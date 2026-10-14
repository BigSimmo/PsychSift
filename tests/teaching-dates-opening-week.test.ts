import { describe, expect, it } from "vitest";

import { mondayOf, openingMondayOf, perthDateKey } from "@/components/teaching/teaching-dates";

import { perthMidday } from "./helpers/fixed-clock";

describe("openingMondayOf: the week Teaching's Week page opens on", () => {
  it("opens on the coming Monday on a Sunday in Perth", () => {
    const sunday = perthDateKey(perthMidday("2026-10-11"));
    expect(sunday).toBe("2026-10-11");
    expect(mondayOf(sunday)).toBe("2026-10-05"); // the week that is ending
    expect(openingMondayOf(sunday)).toBe("2026-10-12");
  });

  it("goes by Perth's Sunday, not UTC's", () => {
    // 23:30 on Sunday in Perth is still Sunday; 00:30 on Monday in Perth is still Sunday in UTC.
    expect(openingMondayOf(perthDateKey(new Date("2026-10-11T15:30:00Z")))).toBe("2026-10-12");
    expect(openingMondayOf(perthDateKey(new Date("2026-10-11T16:30:00Z")))).toBe("2026-10-12");
    // Saturday in Perth keeps the week it is in.
    expect(openingMondayOf(perthDateKey(new Date("2026-10-10T15:30:00Z")))).toBe("2026-10-05");
  });

  it("keeps the current week on every other day", () => {
    for (const day of ["2026-10-05", "2026-10-07", "2026-10-10"]) expect(openingMondayOf(day)).toBe("2026-10-05");
    expect(openingMondayOf("2026-10-12")).toBe("2026-10-12");
  });
});
