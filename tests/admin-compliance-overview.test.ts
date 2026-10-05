import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import { requirementRowUrgency } from "@/components/admin/renewals/urgency";
import {
  buildComplianceOverview,
  complianceExportAboutRows,
  complianceExportFileName,
  complianceExportRows,
  COMPLIANCE_EXPORT_HEADER,
  nextJobReasonText,
} from "@/lib/admin/compliance-overview";
import { ADMIN_REQUIREMENTS_CATALOGUE } from "@/lib/admin/requirements";
import { buildXlsx, crc32, xlsxSheetName } from "@/lib/admin/xlsx-lite";
import { complianceFixture } from "./helpers/on-call-entry-fixture";

// Monday 5 October 2026, 08:12 in Perth.
const NOW = new Date("2026-10-05T00:12:00.000Z");

const entries = [
  // Passed.
  complianceFixture("Life support", { requirementId: "resuscitation-competence", expiresOn: "2026-09-28" }),
  // Inside its 30-day renewal window, and before a 2 Nov start.
  complianceFixture("Fit test", { requirementId: "respirator-fit-testing", expiresOn: "2026-10-20" }),
  // Inside its window, after the start date.
  complianceFixture("WWC", { requirementId: "working-with-children-check", expiresOn: "2026-11-14", leadTimeDays: 90 }),
  // Well ahead.
  complianceFixture("Registration", { requirementId: "medical-registration-renewal", expiresOn: "2027-09-30" }),
  // No end date.
  complianceFixture("Code of conduct", { requirementId: "code-of-conduct" }),
  // Not for this job.
  complianceFixture("Visa", { requirementId: "img-visa-requirements", notForThisJob: true }),
];

describe("buildComplianceOverview", () => {
  const overview = buildComplianceOverview(ADMIN_REQUIREMENTS_CATALOGUE, entries, NOW, "2026-11-02");
  const all = overview.groups.flatMap((group) => group.items);
  const byId = (id: string) => all.find((item) => item.row.item.id === id);

  it("covers every catalogue item once, leaving out the one marked not for this job", () => {
    expect(overview.total).toBe(ADMIN_REQUIREMENTS_CATALOGUE.length - 1);
    expect(all).toHaveLength(overview.total);
    expect(overview.notForThisJob.map((item) => item.id)).toEqual(["img-visa-requirements"]);
  });

  it("reads each row exactly as Renewals words it", () => {
    for (const item of all) {
      const word = requirementRowUrgency(item.row, NOW).word;
      const expected =
        item.bucket === "not-recorded"
          ? "Not recorded yet"
          : item.bucket === "date-passed"
            ? "Date passed"
            : item.bucket === "start-renewing"
              ? "Start renewing"
              : null;
      if (expected) expect(word).toBe(expected);
      else expect(["Recorded", "Start renewing"].includes(word) || word.startsWith("Start ")).toBe(true);
    }
    expect(byId("resuscitation-competence")?.bucket).toBe("date-passed");
    expect(byId("respirator-fit-testing")?.bucket).toBe("start-renewing");
    expect(byId("working-with-children-check")?.bucket).toBe("start-renewing");
    expect(byId("medical-registration-renewal")?.bucket).toBe("recorded");
    expect(byId("code-of-conduct")?.bucket).toBe("recorded");
  });

  it("counts add up to the total", () => {
    const sum = Object.values(overview.counts).reduce((total, count) => total + count, 0);
    expect(sum).toBe(overview.total);
    expect(overview.counts["date-passed"]).toBe(1);
    expect(overview.counts["start-renewing"]).toBe(2);
    expect(overview.counts.recorded).toBe(2);
  });

  it("lists the three soonest dates still ahead, never a passed one", () => {
    expect(overview.nextDeadlines.map((deadline) => deadline.date)).toEqual(["2026-10-20", "2026-11-14", "2027-09-30"]);
  });

  it("splits the next job into what carries over and what is still to do, with why", () => {
    const pass = overview.nextJob;
    expect(pass?.startsOn).toBe("2026-11-02");
    const toDo = new Map(pass?.toDo.map((todo) => [todo.item.row.item.id, todo.reason]));
    expect(toDo.get("resuscitation-competence")).toBe("date-passed");
    expect(toDo.get("respirator-fit-testing")).toBe("ends-before-start");
    expect(toDo.get("cpd-home-and-hours")).toBe("not-recorded");
    expect(pass?.carriesOver.map((item) => item.row.item.id).sort()).toEqual(
      ["code-of-conduct", "medical-registration-renewal", "working-with-children-check"].sort(),
    );
    expect((pass?.carriesOver.length ?? 0) + (pass?.toDo.length ?? 0)).toBe(overview.total);
    const fitTest = pass?.toDo.find((todo) => todo.item.row.item.id === "respirator-fit-testing");
    expect(fitTest && nextJobReasonText(fitTest)).toBe("Your date ends 20 Oct 2026, before you start");
  });

  it("shows no next-job pass without a start date, or for one already past", () => {
    expect(buildComplianceOverview(ADMIN_REQUIREMENTS_CATALOGUE, entries, NOW, null).nextJob).toBeNull();
    expect(buildComplianceOverview(ADMIN_REQUIREMENTS_CATALOGUE, entries, NOW, "2026-09-01").nextJob).toBeNull();
  });

  it("marks items whose rule the catalogue could not confirm", () => {
    expect(byId("criminal-record-screening")?.ruleToConfirm).toBe(true);
    expect(byId("working-with-children-check")?.ruleToConfirm).toBe(false);
  });
});

describe("the Excel export", () => {
  const overview = buildComplianceOverview(ADMIN_REQUIREMENTS_CATALOGUE, entries, NOW, "2026-11-02");
  const rows = complianceExportRows(overview);

  it("has one header and one row per catalogue item, in the page's words", () => {
    expect(rows[0]).toEqual([...COMPLIANCE_EXPORT_HEADER]);
    expect(rows).toHaveLength(ADMIN_REQUIREMENTS_CATALOGUE.length + 1);
    const text = rows.flat().join(" ").toLowerCase();
    for (const banned of ["compliant", "valid", "expired", "lapsed", "verified"]) expect(text).not.toContain(banned);
    const fitTest = rows.find((row) => row[0] === "Respirator fit testing");
    expect(fitTest?.slice(2, 5)).toEqual([
      "Start renewing",
      "20 Oct 2026",
      "To do: Your date ends 20 Oct 2026, before you start",
    ]);
    expect(rows.at(-1)?.[2]).toBe("Not for this job");
  });

  it("says what the file is and is not", () => {
    const about = complianceExportAboutRows(overview, NOW).flat().join(" ");
    expect(about).toContain("Nothing here has been checked with the issuing body");
    expect(complianceExportFileName(NOW)).toBe("Compliance 2026-10-05.xlsx");
  });

  it("is a real .xlsx that Excel's own reader opens, with text that cannot run as a formula", async () => {
    const hostile = [
      ["Item", "Note"],
      ['=HYPERLINK("http://example.invalid")', 'a < b & "c"\u0007'],
    ];
    const bytes = buildXlsx([
      { name: "Compliance", rows, widths: [34, 14] },
      { name: "Odd: name/with*chars", rows: hostile },
    ]);
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(bytes.buffer as ArrayBuffer);
    const first = book.getWorksheet("Compliance");
    expect(first?.getRow(1).getCell(1).value).toBe("Item");
    expect(first?.getRow(1).font?.bold ?? first?.getCell("A1").font?.bold).toBe(true);
    expect(first?.rowCount).toBe(rows.length);
    const second = book.worksheets[1];
    expect(second?.name).toBe(xlsxSheetName("Odd: name/with*chars", 1));
    const formula = second?.getCell("A2");
    expect(formula?.formula).toBeUndefined();
    expect(formula?.value).toBe('=HYPERLINK("http://example.invalid")');
    expect(second?.getCell("B2").value).toBe('a < b & "c"');
  });

  it("computes the standard CRC-32", () => {
    expect(crc32(new TextEncoder().encode("123456789")).toString(16)).toBe("cbf43926");
  });

  it("refuses an empty workbook", () => {
    expect(() => buildXlsx([])).toThrow();
  });
});
