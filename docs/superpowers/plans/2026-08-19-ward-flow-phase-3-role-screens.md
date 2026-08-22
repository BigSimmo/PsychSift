# Ward Flow Phase 3 — the other three roles — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Ward Flow move — add the emergency department, ward and transport officer screens plus the coordinator's live tracker, on top of the first mutable state this build has had.

**Architecture:** One `WardFlowProvider` in a new `src/app/ward-management/layout.tsx` holds the movements, the units, the refusals and the clock. Every change goes through one pure reducer with no React in it, so the bulk of the proof is Vitest rather than browser. The coordinator screen is the primary, guiding screen; the other three answer it. Every existing Ward Flow route is rewired to the same provider so no two surfaces can disagree.

**Tech Stack:** Next.js 16 App Router, React 19 (`useReducer` + `createContext`, no state library), TypeScript 6 strict, CSS Modules with a local token scale, Vitest for the reducer and contracts, Playwright Chromium for journeys.

**Spec:** [`docs/superpowers/specs/2026-08-19-ward-flow-phase-3-role-screens-design.md`](../specs/2026-08-19-ward-flow-phase-3-role-screens-design.md) — read it alongside this plan. §3 is the model surgery, §6 the events, §8 the ten routes, §10 the refusals, §15 the build order.

**Read also:** [`docs/ward-flow-context.md`](../../ward-flow-context.md) — the cold-start orientation, corrected 2026-08-19.

**Build-order item 1 (correcting the context document) is already complete** — commit `7f373e80f`. This plan starts at the model.

## Global Constraints

- **Nothing auto-allocates.** Every placement is a human confirm or override with the reason recorded. No timeout default, no confidence threshold. Withdrawing a referral is not allocating and is exempt.
- **Authorisation gates the destination only.** Detention in an unauthorised emergency department is lawful and normal. No surface may treat a patient's current department as a compliance problem.
- **Urgency tier leads.** The operational score orders only _within_ a tier, contains no urgency component, and is never described as severity, acuity or risk.
- **Conservative failure.** Missing or stale data narrows what is shown. A missing lookup renders an explicit absence, never a substituted record. No `?? array[0]`, no `.find()!`, no defaulted-parameter equivalent.
- **Display less rather than something plausible.** The governing rule. Every review this project has run found a surface stating something the data does not support.
- **Synthetic only.** No name, date of birth, medical record number, address, diagnosis, narrative history or treatment. `Sex` is the single permitted patient attribute. Free text counts — a guard that checks properties and never reads strings is how the Phase 1 privacy defect survived.
- **Determinism.** No `Math.random()`. No wall-clock read outside `ward-clock.ts` — and inside it, only `wallClockNow()`, consumed exactly once, inside the provider. Every function takes `now: Instant`.
- **The reducer is pure.** No React, no I/O, no clock read; `now` arrives on the event.
- **The fixture is copied at seed time**, never mutated in place, or tests become order-dependent.
- **Design tokens only.** No raw hex; no raw padding, gap, z-index or line-height literal in a CSS Module without declaring a local token in the module's root block first. `npm run check:design-system-contract` ratchets these and fails on any increase.
- **Tap targets are `3rem` (48px) minimum.** Never `2.75rem` — that reintroduces a known `ui-smoke` flake.
- **Button wiring.** Every `<button>` has a real handler, is a submit inside a form, or is a `<Link>`. A control unavailable for a stated reason uses `aria-disabled="true"` + inert handler + `title="… — coming soon"` + an `sr-only` note. Never both `disabled` and `aria-disabled`. **Never an `aria-label` that replaces a control's visible content** — it hides every figure from screen readers.
- **Internal navigation** uses `<Link>` / `router.push` / server `redirect()` — never a raw `<a href="/…">`.
- **No horizontal overflow at any width down to 320px.** The coordinator's region grid carries `data-testid="ward-coordinator-region-grid"` and tests assert its scroll box.
- **`npm run format` and commit the result** before any push — it is in neither `lint`, `typecheck` nor `test`.

## Repo traps that will cost you an hour each

- **`npm run lint` can exit 0 without running,** printing `DATABASE_HEAVY_RUN_ADMISSION_BUSY` when another heavyweight command holds the repository lock. Read the output, never the exit code.
- **A bare `npx playwright test` is rejected** by a config guard, and a backgrounded wrapper still reports exit 0 while running nothing. Use `PLAYWRIGHT_BASE_URL=http://localhost:3718 npx playwright test …` after `npm run ensure`, and use the URL `ensure` prints — never assume a port.
- **`npx tsc --noEmit` can go red inside `.next/dev/types/`.** That is a Next-generated artefact corrupted by a dev-server restart, not your code. Delete the offending generated file and re-run. Only errors under `src/`, `tests/` and `scripts/` are yours.
- **A new spec file must be added to BOTH** `testMatch` and `productionSpecPattern` in `playwright.config.ts`, or it silently runs zero tests. `tests/playwright-project-isolation.test.ts` is the proof it landed.
- **A new route needs a literal `<Link href="...">`** in the rail navigation — hrefs built from an array are invisible to `tests/route-reachability.test.ts` and the route fails as an orphan.
- **Every route must be declared** in `docs/design-system/adoption-contract.json`, then `npm run design-system:adoption:update` run.
- **The pre-commit hook regenerates docs and stops for review.** Stage what it regenerates and commit again. It is slow — allow minutes.
- **Do not leave stray log files in the repository root.** Three implementers have.

---

## What already exists

```ts
// ward-clock.ts
type Instant = number;                       // minutes since midnight, synthetic day
type ClockState = "breached" | "critical" | "due" | "clear";
wallClockNow(): Instant;                     // the ONLY wall-clock read; unused until Phase 3
minutesUntil(due, now); clockState(due, now);
formatRemaining(mins); formatElapsed(mins); formatInstant(instant); splitDuration(totalMinutes);

// ward-model.ts — types only
MOVEMENT_STAGES (7), DECLINE_REASONS (6 today, 7 after Task 1), PARALLEL_REFERRAL_CAP = 3
Site, EmergencyDepartment, Unit, Movement, CapacityFigure, Decline, StatusChange,
TransportJob, MovementClosure, BedRelease, LegalForm, LegalStatus, HealthService,
Cohort, Security, Sex

// ward-eligibility.ts — PROTECTED SURFACE, gate semantics must not change
eligibility(movement, unit, now): { eligible: boolean; gates: GateResult[] }   // 8 gates

// ward-sites.ts — 17 sites, 8 EDs, 22 units. NOW_ANCHOR = 642
wardSites, allUnits(), allEmergencyDepartments(), unitById(id), siteByCode(code)  // undefined on miss

// ward-movements.ts — 48 movements (41 open), 6 bed releases
wardMovements, movementById(id), movementsByStage(stage), bedReleases

// ward-derivations.ts
stageCopy, stageSummaries, movementStageSummary (a frozen constant — Task 5 deletes it),
wardServiceOrder, movementHealthService, elapsedLabel, isOpen, destinationUnit, unitSiteCode,
transportStatusLabel, unitCapacity, eligibleCandidates, candidateReason, buildActionInbox,
movementTimeline

// ward-priority.ts (Phase 2)
operationalScore(movement, now): { score, factors }   // blind to urgency
queueOrder(movements, now): Movement[]

// ward-pressure.ts (Phase 2)
edPressure(now, movements = wardMovements): EdPressure[]
```

`edPressure`, `queueOrder` and `buildActionInbox` already take an injected movement list. That was a Phase 2 review correction and it is why they need no change here.

## File Structure

| File                                                         | Responsibility                                                                                 |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| `src/components/ward-management/ward-model.ts`               | **Modified.** New `Movement` fields; `out_of_catchment` decline reason; `Rejection` type.      |
| `src/components/ward-management/ward-movements.ts`           | **Modified.** Fixture populated with the new fields.                                           |
| `src/components/ward-management/ward-flow-events.ts`         | **New.** The `WardFlowEvent` union and the role each event belongs to. Types only.             |
| `src/components/ward-management/ward-flow-reducer.ts`        | **New.** `wardFlowReducer`, `seedWardFlowState`. Pure, no React.                               |
| `src/components/ward-management/ward-flow-provider.tsx`      | **New.** The context, the ticking clock, `useWardFlow()`.                                      |
| `src/app/ward-management/layout.tsx`                         | **New.** Mounts the provider above every Ward Flow route.                                      |
| `src/components/ward-management/coordinator/*`               | **Modified.** Reads the provider; Confirm becomes Refer; refusals surface; phone pins Confirm. |
| `src/components/ward-management/ward-management-modes.tsx`   | **Modified.** Eight boards read the provider.                                                  |
| `src/components/ward-management/ward-management-network.tsx` | **Modified.** Reads the provider.                                                              |
| `src/components/ward-management/ward-management-console.tsx` | **Modified.** `WardPatientWorkspace` reads the provider.                                       |
| `src/components/ward-management/ward/ward-screen.tsx`        | **New.** One unit: capacity, incoming referrals, accept/hold/decline.                          |
| `src/components/ward-management/officer/officer-screen.tsx`  | **New.** The transport officer's phone.                                                        |
| `src/components/ward-management/tracker/live-tracker.tsx`    | **New.** The coordinator's view of every vehicle.                                              |
| `src/components/ward-management/ed/ed-screen.tsx`            | **New.** One department: both clocks, the access target, raise a referral, record examination. |
| `src/components/ward-management/ward-role-switcher.tsx`      | **New.** Four roles; infers place from the selected patient; picker to move.                   |
| `src/app/ward-management/ward/[unitId]/page.tsx`             | **New.** Ward route.                                                                           |
| `src/app/ward-management/ed/[edId]/page.tsx`                 | **New.** ED route.                                                                             |
| `src/app/ward-management/transport/officer/page.tsx`         | **New.** Officer route.                                                                        |
| `tests/ward-flow-reducer.test.ts`                            | **New.** Every transition and every refusal.                                                   |
| `tests/ward-flow-contracts.test.ts`                          | **New.** The invariants, including beds accounting for before and after every event.           |
| `tests/ui-ward-roles.spec.ts`                                | **New.** One journey per role screen, plus the end-to-end loop.                                |

**Checkpoint after Task 6.** At that point the software is complete and coherent: the coordinator screen is live, every existing route agrees with it, and the phone works. Tasks 7–12 add the three new screens. If the phase is sprawling, that is where to stop and re-plan.

---

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
Expected: PASS, 13 tests. (The plan first said 12; the verbatim test code above has always contained 13 `it` blocks. The code is correct, the count was not.)

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
Expected: PASS, 7 tests. (The plan first said 6; the verbatim test code above has always contained 7 `it` blocks.)

**Correction made during execution — the walk's subject is `WF-001`, not `WF-009`.** `WF-009` arrives from the fixture with three declines already recorded against it, which made the declined-unit and withdrawal invariants assert about fixture state rather than about anything the walk caused: both passed with the reducer's own writes disabled. `WF-001` (`placement_requested`, Adult/Open) carries neither seed declines nor seed referrals, so every decline, referral and withdrawal the invariants inspect is one the walk itself produced. Read the built file, not the code block above, for the units and event payloads that follow from that change.

If the bed-accounting test fails, the fault is in Task 2's `HOLD_BED` or `PATIENT_ARRIVED` arithmetic — fix the reducer, never the assertion. Phase 1 shipped a bed grid that failed to reconcile on 10 of 22 units and it took a whole-branch review to find.

- [ ] **Step 3: Commit**

```bash
npm run format
git add tests/ward-flow-contracts.test.ts
git commit -m "test(ward-flow): pin the phase 3 state invariants"
```

---

### Task 4: The provider, the clock and the layout

**Files:**

- Create: `src/components/ward-management/ward-flow-provider.tsx`
- Create: `src/app/ward-management/layout.tsx`
- Create: `tests/ward-flow-provider.test.tsx`

**Interfaces:**

- Consumes: `seedWardFlowState`, `wardFlowReducer`, `WardFlowEvent`, `wallClockNow`, `NOW_ANCHOR`.
- Produces: `WardFlowProvider({ children, initialNow? })`; `useWardFlow(): { movements, units, rejections, now, dispatch }`.

- [ ] **Step 1: Write the failing test**

```tsx
// tests/ward-flow-provider.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { WardFlowProvider, useWardFlow } from "../src/components/ward-management/ward-flow-provider";
import { NOW_ANCHOR } from "../src/components/ward-management/ward-sites";

function Probe() {
  const { movements, units, now, rejections } = useWardFlow();
  return (
    <ul>
      <li data-testid="movements">{movements.length}</li>
      <li data-testid="units">{units.length}</li>
      <li data-testid="now">{now}</li>
      <li data-testid="rejections">{rejections.length}</li>
    </ul>
  );
}

describe("WardFlowProvider", () => {
  it("seeds the fixture and holds the clock at the injected instant", () => {
    render(
      <WardFlowProvider initialNow={NOW_ANCHOR}>
        <Probe />
      </WardFlowProvider>,
    );
    expect(screen.getByTestId("movements")).toHaveTextContent("48");
    expect(screen.getByTestId("units")).toHaveTextContent("22");
    expect(screen.getByTestId("now")).toHaveTextContent(String(NOW_ANCHOR));
    expect(screen.getByTestId("rejections")).toHaveTextContent("0");
  });

  it("refuses to be used outside the provider rather than returning an empty world", () => {
    // Conservative failure: a component rendered outside the provider must fail loudly, not
    // silently render zero patients, which would read as a quiet night.
    expect(() => render(<Probe />)).toThrow(/WardFlowProvider/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/ward-flow-provider.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Build the provider**

`"use client"`. `useReducer(wardFlowReducer, undefined, seedWardFlowState)`.

The clock:

```ts
// `initialNow` is how tests pin time. Only the live app ticks.
const mountedAt = useRef<Instant | undefined>(undefined);
if (mountedAt.current === undefined) mountedAt.current = initialNow ?? wallClockNow();
const [ticks, setTicks] = useState(0);
useEffect(() => {
  if (initialNow !== undefined) return; // pinned: never tick in a test
  const id = setInterval(() => setTicks((value) => value + 1), 30_000);
  return () => clearInterval(id);
}, [initialNow]);
const elapsed = initialNow !== undefined ? 0 : Math.max(0, wallClockNow() - mountedAt.current);
const now = NOW_ANCHOR + elapsed + state.clockOffsetMinutes;
```

`useWardFlow()` throws a named error when the context is absent — never a default empty state.

`src/app/ward-management/layout.tsx` is a server component that renders `<WardFlowProvider>{children}</WardFlowProvider>`.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/ward-flow-provider.test.tsx`
Expected: PASS, 2 tests.

- [ ] **Step 5: Prove the app still boots**

```bash
npm run ensure
npx tsc --noEmit -p tsconfig.json
PLAYWRIGHT_BASE_URL=<url ensure printed> npx playwright test tests/ui-ward-coordinator.spec.ts tests/ui-ward-management.spec.ts --project=chromium --reporter=line
```

Expected: 21 passed, 0 skipped. Adding a layout above the routes must change nothing yet.

- [ ] **Step 6: Commit**

```bash
npm run format
git add src/components/ward-management/ward-flow-provider.tsx src/app/ward-management/layout.tsx tests/ward-flow-provider.test.tsx
git commit -m "feat(ward-flow): add the state provider and the ticking clock"
```

---

### Task 5: The coordinator rewire

The primary screen becomes live and its main action becomes a referral. Spec §7.

**Files:**

- Modify: `src/components/ward-management/coordinator/coordinator-screen.tsx`
- Modify: `src/components/ward-management/coordinator/shortlist-panel.tsx`
- Modify: `src/components/ward-management/coordinator/exception-drawer.tsx`
- Modify: `src/components/ward-management/ward-derivations.ts`
- Create: `tests/ward-restriction-notice.test.ts`
- Modify: `tests/ui-ward-coordinator.spec.ts`

**Interfaces:**

- Consumes: `useWardFlow()`.
- Produces: nothing new; the screen's props stop being derived from `wardMovements` and start coming from the provider.
- **Renames one testid:** the primary control in `shortlist-panel.tsx` currently reads `data-testid="ward-shortlist-confirm"` with the label `Confirm placement`. It becomes `data-testid="ward-shortlist-refer"` labelled `Refer`. The candidate rows keep their existing `data-testid={`ward-shortlist-candidate-${unit.id}`}` — do not rename those. Tasks 7 and 12 select on `ward-shortlist-refer`.

- [ ] **Step 1: Write the failing test**

```ts
// append to tests/ui-ward-coordinator.spec.ts
test("refers a patient to up to three wards and records what it did", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1100 });
  await gotoCoordinator(page);

  const queue = page.getByRole("region", { name: "Priority queue" });
  await queue.locator('[data-testid^="ward-queue-row-"]').first().click();

  const shortlist = page.getByRole("complementary", { name: "Explainable shortlist" });

  // Nothing is referable until a human picks a ward.
  const refer = shortlist.getByRole("button", { name: /Refer/ });
  await expect(refer).toHaveAttribute("aria-disabled", "true");

  await shortlist.locator('[data-testid^="ward-shortlist-candidate-"]').first().click();
  await expect(refer).not.toHaveAttribute("aria-disabled", "true");
  await refer.click();

  // The referral is recorded on the screen, and the parallel cap is stated.
  await expect(shortlist).toContainText(/parallel referral/i);
  await expect(shortlist).not.toContainText(/Confirm placement/);
});

test("shows a refused transition instead of swallowing it", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1100 });
  await gotoCoordinator(page);

  const drawer = page.getByRole("button", { name: /Exceptions/ });
  await drawer.click();
  // The refusals region exists even when empty, so a coordinator learns where to look.
  await expect(page.getByRole("region", { name: "Exceptions" })).toContainText(/refus/i);
});
```

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Add the restriction notice derivation and its test**

Two warnings, not one. Write `tests/ward-restriction-notice.test.ts` first and watch it fail:

```ts
import { describe, expect, it } from "vitest";

import { restrictionNotice } from "../src/components/ward-management/ward-derivations";
import { wardMovements } from "../src/components/ward-management/ward-movements";
import { allUnits } from "../src/components/ward-management/ward-sites";

const unit = (id: string) => allUnits().find((candidate) => candidate.id === id)!;

describe("restriction notice", () => {
  it("says nothing when the ward's security matches what the patient needs", () => {
    const open = wardMovements.find((m) => m.security === "Open" && m.legalStatus !== "Voluntary")!;
    expect(restrictionNotice(open, unit("scgh-adult-open"))).toBeUndefined();
  });

  it("flags a secure ward for an open-security patient as more restrictive than required", () => {
    const open = wardMovements.find((m) => m.security === "Open" && m.legalStatus !== "Voluntary")!;
    const notice = restrictionNotice(open, unit("rph-adult-secure"));
    expect(notice?.level).toBe("more_restrictive");
    expect(notice?.text).toMatch(/more restrictive/i);
  });

  it("flags a voluntary patient on a locked ward separately and more prominently", () => {
    const voluntary = wardMovements.find((m) => m.legalStatus === "Voluntary")!;
    const notice = restrictionNotice(voluntary, unit("rph-adult-secure"));
    expect(notice?.level).toBe("voluntary_on_locked");
    expect(notice?.text).toMatch(/voluntary/i);
    // It prompts a review; it never asserts that anything unlawful has happened.
    expect(notice?.text).not.toMatch(/unlawful|illegal|breach/i);
  });

  it("prefers the voluntary warning when both would apply", () => {
    const voluntaryOpen = wardMovements.find((m) => m.legalStatus === "Voluntary" && m.security === "Open")!;
    expect(restrictionNotice(voluntaryOpen, unit("rph-adult-secure"))?.level).toBe("voluntary_on_locked");
  });
});
```

Then add to `ward-derivations.ts`:

```ts
export type RestrictionNotice = { level: "voluntary_on_locked" | "more_restrictive"; text: string };

/**
 * A ward tighter than the patient needs raises one of two warnings, and they are different things.
 * A voluntary person who cannot leave a locked ward is detained in fact without an order, which is
 * sharper than merely over-restrictive and gets its own flag. Neither blocks a placement and
 * neither touches an eligibility gate — `ward-eligibility.ts` is a protected surface.
 */
export function restrictionNotice(movement: Movement, unit: Unit): RestrictionNotice | undefined {
  if (unit.security !== "Secure") return undefined;
  if (movement.legalStatus === "Voluntary") {
    return {
      level: "voluntary_on_locked",
      text: "Voluntary patient on a locked ward — review legal status before admission",
    };
  }
  if (movement.security === "Open") {
    return { level: "more_restrictive", text: "More restrictive than this movement requires" };
  }
  return undefined;
}
```

Run `npx vitest run tests/ward-restriction-notice.test.ts` — expected PASS, 4 tests.

- [ ] **Step 4: Rewire**

In `coordinator-screen.tsx`, replace the direct `wardMovements` import and the `NOW_ANCHOR` constant with `const { movements, units, rejections, now, dispatch } = useWardFlow();`, and pass `movements`, `units` and `now` down to every region. `queueOrder(movements, now)`, `edPressure(now, movements)`, `buildActionInbox(movements.filter(isOpen), now)`.

In `shortlist-panel.tsx`:

- "Confirm placement" becomes **"Refer to selected wards"**, dispatching `REFER_TO_UNITS` with every explicitly selected candidate, capped at three. Selection becomes multi-select; the existing explicit-selection guard stays — nothing is referable until a human has chosen.
- Each referred ward is labelled a parallel referral.
- Override keeps its reason-gated path and dispatches the same event with the reason recorded.
- **The security wording changes.** Render `restrictionNotice(movement, unit)` from Step 3 on every candidate row and every routed diagram node — the voluntary-on-locked warning more prominently than the more-restrictive one, both carried in text so they survive `forced-colors` rather than relying on colour. Candidate ordering ranks a security-matching ward above an over-restrictive one. `ward-eligibility.ts` is protected — do not change gate semantics, only the rendered text and the ordering.

In `exception-drawer.tsx`, add a refusals section rendering `rejections`, newest first, present even when empty.

- [ ] **Step 5: Run the gates**

```bash
npx tsc --noEmit -p tsconfig.json
npm run lint
npm run check:design-system-contract
PLAYWRIGHT_BASE_URL=<url> npx playwright test tests/ui-ward-coordinator.spec.ts tests/ui-ward-management.spec.ts --project=chromium --reporter=line
```

Read lint's output, not its exit code.

- [ ] **Step 6: Screenshot**

Capture `artifacts/ward-management/phase3-coordinator-live.png` at 1600×1100 with a patient selected and two wards chosen. **Look at it.** Does the screen say what it did, and does anything claim a placement that has not happened?

- [ ] **Step 7: Commit**

```bash
npm run format && git add -A src/components/ward-management/coordinator src/components/ward-management/ward-derivations.ts tests
git commit -m "feat(ward-flow): make the coordinator screen live and refer rather than place"
```

---

### Task 6: The other ten routes

Spec §8. Do this immediately after Task 5 — the window between them is exactly when the application shows two different truths.

**Files:**

- Modify: `src/components/ward-management/ward-derivations.ts`
- Modify: `src/components/ward-management/ward-management-modes.tsx`
- Modify: `src/components/ward-management/ward-management-network.tsx`
- Modify: `src/components/ward-management/ward-management-console.tsx`
- Create: `tests/ward-flow-single-source.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/ward-flow-single-source.test.ts
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WARD_DIR = "src/components/ward-management";

/** Files allowed to read the frozen fixture: the seed itself, and derivations that take it as a
 *  default parameter. Everything else must read the provider, or two surfaces will disagree. */
const ALLOWED = new Set(["ward-movements.ts", "ward-flow-reducer.ts", "ward-pressure.ts", "ward-derivations.ts"]);

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)],
  );
}

describe("one source of truth", () => {
  it("has no component reading the frozen fixture directly", () => {
    const offenders = walk(WARD_DIR)
      .filter((file) => file.endsWith(".tsx"))
      .filter((file) => !ALLOWED.has(file.split(/[\\/]/).pop()!))
      .filter((file) => /from "[^"]*ward-movements"/.test(readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("no longer exports a stage summary frozen at import time", () => {
    const source = readFileSync(join(WARD_DIR, "ward-derivations.ts"), "utf8");
    expect(source).not.toMatch(/export const movementStageSummary/);
  });
});
```

- [ ] **Step 2: Run to verify it fails.** Expected: four offenders, and `movementStageSummary` still exported.

- [ ] **Step 3: Delete the frozen constant**

In `ward-derivations.ts`, delete `export const movementStageSummary = stageSummaries(wardMovements);`. `stageSummaries(movements)` already exists and takes the list — every call site calls it with the current movements instead.

- [ ] **Step 4: Rewire the three components**

Each becomes a client component reading `useWardFlow()`. Replace `wardMovements` with `movements`, `allUnits()` with `units`, and `movementStageSummary` with `stageSummaries(movements)`. `ward-management-modes.tsx` serves eight routes from one file — change the data source only, not the layout.

- [ ] **Step 5: Run everything**

```bash
npx vitest run tests/ward-flow-single-source.test.ts tests/route-reachability.test.ts tests/ward-management.test.ts
npx tsc --noEmit -p tsconfig.json
npm run lint
PLAYWRIGHT_BASE_URL=<url> npx playwright test tests/ui-ward-coordinator.spec.ts tests/ui-ward-management.spec.ts --project=chromium --reporter=line
```

- [ ] **Step 6: Prove the two surfaces now agree**

In the browser, refer a patient on the coordinator screen, then navigate to `/ward-management/queue` **by clicking the rail link, not by reloading**, and confirm the board reflects the referral. Record what you saw.

- [ ] **Step 7: Commit**

```bash
npm run format && git add -A
git commit -m "refactor(ward-flow): every route reads one source of truth"
```

---

### Task 7: The coordinator's phone pins Confirm

Small, and the officer's screen inherits the pattern, so it must exist first.

**Files:**

- Modify: `src/components/ward-management/coordinator/coordinator-screen.tsx`
- Modify: `src/components/ward-management/coordinator/coordinator.module.css`
- Modify: `tests/ui-ward-coordinator.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// append to tests/ui-ward-coordinator.spec.ts
test("keeps the referral control reachable on a phone without moving the page", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoCoordinator(page);

  const queue = page.getByRole("region", { name: "Priority queue" });
  const scrollBefore = await page.evaluate(() => window.scrollY);
  await queue.locator('[data-testid^="ward-queue-row-"]').first().click();

  // The control is pinned, so selecting a patient must not scroll the page under the thumb.
  await expect(page.evaluate(() => window.scrollY)).resolves.toBe(scrollBefore);
  await expect(page.getByTestId("ward-shortlist-refer")).toBeInViewport();

  // And the queue keeps the room it was previously losing to a nested scroller.
  const rows = await queue.locator('[data-testid^="ward-queue-row-"]').count();
  expect(rows).toBeGreaterThan(4);
});
```

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Build it**

Delete the nested double-`requestAnimationFrame` `scrollIntoView` effect. Replace it with a bar pinned to the bottom of the viewport on phone widths carrying the referral and override controls, painting its own safe-area inset. The queue then takes the height the scroller was consuming.

- [ ] **Step 4: Run to verify it passes,** then capture `artifacts/ward-management/phase3-phone-pinned.png` and look at it.

- [ ] **Step 5: Commit**

```bash
npm run format && git add -A src/components/ward-management/coordinator tests
git commit -m "feat(ward-flow): pin the phone referral bar instead of scrolling to it"
```

---

## Checkpoint

Tasks 1–7 produce complete, coherent software: the coordinator screen is live, every existing route agrees with it, the reducer is proved, and the phone works. **If the phase is sprawling, stop here and re-plan.** Tasks 8–12 add the three new screens.

---

### Task 8: The ward screen

**Files:**

- Create: `src/components/ward-management/ward/ward-screen.tsx`
- Create: `src/app/ward-management/ward/[unitId]/page.tsx`
- Create: `tests/ui-ward-roles.spec.ts`
- Modify: `playwright.config.ts`, `docs/design-system/adoption-contract.json`, `ward-management-navigation.tsx`

**Interfaces:**

- Consumes: `useWardFlow()`, `unitById`, `unitCapacity`, `eligibility`, `DECLINE_REASONS`.
- Produces: `WardScreen({ unitId })`.

- [ ] **Step 1: Register the new spec in BOTH Playwright matchers**

Add `ward-roles` to the top-level `testMatch` regex **and** `productionSpecPattern` in `playwright.config.ts`. Missing either yields "No tests found", which reads like a pass. `npx vitest run tests/playwright-project-isolation.test.ts` is the proof.

- [ ] **Step 2: Write the failing test**

```ts
// tests/ui-ward-roles.spec.ts
import { expect, test, type Page } from "playwright/test";

async function gotoWard(page: Page, unitId: string) {
  await page.goto(`/ward-management/ward/${unitId}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("ward-unit-screen")).toBeVisible({ timeout: 15_000 });
  await page.waitForLoadState("networkidle");
}

test.describe("Ward screen", () => {
  test.describe.configure({ timeout: 45_000 });

  test("shows one unit's own capacity and answers an incoming referral", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1024 });
    await gotoWard(page, "bty-adult-secure");

    // One unit, not twenty-two.
    await expect(page.getByTestId("ward-unit-screen")).toContainText("BTY Adult Secure");
    await expect(page.locator('[data-testid^="ward-unit-card-"]')).toHaveCount(1);

    // Its beds reconcile on screen.
    const beds = page.getByTestId("ward-unit-beds");
    await expect(beds).toContainText("Ready");
    await expect(beds).toContainText("Occupied");

    // A decline requires a reason from the fixed list, and out-of-catchment is offered.
    // Unconditional: bty-adult-secure holds a live referral at seed, so this must not
    // hide behind an `if (count())` that can silently never run.
    const incoming = page.locator('[data-testid^="ward-incoming-"]');
    await expect(incoming).not.toHaveCount(0);
    await incoming
      .first()
      .getByRole("button", { name: /Decline/ })
      .click();
    const reasons = page.getByRole("group", { name: /Decline reason/ });
    await expect(reasons).toContainText(/out of catchment/i);
  });
});
```

- [ ] **Step 3: Run to verify it fails.**

- [ ] **Step 4: Build it**

`data-testid="ward-unit-screen"`. The unit resolved by `unitById(unitId)`; **an unresolved id renders an explicit empty state naming the id, never a substituted unit**.

Regions: this unit's five-state bed grid; incoming referrals awaiting an answer, each labelled a parallel referral where it is one and each carrying `restrictionNotice(movement, unit)` where it applies — the ward is the party who would be holding the person, so it sees the voluntary-on-locked warning too — with **accept in principle**, **hold a bed** and **decline** (a reason from the seven, no free text); who is accepted, held or en route here; and what was withdrawn and why, drawn from `withdrawnReferrals`.

`CONFIRM_CAPACITY` lets the ward restate what it can allocate. It writes to its own unit only.

Add the route to `adoption-contract.json`, run `npm run design-system:adoption:update`, and add a literal `<Link href="/ward-management/ward/rph-adult-secure">` to the rail so the route is not an orphan.

- [ ] **Step 5: Run the gates and screenshot** `artifacts/ward-management/phase3-ward.png`. Look at it: does every number belong to this ward and no other?

- [ ] **Step 6: Commit**

```bash
npm run format && git add -A
git commit -m "feat(ward-flow): add the ward screen"
```

---

### Task 9: The transport officer's phone

**Files:**

- Create: `src/components/ward-management/officer/officer-screen.tsx`
- Create: `src/app/ward-management/transport/officer/page.tsx`
- Modify: `tests/ui-ward-roles.spec.ts`, `adoption-contract.json`, `ward-management-navigation.tsx`

- [ ] **Step 1: Write the failing test**

```ts
// append to tests/ui-ward-roles.spec.ts
test("gives the officer four actions and nothing else", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/ward-management/transport/officer", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("ward-officer-screen")).toBeVisible({ timeout: 15_000 });
  await page.waitForLoadState("networkidle");

  const job = page.locator('[data-testid^="ward-officer-job-"]').first();
  await expect(job).toContainText(/escort/i);

  // Exactly four actions, pinned and reachable without scrolling.
  const actions = job.getByRole("button");
  await expect(actions).toHaveCount(4);
  for (const action of await actions.all()) {
    const box = await action.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(48);
  }

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(2);
});
```

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Build it**

Phone-first. Every job not yet arrived — the model records a `provider`, not a person, so **the screen says it is showing all jobs rather than inventing an officer to own them**. Per job: patient identifier, origin department, destination unit, legal form required, escort required. Four buttons dispatching `TRANSPORT_ACCEPTED`, `TRANSPORT_EN_ROUTE`, `PATIENT_COLLECTED`, `PATIENT_ARRIVED`. Each is unavailable, with a stated reason, until its predecessor has happened — never both `disabled` and `aria-disabled`.

Controls pinned to the bottom, following Task 7's pattern.

- [ ] **Step 4: Run the gates and screenshot** `artifacts/ward-management/phase3-officer-390.png`. Look at it: could a driver use this one-handed?

- [ ] **Step 5: Commit**

```bash
npm run format && git add -A
git commit -m "feat(ward-flow): add the transport officer phone screen"
```

---

### Task 10: The live tracker

**Files:**

- Create: `src/components/ward-management/tracker/live-tracker.tsx`
- Modify: `src/app/ward-management/transport/page.tsx`, `tests/ui-ward-roles.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// append to tests/ui-ward-roles.spec.ts
test("tracks every vehicle by leg and by how long since the last stamp", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1024 });
  await page.goto("/ward-management/transport", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("ward-live-tracker")).toBeVisible({ timeout: 15_000 });

  const rows = page.locator('[data-testid^="ward-tracker-row-"]');
  expect(await rows.count()).toBeGreaterThan(0);

  // Every row names its leg and its age, and no row claims a leg it has not reached.
  for (const row of await rows.all()) {
    await expect(row).toContainText(/Requested|Accepted|En route|Collected|Arrived/);
    await expect(row).toContainText(/ago|since/i);
  }
});
```

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Build it**

Rewrite `/ward-management/transport` as the coordinator's tracker: which patient, which leg, how long since the last stamp, using `transportStatusLabel` and `splitDuration`. A movement with no transport shows an explicit absence, never a fabricated leg.

- [ ] **Step 4: Run the gates and screenshot** `artifacts/ward-management/phase3-tracker.png`.

- [ ] **Step 5: Commit**

```bash
npm run format && git add -A
git commit -m "feat(ward-flow): rewrite transport as the coordinator's live tracker"
```

---

### Task 11: The emergency department screen

The last screen, and the one carrying both clocks. Spec §7.

**Files:**

- Create: `src/components/ward-management/ed/ed-screen.tsx`
- Create: `src/app/ward-management/ed/[edId]/page.tsx`
- Modify: `tests/ui-ward-roles.spec.ts`, `adoption-contract.json`, `ward-management-navigation.tsx`

- [ ] **Step 1: Write the failing test**

```ts
// append to tests/ui-ward-roles.spec.ts
test("shows a department its own patients, both clocks, and one outstanding item each", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1024 });
  await page.goto("/ward-management/ed/peel-ed", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("ward-ed-screen")).toBeVisible({ timeout: 15_000 });
  await page.waitForLoadState("networkidle");

  const rows = page.locator('[data-testid^="ward-ed-patient-"]');
  expect(await rows.count()).toBeGreaterThan(0);

  // Its own patients only.
  for (const row of await rows.all()) {
    await expect(row).toHaveAttribute("data-origin-ed", "peel-ed");
  }

  // The legal clock and the department clock are shown as different things.
  await expect(page.getByTestId("ward-ed-screen")).toContainText(/in department/i);
  await expect(page.getByTestId("ward-ed-screen")).toContainText(/legal clock|since form/i);

  // At least one community-formed patient shows a legal clock older than its time in department.
  const communityFormed = page.locator('[data-testid^="ward-ed-patient-"][data-community-formed="true"]');
  expect(await communityFormed.count()).toBeGreaterThan(0);

  // A department can raise a referral.
  await expect(page.getByRole("button", { name: /Raise referral/ })).toBeVisible();
});
```

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Build it**

Its own patients, filtered on `originEdId`. Each row carries **both clocks** — time in the department from `openedAt`, and the legal clock from `formedAt` where that is earlier, marked `data-community-formed="true"` when they differ — plus the four-hour access target, a police flag where `arrivalMode` says so, and **the single outstanding item**: a form, an examination, a transport request, or handover.

Two forms: **raise a referral** (cohort, security, sex, specialling, legal status, urgency — dispatching `RAISE_REFERRAL`) and **record an examination** with its outcome (dispatching `RECORD_EXAMINATION`; `revoked` closes the movement).

Statewide capacity visible and read-only. No statewide queue, no shortlist, no diagram.

- [ ] **Step 4: Run the gates and screenshot** `artifacts/ward-management/phase3-ed.png`. Look at it: does any patient's legal clock read as shorter than its time in the department? That would be backwards.

- [ ] **Step 5: Commit**

```bash
npm run format && git add -A
git commit -m "feat(ward-flow): add the emergency department screen with both clocks"
```

---

### Task 12: The role switcher, the loop, and proving the phase

**Files:**

- Create: `src/components/ward-management/ward-role-switcher.tsx`
- Modify: `ward-management-navigation.tsx`, `tests/ui-ward-roles.spec.ts`

- [ ] **Step 1: Write the failing test — the journey that proves the phase**

```ts
// append to tests/ui-ward-roles.spec.ts
test("walks one patient through all four roles in a single window", async ({ page }) => {
  // NOTE: this journey must navigate by CLICKING. `page.goto()` is a full page load, which
  // resets the provider — the test would then pass or fail for reasons unrelated to the code.
  await page.setViewportSize({ width: 1440, height: 1024 });
  await page.goto("/ward-management", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("ward-coordinator")).toBeVisible({ timeout: 15_000 });
  await page.waitForLoadState("networkidle");

  // Coordinator refers.
  const queue = page.getByRole("region", { name: "Priority queue" });
  const firstRow = queue.locator('[data-testid^="ward-queue-row-"]').first();
  const movementId = (await firstRow.getAttribute("data-testid"))!.replace("ward-queue-row-", "");
  await firstRow.click();

  const shortlist = page.getByRole("complementary", { name: "Explainable shortlist" });
  await shortlist.locator('[data-testid^="ward-shortlist-candidate-"]').first().click();
  await shortlist.getByRole("button", { name: /Refer/ }).click();

  // Switch to the ward the patient was referred to — by clicking, not navigating.
  await page.getByRole("button", { name: /Switch role/ }).click();
  await page.getByRole("menuitem", { name: /Ward/ }).click();
  await expect(page.getByTestId("ward-unit-screen")).toBeVisible();
  const incoming = page.locator(`[data-testid="ward-incoming-${movementId}"]`);
  await expect(incoming).toBeVisible();

  // Ward accepts and holds a bed.
  await incoming.getByRole("button", { name: /Accept/ }).click();
  await incoming.getByRole("button", { name: /Hold a bed/ }).click();

  // Back to the coordinator: the acceptance is already there.
  await page.getByRole("button", { name: /Switch role/ }).click();
  await page.getByRole("menuitem", { name: /Coordinator/ }).click();
  await expect(page.getByRole("complementary", { name: "Explainable shortlist" })).toContainText(/Accepted/);

  // Officer completes the journey.
  await page.getByRole("button", { name: /Switch role/ }).click();
  await page.getByRole("menuitem", { name: /Transport officer/ }).click();
  const job = page.locator(`[data-testid="ward-officer-job-${movementId}"]`);
  for (const label of ["Accepted", "En route", "Collected", "Arrived"]) {
    await job.getByRole("button", { name: label }).click();
  }

  // Arrival closes the record: the patient leaves the system entirely.
  await page.getByRole("button", { name: /Switch role/ }).click();
  await page.getByRole("menuitem", { name: /Coordinator/ }).click();
  await expect(queue.locator(`[data-testid="ward-queue-row-${movementId}"]`)).toHaveCount(0);
});
```

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Build the switcher**

Four roles. Where you stand is inferred from the selected patient — Ward goes to the unit it was referred to, ED to its origin department — with a picker to move elsewhere. **The coordinator has no place**; the switcher shows that asymmetry rather than inventing a location. Tap targets `3rem`. Each destination is a real `<Link>` so the routes are reachable.

- [ ] **Step 4: Prove the phase**

```bash
npx tsc --noEmit -p tsconfig.json
npx vitest run
npm run lint
npm run check:design-system-contract
npm run ensure
PLAYWRIGHT_BASE_URL=<url> npx playwright test tests/ui-ward-coordinator.spec.ts tests/ui-ward-management.spec.ts tests/ui-ward-roles.spec.ts --project=chromium --reporter=line
```

Read lint's output, not its exit code. Do **not** run `verify:ui`, `verify:release`, `eval:*` or `check:supabase-project` — the owner has asked for CI restraint and everything here is offline.

- [ ] **Step 5: The screenshot pass**

Collect every capture from Tasks 5–11 and review them as a set at full size. Ask of each: **is every number on it derived from the current state, and does every label say what the number actually means?** Then send the set to the owner. Their eyes are the gate this phase cannot pass without — every serious defect in Phases 1 and 2 was something that passed its tests and was visibly wrong.

- [ ] **Step 6: Commit**

```bash
npm run format
git add -A
git commit -m "feat(ward-flow): add the role switcher and prove the loop end to end"
```

---

## Self-Review

**Spec coverage.** §3 model changes → Task 1. §4 state layer → Tasks 2 and 4. §5 clock → Task 4. §6 events → Task 2. §7 screens → Tasks 5, 8, 9, 10, 11. §8 the ten routes → Task 6. §9 role switching → Task 12. §10 failure behaviour → Tasks 2, 3 and 5. §11 escalation → Task 5's `RECORD_ESCALATION` dispatch and the shortlist's existing no-eligible-destination state. §12 simplifications → recorded, nothing to build. §14 proof → Tasks 3 and 12. §15 build order → task order, with build-order item 1 already complete at `7f373e80f`. §17 conventions → Tasks 8, 9 and 11 each register their route.

**Type consistency.** `WardFlowState`, `WardFlowEvent`, `WardFlowRole`, `seedWardFlowState`, `wardFlowReducer` are defined in Task 2 and consumed under those names in Tasks 3, 4, 5 and 6. `useWardFlow()` is defined in Task 4 and consumed in Tasks 5, 6, 8, 9, 10, 11 and 12. `Rejection` is defined in Task 1 and consumed in Tasks 2 and 5.

**Two things a reviewer should watch for.** First, that no screen has quietly kept its own copy of the fixture — Task 6's static test is the guard and it must not be weakened. Second, that the end-to-end journey navigates by clicking; a single `page.goto()` in it silently resets the world and the test then proves nothing.
