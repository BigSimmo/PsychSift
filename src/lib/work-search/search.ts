import type { OnCallEntry } from "@/lib/on-call/entry-model";
import { onCallDigitsOf, onCallFieldMatches, onCallSearchTerms, searchOnCallEntries } from "@/lib/on-call/entry-search";
import type { WorkItem, WorkSearchArea } from "@/lib/work-search/model";

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

const WORK_SEARCH_RESULT_LIMIT = 60;

function rankItem(item: WorkItem, terms: readonly string[]): WorkSearchRank | null {
  const tiers: readonly (readonly string[])[] = [[item.title], [...item.tags, item.detail ?? ""], item.text];
  let worst: WorkSearchRank = 0;
  for (const term of terms) {
    const termDigits = onCallDigitsOf(term);
    const best = tiers.findIndex((fields) => fields.some((field) => onCallFieldMatches(field, term, termDigits)));
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
  const terms = onCallSearchTerms(query);
  if (terms.length === 0) return [];

  const hits: WorkSearchHit[] = [];
  for (const item of input.items) {
    const rank = rankItem(item, terms);
    if (rank !== null) hits.push({ item, rank });
  }
  const itemByEntry = new Map(input.entries.map(({ entry, item }) => [entry, item]));
  for (const result of searchOnCallEntries(
    input.entries.map(({ entry }) => entry),
    query,
  )) {
    const item = itemByEntry.get(result.entry);
    if (item) hits.push({ item, rank: Math.min(result.rank, 2) as WorkSearchRank });
  }

  return hits
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

/**
 * The next few dated things ahead, at most one per area so a run of shifts
 * cannot crowd out a renewal: "Coming up" before the reader types.
 */
export function workComingUp(items: readonly WorkItem[], today: string, limit = 3): WorkItem[] {
  const firstByArea = new Map<WorkSearchArea, WorkItem>();
  for (const item of items) {
    if (item.date === null || item.date < today || item.kind === "cpd-activity") continue;
    const current = firstByArea.get(item.area);
    if (!current || item.date < (current.date ?? "")) firstByArea.set(item.area, item);
  }
  return [...firstByArea.values()]
    .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? "") || a.title.localeCompare(b.title))
    .slice(0, limit);
}
