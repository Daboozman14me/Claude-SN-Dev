import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import {
  storyDraftPackageSchema,
  technicalDesignPackageSchema,
  type StoryDraftPackage,
} from "./assisted-contracts.js";
import { isDirectExecution } from "./direct-execution.js";
import { validateAssistedTechnicalDesignFile } from "./validate-assisted-technical-design.js";

export function validateAssistedStoryDraftJson(json: string): void {
  storyDraftPackageSchema.parse(JSON.parse(json) as unknown);
}

function validateArtifactPair(
  value: StoryDraftPackage,
  validatedJsonPath: string,
): void {
  const expectedJsonPath = resolve(validatedJsonPath);
  if (resolve(value.artifacts.json) !== expectedJsonPath) {
    throw new Error(
      "Story artifacts.json must identify the JSON file being validated.",
    );
  }
  const match = basename(expectedJsonPath).match(/^(story-draft-v[0-9]+)\.json$/);
  if (!match) {
    throw new Error("Story JSON filename must use story-draft-vNNN.json.");
  }
  const expectedHtmlPath = join(dirname(expectedJsonPath), `${match[1]!}.html`);
  if (resolve(value.artifacts.html) !== resolve(expectedHtmlPath)) {
    throw new Error(
      "Story HTML must share the JSON report directory and version.",
    );
  }
  if (!existsSync(expectedHtmlPath) || !statSync(expectedHtmlPath).isFile()) {
    throw new Error(`Story HTML artifact does not exist: '${expectedHtmlPath}'.`);
  }
}

export function validateAssistedStoryDraftFile(path: string): string {
  const absolutePath = resolve(path);
  const value = storyDraftPackageSchema.parse(
    JSON.parse(readFileSync(absolutePath, "utf8")) as unknown,
  );
  validateArtifactPair(value, absolutePath);
  validateDesignBasis(value);
  return absolutePath;
}

// Stories for a designed change must rest on a completed, valid design (mode=design).
function validateDesignBasis(value: StoryDraftPackage): void {
  if (value.designBasis.kind !== "technical_design") return;
  const designPath = resolve(value.designBasis.path);
  if (!existsSync(designPath)) {
    throw new Error(`The technical design the stories are based on does not exist: '${designPath}'.`);
  }
  try {
    validateAssistedTechnicalDesignFile(designPath);
  } catch (error) {
    throw new Error(
      `The technical design the stories are based on is not a valid, completed design: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const design = technicalDesignPackageSchema.parse(JSON.parse(readFileSync(designPath, "utf8")) as unknown);
  if (design.mode !== "design") {
    throw new Error("Stories must be based on a technical design (mode=design), not a design evaluation.");
  }
  if (design.packageId !== value.designBasis.packageId) {
    throw new Error(`designBasis.packageId '${value.designBasis.packageId}' does not match the design's '${design.packageId}'.`);
  }
}

if (isDirectExecution(import.meta.url, process.argv[1])) {
  const path = process.argv[2];
  if (!path) {
    process.stderr.write(
      "Usage: npm run validate:assisted-stories -- <story-draft.json>\n",
    );
    process.exitCode = 1;
  } else {
    try {
      process.stdout.write(
        `Valid StoryDraftPackage: ${validateAssistedStoryDraftFile(path)}\n`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`Invalid StoryDraftPackage: ${message}\n`);
      process.exitCode = 1;
    }
  }
}
