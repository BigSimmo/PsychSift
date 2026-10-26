/**
 * A scheduled watch on how well the worker is reading documents (audit 2026-10-24 EM-N6).
 *
 * `document_index_quality.extraction_quality` already records good / partial / poor / unknown for
 * every indexed document, and the developer hub shows the spread on request. Nothing looked at it
 * on a schedule, so an extractor change that quietly made most new documents "poor" would only be
 * noticed when answers got worse. `reindex-health` now reports the four counts and this verdict,
 * and the ingestion autopilot prints the verdict in its run summary.
 *
 * Kept pure and env-free so it can be unit tested and shared by both scripts.
 */

/** A poor share at or above this, across at least `MIN_ASSESSED_DOCUMENTS`, warrants a look. */
export const POOR_SHARE_WARNING = 0.2;
/** A rise of this much over a supplied baseline warrants a look (the re-index before/after check). */
export const POOR_SHARE_RISE_WARNING = 0.05;
/** Below this many assessed documents a share is noise, so no share-based warning is raised. */
export const MIN_ASSESSED_DOCUMENTS = 5;

export type ExtractionQualityCounts = {
  good: number | null;
  partial: number | null;
  poor: number | null;
  unknown: number | null;
};

export type ExtractionQualityVerdict = {
  /** Documents with a good, partial or poor reading. `unknown` is not an assessment. */
  assessed: number | null;
  /** poor / assessed, rounded to three places; null when unreadable or nothing assessed. */
  poorShare: number | null;
  /** One plain line when something needs a look, otherwise null. */
  warning: string | null;
};

function countOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/** Reads the four `quality_extraction_*` counts from a reindex-health payload's `counts`. */
/** Whole-library counts use "quality_extraction_"; the recent cohort uses RECENT_QUALITY_COUNT_PREFIX. */
export const RECENT_QUALITY_COUNT_PREFIX = "quality_recent_extraction_";

export function extractionQualityCountsFrom(
  counts: Record<string, number | null> | undefined,
  prefix = "quality_extraction_",
): ExtractionQualityCounts | null {
  if (!counts || !Object.hasOwn(counts, `${prefix}poor`)) return null;
  return {
    good: countOrNull(counts[`${prefix}good`]),
    partial: countOrNull(counts[`${prefix}partial`]),
    poor: countOrNull(counts[`${prefix}poor`]),
    unknown: countOrNull(counts[`${prefix}unknown`]),
  };
}

export function assessExtractionQuality(
  counts: ExtractionQualityCounts,
  options: { baselinePoorShare?: number | null } = {},
): ExtractionQualityVerdict {
  const { good, partial, poor } = counts;
  // An unreadable count must never read as "no poor documents".
  if (good === null || partial === null || poor === null) {
    return { assessed: null, poorShare: null, warning: "extraction quality counts unavailable" };
  }
  const assessed = good + partial + poor;
  if (assessed === 0) return { assessed, poorShare: null, warning: null };
  const poorShare = Math.round((poor / assessed) * 1000) / 1000;
  const percent = (share: number) => `${Math.round(share * 100)}%`;

  const baseline = options.baselinePoorShare;
  if (
    typeof baseline === "number" &&
    Number.isFinite(baseline) &&
    baseline >= 0 &&
    // Compared in whole tenths of a percent, so a rise of exactly the threshold (0.15 - 0.10)
    // is not lost to floating-point rounding.
    Math.round((poorShare - baseline) * 1000) >= Math.round(POOR_SHARE_RISE_WARNING * 1000)
  ) {
    return {
      assessed,
      poorShare,
      warning: `poor extractions rose from ${percent(baseline)} to ${percent(poorShare)} of ${assessed} assessed documents`,
    };
  }
  if (assessed >= MIN_ASSESSED_DOCUMENTS && poorShare >= POOR_SHARE_WARNING) {
    return {
      assessed,
      poorShare,
      warning: `${poor} of ${assessed} assessed documents (${percent(poorShare)}) have a poor extraction`,
    };
  }
  return { assessed, poorShare, warning: null };
}
