import assert from "node:assert/strict";
import test from "node:test";
import {
  ASSISTED_CONTRACT_VERSION,
  type NormalizedInputDocument,
  requirementsExtractionPackageSchema,
  solutionRecommendationPackageSchema,
  storyDraftPackageSchema,
} from "../src/assisted-contracts.js";

const document: NormalizedInputDocument = {
  contractVersion: ASSISTED_CONTRACT_VERSION,
  id: "doc-requirements",
  title: "Requirements",
  format: "txt",
  sourcePath: "C:\\inputs\\requirements.txt",
  units: [
    {
      id: "document-text",
      type: "document_text",
      text: "Reviewers need a queue of pending requests.",
      location: {
        kind: "file",
        path: "C:\\inputs\\requirements.txt",
      },
    },
  ],
  warnings: [],
};

const citation = {
  id: "cite-requirement",
  documentId: document.id,
  unitId: "document-text",
  location: document.units[0]!.location,
  quote: "queue of pending requests",
} as const;

const sourceInventory = [
  {
    path: document.sourcePath,
    supported: true,
    readable: true,
    included: true,
    format: document.format,
    unitCount: document.units.length,
    warnings: [],
  },
];

function recommendationPackage(): unknown {
  return {
    contractVersion: ASSISTED_CONTRACT_VERSION,
    packageType: "solution_recommendation",
    packageId: "recommendation-001",
    title: "Request review recommendation",
    summary: "Use a configurable review workspace.",
    artifacts: {
      html: "C:\\artifacts\\solution-recommendation-v001.html",
      json: "C:\\artifacts\\solution-recommendation-v001.json",
    },
    sourceInventory,
    documents: [document],
    citations: [citation],
    recommendations: [
      {
        id: "rec-1",
        title: "Create a review workspace",
        description: "Present pending requests to designated reviewers.",
        rationale: "This directly supports the stated reviewer need.",
        citationIds: [citation.id],
      },
    ],
    alternatives: [],
    risks: [],
    assumptions: [],
    questions: [
      {
        id: "question-1",
        text: "Which groups may review requests?",
        citationIds: [],
      },
    ],
    warnings: ["Assignment rules require confirmation."],
  };
}

function storyPackage(): Record<string, unknown> {
  return {
    contractVersion: ASSISTED_CONTRACT_VERSION,
    packageType: "story_draft",
    packageId: "stories-001",
    title: "Request review story draft",
    artifacts: {
      html: "C:\\artifacts\\story-draft-v001.html",
      json: "C:\\artifacts\\story-draft-v001.json",
    },
    sourceInventory,
    documents: [document],
    authoritativeDocumentIds: [document.id],
    citations: [citation],
    epics: [
      {
        id: "epic-1",
        title: "Request review",
        objective: "Enable reviewers to process pending requests.",
        storyIds: ["story-1"],
        citationIds: [citation.id],
      },
    ],
    stories: [
      {
        id: "story-1",
        title: "Show pending requests",
        description: "Provide a queue for designated reviewers.",
        citationIds: [citation.id],
        acceptanceCriteria: [
          {
            id: "ac-1",
            text: "Given pending requests, when a reviewer opens the workspace, then the requests are listed.",
            citationIds: [citation.id],
          },
        ],
        dependencyIds: [],
        assumptions: [],
        questions: ["Confirm the reviewer group."],
      },
    ],
    assumptions: [],
    questions: [],
    warnings: ["Draft content requires human acceptance testing."],
  };
}

test("recommendations validate without governed approval or hash fields", () => {
  const parsed = solutionRecommendationPackageSchema.parse(
    recommendationPackage(),
  );

  assert.equal(parsed.questions.length, 1);
  assert.equal(parsed.warnings.length, 1);
  assert.equal("sha256" in parsed, false);
  assert.equal("approvalStatus" in parsed, false);
  assert.equal("attestations" in parsed, false);
  assert.equal("upstreamPackage" in parsed, false);
});

test("story drafts validate ordinary documents, questions, and warnings", () => {
  const parsed = storyDraftPackageSchema.parse(storyPackage());

  assert.equal(parsed.stories[0]?.questions.length, 1);
  assert.equal(parsed.warnings.length, 1);
  assert.equal("approvalStatus" in parsed, false);
  assert.equal("architectureApprovalPath" in parsed, false);
});

test("citations must resolve to an exact normalized unit and location", () => {
  const wrongUnit = structuredClone(recommendationPackage()) as Record<
    string,
    unknown
  >;
  (wrongUnit.citations as Array<Record<string, unknown>>)[0]!.unitId =
    "missing";
  assert.throws(
    () => solutionRecommendationPackageSchema.parse(wrongUnit),
    /unknown document unit/,
  );

  const wrongLocation = structuredClone(recommendationPackage()) as Record<
    string,
    unknown
  >;
  (wrongLocation.citations as Array<Record<string, unknown>>)[0]!.location = {
    kind: "line",
    path: document.sourcePath,
    line: 1,
  };
  assert.throws(
    () => solutionRecommendationPackageSchema.parse(wrongLocation),
    /location must match/,
  );
});

test("story draft validation rejects unknown and cyclic dependencies", () => {
  const unknown = storyPackage();
  (
    (unknown.stories as Array<Record<string, unknown>>)[0]!
      .dependencyIds as string[]
  ).push("story-missing");
  assert.throws(() => storyDraftPackageSchema.parse(unknown), /unknown dependency/);

  const cyclic = storyPackage();
  const stories = cyclic.stories as Array<Record<string, unknown>>;
  stories.push({
    id: "story-2",
    title: "Configure assignments",
    description: "Configure reviewer assignments.",
    citationIds: [citation.id],
    acceptanceCriteria: [
      {
        id: "ac-2",
        text: "Given reviewer groups, when assignments are configured, then requests are routed to the designated reviewers.",
        citationIds: [citation.id],
      },
    ],
    dependencyIds: ["story-1"],
    assumptions: [],
    questions: [],
  });
  (stories[0]!.dependencyIds as string[]).push("story-2");
  (
    (cyclic.epics as Array<Record<string, unknown>>)[0]!.storyIds as string[]
  ).push("story-2");
  assert.throws(() => storyDraftPackageSchema.parse(cyclic), /dependency cycle/);
});

test("story drafts require Given/When/Then criteria and reject placeholders", () => {
  const declarativeCriterion = storyPackage();
  (
    (
      (declarativeCriterion.stories as Array<Record<string, unknown>>)[0]!
        .acceptanceCriteria as Array<Record<string, unknown>>
    )[0]!
  ).text = "Pending requests are visible to reviewers.";
  assert.throws(
    () => storyDraftPackageSchema.parse(declarativeCriterion),
    /Given \/ When \/ Then format/,
  );

  const incidentalWords = storyPackage();
  (
    (
      (incidentalWords.stories as Array<Record<string, unknown>>)[0]!
        .acceptanceCriteria as Array<Record<string, unknown>>
    )[0]!
  ).text = "The value was given yesterday when it was then processed.";
  assert.throws(
    () => storyDraftPackageSchema.parse(incidentalWords),
    /Given \/ When \/ Then format/,
  );

  const emptyClauses = storyPackage();
  (
    (
      (emptyClauses.stories as Array<Record<string, unknown>>)[0]!
        .acceptanceCriteria as Array<Record<string, unknown>>
    )[0]!
  ).text = "Given when then";
  assert.throws(
    () => storyDraftPackageSchema.parse(emptyClauses),
    /Given \/ When \/ Then format/,
  );

  const placeholder = storyPackage();
  (
    (placeholder.stories as Array<Record<string, unknown>>)[0]!
  ).description = "Provide a queue for APPLICATION NAME reviewers.";
  assert.throws(
    () => storyDraftPackageSchema.parse(placeholder),
    /cannot contain generic client, application, or instance placeholders/,
  );

  const packageQuestionPlaceholder = storyPackage();
  packageQuestionPlaceholder.questions = [
    {
      id: "question-instance",
      text: "Which INSTANCE NAME should receive the change?",
      citationIds: [citation.id],
    },
  ];
  assert.throws(
    () => storyDraftPackageSchema.parse(packageQuestionPlaceholder),
    /cannot contain generic client, application, or instance placeholders/,
  );
});

test("story content must cite a user-designated authoritative document", () => {
  const contextualDocument: NormalizedInputDocument = {
    ...document,
    id: "doc-advisory",
    title: "Advisory recommendation",
    sourcePath: "C:\\inputs\\recommendation.txt",
    units: [
      {
        ...document.units[0]!,
        location: {
          kind: "file",
          path: "C:\\inputs\\recommendation.txt",
        },
      },
    ],
  };
  const contextualCitation = {
    ...citation,
    id: "cite-advisory",
    documentId: contextualDocument.id,
    location: contextualDocument.units[0]!.location,
  };
  const draft = storyPackage();
  draft.documents = [document, contextualDocument];
  draft.sourceInventory = [
    ...sourceInventory,
    {
      path: contextualDocument.sourcePath,
      supported: true,
      readable: true,
      included: true,
      format: contextualDocument.format,
      unitCount: contextualDocument.units.length,
      warnings: [],
    },
  ];
  draft.citations = [citation, contextualCitation];
  const epic = (draft.epics as Array<Record<string, unknown>>)[0]!;
  epic.citationIds = [contextualCitation.id];

  assert.throws(
    () => storyDraftPackageSchema.parse(draft),
    /must cite at least one authoritative document/,
  );
});

test("packages retain a complete inventory of included and excluded inputs", () => {
  const missingInventory = recommendationPackage() as Record<string, unknown>;
  missingInventory.sourceInventory = [];
  assert.throws(
    () => solutionRecommendationPackageSchema.parse(missingInventory),
    /Too small|sourceInventory/i,
  );

  const omittedDocument = recommendationPackage() as Record<string, unknown>;
  omittedDocument.sourceInventory = [
    {
      ...sourceInventory[0],
      included: false,
      warnings: ["Input was omitted."],
    },
  ];
  assert.throws(
    () => solutionRecommendationPackageSchema.parse(omittedDocument),
    /does not match/,
  );

  const duplicateSource = recommendationPackage() as Record<string, unknown>;
  duplicateSource.documents = [
    document,
    { ...document, id: "doc-requirements-copy" },
  ];
  assert.throws(
    () => solutionRecommendationPackageSchema.parse(duplicateSource),
    /Duplicate document source path/,
  );
});

function requirementsPackage(): Record<string, unknown> {
  return {
    contractVersion: ASSISTED_CONTRACT_VERSION,
    packageType: "requirements_extraction",
    packageId: "requirements-001",
    title: "Request review requirements",
    summary: "Extracted requirements for the request review workspace.",
    artifacts: {
      html: "C:\\artifacts\\requirements-extraction-v001.html",
      json: "C:\\artifacts\\requirements-extraction-v001.json",
    },
    sourceInventory,
    documents: [document],
    citations: [citation],
    requirements: [
      {
        id: "req-1",
        title: "Reviewer queue",
        verbatimText: "queue of pending requests",
        type: "functional",
        categories: ["ux"],
        priority: "medium",
        priorityBasis: "inferred",
        isAmbiguous: false,
        citationIds: [citation.id],
      },
    ],
    assumptions: [],
    questions: [],
    warnings: [],
  };
}

test("requirements extraction validates a well-formed register", () => {
  const parsed = requirementsExtractionPackageSchema.parse(
    requirementsPackage(),
  );
  assert.equal(parsed.requirements.length, 1);
  assert.equal(parsed.requirements[0]?.priority, "medium");
});

test("requirements extraction rejects duplicate requirement IDs", () => {
  const duplicateId = requirementsPackage();
  const requirements = duplicateId.requirements as Array<
    Record<string, unknown>
  >;
  requirements.push({ ...requirements[0]! });
  assert.throws(
    () => requirementsExtractionPackageSchema.parse(duplicateId),
    /Duplicate requirement ID/,
  );
});

test("requirements extraction rejects duplicate category tags", () => {
  const duplicateCategory = requirementsPackage();
  (
    (duplicateCategory.requirements as Array<Record<string, unknown>>)[0]!
      .categories as string[]
  ).push("ux");
  assert.throws(
    () => requirementsExtractionPackageSchema.parse(duplicateCategory),
    /duplicate category tags/,
  );
});

test("requirements extraction enforces the ambiguity-note pairing in both directions", () => {
  const missingNote = requirementsPackage();
  (
    (missingNote.requirements as Array<Record<string, unknown>>)[0]!
  ).isAmbiguous = true;
  assert.throws(
    () => requirementsExtractionPackageSchema.parse(missingNote),
    /must include an ambiguityNote/,
  );

  const unexpectedNote = requirementsPackage();
  (
    (unexpectedNote.requirements as Array<Record<string, unknown>>)[0]!
  ).ambiguityNote = "Unclear scope.";
  assert.throws(
    () => requirementsExtractionPackageSchema.parse(unexpectedNote),
    /must not carry an ambiguityNote/,
  );
});

test("requirements extraction enforces consistent priority/priorityBasis pairing", () => {
  const inconsistent = requirementsPackage();
  (
    (inconsistent.requirements as Array<Record<string, unknown>>)[0]!
  ).priority = "unspecified";
  assert.throws(
    () => requirementsExtractionPackageSchema.parse(inconsistent),
    /priority\/priorityBasis pairing is inconsistent/,
  );
});

test("requirements extraction rejects verbatimText not grounded in a cited quote", () => {
  const ungrounded = requirementsPackage();
  (
    (ungrounded.requirements as Array<Record<string, unknown>>)[0]!
  ).verbatimText = "a sentence never actually quoted";
  assert.throws(
    () => requirementsExtractionPackageSchema.parse(ungrounded),
    /verbatimText must exactly match the quote/,
  );
});

test("requirements extraction rejects unknown citation references", () => {
  const unknownCitation = requirementsPackage();
  (
    (unknownCitation.requirements as Array<Record<string, unknown>>)[0]!
      .citationIds as string[]
  ).push("cite-missing");
  assert.throws(
    () => requirementsExtractionPackageSchema.parse(unknownCitation),
    /unknown citation/,
  );
});

test("requirements extraction rejects a splitGroupId shared by only one entry", () => {
  const lonelySplit = requirementsPackage();
  (
    (lonelySplit.requirements as Array<Record<string, unknown>>)[0]!
  ).splitGroupId = "split-1";
  assert.throws(
    () => requirementsExtractionPackageSchema.parse(lonelySplit),
    /must be shared by at least two requirement entries/,
  );
});

test("requirements extraction rejects splitGroupId siblings citing different documents", () => {
  const secondDocument: NormalizedInputDocument = {
    ...document,
    id: "doc-requirements-2",
    title: "Supplemental requirements",
    sourcePath: "C:\\inputs\\requirements-2.txt",
    units: [
      {
        ...document.units[0]!,
        text: "Approvers need a mobile-friendly review screen.",
        location: {
          kind: "file",
          path: "C:\\inputs\\requirements-2.txt",
        },
      },
    ],
  };
  const secondCitation = {
    id: "cite-requirement-2",
    documentId: secondDocument.id,
    unitId: "document-text",
    location: secondDocument.units[0]!.location,
    quote: "mobile-friendly review screen",
  };
  const crossDocumentSplit = requirementsPackage();
  crossDocumentSplit.documents = [document, secondDocument];
  crossDocumentSplit.sourceInventory = [
    ...sourceInventory,
    {
      path: secondDocument.sourcePath,
      supported: true,
      readable: true,
      included: true,
      format: secondDocument.format,
      unitCount: secondDocument.units.length,
      warnings: [],
    },
  ];
  crossDocumentSplit.citations = [citation, secondCitation];
  const requirements = crossDocumentSplit.requirements as Array<
    Record<string, unknown>
  >;
  requirements[0]!.splitGroupId = "split-1";
  requirements.push({
    id: "req-2",
    title: "Mobile review screen",
    verbatimText: "mobile-friendly review screen",
    type: "functional",
    categories: ["ux"],
    priority: "medium",
    priorityBasis: "inferred",
    isAmbiguous: false,
    splitGroupId: "split-1",
    citationIds: [secondCitation.id],
  });
  assert.throws(
    () => requirementsExtractionPackageSchema.parse(crossDocumentSplit),
    /splitGroupId 'split-1' members must cite the same source document/,
  );
});
