import type { WorkCalendarSourceRead } from "@/components/work-calendar/sources";
import { BOOKINGS_URL, readAnswer } from "@/components/work-screens/admin/use-saved-bookings";
import { loadExampleDataset } from "@/lib/example-data/registry";
import { bookingWorkCalendarEntries } from "@/lib/work-screens/admin/bookings-calendar";
import {
  readBookingsSnapshot,
  resetBookings,
  seedBookings,
  subscribeBookings,
} from "@/lib/work-screens/admin/bookings-store";
import { ADMIN_WORK_SCREEN_HREFS } from "@/lib/work-screens/admin/hrefs";
import type { BookingsState } from "@/lib/work-screens/admin/bookings";
import { zonedToday } from "@/lib/work-time/format";

/*
 * The course bookings feed for the work calendar, loaded only when a reader in the "course-bookings"
 * preview opens a calendar, so Roster and My Day carry none of it for anyone else. It reads the way
 * `useBookings` does: with Admin's example data on, the example is seeded into the same page-memory
 * copy the Bookings pages change, and every change there reaches the calendar. With it off, the
 * saved courses are read once from the server. It never writes.
 */

export interface BookingCalendarFeedInput {
  /** Admin's example data is on. */
  readonly active: boolean;
  readonly signedIn: boolean;
  readonly headers: Readonly<Record<string, string>>;
  readonly zone: string;
}

/** Watch the reader's booked courses. Calls `onRead` with each new read; returns a stop function. */
export function watchBookingCalendar(
  input: BookingCalendarFeedInput,
  onRead: (read: WorkCalendarSourceRead) => void,
): () => void {
  let live = true;
  let last = "";
  const send = (status: WorkCalendarSourceRead["status"], state: BookingsState | null) => {
    if (!live) return;
    const entries = state ? bookingWorkCalendarEntries(state, (id) => ADMIN_WORK_SCREEN_HREFS.bookingCourse(id)) : [];
    // Only a change in content is passed on, so the calendar's list stays the same object otherwise.
    const signature = JSON.stringify([status, entries]);
    if (signature === last) return;
    last = signature;
    onRead({ status, entries });
  };

  if (input.active) {
    const source = `example:${input.zone}:${zonedToday(input.zone)}`;
    const show = () => {
      const snapshot = readBookingsSnapshot();
      if (snapshot.source === source) send("ready", snapshot.state);
    };
    const unsubscribe = subscribeBookings(show);
    send("loading", null);
    show();
    if (readBookingsSnapshot().source !== source)
      loadExampleDataset("admin.bookings", new Date(), input.zone).then(
        (data) => {
          if (live) seedBookings(source, data);
        },
        () => send("error", null),
      );
    return () => {
      live = false;
      unsubscribe();
    };
  }

  resetBookings();
  if (!input.signedIn) {
    send("signed-out", null);
    return () => {
      live = false;
    };
  }
  send("loading", null);
  // One catch for the network and for a body that is not the expected JSON, so a bad answer shows the error state.
  fetch(BOOKINGS_URL, { cache: "no-store", headers: input.headers })
    .then(async (response) => {
      if (response.status === 401) return send("signed-out", null);
      const answer = readAnswer(response.ok ? await response.json() : null);
      if (answer.status === "ready") send("ready", answer.state);
      else if (answer.status === "not-set-up") send("unavailable", null);
      else send(answer.status, null);
    })
    .catch(() => send("error", null));
  return () => {
    live = false;
  };
}
