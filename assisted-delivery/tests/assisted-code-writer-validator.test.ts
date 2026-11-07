import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ASSISTED_CONTRACT_VERSION } from "../src/assisted-contracts.js";
import { applyCodeReviewFixes } from "../src/apply-code-review-fixes.js";
import { countLines } from "../src/index-code-review-sources.js";
import { snapshotFluentProject } from "../src/snapshot-fluent-project.js";
import { validateAssistedCodeImplementationFile } from "../src/validate-assisted-code-implementation.js";
import { FIXTURE_SCRIPT, codeReviewPackage, sha256 } from "./code-review-fixtures.js";

function htmlFor(value: any): string {
  const changes = value.changes
    .map(
      (change: any, index: number) =>
        `<!-- change:${index + 1} --><div>${change.path.split(/[\\/]/).pop()} — ${change.action} — implements ${change.implements
          .map((ref: any) => ref.id)
          .join(", ")}</div>`,
    )
    .join("\n");
  const coverage =
    value.mode === "build"
      ? `<h2>Story Coverage</h2>${value.storyCoverage.map((entry: any) => `<p>${entry.storyId}: ${entry.status}</p>`).join("")}`
      : `<h2>Fix Results</h2>${value.fixResults.map((result: any) => `<p>${result.findingId}: ${result.outcome}</p>`).join("")}`;
  return `<html><body><h1>${value.title}</h1>
<h2>Summary</h2><p>${value.summary}</p>
<h2>Inputs and Scope</h2><p>${value.project.root}</p>
<h2>Changes</h2>${changes}
${coverage}
<h2>Build</h2><p>npm run build: ${value.build.status}</p>
<h2>Limitations</h2><p>None beyond the fixture.</p>
</body></html>`;
}

function write(value: any, html = htmlFor(value)): string {
  writeFileSync(value.artifacts.json, JSON.stringify(value, null, 2));
  writeFileSync(value.artifacts.html, html);
  return value.artifacts.json;
}

// Real fix run: review → approve → snapshot → apply → implementation package.
function fixScenario() {
  const project = mkdtempSync(join(tmpdir(), "code-writer-project-"));
  const reports = mkdtempSync(join(tmpdir(), "code-writer-reports-"));
  const scriptPath = join(project, "log-rooms.js");
  writeFileSync(scriptPath, FIXTURE_SCRIPT);

  const review = codeReviewPackage(reports, scriptPath) as any;
  review.artifacts = { html: join(reports, "code-review-v001.html"), json: join(reports, "code-review-v001.json") };
  review.findings.push({
    ...structuredClone(review.findings[0]),
    id: "F-002",
    title: "Pending finding",
    location: { sourceId: "SRC-001", path: scriptPath, startLine: 7, endLine: 7 },
    currentCode: "})(current, previous);",
    suggestedCode: "})(current, previous); // later",
    instanceVerification: { status: "not_applicable" },
  });
  review.findings[0].decision = { status: "approved", decidedOn: "2026-11-07T12:00:00.000Z" };
  writeFileSync(review.artifacts.json, JSON.stringify(review, null, 2));
  writeFileSync(review.artifacts.html, "<h2>Summary</h2>");

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
    build: { command: "npm run build", status: "passed", errorCount: 0, warningCount: 0 },
    instanceChecks: [],
    assumptions: [],
    limitations: [],
    warnings: [],
  };
  return { project, reports, scriptPath, value };
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

test("implementation HTML must show every change, outcome and the build status", () => {
  const cases: Array<[string, (html: string) => string, RegExp]> = [
    ["no marker", (html) => html.replace("<!-- change:1 -->", ""), /0 change markers but the JSON records 1/],
    ["no section", (html) => html.replace("<h2>Fix Results</h2>", "<h3>Fix Results</h3>"), /missing required <h2> section 'Fix Results'/],
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
