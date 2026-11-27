import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// The toolkit is often reached through a junction or symlink (~/.claude/assisted-delivery in a team
// clone, or an eval sandbox), so compare real paths: otherwise a script run through the link would
// silently do nothing.
function realFileUrl(path: string): string {
  try {
    return pathToFileURL(realpathSync.native(path)).href.toLowerCase();
  } catch {
    return pathToFileURL(resolve(path)).href.toLowerCase();
  }
}

export function isDirectExecution(
  moduleUrl: string,
  executablePath: string | undefined,
): boolean {
  if (executablePath === undefined) return false;
  if (moduleUrl === pathToFileURL(resolve(executablePath)).href) return true;
  return realFileUrl(fileURLToPath(moduleUrl)) === realFileUrl(resolve(executablePath));
}
