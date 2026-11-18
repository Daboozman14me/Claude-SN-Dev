# Update set delta workflow

For teams that move changes **DEV → TEST → PROD as update sets** instead of
deploying from git, a Fluent change is packaged as a **delta update set**:
only the records added, changed, or deleted since the version on the target
instance. Classic in-instance work needs none of this; the platform captures
its own update sets.

## How the delta is built

`npm run update-set:delta -- --project <fluent dir> --from <baseline tag> --to <ref> --instance <alias> --into <update-set-delta-vNNN.json>`

1. Both versions are extracted from git with `git archive` (read-only: no
   checkout, no worktree) and built with the project's own `node_modules`.
   The build must leave the keys file unchanged, so every record keeps the
   sys_id it has on the instance.
2. The two builds are compared record by record (`dist/app/update`, table
   definitions, choice sets, the app record). Unchanged records are left out;
   demo data only with `--include-demo`. A removed record becomes a DELETE
   entry; the app record carries the new version.
3. The result is one update set named `<App> <new version> (delta from
   <baseline version>)` with one entry per record, written deterministically
   so the validator can regenerate it byte for byte. Both builds are kept
   beside the package as evidence.

## The mixed-mode precheck

`npm run update-set:precheck -- <package.json>` reads every delta record from
the target instance (read-only) and classifies it:

| Status | Meaning | Import? |
|---|---|---|
| `absent` | a new record is not there yet | yes |
| `matches_baseline` | the record is exactly the baseline version | yes |
| `already_applied` | the record already has the new version | yes (no-op) |
| `changed_on_instance` | someone changed it in the UI since the baseline (who/when shown) | only with the owner's approval |
| `unexpected_present` | a "new" record already exists with other values | only with the owner's approval |

After the owner imports, previews, and commits, `--verify` re-reads the
records and expects every one to be `already_applied`.

## Validation

`npm run validate:assisted-update-set-delta -- <package.json> [--verified]`
checks the refs still point at the same commits, the kept builds are
unchanged, the entries and XML are exactly what the builds produce, every
entry was prechecked, and no blocking precheck lacks approval.

## Importing (the owner)

On the target instance: System Update Sets → Retrieved Update Sets →
Import Update Set from XML → upload → open it → **Preview Update Set**
(resolve any collision) → **Commit Update Set**. Then ask for verification.
Repeat per instance up the promotion chain; each instance gets its own
baseline check.

## Limits

A delta assumes the target already has the app (first install: deploy the
full app or publish it to an update set once). Changes made directly in the
instance UI on the same records must be reconciled before import — that is
what the precheck is for.
