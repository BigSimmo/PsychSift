"use client";

import { useEffect, useMemo, useState } from "react";

import { useCourseChangeSource, useHospitalSickSource } from "@/components/needs-you/use-admin-notification-sources";
import { useFirstWeekPack } from "@/components/on-call/first-week/use-first-week-pack";
import { selectContractEndNeedsYou } from "@/lib/admin/contract-end";
import { adminLoadState, selectAdminOwnEntries } from "@/lib/admin/own-entries";
import { selectReadyNeedsYou } from "@/lib/admin/ready-for-day-one";
import { selectStarterNeedsYou } from "@/lib/admin/starter-pack";
import { applicationsNeedsYouItems } from "@/lib/cme/applications";
import { CPD_HOME_YEAR_END_MONTH, cpdHomeNeedsYouItems, lastAddedFile } from "@/lib/cme/cpd-home-send";
import { useApplicationsStore, useCpdHomeSendStore } from "@/lib/cme/device-record";
import type { CmeEntry } from "@/lib/cme/types";
import { withoutExampleRecords } from "@/lib/example-data/guards";
import {
  featureNotificationItem,
  workToday,
  type FeatureNeedsYouItem,
  type NotificationSource,
  type NotificationSourceStatus,
} from "@/lib/needs-you/feed";
import { useOnCallEntries } from "@/lib/on-call/entry-store";
import { isFirstWeekHighlighted, selectFirstWeekNeedsYou } from "@/lib/on-call/first-week-pack";
import { sharedGet } from "@/lib/shared-get";
import { useAuthSession } from "@/lib/supabase/client";
import { currentWorkTimeZone } from "@/lib/work-time/current-zone";
import { termFolderNeedsYou } from "@/lib/teaching/term-folder";
import { useTermTrackerStore } from "@/lib/teaching/term-tracker-store";

/**
 * The junior features' own Needs you items, as Notification centre sources:
 * Your first week pack (On Call), Contract, Starter pack and Ready for day one
 * (Admin), Job applications and CPD Home (CPD), and the Term evidence folder
 * (Teaching). Each uses its feature's own selector, so the bell and the page
 * can never disagree. Two Admin sources for the new work mode follow them:
 * hospital Sick calls needing cover (Medical Workforce and the site
 * administrator) and course changes for booked doctors (the "course-bookings"
 * preview), from `use-admin-notification-sources.ts`.
 *
 * Rules every source keeps:
 * - nothing is emitted until this device's store has been read (a null store
 *   is "loading", never "nothing due");
 * - example and demo records never reach the bell: On Call entries and every
 *   stored list pass through `withoutExampleRecords`, and a demo read emits
 *   nothing ("unavailable");
 * - a read another source already reports (On Call entries) is "unavailable"
 *   here when it fails, so the sheet names it once.
 *
 * Network: CPD Home reads this year's activities, and only once the doctor has
 * marked a CPD Home file added, or in December. The first week pack reads the
 * hospital handbook only while the pack is highlighted. Sick calls read only for
 * a reader holding Medical Workforce or the administrator role, and course
 * changes only in the "course-bookings" preview, each from a module loaded then.
 */

/** The local demo build (no Supabase in the browser) or an explicit demo deploy. */
function useDemoBuild(): boolean {
  const { status } = useAuthSession();
  return status === "unconfigured" || process.env.NEXT_PUBLIC_DEMO_MODE === "true";
}

function source(
  id: string,
  label: string,
  status: NotificationSourceStatus,
  items: readonly FeatureNeedsYouItem[] = [],
): NotificationSource {
  return { id, label, status, items: status === "ready" ? items.map(featureNotificationItem) : [] };
}

type CpdEntriesRead =
  | { readonly key: string; readonly status: "ready"; readonly entries: readonly CmeEntry[] }
  | { readonly key: string; readonly status: "failed" | "signed-out" | "unavailable" };

/** This CPD year's activities, read only when CPD Home needs them. */
function useCpdHomeEntries(year: number, needed: boolean, epoch: number): CpdEntriesRead | null {
  const key = `${epoch}:${year}`;
  const [read, setRead] = useState<CpdEntriesRead | null>(null);
  useEffect(() => {
    if (!needed) return;
    const controller = new AbortController();
    void (async (): Promise<CpdEntriesRead | null> => {
      try {
        const response = await sharedGet(`/api/cme/entries?year=${year}`, { signal: controller.signal });
        if (response.status === 401) return { key, status: "signed-out" };
        if (!response.ok) return { key, status: "failed" };
        const body = (await response.json().catch(() => null)) as {
          entries?: unknown;
          year?: number;
          demoMode?: boolean;
        } | null;
        if (!body || !Array.isArray(body.entries)) return { key, status: "failed" };
        if (body.demoMode) return { key, status: "unavailable" };
        // Activities from another year are never counted against this year's file.
        if (body.year !== year) return { key, status: "ready", entries: [] };
        return { key, status: "ready", entries: withoutExampleRecords(body.entries as CmeEntry[]) };
      } catch {
        return controller.signal.aborted ? null : { key, status: "failed" };
      }
    })().then((next) => {
      if (next && !controller.signal.aborted) setRead(next);
    });
    return () => controller.abort();
  }, [key, needed, year]);
  return read?.key === key ? read : null;
}

export function useFeatureNotificationSources({
  enabled,
  clock,
  readAt,
  zone,
}: {
  /** False while signed out: nothing is read and nothing is emitted. */
  readonly enabled: boolean;
  /** The clock the items are worked out against. */
  readonly clock: Date;
  /** When the reads started, for the first week pack's own read. */
  readonly readAt: Date;
  /** The work time zone "today" is read in (the feed's own); the saved one when left out. */
  readonly zone?: string;
}): NotificationSource[] {
  const { authEpoch } = useAuthSession();
  const demo = useDemoBuild();
  const today = workToday(clock, zone);
  const year = Number(today.slice(0, 4));

  // On Call entries: the same shared read the bell already makes.
  const entries = useOnCallEntries();
  const entriesState = adminLoadState(entries);
  const own = useMemo(() => withoutExampleRecords(selectAdminOwnEntries(entries)), [entries]);

  const firstWeek = useFirstWeekPack(readAt, { feed: true });
  const { sample: firstWeekSample, startState, landAlert, startsOn, progress } = firstWeek;
  const highlighted = isFirstWeekHighlighted(firstWeek.phase);
  const handbook = firstWeek.handbook.status;
  const applications = useApplicationsStore(null).state;
  const cpdHomeStore = useCpdHomeSendStore(null);
  // A device marked shared keeps no CPD Home record, so nothing is read or shown there (not even December's prompt).
  const cpdHomeShared = cpdHomeStore.mode === "shared";
  const cpdHome = cpdHomeStore.state;
  const terms = useTermTrackerStore(null).state;

  const cpdHomeNeeded =
    enabled &&
    !demo &&
    !cpdHomeShared &&
    cpdHome !== null &&
    (lastAddedFile(cpdHome, year) !== null || Number(today.slice(5, 7)) >= CPD_HOME_YEAR_END_MONTH);
  const cpdEntries = useCpdHomeEntries(year, cpdHomeNeeded, authEpoch);

  // Admin, new work mode: sick calls needing cover and course changes. Their own hooks keep them light.
  const workZone = zone ?? currentWorkTimeZone();
  const hospitalSick = useHospitalSickSource({ enabled, demo, readAt, zone: workZone });
  const courseChanges = useCourseChangeSource({ enabled, demo, today });

  return useMemo((): NotificationSource[] => {
    if (!enabled) return [];

    // On Call: the first week pack, while it is highlighted. Outside that week the handbook is not read
    // and nothing is due, so the source is ready with nothing in it.
    const firstWeekStatus: NotificationSourceStatus =
      firstWeekSample || entries.demoMode || demo
        ? "unavailable"
        : startState !== "ready"
          ? startState === "failed"
            ? "unavailable"
            : startState
          : landAlert === null
            ? "loading"
            : !highlighted || handbook === "ready" || handbook === "no-service"
              ? "ready"
              : handbook === "loading"
                ? "loading"
                : "failed";
    const firstWeekItems =
      firstWeekStatus === "ready" && highlighted
        ? selectFirstWeekNeedsYou({ startsOn, now: clock, progress, landAlert: landAlert ?? true })
        : [];

    // Admin: contract end, the overseas starter pack and Ready for day one, from the doctor's own entries.
    const adminStatus: NotificationSourceStatus =
      entries.demoMode || demo
        ? "unavailable"
        : entriesState === "ready"
          ? "ready"
          : entriesState === "loading"
            ? "loading"
            : entriesState === "signed-out"
              ? "signed-out"
              : "unavailable";
    const adminItems =
      adminStatus === "ready"
        ? [
            ...selectContractEndNeedsYou(own, clock),
            ...selectStarterNeedsYou(own, clock),
            ...selectReadyNeedsYou(own, clock),
          ]
        : [];

    // CPD: Job applications (dates with Remind me on, quiet referees) and CPD Home.
    const applicationsItems = applications
      ? applicationsNeedsYouItems({ ...applications, referees: withoutExampleRecords(applications.referees) }, today)
      : [];
    const cpdHomeStatus: NotificationSourceStatus = demo
      ? "unavailable"
      : cpdHome === null
        ? "loading"
        : !cpdHomeNeeded
          ? "ready"
          : cpdEntries === null
            ? "loading"
            : cpdEntries.status;
    const cpdHomeItems =
      cpdHome && cpdHomeNeeded && cpdEntries?.status === "ready"
        ? cpdHomeNeedsYouItems(
            cpdEntries.entries,
            { ...cpdHome, files: withoutExampleRecords(cpdHome.files) },
            year,
            today,
          )
        : [];

    // Teaching: the term evidence folder, from this device's own term tracker only.
    const termItems = terms
      ? termFolderNeedsYou({ ...terms, terms: withoutExampleRecords(terms.terms) }, today, { demo })
      : [];

    return [
      source("first-week", "Your first week pack", firstWeekStatus, firstWeekItems),
      source("admin-features", "Contract and new job", adminStatus, adminItems),
      source("applications", "Job applications", applications ? "ready" : "loading", applicationsItems),
      source("cpd-home", "CPD Home", cpdHomeStatus, cpdHomeItems),
      source("term-folder", "Term evidence folder", demo ? "unavailable" : terms ? "ready" : "loading", termItems),
      hospitalSick,
      courseChanges,
    ];
  }, [
    enabled,
    firstWeekSample,
    startState,
    landAlert,
    highlighted,
    handbook,
    startsOn,
    progress,
    entries.demoMode,
    demo,
    clock,
    entriesState,
    own,
    applications,
    today,
    cpdHome,
    cpdHomeNeeded,
    cpdEntries,
    year,
    terms,
    hospitalSick,
    courseChanges,
  ]);
}
