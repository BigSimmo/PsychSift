"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { onCallEntryHref } from "@/components/on-call/on-call-entry-view";
import { useWorkModeRouteVisible } from "@/components/work-mode-launch/work-mode-launch-provider";
import { adminLoadState, selectAdminOwnEntries } from "@/lib/admin/own-entries";
import { useApplicationsStore } from "@/lib/cme/device-record";
import type { CmeEntry, CmeRequirementSet } from "@/lib/cme/types";
import { useSavedNumbers } from "@/lib/favourites/favourites-local";
import { savedNumberWorkItems } from "@/lib/favourites/favourites-search";
import { withoutExampleRecords } from "@/lib/example-data/guards";
import { useExampleData } from "@/lib/example-data/store";
import { myDayEnabledForAuth } from "@/lib/my-day/model";
import type { OnCallEntry } from "@/lib/on-call/entry-model";
import { useOnCallEntries } from "@/lib/on-call/entry-store";
import { addDaysToDate, perthDateOf } from "@/lib/perth-time";
import type { RosterLeave } from "@/lib/roster/leave";
import type { OnCallShift } from "@/lib/roster/shifts/model";
import { useAuthSession } from "@/lib/supabase/client";
import type { TeachingWeekResponse } from "@/lib/teaching/model";
import {
  cmeActivityWorkItems,
  entryWorkItem,
  leaveWorkItems,
  sessionWorkItems,
  shiftWorkItems,
} from "@/lib/work-search/items";
import { featureSearchPages, withFeaturePages } from "@/lib/work-search/feature-pages";
import {
  TEACHING_LOOKAHEAD_DAYS,
  type WorkAreaRead,
  type WorkAreaStatus,
  type WorkItem,
} from "@/lib/work-search/model";
import { workSearchPages, type WorkSearchPage } from "@/lib/work-search/pages";
import type { WorkSearchEntry } from "@/lib/work-search/search";

/**
 * The records "Search my work" searches, read when the search opens.
 *
 * Each read is the same server route the area's own page uses, so sign-in,
 * owner scoping and team permissions are exactly the area's own. Results live
 * in memory for this tab only — never on the device — and are reused for two
 * minutes so closing and reopening the search does not fetch everything again.
 * A different account (auth epoch) never sees another's cached records.
 *
 * Signed out, nothing is fetched: the invented sample is loaded instead.
 */

type Read<T> = { status: "ready"; body: T; sample: boolean } | { status: "failed" | "signed-out" };

type Fetched = {
  readonly epoch: number;
  readonly at: number;
  readonly roster: { status: WorkAreaStatus; sample: boolean; items: WorkItem[] };
  readonly teaching: { status: WorkAreaStatus; sample: boolean; items: WorkItem[] };
  readonly cme: { status: WorkAreaStatus; sample: boolean; items: WorkItem[] };
  readonly cpd: WorkSearchCpd | null;
};

/** The confirmed CPD targets and the activities they are measured against, for the built-in answer. */
export type WorkSearchCpd = { readonly set: CmeRequirementSet | null; readonly entries: readonly CmeEntry[] };

const FRESH_FOR_MS = 2 * 60 * 1000;
/** A read that hangs is reported as failed (with Retry) rather than "still loading" for ever. */
const READ_TIMEOUT_MS = 12_000;
let memory: Fetched | null = null;

async function readJson<T>(url: string, signal: AbortSignal): Promise<Read<T>> {
  const local = new AbortController();
  const abort = () => local.abort();
  signal.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, READ_TIMEOUT_MS);
  try {
    const response = await fetch(url, { cache: "no-store", signal: local.signal });
    if (response.status === 401) return { status: "signed-out" };
    if (!response.ok) return { status: "failed" };
    const body = (await response.json()) as T & { demoMode?: boolean; sample?: boolean };
    return { status: "ready", body, sample: Boolean(body.demoMode || body.sample) };
  } catch {
    return { status: "failed" };
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
  }
}

/** Only a complete read is worth reusing; a failed area is fetched again next time. */
function allReady(fetched: Fetched): boolean {
  return [fetched.roster, fetched.teaching, fetched.cme].every((area) => area.status === "ready");
}

function worst(...statuses: WorkAreaStatus[]): WorkAreaStatus {
  if (statuses.includes("failed")) return "failed";
  if (statuses.includes("signed-out")) return "signed-out";
  return "ready";
}

async function fetchRecords(epoch: number, now: number, signal: AbortSignal): Promise<Fetched> {
  const today = perthDateOf(now);
  const weekQuery = new URLSearchParams({
    view: "week",
    from: today,
    to: addDaysToDate(today, TEACHING_LOOKAHEAD_DAYS),
  });
  const [shifts, leave, week, cme, year] = await Promise.all([
    readJson<{ shifts: OnCallShift[] }>("/api/roster/shifts", signal),
    readJson<{ leave: RosterLeave[] }>("/api/roster/leave", signal),
    readJson<TeachingWeekResponse>(`/api/teaching?${weekQuery.toString()}`, signal),
    readJson<{ entries: CmeEntry[]; year?: number }>("/api/cme/entries", signal),
    readJson<{ requirementSet?: CmeRequirementSet | null }>("/api/cme/year", signal),
  ]);
  const set = year.status === "ready" ? (year.body.requirementSet ?? null) : null;
  const cmeEntries = cme.status === "ready" ? (cme.body.entries ?? []) : [];
  return {
    epoch,
    at: Date.now(),
    roster: {
      status: worst(shifts.status, leave.status),
      sample: (shifts.status === "ready" && shifts.sample) || (leave.status === "ready" && leave.sample),
      items: [
        ...(shifts.status === "ready" ? shiftWorkItems(shifts.body.shifts ?? []) : []),
        ...(leave.status === "ready" ? leaveWorkItems(leave.body.leave ?? []) : []),
      ],
    },
    teaching: {
      status: week.status,
      sample: week.status === "ready" && week.sample,
      items:
        week.status === "ready"
          ? sessionWorkItems([...(week.body.sessions ?? []), ...(week.body.relocated ?? [])])
          : [],
    },
    cme: {
      status: worst(cme.status, year.status),
      sample: cme.status === "ready" && cme.sample,
      items: cmeActivityWorkItems(cmeEntries),
    },
    // Activities from another year are never measured against this year's targets.
    cpd:
      cme.status === "ready" && year.status === "ready"
        ? set && cme.body.year === set.year
          ? { set, entries: cmeEntries }
          : { set: null, entries: [] }
        : null,
  };
}

function entryItems(entries: readonly OnCallEntry[]): WorkSearchEntry[] {
  return entries.map((entry) => ({ entry, item: entryWorkItem(entry, onCallEntryHref(entry)) }));
}

export interface WorkSearchRecords {
  readonly items: readonly WorkItem[];
  readonly entries: readonly WorkSearchEntry[];
  readonly areas: readonly WorkAreaRead[];
  readonly cpd: WorkSearchCpd | null;
  /**
   * The pages offered by name: the frame's own, plus the junior features' pages
   * (`feature-pages.ts`), less any screen the launch switch holds back for this reader.
   */
  readonly pages: readonly WorkSearchPage[];
  /** True while a signed-out visitor searches the invented sample. */
  readonly sample: boolean;
  /** True when any area returned invented example records (demo mode, or a roster with none of your own yet). */
  readonly anySample: boolean;
  /** The account the records belong to, so per-tab memory (recent searches) never crosses accounts. */
  readonly epoch: number;
  readonly retry: () => void;
}

export function useWorkSearchRecords(now: number): WorkSearchRecords {
  const { status: authStatus, authEpoch } = useAuthSession();
  const enabled = myDayEnabledForAuth(authStatus);
  const signedOut = authStatus === "signed_out" || authStatus === "expired";
  const onCall = useOnCallEntries();
  // Search has no area of its own: a signed-out visitor searches the sample
  // while the switch shows examples anywhere, and gets the signed-out state when
  // it is off. A signed-in reader's search only ever finds their own records.
  const exampleOn = useExampleData().activeAreas.length > 0;
  const [fetched, setFetched] = useState<Fetched | null>(() =>
    memory && memory.epoch === authEpoch && Date.now() - memory.at < FRESH_FOR_MS ? memory : null,
  );
  const [sample, setSample] = useState<{
    items: WorkItem[];
    entries: readonly OnCallEntry[];
    cpd: WorkSearchCpd;
  } | null>(null);
  const [generation, setGeneration] = useState(0);
  const retryOnCall = onCall.retry;
  const retry = useCallback(() => {
    memory = null;
    setFetched(null);
    setGeneration((value) => value + 1);
    retryOnCall();
  }, [retryOnCall]);

  useEffect(() => {
    // Another account's records never stay in memory, even unseen.
    if (memory && memory.epoch !== authEpoch) memory = null;
    if (!enabled) return;
    if (fetched && fetched.epoch === authEpoch) return;
    const controller = new AbortController();
    void fetchRecords(authEpoch, now, controller.signal).then((next) => {
      if (controller.signal.aborted) return;
      memory = allReady(next) ? next : null;
      setFetched(next);
    });
    return () => controller.abort();
    // `now` is fixed for the life of the open search; `fetched` is checked, not tracked.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, authEpoch, generation]);

  useEffect(() => {
    if (!signedOut || !exampleOn || sample) return;
    let cancelled = false;
    void import("@/lib/work-search/sample").then(({ workSearchSample }) => {
      if (!cancelled) setSample(workSearchSample(new Date(now)));
    });
    return () => {
      cancelled = true;
    };
  }, [signedOut, exampleOn, sample, now]);

  const onCallStatus = adminLoadState(onCall);
  const liveEntries = useMemo(
    () =>
      enabled && onCallStatus === "ready" && !onCall.sample ? entryItems(withoutExampleRecords(onCall.entries)) : [],
    [enabled, onCallStatus, onCall.entries, onCall.sample],
  );
  const sampleEntries = useMemo(() => (sample ? entryItems(sample.entries) : []), [sample]);

  // Numbers the reader saved to Favourites on this device (patient-detail checked when saved and read).
  const savedNumbers = useSavedNumbers();
  const numberItems = useMemo(() => savedNumberWorkItems(savedNumbers), [savedNumbers]);

  // Pages: the frame's and the features'. Only a signed-in reader's own device words are listed.
  const applications = useApplicationsStore(null).state;
  const routeVisible = useWorkModeRouteVisible();
  const ownEntries = useMemo(
    () =>
      enabled && onCallStatus === "ready" && !onCall.demoMode
        ? selectAdminOwnEntries({ entries: onCall.entries, demoMode: false })
        : null,
    [enabled, onCallStatus, onCall.demoMode, onCall.entries],
  );
  const pages = useMemo(
    () =>
      withFeaturePages(
        workSearchPages(),
        featureSearchPages(signedOut ? null : { entries: ownEntries, applications }),
      ).filter((page) => routeVisible(page.href)),
    [signedOut, ownEntries, applications, routeVisible],
  );

  return useMemo<WorkSearchRecords>(() => {
    if (signedOut && exampleOn) {
      const ready: WorkAreaStatus = sample ? "ready" : "loading";
      return {
        items: sample?.items ?? [],
        entries: sampleEntries,
        areas: (["roster", "teaching", "cme", "my-work", "on-call"] as const).map((area) => ({
          area,
          status: ready,
          sample: true,
        })),
        cpd: sample?.cpd ?? null,
        pages,
        sample: true,
        anySample: true,
        epoch: authEpoch,
        retry,
      };
    }
    if (signedOut) {
      return {
        items: [],
        entries: [],
        areas: (["roster", "teaching", "cme", "my-work", "on-call"] as const).map((area) => ({
          area,
          status: "signed-out" as const,
          sample: false,
        })),
        cpd: null,
        pages,
        sample: false,
        anySample: false,
        epoch: authEpoch,
        retry,
      };
    }
    const current = fetched && fetched.epoch === authEpoch ? fetched : null;
    const entryStatus: WorkAreaStatus = enabled ? onCallStatus : "loading";
    const anySample = Boolean(
      current?.roster.sample || current?.teaching.sample || current?.cme.sample || onCall.demoMode,
    );
    return {
      items: [
        ...(current ? [...current.roster.items, ...current.teaching.items, ...current.cme.items] : []),
        ...numberItems,
      ],
      entries: liveEntries,
      areas: [
        { area: "roster", status: current?.roster.status ?? "loading", sample: current?.roster.sample ?? false },
        { area: "teaching", status: current?.teaching.status ?? "loading", sample: current?.teaching.sample ?? false },
        { area: "cme", status: current?.cme.status ?? "loading", sample: current?.cme.sample ?? false },
        { area: "my-work", status: entryStatus, sample: onCall.demoMode },
        { area: "on-call", status: entryStatus, sample: onCall.demoMode },
      ],
      cpd: current?.cpd ?? null,
      pages,
      sample: false,
      anySample,
      epoch: authEpoch,
      retry,
    };
  }, [
    signedOut,
    exampleOn,
    sample,
    sampleEntries,
    fetched,
    authEpoch,
    enabled,
    onCallStatus,
    liveEntries,
    onCall.demoMode,
    retry,
    numberItems,
    pages,
  ]);
}
