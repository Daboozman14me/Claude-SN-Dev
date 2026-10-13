import assert from "node:assert/strict";
import test from "node:test";
import {
  programManifestProjectSchema,
  programManifestSchema,
  programRegistrySchema,
} from "../src/assisted-contracts.js";
import { validateAssistedScaffoldingJson } from "../src/validate-assisted-scaffolding.js";

test("registry accepts a well-formed multi-program entry list", () => {
  const registry = validateAssistedScaffoldingJson(
    "registry",
    JSON.stringify({
      programs: [
        {
          alias: "postal",
          client: "USPS",
          program: "POSTALPROGRAM",
          storageType: "git",
          location: "https://github.com/USPS/POSTALPROGRAM",
        },
        {
          alias: "army",
          client: "Army",
          program: "Army",
          storageType: "sharepoint",
          location: "E:\\SHAREPT1",
        },
      ],
    }),
  );
  assert.equal(registry.programs.length, 2);
});

test("registry rejects a duplicate alias", () => {
  assert.throws(() =>
    programRegistrySchema.parse({
      programs: [
        {
          alias: "postal",
          client: "USPS",
          program: "P1",
          storageType: "git",
          location: "https://github.com/USPS/P1",
        },
        {
          alias: "postal",
          client: "USPS",
          program: "P2",
          storageType: "git",
          location: "https://github.com/USPS/P2",
        },
      ],
    }),
  );
});

test("git manifest requires org", () => {
  assert.throws(() =>
    programManifestSchema.parse({
      program: "POSTALPROGRAM",
      client: "USPS",
      storageType: "git",
      projects: [],
    }),
  );
});

test("sharepoint/local manifest requires root", () => {
  assert.throws(() =>
    programManifestSchema.parse({
      program: "Army",
      client: "Army",
      storageType: "sharepoint",
      projects: [],
    }),
  );
});

test("manifest accepts a project entry and rejects a duplicate application", () => {
  const manifest = programManifestSchema.parse({
    program: "POSTALPROGRAM",
    client: "USPS",
    storageType: "git",
    org: "USPS",
    projects: [
      { application: "Project1", repo: "https://github.com/USPS/Project1" },
    ],
  });
  assert.equal(manifest.projects.length, 1);

  assert.throws(() =>
    programManifestSchema.parse({
      program: "POSTALPROGRAM",
      client: "USPS",
      storageType: "git",
      org: "USPS",
      projects: [
        { application: "Project1", repo: "https://github.com/USPS/Project1" },
        {
          application: "Project1",
          repo: "https://github.com/USPS/Project1-dup",
        },
      ],
    }),
  );
});

test("project entry needs either repo or folder", () => {
  assert.throws(() =>
    programManifestSchema.parse({
      program: "Army",
      client: "Army",
      storageType: "sharepoint",
      root: "E:\\SHAREPT1",
      projects: [{ application: "Project1" }],
    }),
  );
});

test("project entry may record a ServiceNow instance alias, never a credential", () => {
  const manifest = programManifestSchema.parse({
    program: "POSTALPROGRAM",
    client: "USPS",
    storageType: "git",
    org: "USPS",
    projects: [
      {
        application: "Project1",
        repo: "https://github.com/USPS/Project1",
        serviceNowInstance: { alias: "postal-prod", url: "https://postal.service-now.com" },
      },
    ],
  });
  assert.equal(
    manifest.projects[0]!.serviceNowInstance!.alias,
    "postal-prod",
  );

  assert.throws(() =>
    programManifestProjectSchema.parse({
      application: "Project1",
      repo: "https://github.com/USPS/Project1",
      serviceNowInstance: {
        alias: "postal-prod",
        password: "should-never-be-a-field",
      },
    }),
  );
});
