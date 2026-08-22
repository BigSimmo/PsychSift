### Task 5: Referrals

`referrals` is a table with an audit trigger that nothing ever writes, and `plans.referral_id` is a plain text column with no foreign key because no referral is ever created. Spec §8 requires that a duplicate referral for an active plan is blocked and routed to the existing episode, and that a later qualifying discharge creates a new linked episode that never mutates the earlier one.

**Files:**

- Create: `src/lib/caring-contacts/referrals.ts`
- Test: `tests/caring-contacts-referrals.test.ts` (new)

**Interfaces:**

- Consumes: `Referral`, `ReferralState`, `TransitionResult<T>` from `./model`; `PatientId`, `ReferralId`, `TeamId`, `PathwayVersionId` from `./ids`.
- Produces:

```ts
export type ReferralAction =
  | { type: "accept"; pathwayVersionId: PathwayVersionId }
  | { type: "returnForClarification"; reason: string }
  | { type: "decline"; reason: string };

export type DuplicateReferralOutcome =
  { type: "createNewEpisode" } | { type: "routeToExistingEpisode"; planId: PlanId };

export function applyReferralTransition(referral: Referral, action: ReferralAction): TransitionResult<Referral>;
export function routeIncomingReferral(input: {
  patientId: PatientId;
  existingNonTerminalPlanId: PlanId | null;
}): DuplicateReferralOutcome;
```

**Rules:** every action is legal only from `awaitingHandover`, otherwise `referral-not-awaiting-handover`; `accept` records the chosen `pathwayVersionId`; `returnForClarification` and `decline` require a non-blank reason (`referral-reason-required`); `returnForClarification` and `decline` clear `pathwayVersionId` to `null`. `routeIncomingReferral` returns `routeToExistingEpisode` whenever a non-terminal plan exists for that patient, and `createNewEpisode` otherwise — it never mutates anything.

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run and verify it fails** (module not found).
- [ ] **Step 3: Implement `referrals.ts`.**
- [ ] **Step 4: Run and verify it passes.** Paste the `N passed` line.
- [ ] **Step 5: Prove it can fail.** Make `routeIncomingReferral` always return `createNewEpisode` → the duplicate test goes red. Revert.
- [ ] **Step 6: Commit**

```bash
git add src/lib/caring-contacts/referrals.ts tests/caring-contacts-referrals.test.ts
git commit -m "feat(caring-contacts): referral lifecycle and duplicate-referral routing"
```

---
