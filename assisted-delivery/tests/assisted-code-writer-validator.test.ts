import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test from "node:test";
import { ASSISTED_CONTRACT_VERSION } from "../src/assisted-contracts.js";
import { applyCodeReviewFixes } from "../src/apply-code-review-fixes.js";
import { countLines } from "../src/index-code-review-sources.js";
import { snapshotFluentProject } from "../src/snapshot-fluent-project.js";
import { validateAssistedCodeImplementationFile } from "../src/validate-assisted-code-implementation.js";
import { FIXTURE_SCRIPT, codeReviewPackage, sha256 } from "./code-review-fixtures.js";
import { classicWorkOrder, currentState, scriptDeliverables, workOrder } from "./code-writer-fixtures.js";

const fixtureTarget = { application: "Fixture App", scope: "x_app", instanceAlias: "dev292961" };

function coverageHtml(value: any): string {
  if (value.mode === "fix") {
    return `<h2>Fix Results</h2>${value.fixResults.map((result: any) => `<p>${result.findingId}: ${result.outcome}</p>`).join("")}`;
  }
  if (value.workOrder.changeSource.kind !== "stories") return "";
  return `<h2>Story Coverage</h2>${value.storyCoverage.map((entry: any) => `<p>${entry.storyId}: ${entry.status}</p>`).join("")}`;
}

function formHtml(value: any): string {
  if (value.runStatus === "stopped") {
    return `<h2>Questions</h2><ol>${value.questions.map((question: string) => `<li>${question}</li>`).join("")}</ol>`;
  }
  const implementsIds = (item: any) => item.implements.map((ref: any) => ref.id).join(", ");
  if (value.outputForm === "fluent") {
    const changes = value.changes
      .map(
        (change: any, index: number) =>
          `<!-- change:${index + 1} --><div>${basename(change.path)} — ${change.action} — implements ${implementsIds(change)}</div>`,
      )
      .join("\n");
    return `<h2>Inputs and Scope</h2><p>${value.project.root}</p>
<h2>Changes</h2>${changes}
${coverageHtml(value)}
<h2>Build</h2><p>npm run build: ${value.build.status}</p>`;
  }
  if (value.outputForm === "copy_paste") {
    const paste = value.deliverables
      .filter((deliverable: any) => deliverable.kind === "paste_instructions")
      .map(
        (deliverable: any) =>
          `<!-- paste:${deliverable.id} --><div>${deliverable.targets
            .map((target: any) => `${target.table} / ${target.name}${target.field ? ` / ${target.field}` : ""}`)
            .join("; ")} — implements ${implementsIds(deliverable)}</div>`,
      )
      .join("\n");
    return `<h2>Paste Instructions</h2>${paste}\n${coverageHtml(value)}`;
  }
  const deliverables = value.deliverables
    .map(
      (deliverable: any) =>
        `<!-- deliverable:${deliverable.id} --><div>${deliverable.path ? basename(deliverable.path) : ""} — ${deliverable.kind} — ${
          deliverable.applicationScope ?? ""
        } — implements ${implementsIds(deliverable)}</div>`,
    )
    .join("\n");
  const scripts = value.deliverables
    .filter((deliverable: any) => deliverable.kind !== "readme")
    .sort((a: any, b: any) => a.order - b.order)
    .map((deliverable: any) => `<li>${basename(deliverable.path)}</li>`)
    .join("");
  return `<h2>Deliverables</h2>${deliverables}\n<h2>How to Apply</h2><ol>${scripts}</ol>\n${coverageHtml(value)}`;
}

function htmlFor(value: any): string {
  const { workOrder: order, currentState: state } = value;
  return `<html><body><h1>${value.title}</h1>
<h2>Summary</h2><p>${value.summary}</p>
<h2>Work Order</h2><p>${order.target.application} (${order.target.scope}) on ${order.target.instanceAlias}; output ${value.outputForm}; change source ${order.changeSource.kind}</p>${(order.knownDifferences ?? [])
    .map((known: any) => `<p>${known.id} (${known.table ?? known.sinceCommit}): ${known.reason}</p>`)
    .join("")}
<h2>Current State</h2><p>Method ${state.method}; parity ${state.parity}</p>${state.checks
    .map((check: any) => `<p>${check.name}: ${check.status}${check.knownDifference ? ` (${check.knownDifference})` : ""}</p>`)
    .join("")}
${formHtml(value)}
<h2>Limitations</h2><p>None beyond the fixture.</p>
</body></html>`;
}

function write(value: any, html = htmlFor(value)): string {
  writeFileSync(value.artifacts.json, JSON.stringify(value, null, 2));
  writeFileSync(value.artifacts.html, html);
  return value.artifacts.json;
}

function approvedReview(directory: string) {
  const scriptPath = join(directory, "log-rooms.js");
  writeFileSync(scriptPath, FIXTURE_SCRIPT);
  const review = codeReviewPackage(directory, scriptPath) as any;
  review.artifacts = { html: join(directory, "code-review-v001.html"), json: join(directory, "code-review-v001.json") };
  review.findings.push({
    ...structuredClone(review.findings[0]),
    id: "F-002",
    title: "Second finding",
    location: { sourceId: "SRC-001", path: scriptPath, startLine: 7, endLine: 7 },
    currentCode: "})(current, previous);",
    suggestedCode: "})(current, previous); // later",
    instanceVerification: { status: "not_applicable" },
  });
  return { review, scriptPath };
}

function writeReview(review: any): void {
  writeFileSync(review.artifacts.json, JSON.stringify(review, null, 2));
  writeFileSync(review.artifacts.html, "<h2>Summary</h2>");
}

// Real fix run: review → approve → snapshot → apply → implementation package.
function fixScenario() {
  const project = mkdtempSync(join(tmpdir(), "code-writer-project-"));
  const reports = mkdtempSync(join(tmpdir(), "code-writer-reports-"));
  const { review, scriptPath } = approvedReview(project);
  review.artifacts = { html: join(reports, "code-review-v001.html"), json: join(reports, "code-review-v001.json") };
  review.findings[1].title = "Pending finding";
  review.findings[0].decision = { status: "approved", decidedOn: "2026-11-07T12:00:00.000Z" };
  writeReview(review);

  const baseline = snapshotFluentProject(project);
  const applied = applyCodeReviewFixes(review.artifacts.json);
  const value = {
    contractVersion: ASSISTED_CONTRACT_VERSION,
    packageType: "code_implementation",
    packageId: "fix-run",
    title: "Code Implementation: Fixture — approved fixes",
    summary: "Applied 1 approved finding.",
    artifacts: {
      html: join(reports, "code-implementation-v001.html"),
      json: join(reports, "code-implementation-v001.json"),
    },
    mode: "fix",
    outputForm: "fluent",
    runStatus: "completed",
    questions: [] as string[],
    workOrder: workOrder({
      appLocation: { kind: "local_project", path: project },
      target: fixtureTarget,
      changeSource: { kind: "findings", description: "Approved fixture findings." },
    }),
    currentState: currentState(),
    project: { root: project, scope: "x_app", appName: "Fixture App", created: false },
    inputs: { codeReview: { path: review.artifacts.json } },
    requestedStoryIds: [],
    baseline,
    changes: applied.changedFiles.map((file) => ({
      path: file.path,
      action: "modified",
      sha256After: file.sha256After,
      implements: applied.results.filter((r) => r.outcome === "applied" && r.path === file.path).map((r) => ({ kind: "finding", id: r.findingId })),
      summary: "Applied approved review fixes.",
    })),
    storyCoverage: [],
    fixResults: applied.results.map((r) => ({ findingId: r.findingId, outcome: r.outcome, detail: r.detail })),
    build: { command: "npm run build", status: "passed", errorCount: 0, warningCount: 0 } as any,
    instanceChecks: [],
    assumptions: [],
    limitations: [],
    warnings: [],
  };
  return { project, reports, scriptPath, value };
}

function scriptSource(deliverable: any): string {
  return `/*
 * ${deliverable.id} — ${deliverable.title}
 * Implements: ${deliverable.implements.map((ref: any) => ref.id).join(", ")}
 * Run order: ${deliverable.order}
 * Application scope: ${deliverable.applicationScope}
 * ${deliverable.rollbackFor ? `Undoes: ${deliverable.rollbackFor}` : `Update set: ${deliverable.updateSetGuidance}`}
 * Prerequisites: none.
 */
var DRY_RUN = true;
var rule = new GlideRecord('sys_script');
if (rule.get('name', 'Reservation - Set Defaults')) {
  gs.info('[${deliverable.id}] ' + (DRY_RUN ? 'Would update ' : 'Updating ') + rule.getValue('name'));
}
`;
}

function readmeSource(deliverables: any[]): string {
  const lines = deliverables
    .filter((deliverable) => deliverable.kind !== "readme")
    .sort((a, b) => a.order - b.order)
    .map((deliverable) => `${deliverable.order}. ${basename(deliverable.path)} — scope ${deliverable.applicationScope}`);
  return `# How to apply\n\nRun each script in Scripts - Background with DRY_RUN = true first.\n\n${lines.join("\n")}\n`;
}

function writeDeliverableFiles(value: any): void {
  for (const deliverable of value.deliverables) {
    if (!deliverable.path) continue;
    const content = deliverable.kind === "readme" ? readmeSource(value.deliverables) : scriptSource(deliverable);
    writeFileSync(deliverable.path, content);
    deliverable.sha256 = sha256(content);
  }
}

function rehash(deliverable: any): void {
  deliverable.sha256 = sha256(readFileSync(deliverable.path, "utf8"));
}

// Script-form fix run against the live classic app: review on disk, scripts written beside the report.
function scriptScenario(form: "background_script" | "fix_script" = "background_script", count = 2) {
  const reviewFolder = mkdtempSync(join(tmpdir(), "code-writer-review-"));
  const reports = mkdtempSync(join(tmpdir(), "code-writer-script-reports-"));
  const scripts = join(reports, "code-implementation-v001-scripts");
  mkdirSync(scripts);
  const { review } = approvedReview(reviewFolder);
  for (const finding of review.findings) finding.decision = { status: "approved", decidedOn: "2026-11-07T12:00:00.000Z" };
  writeReview(review);
  const findingIds = Array.from({ length: count }, (_, index) => `F-${String(index + 1).padStart(3, "0")}`);
  const value: any = {
    contractVersion: ASSISTED_CONTRACT_VERSION,
    packageType: "code_implementation",
    packageId: "script-run",
    title: "Code Implementation: Conference Room Booking — approved fixes as scripts",
    summary: `Generated ${count} ${form.replace("_", " ")}(s) with rollbacks.`,
    artifacts: { html: join(reports, "code-implementation-v001.html"), json: join(reports, "code-implementation-v001.json") },
    mode: "fix",
    outputForm: form,
    runStatus: "completed",
    questions: [],
    workOrder: classicWorkOrder("findings"),
    currentState: currentState({
      method: "instance_query",
      checks: [{ table: "sys_script", name: "Reservation - Set Defaults", status: "matches", detail: "Script matches the review." }],
    }),
    inputs: { codeReview: { path: review.artifacts.json } },
    requestedStoryIds: [],
    changes: [],
    deliverables: scriptDeliverables(scripts, form, count),
    storyCoverage: [],
    fixResults: review.findings.map((finding: any) => ({
      findingId: finding.id,
      outcome: findingIds.includes(finding.id) ? "applied" : "skipped_out_of_scope",
      detail: findingIds.includes(finding.id) ? `Generated as a ${form.replace("_", " ")}.` : "Outside this run's scope.",
    })),
    instanceChecks: [],
    assumptions: [],
    limitations: [],
    warnings: [],
  };
  writeDeliverableFiles(value);
  return { reports, scripts, value };
}

test("a real fix run validates, including the on-disk change check", () => {
  const { value } = fixScenario();
  assert.deepEqual(value.fixResults.map((r) => r.outcome), ["applied", "skipped_not_approved"]);
  const jsonPath = write(value);
  assert.equal(validateAssistedCodeImplementationFile(jsonPath, { verifyChanges: true }), jsonPath);
});

test("the on-disk change check catches undeclared, phantom and altered changes", () => {
  const undeclared = fixScenario();
  writeFileSync(join(undeclared.project, "sneaky.js"), "x");
  assert.throws(
    () => validateAssistedCodeImplementationFile(write(undeclared.value), { verifyChanges: true }),
    /created on disk but not declared: .*sneaky\.js/,
  );

  const altered = fixScenario();
  writeFileSync(altered.scriptPath, `${FIXTURE_SCRIPT}// edited after the run\n`);
  assert.throws(
    () => validateAssistedCodeImplementationFile(write(altered.value), { verifyChanges: true }),
    /does not match its recorded sha256After/,
  );

  const phantom = fixScenario();
  const ghost = join(phantom.project, "never-written.js");
  phantom.value.baseline.files.push({ path: ghost, sha256: sha256("x") });
  phantom.value.changes.push({ ...structuredClone(phantom.value.changes[0]!), path: ghost });
  assert.throws(
    () => validateAssistedCodeImplementationFile(write(phantom.value), { verifyChanges: true }),
    /Files deleted on disk but not declared: .*never-written\.js|declared as modified but not found on disk: .*never-written\.js/,
  );
});

test("fix runs must account for every review finding honestly", () => {
  const missing = fixScenario();
  missing.value.fixResults = missing.value.fixResults.filter((r) => r.findingId !== "F-002");
  assert.throws(() => validateAssistedCodeImplementationFile(write(missing.value)), /'F-002' has no fixResults entry/);

  const dishonest = fixScenario();
  dishonest.value.fixResults[1]!.outcome = "skipped_no_change";
  assert.throws(() => validateAssistedCodeImplementationFile(write(dishonest.value)), /proposes a code change but was recorded as skipped_no_change/);

  const extra = fixScenario();
  extra.value.fixResults.push({ findingId: "F-404", outcome: "skipped_no_change", detail: "x" });
  assert.throws(() => validateAssistedCodeImplementationFile(write(extra.value)), /'F-404' is not a finding in the code review/);
});

test("implementation HTML must show the work order, current state, every change, outcome and the build status", () => {
  const cases: Array<[string, (html: string) => string, RegExp]> = [
    ["no marker", (html) => html.replace("<!-- change:1 -->", ""), /0 change markers but the JSON records 1/],
    ["no section", (html) => html.replace("<h2>Fix Results</h2>", "<h3>Fix Results</h3>"), /missing required <h2> section 'Fix Results'/],
    ["no work order", (html) => html.replace("<h2>Work Order</h2>", "<h3>Work Order</h3>"), /missing required <h2> section 'Work Order'/],
    ["hidden scope", (html) => html.replace("(x_app)", ""), /Work Order section is missing visible detail 'x_app'/],
    ["hidden parity", (html) => html.replace("parity matches", "parity ok"), /Current State section is missing visible detail 'matches'/],
    ["hidden outcome", (html) => html.replace("F-002: skipped_not_approved", "F-002: skipped"), /does not show 'F-002' with outcome 'skipped_not_approved'/],
    ["hidden build", (html) => html.replace("npm run build: passed", "npm run build"), /does not show the build status 'passed'/],
    ["hidden finding id", (html) => html.replace("implements F-001", "implements a fix"), /change 1 is missing visible detail 'F-001'/],
  ];
  for (const [label, mutate, expected] of cases) {
    const { value } = fixScenario();
    assert.throws(() => validateAssistedCodeImplementationFile(write(value, mutate(htmlFor(value)))), expected, label);
  }
});

test("build runs must cite stories and design decisions that exist", () => {
  const project = mkdtempSync(join(tmpdir(), "code-writer-build-"));
  const reports = mkdtempSync(join(tmpdir(), "code-writer-build-reports-"));
  const storyPath = join(reports, "story-draft-v001.json");
  const designPath = join(reports, "technical-design-v001.json");
  writeFileSync(storyPath, JSON.stringify({ stories: [{ id: "ST-0.1", acceptanceCriteria: [{ id: "ST-0.1-AC1" }] }] }));
  writeFileSync(designPath, JSON.stringify({ designDecisions: [{ id: "TD-01" }] }));
  const tablePath = join(project, "src", "fluent", "table.now.ts");
  const make = () => ({
    contractVersion: ASSISTED_CONTRACT_VERSION,
    packageType: "code_implementation",
    packageId: "build-run",
    title: "Code Implementation: Fixture — EPIC-0",
    summary: "Implemented ST-0.1.",
    artifacts: { html: join(reports, "code-implementation-v001.html"), json: join(reports, "code-implementation-v001.json") },
    mode: "build",
    outputForm: "fluent",
    runStatus: "completed",
    questions: [],
    workOrder: workOrder({ appLocation: { kind: "local_project", path: project }, target: fixtureTarget }),
    currentState: currentState({ parity: "not_checked" }),
    project: { root: project, scope: "x_app", appName: "Fixture App", created: true },
    inputs: { storyPackage: { path: storyPath }, technicalDesignPackage: { path: designPath } },
    requestedStoryIds: ["ST-0.1"],
    baseline: { capturedAt: "2026-11-07T12:00:00.000Z", files: [] },
    changes: [
      {
        path: tablePath,
        action: "created",
        sha256After: sha256("table"),
        implements: [
          { kind: "story", id: "ST-0.1" },
          { kind: "acceptance_criterion", id: "ST-0.1-AC1" },
          { kind: "design_decision", id: "TD-01" },
        ],
        summary: "Reservation table.",
      },
    ],
    storyCoverage: [{ storyId: "ST-0.1", status: "implemented", note: "Done." }],
    fixResults: [],
    build: { command: "npm run build", status: "passed", errorCount: 0, warningCount: 0 },
    instanceChecks: [],
    assumptions: [],
    limitations: [],
    warnings: [],
  });
  assert.doesNotThrow(() => validateAssistedCodeImplementationFile(write(make())));

  const unknownDecision = make();
  unknownDecision.changes[0]!.implements[2]!.id = "TD-99";
  assert.throws(() => validateAssistedCodeImplementationFile(write(unknownDecision)), /cites unknown design decision 'TD-99'/);

  const unknownStory = make();
  unknownStory.requestedStoryIds = ["ST-9.9"];
  unknownStory.storyCoverage = [{ storyId: "ST-9.9", status: "blocked", note: "x" }];
  assert.throws(() => validateAssistedCodeImplementationFile(write(unknownStory)), /'ST-9.9' is not in the story package/);

  assert.equal(countLines(FIXTURE_SCRIPT), 7);
});

test("a multi-script background run with a README validates", () => {
  const { value } = scriptScenario("background_script", 2);
  const jsonPath = write(value);
  assert.equal(validateAssistedCodeImplementationFile(jsonPath), jsonPath);
});

test("a single fix-script run needs no README", () => {
  const { value } = scriptScenario("fix_script", 1);
  assert.equal(value.deliverables.some((deliverable: any) => deliverable.kind === "readme"), false);
  const jsonPath = write(value);
  assert.equal(validateAssistedCodeImplementationFile(jsonPath), jsonPath);
});

test("generated scripts must be safe to paste: header, preview default, logging, no sys_ids", () => {
  const cases: Array<[string, (source: string) => string, RegExp]> = [
    ["no header", (source) => source.replace(/^\/\*[\s\S]*?\*\/\n/, ""), /must start with a \/\* \.\.\. \*\/ header comment/],
    ["header without order", (source) => source.replace("Run order: 1", "Order TBD"), /header does not state 'Run order: 1'/],
    ["header without scope", (source) => source.replace("Application scope: x_2054821_confer_0", "Scope: global"), /header does not state 'x_2054821_confer_0'/],
    ["header without finding", (source) => source.replace(/F-001/g, "a fix"), /header does not state 'F-001'/],
    ["live by default", (source) => source.replace("var DRY_RUN = true;", "var DRY_RUN = false;"), /must declare 'var DRY_RUN = true;'/],
    ["switched off later", (source) => source.replace("var rule", "DRY_RUN = false;\nvar rule"), /must not switch DRY_RUN off/],
    ["no logging", (source) => source.replace("gs.info('[D-01] '", "gs.info('"), /must log its actions with gs\.info\('\[D-01\]/],
    ["hard-coded sys_id", (source) => source.replace("rule.get('name', 'Reservation - Set Defaults')", `rule.get('${"0123456789abcdef".repeat(2)}')`), /hard-codes the sys_id/],
  ];
  for (const [label, mutate, expected] of cases) {
    const { value } = scriptScenario();
    const script = value.deliverables[0];
    writeFileSync(script.path, mutate(readFileSync(script.path, "utf8")));
    rehash(script);
    assert.throws(() => validateAssistedCodeImplementationFile(write(value)), expected, label);
  }
});

test("script deliverables must match the files on disk exactly", () => {
  const edited = scriptScenario();
  writeFileSync(edited.value.deliverables[0].path, "// edited after the run\n", { flag: "a" });
  assert.throws(() => validateAssistedCodeImplementationFile(write(edited.value)), /'D-01' file does not match its recorded sha256/);

  const missing = scriptScenario();
  missing.value.deliverables[0].path = join(missing.scripts, "never-written.js");
  assert.throws(() => validateAssistedCodeImplementationFile(write(missing.value)), /'D-01' file does not exist/);

  const outside = scriptScenario();
  const elsewhere = join(mkdtempSync(join(tmpdir(), "code-writer-elsewhere-")), "01-apply-f-001.js");
  writeFileSync(elsewhere, readFileSync(outside.value.deliverables[0].path));
  outside.value.deliverables[0].path = elsewhere;
  assert.throws(() => validateAssistedCodeImplementationFile(write(outside.value)), /'D-01' must live in/);

  const extraScript = scriptScenario();
  writeFileSync(join(extraScript.scripts, "03-sneaky.js"), "gs.info('x');");
  assert.throws(() => validateAssistedCodeImplementationFile(write(extraScript.value)), /03-sneaky\.js' is in the scripts folder but is not a declared deliverable/);

  const strayReport = scriptScenario();
  writeFileSync(join(strayReport.reports, "notes.txt"), "x");
  assert.throws(() => validateAssistedCodeImplementationFile(write(strayReport.value)), /Report folder contains 'notes\.txt'/);

  const laterVersion = scriptScenario();
  writeFileSync(join(laterVersion.reports, "code-implementation-v002.json"), "{}");
  mkdirSync(join(laterVersion.reports, ".reservations"));
  assert.doesNotThrow(() => validateAssistedCodeImplementationFile(write(laterVersion.value)));
});

test("the README must list every script in run order with its scope", () => {
  const readmeOf = (value: any) => value.deliverables.find((deliverable: any) => deliverable.kind === "readme");

  const unlisted = scriptScenario();
  const readme = readmeOf(unlisted.value);
  writeFileSync(readme.path, readFileSync(readme.path, "utf8").replace(/^.*02-apply-f-002\.js.*$/m, ""));
  rehash(readme);
  assert.throws(() => validateAssistedCodeImplementationFile(write(unlisted.value)), /README does not list script '02-apply-f-002\.js'/);

  const reordered = scriptScenario();
  const second = readmeOf(reordered.value);
  const lines = readFileSync(second.path, "utf8").split("\n");
  const first = lines.findIndex((line) => line.includes("01-apply-f-001.js"));
  [lines[first], lines[first + 1]] = [lines[first + 1]!, lines[first]!];
  writeFileSync(second.path, lines.join("\n"));
  rehash(second);
  assert.throws(() => validateAssistedCodeImplementationFile(write(reordered.value)), /README lists '0[12]-apply-f-00[12]\.js' out of run order/);

  const noScope = scriptScenario();
  const third = readmeOf(noScope.value);
  writeFileSync(third.path, readFileSync(third.path, "utf8").replace("01-apply-f-001.js — scope x_2054821_confer_0", "01-apply-f-001.js"));
  rehash(third);
  assert.throws(() => validateAssistedCodeImplementationFile(write(noScope.value)), /README entry for '01-apply-f-001\.js' does not name its application scope/);
});

test("script-run HTML must mark every deliverable and give the run steps", () => {
  const cases: Array<[string, (html: string) => string, RegExp]> = [
    ["no marker", (html) => html.replace("<!-- deliverable:D-02 -->", ""), /missing marker '<!-- deliverable:D-02 -->'/],
    ["unknown marker", (html) => html.replace("<h2>How to Apply</h2>", "<!-- deliverable:D-99 --><p>x</p><h2>How to Apply</h2>"), /marks unknown deliverable 'D-99'/],
    ["no how-to", (html) => html.replace("<h2>How to Apply</h2>", "<h3>How to Apply</h3>"), /missing required <h2> section 'How to Apply'/],
    ["step missing", (html) => html.replace("<li>02-rollback-f-002.js</li>", ""), /How to Apply section is missing visible detail '02-rollback-f-002\.js'/],
    ["hidden check", (html) => html.replace("Reservation - Set Defaults: matches", "a rule: fine"), /does not show 'Reservation - Set Defaults' with status 'matches'/],
  ];
  for (const [label, mutate, expected] of cases) {
    const { value } = scriptScenario();
    assert.throws(() => validateAssistedCodeImplementationFile(write(value, mutate(htmlFor(value)))), expected, label);
  }
});

test("a copy/paste run validates and must show each target", () => {
  const reports = mkdtempSync(join(tmpdir(), "code-writer-paste-"));
  const make = () => ({
    contractVersion: ASSISTED_CONTRACT_VERSION,
    packageType: "code_implementation",
    packageId: "paste-run",
    title: "Code Implementation: Conference Room Booking — Building field",
    summary: "Paste instructions for one new field.",
    artifacts: { html: join(reports, "code-implementation-v001.html"), json: join(reports, "code-implementation-v001.json") },
    mode: "build",
    outputForm: "copy_paste",
    runStatus: "completed",
    questions: [],
    workOrder: classicWorkOrder("request"),
    currentState: currentState({
      method: "instance_query",
      checks: [{ table: "sys_dictionary", name: "x_2054821_confer_0_room.building", status: "new", detail: "Field does not exist yet." }],
    }),
    inputs: {},
    requestedStoryIds: [],
    changes: [],
    deliverables: [
      {
        id: "D-01",
        kind: "paste_instructions",
        applicationScope: "x_2054821_confer_0",
        paste: { navigation: "System Definition > Dictionary", record: "New", fields: [{ field: "column_label", newValue: "Building" }] },
        title: "Add Building field to Room",
        targets: [{ table: "sys_dictionary", name: "x_2054821_confer_0_room.building", field: "column_label" }],
        implements: [{ kind: "request", id: "request" }],
      },
    ],
    storyCoverage: [],
    fixResults: [],
    instanceChecks: [],
    assumptions: [],
    limitations: [],
    warnings: [],
  });
  assert.doesNotThrow(() => validateAssistedCodeImplementationFile(write(make())));

  const value = make();
  assert.throws(
    () => validateAssistedCodeImplementationFile(write(value, htmlFor(value).replace("<!-- paste:D-01 -->", ""))),
    /missing marker '<!-- paste:D-01 -->'/,
  );
  assert.throws(
    () => validateAssistedCodeImplementationFile(write(value, htmlFor(value).replace(" / column_label", ""))),
    /Paste instructions D-01 is missing visible detail 'column_label'/,
  );
});

test("a stopped run validates with its questions and no output", () => {
  const { value } = scriptScenario();
  Object.assign(value, {
    runStatus: "stopped",
    questions: ["The live 'Reservation - Set Defaults' rule differs from the reviewed code. Re-review first?"],
    currentState: currentState({
      method: "instance_query",
      parity: "differs",
      checks: [{ table: "sys_script", name: "Reservation - Set Defaults", status: "differs", detail: "Edited on the instance after the review." }],
    }),
    deliverables: [],
    fixResults: [],
  });
  const scriptsOnDisk = scriptScenario();
  assert.throws(
    () =>
      validateAssistedCodeImplementationFile(
        write({ ...value, artifacts: scriptsOnDisk.value.artifacts }),
      ),
    /exists but no deliverable files are declared/,
  );

  const clean = mkdtempSync(join(tmpdir(), "code-writer-stopped-"));
  value.artifacts = { html: join(clean, "code-implementation-v001.html"), json: join(clean, "code-implementation-v001.json") };
  assert.doesNotThrow(() => validateAssistedCodeImplementationFile(write(value)));
  assert.throws(
    () => validateAssistedCodeImplementationFile(write(value, htmlFor(value).replace("Re-review first?", "OK?"))),
    /Questions section does not show the question/,
  );

  const fluentStopped = fixScenario();
  Object.assign(fluentStopped.value, {
    runStatus: "stopped",
    questions: ["The local project differs from dev292961. Pull from the instance first?"],
    currentState: currentState({ method: "instance_query", parity: "differs" }),
    changes: [],
    fixResults: [],
    build: undefined,
  });
  assert.doesNotThrow(() => validateAssistedCodeImplementationFile(write(fluentStopped.value)));
});

test("known differences must be visible in the work order and current state", () => {
  const make = () => {
    const { value } = fixScenario();
    value.workOrder.knownDifferences = [
      { id: "KD-01", table: "sys_security_acl", records: "Reservation ACLs", reason: "Roles re-added by hand." },
    ];
    value.currentState = currentState({
      method: "instance_query",
      parity: "known_differences",
      checks: [
        { table: "sys_security_acl", name: "Reservation write ACL", status: "differs", detail: "Roles added locally.", knownDifference: "KD-01" },
      ],
    });
    return value;
  };
  const value = make();
  assert.doesNotThrow(() => validateAssistedCodeImplementationFile(write(value), { verifyChanges: true }));
  assert.throws(
    () => validateAssistedCodeImplementationFile(write(value, htmlFor(value).replace("<p>KD-01 (sys_security_acl): Roles re-added by hand.</p>", ""))),
    /Work Order section is missing visible detail 'KD-01'/,
  );
  assert.throws(
    () => validateAssistedCodeImplementationFile(write(value, htmlFor(value).replace(" (KD-01)</p>", "</p>"))),
    /does not show that 'Reservation write ACL' is known difference 'KD-01'/,
  );
});

test("an undeployed-commits difference must be proven by the project's git history", () => {
  const { value, project } = fixScenario();
  const run = (...args: string[]) =>
    execFileSync("git", ["-C", project, "-c", "user.email=t@example.com", "-c", "user.name=t", ...args], { encoding: "utf8" }).trim();
  const rulePath = join(project, "rule.server.js");
  writeFileSync(rulePath, "// v1\n");
  run("init", "-q");
  run("add", "-A");
  run("commit", "-q", "-m", "deployed");
  const deployed = run("rev-parse", "HEAD");
  writeFileSync(rulePath, "// v2\n");
  run("commit", "-q", "-am", "local fix, not deployed");

  const make = (sinceCommit: string, path: string) => {
    const copy = structuredClone(value);
    copy.workOrder.knownDifferences = [
      { id: "KD-01", kind: "undeployed_commits", sinceCommit, records: "Records changed since the last deploy", reason: "Committed locally, not deployed." } as any,
    ];
    copy.currentState = currentState({
      method: "instance_query",
      parity: "known_differences",
      checks: [{ table: "sys_script", name: "Reservation rule", status: "differs", detail: "Instance has the deployed version.", knownDifference: "KD-01", path }],
    });
    return copy;
  };

  assert.doesNotThrow(() => validateAssistedCodeImplementationFile(write(make(deployed, rulePath))));
  assert.throws(() => validateAssistedCodeImplementationFile(write(make(deployed, join(project, "log-rooms.js")))), /did not change since/);
  assert.throws(() => validateAssistedCodeImplementationFile(write(make("deadbeef", rulePath))), /is not in the project's git history/);
  assert.throws(() => validateAssistedCodeImplementationFile(write(make(run("rev-parse", "HEAD"), rulePath))), /no files changed since/);
});

test("rendered implementation HTML passes the validator for every output form and a stopped run", async () => {
  const { renderCodeImplementationHtml } = await import("../src/render-report-html.js");
  const { codeImplementationPackageSchema } = await import("../src/assisted-contracts.js");
  const rendered = (value: any) => renderCodeImplementationHtml(codeImplementationPackageSchema.parse(value));

  const fluent = fixScenario().value;
  assert.doesNotThrow(() => validateAssistedCodeImplementationFile(write(fluent, rendered(fluent)), { verifyChanges: true }), "fluent");
  for (const form of ["background_script", "fix_script"] as const) {
    const scripts = scriptScenario(form, form === "fix_script" ? 1 : 2).value;
    assert.doesNotThrow(() => validateAssistedCodeImplementationFile(write(scripts, rendered(scripts))), form);
  }

  const stopped = fixScenario().value;
  Object.assign(stopped, {
    runStatus: "stopped",
    questions: ["Is the local project authoritative for <Reservation> & its ACLs?"],
    currentState: currentState({ method: "instance_query", parity: "differs" }),
    changes: [],
    fixResults: [],
    build: undefined,
  });
  assert.doesNotThrow(() => validateAssistedCodeImplementationFile(write(stopped, rendered(stopped))), "stopped");
  assert.match(rendered(stopped), /&lt;Reservation&gt; &amp; its ACLs/);
});
