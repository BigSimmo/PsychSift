export const XLSX_EXTRACTION_BUDGET = {
  maxSheets: 256,
  maxRows: 200_000,
  maxCells: 2_000_000,
  maxTextBytes: 32 * 1024 * 1024,
} as const;

export type XlsxExtractionBudget = {
  maxSheets: number;
  maxRows: number;
  maxCells: number;
  maxTextBytes: number;
};

export type XlsxSourceProvenanceErrorCode =
  "XLSX_SOURCE_PROVENANCE_INVALID" | "XLSX_SOURCE_PROVENANCE_IDENTITY_MISMATCH" | "XLSX_EXTRACTION_BUDGET_EXCEEDED";

/** Fixed, content-free refusal; never retain parser, filename or cell diagnostics. */
export class XlsxSourceProvenanceError extends Error {
  constructor(public readonly code: XlsxSourceProvenanceErrorCode) {
    super(code);
    this.name = "XlsxSourceProvenanceError";
  }
}

function budgetExceeded(): never {
  throw new XlsxSourceProvenanceError("XLSX_EXTRACTION_BUDGET_EXCEEDED");
}

function nonNegativeCount(value: number) {
  if (!Number.isSafeInteger(value) || value < 0) {
    budgetExceeded();
  }
  return value;
}

export class XlsxExtractionBudgetTracker {
  private rowCount = 0;
  private cellCount = 0;
  private textBytes = 0;

  constructor(readonly limits: XlsxExtractionBudget = XLSX_EXTRACTION_BUDGET) {}

  assertSheetCount(sheetCount: number) {
    const safeSheetCount = nonNegativeCount(sheetCount);
    if (safeSheetCount > this.limits.maxSheets) {
      budgetExceeded();
    }
  }

  addRow(cellCount: number) {
    const safeCellCount = nonNegativeCount(cellCount);
    const nextRowCount = this.rowCount + 1;
    if (!Number.isSafeInteger(nextRowCount) || nextRowCount > this.limits.maxRows) {
      budgetExceeded();
    }
    const nextCellCount = this.cellCount + safeCellCount;
    if (!Number.isSafeInteger(nextCellCount) || nextCellCount > this.limits.maxCells) {
      budgetExceeded();
    }
    this.rowCount = nextRowCount;
    this.cellCount = nextCellCount;
  }

  addText(text: string) {
    const nextTextBytes = this.textBytes + Buffer.byteLength(text, "utf8");
    if (!Number.isSafeInteger(nextTextBytes) || nextTextBytes > this.limits.maxTextBytes) {
      budgetExceeded();
    }
    this.textBytes = nextTextBytes;
  }
}
