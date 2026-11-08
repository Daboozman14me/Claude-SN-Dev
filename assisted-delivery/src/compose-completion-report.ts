import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import {
  ASSISTED_CONTRACT_VERSION,
  CODE_REVIEW_SEVERITIES,
  codeImplementationPackageSchema,
  completionReportPackageSchema,
  type CodeImplementationPackage,
  type CodeReviewPackage,
  type CompletionReportPackage,
} from "./assisted-contracts.js";
import { isDirectExecution } from "./direct-execution.js";
import { fileSha256, readCodeReviewPackage } from "./validate-assisted-code-review.js";

const SCRIPT_KINDS = new Set(["background_script", "fix_script", "rollback_script"]);

function samePath(a: string, b: string): boolean {
  return resolve(a).toLocaleLowerCase() === resolve(b).toLocaleLowerCase();
}

function readImplementation(path: string): CodeImplementationPackage {
  return codeImplementationPackageSchema.parse(JSON.parse(readFileSync(resolve(path), "utf8")) as unknown);
}

// The files whose final content the review must have seen, with the hash it must have seen.
function requiredSources(implementation: CodeImplementationPackage): Array<{ path: string; sha256: string }> {
  if (implementation.outputForm === "fluent") {
    return implementation.changes
      .filter((change) => change.action !== "deleted")
      .map((change) => ({ path: change.path, sha256: change.sha256After! }));
  }
  if (implementation.outputForm === "copy_paste") {
    return [{ path: implementation.artifacts.html, sha256: fileSha256(implementation.artifacts.html) }];
  }
  return implementation.deliverables
    .filter((deliverable) => SCRIPT_KINDS.has(deliverable.kind))
    .map((deliverable) => ({ path: deliverable.path!, sha256: deliverable.sha256! }));
}

function checkReviewCoversWork(implementationPath: string, implementation: CodeImplementationPackage, review: CodeReviewPackage): void {
  if (implementation.runStatus !== "completed") {
    throw new Error("A stopped implementation run has no work to review; its questions go to the human instead.");
  }
  if (!review.implementation || !samePath(review.implementation.jsonPath, implementationPath)) {
    throw new Error("The review does not identify this implementation package in 'implementation.jsonPath'.");
  }
  for (const required of requiredSources(implementation)) {
    const source = review.reviewedSources.find((entry) => samePath(entry.path, required.path));
    if (!source) throw new Error(`The review did not cover '${required.path}'.`);
    if (source.sha256 !== required.sha256) {
      throw new Error(`The review saw a different version of '${required.path}' than the implementation produced.`);
    }
  }
  if (implementation.mode === "fix") {
    const prior = review.priorReview;
    if (!prior || !samePath(prior.jsonPath, implementation.inputs.codeReview!.path)) {
      throw new Error("A fix run's review must be a re-review of the code review the fixes came from.");
    }
    for (const result of implementation.fixResults.filter((entry) => entry.outcome === "applied")) {
      if (!prior.resolutions.some((resolution) => resolution.findingId === result.findingId)) {
        throw new Error(`The re-review records no resolution for applied finding '${result.findingId}'.`);
      }
    }
  }
}

function workItems(implementation: CodeImplementationPackage): CompletionReportPackage["work"] {
  const ids = (refs: Array<{ id: string }>) => refs.map((ref) => ref.id);
  if (implementation.outputForm === "fluent") {
    const root = implementation.project!.root;
    return implementation.changes.map((change) => ({
      ref: relative(root, change.path),
      kind: change.action,
      detail: change.summary,
      implements: ids(change.implements),
    }));
  }
  return implementation.deliverables.map((deliverable) => ({
    ref: deliverable.path ? basename(deliverable.path) : deliverable.id,
    kind: deliverable.kind,
    detail: [
      `${deliverable.id}: ${deliverable.title}`,
      deliverable.order !== undefined ? `run order ${deliverable.order}` : "",
      deliverable.applicationScope ? `scope ${deliverable.applicationScope}` : "",
    ]
      .filter(Boolean)
      .join(" · "),
    implements: ids(deliverable.implements),
  }));
}

function findingLocation(finding: CodeReviewPackage["findings"][number]): string {
  const { location } = finding;
  const lines = location.startLine === location.endLine ? `${location.startLine}` : `${location.startLine}-${location.endLine}`;
  const record = location.recordName ? ` (${location.recordTable ? `${location.recordTable} ` : ""}${location.recordName})` : "";
  return `${basename(location.path)}:${lines}${record}`;
}

function nextSteps(implementation: CodeImplementationPackage, review: CodeReviewPackage, reviewPath: string): string[] {
  const steps: string[] = [];
  if (review.findings.length > 0) {
    steps.push(
      `Decide each review finding (approve, reject, or defer) in ${reviewPath}; approved findings become the next fix run.`,
    );
  } else {
    steps.push("The reviewer found no problems in this work.");
  }
  const open = (review.priorReview?.resolutions ?? []).filter((entry) => entry.status === "unresolved" || entry.status === "regressed");
  if (open.length > 0) {
    steps.push(`Prior findings not resolved by this run: ${open.map((entry) => `${entry.findingId} (${entry.status})`).join(", ")}.`);
  }
  const target = `${implementation.workOrder.target.application} (${implementation.workOrder.target.scope}) on ${implementation.workOrder.target.instanceAlias}`;
  if (implementation.outputForm === "fluent") {
    steps.push(
      `Review the changes with git diff in ${implementation.project!.root}, then commit and push when satisfied. Deploying to ${target} is a separate, deliberate step.`,
    );
  } else if (implementation.outputForm === "copy_paste") {
    steps.push(`Apply the paste instructions in ${implementation.artifacts.html} on ${target}, inside the update set they name.`);
    steps.push("After applying, export that update set as XML and ask for a post-apply re-review against this review.");
  } else {
    steps.push(
      `Read each script and the README, then run them on ${target} in run order with DRY_RUN = true, check the log, and only then set DRY_RUN = false. Keep the undo scripts.`,
    );
    steps.push("After applying, export the update set as XML and ask for a post-apply re-review against this review.");
  }
  return steps;
}

export function composeCompletionReport(
  implementationPath: string,
  reviewPath: string,
  artifacts: { html: string; json: string },
  composedAt: string,
): CompletionReportPackage {
  const implementation = readImplementation(implementationPath);
  const { value: review } = readCodeReviewPackage(reviewPath);
  checkReviewCoversWork(implementationPath, implementation, review);

  const severityCounts = Object.fromEntries(CODE_REVIEW_SEVERITIES.map((severity) => [severity, 0])) as Record<
    (typeof CODE_REVIEW_SEVERITIES)[number],
    number
  >;
  for (const finding of review.findings) severityCounts[finding.severity] += 1;
  const resolutions = new Map((review.priorReview?.resolutions ?? []).map((entry) => [entry.findingId, entry]));
  const { target } = implementation.workOrder;
  const work = workItems(implementation);
  const findingSummary = CODE_REVIEW_SEVERITIES.filter((severity) => severityCounts[severity] > 0)
    .map((severity) => `${severityCounts[severity]} ${severity}`)
    .join(", ");

  return completionReportPackageSchema.parse({
    contractVersion: ASSISTED_CONTRACT_VERSION,
    packageType: "completion_report",
    packageId: `completion-${implementation.packageId}`,
    title: `Completion Report: ${target.application} — ${implementation.title.replace(/^Code Implementation:\s*/, "")}`,
    summary: `${implementation.mode === "fix" ? "Fix" : "Build"} run (${implementation.outputForm}) completed with ${work.length} ${
      implementation.outputForm === "fluent" ? "file change(s)" : "deliverable(s)"
    }. The review found ${review.findings.length === 0 ? "no problems" : `${review.findings.length} finding(s): ${findingSummary}`}.`,
    artifacts,
    composedAt,
    implementation: {
      packageId: implementation.packageId,
      jsonPath: resolve(implementationPath),
      sha256: fileSha256(implementationPath),
      mode: implementation.mode,
      outputForm: implementation.outputForm,
      application: target.application,
      scope: target.scope,
      instanceAlias: target.instanceAlias,
    },
    review: { packageId: review.packageId, jsonPath: resolve(reviewPath), sha256: fileSha256(reviewPath) },
    work,
    storyCoverage: implementation.storyCoverage,
    fixResults: implementation.fixResults.map((result) => ({
      findingId: result.findingId,
      outcome: result.outcome,
      resolution: resolutions.get(result.findingId)?.status ?? null,
      note: resolutions.get(result.findingId)?.note ?? result.detail,
    })),
    build: implementation.build
      ? { status: implementation.build.status, errorCount: implementation.build.errorCount, warningCount: implementation.build.warningCount }
      : null,
    findings: review.findings.map((finding) => ({
      id: finding.id,
      title: finding.title,
      severity: finding.severity,
      category: finding.category,
      location: findingLocation(finding),
      hasSuggestedCode: finding.suggestedCode !== null,
      decision: finding.decision.status,
    })),
    severityCounts,
    nextSteps: nextSteps(implementation, review, resolve(reviewPath)),
  });
}

function escape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function table(headers: string[], rows: string[][]): string {
  const head = headers.map((header) => `<th>${escape(header)}</th>`).join("");
  const body = rows.map((row) => `<tr>${row.map((cell) => `<td>${escape(cell)}</td>`).join("")}</tr>`).join("\n");
  return `<table><thead><tr>${head}</tr></thead><tbody>\n${body}\n</tbody></table>`;
}

export function renderCompletionReportHtml(value: CompletionReportPackage): string {
  const { implementation } = value;
  const sections: string[] = [];
  sections.push(`<h2>Summary</h2>
<p>${escape(value.summary)}</p>
<p>Application: ${escape(implementation.application)} (${escape(implementation.scope)}) on ${escape(implementation.instanceAlias)} · Mode: ${
    implementation.mode
  } · Output form: ${implementation.outputForm}</p>
<p>Findings by severity: ${CODE_REVIEW_SEVERITIES.map((severity) => `${severity} ${value.severityCounts[severity] ?? 0}`).join(" · ")}</p>`);
  sections.push(`<h2>Work Completed</h2>\n${table(
    ["Item", "Kind", "Detail", "Implements"],
    value.work.map((item) => [item.ref, item.kind, item.detail, item.implements.join(", ")]),
  )}`);
  if (value.storyCoverage.length > 0) {
    sections.push(`<h2>Story Coverage</h2>\n${table(["Story", "Status", "Note"], value.storyCoverage.map((entry) => [entry.storyId, entry.status, entry.note]))}`);
  }
  if (value.fixResults.length > 0) {
    sections.push(`<h2>Fix Results</h2>\n${table(
      ["Finding", "Writer outcome", "Reviewer resolution", "Note"],
      value.fixResults.map((entry) => [entry.findingId, entry.outcome, entry.resolution ?? "not re-reviewed", entry.note]),
    )}`);
  }
  if (value.build) {
    sections.push(`<h2>Build</h2>\n<p>Build ${escape(value.build.status)}: ${value.build.errorCount} error(s), ${value.build.warningCount} warning(s).</p>`);
  }
  const findings =
    value.findings.length === 0
      ? "<p>The reviewer found no problems.</p>"
      : value.findings
          .map(
            (finding) => `<!-- finding:${finding.id} -->
<div class="finding"><h3>${escape(finding.id)} — ${escape(finding.title)}</h3>
<p>Severity: ${finding.severity} · Category: ${escape(finding.category)} · Location: ${escape(finding.location)}</p>
<p>${finding.hasSuggestedCode ? "Suggested fix provided in the review." : "No code change proposed."} Decision: ${finding.decision}</p></div>`,
          )
          .join("\n");
  sections.push(`<h2>Review Findings</h2>\n${findings}`);
  sections.push(`<h2>Next Steps</h2>\n<ol>${value.nextSteps.map((step) => `<li>${escape(step)}</li>`).join("")}</ol>`);
  sections.push(`<h2>Sources</h2>
<p>Implementation report: ${escape(implementation.jsonPath)}</p>
<p>Code review: ${escape(value.review.jsonPath)}</p>
<p>Composed ${escape(value.composedAt)}.</p>`);
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>${escape(value.title)}</title>
<style>body{font-family:Segoe UI,Arial,sans-serif;max-width:1100px;margin:2rem auto;padding:0 1rem;color:#1f2328}table{border-collapse:collapse;width:100%}th,td{border:1px solid #d0d7de;padding:.35rem .5rem;text-align:left;vertical-align:top}th{background:#f6f8fa}.finding{border-left:4px solid #d0d7de;padding:.25rem .75rem;margin:.75rem 0}</style>
</head><body>
<h1>${escape(value.title)}</h1>
${sections.join("\n")}
</body></html>
`;
}

// Next free completion-report-vNNN pair beside the implementation report, reserved atomically.
function allocateBeside(implementationPath: string): { html: string; json: string } {
  const directory = dirname(resolve(implementationPath));
  const digits = basename(implementationPath).match(/-v([0-9]+)\.json$/)?.[1]?.length ?? 3;
  const reservations = join(directory, ".reservations");
  mkdirSync(reservations, { recursive: true });
  for (let version = 1; version < 10 ** digits; version += 1) {
    const label = `completion-report-v${String(version).padStart(digits, "0")}`;
    const paths = { html: join(directory, `${label}.html`), json: join(directory, `${label}.json`) };
    if (existsSync(paths.html) || existsSync(paths.json)) continue;
    try {
      closeSync(openSync(join(reservations, `${label}.reserve`), "wx"));
    } catch {
      continue;
    }
    return paths;
  }
  throw new Error(`No free completion-report version in '${directory}'.`);
}

export function writeCompletionReport(implementationPath: string, reviewPath: string): { html: string; json: string } {
  checkReviewCoversWork(implementationPath, readImplementation(implementationPath), readCodeReviewPackage(reviewPath).value);
  const artifacts = allocateBeside(implementationPath);
  const value = composeCompletionReport(implementationPath, reviewPath, artifacts, new Date().toISOString());
  writeFileSync(artifacts.json, `${JSON.stringify(value, null, 2)}\n`);
  writeFileSync(artifacts.html, renderCompletionReportHtml(value));
  return artifacts;
}

if (isDirectExecution(import.meta.url, process.argv[1])) {
  const [implementationPath, reviewPath] = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
  if (!implementationPath || !reviewPath) {
    process.stderr.write("Usage: npm run completion:compose -- <code-implementation-vNNN.json> <code-review-vNNN.json>\n");
    process.exitCode = 1;
  } else {
    try {
      const artifacts = writeCompletionReport(implementationPath, reviewPath);
      process.stdout.write(`${JSON.stringify(artifacts, null, 2)}\n`);
    } catch (error) {
      process.stderr.write(`Cannot compose completion report: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    }
  }
}
