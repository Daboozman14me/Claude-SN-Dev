import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import {
  storyDraftPackageSchema,
  type StoryDraftPackage,
} from "./assisted-contracts.js";
import { isDirectExecution } from "./direct-execution.js";

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
  return absolutePath;
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
