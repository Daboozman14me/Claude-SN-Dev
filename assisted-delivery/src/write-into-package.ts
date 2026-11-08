import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// Lets a toolkit command place its output straight into an agent's package skeleton,
// so agents never stage large tool output in scratch files.
export function writeIntoPackage(packagePath: string, field: string, value: unknown): void {
  const path = resolve(packagePath);
  const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`'${path}' is not a JSON package object.`);
  }
  (parsed as Record<string, unknown>)[field] = value;
  writeFileSync(path, `${JSON.stringify(parsed, null, 2)}\n`);
}

export function takeIntoOption(args: string[]): { into?: string; rest: string[] } {
  const index = args.indexOf("--into");
  if (index === -1) return { rest: args };
  const into = args[index + 1];
  if (!into || into.startsWith("--")) throw new Error("--into needs the path of an existing JSON package.");
  return { into, rest: [...args.slice(0, index), ...args.slice(index + 2)] };
}
