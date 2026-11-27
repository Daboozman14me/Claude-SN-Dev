import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { ARTIFACT_TYPE_FOLDERS, artifactTypeFolder } from "./artifact-layout.js";
import { registeredApplicationFolder, slugifyArtifactName } from "./artifact-storage.js";
import { isDirectExecution } from "./direct-execution.js";
import { findProjectSetup } from "./read-project-setup.js";
import { validateAssistedBacklogFile } from "./validate-assisted-backlog.js";
import { validateAssistedCodeImplementationFile } from "./validate-assisted-code-implementation.js";
import { validateAssistedCodeReviewFile } from "./validate-assisted-code-review.js";
import { validateCompletionReportFile } from "./validate-assisted-completion-report.js";
import { validateAssistedLoeFile } from "./validate-assisted-loe.js";
import { validateAssistedRecommendationFile } from "./validate-assisted-recommendation.js";
import { validateAssistedRequirementsFile } from "./validate-assisted-requirements.js";
import { validateAssistedResearchFile } from "./validate-assisted-research.js";
import { validateAssistedStoryDraftFile } from "./validate-assisted-story-draft.js";
import { validateAssistedTechnicalDesignFile } from "./validate-assisted-technical-design.js";
import { validateAssistedTestPlanFile } from "./validate-assisted-test-plan.js";
import { validateAssistedUpdateSetDeltaFile } from "./validate-assisted-update-set-delta.js";
import { validateAssistedUserGuideFile } from "./validate-assisted-user-guide.js";

// Moves an application's documents from the old one-folder-per-request layout
// (Artifacts\<app>\<request>\<base>-vNNN.*) into the type layout at its registered location
// (<app folder>\<type>\<base>-<work label>-vNNN.*). Two steps: `plan` writes a reviewable plan (old
// folder -> work label, every file's old and new path); `apply` copies, rewrites absolute paths inside
// the copies, validates every package before and after, and only then archives the old folder. Nothing
// is deleted.

const BASES = Object.keys(ARTIFACT_TYPE_FOLDERS).sort((a, b) => b.length - a.length);
// "<base>-vNNN" plus what follows it in a file or folder name (an extension, -scripts, -builds).
const DOCUMENT = new RegExp(`^(${BASES.join("|")})-(v[0-9]+)(\\.[a-z0-9]+|-scripts|-builds)$`);
// An evidence folder is named by the bare stem.
const BARE_STEM = new RegExp(`^(${BASES.join("|")})-(v[0-9]+)()$`);
const TEXT_EXTENSIONS = new Set([".json", ".html", ".md", ".txt", ".xml", ".js", ".csv"]);

export interface MigrationApp {
  // Old folder name under the source root, e.g. "new-conf-room-booking".
  from: string;
  // Registered application name it belongs to.
  application: string;
  program?: string | undefined;
}

export interface PlannedMove {
  from: string;
  to: string;
  kind: "document" | "evidence" | "other";
}

export interface MigrationPlan {
  createdAt: string;
  sourceRoot: string;
  apps: Array<MigrationApp & {
    targetFolder: string;
    // Old request folder -> work label used in the new file names ("" = no label). Edit before applying.
    labels: Record<string, string>;
    moves: PlannedMove[];
    conflicts: string[];
  }>;
}

// Folders whose name is just the document type carry no work label (an app-wide document).
function defaultLabel(folder: string, appSlug: string): string {
  const slug = slugifyArtifactName(folder);
  const typeNames = new Set([...Object.keys(ARTIFACT_TYPE_FOLDERS), ...Object.values(ARTIFACT_TYPE_FOLDERS)]);
  if (typeNames.has(slug)) return "";
  // A review folder shares its implementation's label; its type folder already says "review".
  const trimmed = slug.replace(/-review$/, "").replace(new RegExp(`(^|-)${appSlug}(-|$)`), "$1").replace(/^-+|-+$/g, "");
  return trimmed.length > 48 ? trimmed.slice(0, 48).replace(/-[^-]*$/, "") : trimmed;
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? [path, ...walk(path)] : [path];
  });
}

export function planMigration(input: {
  sourceRoot: string;
  apps: MigrationApp[];
  registryPath?: string;
  labels?: Record<string, Record<string, string>>;
}): MigrationPlan {
  const sourceRoot = resolve(input.sourceRoot);
  const apps = input.apps.map((app) => {
    const registered = findProjectSetup(app.application, { registryPath: input.registryPath, program: app.program });
    if (!registered) throw new Error(`'${app.application}' is not registered; register it before migrating '${app.from}'.`);
    const targetFolder = registeredApplicationFolder(registered);
    const appRoot = join(sourceRoot, app.from);
    if (!existsSync(appRoot)) throw new Error(`No folder '${appRoot}'.`);
    const appSlug = slugifyArtifactName(registered.project.application);
    const labels: Record<string, string> = {};
    const moves: PlannedMove[] = [];
    for (const folder of readdirSync(appRoot)) {
      const folderPath = join(appRoot, folder);
      if (!statSync(folderPath).isDirectory()) {
        moves.push({ from: folderPath, to: join(targetFolder, folder), kind: "other" });
        continue;
      }
      const label = input.labels?.[app.from]?.[folder] ?? defaultLabel(folder, appSlug);
      labels[folder] = label;
      const entries = readdirSync(folderPath).filter((name) => name !== ".reservations");
      const typesHere = entries.map((name) => name.match(DOCUMENT)?.[1]).filter((base): base is string => Boolean(base));
      const folderType = typesHere.length > 0 ? artifactTypeFolder(typesHere[0]!) : slugifyArtifactName(folder);
      const rename = (base: string, version: string, rest: string): string => `${base}${label ? `-${label}` : ""}-${version}${rest}`;
      for (const name of entries) {
        const path = join(folderPath, name);
        const document = name.match(DOCUMENT);
        if (document) {
          moves.push({ from: path, to: join(targetFolder, artifactTypeFolder(document[1]!), rename(document[1]!, document[2]!, document[3]!)), kind: "document" });
        } else if ((name === "evidence" || name === "internal") && statSync(path).isDirectory()) {
          // evidence\<stem>\ and internal\<stem>.json follow their document's new name.
          for (const inner of readdirSync(path)) {
            const stem = inner.match(DOCUMENT) ?? inner.match(BARE_STEM);
            const target = stem ? rename(stem[1]!, stem[2]!, stem[3] ?? "") : inner;
            const type = stem ? artifactTypeFolder(stem[1]!) : folderType;
            moves.push({ from: join(path, inner), to: join(targetFolder, type, name, target), kind: "evidence" });
          }
        } else {
          moves.push({ from: path, to: join(targetFolder, folderType, name), kind: "other" });
        }
      }
    }
    const seen = new Map<string, string>();
    const conflicts: string[] = [];
    for (const move of moves) {
      const key = move.to.toLocaleLowerCase();
      const prior = seen.get(key);
      if (prior) conflicts.push(`${move.to} would receive both '${prior}' and '${move.from}'; give one of their folders a different label.`);
      else seen.set(key, move.from);
      if (existsSync(move.to)) conflicts.push(`${move.to} already exists.`);
    }
    return { ...app, targetFolder, labels, moves, conflicts };
  });
  return { createdAt: new Date().toISOString(), sourceRoot, apps };
}

// Every form an absolute path takes inside a report: as written, JSON-escaped, and with forward slashes.
function pathForms(path: string): string[] {
  const windows = path.split("/").join("\\");
  return [...new Set([windows, windows.split("\\").join("\\\\"), windows.split("\\").join("/")])];
}

export function rewritePaths(text: string, pairs: Array<[string, string]>): { text: string; replaced: number } {
  let replaced = 0;
  let result = text;
  // Longest first, so a folder rewrite never pre-empts a file inside it.
  for (const [from, to] of [...pairs].sort((a, b) => b[0].length - a[0].length)) {
    const fromForms = pathForms(from);
    const toForms = pathForms(to);
    fromForms.forEach((form, index) => {
      const parts = result.split(form);
      if (parts.length > 1) {
        replaced += parts.length - 1;
        result = parts.join(toForms[index]!);
      }
    });
  }
  return { text: result, replaced };
}

// Validates one package JSON by its document type; undefined when the file is not a package.
export function validatePackage(jsonPath: string): { ok: boolean; message: string } | undefined {
  const name = basename(jsonPath);
  const base = BASES.find((candidate) => name.startsWith(`${candidate}-`) && name.endsWith(".json"));
  if (!base || dirname(jsonPath).endsWith(`${sep}evidence`)) return undefined;
  const run = (): unknown => {
    switch (base) {
      case "application-research": {
        const value = JSON.parse(readFileSync(jsonPath, "utf8")) as { requestContext?: { targetApplication?: string } };
        return validateAssistedResearchFile(jsonPath, value.requestContext?.targetApplication ?? "");
      }
      case "solution-recommendation": return validateAssistedRecommendationFile(jsonPath);
      case "technical-design": return validateAssistedTechnicalDesignFile(jsonPath);
      case "story-draft": return validateAssistedStoryDraftFile(jsonPath);
      case "test-plan": return validateAssistedTestPlanFile(jsonPath);
      case "code-implementation": return validateAssistedCodeImplementationFile(jsonPath);
      case "completion-report": return validateCompletionReportFile(jsonPath);
      case "code-review": return validateAssistedCodeReviewFile(jsonPath);
      case "backlog": return validateAssistedBacklogFile(jsonPath);
      case "user-guide": return validateAssistedUserGuideFile(jsonPath);
      case "requirements-extraction": return validateAssistedRequirementsFile(jsonPath);
      case "level-of-effort": return validateAssistedLoeFile(jsonPath);
      case "update-set-delta": return validateAssistedUpdateSetDeltaFile(jsonPath);
      default: return undefined;
    }
  };
  try {
    run();
    return { ok: true, message: "valid" };
  } catch (error) {
    return { ok: false, message: (error instanceof Error ? error.message : String(error)).split("\n")[0]!.slice(0, 300) };
  }
}

export interface MigrationResult {
  copied: number;
  rewrittenFiles: number;
  // Recorded hashes of moved documents that matched the original exactly and were updated to the copy.
  resealedHashes: number;
  validation: Array<{ before: string; after: string; was: string; now: string }>;
  regressions: string[];
  archivedTo: string[];
}

const sha256 = (path: string): string => createHash("sha256").update(readFileSync(path)).digest("hex");

// Rewriting paths changes a document's bytes, so a hash another document recorded for it goes stale.
// Update only hashes that matched the original file exactly (a hash that was already stale stays stale,
// and its validator still reports it), and only inside files that name the document's new path.
// Repeats until nothing changes, because a resealed file's own hash may be recorded elsewhere.
function resealHashes(files: Array<{ from: string; to: string }>): number {
  let resealed = 0;
  // Every value a file's hash has had: the original, then each value written during resealing.
  const known = new Map(files.map((file) => [file.to, new Set([sha256(file.from)])]));
  for (let pass = 0; pass < 10; pass += 1) {
    let changed = false;
    const current = new Map(files.map((file) => [file.to, sha256(file.to)]));
    for (const target of files) {
      if (!target.to.endsWith(".json")) continue;
      let text = readFileSync(target.to, "utf8");
      let touched = false;
      for (const other of files) {
        if (other.to === target.to) continue;
        const now = current.get(other.to)!;
        if (!pathForms(other.to).some((form) => text.includes(form))) continue;
        for (const was of known.get(other.to)!) {
          if (was === now || !text.includes(was)) continue;
          text = text.split(was).join(now);
          touched = true;
          resealed += 1;
        }
      }
      if (touched) {
        writeFileSync(target.to, text);
        changed = true;
      }
    }
    for (const file of files) known.get(file.to)!.add(current.get(file.to)!);
    if (!changed) return resealed;
  }
  throw new Error("Hash resealing did not settle; the documents reference each other in a loop.");
}

export function applyMigration(plan: MigrationPlan, options: { alsoRewrite?: string[]; archive?: boolean } = {}): MigrationResult {
  const conflicts = plan.apps.flatMap((app) => app.conflicts);
  if (conflicts.length > 0) throw new Error(`The plan has conflicts; fix them and plan again:\n${conflicts.join("\n")}`);
  const moves = plan.apps.flatMap((app) => app.moves);
  const pairs: Array<[string, string]> = moves.map((move) => [move.from, move.to]);

  // Validate the originals first, so only new failures count against the migration.
  const before = new Map<string, { ok: boolean; message: string }>();
  for (const move of moves) {
    for (const file of statSync(move.from).isDirectory() ? walk(move.from) : [move.from]) {
      const verdict = file.endsWith(".json") ? validatePackage(file) : undefined;
      if (verdict) before.set(resolve(file), verdict);
    }
  }

  let copied = 0;
  for (const move of moves) {
    mkdirSync(dirname(move.to), { recursive: true });
    cpSync(move.from, move.to, { recursive: true, errorOnExist: true, force: false });
    copied += 1;
  }
  let rewrittenFiles = 0;
  const copiedFiles = moves.flatMap((move) =>
    statSync(move.to).isDirectory()
      ? walk(move.to).filter((path) => !statSync(path).isDirectory()).map((to) => ({ from: join(move.from, relative(move.to, to)), to }))
      : [{ from: move.from, to: move.to }],
  );
  for (const file of [...copiedFiles.map((copy) => copy.to), ...(options.alsoRewrite ?? [])]) {
    if (!existsSync(file) || statSync(file).isDirectory()) continue;
    const extension = file.slice(file.lastIndexOf(".")).toLowerCase();
    if (!TEXT_EXTENSIONS.has(extension)) continue;
    const original = readFileSync(file, "utf8");
    const { text, replaced } = rewritePaths(original, pairs);
    if (replaced > 0) {
      writeFileSync(file, text);
      rewrittenFiles += 1;
    }
  }
  const resealedHashes = resealHashes(copiedFiles);

  const validation: MigrationResult["validation"] = [];
  const regressions: string[] = [];
  const toNew = (oldPath: string): string => rewritePaths(oldPath, pairs).text;
  for (const [oldPath, was] of before) {
    const newPath = toNew(oldPath);
    const now = validatePackage(newPath) ?? { ok: false, message: "not found after the move" };
    validation.push({ before: oldPath, after: newPath, was: was.message, now: now.message });
    if (was.ok && !now.ok) regressions.push(`${relative(plan.sourceRoot, oldPath)}: valid before, now '${now.message}'`);
  }

  const archivedTo: string[] = [];
  if (regressions.length === 0 && options.archive !== false) {
    const stamp = plan.createdAt.slice(0, 10);
    for (const app of plan.apps) {
      const archive = join(plan.sourceRoot, "_archive", `${app.from}-migrated-${stamp}`);
      mkdirSync(dirname(archive), { recursive: true });
      renameSync(join(plan.sourceRoot, app.from), archive);
      archivedTo.push(archive);
    }
  }
  return { copied, rewrittenFiles, resealedHashes, validation, regressions, archivedTo };
}

if (isDirectExecution(import.meta.url, process.argv[1])) {
  const [command, ...args] = process.argv.slice(2);
  const values = (name: string): string[] => args.flatMap((arg, index) => (arg === name && args[index + 1] ? [args[index + 1]!] : []));
  const value = (name: string): string | undefined => values(name)[0];
  try {
    if (command === "plan") {
      const from = value("--from");
      const out = value("--out");
      const apps = values("--app").map((spec) => {
        const [folder, application, program] = spec.split("=");
        if (!folder || !application) throw new Error(`--app takes "<old folder>=<Application>[=<program>]", not '${spec}'.`);
        return { from: folder, application, program };
      });
      if (!from || !out || apps.length === 0) throw new Error('Usage: plan --from <Artifacts dir> --app "<old folder>=<Application>[=<program>]" [...] --out <plan.json> [--labels <labels.json>]');
      const labels = value("--labels") ? (JSON.parse(readFileSync(value("--labels")!, "utf8")) as Record<string, Record<string, string>>) : undefined;
      const plan = planMigration({ sourceRoot: from, apps, ...(labels ? { labels } : {}) });
      writeFileSync(out, `${JSON.stringify(plan, null, 2)}\n`);
      for (const app of plan.apps) {
        process.stdout.write(`${app.from} -> ${app.targetFolder}: ${app.moves.length} moves, ${app.conflicts.length} conflicts\n`);
        for (const [folder, label] of Object.entries(app.labels)) process.stdout.write(`  ${folder}  =>  ${label || "(no label)"}\n`);
        for (const conflict of app.conflicts) process.stdout.write(`  CONFLICT ${conflict}\n`);
      }
    } else if (command === "apply") {
      const planPath = args[0];
      if (!planPath) throw new Error("Usage: apply <plan.json> [--also-rewrite <file>]... [--no-archive]");
      const result = applyMigration(JSON.parse(readFileSync(planPath, "utf8")) as MigrationPlan, {
        alsoRewrite: values("--also-rewrite"),
        archive: !args.includes("--no-archive"),
      });
      process.stdout.write(`${JSON.stringify({ ...result, validation: undefined }, null, 2)}\n`);
      for (const row of result.validation) process.stdout.write(`${row.was === row.now ? "same " : "DIFF "} ${basename(row.after)}: ${row.now}\n`);
      if (result.regressions.length > 0) process.exitCode = 1;
    } else {
      throw new Error("Usage: migrate-artifacts.ts plan|apply ...");
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
