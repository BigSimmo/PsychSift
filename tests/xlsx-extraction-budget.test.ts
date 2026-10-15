import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import { extractDocument } from "@/lib/extractors/document";
import {
  XlsxExtractionBudgetTracker,
  XlsxSourceProvenanceError,
  type XlsxExtractionBudget,
} from "@/lib/extractors/xlsx-extraction-budget";
import { xlsxPageSourceProvenanceSchema } from "@/lib/extractors/xlsx-source-provenance";
import { extractedTextSha256 } from "@/lib/extractors/docx-source-provenance";

const xlsxMime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function expectBudgetRefusal(operation: () => void) {
  let failure: unknown;
  try {
    operation();
  } catch (error) {
    failure = error;
  }
  expect(failure).toBeInstanceOf(XlsxSourceProvenanceError);
  expect(failure).toMatchObject({
    code: "XLSX_EXTRACTION_BUDGET_EXCEEDED",
    message: "XLSX_EXTRACTION_BUDGET_EXCEEDED",
  });
}

async function buildXlsx(sheetCount: number) {
  const workbook = new ExcelJS.Workbook();
  for (let index = 0; index < sheetCount; index += 1) {
    workbook.addWorksheet(`Sheet ${index + 1}`).addRow(["value"]);
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

describe("XLSX extraction budgets", () => {
  const limits: XlsxExtractionBudget = {
    maxSheets: 2,
    maxRows: 2,
    maxCells: 3,
    maxTextBytes: 4,
  };

  it("enforces worksheet, row, and rendered-cell boundaries", () => {
    const sheets = new XlsxExtractionBudgetTracker(limits);
    expect(() => sheets.assertSheetCount(2)).not.toThrow();
    expectBudgetRefusal(() => sheets.assertSheetCount(3));

    const rows = new XlsxExtractionBudgetTracker(limits);
    rows.addRow(2);
    rows.addRow(1);
    expectBudgetRefusal(() => rows.addRow(0));

    const cells = new XlsxExtractionBudgetTracker(limits);
    cells.addRow(3);
    expectBudgetRefusal(() => cells.addRow(1));
  });

  it("measures aggregate output as UTF-8 bytes", () => {
    const budget = new XlsxExtractionBudgetTracker(limits);
    budget.addText("éé");
    expectBudgetRefusal(() => budget.addText("a"));
  });

  it("preserves sparse-column output within the budget", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Sparse");
    sheet.getCell("C1").value = "value";

    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const result = await extractDocument({
      buffer,
      fileName: "sparse.xlsx",
      mimeType: xlsxMime,
    });

    expect(result.pages).toHaveLength(1);
    const provenance = xlsxPageSourceProvenanceSchema.parse(result.pages[0].metadata?.source_provenance);
    expect(result.pages).toEqual([
      {
        pageNumber: 1,
        text: "Sheet: Sparse\n,,value",
        ocrUsed: false,
        metadata: { source_provenance: provenance },
      },
    ]);
    expect(provenance).toMatchObject({
      sourceContentSha256: extractedTextSha256(buffer),
      logicalUnitIndex: 1,
      physicalPageNumber: null,
      textIdentity: {
        originalExtractedTextSha256: extractedTextSha256("Sheet: Sparse\n,,value"),
        persistedTextSha256: extractedTextSha256("Sheet: Sparse\n,,value"),
        normalizationApplied: false,
        metadataNormalizationApplied: false,
      },
    });
    expect(provenance.sourceFacts.worksheet.rows).toHaveLength(1);
    expect(provenance.sourceFacts.worksheet.rows[0].cells).toEqual([
      expect.objectContaining({ address: "C1", rowNumber: 1, columnNumber: 3 }),
    ]);
    expect(
      provenance.sourceFacts.worksheet.rows[0].cells[0].resolvedSharedString?.textTokens.map(
        (token) => token.textToken,
      ),
    ).toEqual(["value"]);
  });

  it("rejects workbooks with excessive worksheet counts", async () => {
    const extraction = extractDocument({
      buffer: await buildXlsx(257),
      fileName: "sheet-heavy.xlsx",
      mimeType: xlsxMime,
    });
    await expect(extraction).rejects.toBeInstanceOf(XlsxSourceProvenanceError);
    await expect(extraction).rejects.toMatchObject({
      code: "XLSX_EXTRACTION_BUDGET_EXCEEDED",
      message: "XLSX_EXTRACTION_BUDGET_EXCEEDED",
    });
  });
});
