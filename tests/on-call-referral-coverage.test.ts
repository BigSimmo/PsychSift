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

  it("takes a matching age and catchment while showing its working", () => {
    const match = matchReferralCoverage(olderAdult, { age: 70, suburb: "Demo Bay", minutesNow: 10 * 60 });
    expect(match.verdict).toBe("takes");
    expect(match.why).toMatch(/65\+/);
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
