"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { onCallEntryHref } from "@/components/on-call/on-call-entry-view";
import { adminLoadState } from "@/lib/admin/own-entries";
import type { CmeEntry } from "@/lib/cme/types";
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
import type { WorkAreaRead, WorkAreaStatus, WorkItem } from "@/lib/work-search/model";
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
};

const FRESH_FOR_MS = 2 * 60 * 1000;
let memory: Fetched | null = null;

async function readJson<T>(url: string, signal: AbortSignal): Promise<Read<T>> {
  try {
    const response = await fetch(url, { cache: "no-store", signal });
    if (response.status === 401) return { status: "signed-out" };
    if (!response.ok) return { status: "failed" };
    const body = (await response.json()) as T & { demoMode?: boolean; sample?: boolean };
    return { status: "ready", body, sample: Boolean(body.demoMode || body.sample) };
  } catch {
    return { status: "failed" };
  }
}

function worst(...statuses: WorkAreaStatus[]): WorkAreaStatus {
  if (statuses.includes("failed")) return "failed";
  if (statuses.includes("signed-out")) return "signed-out";
  return "ready";
}

async function fetchRecords(epoch: number, now: Date, signal: AbortSignal): Promise<Fetched> {
  const today = perthDateOf(now);
  const weekQuery = new URLSearchParams({ view: "week", from: today, to: addDaysToDate(today, 41) });
  const [shifts, leave, week, cme] = await Promise.all([
    readJson<{ shifts: OnCallShift[] }>("/api/roster/shifts", signal),
    readJson<{ leave: RosterLeave[] }>("/api/roster/leave", signal),
    readJson<TeachingWeekResponse>(`/api/teaching?${weekQuery.toString()}`, signal),
    readJson<{ entries: CmeEntry[] }>("/api/cme/entries", signal),
  ]);
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
      status: cme.status,
      sample: cme.status === "ready" && cme.sample,
      items: cme.status === "ready" ? cmeActivityWorkItems(cme.body.entries ?? []) : [],
    },
  };
}

function entryItems(entries: readonly OnCallEntry[]): WorkSearchEntry[] {
  return entries.map((entry) => ({ entry, item: entryWorkItem(entry, onCallEntryHref(entry)) }));
}

export interface WorkSearchRecords {
  readonly items: readonly WorkItem[];
  readonly entries: readonly WorkSearchEntry[];
  readonly areas: readonly WorkAreaRead[];
  /** True while a signed-out visitor searches the invented sample. */
  readonly sample: boolean;
  readonly retry: () => void;
}

export function useWorkSearchRecords(now: Date): WorkSearchRecords {
  const { status: authStatus, authEpoch } = useAuthSession();
  const enabled = myDayEnabledForAuth(authStatus);
  const signedOut = authStatus === "signed_out" || authStatus === "expired";
  const onCall = useOnCallEntries();
  const [fetched, setFetched] = useState<Fetched | null>(() =>
    memory && memory.epoch === authEpoch && Date.now() - memory.at < FRESH_FOR_MS ? memory : null,
  );
  const [sample, setSample] = useState<{ items: WorkItem[]; entries: readonly OnCallEntry[] } | null>(null);
  const [generation, setGeneration] = useState(0);
  const retryOnCall = onCall.retry;
  const retry = useCallback(() => {
    memory = null;
    setFetched(null);
    setGeneration((value) => value + 1);
    retryOnCall();
  }, [retryOnCall]);

  useEffect(() => {
    if (!enabled) return;
    if (fetched && fetched.epoch === authEpoch) return;
    const controller = new AbortController();
    void fetchRecords(authEpoch, now, controller.signal).then((next) => {
      if (controller.signal.aborted) return;
      memory = next;
      setFetched(next);
    });
    return () => controller.abort();
    // `now` is fixed for the life of the open search; `fetched` is checked, not tracked.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, authEpoch, generation]);

  useEffect(() => {
    if (!signedOut || sample) return;
    let cancelled = false;
    void import("@/lib/work-search/sample").then(({ workSearchSample }) => {
      if (!cancelled) setSample(workSearchSample(now));
    });
    return () => {
      cancelled = true;
    };
  }, [signedOut, sample, now]);

  const onCallStatus = adminLoadState(onCall);
  const liveEntries = useMemo(
    () => (enabled && onCallStatus === "ready" ? entryItems(onCall.entries) : []),
    [enabled, onCallStatus, onCall.entries],
  );
  const sampleEntries = useMemo(() => (sample ? entryItems(sample.entries) : []), [sample]);

  return useMemo<WorkSearchRecords>(() => {
    if (signedOut) {
      const ready: WorkAreaStatus = sample ? "ready" : "loading";
      return {
        items: sample?.items ?? [],
        entries: sampleEntries,
        areas: (["roster", "teaching", "cme", "my-work", "on-call"] as const).map((area) => ({
          area,
          status: ready,
          sample: true,
        })),
        sample: true,
        retry,
      };
    }
    const current = fetched && fetched.epoch === authEpoch ? fetched : null;
    const entryStatus: WorkAreaStatus = enabled ? onCallStatus : "loading";
    return {
      items: current ? [...current.roster.items, ...current.teaching.items, ...current.cme.items] : [],
      entries: liveEntries,
      areas: [
        { area: "roster", status: current?.roster.status ?? "loading", sample: current?.roster.sample ?? false },
        { area: "teaching", status: current?.teaching.status ?? "loading", sample: current?.teaching.sample ?? false },
        { area: "cme", status: current?.cme.status ?? "loading", sample: current?.cme.sample ?? false },
        { area: "my-work", status: entryStatus, sample: onCall.demoMode },
        { area: "on-call", status: entryStatus, sample: onCall.demoMode },
      ],
      sample: false,
      retry,
    };
  }, [
    signedOut,
    sample,
    sampleEntries,
    fetched,
    authEpoch,
    enabled,
    onCallStatus,
    liveEntries,
    onCall.demoMode,
    retry,
  ]);
}
