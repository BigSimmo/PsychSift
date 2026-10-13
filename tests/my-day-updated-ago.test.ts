import { describe, expect, it } from "vitest";

import { myDayUpdatedAgo } from "@/components/my-day/my-day-page-parts";

// Ward Flow review item 5 (owner approved 12 Oct 2026): My Day says how old its data is.
describe("myDayUpdatedAgo", () => {
  const at = Date.parse("2026-10-13T02:05:00Z");
  const after = (minutes: number) => new Date(at + minutes * 60_000);

  it("says just now inside the first minute", () => {
    expect(myDayUpdatedAgo(after(0), at, "10:05")).toBe("just now");
    expect(myDayUpdatedAgo(new Date(at + 59_000), at, "10:05")).toBe("just now");
  });

  it("counts minutes up to the hour", () => {
    expect(myDayUpdatedAgo(after(1), at, "10:05")).toBe("1 min ago");
    expect(myDayUpdatedAgo(after(59), at, "10:05")).toBe("59 min ago");
  });

  it("gives the clock time and date once the data is an hour old", () => {
    expect(myDayUpdatedAgo(after(60), at, "10:05")).toBe("at 10:05, Tue 13 Oct");
    // A day later the date is what tells yesterday's 10:05 apart from today's.
    expect(myDayUpdatedAgo(after(24 * 60), at, "10:05")).toBe("at 10:05, Tue 13 Oct");
    // The time comes from the recorded moment, not a clock string captured earlier (maybe in another zone).
    expect(myDayUpdatedAgo(after(60), at, null)).toBe("at 10:05, Tue 13 Oct");
    expect(myDayUpdatedAgo(after(60), at, "stale")).toBe("at 10:05, Tue 13 Oct");
  });

  it("dates the moment on the Perth calendar, not UTC", () => {
    // 23:30 Perth on Mon 12 Oct is still 12 Oct, though it is 15:30Z.
    const late = Date.parse("2026-10-12T15:30:00Z");
    expect(myDayUpdatedAgo(new Date(late + 90 * 60_000), late, "23:30")).toBe("at 23:30, Mon 12 Oct");
    // 07:30 Perth on Tue 13 Oct is 23:30Z on 12 Oct.
    const early = Date.parse("2026-10-12T23:30:00Z");
    expect(myDayUpdatedAgo(new Date(early + 90 * 60_000), early, "07:30")).toBe("at 07:30, Tue 13 Oct");
  });

  it("falls back to the clock time, or just now, with no moment recorded", () => {
    expect(myDayUpdatedAgo(after(5), null, "10:05")).toBe("at 10:05");
    expect(myDayUpdatedAgo(after(5), null, null)).toBe("just now");
  });
});
