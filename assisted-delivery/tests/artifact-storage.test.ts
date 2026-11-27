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
import { artifactTypeFolder, parseArtifactFileName } from "../src/artifact-layout.js";

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

// A registry with one program holding the given manifest, all inside a temp folder.
function createRegistry(program: Record<string, unknown>, manifest: Record<string, unknown>): { registryPath: string; root: string } {
  const root = mkdtempSync(join(tmpdir(), "assisted-registry-"));
  const programRoot = join(root, "program");
  mkdirSync(programRoot);
  writeFileSync(join(programRoot, "manifest.json"), JSON.stringify({ root: programRoot, ...manifest }));
  const registryPath = join(root, "registry.json");
  writeFileSync(registryPath, JSON.stringify({ programs: [{ localRoot: programRoot, ...program }] }));
  return { registryPath, root: programRoot };
}

test("unregistered work goes to the type folder with the work label in the file name", () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "artifact-project-"));
  const userProfile = mkdtempSync(join(tmpdir(), "artifact-profile-"));
  const allocation = allocateArtifactVersion({
    projectRoot,
    environment: { USERPROFILE: userProfile },
    registryPath: join(userProfile, "no-registry.json"),
    applicationName: "Example Application",
    workLabel: "Epic 4 Room Gating",
    baseName: "story-draft",
    extensions: ["html", "json"],
  });
  assert.equal(allocation.directory, resolve(userProfile, "ServiceNow-Assisted", "Artifacts", "example-application", "stories"));
  assert.match(allocation.paths.json ?? "", /[\\/]story-draft-epic-4-room-gating-v001\.json$/);
  assert.equal(allocation.registeredApplication, undefined);
  const unlabeled = allocateArtifactVersion({
    projectRoot,
    environment: { USERPROFILE: userProfile },
    registryPath: join(userProfile, "no-registry.json"),
    applicationName: "Example Application",
    baseName: "backlog",
    extensions: ["json"],
  });
  assert.match(unlabeled.paths.json ?? "", /[\\/]backlog[\\/]backlog-v001\.json$/);
});

test("a registered application's documents go to its recorded location, by type", () => {
  const { registryPath, root } = createRegistry(
    { alias: "demo", client: "Internal", program: "Demo", storageType: "local", location: "unused" },
    { program: "Demo", client: "Internal", storageType: "local", projects: [{ application: "New Conf Room Booking", repo: "https://example.invalid/repo" }] },
  );
  const first = allocateArtifactVersion({ registryPath, applicationName: "new-conf-room-booking", workLabel: "epic-4-room-gating", baseName: "code-review", extensions: ["html", "json"] });
  assert.equal(first.directory, resolve(root, "new-conf-room-booking", "reviews"));
  assert.match(first.paths.json ?? "", /code-review-epic-4-room-gating-v001\.json$/);
  assert.deepEqual(first.registeredApplication, { application: "New Conf Room Booking", program: "demo" });
  assert.match(first.policySource, /registered application/);
  const other = allocateArtifactVersion({ registryPath, applicationName: "New Conf Room Booking", workLabel: "email-body-fix", baseName: "code-review", extensions: ["json"] });
  assert.equal(other.versionLabel, "v001", "each piece of work counts its own versions");
  const explicit = allocateArtifactVersion({ registryPath, applicationName: "New Conf Room Booking", explicitRoot: join(root, "elsewhere"), workLabel: "x", baseName: "code-review", extensions: ["json"] });
  assert.ok(explicit.directory.startsWith(join(root, "elsewhere")), "an explicit path still wins");
});

test("a manifest folder overrides the app folder name, and a SharePoint URL alone is refused", () => {
  const { registryPath, root } = createRegistry(
    { alias: "acme", client: "Acme", program: "Acme", storageType: "local", location: "unused" },
    { program: "Acme", client: "Acme", storageType: "local", projects: [{ application: "Facilities", folder: "apps/facilities" }] },
  );
  const allocation = allocateArtifactVersion({ registryPath, applicationName: "Facilities", baseName: "application-research", extensions: ["md"] });
  assert.equal(allocation.directory, resolve(root, "apps", "facilities", "research"));

  // A SharePoint program whose manifest records only the site URL, with no synced local folder.
  const sharepoint = mkdtempSync(join(tmpdir(), "assisted-registry-"));
  writeFileSync(join(sharepoint, "manifest.json"), JSON.stringify({ program: "SP", client: "SP", storageType: "sharepoint", root: "https://contoso.sharepoint.com/sites/x", projects: [{ application: "Facilities", folder: "facilities" }] }));
  const spRegistry = join(sharepoint, "registry.json");
  writeFileSync(spRegistry, JSON.stringify({ programs: [{ alias: "sp", client: "SP", program: "SP", storageType: "sharepoint", location: sharepoint }] }));
  assert.throws(
    () => allocateArtifactVersion({ registryPath: spRegistry, applicationName: "Facilities", baseName: "story-draft", extensions: ["json"] }),
    /OneDrive-synced folder/,
  );
});

test("an application registered in two programs must name its program", () => {
  const root = mkdtempSync(join(tmpdir(), "assisted-registry-"));
  const programs = ["one", "two"].map((alias) => {
    const programRoot = join(root, alias);
    mkdirSync(programRoot);
    writeFileSync(join(programRoot, "manifest.json"), JSON.stringify({ program: alias, client: "C", storageType: "local", root: programRoot, projects: [{ application: "Shared App", folder: "shared" }] }));
    return { alias, client: "C", program: alias, storageType: "local", location: programRoot, localRoot: programRoot };
  });
  const registryPath = join(root, "registry.json");
  writeFileSync(registryPath, JSON.stringify({ programs }));
  assert.throws(() => allocateArtifactVersion({ registryPath, applicationName: "Shared App", baseName: "test-plan", extensions: ["md"] }), /more than one program/);
  const chosen = allocateArtifactVersion({ registryPath, program: "two", applicationName: "Shared App", baseName: "test-plan", extensions: ["md"] });
  assert.equal(chosen.directory, resolve(root, "two", "shared", "tests"));
});

test("document names parse with or without a work label", () => {
  assert.deepEqual(parseArtifactFileName("story-draft-epic-4-room-gating-v001.json", "story-draft", "json"), { stem: "story-draft-epic-4-room-gating-v001", label: "epic-4-room-gating", versionLabel: "v001" });
  assert.deepEqual(parseArtifactFileName("story-draft-v002.json", "story-draft", "json"), { stem: "story-draft-v002", label: undefined, versionLabel: "v002" });
  assert.equal(parseArtifactFileName("story-draft-v002.html", "story-draft", "json"), undefined);
  assert.equal(parseArtifactFileName("code-review-v001.json", "story-draft", "json"), undefined);
  assert.equal(parseArtifactFileName("story-draft-Epic 4-v001.json", "story-draft", "json"), undefined);
  assert.equal(artifactTypeFolder("code-implementation"), "code");
  assert.equal(artifactTypeFolder("completion-report"), "code");
  assert.equal(artifactTypeFolder("custom-thing"), "custom-thing");
});
