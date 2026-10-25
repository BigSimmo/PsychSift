import { describe, expect, it } from "vitest";

import { coverageRank, matchReferralCoverage } from "@/lib/on-call/referral-coverage";

describe("matchReferralCoverage", () => {
  const olderAdult = {
    accepts: ["65+ only"],
    exclusions: ["Under 65"],
    catchment: "Demo Bay and surrounds",
    hours: "08:00-17:00 Mon-Fri",
    phone: "08 1234 5678",
  };

  // Tuesday, so the recorded "Mon-Fri" can be checked.
  const tuesday = 2;

  it("takes a matching age and catchment while showing its working", () => {
    const match = matchReferralCoverage(olderAdult, {
      age: 70,
      suburb: "Demo Bay",
      minutesNow: 10 * 60,
      weekday: tuesday,
    });
    expect(match.verdict).toBe("takes");
    expect(match.why).toMatch(/65\+/);
  });

  it("marks a weekday-only service closed on a Saturday inside its clock window", () => {
    const match = matchReferralCoverage(olderAdult, { age: 70, suburb: "Demo Bay", minutesNow: 10 * 60, weekday: 6 });
    expect(match.verdict).toBe("closed");
    expect(match.why).toMatch(/Mon-Fri/);
  });

  it("asks the reader to check named days when the weekday is unknown or a public holiday", () => {
    const unknownDay = matchReferralCoverage(olderAdult, { age: 70, suburb: "Demo Bay", minutesNow: 10 * 60 });
    expect(unknownDay.verdict).toBe("unclear");
    const holiday = matchReferralCoverage(olderAdult, {
      age: 70,
      suburb: "Demo Bay",
      minutesNow: 10 * 60,
      weekday: tuesday,
      publicHoliday: true,
    });
    expect(holiday.verdict).toBe("unclear");
    expect(holiday.why).toMatch(/check those hours/i);
  });

  it("keeps a bare clock window daily, and reads an overnight window by the day it opened", () => {
    const daily = { ...olderAdult, hours: "08:00-17:00" };
    expect(matchReferralCoverage(daily, { age: 70, suburb: "", minutesNow: 10 * 60, weekday: 6 }).verdict).toBe(
      "takes",
    );
    const weeknights = { ...olderAdult, hours: "17:00-08:00 Mon to Fri" };
    // 02:00 Saturday is still Friday night's shift; 02:00 Monday is Sunday night, not covered.
    expect(matchReferralCoverage(weeknights, { age: 70, suburb: "", minutesNow: 2 * 60, weekday: 6 }).verdict).toBe(
      "takes",
    );
    expect(matchReferralCoverage(weeknights, { age: 70, suburb: "", minutesNow: 2 * 60, weekday: 1 }).verdict).toBe(
      "closed",
    );
  });

  it("never excludes a suburb by a whole-service or statewide catchment", () => {
    for (const catchment of ["Catchment, whole service", "Statewide"]) {
      const match = matchReferralCoverage(
        { accepts: [], exclusions: [], catchment },
        { age: null, suburb: "Demo Bay", minutesNow: null },
      );
      expect(match.verdict).toBe("unclear");
    }
  });

  it("reads ages written as <18 in accepts and exclusions", () => {
    const children = { accepts: ["<18"], exclusions: [], catchment: "Demo Bay" };
    expect(matchReferralCoverage(children, { age: 40, suburb: "Demo Bay", minutesNow: null }).verdict).toBe("excludes");
    expect(matchReferralCoverage(children, { age: 12, suburb: "Demo Bay", minutesNow: null }).verdict).toBe("takes");
    const adults = { accepts: [], exclusions: ["aged < 18"], catchment: "Demo Bay" };
    expect(matchReferralCoverage(adults, { age: 12, suburb: "Demo Bay", minutesNow: null }).verdict).toBe("excludes");
  });

  it("keeps an excluded service visible with the recorded phrase", () => {
    const match = matchReferralCoverage(olderAdult, { age: 40, suburb: "Demo Bay", minutesNow: 10 * 60 });
    expect(match.verdict).toBe("excludes");
    expect(match.why).toMatch(/65\+|Under 65/);
  });

  it("marks closed when hours are a simple clock window", () => {
    const match = matchReferralCoverage(olderAdult, { age: 70, suburb: "Demo Bay", minutesNow: 2 * 60 + 40 });
    expect(match.verdict).toBe("closed");
    expect(match.why).toMatch(/08:00-17:00/);
  });

  it("asks the reader to check free-text hours instead of inventing closed", () => {
    const match = matchReferralCoverage(
      { ...olderAdult, hours: "Weekdays, business hours" },
      { age: 70, suburb: "Demo Bay", minutesNow: 10 * 60 },
    );
    expect(match.verdict).toBe("unclear");
    expect(match.why).toMatch(/check those hours/i);
  });

  it("ranks takes ahead of excluded so excluded rows stay listed last", () => {
    expect(coverageRank("takes")).toBeLessThan(coverageRank("excludes"));
    expect(coverageRank("unclear")).toBeLessThan(coverageRank("excludes"));
  });
});
