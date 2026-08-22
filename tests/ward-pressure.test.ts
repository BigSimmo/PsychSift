// tests/ward-pressure.test.ts
import { describe, expect, it } from "vitest";

import { edPressure } from "../src/components/ward-management/ward-pressure";
import { isOpen } from "../src/components/ward-management/ward-derivations";
import { wardMovements } from "../src/components/ward-management/ward-movements";
import { NOW_ANCHOR, allEmergencyDepartments } from "../src/components/ward-management/ward-sites";
import type { Movement } from "../src/components/ward-management/ward-model";

// A real, valid, open movement (no legalForm, no closure) to spread from when a test needs a
// hand-built movement list — this keeps every field the type requires without re-typing the
// whole shape, and keeps injected data honestly movement-shaped rather than a partial stub.
const baseMovement = wardMovements.find((movement) => movement.id === "WF-002");
if (!baseMovement) throw new Error("Fixture movement WF-002 is required as a template for ward-pressure tests");

function movementFrom(overrides: Partial<Movement>): Movement {
  // `{ ...baseMovement, ...overrides }` widens every overridden field back to optional under
  // TypeScript's spread-merge rules (a known quirk when the second spread's type is Partial<T>),
  // even though every field is genuinely present at runtime. Object.assign keeps the precise
  // `Movement` type because its overload intersects the source types instead of merging them.
  return Object.assign({}, baseMovement, overrides);
}

describe("emergency department pressure", () => {
  it("reports every department, including quiet ones", () => {
    expect(edPressure(NOW_ANCHOR)).toHaveLength(allEmergencyDepartments().length);
  });

  it("counts only open movements — an arrived or closed patient is not still waiting", () => {
    const total = edPressure(NOW_ANCHOR).reduce((sum, row) => sum + row.waiting, 0);
    expect(total).toBe(wardMovements.filter(isOpen).length);
  });

  it("never reports a longer wait than the department's longest-waiting movement", () => {
    for (const row of edPressure(NOW_ANCHOR)) {
      const waits = wardMovements
        .filter((movement) => isOpen(movement) && movement.originEdId === row.ed.id)
        // IMPORTANT 3: mirror the implementation's clamp here too. Without it this expectation
        // is only true by coincidence of today's fixture (every open movement's wait happens to
        // be positive) and would go red the moment a future-dated `openedAt` was authored, even
        // though the implementation was doing the conservative, correct thing.
        .map((movement) => Math.max(0, NOW_ANCHOR - movement.openedAt));
      expect(row.longestWaitMinutes).toBe(waits.length ? Math.max(...waits) : 0);
    }
  });

  it("counts a breach only where a legal deadline has actually passed", () => {
    for (const row of edPressure(NOW_ANCHOR)) {
      const breaching = wardMovements.filter(
        (movement) =>
          isOpen(movement) &&
          movement.originEdId === row.ed.id &&
          movement.legalForm?.dueAt !== undefined &&
          movement.legalForm.dueAt < NOW_ANCHOR,
      ).length;
      expect(row.breaching).toBe(breaching);
    }
  });

  it("sorts worst first — breaching, then longest wait, then volume", () => {
    // RULING 1: the brief's original assertion compared two arrays with `>=`, which coerces
    // both sides to strings and compares character-by-character. That reads "2,767,7" against
    // "2,730,6" as text, not numbers — it passes on today's fixture by luck, and it would also
    // pass a genuinely wrong ordering (a longest wait of 95 sorted before 240 compares as
    // "9" > "2" and looks correctly ordered). Compare the tuple numerically instead, with
    // explicit tie-breaking: breaching first, then longest wait, then waiting volume.
    function compareWorstFirst(
      a: { breaching: number; longestWaitMinutes: number; waiting: number },
      b: { breaching: number; longestWaitMinutes: number; waiting: number },
    ): number {
      return b.breaching - a.breaching || b.longestWaitMinutes - a.longestWaitMinutes || b.waiting - a.waiting;
    }

    const rows = edPressure(NOW_ANCHOR);
    for (let index = 1; index < rows.length; index += 1) {
      const previous = rows[index - 1];
      const current = rows[index];
      // previous must not be worse-ranked than current: comparing (previous, current) must not
      // come out positive, i.e. current must not outrank previous.
      expect(compareWorstFirst(previous, current)).toBeLessThanOrEqual(0);
    }
  });

  // IMPORTANT 1: with only the live fixture (where every department has open movements), a
  // dropped-department mutation like `.filter((row) => row.waiting > 0)` still returns 5/5.
  // Injecting an empty movement list is the only way to prove every department survives with
  // zeros rather than vanishing from the coordinator's card row.
  it("reports every department with zeros, never drops one, when there are no open movements at all", () => {
    const rows = edPressure(NOW_ANCHOR, []);
    const departments = allEmergencyDepartments();
    expect(rows).toHaveLength(departments.length);
    for (const department of departments) {
      const row = rows.find((candidate) => candidate.ed.id === department.id);
      expect(row).toBeDefined();
      // The row's `ed` must be the real department object, never a substituted or fabricated
      // one — a quiet department renders as itself with zeros, not as something else.
      expect(row?.ed).toBe(department);
      expect(row?.waiting).toBe(0);
      expect(row?.longestWaitMinutes).toBe(0);
      expect(row?.breaching).toBe(0);
    }
  });

  // IMPORTANT 2: nothing in the other tests pins a count to the *correct* department — a
  // network-wide total and per-row self-consistency both survive rotating each department's
  // count onto its neighbour. A hand-built, known-origin movement list is the only way to prove
  // attribution, not just volume.
  it("attributes each department's count to that department, not a neighbour's", () => {
    const movements: Movement[] = [
      movementFrom({ id: "TEST-peel-1", originEdId: "peel-ed", openedAt: NOW_ANCHOR - 10 }),
      movementFrom({ id: "TEST-peel-2", originEdId: "peel-ed", openedAt: NOW_ANCHOR - 20 }),
      movementFrom({ id: "TEST-peel-3", originEdId: "peel-ed", openedAt: NOW_ANCHOR - 30 }),
      movementFrom({ id: "TEST-fsh-1", originEdId: "fsh-ed", openedAt: NOW_ANCHOR - 5 }),
    ];

    const rows = edPressure(NOW_ANCHOR, movements);
    for (const row of rows) {
      if (row.ed.id === "peel-ed") {
        expect(row.waiting).toBe(3);
      } else if (row.ed.id === "fsh-ed") {
        expect(row.waiting).toBe(1);
      } else {
        expect(row.waiting).toBe(0);
      }
    }
  });

  // IMPORTANT 3: a dedicated, isolated proof of the clamp — independent of the fixture, whose
  // waits are all currently positive by coincidence. This is the test that must go red if the
  // `Math.max(0, …)` clamp is removed from the implementation.
  it("clamps a future-dated openedAt to a zero wait rather than a negative one", () => {
    const movements: Movement[] = [
      movementFrom({ id: "TEST-future-open", originEdId: "rgh-ed", openedAt: NOW_ANCHOR + 30 }),
    ];
    const rows = edPressure(NOW_ANCHOR, movements);
    const row = rows.find((candidate) => candidate.ed.id === "rgh-ed");
    expect(row?.longestWaitMinutes).toBe(0);
  });

  // MINOR 4: `clockState` treats zero remaining as "critical", not "breached" — only strictly
  // negative remaining time counts as a breach. Nothing in the live fixture has a deadline
  // exactly at `now`, so a `<=` substituted for `clockState` would still pass every other test.
  it("does not count a deadline due exactly now as breaching", () => {
    const movements: Movement[] = [
      movementFrom({
        id: "TEST-due-now",
        originEdId: "sjgm-ed",
        legalForm: { code: "1A", label: "Referral for examination", kind: "examination", dueAt: NOW_ANCHOR },
      }),
    ];
    const rows = edPressure(NOW_ANCHOR, movements);
    const row = rows.find((candidate) => candidate.ed.id === "sjgm-ed");
    expect(row?.breaching).toBe(0);
  });

  // Task 6A: a Form 3B honestly carries no dueAt at all (the Mental Health Act imposes no
  // post-examination deadline) — a form in that state must never reach `clockState`'s
  // arithmetic and must never be counted as breaching, however long the patient has waited.
  it("never counts a legal form with no dueAt as breaching, however old the movement", () => {
    const movements: Movement[] = [
      movementFrom({
        id: "TEST-no-deadline",
        originEdId: "sjgm-ed",
        openedAt: NOW_ANCHOR - 10_000,
        legalForm: { code: "3B", label: "Inpatient treatment order", kind: "detention" },
      }),
    ];
    const rows = edPressure(NOW_ANCHOR, movements);
    const row = rows.find((candidate) => candidate.ed.id === "sjgm-ed");
    expect(row?.breaching).toBe(0);
  });
});
