import { execFileSync } from "node:child_process";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { updateSetDeltaPackageSchema, type UpdateSetDeltaPackage } from "./assisted-contracts.js";
import { isDirectExecution } from "./direct-execution.js";
import { payloadFields, readAppTree } from "./update-set-delta.js";

export type DeltaCheckStatus = UpdateSetDeltaPackage["precheck"][number]["status"];
export interface DeltaCheck {
  name: string;
  status: DeltaCheckStatus;
  fields: string[];
  changedBy?: string;
  changedOn?: string;
}

// Platform bookkeeping the payload carries but a person never edits; never a sign of a UI change.
const IGNORED = new Set([
  "sys_id", "sys_scope", "sys_package", "sys_update_name", "sys_class_name", "sys_policy", "sys_created_by",
  "sys_created_on", "sys_updated_by", "sys_updated_on", "sys_mod_count", "sys_name", "sys_domain", "sys_domain_path",
  "sys_overrides", "sys_customer_update", "sys_replace_on_upgrade",
]);
const clean = (value: string | undefined): string => (value ?? "").replace(/\r\n/g, "\n").trim();

export function comparedFields(baseline: Record<string, string>, next: Record<string, string>): string[] {
  return [...new Set([...Object.keys(baseline), ...Object.keys(next)])].filter((field) => !IGNORED.has(field)).sort();
}

// Is the target at the baseline for this record, already at the new version, or changed by someone else?
export function classifyDeltaEntry(
  entry: UpdateSetDeltaPackage["entries"][number],
  baseline: Record<string, string> | undefined,
  next: Record<string, string> | undefined,
  instance: Record<string, string> | undefined,
): DeltaCheck {
  const base = { name: entry.name };
  if (entry.folder === "dictionary" || entry.folder === "author_elective_update" || !entry.sysId) {
    return { ...base, status: "not_compared", fields: [] };
  }
  const who = instance ? { ...(instance.sys_updated_by ? { changedBy: instance.sys_updated_by } : {}), ...(instance.sys_updated_on ? { changedOn: instance.sys_updated_on } : {}) } : {};
  const differs = (expected: Record<string, string> | undefined): string[] => {
    if (!instance || !expected) return ["(record)"];
    return comparedFields(baseline ?? {}, next ?? {}).filter((field) => field in instance && clean(instance[field]) !== clean(expected[field]));
  };
  if (entry.change === "added") {
    if (!instance) return { ...base, status: "absent", fields: [] };
    const off = differs(next);
    return off.length === 0 ? { ...base, status: "already_applied", fields: [] } : { ...base, status: "unexpected_present", fields: off, ...who };
  }
  if (entry.change === "deleted") {
    if (!instance) return { ...base, status: "already_applied", fields: [] };
    const off = differs(baseline);
    return off.length === 0 ? { ...base, status: "matches_baseline", fields: [] } : { ...base, status: "changed_on_instance", fields: off, ...who };
  }
  if (!instance) return { ...base, status: "changed_on_instance", fields: ["(record missing on target)"] };
  if (differs(next).length === 0) return { ...base, status: "already_applied", fields: [] };
  const off = differs(baseline);
  return off.length === 0 ? { ...base, status: "matches_baseline", fields: [] } : { ...base, status: "changed_on_instance", fields: off, ...who };
}

export type QueryRecords = (table: string, sysIds: string[], fields: string[]) => Array<Record<string, string>>;

export function nowSdkQuery(project: string, instanceAlias: string): QueryRecords {
  // The project's own SDK entry point, run with node directly: no shell, arguments passed as-is.
  const cli = join(project, "node_modules", "@servicenow", "sdk", "bin", "index.js");
  return (table, sysIds, fields) => {
    const output = execFileSync(
      process.execPath,
      [cli, "query", table, "-q", `sys_idIN${sysIds.join(",")}`, "-f", ["sys_id", ...fields, "sys_updated_by", "sys_updated_on"].join(","),
        "--limit", "500", "--no-count", "-a", instanceAlias, "-o", "json"],
      { cwd: project, encoding: "utf8" },
    );
    const parsed = JSON.parse(output.slice(output.indexOf("{"))) as { ok?: boolean; records?: Array<Record<string, string>>; error?: unknown };
    if (!parsed.ok) throw new Error(`Query of ${table} failed: ${JSON.stringify(parsed.error ?? parsed).slice(0, 300)}`);
    return parsed.records ?? [];
  };
}

export function precheckDelta(value: UpdateSetDeltaPackage, query: QueryRecords, options: { includeDemo?: boolean } = {}): DeltaCheck[] {
  const fromTree = readAppTree(join(value.builds.directory, "from", "app"), { includeDemo: options.includeDemo ?? value.includeDemo });
  const toTree = readAppTree(join(value.builds.directory, "to", "app"), { includeDemo: options.includeDemo ?? value.includeDemo });
  const fieldsOf = (name: string, tree: typeof fromTree): Record<string, string> | undefined => {
    const record = tree.get(name);
    return record ? payloadFields(record.content) : undefined;
  };
  const byTable = new Map<string, UpdateSetDeltaPackage["entries"]>();
  for (const entry of value.entries) {
    if (!entry.sysId || entry.folder === "dictionary" || entry.folder === "author_elective_update") continue;
    byTable.set(entry.table, [...(byTable.get(entry.table) ?? []), entry]);
  }
  const found = new Map<string, Record<string, string>>();
  for (const [table, entries] of byTable) {
    const fields = new Set<string>();
    for (const entry of entries) {
      for (const field of comparedFields(fieldsOf(entry.name, fromTree) ?? {}, fieldsOf(entry.name, toTree) ?? {})) fields.add(field);
    }
    for (const record of query(table, entries.map((entry) => entry.sysId!), [...fields].sort())) found.set(`${table}:${record.sys_id}`, record);
  }
  return value.entries.map((entry) => classifyDeltaEntry(
    entry,
    fieldsOf(entry.name, fromTree),
    fieldsOf(entry.name, toTree),
    entry.sysId ? found.get(`${entry.table}:${entry.sysId}`) : undefined,
  ));
}

export function runPrecheck(jsonPath: string, options: { verify?: boolean; query?: QueryRecords } = {}): UpdateSetDeltaPackage {
  const path = resolve(jsonPath);
  const value = updateSetDeltaPackageSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  const checks = precheckDelta(value, options.query ?? nowSdkQuery(value.project, value.target.instanceAlias));
  const approvals = new Map(value.precheck.map((check) => [check.name, check.approvedOverwrite]));
  const next = options.verify
    ? { ...value, verification: checks.map(({ name, status, fields }) => ({ name, status, fields })) }
    : {
      ...value,
      precheck: checks.map((check) => {
        const approved = approvals.get(check.name);
        return approved ? { ...check, approvedOverwrite: approved } : check;
      }),
    };
  const raw = JSON.parse(JSON.stringify(next)) as Record<string, unknown>;
  let result: UpdateSetDeltaPackage;
  try {
    result = updateSetDeltaPackageSchema.parse(raw);
  } catch {
    // A blocking precheck is still recorded so the owner can see it; validation will refuse the import.
    result = raw as UpdateSetDeltaPackage;
  }
  writeFileSync(`${path}.tmp`, `${JSON.stringify(result, null, 2)}\n`);
  renameSync(`${path}.tmp`, path);
  return result;
}

if (isDirectExecution(import.meta.url, process.argv[1])) {
  const args = process.argv.slice(2);
  const jsonPath = args.find((arg) => !arg.startsWith("--"));
  try {
    if (!jsonPath) throw new Error("Usage: npm run update-set:precheck -- <update-set-delta-vNNN.json> [--verify]");
    const verify = args.includes("--verify");
    const result = runPrecheck(jsonPath, { verify });
    const list = verify ? result.verification : result.precheck;
    const counts = new Map<string, number>();
    for (const check of list) counts.set(check.status, (counts.get(check.status) ?? 0) + 1);
    process.stdout.write(`${verify ? "Verification" : "Precheck"}: ${[...counts].map(([status, count]) => `${status}=${count}`).join(" ")}\n`);
    const blocked = list.filter((check) => check.status === "changed_on_instance" || check.status === "unexpected_present");
    for (const check of blocked) process.stdout.write(`  ${check.status}: ${check.name} [${check.fields.join(", ")}]\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
