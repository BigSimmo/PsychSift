### Task 3: The contracts

The invariants that must hold no matter what sequence of events runs. Separate from Task 2 because these are properties of the whole system, not of one transition.

**Files:**

- Create: `tests/ward-flow-contracts.test.ts`

**Interfaces:**

- Consumes: everything from Task 2.

- [ ] **Step 1: Write the tests**

```ts
// tests/ward-flow-contracts.test.ts
import { describe, expect, it } from "vitest";

import { seedWardFlowState, wardFlowReducer } from "../src/components/ward-management/ward-flow-reducer";
import type { WardFlowState } from "../src/components/ward-management/ward-flow-reducer";
import { PARALLEL_REFERRAL_CAP } from "../src/components/ward-management/ward-model";
import { NOW_ANCHOR } from "../src/components/ward-management/ward-sites";
import { unitCapacity } from "../src/components/ward-management/ward-derivations";
import { eligibility } from "../src/components/ward-management/ward-eligibility";

const NOW = NOW_ANCHOR;

/** Every state the system can reach by walking one patient the whole way through. */
function walk(): WardFlowState[] {
  let state = seedWardFlowState();
  const seen: WardFlowState[] = [state];
  const events = [
    { type: "REFER_TO_UNITS", role: "coordinator", unitIds: ["rph-adult-secure", "fsh-adult-secure"] },
    { type: "DECLINE", role: "ward", unitId: "fsh-adult-secure", reason: "out_of_catchment" },
    { type: "ACCEPT_IN_PRINCIPLE", role: "ward", unitId: "rph-adult-secure" },
    { type: "HOLD_BED", role: "ward", unitId: "rph-adult-secure" },
    { type: "HANDOVER_READY", role: "ed" },
    { type: "TRANSPORT_ACCEPTED", role: "officer" },
    { type: "TRANSPORT_EN_ROUTE", role: "officer" },
    { type: "PATIENT_COLLECTED", role: "officer" },
    { type: "PATIENT_ARRIVED", role: "officer" },
  ] as const;
  for (const event of events) {
    state = wardFlowReducer(state, { ...event, now: NOW, movementId: "WF-009" } as never);
    seen.push(state);
  }
  return seen;
}

describe("invariants across every reachable state", () => {
  it("never lets a movement hold more than the parallel cap", () => {
    for (const state of walk()) {
      for (const movement of state.movements) {
        expect(movement.referredUnitIds.length).toBeLessThanOrEqual(PARALLEL_REFERRAL_CAP);
      }
    }
  });

  it("keeps every unit's beds accounting for, before and after every event", () => {
    for (const state of walk()) {
      for (const unit of state.units) {
        const capacity = unitCapacity(unit);
        expect(capacity.available + capacity.held + capacity.blocked + capacity.occupied).toBe(unit.beds);
      }
    }
  });

  it("never leaves a movement ownerless", () => {
    for (const state of walk()) {
      for (const movement of state.movements) {
        expect(movement.owner.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("never returns a declined unit to that patient's eligible candidates", () => {
    const final = walk().at(-1)!;
    const target = final.movements.find((movement) => movement.id === "WF-009")!;
    const declined = new Set(target.declines.map((decline) => decline.unitId));
    for (const unitId of declined) {
      const unit = final.units.find((candidate) => candidate.id === unitId)!;
      expect(eligibility(target, unit, NOW).eligible).toBe(false);
    }
  });

  it("records a withdrawal whenever a referral ends without a decline", () => {
    const final = walk().at(-1)!;
    const target = final.movements.find((movement) => movement.id === "WF-009")!;
    const endedByDecline = new Set(target.declines.map((decline) => decline.unitId));
    const endedByWithdrawal = new Set(target.withdrawnReferrals.map((entry) => entry.unitId));
    for (const unitId of ["rph-adult-secure", "fsh-adult-secure"]) {
      if (unitId === target.acceptedUnitId) continue;
      expect(endedByDecline.has(unitId) || endedByWithdrawal.has(unitId)).toBe(true);
    }
  });

  it("never lets the statutory form disagree with the examination", () => {
    // 1A is awaiting exam; 3B is awaiting a bed after one. An event that records an examination
    // must not leave a patient claiming to still be awaiting it.
    for (const state of walk()) {
      for (const movement of state.movements) {
        const code = movement.legalForm?.code;
        if (code === "1A") expect(movement.examination).toBeUndefined();
        if (code === "3B") expect(movement.examination?.outcome).toBe("inpatient_order");
      }
    }
  });

  it("keeps every rendered string free of anything identifying a person", () => {
    const forbidden = /\b(name|dob|date of birth|mrn|medical record|address|diagnosis)\b/i;
    for (const state of walk()) {
      for (const rejection of state.rejections) {
        expect(rejection.reason).not.toMatch(forbidden);
      }
      for (const movement of state.movements) {
        for (const withdrawn of movement.withdrawnReferrals) {
          expect(withdrawn.reason).not.toMatch(forbidden);
        }
      }
    }
  });
});
```

- [ ] **Step 2: Run and fix**

Run: `npx vitest run tests/ward-flow-contracts.test.ts`
Expected: PASS, 6 tests. If the bed-accounting test fails, the fault is in Task 2's `HOLD_BED` or `PATIENT_ARRIVED` arithmetic — fix the reducer, never the assertion. Phase 1 shipped a bed grid that failed to reconcile on 10 of 22 units and it took a whole-branch review to find.

- [ ] **Step 3: Commit**

```bash
npm run format
git add tests/ward-flow-contracts.test.ts
git commit -m "test(ward-flow): pin the phase 3 state invariants"
```

---
