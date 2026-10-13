import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
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
