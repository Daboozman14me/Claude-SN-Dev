import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { applyCodeReviewFixes } from "../src/apply-code-review-fixes.js";
import { countLines } from "../src/index-code-review-sources.js";
import { diffSnapshots, snapshotFluentProject } from "../src/snapshot-fluent-project.js";
import { FIXTURE_SCRIPT, codeReviewPackage, sha256 } from "./code-review-fixtures.js";

const OTHER_SCRIPT = "var a = 1;\nvar b = 2;\n";

function finding(id: string, sourceId: string, path: string, startLine: number, endLine: number, currentCode: string, suggestedCode: string | null, status = "approved") {
  return {
    id,
    title: `Finding ${id}`,
    severity: "medium",
    category: "best_practice",
    confidence: "confirmed",
    location: { sourceId, path, startLine, endLine },
    currentCode,
    suggestedCode,
    rationale: "Fixture rationale.",
    practiceReference: "Fixture practice",
    instanceVerification: { status: "not_applicable" },
    decision: status === "pending" ? { status } : { status, decidedOn: "2026-11-07T12:00:00.000Z" },
  };
}

function writeFixReview(options: { crlf?: boolean; overlap?: boolean } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "code-writer-fixes-"));
  const script = options.crlf ? FIXTURE_SCRIPT.replace(/\n/g, "\r\n") : FIXTURE_SCRIPT;
  const scriptPath = join(directory, "log-rooms.js");
  const otherPath = join(directory, "other.js");
  writeFileSync(scriptPath, script);
  writeFileSync(otherPath, OTHER_SCRIPT);
  const value = codeReviewPackage(directory, scriptPath) as any;
  value.reviewedSources = [
    { id: "SRC-001", path: scriptPath, kind: "server_script", sha256: sha256(script), lineCount: countLines(script), records: [] },
    { id: "SRC-002", path: otherPath, kind: "server_script", sha256: sha256(OTHER_SCRIPT), lineCount: 2, records: [] },
  ];
  value.target = { application: "Fixture App" };
  value.findings = [
    finding("F-001", "SRC-001", scriptPath, 5, 5, "    gs.log('room ' + gr.name);", "    gs.info('room ' + gr.getValue('name'));"),
    finding(
      "F-002",
      "SRC-001",
      scriptPath,
      2,
      options.overlap ? 5 : 3,
      options.overlap
        ? "  var gr = new GlideRecord('x_app_room');\n  gr.query();\n  while (gr.next()) {\n    gs.log('room ' + gr.name);"
        : "  var gr = new GlideRecord('x_app_room');\n  gr.query();",
      "  var gr = new GlideRecord('x_app_room');\n  gr.addActiveQuery();\n  gr.setLimit(500);\n  gr.query();",
    ),
    finding("F-003", "SRC-001", scriptPath, 7, 7, "})(current, previous);", "})(current, previous); // pending", "pending"),
    finding("F-004", "SRC-001", scriptPath, 1, 1, "(function executeRule(current, previous) {", null),
    finding("F-005", "SRC-002", otherPath, 2, 2, "var b = 2;", "var b = 3;"),
  ];
  writeFileSync(value.artifacts.json, JSON.stringify(value, null, 2));
  writeFileSync(value.artifacts.html, "<h2>Summary</h2>");
  return { directory, scriptPath, otherPath, jsonPath: value.artifacts.json as string };
}

test("project snapshot hashes authored files and skips generated folders", () => {
  const root = mkdtempSync(join(tmpdir(), "code-writer-snapshot-"));
  mkdirSync(join(root, "src", "fluent"), { recursive: true });
  mkdirSync(join(root, "node_modules", "x"), { recursive: true });
  mkdirSync(join(root, "dist"), { recursive: true });
  mkdirSync(join(root, ".git"), { recursive: true });
  writeFileSync(join(root, "src", "fluent", "a.now.ts"), "A\n");
  writeFileSync(join(root, "package-lock.json"), "{}\n");
  writeFileSync(join(root, "node_modules", "x", "i.js"), "x");
  writeFileSync(join(root, "dist", "o.js"), "o");
  writeFileSync(join(root, ".git", "HEAD"), "ref");

  const snapshot = snapshotFluentProject(root, new Date("2026-11-07T00:00:00.000Z"));
  assert.equal(snapshot.capturedAt, "2026-11-07T00:00:00.000Z");
  assert.deepEqual(
    snapshot.files.map((file) => file.path.slice(root.length + 1).replace(/\\/g, "/")),
    ["package-lock.json", "src/fluent/a.now.ts"],
  );
  assert.equal(snapshot.files[1]!.sha256, sha256("A\n"));
  assert.deepEqual(snapshotFluentProject(join(root, "missing")).files, []);
});

test("snapshot diff reports created, modified and deleted files", () => {
  const root = mkdtempSync(join(tmpdir(), "code-writer-diff-"));
  writeFileSync(join(root, "keep.js"), "1");
  writeFileSync(join(root, "change.js"), "1");
  writeFileSync(join(root, "remove.js"), "1");
  const before = snapshotFluentProject(root);
  writeFileSync(join(root, "change.js"), "2");
  writeFileSync(join(root, "remove.js"), "1");
  writeFileSync(join(root, "new.js"), "1");
  const after = snapshotFluentProject(root);
  after.files = after.files.filter((file) => !file.path.endsWith("remove.js"));
  const diff = diffSnapshots(before, after);
  assert.deepEqual(diff.created.map((p) => p.slice(-6)), ["new.js"]);
  assert.deepEqual(diff.modified.map((p) => p.slice(-9)), ["change.js"]);
  assert.deepEqual(diff.deleted.map((p) => p.slice(-9)), ["remove.js"]);
});

test("fix applier applies approved findings bottom-up and skips everything else", () => {
  const { scriptPath, otherPath, jsonPath } = writeFixReview();
  writeFileSync(otherPath, "var a = 1;\nvar b = 99;\n");

  const report = applyCodeReviewFixes(jsonPath);
  const outcomes = Object.fromEntries(report.results.map((result) => [result.findingId, result.outcome]));
  assert.deepEqual(outcomes, {
    "F-001": "applied",
    "F-002": "applied",
    "F-003": "skipped_not_approved",
    "F-004": "skipped_no_change",
    "F-005": "skipped_drift",
  });
  assert.equal(
    readFileSync(scriptPath, "utf8"),
    [
      "(function executeRule(current, previous) {",
      "  var gr = new GlideRecord('x_app_room');",
      "  gr.addActiveQuery();",
      "  gr.setLimit(500);",
      "  gr.query();",
      "  while (gr.next()) {",
      "    gs.info('room ' + gr.getValue('name'));",
      "  }",
      "})(current, previous);",
      "",
    ].join("\n"),
  );
  assert.equal(readFileSync(otherPath, "utf8"), "var a = 1;\nvar b = 99;\n");
  assert.equal(report.changedFiles.length, 1);
  assert.equal(report.changedFiles[0]!.sha256After, sha256(readFileSync(scriptPath, "utf8")));
});

test("fix applier preserves CRLF line endings and supports dry runs", () => {
  const dry = writeFixReview({ crlf: true });
  const original = readFileSync(dry.scriptPath, "utf8");
  const preview = applyCodeReviewFixes(dry.jsonPath, { dryRun: true });
  assert.equal(readFileSync(dry.scriptPath, "utf8"), original);
  assert.equal(preview.dryRun, true);
  assert.notEqual(preview.changedFiles[0]!.sha256After, preview.changedFiles[0]!.sha256Before);

  applyCodeReviewFixes(dry.jsonPath);
  const updated = readFileSync(dry.scriptPath, "utf8");
  assert.match(updated, /gs\.info\('room ' \+ gr\.getValue\('name'\)\);\r\n/);
  assert.doesNotMatch(updated.replace(/\r\n/g, ""), /\n/);
  assert.equal(preview.changedFiles[0]!.sha256After, sha256(updated));
});

test("fix applier refuses overlapping approved findings without writing", () => {
  const { scriptPath, jsonPath } = writeFixReview({ overlap: true });
  const original = readFileSync(scriptPath, "utf8");
  assert.throws(() => applyCodeReviewFixes(jsonPath), /F-002 and F-001 overlap|F-001 and F-002 overlap/);
  assert.equal(readFileSync(scriptPath, "utf8"), original);
});

test("fix applier marks a finding failed when currentCode is not the whole reviewed lines", () => {
  const { scriptPath, jsonPath } = writeFixReview();
  const review = JSON.parse(readFileSync(jsonPath, "utf8"));
  review.findings[0].currentCode = "gs.log('room ' + gr.name);";
  writeFileSync(jsonPath, JSON.stringify(review, null, 2));
  const report = applyCodeReviewFixes(jsonPath);
  assert.equal(report.results.find((result) => result.findingId === "F-001")!.outcome, "failed");
  assert.match(readFileSync(scriptPath, "utf8"), /gs\.log\('room ' \+ gr\.name\);/);
  assert.equal(report.results.find((result) => result.findingId === "F-002")!.outcome, "applied");
});

test("tool output goes straight into an existing package, never a scratch file", async () => {
  const { takeIntoOption, writeIntoPackage } = await import("../src/write-into-package.js");
  const directory = mkdtempSync(join(tmpdir(), "into-package-"));
  const packagePath = join(directory, "code-implementation-v001.json");
  writeFileSync(packagePath, JSON.stringify({ packageType: "code_implementation", baseline: null }));
  writeIntoPackage(packagePath, "baseline", { files: [1, 2] });
  assert.deepEqual(JSON.parse(readFileSync(packagePath, "utf8")), { packageType: "code_implementation", baseline: { files: [1, 2] } });
  assert.deepEqual(takeIntoOption(["C:\project", "--into", packagePath]), { into: packagePath, rest: ["C:\project"] });
  assert.throws(() => takeIntoOption(["C:\project", "--into"]), /needs the path of an existing JSON package/);
  writeFileSync(packagePath, "[]");
  assert.throws(() => writeIntoPackage(packagePath, "baseline", {}), /is not a JSON package object/);
});

test("the deploy workflow template only runs manually and makes the human confirm the instance", () => {
  const workflow = readFileSync(join(import.meta.dirname, "..", "templates", "github-actions", "deploy-servicenow.yml"), "utf8");
  const triggers = workflow.slice(workflow.indexOf("\non:"), workflow.indexOf("\npermissions:"));
  assert.match(triggers, /workflow_dispatch:/);
  assert.doesNotMatch(triggers, /\b(push|pull_request|schedule|workflow_run):/);
  assert.doesNotMatch(triggers, /default:/, "the target instance must never have a default");
  assert.match(workflow, /confirm_instance:/);
  assert.match(workflow, /"\$INSTANCE" != "\$CONFIRM"/);
  assert.match(workflow, /environment: \$\{\{ inputs\.instance \}\}/);
  assert.match(workflow, /name%3Dinstance_name/);
  assert.match(workflow, /SN_SDK_NODE_ENV: SN_SDK_CI_INSTALL/);
  assert.doesNotMatch(workflow, /now-sdk auth/, "CI authenticates through the SDK's environment variables, not the keychain");
  const inputUses = [...workflow.matchAll(/\$\{\{\s*inputs\.(\w+)\s*\}\}/g)].map((match) => workflow.slice(0, match.index).split("\n").pop()!.trim());
  for (const line of inputUses) {
    assert.match(line, /^(INSTANCE:|CONFIRM:|environment:|group: deploy-)/, `inputs are used only via validated env or job routing, found: ${line}`);
  }
  const install = workflow.indexOf("npx now-sdk install");
  assert.ok(workflow.indexOf("name%3Dinstance_name") < install, "the instance is confirmed before installing");
  assert.ok(workflow.indexOf("now-sdk build --frozenKeys") < install, "keys.ts is checked before installing");
});

