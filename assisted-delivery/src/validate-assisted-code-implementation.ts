import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { load } from "cheerio";
import {
  codeImplementationPackageSchema,
  type CodeImplementationDeliverable,
  type CodeImplementationPackage,
} from "./assisted-contracts.js";
import { isDirectExecution } from "./direct-execution.js";
import { walkDirectory } from "./index-code-review-sources.js";
import { diffSnapshots, snapshotFluentProject } from "./snapshot-fluent-project.js";
import { readCodeReviewPackage } from "./validate-assisted-code-review.js";

export interface CodeImplementationValidationOptions {
  // Recompute the project snapshot and require the declared changes to match the disk exactly.
  verifyChanges?: boolean;
}

const SCRIPT_KINDS = new Set(["background_script", "fix_script", "rollback_script"]);
const REPORT_ENTRY = /^((code-implementation-v[0-9]+(\.html|\.json|-scripts))|(completion-report-v[0-9]+\.(html|json))|\.reservations)$/;

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

function isScript(deliverable: CodeImplementationDeliverable): boolean {
  return SCRIPT_KINDS.has(deliverable.kind);
}

function validateArtifactPair(value: CodeImplementationPackage, jsonPath: string): { htmlPath: string; version: string } {
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
  return { htmlPath, version: match[1]! };
}

function requireSections(sections: Map<string, string>, names: string[]): void {
  for (const name of names) {
    if (!sections.has(name.toLocaleLowerCase())) {
      throw new Error(`Code implementation HTML is missing required <h2> section '${name}'.`);
    }
  }
}

// Splits a section into the blocks that follow each `<!-- label:ID -->` marker.
function markerBlocks(sectionHtml: string, label: string): Map<string, string> {
  const markers = [...sectionHtml.matchAll(new RegExp(`<!--\\s*${label}:([A-Za-z0-9-]+)\\s*-->`, "g"))];
  const blocks = new Map<string, string>();
  markers.forEach((marker, index) => {
    const end = index + 1 < markers.length ? markers[index + 1]!.index! : sectionHtml.length;
    blocks.set(marker[1]!, text(sectionHtml.slice(marker.index!, end)));
  });
  if (blocks.size !== markers.length) throw new Error(`Code implementation HTML repeats a '${label}' marker.`);
  return blocks;
}

function requireVisible(block: string, details: string[], where: string): void {
  for (const detail of details) {
    if (!block.includes(detail)) throw new Error(`${where} is missing visible detail '${detail}'.`);
  }
}

function validateCommonHtml(value: CodeImplementationPackage, sections: Map<string, string>): void {
  const { workOrder, currentState } = value;
  const order = text(sections.get("work order")!);
  requireVisible(
    order,
    [workOrder.target.application, workOrder.target.scope, workOrder.target.instanceAlias, value.outputForm, workOrder.changeSource.kind],
    "Work Order section",
  );
  for (const known of workOrder.knownDifferences) {
    requireVisible(order, [known.id, known.table ?? known.sinceCommit!], "Work Order section");
  }
  const state = text(sections.get("current state")!);
  requireVisible(state, [currentState.method, currentState.parity], "Current State section");
  for (const check of currentState.checks) {
    if (!state.includes(check.name) || !state.includes(check.status)) {
      throw new Error(`Current State section does not show '${check.name}' with status '${check.status}'.`);
    }
    if (check.knownDifference && !state.includes(check.knownDifference)) {
      throw new Error(`Current State section does not show that '${check.name}' is known difference '${check.knownDifference}'.`);
    }
  }
}

function validateCoverageHtml(value: CodeImplementationPackage, sections: Map<string, string>): void {
  if (value.mode === "build") {
    if (value.workOrder.changeSource.kind !== "stories") return;
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
}

function coverageSection(value: CodeImplementationPackage): string[] {
  if (value.mode === "fix") return ["Fix Results"];
  return value.workOrder.changeSource.kind === "stories" ? ["Story Coverage"] : [];
}

function validateFluentHtml(value: CodeImplementationPackage, sections: Map<string, string>): void {
  requireSections(sections, ["Inputs and Scope", "Changes", ...coverageSection(value), "Build"]);
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
    requireVisible(
      block,
      [basename(change.path), change.action, ...change.implements.map((ref) => ref.id)],
      `Code implementation HTML change ${number}`,
    );
  });
  validateCoverageHtml(value, sections);
  if (!text(sections.get("build")!).includes(value.build!.status)) {
    throw new Error(`Build section does not show the build status '${value.build!.status}'.`);
  }
}

function validateScriptHtml(value: CodeImplementationPackage, sections: Map<string, string>): void {
  requireSections(sections, ["Deliverables", "How to Apply", ...coverageSection(value)]);
  const blocks = markerBlocks(sections.get("deliverables")!, "deliverable");
  for (const deliverable of value.deliverables) {
    const block = blocks.get(deliverable.id);
    if (block === undefined) {
      throw new Error(`Deliverables section is missing marker '<!-- deliverable:${deliverable.id} -->'.`);
    }
    const details = [deliverable.kind, ...deliverable.implements.map((ref) => ref.id)];
    if (deliverable.path) details.push(basename(deliverable.path));
    if (deliverable.applicationScope) details.push(deliverable.applicationScope);
    requireVisible(block, details, `Deliverable ${deliverable.id}`);
  }
  for (const id of blocks.keys()) {
    if (!value.deliverables.some((deliverable) => deliverable.id === id)) {
      throw new Error(`Deliverables section marks unknown deliverable '${id}'.`);
    }
  }
  const howTo = text(sections.get("how to apply")!);
  for (const script of value.deliverables.filter(isScript)) {
    requireVisible(howTo, [basename(script.path!)], "How to Apply section");
  }
  validateCoverageHtml(value, sections);
}

function validatePasteHtml(value: CodeImplementationPackage, sections: Map<string, string>): void {
  requireSections(sections, ["Paste Instructions", ...coverageSection(value)]);
  const blocks = markerBlocks(sections.get("paste instructions")!, "paste");
  for (const deliverable of value.deliverables.filter((entry) => entry.kind === "paste_instructions")) {
    const block = blocks.get(deliverable.id);
    if (block === undefined) {
      throw new Error(`Paste Instructions section is missing marker '<!-- paste:${deliverable.id} -->'.`);
    }
    const details = deliverable.targets.flatMap((target) => [target.table, target.name, ...(target.field ? [target.field] : [])]);
    requireVisible(block, [...details, ...deliverable.implements.map((ref) => ref.id)], `Paste instructions ${deliverable.id}`);
  }
  validateCoverageHtml(value, sections);
}

function validateHtml(value: CodeImplementationPackage, htmlPath: string): void {
  const html = readFileSync(htmlPath, "utf8");
  const sections = sectionsByHeading(html);
  requireSections(sections, ["Summary", "Work Order", "Current State", "Limitations"]);
  validateCommonHtml(value, sections);

  if (value.runStatus === "stopped") {
    requireSections(sections, ["Questions"]);
    const questions = text(sections.get("questions")!);
    for (const question of value.questions) {
      if (!questions.includes(text(question))) throw new Error(`Questions section does not show the question '${question}'.`);
    }
    return;
  }
  if (value.outputForm === "fluent") validateFluentHtml(value, sections);
  else if (value.outputForm === "copy_paste") validatePasteHtml(value, sections);
  else validateScriptHtml(value, sections);
}

// A generated script must be safe for a human to paste and run: self-describing header,
// preview by default, every action logged under its deliverable id, and no hard-coded sys_ids.
export function checkScriptConventions(deliverable: CodeImplementationDeliverable, source: string): void {
  const label = `Script '${basename(deliverable.path!)}' (${deliverable.id})`;
  const header = source.trimStart().match(/^\/\*[\s\S]*?\*\//);
  if (!header) throw new Error(`${label} must start with a /* ... */ header comment.`);
  const headerText = header[0];
  if (!new RegExp(`run order\\s*:\\s*${deliverable.order}\\b`, "i").test(headerText)) {
    throw new Error(`${label} header does not state 'Run order: ${deliverable.order}'.`);
  }
  const headerDetails = [deliverable.id, deliverable.applicationScope!];
  if (deliverable.rollbackFor) headerDetails.push(deliverable.rollbackFor);
  for (const detail of [...headerDetails, ...deliverable.implements.map((ref) => ref.id)]) {
    if (!headerText.includes(detail)) throw new Error(`${label} header does not state '${detail}'.`);
  }
  if (!/^\s*var\s+DRY_RUN\s*=\s*true\s*;/m.test(source)) {
    throw new Error(`${label} must declare 'var DRY_RUN = true;' so it previews by default.`);
  }
  if (/^\s*(var\s+)?DRY_RUN\s*=\s*false\b/m.test(source)) {
    throw new Error(`${label} must not switch DRY_RUN off; the human does that after reviewing the preview.`);
  }
  if (!source.includes(`gs.info('[${deliverable.id}]`) && !source.includes(`gs.info("[${deliverable.id}]`)) {
    throw new Error(`${label} must log its actions with gs.info('[${deliverable.id}] ...').`);
  }
  const sysId = source.match(/(["'])[0-9a-f]{32}\1/i);
  if (sysId) throw new Error(`${label} hard-codes the sys_id ${sysId[0]}; look records up by name instead.`);
}

function checkReadme(value: CodeImplementationPackage, readme: string): void {
  const scripts = value.deliverables.filter(isScript).sort((a, b) => a.order! - b.order!);
  let cursor = -1;
  for (const script of scripts) {
    const name = basename(script.path!);
    const at = readme.indexOf(name, cursor + 1);
    if (at === -1) {
      throw new Error(
        readme.includes(name) ? `README lists '${name}' out of run order.` : `README does not list script '${name}'.`,
      );
    }
    const lineEnd = readme.indexOf("\n", at);
    const line = readme.slice(readme.lastIndexOf("\n", at) + 1, lineEnd === -1 ? readme.length : lineEnd);
    if (!line.includes(script.applicationScope!)) {
      throw new Error(`README entry for '${name}' does not name its application scope '${script.applicationScope}'.`);
    }
    cursor = at;
  }
}

function validateDeliverableFiles(value: CodeImplementationPackage, jsonPath: string, version: string): void {
  const reportDirectory = dirname(jsonPath);
  const scriptsDirectory = join(reportDirectory, `${version}-scripts`);
  for (const entry of readdirSync(reportDirectory)) {
    if (!REPORT_ENTRY.test(entry)) {
      throw new Error(`Report folder contains '${entry}', which the code writer must not create.`);
    }
  }
  const files = value.deliverables.filter((deliverable) => deliverable.path);
  if (files.length === 0) {
    if (existsSync(scriptsDirectory)) throw new Error(`'${scriptsDirectory}' exists but no deliverable files are declared.`);
    return;
  }
  const declared = new Set<string>();
  for (const deliverable of files) {
    const path = resolve(deliverable.path!);
    const fromScripts = relative(scriptsDirectory, path);
    if (fromScripts === "" || fromScripts.startsWith("..") || resolve(scriptsDirectory, fromScripts) !== path) {
      throw new Error(`Deliverable '${deliverable.id}' must live in '${scriptsDirectory}'.`);
    }
    if (!existsSync(path) || !statSync(path).isFile()) {
      throw new Error(`Deliverable '${deliverable.id}' file does not exist: '${path}'.`);
    }
    const content = readFileSync(path);
    if (createHash("sha256").update(content).digest("hex") !== deliverable.sha256) {
      throw new Error(`Deliverable '${deliverable.id}' file does not match its recorded sha256.`);
    }
    declared.add(path);
    if (isScript(deliverable)) checkScriptConventions(deliverable, content.toString("utf8"));
  }
  for (const path of walkDirectory(scriptsDirectory, new Set())) {
    if (!declared.has(resolve(path))) throw new Error(`'${path}' is in the scripts folder but is not a declared deliverable.`);
  }
  const readme = value.deliverables.find((deliverable) => deliverable.kind === "readme");
  if (readme) checkReadme(value, readFileSync(readme.path!, "utf8"));
}

function implementedReferences(value: CodeImplementationPackage) {
  return [
    ...value.changes.map((change) => ({ label: `Change '${basename(change.path)}'`, refs: change.implements })),
    ...value.deliverables.map((deliverable) => ({ label: `Deliverable '${deliverable.id}'`, refs: deliverable.implements })),
  ];
}

function git(root: string, args: string[]): { ok: boolean; output: string } {
  try {
    return { ok: true, output: execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) };
  } catch {
    return { ok: false, output: "" };
  }
}

// An undeployed-commits difference is only expected if git proves it: the commit is an ancestor
// of HEAD, there is work since it, and every check citing it is a file that work changed.
function verifyUndeployedCommits(value: CodeImplementationPackage): void {
  const differences = value.workOrder.knownDifferences.filter((known) => known.kind === "undeployed_commits");
  if (differences.length === 0) return;
  const root = value.project?.root ?? value.workOrder.appLocation.path;
  if (!root) throw new Error("An undeployed-commits difference needs the project folder to check its git history.");
  for (const known of differences) {
    const since = known.sinceCommit!;
    if (!git(root, ["rev-parse", "--verify", "--quiet", `${since}^{commit}`]).ok) {
      throw new Error(`Known difference '${known.id}': commit '${since}' is not in the project's git history.`);
    }
    if (!git(root, ["merge-base", "--is-ancestor", since, "HEAD"]).ok) {
      throw new Error(`Known difference '${known.id}': commit '${since}' is not an ancestor of the project's HEAD.`);
    }
    const changed = new Set(
      git(root, ["diff", "--name-only", since, "HEAD"]).output.split(/\r?\n/).filter(Boolean).map((path) => path.toLocaleLowerCase()),
    );
    if (changed.size === 0) throw new Error(`Known difference '${known.id}': no files changed since '${since}'.`);
    for (const check of value.currentState.checks.filter((entry) => entry.knownDifference === known.id)) {
      const file = relative(resolve(root), resolve(check.path!)).split(sep).join("/").toLocaleLowerCase();
      if (!changed.has(file)) {
        throw new Error(`Check '${check.name}' cites '${known.id}', but '${check.path}' did not change since '${since}'.`);
      }
    }
  }
}

function validateBuildInputs(value: CodeImplementationPackage): void {
  if (value.workOrder.changeSource.kind !== "stories") return;
  const stories = readJson(resolve(value.inputs.storyPackage!.path), "Story package");
  const design = readJson(resolve(value.inputs.technicalDesignPackage!.path), "Technical design package");
  const storyList = (stories.stories ?? []) as Array<{ id: string; acceptanceCriteria?: Array<{ id: string }> }>;
  const storyIds = new Set(storyList.map((story) => story.id));
  const criterionIds = new Set(storyList.flatMap((story) => (story.acceptanceCriteria ?? []).map((criterion) => criterion.id)));
  const decisionIds = new Set(((design.designDecisions ?? []) as Array<{ id: string }>).map((decision) => decision.id));

  for (const storyId of value.requestedStoryIds) {
    if (!storyIds.has(storyId)) throw new Error(`Requested story '${storyId}' is not in the story package.`);
  }
  for (const { label, refs } of implementedReferences(value)) {
    for (const ref of refs) {
      const known =
        ref.kind === "story" ? storyIds : ref.kind === "acceptance_criterion" ? criterionIds : decisionIds;
      if (!known.has(ref.id)) {
        throw new Error(`${label} cites unknown ${ref.kind.replace("_", " ")} '${ref.id}'.`);
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
  if (!value.project || !value.baseline) {
    throw new Error("--verify-changes applies only to Fluent output with a project and baseline.");
  }
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
  const { htmlPath, version } = validateArtifactPair(value, jsonPath);
  validateHtml(value, htmlPath);
  verifyUndeployedCommits(value);
  if (value.outputForm !== "fluent") validateDeliverableFiles(value, jsonPath, version);
  if (value.runStatus === "completed") {
    if (value.mode === "build") validateBuildInputs(value);
    else validateFixInputs(value);
  }
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
