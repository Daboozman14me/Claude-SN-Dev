import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { programManifestSchema, projectSetupSchema } from "../src/assisted-contracts.js";
import { resolveProjectSetup } from "../src/read-project-setup.js";

const at = "2026-11-16T10:00:00Z";

export function fullSetup(): Record<string, any> {
  return {
    project: { status: "answered", decidedAt: at, appForm: "fluent", change: "new_app", scope: "x_888213_ncrb", companyCode: "888213", localPath: "C:\\apps\\ncrb" },
    instances: { status: "answered", decidedAt: at, list: [{ alias: "dev292961", url: "https://dev292961.service-now.com", purpose: "dev" }] },
    instanceAccess: { status: "answered", decidedAt: at, sdkAlias: "dev292961", basicAuthForHumans: "blocked" },
    deploy: {
      status: "answered",
      decidedAt: at,
      method: "github_actions",
      repo: "https://github.com/example/ncrb",
      environments: [{ instanceAlias: "dev292961", githubEnvironment: "dev292961", authType: "oauth", secretsInPlace: true }],
      deployUser: { userName: "ncrb_deploy", identityType: "human" },
    },
    agile: { status: "answered", decidedAt: at, use: true, framework: "classic", menuActive: "no", team: { name: "NCRB Team", members: ["admin"] }, product: { name: "New Conf Room Booking" }, numberingStart: 90001, importMethod: "xml_import" },
    quality: { status: "answered", decidedAt: at, atf: "deferred", runtimeAccessTracking: "permissive", findingsDecidedBy: "Product Owner" },
    decisions: { status: "answered", decidedAt: at, logPath: "C:\\artifacts\\owner-decisions.md" },
  };
}

function issues(setup: unknown): string {
  const result = projectSetupSchema.safeParse(setup);
  return result.success ? "" : JSON.stringify(result.error.issues);
}

test("a complete project setup validates, and sections may be skipped or left out", () => {
  assert.equal(issues(fullSetup()), "");
  assert.equal(issues({}), "", "an interview in progress records sections one at a time");
  assert.equal(issues({ agile: { status: "skipped", decidedAt: at, note: "No Agile for this small change." } }), "");
});

test("decided sections need their key answers", () => {
  const setup = fullSetup();
  delete setup.project.appForm;
  delete setup.agile.framework;
  setup.quality.status = "default";
  delete setup.quality.atf;
  const found = issues(setup);
  assert.match(found, /project section needs 'appForm'/);
  assert.match(found, /Using Agile needs a framework/);
  assert.match(found, /default quality section needs 'atf'/);
});

test("setup records names only, never credentials", () => {
  const withSecret = fullSetup();
  withSecret.deploy.environments[0].password = "hunter2";
  assert.match(issues(withSecret), /unrecognized_keys|Unrecognized key/i);
  const withToken = fullSetup();
  withToken.instanceAccess.token = "abc";
  assert.match(issues(withToken), /unrecognized_keys|Unrecognized key/i);
});

test("setup cross-checks scope, deploy and instances", () => {
  const scope = fullSetup();
  scope.project.scope = "x_2054821_ncrb";
  assert.match(issues(scope), /must start with x_888213_/);
  const oauth = fullSetup();
  oauth.deploy.deployUser.identityType = "machine";
  assert.match(issues(oauth), /Human deploy user/);
  const noEnvironment = fullSetup();
  noEnvironment.deploy.environments = [];
  assert.match(issues(noEnvironment), /one environment per target instance/);
  const unknownInstance = fullSetup();
  unknownInstance.deploy.environments[0].instanceAlias = "dev000000";
  assert.match(issues(unknownInstance), /not in the instances list/);
});

test("setup:show resolves an application through the registry and its program manifest", () => {
  const directory = mkdtempSync(join(tmpdir(), "setup-"));
  const programRoot = join(directory, "AI Build Demo");
  mkdirSync(programRoot, { recursive: true });
  const manifest = {
    program: "AI Build Demo",
    client: "Internal",
    storageType: "local",
    root: programRoot,
    projects: [{ application: "New Conf Room Booking", folder: "C:\\apps\\ncrb", setup: fullSetup() }],
  };
  assert.doesNotThrow(() => programManifestSchema.parse(manifest));
  writeFileSync(join(programRoot, "manifest.json"), JSON.stringify(manifest));
  const registryPath = join(directory, "programs.json");
  writeFileSync(
    registryPath,
    JSON.stringify({ programs: [{ alias: "ai-build-demo", client: "Internal", program: "AI Build Demo", storageType: "local", location: programRoot }] }),
  );
  const resolved = resolveProjectSetup("new conf room booking", { registryPath });
  assert.equal(resolved.program.alias, "ai-build-demo");
  assert.equal(resolved.project.setup?.agile?.team?.name, "NCRB Team");
  assert.throws(() => resolveProjectSetup("Unknown App", { registryPath }), /not registered in any program manifest/);
});
