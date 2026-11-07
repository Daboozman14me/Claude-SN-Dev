import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { checkCodeReviewDrift } from "./check-code-review-drift.js";
import { isDirectExecution } from "./direct-execution.js";
import { readCodeReviewPackage } from "./validate-assisted-code-review.js";

export type FixOutcome =
  | "applied"
  | "skipped_drift"
  | "skipped_not_approved"
  | "skipped_no_change"
  | "failed";

export interface FixResult {
  findingId: string;
  outcome: FixOutcome;
  detail: string;
  path: string;
  startLine: number;
  endLine: number;
}

export interface ApplyFixesReport {
  reviewPath: string;
  dryRun: boolean;
  results: FixResult[];
  changedFiles: Array<{ path: string; sha256Before: string; sha256After: string }>;
}

function splitLines(content: string): { lines: string[]; eol: string } {
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  return { lines: content.split(/\r?\n/), eol };
}

function normalized(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n");
}

export function applyCodeReviewFixes(
  reviewJsonPath: string,
  options: { dryRun?: boolean } = {},
): ApplyFixesReport {
  const reviewPath = resolve(reviewJsonPath);
  const { value } = readCodeReviewPackage(reviewPath);
  const drift = new Map(
    checkCodeReviewDrift(reviewPath).results.map((result) => [result.findingId, result]),
  );

  const results: FixResult[] = [];
  const candidates: Array<{ findingId: string; path: string; startLine: number; endLine: number; currentCode: string; suggestedCode: string }> = [];
  for (const finding of value.findings) {
    const { path, startLine, endLine } = finding.location;
    const base = { findingId: finding.id, path, startLine, endLine };
    if (finding.decision.status !== "approved") {
      results.push({ ...base, outcome: "skipped_not_approved", detail: `Decision is '${finding.decision.status}'.` });
      continue;
    }
    if (finding.suggestedCode === null) {
      results.push({ ...base, outcome: "skipped_no_change", detail: "The finding proposes no code change." });
      continue;
    }
    const status = drift.get(finding.id)!;
    if (status.status !== "unchanged" && status.status !== "intact") {
      results.push({ ...base, outcome: "skipped_drift", detail: `Drift check: ${status.status} — ${status.detail}` });
      continue;
    }
    candidates.push({ ...base, currentCode: finding.currentCode, suggestedCode: finding.suggestedCode });
  }

  const byFile = new Map<string, typeof candidates>();
  for (const candidate of candidates) {
    const key = resolve(candidate.path);
    byFile.set(key, [...(byFile.get(key) ?? []), candidate]);
  }
  for (const [path, list] of byFile) {
    const sorted = [...list].sort((a, b) => a.startLine - b.startLine);
    for (let index = 1; index < sorted.length; index += 1) {
      if (sorted[index]!.startLine <= sorted[index - 1]!.endLine) {
        throw new Error(
          `Approved findings ${sorted[index - 1]!.findingId} and ${sorted[index]!.findingId} overlap in '${path}'. Nothing was applied; resolve the overlap first.`,
        );
      }
    }
  }

  const changedFiles: ApplyFixesReport["changedFiles"] = [];
  for (const [path, list] of byFile) {
    const original = readFileSync(path, "utf8");
    const { lines, eol } = splitLines(original);
    let changed = false;
    // Bottom-up so each replacement leaves earlier line numbers valid.
    for (const candidate of [...list].sort((a, b) => b.startLine - a.startLine)) {
      const current = lines.slice(candidate.startLine - 1, candidate.endLine).join("\n");
      if (normalized(current) !== normalized(candidate.currentCode)) {
        results.push({
          findingId: candidate.findingId,
          path: candidate.path,
          startLine: candidate.startLine,
          endLine: candidate.endLine,
          outcome: "failed",
          detail: "The reviewed lines are not an exact whole-line match for currentCode; not applied.",
        });
        continue;
      }
      lines.splice(
        candidate.startLine - 1,
        candidate.endLine - candidate.startLine + 1,
        ...candidate.suggestedCode.replace(/\r\n/g, "\n").split("\n"),
      );
      changed = true;
      results.push({
        findingId: candidate.findingId,
        path: candidate.path,
        startLine: candidate.startLine,
        endLine: candidate.endLine,
        outcome: "applied",
        detail: `Replaced lines ${candidate.startLine}-${candidate.endLine}.`,
      });
    }
    if (!changed) continue;
    const updated = lines.join(eol);
    const sha256Before = createHash("sha256").update(original, "utf8").digest("hex");
    const sha256After = createHash("sha256").update(updated, "utf8").digest("hex");
    if (!options.dryRun) writeFileSync(path, updated, "utf8");
    changedFiles.push({ path, sha256Before, sha256After });
  }

  const order = new Map(value.findings.map((finding, index) => [finding.id, index]));
  results.sort((a, b) => order.get(a.findingId)! - order.get(b.findingId)!);
  return { reviewPath, dryRun: options.dryRun ?? false, results, changedFiles };
}

if (isDirectExecution(import.meta.url, process.argv[1])) {
  const args = process.argv.slice(2);
  const path = args.find((arg) => !arg.startsWith("--"));
  if (!path) {
    process.stderr.write("Usage: npm run code-writer:apply-fixes -- <code-review-vNNN.json> [--dry-run]\n");
    process.exitCode = 1;
  } else {
    try {
      const report = applyCodeReviewFixes(path, { dryRun: args.includes("--dry-run") });
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      if (report.results.some((result) => result.outcome === "failed")) process.exitCode = 2;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`Applying code review fixes failed: ${message}\n`);
      process.exitCode = 1;
    }
  }
}
