import { useBookingCalendarEntries } from "@/components/work-calendar/use-booking-calendar-entries";
import { useRotationCalendarEntries } from "@/components/work-calendar/use-rotation-calendar-entries";
import type { WorkCalendarEntry } from "@/lib/work-calendar/entries";

/**
 * Every feature that puts entries on a doctor's work calendar (Roster month,
 * My Day, and later the calendar feed), in one static list.
 *
 * A source is a React hook: `read(enabled)` returns its entries. `enabled` says
 * the calendar is on for this reader; each source also checks its own preview. The list never
 * changes at run time, so `useWorkCalendarEntries` calls every source in the
 * same order on every render, as the rules of hooks need. With `enabled` false
 * a source must not fetch anything and returns `{ status: "off", entries: [] }`.
 *
 * To add a feature, write its hook beside this file (map your records with a
 * pure function in `src/lib/...`, ids stable and `example:` first for example
 * records) and add ONE line to `WORK_CALENDAR_SOURCES` below.
 */

export type WorkCalendarSourceStatus = "off" | "loading" | "ready" | "error" | "signed-out" | "unavailable";

export type WorkCalendarSourceRead = {
  readonly status: WorkCalendarSourceStatus;
  readonly entries: readonly WorkCalendarEntry[];
};

export type WorkCalendarSource = {
  /** Unique, e.g. "rotations" or "bookings". */
  readonly id: string;
  /** A hook. Called on every render, in list order. */
  readonly read: (enabled: boolean) => WorkCalendarSourceRead;
};

export const WORK_CALENDAR_SOURCES: readonly WorkCalendarSource[] = [
  // Rotation preferences: the reader's published rotation placements.
  { id: "rotations", read: useRotationCalendarEntries },
  // Course bookings: the courses the reader has a place on.
  { id: "bookings", read: useBookingCalendarEntries },
];
