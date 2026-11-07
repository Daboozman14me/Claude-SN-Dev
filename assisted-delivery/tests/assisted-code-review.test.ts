import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test from "node:test";
import { codeReviewPackageSchema } from "../src/assisted-contracts.js";
import {
  countLines,
  indexCodeReviewSources,
} from "../src/index-code-review-sources.js";
import {
  FIXTURE_SCRIPT,
  FIXTURE_UPDATE_SET_XML,
  codeReviewPackage,
  sha256,
} from "./code-review-fixtures.js";

const directory = "C:\\artifacts\\code-review";
const scriptPath = "C:\\code\\fixture\\log-rooms.js";

test("code review contract accepts a well-formed package", () => {
  const parsed = codeReviewPackageSchema.parse(
    codeReviewPackage(directory, scriptPath),
  );
  assert.equal(parsed.findings[0]!.decision.status, "pending");
});

test("code review contract rejects broken finding references", () => {
  const cases: Array<[string, (value: any) => void, RegExp]> = [
    [
      "unknown source",
      (value) => (value.findings[0].location.sourceId = "SRC-404"),
      /unknown source 'SRC-404'/,
    ],
    [
      "path mismatch",
      (value) => (value.findings[0].location.path = "C:\\code\\other.js"),
      /path does not match source/,
    ],
    [
      "line past end",
      (value) => (value.findings[0].location.endLine = 99),
      /ends past the last line/,
    ],
    [
      "inverted range",
      (value) => (value.findings[0].location.startLine = 6),
      /endLine precedes startLine/,
    ],
    [
      "no-op suggestion",
      (value) =>
        (value.findings[0].suggestedCode = value.findings[0].currentCode),
      /identical to currentCode/,
    ],
    [
      "duplicate finding",
      (value) => value.findings.push(structuredClone(value.findings[0])),
      /Duplicate finding id 'F-001'/,
    ],
    [
      "verification without query",
      (value) => delete value.findings[0].instanceVerification.query,
      /must record its query and result/,
    ],
    [
      "verification without instance",
      (value) => delete value.target.instanceAlias,
      /target.instanceAlias is not set/,
    ],
    [
      "decision without timestamp",
      (value) => (value.findings[0].decision = { status: "approved" }),
      /must record 'decidedOn'/,
    ],
    [
      "bad finding id",
      (value) => (value.findings[0].id = "FINDING-1"),
      /Invalid string|F-\[0-9\]/,
    ],
    [
      "unknown field",
      (value) => (value.reviewer = "someone"),
      /Unrecognized key/,
    ],
  ];
  for (const [label, mutate, expected] of cases) {
    const value = structuredClone(codeReviewPackage(directory, scriptPath));
    mutate(value);
    assert.throws(
      () => codeReviewPackageSchema.parse(value),
      expected,
      `case '${label}' should be rejected`,
    );
  }
});

test("code review contract allows no-change findings and recorded decisions", () => {
  const value = structuredClone(codeReviewPackage(directory, scriptPath)) as any;
  value.findings[0].suggestedCode = null;
  value.findings[0].instanceVerification = { status: "not_checked" };
  value.findings[0].decision = {
    status: "deferred",
    note: "Revisit after logging standard is agreed.",
    decidedOn: "2026-11-07T15:00:00.000Z",
  };
  delete value.target.instanceAlias;
  assert.doesNotThrow(() => codeReviewPackageSchema.parse(value));
});

const ESCAPED_UPDATE_SET_XML = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  "<unload>",
  '<sys_remote_update_set action="INSERT_OR_UPDATE"><name>Escaped</name></sys_remote_update_set>',
  '<sys_update_xml action="INSERT_OR_UPDATE">',
  "<payload>&lt;?xml version=\"1.0\"?&gt;&lt;record_update table=\"sys_script_client\"&gt;&lt;sys_script_client action=\"INSERT_OR_UPDATE\"&gt;",
  "&lt;name&gt;Warn on short description&lt;/name&gt;",
  "&lt;script&gt;function onChange(control, oldValue, newValue) {",
  "  if (newValue.length &amp;lt; 5) g_form.showFieldMsg('short_description', 'Too short');",
  "}&lt;/script&gt;",
  "&lt;sys_id&gt;fedcba9876543210fedcba9876543210&lt;/sys_id&gt;",
  "&lt;/sys_script_client&gt;&lt;/record_update&gt;</payload>",
  "</sys_update_xml>",
  "</unload>",
  "",
].join("\n");

function buildIndexFixture(): string {
  const root = mkdtempSync(join(tmpdir(), "code-review-index-"));
  const project = join(root, "fluent-app");
  mkdirSync(join(project, "src", "fluent"), { recursive: true });
  mkdirSync(join(project, "src", "server"), { recursive: true });
  mkdirSync(join(project, "node_modules", "pkg"), { recursive: true });
  mkdirSync(join(project, "dist"), { recursive: true });
  writeFileSync(
    join(project, "now.config.json"),
    JSON.stringify({ scope: "x_app", scopeId: "0123456789abcdef0123456789abcdef", name: "Fixture App" }),
  );
  writeFileSync(
    join(project, "src", "fluent", "rule.now.ts"),
    "import { BusinessRule } from '@servicenow/sdk/core'\n\nBusinessRule({ $id: Now.ID['r'], name: 'R', table: 'x_app_room' })\n",
  );
  writeFileSync(join(project, "src", "server", "log-rooms.server.js"), FIXTURE_SCRIPT);
  writeFileSync(join(project, "node_modules", "pkg", "index.js"), "module.exports = 1;\n");
  writeFileSync(join(project, "dist", "out.js"), "built();\n");
  writeFileSync(join(project, "package-lock.json"), "{}\n");
  writeFileSync(join(root, "client.js"), "function onLoad() {\n  g_form.setValue('a', 'b');\n}\n");
  writeFileSync(join(root, "update-set.xml"), FIXTURE_UPDATE_SET_XML);
  writeFileSync(join(root, "escaped-update-set.xml"), ESCAPED_UPDATE_SET_XML);
  writeFileSync(join(root, "binary.js"), Buffer.from([0x61, 0x00, 0x62]));
  writeFileSync(join(root, "notes.txt"), "not walked\n");
  return root;
}

test("countLines ignores a single trailing newline", () => {
  assert.equal(countLines(""), 0);
  assert.equal(countLines("a"), 1);
  assert.equal(countLines("a\nb\n"), 2);
  assert.equal(countLines("a\r\nb"), 2);
});

test("source indexer classifies, fingerprints and skips non-source files", () => {
  const root = buildIndexFixture();
  const index = indexCodeReviewSources([root]);
  const byName = new Map(
    index.sources.map((source) => [basename(source.path), source]),
  );

  assert.deepEqual(
    [...byName.keys()].sort(),
    [
      "client.js",
      "escaped-update-set.xml",
      "log-rooms.server.js",
      "now.config.json",
      "rule.now.ts",
      "update-set.xml",
    ],
  );
  assert.equal(byName.get("rule.now.ts")!.kind, "fluent");
  assert.equal(byName.get("log-rooms.server.js")!.kind, "server_script");
  assert.equal(byName.get("client.js")!.kind, "client_script");
  assert.equal(byName.get("now.config.json")!.kind, "config");
  assert.equal(byName.get("update-set.xml")!.kind, "update_set_xml");

  const script = byName.get("log-rooms.server.js")!;
  assert.equal(script.sha256, sha256(FIXTURE_SCRIPT));
  assert.equal(script.lineCount, countLines(FIXTURE_SCRIPT));
  assert.match(script.id, /^SRC-\d{3}$/);

  assert.ok(index.skipped.some((entry) => /binary\.js$/.test(entry.path) && entry.reason === "binary content"));
  assert.ok(index.skipped.some((entry) => entry.reason === "lock file"));
  assert.ok(!index.sources.some((source) => /node_modules|[\\/]dist[\\/]/.test(source.path)));
  assert.deepEqual(index.fluentProjects.map((project) => project.scope), ["x_app"]);
});

test("source indexer locates update-set records and their script lines", () => {
  const root = buildIndexFixture();
  const index = indexCodeReviewSources([join(root, "update-set.xml"), join(root, "escaped-update-set.xml")]);
  const [escaped, cdata] = [...index.sources].sort((a, b) =>
    a.path.localeCompare(b.path),
  );

  assert.equal(cdata!.records.length, 1);
  const rule = cdata!.records[0]!;
  assert.equal(rule.table, "sys_script");
  assert.equal(rule.name, "Log rooms");
  assert.equal(rule.sysId, "0123456789abcdef0123456789abcdef");
  assert.equal(rule.startLine, 8);
  assert.equal(rule.endLine, 14);
  assert.deepEqual(rule.scriptFields, [{ field: "script", startLine: 10, endLine: 12 }]);

  assert.equal(escaped!.records.length, 1);
  const client = escaped!.records[0]!;
  assert.equal(client.table, "sys_script_client");
  assert.equal(client.name, "Warn on short description");
  assert.equal(client.sysId, "fedcba9876543210fedcba9876543210");
  assert.deepEqual(client.scriptFields, [{ field: "script", startLine: 7, endLine: 9 }]);
});

test("indexed sources slot straight into a code review package", () => {
  const root = buildIndexFixture();
  const index = indexCodeReviewSources([join(root, "update-set.xml")]);
  const value = codeReviewPackage(directory, index.sources[0]!.path) as any;
  value.reviewedSources = index.sources;
  value.findings[0].location = {
    sourceId: index.sources[0]!.id,
    path: index.sources[0]!.path,
    startLine: 11,
    endLine: 11,
    recordTable: "sys_script",
    recordName: "Log rooms",
    sysId: "0123456789abcdef0123456789abcdef",
  };
  value.findings[0].currentCode = "  gs.log('hello');";
  value.findings[0].suggestedCode = "  gs.info('hello');";
  assert.doesNotThrow(() => codeReviewPackageSchema.parse(value));
});
