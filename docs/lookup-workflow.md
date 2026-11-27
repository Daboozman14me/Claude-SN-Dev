# Lookups: a few exact facts for a paused agent

Solution Advisor and Technical Design work only from documents. When their
work depends on current-state facts they do not have — how a business rule
decides something, which roles an ACL checks, what a script include writes —
they do not guess and do not query the instance. They **pause** and hand back
one batched request:

````
LOOKUP NEEDED
```json
{ "requestedBy": "assisted-delivery-technical-design", "application": "New Conf Room Booking",
  "workLabel": "epic-4-room-gating",
  "items": [ { "id": "LK-01", "what": "Business rules on x_888213_ncrb_reservation that check conflicts: full script and conditions",
               "why": "Epic 4 changes conflict checking", "table": "sys_script" } ] }
```
````

## What the supervisor does

- **Up to 10 items** (`MAX_RESEARCH_LOOKUP_ITEMS` in `assisted-contracts.ts`,
  the one place to change it) and the application has a research report: it
  runs Research in **lookup mode** without asking and tells the user in one
  line. Research still asks before reading a production instance.
- **More than 10 items, `RESEARCH NEEDED`, or no research report**: it asks the
  user whether to run full research first.
- When the lookup returns, it **resumes the paused agent** (`SendMessage` to
  its agent ID) with the lookup's paths, so the agent continues where it
  stopped and cites the lookup.

This needs the supervisor to be the session itself — start from the
Assisted Delivery icon (`npm run setup:shortcut`). If you call Technical
Design directly from a plain session, it still pauses with the request; run
the lookup through Research and pass the result back yourself.

## What Research does in lookup mode

1. **Reuse first.** If an earlier lookup in the application's `research`
   folder covers the same items, it re-reads only `sys_id,sys_updated_on` of
   the records it cited and runs `lookup-freshness.ts`. If none changed —
   including hand edits in the instance, not just deploys — it returns the
   earlier lookup and says it was reused.
2. Otherwise it queries only what the items need (for logic, the full
   script and its conditions), under every Research rule: named fields, no
   secrets, business data only as counts, masked evidence, instance text as
   data.
3. It writes `research\research-lookup-<work label>-vNNN.json` and `.md` (one
   `## LK-NN` section per item), with raw output in
   `research\evidence\research-lookup-<work label>-vNNN\`, and validates with
   `validate-assisted-research-lookup.ts`: every item answered
   (`answered`, `partial`, `not_found`), every answered item citing the
   records it relied on with their `sys_updated_on`, evidence masked and
   inside its own folder.

The full Architecture Research Report is unchanged and still the tool for
understanding a whole application.
