// Guard hook (Claude Code PreToolUse) for the ServiceNow Assisted Delivery agents.
//
// Runs before every Bash call. Commands from the user's own (main) session are never touched; commands
// from an assisted-delivery agent are refused when they could write to a ServiceNow instance, publish
// code, or call out to the network, and the supervisor may run only an allowlist of read-only commands.
// Plain JavaScript with no dependencies so it starts fast; exit code 2 blocks the call and the reason on
// stderr goes back to the agent.

const INSTANCE_WRITE = /\bnow-sdk\b[^\n|;&]*\b(exec|execute|install|deploy|cicd|auth)\b/i;
const PUBLISH = /\bgit\s+(push|commit)\b/i;
const NETWORK = /(^|[\s;&|(])(curl|wget|Invoke-WebRequest|Invoke-RestMethod|iwr|irm)(\s|$)/i;

// What the supervisor may run: read-only lookups and validators. Each piece of a compound command
// (split on && || ; |) must match one of these, and no output may be redirected to a file.
const SUPERVISOR_ALLOW = [
  /^cd(\s|$)/i,
  /^(pwd|ls|dir|whoami|date)(\s|$)/i,
  /^(npx\s+)?now-sdk\s+query(\s|$)/i,
  /^(npx\s+)?now-sdk\s+(--help|-h|--version|explain|query\s+--help)(\s|$)/i,
  /^git\s+(-C\s+\S+\s+)?(status|log|diff|show|rev-parse|ls-remote|ls-files|tag\s+-l|branch\s+--show-current)(\s|$)/i,
  /tsx(\.cmd)?["']?\s+["']?[^"'\s]*(read-project-setup|print-contract-schema|validate-assisted-[\w-]+)\.ts["']?(\s|$)/i,
  /^npm\s+run\s+(-s\s+)?(setup:show|contract:schema|validate:[\w-]+)(\s|$)/i,
];

export function agentName(input) {
  const raw = typeof input?.agent_type === "string" ? input.agent_type : "";
  return raw.split(":").pop() ?? "";
}

export function splitCommand(command) {
  return command
    .split(/&&|\|\||;|\|/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function decide(input) {
  if (input?.tool_name !== "Bash") return { allow: true };
  const command = String(input?.tool_input?.command ?? "");
  const agent = agentName(input);
  if (!agent.startsWith("assisted-delivery-")) return { allow: true };

  if (INSTANCE_WRITE.test(command)) {
    return { allow: false, reason: `${agent} may not run now-sdk exec/install/deploy/cicd/auth: instance writes, deploys and credentials belong to the owner.` };
  }
  if (PUBLISH.test(command)) {
    return { allow: false, reason: `${agent} may not commit or push: committing and pushing belong to the owner.` };
  }
  if (NETWORK.test(command)) {
    return { allow: false, reason: `${agent} may not call out with curl or web requests; use now-sdk query for read-only instance access.` };
  }
  if (agent === "assisted-delivery-supervisor") {
    if (/>(?!&1)/.test(command.replace(/2>&1/g, ""))) {
      return { allow: false, reason: "The supervisor may not write files, including by redirecting output." };
    }
    const blocked = splitCommand(command).find((part) => !SUPERVISOR_ALLOW.some((pattern) => pattern.test(part)));
    if (blocked) {
      return { allow: false, reason: `The supervisor runs only read-only commands (setup:show, now-sdk query, git status/log/diff, validators). Not allowed: ${blocked.slice(0, 120)}` };
    }
  }
  return { allow: true };
}

const isMain = process.argv[1] && import.meta.url.toLowerCase().endsWith(process.argv[1].replace(/\\/g, "/").toLowerCase());
if (isMain) {
  let raw = "";
  process.stdin.on("data", (chunk) => { raw += chunk; });
  process.stdin.on("end", () => {
    let input;
    try {
      input = JSON.parse(raw);
    } catch {
      process.exit(0);
    }
    const verdict = decide(input);
    if (verdict.allow) process.exit(0);
    process.stderr.write(`Blocked by the assisted-delivery guard: ${verdict.reason}\n`);
    process.exit(2);
  });
}
