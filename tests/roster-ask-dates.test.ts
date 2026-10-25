import { describe, expect, it } from "vitest";

import { readDates } from "@/lib/roster/ask/dates";

describe("Ask Roster dates", () => {
  it("rolls an unqualified date to the next year in Perth", () => {
    expect(readDates("14 Dec", "2026-12-20")).toEqual({ dates: [{ from: "2027-12-14", to: "2027-12-14" }] });
  });

  it("reads numeric dates as day then month", () => {
    expect(readDates("3/4", "2026-01-01")).toEqual({ dates: [{ from: "2026-04-03", to: "2026-04-03" }] });
  });

  it("refuses a past date with an explicit year", () => {
    expect(readDates("14 Dec 2025", "2026-10-01")).toEqual({ blocked: "past" });
  });

  it("asks when the weekday and date disagree", () => {
    expect(readDates("Tue 15 Oct", "2026-10-01")).toEqual({ blocked: "weekday_mismatch" });
  });

  it("offers both meanings of next Friday", () => {
    expect(readDates("next Friday", "2026-10-15")).toMatchObject({
      options: [{ from: "2026-10-16" }, { from: "2026-10-23" }],
    });
  });

  it("reads a same-month range without using the device timezone", () => {
    expect(readDates("12-16 Oct", "2026-10-01")).toEqual({ dates: [{ from: "2026-10-12", to: "2026-10-16" }] });
  });

  it("asks about a reversed range instead of saying it has passed", () => {
    expect(readDates("28-3 Nov", "2026-10-24")).toEqual({ ask: "Which dates do you mean?", options: [] });
  });
});
