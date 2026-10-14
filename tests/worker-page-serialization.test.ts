import { readFileSync } from "node:fs";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { extractDocument, parseExtractedDocumentPayload } from "@/lib/extractors/document";
import { xlsxFactsSha256, xlsxPageSourceProvenanceSchema } from "@/lib/extractors/xlsx-source-provenance";
import { buildDocumentPageRowsForPersistence, serializeDocumentPageRowsForCommit } from "../worker/behavior";

const cleanString = (value: string) =>
  value
    .replace(/\u0000/g, "")
    .replace(/\\u0000/g, "")
    .toWellFormed();
function sanitize(value: unknown): unknown {
  return typeof value === "string"
    ? cleanString(value)
    : Array.isArray(value)
      ? value.map(sanitize)
      : value && typeof value === "object"
        ? Object.fromEntries(Object.entries(value).map(([key, child]) => [key, sanitize(child)]))
        : value;
}
const sanitation = { cleanString, sanitizeJsonbRecord: (value: unknown) => sanitize(value) as Record<string, unknown> };
async function extraction(value: string, sheetName = "Synthetic") {
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet(sheetName).getCell("A1").value = value;
  return extractDocument({
    buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
    fileName: "synthetic.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}
function tokens(packet: ReturnType<typeof xlsxPageSourceProvenanceSchema.parse>) {
  const cell = packet.sourceFacts.worksheet.rows[0].cells[0];
  return (cell.resolvedSharedString ?? cell.inlineString)?.textTokens.map((token) => token.textToken);
}

describe("exact final ingestion page serialization", () => {
  it("refreshes source facts after both real sanitation passes without rebasing original hashes or sanitizing text twice", async () => {
    const literal = "\\u00" + "\\u0000" + "00";
    const actual = await extraction(literal),
      original = xlsxPageSourceProvenanceSchema.parse(actual.pages[0].metadata?.source_provenance);
    const first = buildDocumentPageRowsForPersistence("synthetic", actual, sanitation),
      intermediate = xlsxPageSourceProvenanceSchema.parse(first[0].metadata.source_provenance);
    expect(tokens(original)).toEqual([literal]);
    expect(tokens(intermediate)).toEqual(["\\u0000"]);
    const final = serializeDocumentPageRowsForCommit(first, sanitation),
      packet = xlsxPageSourceProvenanceSchema.parse(final[0].metadata.source_provenance);
    expect(tokens(packet)).toEqual([""]);
    expect(packet.sourceFactsIdentity.originalFactsSha256).toBe(original.sourceFactsIdentity.originalFactsSha256);
    expect(packet.sourceFactsIdentity.persistedFactsSha256).toBe(xlsxFactsSha256(packet.sourceFacts));
    expect(packet.sourceFactsIdentity.persistedFactsSha256).not.toBe(
      intermediate.sourceFactsIdentity.persistedFactsSha256,
    );
    expect(packet.textIdentity).toMatchObject({
      originalExtractedTextSha256: original.textIdentity.originalExtractedTextSha256,
      persistedTextSha256: intermediate.textIdentity.persistedTextSha256,
      normalizationApplied: true,
      metadataNormalizationApplied: true,
    });
    expect(final[0].text).toBe(first[0].text);
    expect(final[0].text).toContain("\\u0000");
    expect(packet.reasonCodes).toContain("xlsx_metadata_tokens_normalized_unverified");
    expect(packet.structuralDisposition).not.toBe("retained");
    expect(
      parseExtractedDocumentPayload(
        JSON.stringify({
          pages: final.map((row) => ({
            pageNumber: row.page_number,
            text: row.text,
            ocrUsed: row.ocr_used,
            metadata: row.metadata,
          })),
          images: [],
        }),
      ).pages[0].text,
    ).toBe(first[0].text);
  });
  it("refuses a sanitation-changed source locator", async () => {
    const actual = await extraction("value", "Source");
    const changedLocator = {
      ...sanitation,
      sanitizeJsonbRecord: (value: unknown) => {
        const metadata = structuredClone(value) as Record<string, unknown>;
        const packet = xlsxPageSourceProvenanceSchema.parse(metadata.source_provenance);
        packet.sourceFacts.workbook.sheets[0].nameToken = "Renamed";
        metadata.source_provenance = packet;
        return metadata;
      },
    };
    expect(() => buildDocumentPageRowsForPersistence("synthetic", actual, changedLocator)).toThrow(
      "XLSX_SOURCE_PROVENANCE_IDENTITY_MISMATCH",
    );
  });
  it("preserves the existing other-format second pass and unchanged page text", () => {
    const text = "literal\\u0000";
    expect(
      serializeDocumentPageRowsForCommit(
        [{ page_number: 1, text, ocr_used: false, metadata: { diagnostic: "\\u0000" } }],
        sanitation,
      ),
    ).toEqual([{ page_number: 1, text, ocr_used: false, metadata: { diagnostic: "" } }]);
  });
  it("uses the validated pure final serializer directly for main's fenced p_pages", () => {
    const source = readFileSync(new URL("../worker/main.ts", import.meta.url), "utf8");
    const commit = source.slice(
      source.indexOf("async function commitDocumentIndexGeneration"),
      source.indexOf("function buildDocumentPageRows("),
    );
    expect(commit).toContain("p_pages: serializeDocumentPageRowsForCommit(args.pages, { sanitizeJsonbRecord })");
    expect(commit).not.toMatch(/args\.pages\.map|sanitizeJsonbRecord\(page\.metadata\)/);
    expect(source).toContain(
      "return buildDocumentPageRowsForPersistence(documentId, extracted, { cleanString, sanitizeJsonbRecord })",
    );
  });
});
