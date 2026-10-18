import { PublicApiError } from "@/lib/http";
import { withTeachingApi } from "@/lib/teaching/api";
import { IMPORT_MAX_FILE_BYTES } from "@/lib/teaching/depth-model";
import {
  IMPORT_TOO_LARGE_MESSAGE,
  IMPORT_TOO_MANY_ROWS_MESSAGE,
  IMPORT_UNREADABLE_MESSAGE,
  readXlsxRows,
  type SheetRow,
} from "@/lib/teaching/import-sheet-reader";
import { readBoundedFormData } from "@/lib/validation/body";

export const runtime = "nodejs";

/*
 * Reads a chosen term-import .xlsx into rows, on the server and in memory only, so exceljs never
 * ships to the browser. Nothing is stored or logged: the rows go straight back to the caller, who
 * previews them through the depth route as before. Stateless, so demo mode reads too (Import's
 * demo preview), while a signed-in read spends from the Teaching rate limit.
 */

async function readRows(request: Request): Promise<{ rows: SheetRow[] }> {
  const form = await readBoundedFormData(request, IMPORT_MAX_FILE_BYTES, {
    tooLargeMessage: IMPORT_TOO_LARGE_MESSAGE,
    tooLargeCode: "payload_too_large",
    invalidFormMessage: "Choose a CSV or XLSX file.",
    invalidFormCode: "invalid_form_data",
  });
  const file = form.get("file");
  if (!(file instanceof File))
    throw new PublicApiError("Choose a CSV or XLSX file.", 400, { code: "invalid_form_data" });
  if (file.size > IMPORT_MAX_FILE_BYTES) {
    throw new PublicApiError(IMPORT_TOO_LARGE_MESSAGE, 413, { code: "payload_too_large" });
  }
  try {
    return { rows: await readXlsxRows(new Uint8Array(await file.arrayBuffer())) };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    if (reason === IMPORT_TOO_LARGE_MESSAGE) {
      throw new PublicApiError(IMPORT_TOO_LARGE_MESSAGE, 413, { code: "payload_too_large" });
    }
    if (reason === IMPORT_TOO_MANY_ROWS_MESSAGE) {
      throw new PublicApiError(IMPORT_TOO_MANY_ROWS_MESSAGE, 413, { code: "too_many_rows" });
    }
    throw new PublicApiError(IMPORT_UNREADABLE_MESSAGE, 400, { code: "unreadable_file" });
  }
}

export async function POST(request: Request) {
  return withTeachingApi(request, () => readRows(request), { demo: () => readRows(request) });
}
