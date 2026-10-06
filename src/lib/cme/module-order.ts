"use client";

import { useCallback, useMemo } from "react";

import { createBrowserStore } from "@/lib/client-store-factory";
import { cmeModuleOrderChangedEvent, cmeModuleOrderStorageKey } from "@/lib/cme/module-order-keys";

/**
 * Every module the CME dashboard can show below its three always-shown rows
 * — the total-hours figure with its pace mark, the pace sentence, and the
 * computed next action — in the product default order.
 *
 * A module is identified by a stable id, never a position, so a stored
 * preference from before a module was added or removed degrades to "insert
 * it, or drop it" rather than to a scrambled dashboard.
 */
export const cmeDashboardModuleIds = [
  "requirements",
  "routines-due",
  "audited-today",
  "year-dates",
  "provenance",
] as const;

export type CmeDashboardModuleId = (typeof cmeDashboardModuleIds)[number];

export const cmeDashboardModuleLabels: Record<CmeDashboardModuleId, string> = {
  requirements: "What's left",
  "routines-due": "Routines due",
  "audited-today": "Logged today",
  "year-dates": "Year dates",
  provenance: "Where these targets came from",
};

const allModuleIds = new Set<CmeDashboardModuleId>(cmeDashboardModuleIds);

/** Every module, visible, in the product default order — used whenever there is no stored preference to read. */
export const defaultCmeModuleOrder: readonly CmeDashboardModuleId[] = [...cmeDashboardModuleIds];
const defaultSnapshot = JSON.stringify(defaultCmeModuleOrder);

function normalizeModuleOrder(value: unknown): CmeDashboardModuleId[] | null {
  if (!Array.isArray(value)) return null;

  const seen = new Set<CmeDashboardModuleId>();
  const normalized: CmeDashboardModuleId[] = [];
  for (const candidate of value) {
    if (typeof candidate !== "string" || !allModuleIds.has(candidate as CmeDashboardModuleId)) continue;
    const moduleId = candidate as CmeDashboardModuleId;
    if (seen.has(moduleId)) continue;
    seen.add(moduleId);
    normalized.push(moduleId);
  }
  return normalized;
}

/**
 * Parse and validate a stored module order. Missing or malformed values fall
 * back to every module, in the product default order — never to an empty
 * dashboard. An intentional empty list (every module hidden) is a valid,
 * distinct state and is returned as-is.
 */
export function readCmeModuleOrder(storedValue: string | null | undefined): CmeDashboardModuleId[] {
  if (storedValue === null || storedValue === undefined) return [...defaultCmeModuleOrder];
  try {
    return normalizeModuleOrder(JSON.parse(storedValue)) ?? [...defaultCmeModuleOrder];
  } catch {
    return [...defaultCmeModuleOrder];
  }
}

function serializeModuleOrder(moduleIds: readonly CmeDashboardModuleId[]) {
  return JSON.stringify(normalizeModuleOrder(moduleIds) ?? [...defaultCmeModuleOrder]);
}

/**
 * Pure swap used by `moveModule`, exported so the reorder arithmetic is
 * tested without a DOM. A no-op (the same array, copied) at either end, or
 * for an id that is not currently visible — there is nothing to move it past.
 */
export function moveModuleId(
  order: readonly CmeDashboardModuleId[],
  moduleId: CmeDashboardModuleId,
  direction: -1 | 1,
): CmeDashboardModuleId[] {
  const currentIndex = order.indexOf(moduleId);
  const nextIndex = adjacentSameSlotIndex(order, moduleId, direction);
  if (currentIndex < 0 || nextIndex < 0) return [...order];
  const next = [...order];
  const current = next[currentIndex];
  const adjacent = next[nextIndex];
  if (!current || !adjacent) return [...order];
  next[currentIndex] = adjacent;
  next[nextIndex] = current;
  return next;
}

/**
 * The Today screen places each module in a fixed section, so a saved order only
 * changes what the owner sees among modules in the same section. A module can
 * therefore only be moved past another module in its own section; a move that
 * would cross a section boundary would save but show no change.
 */
export const cmeDashboardModuleSlots: Record<CmeDashboardModuleId, "needs-you" | "coming-up" | "at-a-glance"> = {
  requirements: "needs-you",
  "routines-due": "coming-up",
  "audited-today": "at-a-glance",
  "year-dates": "at-a-glance",
  provenance: "at-a-glance",
};

/** Index of the nearest module in `direction` that shares `moduleId`'s section, or -1 when there is none. */
function adjacentSameSlotIndex(
  order: readonly CmeDashboardModuleId[],
  moduleId: CmeDashboardModuleId,
  direction: -1 | 1,
) {
  const currentIndex = order.indexOf(moduleId);
  if (currentIndex < 0) return -1;
  for (let index = currentIndex + direction; index >= 0 && index < order.length; index += direction) {
    const candidate = order[index];
    if (candidate && cmeDashboardModuleSlots[candidate] === cmeDashboardModuleSlots[moduleId]) return index;
  }
  return -1;
}

/** Whether a move would change what Today shows — used to disable a control rather than let it no-op silently. */
export function canMoveModule(
  order: readonly CmeDashboardModuleId[],
  moduleId: CmeDashboardModuleId,
  direction: -1 | 1,
): boolean {
  return adjacentSameSlotIndex(order, moduleId, direction) >= 0;
}

/**
 * Pure add/remove used by `toggleModule`. A hidden module is simply absent
 * from the order; showing it again appends it at the end, never re-inserts it
 * at its old position, which the order itself no longer remembers.
 */
export function toggleModuleId(
  order: readonly CmeDashboardModuleId[],
  moduleId: CmeDashboardModuleId,
): CmeDashboardModuleId[] {
  if (!allModuleIds.has(moduleId)) return [...order];
  return order.includes(moduleId) ? order.filter((id) => id !== moduleId) : [...order, moduleId];
}

// A serialized snapshot gives useSyncExternalStore a stable primitive while
// preserving an in-session preference when browser storage is unavailable.
let inMemorySnapshot: string | null = null;

function getSnapshot() {
  if (inMemorySnapshot !== null) return inMemorySnapshot;
  try {
    return serializeModuleOrder(readCmeModuleOrder(window.localStorage.getItem(cmeModuleOrderStorageKey)));
  } catch {
    return defaultSnapshot;
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(cmeModuleOrderChangedEvent, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(cmeModuleOrderChangedEvent, onChange);
  };
}

const useCmeModuleOrderStore = createBrowserStore(subscribe, getSnapshot, defaultSnapshot);

/**
 * The owner's dashboard layout: which modules show, and in what order.
 * `moduleIds` already excludes hidden modules — the dashboard renders exactly
 * this list, in this order, and nothing else.
 *
 * Mirrors `src/components/clinical-dashboard/use-sidebar-pins.ts`: a
 * serialized-string snapshot behind `useSyncExternalStore`, the native
 * `storage` event plus a same-tab custom event so every open tab agrees, and
 * a graceful in-memory fallback when `localStorage.setItem` throws (private
 * browsing, a full quota) rather than losing the change entirely.
 */
export function useCmeModuleOrder() {
  const snapshot = useCmeModuleOrderStore();
  const moduleIds = useMemo(() => readCmeModuleOrder(snapshot), [snapshot]);

  const setModuleIds = useCallback(
    (next: readonly CmeDashboardModuleId[] | ((current: CmeDashboardModuleId[]) => CmeDashboardModuleId[])) => {
      const current = readCmeModuleOrder(getSnapshot());
      const resolved = typeof next === "function" ? next(current) : [...next];
      const nextSnapshot = serializeModuleOrder(resolved);

      try {
        window.localStorage.setItem(cmeModuleOrderStorageKey, nextSnapshot);
        inMemorySnapshot = null;
      } catch {
        inMemorySnapshot = nextSnapshot;
      }
      window.dispatchEvent(new Event(cmeModuleOrderChangedEvent));
    },
    [],
  );

  const toggleModule = useCallback(
    (moduleId: CmeDashboardModuleId) => setModuleIds((current) => toggleModuleId(current, moduleId)),
    [setModuleIds],
  );

  /** `direction` is `-1` (up) or `1` (down). Always offered alongside a drag affordance, never in its place. */
  const moveModule = useCallback(
    (moduleId: CmeDashboardModuleId, direction: -1 | 1) =>
      setModuleIds((current) => moveModuleId(current, moduleId, direction)),
    [setModuleIds],
  );

  return { moduleIds, toggleModule, moveModule };
}
