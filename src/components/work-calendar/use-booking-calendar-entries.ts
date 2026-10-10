"use client";

import { useEffect, useState } from "react";

import { useSignedIn } from "@/components/mode-kit/use-signed-out-sample";
import type { WorkCalendarSourceRead } from "@/components/work-calendar/sources";
import { useWorkModeRouteVisible } from "@/components/work-mode-launch/work-mode-launch-provider";
import { useWorkTimeZone } from "@/components/work-time/use-work-time-zone";
import { useAuthIfAvailable, useExampleData } from "@/lib/example-data/store";
import { ADMIN_WORK_SCREEN_HREFS } from "@/lib/work-screens/admin/hrefs";

const OFF: WorkCalendarSourceRead = { status: "off", entries: [] };
const LOADING: WorkCalendarSourceRead = { status: "loading", entries: [] };
const FAILED: WorkCalendarSourceRead = { status: "error", entries: [] };
const NO_HEADERS: Readonly<Record<string, string>> = {};

/**
 * The work calendar source for course bookings: every course the reader has a
 * place on, one timed entry each. With Admin's example data on these are the
 * example courses (ids `example:`), the same copy the Bookings pages change.
 * With it off they are the saved courses. A cancelled course comes through as
 * cancelled, so the calendar drops it. There are no entries where the launch
 * switch hides Bookings, since each entry links there.
 *
 * The reading itself is in `booking-calendar-feed.ts`, loaded only once this
 * source is on, so Roster and My Day stay as light as they were for everyone else.
 */
export function useBookingCalendarEntries(calendar: boolean): WorkCalendarSourceRead {
  const visible = useWorkModeRouteVisible();
  const enabled = calendar && visible(ADMIN_WORK_SCREEN_HREFS.bookings);
  const { active } = useExampleData("admin");
  const signedIn = useSignedIn();
  const { zone } = useWorkTimeZone();
  const auth = useAuthIfAvailable();
  const headers = auth?.authorizationHeader ?? NO_HEADERS;
  const account = auth?.session?.user?.id ?? "";
  // Each read is kept with what it was for, so a switch of account or example shows loading, never the last one.
  const key = `${active}:${signedIn}:${account}:${zone}`;
  const [read, setRead] = useState<{ readonly key: string; readonly value: WorkCalendarSourceRead } | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    let stop: (() => void) | null = null;
    import("@/components/work-calendar/booking-calendar-feed").then(
      ({ watchBookingCalendar }) => {
        if (!live) return;
        stop = watchBookingCalendar({ active, signedIn, headers, zone }, (value) => setRead({ key, value }));
      },
      () => {
        if (live) setRead({ key, value: FAILED });
      },
    );
    return () => {
      live = false;
      stop?.();
    };
  }, [enabled, active, signedIn, headers, zone, key]);

  if (!enabled) return OFF;
  return read?.key === key ? read.value : LOADING;
}
