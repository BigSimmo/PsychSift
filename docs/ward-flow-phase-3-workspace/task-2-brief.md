### Task 2: The reducer

The heart of the phase. Pure, no React, and where most of the proof lives. Spec §6 and §10.

**Files:**

- Create: `src/components/ward-management/ward-flow-events.ts`
- Create: `src/components/ward-management/ward-flow-reducer.ts`
- Create: `tests/ward-flow-reducer.test.ts`

**Interfaces:**

- Consumes: `Movement`, `Unit`, `Rejection`, `Instant`, `PARALLEL_REFERRAL_CAP`, `wardMovements`, `allUnits`, `NOW_ANCHOR`.
- Produces: `type WardFlowRole = "coordinator" | "ed" | "ward" | "officer" | "demo"`; `type WardFlowEvent`; `type WardFlowState`; `seedWardFlowState(): WardFlowState`; `wardFlowReducer(state, event): WardFlowState`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/ward-flow-reducer.test.ts
import { describe, expect, it } from "vitest";

import { seedWardFlowState, wardFlowReducer } from "../src/components/ward-management/ward-flow-reducer";
import { NOW_ANCHOR } from "../src/components/ward-management/ward-sites";
import { PARALLEL_REFERRAL_CAP } from "../src/components/ward-management/ward-model";

const NOW = NOW_ANCHOR;

function seeded() {
  return seedWardFlowState();
}

function movement(state: ReturnType<typeof seeded>, id: string) {
  const found = state.movements.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`state is missing ${id}`);
  return found;
}

describe("seeding", () => {
  it("copies the fixture rather than aliasing it", () => {
    const first = seeded();
    const second = seeded();
    expect(first.movements[0]).not.toBe(second.movements[0]);
    expect(first.units[0]).not.toBe(second.units[0]);
  });

  it("starts with no refusals and a zero clock offset", () => {
    const state = seeded();
    expect(state.rejections).toEqual([]);
    expect(state.clockOffsetMinutes).toBe(0);
  });
});

describe("referral", () => {
  it("never refers above the parallel cap", () => {
    const state = seeded();
    const next = wardFlowReducer(state, {
      type: "REFER_TO_UNITS",
      role: "coordinator",
      now: NOW,
      movementId: "WF-009",
      unitIds: ["rph-adult-secure", "fsh-adult-secure", "rgh-adult-secure", "gry-adult-secure"],
    });
    expect(next.rejections).toHaveLength(1);
    expect(movement(next, "WF-009").referredUnitIds).toHaveLength(0);
  });

  it("moves a referred movement to destination review", () => {
    const state = seeded();
    const next = wardFlowReducer(state, {
      type: "REFER_TO_UNITS",
      role: "coordinator",
      now: NOW,
      movementId: "WF-009",
      unitIds: ["rph-adult-secure", "fsh-adult-secure"],
    });
    expect(movement(next, "WF-009").stage).toBe("destination_review");
    expect(movement(next, "WF-009").referredUnitIds).toEqual(["rph-adult-secure", "fsh-adult-secure"]);
  });
});

describe("acceptance", () => {
  function referred() {
    return wardFlowReducer(seeded(), {
      type: "REFER_TO_UNITS",
      role: "coordinator",
      now: NOW,
      movementId: "WF-009",
      unitIds: ["rph-adult-secure", "fsh-adult-secure", "rgh-adult-secure"],
    });
  }

  it("withdraws the other referrals and records each one", () => {
    const next = wardFlowReducer(referred(), {
      type: "ACCEPT_IN_PRINCIPLE",
      role: "ward",
      now: NOW,
      movementId: "WF-009",
      unitId: "rph-adult-secure",
    });
    const target = movement(next, "WF-009");
    expect(target.acceptedUnitId).toBe("rph-adult-secure");
    expect(target.stage).toBe("accepted_awaiting_bed");
    expect(target.withdrawnReferrals.map((entry) => entry.unitId).sort()).toEqual([
      "fsh-adult-secure",
      "rgh-adult-secure",
    ]);
    for (const withdrawn of target.withdrawnReferrals) {
      expect(withdrawn.reason).toContain("RPH Adult Secure");
    }
  });

  it("refuses a second acceptance and says the referral was withdrawn", () => {
    const accepted = wardFlowReducer(referred(), {
      type: "ACCEPT_IN_PRINCIPLE",
      role: "ward",
      now: NOW,
      movementId: "WF-009",
      unitId: "rph-adult-secure",
    });
    const next = wardFlowReducer(accepted, {
      type: "ACCEPT_IN_PRINCIPLE",
      role: "ward",
      now: NOW,
      movementId: "WF-009",
      unitId: "fsh-adult-secure",
    });
    expect(next.rejections).toHaveLength(1);
    expect(next.rejections[0].reason).toMatch(/withdraw/i);
    expect(movement(next, "WF-009").acceptedUnitId).toBe("rph-adult-secure");
  });
});

describe("the last bed", () => {
  it("refuses the second acceptance against a unit with one allocatable bed", () => {
    // Two patients, one bed. The model already names the answer; the reducer must enforce it.
    let state = seeded();
    const unit = state.units.find((candidate) => candidate.allocatable.value === 1);
    if (!unit) throw new Error("fixture no longer contains a single-allocatable-bed unit");

    for (const movementId of ["WF-009", "WF-017"]) {
      state = wardFlowReducer(state, {
        type: "REFER_TO_UNITS",
        role: "coordinator",
        now: NOW,
        movementId,
        unitIds: [unit.id],
      });
      state = wardFlowReducer(state, {
        type: "ACCEPT_IN_PRINCIPLE",
        role: "ward",
        now: NOW,
        movementId,
        unitId: unit.id,
      });
      state = wardFlowReducer(state, { type: "HOLD_BED", role: "ward", now: NOW, movementId, unitId: unit.id });
    }

    expect(state.rejections.some((rejection) => rejection.reason.includes("bed_held_for_earlier_referral"))).toBe(true);
  });
});

describe("holds", () => {
  it("gives a held bed sixty minutes to lapse in", () => {
    let state = seeded();
    state = wardFlowReducer(state, {
      type: "REFER_TO_UNITS",
      role: "coordinator",
      now: NOW,
      movementId: "WF-009",
      unitIds: ["rph-adult-secure"],
    });
    state = wardFlowReducer(state, {
      type: "ACCEPT_IN_PRINCIPLE",
      role: "ward",
      now: NOW,
      movementId: "WF-009",
      unitId: "rph-adult-secure",
    });
    state = wardFlowReducer(state, {
      type: "HOLD_BED",
      role: "ward",
      now: NOW,
      movementId: "WF-009",
      unitId: "rph-adult-secure",
    });
    expect(movement(state, "WF-009").bedHeldUntil).toBe(NOW + 60);
    expect(movement(state, "WF-009").stage).toBe("bed_held");
  });
});

describe("roles", () => {
  it("refuses an event raised by the wrong role", () => {
    const next = wardFlowReducer(seeded(), {
      type: "ACCEPT_IN_PRINCIPLE",
      role: "coordinator",
      now: NOW,
      movementId: "WF-009",
      unitId: "rph-adult-secure",
    });
    expect(next.rejections).toHaveLength(1);
    expect(next.rejections[0].reason).toMatch(/role/i);
    expect(movement(next, "WF-009").acceptedUnitId).toBeUndefined();
  });
});

describe("arrival", () => {
  it("consumes the bed and closes the record", () => {
    let state = seeded();
    const before = state.units.find((unit) => unit.id === "rph-adult-secure")!.allocatable.value;
    for (const event of [
      { type: "REFER_TO_UNITS", role: "coordinator", unitIds: ["rph-adult-secure"] },
      { type: "ACCEPT_IN_PRINCIPLE", role: "ward", unitId: "rph-adult-secure" },
      { type: "HOLD_BED", role: "ward", unitId: "rph-adult-secure" },
      { type: "HANDOVER_READY", role: "ed" },
      { type: "TRANSPORT_ACCEPTED", role: "officer" },
      { type: "TRANSPORT_EN_ROUTE", role: "officer" },
      { type: "PATIENT_COLLECTED", role: "officer" },
      { type: "PATIENT_ARRIVED", role: "officer" },
    ] as const) {
      state = wardFlowReducer(state, { ...event, now: NOW, movementId: "WF-009" } as never);
    }
    expect(state.rejections).toEqual([]);
    expect(movement(state, "WF-009").stage).toBe("arrived");
    const after = state.units.find((unit) => unit.id === "rph-adult-secure")!;
    expect(after.allocatable.value).toBeLessThan(before);
  });
});

describe("new referrals", () => {
  it("issues deterministic ids without any random source", () => {
    const first = wardFlowReducer(seeded(), {
      type: "RAISE_REFERRAL",
      role: "ed",
      now: NOW,
      edId: "jhc-ed",
      draft: {
        cohort: "Adult",
        security: "Open",
        sex: "Female",
        specialling: false,
        legalStatus: "Voluntary",
        urgency: 2,
      },
    });
    const second = wardFlowReducer(seeded(), {
      type: "RAISE_REFERRAL",
      role: "ed",
      now: NOW,
      edId: "jhc-ed",
      draft: {
        cohort: "Adult",
        security: "Open",
        sex: "Female",
        specialling: false,
        legalStatus: "Voluntary",
        urgency: 2,
      },
    });
    const firstId = first.movements[first.movements.length - 1].id;
    expect(firstId).toBe(second.movements[second.movements.length - 1].id);
    expect(first.movements).toHaveLength(second.movements.length);
  });

  it("gives a new referral an owner and the raising department", () => {
    const next = wardFlowReducer(seeded(), {
      type: "RAISE_REFERRAL",
      role: "ed",
      now: NOW,
      edId: "jhc-ed",
      draft: {
        cohort: "Adult",
        security: "Open",
        sex: "Male",
        specialling: false,
        legalStatus: "Voluntary",
        urgency: 3,
      },
    });
    const created = next.movements[next.movements.length - 1];
    expect(created.originEdId).toBe("jhc-ed");
    expect(created.owner.length).toBeGreaterThan(0);
    expect(created.stage).toBe("placement_requested");
    expect(created.withdrawnReferrals).toEqual([]);
  });
});

describe("purity", () => {
  it("never mutates the state it was given", () => {
    const state = seeded();
    const snapshot = JSON.stringify(state);
    wardFlowReducer(state, {
      type: "REFER_TO_UNITS",
      role: "coordinator",
      now: NOW,
      movementId: "WF-009",
      unitIds: ["rph-adult-secure"],
    });
    expect(JSON.stringify(state)).toBe(snapshot);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ward-flow-reducer.test.ts`
Expected: FAIL with "Cannot find module '../src/components/ward-management/ward-flow-reducer'".

- [ ] **Step 3: Write `ward-flow-events.ts`**

The event union, one variant per row of spec §6, each carrying `role: WardFlowRole` and `now: Instant`. Export `EVENT_ROLE: Record<WardFlowEvent["type"], WardFlowRole>` so the reducer's role check reads from one table rather than a `switch`.

- [ ] **Step 4: Write `ward-flow-reducer.ts`**

`seedWardFlowState()` deep-copies `wardMovements` and `allUnits()` — `structuredClone` is available on Node 24 — and returns `{ movements, units, rejections: [], clockOffsetMinutes: 0, referralSequence: 0 }`.

`wardFlowReducer(state, event)`:

1. **Role check first.** If `EVENT_ROLE[event.type] !== event.role`, return state with a `Rejection` appended and nothing else changed.
2. **Resolve the movement.** A movement id that does not resolve is a rejection, never a substituted record.
3. **Stage check.** A transition out of order is a rejection naming the stage it was in.
4. **Apply**, returning new objects throughout — never mutate `state`, `state.movements`, a movement, or a unit in place.

Specific rules the tests pin:

- `REFER_TO_UNITS` refuses more than `PARALLEL_REFERRAL_CAP` unit ids.
- `ACCEPT_IN_PRINCIPLE` on a movement that already has an `acceptedUnitId` is refused with a reason containing "withdrawn". On success it appends one `withdrawnReferrals` entry per other referred unit, each reason naming the accepting unit.
- `HOLD_BED` sets `bedHeldUntil = now + 60` and decrements the unit's `allocatable.value`. If the unit has no allocatable bed left, refuse with a reason containing `bed_held_for_earlier_referral`.
- `PATIENT_ARRIVED` increments the receiving unit's `sexMix[movement.sex]`, decrements `empty.value`, and sets stage `arrived`.
- `RECORD_EXAMINATION` with outcome `inpatient_order` moves the movement's `legalForm` from `1A` to
  `3B` — awaiting examination becomes awaiting a bed — and sets the new `dueAt`. An outcome of
  `revoked` closes the movement as did-not-proceed and clears the form.
- `RAISE_REFERRAL` takes the next id from `referralSequence` (format `WF-9NN` so new referrals are distinguishable from fixture ids), sets `originEdId` from `edId`, `openedAt` to `now`, `owner` to the department, and `withdrawnReferrals: []`.
- `ADVANCE_CLOCK` adds to `clockOffsetMinutes`; `RESET_SCENARIO` returns `seedWardFlowState()`.

Every rejection gets a stable `id` derived from `movementId`, `attempted` and the rejection count — no random source.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/ward-flow-reducer.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 6: Prove the refusals are not vacuous**

For each of the three refusal tests — over-cap referral, second acceptance, wrong role — temporarily delete that guard from the reducer, run the suite, confirm the matching test goes RED, restore, confirm GREEN. Paste both outputs. Three separate demonstrations. **A test written green proves nothing, and this project has shipped several.**

- [ ] **Step 7: Typecheck and commit**

```bash
npx tsc --noEmit -p tsconfig.json
npm run format
git add src/components/ward-management/ward-flow-events.ts src/components/ward-management/ward-flow-reducer.ts tests/ward-flow-reducer.test.ts
git commit -m "feat(ward-flow): add the pure state reducer and its refusals"
```

---
