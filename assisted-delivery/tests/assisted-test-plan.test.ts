import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  ASSISTED_CONTRACT_VERSION,
  testPlanPackageSchema,
} from "../src/assisted-contracts.js";
import {
  validateAssistedTestPlanFile,
  validateAssistedTestPlanJson,
} from "../src/validate-assisted-test-plan.js";

function testPlanPackage(directory: string): Record<string, unknown> {
  const sourcePath = join(directory, "story-draft-v001.html");
  const markdownPath = join(directory, "test-plan-v001.md");
  const jsonPath = join(directory, "internal", "test-plan-v001.json");
  const sourceDocument = {
    contractVersion: ASSISTED_CONTRACT_VERSION,
    id: "story-report",
    title: "Story Draft",
    format: "html",
    sourcePath,
    units: [
      {
        id: "body",
        type: "document_text",
        text: "Story: Secure intake. Given an invalid token, when a request is submitted, then access is denied.",
        location: { kind: "file", path: sourcePath },
      },
    ],
    warnings: [],
  };
  const citation = {
    id: "cite-story-report",
    documentId: sourceDocument.id,
    unitId: "body",
    location: sourceDocument.units[0]!.location,
    quote: "Given an invalid token",
  };
  return {
    contractVersion: ASSISTED_CONTRACT_VERSION,
    packageType: "test_plan",
    packageId: "test-plan-secure-intake-v001",
    title: "Secure Intake Test Plan",
    application: "APPLICATION NAME",
    sourceStoryDocumentId: sourceDocument.id,
    artifacts: {
      markdown: markdownPath,
      json: jsonPath,
    },
    sourceInventory: [
      {
        path: sourcePath,
        supported: true,
        readable: true,
        included: true,
        format: "html",
        unitCount: 1,
        warnings: [],
      },
    ],
    documents: [sourceDocument],
    citations: [citation],
    stories: [
      {
        id: "story-secure-intake",
        title: "Secure intake",
        acceptanceCriteria: [
          {
            id: "story-secure-intake-ac-1",
            text: "Given an invalid token, when a request is submitted, then access is denied.",
            citationIds: [citation.id],
          },
        ],
        citationIds: [citation.id],
      },
    ],
    scenarios: [
      {
        id: "TC-1",
        storyId: "story-secure-intake",
        acceptanceCriterionIds: ["story-secure-intake-ac-1"],
        title: "Reject an invalid token",
        given: "an invalid OAuth token",
        when: "a request is submitted",
        then: "access is denied before business logic executes",
        category: "security",
        priority: "high",
        source: "acceptance_criteria",
        citationIds: [citation.id],
      },
    ],
    coverageGaps: [],
    assumptions: [],
    warnings: [],
  };
}

const markdown = `# Secure Intake Test Plan

## Test Plan Summary
This plan covers the supplied secure-intake Story.

## Source Stories and Acceptance Criteria
<!-- source-story:story-secure-intake -->
### Secure intake
<!-- citations:cite-story-report -->

<!-- acceptance-criterion:story-secure-intake-ac-1 -->
Given an invalid token, when a request is submitted, then access is denied.
<!-- citations:cite-story-report -->

## Coverage Summary
One Story and one acceptance criterion are covered by one direct scenario.

## Test Scenarios by Story
<!-- test-scenario:TC-1 -->
### Reject an invalid token
- Story: story-secure-intake
- Acceptance criteria: story-secure-intake-ac-1
- Given: an invalid OAuth token
- When: a request is submitted
- Then: access is denied before business logic executes
- Category: security
- Priority: high
- Source: acceptance_criteria
<!-- citations:cite-story-report -->

## Coverage Gaps
No coverage gaps were identified in the supplied acceptance criterion.

## Assumptions and Limitations
This is a draft design; no tests were executed and no systems were modified.
`;

test("test-plan contract enforces stable arrays and complete coverage", () => {
  const directory = "C:\\artifacts\\test-plan";
  const value = testPlanPackage(directory);
  const parsed = testPlanPackageSchema.parse(value);
  assert.equal(parsed.scenarios.length, 1);
  assert.equal(parsed.scenarios[0]!.category, "security");

  const wrapped = structuredClone(value) as { scenarios: unknown };
  wrapped.scenarios = { value: parsed.scenarios };
  assert.throws(
    () => testPlanPackageSchema.parse(wrapped),
    /expected array/i,
  );

  const missingCoverage = structuredClone(value) as {
    scenarios: unknown[];
  };
  missingCoverage.scenarios = [];
  assert.throws(
    () => testPlanPackageSchema.parse(missingCoverage),
    /requires scenarios or a coverage gap|requires a scenario or coverage gap/,
  );
  assert.doesNotThrow(() =>
    validateAssistedTestPlanJson(JSON.stringify(value)),
  );

  const underCited = structuredClone(value) as {
    citations: Array<Record<string, unknown>>;
    stories: Array<{
      acceptanceCriteria: Array<Record<string, unknown>>;
    }>;
    scenarios: Array<{
      acceptanceCriterionIds: string[];
      citationIds: string[];
    }>;
  };
  underCited.citations.push({
    ...underCited.citations[0],
    id: "cite-story-report-ac-2",
    quote: "access is denied",
  });
  underCited.stories[0]!.acceptanceCriteria.push({
    id: "story-secure-intake-ac-2",
    text: "Access is denied before business logic executes.",
    citationIds: ["cite-story-report-ac-2"],
  });
  underCited.scenarios[0]!.acceptanceCriterionIds.push(
    "story-secure-intake-ac-2",
  );
  assert.throws(
    () => testPlanPackageSchema.parse(underCited),
    /must cite referenced acceptance criterion 'story-secure-intake-ac-2'/,
  );
  underCited.scenarios[0]!.citationIds.push("cite-story-report-ac-2");
  assert.doesNotThrow(() => testPlanPackageSchema.parse(underCited));
});

test("accepts an all-gap plan when a Story has no acceptance criteria", () => {
  const value = testPlanPackage("C:\\artifacts\\all-gap") as {
    stories: Array<{ acceptanceCriteria: unknown[] }>;
    scenarios: unknown[];
    coverageGaps: unknown[];
  };
  value.stories[0]!.acceptanceCriteria = [];
  value.scenarios = [];
  value.coverageGaps = [
    {
      id: "gap-secure-intake-ac",
      storyId: "story-secure-intake",
      acceptanceCriterionId: null,
      reason: "missing_acceptance_criteria",
      description: "The source Story has no acceptance criteria to decompose.",
      citationIds: ["cite-story-report"],
    },
  ];

  const parsed = testPlanPackageSchema.parse(value);
  assert.equal(parsed.scenarios.length, 0);
  assert.equal(parsed.coverageGaps.length, 1);
});

test("validates Markdown report and internal JSON sidecar", () => {
  const directory = mkdtempSync(join(tmpdir(), "assisted-test-plan-"));
  const internalDirectory = join(directory, "internal");
  mkdirSync(internalDirectory);
  const markdownPath = join(directory, "test-plan-v001.md");
  const jsonPath = join(internalDirectory, "test-plan-v001.json");
  writeFileSync(markdownPath, markdown);
  writeFileSync(jsonPath, JSON.stringify(testPlanPackage(directory)));

  assert.equal(validateAssistedTestPlanFile(jsonPath), jsonPath);

  writeFileSync(
    markdownPath,
    markdown.replace("<!-- test-scenario:TC-1 -->", ""),
  );
  assert.throws(
    () => validateAssistedTestPlanFile(jsonPath),
    /missing marker '<!-- test-scenario:TC-1 -->'/,
  );
});

test("preserves angle-bracket literals in Markdown scenario fields", () => {
  const directory = mkdtempSync(join(tmpdir(), "assisted-test-plan-angle-"));
  const internalDirectory = join(directory, "internal");
  mkdirSync(internalDirectory);
  const markdownPath = join(directory, "test-plan-v001.md");
  const jsonPath = join(internalDirectory, "test-plan-v001.json");
  const value = testPlanPackage(directory) as {
    scenarios: Array<{ given: string }>;
  };
  value.scenarios[0]!.given = "<sys_id> is absent";
  writeFileSync(
    markdownPath,
    markdown.replace(
      "- Given: an invalid OAuth token",
      "- Given: <sys_id> is absent",
    ),
  );
  writeFileSync(jsonPath, JSON.stringify(value));

  assert.equal(validateAssistedTestPlanFile(jsonPath), jsonPath);
});

test("requires structured assumptions in the Markdown report", () => {
  const directory = mkdtempSync(join(tmpdir(), "assisted-test-plan-assumption-"));
  const internalDirectory = join(directory, "internal");
  mkdirSync(internalDirectory);
  const markdownPath = join(directory, "test-plan-v001.md");
  const jsonPath = join(internalDirectory, "test-plan-v001.json");
  const value = testPlanPackage(directory) as {
    assumptions: unknown[];
  };
  value.assumptions = [
    {
      id: "assumption-token-format",
      text: "The supplied token format is representative of production.",
      citationIds: ["cite-story-report"],
    },
  ];
  writeFileSync(markdownPath, markdown);
  writeFileSync(jsonPath, JSON.stringify(value));

  assert.throws(
    () => validateAssistedTestPlanFile(jsonPath),
    /missing marker '<!-- assumption:assumption-token-format -->'/,
  );
  writeFileSync(
    markdownPath,
    markdown.replace(
      "This is a draft design; no tests were executed and no systems were modified.",
      `<!-- assumption:assumption-token-format -->
The supplied token format is representative of production.
<!-- citations:cite-story-report -->

This is a draft design; no tests were executed and no systems were modified.`,
    ),
  );
  assert.equal(validateAssistedTestPlanFile(jsonPath), jsonPath);
});
