import { describe, expect, it } from "vitest";

import {
  formatZonedDay,
  formatZonedRange,
  zoneOffsetMinutes,
  zoneShort,
  zonedDateOf,
  zonedTimeOf,
  zonedToday,
  zonedWallToIso,
} from "@/lib/work-time/format";
import { DEFAULT_WORK_TIME_ZONE, WORK_TIME_ZONES, isWorkTimeZone, workTimeZoneLabel } from "@/lib/work-time/zones";

describe("work time zones", () => {
  it("defaults to Perth and only accepts the listed Australian zones", () => {
    expect(DEFAULT_WORK_TIME_ZONE).toBe("Australia/Perth");
    expect(WORK_TIME_ZONES[0]?.id).toBe("Australia/Perth");
    expect(isWorkTimeZone("Australia/Sydney")).toBe(true);
    expect(isWorkTimeZone("Europe/London")).toBe(false);
    expect(isWorkTimeZone(undefined)).toBe(false);
    expect(workTimeZoneLabel("Nowhere/Else")).toBe("Perth");
  });
});

describe("zoned dates and times ignore the device zone", () => {
  // 2026-10-06T23:30Z is 07:30 on 7 Oct in Perth and 10:30 on 7 Oct in Sydney (daylight time from 4 Oct).
  const instant = "2026-10-06T23:30:00Z";

  it("reads the date and time in the named zone", () => {
    expect(zonedDateOf(instant, "Australia/Perth")).toBe("2026-10-07");
    expect(zonedTimeOf(instant, "Australia/Perth")).toBe("07:30");
    expect(zonedTimeOf(instant, "Australia/Sydney")).toBe("10:30");
    expect(zonedTimeOf(instant, "Australia/Brisbane")).toBe("09:30");
  });

  it("puts a late-evening UTC instant on the next Perth day", () => {
    expect(zonedDateOf("2026-10-06T16:00:00Z", "Australia/Perth")).toBe("2026-10-07");
    expect(zonedDateOf("2026-10-06T15:59:00Z", "Australia/Perth")).toBe("2026-10-06");
    expect(zonedToday("Australia/Perth", Date.parse("2026-10-06T16:00:00Z"))).toBe("2026-10-07");
  });

  it("falls back to Perth for an unknown zone", () => {
    expect(zonedTimeOf(instant, "Mars/Olympus")).toBe("07:30");
  });

  it("throws on an invalid instant, like perth-time", () => {
    expect(() => zonedDateOf("not a date", "Australia/Perth")).toThrow();
  });

  it("knows daylight saving offsets", () => {
    expect(zoneOffsetMinutes("2026-07-01T00:00:00Z", "Australia/Perth")).toBe(480);
    expect(zoneOffsetMinutes("2026-07-01T00:00:00Z", "Australia/Sydney")).toBe(600);
    expect(zoneOffsetMinutes("2026-12-01T00:00:00Z", "Australia/Sydney")).toBe(660);
    expect(zoneOffsetMinutes("2026-12-01T00:00:00Z", "Australia/Adelaide")).toBe(630);
  });
});

describe("zonedWallToIso", () => {
  it("round-trips a Perth shift start", () => {
    expect(zonedWallToIso("2026-10-07", "08:00", "Australia/Perth")).toBe("2026-10-07T00:00:00.000Z");
  });

  it("uses the daylight offset in a Sydney summer", () => {
    expect(zonedWallToIso("2026-12-01", "08:00", "Australia/Sydney")).toBe("2026-11-30T21:00:00.000Z");
    expect(zonedWallToIso("2026-07-01", "08:00", "Australia/Sydney")).toBe("2026-06-30T22:00:00.000Z");
  });

  it("refuses impossible dates, times and the skipped daylight-saving hour", () => {
    expect(zonedWallToIso("2026-02-30", "08:00", "Australia/Perth")).toBeNull();
    expect(zonedWallToIso("2026-10-07", "24:00", "Australia/Perth")).toBeNull();
    expect(zonedWallToIso("2026-10-04", "02:30", "Australia/Sydney")).toBeNull();
  });
});

describe("display helpers", () => {
  it("formats a day and a shift range", () => {
    expect(formatZonedDay("2026-10-07")).toBe("Wed 7 Oct");
    expect(formatZonedRange("2026-10-07T00:00:00Z", "2026-10-07T08:30:00Z", "Australia/Perth")).toBe("08:00 to 16:30");
  });

  it("names the zone, with daylight time in summer", () => {
    expect(zoneShort("Australia/Perth", "2026-07-01T00:00:00Z")).toBe("AWST");
    expect(zoneShort("Australia/Sydney", "2026-12-01T00:00:00Z")).toBe("AEDT");
    expect(zoneShort("Australia/Brisbane", "2026-12-01T00:00:00Z")).toBe("AEST");
  });
});
