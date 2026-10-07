"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import {
  CPD_APPLICATIONS_STORAGE_KEY,
  CPD_HOME_SEND_STORAGE_KEY,
  subscribeAccountTransition,
} from "@/lib/account-scoped-browser-state";
import { isSharedDevice, SHARED_DEVICE_CHANGE_EVENT, useSharedDevice } from "@/lib/alerts/shared-device";
import {
  EMPTY_APPLICATIONS,
  isValidApplications,
  parseApplications,
  type ApplicationsState,
} from "@/lib/cme/applications";
import {
  EMPTY_CPD_HOME_SEND,
  isValidCpdHomeSendState,
  parseCpdHomeSendState,
  type CpdHomeSendState,
} from "@/lib/cme/cpd-home-send";

/**
 * Where CPD's two device-only records live: "Send to AMA CPD Home" file
 * history and the Job applications season. The same pattern as Teaching's term
 * tracker (`term-tracker-store.ts`): `useSyncExternalStore` over localStorage,
 * an in-memory copy when the browser refuses storage, a state of `null` until
 * the browser has been read (so the first paint is never "nothing yet"), and
 * every write validated before it is saved. Both keys are account-scoped, so
 * the auth provider removes them at sign-out, session expiry or an account
 * switch.
 *
 * Two cases keep the record in React state only and save nothing:
 * - the made-up sample (local demo build), so every control can be tried;
 * - a device marked shared ("This is a shared computer" in Alerts), because a
 *   referee's name must not sit on a ward computer for the next person.
 *
 * Marking a device shared also REMOVES both records already saved on it
 * (`clearCpdDeviceRecordsIfShared`), not just hides them. The Alerts switch
 * lives outside CPD and clears only Remind me, so this module listens for the
 * switch itself: on load, on the switch's change event, on a storage event
 * from another tab, and whenever a CPD page sees the device is shared.
 */

export type CmeDeviceMode = "device" | "sample" | "shared";

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

function read(key: string): string | null {
  try {
    const stored = window.localStorage.getItem(key);
    if (stored === null) memory.delete(key);
    return stored;
  } catch {
    return memory.get(key) ?? null;
  }
}

function write(key: string, value: string): void {
  memory.set(key, value);
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage refused: the change lasts for this page only.
  }
  notify();
}

const CPD_DEVICE_KEYS = [CPD_APPLICATIONS_STORAGE_KEY, CPD_HOME_SEND_STORAGE_KEY] as const;

/** On a device marked shared, removes CPD's saved records. True when the device is shared. */
export function clearCpdDeviceRecordsIfShared(): boolean {
  if (!isSharedDevice()) return false;
  let removed = false;
  for (const key of CPD_DEVICE_KEYS) {
    memory.delete(key);
    try {
      if (window.localStorage.getItem(key) !== null) {
        window.localStorage.removeItem(key);
        removed = true;
      }
    } catch {
      // Storage refused: nothing was kept there to remove.
    }
  }
  if (removed) notify();
  return true;
}

if (typeof window !== "undefined") {
  clearCpdDeviceRecordsIfShared();
  window.addEventListener(SHARED_DEVICE_CHANGE_EVENT, () => clearCpdDeviceRecordsIfShared());
  window.addEventListener("storage", () => clearCpdDeviceRecordsIfShared());
}

const serverSnapshot = () => null;

export interface CmeDeviceRecord<T> {
  /** Null until the browser has been read. */
  readonly state: T | null;
  /** Applies a change; returns false when the result would not read back, so nothing was kept. */
  readonly update: (change: (current: T) => T) => boolean;
  readonly mode: CmeDeviceMode;
}

function useCmeDeviceRecord<T>(
  key: string,
  parse: (raw: string | null) => T,
  isValid: (state: T) => boolean,
  empty: T,
  sample: T | null,
): CmeDeviceRecord<T> {
  const shared = useSharedDevice();
  const local = sample ?? (shared ? empty : null);
  useEffect(() => {
    if (shared) clearCpdDeviceRecordsIfShared();
  }, [shared]);
  const [localState, setLocalState] = useState<T | null>(null);
  const localRef = useRef<T | null>(null);
  const hydrated = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  const raw = useSyncExternalStore(subscribe, () => read(key), serverSnapshot);
  const stored = useMemo(() => parse(raw), [parse, raw]);

  const update = useCallback(
    (change: (current: T) => T) => {
      if (local) {
        const next = change(localRef.current ?? local);
        if (!isValid(next)) return false;
        localRef.current = next;
        setLocalState(next);
        return true;
      }
      const next = change(parse(read(key)));
      // An edit that would not read back is dropped rather than saved, so the record stays readable.
      if (!isValid(next)) return false;
      write(key, JSON.stringify(next));
      return true;
    },
    [isValid, key, local, parse],
  );

  const mode: CmeDeviceMode = sample ? "sample" : shared ? "shared" : "device";
  if (local) return { state: localState ?? local, update, mode };
  return { state: hydrated ? stored : null, update, mode };
}

export function useCpdHomeSendStore(sample: CpdHomeSendState | null): CmeDeviceRecord<CpdHomeSendState> {
  return useCmeDeviceRecord(
    CPD_HOME_SEND_STORAGE_KEY,
    parseCpdHomeSendState,
    isValidCpdHomeSendState,
    EMPTY_CPD_HOME_SEND,
    sample,
  );
}

export function useApplicationsStore(sample: ApplicationsState | null): CmeDeviceRecord<ApplicationsState> {
  return useCmeDeviceRecord(
    CPD_APPLICATIONS_STORAGE_KEY,
    parseApplications,
    isValidApplications,
    EMPTY_APPLICATIONS,
    sample,
  );
}
