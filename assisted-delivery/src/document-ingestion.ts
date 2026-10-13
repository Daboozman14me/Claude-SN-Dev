import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { basename, extname, relative, resolve } from "node:path";
import { load } from "cheerio";
import JSZip from "jszip";
import {
  ASSISTED_CONTRACT_VERSION,
  type AssistedDocumentFormat,
  type AssistedDocumentUnit,
  type IngestedFileInventory,
  type NormalizedInputDocument,
  normalizedInputDocumentSchema,
} from "./assisted-contracts.js";

export interface DocumentIngestionResult {
  sourcePath: string;
  documents: NormalizedInputDocument[];
  inventory: IngestedFileInventory[];
  warnings: string[];
}

const formatByExtension = new Map<string, AssistedDocumentFormat>([
  [".docx", "docx"],
  [".pptx", "pptx"],
  [".pdf", "pdf"],
  [".html", "html"],
  [".htm", "html"],
  [".md", "markdown"],
  [".markdown", "markdown"],
  [".txt", "txt"],
  [".text", "txt"],
  [".json", "json"],
]);

function decodeXml(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(/&#([0-9]+);/g, (_match, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 10)),
    )
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

function xmlText(xml: string): string {
  return [...xml.matchAll(/<(?:w|a):t\b[^>]*>([\s\S]*?)<\/(?:w|a):t>/g)]
    .map((match) => decodeXml(match[1] ?? ""))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "document"
  );
}

function documentId(idSeed: string): string {
  const digest = createHash("sha256").update(idSeed).digest("hex").slice(0, 12);
  return `doc-${slug(idSeed)}-${digest}`;
}

function createDocument(
  path: string,
  format: AssistedDocumentFormat,
  title: string,
  units: AssistedDocumentUnit[],
  warnings: string[],
  idSeed: string,
): NormalizedInputDocument {
  return normalizedInputDocumentSchema.parse({
    contractVersion: ASSISTED_CONTRACT_VERSION,
    id: documentId(idSeed),
    title,
    format,
    sourcePath: path,
    units,
    warnings,
  });
}

async function ingestDocx(
  path: string,
  bytes: Buffer,
  idSeed: string,
): Promise<NormalizedInputDocument> {
  const zip = await JSZip.loadAsync(bytes);
  const documentXml = await zip.file("word/document.xml")?.async("string");
  if (!documentXml) {
    throw new Error("The DOCX archive does not contain word/document.xml.");
  }

  const units: AssistedDocumentUnit[] = [];
  let headingCount = 0;
  let paragraphCount = 0;
  let tableCount = 0;
  for (const match of documentXml.matchAll(
    /<w:(p|tbl)\b[\s\S]*?<\/w:\1>/g,
  )) {
    const kind = match[1];
    const block = match[0];
    if (kind === "tbl") {
      tableCount += 1;
      const rows = [...block.matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/g)]
        .map((row) =>
          [...row[0].matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/g)]
            .map((cell) => xmlText(cell[0]))
            .filter(Boolean)
            .join(" | "),
        )
        .filter(Boolean);
      if (rows.length > 0) {
        units.push({
          id: `table-${tableCount}`,
          type: "table",
          text: rows.join("\n"),
          location: { kind: "table", path, table: tableCount },
        });
      }
      continue;
    }

    const text = xmlText(block);
    if (!text) {
      continue;
    }
    const style = block.match(
      /<w:pStyle\b[^>]*w:val=["']([^"']+)["'][^>]*\/?>/,
    )?.[1];
    const heading = style?.match(/^Heading\s*([1-9][0-9]*)$/i);
    if (heading) {
      headingCount += 1;
      units.push({
        id: `heading-${headingCount}`,
        type: "heading",
        text,
        location: {
          kind: "heading",
          path,
          heading: text,
          level: Number.parseInt(heading[1] ?? "1", 10),
        },
      });
    } else {
      paragraphCount += 1;
      units.push({
        id: `paragraph-${paragraphCount}`,
        type: "paragraph",
        text,
        location: { kind: "paragraph", path, paragraph: paragraphCount },
      });
    }
  }

  const warnings =
    units.length === 0 ? ["The DOCX contains no readable text units."] : [];
  const title =
    units.find((unit) => unit.type === "heading")?.text ?? basename(path);
  return createDocument(path, "docx", title, units, warnings, idSeed);
}

function pptxSlideNumber(path: string): number {
  return Number.parseInt(path.match(/slide([0-9]+)\.xml$/)?.[1] ?? "0", 10);
}

async function ingestPptx(
  path: string,
  bytes: Buffer,
  idSeed: string,
): Promise<NormalizedInputDocument> {
  const zip = await JSZip.loadAsync(bytes);
  const slidePaths = Object.keys(zip.files)
    .filter((entry) => /^ppt\/slides\/slide[0-9]+\.xml$/.test(entry))
    .sort((left, right) => pptxSlideNumber(left) - pptxSlideNumber(right));
  if (slidePaths.length === 0) {
    throw new Error("The PPTX archive contains no slide XML.");
  }

  const units: AssistedDocumentUnit[] = [];
  for (const slidePath of slidePaths) {
    const slide = pptxSlideNumber(slidePath);
    const xml = await zip.file(slidePath)?.async("string");
    if (!xml) {
      continue;
    }
    let slideTitle: string | undefined;
    let textIndex = 0;
    let tableIndex = 0;
    for (const shape of xml.matchAll(/<p:sp\b[\s\S]*?<\/p:sp>/g)) {
      const text = xmlText(shape[0]);
      if (!text) {
        continue;
      }
      const isTitle =
        /<p:ph\b[^>]*type=["'](?:title|ctrTitle)["'][^>]*\/?>/.test(shape[0]);
      if (isTitle && slideTitle === undefined) {
        slideTitle = text;
        units.push({
          id: `slide-${slide}-title`,
          type: "slide_title",
          text,
          location: { kind: "slide", path, slide, title: text },
        });
      } else {
        textIndex += 1;
        units.push({
          id: `slide-${slide}-text-${textIndex}`,
          type: "slide_text",
          text,
          location: {
            kind: "slide",
            path,
            slide,
            ...(slideTitle ? { title: slideTitle } : {}),
          },
        });
      }
    }
    for (const frame of xml.matchAll(
      /<p:graphicFrame\b[\s\S]*?<\/p:graphicFrame>/g,
    )) {
      const tables = [
        ...frame[0].matchAll(/<a:tbl\b[\s\S]*?<\/a:tbl>/g),
      ];
      for (const table of tables) {
        const rows = [...table[0].matchAll(/<a:tr\b[\s\S]*?<\/a:tr>/g)]
          .map((row) =>
            [...row[0].matchAll(/<a:tc\b[\s\S]*?<\/a:tc>/g)]
              .map((cell) => xmlText(cell[0]))
              .filter(Boolean)
              .join(" | "),
          )
          .filter(Boolean);
        if (rows.length === 0) {
          continue;
        }
        tableIndex += 1;
        units.push({
          id: `slide-${slide}-table-${tableIndex}`,
          type: "table",
          text: rows.join("\n"),
          location: {
            kind: "slide_table",
            path,
            slide,
            table: tableIndex,
            ...(slideTitle ? { title: slideTitle } : {}),
          },
        });
      }
    }

    const relationshipPath = `ppt/slides/_rels/slide${slide}.xml.rels`;
    const relationships = await zip.file(relationshipPath)?.async("string");
    const notesTarget = relationships?.match(
      /Type=["'][^"']*\/notesSlide["'][^>]*Target=["']([^"']+)["']/,
    )?.[1];
    const normalizedTarget = notesTarget
      ? `ppt/${notesTarget.replace(/^\.\.\//, "")}`
      : `ppt/notesSlides/notesSlide${slide}.xml`;
    const notesXml = await zip.file(normalizedTarget)?.async("string");
    if (notesXml) {
      const notesText = [...notesXml.matchAll(/<p:sp\b[\s\S]*?<\/p:sp>/g)]
        .filter(
          (shape) =>
            !/<p:ph\b[^>]*type=["'](?:sldNum|dt|ftr|hdr)["']/.test(shape[0]),
        )
        .map((shape) => xmlText(shape[0]))
        .filter(Boolean)
        .join("\n");
      if (notesText) {
        units.push({
          id: `slide-${slide}-notes`,
          type: "speaker_notes",
          text: notesText,
          location: { kind: "speaker_notes", path, slide },
        });
      }
    }
  }

  const warnings =
    units.length === 0 ? ["The PPTX contains no readable slide text."] : [];
  const title =
    units.find((unit) => unit.type === "slide_title")?.text ?? basename(path);
  return createDocument(path, "pptx", title, units, warnings, idSeed);
}

async function ingestPdf(
  path: string,
  bytes: Buffer,
  idSeed: string,
): Promise<NormalizedInputDocument> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: true,
  });
  const pdf = await task.promise;
  const units: AssistedDocumentUnit[] = [];
  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (text) {
        units.push({
          id: `page-${pageNumber}`,
          type: "page_text",
          text,
          location: { kind: "page", path, page: pageNumber },
        });
      }
    }
  } finally {
    await task.destroy();
  }
  const warnings =
    units.length === 0 ? ["The PDF contains no extractable page text."] : [];
  return createDocument(path, "pdf", basename(path), units, warnings, idSeed);
}

function ingestHtml(
  path: string,
  content: string,
  idSeed: string,
): NormalizedInputDocument {
  const $ = load(content);
  $("script, style, noscript").remove();
  const units: AssistedDocumentUnit[] = [];
  let headingCount = 0;
  let paragraphCount = 0;
  const extractedSelector = "h1,h2,h3,h4,h5,h6,p,li,caption,th,td,pre";
  const addText = (text: string): void => {
    paragraphCount += 1;
    units.push({
      id: `paragraph-${paragraphCount}`,
      type: "paragraph",
      text,
      location: { kind: "paragraph", path, paragraph: paragraphCount },
    });
  };
  const visit = (node: Parameters<typeof $>[0]): void => {
    if (!node) {
      return;
    }
    if (typeof node !== "string" && "type" in node && node.type === "text") {
      const text = $(node).text().replace(/\s+/g, " ").trim();
      if (text) {
        addText(text);
      }
      return;
    }
    if ($(node).is(extractedSelector)) {
      const text = $(node).text().replace(/\s+/g, " ").trim();
      if (!text) {
        return;
      }
      const tagName =
        typeof node !== "string" && "tagName" in node ? node.tagName : "";
      if (/^h[1-6]$/i.test(tagName)) {
        headingCount += 1;
        units.push({
          id: `heading-${headingCount}`,
          type: "heading",
          text,
          location: {
            kind: "heading",
            path,
            heading: text,
            level: Number.parseInt(tagName.slice(1), 10),
          },
        });
      } else {
        addText(text);
      }
      return;
    }
    $(node)
      .contents()
      .each((_index, child) => visit(child));
  };
  $("body")
    .contents()
    .each((_index, node) => visit(node));
  const warnings =
    units.length === 0 ? ["The HTML contains no readable body text."] : [];
  const title =
    $("title").first().text().trim() ||
    units.find((unit) => unit.type === "heading")?.text ||
    basename(path);
  return createDocument(path, "html", title, units, warnings, idSeed);
}

function ingestMarkdown(
  path: string,
  content: string,
  idSeed: string,
): NormalizedInputDocument {
  const lines = content.split(/\r?\n/);
  const units: AssistedDocumentUnit[] = [];
  let headingCount = 0;
  let textCount = 0;
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    const setext =
      index + 1 < lines.length &&
      line.trim() &&
      /^\s*(?:=+|-+)\s*$/.test(lines[index + 1] ?? "")
        ? lines[index + 1]?.trim()
        : undefined;
    if (heading || setext) {
      const text = (heading?.[2] ?? line).trim();
      const level = heading?.[1]?.length ?? (setext?.startsWith("=") ? 1 : 2);
      headingCount += 1;
      units.push({
        id: `heading-${headingCount}`,
        type: "heading",
        text,
        location: { kind: "heading", path, heading: text, level },
      });
      index += setext ? 2 : 1;
      continue;
    }
    if (!line.trim()) {
      index += 1;
      continue;
    }
    const startLine = index + 1;
    const paragraph: string[] = [];
    while (index < lines.length) {
      const candidate = lines[index] ?? "";
      if (
        !candidate.trim() ||
        /^\s{0,3}#{1,6}\s+/.test(candidate) ||
        (index + 1 < lines.length &&
          /^\s*(?:=+|-+)\s*$/.test(lines[index + 1] ?? ""))
      ) {
        break;
      }
      paragraph.push(candidate.trim());
      index += 1;
    }
    const text = paragraph.join(" ").replace(/\s+/g, " ").trim();
    if (text) {
      textCount += 1;
      units.push({
        id: `text-${textCount}`,
        type: "paragraph",
        text,
        location: {
          kind: "line",
          path,
          line: startLine,
          endLine: startLine + paragraph.length - 1,
        },
      });
    } else {
      index += 1;
    }
  }
  const warnings =
    units.length === 0 ? ["The Markdown contains no readable text."] : [];
  const title =
    units.find((unit) => unit.type === "heading")?.text ?? basename(path);
  return createDocument(path, "markdown", title, units, warnings, idSeed);
}

function ingestText(
  path: string,
  content: string,
  idSeed: string,
): NormalizedInputDocument {
  const lines = content
    .split(/\r?\n/)
    .map((text, index) => ({ text: text.trim(), line: index + 1 }))
    .filter(({ text }) => text.length > 0);
  const units: AssistedDocumentUnit[] = lines.map(
    ({ text, line }, index): AssistedDocumentUnit => ({
      id: `line-${index + 1}`,
      type: "line",
      text,
      location: { kind: "line", path, line },
    }),
  );
  const combinedText = lines.map(({ text }) => text).join("\n");
  if (combinedText) {
    units.unshift({
      id: "document-text",
      type: "document_text",
      text: combinedText,
      location: { kind: "file", path },
    });
  }
  const warnings =
    units.length === 0 ? ["The text file contains no readable lines."] : [];
  return createDocument(path, "txt", basename(path), units, warnings, idSeed);
}

function escapeJsonPointer(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function ingestJson(
  path: string,
  content: string,
  idSeed: string,
): NormalizedInputDocument {
  const parsed: unknown = JSON.parse(content);
  const units: AssistedDocumentUnit[] = [];
  const visit = (value: unknown, pointer: string): void => {
    if (Array.isArray(value)) {
      if (value.length === 0) {
        units.push({
          id: `json-${units.length + 1}`,
          type: "json_value",
          text: "[]",
          location: { kind: "json_pointer", path, pointer },
        });
      } else {
        value.forEach((entry, index) => visit(entry, `${pointer}/${index}`));
      }
      return;
    }
    if (value !== null && typeof value === "object") {
      const entries = Object.entries(value);
      if (entries.length === 0) {
        units.push({
          id: `json-${units.length + 1}`,
          type: "json_value",
          text: "{}",
          location: { kind: "json_pointer", path, pointer },
        });
      } else {
        entries.forEach(([key, entry]) =>
          visit(entry, `${pointer}/${escapeJsonPointer(key)}`),
        );
      }
      return;
    }
    const text =
      value === null
        ? "null"
        : value === ""
          ? '""'
          : String(value);
    units.push({
      id: `json-${units.length + 1}`,
      type: "json_value",
      text,
      location: { kind: "json_pointer", path, pointer },
    });
  };
  visit(parsed, "");
  return createDocument(path, "json", basename(path), units, [], idSeed);
}

async function ingestSupportedFile(
  path: string,
  format: AssistedDocumentFormat,
  idSeed: string,
): Promise<NormalizedInputDocument> {
  const bytes = readFileSync(path);
  switch (format) {
    case "docx":
      return ingestDocx(path, bytes, idSeed);
    case "pptx":
      return ingestPptx(path, bytes, idSeed);
    case "pdf":
      return ingestPdf(path, bytes, idSeed);
    case "html":
      return ingestHtml(path, bytes.toString("utf8"), idSeed);
    case "markdown":
      return ingestMarkdown(path, bytes.toString("utf8"), idSeed);
    case "txt":
      return ingestText(path, bytes.toString("utf8"), idSeed);
    case "json":
      return ingestJson(path, bytes.toString("utf8"), idSeed);
  }
}

function listFiles(path: string): string[] {
  if (!statSync(path).isDirectory()) {
    return [path];
  }
  return readdirSync(path, { withFileTypes: true })
    .flatMap((entry) => {
      const child = resolve(path, entry.name);
      return entry.isDirectory() ? listFiles(child) : [child];
    })
    .sort((left, right) => left.localeCompare(right));
}

export async function ingestDocuments(
  sourcePath: string,
): Promise<DocumentIngestionResult> {
  const absoluteSource = resolve(sourcePath);
  if (!existsSync(absoluteSource)) {
    throw new Error(`Document path does not exist: '${absoluteSource}'.`);
  }
  const sourceIsDirectory = statSync(absoluteSource).isDirectory();
  const documents: NormalizedInputDocument[] = [];
  const inventory: IngestedFileInventory[] = [];
  const warnings: string[] = [];

  for (const path of listFiles(absoluteSource)) {
    const format = formatByExtension.get(extname(path).toLowerCase());
    if (!format) {
      const warning = `Unsupported document format: '${path}'.`;
      inventory.push({
        path,
        supported: false,
        readable: false,
        included: false,
        unitCount: 0,
        warnings: [warning],
      });
      warnings.push(warning);
      continue;
    }
    try {
      const idSeed = sourceIsDirectory
        ? relative(absoluteSource, path)
        : path;
      const document = await ingestSupportedFile(path, format, idSeed);
      documents.push(document);
      inventory.push({
        path,
        supported: true,
        readable: document.units.length > 0,
        included: true,
        format,
        unitCount: document.units.length,
        warnings: document.warnings,
      });
      warnings.push(...document.warnings.map((warning) => `${path}: ${warning}`));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const warning = `Unable to read '${path}': ${message}`;
      inventory.push({
        path,
        supported: true,
        readable: false,
        included: false,
        format,
        unitCount: 0,
        warnings: [warning],
      });
      warnings.push(warning);
    }
  }

  if (documents.length === 0) {
    warnings.push(`No supported readable documents were found in '${absoluteSource}'.`);
  }
  return { sourcePath: absoluteSource, documents, inventory, warnings };
}
