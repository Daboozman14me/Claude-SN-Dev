import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { checkCodeReviewDrift } from "../src/check-code-review-drift.js";
import {
  recordCodeReviewDecision,
  summarizeDecisions,
} from "../src/record-code-review-decision.js";
import {
  readCodeReviewPackage,
  validateAssistedCodeReviewFile,
} from "../src/validate-assisted-code-review.js";
import { FIXTURE_SCRIPT, codeReviewPackage } from "./code-review-fixtures.js";

const FIXTURE_HTML = `<!DOCTYPE html>
<html><head><title>Code Review: Fixture App</title></head><body>
<h1>Code Review: Fixture App</h1>
<h2>Summary</h2><p>One business rule reviewed; one finding.</p>
<h2>Scope and Sources</h2><table><tr><td>SRC-001</td><td>log-rooms.js</td></tr></table>
<h2>Findings</h2>
<!-- finding:F-001 -->
<section><h3>F-001 — gs.log is unavailable in scoped applications</h3>
<p>Severity: medium · Category: best_practice · Confidence: confirmed</p>
<p>Location: log-rooms.js:5</p></section>
<h2>Instance Checks</h2><p>Field 'name' exists on x_app_room.</p>
<h2>Limitations</h2><p>Only one file was supplied.</p>
</body></html>
`;

function writeReview(html = FIXTURE_HTML) {
  const directory = mkdtempSync(join(tmpdir(), "code-review-tools-"));
  const scriptPath = join(directory, "log-rooms.js");
  writeFileSync(scriptPath, FIXTURE_SCRIPT);
  const value = codeReviewPackage(directory, scriptPath);
  const jsonPath = value.artifacts.json;
  writeFileSync(jsonPath, `${JSON.stringify(value, null, 2)}\n`);
  writeFileSync(value.artifacts.html, html);
  return { directory, scriptPath, jsonPath, htmlPath: value.artifacts.html };
}

function rewriteJson(jsonPath: string, mutate: (value: any) => void): void {
  const value = JSON.parse(readFileSync(jsonPath, "utf8"));
  mutate(value);
  writeFileSync(jsonPath, JSON.stringify(value, null, 2));
}

test("code review validator accepts a consistent fresh review", () => {
  const { jsonPath } = writeReview();
  assert.equal(validateAssistedCodeReviewFile(jsonPath, { fresh: true }), jsonPath);
});

test("code review validator rejects HTML that does not match the JSON", () => {
  const cases: Array<[string, string, RegExp]> = [
    ["missing marker", FIXTURE_HTML.replace("<!-- finding:F-001 -->", ""), /missing marker '<!-- finding:F-001 -->'/],
    ["missing section", FIXTURE_HTML.replace("<h2>Instance Checks</h2>", "<h3>Instance Checks</h3>"), /missing required <h2> section 'Instance Checks'/],
    ["wrong location", FIXTURE_HTML.replace("log-rooms.js:5", "log-rooms.js:9"), /missing visible detail 'log-rooms.js:5'/],
    ["missing severity", FIXTURE_HTML.replace("Severity: medium", "Severity: ?"), /missing visible detail 'medium'/],
    ["unknown marker", FIXTURE_HTML.replace("<h2>Instance Checks</h2>", "<!-- finding:F-999 --><h2>Instance Checks</h2>"), /unknown finding 'F-999'/],
    ["unlisted source", FIXTURE_HTML.replace("<td>SRC-001</td>", "<td>source one</td>"), /does not list reviewed source 'SRC-001'/],
  ];
  for (const [label, html, expected] of cases) {
    const { jsonPath } = writeReview(html);
    assert.throws(() => validateAssistedCodeReviewFile(jsonPath), expected, `case '${label}'`);
  }
});

test("code review validator enforces artifact naming", () => {
  const { directory, jsonPath, htmlPath } = writeReview();
  const renamed = join(directory, "review.json");
  writeFileSync(renamed, readFileSync(jsonPath));
  rewriteJson(renamed, (value) => (value.artifacts.json = renamed));
  assert.throws(() => validateAssistedCodeReviewFile(renamed), /must use code-review-vNNN\.json/);
  unlinkSync(htmlPath);
  assert.throws(() => validateAssistedCodeReviewFile(jsonPath), /HTML artifact does not exist/);
});

test("fresh validation catches recorded decisions and edited code", () => {
  const decided = writeReview();
  rewriteJson(decided.jsonPath, (value) => {
    value.findings[0].decision = { status: "approved", decidedOn: "2026-11-07T10:00:00.000Z" };
  });
  assert.doesNotThrow(() => validateAssistedCodeReviewFile(decided.jsonPath));
  assert.throws(
    () => validateAssistedCodeReviewFile(decided.jsonPath, { fresh: true }),
    /must leave every decision pending/,
  );

  const edited = writeReview();
  writeFileSync(edited.scriptPath, FIXTURE_SCRIPT.replace("gs.log", "gs.info"));
  assert.throws(
    () => validateAssistedCodeReviewFile(edited.jsonPath, { fresh: true }),
    /changed since it was indexed/,
  );
});

test("decision recorder updates only the decision and keeps the package valid", () => {
  const { jsonPath, htmlPath } = writeReview();
  const before = JSON.parse(readFileSync(jsonPath, "utf8"));
  const now = new Date("2026-11-07T16:30:00.000Z");

  const summary = recordCodeReviewDecision(jsonPath, {
    findingIds: ["F-001"],
    status: "approved",
    note: "Agreed with reviewer.",
    now,
  });
  assert.deepEqual(summary.counts, { pending: 0, approved: 1, rejected: 0, deferred: 0 });

  const after = JSON.parse(readFileSync(jsonPath, "utf8"));
  assert.deepEqual(after.findings[0].decision, {
    status: "approved",
    note: "Agreed with reviewer.",
    decidedOn: now.toISOString(),
  });
  delete before.findings[0].decision;
  delete after.findings[0].decision;
  assert.deepEqual(after, before);
  assert.equal(readFileSync(htmlPath, "utf8"), FIXTURE_HTML);
  assert.doesNotThrow(() => validateAssistedCodeReviewFile(jsonPath));

  recordCodeReviewDecision(jsonPath, { findingIds: ["F-001"], status: "pending" });
  assert.deepEqual(readCodeReviewPackage(jsonPath).value.findings[0]!.decision, {
    status: "pending",
  });
});

test("decision recorder refuses unknown ids and bad decisions without writing", () => {
  const { jsonPath } = writeReview();
  const original = readFileSync(jsonPath, "utf8");
  assert.throws(
    () => recordCodeReviewDecision(jsonPath, { findingIds: ["F-001", "F-404"], status: "approved" }),
    /Unknown finding id\(s\): F-404\. Nothing was recorded\./,
  );
  assert.throws(
    () => recordCodeReviewDecision(jsonPath, { findingIds: ["F-001"], status: "maybe" as any }),
    /Decision must be one of/,
  );
  assert.equal(readFileSync(jsonPath, "utf8"), original);
  assert.equal(summarizeDecisions(readCodeReviewPackage(jsonPath).value).counts.pending, 1);
});

test("drift checker distinguishes unchanged, intact, moved, changed and missing code", () => {
  const statusAfter = (edit: ((path: string) => void) | undefined) => {
    const { jsonPath, scriptPath } = writeReview();
    edit?.(scriptPath);
    return checkCodeReviewDrift(jsonPath);
  };

  const unchanged = statusAfter(undefined);
  assert.equal(unchanged.results[0]!.status, "unchanged");
  assert.equal(unchanged.safeToApply, true);

  const intact = statusAfter((path) =>
    writeFileSync(path, FIXTURE_SCRIPT.replace("gr.query();", "gr.setLimit(100); gr.query();")),
  );
  assert.equal(intact.results[0]!.status, "intact");
  assert.equal(intact.safeToApply, true);

  const moved = statusAfter((path) => writeFileSync(path, `// header\n// header\n${FIXTURE_SCRIPT}`));
  assert.equal(moved.results[0]!.status, "moved");
  assert.equal(moved.results[0]!.currentStartLine, 7);
  assert.equal(moved.safeToApply, false);

  const changed = statusAfter((path) => writeFileSync(path, FIXTURE_SCRIPT.replace("gs.log", "gs.info")));
  assert.equal(changed.results[0]!.status, "changed");
  assert.equal(changed.safeToApply, false);

  const missing = statusAfter((path) => unlinkSync(path));
  assert.equal(missing.results[0]!.status, "missing");
});

test("drift checker can limit itself to approved findings", () => {
  const { jsonPath } = writeReview();
  assert.equal(checkCodeReviewDrift(jsonPath, { approvedOnly: true }).results.length, 0);
  recordCodeReviewDecision(jsonPath, { findingIds: ["F-001"], status: "approved" });
  assert.equal(checkCodeReviewDrift(jsonPath, { approvedOnly: true }).results.length, 1);
});
