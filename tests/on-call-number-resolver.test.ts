import { describe, expect, it } from "vitest";

import { onCallCallNowPeriod } from "@/lib/on-call/call-now";
import { onCallPrimaryNumber } from "@/lib/on-call/home-modules";
import type { OnCallEntry } from "@/lib/on-call/entry-model";
import {
  formatOnCallNumber,
  isOnCallOutOfHours,
  msUntilOnCallPeriodChange,
  onCallPeriod,
  resolveHandbookPhone,
  resolveOnCallNumber,
  spokenOnCallNumber,
} from "@/lib/on-call/number-resolver";

/**
 * A Perth wall-clock instant, with the same arguments as `new Date(y, m, d, h)`
 * (month from 0). Working hours and "today" are read in the work time zone
 * (Perth by default), never the device's, so these tests no longer depend on
 * the zone the test runner happens to be in.
 */
const perthWall = (year: number, month: number, day: number, hour = 0, minute = 0, second = 0) =>
  new Date(Date.UTC(year, month, day, hour - 8, minute, second));

// Perth wall-clock instants, as tests/on-call-home-modules.test.ts uses: the rule reads the work zone.
const WED_0900 = perthWall(2026, 8, 16, 9, 0, 0);
const WED_2200 = perthWall(2026, 8, 16, 22, 0, 0);
const SAT_MIDDAY = perthWall(2026, 8, 19, 12, 0, 0);
const KINGS_BIRTHDAY_1000 = perthWall(2026, 8, 28, 10, 0, 0); // Monday 28 Sep 2026, WA public holiday
const HOUR = 60 * 60 * 1000;

describe("onCallPeriod: the one in-hours rule", () => {
  it("is in hours on a weekday between 08:00 and 17:00", () => {
    expect(onCallPeriod(WED_0900)).toBe("in-hours");
  });

  it("is after hours at night and at weekends", () => {
    expect(onCallPeriod(WED_2200)).toBe("after-hours");
    expect(onCallPeriod(SAT_MIDDAY)).toBe("after-hours");
  });

  it("is after hours all day on a WA public holiday, which the weekday primitive alone misses", () => {
    expect(isOnCallOutOfHours(KINGS_BIRTHDAY_1000)).toBe(false);
    expect(onCallPeriod(KINGS_BIRTHDAY_1000)).toBe("after-hours");
  });

  it("is exactly the rule Who do I call now uses, so the two screens cannot disagree", () => {
    for (const at of [WED_0900, WED_2200, SAT_MIDDAY, KINGS_BIRTHDAY_1000]) {
      expect(onCallCallNowPeriod(at)).toBe(onCallPeriod(at));
    }
  });
});

describe("msUntilOnCallPeriodChange", () => {
  it("carries a Friday evening over the weekend and the King's Birthday to Tuesday 08:00", () => {
    const friday = perthWall(2026, 8, 25, 18, 0, 0);
    expect(friday.getDay()).toBe(5);
    expect(msUntilOnCallPeriodChange(friday)).toBe(86 * HOUR);
  });

  it("crosses the Christmas run, which the old 96-hour cap could not", () => {
    const christmasEve = perthWall(2026, 11, 24, 17, 0, 0); // Thursday; 25, 26 and 28 Dec are holidays
    expect(msUntilOnCallPeriodChange(christmasEve)).toBe(111 * HOUR);
  });

  it("is always positive, so a timer on it cannot spin", () => {
    for (const at of [WED_0900, perthWall(2026, 8, 16, 17, 0, 0), KINGS_BIRTHDAY_1000]) {
      expect(msUntilOnCallPeriodChange(at)).toBeGreaterThan(0);
    }
  });
});

describe("resolveOnCallNumber (the reader's own entries; onCallTelHref unchanged)", () => {
  const fields = { phone: "(08) 9000 0001", afterHoursPhone: "0400 000 002", pager: "123", extension: "4455" };

  it("offers the direct line in hours and the after-hours line at night", () => {
    expect(resolveOnCallNumber(fields, WED_0900)).toEqual({
      label: "Direct",
      value: "(08) 9000 0001",
      tel: "tel:0890000001",
    });
    expect(resolveOnCallNumber(fields, WED_2200)).toEqual({
      label: "After hours",
      value: "0400 000 002",
      tel: "tel:0400000002",
    });
  });

  it("offers the after-hours line on a public holiday morning (the disagreement this replaces)", () => {
    expect(resolveOnCallNumber(fields, KINGS_BIRTHDAY_1000)?.label).toBe("After hours");
  });

  it("names a pager or extension and never hands it to the dialler", () => {
    expect(resolveOnCallNumber({ pager: "123" }, WED_0900)).toEqual({ label: "Pager", value: "123", tel: null });
    expect(resolveOnCallNumber({ extension: "4455" }, WED_0900)).toEqual({ label: "Ext", value: "4455", tel: null });
    expect(resolveOnCallNumber({}, WED_0900)).toBeNull();
  });

  it("is what onCallPrimaryNumber returns for a contact row", () => {
    const entry = {
      id: "00000000-0000-4000-8000-0000000000c1",
      section: "contacts",
      slug: "reg",
      title: "Registrar",
      subtitle: null,
      body: null,
      details: { role: "Registrar", ...fields },
      linkedDocumentIds: [],
      tags: [],
      isPersonal: false,
      includeOnCard: false,
      sortOrder: 0,
      lastVerifiedAt: null,
    } as unknown as OnCallEntry;
    const resolved = resolveOnCallNumber(fields, KINGS_BIRTHDAY_1000);
    expect(onCallPrimaryNumber(entry, KINGS_BIRTHDAY_1000)).toEqual({ label: resolved?.label, value: resolved?.value });
  });
});

describe("formatOnCallNumber: one grouping, whatever the editor typed", () => {
  it.each(["90000003", "9000-0003", "(08)90000003", "08 9000 0003", "+61 8 9000 0003"])(
    "shows the WA landline %s short inside the hospital and with (08) outside",
    (raw) => {
      expect(formatOnCallNumber(raw, "hospital")).toBe("9000 0003");
      expect(formatOnCallNumber(raw, "outside")).toBe("(08) 9000 0003");
    },
  );

  it("groups mobiles and national numbers the same in either list", () => {
    for (const scope of ["hospital", "outside"] as const) {
      expect(formatOnCallNumber("0400000002", scope)).toBe("0400 000 002");
      expect(formatOnCallNumber("1800 000 012", scope)).toBe("1800 000 012");
      expect(formatOnCallNumber("1300000012", scope)).toBe("1300 000 012");
      expect(formatOnCallNumber("130012", scope)).toBe("13 00 12");
    }
  });

  it("keeps another state's area code in both lists", () => {
    expect(formatOnCallNumber("0290000003", "hospital")).toBe("(02) 9000 0003");
  });

  it("writes an internal number as a lower-case extension and a short code bare", () => {
    expect(formatOnCallNumber("4455", "hospital")).toBe("ext 4455");
    expect(formatOnCallNumber("Ext 4455", "hospital")).toBe("Ext 4455");
    expect(formatOnCallNumber("55", "hospital")).toBe("55");
  });

  it("leaves the national emergency numbers and free text alone", () => {
    expect(formatOnCallNumber("000", "outside")).toBe("000");
    expect(formatOnCallNumber("via switchboard", "hospital")).toBe("via switchboard");
  });
});

describe("spokenOnCallNumber: digits spaced for a screen reader", () => {
  it("reads each digit, pausing between groups", () => {
    expect(spokenOnCallNumber("9000 0003")).toBe("9 0 0 0, 0 0 0 3");
    expect(spokenOnCallNumber("(08) 9000 0003")).toBe("0 8, 9 0 0 0, 0 0 0 3");
    expect(spokenOnCallNumber("9000 0004, then ext 4455")).toBe("9 0 0 0, 0 0 0 4, then ext 4 4 5 5");
  });
});

describe("resolveHandbookPhone: the recorded dial format", () => {
  it("dials an 8-digit WA landline with 08, shows it short and copies it whole", () => {
    expect(resolveHandbookPhone("(08) 9000 0003")).toEqual({
      kind: "direct",
      display: "9000 0003",
      tel: "tel:0890000003",
      copy: "0890000003",
      route: "any-phone",
    });
    expect(resolveHandbookPhone("9000 0003").tel).toBe("tel:0890000003");
    expect(resolveHandbookPhone("9000 0003", "outside").display).toBe("(08) 9000 0003");
  });

  it("builds switchboard, pause, extension only from an explicit comma, and copies the switchboard", () => {
    expect(resolveHandbookPhone("08 9000 0004, 4455")).toEqual({
      kind: "switchboard-extension",
      display: "9000 0004, then ext 4455",
      switchboard: "9000 0004",
      extension: "4455",
      tel: "tel:0890000004,4455",
      copy: "0890000004",
      route: "any-phone",
    });
  });

  it("never guesses a pause from 'ext' wording", () => {
    expect(resolveHandbookPhone("08 9000 0004 ext 4455")).toEqual({
      kind: "text",
      display: "08 9000 0004 ext 4455",
      tel: null,
      copy: null,
      route: null,
    });
  });

  it("refuses a pause dial whose switchboard is not a full number", () => {
    expect(resolveHandbookPhone("4455, 12").tel).toBeNull();
  });

  it("sends any number shorter than 8 digits to a hospital phone, with no tel", () => {
    expect(resolveHandbookPhone("4455")).toEqual({
      kind: "extension",
      display: "ext 4455",
      extension: "4455",
      tel: null,
      copy: "4455",
      route: "hospital-phone",
    });
    // The made-up hospital emergency code: a desk phone dials it, a mobile cannot.
    expect(resolveHandbookPhone("55")).toMatchObject({ tel: null, display: "55", route: "hospital-phone" });
    expect(resolveHandbookPhone("9000000")).toMatchObject({ tel: null, route: "hospital-phone" });
  });

  it("keeps the national emergency and 13 numbers dialable and an empty field empty", () => {
    expect(resolveHandbookPhone("000").tel).toBe("tel:000");
    expect(resolveHandbookPhone("112").tel).toBe("tel:112");
    expect(resolveHandbookPhone("13 00 12")).toMatchObject({ tel: "tel:130012", display: "13 00 12" });
    expect(resolveHandbookPhone("  ")).toEqual({ kind: "none", display: "", tel: null, copy: null, route: null });
  });
});
