import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ASSISTED_CONTRACT_VERSION, MAX_RESEARCH_LOOKUP_ITEMS, researchLookupRequestSchema } from "../src/assisted-contracts.js";
import { checkLookupFreshness } from "../src/lookup-freshness.js";
import { validateResearchLookupFile } from "../src/validate-assisted-research-lookup.js";

const SYS_ID = "a".repeat(32);

function writeLookup(mutate: (value: any) => void = () => {}) {
  const research = mkdtempSync(join(tmpdir(), "lookup-"));
  const stem = "research-lookup-epic-4-room-gating-v001";
  const evidence = join(research, "evidence", stem);
  mkdirSync(evidence, { recursive: true });
  const evidenceFile = join(evidence, "sys_script-conflicts.json");
  writeFileSync(evidenceFile, JSON.stringify({ records: [{ sys_id: SYS_ID, name: "Check conflicts", script: "if (current.state != 'cancelled') { /* ... */ }", sys_updated_on: "2026-11-20 10:00:00" }] }));
  const value: any = {
    contractVersion: ASSISTED_CONTRACT_VERSION,
    packageType: "research_lookup",
    packageId: `ncrb-${stem}`,
    title: "Research lookup: conflict check",
    lookedUpAt: "2026-11-27T10:00:00Z",
    instance: "dev292961",
    request: {
      requestedBy: "assisted-delivery-technical-design",
      application: "New Conf Room Booking",
      workLabel: "epic-4-room-gating",
      items: [{ id: "LK-01", what: "Business rules on x_888213_ncrb_reservation that check conflicts, full script", why: "Epic 4 changes conflict checking", table: "sys_script" }],
    },
    results: [{
      itemId: "LK-01",
      status: "answered",
      answer: "One before-insert/update rule, Check conflicts, ignores cancelled reservations.",
      records: [{ table: "sys_script", sysId: SYS_ID, name: "Check conflicts", sysUpdatedOn: "2026-11-20 10:00:00", evidenceFile }],
    }],
    limitations: [],
    artifacts: { markdown: join(research, `${stem}.md`), json: join(research, `${stem}.json`), evidenceDirectory: evidence },
  };
  mutate(value);
  writeFileSync(value.artifacts.json, JSON.stringify(value, null, 2));
  writeFileSync(join(research, `${stem}.md`), "# Research lookup\n\n## LK-01\nOne rule, Check conflicts.\n");
  return { value, jsonPath: value.artifacts.json as string, evidenceFile };
}

test("a lookup answers every item, cites masked evidence, and validates", () => {
  const { jsonPath } = writeLookup();
  assert.equal(validateResearchLookupFile(jsonPath).results.length, 1);
});

test("a lookup is refused when an item is unanswered, unrequested, or uncited", () => {
  const { jsonPath: missing } = writeLookup((value) => value.request.items.push({ id: "LK-02", what: "Roles", why: "ACL change" }));
  assert.throws(() => validateResearchLookupFile(missing), /LK-02 has no result/);
  const { jsonPath: uncited } = writeLookup((value) => (value.results[0].records = []));
  assert.throws(() => validateResearchLookupFile(uncited), /cites at least one record/);
  const { jsonPath: extra } = writeLookup((value) => value.results.push({ itemId: "LK-09", status: "not_found", answer: "n/a", records: [] }));
  assert.throws(() => validateResearchLookupFile(extra), /LK-09, which was not requested/);
});

test("lookup evidence must be masked and inside the lookup's own evidence folder", () => {
  const { jsonPath, evidenceFile } = writeLookup();
  writeFileSync(evidenceFile, JSON.stringify({ records: [{ sys_id: SYS_ID, email: "jane.doe@example.com" }] }));
  assert.throws(() => validateResearchLookupFile(jsonPath), /personal data/);
  const outside = mkdtempSync(join(tmpdir(), "elsewhere-"));
  const { jsonPath: misplaced } = writeLookup((value) => {
    value.results[0].records[0].evidenceFile = join(outside, "x.json");
  });
  assert.throws(() => validateResearchLookupFile(misplaced), /outside the lookup's evidence folder/);
});

test(`a lookup request holds at most ${MAX_RESEARCH_LOOKUP_ITEMS} items; more means full research`, () => {
  const items = (count: number) => Array.from({ length: count }, (_, index) => ({ id: `LK-${String(index + 1).padStart(2, "0")}`, what: "x", why: "y" }));
  const request = (count: number) => ({ requestedBy: "assisted-delivery-solution-advisor", application: "App", items: items(count) });
  assert.equal(researchLookupRequestSchema.safeParse(request(MAX_RESEARCH_LOOKUP_ITEMS)).success, true);
  assert.equal(researchLookupRequestSchema.safeParse(request(MAX_RESEARCH_LOOKUP_ITEMS + 1)).success, false);
  assert.equal(researchLookupRequestSchema.safeParse({ ...request(1), requestedBy: "assisted-delivery-story-drafter" }).success, false, "only Advisor and Technical Design ask for lookups");
});

test("an earlier lookup is reused only if none of its records changed", () => {
  const { value } = writeLookup();
  const output = (updated: string) => [{ records: [{ sys_id: { value: SYS_ID, display_value: SYS_ID }, sys_updated_on: { value: updated, display_value: updated } }] }];
  assert.deepEqual(checkLookupFreshness(value, output("2026-11-20 10:00:00")), { fresh: true, changed: [], missing: [] });
  const edited = checkLookupFreshness(value, output("2026-11-26 08:30:00"));
  assert.equal(edited.fresh, false, "a hand edit in the instance makes it stale");
  assert.deepEqual(edited.changed[0], { table: "sys_script", sysId: SYS_ID, was: "2026-11-20 10:00:00", now: "2026-11-26 08:30:00" });
  const deleted = checkLookupFreshness(value, [{ records: [] }]);
  assert.equal(deleted.fresh, false);
  assert.equal(deleted.missing.length, 1);
});
