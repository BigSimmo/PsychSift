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

  it("gives the clock time once the data is an hour old", () => {
    expect(myDayUpdatedAgo(after(60), at, "10:05")).toBe("at 10:05");
    expect(myDayUpdatedAgo(after(60), at, null)).toBe("over an hour ago");
  });

  it("falls back to the clock time, or just now, with no moment recorded", () => {
    expect(myDayUpdatedAgo(after(5), null, "10:05")).toBe("at 10:05");
    expect(myDayUpdatedAgo(after(5), null, null)).toBe("just now");
  });
});
