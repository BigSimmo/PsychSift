// tests/caring-contacts-clock.test.ts
import { describe, expect, it } from "vitest";

import { AWST_TIME_ZONE, awstCalendarDay, fixedClock, toAwstParts } from "@/lib/caring-contacts/clock";

describe("caring-contacts clock", () => {
  it("is fixed and repeatable", () => {
    const clock = fixedClock("2026-08-19T02:00:00.000Z");
    expect(clock.now().toISOString()).toBe("2026-08-19T02:00:00.000Z");
    expect(clock.now().toISOString()).toBe("2026-08-19T02:00:00.000Z");
  });

  it("uses AWST with no daylight saving in either half of the year", () => {
    expect(AWST_TIME_ZONE).toBe("Australia/Perth");
    // 02:00 UTC is 10:00 AWST in both January and July — Perth does not observe DST.
    expect(toAwstParts(new Date("2026-01-15T02:00:00.000Z")).hour).toBe(10);
    expect(toAwstParts(new Date("2026-07-15T02:00:00.000Z")).hour).toBe(10);
  });

  it("derives the AWST calendar day across the UTC date boundary", () => {
    // 20:00 UTC on the 18th is 04:00 AWST on the 19th.
    expect(awstCalendarDay(new Date("2026-08-18T20:00:00.000Z"))).toBe("2026-08-19");
  });
});
