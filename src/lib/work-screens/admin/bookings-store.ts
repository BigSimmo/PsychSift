import type { CalendarEvent } from "@/lib/calendar/calendar-event";
import { subscribeAccountTransition } from "@/lib/account-scoped-browser-state";
import { bookingCalendarEvents, EMPTY_BOOKINGS, type BookingsState } from "@/lib/work-screens/admin/bookings";
import { ADMIN_WORK_SCREEN_HREFS } from "@/lib/work-screens/admin/hrefs";

/*
 * The one copy of Admin Bookings that this tab is showing, shared by the Bookings page, the
 * organiser's Courses page and the calendar. It is page memory only: the example version is seeded
 * from the registry and changes stay until the example switch turns off, the account changes or the
 * tab closes. Nothing here is written to the device, so there is no stored key to clear on sign-out.
 * The saved version (shared with organisers) needs its own tables and replaces the seed when it lands.
 */

type Snapshot = {
  readonly state: BookingsState;
  /** What the state was seeded from ("example:<zone>:<day>"), or null when nothing is loaded. */
  readonly source: string | null;
};

const EMPTY: Snapshot = { state: EMPTY_BOOKINGS, source: null };
let snapshot: Snapshot = EMPTY;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function subscribeBookings(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function readBookingsSnapshot(): Snapshot {
  return snapshot;
}

export function serverBookingsSnapshot(): Snapshot {
  return EMPTY;
}

/** Load a seed once per source, so moving between pages keeps what the reader changed. */
export function seedBookings(source: string, state: BookingsState): void {
  if (snapshot.source === source) return;
  snapshot = { state, source };
  emit();
}

/** Apply a change from a pure action in `bookings.ts`. */
export function setBookings(state: BookingsState): void {
  snapshot = { ...snapshot, state };
  emit();
}

/** Forget everything: the example switch turned off, or the account changed. */
export function resetBookings(): void {
  if (snapshot === EMPTY) return;
  snapshot = EMPTY;
  emit();
}

/** The reader's calendar entries from bookings, for the shared work calendar. */
export function readBookingCalendarEvents(): CalendarEvent[] {
  return bookingCalendarEvents(snapshot.state, (courseId) => ADMIN_WORK_SCREEN_HREFS.bookingCourse(courseId));
}

subscribeAccountTransition(() => resetBookings());
