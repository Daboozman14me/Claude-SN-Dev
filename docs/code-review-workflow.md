# Code review workflow

`assisted-delivery-code-review` gives ServiceNow code a fresh, read-only
review against ServiceNow's published practices. It never changes code; a
human decides what gets fixed.

## 1. Review

Point the agent (directly, or through `assisted-delivery-supervisor`) at a
folder or files: scripts, an update-set / application XML export, or a
Fluent project. Optionally name the application, instance alias, and focus
areas.

It produces `code-review-vNNN.html` and `code-review-vNNN.json` under
`ServiceNow-Assisted\Artifacts\<application>\<review-name>\`. Each finding
has an ID (`F-001`…), severity, category, confidence, exact file and lines,
the current code, a suggested replacement, the reason, the ServiceNow
practice involved, and any read-only instance check. Every decision starts
as `pending`.

## 2. Walk-through and decisions

Decisions are recorded in the main Claude session, never by the agent
(agents run in the background and cannot hold a conversation). Ask Claude to
walk through the report; it explains each finding and records your call:

```
npm run code-review:decide -- "<code-review-vNNN.json>" --finding F-003,F-004 --decision approved --note "..."
npm run code-review:decide -- "<code-review-vNNN.json>" --summary
```

Decisions are `approved`, `rejected`, `deferred`, or `pending` (to undo).
Only the `decision` field changes; an unknown ID or invalid decision records
nothing.

## 3. Fix

Before applying approved fixes, confirm the code hasn't changed since the
review:

```
npm run code-review:drift -- "<code-review-vNNN.json>" --approved-only
```

| Result | Meaning | Apply? |
|---|---|---|
| unchanged | file identical to the reviewed version | yes |
| intact | file changed elsewhere; reviewed lines still in place | yes |
| moved | code still present at different lines | re-confirm first |
| changed | reviewed code is gone or different | no — re-review |
| missing | file no longer exists | no |

The command exits with code 2 when anything is not safe to apply. Each
approved finding's `suggestedCode` replaces exactly its `currentCode` lines.

## 4. Re-review

Run the agent again on the same code with the same review name and the
prior JSON. The new version records each earlier finding as `resolved`,
`unresolved`, `regressed`, or `not_applicable`, and reports anything new.

All commands run from `~/.claude/assisted-delivery`. The validator
(`npm run validate:assisted-code-review -- <json> [--fresh]`) is run by the
agent itself; `--fresh` also proves no reviewed file changed during the
review.
