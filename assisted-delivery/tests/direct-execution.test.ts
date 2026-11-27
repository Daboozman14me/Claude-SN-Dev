import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import test from "node:test";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isDirectExecution } from "../src/direct-execution.js";

test("recognizes an executable path using a platform-correct file URL", () => {
  const executablePath = resolve("src/cli.ts");

  assert.equal(
    isDirectExecution(pathToFileURL(executablePath).href, executablePath),
    true,
  );
});

test("rejects a different executable path", () => {
  assert.equal(
    isDirectExecution(
      pathToFileURL(resolve("src/cli.ts")).href,
      resolve("src/validate-research-package.ts"),
    ),
    false,
  );
});

test("recognizes a script run through a junction to the toolkit", () => {
  const root = mkdtempSync(join(tmpdir(), "direct-execution-"));
  const real = join(root, "toolkit");
  mkdirSync(join(real, "src"), { recursive: true });
  const script = join(real, "src", "tool.ts");
  writeFileSync(script, "");
  const link = join(root, "home", ".claude", "assisted-delivery");
  mkdirSync(join(root, "home", ".claude"), { recursive: true });
  symlinkSync(real, link, "junction");
  try {
    // Node reports the module by its real path; the command line names the link.
    assert.equal(isDirectExecution(pathToFileURL(script).href, join(link, "src", "tool.ts")), true);
    assert.equal(isDirectExecution(pathToFileURL(script).href, join(link, "src", "other.ts")), false);
  } finally {
    unlinkSync(link);
  }
});
