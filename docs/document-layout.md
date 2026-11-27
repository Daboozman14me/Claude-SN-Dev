# Where documents live

Every agent writes its documents with one rule:

```
<application folder>\<type folder>\<document type>[-<work label>]-vNNN.<ext>
```

## Application folder

- **Registered application** (set up through scaffolding): the folder recorded
  for it — the program's root plus the application's folder. The root is
  a local folder, the OneDrive-synced copy of a SharePoint library, or the
  git clone of the program repo (agents never commit; the owner reviews and
  commits). A SharePoint program recorded only as a URL is refused until its
  synced folder is recorded.
- **Unregistered application** (and eval sandboxes):
  `%USERPROFILE%\ServiceNow-Assisted\Artifacts\<application>\`, or a team
  default in `.github\servicenow-assist.json`. The allocator reports
  `registeredApplication` when it used a registration, so the supervisor
  can offer to register an application that has none.
- An explicit `--root` always wins.

## Type folders

| Folder | Documents |
|---|---|
| `requirements\` | requirements-extraction (plus source documents and the decisions log) |
| `research\` | application-research, research-lookup, and their `evidence\` |
| `solution\` | solution-recommendation |
| `design\` | technical-design |
| `stories\` | story-draft |
| `tests\` | test-plan (with `internal\` sidecars) |
| `code\` | code-implementation (and `-scripts\`), completion-report |
| `reviews\` | code-review |
| `backlog\` | backlog |
| `update-sets\` | update-set-delta |
| `user-guide\` | user-guide |
| `loe\` | level-of-effort |

## Work label

The epic number plus a short name (`epic-4-room-gating`), or a short name
alone for work outside an epic (`email-body-fix`). The supervisor proposes it
in the code-writing read-back, or picks it and says so for other requests,
then passes the same label to every specialist for that work, so a piece of
work's research, design, stories, tests, code, and review line up and a
redo is the next version. App-wide documents (backlog, user guide) carry no
label. Files from before labels (`story-draft-v001.json`) stay valid.

Allocate with:

```
npm run artifact:path -- --application "<app>" --label "<work label>" --base <document type> --extension html --extension json
```

(`--request` is still accepted as the old name for `--label`; `--program`
picks the program when an application is registered in more than one.)

## Moving documents from the old layout

The old layout was one folder per request
(`Artifacts\<app>\<request>\<type>-vNNN.*`). To move an application (it must
be registered first):

```
npm run artifacts:migrate -- plan --from "<Artifacts folder>" --app "<old folder>=<Application>" --out plan.json [--labels labels.json]
npm run artifacts:migrate -- apply plan.json [--also-rewrite <manifest.json>]
```

`plan` writes every old -> new path and the work label for each old request
folder; edit the labels (through `--labels`, a
`{ "<old app folder>": { "<old request folder>": "<label>" } }` file) and
plan again until it shows no conflicts. `apply` copies, rewrites absolute
paths inside the copies (and any `--also-rewrite` file), reseals recorded
hashes that matched the original exactly, and validates every package
before and after. Only when nothing that was valid fails afterwards does it
rename the old folder to `Artifacts\_archive\<app>-migrated-<date>`. Nothing
is deleted.
