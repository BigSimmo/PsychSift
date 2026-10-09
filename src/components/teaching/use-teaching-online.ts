"use client";

import { useState, useSyncExternalStore } from "react";

import type { TeachingWeekState } from "@/components/teaching/use-teaching-week";
import type { TeachingWeekResponse } from "@/lib/teaching/model";

/*
 * The connection flag and the last good week read, shared by Today and Week. Nothing is kept on
 * the phone (Teaching stores no timetable on the device): the last read lives in memory only, with
 * the time it arrived, so a page that loses signal can keep showing it and say when it is from.
 */

function subscribeOnline(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/** The browser's own connection flag; true on the server. */
export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
}

export type LoadedWeek = { monday: string; week: TeachingWeekResponse; at: Date };

/** The last good read of this week, in memory only, with the time it arrived. */
export function useLastLoaded(view: TeachingWeekState, monday: string | null, now: Date | null): LoadedWeek | null {
  const [loaded, setLoaded] = useState<LoadedWeek | null>(null);
  const week = view.status === "ready" ? view.week : null;
  // Remember each new read as it arrives (state adjusted during render, not in an effect).
  if (week && monday && now && loaded?.week !== week) setLoaded({ monday, week, at: now });
  if (week && monday && now) return { monday, week, at: loaded?.week === week ? loaded.at : now };
  return loaded && loaded.monday === monday ? loaded : null;
}
