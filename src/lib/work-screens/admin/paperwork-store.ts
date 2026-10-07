"use client";

import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { ADMIN_PAPERWORK_STORAGE_KEY, subscribeAccountTransition } from "@/lib/account-scoped-browser-state";
import {
  emptyPaperwork,
  isValidPaperwork,
  parsePaperwork,
  type AdminPaperwork,
} from "@/lib/work-screens/admin/paperwork-model";
import { withoutExampleRecords } from "@/lib/example-data/guards";

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

// The key lives with the other account-scoped keys, so sign-out clears exactly this one.
export { ADMIN_PAPERWORK_STORAGE_KEY };

const listeners = new Set<() => void>();
let memory: string | null = null;
/**
 * True once the browser refused a write (storage blocked or full). From then the
 * page reads its own copy in memory, so a change never snaps back to the older
 * stored record, and the pages say the change lasts for this visit only.
 */
let refused = false;

function notify(): void {
  for (const listener of listeners) listener();
}

function removeStored(): void {
  memory = null;
  refused = false;
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
  if (refused) return memory;
  try {
    return window.localStorage.getItem(ADMIN_PAPERWORK_STORAGE_KEY) ?? memory;
  } catch {
    return memory;
  }
}

function readRefused(): boolean {
  return refused;
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
  refused = !saved;
  notify();
  return saved;
}

/**
 * Example records (ids starting "example:") are never written to the device,
 * whatever path a change took to get here. The signed-out and demo samples live
 * in React state and never reach this function.
 */
export function withoutStoredExamples(state: AdminPaperwork): AdminPaperwork {
  const tax = Object.fromEntries(
    Object.entries(state.tax).map(([key, year]) => [key, { ...year, expenses: withoutExampleRecords(year.expenses) }]),
  );
  return {
    ...state,
    requests: withoutExampleRecords(state.requests),
    documents: withoutExampleRecords(state.documents),
    payslips: withoutExampleRecords(state.payslips),
    sharing: { ...state.sharing, log: withoutExampleRecords(state.sharing.log) },
    tax,
  };
}

export interface AdminPaperworkStore {
  /** Null until the browser has been read, so the first paint is a skeleton and never "nothing yet". */
  readonly state: AdminPaperwork | null;
  /** True when changes are kept in this page only (sample or demo). */
  readonly sample: boolean;
  /** True when the browser refused to save: changes last until this page is closed. */
  readonly unsaved: boolean;
  /** Applies a change. Returns false when the change would not read back, so nothing was saved. */
  readonly update: (change: (current: AdminPaperwork) => AdminPaperwork) => boolean;
  /** Removes every record on this device. */
  readonly forget: () => void;
}

const serverSnapshot = () => null;

export function useAdminPaperwork(sample: AdminPaperwork | null, holding = false): AdminPaperworkStore {
  // The page's own copy of the in-memory record, tied to the record it started from, so a new one (the
  // example data switch turned on or off) starts again rather than keeping the old copy's changes.
  const [sampleState, setSampleState] = useState<{ base: AdminPaperwork; value: AdminPaperwork } | null>(
    sample ? { base: sample, value: sample } : null,
  );
  // The latest sample copy, so two changes in one tap (a change and its Undo) both land.
  const sampleRef = useRef<{ base: AdminPaperwork; value: AdminPaperwork } | null>(sampleState);
  const hydrated = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  const raw = useSyncExternalStore(subscribe, read, serverSnapshot);
  const unsaved = useSyncExternalStore(subscribe, readRefused, () => false);
  const stored = useMemo(() => parsePaperwork(raw), [raw]);

  const update = useCallback(
    (change: (current: AdminPaperwork) => AdminPaperwork): boolean => {
      // Waiting for the in-memory record: nothing to change yet, and nothing may reach the device.
      if (holding) return false;
      if (sample) {
        const current = sampleRef.current?.base === sample ? sampleRef.current.value : sample;
        const next = change(current);
        if (!isValidPaperwork(next)) return false;
        sampleRef.current = { base: sample, value: next };
        setSampleState(sampleRef.current);
        return true;
      }
      const next = withoutStoredExamples(change(parsePaperwork(read())));
      if (!isValidPaperwork(next)) return false;
      write(JSON.stringify(next));
      return true;
    },
    [sample, holding],
  );

  const forget = useCallback(() => {
    if (holding) return;
    if (sample) {
      sampleRef.current = { base: sample, value: sample };
      setSampleState(sampleRef.current);
      return;
    }
    removeStored();
    notify();
  }, [sample, holding]);

  if (holding) return { state: null, sample: true, unsaved: false, update, forget };
  if (sample) {
    const value = sampleState?.base === sample ? sampleState.value : sample;
    return { state: value, sample: true, unsaved: false, update, forget };
  }
  return { state: hydrated ? stored : null, sample: false, unsaved, update, forget };
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
