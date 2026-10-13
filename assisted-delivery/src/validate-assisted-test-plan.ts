import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import {
  testPlanPackageSchema,
  type TestPlanPackage,
} from "./assisted-contracts.js";
import { isDirectExecution } from "./direct-execution.js";

function visibleMarkdown(source: string): string {
  return source
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/```[\s\S]*?```/g, "");
}

function itemBlock(markdown: string, marker: string): string | undefined {
  const index = markdown.indexOf(marker);
  if (index < 0) return undefined;
  const nextOffsets = [
    markdown.indexOf("<!-- source-story:", index + marker.length),
    markdown.indexOf("<!-- acceptance-criterion:", index + marker.length),
    markdown.indexOf("<!-- test-scenario:", index + marker.length),
    markdown.indexOf("<!-- coverage-gap:", index + marker.length),
    markdown.indexOf("\n## ", index + marker.length),
  ].filter((offset) => offset >= 0);
  const end = nextOffsets.length > 0 ? Math.min(...nextOffsets) : markdown.length;
  return markdown.slice(index + marker.length, end);
}

function requireRenderedItem(
  section: string,
  marker: string,
  label: string,
  details: readonly string[],
  citationIds: readonly string[],
): void {
  const block = itemBlock(section, marker);
  if (block === undefined) {
    throw new Error(`Test-plan Markdown is missing marker '${marker}'.`);
  }

  const visible = visibleMarkdown(block);
  for (const detail of details) {
    if (!visible.includes(detail)) {
      throw new Error(
        `Test-plan Markdown item '${label}' is missing structured detail '${detail}'.`,
      );
    }
  }

  if (
    citationIds.length > 0 &&
    !block.includes(`<!-- citations:${citationIds.join(",")} -->`)
  ) {
    throw new Error(
      `Test-plan Markdown item '${label}' is missing its citation marker.`,
    );
  }
}

function requireLabeledField(
  block: string,
  label: string,
  value: string,
  scenarioId: string,
): void {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedValue = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (
    !new RegExp(
      `^\\s*(?:[-*]\\s*)?${escapedLabel}:\\s*${escapedValue}\\s*$`,
      "im",
    ).test(block)
  ) {
    throw new Error(
      `Test scenario '${scenarioId}' is missing labeled field '${label}'.`,
    );
  }
}

function validateMarkdown(value: TestPlanPackage, markdownPath: string): void {
  const markdown = readFileSync(markdownPath, "utf8").replace(/\r\n/g, "\n");
  if (!/^# .*Test Plan/im.test(markdown)) {
    throw new Error("Test-plan Markdown must identify itself as a Test Plan.");
  }
  const lines = markdown.split("\n");
  const sectionContent = (heading: string): string | undefined => {
    const start = lines.findIndex((line) => {
      const match = line.match(/^##\s+(.+?)\s*$/);
      return (
        match?.[1]?.replace(/^\d+\.\s+/, "").trim().toLocaleLowerCase() ===
        heading.toLocaleLowerCase()
      );
    });
    if (start < 0) return undefined;
    const next = lines
      .slice(start + 1)
      .findIndex((line) => /^##\s+/.test(line));
    const end = next < 0 ? lines.length : start + 1 + next;
    return lines.slice(start + 1, end).join("\n");
  };
  const sections = new Map<string, string>();
  for (const section of [
    "Test Plan Summary",
    "Source Stories and Acceptance Criteria",
    "Coverage Summary",
    "Test Scenarios by Story",
    "Coverage Gaps",
    "Assumptions and Limitations",
  ]) {
    const content = sectionContent(section);
    if (content === undefined) {
      throw new Error(
        `Test-plan Markdown is missing required section '${section}'.`,
      );
    }
    if (visibleMarkdown(content).trim().length < 10) {
      throw new Error(
        `Test-plan Markdown section '${section}' must contain substantive visible content.`,
      );
    }
    sections.set(section, content);
  }

  const sourceSection = sections.get(
    "Source Stories and Acceptance Criteria",
  )!;
  const scenarioSection = sections.get("Test Scenarios by Story")!;
  const gapSection = sections.get("Coverage Gaps")!;
  const assumptionSection = sections.get("Assumptions and Limitations")!;
  for (const story of value.stories) {
    requireRenderedItem(
      sourceSection,
      `<!-- source-story:${story.id} -->`,
      story.id,
      [story.title],
      story.citationIds,
    );
    for (const criterion of story.acceptanceCriteria) {
      requireRenderedItem(
        sourceSection,
        `<!-- acceptance-criterion:${criterion.id} -->`,
        criterion.id,
        [criterion.text],
        criterion.citationIds,
      );
    }
  }
  for (const scenario of value.scenarios) {
    requireRenderedItem(
      scenarioSection,
      `<!-- test-scenario:${scenario.id} -->`,
      scenario.id,
      [
        scenario.title,
        scenario.storyId,
        ...scenario.acceptanceCriterionIds,
        scenario.given,
        scenario.when,
        scenario.then,
        scenario.category,
        scenario.priority,
        scenario.source,
      ],
      scenario.citationIds,
    );
    const block = itemBlock(
      scenarioSection,
      `<!-- test-scenario:${scenario.id} -->`,
    )!;
    const labeledFields: ReadonlyArray<readonly [string, string]> = [
      ["Story", scenario.storyId],
      [
        "Acceptance criteria",
        scenario.acceptanceCriterionIds.join(", "),
      ],
      ["Given", scenario.given],
      ["When", scenario.when],
      ["Then", scenario.then],
      ["Category", scenario.category],
      ["Priority", scenario.priority],
      ["Source", scenario.source],
    ];
    for (const [label, fieldValue] of labeledFields) {
      requireLabeledField(block, label, fieldValue, scenario.id);
    }
  }
  for (const gap of value.coverageGaps) {
    requireRenderedItem(
      gapSection,
      `<!-- coverage-gap:${gap.id} -->`,
      gap.id,
      [
        gap.storyId,
        ...(gap.acceptanceCriterionId ? [gap.acceptanceCriterionId] : []),
        gap.reason,
        gap.description,
      ],
      gap.citationIds,
    );
  }
  for (const assumption of value.assumptions) {
    requireRenderedItem(
      assumptionSection,
      `<!-- assumption:${assumption.id} -->`,
      assumption.id,
      [assumption.text],
      assumption.citationIds,
    );
  }
}

export function validateAssistedTestPlanJson(json: string): void {
  testPlanPackageSchema.parse(JSON.parse(json) as unknown);
}

export function validateAssistedTestPlanFile(path: string): string {
  const absolutePath = resolve(path);
  const value = testPlanPackageSchema.parse(
    JSON.parse(readFileSync(absolutePath, "utf8")) as unknown,
  );
  if (resolve(value.artifacts.json) !== absolutePath) {
    throw new Error(
      "Test-plan artifacts.json must identify the JSON file being validated.",
    );
  }
  if (basename(dirname(absolutePath)).toLocaleLowerCase() !== "internal") {
    throw new Error(
      "Test-plan JSON must be stored in the report's internal subfolder.",
    );
  }
  const match = basename(absolutePath).match(/^(test-plan-v[0-9]+)\.json$/);
  if (!match) {
    throw new Error("Test-plan JSON filename must use test-plan-vNNN.json.");
  }
  const reportDirectory = dirname(dirname(absolutePath));
  const markdownPath = join(reportDirectory, `${match[1]!}.md`);
  if (resolve(value.artifacts.markdown) !== resolve(markdownPath)) {
    throw new Error(
      "Test-plan Markdown must share the internal JSON version and report directory.",
    );
  }
  if (!existsSync(markdownPath) || !statSync(markdownPath).isFile()) {
    throw new Error(
      `Test-plan Markdown artifact does not exist: '${markdownPath}'.`,
    );
  }
  validateMarkdown(value, markdownPath);
  return absolutePath;
}

if (isDirectExecution(import.meta.url, process.argv[1])) {
  const path = process.argv[2];
  if (!path) {
    process.stderr.write(
      "Usage: npm run validate:assisted-test-plan -- <internal-test-plan.json>\n",
    );
    process.exitCode = 1;
  } else {
    try {
      process.stdout.write(
        `Valid TestPlanPackage: ${validateAssistedTestPlanFile(path)}\n`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`Invalid TestPlanPackage: ${message}\n`);
      process.exitCode = 1;
    }
  }
}
