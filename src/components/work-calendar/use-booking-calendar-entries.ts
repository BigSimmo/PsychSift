"use client";

import { useMemo } from "react";

import { useLivePreview } from "@/components/live-version/live-version-provider";
import type { WorkCalendarSourceRead } from "@/components/work-calendar/sources";
import { useWorkModeRouteVisible } from "@/components/work-mode-launch/work-mode-launch-provider";
import { useBookings } from "@/components/work-screens/admin/use-bookings";
import { bookingWorkCalendarEntries } from "@/lib/work-screens/admin/bookings";
import { ADMIN_WORK_SCREEN_HREFS } from "@/lib/work-screens/admin/hrefs";
import type { WorkCalendarEntry } from "@/lib/work-calendar/entries";

const OFF: WorkCalendarSourceRead = { status: "off", entries: [] };

/**
 * The work calendar source for course bookings: every course the reader has a
 * place on, one timed entry each, from the one bookings hook. With Admin's
 * example data on these are the example courses (ids `example:`). A cancelled
 * course comes through as cancelled, so the calendar drops it. Only readers in
 * the "course-bookings" preview get entries, and none where the launch switch
 * hides Bookings, since each entry links there.
 */
export function useBookingCalendarEntries(calendar: boolean): WorkCalendarSourceRead {
  const preview = useLivePreview("course-bookings");
  const visible = useWorkModeRouteVisible();
  const enabled = calendar && preview && visible(ADMIN_WORK_SCREEN_HREFS.bookings);
  const { page } = useBookings({ enabled });
  // Keyed on content, so the list stays the same object while nothing changes.
  const signature = JSON.stringify(
    enabled && page.status === "ready"
      ? bookingWorkCalendarEntries(page.state, (id) => ADMIN_WORK_SCREEN_HREFS.bookingCourse(id))
      : [],
  );
  const entries = useMemo(() => JSON.parse(signature) as WorkCalendarEntry[], [signature]);
  if (!enabled) return OFF;
  if (page.status === "ready") return { status: "ready", entries };
  if (page.status === "not-set-up") return { status: "unavailable", entries };
  return { status: page.status, entries };
}
