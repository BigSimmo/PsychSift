"use client";

import { useEffect, useMemo, useState } from "react";

import { useLivePreview } from "@/components/live-version/live-version-provider";
import { useWorkModeRouteVisible } from "@/components/work-mode-launch/work-mode-launch-provider";
import { useHeldWorkRoles } from "@/components/work-frame/use-held-work-roles";
import { useAuthIfAvailable } from "@/lib/example-data/store";
import type { NotificationItem, NotificationSource, NotificationSourceStatus } from "@/lib/needs-you/feed";
import { ADMIN_WORK_SCREEN_HREFS } from "@/lib/work-screens/admin/hrefs";

/**
 * Two Admin sources for the Notification centre, both in the new work mode
 * only (their screens are new work mode screens, and the feed drops any item
 * whose screen the launch switch hides):
 *
 * - Sick calls: for Medical Workforce and the site administrator, one line per
 *   hospital with sick calls still needing cover this week, opening that
 *   hospital's Sick calls screen. A team the reader manages is left out, since
 *   Roster already tells its manager.
 * - Course changes: for a doctor booked or waitlisted on a course the organiser
 *   moved or cancelled, one line per course, opening it. Only in the
 *   "course-bookings" preview.
 *
 * Each read is in its own module, loaded only when the source is on (a reader
 * holding the role, or in the preview), so the bell stays as light as it was
 * for everyone else. Example and demo records never reach the bell: a demo
 * build reads nothing ("unavailable"), and example records are dropped.
 */

/** What one of these sources has read so far. */
export interface AdminNotificationRead {
  readonly status: NotificationSourceStatus;
  readonly items: readonly NotificationItem[];
}

/** The Sick calls screen. Written out so the bell need not load the hospital rules to name it. */
const HOSPITAL_SICK_PATH = "/admin/hospital/sick";
const SICK_ROLES = new Set(["administrator", "workforce"]);

const LOADING: AdminNotificationRead = { status: "loading", items: [] };
const NOTHING: AdminNotificationRead = { status: "ready", items: [] };
const FAILED: AdminNotificationRead = { status: "failed", items: [] };
const UNAVAILABLE: AdminNotificationRead = { status: "unavailable", items: [] };
const NO_HEADERS: Readonly<Record<string, string>> = {};

function asSource(id: string, label: string, read: AdminNotificationRead): NotificationSource {
  return { id, label, status: read.status, items: read.status === "ready" ? read.items : [] };
}

/** Sick calls needing cover, for a reader who may open the hospital Sick calls screen. */
export function useHospitalSickSource({
  enabled,
  demo,
  readAt,
  zone,
}: {
  /** False while signed out: nothing is read. */
  readonly enabled: boolean;
  /** The demo build: nothing real to read. */
  readonly demo: boolean;
  /** When the reads started; the week is counted from here. */
  readonly readAt: Date;
  readonly zone: string;
}): NotificationSource {
  const userId = useAuthIfAvailable()?.session?.user?.id ?? null;
  const signedIn = enabled && userId !== null;
  // The same light roles read the menu makes; the full roles load with the reads, only for these roles.
  const held = useHeldWorkRoles(signedIn && !demo);
  const visible = useWorkModeRouteVisible();
  const on = signedIn && !demo && held.some((role) => SICK_ROLES.has(role)) && visible(HOSPITAL_SICK_PATH);
  const key = `${userId ?? ""}:${zone}:${readAt.getTime()}`;
  const [read, setRead] = useState<{ readonly key: string; readonly read: AdminNotificationRead } | null>(null);

  useEffect(() => {
    if (!on || !userId) return;
    let live = true;
    let stop: (() => void) | null = null;
    import("@/components/needs-you/hospital-sick-feed").then(
      ({ watchHospitalSickNeedsYou }) => {
        if (!live) return;
        stop = watchHospitalSickNeedsYou({ userId, now: readAt, zone }, (next) => setRead({ key, read: next }));
      },
      () => {
        if (live) setRead({ key, read: FAILED });
      },
    );
    return () => {
      live = false;
      stop?.();
    };
  }, [on, userId, readAt, zone, key]);

  const current = demo && enabled ? UNAVAILABLE : !on ? NOTHING : read?.key === key ? read.read : LOADING;
  return useMemo(() => asSource("hospital-sick", "Sick calls", current), [current]);
}

/** Courses the reader is booked or waitlisted on that the organiser moved or cancelled. */
export function useCourseChangeSource({
  enabled,
  demo,
  today,
}: {
  readonly enabled: boolean;
  readonly demo: boolean;
  /** `YYYY-MM-DD` in the work time zone. */
  readonly today: string;
}): NotificationSource {
  const preview = useLivePreview("course-bookings");
  const visible = useWorkModeRouteVisible();
  const auth = useAuthIfAvailable();
  const headers = auth?.authorizationHeader ?? NO_HEADERS;
  const account = auth?.session?.user?.id ?? "";
  const epoch = auth?.authEpoch ?? 0;
  const on = enabled && !demo && preview && account !== "" && visible(ADMIN_WORK_SCREEN_HREFS.bookings);
  // Each read is kept with the account and day it was for, so a switch shows loading, never the last one.
  const key = `${account}:${epoch}:${today}`;
  const [read, setRead] = useState<{ readonly key: string; readonly read: AdminNotificationRead } | null>(null);

  useEffect(() => {
    if (!on) return;
    const controller = new AbortController();
    import("@/components/needs-you/course-change-feed")
      .then(({ readCourseChanges }) => readCourseChanges({ headers, today }, controller.signal))
      .then(
        (next) => {
          if (next && !controller.signal.aborted) setRead({ key, read: next });
        },
        () => {
          if (!controller.signal.aborted) setRead({ key, read: FAILED });
        },
      );
    return () => controller.abort();
  }, [on, headers, today, key]);

  const current = demo && enabled && preview ? UNAVAILABLE : !on ? NOTHING : read?.key === key ? read.read : LOADING;
  return useMemo(() => asSource("course-changes", "Course bookings", current), [current]);
}
