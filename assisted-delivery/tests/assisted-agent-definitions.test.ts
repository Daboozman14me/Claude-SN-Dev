import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const AGENTS_DIRECTORY = join(homedir(), ".claude", "agents");

const SPECIALIST_TOOLS = "tools: Read, Glob, Grep, Bash, Write";
const SUPERVISOR_TOOLS = "tools: Read, Glob, Grep, Bash, Agent";

// Disabled agents are renamed to .md.disabled so Claude Code does not register them.
const DISABLED_AGENTS = new Set(["assisted-delivery-level-of-effort"]);

function agentPath(name: string): string {
  const suffix = DISABLED_AGENTS.has(name) ? ".md.disabled" : ".md";
  return join(AGENTS_DIRECTORY, `${name}${suffix}`);
}

function readAgent(name: string): string {
  return readFileSync(agentPath(name), "utf8");
}

const EXPECTED_AGENTS = [
  "assisted-delivery-research",
  "assisted-delivery-solution-advisor",
  "assisted-delivery-technical-design",
  "assisted-delivery-story-drafter",
  "assisted-delivery-test-design",
  "assisted-delivery-requirements-extractor",
  "assisted-delivery-level-of-effort",
  "assisted-delivery-scaffolding",
  "assisted-delivery-code-review",
  "assisted-delivery-code-writer",
  "assisted-delivery-supervisor",
];

test("every assisted-delivery agent is present and readable", () => {
  for (const name of EXPECTED_AGENTS) {
    assert.doesNotThrow(
      () => readAgent(name),
      `Expected readable agent definition for '${name}'.`,
    );
    if (DISABLED_AGENTS.has(name)) {
      assert.equal(
        existsSync(join(AGENTS_DIRECTORY, `${name}.md`)),
        false,
        `Disabled agent '${name}' must not also exist as an active .md file.`,
      );
    }
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

test("only research, code review, and code writer carry ServiceNow SDK skills", () => {
  const research = readAgent("assisted-delivery-research");
  assert.match(research, /^skills: application-audit, servicenow-sdk:now-sdk$/m);
  const sdkOnly = ["assisted-delivery-code-review", "assisted-delivery-code-writer"];
  for (const name of sdkOnly) {
    assert.match(readAgent(name), /^skills: servicenow-sdk:now-sdk$/m);
  }

  for (const name of EXPECTED_AGENTS) {
    if (name === "assisted-delivery-research" || sdkOnly.includes(name)) continue;
    assert.doesNotMatch(readAgent(name), /^skills:/m);
  }
});

test("code writer stays inside its project, never deploys or commits, and applies only approved fixes", () => {
  const agent = readAgent("assisted-delivery-code-writer");
  assert.match(agent, /^permissionMode: bypassPermissions$/m);
  assert.match(agent, /codeImplementationPackageSchema/);
  assert.match(agent, /snapshot-fluent-project\.ts/);
  assert.match(agent, /apply-code-review-fixes\.ts" "<code-review\.json>" --dry-run/);
  assert.match(agent, /validate-assisted-code-implementation\.ts" "<absolute-json-path>" --verify-changes/);
  assert.match(agent, /--base code-implementation --extension html --extension json/);
  assert.match(agent, /git -C "<project>" status --porcelain/);
  assert.match(agent, /Write only inside the target project folder and the allocated HTML and\s+JSON artifacts/);
  assert.match(agent, /Never deploy: never run `now-sdk install`, `npm run deploy`/);
  assert.match(agent, /Never run git commands that change state/);
  assert.match(agent, /Never apply a finding that is not approved/);
  assert.match(agent, /\*\*Never apply a fix by hand\*\*/);
  assert.match(agent, /\*\*Never delete or rename an existing definition or its `\$id` key\*\*/);
  assert.match(agent, /never invent,\s+copy, or reuse a sys_id/);
  assert.match(agent, /never request or accept a password/);
  assert.match(agent, /Stop after three consecutive failing\s+builds/);
  assert.match(agent, /Output composition — avoid the per-turn output cap/);
});

test("code writer works from a confirmed work order in the output form the human chose", () => {
  const agent = readAgent("assisted-delivery-code-writer");
  for (const form of ["`fluent`", "`copy_paste`", "`background_script`", "`fix_script`"]) {
    assert.match(agent, new RegExp(form), `writer missing output form ${form}`);
  }
  assert.match(agent, /Never assume any part of it — not even that the app is\s+Fluent/);
  assert.match(agent, /## Research the current state first \(read-only\)/);
  assert.match(agent, /\*\*stop and ask\*\*\s+which is authoritative/);
  assert.match(agent, /\*\*`knownDifferences`\*\*/);
  assert.match(agent, /`undeployed_commits`: the project is ahead of the instance/);
  assert.match(agent, /snapshot-fluent-project\.ts" "<project-folder>" --into "<absolute-json-path>"/);
  assert.match(agent, /never\s+stage tool output in a scratch or temp file/);
  assert.match(agent, /print-contract-schema\.ts" code_implementation/);
  assert.match(agent, /render-report-html\.ts" "<absolute-json-path>"/);
  assert.match(agent, /\*\*Write only the JSON; never hand-write the HTML\.\*\*/);
  assert.match(agent, /\*\*Fix mode with Fluent output\*\*: skip the topic reading/);
  assert.match(agent, /`now-sdk\s+exec` \(it runs scripts on the instance\)/);
  assert.match(agent, /templates\/github-actions\/deploy-servicenow\.yml/);
  assert.match(agent, /freshly cloned empty repo holding only `\.git`/);
  assert.match(agent, /`runStatus: stopped`/);
  assert.match(agent, /\*\*Never run, paste, or execute a generated script against an instance\*\*/);
  assert.match(agent, /var DRY_RUN = true;/);
  assert.match(agent, /Run order: 1/);
  assert.match(agent, /gs\.info\('\[D-01\] …'\)/);
  assert.match(agent, /never `get\('<sys_id>'\)`/);
  assert.match(agent, /\*\*safe to re-run\*\*/);
  assert.match(agent, /matching \*\*undo\*\* script \(`rollback_script` with `rollbackFor`\)/);
  assert.match(agent, /`README\.md` \(required when there is more than one script\)/);
  assert.match(agent, /code-implementation-vNNN-scripts\//);
  assert.match(agent, /<!-- deliverable:D-NN -->/);
  assert.match(agent, /<!-- paste:D-NN -->/);
  assert.match(agent, /\*\*full\s+current\s+code\s+beside\s+the\s+full\s+new\s+code\*\*/);
  assert.match(agent, /`skipped_out_of_scope`/);
  assert.match(agent, /Record\s+for rollback/);
});

test("code writer and code reviewer hold code to the same ServiceNow practices", () => {
  const writer = readAgent("assisted-delivery-code-writer");
  const reviewer = readAgent("assisted-delivery-code-review");
  const shared = [
    /current\.update\(\)/,
    /setLimit/,
    /GlideAggregate/,
    /gs\.log/,
    /eval/,
    /getValue/,
    /hard-coded sys_ids/i,
    /GlideAjax/,
    /isLoading/,
    /ref_qual_elements/,
    /role \*\*names\*\*|role names/i,
    /installMethod: 'demo'/,
  ];
  for (const practice of shared) {
    assert.match(writer, practice, `writer missing ${practice}`);
    assert.match(reviewer, practice, `reviewer missing ${practice}`);
  }
});

test("code reviewer stays read-only and leaves every decision to a human", () => {
  const agent = readAgent("assisted-delivery-code-review");
  assert.match(agent, /^permissionMode: bypassPermissions$/m);
  assert.match(agent, /codeReviewPackageSchema/);
  assert.match(agent, /index-code-review-sources\.ts/);
  assert.match(agent, /validate-assisted-code-review\.ts" "<absolute-json-path>" --fresh/);
  assert.match(agent, /--base code-review --extension html --extension json/);
  assert.match(agent, /ServiceNow's published guidance/);
  assert.match(agent, /Write only the allocated HTML and JSON artifacts/);
  assert.match(agent, /Never edit, reformat, move, or delete any reviewed file/);
  assert.match(agent, /Never record, change, or infer approval decisions/);
  assert.match(agent, /Perform no ServiceNow writes, installs, deployments, or credential\s+changes/);
  assert.match(agent, /never construct raw REST calls/);
  assert.match(agent, /Never request or accept\s+a password/);
  assert.match(agent, /copied \*\*verbatim\*\*/);
  assert.match(agent, /## Post-implementation review mode/);
  assert.match(agent, /index-code-review-sources\.ts" .*--into "<absolute-json-path>"/);
  assert.match(agent, /Never stage indexer output in a scratch or temp file/);
  assert.match(agent, /print-contract-schema\.ts" code_review/);
  assert.match(agent, /render-report-html\.ts" "<absolute-json-path>"/);
  assert.match(agent, /runs scripts \(`now-sdk exec`\)/);
  assert.match(agent, /compose-completion-report\.ts" "<code-implementation\.json>" "<code-review\.json>"/);
  assert.match(agent, /validate-assisted-completion-report\.ts" "<completion-report\.json>" --fresh/);
  assert.match(agent, /never write or edit those files yourself/);
  assert.match(agent, /<!-- finding:F-NNN -->/);
  assert.match(agent, /Output composition — avoid the per-turn output cap/);
  for (const section of ["Summary", "Scope and Sources", "Findings", "Instance Checks", "Limitations"]) {
    assert.match(agent, new RegExp("`" + section + "`"));
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
  assert.match(agent, /assisted-delivery-scaffolding/);
  assert.match(agent, /assisted-delivery-code-review/);
  assert.match(agent, /assisted-delivery-code-writer/);
  assert.match(agent, /ten specialists above/);
  assert.match(agent, /never records approve,\s+reject, or defer decisions/);
  assert.match(agent, /may\s+make read-only SDK queries solely to verify facts/);
  assert.match(agent, /no specialist ever commits, pushes, or deploys/);
  assert.match(agent, /`assisted-delivery-code-writer` may edit source only\s+inside the project folder the user names/);
  assert.match(agent, /Never send a review whose findings are all still pending/);
  assert.match(agent, /only\s+after \*\*intake\*\*/);
  assert.match(agent, /never assume an answer\s+\(not even that the app is Fluent\)/);
  assert.match(agent, /\*\*Output form\*\* — ask even for Fluent apps/);
  assert.match(agent, /\*\*Read back the work order\*\*/);
  assert.match(agent, /return the open questions to the caller instead of delegating/);
  assert.match(agent, /\*\*stopped\*\* report, relay its questions/);
  assert.match(agent, /\*\*immediately\*\* delegate\s+`assisted-delivery-code-review` in post-implementation mode/);
  assert.match(agent, /\*\*Completion Report\*\*/);
  assert.match(agent, /\*\*undeployed commits since `<commit>`\*\*/);
  assert.match(agent, /\*\*Deploying is never done by a specialist\.\*\*/);
  assert.match(agent, /\*\*ask the user whether the change is\s+major or minor\*\*/);
  assert.match(agent, /\*\*confirm the target\s+instance with them\*\* — never assume the currently connected or default\s+alias/);
  assert.match(agent, /delegate `assisted-delivery-scaffolding`\s+to register it and generate the repo-creation request/);
  assert.match(agent, /never require them to run\s+npm/i);
  assert.match(agent, /external systems/i);
  assert.match(agent, /designConstraints/);
  assert.match(agent, /Authentication and protocol terms are never application targets/);
  assert.match(agent, /two distinct deliverables/);
  assert.match(agent, /Never mix\s+proposed design into the current-state report/);
  assert.match(agent, /No specialist may edit repository source/);
});

test("scaffolding agent keeps the personal registry out-of-tree and requires explicit provisioning approval", () => {
  const agent = readAgent("assisted-delivery-scaffolding");
  assert.match(agent, /assisted-delivery-programs\.json/);
  assert.match(agent, /personal registry/i);
  assert.match(agent, /manifest\.json/);
  assert.match(agent, /this-conversation approval/i);
  assert.match(agent, /monorepo exception/i);
  assert.match(agent, /Never create a GitHub org/);
  assert.match(agent, /Never write the personal registry anywhere inside a tracked\/junctioned/);
  assert.match(agent, /Perform no ServiceNow instance reads or writes/);
  assert.match(agent, /\*\*generate the complete request\*\*/);
  assert.match(agent, /\*\*Leave it completely empty\*\*/);
  assert.match(agent, /never ask for or handle\s+the values/);
});

test("test design creates traceable batch plans without execution", () => {
  const agent = readAgent("assisted-delivery-test-design");
  assert.match(agent, /readable Story draft in HTML or Markdown/);
  assert.match(agent, /must be sufficient/);
  assert.match(agent, /source=acceptance_criteria/);
  assert.match(agent, /source=inferred/);
  assert.match(agent, /coverageGap/);
  assert.match(agent, /Every Story and every criterion/);
  assert.match(agent, /internal[\\/]test-plan-vNNN\.json/);
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
  assert.match(agent, /evidence[\\/]application-research-vNNN/);
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
  assert.match(agent, /## Design first \(a hard gate\)/);
  assert.match(agent, /"kind": "technical_design"/);
  assert.match(agent, /"kind": "not_required", "changeSize": "minor"/);
  assert.match(agent, /say that a technical design is needed first and stop/);
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
  assert.match(agent, /cache[\\/]loe-workbook[\\/]baseline/);
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
