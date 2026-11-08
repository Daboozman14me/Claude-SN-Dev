import { readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import {
  CODE_REVIEW_SEVERITIES,
  codeImplementationPackageSchema,
  codeReviewPackageSchema,
  type CodeImplementationPackage,
  type CodeReviewPackage,
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

export function renderReportFile(jsonPath: string): string {
  const raw = JSON.parse(readFileSync(resolve(jsonPath), "utf8")) as { packageType?: string };
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
    if (!path) throw new Error("Usage: npm run report:render -- <code-implementation-vNNN.json | code-review-vNNN.json>");
    process.stdout.write(`Rendered ${renderReportFile(path)}\n`);
  } catch (error) {
    process.stderr.write(`Cannot render report: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
