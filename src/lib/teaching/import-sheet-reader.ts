import { IMPORT_MAX_FILE_BYTES, type SheetRow } from "@/lib/teaching/depth-model";

/*
 * The server half of the term import's file reading (spec §9, master plan R25). Imported only by
 * `app/api/teaching/import/read/route.ts`, so exceljs and jszip stay out of every client bundle:
 * the browser posts the chosen .xlsx and gets its rows back. CSV parsing, which is tiny and needs
 * no library, stays in the browser (`import-csv.ts`). Never import this from `import-sheet.ts` or
 * `depth-repository.ts`: those are traced into other server routes, and exceljs pulls an optional
 * `@aws-sdk/client-s3` the build cannot resolve (F1). This route loads exceljs lazily, like Roster's
 * `read-file` route loads its reader.
 */
import { loadOoxmlWorkbook } from "@/lib/ooxml-workbook";
import { MAX_COLUMNS } from "@/lib/teaching/import-csv";

export { parseCsv } from "@/lib/teaching/import-csv";
export type { SheetRow };
const MAX_ARCHIVE_ENTRIES = 1_000;
const MAX_EXPANDED_BYTES = 32 * 1024 * 1024;
const MAX_ROWS = 2_000;
export const IMPORT_UNREADABLE_MESSAGE = "This file couldn't be read. Save it from the template as .xlsx or .csv.";
export const IMPORT_TOO_LARGE_MESSAGE = "Use a file under 1 MB.";
export const IMPORT_TOO_MANY_ROWS_MESSAGE = "Use a sheet with up to 2,000 rows.";

function cellText(value: unknown): string {
  if (value instanceof Date) {
    const iso = value.toISOString();
    return value.getUTCFullYear() < 1901 ? iso.slice(11, 16) : iso.slice(0, 10); // Excel keeps a time as 30 Dec 1899
  }
  if (value && typeof value === "object") {
    if ("error" in value) return "";
    if ("hyperlink" in value) return String((value as { hyperlink: unknown }).hyperlink ?? "");
    if ("result" in value) return cellText((value as { result: unknown }).result);
    if ("richText" in value)
      return (value as { richText: { text: string }[] }).richText.map((part) => part.text).join("");
  }
  return value === null || value === undefined ? "" : String(value);
}

/** The first sheet of an .xlsx the doctor chose, read on the device. Errors carry plain words. */
export async function readXlsxRows(data: ArrayBuffer | Uint8Array): Promise<SheetRow[]> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.byteLength > IMPORT_MAX_FILE_BYTES) throw new Error(IMPORT_TOO_LARGE_MESSAGE);
  const workbook = await loadOoxmlWorkbook(bytes, {
    maxEntries: MAX_ARCHIVE_ENTRIES,
    maxExpandedBytes: MAX_EXPANDED_BYTES,
    onUnreadable: () => new Error(IMPORT_UNREADABLE_MESSAGE),
    onTooManyEntries: () => new Error(IMPORT_UNREADABLE_MESSAGE),
    onExpandedBytesExceeded: () => new Error(IMPORT_UNREADABLE_MESSAGE),
  });
  const rows: SheetRow[] = [];
  workbook.worksheets[0]?.eachRow({ includeEmpty: false }, (row, line) => {
    if (rows.length >= MAX_ROWS || line > 10_000) {
      throw new Error(IMPORT_TOO_MANY_ROWS_MESSAGE);
    }
    const values = Array.isArray(row.values) ? row.values.slice(1, MAX_COLUMNS + 1) : [];
    rows.push({ line, cells: Array.from(values, cellText) });
  });
  return rows;
}
