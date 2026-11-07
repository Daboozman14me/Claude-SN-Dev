import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { load } from "cheerio";
import {
  codeImplementationPackageSchema,
  type CodeImplementationPackage,
} from "./assisted-contracts.js";
import { isDirectExecution } from "./direct-execution.js";
import { diffSnapshots, snapshotFluentProject } from "./snapshot-fluent-project.js";
import { readCodeReviewPackage } from "./validate-assisted-code-review.js";

export interface CodeImplementationValidationOptions {
  // Recompute the project snapshot and require the declared changes to match the disk exactly.
  verifyChanges?: boolean;
}

function text(html: string): string {
  return load(html).root().text().replace(/\s+/g, " ").trim();
}

function sectionsByHeading(html: string): Map<string, string> {
  const headings = [...html.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi)];
  const sections = new Map<string, string>();
  headings.forEach((match, index) => {
    const name = text(match[1]!).replace(/^\d+\.\s*/, "").toLocaleLowerCase();
    const start = match.index! + match[0].length;
    const end = index + 1 < headings.length ? headings[index + 1]!.index! : html.length;
    sections.set(name, html.slice(start, end));
  });
  return sections;
}

function readJson(path: string, label: string): Record<string, unknown> {
  if (!existsSync(path)) throw new Error(`${label} does not exist: '${path}'.`);
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

function validateArtifactPair(value: CodeImplementationPackage, jsonPath: string): string {
  if (resolve(value.artifacts.json) !== jsonPath) {
    throw new Error("Code implementation artifacts.json must identify the JSON file being validated.");
  }
  const match = basename(jsonPath).match(/^(code-implementation-v[0-9]+)\.json$/);
  if (!match) {
    throw new Error("Code implementation JSON filename must use code-implementation-vNNN.json.");
  }
  const htmlPath = join(dirname(jsonPath), `${match[1]!}.html`);
  if (resolve(value.artifacts.html) !== resolve(htmlPath)) {
    throw new Error("Code implementation HTML must share the JSON report directory and version.");
  }
  if (!existsSync(htmlPath) || !statSync(htmlPath).isFile()) {
    throw new Error(`Code implementation HTML artifact does not exist: '${htmlPath}'.`);
  }
  return htmlPath;
}

function validateHtml(value: CodeImplementationPackage, htmlPath: string): void {
  const html = readFileSync(htmlPath, "utf8");
  const sections = sectionsByHeading(html);
  const required = [
    "Summary",
    "Inputs and Scope",
    "Changes",
    value.mode === "build" ? "Story Coverage" : "Fix Results",
    "Build",
    "Limitations",
  ];
  for (const name of required) {
    if (!sections.has(name.toLocaleLowerCase())) {
      throw new Error(`Code implementation HTML is missing required <h2> section '${name}'.`);
    }
  }

  const changesHtml = sections.get("changes")!;
  const markers = [...changesHtml.matchAll(/<!--\s*change:(\d+)\s*-->/g)].map((match) => ({
    number: Number(match[1]),
    index: match.index!,
  }));
  if (markers.length !== value.changes.length) {
    throw new Error(
      `Code implementation HTML has ${markers.length} change markers but the JSON records ${value.changes.length} changes.`,
    );
  }
  value.changes.forEach((change, position) => {
    const number = position + 1;
    const marker = markers.find((entry) => entry.number === number);
    if (!marker) throw new Error(`Code implementation HTML is missing marker '<!-- change:${number} -->'.`);
    const next = markers.map((entry) => entry.index).filter((index) => index > marker.index).sort((a, b) => a - b)[0];
    const block = text(changesHtml.slice(marker.index, next ?? changesHtml.length));
    for (const detail of [basename(change.path), change.action, ...change.implements.map((ref) => ref.id)]) {
      if (!block.includes(detail)) {
        throw new Error(`Code implementation HTML change ${number} is missing visible detail '${detail}'.`);
      }
    }
  });

  if (value.mode === "build") {
    const coverage = text(sections.get("story coverage")!);
    for (const entry of value.storyCoverage) {
      if (!coverage.includes(entry.storyId) || !coverage.includes(entry.status)) {
        throw new Error(`Story Coverage section does not show '${entry.storyId}' with status '${entry.status}'.`);
      }
    }
  } else {
    const fixes = text(sections.get("fix results")!);
    for (const result of value.fixResults) {
      if (!fixes.includes(result.findingId) || !fixes.includes(result.outcome)) {
        throw new Error(`Fix Results section does not show '${result.findingId}' with outcome '${result.outcome}'.`);
      }
    }
  }
  if (!text(sections.get("build")!).includes(value.build.status)) {
    throw new Error(`Build section does not show the build status '${value.build.status}'.`);
  }
}

function validateBuildInputs(value: CodeImplementationPackage): void {
  const stories = readJson(resolve(value.inputs.storyPackage!.path), "Story package");
  const design = readJson(resolve(value.inputs.technicalDesignPackage!.path), "Technical design package");
  const storyList = (stories.stories ?? []) as Array<{ id: string; acceptanceCriteria?: Array<{ id: string }> }>;
  const storyIds = new Set(storyList.map((story) => story.id));
  const criterionIds = new Set(storyList.flatMap((story) => (story.acceptanceCriteria ?? []).map((criterion) => criterion.id)));
  const decisionIds = new Set(((design.designDecisions ?? []) as Array<{ id: string }>).map((decision) => decision.id));

  for (const storyId of value.requestedStoryIds) {
    if (!storyIds.has(storyId)) throw new Error(`Requested story '${storyId}' is not in the story package.`);
  }
  for (const change of value.changes) {
    for (const ref of change.implements) {
      const known =
        ref.kind === "story" ? storyIds : ref.kind === "acceptance_criterion" ? criterionIds : decisionIds;
      if (!known.has(ref.id)) {
        throw new Error(`Change '${basename(change.path)}' cites unknown ${ref.kind.replace("_", " ")} '${ref.id}'.`);
      }
    }
  }
}

function validateFixInputs(value: CodeImplementationPackage): void {
  const { value: review } = readCodeReviewPackage(resolve(value.inputs.codeReview!.path));
  const results = new Map(value.fixResults.map((result) => [result.findingId, result]));
  for (const finding of review.findings) {
    const result = results.get(finding.id);
    if (!result) throw new Error(`Review finding '${finding.id}' has no fixResults entry.`);
    const approved = finding.decision.status === "approved";
    if (result.outcome === "applied" && !approved) {
      throw new Error(`Finding '${finding.id}' was applied but its decision is '${finding.decision.status}'.`);
    }
    if (result.outcome === "skipped_not_approved" && approved) {
      throw new Error(`Finding '${finding.id}' is approved but was recorded as skipped_not_approved.`);
    }
    if (result.outcome === "skipped_no_change" && finding.suggestedCode !== null) {
      throw new Error(`Finding '${finding.id}' proposes a code change but was recorded as skipped_no_change.`);
    }
  }
  for (const id of results.keys()) {
    if (!review.findings.some((finding) => finding.id === id)) {
      throw new Error(`fixResults entry '${id}' is not a finding in the code review.`);
    }
  }
}

function verifyChangesOnDisk(value: CodeImplementationPackage): void {
  const current = snapshotFluentProject(value.project.root);
  const diff = diffSnapshots(value.baseline, current);
  const declared = (action: string) =>
    value.changes.filter((change) => change.action === action).map((change) => resolve(change.path)).sort((a, b) => a.localeCompare(b));
  for (const [action, actual] of [
    ["created", diff.created],
    ["modified", diff.modified],
    ["deleted", diff.deleted],
  ] as const) {
    const expected = declared(action);
    const undeclared = actual.filter((path) => !expected.includes(path));
    const phantom = expected.filter((path) => !actual.includes(path));
    if (undeclared.length > 0) {
      throw new Error(`Files ${action} on disk but not declared: ${undeclared.join(", ")}.`);
    }
    if (phantom.length > 0) {
      throw new Error(`Changes declared as ${action} but not found on disk: ${phantom.join(", ")}.`);
    }
  }
  const hashes = new Map(current.files.map((file) => [resolve(file.path), file.sha256]));
  for (const change of value.changes) {
    if (change.action !== "deleted" && hashes.get(resolve(change.path)) !== change.sha256After) {
      throw new Error(`'${change.path}' on disk does not match its recorded sha256After.`);
    }
  }
}

export function validateAssistedCodeImplementationFile(
  path: string,
  options: CodeImplementationValidationOptions = {},
): string {
  const jsonPath = resolve(path);
  const value = codeImplementationPackageSchema.parse(JSON.parse(readFileSync(jsonPath, "utf8")) as unknown);
  const htmlPath = validateArtifactPair(value, jsonPath);
  validateHtml(value, htmlPath);
  if (value.mode === "build") validateBuildInputs(value);
  else validateFixInputs(value);
  if (options.verifyChanges) verifyChangesOnDisk(value);
  return jsonPath;
}

if (isDirectExecution(import.meta.url, process.argv[1])) {
  const args = process.argv.slice(2);
  const path = args.find((arg) => !arg.startsWith("--"));
  if (!path) {
    process.stderr.write(
      "Usage: npm run validate:assisted-code-implementation -- <code-implementation-vNNN.json> [--verify-changes]\n",
    );
    process.exitCode = 1;
  } else {
    try {
      const verifyChanges = args.includes("--verify-changes");
      process.stdout.write(
        `Valid CodeImplementationPackage: ${validateAssistedCodeImplementationFile(path, { verifyChanges })}\n`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`Invalid CodeImplementationPackage: ${message}\n`);
      process.exitCode = 1;
    }
  }
}
