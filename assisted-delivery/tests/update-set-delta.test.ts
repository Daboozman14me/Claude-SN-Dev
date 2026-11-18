import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ASSISTED_CONTRACT_VERSION, updateSetDeltaPackageSchema } from "../src/assisted-contracts.js";
import { buildUpdateSetDelta, type BuildApp } from "../src/build-update-set-delta.js";
import { classifyDeltaEntry, runPrecheck, type QueryRecords } from "../src/precheck-update-set-delta.js";
import { renderReportFile } from "../src/render-report-html.js";
import { asDelete, diffAppTrees, readAppTree } from "../src/update-set-delta.js";
import { validateAssistedUpdateSetDeltaFile } from "../src/validate-assisted-update-set-delta.js";

const SCOPE = "5b4c5e291993447cb84016dc0fccc530";
const id = (n: number): string => n.toString(16).padStart(32, "0");

function record(table: string, sysId: string, fields: Record<string, string>): string {
  const body = Object.entries(fields).map(([key, val]) => `    <${key}>${val}</${key}>`).join("\n");
  return `<?xml version="1.0"?>\n<record_update table="${table}">\n  <${table} action="INSERT_OR_UPDATE" apply_defaults="true">\n    <sys_id>${sysId}</sys_id>\n    <sys_scope display_value="x_1_app">${SCOPE}</sys_scope>\n    <sys_update_name>${table}_${sysId}</sys_update_name>\n${body}\n  </${table}>\n</record_update>\n`;
}

// Two fake builds: v1 has rules A, B and a demo room; v2 changes A, removes B, adds C, bumps the version.
function writeApp(dir: string, version: "1.0.0" | "1.1.0"): string {
  const app = join(dir, "app");
  for (const folder of ["scope", "update", "unload.demo", "dictionary"]) mkdirSync(join(app, folder), { recursive: true });
  writeFileSync(join(app, "scope", `sys_app_${SCOPE}.xml`), record("sys_app", SCOPE, { name: "Fixture App", version }));
  writeFileSync(join(app, "dictionary", "x_1_app_room.xml"), `<?xml version="1.0"?>\n<database>\n  <element name="x_1_app_room" type="collection" label="Room"/>\n</database>\n`);
  writeFileSync(join(app, "unload.demo", `x_1_app_room_${id(9)}.xml`), record("x_1_app_room", id(9), { name: "Room 1" }));
  if (version === "1.0.0") {
    writeFileSync(join(app, "update", `sys_script_${id(1)}.xml`), record("sys_script", id(1), { name: "Rule A", script: "old();" }));
    writeFileSync(join(app, "update", `sys_script_${id(2)}.xml`), record("sys_script", id(2), { name: "Rule B", script: "b();" }));
  } else {
    writeFileSync(join(app, "update", `sys_script_${id(1)}.xml`), record("sys_script", id(1), { name: "Rule A", script: "new();" }));
    writeFileSync(join(app, "update", `sys_script_${id(3)}.xml`), record("sys_script", id(3), { name: "Rule C", script: "c();" }));
  }
  return app;
}

function scenario() {
  const root = mkdtempSync(join(tmpdir(), "delta-"));
  const project = join(root, "project");
  mkdirSync(project);
  const git = (...args: string[]): string => execFileSync("git", ["-C", project, ...args], { encoding: "utf8" }).trim();
  git("init", "-q");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "Test");
  writeFileSync(join(project, "now.config.json"), JSON.stringify({ scope: "x_1_app", scopeId: SCOPE, name: "Fixture App" }));
  writeFileSync(join(project, "VERSION"), "1.0.0");
  git("add", "-A");
  git("commit", "-q", "-m", "v1");
  git("tag", "v1.0.0");
  const fromCommit = git("rev-parse", "HEAD");
  writeFileSync(join(project, "VERSION"), "1.1.0");
  git("commit", "-q", "-am", "v2");
  const reports = join(root, "reports");
  mkdirSync(reports);
  const jsonPath = join(reports, "update-set-delta-v001.json");
  writeFileSync(jsonPath, JSON.stringify({
    contractVersion: ASSISTED_CONTRACT_VERSION,
    packageType: "update_set_delta",
    packageId: "fixture-update-set-delta-v001",
    title: "Delta: Fixture App",
    summary: "Fixture delta.",
    artifacts: { html: join(reports, "update-set-delta-v001.html"), json: jsonPath },
    timestamp: "2026-11-18 12:00:00",
  }));
  const build: BuildApp = (_project, commit, workDir) => writeApp(workDir, commit === fromCommit ? "1.0.0" : "1.1.0");
  return { project, jsonPath, build };
}

function built() {
  const s = scenario();
  const value = buildUpdateSetDelta({ project: s.project, from: "v1.0.0", to: "HEAD", into: s.jsonPath, instanceAlias: "dev000001", build: s.build });
  return { ...s, value };
}

test("the delta holds only added, changed and deleted records, in update-set XML", () => {
  const { value } = built();
  const byName = new Map(value.entries.map((entry) => [entry.name, entry]));
  assert.equal(byName.get(`sys_script_${id(1)}`)?.change, "changed");
  assert.deepEqual(byName.get(`sys_script_${id(1)}`)?.fieldsChanged, ["script"]);
  assert.equal(byName.get(`sys_script_${id(2)}`)?.change, "deleted");
  assert.equal(byName.get(`sys_script_${id(3)}`)?.change, "added");
  assert.equal(byName.get(`sys_app_${SCOPE}`)?.change, "changed", "the version bump travels with the delta");
  assert.equal(byName.has("x_1_app_room"), false, "an unchanged table definition is left out");
  assert.equal([...byName.keys()].some((name) => name.startsWith("demo:")), false, "demo data is left out by default");
  assert.equal(value.updateSet.name, "Fixture App 1.1.0 (delta from 1.0.0)");
  const xml = readFileSync(value.updateSet.path, "utf8");
  assert.match(xml, /<sys_remote_update_set action="INSERT_OR_UPDATE">.*<name>Fixture App 1\.1\.0 \(delta from 1\.0\.0\)<\/name>/);
  assert.match(xml, new RegExp(`<action>DELETE</action>[\\s\\S]*?<name>sys_script_${id(2)}</name>[\\s\\S]*?&lt;sys_script action=&quot;DELETE&quot;`));
  assert.equal((xml.match(/<sys_update_xml /g) ?? []).length, value.entries.length);
});

test("deleting turns a payload's action into DELETE and nothing else", () => {
  const payload = record("sys_script", id(5), { name: "X" });
  assert.equal(asDelete(payload), payload.replace('<sys_script action="INSERT_OR_UPDATE"', '<sys_script action="DELETE"'));
});

test("the mixed-mode precheck tells baseline, applied, and changed-in-the-UI apart", () => {
  const entry = { name: "sys_script_x", folder: "update" as const, table: "sys_script", sysId: id(1), change: "changed" as const, fieldsChanged: ["script"] };
  const baseline = { name: "Rule A", script: "old();" };
  const next = { name: "Rule A", script: "new();" };
  assert.equal(classifyDeltaEntry(entry, baseline, next, { ...baseline, sys_updated_by: "deploy" }).status, "matches_baseline");
  assert.equal(classifyDeltaEntry(entry, baseline, next, { ...next }).status, "already_applied");
  const edited = classifyDeltaEntry(entry, baseline, next, { name: "Rule A (edited)", script: "old();", sys_updated_by: "jdoe", sys_updated_on: "2026-11-17 10:00:00" });
  assert.equal(edited.status, "changed_on_instance");
  assert.deepEqual(edited.fields, ["name"]);
  assert.equal(edited.changedBy, "jdoe");
  const added = { ...entry, change: "added" as const };
  assert.equal(classifyDeltaEntry(added, undefined, next, undefined).status, "absent");
  assert.equal(classifyDeltaEntry(added, undefined, next, { name: "Someone else's rule", script: "x();" }).status, "unexpected_present");
  const deleted = { ...entry, change: "deleted" as const };
  assert.equal(classifyDeltaEntry(deleted, baseline, undefined, undefined).status, "already_applied");
  assert.equal(classifyDeltaEntry(deleted, baseline, undefined, { ...baseline }).status, "matches_baseline");
});

test("a prechecked, rendered delta validates; a conflict blocks it until the owner approves", () => {
  const { value, jsonPath } = built();
  const fields = (sysId: string): Record<string, string> => ({ [id(1)]: { name: "Rule A", script: "old();" }, [id(2)]: { name: "Rule B", script: "b();" }, [SCOPE]: { name: "Fixture App", version: "1.0.0" } } as Record<string, Record<string, string>>)[sysId] ?? {};
  const atBaseline: QueryRecords = (_table, sysIds) => sysIds.filter((sysId) => sysId !== id(3)).map((sysId) => ({ sys_id: sysId, ...fields(sysId) }));
  runPrecheck(jsonPath, { query: atBaseline });
  renderReportFile(jsonPath);
  assert.doesNotThrow(() => validateAssistedUpdateSetDeltaFile(jsonPath));

  const editedInUi: QueryRecords = (table, sysIds, requested) => atBaseline(table, sysIds, requested)
    .map((row) => (row.sys_id === id(1) ? { ...row, name: "Rule A (edited in UI)", sys_updated_by: "jdoe" } : row));
  const conflicted = runPrecheck(jsonPath, { query: editedInUi });
  assert.equal(conflicted.precheck.find((check) => check.name === `sys_script_${id(1)}`)?.status, "changed_on_instance");
  assert.equal(updateSetDeltaPackageSchema.safeParse(conflicted).success, false, "a conflict without approval is not a valid package");

  assert.equal(value.entries.length, 4);
});

test("the validator refuses edited entries, a tampered XML, and an unverified import", () => {
  const { jsonPath, value } = built();
  const query: QueryRecords = (_table, sysIds) => sysIds.filter((sysId) => sysId !== id(3)).map((sysId) => ({ sys_id: sysId }));
  runPrecheck(jsonPath, { query });
  renderReportFile(jsonPath);
  writeFileSync(value.updateSet.path, `${readFileSync(value.updateSet.path, "utf8")}<!-- extra -->`);
  assert.throws(() => validateAssistedUpdateSetDeltaFile(jsonPath), /XML differs from what update-set:delta generates/);

  const second = built();
  runPrecheck(second.jsonPath, { query });
  const raw = JSON.parse(readFileSync(second.jsonPath, "utf8"));
  raw.entries.pop();
  raw.updateSet.entryCount -= 1;
  raw.precheck = raw.precheck.filter((check: { name: string }) => raw.entries.some((entry: { name: string }) => entry.name === check.name));
  writeFileSync(second.jsonPath, JSON.stringify(raw, null, 2));
  renderReportFile(second.jsonPath);
  assert.throws(() => validateAssistedUpdateSetDeltaFile(second.jsonPath), /never edit entries by hand/);

  const third = built();
  runPrecheck(third.jsonPath, { query });
  renderReportFile(third.jsonPath);
  assert.throws(() => validateAssistedUpdateSetDeltaFile(third.jsonPath, { verified: true }), /After import/);
});

test("readAppTree can include demo data on request", () => {
  const dir = mkdtempSync(join(tmpdir(), "delta-tree-"));
  const app = writeApp(dir, "1.0.0");
  assert.equal([...readAppTree(app).keys()].some((name) => name.startsWith("demo:")), false);
  assert.equal([...readAppTree(app, { includeDemo: true }).keys()].some((name) => name.startsWith("demo:")), true);
  assert.deepEqual(diffAppTrees(readAppTree(app), readAppTree(app)), [], "identical builds have no delta");
});
