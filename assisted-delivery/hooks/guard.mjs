// Guard hook (Claude Code PreToolUse) for the ServiceNow Assisted Delivery agents.
//
// Runs before every Bash call. Commands from the user's own (main) session are never touched; commands
// from an assisted-delivery agent are refused when they could write to a ServiceNow instance, publish
// code, or call out to the network, and the supervisor may run only an allowlist of read-only commands.
// Plain JavaScript with no dependencies so it starts fast; exit code 2 blocks the call and the reason on
// stderr goes back to the agent.

// The SDK is run as now-sdk or as npx @servicenow/sdk; both spellings are guarded.
const INSTANCE_WRITE = /(\bnow-sdk\b|@servicenow\/sdk\b)[^\n|;&]*\b(exec|execute|install|deploy|cicd|auth)\b/i;
// Listing saved credential aliases shows names only, never secrets, so agents may match an alias.
const AUTH_LIST = /^(npx\s+)?(now-sdk|@servicenow\/sdk)\s+auth\s+(--list|-l)(\s+2>&1)?$/i;
const PUBLISH = /\bgit\s+(push|commit)\b/i;
const NETWORK = /(^|[\s;&|(])(curl|wget|Invoke-WebRequest|Invoke-RestMethod|iwr|irm)(\s|$)/i;

// What the supervisor may run: read-only lookups and validators. Each piece of a compound command
// (split on && || ; |) must match one of these, and no output may be redirected to a file.
const SUPERVISOR_ALLOW = [
  /^cd(\s|$)/i,
  /^(pwd|ls|dir|whoami|date)(\s|$)/i,
  /^(npx\s+)?(now-sdk|@servicenow\/sdk)\s+query(\s|$)/i,
  /^(npx\s+)?(now-sdk|@servicenow\/sdk)\s+(--help|-h|--version|explain|query\s+--help|auth\s+(--list|-l))(\s|$)/i,
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

// Tables whose purpose is to hold secrets; no agent needs to read them to understand an application.
export const CREDENTIAL_TABLES = new Set([
  "sys_auth_profile_basic", "sys_auth_profile_oauth2", "oauth_entity", "oauth_credential", "oauth_entity_profile",
  "discovery_credentials", "ssh_credentials", "ssh_private_key_credentials", "basic_auth_credentials",
  "api_key_credentials", "windows_credentials", "snmp_credentials", "cloud_credentials", "jdbc_credentials",
  "sys_certificate", "sys_user_password", "sys_auth_api_key", "ecc_agent_credential",
]);
const SENSITIVE_FIELD = /(password|passwd|secret|token|credential|private_key|api_key|client_key)/i;

export function tokenize(segment) {
  const tokens = [];
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
  for (let match = pattern.exec(segment); match; match = pattern.exec(segment)) tokens.push(match[1] ?? match[2] ?? match[3]);
  return tokens;
}

// Every instance read names its fields and stays away from secrets.
export function checkQuery(segment) {
  const tokens = tokenize(segment);
  const at = tokens.findIndex((token) => token === "query");
  if (at < 0 || tokens.includes("--help") || tokens.includes("-h")) return undefined;
  const table = (tokens[at + 1] ?? "").toLowerCase();
  const option = (...names) => {
    const index = tokens.findIndex((token) => names.includes(token));
    return index >= 0 ? tokens[index + 1] ?? "" : undefined;
  };
  const fields = option("-f", "--fields");
  const query = option("-q", "--query") ?? "";
  if (CREDENTIAL_TABLES.has(table)) return `${table} holds credentials; no agent reads it. Describe the integration from its configuration instead.`;
  if (fields === undefined) return `name the fields to read with -f (never select every field of ${table || "a table"}).`;
  const sensitive = fields.split(",").map((field) => field.trim()).filter((field) => SENSITIVE_FIELD.test(field));
  if (sensitive.length > 0) return `credential-like fields are never read: ${sensitive.join(", ")}.`;
  if (table === "sys_properties" && /(^|,)\s*value\s*(,|$)/i.test(fields) && !/type!=password/i.test(query)) {
    return "read sys_properties values only with password-type properties excluded (add ^type!=password^type!=password2 to the query).";
  }
  return undefined;
}

const PROJECT_FROM_INSTANCE = /(\bnow-sdk\b|@servicenow\/sdk\b)[^\n|;&]*\b(download|transform|init)\b/i;

export function decide(input) {
  if (input?.tool_name !== "Bash") return { allow: true };
  const command = String(input?.tool_input?.command ?? "");
  const agent = agentName(input);
  if (!agent.startsWith("assisted-delivery-")) return { allow: true };

  if (splitCommand(command).some((part) => INSTANCE_WRITE.test(part) && !AUTH_LIST.test(part))) {
    return { allow: false, reason: `${agent} may not run now-sdk exec/install/deploy/cicd/auth: instance writes, deploys and credentials belong to the owner.` };
  }
  if (PUBLISH.test(command)) {
    return { allow: false, reason: `${agent} may not commit or push: committing and pushing belong to the owner.` };
  }
  if (NETWORK.test(command)) {
    return { allow: false, reason: `${agent} may not call out with curl or web requests; use now-sdk query for read-only instance access.` };
  }
  for (const part of splitCommand(command)) {
    if (!/\bnow-sdk\b|@servicenow\/sdk/.test(part)) continue;
    const problem = checkQuery(part);
    if (problem) return { allow: false, reason: `${agent}: ${problem}` };
  }
  if (agent === "assisted-delivery-research" && PROJECT_FROM_INSTANCE.test(command)) {
    return { allow: false, reason: "Research reads the instance with now-sdk query only; it does not download, transform or init projects." };
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
