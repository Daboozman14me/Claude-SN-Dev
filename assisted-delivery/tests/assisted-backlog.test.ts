import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import test from "node:test";
import { backlogPackageSchema } from "../src/assisted-contracts.js";
import { backlogSysId, buildBacklogPackageFile, buildBacklogRecords, readStoryDraft, renderBacklogXml } from "../src/build-backlog.js";
import { renderReportFile } from "../src/render-report-html.js";
import { validateAssistedBacklogFile } from "../src/validate-assisted-backlog.js";
import { backlogScenario } from "./backlog-fixtures.js";

function built(options: { split?: boolean } = {}) {
  const scenario = backlogScenario();
  const value = buildBacklogPackageFile(scenario.value.artifacts.json, options);
  return { ...scenario, value };
}

function finish(jsonPath: string, mutate: (value: any) => void = () => {}): any {
  const value = JSON.parse(readFileSync(jsonPath, "utf8"));
  value.precheck = value.records.map((record: any) => ({ sysId: record.sysId, status: "absent", fields: [] }));
  mutate(value);
  writeFileSync(jsonPath, JSON.stringify(value, null, 2));
  renderReportFile(jsonPath);
  return value;
}

test("backlog sys_ids are deterministic and distinct per table and source", () => {
  const a = backlogSysId("stories-v001", "rm_story", "S0-01");
  assert.match(a, /^[0-9a-f]{32}$/);
  assert.equal(a, backlogSysId("stories-v001", "rm_story", "S0-01"));
  assert.notEqual(a, backlogSysId("stories-v001", "rm_epic", "S0-01"));
  assert.notEqual(a, backlogSysId("stories-v002", "rm_story", "S0-01"));
});

test("backlog:build derives releases, sprints, epics and stories from the draft and plan", () => {
  const { value } = built();
  const of = (table: string) => value.records.filter((record) => record.table === table);
  assert.deepEqual(
    ["rm_release_scrum", "rm_sprint", "rm_epic", "rm_story"].map((table) => of(table).length),
    [1, 1, 2, 3],
  );
  const story = (id: string) => of("rm_story").find((record) => record.source.id === id)!;
  const epic = (id: string) => of("rm_epic").find((record) => record.source.id === id)!;
  const sprint = of("rm_sprint")[0]!;
  assert.equal(story("S0-01").fields.state, "3");
  assert.equal(story("S0-01").fields.sprint, sprint.sysId, "a completed story sits in its epic's sprint");
  assert.equal(story("S0-01").fields.release, sprint.fields.release);
  assert.equal(story("S0-02").fields.sprint, "", "a deferred story is not in a sprint");
  assert.equal(story("S0-02").fields.epic, epic("E0").sysId);
  assert.match(story("S0-02").fields.description!, /Depends on: S0-01/);
  assert.match(story("S0-01").fields.acceptance_criteria!, /<li><b>S0-01-AC01<\/b> Given .*&lt;confirmed&gt; &amp; saved/);
  assert.equal(story("S0-01").fields.short_description, "S0-01 — Story S0-01");
  assert.equal(epic("E0").fields.state, "2", "an epic with some completed stories is in progress");
  assert.equal(epic("E1").fields.state, "1");
  assert.equal(of("rm_release_scrum")[0]!.fields.state, "3");
});

test("an epic state override replaces the derived state", () => {
  const scenario = backlogScenario();
  const value = backlogPackageSchema.parse({
    ...scenario.value,
    plan: { ...scenario.value.plan, epicStateOverrides: [{ epicId: "E0", state: "3", reason: "Owner closed the epic; S0-02 moved to a later release." }] },
  });
  const records = buildBacklogRecords(value, readStoryDraft(scenario.draftPath).draft);
  assert.equal(records.find((record) => record.source.id === "E0")!.fields.state, "3");
});

test("backlog XML is ordered, escaped, stable and can be split per table", () => {
  const { value } = built();
  const xml = readFileSync(value.importFiles[0]!.path, "utf8");
  assert.equal(xml, renderBacklogXml(value.records, value.unloadDate), "regeneration is byte-identical");
  assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?>\n<unload unload_date="2026-11-15 12:00:00">/);
  const order = ["<rm_release_scrum ", "<rm_sprint ", "<rm_epic ", "<rm_story "].map((tag) => xml.indexOf(tag));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.match(xml, /<rm_story action="INSERT_OR_UPDATE">/);
  assert.match(xml, /&amp;lt;confirmed&amp;gt; &amp;amp; saved/, "HTML criteria are escaped again inside XML");
  assert.match(xml, /<sprint\/>/, "empty references are written as empty elements so a re-import clears them");
  const split = built({ split: true }).value;
  assert.deepEqual(split.importFiles.map((file) => file.tables[0]), ["rm_release_scrum", "rm_sprint", "rm_epic", "rm_story"]);
  assert.match(split.importFiles[3]!.path, /backlog-v001-4-rm_story\.xml$/);
});

test("a built, prechecked and rendered backlog passes the validator", () => {
  const { value } = built();
  finish(value.artifacts.json);
  assert.doesNotThrow(() => validateAssistedBacklogFile(value.artifacts.json));
  const html = readFileSync(value.artifacts.html, "utf8");
  for (const section of ["Summary", "Inputs", "Plan", "Story Status", "Records", "Import Steps", "Verification", "Limitations"]) {
    assert.match(html, new RegExp(`<h2>${section}</h2>`));
  }
  assert.match(html, /Import XML/);
});

test("the backlog validator refuses hand edits, stale drafts and missing prechecks", () => {
  const hand = built().value;
  finish(hand.artifacts.json, (value) => {
    value.records.at(-1).fields.short_description = "Edited by hand";
  });
  assert.throws(() => validateAssistedBacklogFile(hand.artifacts.json), /never edit records by hand/);

  const xml = built().value;
  finish(xml.artifacts.json);
  writeFileSync(xml.importFiles[0]!.path, `${readFileSync(xml.importFiles[0]!.path, "utf8")}<!-- extra -->`);
  assert.throws(() => validateAssistedBacklogFile(xml.artifacts.json), /differs from what backlog:build generates/);

  const stale = built();
  finish(stale.value.artifacts.json);
  writeFileSync(stale.draftPath, `${readFileSync(stale.draftPath, "utf8")}\n`);
  assert.throws(() => validateAssistedBacklogFile(stale.value.artifacts.json), /story draft changed/);

  const unchecked = built().value;
  finish(unchecked.artifacts.json, (value) => {
    value.precheck = value.precheck.slice(1);
  });
  assert.throws(() => validateAssistedBacklogFile(unchecked.artifacts.json), /must precheck every record/);
});

test("a story is Complete only with evidence that it was implemented", () => {
  const scenario = backlogScenario();
  const value = JSON.parse(readFileSync(scenario.value.artifacts.json, "utf8"));
  value.storyStatus[1] = { storyId: "S0-02", state: "3", basis: "deployed", evidence: scenario.value.progressSources };
  writeFileSync(scenario.value.artifacts.json, JSON.stringify(value, null, 2));
  buildBacklogPackageFile(scenario.value.artifacts.json);
  finish(scenario.value.artifacts.json);
  assert.throws(() => validateAssistedBacklogFile(scenario.value.artifacts.json), /S0-02 is marked implemented, but no evidence/);
});

test("backlog:build can run again after precheck without losing it", () => {
  const { value } = built();
  finish(value.artifacts.json);
  const again = buildBacklogPackageFile(value.artifacts.json);
  assert.equal(again.precheck.length, again.records.length);
  renderReportFile(value.artifacts.json);
  assert.doesNotThrow(() => validateAssistedBacklogFile(value.artifacts.json));
});

test("partial work is in progress and owner-confirmed work is Complete with a note", () => {
  const scenario = backlogScenario();
  const value = JSON.parse(readFileSync(scenario.value.artifacts.json, "utf8"));
  value.storyStatus[1] = { storyId: "S0-02", state: "2", basis: "partial", evidence: scenario.value.progressSources };
  value.storyStatus[2] = { storyId: "S1-01", state: "3", basis: "owner_confirmed", note: "Owner confirmed 2026-11-15 the manual steps were done." };
  writeFileSync(scenario.value.artifacts.json, JSON.stringify(value, null, 2));
  const result = buildBacklogPackageFile(scenario.value.artifacts.json);
  const story = (id: string) => result.records.find((record) => record.source.id === id)!;
  assert.equal(story("S0-02").fields.state, "2");
  assert.notEqual(story("S0-02").fields.sprint, "", "work in progress sits in its epic's sprint");
  finish(scenario.value.artifacts.json);
  assert.doesNotThrow(() => validateAssistedBacklogFile(scenario.value.artifacts.json));
  const noNote = structuredClone(value);
  delete noNote.storyStatus[2].note;
  const parsed = backlogPackageSchema.safeParse({ ...noNote, records: [], importFiles: [] });
  assert.match(JSON.stringify(parsed.error?.issues ?? []), /owner-confirmed story needs a note/);
});

test("an owner-named team and product are created first and own every epic, story and sprint, with numbers", () => {
  const scenario = backlogScenario();
  const value = JSON.parse(readFileSync(scenario.value.artifacts.json, "utf8"));
  value.plan.product = { name: "Fixture App", description: "The fixture product." };
  value.plan.team = { name: "Fixture Team", typeSysIds: ["1".repeat(32)], members: [{ userName: "admin", sysId: "6".repeat(32) }] };
  value.plan.numbering = { start: 90001 };
  writeFileSync(scenario.value.artifacts.json, JSON.stringify(value, null, 2));
  const result = buildBacklogPackageFile(scenario.value.artifacts.json);
  const one = (table: string) => result.records.find((record) => record.table === table)!;
  const product = one("cmdb_application_product_model");
  const team = one("sys_user_group");
  assert.equal(team.fields.type, "1".repeat(32));
  assert.deepEqual(one("sys_user_grmember").fields, { group: team.sysId, user: "6".repeat(32) });
  for (const record of result.records.filter((entry) => entry.table === "rm_story" || entry.table === "rm_epic")) {
    assert.equal(record.fields.product, product.sysId);
    assert.equal(record.fields.assignment_group, team.sysId);
  }
  assert.equal(one("rm_sprint").fields.assignment_group, team.sysId);
  assert.equal(one("rm_sprint").fields.product, undefined);
  assert.deepEqual(
    result.records.filter((record) => record.table === "rm_story").map((record) => record.fields.number),
    ["STRY0090001", "STRY0090002", "STRY0090003"],
  );
  assert.equal(one("rm_epic").fields.number, "EPIC0090001");
  assert.equal(one("rm_release_scrum").fields.number, "RLSE0090001");
  const xml = readFileSync(result.importFiles[0]!.path, "utf8");
  const order = ["<cmdb_application_product_model ", "<sys_user_group ", "<sys_user_grmember ", "<rm_release_scrum ", "<rm_story "].map((tag) => xml.indexOf(tag));
  assert.deepEqual([...order].sort((a, b) => a - b), order, "team and product import before the records that reference them");
  finish(scenario.value.artifacts.json);
  assert.doesNotThrow(() => validateAssistedBacklogFile(scenario.value.artifacts.json));
});

test("the backlog contract enforces states, fields, overwrite approval and verification", () => {
  const { value } = built();
  const base = JSON.parse(readFileSync(value.artifacts.json, "utf8"));
  const fails = (mutate: (copy: any) => void, pattern: RegExp) => {
    const copy = structuredClone(base);
    mutate(copy);
    const result = backlogPackageSchema.safeParse(copy);
    assert.equal(result.success, false);
    assert.match(JSON.stringify(result.error!.issues), pattern);
  };
  fails((copy) => { copy.storyStatus[2] = { storyId: "S1-01", state: "3", basis: "not_started" }; }, /must be implemented in a deployed version or confirmed/);
  fails((copy) => { copy.storyStatus[1].note = undefined; }, /deferred story needs a note/);
  fails((copy) => { copy.records.at(-1).fields.story_points = "5"; }, /story_points.*not written to rm_story/);
  fails((copy) => { copy.records.at(-1).fields.epic = "f".repeat(32); }, /not a rm_epic record/);
  fails((copy) => { copy.precheck = [{ sysId: copy.records[0].sysId, status: "changed_on_instance", fields: ["state"] }]; }, /owner's approval to overwrite/);
  fails((copy) => { copy.modes = ["verify"]; copy.verification = []; }, /was not verified/);
  fails((copy) => { copy.plan.sprints[0].releaseId = "v9"; }, /Unknown release 'v9'/);
});
