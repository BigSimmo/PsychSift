"use client";

import { useEffect, useMemo, useState } from "react";

import { perthDateKey } from "@/components/teaching/teaching-dates";
import { useTeachingNow } from "@/components/teaching/use-teaching-now";
import { useTeachingResource, type TeachingResourceStatus } from "@/components/teaching/use-teaching-resource";
import { demoTeachingLogbook } from "@/lib/teaching/demo-programme";
import { demoSupervision } from "@/lib/teaching/depth-demo";
import type { SupervisionPairingView } from "@/lib/teaching/depth-model";
import type { LogbookRow } from "@/lib/teaching/model";
import {
  buildTermFolder,
  otherTerms,
  pickFolderTerm,
  type FolderSource,
  type TermFolder,
} from "@/lib/teaching/term-folder";
import { sampleTermTracker, type TermRecord, type TermTrackerState } from "@/lib/teaching/term-tracker";
import { useTermTrackerStore } from "@/lib/teaching/term-tracker-store";
import { perthTime } from "@/lib/teaching/time";

/*
 * Everything the term evidence folder reads, in one place for the page and its Today card. Two reads that
 * already exist (the logbook and supervision) plus the term tracker on this device. In the made-up demo
 * (signed out, or the local demo build) it builds the same shapes from the shipped demo files and calls
 * nothing. A read that fails is reported as "not updating" for its part only, so one slow service never
 * blanks the folder.
 */

export type TermFolderView =
  | { readonly kind: "loading" }
  | { readonly kind: "signed-out" }
  | { readonly kind: "no-term"; readonly today: string }
  | {
      readonly kind: "ready";
      readonly today: string;
      readonly state: TermTrackerState;
      readonly term: TermRecord;
      readonly folder: TermFolder;
      readonly earlier: readonly TermRecord[];
      /** "15:02": when the reads last arrived, or null while one is still loading. */
      readonly updatedAt: string | null;
      readonly failed: readonly ("attendance" | "supervision")[];
      readonly offline: boolean;
      readonly retry: () => void;
    };

type Kept<T> = { readonly data: T; readonly at: string } | null;

function toSource<T>(
  status: TeachingResourceStatus,
  data: T | null | undefined,
  kept: Kept<T> = null,
): FolderSource<T> {
  if (data !== null && data !== undefined) return { status: "ready", data };
  if (status === "loading" || status === "idle") return { status: "loading" };
  // A read that failed after an earlier one worked keeps the last good figures, marked as of then.
  return kept ? { status: "stale", data: kept.data, asOf: kept.at } : { status: "failed" };
}

export function useTermFolder(demoMode: boolean, requestedTermId: string | null): TermFolderView {
  const now = useTeachingNow();
  const today = now ? perthDateKey(now) : null;
  const sample = useMemo(() => (demoMode && today ? sampleTermTracker(today) : null), [demoMode, today]);
  const { state } = useTermTrackerStore(sample);
  const logbook = useTeachingResource<{ attendance: LogbookRow[] }>(demoMode ? null : "/api/teaching?view=logbook");
  const supervision = useTeachingResource<{ pairings: SupervisionPairingView[] }>(
    demoMode ? null : "/api/teaching/depth?view=supervision",
  );
  // The demo day changes only at midnight, so the made-up rows are built once per day, not every clock tick.
  const demoRows = useMemo(
    () => (demoMode && today ? demoTeachingLogbook(new Date(`${today}T04:00:00Z`)) : null),
    [demoMode, today],
  );
  const demoPairings = useMemo(() => (demoMode && today ? demoSupervision(today) : null), [demoMode, today]);

  const rows = demoMode ? demoRows : (logbook.data?.attendance ?? null);
  const pairings = demoMode ? demoPairings : (supervision.data?.pairings ?? null);
  // The last good read of each source on this visit, so a later failure keeps its figures (marked stale).
  const [keptRows, setKeptRows] = useState<Kept<readonly LogbookRow[]>>(null);
  const [keptPairings, setKeptPairings] = useState<Kept<readonly SupervisionPairingView[]>>(null);
  const attendanceSource = toSource(demoMode ? "ready" : logbook.status, rows, keptRows);
  const supervisionSource = toSource(demoMode ? "ready" : supervision.status, pairings, keptPairings);
  const bothReady = attendanceSource.status !== "loading" && supervisionSource.status !== "loading";

  // The time the folder last filled, shown as "updated 15:02". Set when a read lands, never guessed.
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  useEffect(() => {
    if (!bothReady) return;
    const stamp = perthTime(new Date().toISOString());
    // Deferred so the stamp follows the paint that showed the new figures.
    const timer = window.setTimeout(() => {
      setUpdatedAt(stamp);
      if (rows) setKeptRows({ data: rows, at: stamp });
      if (pairings) setKeptPairings({ data: pairings, at: stamp });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [bothReady, rows, pairings]);

  const term = state ? pickFolderTerm(state, requestedTermId) : null;
  const folder = useMemo(
    () =>
      state && term && today
        ? buildTermFolder({ today, state, term, attendance: attendanceSource, supervision: supervisionSource })
        : null,
    // The sources are rebuilt each render from the data below, which is what actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state, term, today, rows, pairings, logbook.status, supervision.status, keptRows, keptPairings],
  );

  if (!demoMode && logbook.status === "signed-out") return { kind: "signed-out" };
  if (!today || !state) return { kind: "loading" };
  if (!term || !folder) return { kind: "no-term", today };
  const failed = [
    attendanceSource.status === "failed" || attendanceSource.status === "stale" ? ("attendance" as const) : null,
    supervisionSource.status === "failed" || supervisionSource.status === "stale" ? ("supervision" as const) : null,
  ].filter((value): value is "attendance" | "supervision" => value !== null);
  return {
    kind: "ready",
    today,
    state,
    term,
    folder,
    earlier: otherTerms(state, term.id),
    updatedAt: bothReady ? updatedAt : null,
    failed,
    offline: !demoMode && (logbook.status === "offline" || supervision.status === "offline"),
    retry: () => {
      if (attendanceSource.status === "failed" || attendanceSource.status === "stale") logbook.retry();
      if (supervisionSource.status === "failed" || supervisionSource.status === "stale") supervision.retry();
    },
  };
}
