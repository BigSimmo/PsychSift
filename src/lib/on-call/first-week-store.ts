"use client";

import { useCallback, useMemo, useState, useSyncExternalStore } from "react";

import { ON_CALL_FIRST_WEEK_READ_STORAGE_KEY, subscribeAccountTransition } from "@/lib/account-scoped-browser-state";
import {
  EMPTY_FIRST_WEEK_READ,
  isValidFirstWeekRead,
  parseFirstWeekRead,
  type FirstWeekReadState,
} from "@/lib/on-call/first-week-pack";

/**
 * Where "Your first week" remembers which sections were read: this device
 * only, under an account-scoped key, so the auth provider removes it at
 * sign-out, session expiry or an account switch. It holds section ids and
 * times, nothing else, and nothing is sent to a server. A browser that refuses
 * storage keeps the marks for this page only.
 *
 * In the signed-out sample the marks live in React state, so a visitor can try
 * every control and nothing is saved.
 */

const listeners = new Set<() => void>();
const memory = new Map<string, string>();
subscribeAccountTransition(() => memory.clear());

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

function read(): string | null {
  try {
    const stored = window.localStorage.getItem(ON_CALL_FIRST_WEEK_READ_STORAGE_KEY);
    if (stored === null) memory.delete(ON_CALL_FIRST_WEEK_READ_STORAGE_KEY);
    return stored;
  } catch {
    return memory.get(ON_CALL_FIRST_WEEK_READ_STORAGE_KEY) ?? null;
  }
}

function write(value: string): void {
  memory.set(ON_CALL_FIRST_WEEK_READ_STORAGE_KEY, value);
  try {
    window.localStorage.setItem(ON_CALL_FIRST_WEEK_READ_STORAGE_KEY, value);
  } catch {
    // Storage refused: the marks last for this page only.
  }
  notify();
}

const serverSnapshot = () => null;
const hydratedSnapshot = () => true;
const unhydratedSnapshot = () => false;

export type FirstWeekReadStore = {
  /** Null until the browser has been read, so the first paint never claims "nothing read". */
  readonly state: FirstWeekReadState | null;
  readonly update: (change: (current: FirstWeekReadState) => FirstWeekReadState) => void;
  /** True for the signed-out sample: nothing is saved. */
  readonly sample: boolean;
};

export function useFirstWeekReadStore(sample: boolean): FirstWeekReadStore {
  const [sampleState, setSampleState] = useState<FirstWeekReadState>(EMPTY_FIRST_WEEK_READ);
  const hydrated = useSyncExternalStore(subscribe, hydratedSnapshot, unhydratedSnapshot);
  const raw = useSyncExternalStore(subscribe, read, serverSnapshot);
  const stored = useMemo(() => parseFirstWeekRead(raw), [raw]);

  const update = useCallback(
    (change: (current: FirstWeekReadState) => FirstWeekReadState) => {
      if (sample) {
        setSampleState((current) => {
          const next = change(current);
          return isValidFirstWeekRead(next) ? next : current;
        });
        return;
      }
      const next = change(parseFirstWeekRead(read()));
      // A change that would not read back is dropped rather than saved.
      if (isValidFirstWeekRead(next)) write(JSON.stringify(next));
    },
    [sample],
  );

  if (sample) return { state: sampleState, update, sample };
  return { state: hydrated ? stored : null, update, sample };
}
