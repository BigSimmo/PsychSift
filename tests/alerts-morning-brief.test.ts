import { describe, expect, it } from "vitest";

import { briefIsDue, morningBriefTime, type BriefShift } from "@/lib/alerts/morning-brief";
import { DEFAULT_REMINDER_SETTINGS } from "@/lib/reminders/settings";

const BRIEF = { enabled: true, workday: "07:00", dayOff: "09:00" };
const NO_QUIET = DEFAULT_REMINDER_SETTINGS.quietHours;
const DAY = "2026-10-07";

/** Perth wall time on a date, as an ISO instant (Perth is UTC+8). */
const perth = (date: string, time: string) => new Date(`${date}T${time}:00+08:00`).toISOString();
const shift = (startDate: string, start: string, endDate: string, end: string, kind: string | null): BriefShift => ({
  startsAt: perth(startDate, start),
  endsAt: perth(endDate, end),
  kind,
});

describe("morning brief time", () => {
  it("goes at the day-off time with no shift", () => {
    expect(morningBriefTime(BRIEF, NO_QUIET, DAY, [])).toEqual({ at: new Date(perth(DAY, "09:00")), kind: "day-off" });
  });

  it("goes at the workday time on a day with a shift, but not for leave", () => {
    expect(morningBriefTime(BRIEF, NO_QUIET, DAY, [shift(DAY, "08:00", DAY, "16:30", "day")])?.kind).toBe("workday");
    expect(morningBriefTime(BRIEF, NO_QUIET, DAY, [shift(DAY, "00:00", DAY, "23:59", "leave")])?.kind).toBe("day-off");
  });

  it("waits until 14:00 after a night shift (owner decision 3)", () => {
    const night = shift("2026-10-06", "21:30", DAY, "08:00", "night");
    expect(morningBriefTime(BRIEF, NO_QUIET, DAY, [night])).toEqual({
      at: new Date(perth(DAY, "14:00")),
      kind: "after-night",
    });
  });

  it("treats an imported evening-to-morning shift with no kind as a night", () => {
    const night = shift("2026-10-06", "21:00", DAY, "07:30", null);
    expect(morningBriefTime(BRIEF, NO_QUIET, DAY, [night])?.kind).toBe("after-night");
  });

  it("keeps a chosen time already later than 14:00 after a night", () => {
    const night = shift("2026-10-06", "21:30", DAY, "08:00", "night");
    const late = { ...BRIEF, dayOff: "15:00" };
    expect(morningBriefTime(late, NO_QUIET, DAY, [night])?.at).toEqual(new Date(perth(DAY, "15:00")));
  });

  it("never breaks through quiet hours: it moves to their end (owner decision 2)", () => {
    const quiet = { enabled: true, start: "21:00", end: "08:00" };
    expect(morningBriefTime(BRIEF, quiet, DAY, [shift(DAY, "08:30", DAY, "17:00", "day")])?.at).toEqual(
      new Date(perth(DAY, "08:00")),
    );
  });

  it("is due from its time for three hours, and not before", () => {
    const time = morningBriefTime(BRIEF, NO_QUIET, DAY, [])!;
    expect(briefIsDue(time, new Date(perth(DAY, "08:59")))).toBe(false);
    expect(briefIsDue(time, new Date(perth(DAY, "09:00")))).toBe(true);
    expect(briefIsDue(time, new Date(perth(DAY, "11:59")))).toBe(true);
    expect(briefIsDue(time, new Date(perth(DAY, "12:00")))).toBe(false);
  });
});
