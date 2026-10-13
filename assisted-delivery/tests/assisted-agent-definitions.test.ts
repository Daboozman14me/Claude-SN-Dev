import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const AGENTS_DIRECTORY = join(homedir(), ".claude", "agents");

const SPECIALIST_TOOLS = "tools: Read, Glob, Grep, Bash, Write";
const SUPERVISOR_TOOLS = "tools: Read, Glob, Grep, Bash, Agent";

function readAgent(name: string): string {
  return readFileSync(join(AGENTS_DIRECTORY, `${name}.md`), "utf8");
}

const EXPECTED_AGENTS = [
  "assisted-delivery-research",
  "assisted-delivery-solution-advisor",
  "assisted-delivery-technical-design",
  "assisted-delivery-story-drafter",
  "assisted-delivery-test-design",
  "assisted-delivery-requirements-extractor",
  "assisted-delivery-level-of-effort",
  "assisted-delivery-supervisor",
];

test("every assisted-delivery agent is present and readable", () => {
  for (const name of EXPECTED_AGENTS) {
    assert.doesNotThrow(
      () => readAgent(name),
      `Expected readable agent definition for '${name}'.`,
    );
  }
});

test("specialists hold no Agent tool and the supervisor holds no Write tool", () => {
  for (const name of EXPECTED_AGENTS) {
    const agent = readAgent(name);
    if (name === "assisted-delivery-supervisor") {
      assert.match(agent, new RegExp(SUPERVISOR_TOOLS.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      assert.doesNotMatch(agent, /^tools:.*\bWrite\b/m);
      assert.doesNotMatch(agent, /^skills:/m);
    } else {
      assert.match(agent, new RegExp(SPECIALIST_TOOLS.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      assert.doesNotMatch(agent, /^tools:.*\bAgent\b/m);
    }
  }
});

test("only the research agent carries ServiceNow SDK skills", () => {
  const research = readAgent("assisted-delivery-research");
  assert.match(research, /^skills: application-audit, servicenow-sdk:now-sdk$/m);

  for (const name of EXPECTED_AGENTS) {
    if (name === "assisted-delivery-research") continue;
    assert.doesNotMatch(readAgent(name), /^skills:/m);
  }
});

test("supervisor routes the complete assisted workflow", () => {
  const agent = readAgent("assisted-delivery-supervisor");
  assert.match(agent, /assisted-delivery-research/);
  assert.match(agent, /assisted-delivery-solution-advisor/);
  assert.match(agent, /assisted-delivery-technical-design/);
  assert.match(agent, /assisted-delivery-story-drafter/);
  assert.match(agent, /assisted-delivery-test-design/);
  assert.match(agent, /assisted-delivery-requirements-extractor/);
  assert.match(agent, /assisted-delivery-level-of-effort/);
  assert.match(agent, /never require them to run\s+npm/i);
  assert.match(agent, /external systems/i);
  assert.match(agent, /designConstraints/);
  assert.match(agent, /Authentication and protocol terms are never application targets/);
  assert.match(agent, /two distinct deliverables/);
  assert.match(agent, /Never mix\s+proposed design into the current-state report/);
  assert.match(agent, /No specialist may edit repository source/);
});

test("test design creates traceable batch plans without execution", () => {
  const agent = readAgent("assisted-delivery-test-design");
  assert.match(agent, /readable Story draft in HTML or Markdown/);
  assert.match(agent, /must be sufficient/);
  assert.match(agent, /source=acceptance_criteria/);
  assert.match(agent, /source=inferred/);
  assert.match(agent, /coverageGap/);
  assert.match(agent, /Every Story and every criterion/);
  assert.match(agent, /internal\\test-plan-vNNN\.json/);
  assert.match(agent, /writes of any kind to ServiceNow,\s+VersionOne\/Jira\/ServiceNow Agile/);
});

test("technical design supports creation and advisory evaluation", () => {
  const agent = readAgent("assisted-delivery-technical-design");
  assert.match(agent, /\*\*Design mode\*\*/);
  assert.match(agent, /\*\*Evaluation mode\*\*/);
  assert.match(agent, /TechnicalDesignPackage/);
  assert.match(agent, /current-state application research/);
  assert.match(agent, /Never ingest its raw evidence directory/);
  assert.match(agent, /least privilege/);
  assert.match(agent, /idempotency/);
  assert.match(agent, /logging, metrics, alerting/);
  assert.match(agent, /migration\/backfill/);
  assert.match(agent, /never authorize implementation/i);
  assert.match(agent, /Write only the allocated Markdown and JSON artifacts/);
});

test("research is comprehensive and isolates raw evidence", () => {
  const agent = readAgent("assisted-delivery-research");
  assert.match(agent, /read-only/i);
  assert.match(agent, /evidence\\application-research-vNNN/);
  assert.match(agent, /embed complete query responses/);
  assert.match(agent, /current-state research limitations/);
  assert.match(agent, /Do not search for internal artifacts named after an external system/);
  assert.match(agent, /Do not enumerate instance-wide OAuth registries/);
  assert.match(agent, /`application` or\s+`direct_dependency`/);
  assert.match(agent, /Preserve every returned record individually in `inventory`/);
  assert.match(agent, /authoritative ServiceNow\s+`sys_id`/);
  assert.match(agent, /inspect every\s+script\/configuration/);
  assert.match(agent, /Complete Application Inventory/);
  assert.match(agent, /inventory-record:<record-id>/);
  assert.match(agent, /ASSISTED_APPLICATION_ARTIFACT_QUERIES/);
  assert.match(agent, /Capture confirmed and derived relationships/);
  assert.match(agent, /one authoritative, high-quality/);
  assert.match(agent, /Do not include target-state architecture/);
  assert.match(agent, /Never edit toolkit source/);
});

test("advisor consumes structured research without transcript ingestion", () => {
  const agent = readAgent("assisted-delivery-solution-advisor");
  assert.match(agent, /final structured\s+JSON/);
  assert.match(agent, /evidence\s+directory or raw query transcripts/);
  assert.match(agent, /open questions/);
  assert.match(agent, /requirements or\s+constraints, never as applications to research/);
  assert.match(agent, /never placeholders/);
  assert.match(agent, /never a review of the\s+existing implementation/);
  assert.match(agent, /Solution Recommendation Report/);
  assert.match(agent, /full as-is architecture belongs solely to the\s+separate Architecture Research Report/);
  assert.match(agent, /brief implementation review or\s+findings summary does not satisfy/);
  assert.match(agent, /Write only the allocated HTML and JSON artifacts/);
});

test("story drafter requires authoritative citations and protects source", () => {
  const agent = readAgent("assisted-delivery-story-drafter");
  assert.match(agent, /authoritative document/);
  assert.match(agent, /acceptance criterion/i);
  assert.match(agent, /Given\/When\/Then/);
  assert.match(agent, /Never use the literal placeholder tokens/);
  assert.match(agent, /Information to confirm/);
  assert.match(agent, /Perform no backlog writes of any kind \(VersionOne/);
  assert.match(agent, /Write only the allocated HTML and JSON artifacts/);
});

test("requirements extractor judges meaning over keywords and grounds every requirement", () => {
  const agent = readAgent("assisted-delivery-requirements-extractor");
  assert.match(agent, /not pattern-match only on modal verbs/);
  assert.match(agent, /boilerplate/i);
  assert.match(agent, /splitGroupId/);
  assert.match(agent, /verbatimText/);
  assert.match(agent, /priorityBasis: "stated"/);
  assert.match(agent, /priorityBasis: "inferred"/);
  assert.match(agent, /priority: "unspecified"/);
  assert.match(agent, /isAmbiguous/);
  assert.match(agent, /ambiguityNote/);
  assert.match(agent, /Requirements Register/);
  assert.match(agent, /no automatic\s+cross-document merge or conflict detection/);
  assert.match(agent, /Write only the allocated HTML and JSON artifacts/);
});

test("level-of-effort scoper never guesses a decision and never writes the original workbook", () => {
  const agent = readAgent("assisted-delivery-level-of-effort");
  assert.match(agent, /Requirements\s+Register JSON path/);
  assert.match(
    agent,
    /Only\s+emit\s+a\s+decision\s+for\s+a\s+feature\s+row\s+when\s+there\s+is\s+a\s+citable\s+basis\s+in\s+the\s+Requirements\s+Register/,
  );
  assert.match(agent, /no\s+decisions at all/);
  assert.match(agent, /Never fill a confident\s+"No"/);
  assert.match(agent, /cache\\loe-workbook\\baseline/);
  assert.match(agent, /one question\s+at a time/);
  assert.match(agent, /Never write to, rename, or otherwise modify the user's original `\.xlsm`/);
  assert.match(agent, /summary\/section-header row/);
  assert.match(agent, /Never emit a scoping decision without at least one citation/);
  assert.match(agent, /Write only the allocated HTML, JSON, and \(optional\) filled-copy/);
  assert.match(agent, /##\s+Derived\s+scope\s+—\s+architecting\s+beyond\s+the\s+literal\s+citation/);
  assert.match(agent, /Technical\s+necessity/);
  assert.match(agent, /Standard\s+bundling/);
  assert.match(agent, /derivationRationale/);
  assert.match(agent, /Disclosed\s+benchmark/);
  assert.match(agent, /benchmarkRationale/);
  assert.match(
    agent,
    /exclusions\s+are\s+always\s+stated,\s+never\s+derived/,
  );
});
