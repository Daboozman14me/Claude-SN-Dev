# Code writer workflow

`assisted-delivery-code-writer` writes ServiceNow changes for **Fluent or
classic** applications, in the **output form you choose**:

| Output form | What you get | Who applies it |
|---|---|---|
| Fluent project edits | Changed files in the Fluent project folder, built with `npm run build` | You review the `git diff`, commit, and deploy separately |
| Copy/paste instructions | For each record, in the HTML report: the menu path, which record to open, every field to set, and the full current code beside the full new code | You paste it on the instance |
| Background scripts | `.js` files plus a README and an undo script for each | You run them in Scripts - Background |
| Fix scripts | Same, written as Fix Script records | You create the Fix Script records and run them |

It never deploys, never commits or pushes, never runs the scripts it writes,
and never writes to ServiceNow. It only reads the instance to establish the
current state.

## 1. Intake (main session, with you)

The writer can't hold a conversation, so the main session (or the
supervisor) asks you these first, one at a time, and never assumes the
answers:

1. **Is the app Fluent or classic?** It suggests an answer from the evidence
   it has (research report, stories, `now.config.json`) and asks you to
   confirm.
2. **Where is it?**
   - Fluent: "the project at `<path>`, or another?" Another can be a local
     folder, a git repo to clone into a new folder, or the instance to
     download it from.
   - Classic: the instance alias and application scope.
3. **Which output do you want?** It asks this even for Fluent apps.
4. **What's changing?** Stories plus a technical design, approved review
   findings, or a plain request in your words.
5. **How much does this run cover?** Which stories, which approved findings,
   or which part of the request.
6. **Known differences** (Fluent): if the project is expected to differ
   from the instance, each difference is listed as `KD-NN` and you confirm
   the project is authoritative for it. A difference is one of two kinds:
   - **Named records** on one table, such as a deliberate hand fix.
   - **Undeployed commits since `<commit>`**, when earlier runs' fixes are
     committed but not yet deployed. One entry covers them all. The
     validator checks git to confirm each differing record's file really
     changed since that commit.

   Any difference not on the list still stops the run.
7. **Read-back.** It reads the whole work order back to you and waits for
   an explicit go.

## 2. Current-state research (writer, read-only)

Before writing anything, the writer checks what exists today:

- **Fluent:**
  - The project must have no uncommitted changes.
  - It snapshots every file before it starts.
  - It compares the records in scope with the instance. **If the local
    project differs from the instance, it stops and asks which one is
    right.**
- **Classic:** it queries each record the change touches, or uses an
  update-set export or research report you supply.
- **Fix mode:** it confirms each approved finding's code is still there.
  Findings whose code has changed are reported as `skipped_drift` and need
  re-review.

When something doesn't add up, you get a **stopped** report with specific
questions instead of a guess. Answer them and start a new run.

## 3. The change

- **Build mode** (stories or a request): it implements only the run scope.
  Anything the design leaves undecided is marked `partial` or `blocked`
  rather than invented.
- **Fix mode** (approved findings): exactly the approved `suggestedCode`,
  nothing more.
  - Fluent: applied line for line by the toolkit, never by hand.
  - Other forms: a script step or paste instruction per finding.
  - Each finding gets an outcome: `applied`, `skipped_not_approved`,
    `skipped_no_change`, `skipped_drift`, `skipped_out_of_scope`, or
    `failed`.
- **Fluent:** it runs `npm run build` after each story and stops after three
  failing builds in a row.
- **Scripts:**
  - One script when the change is simple. Otherwise several, plus a
    `README.md` giving the run order and the application scope and update
    set to select for each.
  - Every script:
    - starts with a header (ID, purpose, what it implements, run order,
      scope, update set);
    - starts with `var DRY_RUN = true;`, so the first run is only a preview;
    - looks records up by name, never by a hard-coded sys_id;
    - skips any record that no longer matches what was researched;
    - is safe to re-run;
    - logs each action with `gs.info('[D-NN] …')`;
    - comes with an undo script.

Output goes to `ServiceNow-Assisted\Artifacts\<application>\<run-name>\`:
`code-implementation-vNNN.html/.json`, plus a
`code-implementation-vNNN-scripts\` folder for script forms. The validator
checks every file against its recorded hash and checks the script
conventions above.

## 4. Automatic review and the Completion Report

As soon as a run completes, `assisted-delivery-code-review` reviews exactly
what the writer produced, with no stop to ask you first:
- Fluent: every changed file.
- Scripts: every script and undo script.
- Copy/paste: the paste instructions.

For a fix run it also re-reviews the findings that were applied, marking
each `resolved`, `unresolved`, or `regressed`.

A toolkit script then composes **`completion-report-vNNN.html/.json`**
beside the implementation report:
- the work done;
- each fix's outcome and whether the reviewer agrees it's resolved;
- the build result;
- every new finding, with its severity and location;
- next steps.

The composer refuses if the review missed a changed file or saw a different
version of it. It never overwrites earlier reports.

## 5. After a run

1. **Decide each finding** in the Completion Report (approve, reject, or
   defer, recorded in the review JSON). Approved findings become the next
   fix run.
2. **Review the change.**
   - Fluent: `git diff` in the project folder, plus the reports.
   - Scripts: read each script and the README.
   - Copy/paste: read the instructions.
2. **Apply it yourself** (not needed for Fluent).
   - Scripts: run each one with `DRY_RUN = true`, check the log, then set
     `DRY_RUN = false` and run it again.
   - Fix scripts: create each Fix Script record with **Record for rollback**
     checked.
   - Keep the undo scripts in case you need to back the change out.
3. **After applying scripts or paste instructions**, export the update set
   as XML and ask for a post-apply re-review against the same review. This
   confirms what actually landed on the instance.
4. **Commit, push, and deploy yourself**, as separate, deliberate steps.

The agents normally run these toolkit commands themselves; to run one by
hand, run it from `~/.claude/assisted-delivery`:
- `npm run code-writer:snapshot -- <project>`
- `npm run code-writer:apply-fixes -- <code-review.json> [--dry-run]`
- `npm run validate:assisted-code-implementation -- <json> [--verify-changes]`
  — `--verify-changes` is for Fluent output only.
- `npm run completion:compose -- <code-implementation.json> <code-review.json>`
- `npm run validate:assisted-completion-report -- <completion-report.json> [--fresh]`

## New Fluent applications: own repo, deploy by GitHub Actions

Installing from this machine (`now-sdk install`) is blocked by the corporate
proxy, so every new Fluent application gets its own GitHub repo and is
deployed from GitHub's servers instead.

1. **Repo request.** At intake, `assisted-delivery-scaffolding` generates a
   checklist for you:
   - the owner and exact repo name;
   - visibility **Private**;
   - **completely empty**, with no README, `.gitignore` or license.

   You create the repo and send back its URL. Scaffolding verifies it and
   clones it.
2. **First build run.** The writer creates the Fluent project inside that
   empty clone. It adds `.github/workflows/deploy-servicenow.yml` from the
   toolkit template. You review the run, then commit and push.
3. **Deploying (later, only when you decide).** Deploying means installing
   the app on a ServiceNow instance.
   - The main session first confirms which instance you mean. It never
     assumes the one it happens to be connected to.
   - You start **Actions > Deploy to ServiceNow > Run workflow** in GitHub
     and type the instance name twice.
   - The workflow refuses mismatched names. It checks the instance's own
     `instance_name` before installing, and it never runs on push.
   - One-time setup per instance (repo Settings > Environments): an
     environment named exactly as the instance, with secrets `SN_USERNAME`
     and `SN_PASSWORD`. You can add required reviewers for an extra approval
     click. You add those secrets yourself.
   - The project's lockfile points at the corporate npm proxy, which GitHub
     can't reach. The workflow rewrites those URLs to public npm, and the
     lockfile's integrity hashes still guarantee identical packages.

`npm run report:render -- <json>` renders the HTML for an implementation or
review package, and `npm run contract:schema -- <package type>` prints one
package's JSON shape. The agents use both.
