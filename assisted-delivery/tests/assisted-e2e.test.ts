import assert from "node:assert/strict";
import { mkdtempSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test from "node:test";
import {
  ASSISTED_CONTRACT_VERSION,
  REQUIRED_RESEARCH_INVENTORY_CATEGORIES,
  type AssistedCitation,
  assistedApplicationResearchPackageSchema,
  requirementsExtractionPackageSchema,
  solutionRecommendationPackageSchema,
  storyDraftPackageSchema,
} from "../src/assisted-contracts.js";
import { allocateArtifactVersion } from "../src/artifact-storage.js";
import { ingestDocuments } from "../src/document-ingestion.js";
import { validateAssistedRecommendationFile } from "../src/validate-assisted-recommendation.js";
import { validateAssistedRequirementsFile } from "../src/validate-assisted-requirements.js";
import { validateAssistedStoryDraftFile } from "../src/validate-assisted-story-draft.js";
import { createAssistedFixtures } from "./assisted-fixtures.js";

test("synthetic documents flow through recommendations and cited story drafts", async () => {
  const directory = mkdtempSync(join(tmpdir(), "assisted-e2e-"));
  const fixtures = await createAssistedFixtures(join(directory, "inputs"));
  const researchDirectory = join(directory, "research");
  const evidenceDirectory = join(
    researchDirectory,
    "evidence",
    "application-research-v001",
  );
  const inventory = REQUIRED_RESEARCH_INVENTORY_CATEGORIES.map((category) => ({
    category,
    count: 0,
    records: [] as Array<Record<string, unknown>>,
  }));
  const tables = inventory.find((entry) => entry.category === "tables")!;
  tables.count = 2;
  tables.records = [
    {
      id: "table-review",
      sysId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      name: "Review",
      table: "x_example_app_review",
      summary: "Stores review records.",
      attributes: {},
      evidenceIds: ["evidence-review-table"],
    },
    {
      id: "table-review-task",
      sysId: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      name: "Review Task",
      table: "x_example_app_review_task",
      summary: "Stores review tasks.",
      attributes: { extends: "task" },
      evidenceIds: ["evidence-review-table"],
    },
  ];
  const research = assistedApplicationResearchPackageSchema.parse({
    contractVersion: ASSISTED_CONTRACT_VERSION,
    packageType: "application_research",
    packageId: "research-synthetic-v001",
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
      objective: "Assess a review-workspace change.",
      externalSystems: ["EXTERNAL SYSTEM"],
      designConstraints: ["REST"],
      researchScope: "application_and_direct_dependencies",
    },
    summary:
      "The application contains review records and no existing inbound API.",
    artifactCounts: inventory.map(({ category, count }) => ({ category, count })),
    inventory,
    relationships: [
      {
        source: "Review Task",
        target: "Review",
        kind: "references",
        confidence: "confirmed",
        evidenceIds: ["evidence-review-table"],
      },
    ],
    lifecycle: [],
    evidence: [
      {
        id: "evidence-review-table",
        table: "sys_db_object",
        recordLabel: "Review",
        scope: "application",
        evidenceFile: join(evidenceDirectory, "tables.json"),
        queryDescription: "Application-owned tables",
      },
    ],
    findings: [
      {
        id: "finding-review-table",
        category: "data_model",
        title: "Existing review record",
        detail: "The application has a review record suitable for extension.",
        relevance: "It can anchor the requested review workspace.",
        evidenceIds: ["evidence-review-table"],
      },
    ],
    informationToConfirm: [],
    limitations: [],
    artifacts: {
      markdown: join(researchDirectory, "application-research-v001.md"),
      json: join(researchDirectory, "application-research-v001.json"),
      evidenceDirectory,
    },
  });
  writeFileSync(
    join(fixtures.directory, "application-research.json"),
    JSON.stringify(research),
  );
  const ingestion = await ingestDocuments(fixtures.directory);
  const byName = (name: string) => {
    const document = ingestion.documents.find(
      (candidate) => basename(candidate.sourcePath) === name,
    );
    assert.ok(document, `Expected ingested document '${name}'.`);
    return document;
  };
  const requirements = byName("requirements.txt");
  const docx = byName("architect-notes.docx");
  const pptx = byName("architect-briefing.pptx");
  const pdf = byName("architect-operations.pdf");
  const researchDocument = byName("application-research.json");
  const unit = (
    document: typeof requirements,
    type: string,
  ) => {
    const found = document.units.find((candidate) => candidate.type === type);
    assert.ok(found, `Expected '${type}' unit in '${document.title}'.`);
    return found;
  };
  const citedUnits = [
    ["cite-file", requirements, unit(requirements, "document_text")],
    ["cite-heading", docx, unit(docx, "heading")],
    ["cite-slide", pptx, unit(pptx, "slide_text")],
    ["cite-page", pdf, unit(pdf, "page_text")],
  ] as const;
  const citations: AssistedCitation[] = citedUnits.map(
    ([id, document, citedUnit]) => ({
      id,
      documentId: document.id,
      unitId: citedUnit.id,
      location: citedUnit.location,
      quote: citedUnit.text,
    }),
  );

  assert.deepEqual(
    citations.map((citation) => citation.location.kind),
    ["file", "heading", "slide", "page"],
  );

  const documents = ingestion.documents;
  const recommendation = solutionRecommendationPackageSchema.parse({
    contractVersion: ASSISTED_CONTRACT_VERSION,
    packageType: "solution_recommendation",
    packageId: "recommendation-synthetic-001",
    title: "Request review recommendation",
    summary:
      "Create a configurable review workspace with observable assignment handling.",
    artifacts: {
      html: join(directory, "pending-solution-recommendation.html"),
      json: join(directory, "pending-solution-recommendation.json"),
    },
    sourceInventory: ingestion.inventory,
    documents,
    citations,
    recommendations: [
      {
        id: "rec-workspace",
        title: "Create a configurable review workspace",
        description:
          "Give reviewers a queue and capture each review outcome.",
        rationale:
          "The requirements and architecture inputs consistently describe queued review work.",
        implementationConsiderations: [
          "Keep assignment behavior configurable.",
          "Record failed assignments for operational follow-up.",
        ],
        citationIds: [
          "cite-file",
          "cite-heading",
          "cite-slide",
          "cite-page",
        ],
      },
    ],
    alternatives: [
      {
        id: "alt-list",
        title: "Use a basic list",
        description: "Expose pending requests through a filtered list.",
        tradeoffs: ["Faster initial delivery", "Less guided review behavior"],
        citationIds: ["cite-file"],
      },
    ],
    risks: [
      {
        id: "risk-assignment",
        description: "Assignment failures could leave requests unreviewed.",
        mitigation: "Monitor failures and support retry.",
        citationIds: ["cite-page"],
      },
    ],
    assumptions: [
      {
        id: "assumption-reviewer",
        text: "A designated reviewer role will be available.",
        citationIds: [],
      },
    ],
    questions: [
      {
        id: "question-assignment",
        text: "Which assignment rules should be configurable?",
        citationIds: ["cite-slide"],
      },
    ],
    warnings: ["Human acceptance testing must confirm workflow usability."],
  });

  const storyDraft = storyDraftPackageSchema.parse({
    contractVersion: ASSISTED_CONTRACT_VERSION,
    packageType: "story_draft",
    packageId: "story-draft-synthetic-001",
    title: "Request review story draft",
    artifacts: {
      html: join(directory, "pending-story-draft.html"),
      json: join(directory, "pending-story-draft.json"),
    },
    sourceInventory: ingestion.inventory,
    documents,
    authoritativeDocumentIds: [
      requirements.id,
      docx.id,
      pptx.id,
      pdf.id,
    ],
    citations,
    epics: [
      {
        id: "epic-review",
        title: "Request review",
        objective: "Enable controlled review of pending requests.",
        storyIds: ["story-queue", "story-monitoring"],
        citationIds: ["cite-file", "cite-heading"],
      },
    ],
    stories: [
      {
        id: "story-queue",
        title: "Review pending requests",
        userStory:
          "As a reviewer, I want a pending request queue so that I can record review outcomes.",
        description: "Provide the configurable review workspace.",
        citationIds: ["cite-file", "cite-slide"],
        acceptanceCriteria: [
          {
            id: "ac-queue",
            text: "Given pending requests, when a reviewer opens the workspace, then the requests are visible for review.",
            citationIds: ["cite-file"],
          },
        ],
        dependencyIds: [],
        assumptions: ["Reviewer access will be defined before testing."],
        questions: [],
      },
      {
        id: "story-monitoring",
        title: "Monitor assignment failures",
        description:
          "Record and expose failed review assignments for follow-up.",
        citationIds: ["cite-page"],
        acceptanceCriteria: [
          {
            id: "ac-monitoring",
            text: "Given an assignment failure, when monitoring runs, then the failure is visible and can be retried.",
            citationIds: ["cite-page"],
          },
        ],
        dependencyIds: ["story-queue"],
        assumptions: [],
        questions: ["Confirm the operational alert destination."],
      },
    ],
    assumptions: [],
    questions: [
      {
        id: "question-alert",
        text: "Which team receives failed-assignment alerts?",
        citationIds: ["cite-page"],
      },
    ],
    warnings: ["Draft stories require product-owner review."],
  });

  const artifactRoot = join(directory, "artifacts");
  const recommendationPaths = allocateArtifactVersion({
    projectRoot: directory,
    explicitRoot: artifactRoot,
    applicationName: "APPLICATION NAME",
    requestSlug: "synthetic-assisted-review",
    baseName: "solution-recommendation",
    extensions: ["html", "json"],
  });
  const storyPaths = allocateArtifactVersion({
    projectRoot: directory,
    explicitRoot: artifactRoot,
    applicationName: "APPLICATION NAME",
    requestSlug: "synthetic-assisted-review",
    baseName: "story-draft",
    extensions: ["html", "json"],
  });
  const requirementsExtraction = requirementsExtractionPackageSchema.parse({
    contractVersion: ASSISTED_CONTRACT_VERSION,
    packageType: "requirements_extraction",
    packageId: "requirements-synthetic-001",
    title: "Request review requirements register",
    summary: "Extracted requirements for the request review workspace.",
    artifacts: {
      html: join(directory, "pending-requirements-extraction.html"),
      json: join(directory, "pending-requirements-extraction.json"),
    },
    sourceInventory: ingestion.inventory,
    documents,
    citations,
    requirements: [
      {
        id: "req-queue",
        title: "Reviewer queue",
        verbatimText: citations.find(
          (candidate) => candidate.id === "cite-file",
        )!.quote!,
        type: "functional",
        categories: ["ux"],
        priority: "medium",
        priorityBasis: "inferred",
        isAmbiguous: false,
        citationIds: ["cite-file"],
      },
    ],
    assumptions: [],
    questions: [],
    warnings: ["Draft requirements require stakeholder confirmation."],
  });
  const requirementsPaths = allocateArtifactVersion({
    projectRoot: directory,
    explicitRoot: artifactRoot,
    applicationName: "APPLICATION NAME",
    requestSlug: "synthetic-assisted-review",
    baseName: "requirements-extraction",
    extensions: ["html", "json"],
  });
  const recommendationPath = recommendationPaths.paths.json!;
  const storyPath = storyPaths.paths.json!;
  const requirementsPath = requirementsPaths.paths.json!;
  recommendation.artifacts = {
    html: recommendationPaths.paths.html!,
    json: recommendationPath,
  };
  storyDraft.artifacts = {
    html: storyPaths.paths.html!,
    json: storyPath,
  };
  requirementsExtraction.artifacts = {
    html: requirementsPaths.paths.html!,
    json: requirementsPath,
  };
  writeFileSync(recommendationPaths.paths.html!, "<html>Recommendation</html>");
  writeFileSync(storyPaths.paths.html!, "<html>Stories</html>");
  writeFileSync(requirementsPaths.paths.html!, "<html>Requirements</html>");
  writeFileSync(recommendationPath, JSON.stringify(recommendation, null, 2));
  writeFileSync(storyPath, JSON.stringify(storyDraft, null, 2));
  writeFileSync(
    requirementsPath,
    JSON.stringify(requirementsExtraction, null, 2),
  );

  assert.equal(
    validateAssistedRecommendationFile(recommendationPath),
    recommendationPath,
  );
  assert.equal(validateAssistedStoryDraftFile(storyPath), storyPath);
  assert.equal(
    validateAssistedRequirementsFile(requirementsPath),
    requirementsPath,
  );
  assert.equal(recommendationPaths.versionLabel, "v001");
  assert.equal(storyPaths.versionLabel, "v001");
  assert.equal(requirementsPaths.versionLabel, "v001");
  assert.ok(
    recommendation.documents.some(
      (document) => document.id === researchDocument.id,
    ),
  );
  assert.ok(JSON.stringify(research).length < 5_000);

  unlinkSync(recommendationPaths.paths.html!);
  assert.throws(
    () => validateAssistedRecommendationFile(recommendationPath),
    /HTML artifact does not exist/,
  );

  const machineOutput = JSON.stringify({
    recommendation,
    storyDraft,
    requirementsExtraction,
  });
  assert.doesNotMatch(
    machineOutput,
    /sha256|approvalStatus|attestation|architectureApprovalPath|upstreamPackage/i,
  );
});
