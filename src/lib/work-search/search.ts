import type { OnCallEntry } from "@/lib/on-call/entry-model";
import { searchOnCallEntries } from "@/lib/on-call/entry-search";
import type { WorkItem, WorkSearchArea } from "@/lib/work-search/model";
import { alternativeMatches, workSearchTerms, type TermAlternative } from "@/lib/work-search/terms";

/** 0 title, 1 tag or detail line, 2 other text: the same tiers On Call's own search uses. */
export type WorkSearchRank = 0 | 1 | 2;

export interface WorkSearchHit {
  readonly item: WorkItem;
  readonly rank: WorkSearchRank;
}

/** An On Call / Admin entry with the item it maps to, so its own search can rank it. */
export interface WorkSearchEntry {
  readonly entry: OnCallEntry;
  readonly item: WorkItem;
}

/** Plenty for every group's "See all"; the records are already in memory. */
export const WORK_SEARCH_RESULT_LIMIT = 200;

type Tiers = readonly [readonly string[], readonly string[], readonly string[]];

/** Each item's lower-cased text, worked out once rather than on every keystroke. */
const tierCache = new WeakMap<WorkItem, Tiers>();

function tiersOf(item: WorkItem): Tiers {
  let tiers = tierCache.get(item);
  if (!tiers) {
    const lower = (values: readonly string[]) => values.filter(Boolean).map((value) => value.toLowerCase());
    tiers = [lower([item.title]), lower([...item.tags, item.detail ?? ""]), lower(item.text)];
    tierCache.set(item, tiers);
  }
  return tiers;
}

function rankItem(item: WorkItem, terms: readonly (readonly TermAlternative[])[]): WorkSearchRank | null {
  const tiers = tiersOf(item);
  let worst: WorkSearchRank = 0;
  for (const alternatives of terms) {
    const best = tiers.findIndex((fields) =>
      fields.some((field) => alternatives.some((alternative) => alternativeMatches(field, alternative))),
    );
    if (best === -1) return null;
    if (best > worst) worst = best as WorkSearchRank;
  }
  return worst;
}

/**
 * Upcoming first (soonest first), then undated, then past (most recent first):
 * "nights" should show the next night before last month's.
 */
function dateOrder(a: WorkItem, b: WorkItem, today: string): number {
  const bucket = (item: WorkItem) => (item.date === null ? 1 : item.date >= today ? 0 : 2);
  const difference = bucket(a) - bucket(b);
  if (difference !== 0) return difference;
  if (a.date === null || b.date === null) return 0;
  return bucket(a) === 0 ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date);
}

/**
 * Every item matching `query`, best first. Each word must match somewhere (AND),
 * and an item ranks by its weakest word, as in On Call's search. On Call and
 * Admin entries are ranked by On Call's own search, so phone numbers match
 * however they are typed. Ties go to the area the reader came from, then by date.
 */
export function searchWork(
  input: { readonly items: readonly WorkItem[]; readonly entries: readonly WorkSearchEntry[] },
  query: string,
  options: { readonly currentArea: WorkSearchArea | null; readonly today: string },
): WorkSearchHit[] {
  const terms = workSearchTerms(query);
  if (terms.length === 0) return [];

  const best = new Map<string, WorkSearchHit>();
  const keep = (item: WorkItem, rank: WorkSearchRank) => {
    const current = best.get(item.id);
    if (!current || rank < current.rank) best.set(item.id, { item, rank });
  };
  for (const item of input.items) {
    const rank = rankItem(item, terms);
    if (rank !== null) keep(item, rank);
  }
  // Entries are matched both ways: by the same word forms as everything else, and by
  // On Call's own search, which also reads their details and phone numbers.
  for (const { item } of input.entries) {
    const rank = rankItem(item, terms);
    if (rank !== null) keep(item, rank);
  }
  const itemByEntry = new Map(input.entries.map(({ entry, item }) => [entry, item]));
  for (const result of searchOnCallEntries(
    input.entries.map(({ entry }) => entry),
    query,
  )) {
    const item = itemByEntry.get(result.entry);
    if (item) keep(item, Math.min(result.rank, 2) as WorkSearchRank);
  }

  return [...best.values()]
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        Number(b.item.area === options.currentArea) - Number(a.item.area === options.currentArea) ||
        dateOrder(a.item, b.item, options.today) ||
        a.item.title.localeCompare(b.item.title),
    )
    .slice(0, WORK_SEARCH_RESULT_LIMIT);
}

/** How many hits each area has, for the chip counts. */
export function workSearchCounts(hits: readonly WorkSearchHit[]): Partial<Record<WorkSearchArea, number>> {
  const counts: Partial<Record<WorkSearchArea, number>> = {};
  for (const { item } of hits) counts[item.area] = (counts[item.area] ?? 0) + 1;
  return counts;
}

/** Whether a dated item is still ahead (or under way): a shift that has ended today is not. */
export function isStillAhead(item: WorkItem, today: string, now: number): boolean {
  if (item.endsAt) return Date.parse(item.endsAt) > now;
  if (item.date === null) return false;
  return (item.until ?? item.date) >= today;
}

/**
 * The next few things ahead before the reader types: overdue renewals first (a
 * passed date is the thing most worth seeing), then at most one of each kind so a
 * run of shifts cannot crowd out leave or a renewal.
 */
export function workComingUp(items: readonly WorkItem[], today: string, now: number, limit = 3): WorkItem[] {
  const overdue = items
    .filter((item) => item.kind === "renewal" && item.date !== null && item.date < today)
    .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
  const firstByKind = new Map<string, WorkItem>();
  for (const item of items) {
    if (item.date === null || item.kind === "cpd-activity" || item.kind === "entry") continue;
    if (item.kind === "renewal" && item.date < today) continue;
    if (item.facet === "leave" || !isStillAhead(item, today, now)) continue;
    const key = `${item.area}:${item.kind}`;
    const current = firstByKind.get(key);
    if (!current || (item.startsAt ?? item.date) < (current.startsAt ?? current.date ?? "")) firstByKind.set(key, item);
  }
  const ahead = [...firstByKind.values()].sort(
    (a, b) => (a.startsAt ?? a.date ?? "").localeCompare(b.startsAt ?? b.date ?? "") || a.title.localeCompare(b.title),
  );
  return [...overdue, ...ahead].slice(0, limit);
}
