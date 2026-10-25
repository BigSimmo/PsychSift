import { excludeSupersededEvidence } from "@/lib/rag/superseded-evidence";
import { committedIndexGeneration } from "@/lib/reindex-pipeline";
import { createAdminClient } from "@/lib/supabase/admin";
import type { RagAnswer, SearchResult } from "@/lib/types";

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw signal.reason ?? new DOMException("The operation was aborted.", "AbortError");
  }
}

/**
 * The refusal for a document that cannot be summarised, or null when it can. A superseded document
 * is never used as evidence, including when it is summarised directly (#BFCTST).
 */
export function documentSummaryUnavailableAnswer(results: SearchResult[]): RagAnswer | null {
  const answer = !results.length
    ? "This document has not been indexed yet, so no summary can be generated."
    : excludeSupersededEvidence(results).length === 0
      ? "This document is marked as superseded, so it is not summarised as clinical guidance. Use its current replacement instead."
      : null;
  return answer ? { answer, grounded: false, confidence: "unsupported", citations: [], sources: [] } : null;
}

export async function loadDocumentSummaryContext(documentId: string, ownerId?: string, signal?: AbortSignal) {
  throwIfAborted(signal);
  const supabase = createAdminClient();
  let documentQuery = supabase.from("documents").select("id,title,file_name,status,metadata").eq("id", documentId);

  if (ownerId) {
    documentQuery =
      typeof (documentQuery as { or?: unknown }).or === "function"
        ? documentQuery.or(`owner_id.eq.${ownerId},and(owner_id.is.null,metadata->>public_corpus.eq.true)`)
        : documentQuery.eq("owner_id", ownerId);
  } else {
    documentQuery = documentQuery.is("owner_id", null);
  }
  if (signal) documentQuery = documentQuery.abortSignal(signal);
  const { data: document, error: documentError } = await documentQuery.maybeSingle();

  throwIfAborted(signal);
  if (documentError) throw new Error(documentError.message);
  if (!document) throw new Error("Document not found.");
  const documentStatus = (document as { status?: unknown }).status;
  if (typeof documentStatus === "string" && documentStatus !== "indexed") {
    return { document, chunks: [] };
  }

  const committedGeneration = committedIndexGeneration((document as { metadata?: unknown }).metadata);
  let chunksQuery = supabase
    .from("document_chunks")
    .select(
      "id,document_id,page_number,chunk_index,section_heading,content,retrieval_synopsis,image_ids,index_generation_id",
    )
    .eq("document_id", documentId);
  if (committedGeneration) {
    chunksQuery = chunksQuery.or(`index_generation_id.is.null,index_generation_id.eq.${committedGeneration}`);
  } else if (typeof (chunksQuery as { is?: unknown }).is === "function") {
    chunksQuery = (chunksQuery as typeof chunksQuery & { is: (column: string, value: null) => typeof chunksQuery }).is(
      "index_generation_id",
      null,
    );
  }
  // Committed-generation rows sort ahead of legacy NULL-generation rows so the
  // 40-row cap cannot be filled by legacy chunks alone.
  chunksQuery = chunksQuery
    .order("index_generation_id", { ascending: true, nullsFirst: false })
    .order("chunk_index", { ascending: true })
    .limit(40);
  if (signal) chunksQuery = chunksQuery.abortSignal(signal);
  const { data: chunks, error } = await chunksQuery;

  throwIfAborted(signal);
  if (error) throw new Error(error.message);
  const rows = chunks ?? [];
  // Legacy NULL-generation rows only stand in while the committed generation
  // has written no replacements, matching the commit RPC's preserve rule.
  const hasCommittedRows =
    Boolean(committedGeneration) && rows.some((chunk) => chunk.index_generation_id === committedGeneration);
  const committedChunks = rows.filter((chunk) =>
    chunk.index_generation_id
      ? Boolean(committedGeneration) && chunk.index_generation_id === committedGeneration
      : !hasCommittedRows,
  );
  return { document, chunks: committedChunks };
}

export const UNSUPPORTED_SUMMARY_TEXT =
  "This summary could not be matched to the document's passages, so it is not shown. Read the document directly.";

/**
 * Audit NEW-G-01: the Summarise path skips the final answer gate, so a summary the model itself
 * marked as unsupported was shown as a clean "Clinical summary", wrong figures included. An
 * ungrounded or unsupported summary keeps no text, sections or model-written notes (exact source
 * quotes stay).
 */
export function sanitizeUnsupportedSummaryAnswer<
  T extends {
    answer?: string;
    grounded?: boolean;
    confidence?: string;
    answerSections?: unknown[];
    conflictsOrGaps?: Array<{ origin?: string }>;
    bestSource?: unknown;
    supportedClaims?: unknown;
    evidenceAssessments?: unknown;
    smartPanel?: Record<string, unknown> | null;
  },
>(answer: T): T {
  if (!answer.grounded || answer.confidence === "unsupported") {
    answer.answer = UNSUPPORTED_SUMMARY_TEXT;
    answer.grounded = false;
    answer.confidence = "unsupported";
    answer.answerSections = [];
    answer.conflictsOrGaps = (answer.conflictsOrGaps ?? []).filter((item) => item.origin !== "model");
    answer.bestSource = null;
    answer.supportedClaims = undefined;
    answer.evidenceAssessments = undefined;
    if (answer.smartPanel) {
      answer.smartPanel = { ...answer.smartPanel, bestSource: null };
    }
  }
  return answer;
}
