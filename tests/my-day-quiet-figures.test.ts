import { describe, expect, it } from "vitest";

import type { MyDayItem } from "@/lib/my-day/model";
import {
  codeKey,
  dayCode,
  durationWords,
  fullDate,
  heroTrack,
  heroWords,
  itemLine,
  listWords,
  relativeDays,
  reminderLine,
  weekRows,
} from "@/lib/my-day/quiet-figures";

// Sunday 4 October 2026, 18:50 in Perth (UTC+8).
const EVENING = new Date("2026-10-04T10:50:00Z");
const TODAY = "2026-10-04";

const onCall = {
  kind: "on_call" as const,
  startsAt: "2026-10-04T13:00:00Z", // Sun 21:00
  endsAt: "2026-10-05T00:00:00Z", // Mon 08:00
  place: "Example Hospital",
};

function item(overrides: Partial<MyDayItem> & { id: string }): MyDayItem {
  return { mode: "my-work", title: `Title ${overrides.id}`, due: null, severity: "info", href: "/admin", ...overrides };
}

describe("words for dates and durations", () => {
  it("says durations the way the mock-up does, never below a minute", () => {
    expect(durationWords(130 * 60_000)).toEqual({ short: "2 h 10 min", spoken: "2 hours 10 minutes" });
    expect(durationWords(45 * 60_000).short).toBe("45 min");
    expect(durationWords(60 * 60_000).short).toBe("1 h");
    expect(durationWords(27 * 3_600_000).short).toBe("1 d 3 h");
    expect(durationWords(0).short).toBe("1 min");
  });

  it("counts whole Perth days", () => {
    expect(relativeDays("2026-10-04", TODAY)).toBe("today");
    expect(relativeDays("2026-10-05", TODAY)).toBe("tomorrow");
    expect(relativeDays("2026-11-14", TODAY)).toBe("in 41 days");
    expect(relativeDays("2026-09-15", TODAY)).toBe("19 days ago");
    expect(fullDate("2026-11-14")).toBe("Sat 14 Nov 2026");
  });

  it("joins words as a sentence", () => {
    expect(listWords(["Tue"])).toBe("Tue");
    expect(listWords(["Tue", "Wed", "Thu"])).toBe("Tue, Wed and Thu");
  });
});

describe("the blue card", () => {
  it("counts down to tonight's on call with the shift's own times", () => {
    expect(heroWords(onCall, false, EVENING)).toEqual({
      eyebrow: "On call tonight",
      big: "Starts in 2 h 10 min",
      sub: "Sun 21:00 to Mon 08:00 · Example Hospital",
      spoken: "On call tonight, starts in 2 hours 10 minutes, Sun 21:00 to Mon 08:00, Example Hospital.",
    });
  });

  it("counts a running on call down to handover", () => {
    const at = new Date("2026-10-04T19:10:00Z"); // Mon 03:10
    const words = heroWords(onCall, true, at);
    expect(words.eyebrow).toBe("On call now");
    expect(words.big).toBe("4 h 50 min left");
    expect(words.sub).toBe("Until 08:00 handover · started Sun 21:00");
  });

  it("draws the line to scale, the shift filled and now marked", () => {
    const track = heroTrack(onCall, false, EVENING);
    // From 18:00 (the start of this hour) to 08:00: 14 hours, the shift starting 3 hours in.
    expect(track.fillFrom).toBeCloseTo((3 / 14) * 100, 5);
    expect(track.fillTo).toBe(100);
    expect(track.now).toBeCloseTo((50 / 60 / 14) * 100, 5);
    expect(track.ticks.map((tick) => tick.label)).toEqual(["18:00", "21:00", "Mon 08:00"]);
  });

  it("drops a middle label that would sit on an end label", () => {
    const soon = { ...onCall, startsAt: "2026-10-04T11:00:00Z" }; // 19:00, ten minutes away
    expect(heroTrack(soon, false, EVENING).ticks.map((tick) => tick.label)).toEqual(["18:00", "Mon 08:00"]);
  });
});

describe("rows that need the reader", () => {
  it("puts how late an item is in amber and says Date passed for Admin", () => {
    expect(itemLine(item({ id: "a", severity: "overdue", due: "2026-09-23" }), TODAY)).toEqual({
      late: "Date passed 11 days",
      rest: "was due Wed 23 Sep · Admin",
    });
    expect(itemLine(item({ id: "c", mode: "cme", severity: "overdue", due: "2026-09-15" }), TODAY).late).toBe(
      "Overdue 19 days",
    );
  });

  it("gives an upcoming date and how far off it is", () => {
    expect(itemLine(item({ id: "w", severity: "soon", due: "2026-11-14" }), TODAY)).toEqual({
      late: null,
      rest: "Due 14 Nov · in 41 days · Admin",
    });
    expect(itemLine(item({ id: "t", severity: "soon", due: "2026-10-04T09:00:00Z" }), TODAY).rest).toBe(
      "Due 17:00 today · Admin",
    );
  });

  it("says which reminder of how many", () => {
    const reminder = item({ id: "j", mode: "cme", severity: "overdue", due: "2026-09-15" });
    expect(reminderLine(reminder, TODAY, 1, 3)).toBe("CPD · 19 days ago · 1 of 3 reminders");
    expect(reminderLine(reminder, TODAY, 1, 1)).toBe("CPD · 19 days ago");
  });
});

describe("This week", () => {
  const day = (id: string, date: string) => ({
    id,
    kind: "day" as const,
    startsAt: `${date}T00:00:00Z`,
    endsAt: `${date}T09:00:00Z`,
  });

  it("keeps tonight's on call on its own and folds same-hours day shifts together", () => {
    const rows = weekRows(
      [{ id: "oc", ...onCall }, day("a", "2026-10-06"), day("b", "2026-10-07"), day("c", "2026-10-08")],
      [
        {
          id: "s",
          title: "Case presentation",
          startsAt: "2026-10-06T04:30:00Z",
          endsAt: "2026-10-06T05:30:00Z",
          venue: "Seminar Room 1",
          isPresenter: true,
          href: "/teaching/session/s",
        },
      ],
      TODAY,
      EVENING,
    );
    expect(rows.map((row) => [row.title, row.subtitle])).toEqual([
      ["On call", "Tonight 21:00 to Mon 08:00 · Roster"],
      ["Day shifts", "Tue, Wed and Thu · 08:00 to 17:00 · Roster"],
      ["Case presentation", "Tue 12:30 · Seminar Room 1 · you lead · Teaching"],
    ]);
  });

  it("writes a running shift that ends today without a weekday", () => {
    const running = { id: "d", kind: "day" as const, startsAt: "2026-10-04T00:00:00Z", endsAt: "2026-10-04T12:00:00Z" };
    expect(weekRows([running], [], TODAY, EVENING)[0]!.subtitle).toBe("Now, until 20:00 · Roster");
  });

  it("codes each day by its strongest shift and keys only the codes shown", () => {
    expect(dayCode(["day", "on_call"])).toBe("on_call");
    expect(dayCode(["leave"])).toBe("leave");
    expect(dayCode([])).toBeNull();
    expect(codeKey(["on_call", null, "day", "day"])).toBe("D day shift · OC on call");
  });
});
