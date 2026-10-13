---
name: architecture-report
description: Use when the user asks to run/generate/produce a current-state Architecture Research Report for a ServiceNow application — phrases like "run architecture report for application X", "generate an architecture report for Y", "do a current-state report on Z". Resolves the application on the live instance, then delegates to the assisted-delivery-research agent with all the operating rules already baked in (direct live-instance querying, incremental Markdown writing to stay under the output token limit, and handling of the known schema-validator name-mismatch defect) so the user never has to restate them.
---

# architecture-report

Produces a complete current-state Architecture Research Report for a named ServiceNow
application by delegating to the `assisted-delivery-research` agent, with the operating
rules this workflow needs already built into the launch prompt.

## Step 1 — Resolve the application

1. Take the application name/scope the user gave (e.g. "Book Conference Room").
2. Query `sys_scope` to resolve it to its real identity:
   ```
   npx @servicenow/sdk query sys_scope -q "nameLIKE<input>^ORscopeLIKE<input>" -f "name,scope,sys_id,short_description" -o json
   ```
   - Exactly one record must match. If zero or multiple, STOP and show the user what was
     found — do not guess.
   - Record the resolved `name` (the instance's true display name — this is often
     **different** from what the user typed, e.g. "Book Conference Room" resolving to
     "Conference Room Scheduler"), the technical `scope` string, and the `sys_id`.

## Step 2 — Launch the research agent

Invoke the `assisted-delivery-research` agent (via the Agent tool) with a prompt that
includes all of the following — do not omit any of these, they were each learned the hard
way on a prior run of this exact workflow:

1. **Identity**: pass the resolved scope name, sys_id, and true display name from Step 1,
   plus the user's original literal wording.
2. **Query live, not stale evidence**: instruct the agent to query the live instance
   directly for every artifact category — never reuse or assume continuity with any prior
   report for this app, since the app may have changed since the last research pass.
3. **Incremental writing**: instruct the agent to write the Markdown report skeleton first
   (all required section headers), then append each inventory category via separate `Edit`
   calls — never compose the full report in one giant `Write`/response. This avoids
   crashing against the per-turn output token cap.
4. **Known validator defect**: warn the agent that `assistedApplicationResearchPackageSchema`
   hard-requires `requestContext.targetApplication` to case-insensitively equal the resolved
   `application.name`. If the user's literal wording doesn't match the instance's true
   resolved name (common — see Step 1), the validator will fail with exactly one error on
   that field. The agent must NOT fabricate a matching name to force a pass. Instead it
   should document the mismatch as a limitation in both the Markdown (Technical Debt & Risk
   Notes / Research Limitations) and the JSON `limitations` array, and manually cross-check
   Markdown/JSON binding consistency by hand (diff inventory category/record markers against
   the JSON `inventory` array) as a substitute for the automated validator.
5. **Follow its own artifact-path allocation and validation commands** exactly as specified
   in the agent's own instructions (`allocate-artifact-paths.ts`, `validate-assisted-research.ts`).
6. **Report back**: ask the agent to return the output file paths, artifact counts by
   category, and any defects/limitations it hit.

## Step 3 — Present results

Summarize on screen: output file paths, the artifact-count table, key current-state
findings, and any defect/limitation the agent surfaced. Do not re-fetch or duplicate the
agent's evidence gathering yourself — relay its findings.
