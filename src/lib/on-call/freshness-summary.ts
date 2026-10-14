import { onCallEntryFreshness, type OnCallEntry, type OnCallFreshness } from "@/lib/on-call/entry-model";
import { ON_CALL_VIEW_PAGES, onCallViewForEntry, type OnCallPageView } from "@/lib/on-call/view";

/**
 * What needs checking, across the whole hub.
 *
 * The mode already decides staleness one entry at a time, on the row where the
 * fix is. What it could not do is answer the question the home is asked —
 * "is any of this out of date?" — so a section holding six year-old phone
 * numbers looked exactly like a section holding six current ones, and the hub
 * rotted without ever saying so.
 *
 * Every verdict here comes from `onCallEntryFreshness`. Nothing in this module
 * compares a date to an interval, and nothing should start to: a second copy of
 * that arithmetic is how the home and the row end up disagreeing about the same
 * entry, and the row is the one the reader trusts.
 */

/** A stale entry and the verdict that made it stale, so a caller can render the
 *  existing badge without asking again. */
export interface OnCallStaleEntry {
  entry: OnCallEntry;
  freshness: Extract<OnCallFreshness, { state: "stale" }>;
}

export interface OnCallFreshnessSummary {
  /** Every stale entry, however it became stale. */
  staleCount: number;
  /** Never confirmed by anyone — including an entry whose stored date cannot be read. */
  neverVerifiedCount: number;
  /** Confirmed once, too long ago. */
  overdueCount: number;
  /** Stale entries per section/view. A view with nothing stale is absent, not zero,
   *  so `.size` is the number of affected views. */
  bySection: ReadonlyMap<OnCallPageView, number>;
  /** The affected sections, worst first. */
  sections: readonly OnCallPageView[];
  /** The stale entries themselves, worst first. */
  stale: readonly OnCallStaleEntry[];
}

/**
 * Worst first.
 *
 * Never-verified outranks overdue because "nobody has ever confirmed this" is a
 * bigger claim about a phone number than "this was right a year ago". Within
 * overdue, the oldest confirmation leads. The remaining ties are settled by
 * `sortOrder` then title — not because that ordering means anything clinically,
 * but because a strip that reshuffles between renders is a strip nobody can
 * point at.
 */
function worstFirst(a: OnCallStaleEntry, b: OnCallStaleEntry): number {
  if (a.freshness.reason !== b.freshness.reason) {
    return a.freshness.reason === "never-verified" ? -1 : 1;
  }
  // Both overdue, so both carry a date that already parsed — the union says so,
  // which is why this narrows rather than asserting non-null. Compared as
  // instants, not as strings: a stored `2025-09-16` and a stored
  // `2025-09-16T04:00:00Z` sort wrongly against each other as text.
  if (a.freshness.reason === "overdue" && b.freshness.reason === "overdue") {
    const byDate = Date.parse(a.freshness.lastVerifiedAt) - Date.parse(b.freshness.lastVerifiedAt);
    if (byDate !== 0) return byDate;
  }
  return a.entry.sortOrder - b.entry.sortOrder || a.entry.title.localeCompare(b.entry.title);
}

/**
 * What needs checking, from the entries the caller already has.
 *
 * `now` is injectable so the twelve-month boundary can be tested at the day,
 * rather than by faking the clock — and so a surface that already knows "today"
 * passes the same instant to every entry instead of drifting mid-render.
 *
 * **Role explainers count.** Elsewhere in the mode they are excluded from
 * counts, because a Who's who row has no number and would be a call card that
 * cannot call. Here the opposite holds: a stale explainer is an out-of-date
 * description of who covers what overnight, which sends the reader to the wrong
 * person just as surely as an out-of-date extension does. Pinned by
 * `tests/on-call-freshness-summary.test.ts`.
 */
export function summariseOnCallFreshness(
  entries: readonly OnCallEntry[],
  now: Date = new Date(),
): OnCallFreshnessSummary {
  const stale: OnCallStaleEntry[] = [];
  const bySection = new Map<OnCallPageView, number>();
  let neverVerifiedCount = 0;
  let overdueCount = 0;

  for (const entry of entries) {
    const freshness = onCallEntryFreshness(entry, now);
    if (freshness.state !== "stale") continue;
    stale.push({ entry, freshness });
    const view = entry.view ?? onCallViewForEntry(entry);
    bySection.set(view, (bySection.get(view) ?? 0) + 1);
    if (freshness.reason === "never-verified") neverVerifiedCount += 1;
    else overdueCount += 1;
  }

  stale.sort(worstFirst);

  // Most-affected section first, so a strip that can only show three shows the
  // three worth showing. Equal counts fall back to the mode's own view page order
  // rather than to whatever order the entries happened to arrive in.
  const sections = [...bySection.keys()].sort(
    (a, b) =>
      (bySection.get(b) ?? 0) - (bySection.get(a) ?? 0) ||
      ON_CALL_VIEW_PAGES.indexOf(a) - ON_CALL_VIEW_PAGES.indexOf(b),
  );

  return { staleCount: stale.length, neverVerifiedCount, overdueCount, bySection, sections, stale };
}
