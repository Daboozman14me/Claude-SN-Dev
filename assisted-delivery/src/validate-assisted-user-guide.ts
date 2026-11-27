import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { userGuidePackageSchema, type UserGuidePackage } from "./assisted-contracts.js";
import { sha256Hex } from "./build-backlog.js";
import { isDirectExecution } from "./direct-execution.js";
import { renderUserGuideHtml } from "./render-report-html.js";
import { matchArtifactFileName } from "./artifact-layout.js";

function validateArtifactPair(value: UserGuidePackage, jsonPath: string): string {
  const expectedJson = resolve(jsonPath);
  if (resolve(value.artifacts.json) !== expectedJson) throw new Error("User guide artifacts.json must identify the JSON file being validated.");
  const match = matchArtifactFileName(basename(expectedJson), "user-guide");
  if (!match) throw new Error("User guide JSON filename must use user-guide[-<work label>]-vNNN.json.");
  const expectedHtml = join(dirname(expectedJson), `${match[1]!}.html`);
  if (resolve(value.artifacts.html) !== resolve(expectedHtml)) throw new Error("User guide HTML must share the JSON report directory and version.");
  if (!existsSync(expectedHtml)) throw new Error(`User guide HTML artifact does not exist: '${expectedHtml}'.`);
  return expectedHtml;
}

// Stories a code-implementation source covers as implemented; those reports carry their own validator.
function implementedStories(value: UserGuidePackage): Set<string> {
  const implemented = new Set<string>();
  for (const source of value.sources.filter((entry) => entry.kind === "code_implementation")) {
    const raw = JSON.parse(readFileSync(resolve(source.path), "utf8")) as { storyCoverage?: Array<{ storyId?: string; status?: string }> };
    for (const entry of raw.storyCoverage ?? []) {
      if (entry.status === "implemented" && entry.storyId) implemented.add(entry.storyId);
    }
  }
  for (const override of value.storyStatusOverrides) {
    if (override.status === "implemented") implemented.add(override.storyId);
    else implemented.delete(override.storyId);
  }
  return implemented;
}

export function validateAssistedUserGuideFile(jsonPath: string): UserGuidePackage {
  const value = userGuidePackageSchema.parse(JSON.parse(readFileSync(resolve(jsonPath), "utf8")));
  const htmlPath = validateArtifactPair(value, jsonPath);

  for (const source of value.sources) {
    const path = resolve(source.path);
    if (!existsSync(path)) throw new Error(`Source does not exist: '${source.path}'.`);
    if (sha256Hex(readFileSync(path)) !== source.sha256) throw new Error(`Source changed after the guide was written (sha256 differs): '${source.path}'.`);
  }
  if (!value.sources.some((source) => source.kind === "code_implementation")) {
    throw new Error("A user guide needs at least one code-implementation source: it describes only delivered work.");
  }

  const implemented = implementedStories(value);
  const coverage = new Map(value.featureCoverage.map((entry) => [entry.storyId, entry]));
  for (const storyId of implemented) {
    if (!coverage.has(storyId)) throw new Error(`Implemented story ${storyId} is not in featureCoverage (cover it in a section or say why not).`);
  }
  for (const entry of value.featureCoverage) {
    if (entry.sectionIds.length > 0 && !implemented.has(entry.storyId)) {
      throw new Error(`Story ${entry.storyId} is described in the guide, but no code-implementation source covers it as implemented.`);
    }
  }
  value.parts.forEach((part) => {
    for (const section of part.sections) {
      for (const reference of section.references) {
        if (reference.kind === "story" && !implemented.has(reference.id)) {
          throw new Error(`Section '${section.id}' cites story ${reference.id}, which is not implemented in any source.`);
        }
      }
    }
  });

  if (readFileSync(htmlPath, "utf8") !== renderUserGuideHtml(value)) {
    throw new Error("User guide HTML differs from the rendered JSON; run report:render.");
  }
  return value;
}

if (isDirectExecution(import.meta.url, process.argv[1])) {
  const jsonPath = process.argv[2];
  try {
    if (!jsonPath) throw new Error("Usage: npm run validate:assisted-user-guide -- <user-guide[-<work label>]-vNNN.json>");
    const value = validateAssistedUserGuideFile(jsonPath);
    const sections = value.parts.reduce((sum, part) => sum + part.sections.length, 0);
    process.stdout.write(`Valid User Guide: ${value.packageId} (${sections} sections, ${value.featureCoverage.length} stories accounted for)\n`);
  } catch (error) {
    process.stderr.write(`Invalid User Guide: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
