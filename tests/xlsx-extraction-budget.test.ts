import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import { extractDocument } from "@/lib/extractors/document";
import {
  XlsxExtractionBudgetTracker,
  XlsxSourceProvenanceError,
  type XlsxExtractionBudget,
} from "@/lib/extractors/xlsx-extraction-budget";

const xlsxMime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

async function buildXlsx(sheetCount: number) {
  const workbook = new ExcelJS.Workbook();
  for (let index = 0; index < sheetCount; index += 1) {
    workbook.addWorksheet(`Sheet ${index + 1}`).addRow(["value"]);
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/**
 * The budget refusal is deliberately a fixed, content-free code (no counts, sheet names or
 * cell text), so assert the exact error class, code and message. Which boundary tripped is
 * pinned by construction: each case keeps every other counter at or under its limit.
 */
function expectBudgetRefusal(action: () => unknown) {
  let thrown: unknown;
  try {
    action();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(XlsxSourceProvenanceError);
  expect((thrown as XlsxSourceProvenanceError).code).toBe("XLSX_EXTRACTION_BUDGET_EXCEEDED");
  expect((thrown as Error).message).toBe("XLSX_EXTRACTION_BUDGET_EXCEEDED");
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

    // Rows: 3 cells stays at the cell limit, so only the third row can trip the budget.
    const rows = new XlsxExtractionBudgetTracker(limits);
    expect(() => rows.addRow(2)).not.toThrow();
    expect(() => rows.addRow(1)).not.toThrow();
    expectBudgetRefusal(() => rows.addRow(0));

    // Cells: the second row stays at the row limit, so only the fourth cell can trip it.
    const cells = new XlsxExtractionBudgetTracker(limits);
    expect(() => cells.addRow(3)).not.toThrow();
    expectBudgetRefusal(() => cells.addRow(1));
  });

  it("measures aggregate output as UTF-8 bytes", () => {
    const budget = new XlsxExtractionBudgetTracker(limits);
    // Two characters but four UTF-8 bytes: exactly at the limit, so one more byte must refuse.
    expect(() => budget.addText("éé")).not.toThrow();
    expectBudgetRefusal(() => budget.addText("a"));
  });

  it("preserves sparse-column output within the budget", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Sparse");
    sheet.getCell("C1").value = "value";

    const result = await extractDocument({
      buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
      fileName: "sparse.xlsx",
      mimeType: xlsxMime,
    });

    // Pages now also carry the XLSX source-provenance record; the rendered text is unchanged.
    expect(result.pages).toEqual([
      {
        pageNumber: 1,
        text: "Sheet: Sparse\n,,value",
        ocrUsed: false,
        metadata: expect.objectContaining({
          source_provenance: expect.objectContaining({ coordinateSpace: "xlsx_worksheet_cells" }),
        }),
      },
    ]);
  });

  it("rejects workbooks with excessive worksheet counts", async () => {
    await expect(
      extractDocument({ buffer: await buildXlsx(257), fileName: "sheet-heavy.xlsx", mimeType: xlsxMime }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof XlsxSourceProvenanceError &&
        error.code === "XLSX_EXTRACTION_BUDGET_EXCEEDED" &&
        error.message === "XLSX_EXTRACTION_BUDGET_EXCEEDED",
    );
  });
});
