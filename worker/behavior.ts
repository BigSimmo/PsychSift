import {
  IngestionAttempt,
  IngestionAttemptError,
  type IngestionFence,
} from "../supabase/functions/_shared/ingestion-attempt";
import { isPartialIndexWriteConflict, isRetryableIngestionError, nextRetryAt } from "../src/lib/ingestion";

export type IngestionFailureDecision = {
  retry: boolean;
  documentStatus: "queued" | "failed" | "indexed";
  stage: string;
  errorMessage: string;
  nextRunAt?: string;
};

export function ingestionFailureDecision(args: {
  error: unknown;
  attemptCount: number;
  maxAttempts: number;
  atomicReindex: boolean;
}): IngestionFailureDecision {
  const errorMessage = args.error instanceof Error ? args.error.message : String(args.error);
  const preservedStatus = args.atomicReindex ? "indexed" : "failed";

  if (isPartialIndexWriteConflict(args.error)) {
    return {
      retry: false,
      documentStatus: preservedStatus,
      stage: "needs recovery after partial index write",
      errorMessage: `${errorMessage}. Run npm run recover:ingestion -- --apply before retrying this document.`,
    };
  }

  if (isRetryableIngestionError(args.error) && args.attemptCount < args.maxAttempts) {
    return {
      retry: true,
      documentStatus: args.atomicReindex ? "indexed" : "queued",
      stage: `retry scheduled after attempt ${args.attemptCount}/${args.maxAttempts}`,
      errorMessage,
      nextRunAt: nextRetryAt(args.attemptCount),
    };
  }

  return {
    retry: false,
    documentStatus: preservedStatus,
    stage: "failed",
    errorMessage,
  };
}

export function enrichmentRepairDecision(args: {
  enrichmentStatus: string;
  enrichmentErrorMessage: string | null;
  optionalIssueCount: number;
}) {
  const optionalRepairRequired = args.optionalIssueCount > 0;
  const optionalRepairMessage = "Optional index artifact writes failed; queued for indexing-v3-agent repair.";
  const enrichmentStatus =
    optionalRepairRequired && args.enrichmentStatus === "completed" ? "pending" : args.enrichmentStatus;
  const enrichmentErrorMessage =
    optionalRepairRequired && args.enrichmentStatus === "completed"
      ? optionalRepairMessage
      : args.enrichmentErrorMessage;
  const repairRequired = enrichmentStatus !== "completed" || optionalRepairRequired;

  return {
    enrichmentStatus,
    enrichmentErrorMessage,
    repairRequired,
    repairReason: optionalRepairRequired
      ? "optional_index_write_issues"
      : enrichmentStatus === "failed"
        ? "inline_enrichment_failed"
        : "enrichment_deferred",
    repairMessage:
      enrichmentErrorMessage ??
      (optionalRepairRequired
        ? optionalRepairMessage
        : "Core index complete; enrichment queued for indexing-v3-agent."),
  };
}

/** Importable actual transport seam: transport failure cancels the whole attempt. */
export async function runIngestionMutation(
  attempt: IngestionAttempt,
  rpc: (
    name: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
  name: string,
  payload: Record<string, unknown> = {},
) {
  return attempt.serialize(async () => {
    attempt.check();
    try {
      const result = await rpc(name, { ...payload, p_fence: attempt.fence });
      if (result.error) throw new Error(result.error.message);
      return name === "commit_document_index_generation"
        ? attempt.handoff(result.data, payload.p_generation)
        : attempt.accept(result.data);
    } catch (error) {
      attempt.cancel();
      throw error;
    }
  });
}
export function claimedJobFence(
  job: {
    id: string;
    document_id: string;
    locked_by: string;
    lease_token: string;
    lease_expected_generation_id: string | null;
    lease_authority_digest: string;
  },
  kind: IngestionFence["job_kind"],
): IngestionFence {
  return {
    job_kind: kind,
    job_id: job.id,
    document_id: job.document_id,
    worker_id: job.locked_by,
    lease_token: job.lease_token,
    expected_generation_id: job.lease_expected_generation_id,
    authority_digest: job.lease_authority_digest,
  };
}

/** Actual image publication seam. Late/ambiguous uploads are retained, never compensated destructively. */
export async function persistIngestionImage<T extends Record<string, unknown>>(args: {
  attempt: IngestionAttempt;
  generation: string;
  extension: string;
  row: T;
  rpc: Parameters<typeof runIngestionMutation>[1];
  upload: (storagePath: string, options: { upsert: false }) => Promise<{ error: { message: string } | null }>;
}): Promise<T & { storage_path: string }> {
  const prepared = await runIngestionMutation(args.attempt, args.rpc, "prepare_ingestion_image_upload", {
    p_generation: args.generation,
    p_extension: args.extension,
  });
  const prefix = `${args.attempt.fence.document_id}/${args.attempt.fence.lease_token}/${args.generation}/`;
  if (
    typeof prepared.storage_path !== "string" ||
    !prepared.storage_path.startsWith(prefix) ||
    !/^[0-9a-f-]{36}\.(png|jpg|jpeg|webp)$/.test(prepared.storage_path.slice(prefix.length))
  ) {
    args.attempt.cancel();
    throw new IngestionAttemptError("ingestion_rpc_invalid");
  }
  args.attempt.check();
  const uploaded = await args.upload(prepared.storage_path, { upsert: false });
  args.attempt.check();
  if (uploaded.error) throw new Error(uploaded.error.message);
  const row = { ...args.row, storage_path: prepared.storage_path };
  await runIngestionMutation(args.attempt, args.rpc, "write_ingestion_base_artifacts", {
    p_generation: args.generation,
    p_chunks: [],
    p_images: [row],
    p_table_facts: [],
    p_embedding_fields: [],
    p_index_units: [],
  });
  return row;
}

/** Guard preparation before optional work; ordinary work failures retain their own semantics. */
export async function runIngestionPreparedWork<T>(
  attempt: IngestionAttempt,
  prepare: () => Promise<unknown>,
  work: () => Promise<T>,
): Promise<T> {
  attempt.check();
  try {
    await prepare();
  } catch (error) {
    attempt.cancel();
    throw error;
  }
  attempt.check();
  const result = await work();
  attempt.check();
  return result;
}

/** Actual optional enrichment boundary used by processJob. */
export async function runIngestionEnrichmentStage<T>(attempt: IngestionAttempt, work: () => Promise<T>) {
  attempt.check();
  try {
    const value = await work();
    attempt.check();
    return { status: "completed" as const, value };
  } catch (error) {
    attempt.check();
    if (error instanceof IngestionAttemptError) {
      attempt.cancel();
      throw error;
    }
    return { status: "failed" as const, error };
  }
}
