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

test("as a hook, a blocked command exits 2 with the reason and an allowed one exits 0", () => {
  const hook = join(dirname(fileURLToPath(import.meta.url)), "..", "hooks", "guard.mjs");
  const run = (input: unknown) => spawnSync(process.execPath, [hook], { input: JSON.stringify(input), encoding: "utf8" });
  const blocked = run(call("npx now-sdk exec -f x.js", "assisted-delivery-code-writer"));
  assert.equal(blocked.status, 2);
  assert.match(blocked.stderr, /Blocked by the assisted-delivery guard: assisted-delivery-code-writer may not run now-sdk exec/);
  assert.equal(run(call("git status")).status, 0);
  assert.equal(spawnSync(process.execPath, [hook], { input: "not json", encoding: "utf8" }).status, 0, "bad input never blocks the user");
});
