import { describe, expect, it } from "vitest";

import { applyReferralTransition, routeIncomingReferral } from "@/lib/caring-contacts/referrals";
import { patientId, pathwayVersionId, planId, referralId, teamId } from "@/lib/caring-contacts/ids";
import type { Referral } from "@/lib/caring-contacts/model";

const awaiting: Referral = {
  id: referralId("SYN-REFERRAL-001"),
  teamId: teamId("TEAM-A"),
  patientId: patientId("SYN-PATIENT-001"),
  state: "awaitingHandover",
  pathwayVersionId: null,
};

describe("referral lifecycle", () => {
  it("accepts a referral onto a named pathway version", () => {
    const result = applyReferralTransition(awaiting, {
      type: "accept",
      pathwayVersionId: pathwayVersionId("SYN-PATHWAY-001"),
    });
    expect(result).toEqual({
      ok: true,
      value: { ...awaiting, state: "accepted", pathwayVersionId: pathwayVersionId("SYN-PATHWAY-001") },
    });
  });

  it("requires a reason to return or decline", () => {
    for (const type of ["returnForClarification", "decline"] as const) {
      expect(applyReferralTransition(awaiting, { type, reason: "  " })).toEqual({
        ok: false,
        reason: "referral-reason-required",
      });
    }
  });

  it("refuses any action once the referral has left handover", () => {
    const accepted = { ...awaiting, state: "accepted" as const };
    expect(applyReferralTransition(accepted, { type: "decline", reason: "duplicate" })).toEqual({
      ok: false,
      reason: "referral-not-awaiting-handover",
    });
  });

  it("routes a duplicate referral to the existing episode instead of starting a second one", () => {
    expect(
      routeIncomingReferral({
        patientId: patientId("SYN-PATIENT-001"),
        existingNonTerminalPlanId: planId("SYN-PLAN-001"),
      }),
    ).toEqual({ type: "routeToExistingEpisode", planId: planId("SYN-PLAN-001") });

    expect(routeIncomingReferral({ patientId: patientId("SYN-PATIENT-001"), existingNonTerminalPlanId: null })).toEqual(
      { type: "createNewEpisode" },
    );
  });
});
