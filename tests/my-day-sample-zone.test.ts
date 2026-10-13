// The My Day sample is one invented day in the reader's work zone: teaching and roster
// both land on that zone's today at their own wall times, even when Perth's date differs.

import { describe, expect, it } from "vitest";

import { buildMyDaySample } from "@/components/my-day/my-day-sample";
import { zonedDateOf, zonedTimeOf } from "@/lib/work-time/format";

const PERTH = "Australia/Perth";
const SYDNEY = "Australia/Sydney";
// 22:30 on Sat 3 Oct in Perth, 01:30 on Sun 4 Oct in Sydney.
const NOW = new Date("2026-10-03T14:30:00Z");

const wall = (instant: string, zone: string) => `${zonedDateOf(instant, zone)} ${zonedTimeOf(instant, zone)}`;
const nextDay = (text: string) => {
  const [date, time] = text.split(" ");
  const moved = new Date(`${date}T00:00:00Z`);
  moved.setUTCDate(moved.getUTCDate() + 1);
  return `${moved.toISOString().slice(0, 10)} ${time}`;
};

describe("buildMyDaySample in a work zone far from Perth", () => {
  it("puts today's teaching on the zone's today at its wall time", () => {
    const today = zonedDateOf(NOW, SYDNEY);
    expect(today).toBe("2026-10-04");
    const sample = buildMyDaySample(today, NOW, SYDNEY);
    const first = sample.sources.teaching.ahead?.[0];
    expect(first && wall(first.startsAt, SYDNEY)).toBe("2026-10-04 14:00");
    expect(sample.sources.teaching.sessions.map((session) => session.title)).toEqual([
      "Registrar teaching: agitation",
    ]);
  });

  it("moves the example roster onto the zone's today at the same wall times", () => {
    const perth = buildMyDaySample(zonedDateOf(NOW, PERTH), NOW, PERTH).sources.roster.shifts;
    const sydney = buildMyDaySample(zonedDateOf(NOW, SYDNEY), NOW, SYDNEY).sources.roster.shifts;
    expect(sydney.length).toBe(perth.length);
    expect(sydney.length).toBeGreaterThan(0);
    sydney.forEach((shift, index) => {
      expect(wall(shift.startsAt, SYDNEY)).toBe(nextDay(wall(perth[index].startsAt, PERTH)));
      expect(wall(shift.endsAt, SYDNEY)).toBe(nextDay(wall(perth[index].endsAt, PERTH)));
    });
  });

  it("leaves Perth's sample unchanged by default", () => {
    const today = zonedDateOf(NOW, PERTH);
    expect(buildMyDaySample(today, NOW)).toEqual(buildMyDaySample(today, NOW, PERTH));
  });
});
