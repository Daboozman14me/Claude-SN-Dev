import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
  programManifestSchema,
  programRegistrySchema,
  type ProgramManifest,
  type ProgramManifestProject,
  type ProgramRegistryEntry,
} from "./assisted-contracts.js";
import { isDirectExecution } from "./direct-execution.js";

export const DEFAULT_REGISTRY_PATH = join(homedir(), ".claude", "assisted-delivery-programs.json");

// Where scaffolding keeps a program's manifest: beside its local root, or in the default clone.
export function manifestCandidates(entry: ProgramRegistryEntry): string[] {
  const roots = [entry.localRoot, entry.storageType === "git" ? undefined : entry.location]
    .filter((root): root is string => Boolean(root));
  const candidates = roots.flatMap((root) => [join(root, "manifest.json"), join(root, "_program", "manifest.json")]);
  candidates.push(join(homedir(), "ServiceNow-Assisted", "Programs", entry.alias, "_program", "manifest.json"));
  return [...new Set(candidates.map((candidate) => resolve(candidate)))];
}

export interface ResolvedProjectSetup {
  program: ProgramRegistryEntry;
  manifestPath: string;
  manifest: ProgramManifest;
  project: ProgramManifestProject;
}

export function resolveProjectSetup(
  application: string,
  options: { registryPath?: string | undefined; program?: string | undefined } = {},
): ResolvedProjectSetup {
  const registryPath = resolve(options.registryPath ?? DEFAULT_REGISTRY_PATH);
  if (!existsSync(registryPath)) throw new Error(`No program registry at '${registryPath}'; register the program with scaffolding first.`);
  const found = findProjectSetup(application, options);
  if (!found) throw new Error(`Application '${application}' is not registered in any program manifest.`);
  return found;
}

const comparable = (name: string): string => name.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

// The registered project for an application (matched by name or its slug), or undefined when there is no
// registry or the application is not in it. More than one match is an error: the caller must name the program.
export function findProjectSetup(
  application: string,
  options: { registryPath?: string | undefined; program?: string | undefined } = {},
): ResolvedProjectSetup | undefined {
  const registryPath = resolve(options.registryPath ?? DEFAULT_REGISTRY_PATH);
  if (!existsSync(registryPath)) return undefined;
  const registry = programRegistrySchema.parse(JSON.parse(readFileSync(registryPath, "utf8")));
  const wanted = comparable(application);
  const matches: ResolvedProjectSetup[] = [];
  for (const program of registry.programs) {
    if (options.program && program.alias !== options.program) continue;
    const manifestPath = manifestCandidates(program).find((candidate) => existsSync(candidate));
    if (!manifestPath) continue;
    const manifest = programManifestSchema.parse(JSON.parse(readFileSync(manifestPath, "utf8")));
    const project = manifest.projects.find((entry) => comparable(entry.application) === wanted);
    if (project) matches.push({ program, manifestPath, manifest, project });
  }
  if (matches.length > 1) {
    throw new Error(`Application '${application}' is in more than one program (${matches.map((match) => match.program.alias).join(", ")}); pass --program.`);
  }
  return matches[0];
}

if (isDirectExecution(import.meta.url, process.argv[1])) {
  const args = process.argv.slice(2);
  const option = (name: string): string | undefined => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const flagged = new Set(["--registry", "--program"].flatMap((name) => {
    const index = args.indexOf(name);
    return index >= 0 ? [index, index + 1] : [];
  }));
  const application = args.filter((_, index) => !flagged.has(index)).join(" ").trim();
  try {
    if (!application) throw new Error('Usage: npm run setup:show -- "<application>" [--program <alias>] [--registry <path>]');
    const resolved = resolveProjectSetup(application, { registryPath: option("--registry"), program: option("--program") });
    process.stdout.write(`${JSON.stringify({
      application: resolved.project.application,
      program: resolved.program.alias,
      manifest: resolved.manifestPath,
      repo: resolved.project.repo,
      folder: resolved.project.folder,
      serviceNowInstance: resolved.project.serviceNowInstance,
      setup: resolved.project.setup ?? "not recorded",
    }, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
