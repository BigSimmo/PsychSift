import JSZip from "jszip";
import { describe, expect, it, vi } from "vitest";

// Shrink the per-page provenance budget so the test needs kilobytes, not MiBs. Every other limit,
// and every module that reads XLSX_SOURCE_LIMITS, keeps the real implementation.
vi.mock("@/lib/extractors/xlsx-original-zip", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/extractors/xlsx-original-zip")>();
  return { ...actual, XLSX_SOURCE_LIMITS: { ...actual.XLSX_SOURCE_LIMITS, pageBytes: 90_000 } };
});

const { extractDocument } = await import("@/lib/extractors/document");
const { preflightOriginalXlsx } = await import("@/lib/extractors/xlsx-source-preflight");
const { validateXlsxSourcePages, xlsxPageSourceProvenanceSchema } =
  await import("@/lib/extractors/xlsx-source-provenance");

const mimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const rel = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const pkg = "http://schemas.openxmlformats.org/package/2006/relationships";
const sheetCount = 3;
// Each sheet references its own ~30 kB shared string. A page carries its string twice (the cell's
// resolved runs plus the dictionary entry), about 60 kB. Under the old behaviour every page also
// carried the other sheets' strings, about 120 kB, which is over the 90 kB mocked page budget.
const longText = (sheet: number) => `sheet${sheet}-`.padEnd(30_000, String.fromCharCode(97 + sheet));

async function multiSheetArchive(cellIndex: (sheet: number) => string) {
  const sheets = Array.from({ length: sheetCount }, (_, i) => i);
  const files: Record<string, string> = {
    "[Content_Types].xml":
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/></Types>',
    "_rels/.rels": `<Relationships xmlns="${pkg}"><Relationship Id="document" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `<workbook xmlns="${ns}" xmlns:r="${rel}"><sheets>${sheets
      .map((i) => `<sheet name="Sheet${i + 1}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
      .join("")}</sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<Relationships xmlns="${pkg}">${sheets
      .map((i) => `<Relationship Id="rId${i + 1}" Type="${rel}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
      .join(
        "",
      )}<Relationship Id="styles" Type="${rel}/styles" Target="styles.xml"/><Relationship Id="strings" Type="${rel}/sharedStrings" Target="sharedStrings.xml"/></Relationships>`,
    "xl/styles.xml": `<styleSheet xmlns="${ns}"><fonts count="1"><font/></fonts><fills count="1"><fill/></fills><borders count="1"><border/></borders><cellXfs>${sheets
      .map(() => '<xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>')
      .join("")}</cellXfs></styleSheet>`,
    "xl/sharedStrings.xml": `<sst xmlns="${ns}">${sheets.map((i) => `<si><t>${longText(i)}</t></si>`).join("")}</sst>`,
  };
  for (const i of sheets)
    files[`xl/worksheets/sheet${i + 1}.xml`] =
      `<worksheet xmlns="${ns}"><sheetData><row r="1"><c r="A1" t="s" s="${i}"><v>${cellIndex(i)}</v></c></row></sheetData></worksheet>`;
  const zip = new JSZip();
  for (const [name, text] of Object.entries(files)) zip.file(name, text, { createFolders: false });
  return Buffer.from(await zip.generateAsync({ type: "nodebuffer", compression: "STORE" }));
}
const extract = (buffer: Buffer) => extractDocument({ buffer, fileName: "synthetic.xlsx", mimeType });

describe("per-worksheet XLSX dictionary projection", () => {
  it("charges each worksheet only for the shared strings and styles it references", async () => {
    const buffer = await multiSheetArchive((sheet) => String(sheet));
    const context = await preflightOriginalXlsx(buffer);
    expect(context.worksheets).toHaveLength(sheetCount);
    context.worksheets.forEach((facts, sheet) => {
      expect(facts.sharedStringRefs.map((ref) => ref.sourceIndex)).toEqual([sheet]);
      expect(facts.styleRefs.map((ref) => ref.sourceIndex)).toEqual([sheet]);
    });

    // The whole workbook's strings would not fit one page; each sheet's own does, so it is admitted.
    const document = await extract(buffer);
    expect(document.pages.map((page) => page.text.startsWith(`Sheet: Sheet${page.pageNumber}`))).toEqual([
      true,
      true,
      true,
    ]);
    document.pages.forEach((page, sheet) => {
      const packet = xlsxPageSourceProvenanceSchema.parse(page.metadata?.source_provenance);
      expect(packet.sourceFacts.sharedStringRefs.map((ref) => ref.sourceIndex)).toEqual([sheet]);
      expect(packet.sourceFacts.worksheet.rows[0].cells[0].resolvedSharedString?.textTokens[0].textToken).toBe(
        longText(sheet),
      );
      expect(packet.sourceFacts.worksheet.rows[0].cells[0].reasonCodes).not.toContain("xlsx_shared_string_unresolved");
    });
  });

  it("still refuses a page whose cell resolves a shared string its projection does not carry", async () => {
    const document = await extract(await multiSheetArchive((sheet) => String(sheet)));
    const pages = structuredClone(document.pages);
    const facts = (pages[1].metadata!.source_provenance as { sourceFacts: { sharedStringRefs: unknown[] } })
      .sourceFacts;
    facts.sharedStringRefs = [];
    expect(() => validateXlsxSourcePages(pages)).toThrow("XLSX_SOURCE_PROVENANCE_IDENTITY_MISMATCH");
  });

  it("still refuses a workbook with an out-of-range shared-string index", async () => {
    const buffer = await multiSheetArchive((sheet) => (sheet === 2 ? "99" : String(sheet)));
    const context = await preflightOriginalXlsx(buffer);
    const outOfRange = context.worksheets[2];
    expect(outOfRange.sharedStringRefs).toEqual([]);
    expect(outOfRange.worksheet.rows[0].cells[0]).toMatchObject({
      sharedStringIndexToken: "99",
      resolvedSharedString: null,
    });
    expect(outOfRange.worksheet.rows[0].cells[0].reasonCodes).toContain("xlsx_shared_string_unresolved");
    await expect(extract(buffer)).rejects.toThrow("XLSX_SOURCE_PROVENANCE_INVALID");
  });
});
