"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";

import {
  MY_DAY_HIDDEN_CARDS_STORAGE_KEY,
  MY_DAY_QUICK_NOTE_STORAGE_KEY,
  MY_DAY_SNOOZED_ITEMS_STORAGE_KEY,
  subscribeAccountTransition,
} from "@/lib/account-scoped-browser-state";
import {
  parseHiddenCards,
  parseSnoozes,
  serialiseHiddenCards,
  type MyDayCardId,
  type MyDaySnoozes,
} from "@/lib/my-day/dashboard";

/**
 * What My Day keeps on this device: the cards the reader hid, and the items
 * they moved to tomorrow. Both keys are account-scoped
 * (`src/lib/account-scoped-browser-state.ts`): the auth provider removes them
 * at sign-out, session expiry or an account switch, so one doctor's choices
 * never show for the next person on a shared computer. Nothing here is sent
 * to a server, and a browser that refuses storage simply keeps the choice for
 * this page only.
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
const memory = new Map<string, string>();
subscribeAccountTransition(() => memory.clear());

/**
 * When storage works it is the only truth: a missing key means "nothing
 * stored" (another tab may have restored a card or undone a "Later"), so the
 * memory copy is dropped. Memory is read only when storage itself throws.
 */
function read(key: string): string | null {
  try {
    const stored = window.localStorage.getItem(key);
    if (stored === null) memory.delete(key);
    return stored;
  } catch {
    // Storage refused: fall back to this page's memory.
    return memory.get(key) ?? null;
  }
}

function write(key: string, value: string | null): void {
  if (value === null) memory.delete(key);
  else memory.set(key, value);
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Storage refused: the choice lasts for this page only.
  }
  notify();
}

const serverSnapshot = () => null;

export interface MyDayDeviceState {
  readonly hidden: ReadonlySet<MyDayCardId>;
  readonly setHidden: (id: MyDayCardId, hidden: boolean) => void;
  readonly snoozes: MyDaySnoozes;
  readonly snooze: (itemId: string, until: string) => void;
  readonly unsnooze: (itemId: string) => void;
}

export function useMyDayDeviceState(today: string): MyDayDeviceState {
  const hiddenRaw = useSyncExternalStore(subscribe, () => read(MY_DAY_HIDDEN_CARDS_STORAGE_KEY), serverSnapshot);
  const snoozedRaw = useSyncExternalStore(subscribe, () => read(MY_DAY_SNOOZED_ITEMS_STORAGE_KEY), serverSnapshot);
  const hidden = useMemo(() => parseHiddenCards(hiddenRaw), [hiddenRaw]);
  const snoozes = useMemo(() => parseSnoozes(snoozedRaw, today), [snoozedRaw, today]);

  const setHidden = useCallback((id: MyDayCardId, hide: boolean) => {
    const next = new Set(parseHiddenCards(read(MY_DAY_HIDDEN_CARDS_STORAGE_KEY)));
    if (hide) next.add(id);
    else next.delete(id);
    write(MY_DAY_HIDDEN_CARDS_STORAGE_KEY, next.size ? serialiseHiddenCards(next) : null);
  }, []);

  const writeSnoozes = useCallback(
    (change: (current: Record<string, string>) => void) => {
      // Expired entries are dropped on every write, so the record never grows.
      const next: Record<string, string> = { ...parseSnoozes(read(MY_DAY_SNOOZED_ITEMS_STORAGE_KEY), today) };
      change(next);
      write(MY_DAY_SNOOZED_ITEMS_STORAGE_KEY, Object.keys(next).length ? JSON.stringify(next) : null);
    },
    [today],
  );
  const snooze = useCallback(
    (itemId: string, until: string) =>
      writeSnoozes((current) => {
        current[itemId] = until;
      }),
    [writeSnoozes],
  );
  const unsnooze = useCallback(
    (itemId: string) =>
      writeSnoozes((current) => {
        delete current[itemId];
      }),
    [writeSnoozes],
  );

  return { hidden, setHidden, snoozes, snooze, unsnooze };
}

/** The longest quick note kept: a reminder, not a document. */
export const MY_DAY_QUICK_NOTE_LIMIT = 500;

/**
 * The quick note on Me: kept on this device for this account only (the same
 * account-scoped store as the hidden cards), never sent anywhere.
 */
export function useMyDayQuickNote(): readonly [string, (value: string) => void] {
  const raw = useSyncExternalStore(subscribe, () => read(MY_DAY_QUICK_NOTE_STORAGE_KEY), serverSnapshot);
  const setNote = useCallback((value: string) => {
    const next = value.slice(0, MY_DAY_QUICK_NOTE_LIMIT);
    write(MY_DAY_QUICK_NOTE_STORAGE_KEY, next.trim() ? next : null);
  }, []);
  return [raw ?? "", setNote] as const;
}

/** Tests only: forget the in-memory fallback. */
export function resetMyDayDeviceStateForTesting(): void {
  memory.clear();
}
