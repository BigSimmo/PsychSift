// src/components/ward-management/ward-pressure.ts
import { clockState, minutesUntil, type Instant } from "@/components/ward-management/ward-clock";
import { isOpen } from "@/components/ward-management/ward-derivations";
import type { EmergencyDepartment, Movement } from "@/components/ward-management/ward-model";
import { wardMovements } from "@/components/ward-management/ward-movements";
import { allEmergencyDepartments } from "@/components/ward-management/ward-sites";

export type EdPressure = {
  ed: EmergencyDepartment;
  waiting: number;
  longestWaitMinutes: number;
  breaching: number;
};

/**
 * Worst first: a passed legal deadline outranks a long wait, which outranks sheer volume.
 *
 * `movements` defaults to the live fixture but is deliberately injectable — this is the mirror
 * of `queueOrder(movements, now)` in `ward-priority.ts`, just with the parameter order kept as
 * `(now, movements)` because `now` is the argument every existing and planned call site passes
 * first. Without the injection point, every assertion about this function is forced to key off
 * the one fixture, which happens to have every department busy and every wait positive — that
 * is what let three false-positive tests through review the first time.
 */
export function edPressure(now: Instant, movements: Movement[] = wardMovements): EdPressure[] {
  return allEmergencyDepartments()
    .map((ed) => {
      const open = movements.filter((movement) => isOpen(movement) && movement.originEdId === ed.id);
      // A movement authored with a future `openedAt` must never surface as a negative wait on
      // a coordinator's card — clamp at zero rather than display something that reads as true
      // and isn't.
      const waits = open.map((movement) => Math.max(0, minutesUntil(now, movement.openedAt)));
      return {
        ed,
        waiting: open.length,
        longestWaitMinutes: waits.length ? Math.max(...waits) : 0,
        // "Breached" already has one definition, owned by ward-clock.ts: `clockState` returns
        // "breached" exactly when the deadline has passed. Reuse it rather than re-deriving the
        // same condition inline, so the two never quietly drift apart. A form with no `dueAt`
        // (Task 6A: a Form 3B honestly carries none) is never breached — `undefined` must never
        // reach `clockState`'s arithmetic.
        breaching: open.filter(
          (movement) =>
            movement.legalForm?.dueAt !== undefined && clockState(movement.legalForm.dueAt, now) === "breached",
        ).length,
      };
    })
    .sort((a, b) => b.breaching - a.breaching || b.longestWaitMinutes - a.longestWaitMinutes || b.waiting - a.waiting);
}
