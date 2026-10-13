import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import JSZip from "jszip";
import {
  type LoeScopingDecision,
  type LoeWorkbookStructure,
} from "./assisted-contracts.js";
import { isDirectExecution } from "./direct-execution.js";
import { resolveSheetTarget } from "./loe-workbook-xml.js";

const MODULE_SCOPE_SHEET_NAME = "Module Scope";

export type LoeCellContent =
  | { kind: "string"; text: string }
  | { kind: "number"; value: number };
export type LoeCellWrite = { row: number; col: string } & LoeCellContent;

function escapeXmlText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Finds the single `<c>` element with the given cell reference inside a row's
 * XML and replaces it, preserving the cell's existing style (`s="..."`)
 * attribute exactly. Only ever touches the one targeted cell; every other
 * byte of the row (and the sheet) is untouched.
 */
export function replaceCellInRowXml(
  rowXml: string,
  col: string,
  write: LoeCellContent,
): string {
  const cellRe = /<c([^>/]*)\/>|<c([^>/]*)>([\s\S]*?)<\/c>/g;
  let match: RegExpExecArray | null;
  while ((match = cellRe.exec(rowXml))) {
    const attrs = match[1] ?? match[2] ?? "";
    const refMatch = /r="([A-Z]+)\d+"/.exec(attrs);
    if (refMatch?.[1] !== col) continue;
    const attrsWithoutType = attrs.replace(/\s*t="[^"]*"/, "");
    const replacement =
      write.kind === "string"
        ? `<c${attrsWithoutType} t="inlineStr"><is><t>${escapeXmlText(
            write.text,
          )}</t></is></c>`
        : `<c${attrsWithoutType}><v>${write.value}</v></c>`;
    return rowXml.slice(0, match.index) +
      replacement +
      rowXml.slice(match.index + match[0].length);
  }
  throw new Error(`Cell '${col}' was not found in the supplied row XML.`);
}

export function applyLoeCellWrites(
  sheetXml: string,
  writes: readonly LoeCellWrite[],
): string {
  let result = sheetXml;
  const byRow = new Map<number, LoeCellWrite[]>();
  for (const write of writes) {
    const list = byRow.get(write.row) ?? [];
    list.push(write);
    byRow.set(write.row, list);
  }
  for (const [row, rowWrites] of byRow) {
    const rowRe = new RegExp(`<row\\b[^>]*\\br="${row}"[^>]*>([\\s\\S]*?)<\\/row>`);
    const rowMatch = rowRe.exec(result);
    if (!rowMatch) {
      throw new Error(`Row '${row}' was not found in the Module Scope sheet.`);
    }
    let rowXml = rowMatch[1]!;
    for (const write of rowWrites) {
      rowXml = replaceCellInRowXml(rowXml, write.col, write);
    }
    const fullRowMatch = rowMatch[0];
    const newFullRow = fullRowMatch.replace(rowMatch[1]!, rowXml);
    result =
      result.slice(0, rowMatch.index) +
      newFullRow +
      result.slice(rowMatch.index + fullRowMatch.length);
  }
  return result;
}

export function buildCellWrites(
  structure: LoeWorkbookStructure,
  decisions: readonly LoeScopingDecision[],
): LoeCellWrite[] {
  const actionCol = structure.columns.action;
  if (!actionCol) {
    throw new Error(
      "LOE workbook structure is missing the required 'action' column role.",
    );
  }
  const simpleCol = structure.columns.simple_units;
  const mediumCol = structure.columns.medium_units;
  const complexCol = structure.columns.complex_units;
  const commentsCol = structure.columns.comments;
  const writes: LoeCellWrite[] = [];
  for (const decision of decisions) {
    if (decision.decision !== "in_scope") {
      // Out-of-scope rows are left completely untouched in the workbook —
      // no "No" text, no zero units. The decision is still visible in the
      // HTML/JSON report for traceability.
      continue;
    }
    writes.push({
      row: decision.row,
      col: actionCol,
      kind: "string",
      text: "Yes",
    });
    if (simpleCol) {
      writes.push({
        row: decision.row,
        col: simpleCol,
        kind: "number",
        value: decision.simpleUnits,
      });
    }
    if (mediumCol) {
      writes.push({
        row: decision.row,
        col: mediumCol,
        kind: "number",
        value: decision.mediumUnits,
      });
    }
    if (complexCol) {
      writes.push({
        row: decision.row,
        col: complexCol,
        kind: "number",
        value: decision.complexUnits,
      });
    }
    if (commentsCol) {
      const tags: string[] = [];
      if (decision.evidenceBasis === "derived") {
        tags.push("[Derived scope]");
      }
      if (decision.sizingBasis === "benchmark") {
        tags.push("[Benchmark estimate — not from client doc]");
      }
      const commentText = [...tags, decision.comment]
        .filter((part): part is string => Boolean(part))
        .join(" ");
      if (commentText) {
        writes.push({
          row: decision.row,
          col: commentsCol,
          kind: "string",
          text: commentText,
        });
      }
    }
  }
  return writes;
}

export async function fillLoeWorkbook(
  sourcePath: string,
  structure: LoeWorkbookStructure,
  decisions: readonly LoeScopingDecision[],
  outputPath: string,
): Promise<void> {
  const absoluteSource = resolve(sourcePath);
  const absoluteOutput = resolve(outputPath);
  if (absoluteSource === absoluteOutput) {
    throw new Error(
      "Refusing to fill an LOE workbook in place; outputPath must differ from sourcePath.",
    );
  }
  const bytes = readFileSync(absoluteSource);
  const zip = await JSZip.loadAsync(bytes);
  const workbookXml = await zip.file("xl/workbook.xml")!.async("string");
  const workbookRelsXml = await zip
    .file("xl/_rels/workbook.xml.rels")!
    .async("string");
  const sheetLocation = resolveSheetTarget(
    workbookXml,
    workbookRelsXml,
    MODULE_SCOPE_SHEET_NAME,
  );
  const sheetXml = await zip.file(sheetLocation.target)!.async("string");
  const writes = buildCellWrites(structure, decisions);
  const filledSheetXml = applyLoeCellWrites(sheetXml, writes);
  zip.file(sheetLocation.target, filledSheetXml);
  const outputBytes = await zip.generateAsync({ type: "nodebuffer" });
  writeFileSync(absoluteOutput, outputBytes);
}

if (isDirectExecution(import.meta.url, process.argv[1])) {
  const [sourcePath, structurePath, decisionsPath, outputPath] =
    process.argv.slice(2);
  if (!sourcePath || !structurePath || !decisionsPath || !outputPath) {
    process.stderr.write(
      "Usage: tsx src/fill-loe-workbook.ts <source-xlsm> <structure.json> <decisions.json> <output-xlsm>\n",
    );
    process.exitCode = 1;
  } else {
    const structure = JSON.parse(
      readFileSync(structurePath, "utf8"),
    ) as LoeWorkbookStructure;
    const decisions = JSON.parse(
      readFileSync(decisionsPath, "utf8"),
    ) as LoeScopingDecision[];
    fillLoeWorkbook(sourcePath, structure, decisions, outputPath)
      .then(() => {
        process.stdout.write(`Wrote filled LOE workbook: ${resolve(outputPath)}\n`);
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`Failed to fill LOE workbook: ${message}\n`);
        process.exitCode = 1;
      });
  }
}
