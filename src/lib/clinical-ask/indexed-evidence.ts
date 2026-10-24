import type { ClinicalAskEvidence, ClinicalAskRequest, SourceReviewState } from "@/lib/clinical-ask/contracts";
import type { RetrievalAccessScope } from "@/lib/owner-scope";
import { searchChunksWithTelemetry } from "@/lib/rag/rag";
import { excludeSupersededEvidence } from "@/lib/rag/superseded-evidence";
import { registryCorpusDetailHref } from "@/lib/registry-corpus-links";
import type { ClinicalSourceMetadata, SearchResult } from "@/lib/types";

const RESULT_LIMIT = 12;
const EXTRACT_LIMIT = 2_000;

function reviewState(metadata: ClinicalSourceMetadata | null | undefined): SourceReviewState {
  if (!metadata) return "unknown";
  if (
    metadata.document_status === "current" &&
    (metadata.clinical_validation_status === "approved" || metadata.clinical_validation_status === "locally_reviewed")
  ) {
    return "reviewed";
  }
  if (
    metadata.document_status === "review_due" ||
    metadata.document_status === "outdated" ||
    metadata.clinical_validation_status === "unverified"
  ) {
    return "needs_review";
  }
  return "unknown";
}

function resultHref(result: SearchResult) {
  const metadata = result.source_metadata;
  const registryHref = registryCorpusDetailHref({
    kind: metadata?.registry_record_kind ?? undefined,
    slug: metadata?.registry_record_slug ?? undefined,
    subkind: metadata?.registry_record_subkind ?? undefined,
    recordId: metadata?.registry_record_id ?? undefined,
  });
  if (registryHref) return registryHref;
  return `/documents/${encodeURIComponent(result.document_id)}?page=${result.page_number ?? 1}&chunk=${encodeURIComponent(result.id)}`;
}

function toEvidence(result: SearchResult): ClinicalAskEvidence | null {
  const extract = result.content.trim().slice(0, EXTRACT_LIMIT);
  if (!extract) return null;
  const metadata = result.source_metadata;
  return {
    id: `indexed:${result.id}`,
    tier: "indexed",
    title: metadata?.source_title?.trim() || result.title.trim() || result.file_name,
    publisher: metadata?.publisher?.trim() || "Indexed organisational document",
    jurisdiction: metadata?.jurisdiction ?? null,
    href: resultHref(result),
    extract,
    reviewState: reviewState(metadata),
    publishedAt: metadata?.publication_date ?? null,
    updatedAt: metadata?.review_date ?? metadata?.indexed_at ?? null,
    retrievedAt: null,
  };
}

export async function retrieveIndexedEvidence(
  request: ClinicalAskRequest,
  accessScope: RetrievalAccessScope,
  signal: AbortSignal,
): Promise<ClinicalAskEvidence[]> {
  // Indexed documents do not carry a reliable mode/domain field: only
  // registry-backed records have registry_record_kind, while guidelines and
  // other organisational documents intentionally do not. Keep this tier
  // owner-scoped and query-relevant, and do not imply that catalogue domain
  // labels constrain the protected hybrid retrieval ordering.
  const { results } = await searchChunksWithTelemetry({
    query: request.question,
    topK: RESULT_LIMIT,
    accessScope,
    allowGlobalSearch: !accessScope.ownerId,
    signal,
  });
  // Owner rule #BFCTST: a superseded source is never evidence. Answer applied it; Clinical Ask did
  // not (audit E2E-06, 24 Oct 2026).
  return excludeSupersededEvidence(results)
    .slice(0, RESULT_LIMIT)
    .map(toEvidence)
    .filter((item): item is ClinicalAskEvidence => item !== null);
}
