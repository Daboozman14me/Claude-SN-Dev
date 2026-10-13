import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";

export const DEFAULT_ASSISTED_CONFIG_PATH = join(
  ".github",
  "servicenow-assist.json",
);

export const artifactStoragePolicySchema = z.object({
  defaultRoot: z
    .string()
    .min(1)
    .default(join("%USERPROFILE%", "ServiceNow-Assisted", "Artifacts")),
  folderPattern: z
    .string()
    .min(1)
    .default(join("{application-slug}", "{request-slug}")),
  versionDigits: z.number().int().min(1).max(6).default(3),
}).strict();

export const assistedConfigurationSchema = z.object({
  artifactStorage: artifactStoragePolicySchema.default(
    artifactStoragePolicySchema.parse({}),
  ),
}).strict();

export type ArtifactStoragePolicy = z.infer<
  typeof artifactStoragePolicySchema
>;
export type AssistedConfiguration = z.infer<
  typeof assistedConfigurationSchema
>;

export interface LoadedAssistedConfiguration {
  configuration: AssistedConfiguration;
  source: string;
}

export function loadAssistedConfiguration(
  projectRoot = process.cwd(),
): LoadedAssistedConfiguration {
  const configurationPath = resolve(projectRoot, DEFAULT_ASSISTED_CONFIG_PATH);
  if (!existsSync(configurationPath)) {
    return {
      configuration: assistedConfigurationSchema.parse({}),
      source: "built-in default",
    };
  }

  return {
    configuration: assistedConfigurationSchema.parse(
      JSON.parse(readFileSync(configurationPath, "utf8")) as unknown,
    ),
    source: configurationPath,
  };
}
