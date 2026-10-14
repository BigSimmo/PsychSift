import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import ExcelJS from "exceljs";
import { PDFParse } from "pdf-parse";
import { extractDocument, extractPdf, parseExtractedDocumentPayload } from "@/lib/extractors/document";
import { extractedTextSha256 } from "@/lib/extractors/docx-source-provenance";
import {
  buildTextSourceProvenance,
  textPageSourceProvenanceSchema,
  TextSourceProvenanceError,
  validateTextSourcePages,
} from "@/lib/extractors/text-source-provenance";
import { buildDocumentPageRowsForPersistence } from "../worker/behavior";

function payload(buffer = Buffer.from("synthetic source")) {
  const text = buffer.toString("utf8");
  return {
    pages: [
      { pageNumber: 1, text, ocrUsed: false, metadata: { source_provenance: buildTextSourceProvenance(buffer, text) } },
    ],
    images: [],
  };
}
const cleanString = (text: string) =>
  text
    .replace(/\u0000/g, "")
    .replace(/\\u0000/g, "")
    .toWellFormed();

describe("TXT source-only provenance", () => {
  it.each([
    "",
    "literal \ufffd",
    "\n\nleading blanks",
    "a\nb\r\nc\rd\n",
    "row\t2.5 mg\t≤4\nfinal tail",
    "\ufeffsupported BOM",
  ])("preserves exact UTF8 Buffer decoding %j", async (input) => {
    const buffer = Buffer.from(input);
    const result = await extractDocument({ buffer, fileName: "synthetic.TXT", mimeType: "application/octet-stream" });
    expect(result.pages[0].text).toBe(buffer.toString("utf8"));
    const source = textPageSourceProvenanceSchema.parse(result.pages[0].metadata?.source_provenance);
    expect(source).toMatchObject({
      sourceContentSha256: extractedTextSha256(buffer),
      sourceByteLength: buffer.byteLength,
      structuralDisposition: "retained",
      reasonCodes: [],
      producer: { nodeVersion: process.version },
      decoding: { validity: "valid", lossiness: "none", lineEndingHandling: "unchanged" },
      textMapping: { status: "not_established", offsets: null },
    });
    expect(source.textIdentity.originalExtractedTextSha256).toBe(extractedTextSha256(input));
    expect(parseExtractedDocumentPayload(JSON.stringify(result))).toEqual(result);
  });
  it.each([
    { bytes: Buffer.from([0x41, 0xff, 0x42]), reasons: ["txt_utf8_replacement_unverified"] },
    {
      bytes: Buffer.concat([Buffer.from("long valid prefix ".repeat(80)), Buffer.from([0xff])]),
      reasons: ["txt_utf8_replacement_unverified"],
    },
    {
      bytes: Buffer.from([0xff, 0xfe, 0x41, 0]),
      reasons: [
        "txt_utf8_replacement_unverified",
        "txt_non_utf8_bom_unsupported",
        "txt_normalization_sensitive_source",
      ],
    },
    { bytes: Buffer.from("2\u00000 mg"), reasons: ["txt_normalization_sensitive_source"] },
    { bytes: Buffer.from("2\\u00000 mg"), reasons: ["txt_normalization_sensitive_source"] },
    { bytes: Buffer.from("A\u202eB"), reasons: ["txt_control_format_unverified"] },
    { bytes: Buffer.from("A\ufeffB"), reasons: ["txt_control_format_unverified"] },
    { bytes: Buffer.from("A\u{e0001}B"), reasons: ["txt_control_format_unverified"] },
  ])("keeps legacy decoding and observed uncertainty $reasons", async ({ bytes, reasons }) => {
    const result = await extractDocument({ buffer: bytes, fileName: "decoder.bin", mimeType: "text/plain" });
    expect(result.pages[0].text).toBe(bytes.toString("utf8"));
    const source = textPageSourceProvenanceSchema.parse(result.pages[0].metadata?.source_provenance);
    expect(source.reasonCodes).toEqual(reasons);
    expect(source.structuralDisposition).toBe("unverified");
    expect(parseExtractedDocumentPayload(JSON.stringify(result))).toEqual(result);
  });
  it("distinguishes valid literal replacement text from invalid bytes with identical decoded text", () => {
    const literal = payload(Buffer.from("\ufffd"));
    const invalid = payload(Buffer.from([0xff]));
    expect(literal.pages[0].text).toBe(invalid.pages[0].text);
    expect(literal.pages[0].metadata.source_provenance.decoding.validity).toBe("valid");
    expect(invalid.pages[0].metadata.source_provenance.decoding.validity).toBe("invalid");
    expect(literal.pages[0].metadata.source_provenance.sourceContentSha256).not.toBe(
      invalid.pages[0].metadata.source_provenance.sourceContentSha256,
    );
  });
  it("keeps unknown unmatched files without TXT provenance", async () => {
    const buffer = Buffer.from("<html>synthetic source</html>");
    const result = await extractDocument({ buffer, fileName: "source.html", mimeType: "text/html" });
    expect(result).toEqual({ pages: [{ pageNumber: 1, text: buffer.toString("utf8"), ocrUsed: false }], images: [] });
  });
  it("preserves DOCX and XLSX precedence over text/plain", async () => {
    const zip = new JSZip();
    zip.file(
      "[Content_Types].xml",
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    );
    zip.file(
      "_rels/.rels",
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    );
    zip.file(
      "word/document.xml",
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Synthetic DOCX source</w:t></w:r></w:p></w:body></w:document>',
    );
    const docx = await extractDocument({
      buffer: await zip.generateAsync({ type: "nodebuffer" }),
      fileName: "source.docx",
      mimeType: "text/plain",
    });
    try {
      expect(docx.pages[0].metadata?.source_provenance?.format).toBe("docx");
    } finally {
      for (const temporary of "temporaryPaths" in docx ? (docx.temporaryPaths ?? []) : [])
        await rm(temporary, { recursive: true, force: true });
    }
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet("Synthetic").addRow(["2.5 mg", "qualifier"]);
    const xlsx = await extractDocument({
      buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
      fileName: "source.xlsx",
      mimeType: "text/plain",
    });
    expect(xlsx.pages[0].text).toBe("Sheet: Synthetic\n2.5 mg,qualifier");
    expect(xlsx.pages[0].metadata?.source_provenance).toMatchObject({
      format: "xlsx",
      coordinateSpace: "xlsx_worksheet_cells",
      logicalUnitIndex: 1,
      formulaEvaluation: "unperformed",
      cachedResultFreshness: "unknown",
    });
  });
  it.each([
    null,
    { format: "txt", version: "unknown" },
    { ...payload().pages[0].metadata.source_provenance, arbitrary: true },
  ])("refuses malformed supplied TXT %j", (source) => {
    const result = payload();
    const raw = { ...result, pages: [{ ...result.pages[0], metadata: { source_provenance: source } }] };
    expect(() => parseExtractedDocumentPayload(JSON.stringify(raw))).toThrow();
    if (source !== null)
      expect(() => parseExtractedDocumentPayload(JSON.stringify(raw))).toThrow(TextSourceProvenanceError);
  });
  it("rejects logical/OCR/reason/disposition and source length/hash/control contradictions", () => {
    for (const change of [
      { logicalUnitIndex: 2 },
      { physicalPageNumber: 1 },
      { reasonCodes: ["unknown"] },
      { structuralDisposition: "unverified" },
      { sourceByteLength: 999 },
      { sourceContentSha256: extractedTextSha256("different") },
      {
        sourceControlObservations: {
          hasNul: true,
          hasLiteralBackslashU0000: false,
          hasUnhandledControlOrFormat: false,
        },
        reasonCodes: ["txt_normalization_sensitive_source"],
        structuralDisposition: "unverified",
      },
    ]) {
      const result = payload();
      Object.assign(result.pages[0].metadata.source_provenance, change);
      expect(() => parseExtractedDocumentPayload(JSON.stringify(result))).toThrow(TextSourceProvenanceError);
    }
    const result = payload();
    expect(() => validateTextSourcePages([{ ...result.pages[0], ocrUsed: true }])).toThrow(
      "TXT_SOURCE_PROVENANCE_INVALID",
    );
    expect(() => validateTextSourcePages([...result.pages, ...result.pages])).toThrow("TXT_SOURCE_PROVENANCE_INVALID");
  });
  it("rejects lone surrogates and a supported BOM claim without the preserved scalar", () => {
    const result = payload(Buffer.from("\ufffd"));
    result.pages[0].text = "\ud800";
    expect(() => parseExtractedDocumentPayload(JSON.stringify(result))).toThrow("TXT_SOURCE_PROVENANCE_INVALID");
    const missingBom = payload();
    missingBom.pages[0].metadata.source_provenance.decoding.bom = "utf8";
    expect(() => parseExtractedDocumentPayload(JSON.stringify(missingBom))).toThrow(
      "TXT_SOURCE_PROVENANCE_IDENTITY_MISMATCH",
    );
  });
  it("preserves original control history and identity through actual persistence sanitation", () => {
    const bytes = Buffer.from("\ufeff2\u00000\\u0000 mg");
    const result = payload(bytes);
    const [row] = buildDocumentPageRowsForPersistence("synthetic-txt", result, {
      cleanString,
      sanitizeJsonbRecord: (value) => JSON.parse(JSON.stringify(value)),
    });
    const persisted = parseExtractedDocumentPayload(
      JSON.stringify({ pages: [{ pageNumber: 1, text: row.text, metadata: row.metadata }], images: [] }),
    );
    const source = textPageSourceProvenanceSchema.parse(persisted.pages[0].metadata?.source_provenance);
    expect(row.text).toBe("\ufeff20 mg");
    expect(source).toMatchObject({
      sourceContentSha256: extractedTextSha256(bytes),
      structuralDisposition: "unverified",
      sourceControlObservations: { hasNul: true, hasLiteralBackslashU0000: true },
      textIdentity: {
        originalExtractedTextSha256: extractedTextSha256(bytes.toString("utf8")),
        persistedTextSha256: extractedTextSha256(row.text),
        normalizationApplied: true,
      },
    });
    expect(() => validateTextSourcePages(persisted.pages, bytes)).toThrow("TXT_SOURCE_PROVENANCE_IDENTITY_MISMATCH");
  });
  it("checks fresh exact text, source bytes, runtime and false normalization flags", () => {
    const bytes = Buffer.from("synthetic source");
    const result = payload(bytes);
    expect(() => validateTextSourcePages(result.pages, Buffer.from("changed source"))).toThrow(
      "TXT_SOURCE_PROVENANCE_IDENTITY_MISMATCH",
    );
    result.pages[0].metadata.source_provenance.producer.nodeVersion = "observed elsewhere";
    expect(() => validateTextSourcePages(result.pages, bytes)).toThrow("TXT_SOURCE_PROVENANCE_IDENTITY_MISMATCH");
    const metadataNormalized = payload(bytes);
    metadataNormalized.pages[0].metadata.source_provenance.textIdentity.metadataNormalizationApplied = true;
    expect(() => validateTextSourcePages(metadataNormalized.pages, bytes)).toThrow(
      "TXT_SOURCE_PROVENANCE_IDENTITY_MISMATCH",
    );
    expect(() => buildTextSourceProvenance(bytes, "different returned string")).toThrow(
      "TXT_SOURCE_PROVENANCE_IDENTITY_MISMATCH",
    );
  });
  it("rejects schema-valid TXT supplied by a native PDF process without fallback", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "clinical-kb-txt-pdf-test-"));
    const script = path.join(root, "fake.py");
    const fallback = vi.spyOn(PDFParse.prototype, "getText");
    try {
      await writeFile(
        script,
        `import json, sys\nwith open(sys.argv[3], 'w') as handle:\n    json.dump(json.loads(${JSON.stringify(JSON.stringify(payload()))}), handle)\n`,
      );
      await expect(
        extractPdf(Buffer.from("synthetic native source"), { scriptPathOverride: script }),
      ).rejects.toMatchObject({ code: "PDF_SOURCE_PROVENANCE_INVALID" });
      expect(fallback).not.toHaveBeenCalled();
    } finally {
      fallback.mockRestore();
      await rm(root, { recursive: true, force: true });
    }
  });
});
