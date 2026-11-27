import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { updateSetDeltaPackageSchema, type UpdateSetDeltaPackage } from "./assisted-contracts.js";
import { deltaUpdateSetName } from "./build-update-set-delta.js";
import { isDirectExecution } from "./direct-execution.js";
import { renderUpdateSetDeltaHtml } from "./render-report-html.js";
import { diffAppTrees, readAppTree, renderDeltaUpdateSetXml, sha256Hex, treeManifestSha } from "./update-set-delta.js";
import { matchArtifactFileName } from "./artifact-layout.js";

const IMPORT_READY = new Set(["absent", "matches_baseline", "already_applied", "not_compared"]);

function validateArtifactPair(value: UpdateSetDeltaPackage, jsonPath: string): string {
  const expectedJson = resolve(jsonPath);
  if (resolve(value.artifacts.json) !== expectedJson) throw new Error("Delta artifacts.json must identify the JSON file being validated.");
  const match = matchArtifactFileName(basename(expectedJson), "update-set-delta");
  if (!match) throw new Error("Delta JSON filename must use update-set-delta[-<work label>]-vNNN.json.");
  const expectedHtml = join(dirname(expectedJson), `${match[1]!}.html`);
  if (resolve(value.artifacts.html) !== resolve(expectedHtml)) throw new Error("Delta HTML must share the JSON report directory and version.");
  if (!existsSync(expectedHtml)) throw new Error(`Delta HTML artifact does not exist: '${expectedHtml}'.`);
  return expectedHtml;
}

export function validateAssistedUpdateSetDeltaFile(
  jsonPath: string,
  options: { verified?: boolean; checkGit?: boolean } = {},
): UpdateSetDeltaPackage {
  const value = updateSetDeltaPackageSchema.parse(JSON.parse(readFileSync(resolve(jsonPath), "utf8")));
  const htmlPath = validateArtifactPair(value, jsonPath);

  if (options.checkGit !== false) {
    for (const side of [value.from, value.to]) {
      const commit = execFileSync("git", ["-C", value.project, "rev-parse", `${side.ref}^{commit}`], { encoding: "utf8" }).trim();
      if (commit !== side.commit) throw new Error(`'${side.ref}' now points at ${commit.slice(0, 10)}, not ${side.commit.slice(0, 10)}; rebuild the delta.`);
    }
  }

  const fromTree = readAppTree(join(value.builds.directory, "from", "app"), { includeDemo: value.includeDemo });
  const toTree = readAppTree(join(value.builds.directory, "to", "app"), { includeDemo: value.includeDemo });
  if (treeManifestSha(fromTree) !== value.builds.fromSha || treeManifestSha(toTree) !== value.builds.toSha) {
    throw new Error("The kept builds changed after the delta was made; rebuild the delta.");
  }
  const entries = diffAppTrees(fromTree, toTree);
  if (!isDeepStrictEqual(entries.map(({ payload: _payload, ...entry }) => entry), value.entries)) {
    throw new Error("Entries differ from what update-set:delta derives from the builds; never edit entries by hand.");
  }
  const expectedName = deltaUpdateSetName(value.target.application, value.to.version, value.from.version);
  if (value.updateSet.name !== expectedName) throw new Error(`The update set should be named '${expectedName}'.`);
  const xml = renderDeltaUpdateSetXml(
    {
      name: value.updateSet.name,
      description: `Delta for ${value.target.application} from ${value.from.version} (${value.from.ref}) to ${value.to.version} (${value.to.ref}).`,
      scopeSysId: value.target.scopeSysId,
      scope: value.target.scope,
      applicationName: value.target.application,
      timestamp: value.timestamp,
    },
    entries,
  );
  if (!existsSync(value.updateSet.path) || readFileSync(value.updateSet.path, "utf8") !== xml || sha256Hex(xml) !== value.updateSet.sha256) {
    throw new Error("The update set XML differs from what update-set:delta generates; rebuild it.");
  }

  const checked = new Map(value.precheck.map((check) => [check.name, check]));
  const unchecked = value.entries.filter((entry) => !checked.has(entry.name));
  if (unchecked.length > 0) throw new Error(`Run update-set:precheck: ${unchecked.length} entries have no precheck (first: ${unchecked[0]!.name}).`);
  for (const check of value.precheck) {
    if (!IMPORT_READY.has(check.status) && !check.approvedOverwrite) {
      throw new Error(`'${check.name}' is ${check.status.replace(/_/g, " ")} on ${value.target.instanceAlias}: not import-ready without the owner's approval.`);
    }
  }

  if (options.verified) {
    const verified = new Map(value.verification.map((check) => [check.name, check]));
    for (const entry of value.entries) {
      const status = verified.get(entry.name)?.status;
      if (status !== "already_applied" && status !== "not_compared") {
        throw new Error(`After import, '${entry.name}' is ${status?.replace(/_/g, " ") ?? "not verified"}; expected already applied.`);
      }
    }
  }

  if (readFileSync(htmlPath, "utf8") !== renderUpdateSetDeltaHtml(value)) {
    throw new Error("Delta HTML differs from the rendered JSON; run report:render.");
  }
  return value;
}

if (isDirectExecution(import.meta.url, process.argv[1])) {
  const args = process.argv.slice(2);
  const jsonPath = args.find((arg) => !arg.startsWith("--"));
  try {
    if (!jsonPath) throw new Error("Usage: npm run validate:assisted-update-set-delta -- <update-set-delta[-<work label>]-vNNN.json> [--verified]");
    const value = validateAssistedUpdateSetDeltaFile(jsonPath, { verified: args.includes("--verified") });
    process.stdout.write(`Valid Update Set Delta: ${value.packageId} ('${value.updateSet.name}', ${value.entries.length} entries${args.includes("--verified") ? ", verified on the target" : ", import-ready"})\n`);
  } catch (error) {
    process.stderr.write(`Invalid Update Set Delta: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
