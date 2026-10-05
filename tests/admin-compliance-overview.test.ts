import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import { requirementRowUrgency } from "@/components/admin/renewals/urgency";
import {
  buildComplianceOverview,
  complianceExportAboutRows,
  complianceBucketCounts,
  complianceExportFileName,
  complianceExportRows,
  COMPLIANCE_EXPORT_HEADER,
  complianceDateLine,
  complianceExportSelection,
  complianceFilterChips,
  complianceFilterMatches,
  complianceGroupNames,
  complianceIsFirstUse,
  complianceNeedsActionCount,
  nextJobReasonText,
} from "@/lib/admin/compliance-overview";
import {
  renewNext,
  renewNextDateLine,
  renewNextNothingDueLine,
  renewNextThenLine,
  renewWindowProgress,
  windowProgress,
} from "@/lib/admin/renew-next";
import { ADMIN_REQUIREMENTS_CATALOGUE, requirementChecklistRowsForJob } from "@/lib/admin/requirements";
import { formatRelativeDate } from "@/lib/admin/renewal-dates";
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
    expect(complianceExportFileName(NOW, true)).toBe("Example compliance 2026-10-05.xlsx");
    // The Rule column never says "Confirmed" next to a status, and the list's own date is named.
    expect(rows.slice(1).map((row) => row[5])).not.toContain("Confirmed");
    expect(new Set(rows.slice(1).map((row) => row[5]))).toEqual(new Set(["Stated by source", "Rule to confirm"]));
    expect(about).toMatch(/statewide requirements list, last updated \d{1,2} [A-Z][a-z]{2} \d{4}\./);
    expect(about).toContain("Stated by source means the source states the rule.");
  });

  it("says a 60-day file includes passed dates and names what it leaves out", () => {
    const about = complianceExportAboutRows(overview, NOW, {
      range: "next-60-days",
      omittedColumns: [],
      rows: 2,
    })
      .flat()
      .join(" ");
    expect(about).toContain("next 60 days only, dates already passed included");
    expect(about).toContain(
      "no recorded date, no end date, a date further ahead, or marked not for this job are left out",
    );
  });

  it("counts statuses the same way for Compliance and Renewals", () => {
    expect(complianceBucketCounts(overview.groups.flatMap((group) => group.items.map((item) => item.bucket)))).toEqual(
      overview.counts,
    );
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

describe("Compliance page helpers (5 Oct mock-up v2)", () => {
  const overview = buildComplianceOverview(ADMIN_REQUIREMENTS_CATALOGUE, entries, NOW, "2026-11-02");
  const all = overview.groups.flatMap((group) => group.items);
  const byId = (id: string) => all.find((item) => item.row.item.id === id)!;
  const today = "2026-10-05";

  it("counts Needs action as passed, renewing and unrecorded, and offers a chip for each status with items", () => {
    const needs = overview.counts["date-passed"] + overview.counts["start-renewing"] + overview.counts["not-recorded"];
    expect(complianceNeedsActionCount(overview)).toBe(needs);
    const chips = complianceFilterChips(overview);
    expect(chips[0]).toEqual({ filter: "all", label: "All", count: overview.total });
    expect(chips[1]).toEqual({ filter: "needs-action", label: "Needs action", count: needs });
    expect(chips.every((chip) => chip.count > 0)).toBe(true);
    expect(chips.some((chip) => chip.filter === "recorded")).toBe(overview.counts.recorded > 0);
    expect(overview.counts.recorded).toBeGreaterThan(0);
    expect(chips.at(-1)?.filter).toBe("recorded");
  });

  it("matches a filter to its items", () => {
    expect(complianceFilterMatches("all", byId("medical-registration-renewal"))).toBe(true);
    expect(complianceFilterMatches("needs-action", byId("medical-registration-renewal"))).toBe(false);
    expect(complianceFilterMatches("needs-action", byId("resuscitation-competence"))).toBe(true);
    expect(complianceFilterMatches("date-passed", byId("respirator-fit-testing"))).toBe(false);
  });

  it("writes the date line in the mock-up's words, never a verdict", () => {
    expect(complianceDateLine(byId("medical-registration-renewal"), today)).toBe("Renew by 30 Sep 2027 · in 11 months");
    expect(complianceDateLine(byId("resuscitation-competence"), today)).toBe("Date passed 28 Sep 2026 · 7 days ago");
    expect(complianceDateLine(byId("code-of-conduct"), today)).toBe("No end date");
    const unrecorded = all.find((item) => item.bucket === "not-recorded")!;
    expect(complianceDateLine(unrecorded, today)).toBeNull();
  });

  it("is first use only when nothing at all is recorded", () => {
    expect(complianceIsFirstUse(overview)).toBe(false);
    expect(complianceIsFirstUse(buildComplianceOverview(ADMIN_REQUIREMENTS_CATALOGUE, [], NOW, null))).toBe(true);
  });

  it("names all of a short group, or two items and a count of the rest", () => {
    const group = overview.groups.find((candidate) => candidate.items.length > 3)!;
    expect(complianceGroupNames(group)).toMatch(new RegExp(`and ${group.items.length - 2} more$`));
    const small = { ...group, items: group.items.slice(0, 2) };
    expect(complianceGroupNames(small)).toBe(small.items.map((item) => item.row.item.title).join(", "));
  });

  it("keeps the Item column always and narrows rows to the next 60 days, passed dates included", () => {
    const rows = complianceExportRows(overview);
    const everything = complianceExportSelection(rows, overview, ["Status"], "everything", today);
    expect(everything[0]).toEqual(["Item", "Status"]);
    expect(everything).toHaveLength(rows.length);
    const soon = complianceExportSelection(rows, overview, ["Status"], "next-60-days", today);
    const titles = soon.slice(1).map((row) => row[0]);
    expect(titles).toContain("Resuscitation competence check");
    expect(titles).toContain("Respirator fit testing");
    expect(titles).not.toContain("Medical registration renewal");
    expect(soon.slice(1).every((row) => row[1] !== "Not for this job")).toBe(true);
  });
});

describe("renewNext", () => {
  const rows = requirementChecklistRowsForJob(ADMIN_REQUIREMENTS_CATALOGUE, entries);
  const today = "2026-10-05";

  it("leads with the passed date, then the soonest open renewal window", () => {
    const next = renewNext(rows, today);
    if (next.kind !== "act") throw new Error("expected an item to act on");
    expect(next.item.row.item.id).toBe("resuscitation-competence");
    expect(next.item.bucket).toBe("date-passed");
    expect(next.then?.row.item.id).toBe("respirator-fit-testing");
    expect(renewNextDateLine(next.item, today)).toBe("Date passed 28 Sep 2026 · 7 days ago");
    expect(renewNextThenLine(next.then!, today)).toBe("Respirator fit testing, renew by 20 Oct 2026, in 2 weeks");
    expect(renewWindowProgress(next.item, today)).toBe(1);
  });

  it("says nothing is due only when no date has passed and no window is open, and names the next date", () => {
    const later = [
      complianceFixture("Registration", { requirementId: "medical-registration-renewal", expiresOn: "2027-09-30" }),
    ];
    const next = renewNext(requirementChecklistRowsForJob(ADMIN_REQUIREMENTS_CATALOGUE, later), today);
    expect(next.kind).toBe("nothing-due");
    if (next.kind !== "nothing-due" || !next.next) throw new Error("expected a next date");
    expect(renewNextNothingDueLine(next.next)).toBe(
      "Next: Medical registration renewal, start renewing from 31 Aug 2027",
    );
    expect(renewNext([], today)).toEqual({ kind: "nothing-due", next: null });
  });

  it("places today on the renewal window between its opening and the recorded date", () => {
    const fit = renewNext(rows, today);
    if (fit.kind !== "act" || !fit.then) throw new Error("expected a second item");
    const share = renewWindowProgress(fit.then, today)!;
    expect(share).toBeGreaterThan(0);
    expect(share).toBeLessThan(1);
  });
});

describe("a stored date that is not a real day", () => {
  // The entry schema checks the shape (YYYY-MM-DD) but not the calendar, so
  // "2026-02-30" can arrive from another client. It must never blank the pages.
  const entries = [
    complianceFixture("Life support", { requirementId: "resuscitation-competence", expiresOn: "2026-02-30" }),
  ];

  it("builds the overview and the Renew next card without throwing", () => {
    expect(() => buildComplianceOverview(ADMIN_REQUIREMENTS_CATALOGUE, entries, NOW, null)).not.toThrow();
    const rows = requirementChecklistRowsForJob(ADMIN_REQUIREMENTS_CATALOGUE, entries);
    expect(() => renewNext(rows, "2026-10-05")).not.toThrow();
    const row = rows.find((candidate) => candidate.item.id === "resuscitation-competence");
    expect(row && requirementRowUrgency(row, NOW).word).toBeTruthy();
  });

  it("is never ranked or shown as a passed deadline", () => {
    const overview = buildComplianceOverview(ADMIN_REQUIREMENTS_CATALOGUE, entries, NOW, null);
    const item = overview.groups
      .flatMap((group) => group.items)
      .find((c) => c.row.item.id === "resuscitation-competence")!;
    expect(item.row.expiresOn).toBeUndefined();
    expect(item.bucket).not.toBe("date-passed");
    const rows = requirementChecklistRowsForJob(ADMIN_REQUIREMENTS_CATALOGUE, entries);
    const next = renewNext(rows, "2026-10-05");
    expect(next.kind === "act" ? next.item.row.expiresOn : next.next?.row.expiresOn).not.toBe("2026-02-30");
    expect(formatRelativeDate("2026-02-30", "2026-10-05")).toBe("");
  });

  it("draws no renewal window for it", () => {
    expect(windowProgress(null, "2026-02-30", "2026-10-05")).toBeNull();
    expect(windowProgress("2026-09-01", "2026-10-01", "2026-09-16")).toBeCloseTo(0.5, 1);
  });
});
