import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ASSISTED_CONTRACT_VERSION, userGuidePackageSchema } from "../src/assisted-contracts.js";
import { sha256Hex } from "../src/build-backlog.js";
import { renderReportFile } from "../src/render-report-html.js";
import { validateAssistedUserGuideFile } from "../src/validate-assisted-user-guide.js";

function scenario() {
  const directory = mkdtempSync(join(tmpdir(), "user-guide-"));
  const evidence = join(directory, "code-implementation-v001.json");
  writeFileSync(evidence, JSON.stringify({
    packageType: "code_implementation",
    storyCoverage: [
      { storyId: "S1-01", status: "implemented", note: "Book a room." },
      { storyId: "S1-02", status: "implemented", note: "Roles and ACLs." },
      { storyId: "S1-03", status: "not_started", note: "ATF deferred." },
    ],
  }));
  const section = (id: string, story: string, checkId: string) => ({
    id,
    title: `Section ${id}`,
    intro: "What this task is for.",
    steps: [{ text: "Open Book a Room & fill in the <form>.", screenshot: { id: `${id}-1`, caption: "The reservation form" } }],
    notes: ["Rooms already booked are not offered."],
    uiRefs: [{ kind: "module", name: "Book a Room", checkId }],
    references: [{ kind: "story", id: story }],
  });
  const value = {
    contractVersion: ASSISTED_CONTRACT_VERSION,
    packageType: "user_guide",
    packageId: "fixture-user-guide-v001",
    title: "Fixture App User Guide",
    summary: "How to use and administer the fixture app.",
    artifacts: { html: join(directory, "user-guide-v001.html"), json: join(directory, "user-guide-v001.json") },
    target: { application: "Fixture App", scope: "x_1_fix", instanceAlias: "dev000001", version: "1.0.0" },
    sources: [{ kind: "code_implementation", path: evidence, packageId: "fixture-build", sha256: sha256Hex(readFileSync(evidence)) }],
    parts: [
      { audience: "end_user", title: "Using the app", sections: [section("book", "S1-01", "IC-01")] },
      { audience: "admin", title: "Administering the app", sections: [{ ...section("roles", "S1-02", "IC-01"), steps: [] }] },
    ],
    diagrams: [{ id: "lifecycle", title: "Booking lifecycle", mermaid: "stateDiagram-v2\n  [*] --> Confirmed" }],
    featureCoverage: [
      { storyId: "S1-01", sectionIds: ["book"] },
      { storyId: "S1-02", sectionIds: ["roles"] },
    ],
    knownLimitations: [{ id: "KL-01", text: "Automated tests were deferred." }],
    instanceChecks: [{ id: "IC-01", query: "sys_app_module title=Book a Room", result: "1 active module" }],
  };
  return { directory, evidence, value };
}

function write(value: any): string {
  writeFileSync(value.artifacts.json, JSON.stringify(value, null, 2));
  renderReportFile(value.artifacts.json);
  return value.artifacts.json;
}

test("a rendered user guide passes its validator and reads as a guide", () => {
  const { value } = scenario();
  const path = write(value);
  assert.doesNotThrow(() => validateAssistedUserGuideFile(path));
  const html = readFileSync(value.artifacts.html, "utf8");
  assert.match(html, /Part 1: Using the app/);
  assert.match(html, /Part 2: Administering the app/);
  assert.match(html, /class="shot"><b>Screenshot book-1<\/b> — The reservation form/);
  assert.match(html, /Open Book a Room &amp; fill in the &lt;form&gt;\./);
  assert.match(html, /<pre class="mermaid">stateDiagram-v2/);
  assert.match(html, /Known limitations/);
});

test("the guide must account for every implemented story and describe only implemented ones", () => {
  const missing = scenario().value as any;
  missing.featureCoverage = [missing.featureCoverage[0]];
  assert.throws(() => validateAssistedUserGuideFile(write(missing)), /Implemented story S1-02 is not in featureCoverage/);

  const unbuilt = scenario().value as any;
  unbuilt.featureCoverage.push({ storyId: "S1-03", sectionIds: ["book"] });
  assert.throws(() => validateAssistedUserGuideFile(write(unbuilt)), /S1-03 is described in the guide, but no code-implementation source/);

  const cited = scenario().value as any;
  cited.parts[0].sections[0].references.push({ kind: "story", id: "S1-03" });
  assert.throws(() => validateAssistedUserGuideFile(write(cited)), /cites story S1-03, which is not implemented/);

  const explained = scenario().value as any;
  explained.featureCoverage.push({ storyId: "S1-03", notCoveredReason: "Deferred by the owner." });
  assert.doesNotThrow(() => validateAssistedUserGuideFile(write(explained)));

  const deferredByOwner = scenario().value as any;
  deferredByOwner.storyStatusOverrides = [{ storyId: "S1-01", status: "deferred", ownerDecisionId: "D-99", note: "Owner deferred booking." }];
  assert.throws(() => validateAssistedUserGuideFile(write(deferredByOwner)), /S1-01 is described in the guide, but no code-implementation source/);
});

test("the guide refuses changed sources, stale HTML and unchecked UI names", () => {
  const changed = scenario();
  const path = write(changed.value);
  writeFileSync(changed.evidence, `${readFileSync(changed.evidence, "utf8")}\n`);
  assert.throws(() => validateAssistedUserGuideFile(path), /Source changed after the guide was written/);

  const stale = scenario().value as any;
  write(stale);
  writeFileSync(stale.artifacts.html, `${readFileSync(stale.artifacts.html, "utf8")}<!-- edit -->`);
  assert.throws(() => validateAssistedUserGuideFile(stale.artifacts.json), /differs from the rendered JSON/);

  const unchecked = scenario().value as any;
  unchecked.parts[0].sections[0].uiRefs[0].checkId = "IC-99";
  const result = userGuidePackageSchema.safeParse(unchecked);
  assert.match(JSON.stringify(result.error?.issues ?? []), /cites instance check 'IC-99', which is not recorded/);

  const onePart = scenario().value as any;
  onePart.parts = [onePart.parts[0], { ...onePart.parts[0], title: "Again" }];
  assert.match(JSON.stringify(userGuidePackageSchema.safeParse(onePart).error?.issues ?? []), /one end_user part and one admin part/);
});
