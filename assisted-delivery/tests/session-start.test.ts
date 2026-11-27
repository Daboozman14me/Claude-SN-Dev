import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { planShortcut, shortcutScript, SUPERVISOR_COMMAND } from "../src/create-shortcut.js";
import { listRegisteredProjects, projectStatus, suggestNext } from "../src/project-status.js";
import { stageFixtures } from "../src/run-evals.js";
// @ts-expect-error plain JavaScript hook, no type declarations
import { decide } from "../hooks/guard.mjs";

function registeredProject() {
  const root = mkdtempSync(join(tmpdir(), "status-"));
  const program = join(root, "acme");
  const app = join(program, "facilities");
  mkdirSync(program, { recursive: true });
  writeFileSync(join(program, "manifest.json"), JSON.stringify({ program: "Facilities", client: "Acme", storageType: "local", root: program, projects: [{ application: "Facilities Request", folder: "facilities" }] }));
  const registryPath = join(root, "registry.json");
  writeFileSync(registryPath, JSON.stringify({ programs: [{ alias: "acme", client: "Acme", program: "Facilities", storageType: "local", location: program, localRoot: program }] }));
  const write = (type: string, file: string, daysAgo: number): void => {
    mkdirSync(join(app, type), { recursive: true });
    const path = join(app, type, file);
    writeFileSync(path, "{}");
    const when = new Date(Date.now() - daysAgo * 24 * 3600 * 1000);
    utimesSync(path, when, when);
  };
  write("requirements", "requirements-extraction-v001.json", 9);
  write("design", "technical-design-epic-2-intake-routing-v001.json", 6);
  write("design", "technical-design-epic-2-intake-routing-v002.json", 5);
  write("stories", "story-draft-epic-2-intake-routing-v001.json", 2);
  write("stories", "story-draft-epic-2-intake-routing-v001.html", 2);
  write("stories", "notes.txt", 0);
  return { registryPath, app };
}

test("project status reports the newest document per type, the latest work and the next step", () => {
  const { registryPath, app } = registeredProject();
  const status = projectStatus("facilities request", { registryPath });
  assert.equal(status.client, "Acme");
  assert.equal(status.folder, app);
  assert.deepEqual(status.types.map((entry) => entry.type).sort(), ["design", "requirements", "stories"]);
  const design = status.types.find((entry) => entry.type === "design")!;
  assert.equal(design.documents, 2);
  assert.equal(design.latest.file, "technical-design-epic-2-intake-routing-v002.json");
  assert.equal(status.types.find((entry) => entry.type === "stories")!.documents, 1, "HTML and JSON of one version count once");
  assert.deepEqual({ label: status.latestWork?.label, type: status.latestWork?.type }, { label: "epic-2-intake-routing", type: "stories" });
  assert.equal(status.suggestedNext, "Latest stage is stories: next is tests.");
  assert.throws(() => projectStatus("Unknown App", { registryPath }), /not registered/);
  assert.deepEqual(listRegisteredProjects(registryPath), [{ client: "Acme", program: "Facilities", application: "Facilities Request" }]);
  assert.deepEqual(listRegisteredProjects(join(app, "no-registry.json")), []);
});

test("the next step follows the delivery order", () => {
  assert.match(suggestNext(new Set()), /start with requirements/);
  assert.equal(suggestNext(new Set(["requirements"])), "Latest stage is requirements: next is research.");
  assert.equal(suggestNext(new Set(["research", "design"])), "Latest stage is design: next is stories.");
  assert.match(suggestNext(new Set(["stories", "code"])), /decide the review findings, then deploy/);
});

test("the desktop icon opens Windows Terminal in the workspace with the supervisor in charge", () => {
  const plan = planShortcut({ desktop: "C:\\Users\\x\\OneDrive - Co\\Desktop", workspace: "C:\\Users\\x\\ServiceNow-Assisted", windowsTerminal: "C:\\wt.exe" });
  assert.equal(plan.shortcutPath, "C:\\Users\\x\\OneDrive - Co\\Desktop\\Assisted Delivery.lnk");
  assert.equal(plan.target, "C:\\wt.exe");
  assert.equal(plan.arguments, `-d "C:\\Users\\x\\ServiceNow-Assisted" --title "Assisted Delivery" powershell.exe -NoExit -Command ${SUPERVISOR_COMMAND}`);
  const fallback = planShortcut({ desktop: "D", workspace: "W", windowsTerminal: undefined });
  assert.equal(fallback.target, "powershell.exe", "PowerShell alone when Windows Terminal is missing");
  assert.match(fallback.arguments, /claude --agent assisted-delivery-supervisor$/);
  const script = shortcutScript({ ...plan, shortcutPath: "C:\\it's\\Assisted Delivery.lnk" });
  assert.match(script, /CreateShortcut\('C:\\it''s\\Assisted Delivery\.lnk'\)/, "quotes are escaped for PowerShell");
});

test("eval fixtures under _home go to the sandbox home with its path filled in", () => {
  const fixtures = mkdtempSync(join(tmpdir(), "fixtures-"));
  writeFileSync(join(fixtures, "README.md"), "workspace file");
  mkdirSync(join(fixtures, "_home", ".claude"), { recursive: true });
  writeFileSync(join(fixtures, "_home", ".claude", "assisted-delivery-programs.json"), '{"location":"{{HOME}}\\\\Programs"}');
  const session = { cwd: mkdtempSync(join(tmpdir(), "work-")), home: mkdtempSync(join(tmpdir(), "home-")) };
  stageFixtures(fixtures, session);
  assert.equal(readFileSync(join(session.cwd, "README.md"), "utf8"), "workspace file");
  assert.throws(() => readFileSync(join(session.cwd, "_home", ".claude", "assisted-delivery-programs.json")), "not copied into the workspace");
  const registry = JSON.parse(readFileSync(join(session.home, ".claude", "assisted-delivery-programs.json"), "utf8"));
  assert.equal(registry.location, `${session.home}\\Programs`);
});

test("the supervisor's read-only shell may read project status", () => {
  const command = `"$HOME/.claude/assisted-delivery/node_modules/.bin/tsx.cmd" "$HOME/.claude/assisted-delivery/src/project-status.ts" --list`;
  assert.equal(decide({ tool_name: "Bash", tool_input: { command }, agent_type: "assisted-delivery-supervisor" }).allow, true);
});
