### Task 6: Plan ownership, reassignment and coverage

Nothing today records which coordinator owns a plan. `claimPlan` and `reassignPlan` are granted action names with no implementation and no field, which is why the spec §4.2 workload monitor ("active plans per coordinator") is currently uncomputable. Spec §4.3 also asks for coverage and absence, "with the named coordinator and any formal reassignment still visible" — so coverage must never erase the owner.

**Files:**

- Create: `src/lib/caring-contacts/assignment.ts`
- Test: `tests/caring-contacts-assignment.test.ts` (new)

**Interfaces:**

- Produces:

```ts
export type PlanAssignment = {
  ownerId: ActorId | null;
  claimedAt: string | null;
  coveredBy: { actorId: ActorId; from: string; until: string } | null;
  reassignmentHistory: readonly { fromActorId: ActorId; toActorId: ActorId; reason: string; at: string }[];
};

export type AssignmentAction =
  | { type: "claim"; actorId: ActorId }
  | { type: "reassign"; toActorId: ActorId; reason: string }
  | { type: "startCoverage"; actorId: ActorId; from: string; until: string }
  | { type: "endCoverage" };

export function unassigned(): PlanAssignment;
export function applyAssignmentAction(
  assignment: PlanAssignment,
  action: AssignmentAction,
  clock: Clock,
): TransitionResult<PlanAssignment>;
export function effectiveResponder(assignment: PlanAssignment, atIso: string): ActorId | null;
export function queueAgeMinutes(claimableSinceIso: string, nowIso: string): number;
export const UNCLAIMED_ESCALATION_MINUTES: 60;
```

**Rules:** `claim` is refused `plan-already-claimed` when an owner exists. `reassign` is refused `plan-not-claimed` when there is no owner and `reassignment-reason-required` on a blank reason; it appends to `reassignmentHistory` and **keeps the full history** — a reassignment never deletes the earlier owner. `startCoverage` is refused `plan-not-claimed` without an owner and `coverage-window-invalid` when `until` is not after `from`; it **never changes `ownerId`**. `effectiveResponder` returns the coverer inside the coverage window and the owner otherwise. `queueAgeMinutes` is whole minutes, floored, and never negative. `UNCLAIMED_ESCALATION_MINUTES` is the spec's 60-minute unclaimed-work escalation.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";

import { fixedClock } from "@/lib/caring-contacts/clock";
import { actorId } from "@/lib/caring-contacts/ids";
import {
  UNCLAIMED_ESCALATION_MINUTES,
  applyAssignmentAction,
  effectiveResponder,
  queueAgeMinutes,
  unassigned,
  type PlanAssignment,
} from "@/lib/caring-contacts/assignment";

const clock = fixedClock("2026-08-19T02:00:00.000Z");
const OWNER = actorId("ACTOR-OWNER");

function claimed(): PlanAssignment {
  const result = applyAssignmentAction(unassigned(), { type: "claim", actorId: OWNER }, clock);
  if (!result.ok) throw new Error(result.reason);
  return result.value;
}

describe("plan ownership", () => {
  it("records the owner on claim and refuses a second claim", () => {
    expect(claimed().ownerId).toBe(OWNER);
    expect(applyAssignmentAction(claimed(), { type: "claim", actorId: actorId("OTHER") }, clock)).toEqual({
      ok: false,
      reason: "plan-already-claimed",
    });
  });

  it("keeps the previous owner visible in the reassignment history", () => {
    const result = applyAssignmentAction(
      claimed(),
      { type: "reassign", toActorId: actorId("ACTOR-NEW"), reason: "annual leave" },
      clock,
    );
    if (!result.ok) throw new Error(result.reason);
    expect(result.value.ownerId).toBe(actorId("ACTOR-NEW"));
    expect(result.value.reassignmentHistory).toHaveLength(1);
    expect(result.value.reassignmentHistory[0]).toMatchObject({ fromActorId: OWNER, reason: "annual leave" });
  });

  it("covers without replacing the named coordinator", () => {
    const result = applyAssignmentAction(
      claimed(),
      { type: "startCoverage", actorId: actorId("ACTOR-COVER"), from: "2026-08-20", until: "2026-08-27" },
      clock,
    );
    if (!result.ok) throw new Error(result.reason);
    expect(result.value.ownerId).toBe(OWNER);
    expect(effectiveResponder(result.value, "2026-08-21")).toBe(actorId("ACTOR-COVER"));
    expect(effectiveResponder(result.value, "2026-08-28")).toBe(OWNER);
  });

  it("refuses a coverage window that does not move forward", () => {
    expect(
      applyAssignmentAction(
        claimed(),
        { type: "startCoverage", actorId: actorId("C"), from: "2026-08-20", until: "2026-08-20" },
        clock,
      ),
    ).toEqual({ ok: false, reason: "coverage-window-invalid" });
  });

  it("measures queue age against the 60-minute escalation", () => {
    expect(UNCLAIMED_ESCALATION_MINUTES).toBe(60);
    expect(queueAgeMinutes("2026-08-19T00:00:00.000Z", "2026-08-19T01:30:00.000Z")).toBe(90);
    expect(queueAgeMinutes("2026-08-19T02:00:00.000Z", "2026-08-19T01:00:00.000Z")).toBe(0);
  });
});
```

- [ ] **Step 2: Run and verify it fails.**
- [ ] **Step 3: Implement `assignment.ts`.**
- [ ] **Step 4: Run and verify it passes.** Paste the `N passed` line.
- [ ] **Step 5: Prove it can fail.** Make `startCoverage` set `ownerId` to the coverer → the "covers without replacing" test goes red. Revert.
- [ ] **Step 6: Commit**

```bash
git add src/lib/caring-contacts/assignment.ts tests/caring-contacts-assignment.test.ts
git commit -m "feat(caring-contacts): plan ownership, reassignment history and coverage"
```

---
