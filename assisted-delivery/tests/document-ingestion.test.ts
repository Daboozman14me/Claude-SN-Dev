import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test from "node:test";
import { ingestDocuments } from "../src/document-ingestion.js";
import { createAssistedFixtures } from "./assisted-fixtures.js";

test("ingests all supported formats into deterministic located units", async () => {
  const directory = mkdtempSync(join(tmpdir(), "assisted-ingestion-"));
  const fixtures = await createAssistedFixtures(directory);
  const result = await ingestDocuments(directory);

  assert.deepEqual(
    result.documents.map((document) => document.format).sort(),
    ["docx", "html", "json", "markdown", "pdf", "pptx", "txt", "txt"],
  );
  const docx = result.documents.find((document) => document.format === "docx");
  assert.ok(
    docx?.units.some(
      (unit) =>
        unit.type === "heading" &&
        unit.location.kind === "heading" &&
        unit.location.heading === "Target Architecture",
    ),
  );
  assert.ok(docx?.units.some((unit) => unit.type === "table"));

  const pptx = result.documents.find((document) => document.format === "pptx");
  assert.ok(
    pptx?.units.some(
      (unit) =>
        unit.type === "slide_title" &&
        unit.location.kind === "slide" &&
        unit.location.slide === 1,
    ),
  );
  assert.ok(
    pptx?.units.some(
      (unit) =>
        unit.type === "table" &&
        unit.location.kind === "slide_table" &&
        /Assignment rules/.test(unit.text),
    ),
  );
  assert.ok(
    pptx?.units.some(
      (unit) =>
        unit.type === "speaker_notes" &&
        unit.location.kind === "speaker_notes",
    ),
  );

  const pdf = result.documents.find((document) => document.format === "pdf");
  assert.equal(
    pdf?.units.filter((unit) => unit.location.kind === "page").length,
    2,
  );
  assert.match(pdf?.units[0]?.text ?? "", /Operational Considerations/);

  const html = result.documents.find((document) => document.format === "html");
  assert.ok(html?.units.some((unit) => unit.type === "heading"));
  assert.ok(
    html?.units.some((unit) => /Escalations require an owner/.test(unit.text)),
  );
  const markdown = result.documents.find(
    (document) => document.format === "markdown",
  );
  assert.ok(markdown?.units.some((unit) => unit.type === "heading"));
  const json = result.documents.find((document) => document.format === "json");
  assert.ok(
    json?.units.some(
      (unit) =>
        unit.location.kind === "json_pointer" &&
        unit.location.pointer === "/requirement",
    ),
  );

  assert.equal(
    result.inventory.find(
      (entry) => basename(entry.path) === basename(fixtures.unsupported),
    )?.supported,
    false,
  );
  assert.equal(
    result.inventory.find(
      (entry) => basename(entry.path) === basename(fixtures.unreadable),
    )?.readable,
    false,
  );
  assert.ok(result.warnings.some((warning) => /Unsupported/.test(warning)));
  assert.ok(result.warnings.some((warning) => /Unable to read/.test(warning)));
});

test("reports an unsupported individual file instead of silently succeeding", async () => {
  const directory = mkdtempSync(join(tmpdir(), "assisted-ingestion-"));
  const fixtures = await createAssistedFixtures(directory);
  const result = await ingestDocuments(fixtures.unsupported);

  assert.equal(result.documents.length, 0);
  assert.equal(result.inventory[0]?.supported, false);
  assert.match(result.warnings.join("\n"), /No supported readable documents/);
});

test("document IDs remain unique when distinct paths have the same slug", async () => {
  const directory = mkdtempSync(join(tmpdir(), "assisted-ingestion-"));
  mkdirSync(join(directory, "a"));
  writeFileSync(join(directory, "a-b.md"), "# First");
  writeFileSync(join(directory, "a_b.md"), "# Second");
  writeFileSync(join(directory, "a", "b.md"), "# Third");

  const result = await ingestDocuments(directory);
  assert.equal(result.documents.length, 3);
  assert.equal(
    new Set(result.documents.map((document) => document.id)).size,
    result.documents.length,
  );
});

test("uses the empty RFC 6901 pointer for a root JSON value", async () => {
  const directory = mkdtempSync(join(tmpdir(), "assisted-ingestion-"));
  const path = join(directory, "root.json");
  writeFileSync(path, JSON.stringify("root value"));

  const result = await ingestDocuments(path);
  const location = result.documents[0]?.units[0]?.location;
  assert.equal(location?.kind, "json_pointer");
  if (location?.kind === "json_pointer") {
    assert.equal(location.pointer, "");
  }
});

test("preserves empty JSON strings as explicit readable values", async () => {
  const directory = mkdtempSync(join(tmpdir(), "assisted-ingestion-"));
  const path = join(directory, "empty-string.json");
  writeFileSync(path, JSON.stringify({ optionalValue: "" }));

  const result = await ingestDocuments(path);
  assert.equal(result.documents[0]?.units[0]?.text, '""');
  assert.equal(result.documents[0]?.warnings.length, 0);
});

test("individual same-named files receive distinct document IDs", async () => {
  const directory = mkdtempSync(join(tmpdir(), "assisted-ingestion-"));
  const firstDirectory = join(directory, "first");
  const secondDirectory = join(directory, "second");
  mkdirSync(firstDirectory);
  mkdirSync(secondDirectory);
  const firstPath = join(firstDirectory, "requirements.md");
  const secondPath = join(secondDirectory, "requirements.md");
  writeFileSync(firstPath, "# First");
  writeFileSync(secondPath, "# Second");

  const [first, second] = await Promise.all([
    ingestDocuments(firstPath),
    ingestDocuments(secondPath),
  ]);
  assert.notEqual(first.documents[0]?.id, second.documents[0]?.id);
});

test("preserves HTML body text in source order without duplication", async () => {
  const directory = mkdtempSync(join(tmpdir(), "assisted-ingestion-"));
  const path = join(directory, "ordered.html");
  writeFileSync(
    path,
    "<body>Before<h2>Heading</h2>Between<p>Paragraph <strong>content</strong></p>After</body>",
  );

  const result = await ingestDocuments(path);
  assert.deepEqual(
    result.documents[0]?.units.map((unit) => unit.text),
    ["Before", "Heading", "Between", "Paragraph content", "After"],
  );
});
