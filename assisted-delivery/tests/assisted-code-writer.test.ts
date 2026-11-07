import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import {
  ASSISTED_CONTRACT_VERSION,
  codeImplementationPackageSchema,
} from "../src/assisted-contracts.js";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const root = "C:\\projects\\new-app";
const reports = "C:\\artifacts\\code-implementation";

export function buildPackage() {
  return {
    contractVersion: ASSISTED_CONTRACT_VERSION,
    packageType: "code_implementation",
    packageId: "code-implementation-build-fixture",
    title: "Code Implementation: New App — EPIC-0",
    summary: "Created the project and implemented ST-0.1.",
    artifacts: {
      html: join(reports, "code-implementation-v001.html"),
      json: join(reports, "code-implementation-v001.json"),
    },
    mode: "build",
    project: { root, scope: "x_2054821_ncrb", appName: "New App", created: true },
    inputs: {
      storyPackage: { path: "C:\\artifacts\\stories\\story-draft-v001.json", packageId: "stories" },
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
    fixResults: [],
    build: { command: "npm run build", status: "passed", errorCount: 0, warningCount: 1 },
    instanceChecks: [],
    assumptions: [],
    limitations: [],
    warnings: [],
  };
}

export function fixPackage() {
  const file = join(root, "src", "fluent", "acl.now.ts");
  return {
    ...buildPackage(),
    packageId: "code-implementation-fix-fixture",
    title: "Code Implementation: New App — approved review fixes",
    mode: "fix",
    project: { root, scope: "x_2054821_ncrb", appName: "New App", created: false },
    inputs: { codeReview: { path: "C:\\artifacts\\review\\code-review-v001.json" } },
    requestedStoryIds: [],
    storyCoverage: [],
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
  };
}

test("implementation contract accepts build and fix packages", () => {
  assert.equal(codeImplementationPackageSchema.parse(buildPackage()).mode, "build");
  assert.equal(codeImplementationPackageSchema.parse(fixPackage()).mode, "fix");
});

test("implementation contract rejects untraceable or unsafe changes", () => {
  const cases: Array<[string, () => any, (value: any) => void, RegExp]> = [
    ["build without design", buildPackage, (v) => delete v.inputs.technicalDesignPackage, /requires both a storyPackage and a technicalDesignPackage/],
    ["build without stories requested", buildPackage, (v) => ((v.requestedStoryIds = []), (v.storyCoverage = [])), /at least one requested story id/],
    ["uncovered story", buildPackage, (v) => v.requestedStoryIds.push("ST-0.2"), /'ST-0.2' has no storyCoverage entry/],
    ["change outside project", buildPackage, (v) => (v.changes[0].path = "C:\\Windows\\evil.js"), /outside the project root/],
    ["change is the root itself", buildPackage, (v) => (v.changes[0].path = root), /outside the project root/],
    ["no traceability", buildPackage, (v) => (v.changes[0].implements = []), /too_small|at least 1|>=1/i],
    ["created file existed", buildPackage, (v) => {
      v.project.created = false;
      v.baseline.files = [{ path: v.changes[0].path, sha256: HASH_A }];
    }, /already existed in the baseline/],
    ["modified file not in baseline", buildPackage, (v) => (v.changes[0].action = "modified"), /was not in the baseline/],
    ["created project with files", buildPackage, (v) => (v.baseline.files = [{ path: join(root, "a.js"), sha256: HASH_A }]), /must start from an empty baseline/],
    ["passed build with errors", buildPackage, (v) => (v.build.errorCount = 2), /passed build cannot report errors/],
    ["missing hash", buildPackage, (v) => delete v.changes[0].sha256After, /must record sha256After/],
    ["build implements finding", buildPackage, (v) => v.changes[0].implements.push({ kind: "finding", id: "F-001" }), /not findings/],
    ["bad scope", buildPackage, (v) => (v.project.scope = "x_this_scope_is_far_too_long"), /Too big|<=18|18/],
    ["fix without review", fixPackage, (v) => delete v.inputs.codeReview, /requires a codeReview input/],
    ["fix creating project", fixPackage, (v) => (v.project.created = true), /cannot create a project/],
    ["fix implements story", fixPackage, (v) => v.changes[0].implements.push({ kind: "story", id: "ST-1" }), /approved findings only/],
    ["applied without change", fixPackage, (v) => v.fixResults.push({ findingId: "F-003", outcome: "applied", detail: "x" }), /'F-003' is marked applied but no change implements it/],
    ["change for unapplied finding", fixPackage, (v) => (v.fixResults[0].outcome = "skipped_drift"), /'F-002', which is not marked applied/],
    ["duplicate result", fixPackage, (v) => v.fixResults.push({ ...v.fixResults[1] }), /Duplicate fixResults entry for 'F-019'/],
    ["delete fluent definition", fixPackage, (v) => {
      v.changes[0].action = "deleted";
      delete v.changes[0].sha256After;
    }, /Deleting Fluent definition/],
  ];
  for (const [label, make, mutate, expected] of cases) {
    const value = structuredClone(make());
    mutate(value);
    assert.throws(() => codeImplementationPackageSchema.parse(value), expected, `case '${label}' should be rejected`);
  }
});

test("implementation contract allows deleting ordinary non-definition files", () => {
  const value = structuredClone(fixPackage()) as any;
  const helper = join(root, "src", "server", "old-helper.js");
  value.baseline.files.push({ path: helper, sha256: HASH_B });
  value.changes.push({
    path: helper,
    action: "deleted",
    implements: [{ kind: "finding", id: "F-002" }],
    summary: "Helper folded into the ACL script.",
  });
  assert.doesNotThrow(() => codeImplementationPackageSchema.parse(value));
});
