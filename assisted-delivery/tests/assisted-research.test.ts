import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  ASSISTED_CONTRACT_VERSION,
  REQUIRED_RESEARCH_INVENTORY_CATEGORIES,
  assistedApplicationResearchPackageSchema,
} from "../src/assisted-contracts.js";
import {
  MAX_ASSISTED_RESEARCH_BYTES,
  validateAssistedResearchFile,
  validateAssistedResearchJson,
} from "../src/validate-assisted-research.js";
import { ASSISTED_APPLICATION_ARTIFACT_QUERIES } from "../src/assisted-research-plan.js";

function researchPackage(directory = "C:\\artifacts\\example\\request"): unknown {
  const evidenceDirectory = join(
    directory,
    "evidence",
    "application-research-v001",
  );
  const inventory: Array<{
    category: string;
    count: number;
    records: Array<Record<string, unknown>>;
  }> = REQUIRED_RESEARCH_INVENTORY_CATEGORIES.map((category) => ({
    category,
    count: 0,
    records: [],
  }));
  const tables = inventory.find((entry) => entry.category === "tables")!;
  tables.count = 3;
  tables.records = [
    {
      id: "table-equipment",
      sysId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      name: "Equipment",
      table: "x_example_app_equipment",
      summary: "Stores equipment records.",
      attributes: { extends: null },
      evidenceIds: ["evidence-table"],
    },
    {
      id: "table-equipment-request",
      sysId: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      name: "Equipment Request",
      table: "x_example_app_equipment_request",
      summary: "Stores equipment requests.",
      attributes: { extends: "task" },
      evidenceIds: ["evidence-table"],
    },
    {
      id: "table-equipment-import",
      sysId: "cccccccccccccccccccccccccccccccc",
      name: "Equipment Import",
      table: "x_example_app_equipment_import",
      summary: "Stages equipment imports.",
      attributes: { extends: "sys_import_set_row" },
      evidenceIds: ["evidence-table"],
    },
  ];
  return {
    contractVersion: ASSISTED_CONTRACT_VERSION,
    packageType: "application_research",
    packageId: "research-example-v001",
    title: "APPLICATION NAME current-state research",
    researchedAt: "2026-09-21T20:00:00.000Z",
    application: {
      name: "APPLICATION NAME",
      scope: "x_example_app",
      sysId: "0123456789abcdef0123456789abcdef",
      instance: "INSTANCE NAME",
    },
    requestContext: {
      targetApplication: "APPLICATION NAME",
      objective: "Assess an inbound equipment integration.",
      externalSystems: ["EXTERNAL SYSTEM"],
      designConstraints: ["OAuth", "REST"],
      researchScope: "application_and_direct_dependencies",
    },
    summary: "The application has a catalog table and no inbound API.",
    artifactCounts: inventory.map(({ category, count }) => ({ category, count })),
    inventory,
    relationships: [
      {
        source: "Equipment Request",
        target: "Equipment",
        kind: "references",
        confidence: "confirmed",
        evidenceIds: ["evidence-table"],
      },
    ],
    lifecycle: [],
    evidence: [
      {
        id: "evidence-table",
        table: "sys_db_object",
        sysId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        recordLabel: "Equipment",
        scope: "application",
        evidenceFile: join(evidenceDirectory, "tables.json"),
        queryDescription: "Application-owned tables",
      },
    ],
    findings: [
      {
        id: "finding-data-model",
        category: "data_model",
        title: "Existing equipment catalog",
        detail: "The application owns an equipment catalog table.",
        relevance: "It is a candidate reconciliation target.",
        evidenceIds: ["evidence-table"],
      },
    ],
    informationToConfirm: [],
    limitations: [],
    artifacts: {
      markdown: join(directory, "application-research-v001.md"),
      json: join(directory, "application-research-v001.json"),
      evidenceDirectory,
    },
  };
}

test("validates a comprehensive assisted research handoff", () => {
  const parsed = assistedApplicationResearchPackageSchema.parse(
    researchPackage(),
  );
  assert.equal(parsed.findings.length, 1);
  assert.deepEqual(parsed.requestContext.externalSystems, ["EXTERNAL SYSTEM"]);
  assert.deepEqual(parsed.requestContext.designConstraints, ["OAuth", "REST"]);
  assert.equal(parsed.inventory[0]?.records.length, 3);
  assert.equal("records" in parsed, false);
  assert.equal("approvalStatus" in parsed, false);
  assert.ok(JSON.stringify(parsed).length < 5_000);

  const withQuestion = researchPackage() as {
    informationToConfirm: Array<Record<string, unknown>>;
  };
  withQuestion.informationToConfirm = [
    {
      id: "confirm-auth",
      text: "Confirm the external API authentication model.",
      citationIds: [],
    },
  ];
  assert.throws(
    () => assistedApplicationResearchPackageSchema.parse(withQuestion),
    /cannot contain information-to-confirm questions/,
  );

  const currentStateWording = researchPackage() as { summary: string };
  currentStateWording.summary =
    "The current implementation approach duplicates validation.";
  assert.doesNotThrow(() =>
    validateAssistedResearchJson(JSON.stringify(currentStateWording)),
  );
});

test("research plan covers every required inventory category", () => {
  assert.deepEqual(
    ASSISTED_APPLICATION_ARTIFACT_QUERIES.map(({ category }) => category).sort(),
    [...REQUIRED_RESEARCH_INVENTORY_CATEGORIES].sort(),
  );
});

test("research inventory retains every counted artifact", () => {
  const missingRecord = structuredClone(researchPackage()) as Record<
    string,
    unknown
  >;
  (
    (missingRecord.inventory as Array<Record<string, unknown>>)[0]!
      .records as unknown[]
  ).pop();
  assert.throws(
    () => assistedApplicationResearchPackageSchema.parse(missingRecord),
    /count must equal the number of individually retained records/,
  );

  const missingCategory = structuredClone(researchPackage()) as Record<
    string,
    unknown
  >;
  (missingCategory.inventory as unknown[]).pop();
  assert.throws(
    () => assistedApplicationResearchPackageSchema.parse(missingCategory),
    /missing from the research inventory/,
  );

  const duplicateRecord = structuredClone(researchPackage()) as Record<
    string,
    unknown
  >;
  const duplicateRecords = (
    (duplicateRecord.inventory as Array<Record<string, unknown>>)[0]!
      .records as Array<Record<string, unknown>>
  );
  duplicateRecords[1]!.id = duplicateRecords[0]!.id;
  duplicateRecords[1]!.sysId = duplicateRecords[0]!.sysId;
  assert.throws(
    () => assistedApplicationResearchPackageSchema.parse(duplicateRecord),
    /Duplicate inventory record ID|Duplicate inventory sys_id/,
  );

  const missingSysId = structuredClone(researchPackage()) as Record<
    string,
    unknown
  >;
  delete (
    (
      (missingSysId.inventory as Array<Record<string, unknown>>)[0]!
        .records as Array<Record<string, unknown>>
    )[0]!
  ).sysId;
  assert.throws(
    () => assistedApplicationResearchPackageSchema.parse(missingSysId),
    /expected string/,
  );
});

test("research identity cannot drift from the requested target application", () => {
  const wrongTarget = researchPackage() as Record<string, unknown>;
  (wrongTarget.requestContext as Record<string, unknown>).targetApplication =
    "OAuth";
  assert.throws(
    () => assistedApplicationResearchPackageSchema.parse(wrongTarget),
    /must match the requested target application/,
  );

  const targetAsExternal = researchPackage() as Record<string, unknown>;
  (targetAsExternal.requestContext as Record<string, unknown>).externalSystems =
    ["APPLICATION NAME"];
  assert.throws(
    () => assistedApplicationResearchPackageSchema.parse(targetAsExternal),
    /must not be classified as an external system/,
  );
});

test("research findings require delivered evidence in the evidence folder", () => {
  const unknownEvidence = structuredClone(researchPackage()) as Record<
    string,
    unknown
  >;
  (
    (unknownEvidence.findings as Array<Record<string, unknown>>)[0]!
      .evidenceIds as string[]
  )[0] = "missing";
  assert.throws(
    () => assistedApplicationResearchPackageSchema.parse(unknownEvidence),
    /unknown evidence/,
  );

  const escapedEvidence = structuredClone(researchPackage()) as Record<
    string,
    unknown
  >;
  (
    (escapedEvidence.evidence as Array<Record<string, unknown>>)[0]!
  ).evidenceFile = "C:\\artifacts\\example\\request\\tables.json";
  assert.throws(
    () => assistedApplicationResearchPackageSchema.parse(escapedEvidence),
    /evidence directory/,
  );
});

test("research packages reject undeclared raw query payloads", () => {
  const rawPayload = researchPackage() as Record<string, unknown>;
  rawPayload.records = [{ raw: "query response" }];
  (
    (rawPayload.evidence as Array<Record<string, unknown>>)[0]!
  ).rawResponse = [{ sys_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }];

  assert.throws(
    () => assistedApplicationResearchPackageSchema.parse(rawPayload),
    /Unrecognized key/,
  );
});

test("research packages enforce field and total-size limits", () => {
  const oversizedField = researchPackage() as Record<string, unknown>;
  (
    (oversizedField.evidence as Array<Record<string, unknown>>)[0]!
  ).recordLabel = "x".repeat(1_001);
  assert.throws(
    () => assistedApplicationResearchPackageSchema.parse(oversizedField),
    /Too big/,
  );

  assert.throws(
    () =>
      validateAssistedResearchJson(
        `${" ".repeat(MAX_ASSISTED_RESEARCH_BYTES)}{}`,
      ),
    /structured-package limit/,
  );
});

test("file validation binds reports and delivered evidence to one version", () => {
  const directory = mkdtempSync(join(tmpdir(), "assisted-research-"));
  const evidenceDirectory = join(
    directory,
    "evidence",
    "application-research-v001",
  );
  mkdirSync(evidenceDirectory, { recursive: true });
  const markdownPath = join(directory, "application-research-v001.md");
  const jsonPath = join(directory, "application-research-v001.json");
  const evidencePath = join(evidenceDirectory, "tables.json");
  const packageValue = researchPackage(directory) as {
    inventory: Array<{
      category: string;
      records: Array<{ id: string; name: string }>;
    }>;
  };
  const renderedMarkdownInventory = packageValue.inventory
    .map(
      ({ category, records }) =>
        `<!-- inventory-category:${category} -->
### ${category}
${records
  .map(
    (record) =>
      `<!-- inventory-record:${record.id} -->
- ${record.name}`,
  )
  .join("\n")}`,
    )
    .join("\n");
  const markdownReport = `# APPLICATION NAME — Architecture Research Report

## Summary — Artifact Counts
The artifact counts summarize the complete current-state inventory.

## Architecture Overview
The current application layers connect as shown.

\`\`\`mermaid
flowchart LR
Application --> Data
\`\`\`
## Order / Record Lifecycle
The current record lifecycle follows these states.

\`\`\`mermaid
stateDiagram-v2
A --> B
\`\`\`
## Intake Paths
Current intake enters through the user import path.

\`\`\`mermaid
flowchart LR
User --> Import
\`\`\`
## Data Model
The current tables relate through this reference.

\`\`\`mermaid
erDiagram
A ||--|| B : relates
\`\`\`

## Complete Application Inventory
${renderedMarkdownInventory}

## Technical Debt & Risk Notes
Current implementation observations.

## Research Limitations
Point-in-time limitations.
`;
  writeFileSync(markdownPath, markdownReport);
  writeFileSync(evidencePath, "[]");
  const value = researchPackage(directory) as {
    artifacts: {
      markdown: string;
      json: string;
      evidenceDirectory: string;
    };
    evidence: Array<{ evidenceFile: string }>;
  };
  value.artifacts = {
    markdown: markdownPath,
    json: jsonPath,
    evidenceDirectory,
  };
  value.evidence[0]!.evidenceFile = evidencePath;
  writeFileSync(jsonPath, JSON.stringify(value));

  assert.equal(
    validateAssistedResearchFile(jsonPath, "APPLICATION NAME"),
    jsonPath,
  );

  writeFileSync(markdownPath, markdownReport.replace(/\n/g, "\r\n"));
  assert.doesNotThrow(() =>
    validateAssistedResearchFile(jsonPath, "APPLICATION NAME"),
  );
  writeFileSync(markdownPath, markdownReport);

  writeFileSync(
    markdownPath,
    markdownReport.replace("## Research Limitations", "## Constraints"),
  );
  assert.throws(
    () => validateAssistedResearchFile(jsonPath, "APPLICATION NAME"),
    /missing required section 'Research Limitations'/,
  );

  const firstRecord = packageValue.inventory.find(
    ({ records }) => records.length > 0,
  )!.records[0]!;
  writeFileSync(
    markdownPath,
    markdownReport.replace(
      `<!-- inventory-record:${firstRecord.id} -->`,
      "",
    ),
  );
  assert.throws(
    () => validateAssistedResearchFile(jsonPath, "APPLICATION NAME"),
    /must render exactly 3 unique record markers/,
  );
  writeFileSync(markdownPath, markdownReport);

  writeFileSync(
    markdownPath,
    `${markdownReport}\n## Information to Confirm\nWhich authentication protocol does the external API use?\n`,
  );
  assert.throws(
    () => validateAssistedResearchFile(jsonPath, "APPLICATION NAME"),
    /must not contain recommendation or open-question sections/,
  );
  writeFileSync(markdownPath, markdownReport);

  writeFileSync(
    markdownPath,
    markdownReport.replace(
      "Current implementation observations.",
      "We recommend implementing a new integration.",
    ),
  );
  assert.throws(
    () => validateAssistedResearchFile(jsonPath, "APPLICATION NAME"),
    /contains proposed-design content/,
  );
  writeFileSync(markdownPath, markdownReport);

  assert.throws(
    () => validateAssistedResearchFile(jsonPath, "OAuth"),
    /supervisor-provided target application/,
  );

  value.artifacts.markdown = join(directory, "application-research-v002.md");
  writeFileSync(jsonPath, JSON.stringify(value));
  assert.throws(
    () => validateAssistedResearchFile(jsonPath, "APPLICATION NAME"),
    /Markdown must share the JSON report directory and version/,
  );
});
