# Required Claude Code permissions for the assisted-delivery toolkit

Snapshot of the permission entries that make this toolkit work without
constant prompts, taken from the global `~/.claude/settings.json` and
`~/.claude/settings.local.json` on 2026-10-13. This is a **reference, not a
synced file** — the global settings files hold plenty of unrelated
permissions and are never committed wholesale.

To replicate on a new machine, add these to the permissions `allow` list in
`~/.claude/settings.json` (adjust the username/path):

```
Bash("C:\Users\<you>\.claude\assisted-delivery" && npm run typecheck)
Bash("C:\Users\<you>\.claude\assisted-delivery\node_modules\.bin\tsx.cmd" *)
Bash(C:\Users\<you>\.claude\assisted-delivery\node_modules\.bin\tsx.cmd *)
Bash('C:\Users\<you>\.claude\assisted-delivery\node_modules\.bin\tsx.cmd' *)
Bash("C:\Users\<you>\AppData\Roaming\npm\now-sdk.cmd" *)
Skill(*)
Read(C:\Users\<you>\.claude\assisted-delivery\**)
Write(C:\Users\<you>\.claude\assisted-delivery\**)
Edit(C:\Users\<you>\.claude\assisted-delivery\**)
Glob(C:\Users\<you>\.claude\assisted-delivery\**)
Grep(C:\Users\<you>\.claude\assisted-delivery\**)
```

If the toolkit's output location (ServiceNow project artifacts/evidence) is
somewhere else, mirror those same five tool entries (`Read`/`Write`/`Edit`/
`Glob`/`Grep`) for that path too — in this setup that was
`C:\Users\<you>\ServiceNow-Assisted\**`, which is intentionally **not** part
of this repo (client project artifacts, scoped separately).

## Known gotchas this toolkit has hit before

- **All agents need the `Edit` tool, not just `Write`.** A past session lost
  6+ hours to a hang because every agent's frontmatter was missing `Edit`
  despite the agent's own instructions requiring it. Confirm each
  `agents/assisted-delivery-*.md` frontmatter actually grants `Edit`.
- **Claude Code only discovers `~/.claude/agents/*.md` at session startup.**
  A newly added or edited agent file won't be picked up mid-session —
  restart to verify changes.
- **Shell out to `tsx` by absolute path, never `cd` into the toolkit first**
  — that's the established convention across every build session on this
  toolkit.
