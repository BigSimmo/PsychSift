import type { OnCallEntry } from "@/lib/on-call/entry-model";
import { searchOnCallEntries } from "@/lib/on-call/entry-search";
import { workSearchAreaLabels, type WorkAreaRead, type WorkItem, type WorkSearchArea } from "@/lib/work-search/model";
import { alternativeMatches, withinOneEdit, workSearchTerms, type TermAlternative } from "@/lib/work-search/terms";

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
  options: { readonly currentArea: WorkSearchArea | null; readonly today: string; readonly exact?: boolean },
): WorkSearchHit[] {
  // "Search for … exactly" turns off the one-letter-out matching.
  const terms = workSearchTerms(query).map((alternatives) =>
    options.exact ? alternatives.map((alternative) => ({ ...alternative, fuzzy: false })) : alternatives,
  );
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
  // On Call's own search has no one-letter-out matching, so it runs in exact mode too.
  const itemByEntry = new Map(input.entries.map(({ entry, item }) => [entry, item]));
  for (const result of searchOnCallEntries(
    input.entries.map(({ entry }) => entry),
    query,
  )) {
    const item = itemByEntry.get(result.entry);
    if (item) keep(item, Math.min(result.rank, 2) as WorkSearchRank);
  }

  return finish(best, options);
}

function finish(
  best: ReadonlyMap<string, WorkSearchHit>,
  options: { readonly currentArea: WorkSearchArea | null; readonly today: string },
): WorkSearchHit[] {
  // Series are folded before the cap, so a long weekly series cannot crowd out other matches.
  return collapseSeries(
    [...best.values()].sort(
      (a, b) =>
        a.rank - b.rank ||
        Number(b.item.area === options.currentArea) - Number(a.item.area === options.currentArea) ||
        dateOrder(a.item, b.item, options.today) ||
        a.item.title.localeCompare(b.item.title),
    ),
    options.today,
  ).slice(0, WORK_SEARCH_RESULT_LIMIT);
}

/**
 * The word a typo was read as, for "Showing matches for journal": set when a
 * typed word matched nothing as typed, in any record or in On Call's own search,
 * but matched a word one letter out.
 */
export function workSearchCorrection(
  input: { readonly items: readonly WorkItem[]; readonly entries: readonly WorkSearchEntry[] },
  query: string,
): { readonly typed: string; readonly read: string } | null {
  const items = [...input.items, ...input.entries.map(({ item }) => item)];
  const entries = input.entries.map(({ entry }) => entry);
  for (const alternatives of workSearchTerms(query)) {
    const fuzzy = alternatives.find((alternative) => alternative.fuzzy);
    if (!fuzzy) continue;
    const exact = alternatives.map((alternative) => ({ ...alternative, fuzzy: false }));
    if (
      items.some((item) =>
        tiersOf(item).some((fields) => fields.some((field) => exact.some((alt) => alternativeMatches(field, alt)))),
      ) ||
      searchOnCallEntries(entries, fuzzy.text).length > 0
    )
      continue;
    for (const item of items) {
      for (const fields of tiersOf(item)) {
        for (const field of fields) {
          const word = field
            .split(/[^\p{L}\p{N}]+/u)
            .find((candidate) => candidate.length >= 4 && withinOneEdit(candidate, fuzzy.text));
          if (word) return { typed: fuzzy.text, read: word };
        }
      }
    }
  }
  return null;
}

/**
 * A weekly session shows once: the best-ranked match of each Teaching title at
 * each place, with "+2 more" added to its detail line for the other sessions
 * still ahead, so a series cannot fill the list.
 */
export function collapseSeries(hits: readonly WorkSearchHit[], today: string): WorkSearchHit[] {
  const firstOf = new Map<string, number>();
  const extra = new Map<string, number>();
  const kept: WorkSearchHit[] = [];
  for (const hit of hits) {
    if (hit.item.kind !== "session") {
      kept.push(hit);
      continue;
    }
    const key = `${hit.item.title.trim().toLowerCase()}|${(hit.item.text[0] ?? "").trim().toLowerCase()}`;
    if (firstOf.has(key)) {
      if (hit.item.date === null || hit.item.date >= today) extra.set(key, (extra.get(key) ?? 0) + 1);
      continue;
    }
    firstOf.set(key, kept.length);
    kept.push(hit);
  }
  for (const [key, count] of extra) {
    if (count === 0) continue;
    const index = firstOf.get(key) as number;
    const { item } = kept[index] as WorkSearchHit;
    kept[index] = {
      ...(kept[index] as WorkSearchHit),
      item: { ...item, detail: [item.detail, `+${count} more`].filter(Boolean).join(" · ") },
    };
  }
  return kept;
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

function listWords(words: readonly string[], joiner: "and" | "or"): string {
  if (words.length <= 1) return words[0] ?? "";
  return `${words.slice(0, -1).join(", ")} ${joiner} ${words[words.length - 1]}`;
}

/**
 * The "Nothing for …" line, naming only the areas that were actually checked, so
 * it never claims a record is absent from an area that failed or is still loading.
 */
export function workSearchNothingFound(areas: readonly WorkAreaRead[], filter: WorkSearchArea | "all"): string {
  const inScope = areas.filter((read) => filter === "all" || read.area === filter);
  const checked = inScope.filter((read) => read.status === "ready").map((read) => workSearchAreaLabels[read.area]);
  const unchecked = inScope.filter((read) => read.status !== "ready").map((read) => workSearchAreaLabels[read.area]);
  if (checked.length === 0) {
    return `${listWords(unchecked, "and")} couldn't be checked, so it may be there.`;
  }
  const missing = unchecked.length > 0 ? ` ${listWords(unchecked, "and")} couldn't be checked.` : "";
  return `It isn't in your ${listWords(checked, "or")} records.${missing}`;
}
