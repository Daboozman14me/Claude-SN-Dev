import { isDeepStrictEqual } from "node:util";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { completionReportPackageSchema } from "./assisted-contracts.js";
import { composeCompletionReport, renderCompletionReportHtml } from "./compose-completion-report.js";
import { isDirectExecution } from "./direct-execution.js";
import { fileSha256 } from "./validate-assisted-code-review.js";

export interface CompletionReportValidationOptions {
  // Recompose from the implementation and review on disk and require an exact match.
  fresh?: boolean;
}

export function validateCompletionReportFile(path: string, options: CompletionReportValidationOptions = {}): string {
  const jsonPath = resolve(path);
  const value = completionReportPackageSchema.parse(JSON.parse(readFileSync(jsonPath, "utf8")) as unknown);
  const match = basename(jsonPath).match(/^(completion-report-v[0-9]+)\.json$/);
  if (!match) throw new Error("Completion report JSON filename must use completion-report-vNNN.json.");
  if (resolve(value.artifacts.json) !== jsonPath) {
    throw new Error("Completion report artifacts.json must identify the JSON file being validated.");
  }
  const htmlPath = join(dirname(jsonPath), `${match[1]!}.html`);
  if (resolve(value.artifacts.html) !== htmlPath || !existsSync(htmlPath)) {
    throw new Error(`Completion report HTML must exist beside the JSON as '${basename(htmlPath)}'.`);
  }
  if (readFileSync(htmlPath, "utf8") !== renderCompletionReportHtml(value)) {
    throw new Error("Completion report HTML does not match its JSON; it must be written by compose-completion-report.ts and not edited.");
  }

  if (options.fresh) {
    for (const [label, input] of [
      ["implementation", value.implementation],
      ["review", value.review],
    ] as const) {
      if (!existsSync(input.jsonPath)) throw new Error(`The ${label} package no longer exists: '${input.jsonPath}'.`);
      if (fileSha256(input.jsonPath) !== input.sha256) {
        throw new Error(`The ${label} package changed after this report was composed (for example, decisions were recorded); compose a new version.`);
      }
    }
    const recomposed = composeCompletionReport(value.implementation.jsonPath, value.review.jsonPath, value.artifacts, value.composedAt);
    if (!isDeepStrictEqual(recomposed, value)) {
      throw new Error("Completion report JSON does not match what its implementation and review produce.");
    }
  }
  return jsonPath;
}

if (isDirectExecution(import.meta.url, process.argv[1])) {
  const args = process.argv.slice(2);
  const path = args.find((arg) => !arg.startsWith("--"));
  if (!path) {
    process.stderr.write("Usage: npm run validate:assisted-completion-report -- <completion-report-vNNN.json> [--fresh]\n");
    process.exitCode = 1;
  } else {
    try {
      process.stdout.write(`Valid CompletionReportPackage: ${validateCompletionReportFile(path, { fresh: args.includes("--fresh") })}\n`);
    } catch (error) {
      process.stderr.write(`Invalid CompletionReportPackage: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    }
  }
}
