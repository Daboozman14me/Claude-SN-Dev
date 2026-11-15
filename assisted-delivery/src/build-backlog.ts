import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { resolve } from "node:path";
import {
  BACKLOG_FIELDS,
  BACKLOG_NUMBER_PREFIXES,
  BACKLOG_TABLES,
  backlogPackageSchema,
  storyDraftPackageSchema,
  type BacklogPackage,
  type BacklogRecord,
  type BacklogTable,
  type StoryDraftPackage,
} from "./assisted-contracts.js";
import { isDirectExecution } from "./direct-execution.js";

const SHORT_DESCRIPTION_MAX = 160;
const ACTIVE_STORY_STATES = new Set(["3", "2", "-7", "-8"]);

export function sha256Hex(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

// Same inputs always give the same sys_id, so a re-import updates instead of duplicating.
export function backlogSysId(storyDraftPackageId: string, table: BacklogTable, sourceId: string): string {
  return sha256Hex(`${storyDraftPackageId}:${table}:${sourceId}`).slice(0, 32);
}

function shortDescription(id: string, title: string): string {
  const text = `${id} — ${title}`;
  return text.length <= SHORT_DESCRIPTION_MAX ? text : `${text.slice(0, SHORT_DESCRIPTION_MAX - 1)}…`;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function buildBacklogRecords(value: BacklogPackage, draft: StoryDraftPackage): BacklogRecord[] {
  const draftId = draft.packageId;
  const status = new Map(value.storyStatus.map((entry) => [entry.storyId, entry]));
  for (const story of draft.stories) {
    if (!status.has(story.id)) throw new Error(`Story ${story.id} has no storyStatus entry.`);
  }
  for (const entry of value.storyStatus) {
    if (!draft.stories.some((story) => story.id === entry.storyId)) throw new Error(`storyStatus names unknown story '${entry.storyId}'.`);
  }
  const epicOfStory = new Map<string, string>();
  for (const epic of draft.epics) for (const storyId of epic.storyIds) epicOfStory.set(storyId, epic.id);
  for (const sprint of value.plan.sprints) {
    for (const epicId of sprint.epicIds) {
      if (!draft.epics.some((epic) => epic.id === epicId)) throw new Error(`Sprint ${sprint.id} names unknown epic '${epicId}'.`);
    }
  }

  const id = (table: BacklogTable, sourceId: string): string => backlogSysId(draftId, table, sourceId);
  const records: BacklogRecord[] = [];
  const { product, team } = value.plan;
  const productId = product ? id("cmdb_application_product_model", "product") : undefined;
  const teamId = team ? id("sys_user_group", "team") : undefined;
  const ownership = (fields: Record<string, string>, withProduct: boolean): Record<string, string> => ({
    ...fields,
    ...(withProduct && productId ? { product: productId } : {}),
    ...(teamId ? { assignment_group: teamId } : {}),
  });

  if (product) {
    records.push({
      table: "cmdb_application_product_model",
      sysId: productId!,
      source: { kind: "product", id: "product" },
      fields: { name: product.name, short_description: product.description },
    });
  }
  if (team) {
    records.push({
      table: "sys_user_group",
      sysId: teamId!,
      source: { kind: "team", id: "team" },
      fields: { name: team.name, type: team.typeSysIds.join(","), active: "true", description: team.description },
    });
    for (const member of team.members) {
      records.push({
        table: "sys_user_grmember",
        sysId: id("sys_user_grmember", `team:${member.userName}`),
        source: { kind: "team_member", id: member.userName },
        fields: { group: teamId!, user: member.sysId },
      });
    }
  }

  for (const release of value.plan.releases) {
    records.push({
      table: "rm_release_scrum",
      sysId: id("rm_release_scrum", release.id),
      source: { kind: "release", id: release.id },
      fields: { short_description: release.name, start_date: release.startDate, end_date: release.endDate, state: release.state },
    });
  }
  const sprintOfEpic = new Map<string, (typeof value.plan.sprints)[number]>();
  for (const sprint of value.plan.sprints) {
    for (const epicId of sprint.epicIds) sprintOfEpic.set(epicId, sprint);
    records.push({
      table: "rm_sprint",
      sysId: id("rm_sprint", sprint.id),
      source: { kind: "sprint", id: sprint.id },
      fields: ownership({
        short_description: sprint.name,
        release: id("rm_release_scrum", sprint.releaseId),
        start_date: sprint.startDate,
        end_date: sprint.endDate,
        state: sprint.state,
      }, false),
    });
  }

  for (const epic of draft.epics) {
    const states = epic.storyIds.map((storyId) => status.get(storyId)!.state);
    const derived = states.every((state) => state === "3") ? "3" : states.some((state) => ACTIVE_STORY_STATES.has(state)) ? "2" : "1";
    const override = value.plan.epicStateOverrides.find((entry) => entry.epicId === epic.id);
    records.push({
      table: "rm_epic",
      sysId: id("rm_epic", epic.id),
      source: { kind: "epic", id: epic.id },
      fields: ownership({
        short_description: shortDescription(epic.id, epic.title),
        description: `${epic.objective}\n\nStories: ${epic.storyIds.join(", ")}\nSource: ${draftId} ${epic.id}`,
        state: override?.state ?? derived,
      }, true),
    });
  }

  for (const story of draft.stories) {
    const entry = status.get(story.id)!;
    const epicId = epicOfStory.get(story.id)!;
    const sprint = ACTIVE_STORY_STATES.has(entry.state) ? sprintOfEpic.get(epicId) : undefined;
    const parts = [story.userStory, story.description].filter((part): part is string => Boolean(part));
    if (story.dependencyIds.length > 0) parts.push(`Depends on: ${story.dependencyIds.join(", ")}`);
    parts.push(`Source: ${draftId} ${story.id}`);
    const criteria = story.acceptanceCriteria
      .map((criterion) => `<li><b>${escapeHtml(criterion.id)}</b> ${escapeHtml(criterion.text)}</li>`)
      .join("");
    records.push({
      table: "rm_story",
      sysId: id("rm_story", story.id),
      source: { kind: "story", id: story.id },
      fields: ownership({
        short_description: shortDescription(story.id, story.title),
        description: parts.join("\n\n"),
        acceptance_criteria: criteria ? `<ul>${criteria}</ul>` : "",
        epic: id("rm_epic", epicId),
        sprint: sprint ? id("rm_sprint", sprint.id) : "",
        release: sprint ? id("rm_release_scrum", sprint.releaseId) : "",
        state: entry.state,
        classification: "Feature",
      }, true),
    });
  }
  const { numbering } = value.plan;
  if (numbering) {
    for (const table of BACKLOG_TABLES) {
      const prefix = BACKLOG_NUMBER_PREFIXES[table];
      if (!prefix) continue;
      records
        .filter((record) => record.table === table)
        .forEach((record, index) => {
          record.fields = { number: `${prefix}${String(numbering.start + index).padStart(7, "0")}`, ...record.fields };
        });
    }
  }
  return records;
}

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function renderBacklogXml(records: BacklogRecord[], unloadDate: string): string {
  const lines = ['<?xml version="1.0" encoding="UTF-8"?>', `<unload unload_date="${unloadDate}">`];
  for (const table of BACKLOG_TABLES) {
    for (const record of records.filter((entry) => entry.table === table)) {
      lines.push(`<${table} action="INSERT_OR_UPDATE">`);
      for (const field of BACKLOG_FIELDS[table]) {
        if (!(field in record.fields)) continue;
        const fieldValue = record.fields[field]!;
        lines.push(fieldValue === "" ? `<${field}/>` : `<${field}>${escapeXml(fieldValue)}</${field}>`);
      }
      lines.push(`<sys_class_name>${table}</sys_class_name>`);
      lines.push(`<sys_id>${record.sysId}</sys_id>`);
      lines.push(`</${table}>`);
    }
  }
  lines.push("</unload>", "");
  return lines.join("\n");
}

export interface BacklogImportFile {
  path: string;
  content: string;
  tables: BacklogTable[];
  recordCount: number;
}

// One mixed file by default; --split gives one file per table, imported in the order listed.
export function planImportFiles(value: BacklogPackage, records: BacklogRecord[], split: boolean): BacklogImportFile[] {
  const base = resolve(value.artifacts.json).replace(/\.json$/, "");
  const present = BACKLOG_TABLES.filter((table) => records.some((record) => record.table === table));
  if (!split) {
    return [{ path: `${base}.xml`, content: renderBacklogXml(records, value.unloadDate), tables: present, recordCount: records.length }];
  }
  return present.map((table, index) => {
    const subset = records.filter((record) => record.table === table);
    return {
      path: `${base}-${index + 1}-${table}.xml`,
      content: renderBacklogXml(subset, value.unloadDate),
      tables: [table],
      recordCount: subset.length,
    };
  });
}

export function readStoryDraft(path: string): { draft: StoryDraftPackage; sha256: string } {
  const raw = readFileSync(resolve(path));
  return { draft: storyDraftPackageSchema.parse(JSON.parse(raw.toString("utf8"))), sha256: sha256Hex(raw) };
}

export function buildBacklogPackageFile(jsonPath: string, options: { split?: boolean } = {}): BacklogPackage {
  const path = resolve(jsonPath);
  const parsed = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  delete parsed.records;
  delete parsed.importFiles;
  // Precheck and verification name records by sys_id; hold them back until the records exist again.
  const { precheck, verification } = parsed;
  delete parsed.precheck;
  delete parsed.verification;
  const value = backlogPackageSchema.parse(parsed);
  const { draft, sha256 } = readStoryDraft(value.storyDraft.path);
  if (draft.packageId !== value.storyDraft.packageId) {
    throw new Error(`Story draft packageId is '${draft.packageId}', not '${value.storyDraft.packageId}'.`);
  }
  if (sha256 !== value.storyDraft.sha256) throw new Error("Story draft sha256 does not match the file; re-read it before building.");
  const records = buildBacklogRecords(value, draft);
  const files = planImportFiles(value, records, Boolean(options.split));
  for (const file of files) writeFileSync(file.path, file.content);
  const result = backlogPackageSchema.parse({
    ...parsed,
    records,
    importFiles: files.map((file) => ({ path: file.path, sha256: sha256Hex(file.content), tables: file.tables, recordCount: file.recordCount })),
    ...(precheck === undefined ? {} : { precheck }),
    ...(verification === undefined ? {} : { verification }),
  });
  writeFileSync(`${path}.tmp`, `${JSON.stringify(result, null, 2)}\n`);
  renameSync(`${path}.tmp`, path);
  return result;
}

if (isDirectExecution(import.meta.url, process.argv[1])) {
  const args = process.argv.slice(2);
  const jsonPath = args.find((arg) => !arg.startsWith("--"));
  try {
    if (!jsonPath) throw new Error("Usage: npm run backlog:build -- <backlog-vNNN.json> [--split]");
    const result = buildBacklogPackageFile(jsonPath, { split: args.includes("--split") });
    const counts = BACKLOG_TABLES.map((table) => `${table}=${result.records.filter((record) => record.table === table).length}`).join(" ");
    process.stdout.write(`Built ${result.records.length} records (${counts}) into ${result.importFiles.map((file) => file.path).join(", ")}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
