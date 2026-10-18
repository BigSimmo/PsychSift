import { normalizedClinicalSearchTokens } from "@/lib/clinical-search";
import { buildDocumentBreakdown, extractQuoteCards } from "@/lib/evidence";
import { evidenceTextForGate } from "@/lib/rag/rag-answer-support";
import { normalizeSectionText } from "@/lib/rag/rag-answer-text";
import { finalQualityGapAnswer } from "@/lib/rag/rag-answer-shape-checks";
import { queryTokenMatchesText } from "@/lib/rag/rag-extractive-signals";
import type { AnswerSection, SearchResult } from "@/lib/types";

const documentLookupMetaTokenPattern =
  /^(?:which|what|list|show|name|where|find|provide|give|gives|support|supports|supporting|sources?|documents?|guidelines?|polic(?:y|ies|ie)|protocols?|procedures?|manuals?|guidance|indexed|reviews?|sets?|states?|says?|describes?|mentions?|mentioned|covers?|contains?|discuss(?:e|es|ed|ing)?|address(?:e|es|ed|ing)?|outlines?|outlined|recommendations?|recommends?|recommended|explains?|explained|relevant|any|there|have|has|our|about|on|for|with|from|that|this|the|and)$/i;

/** Build document support list answer. */
export function buildDocumentSupportListAnswer(args: {
  query: string;
  results: SearchResult[];
  filterToClaimBearingDocuments?: boolean;
}) {
  let scopedResults = args.results;
  let qualifierTokens: string[] = [];
  const matchesByResult = new Map<string, string[]>();
  if (args.filterToClaimBearingDocuments) {
    qualifierTokens = Array.from(
      new Set(
        normalizedClinicalSearchTokens(args.query).filter((token) => !documentLookupMetaTokenPattern.test(token)),
      ),
    );
    if (qualifierTokens.length > 0) {
      const matchesByDocument = new Map<string, Set<string>>();
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
  // Each named document is cited by the chunks that together cover the qualifiers
  // (one chunk when no qualifier filter applies). A document is named only when its
  // whole covering set fits the five-citation budget, never with partial support.
  const citationBudget = 5;
  const coveringChunkIds = (documentId: string) => {
    const chunks = scopedResults.filter((result) => result.document_id === documentId);
    if (qualifierTokens.length === 0 || matchesByResult.size === 0) return chunks.slice(0, 1).map((r) => r.id);
    // Smallest covering set within the citation budget (earliest chunks on ties), so a
    // document never spends citations another named document needs. Chunks whose matches
    // are a subset of an earlier chunk's add nothing, which keeps the search tiny.
    const candidates: { id: string; matches: string[] }[] = [];
    for (const chunk of chunks) {
      const matches = matchesByResult.get(chunk.id) ?? [];
      if (matches.length === 0) continue;
      if (candidates.some((c) => matches.every((token) => c.matches.includes(token)))) continue;
      candidates.push({ id: chunk.id, matches });
    }
    let ids: string[] = [];
    const search = (from: number, picked: number[], size: number): boolean => {
      if (picked.length === size) {
        const covered = new Set(picked.flatMap((i) => candidates[i].matches));
        if (covered.size < qualifierTokens.length) return false;
        ids = picked.map((i) => candidates[i].id);
        return true;
      }
      for (let i = from; i < candidates.length; i += 1) if (search(i + 1, [...picked, i], size)) return true;
      return false;
    };
    for (let size = 1; size <= Math.min(citationBudget, candidates.length); size += 1) if (search(0, [], size)) break;
    // Keep the citation order aligned with the source order.
    return chunks.filter((chunk) => ids.includes(chunk.id)).map((chunk) => chunk.id);
  };
  const citationChunkIds: string[] = [];
  const documents = buildDocumentBreakdown(scopedResults, extractQuoteCards(scopedResults, args.query))
    .filter((document) => {
      const ids = coveringChunkIds(document.document_id);
      if (ids.length === 0 || citationChunkIds.length + ids.length > citationBudget) return false;
      citationChunkIds.push(...ids);
      return true;
    })
    .slice(0, citationBudget);
  // Remaining budget goes to the named documents' other matching chunks, as before.
  for (const result of scopedResults) {
    if (citationChunkIds.length >= citationBudget) break;
    if (citationChunkIds.includes(result.id)) continue;
    if (documents.some((document) => document.document_id === result.document_id)) citationChunkIds.push(result.id);
  }
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
