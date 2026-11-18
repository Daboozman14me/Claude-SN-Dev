# User guide workflow

`assisted-delivery-user-guide` writes the guide for a delivered capability
once a deploy has been verified: **Part 1** for the people who use it and
**Part 2** for the people who administer it, plus simple "how it works"
diagrams and the known limitations.

## Inputs

The approved story draft, the technical design, every code-implementation
and completion report for the delivered epics, the latest architecture
research report (of the deployed version), the owner decisions log, and the
deployed version — or the recorded project setup (`npm run setup:show`).

## Rules the validator enforces

- **Only delivered work.** Every story a code-implementation source covers as
  implemented is accounted for (explained in a section, or given a reason it
  is not user-facing), and no section describes a story that was not
  implemented. Deferred work belongs in Known limitations.
- **Every printed name was checked.** Each menu item, button, field, setting,
  email, role or table the guide names points to a recorded read-only
  instance check.
- **Sources are fingerprinted.** If a source report changes after the guide
  was written, validation fails until the guide is refreshed.
- **The HTML is rendered from the JSON**, so the two cannot disagree.

## Screenshots

The agent cannot see the UI, so each step that needs a picture carries a
marked placeholder (an id and a caption saying exactly what to capture). A
person takes the screenshots and drops them in.

## Commands (run by the agent)

```
npm run artifact:path -- --application <app> --request user-guide --base user-guide --extension html --extension json
npm run report:render -- <user-guide-vNNN.json>
npm run validate:assisted-user-guide -- <user-guide-vNNN.json>
```
