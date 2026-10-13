import { readFileSync } from "node:fs";
import {
  loeStructuralChangeSchema,
  type LoeFunctionalGroup,
  type LoeStructuralChange,
  type LoeWorkbookStructure,
} from "./assisted-contracts.js";
import { isDirectExecution } from "./direct-execution.js";

function featureNameSet(
  structure: LoeWorkbookStructure,
  groupId: string,
): Set<string> {
  return new Set(
    structure.featureRows
      .filter((featureRow) => featureRow.functionalGroupId === groupId)
      .map((featureRow) => featureRow.feature),
  );
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const value of a) {
    if (b.has(value)) intersection += 1;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 1 : intersection / union;
}

const RENAME_SIMILARITY_THRESHOLD = 0.5;

export function diffLoeWorkbookStructure(
  cached: LoeWorkbookStructure,
  fresh: LoeWorkbookStructure,
): LoeStructuralChange[] {
  const changes: LoeStructuralChange[] = [];

  const cachedGroupsById = new Map(
    cached.functionalGroups.map((group) => [group.id, group]),
  );
  const freshGroupsById = new Map(
    fresh.functionalGroups.map((group) => [group.id, group]),
  );

  const removedIds = [...cachedGroupsById.keys()].filter(
    (id) => !freshGroupsById.has(id),
  );
  const addedIds = [...freshGroupsById.keys()].filter(
    (id) => !cachedGroupsById.has(id),
  );

  const renamedPairs = new Map<string, string>();
  const consumedAdded = new Set<string>();
  for (const removedId of removedIds) {
    const removedFeatures = featureNameSet(cached, removedId);
    let bestMatch: { id: string; score: number } | undefined;
    for (const addedId of addedIds) {
      if (consumedAdded.has(addedId)) continue;
      const score = jaccardSimilarity(
        removedFeatures,
        featureNameSet(fresh, addedId),
      );
      if (!bestMatch || score > bestMatch.score) {
        bestMatch = { id: addedId, score };
      }
    }
    if (bestMatch && bestMatch.score >= RENAME_SIMILARITY_THRESHOLD) {
      renamedPairs.set(removedId, bestMatch.id);
      consumedAdded.add(bestMatch.id);
    }
  }

  for (const [oldId, newId] of renamedPairs) {
    const oldGroup = cachedGroupsById.get(oldId)!;
    const newGroup = freshGroupsById.get(newId)!;
    changes.push({
      kind: "functional_group_renamed",
      description: `Functional group '${oldGroup.name}' appears to have been renamed to '${newGroup.name}'.`,
    });
  }
  for (const removedId of removedIds) {
    if (renamedPairs.has(removedId)) continue;
    const group = cachedGroupsById.get(removedId)!;
    changes.push({
      kind: "functional_group_removed",
      description: `Functional group '${group.name}' is no longer present in the supplied template.`,
    });
  }
  for (const addedId of addedIds) {
    if (consumedAdded.has(addedId)) continue;
    const group = freshGroupsById.get(addedId)!;
    changes.push({
      kind: "functional_group_added",
      description: `New functional group '${group.name}' appears in the supplied template.`,
    });
  }

  const groupIdPairs: [string, string, LoeFunctionalGroup][] = [];
  for (const [oldId, newId] of renamedPairs) {
    groupIdPairs.push([oldId, newId, freshGroupsById.get(newId)!]);
  }
  for (const [id, group] of freshGroupsById) {
    if (cachedGroupsById.has(id)) {
      groupIdPairs.push([id, id, group]);
    }
  }

  for (const [cachedGroupId, freshGroupId, freshGroup] of groupIdPairs) {
    const cachedFeatures = featureNameSet(cached, cachedGroupId);
    const freshFeatures = featureNameSet(fresh, freshGroupId);
    for (const feature of freshFeatures) {
      if (!cachedFeatures.has(feature)) {
        changes.push({
          kind: "feature_row_added",
          description: `New feature '${feature}' appears under functional group '${freshGroup.name}'.`,
        });
      }
    }
    for (const feature of cachedFeatures) {
      if (!freshFeatures.has(feature)) {
        changes.push({
          kind: "feature_row_removed",
          description: `Feature '${feature}' is no longer present under functional group '${freshGroup.name}'.`,
        });
      }
    }
    const cachedByName = new Map(
      cached.featureRows
        .filter((featureRow) => featureRow.functionalGroupId === cachedGroupId)
        .map((featureRow) => [featureRow.feature, featureRow]),
    );
    const freshByName = new Map(
      fresh.featureRows
        .filter((featureRow) => featureRow.functionalGroupId === freshGroupId)
        .map((featureRow) => [featureRow.feature, featureRow]),
    );
    for (const [feature, freshRow] of freshByName) {
      const cachedRow = cachedByName.get(feature);
      if (!cachedRow) continue;
      if (
        cachedRow.simpleDefinition !== freshRow.simpleDefinition ||
        cachedRow.mediumDefinition !== freshRow.mediumDefinition ||
        cachedRow.complexDefinition !== freshRow.complexDefinition
      ) {
        changes.push({
          kind: "feature_row_modified",
          description: `Feature '${feature}' under functional group '${freshGroup.name}' has revised Simple/Medium/Complex definitions.`,
        });
      }
    }
  }

  const cachedColumnRoles = Object.entries(cached.columns);
  for (const [role, cachedCol] of cachedColumnRoles) {
    const freshCol = (fresh.columns as Record<string, string | undefined>)[
      role
    ];
    if (freshCol === undefined) {
      changes.push({
        kind: "column_layout_changed",
        description: `Column role '${role}' (previously column ${cachedCol}) is no longer present.`,
      });
    } else if (freshCol !== cachedCol) {
      changes.push({
        kind: "column_layout_changed",
        description: `Column role '${role}' moved from column ${cachedCol} to column ${freshCol}.`,
      });
    }
  }
  for (const [role, freshCol] of Object.entries(fresh.columns)) {
    if (!(role in cached.columns)) {
      changes.push({
        kind: "column_layout_changed",
        description: `New column role '${role}' detected at column ${freshCol}.`,
      });
    }
  }

  return changes.map((change) => loeStructuralChangeSchema.parse(change));
}

if (isDirectExecution(import.meta.url, process.argv[1])) {
  const [cachedPath, freshPath] = process.argv.slice(2);
  if (!cachedPath || !freshPath) {
    process.stderr.write(
      "Usage: tsx src/diff-loe-workbook.ts <cached-structure.json> <fresh-structure.json>\n",
    );
    process.exitCode = 1;
  } else {
    try {
      const cached = JSON.parse(
        readFileSync(cachedPath, "utf8"),
      ) as LoeWorkbookStructure;
      const fresh = JSON.parse(
        readFileSync(freshPath, "utf8"),
      ) as LoeWorkbookStructure;
      const changes = diffLoeWorkbookStructure(cached, fresh);
      process.stdout.write(`${JSON.stringify(changes, null, 2)}\n`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`Failed to diff LOE workbooks: ${message}\n`);
      process.exitCode = 1;
    }
  }
}
