import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import {
  ASSISTED_CONTRACT_VERSION,
  codeImplementationPackageSchema,
} from "../src/assisted-contracts.js";
import { classicWorkOrder, currentState, scriptDeliverables, workOrder } from "./code-writer-fixtures.js";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const root = "C:\\projects\\new-app";
const reports = "C:\\artifacts\\code-implementation";
const scripts = join(reports, "code-implementation-v001-scripts");

function base() {
  return {
    contractVersion: ASSISTED_CONTRACT_VERSION,
    packageType: "code_implementation",
    packageId: "code-implementation-fixture",
    title: "Code Implementation: fixture",
    summary: "Fixture run.",
    artifacts: {
      html: join(reports, "code-implementation-v001.html"),
      json: join(reports, "code-implementation-v001.json"),
    },
    runStatus: "completed",
    questions: [],
    requestedStoryIds: [],
    storyCoverage: [],
    fixResults: [],
    changes: [],
    deliverables: [],
    instanceChecks: [],
    assumptions: [],
    limitations: [],
    warnings: [],
  };
}

function fluentBuild() {
  return {
    ...base(),
    mode: "build",
    outputForm: "fluent",
    workOrder: workOrder({ appLocation: { kind: "local_project", path: root } }),
    currentState: currentState({ parity: "not_checked" }),
    project: { root, scope: "x_2054821_ncrb", appName: "New App", created: true },
    inputs: {
      storyPackage: { path: "C:\\artifacts\\stories\\story-draft-v001.json" },
      technicalDesignPackage: { path: "C:\\artifacts\\design\\technical-design-v001.json" },
    },
    requestedStoryIds: ["ST-0.1"],
    baseline: { capturedAt: "2026-11-07T18:00:00.000Z", files: [] },
    changes: [
      {
        path: join(root, "src", "fluent", "tables", "reservation.now.ts"),
        action: "created",
        sha256After: HASH_A,
        implements: [
          { kind: "story", id: "ST-0.1" },
          { kind: "design_decision", id: "TD-03" },
        ],
        summary: "Reservation table with the No-show state.",
      },
    ],
    storyCoverage: [{ storyId: "ST-0.1", status: "implemented", note: "All acceptance criteria covered." }],
    build: { command: "npm run build", status: "passed", errorCount: 0, warningCount: 1 },
  };
}

function fluentFix() {
  const file = join(root, "src", "fluent", "acl.now.ts");
  return {
    ...base(),
    mode: "fix",
    outputForm: "fluent",
    workOrder: workOrder({
      appLocation: { kind: "local_project", path: root },
      changeSource: { kind: "findings", description: "Approved findings from code-review-v001." },
    }),
    currentState: currentState(),
    project: { root, scope: "x_2054821_ncrb", appName: "New App", created: false },
    inputs: { codeReview: { path: "C:\\artifacts\\review\\code-review-v001.json" } },
    baseline: { capturedAt: "2026-11-07T18:00:00.000Z", files: [{ path: file, sha256: HASH_A }] },
    changes: [
      {
        path: file,
        action: "modified",
        sha256After: HASH_B,
        implements: [{ kind: "finding", id: "F-002" }],
        summary: "Requester write limited to pending reservations.",
      },
    ],
    fixResults: [
      { findingId: "F-002", outcome: "applied", detail: "Replaced lines 3-11." },
      { findingId: "F-019", outcome: "skipped_no_change", detail: "Finding proposes no code change." },
    ],
    build: { command: "npm run build", status: "passed", errorCount: 0, warningCount: 0 },
  };
}

function backgroundFix(count = 2) {
  return {
    ...base(),
    mode: "fix",
    outputForm: "background_script",
    workOrder: classicWorkOrder("findings"),
    currentState: currentState({
      method: "instance_query",
      checks: [{ table: "sys_script", name: "Reservation - Set Defaults", status: "matches", detail: "Script matches the review." }],
    }),
    inputs: { codeReview: { path: "C:\\artifacts\\review\\code-review-v001.json" } },
    deliverables: scriptDeliverables(scripts, "background_script", count),
    fixResults: Array.from({ length: count }, (_, index) => ({
      findingId: `F-${String(index + 1).padStart(3, "0")}`,
      outcome: "applied",
      detail: "Generated as a background script.",
    })),
  };
}

function copyPasteRequest() {
  return {
    ...base(),
    mode: "build",
    outputForm: "copy_paste",
    workOrder: classicWorkOrder("request"),
    currentState: currentState({ method: "instance_query" }),
    inputs: {},
    deliverables: [
      {
        id: "D-01",
        kind: "paste_instructions",
        applicationScope: "x_2054821_confer_0",
        paste: { navigation: "System Definition > Dictionary", record: "New", fields: [{ field: "column_label", newValue: "Building" }] },
        title: "Add Building field to Room",
        targets: [{ table: "sys_dictionary", name: "x_2054821_confer_0_room.building" }],
        implements: [{ kind: "request", id: "request" }],
      },
    ],
  };
}

test("implementation contract accepts every output form", () => {
  for (const [label, make] of [
    ["fluent build", fluentBuild],
    ["fluent fix", fluentFix],
    ["background-script fix", () => backgroundFix()],
    ["single fix script", () => ({ ...backgroundFix(1), outputForm: "fix_script", deliverables: scriptDeliverables(scripts, "fix_script", 1) })],
    ["copy/paste request", copyPasteRequest],
  ] as const) {
    assert.doesNotThrow(() => codeImplementationPackageSchema.parse(make()), label);
  }
});

function withKnownDifference(value: any) {
  value.workOrder.knownDifferences = [
    { id: "KD-01", table: "sys_security_acl", records: "Reservation ACLs", reason: "Roles re-added by hand after transform." },
  ];
  value.currentState = currentState({
    parity: "known_differences",
    checks: [
      {
        table: "sys_security_acl",
        name: "x_2054821_confer_0_reservation (write)",
        status: "differs",
        detail: "Local ACL carries roles; the instance record has none.",
        knownDifference: "KD-01",
      },
    ],
  });
  return value;
}

function withUndeployedCommits(value: any) {
  value.workOrder.knownDifferences = [
    {
      id: "KD-01",
      kind: "undeployed_commits",
      sinceCommit: "b1d67a5",
      records: "Every record changed by commits since the last deploy",
      reason: "Earlier fixes are committed locally but not deployed.",
    },
  ];
  value.currentState = currentState({
    parity: "known_differences",
    checks: [
      {
        table: "sys_script",
        name: "Reservation - Set Defaults",
        status: "differs",
        detail: "Instance has the pre-fix script.",
        knownDifference: "KD-01",
        path: join(root, "src", "fluent", "rule.server.js"),
      },
    ],
  });
  return value;
}

test("confirmed known differences let a run proceed", () => {
  assert.doesNotThrow(() => codeImplementationPackageSchema.parse(withKnownDifference(fluentFix())));
  assert.doesNotThrow(() => codeImplementationPackageSchema.parse(withUndeployedCommits(fluentFix())));
});

test("a stopped run records questions and needs no output", () => {
  const stopped = {
    ...backgroundFix(),
    runStatus: "stopped",
    questions: ["The live business rule differs from the reviewed code. Re-review first?"],
    currentState: currentState({ method: "instance_query", parity: "differs" }),
    deliverables: [],
    fixResults: [],
  };
  assert.doesNotThrow(() => codeImplementationPackageSchema.parse(stopped));
  assert.throws(() => codeImplementationPackageSchema.parse({ ...stopped, questions: [] }), /must record the questions/);
});

test("implementation contract rejects unconfirmed, untraceable or unsafe work", () => {
  const cases: Array<[string, () => any, (value: any) => void, RegExp]> = [
    // work order
    ["parity differs but completed", fluentFix, (v) => (v.currentState.parity = "differs"), /must stop and ask/],
    ["classic app given fluent output", fluentFix, (v) => (v.workOrder.appForm = "classic"), /classic application cannot receive Fluent output/],
    ["fix mode from a request", fluentFix, (v) => (v.workOrder.changeSource.kind = "request"), /Fix mode works from findings/],
    ["git repo without url", fluentFix, (v) => (v.workOrder.appLocation = { kind: "git_repo" }), /must give repoUrl/],
    ["local project without path", fluentFix, (v) => (v.workOrder.appLocation = { kind: "local_project" }), /must give path/],
    ["scope mismatch", fluentFix, (v) => (v.workOrder.target.scope = "x_2054821_other"), /does not match the confirmed work order/],
    // known differences
    ["unexplained difference", fluentFix, (v) => withKnownDifference(v).currentState.checks[0].knownDifference = undefined, /differ without a confirmed known difference/],
    ["unknown difference id", fluentFix, (v) => (withKnownDifference(v).currentState.checks[0].knownDifference = "KD-09"), /unknown known difference 'KD-09'/],
    ["difference on another table", fluentFix, (v) => (withKnownDifference(v).currentState.checks[0].table = "sys_script"), /covers table 'sys_security_acl', not 'sys_script'/],
    ["known difference called matches", fluentFix, (v) => (withKnownDifference(v).currentState.parity = "matches"), /need parity 'known_differences'/],
    ["matching check cites a difference", fluentFix, (v) => (withKnownDifference(v).currentState.checks[0].status = "matches"), /needs no known difference/],
    ["records difference without table", fluentFix, (v) => delete withKnownDifference(v).workOrder.knownDifferences[0].table, /must name its table/],
    ["undeployed commits without commit", fluentFix, (v) => delete withUndeployedCommits(v).workOrder.knownDifferences[0].sinceCommit, /must give the commit the instance was last deployed from/],
    ["undeployed commits check without file", fluentFix, (v) => delete withUndeployedCommits(v).currentState.checks[0].path, /must give the project file that holds the record/],
    ["undeployed commits on a classic app", fluentFix, (v) => {
      withUndeployedCommits(v);
      v.workOrder.appLocation = { kind: "instance", instanceAlias: "dev292961" };
    }, /apply only to a Fluent project held in git/],
    // fluent
    ["fluent without build", fluentBuild, (v) => delete v.build, /requires project, baseline, and build/],
    ["build without design", fluentBuild, (v) => delete v.inputs.technicalDesignPackage, /requires both a storyPackage and a technicalDesignPackage/],
    ["uncovered story", fluentBuild, (v) => v.requestedStoryIds.push("ST-0.2"), /'ST-0.2' has no storyCoverage entry/],
    ["change outside project", fluentBuild, (v) => (v.changes[0].path = "C:\\Windows\\evil.js"), /outside the project root/],
    ["created file existed", fluentBuild, (v) => {
      v.project.created = false;
      v.baseline.files = [{ path: v.changes[0].path, sha256: HASH_A }];
    }, /already existed in the baseline/],
    ["passed build with errors", fluentBuild, (v) => (v.build.errorCount = 2), /passed build cannot report errors/],
    ["build implements finding", fluentBuild, (v) => v.changes[0].implements.push({ kind: "finding", id: "F-001" }), /not findings/],
    ["fix implements story", fluentFix, (v) => v.changes[0].implements.push({ kind: "story", id: "ST-1" }), /approved findings only/],
    ["applied without change", fluentFix, (v) => v.fixResults.push({ findingId: "F-003", outcome: "applied", detail: "x" }), /'F-003' is marked applied but no change implements it/],
    ["delete fluent definition", fluentFix, (v) => {
      v.changes[0].action = "deleted";
      delete v.changes[0].sha256After;
    }, /Deleting Fluent definition/],
    // scripts
    ["scripts with a project", backgroundFix, (v) => (v.project = { root, scope: "x_2054821_confer_0", appName: "x", created: false }), /Fluent-only/],
    ["missing rollback", backgroundFix, (v) => (v.deliverables = v.deliverables.filter((d: any) => d.id !== "D-02")), /'D-01' has no rollback script/],
    ["rollback for unknown script", backgroundFix, (v) => (v.deliverables.find((d: any) => d.id === "D-02").rollbackFor = "D-99"), /undoes unknown script 'D-99'/],
    ["many scripts without readme", backgroundFix, (v) => (v.deliverables = v.deliverables.filter((d: any) => d.kind !== "readme")), /requires a readme/],
    ["script without scope", backgroundFix, (v) => delete v.deliverables[0].applicationScope, /must name the application scope/],
    ["script without order", backgroundFix, (v) => delete v.deliverables[0].order, /must give its run order/],
    ["duplicate order", backgroundFix, (v) => (v.deliverables[2].order = 1), /Run order 1 is used by more than one script/],
    ["script without file", backgroundFix, (v) => delete v.deliverables[0].path, /must give its file path and sha256/],
    ["fix script in background run", backgroundFix, (v) => (v.deliverables[0].kind = "fix_script"), /cannot contain a 'fix_script' deliverable/],
    ["untraceable script", backgroundFix, (v) => (v.deliverables[0].implements = []), /must cite what it implements/],
    ["script with no targets", backgroundFix, (v) => (v.deliverables[0].targets = []), /must name the records it changes/],
    ["completed with no output", copyPasteRequest, (v) => (v.deliverables = []), /must produce at least one deliverable/],
    ["request output cites finding", copyPasteRequest, (v) => (v.deliverables[0].implements = [{ kind: "finding", id: "F-001" }]), /not findings/],
  ];
  for (const [label, make, mutate, expected] of cases) {
    const value = structuredClone(make());
    mutate(value);
    assert.throws(() => codeImplementationPackageSchema.parse(value), expected, `case '${label}' should be rejected`);
  }
});
