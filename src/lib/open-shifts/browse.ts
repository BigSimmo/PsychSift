import { perthDateOf } from "@/lib/roster/shifts/perth-time";
import type { FatigueShift } from "@/lib/roster/fatigue-rules";

import {
  TIME_OF_DAY,
  inWindow,
  isBelowMyLevel,
  isBrowsable,
  timeOfDay,
  type OpenShiftListing,
  type TimeOfDay,
} from "./model";
import { isClash, rosterCheckFor, type RosterCheck } from "./roster-check";

/**
 * Browse: every count on the page comes from here, from the same rows, so the
 * quick bar, the "18 of 29" line, the calendar badges and the day list always
 * agree. Counts never include shifts outside the 14-day window, the reader's
 * own posts, or shifts they have already asked for.
 */

export type BrowseFilters = {
  /** Hide shifts that overlap the reader's roster. On by default. */
  readonly hideClashes: boolean;
  /** Site ids to show; empty means every site. A shift with no site always shows. */
  readonly siteIds: readonly string[];
  /** Show shifts posted for a lower level than the reader's own. Off by default. */
  readonly includeLowerLevels: boolean;
  /** Start bands to show; empty means any time. */
  readonly starts: readonly TimeOfDay[];
};

export const DEFAULT_FILTERS: BrowseFilters = {
  hideClashes: true,
  siteIds: [],
  includeLowerLevels: false,
  starts: [],
};

export type BrowseRow = { readonly listing: OpenShiftListing; readonly check: RosterCheck };

export type SiteChoice = {
  readonly id: string;
  readonly name: string;
  readonly teamName: string;
  readonly count: number;
};

export type BrowseSummary = {
  /** Open in the window, before any filter. */
  readonly total: number;
  /** After every filter. */
  readonly matching: readonly BrowseRow[];
  readonly hidden: { readonly clash: number; readonly level: number; readonly site: number; readonly time: number };
  /** Every open shift in the window (unfiltered), with its check: the hidden note's "Show". */
  readonly all: readonly BrowseRow[];
  readonly sites: readonly SiteChoice[];
  /** Counts for the Starts choices, after every other filter. */
  readonly startCounts: Readonly<Record<TimeOfDay, number>>;
  /** Matching shifts per Perth date. */
  readonly perDay: ReadonlyMap<string, number>;
  /** Dates with a matching urgent shift. */
  readonly urgentDays: ReadonlySet<string>;
  readonly lowerLevelCount: number;
};

function siteKey(listing: OpenShiftListing): string | null {
  return listing.siteId;
}

export function summariseBrowse(
  listings: readonly OpenShiftListing[],
  roster: readonly FatigueShift[] | null,
  filters: BrowseFilters,
  now: Date,
  rosterStatus: "loading" | "ready" | "error" = "ready",
): BrowseSummary {
  const today = perthDateOf(now);
  const all: BrowseRow[] = listings
    .filter((listing) => isBrowsable(listing, now) && inWindow(listing, today))
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt) || a.id.localeCompare(b.id))
    .map((listing) => ({
      listing,
      check: rosterCheckFor(
        { id: `open:${listing.id}`, startsAt: listing.startsAt, endsAt: listing.endsAt, kind: listing.kind },
        roster,
        rosterStatus,
        now,
      ),
    }));

  const passesClash = (row: BrowseRow) => !filters.hideClashes || !isClash(row.check);
  const passesLevel = (row: BrowseRow) => filters.includeLowerLevels || !isBelowMyLevel(row.listing);
  const passesSite = (row: BrowseRow) => {
    const key = siteKey(row.listing);
    return filters.siteIds.length === 0 || key === null || filters.siteIds.includes(key);
  };
  const passesTime = (row: BrowseRow) =>
    filters.starts.length === 0 || filters.starts.includes(timeOfDay(row.listing.startsAt));

  const matching = all.filter((row) => passesClash(row) && passesLevel(row) && passesSite(row) && passesTime(row));

  // Each hidden shift is counted once, under the first filter that hides it, so the reasons add up.
  const hidden = { clash: 0, level: 0, site: 0, time: 0 };
  for (const row of all) {
    if (!passesClash(row)) hidden.clash += 1;
    else if (!passesLevel(row)) hidden.level += 1;
    else if (!passesSite(row)) hidden.site += 1;
    else if (!passesTime(row)) hidden.time += 1;
  }

  const siteMap = new Map<string, SiteChoice>();
  for (const row of all.filter((item) => passesClash(item) && passesLevel(item) && passesTime(item))) {
    const key = siteKey(row.listing);
    if (key === null) continue;
    const existing = siteMap.get(key);
    siteMap.set(key, {
      id: key,
      name: row.listing.siteName ?? "Site not named",
      teamName: row.listing.teamName,
      count: (existing?.count ?? 0) + 1,
    });
  }
  // Sites with nothing open still appear when the reader has chosen them.
  for (const row of all) {
    const key = siteKey(row.listing);
    if (key !== null && !siteMap.has(key)) {
      siteMap.set(key, {
        id: key,
        name: row.listing.siteName ?? "Site not named",
        teamName: row.listing.teamName,
        count: 0,
      });
    }
  }

  const startCounts = Object.fromEntries(TIME_OF_DAY.map((band) => [band, 0])) as Record<TimeOfDay, number>;
  for (const row of all.filter((item) => passesClash(item) && passesLevel(item) && passesSite(item))) {
    startCounts[timeOfDay(row.listing.startsAt)] += 1;
  }

  const perDay = new Map<string, number>();
  const urgentDays = new Set<string>();
  for (const row of matching) {
    const date = perthDateOf(row.listing.startsAt);
    perDay.set(date, (perDay.get(date) ?? 0) + 1);
    if (row.listing.urgent) urgentDays.add(date);
  }

  return {
    total: all.length,
    matching,
    hidden,
    all,
    sites: [...siteMap.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    startCounts,
    perDay,
    urgentDays,
    lowerLevelCount: all.filter((row) => isBelowMyLevel(row.listing)).length,
  };
}

/** How many quick-bar filters differ from the defaults (for the "Filters 2" badge). */
export function activeFilterCount(filters: BrowseFilters): number {
  return (
    (filters.hideClashes === DEFAULT_FILTERS.hideClashes ? 0 : 1) +
    (filters.siteIds.length > 0 ? 1 : 0) +
    (filters.includeLowerLevels ? 1 : 0) +
    (filters.starts.length > 0 ? 1 : 0)
  );
}

/** The next date after `date` (within the window) that has a match, for the empty day. */
export function nextMatchingDate(summary: BrowseSummary, date: string): string | null {
  const later = [...summary.perDay.keys()].filter((day) => day > date).sort();
  return later[0] ?? null;
}

/** Matching rows on one Perth date, plus the rows that date hides and why. */
export function dayRows(summary: BrowseSummary, date: string) {
  const onDay = (row: BrowseRow) => perthDateOf(row.listing.startsAt) === date;
  const shown = summary.matching.filter(onDay);
  const shownIds = new Set(shown.map((row) => row.listing.id));
  const hiddenRows = summary.all.filter((row) => onDay(row) && !shownIds.has(row.listing.id));
  return {
    shown,
    hidden: hiddenRows,
    hiddenClash: hiddenRows.filter((row) => isClash(row.check)).length,
    hiddenLevel: hiddenRows.filter((row) => !isClash(row.check) && isBelowMyLevel(row.listing)).length,
  };
}
