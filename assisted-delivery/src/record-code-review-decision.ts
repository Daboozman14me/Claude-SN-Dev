import { renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  CODE_REVIEW_DECISION_STATUSES,
  codeReviewPackageSchema,
  type CodeReviewPackage,
} from "./assisted-contracts.js";
import { isDirectExecution } from "./direct-execution.js";
import { readCodeReviewPackage } from "./validate-assisted-code-review.js";

type DecisionStatus = (typeof CODE_REVIEW_DECISION_STATUSES)[number];

export interface DecisionRequest {
  findingIds: string[];
  status: DecisionStatus;
  note?: string;
  now?: Date;
}

export interface DecisionSummary {
  total: number;
  counts: Record<DecisionStatus, number>;
  findings: Array<{
    id: string;
    severity: string;
    title: string;
    status: DecisionStatus;
    note?: string;
  }>;
}

export function summarizeDecisions(value: CodeReviewPackage): DecisionSummary {
  const counts = Object.fromEntries(
    CODE_REVIEW_DECISION_STATUSES.map((status) => [status, 0]),
  ) as Record<DecisionStatus, number>;
  for (const finding of value.findings) counts[finding.decision.status] += 1;
  return {
    total: value.findings.length,
    counts,
    findings: value.findings.map((finding) => ({
      id: finding.id,
      severity: finding.severity,
      title: finding.title,
      status: finding.decision.status,
      ...(finding.decision.note ? { note: finding.decision.note } : {}),
    })),
  };
}

// Only finding.decision is ever changed; everything the reviewer wrote is preserved verbatim.
export function recordCodeReviewDecision(
  jsonPath: string,
  request: DecisionRequest,
): DecisionSummary {
  const absolutePath = resolve(jsonPath);
  const { raw, value } = readCodeReviewPackage(absolutePath);
  if (resolve(value.artifacts.json) !== absolutePath) {
    throw new Error("Code review artifacts.json must identify the JSON file being updated.");
  }
  if (request.findingIds.length === 0) {
    throw new Error("At least one finding id is required.");
  }
  if (!CODE_REVIEW_DECISION_STATUSES.includes(request.status)) {
    throw new Error(
      `Decision must be one of ${CODE_REVIEW_DECISION_STATUSES.join(", ")}; got '${request.status}'.`,
    );
  }
  const rawFindings = raw.findings as Array<Record<string, unknown>> | undefined;
  const known = new Set(value.findings.map((finding) => finding.id));
  const unknown = request.findingIds.filter((id) => !known.has(id));
  if (unknown.length > 0) {
    throw new Error(`Unknown finding id(s): ${unknown.join(", ")}. Nothing was recorded.`);
  }

  const decidedOn = (request.now ?? new Date()).toISOString();
  for (const id of new Set(request.findingIds)) {
    const target = rawFindings!.find((finding) => finding.id === id)!;
    target.decision =
      request.status === "pending"
        ? { status: "pending", ...(request.note ? { note: request.note } : {}) }
        : { status: request.status, ...(request.note ? { note: request.note } : {}), decidedOn };
  }

  const updated = codeReviewPackageSchema.parse(raw);
  const temporaryPath = `${absolutePath}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
  renameSync(temporaryPath, absolutePath);
  return summarizeDecisions(updated);
}

function parseArguments(argv: string[]): {
  jsonPath?: string;
  summaryOnly: boolean;
  findingIds: string[];
  status?: string;
  note?: string;
} {
  const result: ReturnType<typeof parseArguments> = { summaryOnly: false, findingIds: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    const takeValue = (): string => {
      const next = argv[index + 1];
      if (next === undefined || next.startsWith("--")) {
        throw new Error(`Option '${argument}' requires a value.`);
      }
      index += 1;
      return next;
    };
    if (argument === "--summary") result.summaryOnly = true;
    else if (argument === "--finding") {
      result.findingIds.push(
        ...takeValue()
          .split(",")
          .map((id) => id.trim())
          .filter(Boolean),
      );
    } else if (argument === "--decision") result.status = takeValue();
    else if (argument === "--note") result.note = takeValue();
    else if (argument.startsWith("--")) throw new Error(`Unknown option '${argument}'.`);
    else if (!result.jsonPath) result.jsonPath = argument;
    else throw new Error(`Unexpected argument '${argument}'.`);
  }
  return result;
}

if (isDirectExecution(import.meta.url, process.argv[1])) {
  try {
    const args = parseArguments(process.argv.slice(2));
    if (!args.jsonPath || (!args.summaryOnly && (!args.status || args.findingIds.length === 0))) {
      process.stderr.write(
        "Usage: npm run code-review:decide -- <code-review-vNNN.json> --finding F-001[,F-002] --decision approved|rejected|deferred|pending [--note \"...\"]\n" +
          "       npm run code-review:decide -- <code-review-vNNN.json> --summary\n",
      );
      process.exitCode = 1;
    } else {
      const summary = args.summaryOnly
        ? summarizeDecisions(readCodeReviewPackage(args.jsonPath).value)
        : recordCodeReviewDecision(args.jsonPath, {
            findingIds: args.findingIds,
            status: args.status as DecisionStatus,
            ...(args.note ? { note: args.note } : {}),
          });
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Code review decision failed: ${message}\n`);
    process.exitCode = 1;
  }
}
