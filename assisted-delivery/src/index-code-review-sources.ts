import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import type { z } from "zod";
import type {
  CODE_REVIEW_SOURCE_KINDS,
  codeReviewSourceRecordSchema,
} from "./assisted-contracts.js";
import { isDirectExecution } from "./direct-execution.js";

type SourceKind = (typeof CODE_REVIEW_SOURCE_KINDS)[number];
type SourceRecord = z.input<typeof codeReviewSourceRecordSchema>;

export interface IndexedSource {
  id: string;
  path: string;
  kind: SourceKind;
  sha256: string;
  lineCount: number;
  records: SourceRecord[];
}

export interface FluentProject {
  root: string;
  scope?: string;
  scopeId?: string;
  name?: string;
}

export interface CodeReviewSourceIndex {
  inputs: string[];
  sources: IndexedSource[];
  fluentProjects: FluentProject[];
  skipped: Array<{ path: string; reason: string }>;
}

const SKIPPED_DIRECTORIES = new Set([
  "node_modules",
  "dist",
  "target",
  ".git",
  ".now",
  ".vscode",
  "@types",
]);
const WALKED_EXTENSIONS = new Set([
  ".ts",
  ".js",
  ".mjs",
  ".cjs",
  ".xml",
  ".json",
  ".html",
  ".htm",
  ".css",
]);
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const CONTAINER_TAGS = new Set(["sys_update_xml", "sys_remote_update_set"]);
// Script-bearing fields across common ServiceNow metadata tables.
const SCRIPT_FIELDS = [
  "script",
  "script_true",
  "script_false",
  "client_script",
  "server_script",
  "condition",
  "advanced_condition",
  "template",
  "css",
  "html",
  "processing_script",
  "operation_script",
  "script_plain",
];

const LT = "(?:<|&lt;)";
const GT = "(?:>|&gt;)";
const QUOTE = "(?:\"|&quot;)";

export function countLines(content: string): number {
  if (content.length === 0) return 0;
  const lines = content.split(/\r\n|\n/).length;
  return /\r?\n$/.test(content) ? lines - 1 : lines;
}

function lineStarts(content: string): number[] {
  const starts = [0];
  for (let index = 0; index < content.length; index += 1) {
    if (content[index] === "\n") starts.push(index + 1);
  }
  return starts;
}

function lineAt(starts: number[], offset: number): number {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (starts[middle]! <= offset) low = middle;
    else high = middle - 1;
  }
  return low + 1;
}

function firstElementText(block: string, tag: string): string | undefined {
  const match = block.match(
    new RegExp(`${LT}${tag}(?:\\s[^<>]*?)?${GT}([\\s\\S]*?)${LT}/${tag}${GT}`),
  );
  const text = match?.[1]
    ?.replace(/<!\[CDATA\[|\]\]>/g, "")
    .trim();
  return text ? text : undefined;
}

function xmlRecords(content: string): SourceRecord[] {
  const starts = lineStarts(content);
  const records: SourceRecord[] = [];
  const opener = new RegExp(
    `${LT}([A-Za-z_][\\w.]*)\\s+action=${QUOTE}(?:INSERT_OR_UPDATE|DELETE)${QUOTE}[^<>]*?${GT}`,
    "g",
  );
  for (const match of content.matchAll(opener)) {
    const table = match[1]!;
    if (CONTAINER_TAGS.has(table)) continue;
    const openStart = match.index!;
    const bodyStart = openStart + match[0].length;
    const closer = new RegExp(`${LT}/${table.replace(/\./g, "\\.")}${GT}`, "g");
    closer.lastIndex = bodyStart;
    const close = closer.exec(content);
    const end = close ? close.index + close[0].length : content.length;
    const block = content.slice(bodyStart, close ? close.index : content.length);

    const scriptFields: SourceRecord["scriptFields"] = [];
    for (const field of SCRIPT_FIELDS) {
      const fieldPattern = new RegExp(
        `${LT}${field}(?:\\s[^<>]*?)?${GT}([\\s\\S]*?)${LT}/${field}${GT}`,
        "g",
      );
      for (const fieldMatch of block.matchAll(fieldPattern)) {
        const inner = fieldMatch[1]!.replace(/<!\[CDATA\[|\]\]>/g, "").trim();
        if (!inner) continue;
        const fieldStart = bodyStart + fieldMatch.index!;
        scriptFields.push({
          field,
          startLine: lineAt(starts, fieldStart),
          endLine: lineAt(starts, fieldStart + fieldMatch[0].length - 1),
        });
      }
    }
    scriptFields.sort((a, b) => a.startLine - b.startLine);

    const sysId = firstElementText(block, "sys_id");
    const name = firstElementText(block, "name") ?? firstElementText(block, "sys_name");
    records.push({
      table,
      ...(name ? { name: name.slice(0, 500) } : {}),
      ...(sysId && /^[0-9a-f]{32}$/.test(sysId) ? { sysId } : {}),
      startLine: lineAt(starts, openStart),
      endLine: lineAt(starts, end - 1),
      scriptFields,
    });
  }
  return records;
}

function classify(path: string, content: string): SourceKind {
  const file = basename(path).toLocaleLowerCase();
  const extension = extname(file);
  if (file.endsWith(".now.ts") || file === "keys.ts") return "fluent";
  if (extension === ".json") return "config";
  if (extension === ".xml") {
    if (/sys_remote_update_set|<sys_update_xml\b/.test(content)) {
      return "update_set_xml";
    }
    return /action=(?:"|&quot;)(?:INSERT_OR_UPDATE|DELETE)/.test(content)
      ? "app_xml"
      : "other";
  }
  if ([".ts", ".js", ".mjs", ".cjs"].includes(extension)) {
    if (/\.client\.(?:js|ts)$/.test(file)) return "client_script";
    if (/\.server\.(?:js|ts)$/.test(file)) return "server_script";
    if (/@servicenow\/sdk\/core/.test(content)) return "fluent";
    const clientSignals = /\bg_form\b|\bg_user\b|\bg_list\b|\bonChange\s*\(|\bonLoad\s*\(|\bonSubmit\s*\(/.test(
      content,
    );
    const serverSignals = /\bGlideRecord\b|\bgs\.|\bcurrent\b|\bClass\.create\b/.test(
      content,
    );
    return clientSignals && !serverSignals ? "client_script" : "server_script";
  }
  return "other";
}

function fluentProjectFor(path: string): FluentProject | undefined {
  let directory = dirname(path);
  for (;;) {
    const config = join(directory, "now.config.json");
    if (existsSync(config)) {
      try {
        const parsed = JSON.parse(readFileSync(config, "utf8")) as Record<
          string,
          unknown
        >;
        return {
          root: directory,
          ...(typeof parsed.scope === "string" ? { scope: parsed.scope } : {}),
          ...(typeof parsed.scopeId === "string" ? { scopeId: parsed.scopeId } : {}),
          ...(typeof parsed.name === "string" ? { name: parsed.name } : {}),
        };
      } catch {
        return { root: directory };
      }
    }
    const parent = dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}

export function walkDirectory(
  directory: string,
  skippedDirectories: ReadonlySet<string> = SKIPPED_DIRECTORIES,
): string[] {
  const files: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        if (!skippedDirectories.has(entry.name)) walk(full);
      } else if (entry.isFile()) {
        files.push(full);
      }
    }
  };
  walk(resolve(directory));
  return files;
}

function collectFiles(
  input: string,
  skipped: CodeReviewSourceIndex["skipped"],
): string[] {
  const absolute = resolve(input);
  if (!existsSync(absolute)) {
    skipped.push({ path: absolute, reason: "does not exist" });
    return [];
  }
  if (statSync(absolute).isFile()) return [absolute];
  return walkDirectory(absolute).filter((full) => {
    if (basename(full) === "package-lock.json") {
      skipped.push({ path: full, reason: "lock file" });
      return false;
    }
    return WALKED_EXTENSIONS.has(extname(full).toLocaleLowerCase());
  });
}

export function indexCodeReviewSources(inputs: string[]): CodeReviewSourceIndex {
  const skipped: CodeReviewSourceIndex["skipped"] = [];
  const paths = [...new Set(inputs.flatMap((input) => collectFiles(input, skipped)))].sort(
    (a, b) => a.localeCompare(b),
  );
  const sources: IndexedSource[] = [];
  const projects = new Map<string, FluentProject>();
  for (const path of paths) {
    const size = statSync(path).size;
    if (size > MAX_FILE_BYTES) {
      skipped.push({ path, reason: `larger than ${MAX_FILE_BYTES} bytes` });
      continue;
    }
    const bytes = readFileSync(path);
    if (bytes.includes(0)) {
      skipped.push({ path, reason: "binary content" });
      continue;
    }
    const content = bytes.toString("utf8");
    const kind = classify(path, content);
    sources.push({
      id: `SRC-${String(sources.length + 1).padStart(3, "0")}`,
      path,
      kind,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      lineCount: countLines(content),
      records: kind === "update_set_xml" || kind === "app_xml" ? xmlRecords(content) : [],
    });
    const project = fluentProjectFor(path);
    if (project) projects.set(project.root, project);
  }
  return {
    inputs: inputs.map((input) => resolve(input)),
    sources,
    fluentProjects: [...projects.values()],
    skipped,
  };
}

if (isDirectExecution(import.meta.url, process.argv[1])) {
  const inputs = process.argv.slice(2);
  if (inputs.length === 0) {
    process.stderr.write(
      "Usage: npm run code-review:index -- <file-or-folder> [<file-or-folder> ...]\n",
    );
    process.exitCode = 1;
  } else {
    try {
      process.stdout.write(`${JSON.stringify(indexCodeReviewSources(inputs), null, 2)}\n`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`Code review source indexing failed: ${message}\n`);
      process.exitCode = 1;
    }
  }
}
