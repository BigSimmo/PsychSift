"use client";

import { useCallback, useMemo } from "react";

import { createBrowserStore } from "@/lib/client-store-factory";
import type { AppModeId } from "@/lib/app-modes";

export const SIDEBAR_PINS_STORAGE_KEY = "clinical-kb-sidebar-pins";

export const defaultSidebarPinnedModeIds = [
  "answer",
  "documents",
  "services",
  "prescribing",
  "factsheets",
  "tools",
] as const satisfies readonly AppModeId[];

export const pinnableSidebarModeIds = [
  ...defaultSidebarPinnedModeIds,
  "forms",
  "differentials",
  "dsm",
  "specifiers",
  "formulation",
  "therapy-compass",
] as const satisfies readonly AppModeId[];

const changeEvent = "clinical-kb-sidebar-pins-change";
const defaultSnapshot = JSON.stringify(defaultSidebarPinnedModeIds);
const allowedModeIds = new Set<AppModeId>(pinnableSidebarModeIds);

function normalizePinnedModeIds(value: unknown): AppModeId[] | null {
  if (!Array.isArray(value)) return null;

  const seen = new Set<AppModeId>();
  const normalized: AppModeId[] = [];
  for (const candidate of value) {
    if (typeof candidate !== "string" || !allowedModeIds.has(candidate as AppModeId)) continue;
    const modeId = candidate as AppModeId;
    if (seen.has(modeId)) continue;
    seen.add(modeId);
    normalized.push(modeId);
  }
  return normalized;
}

/** Parse and validate a stored pin list. Missing or malformed values use the product defaults. */
export function readSidebarPinnedModes(storedValue: string | null | undefined): AppModeId[] {
  if (storedValue === null || storedValue === undefined) return [...defaultSidebarPinnedModeIds];
  try {
    return normalizePinnedModeIds(JSON.parse(storedValue)) ?? [...defaultSidebarPinnedModeIds];
  } catch {
    return [...defaultSidebarPinnedModeIds];
  }
}

function serializePinnedModeIds(modeIds: readonly AppModeId[]) {
  return JSON.stringify(normalizePinnedModeIds(modeIds) ?? [...defaultSidebarPinnedModeIds]);
}

// A serialized snapshot gives useSyncExternalStore a stable primitive while
// preserving an in-session preference when browser storage is unavailable.
let inMemorySnapshot: string | null = null;

function getSnapshot() {
  if (inMemorySnapshot !== null) return inMemorySnapshot;
  try {
    return serializePinnedModeIds(readSidebarPinnedModes(window.localStorage.getItem(SIDEBAR_PINS_STORAGE_KEY)));
  } catch {
    return defaultSnapshot;
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(changeEvent, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(changeEvent, onChange);
  };
}

const useSidebarPinsStore = createBrowserStore(subscribe, getSnapshot, defaultSnapshot);

export function useSidebarPins() {
  const snapshot = useSidebarPinsStore();
  const pinnedModeIds = useMemo(() => readSidebarPinnedModes(snapshot), [snapshot]);

  const setPinnedModeIds = useCallback((next: readonly AppModeId[] | ((current: AppModeId[]) => AppModeId[])) => {
    const current = readSidebarPinnedModes(getSnapshot());
    const resolved = typeof next === "function" ? next(current) : [...next];
    const nextSnapshot = serializePinnedModeIds(resolved);

    try {
      window.localStorage.setItem(SIDEBAR_PINS_STORAGE_KEY, nextSnapshot);
      inMemorySnapshot = null;
    } catch {
      inMemorySnapshot = nextSnapshot;
    }
    window.dispatchEvent(new Event(changeEvent));
  }, []);

  const togglePinnedMode = useCallback(
    (modeId: AppModeId) => {
      if (!allowedModeIds.has(modeId)) return;
      setPinnedModeIds((current) =>
        current.includes(modeId) ? current.filter((id) => id !== modeId) : [...current, modeId],
      );
    },
    [setPinnedModeIds],
  );

  const movePinnedMode = useCallback(
    (modeId: AppModeId, direction: -1 | 1) => {
      setPinnedModeIds((current) => {
        const currentIndex = current.indexOf(modeId);
        const nextIndex = currentIndex + direction;
        if (currentIndex < 0 || nextIndex < 0 || nextIndex >= current.length) return current;
        const next = [...current];
        const currentMode = next[currentIndex];
        const adjacentMode = next[nextIndex];
        if (!currentMode || !adjacentMode) return current;
        next[currentIndex] = adjacentMode;
        next[nextIndex] = currentMode;
        return next;
      });
    },
    [setPinnedModeIds],
  );

  return { pinnedModeIds, togglePinnedMode, movePinnedMode };
}
