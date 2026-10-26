/**
 * Pure status-derivation logic for documents left at `document_status = "unknown"`.
 *
 * A document that carries a `publication_date` but no explicit review date can
 * be assigned a defensible status by assuming the standard review cycle: its
 * review date is `publication_date + reviewCycleYears`, and it is `current`
 * while that inferred date is in the future, else `review_due`.
 *
 * This encodes a policy assumption (the review cycle) and is intentionally
 * conservative: date-less docs and future/implausible publication dates are not
 * derived. See `scripts/derive-unknown-status.ts` for the live backfill driver.
 */

import {
  sourceAuthorityIdentityForPublisher,
  sourceAuthorityIdentityForPublisherCode,
} from "@/lib/source-authority-registry";

export const DEFAULT_REVIEW_CYCLE_YEARS = 3;

/**
 * Registry keys of the publishers whose documents carry the standard review cycle this
 * derivation assumes. Only WA Health is documented as doing so; any other publisher, or a
 * document with no recognised publisher, stays "unknown" rather than being read as current.
 * Widening this list is a clinical policy decision for the owner.
 */
const REVIEW_CYCLE_AUTHORITY_KEYS: ReadonlySet<string> = new Set(["wa-health"]);

/** Whether a document's recorded publisher is one whose standard review cycle may be assumed. */
export function reviewCycleAppliesTo(metadata: { publisher_code?: unknown; publisher?: unknown }): boolean {
  const identities = [
    typeof metadata.publisher_code === "string" && metadata.publisher_code.trim()
      ? sourceAuthorityIdentityForPublisherCode(metadata.publisher_code)
      : undefined,
    typeof metadata.publisher === "string" && metadata.publisher.trim()
      ? sourceAuthorityIdentityForPublisher(metadata.publisher)
      : undefined,
  ].filter((identity) => identity !== undefined);
  // Every recorded identity must resolve, and to a cycle publisher: a WA Health code beside
  // a different named publisher is a conflict, not evidence.
  return (
    identities.length > 0 &&
    identities.every((identity) => identity !== null && REVIEW_CYCLE_AUTHORITY_KEYS.has(identity.key))
  );
}

/** Metadata version stamp written when a status is derived from the review cycle. */
export const UNKNOWN_STATUS_DERIVATION_VERSION = "unknown_status_cycle_v1";

/** Human-readable basis recorded alongside a cycle-inferred status. */
export function unknownStatusDerivationBasis(reviewCycleYears = DEFAULT_REVIEW_CYCLE_YEARS) {
  return `inferred from publication_date + ${reviewCycleYears}-year standard review cycle; no explicit review date in source`;
}
export type UnknownStatusDerivation =
  | { kind: "derived"; reviewDate: string; status: "current" | "review_due" }
  | { kind: "skip"; reason: "no_publication_date" | "unparseable_publication_date" | "future_publication_date" };

function pad(value: number) {
  return String(value).padStart(2, "0");
}

/** Parse a strict `YYYY-MM-DD` date; null when absent or not a real calendar date. */
export function parseIsoDate(value: unknown): { year: number; month: number; day: number } | null {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
    return null;
  }
  return { year, month, day };
}

/**
 * Derive a document status from a publication date and a review cycle.
 *
 * @param publicationDate raw metadata value (`YYYY-MM-DD` string expected)
 * @param options.reviewCycleYears cycle length in years (default 3, WA standard)
 * @param options.now reference "today" (Perth end-of-day comparison)
 */
export function deriveUnknownStatus(
  publicationDate: unknown,
  options: { reviewCycleYears?: number; now?: Date } = {},
): UnknownStatusDerivation {
  const reviewCycleYears = options.reviewCycleYears ?? DEFAULT_REVIEW_CYCLE_YEARS;
  const now = options.now ?? new Date();

  if (publicationDate == null || publicationDate === "") {
    return { kind: "skip", reason: "no_publication_date" };
  }
  const pub = parseIsoDate(publicationDate);
  if (!pub) return { kind: "skip", reason: "unparseable_publication_date" };

  // A publication date in the future is almost certainly a mis-extraction; do
  // not let it fabricate an inferred review date that reads as "current".
  const pubDate = new Date(`${pub.year}-${pad(pub.month)}-${pad(pub.day)}T00:00:00+08:00`);
  if (pubDate > now) return { kind: "skip", reason: "future_publication_date" };

  // A 29 February publication lands on 28 February in a non-leap review year, so the inferred
  // date is always a real calendar date and never later than one full cycle.
  const reviewYear = pub.year + reviewCycleYears;
  const daysInReviewMonth = new Date(Date.UTC(reviewYear, pub.month, 0)).getUTCDate();
  const reviewDate = `${reviewYear}-${pad(pub.month)}-${pad(Math.min(pub.day, daysInReviewMonth))}`;
  const status = new Date(`${reviewDate}T23:59:59+08:00`) >= now ? "current" : "review_due";
  return { kind: "derived", reviewDate, status };
}
