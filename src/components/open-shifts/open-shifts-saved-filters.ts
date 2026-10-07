import { DEFAULT_FILTERS, type BrowseFilters } from "@/lib/open-shifts/browse";
import type { TimeOfDay } from "@/lib/open-shifts/model";

/**
 * Browse remembers your filter choices on this device (spec B2, work-mode
 * redesign 6 Oct 2026: "Reset goes back to your defaults"). Only three
 * device-neutral choices are kept: No clashes, lower levels and start times.
 * Never sites (a saved site can vanish and would quietly hide every shift),
 * and never anything from the roster or the list. Storage can be missing or
 * blocked, so every read and write is guarded and Browse works without it.
 */

const KEY = "psychsift.open-shifts.filters.v1";
const TIMES: readonly TimeOfDay[] = ["day", "evening", "night"];

type Saved = Pick<BrowseFilters, "hideClashes" | "includeLowerLevels" | "starts">;

export function readSavedFilters(): BrowseFilters | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<Saved> | null;
    if (!value || typeof value !== "object") return null;
    return {
      ...DEFAULT_FILTERS,
      hideClashes: typeof value.hideClashes === "boolean" ? value.hideClashes : DEFAULT_FILTERS.hideClashes,
      includeLowerLevels:
        typeof value.includeLowerLevels === "boolean" ? value.includeLowerLevels : DEFAULT_FILTERS.includeLowerLevels,
      starts: Array.isArray(value.starts)
        ? TIMES.filter((time) => (value.starts as unknown[]).includes(time))
        : DEFAULT_FILTERS.starts,
    };
  } catch {
    return null;
  }
}

export function saveFilters(filters: BrowseFilters): void {
  try {
    const saved: Saved = {
      hideClashes: filters.hideClashes,
      includeLowerLevels: filters.includeLowerLevels,
      starts: filters.starts,
    };
    window.localStorage.setItem(KEY, JSON.stringify(saved));
  } catch {
    // Storage is blocked or full: the choice still applies for this visit.
  }
}

export function clearSavedFilters(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // Nothing to clear when storage is unavailable.
  }
}
