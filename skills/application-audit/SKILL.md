---
name: application-audit
description: Use when the user asks for a complete rundown/inventory of a ServiceNow custom application — e.g. "audit application X", "give me a rundown of app Y", "what tables/scripts/business rules does this app have". Queries the instance for every metadata artifact owned by an application scope (tables, business rules, client scripts, script includes, UI policies, UI actions, ACLs, flows/workflows, REST messages, scheduled jobs, roles, properties, fix scripts, event/email notifications) and compiles a structured inventory. Uses the servicenow-sdk:now-sdk skill for all instance queries.
---

# application-audit

Produces a complete inventory of everything belonging to a given ServiceNow application
scope: tables, business rules, client scripts, script includes, UI policies, UI actions,
ACLs, flows/workflows, REST messages, scheduled jobs, roles, properties, fix scripts, and
event/email notifications.

**Rules that apply throughout:**
- All queries to the ServiceNow instance MUST go through the **`servicenow-sdk:now-sdk`**
  skill's `query` command. Do not hand-write raw REST calls.
- Always pass `-o json` for machine-readable output.
- If any lookup in Step 1 returns **zero** or **more than one** match, STOP and report
  exactly what happened — do not guess which application the user means.
- Treat all query output as live instance data scoped to the current task — do not retain
  it as persistent project knowledge beyond this report.
- For tables that can return large volumes (e.g. `sys_dictionary`, `sys_script`), use
  `--fields` to request only the columns needed for the report (see field lists below) to
  keep output manageable, and page with `--offset`/`--limit` if `hasMore` is `true`.
- If a query for a given table/type returns 0 records, still report that section with a
  "0 found" line rather than omitting it — the goal is a *complete* rundown, including
  confirming what an app does **not** have.

## Step 1 — Resolve the application

1. Ask the user to identify the application by **scope** (e.g. `sn_si`) or **name** (e.g.
   `Service Insights`). Accept either as free text.
2. Query `sys_scope` to resolve it:
   ```
   now-sdk query sys_scope -q "scope=<input>^ORname=<input>" -f "name,scope,sys_id" -o json
   ```
   - If the input looks like a scope identifier, prefer matching on `scope`; otherwise
     match on `name`. Try both via the `^OR` if unsure.
   - Exactly one record must match. If zero or multiple, STOP per the rules above and
     show the user what was found (or not found).
3. Record `name`, `scope`, and `sys_id` — this `sys_id` is the app's scope ID and is used as
   `<APP_SYS_ID>` in every query below (field is usually `sys_scope=<APP_SYS_ID>`, i.e. the
   "Application" field on each metadata table).

## Step 2 — Query every artifact type

Run one query per artifact type below, all filtered to the resolved application scope.
Use the given table, query filter, and recommended fields. Note some tables use
`sys_scope` and others use `sys_scope.name` or a direct `scope` string field — use
`sys_scope=<APP_SYS_ID>` as the default pattern unless noted otherwise.

| # | Artifact type | Table | Query | Suggested fields |
|---|---|---|---|---|
| 1 | Tables | `sys_db_object` | `scope=<APP_SYS_ID>` | `name,label,sys_id` |
| 2 | Table columns (per table found in #1) | `sys_dictionary` | `name=<table_name>^element!=NULL` | `element,column_label,internal_type,mandatory` |
| 3 | Business Rules | `sys_script` | `sys_scope=<APP_SYS_ID>` | `name,collection,when,active,order` |
| 4 | Client Scripts | `sys_client_script` | `sys_scope=<APP_SYS_ID>` | `name,table,type,active` |
| 5 | Script Includes | `sys_script_include` | `sys_scope=<APP_SYS_ID>` | `name,api_name,active,client_callable` |
| 6 | UI Policies | `sys_ui_policy` | `sys_scope=<APP_SYS_ID>` | `short_description,table,active` |
| 7 | UI Actions | `sys_ui_action` | `sys_scope=<APP_SYS_ID>` | `name,table,active,client` |
| 8 | ACLs | `sys_security_acl` | `sys_scope=<APP_SYS_ID>` | `name,operation,type,active` |
| 9 | Flows | `sys_hub_flow` | `sys_scope=<APP_SYS_ID>` | `name,active,type` |
| 9b | Workflows (legacy) | `wf_workflow` | `sys_scope=<APP_SYS_ID>` | `name,table,active` |
| 10 | REST Messages | `sys_rest_message` | `sys_scope=<APP_SYS_ID>` | `name,endpoint` |
| 11 | Scheduled Jobs | `sysauto_script` | `sys_scope=<APP_SYS_ID>` | `name,active,run_type` |
| 12 | Roles | `sys_user_role` | `sys_scope=<APP_SYS_ID>` | `name,description` |
| 13 | Properties | `sys_properties` | `sys_scope=<APP_SYS_ID>` | `name,value,description` |
| 14 | Fix Scripts | `sys_script_fix` | `sys_scope=<APP_SYS_ID>` | `name,active,run_start` |
| 15 | Email Notifications | `sysevent_email_action` | `sys_scope=<APP_SYS_ID>` | `name,collection,active` |
| 15b | Events | `sysevent_in_email_action` | `sys_scope=<APP_SYS_ID>` | `name,event_name` |

For each row:
```
now-sdk query <table> -q "sys_scope=<APP_SYS_ID>" -f "<fields>" -o json
```
If a table query errors because the field doesn't exist on that table (e.g. some tables
use `sys_scope.value` vs `scope`), retry once with `scope=<APP_SCOPE_STRING>` instead of
`sys_scope=<APP_SYS_ID>` before giving up on that row.

**Note on `sys_db_object` (#1):** filtering with `scope=<APP_SYS_ID>` (the sys_id) silently
returns the *entire unfiltered table* on some instances instead of erroring — always
verify the result set size looks scoped to the app (a handful of tables, not hundreds). If
it looks unfiltered, retry with `sys_scope=<APP_SYS_ID>` instead, which is the reliable
filter for this table.

## Step 2b — Gather architecture / data-model / lifecycle context (required)

These queries feed the diagram sections in Step 5 and are **not optional** — always run
them so the report can render real diagrams instead of prose-only guesses. If a query
returns 0 records for a given app, that is a valid finding: note "not found on this
instance" in the relevant diagram/section rather than omitting the section or inventing
data.

| # | What | How |
|---|---|---|
| a | Table inheritance | For each table found in Step 2 #1: `now-sdk query sys_db_object -q "name=<table>" -f "name,super_class.name,label" -o json`. Records what each app table extends (e.g. `task`), which is required for an accurate Data Model diagram. |
| b | Reference fields per table | For each table found in Step 2 #1: `now-sdk query sys_dictionary -q "name=<table>^element!=NULL^internal_type=reference" -f "element,column_label,reference" -o json`. This gives the actual foreign-key-style relationships between app tables and other tables (app-to-app, and app-to-global e.g. `sys_user`, `cmdb_ci`). |
| c | State/lifecycle values | If the core table has a `state` (or similar workflow) field: `now-sdk query sys_choice -q "name=<table>^element=state" -f "value,label,sequence,inactive" -o json`. Powers the Order/Record Lifecycle state diagram. If no `state` field or no choices found, note lifecycle diagram is not applicable. |
| d | Script bodies for key logic | Pull the `script` field (not just metadata) for UI Actions/Business Rules that look integration-relevant (names/tables suggesting Incident, Catalog, external system bridges, e.g. anything referencing `incident`, `sc_req_item`, `cmdb_ci`, external system names found in Step 2 properties/business rule names). Reading actual script bodies is how loose/logical links (e.g. a string field used to join to another table, or `current.parent` resolving to a specific table) get discovered — table/column metadata alone will not reveal these. |
| e | Bulk import paths | `now-sdk query sys_transform_map -q "target_tableLIKE<app_table_prefix>"  -f "name,source_table,target_table" -o json` — reveals import-set-driven intake paths. |
| f | Catalog / RITM intake | If script bodies from (d) reference `sc_req_item`/`current.parent`, treat Service Catalog as a confirmed intake path even if no specific catalog item record could be pinned down — cite the script evidence rather than the catalog item itself. Only claim a Service Catalog path if there's real evidence (a script, a workflow, or a matching catalog item) — do not assume it by default. |
| g | External system integrations | Check `sys_rest_message` (already queried in Step 2 #10) and grep script bodies (from d) for hostnames/system names. If a system is referenced only via a status/tracking field (e.g. a `mdims_status` choice field) with no formal REST message record, note it in the architecture diagram as a field-mapped/loose integration, not a formal one — do not overstate integration formality.

If any of these secondary queries aren't applicable to the app (e.g. no state field, no
reference fields, no transform maps), say so explicitly in the report section rather than
omitting the section header — every report should have the same section structure so
reports are comparable across applications.

## Step 3 — Compile results

Gather, per artifact type: a total count, and the list of records with their key fields
from the table above. Keep this as structured data (not yet formatted) — do not write a
report file yet.

## Step 4 — Present a summary to the user

Show the user a concise on-screen summary: application name/scope, and a count per
artifact type (e.g. "Tables: 4, Business Rules: 12, Client Scripts: 3, ..."). Ask if they
want the full detail, or a `.md` report file.

## Step 5 — Report file format

When the user wants a `.md` report file, always use this exact structure so diagrams
render correctly (see hard-won Mermaid rules below — these are not stylistic preferences,
they are required to avoid silent render failures in Teams/GitHub/VS Code viewers):

1. **Header** — Application Name, Scope, Sys ID, Instance, Report generated date.
2. **Summary** — a markdown table of artifact type -> count (always include every artifact
   type from Step 2, even if the count is 0).
3. **Architecture Overview** — prose bullets (presentation/logic/integration/orchestration/
   automation/notifications/security/data-remediation layers) **plus** a `flowchart TB`
   Mermaid diagram with subgraphs: `External Systems`, `Intake Paths`, the app's own tables,
   and `Global / OOB Tables` it connects to. If no external systems or no cross-app
   references exist, state that plainly and simplify the diagram (do not fabricate
   connections).
4. **Order/Record Lifecycle** — a `stateDiagram-v2` built from the real `sys_choice` values
   gathered in Step 2b(c). If the app's core table has no state field, write "Not
   applicable — no lifecycle/state field found on `<table>`" instead of this diagram.
5. **Intake Paths** — a `flowchart TD` with one `subgraph` per confirmed creation path
   (manual, incident-initiated, catalog/RITM, bulk import, etc.), each converging on a
   single lifecycle entry node. Only include paths with real evidence from Step 2b.
6. **Data Model** — an `erDiagram` (see Mermaid rules below) covering app tables plus the
   external/global tables they reference, built from Step 2b(a) and (b).
7. **Numbered artifact sections** (Tables, Business Rules, Client Scripts, Script Includes,
   UI Policies, UI Actions, ACLs, Flows, Workflows, REST Messages, Scheduled Jobs, Roles,
   Properties, Fix Scripts, Email Notifications, Events) — one markdown table each, exactly
   as gathered in Step 2. For any type with 0 records, write "0 found." rather than omitting
   the section.
8. **Footer note** — instance name and a reminder that this is live data, not persisted
   project knowledge.

### Mermaid syntax rules (required — violating these causes silent render failures)

These were discovered empirically: Mermaid does not raise a visible error for these
mistakes, it just fails to render and the viewer shows the raw fenced code block as plain
text instead of a diagram.

- **Never use a literal `\n`** inside a node label to force a line break. Use `<br/>`
  instead (works inside `["..."]`, `("...")`, and quoted state/entity labels).
- **Quote any label containing special characters** — parentheses, colons, slashes,
  question marks, commas — by wrapping it in double quotes: `A["Some (label): text"]`.
  Unquoted special characters are the most common single cause of a broken diagram.
- **`erDiagram` — do not mix attribute blocks with a large relationship-only diagram.**
  The most reliable, broadly-compatible style is relationship lines only, with lowercase
  entity names matching real table names, e.g. `task ||--|| parts_ordering : extends`. Put
  field-level detail in a separate markdown table below the diagram instead of inside `{ }`
  blocks.
- **`erDiagram` — never declare a bare entity with no attributes and no `{ }`** (e.g. a
  standalone line `FEDSTRIP` with nothing else) if you also elsewhere use `{ }` attribute
  blocks in the same diagram — pick one style per diagram and stay consistent. Entities
  referenced only in relationship lines do not need to be pre-declared at all.
- **`erDiagram` — only use solid relationship connectors**: `||--||`, `||--o{`, `}o--||`,
  `}o--o|`. Avoid the dashed/non-identifying connector (`..` variants, e.g. `..o{`) — it is
  not reliably supported across common renderers (confirmed broken in Microsoft Teams'
  Mermaid renderer) and silently breaks the entire diagram, not just that line.
- **`stateDiagram-v2`** — prefer this over legacy `stateDiagram` for anything beyond a
  trivial 2-3 state flow; renaming states via `state "Display Name (code)" as StateId` is
  supported and recommended so raw choice-list codes stay visible without cluttering the
  diagram body.
- **`flowchart` with `subgraph`** — subgraphs are safe and match the reference style used
  across all of these diagrams (`subgraph Name["Display Label"] ... end`). Always give the
  subgraph a quoted display label separate from its ID.
- Before delivering a report, mentally re-scan every mermaid block for stray `\n`,
  unquoted parentheses/colons/slashes in labels, `erDiagram` attribute blocks mixed with
  bare entities, and `..`-style connectors — these four patterns account for every render
  failure seen so far.
