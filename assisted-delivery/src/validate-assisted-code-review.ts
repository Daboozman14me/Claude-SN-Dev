import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { load } from "cheerio";
import {
  codeReviewPackageSchema,
  type CodeReviewPackage,
} from "./assisted-contracts.js";
import { isDirectExecution } from "./direct-execution.js";

export const CODE_REVIEW_HTML_SECTIONS = [
  "Summary",
  "Scope and Sources",
  "Findings",
  "Instance Checks",
  "Limitations",
] as const;

export interface CodeReviewValidationOptions {
  // A freshly written review: every decision pending and every reviewed file unchanged.
  fresh?: boolean;
}

export function readCodeReviewPackage(path: string): {
  raw: Record<string, unknown>;
  value: CodeReviewPackage;
} {
  const raw = JSON.parse(readFileSync(resolve(path), "utf8")) as Record<
    string,
    unknown
  >;
  return { raw, value: codeReviewPackageSchema.parse(raw) };
}

export function fileSha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function visibleText(html: string): string {
  return load(html).root().text().replace(/\s+/g, " ").trim();
}

function validateArtifactPair(
  value: CodeReviewPackage,
  validatedJsonPath: string,
): string {
  const expectedJsonPath = resolve(validatedJsonPath);
  if (resolve(value.artifacts.json) !== expectedJsonPath) {
    throw new Error(
      "Code review artifacts.json must identify the JSON file being validated.",
    );
  }
  const match = basename(expectedJsonPath).match(/^(code-review-v[0-9]+)\.json$/);
  if (!match) {
    throw new Error("Code review JSON filename must use code-review-vNNN.json.");
  }
  const expectedHtmlPath = join(dirname(expectedJsonPath), `${match[1]!}.html`);
  if (resolve(value.artifacts.html) !== resolve(expectedHtmlPath)) {
    throw new Error(
      "Code review HTML must share the JSON report directory and version.",
    );
  }
  if (!existsSync(expectedHtmlPath) || !statSync(expectedHtmlPath).isFile()) {
    throw new Error(`Code review HTML artifact does not exist: '${expectedHtmlPath}'.`);
  }
  return expectedHtmlPath;
}

function validateHtml(value: CodeReviewPackage, htmlPath: string): void {
  const html = readFileSync(htmlPath, "utf8");
  const $ = load(html);
  const headings = $("h2")
    .map((_, element) => $(element).text().replace(/\s+/g, " ").trim().toLocaleLowerCase())
    .get();
  for (const section of CODE_REVIEW_HTML_SECTIONS) {
    if (!headings.some((heading) => heading.replace(/^\d+\.\s*/, "") === section.toLocaleLowerCase())) {
      throw new Error(`Code review HTML is missing required <h2> section '${section}'.`);
    }
  }

  const pageText = visibleText(html);
  for (const source of value.reviewedSources) {
    if (!pageText.includes(source.id)) {
      throw new Error(`Code review HTML does not list reviewed source '${source.id}'.`);
    }
  }

  const markerPattern = /<!--\s*finding:(F-[0-9]{3,})\s*-->/g;
  const markers = [...html.matchAll(markerPattern)].map((match) => ({
    id: match[1]!,
    index: match.index!,
  }));
  const knownIds = new Set(value.findings.map((finding) => finding.id));
  for (const marker of markers) {
    if (!knownIds.has(marker.id)) {
      throw new Error(`Code review HTML has a marker for unknown finding '${marker.id}'.`);
    }
  }
  for (const finding of value.findings) {
    const position = markers.findIndex((marker) => marker.id === finding.id);
    if (position < 0) {
      throw new Error(`Code review HTML is missing marker '<!-- finding:${finding.id} -->'.`);
    }
    if (markers.filter((marker) => marker.id === finding.id).length > 1) {
      throw new Error(`Code review HTML repeats the marker for '${finding.id}'.`);
    }
    const start = markers[position]!.index;
    const nextMarker = markers
      .map((marker) => marker.index)
      .filter((index) => index > start)
      .sort((a, b) => a - b)[0];
    const nextSection = html.slice(start).search(/<h2\b/i);
    const ends = [nextMarker, nextSection >= 0 ? start + nextSection : undefined]
      .filter((index): index is number => index !== undefined);
    const block = visibleText(html.slice(start, ends.length ? Math.min(...ends) : html.length));
    const lineLabel =
      finding.location.startLine === finding.location.endLine
        ? `${finding.location.startLine}`
        : `${finding.location.startLine}-${finding.location.endLine}`;
    const required = [
      finding.id,
      finding.title.replace(/\s+/g, " ").trim(),
      finding.severity,
      `${basename(finding.location.path)}:${lineLabel}`,
    ];
    for (const detail of required) {
      if (!block.includes(detail)) {
        throw new Error(
          `Code review HTML finding '${finding.id}' is missing visible detail '${detail}'.`,
        );
      }
    }
  }
}

function validateFresh(value: CodeReviewPackage): void {
  for (const finding of value.findings) {
    if (finding.decision.status !== "pending") {
      throw new Error(
        `A fresh code review must leave every decision pending; '${finding.id}' is '${finding.decision.status}'.`,
      );
    }
  }
  for (const source of value.reviewedSources) {
    if (!existsSync(source.path)) {
      throw new Error(`Reviewed source '${source.id}' no longer exists: '${source.path}'.`);
    }
    if (fileSha256(source.path) !== source.sha256) {
      throw new Error(
        `Reviewed source '${source.id}' changed since it was indexed; the reviewer must never modify reviewed code.`,
      );
    }
  }
}

export function validateAssistedCodeReviewFile(
  path: string,
  options: CodeReviewValidationOptions = {},
): string {
  const absolutePath = resolve(path);
  const { value } = readCodeReviewPackage(absolutePath);
  const htmlPath = validateArtifactPair(value, absolutePath);
  validateHtml(value, htmlPath);
  if (options.fresh) validateFresh(value);
  return absolutePath;
}

if (isDirectExecution(import.meta.url, process.argv[1])) {
  const args = process.argv.slice(2);
  const fresh = args.includes("--fresh");
  const path = args.find((arg) => !arg.startsWith("--"));
  if (!path) {
    process.stderr.write(
      "Usage: npm run validate:assisted-code-review -- <code-review-vNNN.json> [--fresh]\n",
    );
    process.exitCode = 1;
  } else {
    try {
      process.stdout.write(
        `Valid CodeReviewPackage: ${validateAssistedCodeReviewFile(path, { fresh })}\n`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`Invalid CodeReviewPackage: ${message}\n`);
      process.exitCode = 1;
    }
  }
}
