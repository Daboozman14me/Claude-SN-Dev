# Code writer workflow

`assisted-delivery-code-writer` writes Fluent (ServiceNow SDK) code inside
**one project folder you name** for each run. It never deploys, never
commits or pushes, never writes to ServiceNow, and only reads the instance to
check facts (for example, the company code or whether a table exists).

## Before a run

- The project folder must have **no uncommitted changes** if it is a git
  repo — commit or discard first. Every run then starts from a known point,
  so its changes can be reviewed with `git diff` and undone if needed.
- The writer snapshots every file before it starts and proves at the end
  (`--verify-changes`) that its report lists exactly the files that changed.

## Build mode — implement stories

Inputs: the project folder (or an empty folder plus app name and scope for a
new app), a Story Draft JSON, a Technical Design JSON, and the **story IDs for
this run** — about one epic at a time.

1. For a new app it reads the company code, confirms the scope
   (`x_<company code>_<name>`, at most 18 characters) is free, runs
   `now-sdk init`, and `npm install`.
2. It implements only the named stories, following the design. Anything the
   design leaves undecided is marked `partial` or `blocked`, not invented.
3. It runs `npm run build` after each story and stops after three failing
   builds in a row.
4. It writes `code-implementation-vNNN.html/.json` under
   `ServiceNow-Assisted\Artifacts\<application>\<run-name>\`: every changed
   file, which story / acceptance criterion / design decision it implements,
   each story's status, and the build result.

## Fix mode — apply approved review findings

Input: a Code Review JSON whose decisions you have recorded
(`code-review-workflow.md`, step 2).

1. Drift check → dry run → apply, all with toolkit scripts — never by hand.
   Only `approved` findings whose code is unchanged are applied, line for
   line; everything else is reported (`skipped_not_approved`,
   `skipped_no_change`, `skipped_drift`, `failed`).
2. It builds the project. If an applied fix breaks the build it reports
   that rather than patching it with unapproved edits.

## After a run

1. Review the change: `git diff` in the project folder, plus the HTML report.
2. Ask for a re-review by `assisted-delivery-code-review` (same review name,
   prior review JSON) to confirm fixes are resolved and nothing regressed.
3. Commit and push yourself (or ask the main Claude session to, with your
   approval). Deploying is a separate, deliberate step.

Toolkit commands (run from `~/.claude/assisted-delivery`, normally by the
agent): `npm run code-writer:snapshot -- <project>`,
`npm run code-writer:apply-fixes -- <code-review.json> [--dry-run]`,
`npm run validate:assisted-code-implementation -- <json> [--verify-changes]`.
