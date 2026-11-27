import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { isDirectExecution } from "./direct-execution.js";

// Creates the "Assisted Delivery" desktop icon: Windows Terminal, PowerShell, in the delivery workspace,
// already running the supervisor. Plain `claude` stays the normal session.

export interface ShortcutPlan {
  shortcutPath: string;
  target: string;
  arguments: string;
  workingDirectory: string;
  description: string;
}

export const SHORTCUT_NAME = "Assisted Delivery";
export const SUPERVISOR_COMMAND = "claude --agent assisted-delivery-supervisor";

export function planShortcut(options: { desktop: string; workspace: string; windowsTerminal: string | undefined }): ShortcutPlan {
  const powershell = `powershell.exe -NoExit -Command ${SUPERVISOR_COMMAND}`;
  // Without Windows Terminal, PowerShell opens in its own console window instead.
  const target = options.windowsTerminal ?? "powershell.exe";
  const args = options.windowsTerminal
    ? `-d "${options.workspace}" --title "${SHORTCUT_NAME}" ${powershell}`
    : `-NoExit -Command ${SUPERVISOR_COMMAND}`;
  return {
    shortcutPath: join(options.desktop, `${SHORTCUT_NAME}.lnk`),
    target,
    arguments: args,
    workingDirectory: options.workspace,
    description: "ServiceNow Assisted Delivery: Claude Code with the supervisor in charge",
  };
}

// PowerShell single-quoted string: only the quote itself needs doubling.
const quote = (value: string): string => `'${value.replace(/'/g, "''")}'`;

export function shortcutScript(plan: ShortcutPlan): string {
  return [
    "$shell = New-Object -ComObject WScript.Shell",
    `$link = $shell.CreateShortcut(${quote(plan.shortcutPath)})`,
    `$link.TargetPath = ${quote(plan.target)}`,
    `$link.Arguments = ${quote(plan.arguments)}`,
    `$link.WorkingDirectory = ${quote(plan.workingDirectory)}`,
    `$link.Description = ${quote(plan.description)}`,
    "$link.Save()",
  ].join("; ");
}

function powershellValue(command: string): string {
  const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", command], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr.trim() || `PowerShell failed: ${command}`);
  return result.stdout.trim();
}

if (isDirectExecution(import.meta.url, process.argv[1])) {
  const args = process.argv.slice(2);
  try {
    // The Desktop may be redirected (for example into OneDrive), so ask Windows where it is.
    const desktop = powershellValue("[Environment]::GetFolderPath('Desktop')");
    const workspace = join(homedir(), "ServiceNow-Assisted");
    // wt.exe is an app execution alias that file checks cannot see, so ask Windows where it resolves.
    const found = spawnSync("where.exe", ["wt"], { encoding: "utf8" });
    const terminal = found.status === 0 ? found.stdout.split(/\r?\n/)[0]?.trim() : undefined;
    const plan = planShortcut({ desktop, workspace, windowsTerminal: terminal || undefined });
    if (args.includes("--print")) {
      process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    } else {
      mkdirSync(workspace, { recursive: true });
      powershellValue(shortcutScript(plan));
      process.stdout.write(`Created '${plan.shortcutPath}': opens ${plan.target.endsWith("wt.exe") ? "Windows Terminal" : "PowerShell"} in ${workspace} running '${SUPERVISOR_COMMAND}'.\n`);
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
