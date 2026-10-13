# Octane / Assisted-Delivery integration design notes

Status: **conceptual design only — nothing described here has been built.**
This is a write-up of a design conversation, kept here so it isn't lost and
can be shared/revisited. See the companion local memory
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
- **A scaffolding agent is needed** (the ServiceNow-toolkit analog of
  Octane's Acorn "Generate" function) to set up the storage hierarchy:
  program-level org/account → project-level repo → individual/local tier. It
  should write a small manifest per program/project stating where each tier
  lives, so other agents look up locations instead of guessing.
- **Provisioning stays human-confirmed.** Actually creating a GitHub org/repo
  or a SharePoint site/folder is infrastructure creation, not just writing
  files — a scaffolding agent's job is the manifest/structure, never
  autonomous provisioning.
- **Code, program files, and context files are always stored centrally** —
  never only local.
- **Drafts may live locally first**, but promotion from local to central is
  always explicitly triggered by the user. Agents must ask whether a given
  document is local or central, and must never auto-promote a draft.
- **Agents must confirm which program and project a task belongs to** each
  conversation when it isn't entirely obvious from context, rather than
  inferring it.

## How to apply this when building the integration

When extending the assisted-delivery agents/skills toward this model, bake
in:

1. A local-vs-central prompt before saving any document.
2. No auto-promotion logic from local to central.
3. A program/project confirmation step at conversation start when ambiguous.
4. Manifest-based location lookup rather than hardcoded paths.
5. Human approval gates around any infrastructure-creation step.

## Next step

Nothing here is implemented yet. The natural next step is spec'ing out the
scaffolding agent and/or the manifest format it would write.
