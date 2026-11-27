import {
  existsSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { artifactTypeFolder } from "./artifact-layout.js";
import {
  type ArtifactStoragePolicy,
  DEFAULT_ASSISTED_CONFIG_PATH,
  loadAssistedConfiguration,
} from "./assisted-config.js";
import { findProjectSetup, type ResolvedProjectSetup } from "./read-project-setup.js";

export {
  artifactStoragePolicySchema,
  type ArtifactStoragePolicy,
} from "./assisted-config.js";

export interface AllocateArtifactVersionInput {
  baseName: string;
  extensions: string[];
  applicationName?: string;
  // The piece of work (epic number plus short name, e.g. "epic-4-room-gating"); part of the file name.
  workLabel?: string;
  // Older name for the work label, still accepted.
  requestSlug?: string;
  // Program alias, needed only when the application is registered in more than one program.
  program?: string;
  registryPath?: string;
  explicitRoot?: string;
  projectRoot?: string;
  environment?: NodeJS.ProcessEnv;
}

export interface AllocatedArtifactVersion {
  directory: string;
  version: number;
  versionLabel: string;
  paths: Record<string, string>;
  policySource: string;
  // Set when the application is registered: documents go to its recorded location.
  registeredApplication?: { application: string; program: string };
}

function expandEnvironmentVariables(
  value: string,
  environment: NodeJS.ProcessEnv,
): string {
  return value.replace(/%([^%]+)%/g, (_match, variable: string) => {
    const expanded = environment[variable];
    if (!expanded) {
      throw new Error(
        `Artifact storage path references undefined environment variable '${variable}'.`,
      );
    }
    return expanded;
  });
}

export function slugifyArtifactName(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug) {
    throw new Error(`Cannot create an artifact slug from '${value}'.`);
  }
  return slug;
}

export function loadArtifactStoragePolicy(
  projectRoot = process.cwd(),
): { policy: ArtifactStoragePolicy; source: string } {
  const loaded = loadAssistedConfiguration(projectRoot);
  return {
    policy: loaded.configuration.artifactStorage,
    source: loaded.source,
  };
}

function renderFolderPattern(
  pattern: string,
  applicationSlug: string,
  requestSlug: string | undefined,
  typeFolder: string,
): string {
  if (pattern.includes("{request-slug}") && !requestSlug) {
    throw new Error("This team's artifact folderPattern uses {request-slug}; pass a work label.");
  }
  const rendered = pattern
    .replaceAll("{application-slug}", applicationSlug)
    .replaceAll("{request-slug}", requestSlug ?? "")
    .replaceAll("{type-folder}", typeFolder);
  if (
    rendered.includes("{") ||
    rendered.includes("}") ||
    rendered.includes(":") ||
    isAbsolute(rendered) ||
    rendered.split(/[\\/]+/).some((segment) => segment === "..")
  ) {
    throw new Error(
      "Artifact folderPattern must be relative and may use only {application-slug}, {type-folder} and {request-slug} placeholders.",
    );
  }
  return rendered;
}

// Where a registered application's documents live: its manifest folder, or a folder named for it under
// the program's root (a local folder, the OneDrive-synced copy of a SharePoint library, or the git clone).
export function registeredApplicationFolder(resolved: ResolvedProjectSetup): string {
  const { program, manifest, project } = resolved;
  const programRoot =
    program.localRoot ??
    (program.storageType === "git"
      ? join(homedir(), "ServiceNow-Assisted", "Programs", program.alias)
      : manifest.root ?? program.location);
  if (/^https?:/i.test(programRoot)) {
    throw new Error(
      `Program '${program.alias}' is recorded only as ${programRoot}. Record the OneDrive-synced folder of that library (localRoot) so documents can be written there.`,
    );
  }
  const folder = project.folder ?? slugifyArtifactName(project.application);
  return isAbsolute(folder) ? resolve(folder) : resolve(programRoot, folder);
}

function normalizeExtensions(extensions: string[]): string[] {
  const normalized = [
    ...new Set(
      extensions.map((extension) =>
        extension.trim().toLowerCase().replace(/^\./, ""),
      ),
    ),
  ];
  if (
    normalized.length === 0 ||
    normalized.some((extension) => !/^[a-z0-9]+$/.test(extension))
  ) {
    throw new Error("At least one valid artifact file extension is required.");
  }
  return normalized;
}

export function allocateArtifactVersion(
  input: AllocateArtifactVersionInput,
): AllocatedArtifactVersion {
  const projectRoot = resolve(input.projectRoot ?? process.cwd());
  const environment = input.environment ?? process.env;
  const { policy, source } = loadArtifactStoragePolicy(projectRoot);
  const applicationSlug = slugifyArtifactName(
    input.applicationName ?? "general",
  );
  const rawLabel = input.workLabel ?? input.requestSlug;
  const workLabel = rawLabel ? slugifyArtifactName(rawLabel) : undefined;
  const baseName = slugifyArtifactName(input.baseName);
  const extensions = normalizeExtensions(input.extensions);
  const typeFolder = artifactTypeFolder(baseName);

  // Precedence: an explicit path, then the application's registered location, then the team or
  // built-in default (which unregistered applications and eval sandboxes use).
  const registered =
    input.explicitRoot || !input.applicationName
      ? undefined
      : findProjectSetup(input.applicationName, {
          registryPath: input.registryPath,
          program: input.program,
        });
  const pattern = registered ? "{type-folder}" : policy.folderPattern;
  // A legacy pattern with {request-slug} keeps the label in the folder name instead of the file name.
  const labelInFolder = pattern.includes("{request-slug}");
  const stemBase = workLabel && !labelInFolder ? `${baseName}-${workLabel}` : baseName;
  const renderedFolder = renderFolderPattern(
    pattern,
    applicationSlug,
    workLabel,
    typeFolder,
  );
  const fallbackRoot = registered
    ? undefined
    : expandEnvironmentVariables(input.explicitRoot ?? policy.defaultRoot, environment);
  const directory = (() => {
    try {
      const root = registered
        ? registeredApplicationFolder(registered)
        : isAbsolute(fallbackRoot!)
          ? resolve(fallbackRoot!)
          : resolve(projectRoot, fallbackRoot!);
      const target = resolve(root, renderedFolder);
      const relativeTarget = relative(root, target);
      if (
        relativeTarget === "" ||
        relativeTarget.startsWith("..") ||
        isAbsolute(relativeTarget)
      ) {
        throw new Error("The rendered artifact directory escapes its root.");
      }
      mkdirSync(target, { recursive: true });
      return target;
    } catch (error) {
      if (error instanceof Error && error.message.includes("OneDrive-synced")) throw error;
      throw new Error(
        `Unable to create the configured artifact directory. Provide a writable output path or update '${DEFAULT_ASSISTED_CONFIG_PATH}'.`,
        { cause: error },
      );
    }
  })();
  const reservationDirectory = join(directory, ".reservations");
  mkdirSync(reservationDirectory, { recursive: true });

  for (let version = 1; version < 10 ** policy.versionDigits; version += 1) {
    const versionLabel = `v${version
      .toString()
      .padStart(policy.versionDigits, "0")}`;
    const paths = Object.fromEntries(
      extensions.map((extension) => [
        extension,
        join(directory, `${stemBase}-${versionLabel}.${extension}`),
      ]),
    );
    if (Object.values(paths).some((path) => existsSync(path))) {
      continue;
    }
    const reservationPath = join(
      reservationDirectory,
      `${stemBase}-${versionLabel}.reserve`,
    );
    try {
      writeFileSync(reservationPath, `${new Date().toISOString()}\n`, {
        flag: "wx",
      });
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "EEXIST"
      ) {
        continue;
      }
      throw new Error(
        `Unable to reserve artifact version '${versionLabel}' in '${directory}'.`,
        { cause: error },
      );
    }

    return {
      directory,
      version,
      versionLabel,
      paths,
      policySource: input.explicitRoot
        ? "explicit user path"
        : registered
          ? `registered application (program ${registered.program.alias})`
          : source,
      ...(registered
        ? {
            registeredApplication: {
              application: registered.project.application,
              program: registered.program.alias,
            },
          }
        : {}),
    };
  }

  throw new Error(
    `No artifact version is available in '${directory}' using ${policy.versionDigits} digits.`,
  );
}
