import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { isDirectExecution } from "./direct-execution.js";
import { walkDirectory } from "./index-code-review-sources.js";
import { fileSha256 } from "./validate-assisted-code-review.js";

// Generated or installed content; changes there are not authored edits.
const SNAPSHOT_SKIPPED_DIRECTORIES = new Set(["node_modules", "dist", "target", ".git", ".now"]);

export interface ProjectSnapshot {
  root: string;
  capturedAt: string;
  files: Array<{ path: string; sha256: string }>;
}

export interface SnapshotDiff {
  created: string[];
  modified: string[];
  deleted: string[];
}

export function snapshotFluentProject(root: string, now: Date = new Date()): ProjectSnapshot {
  const absoluteRoot = resolve(root);
  if (!existsSync(absoluteRoot)) {
    return { root: absoluteRoot, capturedAt: now.toISOString(), files: [] };
  }
  if (!statSync(absoluteRoot).isDirectory()) {
    throw new Error(`Project root is not a directory: '${absoluteRoot}'.`);
  }
  const files = walkDirectory(absoluteRoot, SNAPSHOT_SKIPPED_DIRECTORIES)
    .sort((a, b) => a.localeCompare(b))
    .map((path) => ({ path, sha256: fileSha256(path) }));
  return { root: absoluteRoot, capturedAt: now.toISOString(), files };
}

export function diffSnapshots(
  baseline: Pick<ProjectSnapshot, "files">,
  current: Pick<ProjectSnapshot, "files">,
): SnapshotDiff {
  const before = new Map(baseline.files.map((file) => [resolve(file.path), file.sha256]));
  const after = new Map(current.files.map((file) => [resolve(file.path), file.sha256]));
  const created: string[] = [];
  const modified: string[] = [];
  const deleted: string[] = [];
  for (const [path, sha] of after) {
    if (!before.has(path)) created.push(path);
    else if (before.get(path) !== sha) modified.push(path);
  }
  for (const path of before.keys()) {
    if (!after.has(path)) deleted.push(path);
  }
  const sort = (list: string[]) => list.sort((a, b) => a.localeCompare(b));
  return { created: sort(created), modified: sort(modified), deleted: sort(deleted) };
}

if (isDirectExecution(import.meta.url, process.argv[1])) {
  const root = process.argv[2];
  if (!root) {
    process.stderr.write("Usage: npm run code-writer:snapshot -- <project-root>\n");
    process.exitCode = 1;
  } else {
    try {
      process.stdout.write(`${JSON.stringify(snapshotFluentProject(root), null, 2)}\n`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`Project snapshot failed: ${message}\n`);
      process.exitCode = 1;
    }
  }
}
