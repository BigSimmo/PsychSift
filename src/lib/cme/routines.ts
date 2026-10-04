import { perthCalendarDate } from "@/lib/cme/cpd-year";
import type { CmeAllocation } from "@/lib/cme/types";

/**
 * How often the owner expects to do this activity. Purely descriptive — it
 * decides nothing about `nextDue`, which is a plain date the owner (or a
 * future scheduler) sets explicitly. Matches the `cme_routines.cadence` check
 * constraint in the schema (`supabase/schema.sql`).
 */
export const cmeRoutineCadences = ["weekly", "monthly", "quarterly"] as const;
export type CmeRoutineCadence = (typeof cmeRoutineCadences)[number];

export const cmeRoutineCadenceLabels: Record<CmeRoutineCadence, string> = {
  weekly: "Weekly",
  monthly: "Monthly",
  quarterly: "Quarterly",
};

/**
 * A recurring activity the owner does every month or term — supervision, a
 * journal club, a peer-review meeting.
 *
 * A routine is a reminder to log something. Nothing in this module writes a
 * `CmeEntry` — due "Log N h" saves in the route UI when the owner taps it.
 * See `routinesDueOn` (what is due) and `routineLogPrefill` (the payload a
 * Log tap builds) below.
 */
export type CmeRoutine = {
  readonly id: string;
  readonly title: string;
  readonly cadence: CmeRoutineCadence;
  /** What the owner usually logs for this routine, in hours. */
  readonly usualHours: number;
  /**
   * How those hours usually split across categories. Often empty — plenty of
   * routines have no fixed split, and the owner chooses each time he logs one.
   */
  readonly usualAllocations: readonly CmeAllocation[];
  /** The next Perth calendar date (`YYYY-MM-DD`) this is due, or `null` if it has not been scheduled. */
  readonly nextDue: string | null;
  /**
   * When the owner retired this routine, or `null` while it is active. An
   * archived routine is never due and is never offered as a suggestion —
   * `routinesDueOn` excludes it unconditionally.
   */
  readonly archivedAt: string | null;
};

/**
 * The payload a Log tap builds for one routine, as of `instant`. Building it
 * here once keeps due "Log N h" and not-yet-due "Log now" aligned on which
 * fields a routine carries forward. The UI either saves this immediately
 * (due + usual split, with Undo) or opens the entry form with it.
 */
export type CmeRoutineLogPrefill = {
  readonly routineId: string;
  /**
   * Today's Perth calendar date — a routine is always offered as of today,
   * never backdated to `nextDue`. "Due" and "when it actually happened" are
   * different facts, and only the owner knows the second one.
   */
  readonly date: string;
  readonly title: string;
  readonly hours: number;
  readonly allocations: readonly CmeAllocation[];
};

/** Builds the pre-fill for a "Log" tap on `routine`, as of `instant`. Read-only: it returns a value, it writes nothing. */
export function routineLogPrefill(routine: CmeRoutine, instant: Date): CmeRoutineLogPrefill {
  return {
    routineId: routine.id,
    date: perthCalendarDate(instant),
    title: routine.title,
    hours: routine.usualHours,
    allocations: routine.usualAllocations,
  };
}

/**
 * Which routines are due as of `instant`, in Perth.
 *
 * Two parameters, deliberately and permanently — see the sibling test "never
 * logs itself", which pins `routinesDueOn.length` at 2. This function is a
 * read: it reports which routines have reached their next-due date and
 * nothing else. There is no companion function that turns this list into
 * entries, because only the owner knows whether he was actually there —
 * that decision is his, made through the entry form, one confirmation at a
 * time. `CmeRoutinesPage` is the only caller, and it only ever uses this list
 * to decide what to show, never to log anything on its own.
 *
 * An archived routine never appears here. Nor does a routine with no
 * `nextDue` set — it is waiting on the owner to schedule it, not overdue.
 */
export function routinesDueOn(routines: readonly CmeRoutine[], instant: Date): readonly CmeRoutine[] {
  const today = perthCalendarDate(instant);
  return routines
    .filter((routine) => routine.archivedAt === null && routine.nextDue !== null && routine.nextDue <= today)
    .slice()
    .sort((a, b) => (a.nextDue ?? "").localeCompare(b.nextDue ?? ""));
}

const MONTH_ABBREVIATIONS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/**
 * Renders a Perth calendar date (`YYYY-MM-DD`) as "28 Sep 2026".
 *
 * Deliberately plain string arithmetic, not `Date` + `Intl.DateTimeFormat`:
 * the value is already the correct Perth calendar day, so parsing it back
 * into an instant and re-projecting it through a time zone is a needless
 * round trip — one a runtime whose local zone sits behind UTC could roll
 * onto the wrong day. Splitting the string cannot.
 */
export function formatRoutineDueDate(dateIso: string): string {
  const [year, month, day] = dateIso.split("-");
  const monthIndex = Number.parseInt(month, 10) - 1;
  const dayNumber = Number.parseInt(day, 10);
  return `${dayNumber} ${MONTH_ABBREVIATIONS[monthIndex]} ${year}`;
}

/** "1" -> "1.0", "1.5" -> "1.5" — always one decimal, so a routine's hours read the same everywhere they appear. */
export function formatRoutineHours(hours: number): string {
  return hours.toFixed(1);
}
