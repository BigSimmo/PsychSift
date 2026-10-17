import { normalizedClinicalSearchTokens } from "@/lib/clinical-search";
import { buildDocumentBreakdown, extractQuoteCards } from "@/lib/evidence";
import { evidenceTextForGate } from "@/lib/rag/rag-answer-support";
import { normalizeSectionText } from "@/lib/rag/rag-answer-text";
import { finalQualityGapAnswer } from "@/lib/rag/rag-answer-shape-checks";
import { queryTokenMatchesText } from "@/lib/rag/rag-extractive-signals";
import type { AnswerSection, SearchResult } from "@/lib/types";

const documentLookupMetaTokenPattern =
  /^(?:which|what|list|show|name|where|find|provide|support|supports|supporting|sources?|documents?|guidelines?|polic(?:y|ies|ie)|protocols?|procedures?|manuals?|guidance|indexed|reviews?|sets?|states?|says?|describes?|mentions?|covers?|contains?|for|with|from|that|this|the|and)$/i;

/** Build document support list answer. */
export function buildDocumentSupportListAnswer(args: {
  query: string;
  results: SearchResult[];
  filterToClaimBearingDocuments?: boolean;
}) {
  let scopedResults = args.results;
  if (args.filterToClaimBearingDocuments) {
    const qualifierTokens = Array.from(
      new Set(
        normalizedClinicalSearchTokens(args.query).filter((token) => !documentLookupMetaTokenPattern.test(token)),
      ),
    );
    if (qualifierTokens.length > 0) {
      const matchesByDocument = new Map<string, Set<string>>();
      const matchesByResult = new Map<string, string[]>();
      for (const result of args.results) {
        const evidence = evidenceTextForGate(result);
        const matches = qualifierTokens.filter((token) => queryTokenMatchesText(token, evidence));
        matchesByResult.set(result.id, matches);
        const documentMatches = matchesByDocument.get(result.document_id) ?? new Set<string>();
        matches.forEach((token) => documentMatches.add(token));
        matchesByDocument.set(result.document_id, documentMatches);
      }
      // A partial hit does not support a compound query. Accumulate qualifiers across
      // a document's chunks, then retain the chunks that supply its matching evidence.
      scopedResults = args.results.filter(
        (result) =>
          matchesByDocument.get(result.document_id)?.size === qualifierTokens.length &&
          (matchesByResult.get(result.id)?.length ?? 0) > 0,
      );
    }
  }
  const documents = buildDocumentBreakdown(scopedResults, extractQuoteCards(scopedResults, args.query)).slice(0, 5);
  if (!documents.length) {
    const gapAnswer = finalQualityGapAnswer(args.query, "document_lookup", "document_lookup");
    return {
      answer: gapAnswer,
      citationChunkIds: [] as string[],
      supportListCitationResultIds: [] as string[],
      answerSections: [] as AnswerSection[],
    };
  }
  const names = documents
    .map((document) =>
      normalizeSectionText(document.title || document.file_name)
        .replace(/([a-zA-Z])\(/g, "$1 (")
        .replace(/\s{2,}/g, " ")
        .trim(),
    )
    .filter(Boolean);
  const answer =
    names.length === 1
      ? `I found one indexed document that supports this query: ${names[0]}.`
      : `I found ${names.length} indexed documents that support this query: ${names.slice(0, -1).join("; ")}; and ${names.at(-1)}.`;
  const chunksByDocument = documents.map((document) =>
    scopedResults.filter((result) => result.document_id === document.document_id).map((result) => result.id),
  );
  // Every named document gets an anchor before extra chunks can consume the
  // five-citation budget. Split-chunk supporting evidence fills remaining slots.
  const citationChunkIds = Array.from(
    new Set([
      ...chunksByDocument.flatMap((ids) => ids.slice(0, 1)),
      ...chunksByDocument.flatMap((ids) => ids.slice(1)),
    ]),
  ).slice(0, 5);
  return {
    answer,
    preformatted: true,
    citationChunkIds,
    supportListCitationResultIds: scopedResults
      .filter((result) => documents.some((document) => document.document_id === result.document_id))
      .map((result) => result.id),
    answerSections: [
      {
        heading: "Document matches",
        kind: "documentation",
        supportLevel: "direct",
        body: names.join("; "),
        citation_chunk_ids: citationChunkIds,
      },
    ] satisfies AnswerSection[],
  };
}
