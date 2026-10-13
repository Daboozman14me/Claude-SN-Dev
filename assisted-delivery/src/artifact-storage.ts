import {
  existsSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import {
  type ArtifactStoragePolicy,
  DEFAULT_ASSISTED_CONFIG_PATH,
  loadAssistedConfiguration,
} from "./assisted-config.js";

export {
  artifactStoragePolicySchema,
  type ArtifactStoragePolicy,
} from "./assisted-config.js";

export interface AllocateArtifactVersionInput {
  baseName: string;
  extensions: string[];
  applicationName?: string;
  requestSlug: string;
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
  requestSlug: string,
): string {
  const rendered = pattern
    .replaceAll("{application-slug}", applicationSlug)
    .replaceAll("{request-slug}", requestSlug);
  if (
    rendered.includes("{") ||
    rendered.includes("}") ||
    rendered.includes(":") ||
    isAbsolute(rendered) ||
    rendered.split(/[\\/]+/).some((segment) => segment === "..")
  ) {
    throw new Error(
      "Artifact folderPattern must be relative and may use only {application-slug} and {request-slug} placeholders.",
    );
  }
  return rendered;
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
  const configuredRoot = input.explicitRoot ?? policy.defaultRoot;
  const expandedRoot = expandEnvironmentVariables(configuredRoot, environment);
  const applicationSlug = slugifyArtifactName(
    input.applicationName ?? "general",
  );
  const requestSlug = slugifyArtifactName(input.requestSlug);
  const baseName = slugifyArtifactName(input.baseName);
  const extensions = normalizeExtensions(input.extensions);
  const renderedFolder = renderFolderPattern(
    policy.folderPattern,
    applicationSlug,
    requestSlug,
  );
  const directory = (() => {
    try {
      const root = isAbsolute(expandedRoot)
        ? resolve(expandedRoot)
        : resolve(projectRoot, expandedRoot);
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
        join(directory, `${baseName}-${versionLabel}.${extension}`),
      ]),
    );
    if (Object.values(paths).some((path) => existsSync(path))) {
      continue;
    }
    const reservationPath = join(
      reservationDirectory,
      `${baseName}-${versionLabel}.reserve`,
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
      policySource: input.explicitRoot ? "explicit user path" : source,
    };
  }

  throw new Error(
    `No artifact version is available in '${directory}' using ${policy.versionDigits} digits.`,
  );
}
