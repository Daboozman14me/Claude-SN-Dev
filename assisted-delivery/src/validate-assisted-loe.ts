import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import {
  levelOfEffortPackageSchema,
  type LevelOfEffortPackage,
} from "./assisted-contracts.js";
import { isDirectExecution } from "./direct-execution.js";

export function validateAssistedLoeJson(json: string): void {
  levelOfEffortPackageSchema.parse(JSON.parse(json) as unknown);
}

function validateArtifactSet(
  value: LevelOfEffortPackage,
  validatedJsonPath: string,
): void {
  const expectedJsonPath = resolve(validatedJsonPath);
  if (resolve(value.artifacts.json) !== expectedJsonPath) {
    throw new Error(
      "Level-of-effort artifacts.json must identify the JSON file being validated.",
    );
  }
  const match = basename(expectedJsonPath).match(
    /^(level-of-effort-v[0-9]+)\.json$/,
  );
  if (!match) {
    throw new Error(
      "Level-of-effort JSON filename must use level-of-effort-vNNN.json.",
    );
  }
  const expectedHtmlPath = join(dirname(expectedJsonPath), `${match[1]!}.html`);
  if (resolve(value.artifacts.html) !== resolve(expectedHtmlPath)) {
    throw new Error(
      "Level-of-effort HTML must share the JSON report directory and version.",
    );
  }
  if (!existsSync(expectedHtmlPath) || !statSync(expectedHtmlPath).isFile()) {
    throw new Error(
      `Level-of-effort HTML artifact does not exist: '${expectedHtmlPath}'.`,
    );
  }
  if (value.artifacts.xlsm) {
    const expectedXlsmPath = join(
      dirname(expectedJsonPath),
      `${match[1]!}.xlsm`,
    );
    if (resolve(value.artifacts.xlsm) !== resolve(expectedXlsmPath)) {
      throw new Error(
        "Level-of-effort filled .xlsm must share the JSON report directory and version.",
      );
    }
    if (!existsSync(expectedXlsmPath) || !statSync(expectedXlsmPath).isFile()) {
      throw new Error(
        `Level-of-effort filled .xlsm artifact does not exist: '${expectedXlsmPath}'.`,
      );
    }
  }
}

export function validateAssistedLoeFile(path: string): string {
  const absolutePath = resolve(path);
  const value = levelOfEffortPackageSchema.parse(
    JSON.parse(readFileSync(absolutePath, "utf8")) as unknown,
  );
  validateArtifactSet(value, absolutePath);
  return absolutePath;
}

if (isDirectExecution(import.meta.url, process.argv[1])) {
  const path = process.argv[2];
  if (!path) {
    process.stderr.write(
      "Usage: npm run validate:assisted-loe -- <level-of-effort.json>\n",
    );
    process.exitCode = 1;
  } else {
    try {
      process.stdout.write(
        `Valid LevelOfEffortPackage: ${validateAssistedLoeFile(path)}\n`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`Invalid LevelOfEffortPackage: ${message}\n`);
      process.exitCode = 1;
    }
  }
}
