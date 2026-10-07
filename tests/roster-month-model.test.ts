import { describe, expect, it } from "vitest";

import {
  monthTotals,
  nextLeave,
  nextNights,
  payslipFigures,
  rosterDays,
  runWords,
  type MonthShift,
} from "@/components/roster/roster-month-model";
import type { ShiftKind } from "@/lib/roster/shift-kind";

/*
 * The Month tab's counts and the Payslip check card's counts (work-mode
 * redesign, owner request 6 Oct 2026). Every shift here is invented.
 */

const at = (date: string, time: string) => `${date}T${time}:00+08:00`;
function shift(id: string, date: string, kind: ShiftKind, start = "08:00", end = "16:30", endDate = date): MonthShift {
  return { id, startsAt: at(date, start), endsAt: at(endDate, end), kind };
}

const NONE: ReadonlySet<string> = new Set();

describe("rosterDays", () => {
  it("puts a working shift on the day it starts, even a night that ends the next morning", () => {
    const days = rosterDays([shift("n1", "2026-10-16", "night", "21:00", "08:30", "2026-10-17")]);
    expect(days.get("2026-10-16")?.kinds).toEqual(["night"]);
    expect(days.has("2026-10-17")).toBe(false);
  });

  it("spreads leave over every day it covers, but not into a day it ends at midnight", () => {
    const days = rosterDays([shift("al", "2026-10-21", "leave", "00:00", "00:00", "2026-10-24")]);
    expect([...days.keys()]).toEqual(["2026-10-21", "2026-10-22", "2026-10-23"]);
  });
});

describe("monthTotals", () => {
  it("counts each kind, days off and public holidays worked", () => {
    const shifts = [
      shift("d1", "2026-10-01", "day"),
      shift("d2", "2026-10-02", "day"),
      shift("e1", "2026-10-03", "evening", "13:00", "21:30"),
      shift("n1", "2026-10-04", "night", "21:00", "08:30", "2026-10-05"),
      shift("oc", "2026-10-05", "on_call", "21:00", "08:00", "2026-10-06"),
      shift("al", "2026-10-06", "leave", "00:00", "00:00", "2026-10-07"),
      shift("x1", "2026-11-01", "day"),
    ];
    const totals = monthTotals(shifts, "2026-10", new Set(["2026-10-01", "2026-10-07"]), null);
    expect(totals).toMatchObject({ day: 2, evening: 1, night: 1, on_call: 1, holidaysWorked: 1, countedFrom: null });
    // 31 days: five with a shift and one on leave.
    expect(totals.off).toBe(25);
  });

  it("counts only from the first loaded day, and says so", () => {
    const totals = monthTotals(
      [shift("d1", "2026-10-02", "day"), shift("d2", "2026-10-20", "day")],
      "2026-10",
      NONE,
      "2026-10-10",
    );
    expect(totals.countedFrom).toBe("2026-10-10");
    expect(totals.day).toBe(1);
    expect(totals.off).toBe(21);
  });

  it("does not count a public holiday on leave as worked", () => {
    const totals = monthTotals(
      [shift("al", "2026-12-25", "leave", "00:00", "00:00", "2026-12-26")],
      "2026-12",
      new Set(["2026-12-25"]),
      null,
    );
    expect(totals.holidaysWorked).toBe(0);
  });
});

describe("Coming up", () => {
  const now = new Date(at("2026-10-06", "07:42"));

  it("finds the next run of nights and stops at a gap", () => {
    const run = nextNights(
      [
        shift("n3", "2026-10-20", "night", "21:00", "08:30", "2026-10-21"),
        shift("n1", "2026-10-16", "night", "21:00", "08:30", "2026-10-17"),
        shift("n2", "2026-10-17", "night", "21:00", "08:30", "2026-10-18"),
      ],
      now,
    );
    expect(run?.count).toBe(2);
    expect(run?.dates).toEqual(["2026-10-16", "2026-10-17"]);
  });

  it("finds the next leave and its length in days", () => {
    const leave = nextLeave([shift("al", "2026-11-09", "leave", "00:00", "00:00", "2026-11-14")], now);
    expect(leave).toMatchObject({ from: "2026-11-09", to: "2026-11-13", days: 5 });
  });

  it("is empty when nothing is coming", () => {
    expect(nextNights([shift("n0", "2026-10-01", "night", "21:00", "08:30", "2026-10-02")], now)).toBeNull();
    expect(nextLeave([], now)).toBeNull();
  });

  it("joins a run of days in words", () => {
    const words = (date: string) => date.slice(8);
    expect(runWords(["2026-10-16"], words)).toBe("16");
    expect(runWords(["2026-10-16", "2026-10-17"], words)).toBe("16 and 17");
    expect(runWords(["2026-10-16", "2026-10-17", "2026-10-18"], words)).toBe("16 to 18");
  });
});

describe("payslipFigures", () => {
  it("counts shifts, nights, on call, weekend and public holiday shifts in the fortnight only", () => {
    const figures = payslipFigures(
      [
        shift("d0", "2026-09-27", "day"), // before the fortnight
        shift("d1", "2026-09-28", "day"),
        shift("n1", "2026-10-03", "night", "21:00", "08:30", "2026-10-04"), // Saturday
        shift("oc", "2026-10-04", "on_call", "21:00", "08:00", "2026-10-05"), // Sunday
        shift("al", "2026-10-06", "leave", "00:00", "00:00", "2026-10-07"),
        shift("d2", "2026-10-05", "day"), // a public holiday below
        shift("d3", "2026-10-12", "day"), // after the fortnight
      ],
      { start: "2026-09-28", end: "2026-10-11" },
      new Set(["2026-10-05"]),
    );
    expect(figures).toEqual({ shifts: 4, nights: 1, onCall: 1, weekend: 2, holidays: 1 });
  });
});
