import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { MASK, findPersonalData, maskEvidenceDirectory, maskText } from "../src/mask-evidence.js";

const record = JSON.stringify({
  records: [{
    sys_id: "5b4c5e291993447cb84016dc0fccc530",
    user_name: "ncrb_deploy",
    email: "jane.doe@example.com",
    first_name: "Jane",
    last_name: { display_value: "Doe", value: "Doe" },
    mobile_phone: "",
    sys_updated_on: "2026-11-15 15:09:17",
    version: "1.3.0",
    script: "if (current.priority == 1) gs.info('notify ops@example.org or call 555-123-4567');",
  }],
});

test("masking removes emails, phone numbers and personal-name fields, nothing else", () => {
  const { text, masked } = maskText(record);
  assert.ok(masked >= 5, `masked ${masked}`);
  for (const gone of ["jane.doe@example.com", "ops@example.org", "555-123-4567", '"Jane"', '"Doe"']) assert.ok(!text.includes(gone), gone);
  for (const kept of ["5b4c5e291993447cb84016dc0fccc530", "ncrb_deploy", "2026-11-15 15:09:17", "1.3.0", "current.priority == 1", '"mobile_phone":""']) assert.ok(text.includes(kept), kept);
  assert.ok(text.includes(`"first_name":"${MASK}"`));
  assert.deepEqual(findPersonalData(text), [], "masked output passes the check");
  assert.ok(findPersonalData(record).length >= 4, "the unmasked record is caught");
});

test("evidence:mask rewrites a folder in place and the result passes the research check", () => {
  const dir = mkdtempSync(join(tmpdir(), "evidence-"));
  writeFileSync(join(dir, "users.json"), record);
  writeFileSync(join(dir, "tables.json"), JSON.stringify({ records: [{ name: "x_1_app_room", label: "Room" }] }));
  const result = maskEvidenceDirectory(dir);
  assert.equal(result.files, 1);
  assert.deepEqual(findPersonalData(readFileSync(join(dir, "users.json"), "utf8")), []);
  assert.match(readFileSync(join(dir, "tables.json"), "utf8"), /x_1_app_room/);
});
