import { readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import {
  BACKLOG_TABLES,
  CODE_REVIEW_SEVERITIES,
  backlogPackageSchema,
  codeImplementationPackageSchema,
  codeReviewPackageSchema,
  updateSetDeltaPackageSchema,
  userGuidePackageSchema,
  type BacklogPackage,
  type CodeImplementationPackage,
  type CodeReviewPackage,
  type UpdateSetDeltaPackage,
  type UserGuidePackage,
} from "./assisted-contracts.js";
import { isDirectExecution } from "./direct-execution.js";

// Agents write only the JSON package; the HTML a human reads is rendered from it, so the two
// cannot disagree and agents spend no turns hand-building markup.

function escape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function table(headers: string[], rows: string[][]): string {
  if (rows.length === 0) return "<p>None.</p>";
  const head = headers.map((header) => `<th>${escape(header)}</th>`).join("");
  const body = rows.map((row) => `<tr>${row.map((cell) => `<td>${escape(cell)}</td>`).join("")}</tr>`).join("\n");
  return `<table><thead><tr>${head}</tr></thead><tbody>\n${body}\n</tbody></table>`;
}

function code(value: string): string {
  return `<pre><code>${escape(value)}</code></pre>`;
}

function list(items: string[]): string {
  return items.length === 0 ? "<p>None.</p>" : `<ul>${items.map((item) => `<li>${escape(item)}</li>`).join("")}</ul>`;
}

function page(title: string, sections: string[]): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>${escape(title)}</title>
<style>body{font-family:Segoe UI,Arial,sans-serif;max-width:1200px;margin:2rem auto;padding:0 1rem;color:#1f2328}table{border-collapse:collapse;width:100%;margin:.5rem 0}th,td{border:1px solid #d0d7de;padding:.35rem .5rem;text-align:left;vertical-align:top}th{background:#f6f8fa}pre{background:#f6f8fa;padding:.5rem;overflow-x:auto;white-space:pre-wrap}.item{border-left:4px solid #d0d7de;padding:.25rem .75rem;margin:.75rem 0}.pair{display:grid;grid-template-columns:1fr 1fr;gap:.75rem}</style>
</head><body>
<h1>${escape(title)}</h1>
${sections.join("\n")}
</body></html>
`;
}

const ids = (refs: Array<{ id: string }>) => refs.map((ref) => ref.id).join(", ");

function workOrderSection(value: CodeImplementationPackage): string {
  const { workOrder: order } = value;
  const location = [order.appLocation.kind, order.appLocation.path, order.appLocation.repoUrl, order.appLocation.instanceAlias]
    .filter(Boolean)
    .join(" · ");
  return `<h2>Work Order</h2>
${table(
  ["Item", "Value"],
  [
    ["Application", `${order.target.application} (${order.target.scope}) on ${order.target.instanceAlias}`],
    ["App form", order.appForm],
    ["Location", location],
    ["Output form", value.outputForm],
    ["Mode", value.mode],
    ["What's changing", `${order.changeSource.kind}: ${order.changeSource.description}`],
    ["Run scope", order.runScope],
    ["Confirmed", order.confirmedAt],
  ],
)}
<h3>Known differences</h3>
${table(
  ["ID", "Kind", "Covers", "Records", "Reason"],
  order.knownDifferences.map((known) => [
    known.id,
    known.kind,
    known.table ?? `commits since ${known.sinceCommit}`,
    known.records,
    known.reason,
  ]),
)}`;
}

function currentStateSection(value: CodeImplementationPackage): string {
  const { currentState: state } = value;
  return `<h2>Current State</h2>
<p>Method: ${state.method} · Parity: ${state.parity}</p>
${table(
  ["Table", "Record", "Status", "Known difference", "Detail"],
  state.checks.map((check) => [check.table, check.name, check.status, check.knownDifference ?? "", check.detail]),
)}`;
}

function coverageSection(value: CodeImplementationPackage): string {
  if (value.mode === "fix") {
    return `<h2>Fix Results</h2>\n${table(
      ["Finding", "Outcome", "Detail"],
      value.fixResults.map((result) => [result.findingId, result.outcome, result.detail]),
    )}`;
  }
  if (value.workOrder.changeSource.kind !== "stories") return "";
  return `<h2>Story Coverage</h2>\n${table(
    ["Story", "Status", "Note"],
    value.storyCoverage.map((entry) => [entry.storyId, entry.status, entry.note]),
  )}`;
}

function limitationsSection(observations: Array<{ text: string }>, extras: string[] = []): string {
  return `<h2>Limitations</h2>\n${list([...observations.map((entry) => entry.text), ...extras])}`;
}

function fluentSections(value: CodeImplementationPackage): string[] {
  const inputs = Object.entries(value.inputs)
    .filter(([, reference]) => reference)
    .map(([name, reference]) => [name, reference!.path]);
  const changes = value.changes
    .map(
      (change, index) => `<!-- change:${index + 1} -->
<div class="item"><h3>${index + 1}. ${escape(basename(change.path))}</h3>
<p>Action: ${change.action} · Implements: ${escape(ids(change.implements))}</p>
<p>${escape(change.summary)}</p><p><small>${escape(change.path)}</small></p></div>`,
    )
    .join("\n");
  const build = value.build!;
  return [
    `<h2>Inputs and Scope</h2>
<p>Project: ${escape(value.project!.root)} (${escape(value.project!.scope)})${value.project!.created ? " — created by this run" : ""}</p>
${table(["Input", "Path"], inputs)}
${value.requestedStoryIds.length > 0 ? `<p>Requested stories: ${escape(value.requestedStoryIds.join(", "))}</p>` : ""}`,
    `<h2>Changes</h2>\n${changes || "<p>No files changed.</p>"}`,
    coverageSection(value),
    `<h2>Build</h2>
<p>${escape(build.command)}: ${build.status} · ${build.errorCount} error(s) · ${build.warningCount} warning(s)</p>
${build.excerpt ? code(build.excerpt) : ""}`,
  ];
}

function scriptSections(value: CodeImplementationPackage): string[] {
  const deliverables = value.deliverables
    .map(
      (deliverable) => `<!-- deliverable:${deliverable.id} -->
<div class="item"><h3>${escape(deliverable.id)} — ${escape(deliverable.title)}</h3>
<p>Kind: ${deliverable.kind}${deliverable.path ? ` · File: ${escape(basename(deliverable.path))}` : ""}${
        deliverable.order !== undefined ? ` · Run order: ${deliverable.order}` : ""
      }${deliverable.applicationScope ? ` · Scope: ${escape(deliverable.applicationScope)}` : ""}${
        deliverable.rollbackFor ? ` · Undoes: ${escape(deliverable.rollbackFor)}` : ""
      }</p>
<p>Implements: ${escape(ids(deliverable.implements)) || "—"}</p>
${deliverable.targets.length > 0 ? table(["Table", "Record", "Field"], deliverable.targets.map((target) => [target.table, target.name, target.field ?? ""])) : ""}
${deliverable.updateSetGuidance ? `<p>Update set: ${escape(deliverable.updateSetGuidance)}</p>` : ""}</div>`,
    )
    .join("\n");
  const scripts = value.deliverables
    .filter((deliverable) => deliverable.kind !== "readme")
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const steps = scripts
    .map(
      (script) =>
        `<li>${escape(basename(script.path!))} — scope ${escape(script.applicationScope ?? "")}${
          script.kind === "rollback_script" ? ` (undo for ${escape(script.rollbackFor ?? "")}; run only to back out)` : ""
        }${script.updateSetGuidance ? `; ${escape(script.updateSetGuidance)}` : ""}</li>`,
    )
    .join("");
  const where = value.outputForm === "fix_script" ? "a Fix Script record (System Definition > Fix Scripts, Record for rollback checked)" : "Scripts - Background";
  return [
    `<h2>Deliverables</h2>\n${deliverables}`,
    `<h2>How to Apply</h2>
<p>Select the named application scope and update set, paste each script into ${where}, run it with DRY_RUN = true, read the log, then set DRY_RUN = false and run it again. Keep the undo scripts.</p>
<ol>${steps}</ol>`,
    coverageSection(value),
  ];
}

function pasteSections(value: CodeImplementationPackage): string[] {
  const items = value.deliverables
    .filter((deliverable) => deliverable.kind === "paste_instructions")
    .map((deliverable) => {
      const paste = deliverable.paste!;
      const fields = paste.fields
        .map(
          (field) => `<h4>${escape(field.field)}</h4>
<div class="pair"><div><p>Current</p>${code(field.currentValue ?? "(empty)")}</div><div><p>New</p>${code(field.newValue)}</div></div>`,
        )
        .join("\n");
      return `<!-- paste:${deliverable.id} -->
<div class="item"><h3>${escape(deliverable.id)} — ${escape(deliverable.title)}</h3>
<p>Scope: ${escape(deliverable.applicationScope ?? "")}${deliverable.updateSetGuidance ? ` · Update set: ${escape(deliverable.updateSetGuidance)}` : ""}</p>
<p>Go to: ${escape(paste.navigation)} · Open: ${escape(paste.record)}</p>
${table(["Table", "Record", "Field"], deliverable.targets.map((target) => [target.table, target.name, target.field ?? ""]))}
<p>Implements: ${escape(ids(deliverable.implements))}</p>
${fields}</div>`;
    })
    .join("\n");
  return [`<h2>Paste Instructions</h2>\n${items}`, coverageSection(value)];
}

export function renderCodeImplementationHtml(value: CodeImplementationPackage): string {
  const sections = [`<h2>Summary</h2>\n<p>${escape(value.summary)}</p><p>Run status: ${value.runStatus}</p>`, workOrderSection(value), currentStateSection(value)];
  if (value.runStatus === "stopped") {
    sections.push(`<h2>Questions</h2>\n<ol>${value.questions.map((question) => `<li>${escape(question)}</li>`).join("")}</ol>`);
  } else if (value.outputForm === "fluent") {
    sections.push(...fluentSections(value));
  } else if (value.outputForm === "copy_paste") {
    sections.push(...pasteSections(value));
  } else {
    sections.push(...scriptSections(value));
  }
  if (value.instanceChecks.length > 0) {
    sections.push(`<h3>Instance queries</h3>\n${table(["Query", "Result"], value.instanceChecks.map((check) => [check.query, check.result]))}`);
  }
  sections.push(limitationsSection([...value.limitations, ...value.assumptions], value.warnings));
  return page(value.title, sections.filter(Boolean));
}

export function renderCodeReviewHtml(value: CodeReviewPackage): string {
  const counts = CODE_REVIEW_SEVERITIES.map((severity) => `${severity} ${value.findings.filter((finding) => finding.severity === severity).length}`);
  const findings = CODE_REVIEW_SEVERITIES.flatMap((severity) => value.findings.filter((finding) => finding.severity === severity))
    .map((finding) => {
      const { location } = finding;
      const lines = location.startLine === location.endLine ? `${location.startLine}` : `${location.startLine}-${location.endLine}`;
      const record = location.recordName ? ` · ${escape(location.recordTable ?? "")} ${escape(location.recordName)}` : "";
      const check = finding.instanceVerification;
      return `<!-- finding:${finding.id} -->
<div class="item"><h3>${escape(finding.id)} — ${escape(finding.title)}</h3>
<p>Severity: ${finding.severity} · Category: ${finding.category} · Confidence: ${finding.confidence}</p>
<p>Location: ${escape(basename(location.path))}:${lines}${record}</p>
<div class="pair"><div><p>Current</p>${code(finding.currentCode)}</div><div><p>Suggested</p>${
        finding.suggestedCode === null ? "<p>No code change proposed.</p>" : code(finding.suggestedCode)
      }</div></div>
<p>${escape(finding.rationale)}</p>
<p>Practice: ${escape(finding.practiceReference)}</p>
<p>Instance check: ${check.status}${check.query ? ` — ${escape(check.query)}` : ""}${check.result ? ` → ${escape(check.result)}` : ""}</p>
<p>Decision: ${finding.decision.status}${finding.decision.note ? ` — ${escape(finding.decision.note)}` : ""}</p></div>`;
    })
    .join("\n");
  const prior = value.priorReview
    ? `<h3>Prior review ${escape(value.priorReview.packageId)}</h3>\n${table(
        ["Finding", "Resolution", "Note"],
        value.priorReview.resolutions.map((entry) => [entry.findingId, entry.status, entry.note]),
      )}`
    : "";
  const checks = value.findings
    .filter((finding) => finding.instanceVerification.query)
    .map((finding) => [finding.id, finding.instanceVerification.status, finding.instanceVerification.query!, finding.instanceVerification.result ?? ""]);
  return page(value.title, [
    `<h2>Summary</h2>
<p>${escape(value.summary)}</p>
<p>Findings by severity: ${counts.join(" · ")}. Decisions are recorded afterwards with the human.</p>
${value.implementation ? `<p>Reviews implementation ${escape(value.implementation.packageId)}.</p>` : ""}
${prior}`,
    `<h2>Scope and Sources</h2>
${table(
  ["Source", "File", "Kind", "Lines", "Records"],
  value.reviewedSources.map((source) => [
    source.id,
    basename(source.path),
    source.kind,
    `${source.lineCount}`,
    source.records.map((record) => `${record.table}${record.name ? ` ${record.name}` : ""}`).join("; "),
  ]),
)}`,
    `<h2>Findings</h2>\n${findings || "<p>No findings.</p>"}`,
    `<h2>Instance Checks</h2>\n${table(["Finding", "Status", "Query", "Result"], checks)}`,
    limitationsSection([...value.limitations, ...value.assumptions], value.warnings),
  ]);
}

export function renderBacklogHtml(value: BacklogPackage): string {
  const STATE_LABELS: Record<string, string> = {
    "-6": "Draft", "1": "Ready", "2": "Work in progress", "-7": "Ready for testing", "-8": "Testing", "3": "Complete", "4": "Cancelled",
  };
  const label = (state: string | undefined): string => STATE_LABELS[state ?? ""] ?? state ?? "";
  const bySysId = new Map(value.records.map((record) => [record.sysId, record]));
  const name = (sysId: string | undefined): string => (sysId ? bySysId.get(sysId)?.fields.short_description ?? sysId : "");
  const storyRecord = new Map(value.records.filter((record) => record.table === "rm_story").map((record) => [record.source.id, record]));
  const counts = BACKLOG_TABLES.map(
    (tableName) => [tableName, String(value.records.filter((record) => record.table === tableName).length)],
  ).filter(([, count]) => count !== "0");
  const verification = new Map(value.verification.map((entry) => [entry.sysId, entry]));
  return page(value.title, [
    `<h2>Summary</h2>\n<p>${escape(value.summary)}</p>\n<p>Modes: ${escape(value.modes.join(", "))}. Target: ${escape(value.target.application)} on ${escape(value.target.instanceAlias)}.</p>`,
    `<h2>Inputs</h2>\n${table(["Input", "Package", "Path"], [
      ["Story draft", value.storyDraft.packageId, value.storyDraft.path],
      ...value.progressSources.map((source) => [source.note, source.packageId, source.path]),
    ])}`,
    `<h2>Plan</h2>\n<h3>Releases</h3>\n${table(["Release", "Start", "End", "State"], value.plan.releases.map((release) => [release.name, release.startDate, release.endDate, label(release.state)]))}
<h3>Sprints</h3>\n${table(["Sprint", "Release", "Epics", "Start", "End", "State"], value.plan.sprints.map((sprint) => [
      sprint.name, value.plan.releases.find((release) => release.id === sprint.releaseId)?.name ?? sprint.releaseId, sprint.epicIds.join(", "), sprint.startDate, sprint.endDate, label(sprint.state),
    ]))}${value.plan.epicStateOverrides.length > 0 ? `\n<h3>Epic state overrides</h3>\n${table(["Epic", "State", "Reason"], value.plan.epicStateOverrides.map((entry) => [entry.epicId, label(entry.state), entry.reason]))}` : ""}`,
    `<h2>Story Status</h2>\n${table(["Story", "State", "Basis", "Sprint", "Evidence", "Note"], value.storyStatus.map((status) => {
      const record = storyRecord.get(status.storyId);
      return [
        record?.fields.short_description ?? status.storyId,
        label(status.state),
        status.basis.replace(/_/g, " "),
        name(record?.fields.sprint),
        status.evidence.map((evidence) => evidence.packageId).join(", "),
        status.note ?? "",
      ];
    }))}`,
    `<h2>Records</h2>\n${table(["Table", "Records"], counts)}\n${table(["Table", "Record", "State", "sys_id"], value.records.filter((record) => record.table !== "rm_story").map((record) => [
      record.table, record.fields.short_description ?? "", label(record.fields.state), record.sysId,
    ]))}`,
    `<h2>Import Steps</h2>\n${table(["File", "Tables", "Records", "sha256"], value.importFiles.map((file) => [file.path, file.tables.join(", "), String(file.recordCount), file.sha256]))}
<ol><li>Sign in to ${escape(value.target.instanceAlias)} as an admin in your normal browser.</li><li>Open the list of the first table in the file (for example <code>rm_story.list</code>), right-click any column heading and choose <b>Import XML</b>.</li><li>Choose the file above and click <b>Upload</b>. The import creates or updates every record in the file; importing the same file again changes nothing.</li><li>Tell the backlog agent the import is done so it can verify the records read-only.</li></ol>`,
    `<h2>Verification</h2>\n${value.modes.includes("verify") ? table(["Record", "Status", "Fields", "Note"], value.records.map((record) => {
      const entry = verification.get(record.sysId);
      return [`${record.source.kind} ${record.source.id}`, entry?.status ?? "not verified", entry?.fields.join(", ") ?? "", entry?.note ?? ""];
    })) : "<p>Not verified yet: run verify mode after the import.</p>"}`,
    `<h2>Questions</h2>\n${list(value.questions.map((question) => `${question.id}: ${question.text}`))}`,
    limitationsSection(value.limitations, [...value.assumptions.map((entry) => `Assumption ${entry.id}: ${entry.text}`), ...value.warnings]),
  ]);
}

export function renderUserGuideHtml(value: UserGuidePackage): string {
  const ordered = [...value.parts].sort((a, b) => (a.audience === "end_user" ? -1 : 1) - (b.audience === "end_user" ? -1 : 1));
  const toc = ordered
    .map((part, index) => `<li><a href="#part-${index + 1}">${escape(part.title)}</a><ol>${part.sections
      .map((section) => `<li><a href="#${escape(section.id)}">${escape(section.title)}</a></li>`)
      .join("")}</ol></li>`)
    .join("");
  const section = (entry: UserGuidePackage["parts"][number]["sections"][number]): string => {
    const steps = entry.steps.length === 0 ? "" : `<ol class="steps">${entry.steps
      .map((step) => `<li>${escape(step.text)}${step.screenshot
        ? `<div class="shot"><b>Screenshot ${escape(step.screenshot.id)}</b> — ${escape(step.screenshot.caption)}</div>`
        : ""}</li>`)
      .join("")}</ol>`;
    const notes = entry.notes.length === 0 ? "" : `<div class="note">${entry.notes.map((note) => `<p>${escape(note)}</p>`).join("")}</div>`;
    return `<section id="${escape(entry.id)}"><h3>${escape(entry.title)}</h3><p>${escape(entry.intro)}</p>${steps}${notes}</section>`;
  };
  const parts = ordered
    .map((part, index) => `<h2 id="part-${index + 1}">Part ${index + 1}: ${escape(part.title)}</h2>\n${part.sections.map(section).join("\n")}`)
    .join("\n");
  const diagrams = value.diagrams.length === 0 ? "" : `<h2>How it works</h2>\n${value.diagrams
    .map((diagram) => `<h3>${escape(diagram.title)}</h3><div class="diagram"><pre class="mermaid">${escape(diagram.mermaid)}</pre></div>`)
    .join("\n")}`;
  const limitations = `<h2>Known limitations</h2>\n${list(value.knownLimitations.map((entry) => entry.text))}`;
  const about = `<h2>About this guide</h2>\n<p>${escape(value.summary)}</p>\n${table(["Source", "Package", "Path"], value.sources.map((source) => [
    source.kind.replace(/_/g, " "), source.packageId ?? "", source.path,
  ]))}\n<p>Every button, menu item, field and setting named in this guide was checked on ${escape(value.target.instanceAlias)} (${value.instanceChecks.length} read-only checks). Screenshot boxes mark where a screenshot belongs.</p>`;
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>${escape(value.title)}</title>
<style>body{font-family:Segoe UI,Arial,sans-serif;max-width:980px;margin:2rem auto;padding:0 1.25rem;color:#1f2328;line-height:1.55}h1{font-size:2rem;margin-bottom:.2rem}h2{border-bottom:1px solid #d0d7de;padding-bottom:.3rem;margin-top:2.2rem}h3{margin-top:1.6rem}.meta{color:#57606a}nav{background:#f6f8fa;border:1px solid #d0d7de;border-radius:6px;padding:.5rem 1.25rem}nav ol{margin:.25rem 0}.steps li{margin:.35rem 0}.shot{border:2px dashed #9aa5b1;border-radius:6px;background:#fafbfc;color:#57606a;padding:1.4rem .75rem;margin:.5rem 0;text-align:center;font-size:.9rem}.note{background:#fff8e6;border-left:4px solid #d4a72c;padding:.4rem .8rem;margin:.6rem 0}.diagram{border:1px solid #d0d7de;border-radius:6px;padding:.75rem;overflow:auto}pre.mermaid{text-align:center}table{border-collapse:collapse;width:100%;font-size:.9rem}th,td{border:1px solid #d0d7de;padding:.3rem .5rem;text-align:left}th{background:#f6f8fa}</style>
<script type="module">import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs'; mermaid.initialize({ startOnLoad: true, securityLevel: 'strict', theme: 'neutral' });</script>
</head><body>
<h1>${escape(value.title)}</h1>
<p class="meta">${escape(value.target.application)} · version ${escape(value.target.version)} · ${escape(value.target.instanceAlias)}</p>
<nav><b>Contents</b><ol>${toc}<li><a href="#limits">Known limitations</a></li></ol></nav>
${diagrams}
${parts}
<div id="limits">${limitations}</div>
${about}
</body></html>
`;
}

export function renderUpdateSetDeltaHtml(value: UpdateSetDeltaPackage): string {
  const checks = new Map(value.precheck.map((check) => [check.name, check]));
  const verified = new Map(value.verification.map((check) => [check.name, check]));
  const count = (change: string): number => value.entries.filter((entry) => entry.change === change).length;
  return page(value.title, [
    `<h2>Summary</h2>\n<p>${escape(value.summary)}</p>\n${table(["", ""], [
      ["Application", `${value.target.application} (${value.target.scope})`],
      ["From", `${value.from.version} · ${value.from.ref} · ${value.from.commit.slice(0, 10)}`],
      ["To", `${value.to.version} · ${value.to.ref} · ${value.to.commit.slice(0, 10)}`],
      ["Update set", value.updateSet.name],
      ["Entries", `${value.entries.length} (added ${count("added")}, changed ${count("changed")}, deleted ${count("deleted")})`],
      ["Target instance", value.target.instanceAlias],
    ])}`,
    `<h2>Entries</h2>\n${table(["Change", "Record", "Table", "Fields changed", "Precheck", "After import"], value.entries.map((entry) => [
      entry.change, entry.name, entry.table, entry.fieldsChanged.join(", "),
      checks.get(entry.name)?.status.replace(/_/g, " ") ?? "not run",
      verified.get(entry.name)?.status.replace(/_/g, " ") ?? "",
    ]))}`,
    `<h2>Precheck</h2>\n<p>Before import, every record in the delta was read from ${escape(value.target.instanceAlias)} to confirm it is at the baseline version and that nobody changed it in the instance since.</p>\n${table(["Record", "Status", "Fields", "Changed by", "Changed on", "Owner approval"], value.precheck
      .filter((check) => check.status !== "absent" && check.status !== "matches_baseline")
      .map((check) => [check.name, check.status.replace(/_/g, " "), check.fields.join(", "), check.changedBy ?? "", check.changedOn ?? "", check.approvedOverwrite ?? ""]))}`,
    `<h2>Import Steps</h2>\n<p>File: <code>${escape(value.updateSet.path)}</code> (sha256 ${escape(value.updateSet.sha256.slice(0, 16))}…)</p>
<ol><li>On the target instance, open <b>System Update Sets → Retrieved Update Sets</b> and choose <b>Import Update Set from XML</b>.</li><li>Upload the file. "${escape(value.updateSet.name)}" appears as Loaded.</li><li>Open it and click <b>Preview Update Set</b>. Resolve any collision the preview reports with the developer who made it before going on.</li><li>Click <b>Commit Update Set</b>, then ask for the post-import verification.</li></ol>`,
    `<h2>Warnings</h2>\n${list(value.warnings)}`,
    `<h2>Questions</h2>\n${list(value.questions.map((question) => `${question.id}: ${question.text}`))}`,
    limitationsSection(value.limitations),
  ]);
}

export function renderReportFile(jsonPath: string): string {
  const raw = JSON.parse(readFileSync(resolve(jsonPath), "utf8")) as { packageType?: string };
  if (raw.packageType === "update_set_delta") {
    const value = updateSetDeltaPackageSchema.parse(raw);
    writeFileSync(value.artifacts.html, renderUpdateSetDeltaHtml(value));
    return value.artifacts.html;
  }
  if (raw.packageType === "user_guide") {
    const value = userGuidePackageSchema.parse(raw);
    writeFileSync(value.artifacts.html, renderUserGuideHtml(value));
    return value.artifacts.html;
  }
  if (raw.packageType === "backlog") {
    const value = backlogPackageSchema.parse(raw);
    writeFileSync(value.artifacts.html, renderBacklogHtml(value));
    return value.artifacts.html;
  }
  if (raw.packageType === "code_implementation") {
    const value = codeImplementationPackageSchema.parse(raw);
    writeFileSync(value.artifacts.html, renderCodeImplementationHtml(value));
    return value.artifacts.html;
  }
  if (raw.packageType === "code_review") {
    const value = codeReviewPackageSchema.parse(raw);
    writeFileSync(value.artifacts.html, renderCodeReviewHtml(value));
    return value.artifacts.html;
  }
  throw new Error(`No renderer for package type '${raw.packageType}'.`);
}

if (isDirectExecution(import.meta.url, process.argv[1])) {
  const path = process.argv[2];
  try {
    if (!path) throw new Error("Usage: npm run report:render -- <code-implementation-vNNN.json | code-review-vNNN.json | backlog-vNNN.json | user-guide-vNNN.json | update-set-delta-vNNN.json>");
    process.stdout.write(`Rendered ${renderReportFile(path)}\n`);
  } catch (error) {
    process.stderr.write(`Cannot render report: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
