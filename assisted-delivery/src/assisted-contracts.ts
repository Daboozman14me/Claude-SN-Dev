import { z } from "zod";
import { isAbsolute, relative, resolve } from "node:path";

export const ASSISTED_CONTRACT_VERSION = "1.0.0" as const;

export const assistedDocumentFormatSchema = z.enum([
  "docx",
  "pptx",
  "pdf",
  "html",
  "markdown",
  "txt",
  "json",
]);
export type AssistedDocumentFormat = z.infer<
  typeof assistedDocumentFormatSchema
>;

const filePathSchema = z.string().min(1);
export const assistedSourceLocationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("file"), path: filePathSchema }),
  z.object({
    kind: z.literal("heading"),
    path: filePathSchema,
    heading: z.string().min(1),
    level: z.number().int().positive().optional(),
  }),
  z.object({
    kind: z.literal("paragraph"),
    path: filePathSchema,
    paragraph: z.number().int().positive(),
  }),
  z.object({
    kind: z.literal("table"),
    path: filePathSchema,
    table: z.number().int().positive(),
    row: z.number().int().positive().optional(),
  }),
  z.object({
    kind: z.literal("slide_table"),
    path: filePathSchema,
    slide: z.number().int().positive(),
    table: z.number().int().positive(),
    title: z.string().min(1).optional(),
  }),
  z.object({
    kind: z.literal("slide"),
    path: filePathSchema,
    slide: z.number().int().positive(),
    title: z.string().min(1).optional(),
  }),
  z.object({
    kind: z.literal("speaker_notes"),
    path: filePathSchema,
    slide: z.number().int().positive(),
  }),
  z.object({
    kind: z.literal("page"),
    path: filePathSchema,
    page: z.number().int().positive(),
  }),
  z
    .object({
      kind: z.literal("line"),
      path: filePathSchema,
      line: z.number().int().positive(),
      endLine: z.number().int().positive().optional(),
    })
    .superRefine((value, context) => {
      if (value.endLine !== undefined && value.endLine < value.line) {
        context.addIssue({
          code: "custom",
          path: ["endLine"],
          message: "endLine must not precede line.",
        });
      }
    }),
  z.object({
    kind: z.literal("json_pointer"),
    path: filePathSchema,
    pointer: z.union([z.literal(""), z.string().startsWith("/")]),
  }),
]);
export type AssistedSourceLocation = z.infer<
  typeof assistedSourceLocationSchema
>;

export const assistedDocumentUnitSchema = z.object({
  id: z.string().min(1),
  type: z.enum([
    "heading",
    "document_text",
    "paragraph",
    "table",
    "slide_title",
    "slide_text",
    "speaker_notes",
    "page_text",
    "line",
    "json_value",
  ]),
  text: z.string().min(1),
  location: assistedSourceLocationSchema,
});
export type AssistedDocumentUnit = z.infer<
  typeof assistedDocumentUnitSchema
>;

export const normalizedInputDocumentSchema = z
  .object({
    contractVersion: z.literal(ASSISTED_CONTRACT_VERSION),
    id: z.string().min(1),
    title: z.string().min(1),
    format: assistedDocumentFormatSchema,
    sourcePath: z.string().min(1),
    units: z.array(assistedDocumentUnitSchema),
    warnings: z.array(z.string().min(1)).default([]),
  })
  .superRefine((value, context) => {
    const unitIds = new Set<string>();
    for (const unit of value.units) {
      if (unitIds.has(unit.id)) {
        context.addIssue({
          code: "custom",
          path: ["units", unit.id],
          message: `Duplicate document unit ID '${unit.id}'.`,
        });
      }
      unitIds.add(unit.id);
      if (unit.location.path !== value.sourcePath) {
        context.addIssue({
          code: "custom",
          path: ["units", unit.id, "location", "path"],
          message: `Unit '${unit.id}' location must use the document sourcePath.`,
        });
      }
    }
    if (value.units.length === 0 && value.warnings.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["warnings"],
        message: "A document with no readable units must explain why.",
      });
    }
  });
export type NormalizedInputDocument = z.infer<
  typeof normalizedInputDocumentSchema
>;

export const ingestedFileInventorySchema = z.object({
  path: filePathSchema,
  supported: z.boolean(),
  readable: z.boolean(),
  included: z.boolean(),
  format: assistedDocumentFormatSchema.optional(),
  unitCount: z.number().int().nonnegative(),
  warnings: z.array(z.string().min(1)),
});
export type IngestedFileInventory = z.infer<
  typeof ingestedFileInventorySchema
>;

export const assistedCitationSchema = z.object({
  id: z.string().min(1),
  documentId: z.string().min(1),
  unitId: z.string().min(1),
  location: assistedSourceLocationSchema,
  quote: z.string().min(1).optional(),
});
export type AssistedCitation = z.infer<typeof assistedCitationSchema>;

const citationIdsSchema = z
  .array(z.string().min(1).max(200))
  .max(500)
  .default([]);
const observationSchema = z
  .object({
    id: z.string().min(1).max(200),
    text: z.string().min(1).max(10_000),
    citationIds: citationIdsSchema,
  })
  .strict();

export const assistedResearchEvidenceSchema = z
  .object({
    id: z.string().min(1).max(200),
    table: z.string().min(1).max(200),
    sysId: z.string().min(1).max(100).optional(),
    recordLabel: z.string().min(1).max(1_000).optional(),
    field: z.string().min(1).max(200).optional(),
    scope: z.enum(["application", "direct_dependency"]),
    evidenceFile: filePathSchema.max(4_096),
    queryDescription: z.string().min(1).max(1_000),
  })
  .strict();
export type AssistedResearchEvidence = z.infer<
  typeof assistedResearchEvidenceSchema
>;

export const assistedResearchFindingSchema = z
  .object({
    id: z.string().min(1).max(200),
    category: z.enum([
      "data_model",
      "automation",
      "integration",
      "security",
      "user_experience",
      "operations",
      "other",
    ]),
    title: z.string().min(1).max(500),
    detail: z.string().min(1).max(10_000),
    relevance: z.string().min(1).max(5_000),
    evidenceIds: z.array(z.string().min(1).max(200)).min(1).max(100),
  })
  .strict();
export type AssistedResearchFinding = z.infer<
  typeof assistedResearchFindingSchema
>;

export const assistedResearchInventoryRecordSchema = z
  .object({
    id: z.string().min(1).max(200),
    sysId: z.string().regex(/^[0-9a-f]{32}$/i),
    name: z.string().min(1).max(1_000),
    table: z.string().min(1).max(500).optional(),
    summary: z.string().min(1).max(5_000),
    attributes: z
      .record(z.string().min(1).max(200), z.string().max(5_000).nullable())
      .default({}),
    evidenceIds: z.array(z.string().min(1).max(200)).min(1).max(100),
  })
  .strict();

export const assistedResearchInventoryCategorySchema = z
  .object({
    category: z.string().min(1).max(200),
    count: z.number().int().nonnegative(),
    records: z.array(assistedResearchInventoryRecordSchema).max(10_000),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.count !== value.records.length) {
      context.addIssue({
        code: "custom",
        path: ["records"],
        message:
          "Research inventory count must equal the number of individually retained records.",
      });
    }
  });

export const assistedResearchRelationshipSchema = z
  .object({
    source: z.string().min(1).max(1_000),
    target: z.string().min(1).max(1_000),
    kind: z.enum([
      "extends",
      "references",
      "reads",
      "writes",
      "invokes",
      "transforms_to",
      "triggers",
      "integrates_with",
    ]),
    confidence: z.enum(["confirmed", "derived", "hypothesis"]),
    evidenceIds: z.array(z.string().min(1).max(200)).min(1).max(100),
  })
  .strict();

export const assistedResearchLifecycleValueSchema = z
  .object({
    table: z.string().min(1).max(500),
    field: z.string().min(1).max(200),
    value: z.string().max(500),
    label: z.string().min(1).max(500),
    sequence: z.number().int().optional(),
    active: z.boolean().optional(),
    evidenceIds: z.array(z.string().min(1).max(200)).min(1).max(100),
  })
  .strict();

export const REQUIRED_RESEARCH_INVENTORY_CATEGORIES = [
  "tables",
  "dictionary_fields",
  "business_rules",
  "client_scripts",
  "script_includes",
  "ui_policies",
  "ui_actions",
  "acls",
  "acl_roles",
  "roles",
  "flows",
  "workflows",
  "scripted_rest_apis",
  "scripted_rest_operations",
  "rest_messages",
  "scheduled_jobs",
  "properties",
  "transform_maps",
  "transform_field_maps",
  "fix_scripts",
  "email_notifications",
  "event_registry",
  "inbound_email_actions",
] as const;

export const assistedApplicationResearchPackageSchema = z
  .object({
    contractVersion: z.literal(ASSISTED_CONTRACT_VERSION),
    packageType: z.literal("application_research"),
    packageId: z.string().min(1).max(200),
    title: z.string().min(1).max(500),
    researchedAt: z.string().datetime({ offset: true }),
    application: z
      .object({
        name: z.string().min(1).max(500),
        scope: z.string().min(1).max(200),
        sysId: z.string().min(1).max(100),
        instance: z.string().min(1).max(500),
      })
      .strict(),
    requestContext: z
      .object({
        targetApplication: z.string().min(1).max(500),
        objective: z.string().min(1).max(5_000),
        externalSystems: z
          .array(z.string().min(1).max(500))
          .max(100)
          .default([]),
        designConstraints: z
          .array(z.string().min(1).max(500))
          .max(100)
          .default([]),
        researchScope: z.literal("application_and_direct_dependencies"),
      })
      .strict(),
    summary: z.string().min(1).max(20_000),
    artifactCounts: z
      .array(
        z
          .object({
            category: z.string().min(1).max(200),
            count: z.number().int().nonnegative(),
          })
          .strict(),
      )
      .max(100)
      .default([]),
    inventory: z
      .array(assistedResearchInventoryCategorySchema)
      .min(1)
      .max(200),
    relationships: z.array(assistedResearchRelationshipSchema).max(5_000),
    lifecycle: z.array(assistedResearchLifecycleValueSchema).max(5_000),
    evidence: z.array(assistedResearchEvidenceSchema).min(1).max(500),
    findings: z.array(assistedResearchFindingSchema).min(1).max(100),
    informationToConfirm: z
      .array(observationSchema)
      .length(0, {
        message:
          "Current-state research cannot contain information-to-confirm questions; route them to the solution recommendation.",
      })
      .default([]),
    limitations: z.array(z.string().min(1).max(5_000)).max(50).default([]),
    artifacts: z
      .object({
        markdown: filePathSchema.max(4_096),
        json: filePathSchema.max(4_096),
        evidenceDirectory: filePathSchema.max(4_096),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.requestContext.targetApplication.toLocaleLowerCase() !==
      value.application.name.toLocaleLowerCase()
    ) {
      context.addIssue({
        code: "custom",
        path: ["requestContext", "targetApplication"],
        message:
          "Research package application identity must match the requested target application.",
      });
    }
    if (
      value.requestContext.externalSystems.some(
        (system) =>
          system.toLocaleLowerCase() ===
          value.application.name.toLocaleLowerCase(),
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["requestContext", "externalSystems"],
        message:
          "The target application must not be classified as an external system.",
      });
    }
    const evidenceIds = new Set<string>();
    for (const evidence of value.evidence) {
      if (evidenceIds.has(evidence.id)) {
        context.addIssue({
          code: "custom",
          path: ["evidence", evidence.id],
          message: `Duplicate research evidence ID '${evidence.id}'.`,
        });
      }
      evidenceIds.add(evidence.id);
      const evidenceRelativePath = relative(
        resolve(value.artifacts.evidenceDirectory),
        resolve(evidence.evidenceFile),
      );
      if (
        evidenceRelativePath === "" ||
        evidenceRelativePath.startsWith("..") ||
        isAbsolute(evidenceRelativePath)
      ) {
        context.addIssue({
          code: "custom",
          path: ["evidence", evidence.id, "evidenceFile"],
          message: `Research evidence '${evidence.id}' must be stored under the package evidence directory.`,
        });
      }
    }

    const artifactCounts = new Map<string, number>();
    for (const artifactCount of value.artifactCounts) {
      if (artifactCounts.has(artifactCount.category)) {
        context.addIssue({
          code: "custom",
          path: ["artifactCounts", artifactCount.category],
          message: `Duplicate artifact count category '${artifactCount.category}'.`,
        });
      }
      artifactCounts.set(artifactCount.category, artifactCount.count);
    }

    const inventoryCategories = new Set<string>();
    for (const inventory of value.inventory) {
      if (inventoryCategories.has(inventory.category)) {
        context.addIssue({
          code: "custom",
          path: ["inventory", inventory.category],
          message: `Duplicate research inventory category '${inventory.category}'.`,
        });
      }
      inventoryCategories.add(inventory.category);
      if (artifactCounts.get(inventory.category) !== inventory.count) {
        context.addIssue({
          code: "custom",
          path: ["inventory", inventory.category, "count"],
          message: `Research inventory category '${inventory.category}' must match artifactCounts.`,
        });
      }
      const recordIds = new Set<string>();
      const recordSysIds = new Set<string>();
      for (const record of inventory.records) {
        if (recordIds.has(record.id)) {
          context.addIssue({
            code: "custom",
            path: ["inventory", inventory.category, record.id],
            message: `Duplicate inventory record ID '${record.id}' in category '${inventory.category}'.`,
          });
        }
        recordIds.add(record.id);
        if (record.sysId) {
          const normalizedSysId = record.sysId.toLocaleLowerCase();
          if (recordSysIds.has(normalizedSysId)) {
            context.addIssue({
              code: "custom",
              path: ["inventory", inventory.category, record.id, "sysId"],
              message: `Duplicate inventory sys_id '${record.sysId}' in category '${inventory.category}'.`,
            });
          }
          recordSysIds.add(normalizedSysId);
        }
        for (const evidenceId of record.evidenceIds) {
          if (!evidenceIds.has(evidenceId)) {
            context.addIssue({
              code: "custom",
              path: ["inventory", inventory.category, record.name, "evidenceIds"],
              message: `Inventory record '${record.name}' references unknown evidence '${evidenceId}'.`,
            });
          }
        }
      }
    }
    for (const category of artifactCounts.keys()) {
      if (!inventoryCategories.has(category)) {
        context.addIssue({
          code: "custom",
          path: ["inventory"],
          message: `Artifact count category '${category}' is missing from the research inventory.`,
        });
      }
    }
    for (const category of REQUIRED_RESEARCH_INVENTORY_CATEGORIES) {
      if (!inventoryCategories.has(category)) {
        context.addIssue({
          code: "custom",
          path: ["inventory"],
          message: `Required research inventory category '${category}' is missing.`,
        });
      }
    }
    for (const relationship of value.relationships) {
      for (const evidenceId of relationship.evidenceIds) {
        if (!evidenceIds.has(evidenceId)) {
          context.addIssue({
            code: "custom",
            path: ["relationships", relationship.source, relationship.target],
            message: `Research relationship references unknown evidence '${evidenceId}'.`,
          });
        }
      }
    }
    for (const lifecycleValue of value.lifecycle) {
      for (const evidenceId of lifecycleValue.evidenceIds) {
        if (!evidenceIds.has(evidenceId)) {
          context.addIssue({
            code: "custom",
            path: ["lifecycle", lifecycleValue.table, lifecycleValue.field],
            message: `Research lifecycle value references unknown evidence '${evidenceId}'.`,
          });
        }
      }
    }

    const findingIds = new Set<string>();
    for (const finding of value.findings) {
      if (findingIds.has(finding.id)) {
        context.addIssue({
          code: "custom",
          path: ["findings", finding.id],
          message: `Duplicate research finding ID '${finding.id}'.`,
        });
      }
      findingIds.add(finding.id);
      for (const evidenceId of finding.evidenceIds) {
        if (!evidenceIds.has(evidenceId)) {
          context.addIssue({
            code: "custom",
            path: ["findings", finding.id, "evidenceIds"],
            message: `Finding '${finding.id}' references unknown evidence '${evidenceId}'.`,
          });
        }
      }
    }
  });
export type AssistedApplicationResearchPackage = z.infer<
  typeof assistedApplicationResearchPackageSchema
>;

function validateDocumentsAndCitations(
  documents: readonly NormalizedInputDocument[],
  citations: readonly AssistedCitation[],
  context: z.RefinementCtx,
): void {
  const documentsById = new Map<string, NormalizedInputDocument>();
  for (const document of documents) {
    if (documentsById.has(document.id)) {
      context.addIssue({
        code: "custom",
        path: ["documents", document.id],
        message: `Duplicate document ID '${document.id}'.`,
      });
    }
    documentsById.set(document.id, document);
  }

  const citationIds = new Set<string>();
  for (const citation of citations) {
    if (citationIds.has(citation.id)) {
      context.addIssue({
        code: "custom",
        path: ["citations", citation.id],
        message: `Duplicate citation ID '${citation.id}'.`,
      });
    }
    citationIds.add(citation.id);
    const document = documentsById.get(citation.documentId);
    const unit = document?.units.find(
      (candidate) => candidate.id === citation.unitId,
    );
    if (!document) {
      context.addIssue({
        code: "custom",
        path: ["citations", citation.id, "documentId"],
        message: `Citation '${citation.id}' references an unknown document.`,
      });
    } else if (!unit) {
      context.addIssue({
        code: "custom",
        path: ["citations", citation.id, "unitId"],
        message: `Citation '${citation.id}' references an unknown document unit.`,
      });
    } else {
      if (
        JSON.stringify(citation.location) !== JSON.stringify(unit.location)
      ) {
        context.addIssue({
          code: "custom",
          path: ["citations", citation.id, "location"],
          message: `Citation '${citation.id}' location must match its document unit.`,
        });
      }
      if (citation.quote && !unit.text.includes(citation.quote)) {
        context.addIssue({
          code: "custom",
          path: ["citations", citation.id, "quote"],
          message: `Citation '${citation.id}' quote is not present in its document unit.`,
        });
      }
    }
  }
}

function validateSourceInventory(
  inventory: readonly IngestedFileInventory[],
  documents: readonly NormalizedInputDocument[],
  context: z.RefinementCtx,
): void {
  const inventoryByPath = new Map<string, IngestedFileInventory>();
  for (const entry of inventory) {
    if (inventoryByPath.has(entry.path)) {
      context.addIssue({
        code: "custom",
        path: ["sourceInventory", entry.path],
        message: `Duplicate source inventory path '${entry.path}'.`,
      });
    }
    inventoryByPath.set(entry.path, entry);
    if (!entry.included && entry.warnings.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["sourceInventory", entry.path, "warnings"],
        message: `Excluded input '${entry.path}' must explain why it was not included.`,
      });
    }
  }

  const documentsByPath = new Map(
    documents.map((document) => [document.sourcePath, document]),
  );
  if (documentsByPath.size !== documents.length) {
    const seen = new Set<string>();
    for (const document of documents) {
      if (seen.has(document.sourcePath)) {
        context.addIssue({
          code: "custom",
          path: ["documents", document.id, "sourcePath"],
          message: `Duplicate document source path '${document.sourcePath}'.`,
        });
      }
      seen.add(document.sourcePath);
    }
  }
  for (const document of documents) {
    const entry = inventoryByPath.get(document.sourcePath);
    if (!entry) {
      context.addIssue({
        code: "custom",
        path: ["documents", document.id, "sourcePath"],
        message: `Document '${document.id}' is missing from sourceInventory.`,
      });
      continue;
    }
    if (
      !entry.supported ||
      !entry.included ||
      entry.format !== document.format ||
      entry.unitCount !== document.units.length ||
      entry.readable !== (document.units.length > 0)
    ) {
      context.addIssue({
        code: "custom",
        path: ["sourceInventory", entry.path],
        message: `Inventory entry for '${entry.path}' does not match its normalized document.`,
      });
    }
  }
  for (const entry of inventory) {
    if (entry.included !== documentsByPath.has(entry.path)) {
      context.addIssue({
        code: "custom",
        path: ["sourceInventory", entry.path, "included"],
        message: `Inventory inclusion for '${entry.path}' does not match the package documents.`,
      });
    }
  }
}

function validateCitationReferences(
  references: readonly { id: string; citationIds: readonly string[] }[],
  citations: readonly AssistedCitation[],
  path: string,
  context: z.RefinementCtx,
): void {
  const known = new Set(citations.map((citation) => citation.id));
  for (const reference of references) {
    for (const citationId of reference.citationIds) {
      if (!known.has(citationId)) {
        context.addIssue({
          code: "custom",
          path: [path, reference.id, "citationIds"],
          message: `'${reference.id}' references unknown citation '${citationId}'.`,
        });
      }
    }
  }
}

export const solutionRecommendationSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  rationale: z.string().min(1),
  implementationConsiderations: z.array(z.string().min(1)).default([]),
  citationIds: z.array(z.string().min(1)).min(1),
});

export const solutionAlternativeSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  tradeoffs: z.array(z.string().min(1)).min(1),
  citationIds: citationIdsSchema,
});

export const solutionRiskSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  mitigation: z.string().min(1).optional(),
  citationIds: citationIdsSchema,
});

const assistedArtifactPairSchema = z
  .object({
    html: filePathSchema.max(4_096),
    json: filePathSchema.max(4_096),
  })
  .strict();

export const solutionRecommendationPackageSchema = z
  .object({
    contractVersion: z.literal(ASSISTED_CONTRACT_VERSION),
    packageType: z.literal("solution_recommendation"),
    packageId: z.string().min(1),
    title: z.string().min(1),
    summary: z.string().min(1),
    artifacts: assistedArtifactPairSchema,
    sourceInventory: z.array(ingestedFileInventorySchema).min(1),
    documents: z.array(normalizedInputDocumentSchema).min(1),
    citations: z.array(assistedCitationSchema).min(1),
    recommendations: z.array(solutionRecommendationSchema).min(1),
    alternatives: z.array(solutionAlternativeSchema).default([]),
    risks: z.array(solutionRiskSchema).default([]),
    assumptions: z.array(observationSchema).default([]),
    questions: z.array(observationSchema).default([]),
    warnings: z.array(z.string().min(1)).default([]),
  })
  .superRefine((value, context) => {
    validateSourceInventory(value.sourceInventory, value.documents, context);
    validateDocumentsAndCitations(value.documents, value.citations, context);
    validateCitationReferences(
      [
        ...value.recommendations,
        ...value.alternatives,
        ...value.risks,
        ...value.assumptions,
        ...value.questions,
      ],
      value.citations,
      "recommendationContent",
      context,
    );
  });
export type SolutionRecommendationPackage = z.infer<
  typeof solutionRecommendationPackageSchema
>;

export const TECHNICAL_DESIGN_AREAS = [
  "architecture",
  "data_model",
  "server_logic",
  "client_experience",
  "security",
  "integration",
  "automation",
  "operations",
  "migration",
  "testing",
] as const;
const technicalDesignAreaSchema = z.enum(TECHNICAL_DESIGN_AREAS);

export const technicalDesignDecisionSchema = z
  .object({
    id: z.string().min(1).max(200),
    area: technicalDesignAreaSchema,
    title: z.string().min(1).max(500),
    design: z.string().min(1).max(20_000),
    rationale: z.string().min(1).max(10_000),
    affectedArtifacts: z
      .array(
        z
          .object({
            name: z.string().min(1).max(1_000),
            type: z.string().min(1).max(500),
            action: z.enum(["create", "modify", "reuse", "retire"]),
            behavior: z.string().min(1).max(10_000),
          })
          .strict(),
      )
      .min(1)
      .max(500),
    citationIds: z.array(z.string().min(1).max(200)).min(1).max(100),
  })
  .strict();

export const technicalDesignEvaluationFindingSchema = z
  .object({
    id: z.string().min(1).max(200),
    area: technicalDesignAreaSchema,
    coverage: z.enum(["addressed", "partial", "missing", "not_applicable"]),
    severity: z.enum(["high", "medium", "low", "advisory"]),
    title: z.string().min(1).max(500),
    observation: z.string().min(1).max(20_000),
    impact: z.string().min(1).max(10_000),
    recommendation: z.string().min(1).max(10_000),
    citationIds: z.array(z.string().min(1).max(200)).min(1).max(100),
  })
  .strict();

export const technicalDesignCoverageSchema = z
  .object({
    area: technicalDesignAreaSchema,
    coverage: z.enum(["addressed", "partial", "missing", "not_applicable"]),
    explanation: z.string().min(1).max(10_000),
    citationIds: z.array(z.string().min(1).max(200)).min(1).max(100),
  })
  .strict();

const technicalDesignArtifactPairSchema = z
  .object({
    markdown: filePathSchema.max(4_096),
    json: filePathSchema.max(4_096),
  })
  .strict();

export const technicalDesignPackageSchema = z
  .object({
    contractVersion: z.literal(ASSISTED_CONTRACT_VERSION),
    packageType: z.literal("technical_design"),
    packageId: z.string().min(1).max(200),
    mode: z.enum(["design", "evaluation"]),
    title: z.string().min(1).max(500),
    application: z.string().min(1).max(500),
    objective: z.string().min(1).max(5_000),
    summary: z.string().min(1).max(20_000),
    evaluatedDesignDocumentId: z.string().min(1).max(200).nullable(),
    artifacts: technicalDesignArtifactPairSchema,
    sourceInventory: z.array(ingestedFileInventorySchema).min(1),
    documents: z.array(normalizedInputDocumentSchema).min(1),
    citations: z.array(assistedCitationSchema).min(1),
    currentStateConstraints: z.array(observationSchema).default([]),
    designDecisions: z.array(technicalDesignDecisionSchema).max(500).default([]),
    evaluationCoverage: z
      .array(technicalDesignCoverageSchema)
      .max(TECHNICAL_DESIGN_AREAS.length)
      .default([]),
    evaluationFindings: z
      .array(technicalDesignEvaluationFindingSchema)
      .max(500)
      .default([]),
    risks: z.array(solutionRiskSchema).default([]),
    assumptions: z.array(observationSchema).default([]),
    questions: z.array(observationSchema).default([]),
    warnings: z.array(z.string().min(1).max(5_000)).default([]),
  })
  .strict()
  .superRefine((value, context) => {
    validateSourceInventory(value.sourceInventory, value.documents, context);
    validateDocumentsAndCitations(value.documents, value.citations, context);
    validateCitationReferences(
      [
        ...value.currentStateConstraints,
        ...value.designDecisions,
        ...value.evaluationCoverage.map((coverage) => ({
          ...coverage,
          id: coverage.area,
        })),
        ...value.evaluationFindings,
        ...value.risks,
        ...value.assumptions,
        ...value.questions,
      ],
      value.citations,
      "technicalDesignContent",
      context,
    );
    if (value.mode === "design" && value.designDecisions.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["designDecisions"],
        message: "Design mode requires at least one technical design decision.",
      });
    }
    if (
      value.mode === "design" &&
      value.evaluatedDesignDocumentId !== null
    ) {
      context.addIssue({
        code: "custom",
        path: ["evaluatedDesignDocumentId"],
        message: "Design mode cannot identify an evaluated design document.",
      });
    }
    if (value.mode === "design" && value.evaluationCoverage.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["evaluationCoverage"],
        message: "Design mode cannot contain evaluation coverage.",
      });
    }
    if (value.mode === "evaluation" && value.evaluationFindings.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["evaluationFindings"],
        message:
          "Evaluation mode requires at least one technical design finding.",
      });
    }
    const designDocument =
      value.mode === "evaluation"
        ? value.documents.find(
            (document) => document.id === value.evaluatedDesignDocumentId,
          )
        : undefined;
    if (value.mode === "evaluation" && !designDocument) {
      context.addIssue({
        code: "custom",
        path: ["evaluatedDesignDocumentId"],
        message:
          "Evaluation mode requires an evaluated design document included in documents.",
      });
    }
    if (value.mode === "evaluation") {
      const coverageAreas = value.evaluationCoverage.map(
        (coverage) => coverage.area,
      );
      const uniqueAreas = new Set(coverageAreas);
      if (
        coverageAreas.length !== TECHNICAL_DESIGN_AREAS.length ||
        uniqueAreas.size !== TECHNICAL_DESIGN_AREAS.length ||
        TECHNICAL_DESIGN_AREAS.some((area) => !uniqueAreas.has(area))
      ) {
        context.addIssue({
          code: "custom",
          path: ["evaluationCoverage"],
          message:
            "Evaluation mode requires exactly one coverage assessment for every technical-design area.",
        });
      }
      const designCitationIds = new Set(
        value.citations
          .filter(
            (citation) =>
              citation.documentId === value.evaluatedDesignDocumentId,
          )
          .map((citation) => citation.id),
      );
      for (const [path, entries] of [
        ["evaluationCoverage", value.evaluationCoverage],
        ["evaluationFindings", value.evaluationFindings],
      ] as const) {
        for (const entry of entries) {
          if (
            !entry.citationIds.some((citationId) =>
              designCitationIds.has(citationId),
            )
          ) {
            context.addIssue({
              code: "custom",
              path: [path, entry.area, "citationIds"],
              message:
                "Evaluation coverage and findings must cite the evaluated design document.",
            });
          }
        }
      }
    }
    if (
      value.mode === "design" &&
      value.evaluationFindings.length > 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["evaluationFindings"],
        message: "Design mode cannot contain evaluation findings.",
      });
    }
    if (
      value.mode === "evaluation" &&
      value.designDecisions.length > 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["designDecisions"],
        message: "Evaluation mode cannot introduce design decisions.",
      });
    }
  });
export type TechnicalDesignPackage = z.infer<
  typeof technicalDesignPackageSchema
>;

const storyDraftContentSchema = z
  .string()
  .min(1)
  .refine(
    (value) =>
      !/\b(?:CLIENT NAME|APPLICATION NAME|INSTANCE NAME)\b/i.test(value),
    "Delivered Story content cannot contain generic client, application, or instance placeholders.",
  );

const storyDraftObservationSchema = z
  .object({
    id: z.string().min(1).max(200),
    text: storyDraftContentSchema,
    citationIds: citationIdsSchema,
  })
  .strict();

export const assistedAcceptanceCriterionSchema = z.object({
  id: z.string().min(1),
  text: storyDraftContentSchema.refine(
    (value) => {
      const clauses = value
        .trim()
        .match(/^Given\b([\s\S]*?)\bWhen\b([\s\S]*?)\bThen\b([\s\S]*)$/i);
      return (
        clauses !== null &&
        clauses.slice(1).every((clause) => /\w/.test(clause))
      );
    },
    "Acceptance criteria must use explicit Given / When / Then format.",
  ),
  citationIds: z.array(z.string().min(1)).min(1),
});

export const assistedStorySchema = z.object({
  id: z.string().min(1),
  title: storyDraftContentSchema,
  userStory: storyDraftContentSchema.optional(),
  description: storyDraftContentSchema,
  citationIds: z.array(z.string().min(1)).min(1),
  acceptanceCriteria: z.array(assistedAcceptanceCriterionSchema).min(1),
  dependencyIds: z.array(z.string().min(1)).default([]),
  assumptions: z.array(storyDraftContentSchema).default([]),
  questions: z.array(storyDraftContentSchema).default([]),
});

export const assistedEpicSchema = z.object({
  id: z.string().min(1),
  title: storyDraftContentSchema,
  objective: storyDraftContentSchema,
  storyIds: z.array(z.string().min(1)).min(1),
  citationIds: z.array(z.string().min(1)).min(1),
});

export const storyDraftPackageSchema = z
  .object({
    contractVersion: z.literal(ASSISTED_CONTRACT_VERSION),
    packageType: z.literal("story_draft"),
    packageId: z.string().min(1),
    title: storyDraftContentSchema,
    artifacts: assistedArtifactPairSchema,
    sourceInventory: z.array(ingestedFileInventorySchema).min(1),
    documents: z.array(normalizedInputDocumentSchema).min(1),
    authoritativeDocumentIds: z.array(z.string().min(1)).min(1),
    citations: z.array(assistedCitationSchema).min(1),
    epics: z.array(assistedEpicSchema).min(1),
    stories: z.array(assistedStorySchema).min(1),
    assumptions: z.array(storyDraftObservationSchema).default([]),
    questions: z.array(storyDraftObservationSchema).default([]),
    warnings: z.array(storyDraftContentSchema).default([]),
  })
  .superRefine((value, context) => {
    validateSourceInventory(value.sourceInventory, value.documents, context);
    validateDocumentsAndCitations(value.documents, value.citations, context);
    const documentIds = new Set(value.documents.map((document) => document.id));
    const authoritativeDocumentIds = new Set<string>();
    for (const documentId of value.authoritativeDocumentIds) {
      if (authoritativeDocumentIds.has(documentId)) {
        context.addIssue({
          code: "custom",
          path: ["authoritativeDocumentIds"],
          message: `Duplicate authoritative document '${documentId}'.`,
        });
      }
      authoritativeDocumentIds.add(documentId);
      if (!documentIds.has(documentId)) {
        context.addIssue({
          code: "custom",
          path: ["authoritativeDocumentIds"],
          message: `Unknown authoritative document '${documentId}'.`,
        });
      }
    }
    const citations = [
      ...value.epics,
      ...value.stories,
      ...value.stories.flatMap((story) => story.acceptanceCriteria),
      ...value.assumptions,
      ...value.questions,
    ];
    validateCitationReferences(
      citations,
      value.citations,
      "storyContent",
      context,
    );
    const citationsById = new Map(
      value.citations.map((citation) => [citation.id, citation]),
    );
    for (const content of [
      ...value.epics,
      ...value.stories,
      ...value.stories.flatMap((story) => story.acceptanceCriteria),
    ]) {
      const hasAuthoritativeCitation = content.citationIds.some((citationId) => {
        const citation = citationsById.get(citationId);
        return (
          citation !== undefined &&
          authoritativeDocumentIds.has(citation.documentId)
        );
      });
      if (!hasAuthoritativeCitation) {
        context.addIssue({
          code: "custom",
          path: ["storyContent", content.id, "citationIds"],
          message: `'${content.id}' must cite at least one authoritative document.`,
        });
      }
    }

    const storyIds = new Set<string>();
    const storyById = new Map(value.stories.map((story) => [story.id, story]));
    for (const story of value.stories) {
      if (storyIds.has(story.id)) {
        context.addIssue({
          code: "custom",
          path: ["stories", story.id],
          message: `Duplicate story ID '${story.id}'.`,
        });
      }
      storyIds.add(story.id);
      const criterionIds = new Set<string>();
      for (const criterion of story.acceptanceCriteria) {
        if (criterionIds.has(criterion.id)) {
          context.addIssue({
            code: "custom",
            path: ["stories", story.id, "acceptanceCriteria", criterion.id],
            message: `Duplicate acceptance criterion ID '${criterion.id}'.`,
          });
        }
        criterionIds.add(criterion.id);
      }
      for (const dependencyId of story.dependencyIds) {
        if (!storyById.has(dependencyId)) {
          context.addIssue({
            code: "custom",
            path: ["stories", story.id, "dependencyIds"],
            message: `Story '${story.id}' references unknown dependency '${dependencyId}'.`,
          });
        } else if (dependencyId === story.id) {
          context.addIssue({
            code: "custom",
            path: ["stories", story.id, "dependencyIds"],
            message: `Story '${story.id}' cannot depend on itself.`,
          });
        }
      }
    }

    const memberships = new Map<string, number>();
    const epicIds = new Set<string>();
    for (const epic of value.epics) {
      if (epicIds.has(epic.id)) {
        context.addIssue({
          code: "custom",
          path: ["epics", epic.id],
          message: `Duplicate epic ID '${epic.id}'.`,
        });
      }
      epicIds.add(epic.id);
      for (const storyId of epic.storyIds) {
        if (!storyById.has(storyId)) {
          context.addIssue({
            code: "custom",
            path: ["epics", epic.id, "storyIds"],
            message: `Epic '${epic.id}' references unknown story '${storyId}'.`,
          });
        }
        memberships.set(storyId, (memberships.get(storyId) ?? 0) + 1);
      }
    }
    for (const storyId of storyIds) {
      if (memberships.get(storyId) !== 1) {
        context.addIssue({
          code: "custom",
          path: ["stories", storyId],
          message: `Story '${storyId}' must belong to exactly one epic.`,
        });
      }
    }

    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (storyId: string): void => {
      if (visiting.has(storyId)) {
        context.addIssue({
          code: "custom",
          path: ["stories", storyId, "dependencyIds"],
          message: `Story dependency cycle includes '${storyId}'.`,
        });
        return;
      }
      if (visited.has(storyId)) {
        return;
      }
      visiting.add(storyId);
      storyById.get(storyId)?.dependencyIds.forEach(visit);
      visiting.delete(storyId);
      visited.add(storyId);
    };
    storyIds.forEach(visit);
  });
export type StoryDraftPackage = z.infer<typeof storyDraftPackageSchema>;

export const TEST_SCENARIO_CATEGORIES = [
  "functional",
  "validation",
  "permissions",
  "security",
  "integration",
  "negative",
  "regression",
  "recovery",
  "ui",
  "operations",
  "performance",
] as const;

const testPlanAcceptanceCriterionSchema = z
  .object({
    id: z.string().min(1).max(200),
    text: z.string().min(1).max(10_000),
    citationIds: z.array(z.string().min(1).max(200)).min(1).max(100),
  })
  .strict();

const testPlanSourceStorySchema = z
  .object({
    id: z.string().min(1).max(200),
    title: z.string().min(1).max(1_000),
    acceptanceCriteria: z
      .array(testPlanAcceptanceCriterionSchema)
      .max(500),
    citationIds: z.array(z.string().min(1).max(200)).min(1).max(100),
  })
  .strict();

export const testScenarioSchema = z
  .object({
    id: z.string().min(1).max(200),
    storyId: z.string().min(1).max(200),
    acceptanceCriterionIds: z
      .array(z.string().min(1).max(200))
      .min(1)
      .max(100),
    title: z.string().min(1).max(1_000),
    given: z.string().min(1).max(10_000),
    when: z.string().min(1).max(10_000),
    then: z.string().min(1).max(10_000),
    category: z.enum(TEST_SCENARIO_CATEGORIES),
    priority: z.enum(["high", "medium", "low"]),
    source: z.enum(["acceptance_criteria", "inferred"]),
    citationIds: z.array(z.string().min(1).max(200)).min(1).max(100),
  })
  .strict();

export const testCoverageGapSchema = z
  .object({
    id: z.string().min(1).max(200),
    storyId: z.string().min(1).max(200),
    acceptanceCriterionId: z.string().min(1).max(200).nullable(),
    reason: z.enum([
      "missing_acceptance_criteria",
      "vague",
      "conflicting",
      "untestable",
      "missing_detail",
    ]),
    description: z.string().min(1).max(10_000),
    citationIds: z.array(z.string().min(1).max(200)).min(1).max(100),
  })
  .strict();

const testPlanArtifactSchema = z
  .object({
    markdown: filePathSchema.max(4_096),
    json: filePathSchema.max(4_096),
  })
  .strict();

export const testPlanPackageSchema = z
  .object({
    contractVersion: z.literal(ASSISTED_CONTRACT_VERSION),
    packageType: z.literal("test_plan"),
    packageId: z.string().min(1).max(200),
    title: z.string().min(1).max(500),
    application: z.string().min(1).max(500),
    sourceStoryDocumentId: z.string().min(1).max(200),
    artifacts: testPlanArtifactSchema,
    sourceInventory: z.array(ingestedFileInventorySchema).min(1),
    documents: z.array(normalizedInputDocumentSchema).min(1),
    citations: z.array(assistedCitationSchema).min(1),
    stories: z.array(testPlanSourceStorySchema).min(1).max(1_000),
    scenarios: z.array(testScenarioSchema).max(20_000),
    coverageGaps: z.array(testCoverageGapSchema).max(5_000).default([]),
    assumptions: z.array(observationSchema).default([]),
    warnings: z.array(z.string().min(1).max(5_000)).default([]),
  })
  .strict()
  .superRefine((value, context) => {
    validateSourceInventory(value.sourceInventory, value.documents, context);
    validateDocumentsAndCitations(value.documents, value.citations, context);
    if (
      !value.documents.some(
        (document) => document.id === value.sourceStoryDocumentId,
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["sourceStoryDocumentId"],
        message:
          "Test plan sourceStoryDocumentId must identify an included document.",
      });
    }
    validateCitationReferences(
      [
        ...value.stories,
        ...value.stories.flatMap((story) => story.acceptanceCriteria),
        ...value.scenarios,
        ...value.coverageGaps,
        ...value.assumptions,
      ],
      value.citations,
      "testPlanContent",
      context,
    );
    const sourceCitationIds = new Set(
      value.citations
        .filter(
          (citation) => citation.documentId === value.sourceStoryDocumentId,
        )
        .map((citation) => citation.id),
    );
    const storyById = new Map<string, (typeof value.stories)[number]>();
    const criterionToStory = new Map<string, string>();
    for (const story of value.stories) {
      if (storyById.has(story.id)) {
        context.addIssue({
          code: "custom",
          path: ["stories", story.id],
          message: `Duplicate test-plan Story ID '${story.id}'.`,
        });
      }
      storyById.set(story.id, story);
      if (
        !story.citationIds.some((citationId) =>
          sourceCitationIds.has(citationId),
        )
      ) {
        context.addIssue({
          code: "custom",
          path: ["stories", story.id, "citationIds"],
          message: `Test-plan Story '${story.id}' must cite the source Story document.`,
        });
      }
      for (const criterion of story.acceptanceCriteria) {
        if (criterionToStory.has(criterion.id)) {
          context.addIssue({
            code: "custom",
            path: ["stories", story.id, "acceptanceCriteria", criterion.id],
            message: `Duplicate test-plan acceptance criterion ID '${criterion.id}'.`,
          });
        }
        criterionToStory.set(criterion.id, story.id);
        if (
          !criterion.citationIds.some((citationId) =>
            sourceCitationIds.has(citationId),
          )
        ) {
          context.addIssue({
            code: "custom",
            path: [
              "stories",
              story.id,
              "acceptanceCriteria",
              criterion.id,
              "citationIds",
            ],
            message: `Acceptance criterion '${criterion.id}' must cite the source Story document.`,
          });
        }
      }
    }

    const scenarioIds = new Set<string>();
    const coveredStories = new Set<string>();
    const coveredCriteria = new Set<string>();
    for (const scenario of value.scenarios) {
      if (scenarioIds.has(scenario.id)) {
        context.addIssue({
          code: "custom",
          path: ["scenarios", scenario.id],
          message: `Duplicate test scenario ID '${scenario.id}'.`,
        });
      }
      scenarioIds.add(scenario.id);
      if (!storyById.has(scenario.storyId)) {
        context.addIssue({
          code: "custom",
          path: ["scenarios", scenario.id, "storyId"],
          message: `Scenario '${scenario.id}' references unknown Story '${scenario.storyId}'.`,
        });
      } else {
        coveredStories.add(scenario.storyId);
      }
      for (const criterionId of scenario.acceptanceCriterionIds) {
        const criterion = storyById
          .get(scenario.storyId)
          ?.acceptanceCriteria.find(
            (candidate) => candidate.id === criterionId,
          );
        if (!criterion || criterionToStory.get(criterionId) !== scenario.storyId) {
          context.addIssue({
            code: "custom",
            path: ["scenarios", scenario.id, "acceptanceCriterionIds"],
            message: `Scenario '${scenario.id}' references criterion '${criterionId}' outside Story '${scenario.storyId}'.`,
          });
        } else {
          coveredCriteria.add(criterionId);
          if (
            !scenario.citationIds.some((citationId) =>
              criterion.citationIds.includes(citationId),
            )
          ) {
            context.addIssue({
              code: "custom",
              path: ["scenarios", scenario.id, "citationIds"],
              message: `Scenario '${scenario.id}' must cite referenced acceptance criterion '${criterionId}'.`,
            });
          }
        }
      }
      if (
        !scenario.citationIds.some((citationId) =>
          sourceCitationIds.has(citationId),
        )
      ) {
        context.addIssue({
          code: "custom",
          path: ["scenarios", scenario.id, "citationIds"],
          message: `Scenario '${scenario.id}' must cite the source Story document.`,
        });
      }
    }

    const gapIds = new Set<string>();
    const gapStories = new Set<string>();
    const gapCriteria = new Set<string>();
    for (const gap of value.coverageGaps) {
      if (gapIds.has(gap.id)) {
        context.addIssue({
          code: "custom",
          path: ["coverageGaps", gap.id],
          message: `Duplicate coverage-gap ID '${gap.id}'.`,
        });
      }
      gapIds.add(gap.id);
      if (!storyById.has(gap.storyId)) {
        context.addIssue({
          code: "custom",
          path: ["coverageGaps", gap.id, "storyId"],
          message: `Coverage gap '${gap.id}' references unknown Story '${gap.storyId}'.`,
        });
      } else {
        gapStories.add(gap.storyId);
      }
      if (gap.acceptanceCriterionId !== null) {
        if (criterionToStory.get(gap.acceptanceCriterionId) !== gap.storyId) {
          context.addIssue({
            code: "custom",
            path: ["coverageGaps", gap.id, "acceptanceCriterionId"],
            message: `Coverage gap '${gap.id}' references a criterion outside Story '${gap.storyId}'.`,
          });
        } else {
          gapCriteria.add(gap.acceptanceCriterionId);
          const criterion = storyById
            .get(gap.storyId)
            ?.acceptanceCriteria.find(
              (candidate) =>
                candidate.id === gap.acceptanceCriterionId,
            );
          if (
            !gap.citationIds.some((citationId) =>
              criterion?.citationIds.includes(citationId),
            )
          ) {
            context.addIssue({
              code: "custom",
              path: ["coverageGaps", gap.id, "citationIds"],
              message: `Coverage gap '${gap.id}' must cite its acceptance criterion.`,
            });
          }
        }
      } else if (
        !gap.citationIds.some((citationId) =>
          sourceCitationIds.has(citationId),
        )
      ) {
        context.addIssue({
          code: "custom",
          path: ["coverageGaps", gap.id, "citationIds"],
          message: `Story-level coverage gap '${gap.id}' must cite the source Story document.`,
        });
      }
    }
    for (const story of value.stories) {
      if (!coveredStories.has(story.id) && !gapStories.has(story.id)) {
        context.addIssue({
          code: "custom",
          path: ["stories", story.id],
          message: `Story '${story.id}' requires scenarios or a coverage gap.`,
        });
      }
      for (const criterion of story.acceptanceCriteria) {
        if (
          !coveredCriteria.has(criterion.id) &&
          !gapCriteria.has(criterion.id)
        ) {
          context.addIssue({
            code: "custom",
            path: ["stories", story.id, "acceptanceCriteria", criterion.id],
            message: `Acceptance criterion '${criterion.id}' requires a scenario or coverage gap.`,
          });
        }
      }
    }
  });
export type TestPlanPackage = z.infer<typeof testPlanPackageSchema>;

export const REQUIREMENT_TYPES = [
  "functional",
  "non_functional",
  "constraint",
  "assumption",
] as const;

export const REQUIREMENT_CATEGORIES = [
  "integration",
  "security",
  "data",
  "ux",
  "reporting",
  "performance",
  "compliance",
  "operations",
  "other",
] as const;

export const REQUIREMENT_PRIORITY_LEVELS = [
  "high",
  "medium",
  "low",
  "unspecified",
] as const;
export const REQUIREMENT_PRIORITY_BASES = [
  "stated",
  "inferred",
  "not_stated",
] as const;

export const extractedRequirementSchema = z
  .object({
    id: z.string().min(1).max(200),
    title: z.string().min(1).max(500),
    verbatimText: z.string().min(1).max(5_000),
    type: z.enum(REQUIREMENT_TYPES),
    categories: z.array(z.enum(REQUIREMENT_CATEGORIES)).min(1).max(9),
    priority: z.enum(REQUIREMENT_PRIORITY_LEVELS),
    priorityBasis: z.enum(REQUIREMENT_PRIORITY_BASES),
    isAmbiguous: z.boolean(),
    ambiguityNote: z.string().min(1).max(2_000).optional(),
    splitGroupId: z.string().min(1).max(200).optional(),
    citationIds: z.array(z.string().min(1).max(200)).min(1).max(50),
  })
  .strict();
export type ExtractedRequirement = z.infer<typeof extractedRequirementSchema>;

const requirementsExtractionArtifactPairSchema = z
  .object({
    html: filePathSchema.max(4_096),
    json: filePathSchema.max(4_096),
  })
  .strict();

export const requirementsExtractionPackageSchema = z
  .object({
    contractVersion: z.literal(ASSISTED_CONTRACT_VERSION),
    packageType: z.literal("requirements_extraction"),
    packageId: z.string().min(1).max(200),
    title: z.string().min(1).max(500),
    summary: z.string().min(1).max(20_000),
    artifacts: requirementsExtractionArtifactPairSchema,
    sourceInventory: z.array(ingestedFileInventorySchema).min(1),
    documents: z.array(normalizedInputDocumentSchema).min(1),
    citations: z.array(assistedCitationSchema).min(1),
    requirements: z.array(extractedRequirementSchema).min(1).max(5_000),
    assumptions: z.array(observationSchema).default([]),
    questions: z.array(observationSchema).default([]),
    warnings: z.array(z.string().min(1).max(5_000)).default([]),
  })
  .strict()
  .superRefine((value, context) => {
    validateSourceInventory(value.sourceInventory, value.documents, context);
    validateDocumentsAndCitations(value.documents, value.citations, context);
    validateCitationReferences(
      [...value.requirements, ...value.assumptions, ...value.questions],
      value.citations,
      "requirementContent",
      context,
    );

    const citationsById = new Map(
      value.citations.map((citation) => [citation.id, citation]),
    );
    const requirementIds = new Set<string>();
    for (const requirement of value.requirements) {
      if (requirementIds.has(requirement.id)) {
        context.addIssue({
          code: "custom",
          path: ["requirements", requirement.id],
          message: `Duplicate requirement ID '${requirement.id}'.`,
        });
      }
      requirementIds.add(requirement.id);

      if (
        new Set(requirement.categories).size !== requirement.categories.length
      ) {
        context.addIssue({
          code: "custom",
          path: ["requirements", requirement.id, "categories"],
          message: `Requirement '${requirement.id}' lists duplicate category tags.`,
        });
      }

      if (requirement.isAmbiguous && !requirement.ambiguityNote) {
        context.addIssue({
          code: "custom",
          path: ["requirements", requirement.id, "ambiguityNote"],
          message: `Requirement '${requirement.id}' is flagged ambiguous and must include an ambiguityNote.`,
        });
      }
      if (!requirement.isAmbiguous && requirement.ambiguityNote) {
        context.addIssue({
          code: "custom",
          path: ["requirements", requirement.id, "ambiguityNote"],
          message: `Requirement '${requirement.id}' is not flagged ambiguous and must not carry an ambiguityNote.`,
        });
      }

      const basisMatchesLevel =
        (requirement.priority === "unspecified" &&
          requirement.priorityBasis === "not_stated") ||
        (requirement.priority !== "unspecified" &&
          requirement.priorityBasis !== "not_stated");
      if (!basisMatchesLevel) {
        context.addIssue({
          code: "custom",
          path: ["requirements", requirement.id, "priorityBasis"],
          message: `Requirement '${requirement.id}' priority/priorityBasis pairing is inconsistent ('unspecified' must pair with 'not_stated' and vice versa).`,
        });
      }

      const grounded = requirement.citationIds.some(
        (citationId) =>
          citationsById.get(citationId)?.quote === requirement.verbatimText,
      );
      if (!grounded) {
        context.addIssue({
          code: "custom",
          path: ["requirements", requirement.id, "verbatimText"],
          message: `Requirement '${requirement.id}' verbatimText must exactly match the quote of one of its cited citations.`,
        });
      }
    }

    const groups = new Map<string, ExtractedRequirement[]>();
    for (const requirement of value.requirements) {
      if (!requirement.splitGroupId) continue;
      const list = groups.get(requirement.splitGroupId) ?? [];
      list.push(requirement);
      groups.set(requirement.splitGroupId, list);
    }
    for (const [groupId, members] of groups) {
      if (members.length < 2) {
        context.addIssue({
          code: "custom",
          path: ["requirements", groupId, "splitGroupId"],
          message: `splitGroupId '${groupId}' must be shared by at least two requirement entries.`,
        });
      }
      const documentIds = new Set(
        members.flatMap((member) =>
          member.citationIds
            .map((id) => citationsById.get(id)?.documentId)
            .filter((id): id is string => id !== undefined),
        ),
      );
      if (documentIds.size > 1) {
        context.addIssue({
          code: "custom",
          path: ["requirements", groupId, "splitGroupId"],
          message: `splitGroupId '${groupId}' members must cite the same source document.`,
        });
      }
    }
  });
export type RequirementsExtractionPackage = z.infer<
  typeof requirementsExtractionPackageSchema
>;

export const LOE_WORKBOOK_COLUMN_ROLES = [
  "action",
  "functional_group",
  "feature",
  "simple_definition",
  "medium_definition",
  "complex_definition",
  "help",
  "user_story",
  "user_story_abbreviation",
  "user_story_in_out_scope",
  "simple_units",
  "medium_units",
  "complex_units",
  "total_units",
  "line_item_adjustor",
  "comments",
] as const;
export const loeWorkbookColumnRoleSchema = z.enum(LOE_WORKBOOK_COLUMN_ROLES);
export type LoeWorkbookColumnRole = z.infer<typeof loeWorkbookColumnRoleSchema>;

export const loeFunctionalGroupSchema = z
  .object({
    id: z.string().min(1).max(200),
    name: z.string().min(1).max(500),
    headerRow: z.number().int().positive(),
    firstFeatureRow: z.number().int().positive(),
    lastFeatureRow: z.number().int().positive(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.lastFeatureRow < value.firstFeatureRow) {
      context.addIssue({
        code: "custom",
        path: ["lastFeatureRow"],
        message: "lastFeatureRow must not precede firstFeatureRow.",
      });
    }
    if (value.firstFeatureRow <= value.headerRow) {
      context.addIssue({
        code: "custom",
        path: ["firstFeatureRow"],
        message: "firstFeatureRow must come after headerRow.",
      });
    }
  });
export type LoeFunctionalGroup = z.infer<typeof loeFunctionalGroupSchema>;

export const loeFeatureRowSchema = z
  .object({
    row: z.number().int().positive(),
    functionalGroupId: z.string().min(1).max(200),
    feature: z.string().min(1).max(1_000),
    simpleDefinition: z.string().max(10_000).optional(),
    mediumDefinition: z.string().max(10_000).optional(),
    complexDefinition: z.string().max(10_000).optional(),
    helpText: z.string().max(10_000).optional(),
  })
  .strict();
export type LoeFeatureRow = z.infer<typeof loeFeatureRowSchema>;

export const loeWorkbookStructureSchema = z
  .object({
    templateFileName: z.string().min(1).max(1_000),
    templateFingerprint: z.string().min(1).max(200),
    capturedAt: z.string().datetime({ offset: true }),
    sheetName: z.literal("Module Scope"),
    headerRow: z.number().int().positive(),
    columns: z.record(z.string().min(1), z.string().regex(/^[A-Z]+$/)),
    functionalGroups: z.array(loeFunctionalGroupSchema).min(1).max(2_000),
    featureRows: z.array(loeFeatureRowSchema).min(1).max(20_000),
  })
  .strict()
  .superRefine((value, context) => {
    for (const role of Object.keys(value.columns)) {
      if (!LOE_WORKBOOK_COLUMN_ROLES.includes(role as LoeWorkbookColumnRole)) {
        context.addIssue({
          code: "custom",
          path: ["columns", role],
          message: `Unknown LOE workbook column role '${role}'.`,
        });
      }
    }
    for (const requiredRole of ["action", "functional_group", "feature"] as const) {
      if (!value.columns[requiredRole]) {
        context.addIssue({
          code: "custom",
          path: ["columns", requiredRole],
          message: `LOE workbook structure is missing required column role '${requiredRole}'.`,
        });
      }
    }
    const groupIds = new Set<string>();
    for (const group of value.functionalGroups) {
      if (groupIds.has(group.id)) {
        context.addIssue({
          code: "custom",
          path: ["functionalGroups", group.id],
          message: `Duplicate functional group ID '${group.id}'.`,
        });
      }
      groupIds.add(group.id);
    }
    const rows = new Set<number>();
    for (const featureRow of value.featureRows) {
      if (rows.has(featureRow.row)) {
        context.addIssue({
          code: "custom",
          path: ["featureRows", featureRow.row],
          message: `Duplicate feature row '${featureRow.row}'.`,
        });
      }
      rows.add(featureRow.row);
      if (!groupIds.has(featureRow.functionalGroupId)) {
        context.addIssue({
          code: "custom",
          path: ["featureRows", featureRow.row, "functionalGroupId"],
          message: `Feature row '${featureRow.row}' references unknown functional group '${featureRow.functionalGroupId}'.`,
        });
      }
    }
  });
export type LoeWorkbookStructure = z.infer<typeof loeWorkbookStructureSchema>;

export const LOE_STRUCTURAL_CHANGE_KINDS = [
  "functional_group_added",
  "functional_group_removed",
  "functional_group_renamed",
  "feature_row_added",
  "feature_row_removed",
  "feature_row_modified",
  "column_layout_changed",
] as const;

export const loeStructuralChangeSchema = z
  .object({
    kind: z.enum(LOE_STRUCTURAL_CHANGE_KINDS),
    description: z.string().min(1).max(2_000),
  })
  .strict();
export type LoeStructuralChange = z.infer<typeof loeStructuralChangeSchema>;

export const LOE_SCOPE_DECISIONS = ["in_scope", "out_of_scope"] as const;
export const loeScopeDecisionSchema = z.enum(LOE_SCOPE_DECISIONS);

export const LOE_EVIDENCE_BASIS = ["stated", "derived"] as const;
export const loeEvidenceBasisSchema = z.enum(LOE_EVIDENCE_BASIS);

export const LOE_SIZING_BASIS = ["stated", "benchmark"] as const;
export const loeSizingBasisSchema = z.enum(LOE_SIZING_BASIS);

export const loeScopingDecisionSchema = z
  .object({
    id: z.string().min(1).max(200),
    row: z.number().int().positive(),
    functionalGroupId: z.string().min(1).max(200),
    feature: z.string().min(1).max(1_000),
    decision: loeScopeDecisionSchema,
    evidenceBasis: loeEvidenceBasisSchema,
    derivationRationale: z.string().min(1).max(2_000).optional(),
    simpleUnits: z.number().int().nonnegative().default(0),
    mediumUnits: z.number().int().nonnegative().default(0),
    complexUnits: z.number().int().nonnegative().default(0),
    sizingBasis: loeSizingBasisSchema.optional(),
    benchmarkRationale: z.string().min(1).max(2_000).optional(),
    comment: z.string().min(1).max(2_000).optional(),
    rationale: z.string().min(1).max(5_000),
    isAmbiguous: z.boolean(),
    ambiguityNote: z.string().min(1).max(2_000).optional(),
    citationIds: z.array(z.string().min(1).max(200)).min(1).max(500),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.isAmbiguous && !value.ambiguityNote) {
      context.addIssue({
        code: "custom",
        path: ["ambiguityNote"],
        message: `Decision '${value.id}' is flagged ambiguous and must include an ambiguityNote.`,
      });
    }
    if (!value.isAmbiguous && value.ambiguityNote) {
      context.addIssue({
        code: "custom",
        path: ["ambiguityNote"],
        message: `Decision '${value.id}' is not flagged ambiguous and must not carry an ambiguityNote.`,
      });
    }
    if (value.evidenceBasis === "derived" && !value.derivationRationale) {
      context.addIssue({
        code: "custom",
        path: ["derivationRationale"],
        message: `Decision '${value.id}' has evidenceBasis 'derived' and must include a derivationRationale.`,
      });
    }
    if (value.evidenceBasis === "stated" && value.derivationRationale) {
      context.addIssue({
        code: "custom",
        path: ["derivationRationale"],
        message: `Decision '${value.id}' has evidenceBasis 'stated' and must not carry a derivationRationale.`,
      });
    }
    if (value.decision === "out_of_scope" && value.evidenceBasis !== "stated") {
      context.addIssue({
        code: "custom",
        path: ["evidenceBasis"],
        message: `Decision '${value.id}' is out_of_scope and must have evidenceBasis 'stated' — exclusions are never derived.`,
      });
    }
    if (value.sizingBasis === "benchmark" && !value.benchmarkRationale) {
      context.addIssue({
        code: "custom",
        path: ["benchmarkRationale"],
        message: `Decision '${value.id}' has sizingBasis 'benchmark' and must include a benchmarkRationale.`,
      });
    }
    if (value.sizingBasis === "stated" && value.benchmarkRationale) {
      context.addIssue({
        code: "custom",
        path: ["benchmarkRationale"],
        message: `Decision '${value.id}' has sizingBasis 'stated' and must not carry a benchmarkRationale.`,
      });
    }
    const totalUnits =
      value.simpleUnits + value.mediumUnits + value.complexUnits;
    if (value.decision === "out_of_scope" && totalUnits !== 0) {
      context.addIssue({
        code: "custom",
        path: ["decision"],
        message: `Decision '${value.id}' is out_of_scope and must have zero Simple/Medium/Complex units.`,
      });
    }
    if (value.decision === "out_of_scope" && value.sizingBasis) {
      context.addIssue({
        code: "custom",
        path: ["sizingBasis"],
        message: `Decision '${value.id}' is out_of_scope and must not carry a sizingBasis.`,
      });
    }
    if (
      value.decision === "in_scope" &&
      totalUnits === 0 &&
      !value.isAmbiguous
    ) {
      context.addIssue({
        code: "custom",
        path: ["decision"],
        message: `Decision '${value.id}' is in_scope with zero units and must either state nonzero units or be flagged isAmbiguous with an explanatory note.`,
      });
    }
    if (value.isAmbiguous && totalUnits !== 0) {
      context.addIssue({
        code: "custom",
        path: ["isAmbiguous"],
        message: `Decision '${value.id}' is flagged ambiguous and must have zero Simple/Medium/Complex units — an ambiguous row cannot also carry a sizingBasis.`,
      });
    }
    if (value.decision === "in_scope" && totalUnits > 0 && !value.sizingBasis) {
      context.addIssue({
        code: "custom",
        path: ["sizingBasis"],
        message: `Decision '${value.id}' has nonzero units and must declare a sizingBasis ('stated' or 'benchmark').`,
      });
    }
  });
export type LoeScopingDecision = z.infer<typeof loeScopingDecisionSchema>;

const loeArtifactSetSchema = z
  .object({
    html: filePathSchema.max(4_096),
    json: filePathSchema.max(4_096),
    xlsm: filePathSchema.max(4_096).optional(),
  })
  .strict();

export const levelOfEffortPackageSchema = z
  .object({
    contractVersion: z.literal(ASSISTED_CONTRACT_VERSION),
    packageType: z.literal("level_of_effort"),
    packageId: z.string().min(1).max(200),
    title: z.string().min(1).max(500),
    summary: z.string().min(1).max(20_000),
    artifacts: loeArtifactSetSchema,
    requirementsSourcePackageId: z.string().min(1).max(200),
    sourceInventory: z.array(ingestedFileInventorySchema).min(1),
    documents: z.array(normalizedInputDocumentSchema).min(1),
    citations: z.array(assistedCitationSchema).min(1),
    workbookStructure: loeWorkbookStructureSchema,
    structuralChanges: z.array(loeStructuralChangeSchema).default([]),
    decisions: z.array(loeScopingDecisionSchema).min(1).max(20_000),
    assumptions: z.array(observationSchema).default([]),
    questions: z.array(observationSchema).default([]),
    warnings: z.array(z.string().min(1).max(5_000)).default([]),
  })
  .strict()
  .superRefine((value, context) => {
    validateSourceInventory(value.sourceInventory, value.documents, context);
    validateDocumentsAndCitations(value.documents, value.citations, context);
    validateCitationReferences(
      [...value.decisions, ...value.assumptions, ...value.questions],
      value.citations,
      "levelOfEffortContent",
      context,
    );

    const groupIds = new Set(
      value.workbookStructure.functionalGroups.map((group) => group.id),
    );
    const rows = new Set(
      value.workbookStructure.featureRows.map((featureRow) => featureRow.row),
    );
    const decisionIds = new Set<string>();
    const decidedRows = new Set<number>();
    for (const decision of value.decisions) {
      if (decisionIds.has(decision.id)) {
        context.addIssue({
          code: "custom",
          path: ["decisions", decision.id],
          message: `Duplicate decision ID '${decision.id}'.`,
        });
      }
      decisionIds.add(decision.id);
      if (decidedRows.has(decision.row)) {
        context.addIssue({
          code: "custom",
          path: ["decisions", decision.id, "row"],
          message: `Row '${decision.row}' has more than one scoping decision.`,
        });
      }
      decidedRows.add(decision.row);
      if (!rows.has(decision.row)) {
        context.addIssue({
          code: "custom",
          path: ["decisions", decision.id, "row"],
          message: `Decision '${decision.id}' references unknown workbook row '${decision.row}'.`,
        });
      }
      if (!groupIds.has(decision.functionalGroupId)) {
        context.addIssue({
          code: "custom",
          path: ["decisions", decision.id, "functionalGroupId"],
          message: `Decision '${decision.id}' references unknown functional group '${decision.functionalGroupId}'.`,
        });
      }
    }
  });
export type LevelOfEffortPackage = z.infer<typeof levelOfEffortPackageSchema>;

export const programStorageTypeSchema = z.enum(["git", "sharepoint", "local"]);
export type ProgramStorageType = z.infer<typeof programStorageTypeSchema>;

export const programRegistryEntrySchema = z
  .object({
    alias: z.string().min(1),
    client: z.string().min(1),
    program: z.string().min(1),
    storageType: programStorageTypeSchema,
    location: z.string().min(1),
    localRoot: z.string().min(1).optional(),
  })
  .strict();
export type ProgramRegistryEntry = z.infer<typeof programRegistryEntrySchema>;

export const programRegistrySchema = z
  .object({
    programs: z.array(programRegistryEntrySchema).default([]),
  })
  .strict()
  .superRefine((value, context) => {
    const aliases = new Set<string>();
    for (const entry of value.programs) {
      if (aliases.has(entry.alias)) {
        context.addIssue({
          code: "custom",
          path: ["programs", entry.alias],
          message: `Duplicate program alias '${entry.alias}'.`,
        });
      }
      aliases.add(entry.alias);
    }
  });
export type ProgramRegistry = z.infer<typeof programRegistrySchema>;

export const programManifestServiceNowInstanceSchema = z
  .object({
    alias: z.string().min(1),
    url: z.string().min(1).optional(),
  })
  .strict();
export type ProgramManifestServiceNowInstance = z.infer<
  typeof programManifestServiceNowInstanceSchema
>;

export const programManifestProjectSchema = z
  .object({
    application: z.string().min(1),
    repo: z.string().min(1).optional(),
    folder: z.string().min(1).optional(),
    serviceNowInstance: programManifestServiceNowInstanceSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (!value.repo && !value.folder) {
      context.addIssue({
        code: "custom",
        path: ["repo"],
        message: "Project entry must set either 'repo' or 'folder'.",
      });
    }
  });
export type ProgramManifestProject = z.infer<
  typeof programManifestProjectSchema
>;

export const programManifestSchema = z
  .object({
    program: z.string().min(1),
    client: z.string().min(1),
    storageType: programStorageTypeSchema,
    org: z.string().min(1).optional(),
    root: z.string().min(1).optional(),
    projects: z.array(programManifestProjectSchema).default([]),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.storageType === "git" && !value.org) {
      context.addIssue({
        code: "custom",
        path: ["org"],
        message: "Git-backed manifests must set 'org'.",
      });
    }
    if (value.storageType !== "git" && !value.root) {
      context.addIssue({
        code: "custom",
        path: ["root"],
        message: "SharePoint/local manifests must set 'root'.",
      });
    }
    const applications = new Set<string>();
    for (const project of value.projects) {
      if (applications.has(project.application)) {
        context.addIssue({
          code: "custom",
          path: ["projects", project.application],
          message: `Duplicate application '${project.application}'.`,
        });
      }
      applications.add(project.application);
    }
  });
export type ProgramManifest = z.infer<typeof programManifestSchema>;
