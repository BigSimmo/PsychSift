import type { CalendarEvent, CalendarRecurrence } from "@/lib/calendar/calendar-event";
import { formatRoutineHours, type CmeRoutine, type CmeRoutineCadence } from "@/lib/cme/routines";
import type { CmeEntry, CmeRequirementSet } from "@/lib/cme/types";
import { CME_CLOSE_WINDOW_DAYS } from "@/lib/cme/year-close";
import { isRanzcpHome } from "@/lib/cme/home-choice";
import { addDays } from "@/lib/calendar/calendar-event";

/**
 * CME's dates as calendar events: what was logged, when each routine is next
 * due (and every repeat after), and the year's own dates.
 *
 * The MyCPD reporting date is shown only when the owner confirmed the RANZCP
 * preset for the year. It is the college's date, not a Medical Board one, and
 * this mode never asserts a requirement the owner has not confirmed.
 */

const CADENCE_RECURRENCE: Record<CmeRoutineCadence, CalendarRecurrence> = {
  weekly: "weekly",
  monthly: "monthly",
  quarterly: "quarterly",
};

/** RANZCP's 2026 program guide keeps each year's claim open until 1 March of the following year. */
export function cmeReportingCloseDate(set: CmeRequirementSet): string | null {
  return isRanzcpHome(set.confirmedSource) ? `${set.year + 1}-03-01` : null;
}

export function cmeDeadlineEvents(set: CmeRequirementSet): CalendarEvent[] {
  const events: CalendarEvent[] = [
    {
      id: `cme-${set.year}-close-window`,
      title: `You can close your ${set.year} CPD year from today`,
      date: addDays(`${set.year}-12-31`, -CME_CLOSE_WINDOW_DAYS),
      kind: "deadline",
      reminderType: "cpd-year-end",
      href: `/cme/summary?year=${set.year}`,
      notes: "Check each entry against your records, then open your annual summary.",
    },
    {
      id: `cme-${set.year}-year-end`,
      title: `End of the ${set.year} CPD year`,
      date: `${set.year}-12-31`,
      kind: "deadline",
      reminderType: "cpd-year-end",
      href: `/cme/check?year=${set.year}`,
      notes: "Activities after today count toward next year.",
    },
  ];
  const reporting = cmeReportingCloseDate(set);
  if (reporting) {
    events.push({
      id: `cme-${set.year}-mycpd-close`,
      title: `Last day to finish your ${set.year} claim in MyCPD`,
      date: reporting,
      kind: "deadline",
      reminderType: "cpd-year-end",
      href: `/cme/log?year=${set.year}&copy=todo`,
      notes: "RANZCP keeps the previous year's claim open until 1 March. Confirm the date with your CPD home.",
    });
  }
  return events;
}

export function cmeRoutineEvents(routines: readonly CmeRoutine[]): CalendarEvent[] {
  return routines
    .filter((routine) => !routine.archivedAt && routine.nextDue)
    .map((routine) => ({
      id: `cme-routine-${routine.id}`,
      title: routine.title,
      date: routine.nextDue!,
      kind: "due" as const,
      reminderType: "cpd-routines" as const,
      recurrence: CADENCE_RECURRENCE[routine.cadence],
      href: "/cme/routines",
      notes: `Usually ${formatRoutineHours(routine.usualHours)} of CPD.`,
    }));
}

export function cmeLoggedEvents(entries: readonly CmeEntry[]): CalendarEvent[] {
  return entries
    .filter((entry) => !entry.archivedAt)
    .map((entry) => ({
      id: `cme-entry-${entry.id}`,
      title: entry.title,
      date: entry.date,
      kind: "logged" as const,
      href: `/cme/log/${entry.id}`,
    }));
}

/** Everything for the calendar page. Logged activities are shown but never exported: they are already in the past. */
export function cmeCalendarEvents(args: {
  set: CmeRequirementSet;
  entries: readonly CmeEntry[];
  routines: readonly CmeRoutine[];
}): { shown: CalendarEvent[]; exported: CalendarEvent[] } {
  const exported = [...cmeRoutineEvents(args.routines), ...cmeDeadlineEvents(args.set)];
  return { shown: [...cmeLoggedEvents(args.entries), ...exported], exported };
}
