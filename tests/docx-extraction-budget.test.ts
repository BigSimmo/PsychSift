import { rm } from "node:fs/promises";

import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import {
  assertDeclaredDocxMediaBudget,
  assertDeclaredDocxTextBudget,
  DOCX_EXTRACTION_BUDGET,
  DocxExtractionBudgetTracker,
  type DocxExtractionBudget,
} from "@/lib/extractors/docx-extraction-budget";
import { extractDocument } from "@/lib/extractors/document";

const docxMime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

async function buildDocx(
  mediaCount: number,
  documentText = "Budget test",
  compression: "DEFLATE" | "STORE" = "DEFLATE",
) {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
  );
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${documentText}</w:t></w:r></w:p></w:body></w:document>`,
  );
  for (let index = 0; index < mediaCount; index += 1) {
    zip.file(`word/media/image-${index}.png`, Buffer.from([index % 256]));
  }
  return zip.generateAsync({ type: "nodebuffer", compression });
}

async function captureExtractionError(promise: ReturnType<typeof extractDocument>) {
  return promise.then(
    async (result) => {
      const temporaryPaths = result.temporaryPaths;
      if (temporaryPaths === undefined) throw new Error("DOCX extraction must return temporary paths for cleanup");
      await Promise.all(temporaryPaths.map((target) => rm(target, { recursive: true, force: true })));
      return null;
    },
    (error: unknown) => error,
  );
}

describe("DOCX extraction budgets", () => {
  const limits: DocxExtractionBudget = {
    maxArtifacts: 2,
    maxSingleArtifactBytes: 4,
    maxArtifactBytes: 6,
    maxTextBytes: 4,
  };

  it("accepts exact boundaries and rejects the first artifact count beyond them", () => {
    const budget = new DocxExtractionBudgetTracker(limits);
    expect(() => budget.assertArtifactCount(2)).not.toThrow();
    expect(() => budget.assertArtifactCount(3)).toThrow("DOCX_EXTRACTION_BUDGET_EXCEEDED: artifact count 3 exceeds 2");
  });

  it("enforces single and aggregate media-byte limits before the caller writes files", () => {
    expect(() => new DocxExtractionBudgetTracker(limits).addArtifact(5)).toThrow(
      "DOCX_EXTRACTION_BUDGET_EXCEEDED: single artifact bytes 5 exceed 4",
    );

    const aggregate = new DocxExtractionBudgetTracker({ ...limits, maxArtifacts: 3 });
    aggregate.addArtifact(4);
    aggregate.addArtifact(2);
    expect(() => aggregate.addArtifact(1)).toThrow(
      "DOCX_EXTRACTION_BUDGET_EXCEEDED: aggregate artifact bytes exceed 6",
    );
  });

  it("preflights declared media sizes before entries are inflated", () => {
    expect(() => assertDeclaredDocxMediaBudget([{ _data: { uncompressedSize: 5 } }], limits)).toThrow(
      "DOCX_EXTRACTION_BUDGET_EXCEEDED: single artifact bytes 5 exceed 4",
    );
    expect(() =>
      assertDeclaredDocxMediaBudget([{ _data: { uncompressedSize: 4 } }, { _data: { uncompressedSize: 3 } }], limits),
    ).toThrow("DOCX_EXTRACTION_BUDGET_EXCEEDED: aggregate artifact bytes exceed 6");
  });

  it("preflights aggregate Word XML before Mammoth inflates it", () => {
    expect(() =>
      assertDeclaredDocxTextBudget([{ _data: { uncompressedSize: 2 } }, { _data: { uncompressedSize: 3 } }], limits),
    ).toThrow("DOCX_EXTRACTION_BUDGET_EXCEEDED: declared Word XML bytes exceed 4");
  });

  it("measures extracted text as UTF-8 bytes", () => {
    expect(() => new DocxExtractionBudgetTracker(limits).assertText("éé")).not.toThrow();
    expect(() => new DocxExtractionBudgetTracker(limits).assertText("ééa")).toThrow(
      "DOCX_EXTRACTION_BUDGET_EXCEEDED: extracted UTF-8 text exceeds 4 bytes",
    );
  });

  it("rejects excessive embedded-media counts before extraction writes artifacts", async () => {
    const error = await captureExtractionError(
      extractDocument({ buffer: await buildDocx(1_001), fileName: "media-heavy.docx", mimeType: docxMime }),
    );

    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toContain("DOCX_EXTRACTION_BUDGET_EXCEEDED: artifact count 1001 exceeds 1000");
  });

  it("rejects oversized Word XML before Mammoth extraction", async () => {
    const error = await captureExtractionError(
      extractDocument({
        buffer: await buildDocx(0, "a".repeat(DOCX_EXTRACTION_BUDGET.maxTextBytes), "STORE"),
        fileName: "text-heavy.docx",
        mimeType: docxMime,
      }),
    );

    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toContain(
      `DOCX_EXTRACTION_BUDGET_EXCEEDED: declared Word XML bytes exceed ${DOCX_EXTRACTION_BUDGET.maxTextBytes}`,
    );
  });
});
