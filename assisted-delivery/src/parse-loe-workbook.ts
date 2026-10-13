import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import JSZip from "jszip";
import {
  loeWorkbookStructureSchema,
  type LoeFeatureRow,
  type LoeFunctionalGroup,
  type LoeWorkbookColumnRole,
  type LoeWorkbookStructure,
} from "./assisted-contracts.js";
import { isDirectExecution } from "./direct-execution.js";
import {
  hashFingerprint,
  parseCellsFromRowXml,
  parseDefinedNames,
  parseRows,
  parseSharedStrings,
  resolveSheetTarget,
} from "./loe-workbook-xml.js";

const MODULE_SCOPE_SHEET_NAME = "Module Scope";

const HEADER_LABEL_TO_ROLE: Record<string, LoeWorkbookColumnRole> = {
  Action: "action",
  "Functional Group": "functional_group",
  Features: "feature",
  "Simple Definition": "simple_definition",
  "Medium Definition": "medium_definition",
  "Complex Definition": "complex_definition",
  Help: "help",
  "User Story": "user_story",
  "User Story Abbreviation": "user_story_abbreviation",
  "User Story In/Out Scope": "user_story_in_out_scope",
  "# of Simple Units": "simple_units",
  "# of Medium Units": "medium_units",
  "# of Complex Units": "complex_units",
  "# of Total Units": "total_units",
  "Line Item Adjustor": "line_item_adjustor",
  Comments: "comments",
};

async function readZipText(zip: JSZip, path: string): Promise<string> {
  const file = zip.file(path);
  if (!file) {
    throw new Error(`Workbook is missing expected part '${path}'.`);
  }
  return file.async("string");
}

export async function parseLoeWorkbook(
  path: string,
): Promise<LoeWorkbookStructure> {
  const absolutePath = resolve(path);
  const bytes = readFileSync(absolutePath);
  const zip = await JSZip.loadAsync(bytes);

  const workbookXml = await readZipText(zip, "xl/workbook.xml");
  const workbookRelsXml = await readZipText(
    zip,
    "xl/_rels/workbook.xml.rels",
  );
  const sheetLocation = resolveSheetTarget(
    workbookXml,
    workbookRelsXml,
    MODULE_SCOPE_SHEET_NAME,
  );
  const sheetXml = await readZipText(zip, sheetLocation.target);
  const sharedStringsXml = zip.file("xl/sharedStrings.xml")
    ? await readZipText(zip, "xl/sharedStrings.xml")
    : "";
  const sharedStrings = parseSharedStrings(sharedStringsXml);

  const rows = parseRows(sheetXml);
  const definedNames = parseDefinedNames(workbookXml);
  const startRowName = definedNames.find(
    (name) =>
      name.name === "modules_start_row" &&
      name.sheetName === MODULE_SCOPE_SHEET_NAME,
  );
  const endRowName = definedNames.find(
    (name) =>
      name.name === "modules_end_row" &&
      name.sheetName === MODULE_SCOPE_SHEET_NAME,
  );

  let headerRow: number | undefined;
  let columns: Partial<Record<LoeWorkbookColumnRole, string>> = {};
  for (const [rowNumber, rowXml] of rows) {
    const cells = parseCellsFromRowXml(rowXml, sharedStrings);
    const hasFunctionalGroup = [...cells.values()].some(
      (cell) => cell.value === "Functional Group",
    );
    const hasFeatures = [...cells.values()].some(
      (cell) => cell.value === "Features",
    );
    if (hasFunctionalGroup && hasFeatures) {
      headerRow = rowNumber;
      const resolved: Partial<Record<LoeWorkbookColumnRole, string>> = {};
      for (const cell of cells.values()) {
        const role = HEADER_LABEL_TO_ROLE[cell.value];
        if (role) {
          resolved[role] = cell.col;
        }
      }
      columns = resolved;
      break;
    }
  }
  if (headerRow === undefined) {
    throw new Error(
      `Could not locate the '${MODULE_SCOPE_SHEET_NAME}' header row (expected cells reading 'Functional Group' and 'Features').`,
    );
  }
  for (const requiredRole of ["action", "functional_group", "feature"] as const) {
    if (!columns[requiredRole]) {
      throw new Error(
        `'${MODULE_SCOPE_SHEET_NAME}' header row is missing a column for required role '${requiredRole}'.`,
      );
    }
  }

  const tableStart = startRowName?.startRow ?? headerRow + 1;
  const tableEnd =
    endRowName?.startRow ??
    Math.max(...[...rows.keys()].filter((rowNumber) => rowNumber > headerRow));

  const actionCol = columns.action!;
  const functionalGroupCol = columns.functional_group!;
  const featureCol = columns.feature!;
  const simpleDefCol = columns.simple_definition;
  const mediumDefCol = columns.medium_definition;
  const complexDefCol = columns.complex_definition;
  const helpCol = columns.help;

  const functionalGroups: LoeFunctionalGroup[] = [];
  const featureRows: LoeFeatureRow[] = [];
  let currentGroup: LoeFunctionalGroup | undefined;

  for (let rowNumber = tableStart; rowNumber <= tableEnd; rowNumber += 1) {
    const rowXml = rows.get(rowNumber);
    if (!rowXml) continue;
    const cells = parseCellsFromRowXml(rowXml, sharedStrings);
    const actionCell = cells.get(actionCol);
    const groupName = cells.get(functionalGroupCol)?.value.trim();
    const featureName = cells.get(featureCol)?.value.trim();

    if (groupName && actionCell?.hasFormula) {
      if (currentGroup) {
        currentGroup.lastFeatureRow = Math.max(
          currentGroup.lastFeatureRow,
          rowNumber - 1,
        );
      }
      currentGroup = {
        id: slugify(groupName),
        name: groupName,
        headerRow: rowNumber,
        firstFeatureRow: rowNumber + 1,
        lastFeatureRow: rowNumber + 1,
      };
      functionalGroups.push(currentGroup);
      continue;
    }

    if (featureName && !actionCell?.hasFormula && currentGroup) {
      currentGroup.lastFeatureRow = rowNumber;
      featureRows.push({
        row: rowNumber,
        functionalGroupId: currentGroup.id,
        feature: featureName,
        simpleDefinition: simpleDefCol
          ? cells.get(simpleDefCol)?.value || undefined
          : undefined,
        mediumDefinition: mediumDefCol
          ? cells.get(mediumDefCol)?.value || undefined
          : undefined,
        complexDefinition: complexDefCol
          ? cells.get(complexDefCol)?.value || undefined
          : undefined,
        helpText: helpCol ? cells.get(helpCol)?.value || undefined : undefined,
      });
    }
  }

  const fingerprintParts = [
    ...Object.entries(columns)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([role, col]) => `${role}=${col}`),
    ...functionalGroups.map((group) => `group:${group.id}:${group.name}`),
    ...featureRows.map(
      (featureRow) => `row:${featureRow.row}:${featureRow.feature}`,
    ),
  ];

  const structure: LoeWorkbookStructure = {
    templateFileName: absolutePath.split(/[\\/]/).pop() ?? absolutePath,
    templateFingerprint: hashFingerprint(fingerprintParts),
    capturedAt: new Date().toISOString(),
    sheetName: MODULE_SCOPE_SHEET_NAME,
    headerRow,
    columns: columns as Record<LoeWorkbookColumnRole, string>,
    functionalGroups,
    featureRows,
  };

  return loeWorkbookStructureSchema.parse(structure);
}

function slugify(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "group";
}

if (isDirectExecution(import.meta.url, process.argv[1])) {
  const path = process.argv[2];
  if (!path) {
    process.stderr.write(
      "Usage: tsx src/parse-loe-workbook.ts <path-to-xlsm>\n",
    );
    process.exitCode = 1;
  } else {
    parseLoeWorkbook(path)
      .then((structure) => {
        process.stdout.write(`${JSON.stringify(structure, null, 2)}\n`);
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`Failed to parse LOE workbook: ${message}\n`);
        process.exitCode = 1;
      });
  }
}
