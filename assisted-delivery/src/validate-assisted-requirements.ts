import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import {
  requirementsExtractionPackageSchema,
  type RequirementsExtractionPackage,
} from "./assisted-contracts.js";
import { isDirectExecution } from "./direct-execution.js";

export function validateAssistedRequirementsJson(json: string): void {
  requirementsExtractionPackageSchema.parse(JSON.parse(json) as unknown);
}

function validateArtifactPair(
  value: RequirementsExtractionPackage,
  validatedJsonPath: string,
): void {
  const expectedJsonPath = resolve(validatedJsonPath);
  if (resolve(value.artifacts.json) !== expectedJsonPath) {
    throw new Error(
      "Requirements artifacts.json must identify the JSON file being validated.",
    );
  }
  const match = basename(expectedJsonPath).match(
    /^(requirements-extraction-v[0-9]+)\.json$/,
  );
  if (!match) {
    throw new Error(
      "Requirements JSON filename must use requirements-extraction-vNNN.json.",
    );
  }
  const expectedHtmlPath = join(dirname(expectedJsonPath), `${match[1]!}.html`);
  if (resolve(value.artifacts.html) !== resolve(expectedHtmlPath)) {
    throw new Error(
      "Requirements HTML must share the JSON report directory and version.",
    );
  }
  if (!existsSync(expectedHtmlPath) || !statSync(expectedHtmlPath).isFile()) {
    throw new Error(
      `Requirements HTML artifact does not exist: '${expectedHtmlPath}'.`,
    );
  }
}

export function validateAssistedRequirementsFile(path: string): string {
  const absolutePath = resolve(path);
  const value = requirementsExtractionPackageSchema.parse(
    JSON.parse(readFileSync(absolutePath, "utf8")) as unknown,
  );
  validateArtifactPair(value, absolutePath);
  return absolutePath;
}

if (isDirectExecution(import.meta.url, process.argv[1])) {
  const path = process.argv[2];
  if (!path) {
    process.stderr.write(
      "Usage: npm run validate:assisted-requirements -- <requirements-extraction.json>\n",
    );
    process.exitCode = 1;
  } else {
    try {
      process.stdout.write(
        `Valid RequirementsExtractionPackage: ${validateAssistedRequirementsFile(path)}\n`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(
        `Invalid RequirementsExtractionPackage: ${message}\n`,
      );
      process.exitCode = 1;
    }
  }
}
