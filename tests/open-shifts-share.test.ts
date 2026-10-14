import { describe, expect, it } from "vitest";

import { toIcs } from "@/lib/calendar/ics";
import { openShiftCalendarEvent, openShiftShareText } from "@/lib/open-shifts/share";

const night = {
  id: "shift-1",
  // Tue 13 Oct 2026, 21:30 to 08:00 Perth (UTC+8).
  startsAt: "2026-10-13T13:30:00.000Z",
  endsAt: "2026-10-14T00:00:00.000Z",
  minGrade: "registrar" as const,
  kind: "night" as const,
  siteName: "Example Health Campus",
  teamName: "Example Mental Health Team",
  urgent: true,
};

describe("openShiftShareText", () => {
  it("says the shift, day, times, hours and place in plain words", () => {
    expect(openShiftShareText(night)).toBe(
      "Open shift (urgent): Registrar · Night shift, Tue 13 Oct, 21:30 to 08:00 next day (10.5 h), Example Health Campus · Example Mental Health Team.\nRequest it in PsychSift, Roster, Open shifts.",
    );
  });

  it("adds the link on its own line when given", () => {
    expect(openShiftShareText({ ...night, urgent: false }, "https://example.test/x").split("\n")).toEqual([
      expect.stringMatching(/^Open shift: /),
      "Request it in PsychSift, Roster, Open shifts.",
      "https://example.test/x",
    ]);
  });
});

describe("openShiftCalendarEvent", () => {
  it("is a timed Perth event with a stable id that runs past midnight", () => {
    const event = openShiftCalendarEvent(night);
    expect(event).toMatchObject({
      id: "psychsift-open-shift-shift-1",
      date: "2026-10-13",
      startTime: "21:30",
      durationMinutes: 630,
      location: "Example Health Campus · Example Mental Health Team",
    });
    const ics = toIcs([event], { now: new Date("2026-10-12T00:00:00Z") });
    expect(ics).toContain("UID:psychsift-open-shift-shift-1");
    expect(ics).not.toMatch(/VALARM/);
  });
});
