import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import {
  assistedApplicationResearchPackageSchema,
  type AssistedApplicationResearchPackage,
} from "./assisted-contracts.js";
import { isDirectExecution } from "./direct-execution.js";

export const MAX_ASSISTED_RESEARCH_BYTES = 2 * 1_024 * 1_024;
const PROPOSED_DESIGN_PATTERN =
  /\b(proposed (?:target[- ]state|solution|design|architecture)|target[- ]state (?:solution|design|architecture)|we recommend(?:ed)?|recommended (?:solution|design|architecture|approach)|implement the following|should be implemented)\b/i;

function validateCurrentStateNarrative(
  value: AssistedApplicationResearchPackage,
): void {
  const narratives = [
    value.summary,
    ...value.findings.flatMap((finding) => [
      finding.title,
      finding.detail,
      finding.relevance,
    ]),
    ...value.limitations,
  ];
  const proposedText = narratives
    .map((narrative) => narrative.match(PROPOSED_DESIGN_PATTERN)?.[0])
    .find(Boolean);
  if (proposedText) {
    throw new Error(
      `Research JSON contains proposed-design content '${proposedText}'. Recommendations belong in the separate solution report.`,
    );
  }
}

function validateExpectedTarget(
  value: AssistedApplicationResearchPackage,
  expectedTargetApplication?: string,
): void {
  if (
    expectedTargetApplication !== undefined &&
    value.requestContext.targetApplication.toLocaleLowerCase() !==
      expectedTargetApplication.toLocaleLowerCase()
  ) {
    throw new Error(
      "Research requestContext.targetApplication must match the supervisor-provided target application.",
    );
  }
}

export function validateAssistedResearchJson(
  json: string,
  expectedTargetApplication?: string,
): void {
  if (Buffer.byteLength(json, "utf8") > MAX_ASSISTED_RESEARCH_BYTES) {
    throw new Error(
      `Assisted research JSON exceeds the ${MAX_ASSISTED_RESEARCH_BYTES}-byte structured-package limit.`,
    );
  }
  const value = assistedApplicationResearchPackageSchema.parse(
    JSON.parse(json) as unknown,
  );
  validateExpectedTarget(value, expectedTargetApplication);
  validateCurrentStateNarrative(value);
}

function visibleMarkdown(source: string): string {
  return source
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/<[^>]+>/g, "");
}

function markdownMarkerIndex(source: string, marker: string): number {
  const lines = source.split(/\r?\n/);
  let offset = 0;
  let inFence = false;
  let inComment = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!inComment && /^```/.test(trimmed)) {
      inFence = !inFence;
    }
    if (!inFence && !inComment && trimmed === marker) {
      return offset + line.indexOf(marker);
    }
    if (!inFence && trimmed !== marker) {
      if (line.includes("<!--")) inComment = true;
      if (line.includes("-->")) inComment = false;
    }
    offset += line.length + 1;
  }
  return -1;
}

function validateDeliveredResearchArtifacts(
  value: AssistedApplicationResearchPackage,
  validatedJsonPath: string,
): void {
  const expectedJsonPath = resolve(validatedJsonPath);
  if (resolve(value.artifacts.json) !== expectedJsonPath) {
    throw new Error(
      "Research artifacts.json must identify the JSON file being validated.",
    );
  }
  const match = basename(expectedJsonPath).match(
    /^(application-research-v[0-9]+)\.json$/,
  );
  if (!match) {
    throw new Error(
      "Research JSON filename must use application-research-vNNN.json.",
    );
  }
  const reportDirectory = dirname(expectedJsonPath);
  const baseName = match[1]!;
  const expectedMarkdownPath = join(reportDirectory, `${baseName}.md`);
  const expectedEvidenceDirectory = join(
    reportDirectory,
    "evidence",
    baseName,
  );
  if (resolve(value.artifacts.markdown) !== resolve(expectedMarkdownPath)) {
    throw new Error(
      "Research Markdown must share the JSON report directory and version.",
    );
  }
  if (
    resolve(value.artifacts.evidenceDirectory) !==
    resolve(expectedEvidenceDirectory)
  ) {
    throw new Error(
      "Research evidence directory must be the version-specific child of the report directory.",
    );
  }
  if (
    !existsSync(expectedMarkdownPath) ||
    !statSync(expectedMarkdownPath).isFile()
  ) {
    throw new Error(
      `Research Markdown artifact does not exist: '${expectedMarkdownPath}'.`,
    );
  }
  const markdown = readFileSync(expectedMarkdownPath, "utf8").replace(
    /\r\n/g,
    "\n",
  );
  if (
    !/^# .*(Architecture Research Report|Current-State Architecture Report)/im.test(
      markdown,
    )
  ) {
    throw new Error(
      "Research Markdown must identify itself as an Architecture Research Report.",
    );
  }
  const requiredMarkdownSections = [
    "Summary — Artifact Counts",
    "Architecture Overview",
    "Order / Record Lifecycle",
    "Intake Paths",
    "Data Model",
    "Complete Application Inventory",
    "Technical Debt & Risk Notes",
    "Research Limitations",
  ];
  const markdownLines = markdown.split(/\r?\n/);
  const markdownSection = (heading: string): string | undefined => {
    let inComment = false;
    let inFence = false;
    let start = -1;
    let end = markdownLines.length;
    for (let index = 0; index < markdownLines.length; index += 1) {
      const line = markdownLines[index]!;
      if (line.includes("<!--")) inComment = true;
      if (!inComment && /^```/.test(line.trim())) inFence = !inFence;
      if (!inComment && !inFence) {
        const match = line.match(/^##\s+(.+?)\s*$/);
        const normalized = match?.[1]
          ?.replace(/^\d+\.\s+/, "")
          .trim()
          .toLocaleLowerCase();
        if (normalized === heading.toLocaleLowerCase()) {
          start = index;
        } else if (start >= 0 && match) {
          end = index;
          break;
        }
      }
      if (line.includes("-->")) inComment = false;
    }
    if (start < 0) {
      return undefined;
    }
    return markdownLines.slice(start + 1, end).join("\n");
  };
  const markdownMermaid = (
    section: string,
    diagramType: RegExp,
  ): string | undefined => {
    const withoutComments = section.replace(/<!--[\s\S]*?-->/g, "");
    const match = withoutComments.match(
      /```mermaid\s*\r?\n([\s\S]+?)```/i,
    );
    const body = match?.[1]?.trim();
    return body && diagramType.test(body) && /--/.test(body)
      ? body
      : undefined;
  };
  for (const section of requiredMarkdownSections) {
    const content = markdownSection(section);
    if (content === undefined) {
      throw new Error(
        `Research Markdown is missing required section '${section}'.`,
      );
    }
    if (visibleMarkdown(content).trim().length < 10) {
      throw new Error(
        `Research Markdown section '${section}' must include substantive visible narrative.`,
      );
    }
  }
  const markdownDiagramRequirements = new Map<string, RegExp>([
    ["Architecture Overview", /^(?:flowchart|graph)\b/im],
    ["Order / Record Lifecycle", /^stateDiagram(?:-v2)?\b/im],
    ["Intake Paths", /^(?:flowchart|graph)\b/im],
    ["Data Model", /^erDiagram\b/im],
  ]);
  const markdownDiagrams = new Set<string>();
  for (const [diagramSection, diagramType] of markdownDiagramRequirements) {
    const diagram = markdownMermaid(
      markdownSection(diagramSection)!,
      diagramType,
    );
    if (!diagram) {
      throw new Error(
        `Research Markdown section '${diagramSection}' must include a connected ${diagramType.source} Mermaid diagram.`,
      );
    }
    markdownDiagrams.add(diagram.replace(/\s+/g, " "));
  }
  if (markdownDiagrams.size !== markdownDiagramRequirements.size) {
    throw new Error(
      "Research Markdown must include four distinct, diagram-specific current-state diagrams.",
    );
  }
  if (
    /^#{1,6}\s+.*\b(target[- ]state|solution recommendation|design recommendation|implementation approach|information to confirm|open questions|unanswered questions|clarification questions)\b/im.test(
      markdown,
    )
  ) {
    throw new Error(
      "Research Markdown must not contain recommendation or open-question sections; those belong in the separate solution report.",
    );
  }
  const proposedMarkdownText = visibleMarkdown(markdown).match(
    PROPOSED_DESIGN_PATTERN,
  )?.[0];
  if (proposedMarkdownText) {
    throw new Error(
      `Research Markdown contains proposed-design content '${proposedMarkdownText}'. Recommendations belong in the separate solution report.`,
    );
  }
  for (const inventory of value.inventory) {
    const markdownCategoryMarker = `<!-- inventory-category:${inventory.category} -->`;
    const categoryMarkerIndex = markdownMarkerIndex(
      markdown,
      markdownCategoryMarker,
    );
    if (categoryMarkerIndex < 0) {
      throw new Error(
        `Research Markdown is missing inventory category '${inventory.category}'.`,
      );
    }
    const nextCategoryIndex = markdown.indexOf(
      "<!-- inventory-category:",
      categoryMarkerIndex + markdownCategoryMarker.length,
    );
    const categoryBlock = markdown.slice(
      categoryMarkerIndex + markdownCategoryMarker.length,
      nextCategoryIndex < 0 ? markdown.length : nextCategoryIndex,
    );
    const visibleCategoryHeading = categoryBlock.match(/^###\s+(.+?)\s*$/m)?.[1];
    const normalizeCategory = (text: string): string =>
      text.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "");
    if (
      !visibleCategoryHeading ||
      normalizeCategory(visibleCategoryHeading) !==
        normalizeCategory(inventory.category)
    ) {
      throw new Error(
        `Research Markdown inventory category '${inventory.category}' must include its own visible level-three heading.`,
      );
    }
    const renderedRecordIds = [
      ...categoryBlock.matchAll(/<!-- inventory-record:([^>]+) -->/g),
    ].map((match) => match[1]!);
    if (
      renderedRecordIds.length !== inventory.count ||
      new Set(renderedRecordIds).size !== renderedRecordIds.length
    ) {
      throw new Error(
        `Research Markdown inventory category '${inventory.category}' must render exactly ${inventory.count} unique record markers.`,
      );
    }
    for (const record of inventory.records) {
      const marker = `<!-- inventory-record:${record.id} -->`;
      const markerIndex = markdownMarkerIndex(categoryBlock, marker);
      if (markerIndex < 0) {
        throw new Error(
          `Research Markdown inventory category '${inventory.category}' is missing record '${record.id}'.`,
        );
      }
      const followingText = categoryBlock.slice(
        markerIndex + marker.length,
        categoryBlock.indexOf(
          "<!-- inventory-record:",
          markerIndex + marker.length,
        ) >= 0
          ? categoryBlock.indexOf(
              "<!-- inventory-record:",
              markerIndex + marker.length,
            )
          : markerIndex + marker.length + 2_000,
      );
      if (!visibleMarkdown(followingText).includes(record.name)) {
        throw new Error(
          `Research Markdown inventory record '${record.id}' is missing visible details for '${record.name}'.`,
        );
      }
    }
  }
  for (const evidence of value.evidence) {
    const path = resolve(evidence.evidenceFile);
    if (!existsSync(path) || !statSync(path).isFile()) {
      throw new Error(`Research evidence file does not exist: '${path}'.`);
    }
  }
}

export function validateAssistedResearchFile(
  path: string,
  expectedTargetApplication: string,
): string {
  const absolutePath = resolve(path);
  const json = readFileSync(absolutePath, "utf8");
  if (Buffer.byteLength(json, "utf8") > MAX_ASSISTED_RESEARCH_BYTES) {
    throw new Error(
      `Assisted research JSON exceeds the ${MAX_ASSISTED_RESEARCH_BYTES}-byte structured-package limit.`,
    );
  }
  const value = assistedApplicationResearchPackageSchema.parse(
    JSON.parse(json) as unknown,
  );
  validateExpectedTarget(value, expectedTargetApplication);
  validateCurrentStateNarrative(value);
  validateDeliveredResearchArtifacts(value, absolutePath);
  return absolutePath;
}

if (isDirectExecution(import.meta.url, process.argv[1])) {
  const path = process.argv[2];
  const expectedTargetApplication = process.argv[3];
  if (!path || !expectedTargetApplication) {
    process.stderr.write(
      "Usage: npm run validate:assisted-research -- <research.json> <expected-target-application>\n",
    );
    process.exitCode = 1;
  } else {
    try {
      process.stdout.write(
        `Valid AssistedApplicationResearchPackage: ${validateAssistedResearchFile(path, expectedTargetApplication)}\n`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(
        `Invalid AssistedApplicationResearchPackage: ${message}\n`,
      );
      process.exitCode = 1;
    }
  }
}
