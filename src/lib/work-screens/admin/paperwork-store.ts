"use client";

import { useCallback, useMemo, useState, useSyncExternalStore } from "react";

import { subscribeAccountTransition } from "@/lib/account-scoped-browser-state";
import {
  emptyPaperwork,
  isValidPaperwork,
  parsePaperwork,
  type AdminPaperwork,
} from "@/lib/work-screens/admin/paperwork-model";

/**
 * Where Admin's own-paperwork record lives: this device, for this account.
 *
 * ACCOUNT SCOPE. The key must be added to `clearAccountScopedBrowserStorage`
 * in `src/lib/account-scoped-browser-state.ts` (that file is owned by another
 * thread, so the addition is listed in the wiring report). Until it is, this
 * module closes the same hole itself as far as it can: it removes its own key
 * on every account transition it hears, and the pages call `forget()` when the
 * session reads as signed out.
 *
 * In the signed-out sample, and in the local demo build, the hook keeps a
 * sample in React state so every control can be tried and nothing is saved.
 */

export const ADMIN_PAPERWORK_STORAGE_KEY = "psychsift:admin:paperwork-v1";

const listeners = new Set<() => void>();
let memory: string | null = null;

function notify(): void {
  for (const listener of listeners) listener();
}

function removeStored(): void {
  memory = null;
  try {
    window.localStorage.removeItem(ADMIN_PAPERWORK_STORAGE_KEY);
  } catch {
    // Storage blocked: nothing was kept there either.
  }
}

subscribeAccountTransition(() => {
  removeStored();
  notify();
});

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === ADMIN_PAPERWORK_STORAGE_KEY) onChange();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

function read(): string | null {
  try {
    return window.localStorage.getItem(ADMIN_PAPERWORK_STORAGE_KEY) ?? memory;
  } catch {
    return memory;
  }
}

/** Writes the record. Returns false when the browser refused, so the page can say it lasts this visit only. */
function write(value: string): boolean {
  memory = value;
  let saved = true;
  try {
    window.localStorage.setItem(ADMIN_PAPERWORK_STORAGE_KEY, value);
  } catch {
    saved = false;
  }
  notify();
  return saved;
}

export interface AdminPaperworkStore {
  /** Null until the browser has been read, so the first paint is a skeleton and never "nothing yet". */
  readonly state: AdminPaperwork | null;
  /** True when changes are kept in this page only (sample, demo, or storage refused). */
  readonly sample: boolean;
  /** Applies a change. Returns false when the change would not read back, so nothing was saved. */
  readonly update: (change: (current: AdminPaperwork) => AdminPaperwork) => boolean;
  /** Removes every record on this device. */
  readonly forget: () => void;
}

const serverSnapshot = () => null;

export function useAdminPaperwork(sample: AdminPaperwork | null): AdminPaperworkStore {
  const [sampleState, setSampleState] = useState<AdminPaperwork | null>(sample);
  const hydrated = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  const raw = useSyncExternalStore(subscribe, read, serverSnapshot);
  const stored = useMemo(() => parsePaperwork(raw), [raw]);

  const update = useCallback(
    (change: (current: AdminPaperwork) => AdminPaperwork): boolean => {
      if (sample) {
        const next = change(sampleState ?? sample);
        if (!isValidPaperwork(next)) return false;
        setSampleState(next);
        return true;
      }
      const next = change(parsePaperwork(read()));
      if (!isValidPaperwork(next)) return false;
      write(JSON.stringify(next));
      return true;
    },
    [sample, sampleState],
  );

  const forget = useCallback(() => {
    if (sample) {
      setSampleState(sample);
      return;
    }
    removeStored();
    notify();
  }, [sample]);

  if (sample) return { state: sampleState ?? sample, sample: true, update, forget };
  return { state: hydrated ? stored : null, sample: false, update, forget };
}

/** Removes the record from this device, outside any page (sign-out, or "Remove from this phone"). */
export function forgetAdminPaperworkOnDevice(): void {
  if (typeof window === "undefined") return;
  removeStored();
  notify();
}

/** For tests and for a page that needs an empty record before the first save. */
export function emptyAdminPaperwork(): AdminPaperwork {
  return emptyPaperwork();
}
