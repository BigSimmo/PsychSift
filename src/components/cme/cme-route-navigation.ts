import type { CmeRoutineLogPrefill } from "@/lib/cme/routines";

/** The entry form. One screen, reached from the log, the setup page and a routine's Log control. */
export const CME_NEW_ENTRY_ROUTE = "/cme/new";

/**
 * Where a routine's form-based "Log" path sends the owner.
 *
 * Used for not-yet-due "Log now", for due routines without a usual category
 * split, and for My Day deep links. Due "Log N h" with a usual split saves
 * immediately in the route instead (see `useCmeOneTapRoutineLog`).
 *
 * The routine id travels in the query. The server resolves only an owner-loaded
 * routine and passes its title, usual hours and category split to the form.
 */
export function cmeRoutineLogHref(prefill: CmeRoutineLogPrefill): string {
  return `${CME_NEW_ENTRY_ROUTE}?routine=${encodeURIComponent(prefill.routineId)}`;
}
