import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync as writeFileSyncTop } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import JSZip from "jszip";
import {
  ASSISTED_CONTRACT_VERSION,
  levelOfEffortPackageSchema,
  type LevelOfEffortPackage,
  type LoeWorkbookStructure,
  type NormalizedInputDocument,
} from "../src/assisted-contracts.js";
import { diffLoeWorkbookStructure } from "../src/diff-loe-workbook.js";
import {
  buildCellWrites,
  fillLoeWorkbook,
} from "../src/fill-loe-workbook.js";
import { parseCellsFromRowXml } from "../src/loe-workbook-xml.js";
import { parseLoeWorkbook } from "../src/parse-loe-workbook.js";
import { validateAssistedLoeFile } from "../src/validate-assisted-loe.js";

const document: NormalizedInputDocument = {
  contractVersion: ASSISTED_CONTRACT_VERSION,
  id: "doc-requirements",
  title: "Requirements Register",
  format: "json",
  sourcePath: "C:\\inputs\\requirements-extraction-v001.json",
  units: [
    {
      id: "json-1",
      type: "json_value",
      text: "ITSM implementation (NOTE: ITAM is out-of-scope)",
      location: {
        kind: "json_pointer",
        path: "C:\\inputs\\requirements-extraction-v001.json",
        pointer: "/requirements/0/verbatimText",
      },
    },
  ],
  warnings: [],
};

const citation = {
  id: "cite-itsm",
  documentId: document.id,
  unitId: "json-1",
  location: document.units[0]!.location,
  quote: "ITSM implementation (NOTE: ITAM is out-of-scope)",
} as const;

const sourceInventory = [
  {
    path: document.sourcePath,
    supported: true,
    readable: true,
    included: true,
    format: "json" as const,
    unitCount: 1,
    warnings: [],
  },
];

const workbookStructure: LoeWorkbookStructure = {
  templateFileName: "Blank - Standard v1.1.0 Modules Template.xlsm",
  templateFingerprint: "fingerprint-1",
  capturedAt: "2026-10-05T00:00:00Z",
  sheetName: "Module Scope",
  headerRow: 4,
  columns: {
    action: "B",
    functional_group: "C",
    feature: "D",
    simple_definition: "E",
    medium_definition: "F",
    complex_definition: "G",
    help: "H",
    user_story: "I",
    user_story_abbreviation: "J",
    user_story_in_out_scope: "K",
    simple_units: "L",
    medium_units: "M",
    complex_units: "N",
    total_units: "O",
    line_item_adjustor: "P",
    comments: "Q",
  },
  functionalGroups: [
    {
      id: "it-service-management-incident",
      name: "IT Service Management - Incident",
      headerRow: 100,
      firstFeatureRow: 101,
      lastFeatureRow: 101,
    },
  ],
  featureRows: [
    {
      row: 101,
      functionalGroupId: "it-service-management-incident",
      feature: "Incident lifecycle handling",
      simpleDefinition: "up to 2 incident states",
      mediumDefinition: "up to 5 incident states",
      complexDefinition: "up to 10 incident states",
    },
  ],
};

function buildPackage(
  overrides: Partial<LevelOfEffortPackage> = {},
): LevelOfEffortPackage {
  return {
    contractVersion: ASSISTED_CONTRACT_VERSION,
    packageType: "level_of_effort",
    packageId: "loe-artrans-1",
    title: "ARTRANS Level of Effort",
    summary: "Scoping decisions for the ARTRANS ServiceNow engagement.",
    artifacts: {
      html: "C:\\out\\level-of-effort-v001.html",
      json: "C:\\out\\level-of-effort-v001.json",
    },
    requirementsSourcePackageId: "requirements-artrans-1",
    sourceInventory,
    documents: [document],
    citations: [citation],
    workbookStructure,
    structuralChanges: [],
    decisions: [
      {
        id: "decision-1",
        row: 101,
        functionalGroupId: "it-service-management-incident",
        feature: "Incident lifecycle handling",
        decision: "in_scope",
        evidenceBasis: "stated",
        simpleUnits: 0,
        mediumUnits: 1,
        complexUnits: 0,
        sizingBasis: "stated",
        rationale: "ITSM Incident Management is explicitly in scope.",
        isAmbiguous: false,
        citationIds: [citation.id],
      },
    ],
    assumptions: [],
    questions: [],
    warnings: [],
    ...overrides,
  };
}

test("a well-formed LevelOfEffortPackage parses", () => {
  assert.doesNotThrow(() => levelOfEffortPackageSchema.parse(buildPackage()));
});

test("in_scope with zero units and no ambiguity flag is rejected", () => {
  const pkg = buildPackage({
    decisions: [
      {
        id: "decision-1",
        row: 101,
        functionalGroupId: "it-service-management-incident",
        feature: "Incident lifecycle handling",
        decision: "in_scope",
        evidenceBasis: "stated",
        simpleUnits: 0,
        mediumUnits: 0,
        complexUnits: 0,
        rationale: "In scope but unsized.",
        isAmbiguous: false,
        citationIds: [citation.id],
      },
    ],
  });
  assert.throws(() => levelOfEffortPackageSchema.parse(pkg));
});

test("out_of_scope with nonzero units is rejected", () => {
  const pkg = buildPackage({
    decisions: [
      {
        id: "decision-1",
        row: 101,
        functionalGroupId: "it-service-management-incident",
        feature: "Incident lifecycle handling",
        decision: "out_of_scope",
        evidenceBasis: "stated",
        simpleUnits: 1,
        mediumUnits: 0,
        complexUnits: 0,
        rationale: "Out of scope but sized.",
        isAmbiguous: false,
        citationIds: [citation.id],
      },
    ],
  });
  assert.throws(() => levelOfEffortPackageSchema.parse(pkg));
});

test("a decision with no citations is rejected", () => {
  const pkg = buildPackage({
    decisions: [
      {
        id: "decision-1",
        row: 101,
        functionalGroupId: "it-service-management-incident",
        feature: "Incident lifecycle handling",
        decision: "in_scope",
        evidenceBasis: "stated",
        simpleUnits: 0,
        mediumUnits: 1,
        complexUnits: 0,
        sizingBasis: "stated",
        rationale: "Missing citation.",
        isAmbiguous: false,
        citationIds: [],
      },
    ],
  });
  assert.throws(() => levelOfEffortPackageSchema.parse(pkg));
});

test("duplicate decision rows are rejected", () => {
  const pkg = buildPackage({
    decisions: [
      {
        id: "decision-1",
        row: 101,
        functionalGroupId: "it-service-management-incident",
        feature: "Incident lifecycle handling",
        decision: "in_scope",
        evidenceBasis: "stated",
        simpleUnits: 0,
        mediumUnits: 1,
        complexUnits: 0,
        sizingBasis: "stated",
        rationale: "First.",
        isAmbiguous: false,
        citationIds: [citation.id],
      },
      {
        id: "decision-2",
        row: 101,
        functionalGroupId: "it-service-management-incident",
        feature: "Incident lifecycle handling",
        decision: "in_scope",
        evidenceBasis: "stated",
        simpleUnits: 0,
        mediumUnits: 1,
        complexUnits: 0,
        sizingBasis: "stated",
        rationale: "Second, same row.",
        isAmbiguous: false,
        citationIds: [citation.id],
      },
    ],
  });
  assert.throws(() => levelOfEffortPackageSchema.parse(pkg));
});

test("ambiguous flag requires an ambiguityNote and vice versa", () => {
  const ambiguousWithoutNote = buildPackage({
    decisions: [
      {
        id: "decision-1",
        row: 101,
        functionalGroupId: "it-service-management-incident",
        feature: "Incident lifecycle handling",
        decision: "in_scope",
        evidenceBasis: "stated",
        simpleUnits: 0,
        mediumUnits: 0,
        complexUnits: 0,
        rationale: "Ambiguous but missing a note.",
        isAmbiguous: true,
        citationIds: [citation.id],
      },
    ],
  });
  assert.throws(() => levelOfEffortPackageSchema.parse(ambiguousWithoutNote));
});

test("a derived decision requires a derivationRationale", () => {
  const pkg = buildPackage({
    decisions: [
      {
        id: "decision-1",
        row: 101,
        functionalGroupId: "it-service-management-incident",
        feature: "Incident lifecycle handling",
        decision: "in_scope",
        evidenceBasis: "derived",
        simpleUnits: 0,
        mediumUnits: 1,
        complexUnits: 0,
        sizingBasis: "stated",
        rationale: "Derived but missing the rationale.",
        isAmbiguous: false,
        citationIds: [citation.id],
      },
    ],
  });
  assert.throws(() => levelOfEffortPackageSchema.parse(pkg));
});

test("a stated decision must not carry a derivationRationale", () => {
  const pkg = buildPackage({
    decisions: [
      {
        id: "decision-1",
        row: 101,
        functionalGroupId: "it-service-management-incident",
        feature: "Incident lifecycle handling",
        decision: "in_scope",
        evidenceBasis: "stated",
        derivationRationale: "Should not be here.",
        simpleUnits: 0,
        mediumUnits: 1,
        complexUnits: 0,
        sizingBasis: "stated",
        rationale: "Stated but carries a derivation rationale anyway.",
        isAmbiguous: false,
        citationIds: [citation.id],
      },
    ],
  });
  assert.throws(() => levelOfEffortPackageSchema.parse(pkg));
});

test("a valid derived decision parses", () => {
  const pkg = buildPackage({
    decisions: [
      {
        id: "decision-1",
        row: 101,
        functionalGroupId: "it-service-management-incident",
        feature: "Incident lifecycle handling",
        decision: "in_scope",
        evidenceBasis: "derived",
        derivationRationale:
          "A stated ITSM implementation licenses this standard sibling row.",
        simpleUnits: 0,
        mediumUnits: 1,
        complexUnits: 0,
        sizingBasis: "stated",
        rationale: "Derived from a stated ITSM implementation.",
        isAmbiguous: false,
        citationIds: [citation.id],
      },
    ],
  });
  assert.doesNotThrow(() => levelOfEffortPackageSchema.parse(pkg));
});

test("out_of_scope decisions must have evidenceBasis 'stated'", () => {
  const pkg = buildPackage({
    decisions: [
      {
        id: "decision-1",
        row: 101,
        functionalGroupId: "it-service-management-incident",
        feature: "Incident lifecycle handling",
        decision: "out_of_scope",
        evidenceBasis: "derived",
        derivationRationale: "Exclusions cannot be derived.",
        simpleUnits: 0,
        mediumUnits: 0,
        complexUnits: 0,
        rationale: "Trying to derive an exclusion.",
        isAmbiguous: false,
        citationIds: [citation.id],
      },
    ],
  });
  assert.throws(() => levelOfEffortPackageSchema.parse(pkg));
});

test("a benchmark sizing basis requires a benchmarkRationale", () => {
  const pkg = buildPackage({
    decisions: [
      {
        id: "decision-1",
        row: 101,
        functionalGroupId: "it-service-management-incident",
        feature: "Incident lifecycle handling",
        decision: "in_scope",
        evidenceBasis: "stated",
        simpleUnits: 0,
        mediumUnits: 1,
        complexUnits: 0,
        sizingBasis: "benchmark",
        rationale: "Sized without disclosing the benchmark used.",
        isAmbiguous: false,
        citationIds: [citation.id],
      },
    ],
  });
  assert.throws(() => levelOfEffortPackageSchema.parse(pkg));
});

test("a stated sizing basis must not carry a benchmarkRationale", () => {
  const pkg = buildPackage({
    decisions: [
      {
        id: "decision-1",
        row: 101,
        functionalGroupId: "it-service-management-incident",
        feature: "Incident lifecycle handling",
        decision: "in_scope",
        evidenceBasis: "stated",
        simpleUnits: 0,
        mediumUnits: 1,
        complexUnits: 0,
        sizingBasis: "stated",
        benchmarkRationale: "Should not be here.",
        rationale: "Stated sizing but carries a benchmark rationale anyway.",
        isAmbiguous: false,
        citationIds: [citation.id],
      },
    ],
  });
  assert.throws(() => levelOfEffortPackageSchema.parse(pkg));
});

test("a valid benchmark-sized decision parses", () => {
  const pkg = buildPackage({
    decisions: [
      {
        id: "decision-1",
        row: 101,
        functionalGroupId: "it-service-management-incident",
        feature: "Incident lifecycle handling",
        decision: "in_scope",
        evidenceBasis: "stated",
        simpleUnits: 0,
        mediumUnits: 1,
        complexUnits: 0,
        sizingBasis: "benchmark",
        benchmarkRationale:
          "No workflow count stated; using a typical mid-size Day-1 benchmark of 1 Medium unit. Not sourced from client documentation.",
        rationale: "In scope but sized from a disclosed benchmark.",
        isAmbiguous: false,
        citationIds: [citation.id],
      },
    ],
  });
  assert.doesNotThrow(() => levelOfEffortPackageSchema.parse(pkg));
});

test("a nonzero-unit decision must declare a sizingBasis", () => {
  const pkg = buildPackage({
    decisions: [
      {
        id: "decision-1",
        row: 101,
        functionalGroupId: "it-service-management-incident",
        feature: "Incident lifecycle handling",
        decision: "in_scope",
        evidenceBasis: "stated",
        simpleUnits: 0,
        mediumUnits: 1,
        complexUnits: 0,
        rationale: "Nonzero units but no sizing basis declared.",
        isAmbiguous: false,
        citationIds: [citation.id],
      },
    ],
  });
  assert.throws(() => levelOfEffortPackageSchema.parse(pkg));
});

test("an ambiguous decision with nonzero units is rejected", () => {
  const pkg = buildPackage({
    decisions: [
      {
        id: "decision-1",
        row: 101,
        functionalGroupId: "it-service-management-incident",
        feature: "Incident lifecycle handling",
        decision: "in_scope",
        evidenceBasis: "stated",
        simpleUnits: 0,
        mediumUnits: 1,
        complexUnits: 0,
        sizingBasis: "stated",
        rationale: "Ambiguous yet somehow sized.",
        isAmbiguous: true,
        ambiguityNote: "This should not be allowed alongside nonzero units.",
        citationIds: [citation.id],
      },
    ],
  });
  assert.throws(() => levelOfEffortPackageSchema.parse(pkg));
});

test("an out_of_scope decision must not carry a sizingBasis", () => {
  const pkg = buildPackage({
    decisions: [
      {
        id: "decision-1",
        row: 101,
        functionalGroupId: "it-service-management-incident",
        feature: "Incident lifecycle handling",
        decision: "out_of_scope",
        evidenceBasis: "stated",
        simpleUnits: 0,
        mediumUnits: 0,
        complexUnits: 0,
        sizingBasis: "stated",
        rationale: "Out of scope but still declares a sizing basis.",
        isAmbiguous: false,
        citationIds: [citation.id],
      },
    ],
  });
  assert.throws(() => levelOfEffortPackageSchema.parse(pkg));
});

test("parseCellsFromRowXml correctly handles a self-closing cell followed by more cells", () => {
  // Reproduces the real greedy-regex trap: a self-closing <c .../> cell
  // immediately followed by other cells before any </c> appears.
  const rowXml =
    '<c r="B34" s="17"/><c r="C34" s="15"/><c r="D34" s="70" t="s"><v>1490</v></c>';
  const sharedStrings = new Array(1491).fill("");
  sharedStrings[1490] = "Lists: up to 2 additional entries";
  const cells = parseCellsFromRowXml(rowXml, sharedStrings);
  assert.equal(cells.get("B")?.value, "");
  assert.equal(cells.get("C")?.value, "");
  assert.equal(cells.get("D")?.value, "Lists: up to 2 additional entries");
});

test("diffLoeWorkbookStructure detects every structural-change kind", () => {
  const base: LoeWorkbookStructure = {
    ...workbookStructure,
    functionalGroups: [
      {
        id: "group-a",
        name: "Group A",
        headerRow: 10,
        firstFeatureRow: 11,
        lastFeatureRow: 12,
      },
      {
        id: "group-removed",
        name: "Group Removed",
        headerRow: 20,
        firstFeatureRow: 21,
        lastFeatureRow: 21,
      },
    ],
    featureRows: [
      {
        row: 11,
        functionalGroupId: "group-a",
        feature: "Feature kept",
      },
      {
        row: 12,
        functionalGroupId: "group-a",
        feature: "Feature removed",
      },
      {
        row: 21,
        functionalGroupId: "group-removed",
        feature: "Removed-group feature",
      },
    ],
  };
  const fresh: LoeWorkbookStructure = {
    ...workbookStructure,
    columns: { ...workbookStructure.columns, comments: "R" },
    functionalGroups: [
      {
        id: "group-a",
        name: "Group A",
        headerRow: 10,
        firstFeatureRow: 11,
        lastFeatureRow: 11,
      },
      {
        id: "group-added",
        name: "Group Added",
        headerRow: 30,
        firstFeatureRow: 31,
        lastFeatureRow: 31,
      },
    ],
    featureRows: [
      {
        row: 11,
        functionalGroupId: "group-a",
        feature: "Feature kept",
      },
      {
        row: 31,
        functionalGroupId: "group-added",
        feature: "Brand new feature",
      },
    ],
  };
  const changes = diffLoeWorkbookStructure(base, fresh);
  const kinds = new Set(changes.map((change) => change.kind));
  assert.ok(kinds.has("functional_group_removed"));
  assert.ok(kinds.has("functional_group_added"));
  assert.ok(kinds.has("feature_row_removed"));
  assert.ok(kinds.has("column_layout_changed"));
});

test("diffLoeWorkbookStructure pairs a high-overlap group as a rename, not add+remove", () => {
  const base: LoeWorkbookStructure = {
    ...workbookStructure,
    functionalGroups: [
      {
        id: "old-name",
        name: "Old Name",
        headerRow: 10,
        firstFeatureRow: 11,
        lastFeatureRow: 13,
      },
    ],
    featureRows: [
      { row: 11, functionalGroupId: "old-name", feature: "Feature One" },
      { row: 12, functionalGroupId: "old-name", feature: "Feature Two" },
      { row: 13, functionalGroupId: "old-name", feature: "Feature Three" },
    ],
  };
  const fresh: LoeWorkbookStructure = {
    ...workbookStructure,
    functionalGroups: [
      {
        id: "new-name",
        name: "New Name",
        headerRow: 10,
        firstFeatureRow: 11,
        lastFeatureRow: 13,
      },
    ],
    featureRows: [
      { row: 11, functionalGroupId: "new-name", feature: "Feature One" },
      { row: 12, functionalGroupId: "new-name", feature: "Feature Two" },
      { row: 13, functionalGroupId: "new-name", feature: "Feature Three" },
    ],
  };
  const changes = diffLoeWorkbookStructure(base, fresh);
  assert.equal(
    changes.filter((change) => change.kind === "functional_group_renamed")
      .length,
    1,
  );
  assert.equal(
    changes.filter(
      (change) =>
        change.kind === "functional_group_added" ||
        change.kind === "functional_group_removed",
    ).length,
    0,
  );
});

async function buildSyntheticWorkbook(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    "xl/workbook.xml",
    `<?xml version="1.0"?><workbook xmlns:r="r"><sheets><sheet name="Module Scope" sheetId="1" r:id="rId1"/></sheets></workbook>`,
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    `<?xml version="1.0"?><Relationships><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
  );
  zip.file(
    "xl/sharedStrings.xml",
    `<?xml version="1.0"?><sst><si><t>Action</t></si><si><t>Functional Group</t></si><si><t>Features</t></si><si><t>IT Service Management - Incident</t></si><si><t>Incident lifecycle handling</t></si><si><t># of Simple Units</t></si><si><t># of Medium Units</t></si><si><t># of Complex Units</t></si><si><t>Comments</t></si></sst>`,
  );
  zip.file(
    "xl/worksheets/sheet1.xml",
    [
      "<worksheet>",
      '<sheetData>',
      '<row r="4"><c r="B4" t="s"><v>0</v></c><c r="C4" t="s"><v>1</v></c><c r="D4" t="s"><v>2</v></c><c r="L4" t="s"><v>5</v></c><c r="M4" t="s"><v>6</v></c><c r="N4" t="s"><v>7</v></c><c r="Q4" t="s"><v>8</v></c></row>',
      '<row r="5"><c r="B5" s="1"><f>COUNTIF(B6:B6,"Yes")</f><v>0</v></c><c r="C5" t="s"><v>3</v></c><c r="D5"/></row>',
      '<row r="6"><c r="B6" s="17"/><c r="C6" s="15"/><c r="D6" t="s"><v>4</v></c><c r="L6" s="46"/><c r="M6" s="46"/><c r="N6" s="46"/><c r="Q6" s="33"/></row>',
      "</sheetData>",
      "</worksheet>",
    ].join(""),
  );
  zip.file("xl/vbaProject.bin", Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]));
  return zip.generateAsync({ type: "nodebuffer" });
}

test("fillLoeWorkbook writes only the targeted cells and preserves every other byte", async () => {
  const { mkdtempSync, writeFileSync, readFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");

  const dir = mkdtempSync(join(tmpdir(), "loe-fill-test-"));
  const sourcePath = join(dir, "source.xlsm");
  const outputPath = join(dir, "filled.xlsm");
  writeFileSync(sourcePath, await buildSyntheticWorkbook());

  const structure = await parseLoeWorkbook(sourcePath);
  assert.equal(structure.functionalGroups.length, 1);
  assert.equal(structure.featureRows.length, 1);
  assert.equal(structure.featureRows[0]!.row, 6);

  const decisions = [
    {
      id: "decision-1",
      row: 6,
      functionalGroupId: structure.functionalGroups[0]!.id,
      feature: "Incident lifecycle handling",
      decision: "in_scope" as const,
      evidenceBasis: "stated" as const,
      simpleUnits: 0,
      mediumUnits: 2,
      complexUnits: 0,
      sizingBasis: "stated" as const,
      comment: "Sized from the Requirements Register.",
      rationale: "In scope per ARTRANS requirements.",
      isAmbiguous: false,
      citationIds: ["cite-itsm"],
    },
  ];

  await fillLoeWorkbook(sourcePath, structure, decisions, outputPath);

  const beforeZip = await JSZip.loadAsync(readFileSync(sourcePath));
  const afterZip = await JSZip.loadAsync(readFileSync(outputPath));
  const beforeVba = await beforeZip.file("xl/vbaProject.bin")!.async("nodebuffer");
  const afterVba = await afterZip.file("xl/vbaProject.bin")!.async("nodebuffer");
  assert.deepEqual(beforeVba, afterVba);

  const filledStructure = await parseLoeWorkbook(outputPath);
  assert.deepEqual(filledStructure.featureRows, structure.featureRows);

  const sheetXml = await afterZip.file("xl/worksheets/sheet1.xml")!.async("string");
  assert.match(sheetXml, /<c r="B6" s="17" t="inlineStr"><is><t>Yes<\/t><\/is><\/c>/);
  assert.match(sheetXml, /<c r="M6" s="46"><v>2<\/v><\/c>/);
  assert.match(
    sheetXml,
    /<c r="Q6" s="33" t="inlineStr"><is><t>Sized from the Requirements Register\.<\/t><\/is><\/c>/,
  );
});

test("buildCellWrites leaves out-of-scope rows completely untouched", () => {
  const writes = buildCellWrites(workbookStructure, [
    {
      id: "decision-1",
      row: 101,
      functionalGroupId: "it-service-management-incident",
      feature: "Incident lifecycle handling",
      decision: "out_of_scope",
      evidenceBasis: "stated",
      simpleUnits: 0,
      mediumUnits: 0,
      complexUnits: 0,
      rationale: "Out of scope.",
      isAmbiguous: false,
      citationIds: ["cite-itsm"],
    },
  ]);
  assert.equal(
    writes.length,
    0,
    "an out_of_scope decision must never write a literal 'No' or zero units — the row stays blank",
  );
});

test("buildCellWrites always writes Action/Simple/Medium/Complex for an in-scope row", () => {
  const writes = buildCellWrites(workbookStructure, [
    {
      id: "decision-1",
      row: 101,
      functionalGroupId: "it-service-management-incident",
      feature: "Incident lifecycle handling",
      decision: "in_scope",
      evidenceBasis: "stated",
      simpleUnits: 0,
      mediumUnits: 1,
      complexUnits: 0,
      sizingBasis: "stated",
      rationale: "In scope.",
      isAmbiguous: false,
      citationIds: ["cite-itsm"],
    },
  ]);
  assert.equal(writes.length, 4);
  assert.ok(
    writes.some(
      (write) =>
        write.col === "B" && write.kind === "string" && write.text === "Yes",
    ),
  );
  assert.ok(
    !writes.some((write) => write.col === "Q"),
    "no comment supplied, so the Q cell should not be written",
  );
});

test("buildCellWrites tags the comment cell for derived scope and benchmark sizing", () => {
  const writes = buildCellWrites(workbookStructure, [
    {
      id: "decision-1",
      row: 101,
      functionalGroupId: "it-service-management-incident",
      feature: "Incident lifecycle handling",
      decision: "in_scope",
      evidenceBasis: "derived",
      derivationRationale: "Standard sibling of a stated ITSM implementation.",
      simpleUnits: 0,
      mediumUnits: 1,
      complexUnits: 0,
      sizingBasis: "benchmark",
      benchmarkRationale: "No count stated; using a Day-1 benchmark of 1.",
      comment: "Review before finalizing.",
      rationale: "Derived and benchmark-sized.",
      isAmbiguous: false,
      citationIds: ["cite-itsm"],
    },
  ]);
  const commentWrite = writes.find((write) => write.col === "Q");
  assert.ok(commentWrite, "expected a comment write for the derived/benchmark decision");
  assert.equal(commentWrite!.kind, "string");
  assert.match((commentWrite as { text: string }).text, /\[Derived scope\]/);
  assert.match(
    (commentWrite as { text: string }).text,
    /\[Benchmark estimate — not from client doc\]/,
  );
  assert.match((commentWrite as { text: string }).text, /Review before finalizing\./);
});

test("validateAssistedLoeFile binds the JSON report to its sibling HTML artifact", () => {
  const directory = mkdtempSync(join(tmpdir(), "assisted-loe-"));
  const jsonPath = join(directory, "level-of-effort-v001.json");
  const htmlPath = join(directory, "level-of-effort-v001.html");
  const pkg = buildPackage({ artifacts: { html: htmlPath, json: jsonPath } });
  writeFileSyncTop(jsonPath, JSON.stringify(pkg));
  writeFileSyncTop(htmlPath, "<html><body>Level of Effort</body></html>");
  assert.doesNotThrow(() => validateAssistedLoeFile(jsonPath));
});

test("validateAssistedLoeFile rejects a JSON report with no matching HTML on disk", () => {
  const directory = mkdtempSync(join(tmpdir(), "assisted-loe-"));
  const jsonPath = join(directory, "level-of-effort-v001.json");
  const htmlPath = join(directory, "level-of-effort-v001.html");
  const pkg = buildPackage({ artifacts: { html: htmlPath, json: jsonPath } });
  writeFileSyncTop(jsonPath, JSON.stringify(pkg));
  assert.throws(() => validateAssistedLoeFile(jsonPath));
});
