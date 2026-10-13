import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  ASSISTED_CONTRACT_VERSION,
  TECHNICAL_DESIGN_AREAS,
  technicalDesignPackageSchema,
} from "../src/assisted-contracts.js";
import {
  validateAssistedTechnicalDesignFile,
  validateAssistedTechnicalDesignJson,
} from "../src/validate-assisted-technical-design.js";

function technicalDesignPackage(
  directory: string,
  mode: "design" | "evaluation",
): Record<string, unknown> {
  const sourcePath = join(directory, "requirements.txt");
  const markdown = join(directory, "technical-design-v001.md");
  const json = join(directory, "technical-design-v001.json");
  const document = {
    contractVersion: ASSISTED_CONTRACT_VERSION,
    id: "requirements",
    title: "Requirements",
    format: "txt",
    sourcePath,
    units: [
      {
        id: "document-text",
        type: "document_text",
        text: "Equipment updates must be authenticated and recoverable.",
        location: { kind: "file", path: sourcePath },
      },
    ],
    warnings: [],
  };
  const citation = {
    id: "cite-requirement",
    documentId: document.id,
    unitId: "document-text",
    location: document.units[0]!.location,
    quote: "authenticated and recoverable",
  };
  const designPath = join(directory, "source-design.txt");
  const designDocument = {
    contractVersion: ASSISTED_CONTRACT_VERSION,
    id: "source-design",
    title: "Source Technical Design",
    format: "txt",
    sourcePath: designPath,
    units: [
      {
        id: "design-text",
        type: "document_text",
        text: "The design identifies processing errors but does not define retries.",
        location: { kind: "file", path: designPath },
      },
    ],
    warnings: [],
  };
  const designCitation = {
    id: "cite-source-design",
    documentId: designDocument.id,
    unitId: "design-text",
    location: designDocument.units[0]!.location,
    quote: "does not define retries",
  };
  return {
    contractVersion: ASSISTED_CONTRACT_VERSION,
    packageType: "technical_design",
    packageId: `technical-design-${mode}-001`,
    mode,
    title:
      mode === "design"
        ? "Equipment Integration Technical Design"
        : "Equipment Integration Technical Design Evaluation",
    application: "APPLICATION NAME",
    objective:
      mode === "design"
        ? "Define the implementation details."
        : "Evaluate the supplied technical design.",
    summary: "The design content is prepared for human engineering review.",
    evaluatedDesignDocumentId:
      mode === "evaluation" ? designDocument.id : null,
    artifacts: { markdown, json },
    sourceInventory: [
      {
        path: sourcePath,
        supported: true,
        readable: true,
        included: true,
        format: "txt",
        unitCount: 1,
        warnings: [],
      },
      ...(mode === "evaluation"
        ? [
            {
              path: designPath,
              supported: true,
              readable: true,
              included: true,
              format: "txt",
              unitCount: 1,
              warnings: [],
            },
          ]
        : []),
    ],
    documents:
      mode === "evaluation" ? [document, designDocument] : [document],
    citations:
      mode === "evaluation" ? [citation, designCitation] : [citation],
    currentStateConstraints: [
      {
        id: "constraint-auth",
        text: "The integration requires authenticated processing.",
        citationIds: [citation.id],
      },
    ],
    designDecisions:
      mode === "design"
        ? [
            {
              id: "decision-inbound-api",
              area: "integration",
              title: "Inbound equipment API",
              design:
                "Use an authenticated endpoint with idempotent request processing.",
              rationale: "The requirement calls for recoverable updates.",
              affectedArtifacts: [
                {
                  name: "Equipment API",
                  type: "Scripted REST API",
                  action: "create",
                  behavior: "Validate and stage inbound equipment updates.",
                },
              ],
              citationIds: [citation.id],
            },
          ]
        : [],
    evaluationCoverage:
      mode === "evaluation"
        ? TECHNICAL_DESIGN_AREAS.map((area) => ({
            area,
            coverage: area === "integration" ? "partial" : "not_applicable",
            explanation:
              area === "integration"
                ? "The source design partially covers integration recovery."
                : `The source design contains no applicable ${area} behavior.`,
            citationIds: [designCitation.id],
          }))
        : [],
    evaluationFindings:
      mode === "evaluation"
        ? [
            {
              id: "finding-recovery",
              area: "integration",
              coverage: "partial",
              severity: "medium",
              title: "Recovery behavior is incomplete",
              observation: "The source design identifies errors but no retry path.",
              impact: "Transient failures may lose equipment updates.",
              recommendation: "Define retry, reconciliation, and dead-letter behavior.",
              citationIds: [designCitation.id],
            },
          ]
        : [],
    risks: [],
    assumptions: [],
    questions: [],
    warnings: [],
  };
}

const designMarkdown = `# Equipment Integration Technical Design

## Purpose and Scope
Define implementation behavior for equipment updates.

## Inputs and Traceability
The requirements and application research inform this design.

## Current-State Constraints
Existing application behavior constrains the implementation.

## Technical Architecture
The integration uses staged processing.

\`\`\`mermaid
flowchart LR
Source --> API --> Staging --> Equipment
\`\`\`

## Detailed Technical Design
<!-- design-decision:decision-inbound-api -->
### Inbound equipment API
Use an authenticated endpoint with idempotent request processing.

The requirement calls for recoverable updates.

| Artifact | Type | Action | Behavior |
| --- | --- | --- | --- |
| Equipment API | Scripted REST API | create | Validate and stage inbound equipment updates. |

<!-- citations:cite-requirement -->

## Security Design
Use a dedicated identity and least-privilege role.

## Integration and Error Handling
Validate payloads and retain failures for reconciliation.

## Operational Design
Log correlation identifiers and monitor processing failures.

## Implementation Sequence
Create data structures before API and processing logic.

## Test Considerations
Cover authentication, duplicate requests, retries, and recovery.

## Risks
Payload ambiguity may delay field mapping.

## Assumptions and Open Questions
Payload ownership and support responsibilities require confirmation.
`;

const evaluationMarkdown = `# Equipment Integration Technical Design Evaluation

## Evaluation Scope
Evaluate the supplied integration design and its supporting requirements.

## Inputs and Traceability
The source design and requirements are included in the source inventory.

## Current-State Constraints
Existing application behavior constrains the evaluated design.

## Coverage Assessment
${TECHNICAL_DESIGN_AREAS.map(
  (area) => `<!-- coverage:${area} -->
### ${area}
${area === "integration" ? "partial" : "not_applicable"} — ${
    area === "integration"
      ? "The source design partially covers integration recovery."
      : `The source design contains no applicable ${area} behavior.`
  }
<!-- citations:cite-source-design -->`,
).join("\n\n")}

## Evaluation Findings
<!-- evaluation-finding:finding-recovery -->
### Recovery behavior is incomplete
**Coverage:** partial

**Severity:** medium

The source design identifies errors but no retry path.

Transient failures may lose equipment updates.

Define retry, reconciliation, and dead-letter behavior.

<!-- citations:cite-source-design -->

## Risks and Gaps
Transient processing failures may lose equipment updates.

## Recommendations
Define retry, reconciliation, and dead-letter handling.

## Assumptions and Open Questions
Support ownership remains an open design question.
`;

test("technical design contract separates design and evaluation modes", () => {
  const directory = "C:\\artifacts\\technical-design";
  const design = technicalDesignPackage(directory, "design");
  const evaluation = technicalDesignPackage(directory, "evaluation");

  assert.equal(technicalDesignPackageSchema.parse(design).mode, "design");
  assert.equal(
    technicalDesignPackageSchema.parse(evaluation).mode,
    "evaluation",
  );

  const invalid = structuredClone(design) as {
    mode: string;
    designDecisions: unknown[];
    evaluationFindings: unknown[];
  };
  invalid.mode = "evaluation";
  assert.throws(
    () => technicalDesignPackageSchema.parse(invalid),
    /Evaluation mode requires at least one technical design finding|cannot introduce design decisions/,
  );
  assert.doesNotThrow(() =>
    validateAssistedTechnicalDesignJson(JSON.stringify(evaluation)),
  );
});

test("validates design and evaluation Markdown artifacts", () => {
  for (const [mode, markdown] of [
    ["design", designMarkdown],
    ["evaluation", evaluationMarkdown],
  ] as const) {
    const directory = mkdtempSync(join(tmpdir(), `technical-${mode}-`));
    const value = technicalDesignPackage(directory, mode);
    const markdownPath = join(directory, "technical-design-v001.md");
    const jsonPath = join(directory, "technical-design-v001.json");
    writeFileSync(markdownPath, markdown);
    writeFileSync(jsonPath, JSON.stringify(value));

    assert.equal(validateAssistedTechnicalDesignFile(jsonPath), jsonPath);
  }
});

test("rejects omitted structured findings and affirmative governance outcomes", () => {
  const directory = mkdtempSync(join(tmpdir(), "technical-evaluation-"));
  const value = technicalDesignPackage(directory, "evaluation");
  const markdownPath = join(directory, "technical-design-v001.md");
  const jsonPath = join(directory, "technical-design-v001.json");
  writeFileSync(
    markdownPath,
    evaluationMarkdown.replace(
      "<!-- evaluation-finding:finding-recovery -->",
      "",
    ),
  );
  writeFileSync(jsonPath, JSON.stringify(value));

  assert.throws(
    () => validateAssistedTechnicalDesignFile(jsonPath),
    /missing structured item marker/,
  );

  writeFileSync(
    markdownPath,
    evaluationMarkdown.replace(
      "Evaluate the supplied integration design",
      "The technical design is approved for implementation after evaluating the supplied integration design",
    ),
  );
  assert.throws(
    () => validateAssistedTechnicalDesignFile(jsonPath),
    /prohibited governance outcome/,
  );

  const prohibitedJson = technicalDesignPackage(directory, "evaluation");
  prohibitedJson.summary = "The solution is authorized for implementation.";
  assert.throws(
    () =>
      validateAssistedTechnicalDesignJson(JSON.stringify(prohibitedJson)),
    /prohibited governance outcome/,
  );

  writeFileSync(
    markdownPath,
    evaluationMarkdown.replace(
      "Evaluate the supplied integration design",
      "This advisory evaluation does not approve the supplied integration design",
    ),
  );
  assert.doesNotThrow(() =>
    validateAssistedTechnicalDesignFile(jsonPath),
  );

  const negatedJson = technicalDesignPackage(directory, "evaluation");
  negatedJson.summary =
    "This advisory does not certify the design as ready for implementation.";
  assert.doesNotThrow(() =>
    validateAssistedTechnicalDesignJson(JSON.stringify(negatedJson)),
  );

  writeFileSync(
    markdownPath,
    evaluationMarkdown.replace(
      "Evaluate the supplied integration design",
      "The design is not ready for implementation and requires human review of the supplied integration design",
    ),
  );
  assert.doesNotThrow(() =>
    validateAssistedTechnicalDesignFile(jsonPath),
  );
});
