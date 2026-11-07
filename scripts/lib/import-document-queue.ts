type ImportQueuePayload = {
  p_document_id: string;
  p_owner_id: string;
  p_content_hash: string;
  p_batch_id: string;
  p_force: boolean;
  p_max_attempts: number;
};

/** Existing bytes only: this operation cannot create a document or grant source/provider authority. */
export async function queueExistingImportDocument(args: {
  rpc: (
    name: "enqueue_import_document",
    payload: ImportQueuePayload,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
  documentId: string;
  ownerId: string;
  contentHash: string;
  batchId: string;
  force: boolean;
  maxAttempts: number;
}) {
  const { data, error } = await args.rpc("enqueue_import_document", {
    p_document_id: args.documentId,
    p_owner_id: args.ownerId,
    p_content_hash: args.contentHash,
    p_batch_id: args.batchId,
    p_force: args.force,
    p_max_attempts: args.maxAttempts,
  });
  if (error) throw new Error(error.message);
  if (
    !data ||
    typeof data !== "object" ||
    !("outcome" in data) ||
    !["enqueued", "already_active", "skipped"].includes(String(data.outcome))
  ) {
    throw new Error("Import enqueue returned an invalid result; retain existing bytes and retry by exact identity.");
  }
  return data as { outcome: "enqueued" | "already_active" | "skipped" };
}

export function assertExistingImportDocument(document: unknown): asserts document {
  if (!document) {
    throw new Error(
      "New backend intake requires a reviewed source-authority manifest and an implemented authenticated backend admission RPC. No bytes were uploaded. Use the administrator upload path for its supported formats; do not bypass its format, scanner or supplier gates.",
    );
  }
}
