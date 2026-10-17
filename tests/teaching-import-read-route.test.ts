import ExcelJS from "exceljs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({ isDemoMode: () => true }));

import { POST } from "@/app/api/teaching/import/read/route";

function upload(bytes: Uint8Array | null, name = "term.xlsx"): Request {
  const form = new FormData();
  if (bytes) form.append("file", new File([bytes as BlobPart], name));
  return new Request("http://localhost/api/teaching/import/read", { method: "POST", body: form });
}

describe("POST /api/teaching/import/read (server-side .xlsx read)", () => {
  it("returns the sheet's rows and stores nothing in the response headers' caches", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Term");
    sheet.addRow(["title", "kind"]);
    sheet.addRow(["Journal club", "journal"]);
    const response = await POST(upload(new Uint8Array(await workbook.xlsx.writeBuffer())));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    const body = (await response.json()) as { rows: { line: number; cells: string[] }[] };
    expect(body.rows.map((row) => row.cells.slice(0, 2))).toEqual([
      ["title", "kind"],
      ["Journal club", "journal"],
    ]);
  });

  it("refuses an unreadable file with the reader's message, not a server fault", async () => {
    const response = await POST(upload(new Uint8Array([1, 2, 3])));
    expect(response.status).toBe(400);
    expect(JSON.stringify(await response.json())).toContain("This file couldn't be read");
  });

  it("names the row limit, not the file size, when a small sheet has too many rows", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Term");
    for (let i = 0; i < 2_001; i += 1) sheet.addRow([`Session ${i}`]);
    const bytes = new Uint8Array(await workbook.xlsx.writeBuffer());
    expect(bytes.byteLength).toBeLessThan(1024 * 1024);
    const response = await POST(upload(bytes));
    expect(response.status).toBe(413);
    const text = JSON.stringify(await response.json());
    expect(text).toContain("up to 2,000 rows");
    expect(text).toContain("too_many_rows");
    expect(text).not.toContain("under 1 MB");
  });

  it("asks for a file when none was sent", async () => {
    const response = await POST(upload(null));
    expect(response.status).toBe(400);
  });
});
