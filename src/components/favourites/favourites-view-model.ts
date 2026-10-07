import type { LucideIcon } from "lucide-react";

import type { AppModeId } from "@/lib/app-modes";
import type { FavouriteContentType } from "@/lib/favourites-client-contract";

/**
 * Pure logic behind the Favourites page: what is in the list, how it is grouped,
 * what Continue and the My Day pins show, and the one-line summary under the title.
 * Kept free of React so every ordering rule can be pinned by a plain unit test.
 */

export type FavouriteType =
  | "Medication"
  | "Document"
  | "Table"
  | "Saved search"
  | "Source"
  | "Service"
  | "Form"
  | "Differential"
  | "Therapy"
  | "Work page";

export type FavouriteItem = {
  id: string;
  title: string;
  description: string;
  type: FavouriteType;
  tabId: string;
  /** Display name of the set the item lives in, or `Unsorted`. */
  set: string;
  evidence: string;
  /** Human label for when it was last opened, for example "Today 08:44", or "Saved". */
  lastUsed: string;
  /** Epoch ms of the last open, or null when it has never been opened. */
  openedAt: number | null;
  action: string;
  href: string;
  icon: LucideIcon;
  pinned?: boolean;
  /** Epoch ms the item was pinned to My Day, used to keep tiles in pin order. */
  pinnedAt?: number | null;
  contentType?: FavouriteContentType;
  contentKey?: string;
  setId?: string | null;
  sortOrder?: number;
  /** A demo-mode fixture, not something this clinician saved. Shown with an "Example" tag. */
  example?: boolean;
  /** A short name for a shelf tile, when the title is long ("Month" for "Roster"). */
  shortTitle?: string;
  /** Set on a saved work page: its key in the device store (`work-page-stars.ts`). */
  workKey?: string;
  /** The work area a saved work page belongs to, shown in place of a type. */
  areaName?: string;
  /** The palette its icon wears: the work area's colour for a work page. */
  identity?: AppModeId;
  /** Epoch ms it was saved, used to order never-opened items. */
  savedAt?: number;
};

export type FavouritesView = "recent" | "az" | "type" | "order";

export type FavouriteGroup = {
  id: string;
  /** Empty for an ungrouped list. */
  label: string;
  items: FavouriteItem[];
};

export type FavouriteSetChip = {
  name: string;
  count: number;
};

export const UNSORTED_SET_NAME = "Unsorted";
/** How many favourites can be pinned to My Day at once, clinical and work pages together. */
export const QUICK_LAUNCH_LIMIT = 4;

const DAY_MS = 24 * 60 * 60 * 1000;
const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const typeOrder: readonly FavouriteType[] = [
  "Medication",
  "Service",
  "Form",
  "Differential",
  "Therapy",
  "Document",
  "Table",
  "Source",
  "Saved search",
  "Work page",
];

const typeGroupLabel: Record<FavouriteType, string> = {
  Medication: "Medications",
  Document: "Documents",
  Table: "Tables",
  "Saved search": "Saved searches",
  Source: "Sources",
  Service: "Services",
  Form: "Forms",
  Differential: "Differentials",
  Therapy: "Therapies",
  "Work page": "Work pages",
};

export function isSourceBacked(item: FavouriteItem): boolean {
  return Boolean(item.evidence && item.evidence !== "Run" && item.evidence !== "Saved query");
}

export function matchesFavouriteSearch(item: FavouriteItem, searchTerm: string): boolean {
  const term = searchTerm.trim().toLowerCase();
  if (!term) return true;
  return [item.title, item.description, item.type, item.set, item.evidence].some((field) =>
    field.toLowerCase().includes(term),
  );
}

function byTitle(first: FavouriteItem, second: FavouriteItem) {
  return first.title.localeCompare(second.title);
}

function byMostRecent(first: FavouriteItem, second: FavouriteItem) {
  return (second.openedAt ?? 0) - (first.openedAt ?? 0) || byTitle(first, second);
}

/**
 * The set chips, in the clinician's own set order, followed by Unsorted.
 * Only sets that hold something are shown: an empty set is still offered by the
 * Move to set picker, but a chip that filters to nothing is a dead end.
 */
export function buildSetChips(items: readonly FavouriteItem[], orderedSetNames: readonly string[]): FavouriteSetChip[] {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item.set, (counts.get(item.set) ?? 0) + 1);
  // Deduplicated: a demo preset and an account set can share a fixed name.
  const names = [...new Set(orderedSetNames.filter((name) => name !== UNSORTED_SET_NAME))];
  for (const item of items) {
    if (item.set !== UNSORTED_SET_NAME && !names.includes(item.set)) names.push(item.set);
  }
  const chips = names.flatMap((name) => {
    const count = counts.get(name) ?? 0;
    return count > 0 ? [{ name, count }] : [];
  });
  const unsorted = counts.get(UNSORTED_SET_NAME) ?? 0;
  return unsorted > 0 ? [...chips, { name: UNSORTED_SET_NAME, count: unsorted }] : chips;
}

export function sortForView(items: readonly FavouriteItem[], view: FavouritesView): FavouriteItem[] {
  const sorted = [...items];
  if (view === "recent") return sorted.sort(byMostRecent);
  if (view === "order") {
    return sorted.sort((first, second) => (first.sortOrder ?? 0) - (second.sortOrder ?? 0) || byTitle(first, second));
  }
  if (view === "type") {
    return sorted.sort(
      (first, second) => typeOrder.indexOf(first.type) - typeOrder.indexOf(second.type) || byTitle(first, second),
    );
  }
  return sorted.sort(byTitle);
}

function startOfDay(timestamp: number) {
  const date = new Date(timestamp);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** Whole calendar days between the open and now, in local time. */
export function daysAgo(openedAt: number, now: number): number {
  return Math.round((startOfDay(now) - startOfDay(openedAt)) / DAY_MS);
}

function recentBucket(item: FavouriteItem, now: number): { id: string; label: string } {
  if (item.openedAt === null) return { id: "never", label: "Not opened yet" };
  const days = daysAgo(item.openedAt, now);
  if (days <= 0) return { id: "today", label: "Today" };
  if (days === 1) return { id: "yesterday", label: "Yesterday" };
  if (days <= 6) return { id: "week", label: "Earlier this week" };
  return { id: "older", label: "Older" };
}

export function groupForView(items: readonly FavouriteItem[], view: FavouritesView, now: number): FavouriteGroup[] {
  const sorted = sortForView(items, view);
  if (view === "az" || view === "order") return sorted.length ? [{ id: "all", label: "", items: sorted }] : [];

  const groups: FavouriteGroup[] = [];
  for (const item of sorted) {
    const key =
      view === "recent" ? recentBucket(item, now) : { id: `type-${item.type}`, label: typeGroupLabel[item.type] };
    const current = groups.at(-1);
    if (current && current.id === key.id) current.items.push(item);
    else groups.push({ id: key.id, label: key.label, items: [item] });
  }
  if (view === "recent") {
    // byMostRecent already puts never-opened items last; keep them alphabetical.
    const never = groups.find((group) => group.id === "never");
    if (never) never.items.sort(byTitle);
  }
  return groups;
}

export function pickContinueItem(items: readonly FavouriteItem[]): FavouriteItem | null {
  const opened = items.filter((item) => item.openedAt !== null);
  return opened.length ? ([...opened].sort(byMostRecent)[0] ?? null) : null;
}

export function quickLaunchItems(items: readonly FavouriteItem[]): FavouriteItem[] {
  return items
    .filter((item) => item.pinned)
    .sort(
      (first, second) =>
        (first.pinnedAt ?? Number.MAX_SAFE_INTEGER) - (second.pinnedAt ?? Number.MAX_SAFE_INTEGER) ||
        byTitle(first, second),
    )
    .slice(0, QUICK_LAUNCH_LIMIT);
}

export function quickLaunchHasRoom(items: readonly FavouriteItem[]): boolean {
  return items.filter((item) => item.pinned).length < QUICK_LAUNCH_LIMIT;
}

/** The single summary line under the page title, for example "11 saved · 2 pinned". */
export function favouritesSummary({ itemCount, pinnedCount }: { itemCount: number; pinnedCount: number }): string {
  const parts = [`${itemCount} saved`];
  if (pinnedCount > 0) parts.push(`${pinnedCount} pinned`);
  return parts.join(" · ");
}

function clock(timestamp: number) {
  const date = new Date(timestamp);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/** Right-hand time in the Recent view: a clock time for today and yesterday, a weekday this week, else a date. */
export function recentTimeLabel(openedAt: number | null, now: number): string {
  if (openedAt === null) return "";
  const days = daysAgo(openedAt, now);
  if (days <= 1) return clock(openedAt);
  const date = new Date(openedAt);
  if (days <= 6) return dayNames[date.getDay()] ?? "";
  return `${date.getDate()} ${monthNames[date.getMonth()]}`;
}

/** Continue card wording, for example "today at 08:44" or "on Mon". */
export function continueWhenLabel(openedAt: number, now: number): string {
  const days = daysAgo(openedAt, now);
  if (days <= 0) return `today at ${clock(openedAt)}`;
  if (days === 1) return `yesterday at ${clock(openedAt)}`;
  const date = new Date(openedAt);
  if (days <= 6) return `on ${dayNames[date.getDay()]}`;
  return `on ${date.getDate()} ${monthNames[date.getMonth()]}`;
}

/**
 * Demo fixtures carry labels such as "Today 08:44" instead of timestamps. Turn
 * them into a real time relative to now so they sort and group like saved items.
 */
export function demoOpenedAt(label: string | undefined, now: number): number | null {
  if (!label) return null;
  const match = label.trim().match(/^(\w+)\s+(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const [, day = "", hours = "0", minutes = "0"] = match;
  const base = new Date(now);
  let offset: number;
  if (day.toLowerCase() === "today") offset = 0;
  else if (day.toLowerCase() === "yesterday") offset = 1;
  else {
    const weekday = dayNames.findIndex((name) => name.toLowerCase() === day.toLowerCase());
    if (weekday < 0) return null;
    // The most recent such weekday before today: "Mon" read on a Monday means last Monday.
    offset = (base.getDay() - weekday + 7) % 7 || 7;
  }
  return new Date(
    base.getFullYear(),
    base.getMonth(),
    base.getDate() - offset,
    Number(hours),
    Number(minutes),
  ).getTime();
}

/**
 * Where a dragged row lands: the number of other rows whose centre sits above
 * the dragged row's current centre. `centers` are the rows' resting centres.
 */
export function dragTargetIndex(centers: readonly number[], fromIndex: number, draggedCenter: number): number {
  let target = 0;
  centers.forEach((center, index) => {
    if (index !== fromIndex && center < draggedCenter) target += 1;
  });
  return target;
}

/** A copy of `items` with the entry at `from` moved to `to`. */
export function moveEntry<T>(items: readonly T[], from: number, to: number): T[] {
  const next = [...items];
  const [moved] = next.splice(from, 1);
  if (moved === undefined) return next;
  next.splice(to, 0, moved);
  return next;
}

/** How many tiles the Favourites shelf shows, on My Day and on the Favourites page. */
export const SHELF_LIMIT = 8;

/**
 * The Favourites shelf: pinned items first, in the order they were pinned,
 * then whatever was opened most recently, then the newest saved. One rule for
 * both places it is drawn, so My Day and Favourites always agree.
 */
export function shelfItems(items: readonly FavouriteItem[], limit: number = SHELF_LIMIT): FavouriteItem[] {
  const pinned = items
    .filter((item) => item.pinned)
    .sort(
      (first, second) =>
        (first.pinnedAt ?? Number.MAX_SAFE_INTEGER) - (second.pinnedAt ?? Number.MAX_SAFE_INTEGER) ||
        byTitle(first, second),
    );
  const rest = items
    .filter((item) => !item.pinned)
    .sort(
      (first, second) =>
        (second.openedAt ?? 0) - (first.openedAt ?? 0) ||
        (second.savedAt ?? 0) - (first.savedAt ?? 0) ||
        byTitle(first, second),
    );
  return [...pinned, ...rest].slice(0, Math.max(0, limit));
}
