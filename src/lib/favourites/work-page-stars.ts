"use client";

import { useSyncExternalStore } from "react";

import { subscribeAccountTransition, WORK_PAGE_FAVOURITES_STORAGE_KEY } from "@/lib/account-scoped-browser-state";
import { WORK_AREAS, workAreaItems, type WorkArea, type WorkAreaId, type WorkFrameItem } from "@/lib/work-frame/areas";
import { announceWorkSyncChange } from "@/lib/work-sync/sections";

/**
 * Work pages saved to Favourites (owner request 7 Oct 2026: one saved list,
 * shown on the Favourites page and on My Day).
 *
 * Clinical favourites (services, forms, differentials, therapies) stay on the
 * account. Work pages are read and written on this device under one
 * account-scoped key that the auth provider clears at sign-out
 * (`account-scoped-browser-state.ts`), and `@/lib/work-sync` copies that key to
 * the account and back, so the list follows the doctor to every device (owner
 * decision 7 Oct 2026, no migration).
 *
 * An entry stores only ids and times. The title, link and icon come from the
 * work frame's own navigation (`WORK_AREAS`) every time they are read, so a
 * renamed page shows its new name and a page that no longer exists, or that
 * only links somewhere by action, simply drops out instead of dead-ending.
 */

export type WorkPageStar = {
  readonly areaId: WorkAreaId;
  readonly itemId: string;
  /** Epoch ms it was added. */
  readonly starredAt: number;
  /** Epoch ms it was pinned to My Day, or null. */
  readonly pinnedAt: number | null;
  /** Epoch ms it was last opened from Favourites, or null. */
  readonly openedAt: number | null;
};

export type ResolvedWorkPageStar = WorkPageStar & {
  readonly key: string;
  readonly area: WorkArea;
  readonly item: WorkFrameItem & { readonly href: string };
};

/** Room for every work page in every area, with headroom. Older entries fall off first. */
export const MAX_WORK_PAGE_STARS = 60;

const EMPTY: readonly WorkPageStar[] = Object.freeze([]);
let cache: readonly WorkPageStar[] | null = null;
const listeners = new Set<() => void>();

export function workPageStarKey(areaId: WorkAreaId, itemId: string): string {
  return `${areaId}:${itemId}`;
}

function isAreaId(value: unknown): value is WorkAreaId {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(WORK_AREAS, value);
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function parse(raw: string | null): readonly WorkPageStar[] {
  if (!raw) return EMPTY;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return EMPTY;
    const seen = new Set<string>();
    const out: WorkPageStar[] = [];
    for (const entry of parsed) {
      if (!entry || typeof entry !== "object") continue;
      const candidate = entry as Record<string, unknown>;
      const starredAt = finiteOrNull(candidate.starredAt);
      if (!isAreaId(candidate.areaId) || typeof candidate.itemId !== "string" || starredAt === null) continue;
      const itemId = candidate.itemId.slice(0, 80);
      const key = workPageStarKey(candidate.areaId, itemId);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        areaId: candidate.areaId,
        itemId,
        starredAt,
        pinnedAt: finiteOrNull(candidate.pinnedAt),
        openedAt: finiteOrNull(candidate.openedAt),
      });
      if (out.length >= MAX_WORK_PAGE_STARS) break;
    }
    return out;
  } catch {
    return EMPTY;
  }
}

function read(): readonly WorkPageStar[] {
  if (typeof window === "undefined") return EMPTY;
  // The account copy can rewrite the key at any time; the listener is what drops this cache then.
  attachStorageListener();
  if (cache) return cache;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(WORK_PAGE_FAVOURITES_STORAGE_KEY);
  } catch {
    // Storage blocked (private window, policy): nothing is saved, and that is honest.
  }
  cache = parse(raw);
  return cache;
}

function notify() {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // One faulty subscriber must not stop the others hearing the change.
    }
  }
}

/** Returns false when the browser refused the write, so the caller can say it did not save. */
function write(next: readonly WorkPageStar[]): boolean {
  const trimmed = next.slice(0, MAX_WORK_PAGE_STARS);
  cache = trimmed;
  let saved = true;
  try {
    window.localStorage.setItem(WORK_PAGE_FAVOURITES_STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    saved = false;
  }
  notify();
  if (saved) announceWorkSyncChange(WORK_PAGE_FAVOURITES_STORAGE_KEY);
  return saved;
}

let storageListenerAttached = false;
function attachStorageListener() {
  if (storageListenerAttached || typeof window === "undefined") return;
  storageListenerAttached = true;
  // Another tab changed the list: forget the cache so this tab shows the same thing.
  window.addEventListener("storage", (event) => {
    if (event.key === null || event.key === WORK_PAGE_FAVOURITES_STORAGE_KEY) {
      cache = null;
      notify();
    }
  });
}

// Sign-out, expiry or a different person: the key is already gone, drop what was remembered.
subscribeAccountTransition(() => {
  cache = null;
  notify();
});

export function subscribeWorkPageStars(listener: () => void): () => void {
  attachStorageListener();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function loadWorkPageStars(): readonly WorkPageStar[] {
  return read();
}

export function isWorkPageStarred(areaId: WorkAreaId, itemId: string): boolean {
  const key = workPageStarKey(areaId, itemId);
  return read().some((star) => workPageStarKey(star.areaId, star.itemId) === key);
}

/** Adds or removes a work page. Returns whether it is now saved, and whether the write stuck. */
export function toggleWorkPageStar(
  areaId: WorkAreaId,
  itemId: string,
  now: number = Date.now(),
): { starred: boolean; saved: boolean } {
  const key = workPageStarKey(areaId, itemId);
  const current = read();
  if (current.some((star) => workPageStarKey(star.areaId, star.itemId) === key)) {
    return {
      starred: false,
      saved: write(current.filter((star) => workPageStarKey(star.areaId, star.itemId) !== key)),
    };
  }
  return {
    starred: true,
    saved: write([{ areaId, itemId, starredAt: now, pinnedAt: null, openedAt: null }, ...current]),
  };
}

/** Puts back entries removed a moment ago (Undo), keeping their pins and times. */
export function restoreWorkPageStars(entries: readonly WorkPageStar[]): boolean {
  const current = read();
  const present = new Set(current.map((star) => workPageStarKey(star.areaId, star.itemId)));
  const missing = entries.filter((star) => !present.has(workPageStarKey(star.areaId, star.itemId)));
  return missing.length ? write([...missing, ...current]) : true;
}

export function removeWorkPageStars(keys: ReadonlySet<string>): readonly WorkPageStar[] {
  const current = read();
  const removed = current.filter((star) => keys.has(workPageStarKey(star.areaId, star.itemId)));
  if (removed.length) write(current.filter((star) => !keys.has(workPageStarKey(star.areaId, star.itemId))));
  return removed;
}

export function setWorkPageStarsPinned(keys: ReadonlySet<string>, pinned: boolean, now: number = Date.now()): boolean {
  const current = read();
  return write(
    current.map((star) =>
      keys.has(workPageStarKey(star.areaId, star.itemId)) ? { ...star, pinnedAt: pinned ? now : null } : star,
    ),
  );
}

export function recordWorkPageOpened(key: string, now: number = Date.now()): void {
  const current = read();
  if (!current.some((star) => workPageStarKey(star.areaId, star.itemId) === key)) return;
  write(current.map((star) => (workPageStarKey(star.areaId, star.itemId) === key ? { ...star, openedAt: now } : star)));
}

/**
 * Removes every saved work page from this device. Sign-out already does this
 * through `clearAccountScopedBrowserStorage` (the key is listed there); this is
 * for callers that clear on their own, such as a "clear this device" action.
 */
export function clearWorkPageStars(): void {
  cache = null;
  try {
    window.localStorage.removeItem(WORK_PAGE_FAVOURITES_STORAGE_KEY);
  } catch {
    // Storage blocked: there is nothing stored to remove.
  }
  notify();
}

/** Test seam: forget the cache and subscribers between tests. */
export function resetWorkPageStarsForTesting(): void {
  cache = null;
  listeners.clear();
}

/**
 * Joins each entry to the page it names. Only pages with a real link are kept:
 * an action-only item (a sheet) has nowhere to go from Favourites.
 * `routeVisible` (`useWorkModeRouteVisible`) hides a new-only page from a
 * reader on the classic work mode, where it 404s. The entry stays stored, so
 * it is back when the new work mode is.
 */
export function resolveWorkPageStars(
  stars: readonly WorkPageStar[],
  routeVisible: (href: string) => boolean = () => true,
): ResolvedWorkPageStar[] {
  const out: ResolvedWorkPageStar[] = [];
  for (const star of stars) {
    const area = WORK_AREAS[star.areaId];
    if (!area) continue;
    const item = workAreaItems(area).find((candidate) => candidate.id === star.itemId);
    if (!item?.href || !routeVisible(item.href)) continue;
    out.push({ ...star, key: workPageStarKey(star.areaId, star.itemId), area, item: { ...item, href: item.href } });
  }
  return out;
}

/**
 * Every work page that can be added, area by area, without duplicates.
 * `visible` (`useWorkFrameItemVisible`) drops pages this reader cannot use: a
 * closed gate, or a new-only page on the classic work mode.
 */
export function starrableWorkPages(
  visible: (item: WorkFrameItem) => boolean = () => true,
): { area: WorkArea; items: (WorkFrameItem & { href: string })[] }[] {
  return (Object.values(WORK_AREAS) as WorkArea[]).map((area) => {
    const seen = new Set<string>();
    const items: (WorkFrameItem & { href: string })[] = [];
    for (const item of workAreaItems(area)) {
      // Items that lead into another area are that area's pages; list them there.
      if (!item.href || item.leadsTo || seen.has(item.id) || !visible(item)) continue;
      // Favourites itself is where saved pages are listed; saving it would point at itself.
      if (item.href.split(/[?#]/)[0] === "/my-day/favourites") continue;
      seen.add(item.id);
      items.push({ ...item, href: item.href });
    }
    return { area, items };
  });
}

const getServerSnapshot = () => EMPTY;

/** The saved work pages, live. Empty on the server and until the device store is read. */
export function useWorkPageStars(): readonly WorkPageStar[] {
  return useSyncExternalStore(subscribeWorkPageStars, read, getServerSnapshot);
}
