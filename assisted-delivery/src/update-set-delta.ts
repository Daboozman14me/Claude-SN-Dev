import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { load } from "cheerio";

export const DELTA_FOLDERS = ["scope", "dictionary", "author_elective_update", "update", "unload.demo"] as const;
export type DeltaFolder = (typeof DELTA_FOLDERS)[number];
export type DeltaChange = "added" | "changed" | "deleted";

export interface AppRecordFile {
  name: string;
  folder: DeltaFolder;
  table: string;
  sysId?: string;
  content: string;
}

export interface DeltaEntry {
  name: string;
  folder: DeltaFolder;
  table: string;
  sysId?: string;
  change: DeltaChange;
  fieldsChanged: string[];
  payload: string;
}

export function sha256Hex(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

const normalize = (text: string): string => text.replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").trim();

// The record element inside a <record_update> payload (or the table element of a <database> payload).
function describe(content: string, folder: DeltaFolder, fileBase: string): { table: string; sysId?: string; updateName: string } {
  const $ = load(content, { xml: true });
  if (folder === "dictionary") {
    const table = $("database > element").first().attr("name") ?? fileBase;
    return { table: "sys_db_object", updateName: table };
  }
  const root = $("record_update").first();
  const record = root.children().first();
  const table = root.attr("table") ?? record.prop("tagName")?.toString().toLowerCase() ?? fileBase;
  const sysId = record.children("sys_id").first().text().trim() || undefined;
  const updateName = record.find("sys_update_name").first().text().trim() || fileBase;
  return { table, ...(sysId ? { sysId } : {}), updateName };
}

export function readAppTree(appDir: string, options: { includeDemo?: boolean } = {}): Map<string, AppRecordFile> {
  const records = new Map<string, AppRecordFile>();
  for (const folder of DELTA_FOLDERS) {
    if (folder === "unload.demo" && !options.includeDemo) continue;
    const dir = join(appDir, folder);
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir).filter((entry) => entry.endsWith(".xml")).sort()) {
      const content = readFileSync(join(dir, file), "utf8");
      const info = describe(content, folder, basename(file, ".xml"));
      const name = folder === "unload.demo" ? `demo:${info.updateName}` : info.updateName;
      records.set(name, { name, folder, table: info.table, ...(info.sysId ? { sysId: info.sysId } : {}), content });
    }
  }
  return records;
}

// Simple field values of a payload's record element, for change lists and the instance precheck.
export function payloadFields(content: string): Record<string, string> {
  const $ = load(content, { xml: true });
  const record = $("record_update").first().children().first();
  const fields: Record<string, string> = {};
  record.children().each((_, element) => {
    const node = $(element);
    if (node.children().length > 0) return;
    fields[element.tagName] = normalize(node.text());
  });
  return fields;
}

function changedFields(before: string, after: string, folder: DeltaFolder): string[] {
  if (folder === "dictionary") return ["(table definition)"];
  const a = payloadFields(before);
  const b = payloadFields(after);
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((field) => a[field] !== b[field]).sort();
}

export function asDelete(content: string): string {
  return content.replace(/(<record_update[^>]*>\s*<[A-Za-z0-9_]+\s+action=")INSERT_OR_UPDATE"/, '$1DELETE"');
}

export function diffAppTrees(from: Map<string, AppRecordFile>, to: Map<string, AppRecordFile>): DeltaEntry[] {
  const entries: DeltaEntry[] = [];
  for (const [name, after] of to) {
    const before = from.get(name);
    if (!before) {
      entries.push({ name, folder: after.folder, table: after.table, ...(after.sysId ? { sysId: after.sysId } : {}), change: "added", fieldsChanged: [], payload: after.content });
    } else if (normalize(before.content) !== normalize(after.content)) {
      entries.push({
        name, folder: after.folder, table: after.table, ...(after.sysId ? { sysId: after.sysId } : {}),
        change: "changed", fieldsChanged: changedFields(before.content, after.content, after.folder), payload: after.content,
      });
    }
  }
  for (const [name, before] of from) {
    if (to.has(name)) continue;
    entries.push({
      name, folder: before.folder, table: before.table, ...(before.sysId ? { sysId: before.sysId } : {}),
      change: "deleted", fieldsChanged: [], payload: before.folder === "dictionary" ? before.content : asDelete(before.content),
    });
  }
  const order = (entry: DeltaEntry): number => DELTA_FOLDERS.indexOf(entry.folder);
  return entries.sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name));
}

export function treeManifestSha(tree: Map<string, AppRecordFile>): string {
  return sha256Hex([...tree.values()].map((record) => `${record.name}\n${sha256Hex(normalize(record.content))}`).sort().join("\n"));
}

const escapeXml = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export interface UpdateSetHeader {
  name: string;
  description: string;
  scopeSysId: string;
  scope: string;
  applicationName: string;
  timestamp: string;
}

// sys_ids for the update set and its entries derive from its name, so regeneration is byte-identical.
const derivedId = (...parts: string[]): string => sha256Hex(parts.join(":")).slice(0, 32);

export function renderDeltaUpdateSetXml(header: UpdateSetHeader, entries: DeltaEntry[]): string {
  const setId = derivedId("update_set", header.name);
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<unload unload_date="${header.timestamp}">`,
    `<sys_remote_update_set action="INSERT_OR_UPDATE"><application display_value="${escapeXml(header.applicationName)}">${header.scopeSysId}</application><application_name>${escapeXml(header.applicationName)}</application_name><application_scope>${header.scope}</application_scope><description>${escapeXml(header.description)}</description><name>${escapeXml(header.name)}</name><remote_sys_id>${setId}</remote_sys_id><state>loaded</state><sys_class_name>sys_remote_update_set</sys_class_name><sys_created_by>admin</sys_created_by><sys_created_on>${header.timestamp}</sys_created_on><sys_id>${setId}</sys_id><sys_mod_count>0</sys_mod_count><sys_updated_by>admin</sys_updated_by><sys_updated_on>${header.timestamp}</sys_updated_on></sys_remote_update_set>`,
  ];
  for (const entry of entries) {
    const action = entry.change === "deleted" ? "DELETE" : "INSERT_OR_UPDATE";
    const type = entry.folder === "dictionary" ? "Dictionary" : entry.table;
    lines.push(
      `<sys_update_xml action="INSERT_OR_UPDATE"><action>${action}</action><application display_value="${escapeXml(header.applicationName)}">${header.scopeSysId}</application><category>customer</category><name>${escapeXml(entry.name.replace(/^demo:/, ""))}</name><payload>${escapeXml(entry.payload)}</payload><remote_update_set display_value="${escapeXml(header.name)}">${setId}</remote_update_set><replace_on_upgrade>false</replace_on_upgrade><sys_created_by>admin</sys_created_by><sys_created_on>${header.timestamp}</sys_created_on><sys_id>${derivedId("update_xml", header.name, entry.name)}</sys_id><sys_mod_count>0</sys_mod_count><sys_updated_by>admin</sys_updated_by><sys_updated_on>${header.timestamp}</sys_updated_on><table/><target_name>${escapeXml(entry.name.replace(/^demo:/, ""))}</target_name><type>${escapeXml(type)}</type><update_domain>global</update_domain></sys_update_xml>`,
    );
  }
  lines.push("</unload>", "");
  return lines.join("\n");
}
