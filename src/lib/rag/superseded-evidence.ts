import type { SearchResult } from "@/lib/types";

/**
 * Owner rule (Josh, 2026-09-25, ledger #BFCTST): a superseded source is never used as evidence.
 * A document marked "outdated" has been replaced, so it is removed before any answer route
 * (extractive or generated) sees it. "review_due" and "unknown" sources stay: they are still the
 * current version and keep their own governance warnings. When only outdated sources matched, the
 * answer path receives no evidence and degrades to its existing evidence-gap behaviour.
 */
export function excludeSupersededEvidence<T extends Pick<SearchResult, "source_metadata">>(results: T[]): T[] {
  return results.filter((result) => result.source_metadata?.document_status !== "outdated");
}
