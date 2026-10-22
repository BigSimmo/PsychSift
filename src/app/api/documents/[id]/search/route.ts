import { NextResponse } from "next/server";
import { z } from "zod";
import { rateLimitJsonResponse } from "@/lib/api-rate-limit";
import { demoChunks, getDemoDocument } from "@/lib/demo-data";
import { isDemoMode } from "@/lib/env";
import { jsonError, publicErrorResponse } from "@/lib/http";
import { matchesTermInWords, wordBoundaryWords } from "@/lib/keyword-query";
import { committedIndexGeneration, isCommittedGenerationMetadata } from "@/lib/reindex-pipeline";
import { createAdminClient } from "@/lib/supabase/admin";
import { AuthenticationError, unauthorizedResponse } from "@/lib/supabase/auth";
import { requireSignedInClinicalAccess } from "@/lib/clinical-access";
import { enforceDocumentReadRateLimit, withOwnerReadScope } from "@/lib/public-api-access";
import { parseRouteParams } from "@/lib/validation/params";
import { parseRequestQuery, queryInteger } from "@/lib/validation/query";
import {
  assertDocumentChunkSearchRpcRows,
  assertDocumentChunkSearchTableRows,
  type DocumentChunkSearchRow,
} from "@/lib/validation/row-contracts";

export const runtime = "nodejs";

const maxSearchTerms = 8;
const defaultSearchLimit = 20;
const maxSearchLimit = 60;
const documentSearchQuerySchema = z.object({
  q: z.string().optional().default("").transform(normalizeSearchQuery),
  limit: queryInteger({ fallback: defaultSearchLimit, min: 1, max: maxSearchLimit }),
});
const documentSearchParamsSchema = z.object({
  id: z.string().uuid(),
});
const softStopTerms = new Set([
  "the",
  "and",
  "for",
  "with",
  "what",
  "when",
  "where",
  "which",
  "should",
  "must",
  "does",
  "this",
  "that",
  "document",
  "section",
  "page",
]);

function normalizeSearchQuery(value: string | null) {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function searchTermsFor(query: string) {
  return Array.from(
    new Set(
      query
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .split(/\s+/)
        .map((term) => term.trim())
        .filter((term) => term.length >= 2),
    ),
  ).slice(0, maxSearchTerms);
}

function ilikeSafeTerm(value: string) {
  return value.replace(/[%_,]/g, " ").trim();
}

function importantTermsFor(terms: string[]) {
  return terms.filter((term) => term.length >= 3 && !softStopTerms.has(term)).slice(0, 6);
}

function coveredTermsFor(row: DocumentChunkSearchRow, terms: string[]) {
  const haystackWords = wordBoundaryWords(`${row.section_heading ?? ""} ${row.content}`);
  return terms.filter((term) => matchesTermInWords(haystackWords, term));
}

function snippetFor(content: string, terms: string[], limit = 320) {
  const compact = content.replace(/\s+/g, " ").trim();
  if (!compact) return "";

  const hitIndex = terms.reduce((best, term) => {
    const escapedTerm = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = new RegExp(`(^|[^a-z0-9])(${escapedTerm})`, "i").exec(compact);
    const index = match ? match.index + (match[1]?.length ?? 0) : -1;
    return index >= 0 && (best < 0 || index < best) ? index : best;
  }, -1);

  if (hitIndex < 0) return compact.length > limit ? `${compact.slice(0, limit - 3).trim()}...` : compact;

  const start = Math.max(0, hitIndex - Math.floor(limit / 3));
  const end = Math.min(compact.length, start + limit);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < compact.length ? "..." : "";
  return `${prefix}${compact.slice(start, end).trim()}${suffix}`;
}

function scoreChunk(row: DocumentChunkSearchRow, query: string, terms: string[]) {
  const heading = row.section_heading?.toLowerCase() ?? "";
  const content = row.content.toLowerCase();
  const normalizedQuery = query.toLowerCase();
  const importantTerms = importantTermsFor(terms);
  const coveredImportantTerms = coveredTermsFor(row, importantTerms);
  const textRank = Number(row.text_rank ?? 0);
  const trigramScore = Number(row.trigram_score ?? 0);
  // Each chunk's heading and content are already lowercased above; split with the
  // same /[^a-z0-9]+/ pattern wordBoundaryWords uses after toLowerCase, so we skip
  // a redundant full-string lowercasing allocation per chunk on this hot path.
  const headingWords = heading.split(/[^a-z0-9]+/);
  const contentWords = content.split(/[^a-z0-9]+/);
  const hasExactPhrase =
    content.includes(normalizedQuery) && terms.every((term) => matchesTermInWords(contentWords, term));
  let score = hasExactPhrase ? 2.4 : 0;

  for (const term of terms) {
    if (matchesTermInWords(headingWords, term)) score += 1.2;
    if (matchesTermInWords(contentWords, term)) score += 0.55;
  }
  if (importantTerms.length > 1) {
    score += (coveredImportantTerms.length / importantTerms.length) * 0.9;
    if (coveredImportantTerms.length === importantTerms.length) score += 0.8;
    if (coveredImportantTerms.length <= 1) score -= 0.45;
  }
  if (Number.isFinite(textRank) && textRank > 0) score += textRank * 10;
  if (Number.isFinite(trigramScore) && trigramScore > 0) score += trigramScore * 3;

  return Number((score + Math.max(0, 0.15 - row.chunk_index * 0.001)).toFixed(4));
}

function resultFromChunk(row: DocumentChunkSearchRow, query: string, terms: string[]) {
  const matchedTerms = coveredTermsFor(row, terms);

  return {
    id: row.id,
    page_number: row.page_number,
    chunk_index: row.chunk_index,
    section_heading: row.section_heading,
    snippet: snippetFor(row.content, matchedTerms.length ? matchedTerms : terms),
    matched_terms: matchedTerms,
    image_ids: row.image_ids ?? [],
    text_rank: Number.isFinite(Number(row.text_rank)) ? Number(row.text_rank) : null,
    trigram_score: Number.isFinite(Number(row.trigram_score)) ? Number(row.trigram_score) : null,
    score: scoreChunk(row, query, terms),
  };
}

function generationMetadataForRow(row: DocumentChunkSearchRow) {
  return row.index_generation_id ? { index_generation_id: row.index_generation_id } : row.metadata;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: rawId } = await params;
    const { q: query, limit } = parseRequestQuery(request, documentSearchQuerySchema, "Invalid document search query.");
    const terms = searchTermsFor(query);

    if (!query || !terms.length) {
      return NextResponse.json({ query, results: [], pageHits: [], hitCount: 0 });
    }

    if (isDemoMode()) {
      const document = getDemoDocument(rawId);
      if (!document) return publicErrorResponse("Demo document not found.", 404, { code: "document_not_found" });
      const results = demoChunks
        .filter((chunk) => chunk.document_id === rawId)
        .map((chunk) => resultFromChunk(chunk, query, terms))
        .filter((result) => result.matched_terms.length > 0)
        .sort((a, b) => b.score - a.score || a.chunk_index - b.chunk_index)
        .slice(0, limit);

      return NextResponse.json({
        query,
        results,
        pageHits: Array.from(new Set(results.map((result) => result.page_number).filter(Boolean))),
        hitCount: results.length,
        demoMode: true,
      });
    }

    const { id } = parseRouteParams({ id: rawId }, documentSearchParamsSchema, "Invalid document id.");
    const supabase = createAdminClient();
    const { access, rateLimit } = await enforceDocumentReadRateLimit(request, supabase);
    requireSignedInClinicalAccess(access);
    if (rateLimit.limited) {
      return rateLimitJsonResponse("Document requests are rate limited. Try again shortly.", rateLimit);
    }
    const { data: document, error: documentError } = await withOwnerReadScope(
      supabase.from("documents").select("id,metadata,status").eq("id", id),
      access.ownerId,
    ).maybeSingle();

    if (documentError) throw new Error(documentError.message);
    if (!document) return publicErrorResponse("Document not found.", 404, { code: "document_not_found" });
    // Match search_document_chunks: only indexed documents are searchable. Without
    // this gate the portable_ilike fallback (admin client) can surface staged chunks
    // from processing/failed docs when the RPC is unavailable.
    if (document.status !== "indexed") {
      return NextResponse.json({
        query,
        results: [],
        pageHits: [],
        hitCount: 0,
        strategy: "document_not_indexed",
      });
    }
    const committedGeneration = committedIndexGeneration(document.metadata);

    const { data: rpcData, error: rpcError } = await supabase.rpc("search_document_chunks", {
      p_document_id: id,
      p_query: query,
      match_count: limit,
      p_owner_id: access.ownerId,
    });

    if (!rpcError) {
      const rpcRows = rpcData ?? [];
      assertDocumentChunkSearchRpcRows(rpcRows);
      const results = rpcRows
        .filter((row) =>
          isCommittedGenerationMetadata({
            rowMetadata: generationMetadataForRow(row),
            committedGeneration,
          }),
        )
        .map((row) => resultFromChunk(row, query, terms))
        .filter((result) => result.matched_terms.length > 0 && result.score > 0)
        .sort(
          (a, b) =>
            b.score - a.score ||
            (b.text_rank ?? 0) - (a.text_rank ?? 0) ||
            (b.trigram_score ?? 0) - (a.trigram_score ?? 0) ||
            a.chunk_index - b.chunk_index,
        )
        .slice(0, limit);

      return NextResponse.json({
        query,
        results,
        pageHits: Array.from(new Set(results.map((result) => result.page_number).filter(Boolean))),
        hitCount: results.length,
        strategy: "full_text_trigram_rpc",
      });
    }

    const filters = terms
      .map(ilikeSafeTerm)
      .filter(Boolean)
      .flatMap((term) => [`content.ilike.%${term}%`, `section_heading.ilike.%${term}%`])
      .join(",");

    const queryBuilder = supabase
      .from("document_chunks")
      .select("id,page_number,chunk_index,section_heading,content,image_ids,metadata,index_generation_id")
      .eq("document_id", id)
      .order("chunk_index", { ascending: true })
      .limit(Math.min(maxSearchLimit * 3, Math.max(limit * 3, limit)));

    const { data, error } = filters ? await queryBuilder.or(filters) : await queryBuilder;
    if (error) throw new Error(error.message);

    const importantTerms = importantTermsFor(terms);
    const fallbackTableRows = data ?? [];
    assertDocumentChunkSearchTableRows(fallbackTableRows);
    const committedData = fallbackTableRows.filter((row) =>
      isCommittedGenerationMetadata({
        rowMetadata: generationMetadataForRow(row),
        committedGeneration,
      }),
    );
    const candidateRows = committedData.filter((row) => {
      if (importantTerms.length <= 1) return true;
      return importantTerms.every((term) => coveredTermsFor(row, [term]).length > 0);
    });
    const fallbackRows = candidateRows.length ? candidateRows : committedData;
    const results = fallbackRows
      .map((row) => resultFromChunk(row, query, terms))
      .filter((result) => {
        if (importantTerms.length <= 1) return result.matched_terms.length > 0 && result.score > 0;
        const covered = importantTerms.filter((term) => result.matched_terms.includes(term)).length;
        return covered >= Math.min(importantTerms.length, 2) && result.score > 0;
      })
      .sort((a, b) => b.score - a.score || a.chunk_index - b.chunk_index)
      .slice(0, limit);

    return NextResponse.json({
      query,
      results,
      pageHits: Array.from(new Set(results.map((result) => result.page_number).filter(Boolean))),
      hitCount: results.length,
      strategy: "portable_ilike_fallback",
    });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return unauthorizedResponse();
    }
    return jsonError(error);
  }
}
