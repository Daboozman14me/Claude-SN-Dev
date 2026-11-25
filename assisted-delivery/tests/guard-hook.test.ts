import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
// @ts-expect-error plain JavaScript hook, no type declarations
import { decide } from "../hooks/guard.mjs";

const call = (command: string, agent?: string) => ({
  tool_name: "Bash",
  tool_input: { command },
  ...(agent ? { agent_type: agent } : {}),
});
const allowed = (command: string, agent?: string): boolean => decide(call(command, agent)).allow;

test("the user's own session and other agents are never restricted", () => {
  assert.equal(allowed("npx now-sdk install"), true, "main session");
  assert.equal(allowed("git push origin main"), true, "main session");
  assert.equal(allowed("curl https://example.com", "some-other-agent"), true);
  assert.equal(decide({ tool_name: "Write", tool_input: { file_path: "x" }, agent_type: "assisted-delivery-supervisor" }).allow, true);
});

test("no assisted-delivery agent may write to an instance, publish, or call the network", () => {
  for (const agent of ["assisted-delivery-code-writer", "assisted-delivery-backlog", "servicenow-assisted-delivery:assisted-delivery-research"]) {
    assert.equal(allowed("npx now-sdk exec -f create.js", agent), false, `${agent}: exec`);
    assert.equal(allowed("cd project && npx now-sdk install --auth dev", agent), false, `${agent}: install`);
    assert.equal(allowed("now-sdk auth --add x", agent), false, `${agent}: auth`);
    assert.equal(allowed("git commit -m x && git push", agent), false, `${agent}: publish`);
    assert.equal(allowed("curl -X POST https://dev1.service-now.com/api", agent), false, `${agent}: curl`);
    assert.equal(allowed("powershell Invoke-WebRequest https://x", agent), false, `${agent}: iwr`);
    assert.equal(allowed("npx now-sdk query sys_app -q scope=x_1 -f version -o json", agent), true, `${agent}: query`);
    assert.equal(allowed("npm run build", agent), true, `${agent}: build`);
    assert.equal(allowed("npx @servicenow/sdk install --auth dev", agent), false, `${agent}: install, package spelling`);
    assert.equal(allowed("npx @servicenow/sdk exec -f x.js", agent), false, `${agent}: exec, package spelling`);
    assert.equal(allowed("npx now-sdk auth --list", agent), true, `${agent}: listing aliases`);
    assert.equal(allowed("npx @servicenow/sdk auth --list 2>&1", agent), true, `${agent}: listing aliases`);
    assert.equal(allowed("npx now-sdk auth --list && npx now-sdk install", agent), false, `${agent}: list then install`);
  }
});

test("the supervisor runs only read-only commands", () => {
  const supervisor = "assisted-delivery-supervisor";
  for (const ok of [
    `"$HOME/.claude/assisted-delivery/node_modules/.bin/tsx.cmd" "$HOME/.claude/assisted-delivery/src/read-project-setup.ts" "New Conf Room Booking"`,
    "npx now-sdk query sys_app -q scope=x_888213_ncrb -f version -o json 2>&1",
    "cd C:/repo && git status --short && git log --oneline -3",
    "git -C C:/repo diff --stat",
    "npm run -s validate:assisted-backlog -- C:/a/backlog-v001.json",
  ]) assert.equal(allowed(ok, supervisor), true, ok);
  for (const blocked of [
    "npm run build",
    "node -e \"require('fs').writeFileSync('x','y')\"",
    "git status > status.txt",
    "rm -rf C:/repo",
    "npx now-sdk install",
    "git checkout main",
    "cd C:/repo && npm run evals",
  ]) assert.equal(allowed(blocked, supervisor), false, blocked);
});

test("instance reads name their fields and never touch secrets", () => {
  const research = "assisted-delivery-research";
  for (const ok of [
    "npx now-sdk query sys_script -q \"sys_scope.scope=x_1_app\" -f name,script,when,order -o json",
    "npx @servicenow/sdk query sys_app -q scope=x_1_app -f \"name,version\" -o json",
    "npx now-sdk query sys_properties -q \"name STARTSWITHx_1_app^type!=password^type!=password2\" -f name,value,type -o json",
    "npx now-sdk query sys_properties -q nameSTARTSWITHx_1_app -f name,type,description -o json",
    "npx now-sdk query --help",
  ]) assert.equal(allowed(ok, research), true, ok);
  for (const blocked of [
    "npx now-sdk query sys_script -q sys_scope.scope=x_1_app -o json",
    "npx now-sdk query sys_auth_profile_basic -q nameLIKEx -f name -o json",
    "npx now-sdk query oauth_entity -q name=x -f name,client_id -o json",
    "npx now-sdk query sys_rest_message -q name=x -f name,basic_auth_password -o json",
    "npx now-sdk query sys_user -q active=true -f user_name,user_password -o json",
    "npx now-sdk query sys_properties -q nameSTARTSWITHx_1_app -f name,value -o json",
  ]) assert.equal(allowed(blocked, research), false, blocked);
  assert.equal(allowed("npx now-sdk query sys_script -q x -o json", "assisted-delivery-code-review"), false, "applies to every agent");
});

test("document-only agents never touch an instance, even to read", () => {
  for (const agent of ["assisted-delivery-story-drafter", "assisted-delivery-solution-advisor", "assisted-delivery-technical-design", "assisted-delivery-test-design", "assisted-delivery-requirements-extractor"]) {
    assert.equal(allowed("npx now-sdk query sys_app -q scope=x_1 -f version -o json", agent), false, `${agent}: query`);
    assert.equal(allowed("npx @servicenow/sdk auth --list", agent), false, `${agent}: auth --list`);
    assert.equal(allowed("cd x && npx now-sdk download ./app", agent), false, `${agent}: download`);
    assert.equal(allowed("npx @servicenow/sdk explain BusinessRule --peek --format=raw", agent), true, `${agent}: docs`);
    assert.equal(allowed(`"$HOME/.claude/assisted-delivery/node_modules/.bin/tsx.cmd" "$HOME/.claude/assisted-delivery/src/ingest-documents.ts" "./sources"`, agent), true, `${agent}: ingest`);
  }
  assert.equal(allowed("npx now-sdk query sys_app -q scope=x_1 -f version -o json", "assisted-delivery-research"), true, "research still reads");
});

test("research reads the instance with query only", () => {
  assert.equal(allowed("npx now-sdk download ./app", "assisted-delivery-research"), false);
  assert.equal(allowed("npx now-sdk transform --from x", "assisted-delivery-research"), false);
  assert.equal(allowed("npx @servicenow/sdk download ./app", "assisted-delivery-research"), false);
  assert.equal(allowed("npx now-sdk init --from abc", "assisted-delivery-code-writer"), true, "the writer may init a project");
});

test("as a hook, a blocked command exits 2 with the reason and an allowed one exits 0", () => {
  const hook = join(dirname(fileURLToPath(import.meta.url)), "..", "hooks", "guard.mjs");
  const run = (input: unknown) => spawnSync(process.execPath, [hook], { input: JSON.stringify(input), encoding: "utf8" });
  const blocked = run(call("npx now-sdk exec -f x.js", "assisted-delivery-code-writer"));
  assert.equal(blocked.status, 2);
  assert.match(blocked.stderr, /Blocked by the assisted-delivery guard: assisted-delivery-code-writer may not run now-sdk exec/);
  assert.equal(run(call("git status")).status, 0);
  assert.equal(spawnSync(process.execPath, [hook], { input: "not json", encoding: "utf8" }).status, 0, "bad input never blocks the user");
});
