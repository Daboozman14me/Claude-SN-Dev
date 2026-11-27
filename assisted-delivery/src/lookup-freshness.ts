import { readFileSync } from "node:fs";
import { isDirectExecution } from "./direct-execution.js";
import { researchLookupPackageSchema, type ResearchLookupPackage } from "./assisted-contracts.js";

// Decides whether an earlier lookup can be reused: Research re-reads only sys_id and sys_updated_on of
// the records it cited (one small query per table) and passes the query output here. Reuse only when
// every cited record still exists and none has changed — a hand edit in the instance counts, not just
// a deploy.

export interface FreshnessResult {
  fresh: boolean;
  changed: Array<{ table: string; sysId: string; was: string; now: string }>;
  missing: Array<{ table: string; sysId: string }>;
}

// now-sdk query JSON output: records with plain values or { value, display_value } pairs, possibly nested.
export function currentUpdateTimes(outputs: unknown[]): Map<string, string> {
  const times = new Map<string, string>();
  const plain = (value: unknown): string | undefined =>
    typeof value === "string" ? value : value && typeof value === "object" && "value" in value ? String((value as { value: unknown }).value) : undefined;
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(visit);
    } else if (node && typeof node === "object") {
      const record = node as Record<string, unknown>;
      const sysId = plain(record.sys_id);
      const updated = plain(record.sys_updated_on);
      if (sysId && updated) times.set(sysId.toLowerCase(), updated);
      Object.values(record).forEach(visit);
    }
  };
  outputs.forEach(visit);
  return times;
}

export function checkLookupFreshness(lookup: ResearchLookupPackage, outputs: unknown[]): FreshnessResult {
  const now = currentUpdateTimes(outputs);
  const changed: FreshnessResult["changed"] = [];
  const missing: FreshnessResult["missing"] = [];
  for (const record of lookup.results.flatMap((result) => result.records)) {
    const current = now.get(record.sysId.toLowerCase());
    if (current === undefined) missing.push({ table: record.table, sysId: record.sysId });
    else if (current !== record.sysUpdatedOn) changed.push({ table: record.table, sysId: record.sysId, was: record.sysUpdatedOn, now: current });
  }
  const cited = lookup.results.some((result) => result.records.length > 0);
  return { fresh: cited && changed.length === 0 && missing.length === 0, changed, missing };
}

if (isDirectExecution(import.meta.url, process.argv[1])) {
  const [lookupPath, ...outputPaths] = process.argv.slice(2);
  try {
    if (!lookupPath || outputPaths.length === 0) throw new Error("Usage: lookup-freshness.ts <research-lookup.json> <query-output.json> [...]");
    const lookup = researchLookupPackageSchema.parse(JSON.parse(readFileSync(lookupPath, "utf8")) as unknown);
    const outputs = outputPaths.map((path) => JSON.parse(readFileSync(path, "utf8")) as unknown);
    process.stdout.write(`${JSON.stringify(checkLookupFreshness(lookup, outputs), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
