import { createHash } from "node:crypto";
import { join } from "node:path";
import { ASSISTED_CONTRACT_VERSION } from "../src/assisted-contracts.js";
import { countLines } from "../src/index-code-review-sources.js";

export const FIXTURE_SCRIPT = [
  "(function executeRule(current, previous) {",
  "  var gr = new GlideRecord('x_app_room');",
  "  gr.query();",
  "  while (gr.next()) {",
  "    gs.log('room ' + gr.name);",
  "  }",
  "})(current, previous);",
  "",
].join("\n");

export function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export function codeReviewPackage(directory: string, scriptPath: string) {
  return {
    contractVersion: ASSISTED_CONTRACT_VERSION,
    packageType: "code_review",
    packageId: "code-review-fixture",
    title: "Code Review: Fixture App",
    summary: "One business rule reviewed; one finding.",
    artifacts: {
      html: join(directory, "code-review-v001.html"),
      json: join(directory, "code-review-v001.json"),
    },
    target: {
      application: "Fixture App",
      scope: "x_app",
      instanceAlias: "dev292961",
    },
    reviewedSources: [
      {
        id: "SRC-001",
        path: scriptPath,
        kind: "server_script",
        sha256: sha256(FIXTURE_SCRIPT),
        lineCount: countLines(FIXTURE_SCRIPT),
        records: [],
      },
    ],
    findings: [
      {
        id: "F-001",
        title: "gs.log is unavailable in scoped applications",
        severity: "medium",
        category: "best_practice",
        confidence: "confirmed",
        location: {
          sourceId: "SRC-001",
          path: scriptPath,
          startLine: 5,
          endLine: 5,
        },
        currentCode: "    gs.log('room ' + gr.name);",
        suggestedCode: "    gs.info('room ' + gr.getValue('name'));",
        rationale:
          "Scoped applications must use gs.info/gs.warn/gs.error; gs.log is global-only.",
        practiceReference:
          "ServiceNow scoped application scripting: GlideSystem logging",
        instanceVerification: {
          status: "confirmed",
          query: "now-sdk query sys_dictionary -q name=x_app_room^element=name -f element",
          result: "Field 'name' exists on x_app_room.",
        },
        decision: { status: "pending" },
      },
    ],
    assumptions: [],
    limitations: [],
    warnings: [],
  };
}

export const FIXTURE_UPDATE_SET_XML = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  "<unload unload_date=\"2026-11-07 10:00:00\">",
  "<sys_remote_update_set action=\"INSERT_OR_UPDATE\">",
  "<name>Fixture update set</name>",
  "</sys_remote_update_set>",
  "<sys_update_xml action=\"INSERT_OR_UPDATE\">",
  "<name>sys_script_0123456789abcdef0123456789abcdef</name>",
  "<payload><![CDATA[<?xml version=\"1.0\" encoding=\"UTF-8\"?><record_update table=\"sys_script\"><sys_script action=\"INSERT_OR_UPDATE\">",
  "<name>Log rooms</name>",
  "<script><![CDATA[(function executeRule(current, previous) {",
  "  gs.log('hello');",
  "})(current, previous);]]]]><![CDATA[></script>",
  "<sys_id>0123456789abcdef0123456789abcdef</sys_id>",
  "</sys_script></record_update>]]></payload>",
  "<type>Business Rule</type>",
  "</sys_update_xml>",
  "</unload>",
  "",
].join("\n");
