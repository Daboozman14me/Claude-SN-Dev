# Octane / Assisted-Delivery integration design notes

Status: **the storage-scaffolding layer is built.** The 8th specialist,
`assisted-delivery-scaffolding`, exists at
`agents/assisted-delivery-scaffolding.md` and implements the hierarchy and
registration flow described below. The rest of this doc (the research →
story-drafter → test-design write-back chain) is still conceptual design
only. This is a write-up of a design conversation, kept here so it isn't lost
and can be shared/revisited. See the companion local memory
`project_octane_assisted_delivery_integration.md` for the raw working notes
this was adapted from.

## Background

Octane — a separate internal methodology, not this repo and not a public
project — is a governance model for building and maintaining enterprise
applications with AI code-assist agents. Its central
artifact is the **Business Context File (BCF)**: a living, per-feature
specification stored in the application's own repo, bound to the code it
governs (via `appliesTo` path globs and code-symbol anchors), carrying an
append-only decision log (Business Decision Records), grouped into Module
Bundles for selective context loading, and enforced by freshness/quality/
traceability gates with a named owner and an approval lifecycle.

The ServiceNow assisted-delivery agents in this repo are, by contrast,
one-shot, read-only report generators: each produces an HTML/JSON deliverable
(Requirements Register, Architecture Research Report, Solution
Recommendation, Technical Design, Story draft, Test Plan) with no
persistence, no binding to code, no decision log, and no gates.

## The core idea

The assisted-delivery agents could become the authoring/verification building
blocks for an Octane-style persisted context file, chained roughly like this:

1. **`research`** seeds the initial context/baseline for an application (its
   current-state architecture).
2. **`story-drafter`** supplies the proposed change — the delta a new story
   should make to that context.
3. **`test-design`** (and a verification step) checks what was actually
   delivered against the intended change.
4. On approval, the result is written back to the context file — updating it
   in place rather than producing another disconnected one-shot report.

This mirrors Octane's own lifecycle: Create (initial BCF authoring) → Build →
context-update (write-back) → Independent Verification (match delivered work
against acceptance criteria before approval).

## Design decisions reached so far

- **Storage is not one-size-fits-all.** Each team/program may use a GitHub
  repo, SharePoint, or local storage, chosen per that team's own customer
  requirements — there is no single mandated backend.
- **Git-backed storage gets governance mechanics for free**: PR review,
  merge-conflict visibility, CODEOWNERS-style ownership, CI gates. SharePoint
  or local storage would need to fake those (version history, a manual
  ownership convention) — explicitly a lighter-weight tier, not an
  equivalent.
- **A scaffolding agent sets up the storage hierarchy** (the ServiceNow-
  toolkit analog of Octane's Acorn "Generate" function): **Client → Program →
  Project/Application**. A program maps to one GitHub org/account, one
  SharePoint root, or one local root folder, per the team's own choice. A
  project/application defaults to **one repo (or folder) per application**;
  a shared repo for multiple small/tightly-coupled applications is an
  explicit exception, confirmed every time a given repo name turns out to
  already be in use, never assumed.
- **Provisioning stays human-first, agent-assisted.** Creating a GitHub org,
  a GitHub repo, or a SharePoint site/library is something a human does or
  explicitly approves, one action at a time — never a standing
  authorization. The scaffolding agent *attempts* git repo creation (via
  `gh`) only after that specific approval; if it can't (no `gh`, not
  authenticated, no org permission, name taken, network error), it reports
  the precise reason and asks the human to either create it themselves or
  point to an existing repo instead. A plain local root folder is the one
  exception the agent may create directly — that's not infrastructure
  provisioning, just `mkdir`.
- **The manifest lives colocated with the program's own root storage** (a
  dedicated git meta-repo named after the program, the SharePoint root, or
  the local root) — never a separate central system. This follows Octane's
  own principle that context lives next to what it describes, extended up
  one level from "application" to "program."
- **A personal, local pointer registry** — not shared, not part of any
  tracked repo — maps program aliases to `{client, program, storageType,
  location}`. It's a list because one person works multiple client accounts
  at once; resolving an ambiguous task means checking this registry for an
  exact match, multiple candidates (ask which), or no match (start new-
  program registration). It lives at
  `~/.claude/assisted-delivery-programs.json` — deliberately *outside* the
  junction-linked `assisted-delivery/` folder this repo tracks, since it
  accumulates client names and repo URLs across every account the person
  works and must never risk being swept into a commit here.
- **Code, program files, and context files are always stored centrally** —
  never only local.
- **Drafts may live locally first**, but promotion from local to central is
  always explicitly triggered by the user. Agents must ask whether a given
  document is local or central, and must never auto-promote a draft.
- **Agents must confirm which program and project a task belongs to** each
  conversation when it isn't entirely obvious from context, rather than
  inferring it.

### Worked example

Client USPS, program POSTALPROGRAM, git-backed, with a dedicated meta-repo
holding the manifest plus three sibling project repos; client Army, program
Army, SharePoint-backed via a synced local drive letter.

Personal registry (`~/.claude/assisted-delivery-programs.json`):

```json
{
  "programs": [
    {
      "alias": "postal",
      "client": "USPS",
      "program": "POSTALPROGRAM",
      "storageType": "git",
      "location": "https://github.com/USPS/POSTALPROGRAM"
    },
    {
      "alias": "army",
      "client": "Army",
      "program": "Army",
      "storageType": "sharepoint",
      "location": "E:\\SHAREPT1"
    }
  ]
}
```

POSTALPROGRAM's manifest (inside `github.com/USPS/POSTALPROGRAM`):

```json
{
  "program": "POSTALPROGRAM",
  "client": "USPS",
  "storageType": "git",
  "org": "USPS",
  "projects": [
    { "application": "Project1", "repo": "https://github.com/USPS/Project1" },
    { "application": "Project2", "repo": "https://github.com/USPS/Project2" },
    { "application": "Project3", "repo": "https://github.com/USPS/Project3" }
  ]
}
```

Army's manifest (at `E:\SHAREPT1\manifest.json`):

```json
{
  "program": "Army",
  "client": "Army",
  "storageType": "sharepoint",
  "root": "E:\\SHAREPT1",
  "projects": [
    { "application": "Project1", "folder": "E:\\SHAREPT1\\Project1" },
    { "application": "Project2", "folder": "E:\\SHAREPT1\\Project2" },
    { "application": "Project3", "folder": "E:\\SHAREPT1\\Project3" }
  ]
}
```

Both shapes are validated by
`assisted-delivery/src/validate-assisted-scaffolding.ts` against the
`programRegistrySchema`/`programManifestSchema` zod schemas in
`assisted-delivery/src/assisted-contracts.ts`.

## How to apply this when building the integration

When extending the assisted-delivery agents/skills toward this model, bake
in:

1. A local-vs-central prompt before saving any document.
2. No auto-promotion logic from local to central.
3. A program/project confirmation step at conversation start when ambiguous.
4. Manifest-based location lookup rather than hardcoded paths.
5. Human approval gates around any infrastructure-creation step.

## Next step

The storage-scaffolding layer above is built (`assisted-delivery-scaffolding`
agent + registry/manifest schemas + validator). What's still conceptual:
chaining `research` → `story-drafter` → `test-design`/verification into an
actual write-back loop against a program's registered context, per "The core
idea" above.
