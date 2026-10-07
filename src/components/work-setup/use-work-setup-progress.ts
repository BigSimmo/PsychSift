"use client";

import { useCallback, useSyncExternalStore } from "react";

import { subscribeAccountTransition, WORK_SETUP_PROGRESS_STORAGE_KEY } from "@/lib/account-scoped-browser-state";
import {
  INITIAL_WORK_SETUP_PROGRESS,
  parseWorkSetupProgress,
  serialiseWorkSetupProgress,
  type WorkSetupProgress,
} from "@/lib/work-setup/progress";

/**
 * The walkthrough's progress on this device. One store for the walkthrough page,
 * My Day's prompt card and the help centre, so finishing a step anywhere shows
 * everywhere at once. A browser that refuses storage still runs the walkthrough
 * for this visit; it just starts again next time.
 */

let cachedRaw: string | null | undefined;
let cached: WorkSetupProgress = INITIAL_WORK_SETUP_PROGRESS;
/** Kept in memory when storage refuses a write, so this visit still moves forward. */
let memoryOnly: WorkSetupProgress | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

function readRaw(): string | null {
  try {
    return window.localStorage.getItem(WORK_SETUP_PROGRESS_STORAGE_KEY);
  } catch {
    return null;
  }
}

function getSnapshot(): WorkSetupProgress {
  if (memoryOnly) return memoryOnly;
  const raw = readRaw();
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cached = parseWorkSetupProgress(raw);
  }
  return cached;
}

function getServerSnapshot(): WorkSetupProgress {
  return INITIAL_WORK_SETUP_PROGRESS;
}

let wired = false;
function wire() {
  if (wired || typeof window === "undefined") return;
  wired = true;
  window.addEventListener("storage", (event) => {
    if (event.key === null || event.key === WORK_SETUP_PROGRESS_STORAGE_KEY) notify();
  });
  // The key is already removed when this fires; drop what this tab remembered.
  subscribeAccountTransition(() => {
    memoryOnly = null;
    cachedRaw = undefined;
    notify();
  });
}

function subscribe(listener: () => void) {
  wire();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function writeWorkSetupProgress(next: WorkSetupProgress): void {
  try {
    window.localStorage.setItem(WORK_SETUP_PROGRESS_STORAGE_KEY, serialiseWorkSetupProgress(next));
    memoryOnly = null;
  } catch {
    memoryOnly = next;
  }
  notify();
}

export function useWorkSetupProgress(): {
  readonly progress: WorkSetupProgress;
  /** Apply one of the pure transitions in `@/lib/work-setup/progress`. */
  readonly update: (change: (current: WorkSetupProgress) => WorkSetupProgress) => void;
} {
  const progress = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const update = useCallback((change: (current: WorkSetupProgress) => WorkSetupProgress) => {
    writeWorkSetupProgress(change(getSnapshot()));
  }, []);
  return { progress, update };
}
