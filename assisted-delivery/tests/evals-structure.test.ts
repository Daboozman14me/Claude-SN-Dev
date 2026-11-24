import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// The toolkit folder is a junction; resolve the repo's evals/ beside it in Claude-SN-Dev.
const toolkit = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const candidates = [join(toolkit, "..", "evals"), join(process.env.USERPROFILE ?? "", "Claude-SN-Dev", "evals")];
const EVALS = candidates.find((path) => existsSync(path));

function caseFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === "results" || name === "mocks") return [];
    if (statSync(path).isDirectory()) return caseFiles(path);
    return name === "case.yaml" ? [path] : [];
  });
}

interface EvalCase {
  schema_version?: string;
  name?: string;
  tags?: string[];
  context?: { scaffold_script?: string };
  execution?: { prompt?: string; env?: Record<string, string> };
  graders?: Array<{ type: string; name: string; tool?: string; input_match?: string; max?: number }>;
}

test("every eval case is well formed and can never reach an instance", { skip: !EVALS && "no evals folder beside the toolkit" }, () => {
  const files = caseFiles(EVALS!);
  assert.ok(files.length > 0, "the suite has cases");
  for (const file of files) {
    // Cases are written as JSON-compatible YAML so they parse without a YAML library.
    const value = JSON.parse(readFileSync(file, "utf8")) as EvalCase;
    const where = file.replace(EVALS!, "evals");
    assert.equal(value.schema_version, "1.0", `${where}: schema_version 1.0`);
    assert.ok(value.name && value.execution?.prompt, `${where}: name and prompt`);
    assert.ok((value.graders ?? []).length > 0, `${where}: at least one grader`);
    for (const key of Object.keys(value.execution?.env ?? {})) {
      assert.match(key, /^EVAL_/, `${where}: only EVAL_* variables can be set from a case`);
    }
    const scaffold = value.context?.scaffold_script;
    assert.ok(scaffold, `${where}: a scaffold script stages the fixtures`);
    assert.ok(existsSync(join(dirname(file), scaffold!)), `${where}: the scaffold script exists`);
    if ((value.tags ?? []).includes("safety")) {
      const guards = (value.graders ?? []).filter((grader) => grader.type === "tool_used" && grader.max === 0);
      assert.ok(guards.length > 0, `${where}: a safety case needs at least one tool_used grader with max 0`);
    }
  }
});

test("the eval runner isolates every run from real instances and keeps reports local", () => {
  const runner = readFileSync(join(toolkit, "src", "run-evals.ts"), "utf8");
  assert.match(runner, /SN_SDK_CREDENTIALS_DIR: noCredentials/);
  assert.match(runner, /"--disallowedTools", \.\.\.HARD_DENY/);
  assert.doesNotMatch(runner, /ANTHROPIC_API_KEY|execFileSync\([^)]*apiKeyHelper/, "the runner never fetches or passes a login key itself");
  const scripts = (JSON.parse(readFileSync(join(toolkit, "package.json"), "utf8")) as { scripts: Record<string, string> }).scripts;
  assert.equal(scripts.evals, "tsx src/run-evals.ts");
});
