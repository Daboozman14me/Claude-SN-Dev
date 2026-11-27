import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { ARTIFACT_TYPE_FOLDERS, parseArtifactFileName } from "./artifact-layout.js";
import { registeredApplicationFolder } from "./artifact-storage.js";
import { programManifestSchema, programRegistrySchema } from "./assisted-contracts.js";
import { isDirectExecution } from "./direct-execution.js";
import { DEFAULT_REGISTRY_PATH, findProjectSetup, manifestCandidates } from "./read-project-setup.js";

// What the supervisor reads to greet the user and to "pick up" a project: the registered projects, and
// for one application the newest document of each type plus the next step in the delivery order.

// Delivery order: requirements -> research -> solution -> design -> stories -> tests -> code -> review.
export const DELIVERY_ORDER = ["requirements", "research", "solution", "design", "stories", "tests", "code", "reviews"] as const;

export interface LatestDocument {
  file: string;
  label: string | undefined;
  version: string;
  modified: string;
}

export interface ProjectStatus {
  application: string;
  program: string;
  client: string;
  folder: string;
  types: Array<{ type: string; documents: number; latest: LatestDocument }>;
  // The piece of work touched most recently, across every type.
  latestWork: { label: string | undefined; type: string; modified: string } | undefined;
  suggestedNext: string;
}

const BASE_FOR_FOLDER = new Map<string, string[]>();
for (const [base, folder] of Object.entries(ARTIFACT_TYPE_FOLDERS)) {
  BASE_FOR_FOLDER.set(folder, [...(BASE_FOR_FOLDER.get(folder) ?? []), base]);
}

// The newest main document (by modified time) in one type folder; HTML/Markdown/JSON reports only.
function latestIn(folder: string, type: string): { documents: number; latest: LatestDocument } | undefined {
  if (!existsSync(folder)) return undefined;
  const bases = BASE_FOR_FOLDER.get(type) ?? [type];
  const documents = readdirSync(folder).flatMap((file) => {
    for (const base of bases) {
      for (const extension of ["json", "md", "html"]) {
        const parsed = parseArtifactFileName(file, base, extension);
        if (parsed) return [{ file, stem: parsed.stem, label: parsed.label, version: parsed.versionLabel, modified: statSync(join(folder, file)).mtime }];
      }
    }
    return [];
  });
  if (documents.length === 0) return undefined;
  const stems = new Set(documents.map((document) => document.stem));
  const newest = documents.sort((a, b) => b.modified.getTime() - a.modified.getTime())[0]!;
  return {
    documents: stems.size,
    latest: { file: newest.file, label: newest.label, version: newest.version, modified: newest.modified.toISOString() },
  };
}

export function suggestNext(present: Set<string>): string {
  const furthest = [...DELIVERY_ORDER].reverse().find((type) => present.has(type));
  if (!furthest) return "No documents yet: start with requirements (extract them from the customer's documents) or research the current application.";
  if (furthest === "reviews" || furthest === "code") {
    return "Code and review exist: decide the review findings, then deploy (owner), sync the backlog, and write or update the user guide.";
  }
  const next = DELIVERY_ORDER[DELIVERY_ORDER.indexOf(furthest) + 1]!;
  return `Latest stage is ${furthest}: next is ${next}.`;
}

export function projectStatus(application: string, options: { registryPath?: string; program?: string } = {}): ProjectStatus {
  const resolved = findProjectSetup(application, options);
  if (!resolved) throw new Error(`'${application}' is not registered. Offer to register it (scaffolding setup).`);
  const folder = registeredApplicationFolder(resolved);
  const types = [...new Set(Object.values(ARTIFACT_TYPE_FOLDERS))].flatMap((type) => {
    const found = latestIn(join(folder, type), type);
    return found ? [{ type, ...found }] : [];
  });
  const newest = [...types].sort((a, b) => b.latest.modified.localeCompare(a.latest.modified))[0];
  return {
    application: resolved.project.application,
    program: resolved.program.program,
    client: resolved.program.client,
    folder,
    types,
    latestWork: newest ? { label: newest.latest.label, type: newest.type, modified: newest.latest.modified } : undefined,
    suggestedNext: suggestNext(new Set(types.map((entry) => entry.type))),
  };
}

export interface RegisteredProject {
  client: string;
  program: string;
  application: string;
}

// Every registered application, grouped by nothing: the supervisor shows them as a short list.
export function listRegisteredProjects(registryPath = DEFAULT_REGISTRY_PATH): RegisteredProject[] {
  if (!existsSync(registryPath)) return [];
  const registry = programRegistrySchema.parse(JSON.parse(readFileSync(registryPath, "utf8")));
  return registry.programs.flatMap((program) => {
    const manifestPath = manifestCandidates(program).find((candidate) => existsSync(candidate));
    if (!manifestPath) return [];
    const manifest = programManifestSchema.parse(JSON.parse(readFileSync(manifestPath, "utf8")));
    return manifest.projects.map((project) => ({ client: program.client, program: program.program, application: project.application }));
  });
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
  const application = args.filter((arg, index) => !flagged.has(index) && arg !== "--list").join(" ").trim();
  const registryPath = option("--registry");
  try {
    const result = args.includes("--list") || !application
      ? listRegisteredProjects(registryPath ?? DEFAULT_REGISTRY_PATH)
      : projectStatus(application, { ...(registryPath ? { registryPath } : {}), ...(option("--program") ? { program: option("--program")! } : {}) });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
