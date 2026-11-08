import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test from "node:test";
import { ASSISTED_CONTRACT_VERSION } from "../src/assisted-contracts.js";
import { applyCodeReviewFixes } from "../src/apply-code-review-fixes.js";
import { writeCompletionReport } from "../src/compose-completion-report.js";
import { countLines } from "../src/index-code-review-sources.js";
import { recordCodeReviewDecision } from "../src/record-code-review-decision.js";
import { snapshotFluentProject } from "../src/snapshot-fluent-project.js";
import { validateCompletionReportFile } from "../src/validate-assisted-completion-report.js";
import { FIXTURE_SCRIPT, codeReviewPackage, sha256 } from "./code-review-fixtures.js";
import { classicWorkOrder, currentState, workOrder } from "./code-writer-fixtures.js";

function writeJson(path: string, value: unknown): string {
  writeFileSync(path, JSON.stringify(value, null, 2));
  return path;
}

function writeReview(review: any): string {
  writeFileSync(review.artifacts.html, "<h2>Summary</h2>");
  return writeJson(review.artifacts.json, review);
}

// Writer fix run on a Fluent project, then the automatic re-review of exactly that work.
function fluentFixRun() {
  const project = mkdtempSync(join(tmpdir(), "completion-project-"));
  const reviews = mkdtempSync(join(tmpdir(), "completion-review-"));
  const rereviews = mkdtempSync(join(tmpdir(), "completion-rereview-"));
  const reports = mkdtempSync(join(tmpdir(), "completion-impl-"));
  const scriptPath = join(project, "log-rooms.server.js");
  writeFileSync(scriptPath, FIXTURE_SCRIPT);

  const review = codeReviewPackage(reviews, scriptPath) as any;
  review.findings[0].decision = { status: "approved", decidedOn: "2026-11-08T10:00:00.000Z" };
  const reviewPath = writeReview(review);

  const baseline = snapshotFluentProject(project);
  const applied = applyCodeReviewFixes(reviewPath);
  const after = readFileSync(scriptPath, "utf8");
  const implementationPath = join(reports, "code-implementation-v001.json");
  const implementation = {
    contractVersion: ASSISTED_CONTRACT_VERSION,
    packageType: "code_implementation",
    packageId: "crb-fix-run",
    title: "Code Implementation: Fixture App — approved fixes",
    summary: "Applied F-001.",
    artifacts: { html: join(reports, "code-implementation-v001.html"), json: implementationPath },
    mode: "fix",
    outputForm: "fluent",
    runStatus: "completed",
    questions: [],
    workOrder: workOrder({
      appLocation: { kind: "local_project", path: project },
      target: { application: "Fixture App", scope: "x_app", instanceAlias: "dev292961" },
      changeSource: { kind: "findings", description: "Approved findings." },
    }),
    currentState: currentState(),
    project: { root: project, scope: "x_app", appName: "Fixture App", created: false },
    inputs: { codeReview: { path: reviewPath } },
    requestedStoryIds: [],
    baseline,
    changes: applied.changedFiles.map((file) => ({
      path: file.path,
      action: "modified",
      sha256After: file.sha256After,
      implements: [{ kind: "finding", id: "F-001" }],
      summary: "Replaced gs.log with gs.info.",
    })),
    deliverables: [],
    storyCoverage: [],
    fixResults: applied.results.map((r) => ({ findingId: r.findingId, outcome: r.outcome, detail: r.detail })),
    build: { command: "npm run build", status: "passed", errorCount: 0, warningCount: 0 },
    instanceChecks: [],
    assumptions: [],
    limitations: [],
    warnings: [],
  };
  writeJson(implementationPath, implementation);
  writeFileSync(implementation.artifacts.html, "<h2>Summary</h2>");

  const rereview = codeReviewPackage(rereviews, scriptPath) as any;
  rereview.packageId = "crb-rereview";
  rereview.reviewedSources[0].sha256 = sha256(after);
  rereview.reviewedSources[0].lineCount = countLines(after);
  rereview.findings[0] = {
    ...rereview.findings[0],
    title: "Room query has no filter",
    severity: "low",
    category: "performance",
    location: { sourceId: "SRC-001", path: scriptPath, startLine: 3, endLine: 3 },
    currentCode: "  gr.query();",
    suggestedCode: "  gr.addActiveQuery();\n  gr.query();",
  };
  rereview.priorReview = {
    packageId: review.packageId,
    jsonPath: reviewPath,
    resolutions: [{ findingId: "F-001", status: "resolved", note: "gs.info now used." }],
  };
  rereview.implementation = { packageId: implementation.packageId, jsonPath: implementationPath };
  const rereviewPath = writeReview(rereview);
  return { implementationPath, implementation, rereviewPath, rereview, reviewPath, scriptPath };
}

test("a fix run plus its automatic re-review composes one validated completion report", () => {
  const run = fluentFixRun();
  const artifacts = writeCompletionReport(run.implementationPath, run.rereviewPath);
  assert.equal(basename(artifacts.json), "completion-report-v001.json");
  assert.equal(validateCompletionReportFile(artifacts.json, { fresh: true }), artifacts.json);

  const report = JSON.parse(readFileSync(artifacts.json, "utf8"));
  assert.deepEqual(report.fixResults.map((r: any) => [r.findingId, r.outcome, r.resolution]), [["F-001", "applied", "resolved"]]);
  assert.deepEqual(report.findings.map((f: any) => [f.id, f.severity, f.location, f.decision]), [["F-001", "low", "log-rooms.server.js:3", "pending"]]);
  assert.equal(report.severityCounts.low, 1);
  assert.equal(report.build.status, "passed");
  assert.match(report.nextSteps[0], /Decide each review finding/);
  assert.match(report.nextSteps.at(-1), /git diff/);

  const html = readFileSync(artifacts.html, "utf8");
  for (const section of ["Summary", "Work Completed", "Fix Results", "Build", "Review Findings", "Next Steps", "Sources"]) {
    assert.match(html, new RegExp(`<h2>${section}</h2>`));
  }
  assert.match(html, /<!-- finding:F-001 -->/);

  const second = writeCompletionReport(run.implementationPath, run.rereviewPath);
  assert.equal(basename(second.json), "completion-report-v002.json");
});

test("the completion report refuses a review that did not check exactly this work", () => {
  const cases: Array<[string, (run: ReturnType<typeof fluentFixRun>) => void, RegExp]> = [
    ["unlinked review", (run) => delete run.rereview.implementation, /does not identify this implementation package/],
    ["stale file", (run) => (run.rereview.reviewedSources[0].sha256 = sha256(FIXTURE_SCRIPT)), /saw a different version of/],
    ["file not reviewed", (run) => {
      const elsewhere = join(tmpdir(), "elsewhere.js");
      run.rereview.reviewedSources[0].path = elsewhere;
      run.rereview.findings[0].location.path = elsewhere;
    }, /did not cover/],
    ["not a re-review", (run) => delete run.rereview.priorReview, /must be a re-review of the code review the fixes came from/],
    ["applied fix not re-checked", (run) => (run.rereview.priorReview.resolutions = []), /no resolution for applied finding 'F-001'/],
  ];
  for (const [label, mutate, expected] of cases) {
    const run = fluentFixRun();
    mutate(run);
    writeReview(run.rereview);
    assert.throws(() => writeCompletionReport(run.implementationPath, run.rereviewPath), expected, label);
  }

  const stopped = fluentFixRun();
  Object.assign(stopped.implementation, {
    runStatus: "stopped",
    questions: ["Which side is authoritative?"],
    currentState: currentState({ parity: "differs" }),
    changes: [],
    fixResults: [],
  });
  delete (stopped.implementation as any).build;
  writeJson(stopped.implementationPath, stopped.implementation);
  assert.throws(() => writeCompletionReport(stopped.implementationPath, stopped.rereviewPath), /stopped implementation run has no work to review/);
});

test("a completion report goes stale when its inputs change and cannot be hand-edited", () => {
  const run = fluentFixRun();
  const artifacts = writeCompletionReport(run.implementationPath, run.rereviewPath);

  writeFileSync(artifacts.html, readFileSync(artifacts.html, "utf8").replace("Decision: pending", "Decision: approved"));
  assert.throws(() => validateCompletionReportFile(artifacts.json), /HTML does not match its JSON/);

  const fresh = writeCompletionReport(run.implementationPath, run.rereviewPath);
  recordCodeReviewDecision(run.rereviewPath, { findingIds: ["F-001"], status: "approved" });
  assert.doesNotThrow(() => validateCompletionReportFile(fresh.json));
  assert.throws(() => validateCompletionReportFile(fresh.json, { fresh: true }), /review package changed after this report was composed/);
});

test("a copy/paste run is reviewed through its paste instructions", () => {
  const reports = mkdtempSync(join(tmpdir(), "completion-paste-"));
  const reviews = mkdtempSync(join(tmpdir(), "completion-paste-review-"));
  const implementationPath = join(reports, "code-implementation-v001.json");
  const htmlPath = join(reports, "code-implementation-v001.html");
  writeFileSync(htmlPath, "<h2>Paste Instructions</h2><!-- paste:D-01 --><p>sys_dictionary room.building</p>\n");
  writeJson(implementationPath, {
    contractVersion: ASSISTED_CONTRACT_VERSION,
    packageType: "code_implementation",
    packageId: "paste-run",
    title: "Code Implementation: Conference Room Booking — Building field",
    summary: "One field.",
    artifacts: { html: htmlPath, json: implementationPath },
    mode: "build",
    outputForm: "copy_paste",
    runStatus: "completed",
    questions: [],
    workOrder: classicWorkOrder("request"),
    currentState: currentState({ method: "instance_query" }),
    inputs: {},
    deliverables: [
      {
        id: "D-01",
        kind: "paste_instructions",
        title: "Add Building field to Room",
        targets: [{ table: "sys_dictionary", name: "x_2054821_confer_0_room.building" }],
        implements: [{ kind: "request", id: "request" }],
      },
    ],
  });
  const review = codeReviewPackage(reviews, htmlPath) as any;
  review.reviewedSources[0] = { id: "SRC-001", path: htmlPath, kind: "other", sha256: sha256(readFileSync(htmlPath, "utf8")), lineCount: 2, records: [] };
  review.findings = [];
  review.implementation = { packageId: "paste-run", jsonPath: implementationPath };
  const reviewPath = writeReview(review);

  const artifacts = writeCompletionReport(implementationPath, reviewPath);
  assert.doesNotThrow(() => validateCompletionReportFile(artifacts.json, { fresh: true }));
  const report = JSON.parse(readFileSync(artifacts.json, "utf8"));
  assert.equal(report.build, null);
  assert.equal(report.work[0].ref, "D-01");
  assert.match(report.nextSteps.join(" "), /The reviewer found no problems/);
  assert.match(report.nextSteps.join(" "), /export that update set as XML/);
});
