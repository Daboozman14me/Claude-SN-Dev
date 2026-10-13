import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import JSZip from "jszip";
import { PDFDocument, StandardFonts } from "pdf-lib";

export interface AssistedFixturePaths {
  directory: string;
  requirements: string;
  docx: string;
  pptx: string;
  pdf: string;
  html: string;
  markdown: string;
  text: string;
  json: string;
  unsupported: string;
  unreadable: string;
}

async function writeDocx(path: string): Promise<void> {
  const zip = new JSZip();
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Target Architecture</w:t></w:r></w:p>
    <w:p><w:r><w:t>Use a reusable request review workspace.</w:t></w:r></w:p>
    <w:tbl><w:tr><w:tc><w:p><w:r><w:t>Component</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Purpose</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>Review queue</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Tracks review work</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
  </w:body>
</w:document>`,
  );
  writeFileSync(path, await zip.generateAsync({ type: "nodebuffer" }));
}

async function writePptx(path: string): Promise<void> {
  const zip = new JSZip();
  zip.file(
    "ppt/slides/slide1.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld><p:spTree>
    <p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>Delivery Approach</a:t></a:r></a:p></p:txBody></p:sp>
    <p:sp><p:nvSpPr><p:cNvPr id="3" name="Body"/><p:cNvSpPr/><p:nvPr><p:ph type="body"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>Start with read-only discovery and a draft review queue.</a:t></a:r></a:p></p:txBody></p:sp>
    <p:graphicFrame><a:graphic><a:graphicData><a:tbl>
      <a:tr><a:tc><a:txBody><a:p><a:r><a:t>Decision</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:p><a:r><a:t>Owner</a:t></a:r></a:p></a:txBody></a:tc></a:tr>
      <a:tr><a:tc><a:txBody><a:p><a:r><a:t>Assignment rules</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:p><a:r><a:t>Product owner</a:t></a:r></a:p></a:txBody></a:tc></a:tr>
    </a:tbl></a:graphicData></a:graphic></p:graphicFrame>
  </p:spTree></p:cSld>
</p:sld>`,
  );
  zip.file(
    "ppt/slides/_rels/slide1.xml.rels",
    `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide1.xml"/>
</Relationships>`,
  );
  zip.file(
    "ppt/notesSlides/notesSlide1.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<p:notes xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld><p:spTree><p:sp><p:nvSpPr><p:nvPr><p:ph type="body"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>Confirm assignment rules with the product owner.</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld>
</p:notes>`,
  );
  writeFileSync(path, await zip.generateAsync({ type: "nodebuffer" }));
}

async function writePdf(path: string): Promise<void> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const first = pdf.addPage([500, 700]);
  first.drawText("Operational Considerations", {
    x: 40,
    y: 650,
    size: 18,
    font,
  });
  first.drawText("Record review outcomes and support retry.", {
    x: 40,
    y: 620,
    size: 12,
    font,
  });
  const second = pdf.addPage([500, 700]);
  second.drawText("Provide monitoring for failed review assignments.", {
    x: 40,
    y: 650,
    size: 12,
    font,
  });
  writeFileSync(path, await pdf.save());
}

export async function createAssistedFixtures(
  directory: string,
): Promise<AssistedFixturePaths> {
  mkdirSync(directory, { recursive: true });
  const paths: AssistedFixturePaths = {
    directory,
    requirements: join(directory, "requirements.txt"),
    docx: join(directory, "architect-notes.docx"),
    pptx: join(directory, "architect-briefing.pptx"),
    pdf: join(directory, "architect-operations.pdf"),
    html: join(directory, "context.html"),
    markdown: join(directory, "decisions.md"),
    text: join(directory, "notes.txt"),
    json: join(directory, "requirements.json"),
    unsupported: join(directory, "inventory.csv"),
    unreadable: join(directory, "unreadable.docx"),
  };

  writeFileSync(
    paths.requirements,
    "Reviewers need a queue of pending requests.\nEach decision needs acceptance criteria.",
  );
  writeFileSync(
    paths.html,
    "<html><head><title>Current Context</title></head><body><h1>Current State</h1><p>Requests are reviewed manually.</p><section><span>Escalations require an owner.</span></section></body></html>",
  );
  writeFileSync(
    paths.markdown,
    "# Design Inputs\n\nKeep assignment rules configurable.",
  );
  writeFileSync(paths.text, "First note\nSecond note");
  writeFileSync(
    paths.json,
    JSON.stringify({
      requirement: "Show pending requests",
      constraints: ["Read-only discovery"],
    }),
  );
  writeFileSync(paths.unsupported, "name,value\nexample,1");
  writeFileSync(paths.unreadable, "not a zip archive");
  await Promise.all([writeDocx(paths.docx), writePptx(paths.pptx), writePdf(paths.pdf)]);
  return paths;
}
