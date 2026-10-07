import { afterEach, describe, expect, it, vi } from "vitest";

import { APP_PREFERENCES_STORAGE_KEY } from "@/lib/account-scoped-browser-state";
import { formatClockRange, formatClockTime, perthHour } from "@/lib/clock-time";
import {
  formatOnCallDate,
  formatOnCallDateTime,
  formatOnCallShortDay,
  formatOnCallTime,
  formatOnCallTimeRange,
  onCallAgo,
} from "@/lib/on-call/display-dates";
import { perthCalendarDate, perthDateOf, perthTimeOf, perthWallToIso } from "@/lib/perth-time";
import * as rosterTime from "@/lib/roster/shifts/perth-time";
import { formatSessionTime, perthDate, perthInstant, perthTime, perthToday } from "@/lib/teaching/time";

/**
 * The shared "Perth" helpers read the WORK time zone: Perth by default and on
 * the server, the saved choice on a phone, an explicit `zone` when passed, and
 * never the device's own zone.
 */

const SYDNEY = "Australia/Sydney";
// 23:30 Saturday 12 Sep 2026 in Perth; 01:30 Sunday 13 Sep in Sydney (AEST, UTC+10).
const LATE = "2026-09-12T15:30:00.000Z";
// 19:00 Perth / 21:00 Sydney on the 12th, to 23:00 Perth / 01:00 Sydney on the 13th.
const START = "2026-09-12T11:00:00.000Z";
const END = "2026-09-12T15:00:00.000Z";
// 08:00 Perth, 11:00 Sydney summer time (AEDT, UTC+11), 1 Dec 2026.
const SUMMER = "2026-12-01T00:00:00.000Z";

function inTimeZone<T>(zone: string, fn: () => T): T {
  const previous = process.env.TZ;
  process.env.TZ = zone;
  try {
    return fn();
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
}

function saveZone(zone: string) {
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => (key === APP_PREFERENCES_STORAGE_KEY ? JSON.stringify({ timeZone: zone }) : null),
    },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("@/lib/perth-time", () => {
  it("defaults to Perth with no window (the server), whatever the device zone", () => {
    expect(typeof window).toBe("undefined");
    inTimeZone("America/New_York", () => {
      expect(perthCalendarDate(LATE)).toBe("2026-09-12");
      expect(perthDateOf(LATE)).toBe("2026-09-12");
      expect(perthTimeOf(LATE)).toBe("23:30");
      expect(perthWallToIso("2026-12-01", "08:00")).toBe(SUMMER);
    });
  });

  it("reads an explicit Sydney zone, daylight saving included", () => {
    expect(perthDateOf(LATE, SYDNEY)).toBe("2026-09-13");
    expect(perthTimeOf(LATE, SYDNEY)).toBe("01:30");
    expect(perthTimeOf(SUMMER, SYDNEY)).toBe("11:00");
    expect(perthWallToIso("2026-12-01", "11:00", SYDNEY)).toBe(SUMMER);
    // 02:30 on 4 Oct 2026 does not exist in Sydney: the clock jumps from 02:00 to 03:00.
    expect(perthWallToIso("2026-10-04", "02:30", SYDNEY)).toBeNull();
    expect(perthWallToIso("2026-10-04", "02:30")).not.toBeNull();
  });

  it("reads and writes on the same clock: a typed 08:00 shows as 08:00 in every zone", () => {
    for (const zone of ["Australia/Perth", SYDNEY, "Australia/Adelaide", "Australia/Darwin"]) {
      const iso = perthWallToIso("2026-12-01", "08:00", zone)!;
      expect(perthTimeOf(iso, zone)).toBe("08:00");
      expect(perthDateOf(iso, zone)).toBe("2026-12-01");
    }
  });

  it("a saved Sydney choice moves the default", () => {
    saveZone(SYDNEY);
    expect(perthDateOf(LATE)).toBe("2026-09-13");
    expect(perthTimeOf(SUMMER)).toBe("11:00");
    expect(perthWallToIso("2026-12-01", "11:00")).toBe(SUMMER);
  });

  it("an unknown zone reads as Perth", () => {
    expect(perthTimeOf(LATE, "Mars/Olympus")).toBe("23:30");
    expect(perthWallToIso("2026-12-01", "08:00", "Mars/Olympus")).toBe(SUMMER);
  });

  it("the roster wrapper passes the zone through, and leaving it out takes the default", () => {
    expect(rosterTime.perthDateOf(LATE)).toBe("2026-09-12");
    expect(rosterTime.perthDateOf(LATE, SYDNEY)).toBe("2026-09-13");
    expect(rosterTime.perthTimeOf(LATE, SYDNEY)).toBe("01:30");
    expect(rosterTime.perthCalendarDate(LATE, SYDNEY)).toBe("2026-09-13");
    expect(rosterTime.perthWallToIso("2026-12-01", "11:00", SYDNEY)).toBe(SUMMER);
    saveZone(SYDNEY);
    expect(rosterTime.perthTimeOf(LATE)).toBe("01:30");
  });
});

describe("@/lib/clock-time", () => {
  it("Perth by default, Sydney when passed or saved", () => {
    expect(formatClockTime(SUMMER)).toBe("08:00");
    expect(formatClockTime(SUMMER, SYDNEY)).toBe("11:00");
    expect(formatClockRange(START, END)).toBe("19:00–23:00");
    expect(formatClockRange(START, END, SYDNEY)).toBe("21:00–01:00 +1");
    expect(perthHour(new Date(SUMMER))).toBe(8);
    expect(perthHour(new Date(SUMMER), SYDNEY)).toBe(11);
    saveZone(SYDNEY);
    expect(formatClockTime(SUMMER)).toBe("11:00");
  });

  it("keeps midnight as 00:00", () => {
    expect(formatClockTime("2026-09-12T16:00:00.000Z")).toBe("00:00");
  });
});

describe("@/lib/on-call/display-dates", () => {
  it("Perth by default, whatever the device zone", () => {
    inTimeZone(SYDNEY, () => {
      expect(formatOnCallDate(LATE)).toBe("12 Sep 2026");
      expect(formatOnCallDateTime(LATE)).toBe("12 Sep 2026, 11:30 pm");
      expect(formatOnCallShortDay(LATE)).toBe("Sat 12 Sep");
      expect(formatOnCallTime(LATE)).toBe("23:30");
      expect(formatOnCallTimeRange(START, END)).toEqual({ range: "19:00–23:00", nextDay: false });
      expect(onCallAgo("2026-09-12T12:00:00.000Z", new Date(LATE))).toBe("today");
    });
  });

  it("an explicit Sydney zone moves the day and the clock", () => {
    expect(formatOnCallDate(LATE, SYDNEY)).toBe("13 Sep 2026");
    expect(formatOnCallDateTime(LATE, SYDNEY)).toBe("13 Sep 2026, 1:30 am");
    expect(formatOnCallShortDay(LATE, SYDNEY)).toBe("Sun 13 Sep");
    expect(formatOnCallTime(SUMMER, SYDNEY)).toBe("11:00");
    expect(formatOnCallTimeRange(START, END, SYDNEY)).toEqual({ range: "21:00–01:00", nextDay: true });
    expect(onCallAgo("2026-09-12T12:00:00.000Z", new Date(LATE), SYDNEY)).toBe("yesterday");
  });

  it("a saved Sydney choice moves the default", () => {
    saveZone(SYDNEY);
    expect(formatOnCallTime(LATE)).toBe("01:30");
    expect(formatOnCallShortDay(LATE)).toBe("Sun 13 Sep");
  });
});

describe("@/lib/teaching/time", () => {
  it("Perth by default, whatever the device zone", () => {
    inTimeZone("America/Los_Angeles", () => {
      expect(perthDate(LATE)).toBe("2026-09-12");
      expect(perthTime(LATE)).toBe("23:30");
      expect(perthToday(new Date(LATE))).toBe("2026-09-12");
      expect(perthInstant("2026-12-01", "08:00")).toBe(SUMMER);
      expect(formatSessionTime(START, END)).toBe("Sat 12 Sep, 19:00 to 23:00");
    });
  });

  it("an explicit Sydney zone, with the daylight-saving gap refused", () => {
    expect(perthDate(LATE, SYDNEY)).toBe("2026-09-13");
    expect(perthTime(SUMMER, SYDNEY)).toBe("11:00");
    expect(perthToday(new Date(LATE), SYDNEY)).toBe("2026-09-13");
    expect(perthInstant("2026-12-01", "11:00", SYDNEY)).toBe(SUMMER);
    expect(() => perthInstant("2026-10-04", "02:30", SYDNEY)).toThrow(RangeError);
    expect(() => perthInstant("2026-02-30", "08:00", SYDNEY)).toThrow(RangeError);
    expect(formatSessionTime(START, END, SYDNEY)).toBe("Sat 12 Sep, 21:00 to Sun 13 Sep, 01:00");
  });

  it("a saved Sydney choice moves the default", () => {
    saveZone(SYDNEY);
    expect(perthToday(new Date(LATE))).toBe("2026-09-13");
    expect(perthInstant("2026-12-01", "11:00")).toBe(SUMMER);
  });
});
