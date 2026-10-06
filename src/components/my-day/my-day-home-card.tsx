"use client";

import { Sunrise } from "lucide-react";
import { useEffect, useState } from "react";

import { ModeGroupedList, ModeRow } from "@/components/mode-kit/grouped-list";
import { listNames, MyDayItemRow, useMyDayNow } from "@/components/my-day/my-day-page-parts";
import { useMyDayItems } from "@/components/my-day/use-my-day-items";
import { appModeDefinition } from "@/lib/app-modes";
import { summariseMyDay } from "@/lib/my-day/merge";
import { myDayEnabledForAuth, type MyDayItem } from "@/lib/my-day/model";
import { useAuthSession } from "@/lib/supabase/client";

const TOP_COUNT = 3;
const CACHE_MAX_AGE_MS = 2 * 60_000;

/**
 * The last ready state, remembered in memory only (never stored), so the card
 * does not pop in again every time the reader returns to the home screen.
 * Used only for the same sign-in (auth epoch) and for under two minutes.
 */
let lastReady: { readonly items: readonly MyDayItem[]; readonly epoch: number; readonly at: number } | null = null;

export function resetMyDayHomeCardCache(): void {
  lastReady = null;
}

function freshCache(epoch: number): readonly MyDayItem[] | null {
  return lastReady && lastReady.epoch === epoch && Date.now() - lastReady.at < CACHE_MAX_AGE_MS
    ? lastReady.items
    : null;
}

/**
 * My Day on the shared home screen. Renders nothing at all (no box, no
 * skeleton) when signed out, loading with nothing remembered, in demo mode or
 * with nothing to show, so the home layout never shifts for those readers.
 */
export function MyDayHomeCard({ now: nowProp }: { now?: Date } = {}) {
  const { status: authStatus, authEpoch } = useAuthSession();
  const enabled = myDayEnabledForAuth(authStatus);
  const now = useMyDayNow(nowProp);
  const state = useMyDayItems({ enabled, now });
  // The remembered items belong to the sign-in they were read under. If the epoch changes while mounted (a
  // direct account switch), they are dropped at once so one account's titles never render for another.
  const [remembered] = useState(() => ({ epoch: authEpoch, items: freshCache(authEpoch) }));
  const seed = remembered.epoch === authEpoch ? remembered.items : null;

  const ready = state.status === "ready" && !state.demoMode;
  useEffect(() => {
    if (ready) lastReady = { items: state.items, epoch: authEpoch, at: Date.now() };
  }, [ready, state.items, authEpoch]);

  const items =
    state.status === "ready" ? (state.demoMode ? [] : state.items) : state.status === "loading" ? (seed ?? []) : [];
  if (items.length === 0) return null;

  const failed = state.sources
    .filter((source) => source.status === "failed")
    .map((source) => appModeDefinition(source.mode).label);
  const summary = summariseMyDay(items);
  const parts = [
    summary.overdue > 0 ? `${summary.overdue} overdue` : null,
    summary.soon > 0 ? `${summary.soon} due soon` : null,
  ].filter((part): part is string => part !== null);
  const subtitle =
    failed.length > 0 ? `${listNames(failed)} couldn't load` : parts.length > 0 ? parts.join(" · ") : undefined;

  return (
    <ModeGroupedList eyebrow="My Day" headerIcon={Sunrise} mode="my-day" testId="my-day-home-card">
      {items.slice(0, TOP_COUNT).map((item) => (
        <MyDayItemRow key={item.id} item={item} now={now} />
      ))}
      <ModeRow
        title={`See all ${summary.total} in My Day`}
        subtitle={subtitle}
        href="/my-day"
        testId="my-day-home-card-see-all"
      />
    </ModeGroupedList>
  );
}
