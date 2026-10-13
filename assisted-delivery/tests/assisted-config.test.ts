import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  assistedConfigurationSchema,
  loadAssistedConfiguration,
} from "../src/assisted-config.js";

function createProject(configuration?: unknown): string {
  const projectRoot = mkdtempSync(join(tmpdir(), "assisted-config-"));
  if (configuration !== undefined) {
    mkdirSync(join(projectRoot, ".github"));
    writeFileSync(
      join(projectRoot, ".github", "servicenow-assist.json"),
      JSON.stringify(configuration),
    );
  }
  return projectRoot;
}

test("loads assisted artifact configuration with a standalone default", () => {
  const missing = loadAssistedConfiguration(createProject());
  assert.match(
    missing.configuration.artifactStorage.defaultRoot,
    /ServiceNow-Assisted/,
  );
  assert.equal(missing.source, "built-in default");

  const configured = loadAssistedConfiguration(
    createProject({
      artifactStorage: {
        defaultRoot: "C:\\team-artifacts",
        versionDigits: 4,
      },
    }),
  );
  assert.equal(
    configured.configuration.artifactStorage.defaultRoot,
    "C:\\team-artifacts",
  );
  assert.equal(configured.configuration.artifactStorage.versionDigits, 4);
});

test("configuration rejects unsupported product profile fields", () => {
  assert.throws(
    () =>
      assistedConfigurationSchema.parse({
        workflowProfile: "governed",
      }),
    /Unrecognized key/,
  );
});

test("configuration rejects unknown artifact storage settings", () => {
  assert.throws(
    () =>
      assistedConfigurationSchema.parse({
        artifactStorage: { defaultRott: "C:\\wrong-location" },
      }),
    /Unrecognized key/,
  );
});
