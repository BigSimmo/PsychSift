"use client";

import { useEffect, useSyncExternalStore } from "react";

/*
 * Whether a Differentials list currently has diagnoses ticked for comparison.
 *
 * The phone dock reserve inflates on the shell's CLAIM of the compare addon
 * slot, not on the tray's render, so the claim must follow the selection
 * (docs/search-chrome-behaviour.md, "An addon that can be empty must gate its
 * claim on being non-empty"). Therapy reads its set from the URL; Differentials
 * keeps its ticks in component state, so the list publishes the count here and
 * the shell reads it.
 */

let selectedCount = 0;
const listeners = new Set<() => void>();

function publish(count: number) {
  if (count === selectedCount) return;
  selectedCount = count;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The list side: report how many diagnoses are ticked; clears on unmount. */
export function usePublishDifferentialsCompareCount(count: number): void {
  useEffect(() => {
    publish(count);
  }, [count]);
  useEffect(() => () => publish(0), []);
}

/** The shell side: true once at least one diagnosis is ticked. */
export function useDifferentialsCompareHasSelection(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => selectedCount > 0,
    () => false,
  );
}
