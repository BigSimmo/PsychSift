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
  chooseFolderTerm,
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
      /**
       * "15:02": when a read last succeeded, or null while one is still loading or when none has succeeded on
       * this visit. A failed read never sets it.
       */
      readonly updatedAt: string | null;
      /** A `?term=` link asked for a term that is no longer on this phone, so another term is shown. */
      readonly requestedMissing: boolean;
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

  // Each source's last good read, stamped when it lands (deferred so the stamp follows the paint that showed
  // the figures). A failed read stamps nothing, so "updated 15:02" only ever names a read that worked.
  useEffect(() => {
    if (!rows) return;
    const timer = window.setTimeout(() => setKeptRows({ data: rows, at: perthTime(new Date().toISOString()) }), 0);
    return () => window.clearTimeout(timer);
  }, [rows]);
  useEffect(() => {
    if (!pairings) return;
    const timer = window.setTimeout(
      () => setKeptPairings({ data: pairings, at: perthTime(new Date().toISOString()) }),
      0,
    );
    return () => window.clearTimeout(timer);
  }, [pairings]);
  const goodStamps = [
    attendanceSource.status === "ready" ? keptRows?.at : null,
    supervisionSource.status === "ready" ? keptPairings?.at : null,
  ].filter((at): at is string => Boolean(at));
  const updatedAt = goodStamps.length ? goodStamps.sort().at(-1)! : null;

  // Read both again when the page comes back into view, so figures that loaded once are not shown forever,
  // and a read that now fails keeps its last good figures, marked "As of".
  const refreshLogbook = logbook.retry;
  const refreshSupervision = supervision.retry;
  useEffect(() => {
    if (demoMode) return;
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      refreshLogbook();
      refreshSupervision();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [demoMode, refreshLogbook, refreshSupervision]);

  const { term, requestedMissing } = state
    ? chooseFolderTerm(state, requestedTermId)
    : { term: null, requestedMissing: false };
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
    requestedMissing,
    failed,
    offline: !demoMode && (logbook.status === "offline" || supervision.status === "offline"),
    // Try again reads both sources, so the whole folder is current, not only the part that failed.
    retry: () => {
      if (demoMode) return;
      logbook.retry();
      supervision.retry();
    },
  };
}
