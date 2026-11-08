import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { codeReviewPackageSchema } from "../src/assisted-contracts.js";
import { renderCodeReviewHtml, renderReportFile } from "../src/render-report-html.js";
import { validateAssistedCodeReviewFile } from "../src/validate-assisted-code-review.js";
import { FIXTURE_SCRIPT, codeReviewPackage } from "./code-review-fixtures.js";

test("a rendered code review passes the review validator, fresh", () => {
  const directory = mkdtempSync(join(tmpdir(), "render-review-"));
  const scriptPath = join(directory, "log-rooms.js");
  writeFileSync(scriptPath, FIXTURE_SCRIPT);
  const review = codeReviewPackage(directory, scriptPath) as any;
  review.priorReview = { packageId: "older", jsonPath: join(directory, "older.json"), resolutions: [{ findingId: "F-009", status: "resolved", note: "Fixed." }] };
  writeFileSync(review.artifacts.json, JSON.stringify(review, null, 2));
  assert.equal(renderReportFile(review.artifacts.json), review.artifacts.html);
  assert.doesNotThrow(() => validateAssistedCodeReviewFile(review.artifacts.json, { fresh: true }));

  const html = renderCodeReviewHtml(codeReviewPackageSchema.parse(review));
  assert.match(html, /<!-- finding:F-001 -->/);
  assert.match(html, /gs\.log\(&#39;room|gs\.log\('room/);
  assert.match(html, /F-009/);
});

test("rendering refuses package types it does not know", () => {
  const directory = mkdtempSync(join(tmpdir(), "render-unknown-"));
  const path = join(directory, "x.json");
  writeFileSync(path, JSON.stringify({ packageType: "story_draft" }));
  assert.throws(() => renderReportFile(path), /No renderer for package type 'story_draft'/);
});
