import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import {
  technicalDesignPackageSchema,
  type TechnicalDesignPackage,
} from "./assisted-contracts.js";
import { isDirectExecution } from "./direct-execution.js";

const PROHIBITED_OUTCOME_PATTERN =
  /\b(?:(?:design|technical design|solution|implementation)\s+(?:is|has been|was)\s+(?:approved|rejected|authorized|certified(?: as)? ready|ready\s+for\s+implementation)|(?:approved|rejected|certified|authorized)\s+for\s+implementation|implementation\s+(?:is\s+)?authorized|authorize[sd]?\s+(?:the\s+)?implementation|implementation\s+(?:may|can|should)\s+proceed|certif(?:y|ies|ied)\b.{0,60}\bready\s+for\s+implementation|(?:sign[- ]off|approval status|quality gate)\s*:\s*(?:approved|passed|complete))\b/gi;

function findProhibitedOutcome(text: string): string | undefined {
  PROHIBITED_OUTCOME_PATTERN.lastIndex = 0;
  for (const match of text.matchAll(PROHIBITED_OUTCOME_PATTERN)) {
    const prefix = text.slice(Math.max(0, match.index! - 60), match.index);
    if (
      /(?:\bnot|\bnever|\bno|\bdoes\s+not|\bdo\s+not|\bcannot|\bcan't)\b(?:\s+\w+){0,3}\s*$/i.test(
        prefix,
      )
    ) {
      continue;
    }
    return match[0];
  }
  return undefined;
}

function validateAdvisoryBoundary(value: TechnicalDesignPackage): void {
  const narratives = [
    value.summary,
    ...value.designDecisions.flatMap((decision) => [
      decision.title,
      decision.design,
      decision.rationale,
      ...decision.affectedArtifacts.flatMap((artifact) => [
        artifact.name,
        artifact.behavior,
      ]),
    ]),
    ...value.evaluationCoverage.map((coverage) => coverage.explanation),
    ...value.evaluationFindings.flatMap((finding) => [
      finding.title,
      finding.observation,
      finding.impact,
      finding.recommendation,
    ]),
    ...value.risks.flatMap((risk) => [
      risk.description,
      ...(risk.mitigation ? [risk.mitigation] : []),
    ]),
    ...value.assumptions.map((assumption) => assumption.text),
    ...value.questions.map((question) => question.text),
  ];
  const prohibited = narratives
    .map((narrative) => findProhibitedOutcome(narrative))
    .find(Boolean);
  if (prohibited) {
    throw new Error(
      `Technical-design JSON contains prohibited governance outcome '${prohibited}'.`,
    );
  }
}

export function validateAssistedTechnicalDesignJson(json: string): void {
  const value = technicalDesignPackageSchema.parse(
    JSON.parse(json) as unknown,
  );
  validateAdvisoryBoundary(value);
}

function visibleMarkdown(source: string): string {
  return source
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/<[^>]+>/g, "");
}

function validateMarkdown(
  value: TechnicalDesignPackage,
  markdownPath: string,
): void {
  const markdown = readFileSync(markdownPath, "utf8").replace(/\r\n/g, "\n");
  const expectedTitle =
    value.mode === "design"
      ? /Technical Design(?! Evaluation)/i
      : /Technical Design Evaluation/i;
  if (!new RegExp(`^# .*${expectedTitle.source}`, "im").test(markdown)) {
    throw new Error(
      `Technical-design Markdown title does not identify ${value.mode} mode.`,
    );
  }

  const requiredSections =
    value.mode === "design"
      ? [
          "Purpose and Scope",
          "Inputs and Traceability",
          "Current-State Constraints",
          "Technical Architecture",
          "Detailed Technical Design",
          "Security Design",
          "Integration and Error Handling",
          "Operational Design",
          "Implementation Sequence",
          "Test Considerations",
          "Risks",
          "Assumptions and Open Questions",
        ]
      : [
          "Evaluation Scope",
          "Inputs and Traceability",
          "Current-State Constraints",
          "Coverage Assessment",
          "Evaluation Findings",
          "Risks and Gaps",
          "Recommendations",
          "Assumptions and Open Questions",
        ];
  const markdownLines = markdown.split("\n");
  const sectionContent = (heading: string): string | undefined => {
    const start = markdownLines.findIndex((line) => {
      const match = line.match(/^##\s+(.+?)\s*$/);
      return (
        match?.[1]?.replace(/^\d+\.\s+/, "").trim().toLocaleLowerCase() ===
        heading.toLocaleLowerCase()
      );
    });
    if (start < 0) return undefined;
    const next = markdownLines
      .slice(start + 1)
      .findIndex((line) => /^##\s+/.test(line));
    const end = next < 0 ? markdownLines.length : start + 1 + next;
    return markdownLines.slice(start + 1, end).join("\n");
  };
  for (const section of requiredSections) {
    const content = sectionContent(section);
    if (content === undefined) {
      throw new Error(
        `Technical-design Markdown is missing required section '${section}'.`,
      );
    }
    if (visibleMarkdown(content).trim().length < 10) {
      throw new Error(
        `Technical-design Markdown section '${section}' must contain substantive visible content.`,
      );
    }
  }

  if (value.mode === "design" && !/```mermaid[\s\S]+?```/i.test(markdown)) {
    throw new Error(
      "Technical-design Markdown must include at least one Mermaid design diagram.",
    );
  }
  const renderedItems =
    value.mode === "design"
      ? value.designDecisions.map((item) => ({
          marker: `<!-- design-decision:${item.id} -->`,
          title: item.title,
          requiredDetails: [
            item.design,
            item.rationale,
            ...item.affectedArtifacts.flatMap((artifact) => [
              artifact.name,
              artifact.type,
              artifact.action,
              artifact.behavior,
            ]),
          ],
          citationIds: item.citationIds,
        }))
      : value.evaluationFindings.map((item) => ({
          marker: `<!-- evaluation-finding:${item.id} -->`,
          title: item.title,
          requiredDetails: [
            item.coverage,
            item.severity,
            item.observation,
            item.impact,
            item.recommendation,
          ],
          citationIds: item.citationIds,
        }));
  for (const item of renderedItems) {
    const index = markdown.indexOf(item.marker);
    if (index < 0) {
      throw new Error(
        `Technical-design Markdown is missing structured item marker '${item.marker}'.`,
      );
    }
    const nextItemOffsets = [
      markdown.indexOf("<!-- design-decision:", index + item.marker.length),
      markdown.indexOf("<!-- evaluation-finding:", index + item.marker.length),
      markdown.indexOf("\n## ", index + item.marker.length),
    ].filter((offset) => offset >= 0);
    const end =
      nextItemOffsets.length > 0 ? Math.min(...nextItemOffsets) : markdown.length;
    const following = markdown.slice(index + item.marker.length, end);
    const visible = visibleMarkdown(following);
    if (!visible.includes(item.title)) {
      throw new Error(
        `Technical-design Markdown is missing visible details for '${item.title}'.`,
      );
    }
    for (const detail of item.requiredDetails) {
      if (!visible.includes(detail)) {
        throw new Error(
          `Technical-design Markdown item '${item.title}' is missing structured detail '${detail}'.`,
        );
      }
    }
    const citationMarker = `<!-- citations:${item.citationIds.join(",")} -->`;
    if (!following.includes(citationMarker)) {
      throw new Error(
        `Technical-design Markdown item '${item.title}' is missing its citation marker.`,
      );
    }
  }
  if (value.mode === "evaluation") {
    for (const coverage of value.evaluationCoverage) {
      const marker = `<!-- coverage:${coverage.area} -->`;
      const index = markdown.indexOf(marker);
      if (index < 0) {
        throw new Error(
          `Technical-design Markdown is missing coverage marker '${marker}'.`,
        );
      }
      const nextCoverage = markdown.indexOf(
        "<!-- coverage:",
        index + marker.length,
      );
      const nextSection = markdown.indexOf("\n## ", index + marker.length);
      const endOffsets = [nextCoverage, nextSection].filter(
        (offset) => offset >= 0,
      );
      const end =
        endOffsets.length > 0 ? Math.min(...endOffsets) : markdown.length;
      const coverageBlock = markdown.slice(index + marker.length, end);
      const following = visibleMarkdown(coverageBlock);
      if (
        !following.includes(coverage.coverage) ||
        !following.includes(coverage.explanation)
      ) {
        throw new Error(
          `Technical-design Markdown coverage '${coverage.area}' is missing visible status or explanation.`,
        );
      }
      if (
        !coverageBlock.includes(
          `<!-- citations:${coverage.citationIds.join(",")} -->`,
        )
      ) {
        throw new Error(
          `Technical-design Markdown coverage '${coverage.area}' is missing its citation marker.`,
        );
      }
    }
  }
  const prohibitedOutcome = findProhibitedOutcome(visibleMarkdown(markdown));
  if (prohibitedOutcome) {
    throw new Error(
      `Technical-design Markdown contains prohibited governance outcome '${prohibitedOutcome}'.`,
    );
  }
}

export function validateAssistedTechnicalDesignFile(path: string): string {
  const absolutePath = resolve(path);
  const value = technicalDesignPackageSchema.parse(
    JSON.parse(readFileSync(absolutePath, "utf8")) as unknown,
  );
  validateAdvisoryBoundary(value);
  if (resolve(value.artifacts.json) !== absolutePath) {
    throw new Error(
      "Technical-design artifacts.json must identify the JSON file being validated.",
    );
  }
  const match = basename(absolutePath).match(
    /^(technical-design-v[0-9]+)\.json$/,
  );
  if (!match) {
    throw new Error(
      "Technical-design JSON filename must use technical-design-vNNN.json.",
    );
  }
  const markdownPath = join(dirname(absolutePath), `${match[1]!}.md`);
  if (resolve(value.artifacts.markdown) !== resolve(markdownPath)) {
    throw new Error(
      "Technical-design Markdown must share the JSON report directory and version.",
    );
  }
  if (!existsSync(markdownPath) || !statSync(markdownPath).isFile()) {
    throw new Error(
      `Technical-design Markdown artifact does not exist: '${markdownPath}'.`,
    );
  }
  validateMarkdown(value, markdownPath);
  return absolutePath;
}

if (isDirectExecution(import.meta.url, process.argv[1])) {
  const path = process.argv[2];
  if (!path) {
    process.stderr.write(
      "Usage: npm run validate:assisted-technical-design -- <technical-design.json>\n",
    );
    process.exitCode = 1;
  } else {
    try {
      process.stdout.write(
        `Valid TechnicalDesignPackage: ${validateAssistedTechnicalDesignFile(path)}\n`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`Invalid TechnicalDesignPackage: ${message}\n`);
      process.exitCode = 1;
    }
  }
}
