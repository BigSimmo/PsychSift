"use client";

import { useCallback, useMemo } from "react";

import { useCmeMyDaySource } from "@/components/my-day/sources/cme";
import { useEntriesMyDaySources } from "@/components/my-day/sources/entries";
import { useRosterMyDaySource } from "@/components/my-day/sources/roster";
import { useTeachingMyDaySource } from "@/components/my-day/sources/teaching";
import type { CmeRoutine } from "@/lib/cme/routines";
import { mergeMyDayItems } from "@/lib/my-day/merge";
import type { MyDaySourceResult, MyDayState } from "@/lib/my-day/model";

/**
 * The one My Day read, shared by the `/my-day` page and the home card.
 *
 * Each source hook reads its mode's existing data the way that mode's own page
 * does, and maps it onto `MyDayItem` with that mode's own selectors. With
 * `enabled: false` (signed out) no source fetches anything.
 *
 * Admin and On Call are one source hook because both read the same On Call
 * entries; reading them once keeps a single network request and lets Admin
 * own the compliance-date rows without On Call repeating them.
 */
/** The My Day state plus the CPD routines it already read, so the Week page need not read them again. */
export type MyDayItemsRead = MyDayState & { readonly cmeRoutines: readonly CmeRoutine[] };

export function useMyDayItems({ enabled, now }: { readonly enabled: boolean; readonly now: Date }): MyDayItemsRead {
  const entries = useEntriesMyDaySources({ enabled, now });
  const roster = useRosterMyDaySource({ enabled, now });
  const cme = useCmeMyDaySource({ enabled, now });
  const teaching = useTeachingMyDaySource({ enabled, now });

  const sources: readonly MyDaySourceResult[] = useMemo(() => {
    const all = [entries.onCall, roster.result, cme.result, teaching.result, entries.admin];
    // While enabled, a source that answers "signed out" (the session lapsed under it) did not check anything.
    return enabled
      ? all.map((source): MyDaySourceResult =>
          source.status === "signed-out" ? { ...source, status: "failed" } : source,
        )
      : all;
  }, [enabled, entries.onCall, entries.admin, roster.result, cme.result, teaching.result]);
  const items = useMemo(() => mergeMyDayItems(sources.map((source) => source.items)), [sources]);

  const retryEntries = entries.retry;
  const retryRoster = roster.retry;
  const retryCme = cme.retry;
  const retryTeaching = teaching.retry;
  const retry = useCallback(() => {
    retryEntries();
    retryRoster();
    retryCme();
    retryTeaching();
  }, [retryEntries, retryRoster, retryCme, retryTeaching]);

  const signedOut = !enabled;
  const loading = sources.some((source) => source.status === "loading");
  return {
    status: signedOut ? "signed-out" : loading ? "loading" : "ready",
    items: signedOut ? [] : items,
    sources,
    // Only a source that actually loaded sample data makes the view "demo".
    demoMode: sources.some((source) => source.status === "ready" && source.sample === true),
    retry,
    cmeRoutines: cme.routines,
  };
}
