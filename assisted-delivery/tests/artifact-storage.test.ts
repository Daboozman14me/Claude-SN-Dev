import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  allocateArtifactVersion,
  slugifyArtifactName,
} from "../src/artifact-storage.js";

function createProject(): string {
  const project = mkdtempSync(join(tmpdir(), "assisted-artifacts-"));
  const configDirectory = join(project, ".github");
  const root = join(project, "team-artifacts");
  mkdirSync(configDirectory);
  writeFileSync(
    join(configDirectory, "servicenow-assist.json"),
    JSON.stringify({
      artifactStorage: {
        defaultRoot: root,
        folderPattern: "{application-slug}\\{request-slug}",
        versionDigits: 3,
      },
    }),
  );
  return project;
}

test("allocates synchronized versioned artifact paths without overwriting", () => {
  const project = createProject();
  const first = allocateArtifactVersion({
    projectRoot: project,
    applicationName: "Example Application",
    requestSlug: "Supervisor Approval",
    baseName: "architecture",
    extensions: ["html", "json"],
  });
  writeFileSync(first.paths.html ?? "", "first HTML");
  writeFileSync(first.paths.json ?? "", "first JSON");
  const second = allocateArtifactVersion({
    projectRoot: project,
    applicationName: "Example Application",
    requestSlug: "Supervisor Approval",
    baseName: "architecture",
    extensions: ["html", "json"],
  });

  assert.equal(first.versionLabel, "v001");
  assert.equal(second.versionLabel, "v002");
  assert.match(first.directory, /example-application[\\/]supervisor-approval$/);
  assert.ok(existsSync(first.paths.html ?? ""));
  assert.ok(existsSync(first.paths.json ?? ""));
  assert.equal(readFileSync(first.paths.html ?? "", "utf8"), "first HTML");
});

test("atomically reserves versions before artifact files are written", () => {
  const project = createProject();
  const input = {
    projectRoot: project,
    applicationName: "Example Application",
    requestSlug: "Concurrent Request",
    baseName: "research",
    extensions: ["html", "json"],
  };

  const first = allocateArtifactVersion(input);
  const second = allocateArtifactVersion(input);

  assert.equal(first.versionLabel, "v001");
  assert.equal(second.versionLabel, "v002");
  assert.ok(existsSync(join(first.directory, ".reservations")));
});
test("an explicit root overrides the team default", () => {
  const project = createProject();
  const explicitRoot = join(project, "explicit");
  const allocation = allocateArtifactVersion({
    projectRoot: project,
    explicitRoot,
    requestSlug: "Request",
    baseName: "research",
    extensions: [".html"],
  });

  assert.ok(allocation.directory.startsWith(explicitRoot));
  assert.equal(allocation.policySource, "explicit user path");
});

test("uses and creates the built-in user-profile fallback", () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "artifact-project-"));
  const userProfile = mkdtempSync(join(tmpdir(), "artifact-profile-"));

  const allocation = allocateArtifactVersion({
    projectRoot,
    environment: { USERPROFILE: userProfile },
    applicationName: "Example Application",
    requestSlug: "general-report",
    baseName: "research",
    extensions: ["html"],
  });

  assert.ok(
    allocation.directory.startsWith(
      resolve(userProfile, "ServiceNow-Assisted", "Artifacts"),
    ),
  );
  assert.ok(existsSync(allocation.directory));
  assert.equal(allocation.policySource, "built-in default");
});

test("reports undefined environment variables in configured roots", () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "artifact-project-"));
  const configDirectory = join(projectRoot, ".github");
  mkdirSync(configDirectory);
  writeFileSync(
    join(configDirectory, "servicenow-assist.json"),
    JSON.stringify({
      artifactStorage: {
        defaultRoot: "%MISSING_ARTIFACT_ROOT%\\Artifacts",
      },
    }),
  );

  assert.throws(
    () =>
      allocateArtifactVersion({
        projectRoot,
        environment: {},
        requestSlug: "example-request",
        baseName: "research",
        extensions: ["json"],
      }),
    /undefined environment variable 'MISSING_ARTIFACT_ROOT'/,
  );
});

test("rejects folder patterns that can escape the configured root", () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "artifact-project-"));
  const configDirectory = join(projectRoot, ".github");
  mkdirSync(configDirectory);
  writeFileSync(
    join(configDirectory, "servicenow-assist.json"),
    JSON.stringify({
      artifactStorage: {
        defaultRoot: ".artifacts",
        folderPattern: "..\\{request-slug}",
      },
    }),
  );

  assert.throws(
    () =>
      allocateArtifactVersion({
        projectRoot,
        requestSlug: "example-request",
        baseName: "research",
        extensions: ["json"],
      }),
    /folderPattern must be relative/,
  );
});

test("rejects Windows drive-relative folder patterns", () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "artifact-project-"));
  const configDirectory = join(projectRoot, ".github");
  mkdirSync(configDirectory);
  writeFileSync(
    join(configDirectory, "servicenow-assist.json"),
    JSON.stringify({
      artifactStorage: {
        defaultRoot: ".artifacts",
        folderPattern: "X:{request-slug}",
      },
    }),
  );

  assert.throws(
    () =>
      allocateArtifactVersion({
        projectRoot,
        requestSlug: "escape",
        baseName: "research",
        extensions: ["json"],
      }),
    /folderPattern must be relative/,
  );
});

test("gives actionable guidance for an invalid destination", () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "artifact-project-"));

  assert.throws(
    () =>
      allocateArtifactVersion({
        projectRoot,
        explicitRoot: `${projectRoot}\0invalid`,
        requestSlug: "example-request",
        baseName: "research",
        extensions: ["json"],
      }),
    /Provide a writable output path or update/,
  );
});

test("creates safe filesystem slugs", () => {
  assert.equal(slugifyArtifactName(" Client / Application "), "client-application");
  assert.throws(() => slugifyArtifactName("***"), /Cannot create/);
});
