import { allowedChunkMap, citationFromResult as resultCitation, compactCitations } from "@/lib/citations";
import { adjacentLabelledNumericBandConflicts, textReferencesAdjacentBandConflict } from "@/lib/answer-verification";
import { safeRecord, sanitizeStructuredText } from "@/lib/rag/rag-answer-text";
import {
  sourceDirectlySupportsAnswerText,
  sourceLabelledNumericBandConflictsAffectingText,
} from "@/lib/rag/rag-claim-support";
import { appendRoutingReason } from "@/lib/rag/rag-routing";
import { sourceTextForClinicalProse } from "@/lib/source-text-sanitizer";
import type { ConflictOrGap, QuoteCard, RagAnswer, SearchResult } from "@/lib/types";

export function normalizeQuoteVerificationText(text: string) {
  return sourceTextForClinicalProse(text)
    .normalize("NFKC")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function tableFactQuoteText(fact: NonNullable<SearchResult["table_facts"]>[number]) {
  // Mirrors tableFactText in answer-verification.ts: include the fact-metadata
  // snippet fields that rich-mode prompts show the model (tableSnippetForFact),
  // so quotes drawn from them verify as exact.
  const metadata = safeRecord(fact.metadata);
  const metadataString = (key: string) => (typeof metadata[key] === "string" ? (metadata[key] as string) : "");
  const metadataCells = Array.isArray(metadata.cells) ? (metadata.cells as unknown[]).map(String).join(" ") : "";
  return [
    fact.table_title,
    fact.row_label,
    fact.clinical_parameter,
    fact.threshold_value,
    fact.action,
    metadataString("accessible_table_markdown"),
    metadataString("table_text_snippet"),
    metadataCells,
  ]
    .filter(Boolean)
    .join(" ");
}

export function sourceTextForQuoteVerification(source: SearchResult) {
  const parts = [
    source.content,
    source.adjacent_context,
    source.section_heading,
    source.retrieval_synopsis,
    source.table_facts?.map(tableFactQuoteText).join(" "),
    source.memory_cards?.map((card) => card.content).join(" "),
    source.index_unit ? [source.index_unit.title, source.index_unit.content].filter(Boolean).join(" ") : "",
    source.images
      ?.map((image) =>
        [image.tableLabel, image.tableTitle, image.caption, image.tableTextSnippet, image.accessibleTableMarkdown]
          .filter(Boolean)
          .join(" "),
      )
      .join(" "),
  ];
  return parts.filter(Boolean).join(" ");
}

export function isExactSourceQuote(quote: string, source: SearchResult) {
  const normalizedQuote = normalizeQuoteVerificationText(quote);
  if (normalizedQuote.length < 8) return false;
  const normalizedSource = normalizeQuoteVerificationText(sourceTextForQuoteVerification(source));
  return normalizedSource.includes(normalizedQuote);
}

export function sanitizeQuoteCards(
  cards: Array<{ chunk_id: string; quote: string; section_heading?: string | null }> | undefined,
  results: SearchResult[],
): QuoteCard[] {
  const chunks = allowedChunkMap(results);
  return (cards ?? [])
    .map((card) => {
      const source = chunks.get(card.chunk_id);
      if (!source) return null;
      const quote = sanitizeStructuredText(card.quote, { minLength: 8, minTokens: 2 });
      if (!quote) return null;
      if (!isExactSourceQuote(quote, source)) return null;
      return {
        ...resultCitation(source, "exact_quote"),
        quote,
        section_heading: card.section_heading ?? source.section_heading,
      } satisfies QuoteCard;
    })
    .filter((card): card is QuoteCard => Boolean(card));
}

export function sanitizeConflictsOrGaps(items: ConflictOrGap[] | undefined, results: SearchResult[]): ConflictOrGap[] {
  const allowed = new Set(results.map((result) => result.id));
  return (items ?? [])
    .map((item) => ({
      type: item.type,
      message: sanitizeStructuredText(item.message, { minLength: 8, minTokens: 2 }) || item.message,
      source_chunk_ids: item.source_chunk_ids?.filter((id) => allowed.has(id)),
      origin: "model" as const,
    }))
    .filter((item) => !item.source_chunk_ids || item.source_chunk_ids.length > 0);
}

export function enrichGroundedReviewCitations(
  answer: RagAnswer,
  results: SearchResult[],
  minCitations = 2,
  query?: string,
): RagAnswer {
  const targetCitationCount = Math.min(2, minCitations);
  if (!answer.grounded || answer.confidence === "unsupported") return answer;
  if (answer.citations.length >= targetCitationCount) return answer;
  if ((answer.unverifiedNumericTokens?.length ?? 0) > 0 || answer.faithfulnessWarning) return answer;

  const resultById = new Map(results.map((result) => [result.id, result]));
  const adjacentBandConflicts = adjacentLabelledNumericBandConflicts(results);
  const modelSelected = answer.citations.filter((citation) => citation.provenance === "model_selected");
  if (modelSelected.length === 0) return answer;
  if (
    modelSelected.some((citation) => {
      const source = resultById.get(citation.chunk_id);
      return !source || !sourceDirectlySupportsAnswerText(answer.answer, source);
    })
  ) {
    return answer;
  }

  const existing = new Set(answer.citations.map((citation) => citation.chunk_id));
  const additional = compactCitations(results, results.length, "deterministic_support")
    .filter((citation) => {
      if (existing.has(citation.chunk_id)) return false;
      const source = resultById.get(citation.chunk_id);
      if (!source) return false;
      const metadata = source.source_metadata;
      if (metadata?.document_status !== "current" || metadata.extraction_quality !== "good") return false;
      if (source.indexing_quality && source.indexing_quality.extraction_quality !== "good") return false;
      if (sourceLabelledNumericBandConflictsAffectingText(source, answer.answer, query).length > 0) return false;
      if (textReferencesAdjacentBandConflict(answer.answer, source.id, adjacentBandConflicts, query)) return false;
      return sourceDirectlySupportsAnswerText(answer.answer, source);
    })
    .slice(0, Math.min(1, targetCitationCount - answer.citations.length));
  if (additional.length === 0) return answer;

  return {
    ...answer,
    citations: [...answer.citations, ...additional],
    routingReason: appendRoutingReason(answer.routingReason, "review_citations_enriched"),
  };
}
