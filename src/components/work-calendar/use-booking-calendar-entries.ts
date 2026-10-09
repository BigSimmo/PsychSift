"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";

import { useLivePreview } from "@/components/live-version/live-version-provider";
import { useSignedIn } from "@/components/mode-kit/use-signed-out-sample";
import type { WorkCalendarSourceRead, WorkCalendarSourceStatus } from "@/components/work-calendar/sources";
import { useWorkModeRouteVisible } from "@/components/work-mode-launch/work-mode-launch-provider";
import { useRegistryDataset } from "@/components/work-screens/use-registry-dataset";
import { useSavedBookings } from "@/components/work-screens/admin/use-saved-bookings";
import { useWorkTimeZone } from "@/components/work-time/use-work-time-zone";
import { useExampleData } from "@/lib/example-data/store";
import type { BookingsState } from "@/lib/work-screens/admin/bookings";
import { bookingWorkCalendarEntries } from "@/lib/work-screens/admin/bookings-calendar";
import {
  readBookingsSnapshot,
  resetBookings,
  seedBookings,
  serverBookingsSnapshot,
  subscribeBookings,
} from "@/lib/work-screens/admin/bookings-store";
import { ADMIN_WORK_SCREEN_HREFS } from "@/lib/work-screens/admin/hrefs";
import type { WorkCalendarEntry } from "@/lib/work-calendar/entries";
import { zonedToday } from "@/lib/work-time/format";

const OFF: WorkCalendarSourceRead = { status: "off", entries: [] };

/**
 * The work calendar source for course bookings: every course the reader has a
 * place on, one timed entry each. With Admin's example data on these are the
 * example courses (ids `example:`), read from the same page-memory copy the
 * Bookings pages change. With it off they are the saved courses. A cancelled
 * course comes through as cancelled, so the calendar drops it. Only readers in
 * the "course-bookings" preview get entries, and none where the launch switch
 * hides Bookings, since each entry links there.
 *
 * It reads the way `useBookings` does but carries none of its actions, so the
 * Roster and My Day calendars stay light.
 */
export function useBookingCalendarEntries(calendar: boolean): WorkCalendarSourceRead {
  const preview = useLivePreview("course-bookings");
  const visible = useWorkModeRouteVisible();
  const enabled = calendar && preview && visible(ADMIN_WORK_SCREEN_HREFS.bookings);
  const { active } = useExampleData("admin");
  const signedIn = useSignedIn();
  const { zone } = useWorkTimeZone();
  const read = useRegistryDataset("admin.bookings", enabled && active);
  const snapshot = useSyncExternalStore(subscribeBookings, readBookingsSnapshot, serverBookingsSnapshot);
  const saved = useSavedBookings(enabled && !active && signedIn);
  const source = `example:${zone}:${zonedToday(zone)}`;

  useEffect(() => {
    if (!enabled) return;
    if (!active) resetBookings();
    else if (read.status === "ready") seedBookings(source, read.data);
  }, [enabled, active, read, source]);

  let state: BookingsState | null = null;
  let status: WorkCalendarSourceStatus = "loading";
  if (active) {
    if (read.status === "error") status = "error";
    else if (snapshot.source === source) {
      state = snapshot.state;
      status = "ready";
    }
  } else if (!signedIn) status = "signed-out";
  else if (saved.page.status === "ready") {
    state = saved.page.state;
    status = "ready";
  } else status = saved.page.status === "not-set-up" ? "unavailable" : saved.page.status;

  // Keyed on content, so the list stays the same object while nothing changes.
  const signature = JSON.stringify(
    enabled && state ? bookingWorkCalendarEntries(state, (id) => ADMIN_WORK_SCREEN_HREFS.bookingCourse(id)) : [],
  );
  const entries = useMemo(() => JSON.parse(signature) as WorkCalendarEntry[], [signature]);
  if (!enabled) return OFF;
  return { status, entries };
}
