import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  backlogPackageSchema,
  type BacklogPackage,
} from "./assisted-contracts.js";
import { buildBacklogRecords, planImportFiles, readStoryDraft, sha256Hex } from "./build-backlog.js";
import { isDirectExecution } from "./direct-execution.js";
import { renderBacklogHtml } from "./render-report-html.js";
import { matchArtifactFileName } from "./artifact-layout.js";

function validateArtifactPair(value: BacklogPackage, jsonPath: string): string {
  const expectedJson = resolve(jsonPath);
  if (resolve(value.artifacts.json) !== expectedJson) throw new Error("Backlog artifacts.json must identify the JSON file being validated.");
  const match = matchArtifactFileName(basename(expectedJson), "backlog");
  if (!match) throw new Error("Backlog JSON filename must use backlog[-<work label>]-vNNN.json.");
  const expectedHtml = join(dirname(expectedJson), `${match[1]!}.html`);
  if (resolve(value.artifacts.html) !== resolve(expectedHtml)) throw new Error("Backlog HTML must share the JSON report directory and version.");
  if (!existsSync(expectedHtml)) throw new Error(`Backlog HTML artifact does not exist: '${expectedHtml}'.`);
  return expectedHtml;
}

function validateEvidence(value: BacklogPackage): void {
  const coverage = new Map<string, Map<string, string>>();
  const storiesIn = (path: string): Map<string, string> => {
    const key = resolve(path);
    const cached = coverage.get(key);
    if (cached) return cached;
    if (!existsSync(key)) throw new Error(`Evidence file does not exist: '${path}'.`);
    // Evidence reports carry their own validator; only their story coverage matters here.
    const raw = JSON.parse(readFileSync(key, "utf8")) as { packageType?: string; storyCoverage?: Array<{ storyId?: string; status?: string }> };
    const entries = raw.packageType === "code_implementation" && Array.isArray(raw.storyCoverage) ? raw.storyCoverage : [];
    const map = new Map<string, string>(entries.map((entry) => [String(entry.storyId), String(entry.status)]));
    coverage.set(key, map);
    return map;
  };
  for (const status of value.storyStatus) {
    if (status.basis === "partial") {
      const covered = status.evidence.some((evidence) => ["partial", "implemented"].includes(storiesIn(evidence.path).get(status.storyId) ?? ""));
      if (!covered) throw new Error(`Story ${status.storyId} is marked partial, but no evidence file covers it.`);
      continue;
    }
    if (status.basis !== "deployed" && status.basis !== "implemented_not_deployed") continue;
    const implemented = status.evidence.some((evidence) => storiesIn(evidence.path).get(status.storyId) === "implemented");
    if (!implemented) {
      throw new Error(`Story ${status.storyId} is marked implemented, but no evidence file is a code implementation report covering it as implemented.`);
    }
  }
  if (value.storyStatus.some((status) => status.basis === "deployed") && value.instanceChecks.length === 0) {
    throw new Error("Stories marked deployed need an instance check recording the deployed version.");
  }
  for (const source of value.progressSources) {
    if (!existsSync(resolve(source.path))) throw new Error(`Progress source does not exist: '${source.path}'.`);
  }
}

export function validateAssistedBacklogFile(jsonPath: string, options: { verified?: boolean } = {}): BacklogPackage {
  const value = backlogPackageSchema.parse(JSON.parse(readFileSync(resolve(jsonPath), "utf8")));
  const htmlPath = validateArtifactPair(value, jsonPath);

  const { draft, sha256 } = readStoryDraft(value.storyDraft.path);
  if (draft.packageId !== value.storyDraft.packageId) throw new Error("storyDraft.packageId does not match the story draft file.");
  if (sha256 !== value.storyDraft.sha256) throw new Error("The story draft changed after this backlog was built (sha256 differs).");

  if (!isDeepStrictEqual(value.records, buildBacklogRecords(value, draft))) {
    throw new Error("Records differ from what backlog:build derives from the story draft and plan; re-run backlog:build, never edit records by hand.");
  }
  if (value.importFiles.length === 0) throw new Error("No import file: run backlog:build.");
  const split = value.importFiles.length > 1 || value.importFiles[0]!.tables.length === 1;
  const expected = planImportFiles(value, value.records, split);
  if (expected.length !== value.importFiles.length) throw new Error("Import files do not match the records; re-run backlog:build.");
  expected.forEach((file, index) => {
    const declared = value.importFiles[index]!;
    if (resolve(declared.path) !== resolve(file.path)) throw new Error(`Import file ${index + 1} should be '${file.path}'.`);
    if (!existsSync(file.path)) throw new Error(`Import file does not exist: '${file.path}'.`);
    const onDisk = readFileSync(file.path, "utf8");
    if (onDisk !== file.content || sha256Hex(onDisk) !== declared.sha256) {
      throw new Error(`Import file '${file.path}' differs from what backlog:build generates; re-run backlog:build.`);
    }
  });

  validateEvidence(value);

  if (value.modes.includes("sync")) {
    const checked = new Set(value.precheck.map((entry) => entry.sysId));
    const unchecked = value.records.filter((record) => !checked.has(record.sysId));
    if (unchecked.length > 0) {
      throw new Error(`A sync must precheck every record on the instance before import; ${unchecked.length} not checked (first: ${unchecked[0]!.source.kind} ${unchecked[0]!.source.id}).`);
    }
  }

  if (readFileSync(htmlPath, "utf8") !== renderBacklogHtml(value)) {
    throw new Error("Backlog HTML differs from the rendered JSON; run report:render.");
  }
  if (options.verified && !value.modes.includes("verify")) throw new Error("--verified needs a package in verify mode.");
  return value;
}

if (isDirectExecution(import.meta.url, process.argv[1])) {
  const args = process.argv.slice(2);
  const jsonPath = args.find((arg) => !arg.startsWith("--"));
  try {
    if (!jsonPath) throw new Error("Usage: npm run validate:assisted-backlog -- <backlog[-<work label>]-vNNN.json> [--verified]");
    const value = validateAssistedBacklogFile(jsonPath, { verified: args.includes("--verified") });
    process.stdout.write(`Valid Backlog Package: ${value.packageId} (${value.records.length} records, modes ${value.modes.join("+")})\n`);
  } catch (error) {
    process.stderr.write(`Invalid Backlog Package: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
