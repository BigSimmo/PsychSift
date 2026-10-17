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
  let documentQuery = supabase.from("documents").select("id,title,file_name,metadata").eq("id", documentId);

  if (ownerId) {
    documentQuery =
      typeof (documentQuery as { or?: unknown }).or === "function"
        ? documentQuery.or(`owner_id.eq.${ownerId},owner_id.is.null`)
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
    chunksQuery = chunksQuery.eq("index_generation_id", committedGeneration);
  } else if (typeof (chunksQuery as { is?: unknown }).is === "function") {
    chunksQuery = (chunksQuery as typeof chunksQuery & { is: (column: string, value: null) => typeof chunksQuery }).is(
      "index_generation_id",
      null,
    );
  }
  chunksQuery = chunksQuery.order("chunk_index", { ascending: true }).limit(40);
  if (signal) chunksQuery = chunksQuery.abortSignal(signal);
  const { data: chunks, error } = await chunksQuery;

  throwIfAborted(signal);
  if (error) throw new Error(error.message);
  return { document, chunks: chunks ?? [] };
}
