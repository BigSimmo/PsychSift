import { describe, expect, it } from "vitest";

import { WA_PUBLIC_HOLIDAYS_2028, holidays, isWaPublicHoliday2028 } from "@/lib/roster/holidays";

describe("roster-holidays (#Y5X0HH)", () => {
  it("includes all 12 official 2028 WA public holidays including King's Birthday", () => {
    expect(WA_PUBLIC_HOLIDAYS_2028).toHaveLength(12);
    expect(WA_PUBLIC_HOLIDAYS_2028).toContain("2028-01-01"); // New Year's Day
    expect(WA_PUBLIC_HOLIDAYS_2028).toContain("2028-01-03"); // New Year's Day (substitute)
    expect(WA_PUBLIC_HOLIDAYS_2028).toContain("2028-01-26"); // Australia Day
    expect(WA_PUBLIC_HOLIDAYS_2028).toContain("2028-03-06"); // Labour Day
    expect(WA_PUBLIC_HOLIDAYS_2028).toContain("2028-04-14"); // Good Friday
    expect(WA_PUBLIC_HOLIDAYS_2028).toContain("2028-04-16"); // Easter Sunday
    expect(WA_PUBLIC_HOLIDAYS_2028).toContain("2028-04-17"); // Easter Monday
    expect(WA_PUBLIC_HOLIDAYS_2028).toContain("2028-04-25"); // Anzac Day
    expect(WA_PUBLIC_HOLIDAYS_2028).toContain("2028-06-05"); // Western Australia Day
    expect(WA_PUBLIC_HOLIDAYS_2028).toContain("2028-09-25"); // King's Birthday
    expect(WA_PUBLIC_HOLIDAYS_2028).toContain("2028-12-25"); // Christmas Day
    expect(WA_PUBLIC_HOLIDAYS_2028).toContain("2028-12-26"); // Boxing Day
  });

  it("appends 2028 holidays to the main holiday array", () => {
    const list2028 = holidays.filter((date) => date.startsWith("2028-"));
    expect(list2028).toEqual(WA_PUBLIC_HOLIDAYS_2028);
  });

  it("identifies 2028 holiday dates correctly", () => {
    expect(isWaPublicHoliday2028("2028-09-25")).toBe(true);
    expect(isWaPublicHoliday2028("2028-09-26")).toBe(false);
  });
});
