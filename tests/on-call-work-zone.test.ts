import { afterEach, describe, expect, it, vi } from "vitest";

import { APP_PREFERENCES_STORAGE_KEY } from "@/lib/account-scoped-browser-state";
import { msUntilNextOnCallLocalDay, onCallLocalDateKey, onCallZonedHourStart } from "@/lib/on-call/local-date";
import { isOnCallOutOfHours, msUntilOnCallPeriodChange, onCallPeriod } from "@/lib/on-call/number-resolver";
import { onCallUsualShiftKey } from "@/lib/on-call/recent-storage";
import { msUntilOnCallShiftContextChange, onCallClockPeriod, onCallShiftContext } from "@/lib/on-call/shift-context";
import { isWaPublicHoliday } from "@/lib/on-call/wa-public-holidays";
import { currentWorkYear } from "@/lib/work-time/current-zone";

/**
 * Every on-call "today", in-hours rule and shift key reads the work time zone
 * (Perth unless the doctor chose another), never the phone's own zone. These
 * pin that from the outside: the process is put in another zone and the
 * answers must still be Perth's.
 */

const HOUR = 60 * 60 * 1000;

/** Runs `fn` with the process pinned to `zone`, as tests/teaching-time.test.ts does. */
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

const deviceZones = ["UTC", "Australia/Sydney", "America/New_York", "Pacific/Kiritimati", "Etc/GMT+12"];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a phone in another zone still gets Perth answers", () => {
  // 00:30 Perth on Sunday 13 Sep 2026 is 16:30 UTC on Saturday the 12th.
  const PERTH_0030_SUNDAY = new Date("2026-09-12T16:30:00.000Z");
  // 06:30 Perth on Thursday 17 Sep is 08:30 on a Sydney phone (AEST, UTC+10).
  const PERTH_0630_THURSDAY = new Date("2026-09-16T22:30:00.000Z");

  for (const device of deviceZones) {
    it(`device on ${device}: today is Perth's, across the UTC midnight edge`, () => {
      inTimeZone(device, () => {
        expect(onCallLocalDateKey(PERTH_0030_SUNDAY)).toBe("2026-09-13");
        // 23:30 Perth: half an hour to the next Perth midnight, whatever the phone says.
        expect(msUntilNextOnCallLocalDay(new Date("2026-09-12T15:30:00.000Z"))).toBe(HOUR / 2);
      });
    });

    it(`device on ${device}: in hours is read on Perth's clock`, () => {
      inTimeZone(device, () => {
        expect(isOnCallOutOfHours(PERTH_0630_THURSDAY)).toBe(true);
        expect(onCallPeriod(PERTH_0630_THURSDAY)).toBe("after-hours");
        // 06:30 Perth to 08:00 Perth.
        expect(msUntilOnCallPeriodChange(PERTH_0630_THURSDAY)).toBe(1.5 * HOUR);
        // 00:30 Perth on Sunday is the weekend, though UTC still says Saturday.
        expect(isOnCallOutOfHours(PERTH_0030_SUNDAY)).toBe(true);
      });
    });

    it(`device on ${device}: the WA holiday and the shift key follow Perth's day`, () => {
      inTimeZone(device, () => {
        // 00:30 Perth on Monday 28 Sep 2026 (King's Birthday) is 16:30 UTC on Sunday the 27th.
        expect(isWaPublicHoliday(new Date("2026-09-27T16:30:00.000Z"))).toBe(true);
        // 23:30 Perth on Sunday the 27th is not the holiday.
        expect(isWaPublicHoliday(new Date("2026-09-27T15:30:00.000Z"))).toBe(false);
        // 20:00 Perth on Wednesday 23 Sep: the after-hours shift began at 17:00 Perth (09:00 UTC).
        expect(onCallUsualShiftKey(new Date("2026-09-23T12:00:00.000Z"))).toBe("2026-09-23T09:00:00.000Z");
      });
    });

    it(`device on ${device}: the On Call shift clock is Perth's`, () => {
      inTimeZone(device, () => {
        // 06:30 Perth Thursday: still the night that began on Wednesday the 16th.
        expect(onCallClockPeriod(PERTH_0630_THURSDAY)).toBe("night");
        expect(onCallShiftContext({ shifts: [], pick: null, now: PERTH_0630_THURSDAY }).shiftKey).toBe(
          "clock:2026-09-16:night",
        );
        // Next change is 08:00 Perth, 90 minutes away.
        expect(msUntilOnCallShiftContextChange({ shifts: [], pick: null, now: PERTH_0630_THURSDAY })).toBe(1.5 * HOUR);
      });
    });
  }
});

describe("another work zone, chosen in Settings", () => {
  it("a stored Sydney choice moves the default from Perth to Sydney", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) =>
          key === APP_PREFERENCES_STORAGE_KEY ? JSON.stringify({ timeZone: "Australia/Sydney" }) : null,
      },
    });
    // 22:30 UTC on the 16th is 08:30 Thursday in Sydney and 06:30 in Perth.
    const at = new Date("2026-09-16T22:30:00.000Z");
    expect(onCallLocalDateKey(at)).toBe("2026-09-17");
    expect(isOnCallOutOfHours(at)).toBe(false);
  });

  it("an unknown stored zone falls back to Perth", () => {
    vi.stubGlobal("window", {
      localStorage: { getItem: () => JSON.stringify({ timeZone: "Mars/Olympus" }) },
    });
    expect(isOnCallOutOfHours(new Date("2026-09-16T22:30:00.000Z"))).toBe(true);
  });

  it("Sydney daylight saving: the day it starts is 23 hours long", () => {
    // Sydney moves from 02:00 AEST to 03:00 AEDT on Sunday 4 Oct 2026.
    // Midnight starting the 4th is 14:00 UTC on the 3rd (AEST); the next is 13:00 UTC on the 4th (AEDT).
    const midnight = new Date("2026-10-03T14:00:00.000Z");
    expect(onCallLocalDateKey(midnight, "Australia/Sydney")).toBe("2026-10-04");
    expect(msUntilNextOnCallLocalDay(midnight, "Australia/Sydney")).toBe(23 * HOUR);
    // Perth has no daylight saving: its day is 24 hours.
    expect(msUntilNextOnCallLocalDay(new Date("2026-10-03T16:00:00.000Z"), "Australia/Perth")).toBe(24 * HOUR);
  });

  it("Sydney daylight saving: 08:00 means 08:00 on the summer clock", () => {
    // Monday 5 Oct 2026, 08:30 AEDT (UTC+11) is 21:30 UTC on the 4th. A fixed +10 would read 07:30.
    const monday0830 = new Date("2026-10-04T21:30:00.000Z");
    expect(isOnCallOutOfHours(monday0830, "Australia/Sydney")).toBe(false);
    expect(isOnCallOutOfHours(monday0830, "Australia/Perth")).toBe(true);
    // Friday 2 Oct, 18:00 AEST, to Monday 5 Oct, 08:00 AEDT: 62 wall hours, 61 real ones.
    expect(msUntilOnCallPeriodChange(new Date("2026-10-02T08:00:00.000Z"), "Australia/Sydney")).toBe(61 * HOUR);
  });

  it("Sydney daylight saving: the On Call shift clock moves with the summer clock", () => {
    // Sunday 4 Oct 2026, 01:30 AEST (15:30 UTC on the 3rd). The clock jumps 02:00 -> 03:00, so
    // 08:00 AEDT (21:00 UTC) is 5.5 real hours away, not 6.5.
    const now = new Date("2026-10-03T15:30:00.000Z");
    expect(onCallClockPeriod(now, "Australia/Sydney")).toBe("night");
    expect(msUntilOnCallShiftContextChange({ shifts: [], pick: null, now, zone: "Australia/Sydney" })).toBe(5.5 * HOUR);
  });

  it("Adelaide's half-hour offset: hours begin on its own clock", () => {
    // Wednesday 16 Sep 2026, 16:10 ACST (UTC+9:30) is 06:40 UTC: 50 minutes to 17:00.
    const at = new Date("2026-09-16T06:40:00.000Z");
    expect(msUntilOnCallPeriodChange(at, "Australia/Adelaide")).toBe(50 * 60 * 1000);
    expect(new Date(onCallZonedHourStart(at, "Australia/Adelaide")).toISOString()).toBe("2026-09-16T06:30:00.000Z");
  });
});

describe("the work year", () => {
  // 22:00 Perth on New Year's Eve 2026 is 01:00 on 1 Jan 2027 in Sydney (AEDT).
  const NEW_YEARS_EVE = Date.parse("2026-12-31T14:00:00.000Z");

  it("is Perth's year, even on a phone that has already reached the new year", () => {
    inTimeZone("Australia/Sydney", () => {
      expect(currentWorkYear(NEW_YEARS_EVE)).toBe(2026);
    });
    expect(currentWorkYear(NEW_YEARS_EVE, "Australia/Sydney")).toBe(2027);
  });
});
