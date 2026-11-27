import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { matchArtifactFileName } from "./artifact-layout.js";
import { researchLookupPackageSchema, type ResearchLookupPackage } from "./assisted-contracts.js";
import { isDirectExecution } from "./direct-execution.js";
import { findPersonalData } from "./mask-evidence.js";

// A research lookup is research-lookup[-<work label>]-vNNN.json + .md in the research folder, with its
// raw query output (full script text included) masked in evidence/<same name>/.
export function validateResearchLookupFile(path: string): ResearchLookupPackage {
  const jsonPath = resolve(path);
  const value = researchLookupPackageSchema.parse(JSON.parse(readFileSync(jsonPath, "utf8")) as unknown);
  if (resolve(value.artifacts.json) !== jsonPath) throw new Error("Lookup artifacts.json must identify the JSON file being validated.");
  const match = matchArtifactFileName(basename(jsonPath), "research-lookup");
  if (!match) throw new Error("Lookup JSON filename must use research-lookup[-<work label>]-vNNN.json.");
  const markdownPath = join(dirname(jsonPath), `${match[1]}.md`);
  if (resolve(value.artifacts.markdown) !== markdownPath) throw new Error("Lookup Markdown must share the JSON's folder and name.");
  if (!existsSync(markdownPath)) throw new Error(`Lookup Markdown does not exist: '${markdownPath}'.`);
  const evidenceDirectory = join(dirname(jsonPath), "evidence", match[1]);
  if (resolve(value.artifacts.evidenceDirectory) !== evidenceDirectory) throw new Error("Lookup evidence must be in evidence/<lookup name>/ beside it.");

  const markdown = readFileSync(markdownPath, "utf8");
  for (const item of value.request.items) {
    if (!markdown.includes(item.id)) throw new Error(`Lookup Markdown does not answer ${item.id}.`);
  }
  for (const result of value.results) {
    for (const record of result.records) {
      const file = resolve(record.evidenceFile);
      if (relative(evidenceDirectory, file).startsWith("..")) throw new Error(`Evidence for ${result.itemId} is outside the lookup's evidence folder: '${file}'.`);
      if (!existsSync(file) || !statSync(file).isFile()) throw new Error(`Evidence for ${result.itemId} does not exist: '${file}'.`);
      const personal = findPersonalData(readFileSync(file, "utf8"));
      if (personal.length > 0) throw new Error(`Lookup evidence '${file}' still holds personal data (${personal.slice(0, 3).join(", ")}); run evidence:mask on the evidence folder.`);
    }
  }
  return value;
}

if (isDirectExecution(import.meta.url, process.argv[1])) {
  const path = process.argv[2];
  try {
    if (!path) throw new Error("Usage: validate-assisted-research-lookup.ts <research-lookup[-<work label>]-vNNN.json>");
    validateResearchLookupFile(path);
    process.stdout.write(`Valid ResearchLookupPackage: ${resolve(path)}\n`);
  } catch (error) {
    process.stderr.write(`Invalid ResearchLookupPackage: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
