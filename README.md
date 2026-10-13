# Claude-SN-Dev

This repo holds the **ServiceNow Assisted Delivery toolkit**: a set of Claude
Code custom subagents (ported from a GitHub Copilot multi-agent toolkit) plus
their supporting TypeScript library and skills. It is scoped to the toolkit
and its configuration only — it does **not** contain any ServiceNow client
project artifacts (those live separately, outside this repo).

## What's in here

- `agents/` — the subagent definitions: `assisted-delivery-supervisor` (the
  orchestration hub) plus six specialists (`requirements-extractor`,
  `research`, `solution-advisor`, `technical-design`, `story-drafter`,
  `test-design`), and one disabled work-in-progress agent
  (`assisted-delivery-level-of-effort.md.disabled` — still undersizes on a
  second clean engagement; do not re-enable until refined).
- `assisted-delivery/` — the TypeScript toolkit the agents call into
  (`src/`, `tests/`, `package.json`). Run `npm install` then `npm test` here
  after cloning; `node_modules/` and the runtime `cache/` folder are
  gitignored, not tracked.
- `skills/` — the two skills `assisted-delivery-research` depends on
  (`application-audit`, `architecture-report`).
- `docs/octane-integration-design.md` — design notes from an ongoing
  discussion on using these agents as building blocks for a persisted,
  governed context-file model (inspired by the "Octane" methodology).
- `docs/settings-permissions.md` — the Claude Code permission entries this
  toolkit needs, for setting it up on another machine.

## How this repo is wired up on this machine

This repo does **not** hold its own copies of the agent/skill/toolkit files.
Each of `agents/`, `assisted-delivery/`, `skills/application-audit/`, and
`skills/architecture-report/` is a **Windows directory junction** pointing at
the live files Claude Code actually reads from `~/.claude/`. Editing an agent
file normally (through Claude Code, or any editor) *is* editing the
git-tracked file — there is no separate copy to keep in sync.

To set this up on a different machine:

1. Clone this repo.
2. Make sure the toolkit/agents/skills exist locally at the usual Claude Code
   paths (`~/.claude/agents/`, `~/.claude/assisted-delivery/`,
   `~/.claude/skills/application-audit/`, `~/.claude/skills/architecture-report/`).
3. Delete the plain `agents/`, `assisted-delivery/`, `skills/application-audit/`,
   `skills/architecture-report/` folders this clone creates, and replace them
   with junctions (from an elevated-not-required shell):
   ```
   mklink /J agents "<path to>\.claude\agents"
   mklink /J assisted-delivery "<path to>\.claude\assisted-delivery"
   mklink /J skills\application-audit "<path to>\.claude\skills\application-audit"
   mklink /J skills\architecture-report "<path to>\.claude\skills\architecture-report"
   ```
   (In Git Bash specifically, run `cmd /c mklink /J ...` with
   `MSYS_NO_PATHCONV=1` set, otherwise MSYS mangles the `/J` flag.)

## Reverting a bad agent change

Because the junction points at the real file, normal git history applies
directly to it: `git diff`, `git checkout -- <file>`, `git log`, and
`git revert` all work as usual. Commit before letting an agent edit itself so
there's always a clean checkpoint to fall back to. Note: Claude Code only
reads `~/.claude/agents/*.md` at session **startup**, so a revert won't be
picked up by an already-running session until it's restarted.
