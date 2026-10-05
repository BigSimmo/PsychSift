import { describe, expect, it } from "vitest";

import {
  formatSpanUntil,
  formatSpanWords,
  leadShift,
  relativeDay,
  shiftSpan,
  weekCountWords,
  weekRows,
  type OverviewShift,
} from "@/lib/roster/shifts-overview";
import type { ShiftKind } from "@/lib/roster/shift-kind";
import { addDaysToDate, perthWallToIso } from "@/lib/roster/shifts/perth-time";

/* The words Roster Shifts draws, from an invented roster (Perth time). */

function at(date: string, start: string, end: string, kind: ShiftKind, place: string | null = null): OverviewShift {
  return {
    id: `${kind}-${date}-${start}`,
    startsAt: perthWallToIso(date, start)!,
    endsAt: perthWallToIso(end > start ? date : addDaysToDate(date, 1), end)!,
    kind,
    place,
  };
}

const week = [
  at("2026-10-05", "14:00", "22:30", "evening", "Ward and liaison"),
  at("2026-10-06", "08:30", "17:00", "day", "Clinic"),
  at("2026-10-07", "00:00", "00:00", "leave"),
  at("2026-10-09", "21:00", "08:00", "night", "Overnight on site"),
  at("2026-10-11", "21:00", "08:00", "on_call"),
];

describe("Roster Shifts words", () => {
  it("names the end day of a shift that runs past midnight", () => {
    expect(shiftSpan(week[0]!)).toBe("14:00 to 22:30");
    expect(shiftSpan(week[3]!)).toBe("21:00 to Sat 08:00");
    expect(shiftSpan(at("2026-10-05", "16:00", "00:00", "evening"))).toBe("16:00 to 24:00");
  });

  it("leads with the shift on now, else the next one, never leave", () => {
    expect(leadShift(week, new Date(perthWallToIso("2026-10-04", "18:50")!))).toMatchObject({
      state: "next",
      shift: { id: week[0]!.id },
    });
    expect(leadShift(week, new Date(perthWallToIso("2026-10-09", "23:40")!))).toMatchObject({
      state: "on_now",
      shift: { id: week[3]!.id },
    });
    // During Wednesday's leave the next duty leads, not the leave.
    expect(leadShift(week, new Date(perthWallToIso("2026-10-07", "10:00")!))).toMatchObject({
      state: "next",
      shift: { id: week[3]!.id },
    });
    expect(leadShift([], new Date())).toEqual({ state: "none" });
  });

  it("writes times until and relative days plainly", () => {
    expect(formatSpanUntil(19 * 3_600_000 + 10 * 60_000)).toBe("19 h 10 min");
    expect(formatSpanUntil(45 * 60_000)).toBe("45 min");
    expect(formatSpanUntil(-5)).toBe("0 min");
    expect(relativeDay("2026-10-05", "2026-10-04")).toBe("tomorrow");
    expect(relativeDay("2026-10-04", "2026-10-04")).toBe("today");
    expect(relativeDay("2026-10-09", "2026-10-04")).toBe("Fri 9");
    expect(formatSpanWords("2026-10-05", "2026-10-11")).toBe("5 to 11 Oct");
    expect(formatSpanWords("2026-09-28", "2026-10-11")).toBe("28 Sep to 11 Oct");
  });

  it("draws one row per day, says off, and notes a night that ended that morning", () => {
    const rows = weekRows(week, "2026-10-05");
    expect(rows.map((row) => `${row.weekday} ${row.day}`)).toEqual([
      "Mon 5",
      "Tue 6",
      "Wed 7",
      "Thu 8",
      "Fri 9",
      "Sat 10",
      "Sun 11",
    ]);
    expect(rows[3]).toMatchObject({ shifts: [], offNote: null });
    expect(rows[5]).toMatchObject({ shifts: [], offNote: "Night shift ends 08:00" });
    expect(weekCountWords(rows)).toBe("3 shifts and 1 on call");
    expect(weekCountWords(weekRows([], "2026-10-05"))).toBe("No shifts");
  });

  it("leads with on call that is running now, not the shift after it", () => {
    const shifts = [at("2026-10-11", "21:00", "08:00", "on_call"), at("2026-10-12", "08:30", "17:00", "day")];
    expect(leadShift(shifts, new Date(perthWallToIso("2026-10-12", "02:00")!))).toMatchObject({
      state: "on_now",
      shift: { id: shifts[0]!.id },
    });
  });

  it("says what is still running on a day with nothing starting", () => {
    const longCall = {
      id: "call",
      startsAt: perthWallToIso("2026-10-05", "17:00")!,
      endsAt: perthWallToIso("2026-10-08", "08:00")!,
      kind: "on_call" as const,
      place: null,
    };
    const leave = {
      id: "leave",
      startsAt: perthWallToIso("2026-10-09", "00:00")!,
      endsAt: perthWallToIso("2026-10-12", "00:00")!,
      kind: "leave" as const,
      place: null,
    };
    const rows = weekRows([longCall, leave], "2026-10-05");
    expect(rows.map((row) => row.offNote)).toEqual([
      null,
      "On call all day",
      "On call all day",
      "On call ends 08:00",
      null,
      "On leave",
      "On leave",
    ]);
    // Leave ending at midnight does not reach the next Monday.
    expect(weekRows([leave], "2026-10-12")[0]!.offNote).toBeNull();
  });
});
