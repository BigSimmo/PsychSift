### Task 1: The model and the fixture

The spec's §3. Nothing executable depends on anything else until these fields exist, so this comes first.

**Files:**

- Modify: `src/components/ward-management/ward-model.ts`
- Modify: `src/components/ward-management/ward-movements.ts`
- Create: `tests/ward-model-phase3.test.ts`

**Interfaces:**

- Produces: `Movement.formedAt`, `Movement.arrivalMode`, `Movement.bedHeldUntil`, `Movement.examination`, `Movement.withdrawnReferrals`, `Movement.escalation`; `DECLINE_REASONS` with seven entries; `type Rejection`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/ward-model-phase3.test.ts
import { describe, expect, it } from "vitest";

import { DECLINE_REASONS } from "../src/components/ward-management/ward-model";
import { wardMovements } from "../src/components/ward-management/ward-movements";
import { NOW_ANCHOR } from "../src/components/ward-management/ward-sites";
import { isOpen } from "../src/components/ward-management/ward-derivations";

describe("Phase 3 model additions", () => {
  it("records out-of-catchment as a decline reason", () => {
    expect(DECLINE_REASONS).toContain("out_of_catchment");
    expect(new Set(DECLINE_REASONS).size).toBe(DECLINE_REASONS.length);
  });

  it("gives every movement a withdrawn-referral list, even an empty one", () => {
    for (const movement of wardMovements) {
      expect(Array.isArray(movement.withdrawnReferrals)).toBe(true);
    }
  });

  it("never dates a form later than the placement request it belongs to", () => {
    // The legal clock starts when the person was formed; the ED clock when this department
    // raised the request. formedAt may precede openedAt and must never follow it.
    for (const movement of wardMovements) {
      if (movement.formedAt === undefined) continue;
      expect(movement.formedAt).toBeLessThanOrEqual(movement.openedAt);
    }
  });

  it("carries at least one community-formed patient whose legal clock started before arrival", () => {
    const communityFormed = wardMovements.filter(
      (movement) => movement.formedAt !== undefined && movement.formedAt < movement.openedAt,
    );
    expect(communityFormed.length).toBeGreaterThan(0);
  });

  it("carries at least one patient brought in under police escort", () => {
    expect(wardMovements.some((movement) => movement.arrivalMode === "police")).toBe(true);
  });

  it("carries at least one examined patient, and every examination is dated at or before now", () => {
    const examined = wardMovements.filter((movement) => movement.examination !== undefined);
    expect(examined.length).toBeGreaterThan(0);
    for (const movement of examined) {
      expect(movement.examination!.at).toBeLessThanOrEqual(NOW_ANCHOR);
    }
  });

  it("holds a bed only with a time for the hold to expire at", () => {
    for (const movement of wardMovements) {
      if (movement.stage !== "bed_held") continue;
      expect(movement.bedHeldUntil).toBeDefined();
    }
  });

  it("puts a patient on 1A while awaiting examination and on 3B once examined", () => {
    // Settled by the product owner: 1A means awaiting exam; 3B means in the department awaiting a
    // bed. Form 3A is not used. The form therefore follows the examination, in both directions.
    for (const movement of wardMovements) {
      const code = movement.legalForm?.code;
      if (code === "1A") expect(movement.examination).toBeUndefined();
      if (code === "3B") expect(movement.examination?.outcome).toBe("inpatient_order");
      expect(code).not.toBe("3A");
    }
  });

  it("carries at least one patient on each of 1A and 3B", () => {
    const codes = wardMovements.map((movement) => movement.legalForm?.code);
    expect(codes).toContain("1A");
    expect(codes).toContain("3B");
  });

  it("keeps every new field free of anything that identifies a person", () => {
    const forbidden = /\b(name|dob|date of birth|mrn|medical record|address|diagnosis)\b/i;
    for (const movement of wardMovements.filter(isOpen)) {
      for (const withdrawn of movement.withdrawnReferrals) {
        expect(withdrawn.reason).not.toMatch(forbidden);
      }
      if (movement.escalation) {
        expect(movement.escalation.contact).not.toMatch(forbidden);
      }
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ward-model-phase3.test.ts`
Expected: FAIL — `out_of_catchment` is not in `DECLINE_REASONS`, and `withdrawnReferrals` does not exist.

- [ ] **Step 3: Add the types**

In `src/components/ward-management/ward-model.ts`, add `"out_of_catchment"` to `DECLINE_REASONS` (making seven), and add to `Movement`:

```ts
/** When the referral for examination was made. May precede `openedAt` for a community-formed
 *  patient — the legal clock and the department clock are different clocks. */
formedAt?: Instant;
/** How the patient reached the department. Police attendance is a real and invisible pressure. */
arrivalMode?: "self" | "ambulance" | "police";
/** When a held bed lapses. A hold cannot expire without a time to expire at. */
bedHeldUntil?: Instant;
/** The psychiatric examination a Form 1A refers the person for. Until it happens you often do
 *  not know whether an authorised bed is needed at all. */
examination?: { at: Instant; outcome: "inpatient_order" | "community_order" | "revoked" };
/** Referrals ended because another unit accepted. A shrinking `referredUnitIds` tells nobody. */
withdrawnReferrals: { unitId: string; at: Instant; reason: string }[];
/** Recorded when the network is exhausted. */
escalation?: { at: Instant; triedUnitIds: string[]; contact: string };
```

Add alongside it:

```ts
/** A transition the reducer refused, surfaced on the coordinator screen rather than swallowed. */
export type Rejection = {
  id: string;
  at: Instant;
  movementId: string;
  attempted: string;
  reason: string;
};
```

- [ ] **Step 4: Populate the fixture**

In `ward-movements.ts`, give every movement `withdrawnReferrals: []`. Then, on the hand-authored records only:

- at least three carry a `formedAt` between 60 and 240 minutes before their `openedAt` — community-formed patients whose examination window was already running when they arrived — **and at least one of those three is at `peel-ed`**, which Task 11 asserts on;
- at least one carries `arrivalMode: "police"` and at least two `"ambulance"`;
- **the five movements currently on `3A` become `1A`** — they are awaiting examination, and 3A is
  not used;
- **several movements gain an `examination` with outcome `"inpatient_order"` and move to `3B`** —
  examined, ordered, and waiting in the department for a bed, which describes most of this board and
  which nothing currently says. Their `dueAt` becomes the detention deadline rather than the
  examination deadline;
- every movement already at stage `bed_held` gains a `bedHeldUntil` between `NOW_ANCHOR - 20` and `NOW_ANCHOR + 45`, so at least one hold is already lapsed and at least one is still running.

**Preserve every existing `referredUnitIds` entry.** Five movements carry live referrals at seed — to `sjgm-adult-open`, `gry-adult-secure`, `fsh-older-adult`, `bty-adult-secure`, and the pair `bty-older-adult`/`gry-older-adult`. Task 8 stands on the `bty-adult-secure` one and Task 3 stands on `fsh-older-adult`; emptying any of them turns a later test green for the wrong reason.

The 30 generated movements derive their values from their index, as their existing fields do. Add no free text that describes a person.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/ward-model-phase3.test.ts tests/ward-model.test.ts tests/ward-eligibility.test.ts tests/ward-priority.test.ts tests/ward-pressure.test.ts tests/ward-capacity-reconciliation.test.ts`
Expected: PASS. The new file's 8 tests plus the existing suites unchanged — adding optional fields must break nothing.

- [ ] **Step 6: Typecheck and commit**

```bash
npx tsc --noEmit -p tsconfig.json
npm run format
git add src/components/ward-management/ward-model.ts src/components/ward-management/ward-movements.ts tests/ward-model-phase3.test.ts
git commit -m "feat(ward-flow): add the Phase 3 model fields and the out-of-catchment decline reason"
```

---
