import { execFileSync } from "node:child_process";
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { updateSetDeltaPackageSchema, type UpdateSetDeltaPackage } from "./assisted-contracts.js";
import { isDirectExecution } from "./direct-execution.js";
import { diffAppTrees, readAppTree, renderDeltaUpdateSetXml, sha256Hex, treeManifestSha } from "./update-set-delta.js";

export type BuildApp = (project: string, commit: string, workDir: string) => string;

const git = (project: string, args: string[]): string => execFileSync("git", ["-C", project, ...args], { encoding: "utf8" }).trim();
const keysPath = (root: string): string => join(root, "src", "fluent", "generated", "keys.ts");
const sameIgnoringLineEndings = (a: string, b: string): boolean => a.replace(/\r\n/g, "\n") === b.replace(/\r\n/g, "\n");

// Extracts one commit (git archive: read-only to the repo), builds it with the project's node_modules
// through a junction, and returns the dist/app folder. The junction is removed with unlink, which never
// touches the real node_modules.
export const buildAppAtCommit: BuildApp = (project, commit, workDir) => {
  const source = join(workDir, "src");
  rmSync(source, { recursive: true, force: true });
  mkdirSync(source, { recursive: true });
  const tarPath = join(workDir, "source.tar");
  git(project, ["archive", "--format=tar", "-o", tarPath, commit]);
  // Relative paths: GNU tar reads a leading "C:" as a remote host.
  execFileSync("tar", ["-xf", "source.tar", "-C", "src"], { cwd: workDir });
  rmSync(tarPath, { force: true });
  const link = join(source, "node_modules");
  symlinkSync(join(project, "node_modules"), link, "junction");
  try {
    const keysBefore = existsSync(keysPath(source)) ? readFileSync(keysPath(source), "utf8") : "";
    execFileSync(process.execPath, [join(source, "node_modules", "@servicenow", "sdk", "bin", "index.js"), "build"], { cwd: source, stdio: "pipe" });
    const keysAfter = existsSync(keysPath(source)) ? readFileSync(keysPath(source), "utf8") : "";
    if (!sameIgnoringLineEndings(keysBefore, keysAfter)) {
      throw new Error(`Building ${commit} changed its keys file: record ids would differ from the deployed build.`);
    }
    const app = join(workDir, "app");
    rmSync(app, { recursive: true, force: true });
    cpSync(join(source, "dist", "app"), app, { recursive: true });
    return app;
  } finally {
    if (existsSync(link) && lstatSync(link).isSymbolicLink()) unlinkSync(link);
    if (!existsSync(link)) rmSync(source, { recursive: true, force: true });
  }
};

export const appVersion = (appDir: string): string => {
  const scope = readAppTree(appDir);
  const app = [...scope.values()].find((record) => record.folder === "scope");
  return app?.content.match(/<version>([^<]*)<\/version>/)?.[1] ?? "unknown";
};

const utcStamp = (): string => new Date().toISOString().replace("T", " ").replace(/\.\d+Z$/, "");

export function deltaUpdateSetName(application: string, toVersion: string, fromVersion: string): string {
  return `${application} ${toVersion} (delta from ${fromVersion})`;
}

export interface DeltaBuildOptions {
  project: string;
  from: string;
  to: string;
  into: string;
  instanceAlias: string;
  includeDemo?: boolean;
  build?: BuildApp;
}

export function buildUpdateSetDelta(options: DeltaBuildOptions): UpdateSetDeltaPackage {
  const project = resolve(options.project);
  const jsonPath = resolve(options.into);
  if (!existsSync(jsonPath)) throw new Error(`--into needs an existing package skeleton: '${jsonPath}'.`);
  const fromCommit = git(project, ["rev-parse", `${options.from}^{commit}`]);
  const toCommit = git(project, ["rev-parse", `${options.to}^{commit}`]);
  if (options.to === "HEAD" && git(project, ["status", "--porcelain"]) !== "") {
    throw new Error("The project has uncommitted changes; commit them first so the delta matches a real commit.");
  }
  const config = JSON.parse(readFileSync(join(project, "now.config.json"), "utf8")) as { scope: string; scopeId: string; name: string };
  const builds = jsonPath.replace(/\.json$/, "-builds");
  const build = options.build ?? buildAppAtCommit;
  const fromApp = build(project, fromCommit, join(builds, "from"));
  const toApp = build(project, toCommit, join(builds, "to"));
  const fromTree = readAppTree(fromApp, { includeDemo: Boolean(options.includeDemo) });
  const toTree = readAppTree(toApp, { includeDemo: Boolean(options.includeDemo) });
  const entries = diffAppTrees(fromTree, toTree);
  const fromVersion = appVersion(fromApp);
  const toVersion = appVersion(toApp);

  const skeleton = JSON.parse(readFileSync(jsonPath, "utf8")) as Record<string, unknown>;
  const timestamp = typeof skeleton.timestamp === "string" ? skeleton.timestamp : utcStamp();
  const name = deltaUpdateSetName(config.name, toVersion, fromVersion);
  const xmlPath = jsonPath.replace(/\.json$/, ".xml");
  const xml = renderDeltaUpdateSetXml(
    { name, description: `Delta for ${config.name} from ${fromVersion} (${options.from}) to ${toVersion} (${options.to}).`, scopeSysId: config.scopeId, scope: config.scope, applicationName: config.name, timestamp },
    entries,
  );
  writeFileSync(xmlPath, xml);

  const result = updateSetDeltaPackageSchema.parse({
    ...skeleton,
    target: { application: config.name, scope: config.scope, scopeSysId: config.scopeId, instanceAlias: options.instanceAlias },
    project,
    from: { ref: options.from, commit: fromCommit, version: fromVersion },
    to: { ref: options.to, commit: toCommit, version: toVersion },
    includeDemo: Boolean(options.includeDemo),
    timestamp,
    builds: { directory: builds, fromSha: treeManifestSha(fromTree), toSha: treeManifestSha(toTree) },
    entries: entries.map(({ payload: _payload, ...entry }) => entry),
    updateSet: { name, path: xmlPath, sha256: sha256Hex(xml), entryCount: entries.length },
    precheck: [],
    verification: [],
  });
  writeFileSync(`${jsonPath}.tmp`, `${JSON.stringify(result, null, 2)}\n`);
  renameSync(`${jsonPath}.tmp`, jsonPath);
  return result;
}

if (isDirectExecution(import.meta.url, process.argv[1])) {
  const args = process.argv.slice(2);
  const option = (flag: string): string | undefined => {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : undefined;
  };
  try {
    const project = option("--project");
    const from = option("--from");
    const into = option("--into");
    const instanceAlias = option("--instance");
    if (!project || !from || !into || !instanceAlias) {
      throw new Error("Usage: npm run update-set:delta -- --project <fluent dir> --from <tag|commit> [--to <ref, default HEAD>] --instance <alias> --into <update-set-delta-vNNN.json> [--include-demo]");
    }
    const result = buildUpdateSetDelta({ project, from, to: option("--to") ?? "HEAD", into, instanceAlias, includeDemo: args.includes("--include-demo") });
    const counts = ["added", "changed", "deleted"].map((change) => `${change}=${result.entries.filter((entry) => entry.change === change).length}`).join(" ");
    process.stdout.write(`Built '${result.updateSet.name}': ${result.entries.length} entries (${counts}) -> ${result.updateSet.path}\n`);
    process.stdout.write(`Builds kept in ${dirname(result.updateSet.path)} for the validator.\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
