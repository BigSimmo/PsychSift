import { normalizedClinicalSearchTokens } from "@/lib/clinical-search";
import { uniqueTextValues } from "@/lib/rag/rag-classifier-fallback";
import { excludeSupersededEvidence } from "@/lib/rag/superseded-evidence";
import type { SearchResult } from "@/lib/types";

// Adds document titles, headings and labels from the first candidates to the clinical search query.

/** Metadata expansion term score. */
function metadataExpansionTermScore(queryTokens: Set<string>, value: string, sourceWeight: number) {
  const tokens = normalizedClinicalSearchTokens(value);
  if (tokens.length === 0) return 0;
  const overlap = tokens.filter((token) => queryTokens.has(token)).length;
  const compactness = value.length <= 80 ? 0.25 : 0;
  return sourceWeight + overlap * 0.6 + compactness;
}

/** Candidate metadata expansion terms. */
function candidateMetadataExpansionTerms(query: string, candidates: SearchResult[], limit = 12) {
  const queryTokens = new Set(normalizedClinicalSearchTokens(query));
  const scoredTerms: Array<{ value: string; score: number }> = [];

  for (const candidate of candidates.slice(0, 24)) {
    scoredTerms.push(
      {
        value: candidate.section_heading ?? "",
        score: metadataExpansionTermScore(queryTokens, candidate.section_heading ?? "", 1.4),
      },
      { value: candidate.title, score: metadataExpansionTermScore(queryTokens, candidate.title, 1.2) },
      {
        value: candidate.file_name.replace(/\.[^.]+$/, "").replace(/[._-]+/g, " "),
        score: metadataExpansionTermScore(queryTokens, candidate.file_name, 0.8),
      },
    );

    for (const label of candidate.document_labels ?? []) {
      if (label.confidence !== undefined && label.confidence < 0.55) continue;
      scoredTerms.push({
        value: label.label,
        score: metadataExpansionTermScore(queryTokens, label.label, 1.8),
      });
    }

    if (candidate.document_summary && candidate.document_summary.length <= 140) {
      scoredTerms.push({
        value: candidate.document_summary,
        score: metadataExpansionTermScore(queryTokens, candidate.document_summary, 0.9),
      });
    }
  }

  return uniqueTextValues(
    scoredTerms
      .filter((term) => term.value.trim() && term.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((term) => term.value),
    limit,
  );
}

/**
 * Expand clinical query with candidate metadata. Superseded candidates add nothing: an old
 * version's title would steer the meaning-based search towards rows that are then thrown away
 * (audit RET-N5, 24 Oct 2026; owner rule #BFCTST).
 */
export function expandClinicalQueryWithCandidateMetadata(
  query: string,
  expandedQuery: string,
  candidates: SearchResult[],
) {
  const metadataTerms = candidateMetadataExpansionTerms(query, excludeSupersededEvidence(candidates));
  if (metadataTerms.length === 0) return expandedQuery;
  return uniqueTextValues([expandedQuery, ...metadataTerms], 24).join(" ");
}
