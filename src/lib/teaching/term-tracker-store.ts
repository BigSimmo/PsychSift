"use client";

import { useCallback, useMemo, useState, useSyncExternalStore } from "react";

import {
  subscribeAccountTransition,
  TEACHING_EXAM_PREP_STORAGE_KEY,
  TEACHING_TERM_TRACKER_STORAGE_KEY,
} from "@/lib/account-scoped-browser-state";
import {
  isValidExamPrep,
  isValidTermTracker,
  parseExamPrep,
  parseTermTracker,
  type ExamPrepState,
  type TermTrackerState,
} from "@/lib/teaching/term-tracker";

/**
 * Where the term tracker and exam prep live: this device only. Both keys are account-scoped, so the
 * auth provider removes them at sign-out, session expiry or an account switch, and one doctor's term
 * never shows for the next person on a shared computer. Nothing here is sent to a server. A browser
 * that refuses storage keeps the changes for this page only.
 *
 * In the made-up sample (signed out, or the local demo build) the same hook keeps the sample in React
 * state, so a visitor can try every control and nothing is saved.
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

const serverSnapshot = () => null;

interface DeviceRecord<T> {
  /** Null until the browser has been read, so the first paint is a skeleton and never "nothing yet". */
  readonly state: T | null;
  readonly update: (change: (current: T) => T) => void;
}

function useDeviceRecord<T>(
  key: string,
  parse: (raw: string | null) => T,
  isValid: (state: T) => boolean,
  sample: T | null,
): DeviceRecord<T> {
  const [sampleState, setSampleState] = useState<T | null>(sample);
  const hydrated = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  const raw = useSyncExternalStore(subscribe, () => read(key), serverSnapshot);
  const stored = useMemo(() => parse(raw), [parse, raw]);

  const update = useCallback(
    (change: (current: T) => T) => {
      if (sample) {
        setSampleState((current) => {
          const next = change(current ?? sample);
          return isValid(next) ? next : current;
        });
        return;
      }
      const next = change(parse(read(key)));
      // An edit that would not read back is dropped rather than saved, so the record stays readable.
      if (isValid(next)) write(key, JSON.stringify(next));
    },
    [isValid, key, parse, sample],
  );

  if (sample) return { state: sampleState ?? sample, update };
  return { state: hydrated ? stored : null, update };
}

export function useTermTrackerStore(sample: TermTrackerState | null): DeviceRecord<TermTrackerState> {
  return useDeviceRecord(TEACHING_TERM_TRACKER_STORAGE_KEY, parseTermTracker, isValidTermTracker, sample);
}

export function useExamPrepStore(sample: ExamPrepState | null): DeviceRecord<ExamPrepState> {
  return useDeviceRecord(TEACHING_EXAM_PREP_STORAGE_KEY, parseExamPrep, isValidExamPrep, sample);
}
