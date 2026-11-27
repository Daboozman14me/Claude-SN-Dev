import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { applyMigration, planMigration, rewritePaths } from "../src/migrate-artifacts.js";
import { validateAssistedCodeReviewFile } from "../src/validate-assisted-code-review.js";
import { FIXTURE_SCRIPT, codeReviewPackage } from "./code-review-fixtures.js";

const sha = (text: string | Buffer): string => createHash("sha256").update(text).digest("hex");

const REVIEW_HTML = `<!DOCTYPE html>
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

// Old layout: Artifacts\demo-app\<request folder>\<base>-vNNN.*, plus a registry pointing the app at a program.
function oldLayout() {
  const root = mkdtempSync(join(tmpdir(), "migrate-"));
  const artifacts = join(root, "Artifacts");
  const app = join(artifacts, "demo-app");
  const program = join(root, "Programs", "demo");
  mkdirSync(program, { recursive: true });
  writeFileSync(join(program, "manifest.json"), JSON.stringify({ program: "Demo", client: "Internal", storageType: "local", root: program, projects: [{ application: "Demo App", folder: "demo-app" }] }));
  const registryPath = join(root, "registry.json");
  writeFileSync(registryPath, JSON.stringify({ programs: [{ alias: "demo", client: "Internal", program: "Demo", storageType: "local", location: program, localRoot: program }] }));

  // A reviewed script and a code review of it, in a "-review" folder.
  const reviewDir = join(app, "fix-one-review");
  mkdirSync(reviewDir, { recursive: true });
  const scriptPath = join(app, "fix-one", "code-implementation-v001-scripts", "log-rooms.js");
  mkdirSync(join(app, "fix-one", "code-implementation-v001-scripts"), { recursive: true });
  writeFileSync(scriptPath, FIXTURE_SCRIPT);
  const review = codeReviewPackage(reviewDir, scriptPath);
  writeFileSync(review.artifacts.json, `${JSON.stringify(review, null, 2)}\n`);
  writeFileSync(review.artifacts.html, REVIEW_HTML);

  // An implementation report that names its own path, and a completion report that records its hash.
  const implementation = join(app, "fix-one", "code-implementation-v001.json");
  writeFileSync(implementation, `${JSON.stringify({ artifacts: { json: implementation } }, null, 2)}\n`);
  const completion = join(app, "fix-one", "completion-report-v001.json");
  writeFileSync(completion, `${JSON.stringify({ implementation: { jsonPath: implementation, sha256: sha(readFileSync(implementation)) } }, null, 2)}\n`);

  // An app-wide backlog folder, a research folder with evidence, and a loose note.
  mkdirSync(join(app, "backlog"));
  writeFileSync(join(app, "backlog", "backlog-v001.xml"), "<unload/>");
  const research = join(app, "current-state-research-of-demo-app-v1-0");
  mkdirSync(join(research, "evidence", "application-research-v001"), { recursive: true });
  writeFileSync(join(research, "evidence", "application-research-v001", "tables.json"), "{}");
  writeFileSync(join(research, "application-research-v001.md"), "# Research");
  mkdirSync(join(app, "requirements"));
  writeFileSync(join(app, "requirements", "owner-decisions.md"), "decisions");
  return { root, artifacts, program, registryPath, review: review.artifacts.json, implementation, completion };
}

test("the plan sends every document to its type folder with its request folder as the work label", () => {
  const layout = oldLayout();
  const plan = planMigration({ sourceRoot: layout.artifacts, apps: [{ from: "demo-app", application: "Demo App" }], registryPath: layout.registryPath });
  const app = plan.apps[0]!;
  assert.equal(app.targetFolder, join(layout.program, "demo-app"));
  assert.deepEqual(app.labels, {
    backlog: "",
    "current-state-research-of-demo-app-v1-0": "current-state-research-of-v1-0",
    "fix-one": "fix-one",
    "fix-one-review": "fix-one",
    requirements: "",
  });
  const to = (suffix: string): string | undefined => app.moves.find((move) => move.from.endsWith(suffix))?.to;
  const target = (...parts: string[]): string => join(layout.program, "demo-app", ...parts);
  assert.equal(to("fix-one-review\\code-review-v001.json"), target("reviews", "code-review-fix-one-v001.json"));
  assert.equal(to("fix-one\\code-implementation-v001-scripts"), target("code", "code-implementation-fix-one-v001-scripts"));
  assert.equal(to("fix-one\\completion-report-v001.json"), target("code", "completion-report-fix-one-v001.json"));
  assert.equal(to("backlog\\backlog-v001.xml"), target("backlog", "backlog-v001.xml"));
  assert.equal(to("evidence\\application-research-v001"), target("research", "evidence", "application-research-current-state-research-of-v1-0-v001"));
  assert.equal(to("requirements\\owner-decisions.md"), target("requirements", "owner-decisions.md"));
  assert.deepEqual(app.conflicts, []);

  const relabeled = planMigration({
    sourceRoot: layout.artifacts,
    apps: [{ from: "demo-app", application: "Demo App" }],
    registryPath: layout.registryPath,
    labels: { "demo-app": { "current-state-research-of-demo-app-v1-0": "full" } },
  });
  assert.equal(relabeled.apps[0]!.labels["current-state-research-of-demo-app-v1-0"], "full", "labels can be edited before applying");
});

test("two folders that would collide are reported, and an unregistered app is refused", () => {
  const layout = oldLayout();
  mkdirSync(join(layout.artifacts, "demo-app", "fix-one-again"));
  writeFileSync(join(layout.artifacts, "demo-app", "fix-one-again", "code-implementation-v001.json"), "{}");
  const plan = planMigration({
    sourceRoot: layout.artifacts,
    apps: [{ from: "demo-app", application: "Demo App" }],
    registryPath: layout.registryPath,
    labels: { "demo-app": { "fix-one-again": "fix-one" } },
  });
  assert.equal(plan.apps[0]!.conflicts.length, 1);
  assert.throws(() => applyMigration(plan), /conflicts/);
  assert.throws(() => planMigration({ sourceRoot: layout.artifacts, apps: [{ from: "demo-app", application: "Other App" }], registryPath: layout.registryPath }), /not registered/);
});

test("paths are rewritten in every form they are written in", () => {
  const pairs: Array<[string, string]> = [["C:\\a\\old\\x-v001.json", "C:\\b\\new\\x-label-v001.json"], ["C:\\a\\old", "C:\\b\\other"]];
  const { text, replaced } = rewritePaths('{"p":"C:\\\\a\\\\old\\\\x-v001.json","q":"C:/a/old/x-v001.json","r":"C:\\a\\old\\y.md"}', pairs);
  assert.equal(text, '{"p":"C:\\\\b\\\\new\\\\x-label-v001.json","q":"C:/b/new/x-label-v001.json","r":"C:\\b\\other\\y.md"}');
  assert.equal(replaced, 3);
});

test("apply copies, rewrites, reseals hashes, keeps packages valid, and archives the old folder", () => {
  const layout = oldLayout();
  assert.equal(validateAssistedCodeReviewFile(layout.review), layout.review, "valid before");
  const decisions = join(layout.program, "manifest-notes.md");
  writeFileSync(decisions, `log: ${join(layout.artifacts, "demo-app", "requirements", "owner-decisions.md")}`);
  const plan = planMigration({ sourceRoot: layout.artifacts, apps: [{ from: "demo-app", application: "Demo App" }], registryPath: layout.registryPath });
  const result = applyMigration(plan, { alsoRewrite: [decisions] });

  const target = join(layout.program, "demo-app");
  const review = join(target, "reviews", "code-review-fix-one-v001.json");
  assert.equal(validateAssistedCodeReviewFile(review), review, "the moved review still validates");
  const reviewJson = JSON.parse(readFileSync(review, "utf8"));
  assert.equal(reviewJson.reviewedSources[0].path, join(target, "code", "code-implementation-fix-one-v001-scripts", "log-rooms.js"));

  const implementation = join(target, "code", "code-implementation-fix-one-v001.json");
  const completion = JSON.parse(readFileSync(join(target, "code", "completion-report-fix-one-v001.json"), "utf8"));
  assert.equal(completion.implementation.jsonPath, implementation);
  assert.equal(completion.implementation.sha256, sha(readFileSync(implementation)), "the recorded hash follows the rewritten report");
  assert.ok(result.resealedHashes >= 1);
  assert.match(readFileSync(decisions, "utf8"), /demo-app\\requirements\\owner-decisions\.md$/);
  assert.ok(readFileSync(decisions, "utf8").startsWith(`log: ${target}`));

  assert.deepEqual(result.regressions, []);
  assert.equal(existsSync(join(layout.artifacts, "demo-app")), false, "the old folder is archived");
  assert.equal(result.archivedTo.length, 1);
  assert.ok(existsSync(join(result.archivedTo[0]!, "fix-one-review", "code-review-v001.json")), "nothing is deleted");
});

test("a stale hash is never resealed", () => {
  const layout = oldLayout();
  const stale = JSON.parse(readFileSync(layout.completion, "utf8"));
  stale.implementation.sha256 = "0".repeat(64);
  writeFileSync(layout.completion, JSON.stringify(stale, null, 2));
  const plan = planMigration({ sourceRoot: layout.artifacts, apps: [{ from: "demo-app", application: "Demo App" }], registryPath: layout.registryPath });
  applyMigration(plan);
  const moved = JSON.parse(readFileSync(join(layout.program, "demo-app", "code", "completion-report-fix-one-v001.json"), "utf8"));
  assert.equal(moved.implementation.sha256, "0".repeat(64));
});
