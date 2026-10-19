import { committedIndexGeneration } from "@/lib/reindex-pipeline";
import { createAdminClient } from "@/lib/supabase/admin";

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw signal.reason ?? new DOMException("The operation was aborted.", "AbortError");
  }
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

export function sanitizeUnsupportedSummaryAnswer<
  T extends {
    grounded?: boolean;
    confidence?: string;
    bestSource?: unknown;
    supportedClaims?: unknown;
    evidenceAssessments?: unknown;
    smartPanel?: Record<string, unknown> | null;
  },
>(answer: T): T {
  if (!answer.grounded || answer.confidence === "unsupported") {
    answer.bestSource = null;
    answer.supportedClaims = undefined;
    answer.evidenceAssessments = undefined;
    if (answer.smartPanel) {
      answer.smartPanel = { ...answer.smartPanel, bestSource: null };
    }
  }
  return answer;
}
