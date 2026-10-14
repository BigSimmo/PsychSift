import { describe, expect, it } from "vitest";

import { rosterShareText, type ShareShift } from "@/lib/roster/share-text";
import { perthWallToIso } from "@/lib/roster/shifts/perth-time";

/* Plain-text share of the reader's own shifts. Every place is invented. */

function shift(
  kind: ShareShift["kind"],
  date: string,
  start: string,
  endDate: string,
  end: string,
  location: string | null = null,
): ShareShift {
  return {
    startsAt: perthWallToIso(date, start)!,
    endsAt: perthWallToIso(endDate, end)!,
    title: "Ward round",
    kind,
    location,
    workplace: null,
  };
}

// 08:00 Perth on Thu 1 Oct 2026.
const from = new Date(perthWallToIso("2026-10-01", "08:00")!);

describe("rosterShareText", () => {
  it("lists a week with kinds, Perth times, places and grouped days off", () => {
    const text = rosterShareText(
      [
        shift("on_call", "2026-10-01", "08:00", "2026-10-01", "17:00", "Example Hospital"),
        shift("night", "2026-10-02", "21:30", "2026-10-03", "08:00"),
        shift("day", "2026-10-06", "08:00", "2026-10-06", "16:30", "Example Clinic"),
      ],
      { from, days: 7 },
    );
    expect(text.split("\n")).toEqual([
      "My shifts, Thu 1 Oct – Wed 7 Oct",
      "Thu 1 Oct · On call 08:00–17:00 · Example Hospital",
      "Fri 2 Oct · Night 21:30–08:00 +1",
      "Sat 3 – Mon 5 Oct · Off",
      "Tue 6 Oct · Day 08:00–16:30 · Example Clinic",
      "Wed 7 Oct · Off",
    ]);
  });

  it("covers 14 days, names the person, spans months and leaves out shifts outside the window", () => {
    const start = new Date(perthWallToIso("2026-09-28", "12:00")!);
    const text = rosterShareText(
      [
        shift("day", "2026-09-27", "08:00", "2026-09-27", "16:00"),
        shift("leave", "2026-10-01", "08:00", "2026-10-01", "16:30"),
        shift("day", "2026-10-12", "08:00", "2026-10-12", "16:00"),
      ],
      { from: start, days: 14, name: "Alex" },
    );
    expect(text.split("\n")).toEqual([
      "Shifts for Alex, Mon 28 Sep – Sun 11 Oct",
      "Mon 28 – Wed 30 Sep · Off",
      "Thu 1 Oct · Leave 08:00–16:30",
      "Fri 2 – Sun 11 Oct · Off",
    ]);
  });

  it("names both months when days off cross a month", () => {
    const start = new Date(perthWallToIso("2026-09-28", "12:00")!);
    const text = rosterShareText([shift("day", "2026-09-28", "08:00", "2026-09-28", "16:00")], {
      from: start,
      days: 7,
    });
    expect(text.split("\n")[2]).toBe("Tue 29 Sep – Sun 4 Oct · Off");
  });

  it("infers a missing kind and does not mark a shift ending at midnight as next day", () => {
    const text = rosterShareText([{ ...shift(null, "2026-10-01", "16:00", "2026-10-02", "00:00"), title: "Evening" }], {
      from,
      days: 7,
    });
    expect(text.split("\n")[1]).toBe("Thu 1 Oct · Late 16:00–00:00");
  });

  it("never shares a shift title", () => {
    const text = rosterShareText([shift("day", "2026-10-01", "08:00", "2026-10-01", "16:00")], { from, days: 7 });
    expect(text).not.toContain("Ward round");
  });
});
