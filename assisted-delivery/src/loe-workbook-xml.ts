import { createHash } from "node:crypto";

export interface LoeParsedCell {
  col: string;
  hasFormula: boolean;
  value: string;
}

/**
 * Parses `<c>` cell elements out of a single `<row>` element's inner XML.
 *
 * Excludes `/` from the attribute character class so a self-closing cell
 * (`<c r="B34" s="17"/>`) is matched by the self-close alternative instead
 * of bleeding into the next cell's `</c>` via the open/content alternative
 * (the greedy-`[^>]*` trap: it swallows the trailing `/`, leaving the
 * alternation's `>` branch able to match without backtracking).
 */
const CELL_RE =
  /<c([^>/]*)\/>|<c([^>/]*)>([\s\S]*?)<\/c>/g;

export function parseCellsFromRowXml(
  rowXml: string,
  sharedStrings: readonly string[],
): Map<string, LoeParsedCell> {
  const cells = new Map<string, LoeParsedCell>();
  let match: RegExpExecArray | null;
  CELL_RE.lastIndex = 0;
  while ((match = CELL_RE.exec(rowXml))) {
    const attrs = match[1] ?? match[2] ?? "";
    const inner = match[3] ?? "";
    const refMatch = /r="([A-Z]+)\d+"/.exec(attrs);
    if (!refMatch) continue;
    const col = refMatch[1]!;
    const typeMatch = /\bt="([^"]+)"/.exec(attrs);
    const type = typeMatch?.[1];
    const hasFormula = /<f\b/.test(inner);
    let value = "";
    if (type === "s") {
      const valueMatch = /<v>([^<]*)<\/v>/.exec(inner);
      if (valueMatch) {
        value = sharedStrings[Number.parseInt(valueMatch[1]!, 10)] ?? "";
      }
    } else if (type === "inlineStr") {
      const textMatch = /<t[^>]*>([\s\S]*?)<\/t>/.exec(inner);
      value = textMatch?.[1] ?? "";
    } else {
      const valueMatch = /<v>([\s\S]*?)<\/v>/.exec(inner);
      value = valueMatch?.[1] ?? "";
    }
    cells.set(col, { col, hasFormula, value: decodeXmlEntities(value) });
  }
  return cells;
}

export function decodeXmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

export function parseSharedStrings(sharedStringsXml: string): string[] {
  const strings: string[] = [];
  const siRe = /<si>([\s\S]*?)<\/si>/g;
  let match: RegExpExecArray | null;
  while ((match = siRe.exec(sharedStringsXml))) {
    const body = match[1]!;
    const tRe = /<t[^>]*>([\s\S]*?)<\/t>/g;
    let text = "";
    let textMatch: RegExpExecArray | null;
    while ((textMatch = tRe.exec(body))) {
      text += textMatch[1];
    }
    strings.push(decodeXmlEntities(text));
  }
  return strings;
}

export function parseRows(
  sheetXml: string,
): Map<number, string> {
  const rows = new Map<number, string>();
  const rowRe = /<row\b[^>]*\br="(\d+)"[^>]*>([\s\S]*?)<\/row>/g;
  let match: RegExpExecArray | null;
  while ((match = rowRe.exec(sheetXml))) {
    rows.set(Number.parseInt(match[1]!, 10), match[2]!);
  }
  return rows;
}

export function hashFingerprint(parts: readonly string[]): string {
  const hash = createHash("sha256");
  for (const part of parts) {
    hash.update(part);
    hash.update("\u0000");
  }
  return hash.digest("hex");
}

export interface SheetLocation {
  sheetName: string;
  target: string;
}

export function resolveSheetTarget(
  workbookXml: string,
  workbookRelsXml: string,
  sheetName: string,
): SheetLocation {
  const sheetRe = /<sheet\b[^>]*\bname="([^"]+)"[^>]*\br:id="([^"]+)"[^>]*\/>/g;
  let match: RegExpExecArray | null;
  let relId: string | undefined;
  while ((match = sheetRe.exec(workbookXml))) {
    if (decodeXmlEntities(match[1]!) === sheetName) {
      relId = match[2];
      break;
    }
  }
  if (!relId) {
    throw new Error(`Workbook does not contain a sheet named '${sheetName}'.`);
  }
  const relRe = new RegExp(
    `<Relationship\\b[^>]*\\bId="${relId}"[^>]*\\bTarget="([^"]+)"[^>]*/>`,
  );
  const relMatch = relRe.exec(workbookRelsXml);
  if (!relMatch) {
    throw new Error(
      `Workbook relationships do not define a target for '${relId}'.`,
    );
  }
  return { sheetName, target: `xl/${relMatch[1]}` };
}

export interface DefinedNameRange {
  name: string;
  sheetName: string;
  startRow?: number;
  endRow?: number;
  column?: string;
}

export function parseDefinedNames(workbookXml: string): DefinedNameRange[] {
  const results: DefinedNameRange[] = [];
  const nameRe =
    /<definedName\b[^>]*\bname="([^"]+)"[^>]*>([\s\S]*?)<\/definedName>/g;
  let match: RegExpExecArray | null;
  while ((match = nameRe.exec(workbookXml))) {
    const name = decodeXmlEntities(match[1]!);
    const body = decodeXmlEntities(match[2]!).replace(/^'|'$/g, "");
    const refMatch =
      /^'?([^'!]+)'?!\$?([A-Z]+)\$?(\d+)?(?::\$?([A-Z]+)?\$?(\d+))?$/.exec(
        body,
      );
    if (!refMatch) continue;
    const [, sheetName, startCol, startRow, , endRow] = refMatch;
    const entry: DefinedNameRange = {
      name,
      sheetName: sheetName!,
    };
    if (!startRow && startCol) entry.column = startCol;
    if (startRow) entry.startRow = Number.parseInt(startRow, 10);
    if (endRow) entry.endRow = Number.parseInt(endRow, 10);
    results.push(entry);
  }
  return results;
}
