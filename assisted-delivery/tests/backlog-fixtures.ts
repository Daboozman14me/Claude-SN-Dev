import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ASSISTED_CONTRACT_VERSION } from "../src/assisted-contracts.js";
import { sha256Hex } from "../src/build-backlog.js";

const citation = {
  id: "cite-1",
  documentId: "doc-1",
  unitId: "unit-1",
  location: { kind: "file", path: "C:\\inputs\\technical-design-v001.md" },
  quote: "book a room",
} as const;

export function storyDraft(_directory: string): Record<string, unknown> {
  const criterion = (id: string) => ({
    id,
    text: "Given a free room, when a user books it, then the booking is <confirmed> & saved.",
    citationIds: [citation.id],
  });
  const story = (id: string, dependencyIds: string[] = []) => ({
    id,
    title: `Story ${id}`,
    userStory: `As a user I want ${id}.`,
    description: `Implements ${id}.`,
    citationIds: [citation.id],
    acceptanceCriteria: [criterion(`${id}-AC01`)],
    dependencyIds,
    assumptions: [],
    questions: [],
  });
  return {
    contractVersion: ASSISTED_CONTRACT_VERSION,
    packageType: "story_draft",
    packageId: "fixture-stories-v001",
    designBasis: { kind: "technical_design", path: "C:\\inputs\\technical-design-v001.json", packageId: "fixture-design-v001" },
    title: "Fixture stories",
    artifacts: { html: "C:\\inputs\\story-draft-v001.html", json: "C:\\inputs\\story-draft-v001.json" },
    sourceInventory: [
      { path: citation.location.path, supported: true, readable: true, included: true, format: "markdown", unitCount: 1, warnings: [] },
    ],
    documents: [
      {
        contractVersion: ASSISTED_CONTRACT_VERSION,
        id: "doc-1",
        title: "Objectives",
        format: "markdown",
        sourcePath: citation.location.path,
        units: [{ id: "unit-1", type: "document_text", text: "Users book a room.", location: citation.location }],
        warnings: [],
      },
    ],
    authoritativeDocumentIds: ["doc-1"],
    citations: [citation],
    epics: [
      { id: "E0", title: "Foundation", objective: "Tables and roles.", storyIds: ["S0-01", "S0-02"], citationIds: [citation.id] },
      { id: "E1", title: "Booking", objective: "Book rooms.", storyIds: ["S1-01"], citationIds: [citation.id] },
    ],
    stories: [story("S0-01"), story("S0-02", ["S0-01"]), story("S1-01", ["S0-01"])],
    assumptions: [],
    questions: [],
    warnings: [],
  };
}

// Only the fields the backlog validator reads; a real report also passes its own validator.
export function implementationEvidence(directory: string, coverage: Array<[string, string]>): string {
  const path = join(directory, "code-implementation-v001.json");
  writeFileSync(
    path,
    JSON.stringify({
      packageType: "code_implementation",
      packageId: "fixture-epic-0-build",
      storyCoverage: coverage.map(([storyId, status]) => ({ storyId, status, note: "Fixture." })),
    }),
  );
  return path;
}

export function backlogScenario() {
  const directory = mkdtempSync(join(tmpdir(), "backlog-"));
  const draftPath = join(directory, "story-draft-v001.json");
  writeFileSync(draftPath, JSON.stringify(storyDraft(directory), null, 2));
  const evidencePath = implementationEvidence(directory, [["S0-01", "implemented"], ["S0-02", "partial"]]);
  const evidence = [{ path: evidencePath, packageId: "fixture-epic-0-build", note: "Epic 0 build" }];
  const value = {
    contractVersion: ASSISTED_CONTRACT_VERSION,
    packageType: "backlog",
    packageId: "fixture-backlog-v001",
    title: "Backlog: fixture",
    summary: "Load and sync.",
    artifacts: { html: join(directory, "backlog-v001.html"), json: join(directory, "backlog-v001.json") },
    modes: ["load", "sync"],
    target: { application: "Fixture App", instanceAlias: "dev000001" },
    storyDraft: { path: draftPath, packageId: "fixture-stories-v001", sha256: sha256Hex(readFileSync(draftPath)) },
    progressSources: evidence,
    plan: {
      releases: [{ id: "v1.0.0", name: "Fixture v1.0.0", startDate: "2026-11-09 08:00:00", endDate: "2026-11-10 16:00:00", state: "3" }],
      sprints: [
        { id: "SP-E0", name: "Fixture Epic 0", releaseId: "v1.0.0", epicIds: ["E0"], startDate: "2026-11-09 08:00:00", endDate: "2026-11-10 16:00:00", state: "3" },
      ],
      epicStateOverrides: [],
    },
    storyStatus: [
      { storyId: "S0-01", state: "3", basis: "deployed", evidence },
      { storyId: "S0-02", state: "1", basis: "deferred", note: "Deferred by the owner." },
      { storyId: "S1-01", state: "1", basis: "not_started" },
    ],
    unloadDate: "2026-11-15 12:00:00",
    precheck: [],
    instanceChecks: [{ query: "sys_app version", result: "1.0.0" }],
  };
  writeFileSync(value.artifacts.json, JSON.stringify(value, null, 2));
  return { directory, draftPath, evidencePath, value };
}
