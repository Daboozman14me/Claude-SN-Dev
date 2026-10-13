import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  programManifestSchema,
  programRegistrySchema,
  type ProgramManifest,
  type ProgramRegistry,
} from "./assisted-contracts.js";
import { isDirectExecution } from "./direct-execution.js";

export type ScaffoldingValidationKind = "registry" | "manifest";

export function validateAssistedScaffoldingJson(
  kind: "registry",
  json: string,
): ProgramRegistry;
export function validateAssistedScaffoldingJson(
  kind: "manifest",
  json: string,
): ProgramManifest;
export function validateAssistedScaffoldingJson(
  kind: ScaffoldingValidationKind,
  json: string,
): ProgramRegistry | ProgramManifest {
  const value = JSON.parse(json) as unknown;
  return kind === "registry"
    ? programRegistrySchema.parse(value)
    : programManifestSchema.parse(value);
}

export function validateAssistedScaffoldingFile(
  kind: ScaffoldingValidationKind,
  path: string,
): string {
  const absolutePath = resolve(path);
  const json = readFileSync(absolutePath, "utf8");
  if (kind === "registry") {
    validateAssistedScaffoldingJson("registry", json);
  } else {
    validateAssistedScaffoldingJson("manifest", json);
  }
  return absolutePath;
}

if (isDirectExecution(import.meta.url, process.argv[1])) {
  const args = process.argv.slice(2);
  const kindIndex = args.indexOf("--kind");
  const kindArg = kindIndex >= 0 ? args[kindIndex + 1] : undefined;
  const path = args.find(
    (_, index) => index !== kindIndex && index !== kindIndex + 1,
  );

  if ((kindArg !== "registry" && kindArg !== "manifest") || !path) {
    process.stderr.write(
      "Usage: npm run validate:assisted-scaffolding -- --kind <registry|manifest> <path.json>\n",
    );
    process.exitCode = 1;
  } else {
    try {
      const absolutePath = validateAssistedScaffoldingFile(kindArg, path);
      process.stdout.write(`Valid ${kindArg}: ${absolutePath}\n`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`Invalid ${kindArg}: ${message}\n`);
      process.exitCode = 1;
    }
  }
}
