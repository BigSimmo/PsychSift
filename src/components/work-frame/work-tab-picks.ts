"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";

import { WORK_TAB_PICKS_STORAGE_KEY, subscribeAccountTransition } from "@/lib/account-scoped-browser-state";
import { parseWorkTabPicks, type WorkAreaId, type WorkTabPicks } from "@/lib/work-frame/areas";

/**
 * The first tabs each reader chose for each work area, kept on this device.
 * The key is account-scoped (`src/lib/account-scoped-browser-state.ts`), so the
 * auth provider removes it at sign-out, session expiry or an account switch.
 * Page ids only. A browser that refuses storage keeps the choice for this page.
 */

const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  const unsubscribeTransition = subscribeAccountTransition(onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
    unsubscribeTransition();
  };
}

/** In-memory fallback for a browser that refuses storage, dropped at an account transition. */
let memory: string | null = null;
subscribeAccountTransition(() => {
  memory = null;
});

function read(): string | null {
  try {
    const stored = window.localStorage.getItem(WORK_TAB_PICKS_STORAGE_KEY);
    if (stored === null) memory = null;
    return stored;
  } catch {
    return memory;
  }
}

function write(value: string | null): void {
  memory = value;
  try {
    if (value === null) window.localStorage.removeItem(WORK_TAB_PICKS_STORAGE_KEY);
    else window.localStorage.setItem(WORK_TAB_PICKS_STORAGE_KEY, value);
  } catch {
    // Storage refused: the choice lasts for this page only.
  }
  notify();
}

const serverSnapshot = () => null;

/** The reader's first tabs for one area, and a way to change or clear them (an empty list clears). */
export function useWorkTabPicks(areaId: WorkAreaId): [readonly string[] | undefined, (ids: readonly string[]) => void] {
  const raw = useSyncExternalStore(subscribe, read, serverSnapshot);
  const all = useMemo(() => parseWorkTabPicks(raw), [raw]);
  const set = useCallback(
    (ids: readonly string[]) => {
      const next: Partial<Record<WorkAreaId, readonly string[]>> = { ...parseWorkTabPicks(read()) };
      if (ids.length > 0) next[areaId] = ids;
      else delete next[areaId];
      write(Object.keys(next).length > 0 ? JSON.stringify(next satisfies WorkTabPicks) : null);
    },
    [areaId],
  );
  return [all[areaId], set];
}
