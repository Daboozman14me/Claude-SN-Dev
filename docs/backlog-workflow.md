# Backlog workflow

`assisted-delivery-backlog` keeps a ServiceNow Agile backlog true to the
approved stories and to what has been delivered. It maps; the toolkit derives
the records and the import file; the owner imports; the agent verifies. The
agent never writes to the instance.

## When it runs

| Moment in the chain | Mode | Result |
|---|---|---|
| The owner approves a Story Draft | `load` | Every epic (rm_epic) and story (rm_story) as Ready, with acceptance criteria |
| An epic is built, reviewed, deployed and verified | `sync` | That epic's stories Complete, its sprint (rm_sprint) and release (rm_release_scrum) recorded |
| The owner says the import is done | `verify` | Every record read back and reconciled |

A catch-up run (stories approved long ago, several epics already delivered)
is `load` + `sync` in one package.

## Steps

All commands run from `~/.claude/assisted-delivery`; the agent runs them, not
the owner.

1. Allocate paths: `npm run artifact:path -- --application <app> --request backlog --base backlog --extension html --extension json`.
2. Write the package skeleton: `storyDraft` (path, packageId, sha256 of the
   file), `plan` (releases, sprints, optional epic state overrides with the
   owner's reason), `storyStatus` (one per story, with evidence), and
   `instanceChecks` (the deployed version).
3. `npm run backlog:build -- <backlog-vNNN.json>` derives every record and
   writes `backlog-vNNN.xml` beside the package (`--split` writes one file per
   table, numbered in import order). Records and XML are never hand-written;
   the validator rebuilds both and refuses any difference.
4. For a sync, precheck every record on the instance (read-only) and record
   `absent`, `matches_package`, or `changed_on_instance`. A record a person
   changed is overwritten only with the owner's recorded approval.
5. `npm run report:render -- <backlog-vNNN.json>`, then
   `npm run validate:assisted-backlog -- <backlog-vNNN.json>`.
6. The owner imports: on the instance, open a list (for example
   `rm_story.list`), right-click a column heading, **Import XML**, choose the
   file, **Upload**. Importing the same file again changes nothing, because
   every sys_id is derived from the story draft and source ID.
7. Verify: a new package version in `verify` mode with one `verification`
   entry per record; validate with `--verified`.

## Status rules

| Evidence | State |
|---|---|
| Implemented (code-implementation report) in a deployed version | Complete (3) |
| Implemented, not deployed | Ready for testing (-7) |
| Deferred by the owner (note who and when) | Ready (1) |
| Not built yet | Ready (1) or Draft (-6) |

`partial` coverage is never Complete. Story points, assignees, and teams are
left for the team to set; the agent never invents them.
