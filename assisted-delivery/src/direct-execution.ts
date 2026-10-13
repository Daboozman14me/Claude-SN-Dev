import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function isDirectExecution(
  moduleUrl: string,
  executablePath: string | undefined,
): boolean {
  return (
    executablePath !== undefined &&
    moduleUrl === pathToFileURL(resolve(executablePath)).href
  );
}
