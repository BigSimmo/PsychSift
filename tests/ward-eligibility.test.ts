import { describe, expect, it } from "vitest";

import { eligibility, requiresAuthorisedDestination } from "../src/components/ward-management/ward-eligibility";
import type { LegalStatus, Movement, Unit } from "../src/components/ward-management/ward-model";

const NOW = 10 * 60 + 42;

function unit(overrides: Partial<Unit> = {}): Unit {
  return {
    id: "u-test",
    siteCode: "RPH",
    name: "Test Unit",
    cohort: "Adult",
    security: "Open",
    authorised: true,
    beds: 20,
    empty: { value: 3, source: "feed", confirmedAt: NOW - 2, staleAfterMinutes: 15 },
    allocatable: { value: 2, source: "ward", confirmedAt: NOW - 10, staleAfterMinutes: 120 },
    held: 0,
    blocked: 0,
    sexMix: { Female: 10, Male: 8 },
    speciallingCapacity: 1,
    ...overrides,
  };
}

function movement(overrides: Partial<Movement> = {}): Movement {
  return {
    id: "WF-001",
    originEdId: "ed-rph",
    openedAt: NOW - 300,
    urgency: 2,
    cohort: "Adult",
    security: "Open",
    sex: "Female",
    specialling: false,
    legalStatus: "Voluntary",
    statusChanges: [],
    stage: "destination_review",
    owner: "Flow coordinator",
    referredUnitIds: [],
    declines: [],
    blocker: "No blocker",
    withdrawnReferrals: [],
    ...overrides,
  };
}

describe("authorisation", () => {
  it("requires an authorised destination for every non-voluntary status", () => {
    expect(requiresAuthorisedDestination("Voluntary")).toBe(false);
    expect(requiresAuthorisedDestination("Referred for psychiatric examination")).toBe(true);
    expect(requiresAuthorisedDestination("Detained awaiting examination")).toBe(true);
    expect(requiresAuthorisedDestination("Involuntary inpatient")).toBe(true);
  });

  it("blocks a detained patient from an unauthorised unit", () => {
    const verdict = eligibility(
      movement({ legalStatus: "Detained awaiting examination" }),
      unit({ authorised: false }),
      NOW,
    );
    expect(verdict.eligible).toBe(false);
    expect(verdict.gates.find((gate) => gate.gate === "authorisation")?.pass).toBe(false);
  });

  it("treats unknown-status movements as requiring authorisation, failing safe", () => {
    const verdict = eligibility(
      // A movement whose legal status never arrived. Cast deliberately: the point of the
      // test is the runtime fail-safe, not the type system.
      movement({ legalStatus: undefined as unknown as LegalStatus }),
      unit({ authorised: false }),
      NOW,
    );
    expect(verdict.eligible).toBe(false);
  });
});

describe("clinical and operational gates", () => {
  it("refuses a cohort mismatch", () => {
    const verdict = eligibility(movement({ cohort: "Older adult" }), unit({ cohort: "Adult" }), NOW);
    const cohortGate = verdict.gates.find((gate) => gate.gate === "cohort");
    expect(cohortGate?.pass).toBe(false);
    // Grammar: "an older adult movement", never "a older adult movement".
    expect(cohortGate?.detail).toContain("an older adult movement");
  });

  it("gives the cohort gate a different detail string on pass than on fail", () => {
    const failing = eligibility(movement({ cohort: "Older adult" }), unit({ cohort: "Adult" }), NOW);
    const passing = eligibility(movement({ cohort: "Adult" }), unit({ cohort: "Adult" }), NOW);
    const failDetail = failing.gates.find((gate) => gate.gate === "cohort")?.detail;
    const passDetail = passing.gates.find((gate) => gate.gate === "cohort")?.detail;
    expect(failDetail).not.toBe(passDetail);
  });

  it("gives the security gate a different detail string on pass than on fail", () => {
    const failing = eligibility(movement({ security: "Secure" }), unit({ security: "Open" }), NOW);
    const passing = eligibility(movement({ security: "Open" }), unit({ security: "Open" }), NOW);
    const failGate = failing.gates.find((gate) => gate.gate === "security");
    const passGate = passing.gates.find((gate) => gate.gate === "security");
    expect(failGate?.pass).toBe(false);
    expect(passGate?.pass).toBe(true);
    expect(failGate?.detail).not.toBe(passGate?.detail);
  });

  it("refuses when the ward cannot staff the required specialling", () => {
    const verdict = eligibility(movement({ specialling: true }), unit({ speciallingCapacity: 0 }), NOW);
    expect(verdict.gates.find((gate) => gate.gate === "specialling")?.pass).toBe(false);
  });

  it("refuses a unit that has already declined this movement", () => {
    const declined = movement({ declines: [{ unitId: "u-test", at: NOW - 60, reason: "no_bed" }] });
    const verdict = eligibility(declined, unit(), NOW);
    expect(verdict.gates.find((gate) => gate.gate === "prior_decline")?.pass).toBe(false);
  });

  it("drops a unit whose allocatable figure has gone stale rather than showing it hopefully", () => {
    const stale = unit({
      allocatable: { value: 4, source: "ward", confirmedAt: NOW - 200, staleAfterMinutes: 120 },
    });
    const verdict = eligibility(movement(), stale, NOW);
    expect(verdict.gates.find((gate) => gate.gate === "capacity_freshness")?.pass).toBe(false);
  });

  it("passes every gate for a well-matched voluntary movement", () => {
    const verdict = eligibility(movement(), unit(), NOW);
    expect(verdict.eligible).toBe(true);
    expect(verdict.gates.every((gate) => gate.pass)).toBe(true);
  });
});
