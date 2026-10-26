import type { ClinicalSourceClientEntry, ClinicalSourceReferenceInput } from "@/lib/sources/catalogue-types";
import { strictSourceDate } from "@/lib/sources/source-date-policy";

/**
 * The Currency check: is each source still the latest, and which ones come up
 * for review soon.
 *
 * Built only from what the catalogue already records. Nothing here contacts a
 * publisher or guesses a review interval, so a source with no forward date is
 * counted as having none rather than being given one. Two kinds of recorded
 * date can fall in the coming months:
 *
 * - an expiry date (`expiryDate`), which the catalogue already treats as the
 *   point a source becomes outdated; and
 * - a review date that lies in the future. A review that has not happened yet
 *   can only be the date a review is due, so it is shown as "Review date".
 *
 * A past review date says when a source was last looked at and never puts it on
 * the timeline.
 */

export type SourceCurrencyStatus = ClinicalSourceReferenceInput["documentStatus"];

export const SOURCE_CURRENCY_STATUS_ORDER: readonly SourceCurrencyStatus[] = [
  "current",
  "review_due",
  "outdated",
  "unknown",
];

export const SOURCE_CURRENCY_STATUS_LABELS: Record<SourceCurrencyStatus, string> = {
  current: "Current",
  review_due: "Review due",
  outdated: "Outdated",
  unknown: "Not reviewed",
};

export const CURRENCY_CHECK_MONTHS = 6;

export type UpcomingSourceDate = {
  entry: ClinicalSourceClientEntry;
  date: string;
  kind: "expires" | "review";
};

export type CurrencyCheckMonth = {
  key: string;
  label: string;
  items: UpcomingSourceDate[];
};

export type SourceCurrencyCheck = {
  total: number;
  counts: Record<SourceCurrencyStatus, number>;
  months: CurrencyCheckMonth[];
  upcoming: UpcomingSourceDate[];
  needsReview: ClinicalSourceClientEntry[];
  replaced: ClinicalSourceClientEntry[];
};

const MONTH_LABEL = new Intl.DateTimeFormat("en-AU", { month: "short", timeZone: "UTC" });

function monthKey(date: string) {
  return date.slice(0, 7);
}

function addMonths(date: string, months: number) {
  const [year, month] = date.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1 + months, 1));
  return shifted.toISOString().slice(0, 10);
}

/** Today's date in Perth, as the YYYY-MM-DD the catalogue's dates use. */
export function perthToday(now: Date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Perth" }).format(now);
}

function upcomingDate(entry: ClinicalSourceClientEntry, today: string, windowEnd: string): UpcomingSourceDate | null {
  const expiry = strictSourceDate(entry.expiryDate);
  if (expiry && expiry >= today && expiry < windowEnd) return { entry, date: expiry, kind: "expires" };
  const review = strictSourceDate(entry.reviewDate);
  if (review && review > today && review < windowEnd) return { entry, date: review, kind: "review" };
  return null;
}

/** Statuses on the "Needs review first" list, in reading order. `current` is absent. */
const NEEDS_REVIEW_RANK: Partial<Record<SourceCurrencyStatus, number>> = { outdated: 0, review_due: 1, unknown: 2 };

/** The statuses `needsReview` holds, for links that filter the catalogue to the same set. */
export const NEEDS_REVIEW_STATUSES: readonly SourceCurrencyStatus[] = ["outdated", "review_due", "unknown"];

function byTitle(left: ClinicalSourceClientEntry, right: ClinicalSourceClientEntry) {
  return left.title.localeCompare(right.title, "en-AU");
}

export function deriveSourceCurrencyCheck(
  entries: readonly ClinicalSourceClientEntry[],
  today: string = perthToday(),
): SourceCurrencyCheck {
  const counts: Record<SourceCurrencyStatus, number> = { current: 0, review_due: 0, outdated: 0, unknown: 0 };
  for (const entry of entries) counts[entry.documentStatus] += 1;

  const firstMonth = `${monthKey(today)}-01`;
  const windowEnd = addMonths(firstMonth, CURRENCY_CHECK_MONTHS);

  const upcoming = entries
    .map((entry) => upcomingDate(entry, today, windowEnd))
    .filter((item): item is UpcomingSourceDate => item !== null)
    .sort((left, right) => left.date.localeCompare(right.date) || byTitle(left.entry, right.entry));

  const months = Array.from({ length: CURRENCY_CHECK_MONTHS }, (_, index) => {
    const start = addMonths(firstMonth, index);
    return {
      key: monthKey(start),
      label: MONTH_LABEL.format(new Date(`${start}T00:00:00.000Z`)),
      items: upcoming.filter((item) => monthKey(item.date) === monthKey(start)),
    };
  });

  const replaced = entries.filter((entry) => entry.supersededBy.length > 0).sort(byTitle);
  const replacedIds = new Set(replaced.map((entry) => entry.id));

  // Outdated, then review due, then not reviewed: the more serious state is read
  // first, matching the catalogue's own "Needs review first" order. A source nobody
  // has reviewed ("unknown", shown as "Not reviewed") needs review too; leaving it
  // out let an unreviewed source sit off this list indefinitely (audit 26 Oct 2026).
  const needsReview = entries
    .filter((entry) => !replacedIds.has(entry.id) && NEEDS_REVIEW_RANK[entry.documentStatus] !== undefined)
    .sort(
      (left, right) =>
        (NEEDS_REVIEW_RANK[left.documentStatus] ?? 0) - (NEEDS_REVIEW_RANK[right.documentStatus] ?? 0) ||
        byTitle(left, right),
    );

  return { total: entries.length, counts, months, upcoming, needsReview, replaced };
}
