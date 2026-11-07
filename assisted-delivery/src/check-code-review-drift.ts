import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { CodeReviewFinding } from "./assisted-contracts.js";
import { isDirectExecution } from "./direct-execution.js";
import { fileSha256, readCodeReviewPackage } from "./validate-assisted-code-review.js";

export type DriftStatus =
  | "unchanged"
  | "intact"
  | "moved"
  | "changed"
  | "missing";

export interface DriftResult {
  findingId: string;
  decision: string;
  path: string;
  status: DriftStatus;
  startLine: number;
  endLine: number;
  currentStartLine?: number;
  detail: string;
}

export interface DriftReport {
  safeToApply: boolean;
  results: DriftResult[];
}

function normalizeLines(text: string): string[] {
  return text.replace(/\r\n/g, "\n").split("\n").map((line) => line.trimEnd());
}

function locate(lines: string[], snippet: string[]): number | undefined {
  const target = snippet.join("\n").trim();
  if (!target) return undefined;
  for (let start = 0; start < lines.length; start += 1) {
    const window = lines.slice(start, start + snippet.length).join("\n");
    if (window.includes(target)) return start + 1;
  }
  return undefined;
}

function checkFinding(finding: CodeReviewFinding, sourceSha: string | undefined): DriftResult {
  const { location } = finding;
  const base = {
    findingId: finding.id,
    decision: finding.decision.status,
    path: location.path,
    startLine: location.startLine,
    endLine: location.endLine,
  };
  if (!existsSync(location.path)) {
    return { ...base, status: "missing", detail: "The reviewed file no longer exists." };
  }
  if (sourceSha && fileSha256(location.path) === sourceSha) {
    return { ...base, status: "unchanged", detail: "File is byte-for-byte identical to the reviewed version." };
  }
  const lines = normalizeLines(readFileSync(location.path, "utf8"));
  const snippet = normalizeLines(finding.currentCode);
  const atLines = lines
    .slice(location.startLine - 1, location.endLine)
    .join("\n");
  if (atLines.includes(snippet.join("\n").trim())) {
    return {
      ...base,
      status: "intact",
      detail: "File changed elsewhere, but the reviewed code is still at the recorded lines.",
    };
  }
  const found = locate(lines, snippet);
  if (found !== undefined) {
    return {
      ...base,
      status: "moved",
      currentStartLine: found,
      detail: `The reviewed code now starts at line ${found}; re-confirm the fix before applying.`,
    };
  }
  return {
    ...base,
    status: "changed",
    detail: "The reviewed code is no longer present; the finding must be re-reviewed before any fix.",
  };
}

export function checkCodeReviewDrift(
  jsonPath: string,
  options: { approvedOnly?: boolean } = {},
): DriftReport {
  const { value } = readCodeReviewPackage(resolve(jsonPath));
  const shaBySource = new Map(value.reviewedSources.map((source) => [source.id, source.sha256]));
  const findings = options.approvedOnly
    ? value.findings.filter((finding) => finding.decision.status === "approved")
    : value.findings;
  const results = findings.map((finding) =>
    checkFinding(finding, shaBySource.get(finding.location.sourceId)),
  );
  return {
    safeToApply: results.every((result) => result.status === "unchanged" || result.status === "intact"),
    results,
  };
}

if (isDirectExecution(import.meta.url, process.argv[1])) {
  const args = process.argv.slice(2);
  const path = args.find((arg) => !arg.startsWith("--"));
  if (!path) {
    process.stderr.write(
      "Usage: npm run code-review:drift -- <code-review-vNNN.json> [--approved-only]\n",
    );
    process.exitCode = 1;
  } else {
    try {
      const report = checkCodeReviewDrift(path, { approvedOnly: args.includes("--approved-only") });
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      if (!report.safeToApply) process.exitCode = 2;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`Code review drift check failed: ${message}\n`);
      process.exitCode = 1;
    }
  }
}
