import {
  IngestionAttempt,
  IngestionAttemptError,
  type IngestionFence,
} from "../supabase/functions/_shared/ingestion-attempt";
import { isPartialIndexWriteConflict, isRetryableIngestionError, nextRetryAt } from "../src/lib/ingestion";
import type { JobRow, ShadowGenerationMember, ShadowCoreProducerRows, ShadowProducerPersistence, ShadowProducerFailure } from "./types";
import { randomUUID } from "node:crypto";
import { readShadowWorkerContextV1, readShadowMemberSealReceiptV1, prepareShadowProducerDeclarationV1,
  captureShadowProducerInputV1, readShadowProducerInputV1, createShadowNodeJsonByteEnvelope,
  encodeShadowNodeJsonCanonicalPayload,
  type ShadowWorkerContextV1, type ShadowProducerBatchV1 } from "../scripts/lib/reindex-eval-session";
import { requireExactSourceAnchoredGeneration } from "../supabase/functions/_shared/source-anchored-summary";

/** The actual core sink retains complete candidate families before declaring them. */
export function collectIngestionShadowCoreRows(pending: ShadowCoreProducerRows,
  family: keyof ShadowCoreProducerRows, rows: readonly unknown[]) {
  for (const input of rows) {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("shadow_core_input_invalid");
    const row = readShadowProducerInputV1(captureShadowProducerInputV1(input)).nativeInput as Record<string, unknown>;
    // These are newly planned native IDs, not invented server after-images.
    // No timestamp, generated column or future finalization field is supplied.
    pending[family].push({ ...row, id: row.id ?? randomUUID() });
  }
}

export async function persistIngestionShadowCoreFamily(args: {
  attempt: IngestionAttempt; shadow: ShadowProducerPersistence; pending: ShadowCoreProducerRows;
  family: keyof ShadowCoreProducerRows; producerVersion: string; rpc: Parameters<typeof runIngestionMutation>[1];
}) {
  // Snapshot before yielding: declarations and later batches must describe the
  // same native rows even if the caller changes its pending collection.
  const capturedRows = args.pending[args.family].map(row => captureShadowProducerInputV1(row));
  const rows = capturedRows.map(row => readShadowProducerInputV1(row).nativeInput as Record<string, unknown>);
  await args.shadow.declareBatch({ groupKey: "worker_core", families: [args.family], artifactGenerationId: null,
    producerVersion: args.producerVersion, units: rows.map((row, index) => ({ family: args.family, key: String(row.id), output: capturedRows[index]! })) });
  args.attempt.check();
  for (let offset = 0; offset < rows.length; offset += 50) {
    const payload: Record<string, unknown> = { p_generation: args.shadow.binding.candidateGenerationId,
      p_chunks: [], p_images: [], p_table_facts: [], p_embedding_fields: [], p_index_units: [] };
    payload[`p_${args.family}`] = rows.slice(offset, offset + 50);
    const result = await runIngestionMutation(args.attempt, args.rpc, "write_ingestion_base_artifacts", payload);
    requireSuccessfulIngestionAck(args.attempt, result);
  }
  return rows;
}

/** Capture the actual sanitized quality input before the declaration can yield. */
export async function persistIngestionQuality(args: {
  attempt: IngestionAttempt; rpc: Parameters<typeof runIngestionMutation>[1];
  quality: Record<string, unknown>; producerVersion: string; shadow?: ShadowProducerPersistence;
}) {
  try {
    args.attempt.check();
    const input = args.shadow ? readShadowProducerInputV1(captureShadowProducerInputV1(args.quality)).nativeInput as Record<string, unknown> : args.quality;
    const output = args.shadow ? await args.shadow.declareBatch({ groupKey: "worker_core", families: ["quality"],
      artifactGenerationId: null, producerVersion: args.producerVersion,
      units: [{ family: "quality", key: "singleton", output: input }] }) : null;
    const result = await runIngestionMutation(args.attempt, args.rpc, args.shadow ? "persist_shadow_quality_projection" : "persist_ingestion_index_quality", {
      p_quality: input,
      ...(args.shadow ? { p_generation: args.shadow.binding.candidateGenerationId, p_output_manifest: output } : {}),
    });
    if (args.shadow && (result.ok !== true ||
      result.kind !== "quality_projected" && result.kind !== "unchanged" ||
      typeof result.projection_digest !== "string" || !/^sha256:[0-9a-f]{64}$/.test(result.projection_digest)))
      throw new IngestionAttemptError("ingestion_rpc_invalid");
    return result;
  } catch (error) {
    args.attempt.cancel();
    throw error;
  }
}

/** Persist the final private worker component; this never completes or seals a job. */
export async function persistIngestionShadowWorkerProjection(args: {
  attempt: IngestionAttempt; rpc: Parameters<typeof runIngestionMutation>[1]; shadow: ShadowProducerPersistence;
  producerVersion: string; metadata: Record<string, unknown>;
  counts: { page_count: number; chunk_count: number; image_count: number; status: string; error_message: string | null };
}) {
  try {
    args.attempt.check();
    const input = readShadowProducerInputV1(captureShadowProducerInputV1({
      worker_metadata: args.metadata, document_counts: args.counts,
    })).nativeInput as { worker_metadata: typeof args.metadata; document_counts: typeof args.counts };
    const output = await args.shadow.declareBatch({ groupKey: "projection_aggregate", families: ["document_metadata"],
      artifactGenerationId: null, producerVersion: args.producerVersion,
      units: [{ family: "document_metadata", key: "singleton", output: input }] });
    const result = await runIngestionMutation(args.attempt, args.rpc, "persist_shadow_worker_projection", {
      p_generation: args.shadow.binding.candidateGenerationId, p_output_manifest: output,
      p_metadata: input.worker_metadata, p_counts: input.document_counts,
    });
    if (result.ok !== true ||
      result.kind !== "worker_projected" && result.kind !== "unchanged" ||
      typeof result.projection_digest !== "string" || !/^sha256:[0-9a-f]{64}$/.test(result.projection_digest))
      throw new IngestionAttemptError("ingestion_rpc_invalid");
    return result;
  } catch (error) {
    args.attempt.cancel();
    throw error;
  }
}

export async function prepareIngestionImageStorage(args: {
  attempt: IngestionAttempt; generation: string; extension: string; rpc: Parameters<typeof runIngestionMutation>[1];
}) {
  const prepared = await runIngestionMutation(args.attempt, args.rpc, "prepare_ingestion_image_upload", {
    p_generation: args.generation, p_extension: args.extension,
  });
  const prefix = `${args.attempt.fence.document_id}/${args.attempt.fence.lease_token}/${args.generation}/`;
  if (typeof prepared.storage_path !== "string" || !prepared.storage_path.startsWith(prefix) ||
    !/^[0-9a-f-]{36}\.(png|jpg|jpeg|webp)$/.test(prepared.storage_path.slice(prefix.length))) {
    args.attempt.cancel(); throw new IngestionAttemptError("ingestion_rpc_invalid");
  }
  return prepared.storage_path;
}

/** Select the producer source view without changing the live document or U03 Fence. */
export function selectIngestionEnrichmentGeneration(args: {
  job: JobRow; attempt: IngestionAttempt;
  document: { id: string; owner_id: string | null; index_generation_id: string | null; metadata: unknown };
  shadow?: Pick<ShadowWorkerContextV1, "binding">;
}) {
  try {
    args.attempt.check();
    const { job, document } = args; const fence = args.attempt.fence;
    if (document.id !== job.document_id || document.id !== fence.document_id || document.owner_id !== job.documents.owner_id)
      throw new Error("shadow_generation_identity_invalid");
    if (job.operation !== "shadow_reindex") {
      if (args.shadow) throw new Error("shadow_generation_identity_invalid");
      const generation = requireExactSourceAnchoredGeneration(document.index_generation_id, document.metadata);
      if (generation !== fence.expected_generation_id || generation !== job.lease_write_generation_id)
        throw new Error("source_anchored_summary_requires_active_generation");
      return generation;
    }
    const binding = args.shadow?.binding;
    if (!binding || binding.source.documentId !== document.id || binding.source.ownerId !== document.owner_id ||
      binding.jobId !== job.id || binding.jobId !== fence.job_id || binding.firstLeaseToken !== fence.lease_token ||
      binding.source.authorityDigest !== fence.authority_digest || binding.source.baselineGenerationId !== fence.expected_generation_id ||
      binding.candidateGenerationId !== job.lease_write_generation_id || binding.candidateGenerationId !== job.requested_generation_id ||
      binding.candidateGenerationId === binding.source.baselineGenerationId || document.index_generation_id !== binding.source.baselineGenerationId)
      throw new Error("shadow_generation_identity_invalid");
    if (binding.source.baselineGenerationId === null) {
      if (!document.metadata || typeof document.metadata !== "object" || Array.isArray(document.metadata) ||
        Object.hasOwn(document.metadata, "index_generation_id"))
        throw new Error("shadow_generation_identity_invalid");
    } else requireExactSourceAnchoredGeneration(document.index_generation_id, document.metadata);
    return binding.candidateGenerationId;
  } catch (error) {
    args.attempt.cancel();
    throw error;
  }
}

/** Retain the admitted claim checkpoint before heartbeat/progress can advance it. */
export async function declareIngestionShadowClaimControl(args: {
  attempt: IngestionAttempt; shadow: ShadowProducerPersistence;
  controlSnapshot: ShadowWorkerContextV1["controlSnapshot"]; producerVersion: string;
}) {
  try {
    args.attempt.check();
    const output = createShadowNodeJsonByteEnvelope(captureShadowProducerInputV1(args.controlSnapshot), "u04-retained-evidence-v1").envelope;
    await args.shadow.declareBatch({ groupKey: "control", families: ["attempt_control"], artifactGenerationId: null,
      producerVersion: args.producerVersion, units: [{ family: "attempt_control", key: args.shadow.binding.jobId, output }] });
    args.attempt.check();
  } catch (error) { args.attempt.cancel(); throw error; }
}

const shadowUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function shadowTransportObject(value: unknown) {
  const captured = captureShadowProducerInputV1(value);
  if (captured.ownUndefinedPaths.length !== 0) throw new IngestionAttemptError("ingestion_rpc_invalid");
  const input = readShadowProducerInputV1(captured).nativeInput;
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new IngestionAttemptError("ingestion_rpc_invalid");
  return input as Readonly<Record<string, unknown>>;
}

function requireSuccessfulIngestionAck(
  attempt: IngestionAttempt,
  value: Readonly<Record<string, unknown>>,
) {
  if (value.ok !== true) {
    attempt.cancel();
    throw new IngestionAttemptError("ingestion_rpc_invalid");
  }
  return value;
}

function sameShadowValue(left: unknown, right: unknown) {
  return encodeShadowNodeJsonCanonicalPayload(left) === encodeShadowNodeJsonCanonicalPayload(right);
}

function shadowTerminalFence(attempt: IngestionAttempt, shadow: ShadowWorkerContextV1) {
  const fence = attempt.fence;
  const binding = shadow.binding;
  const initialJob = shadow.controlSnapshot.ownNodeJobs[0];
  if (!initialJob || fence.job_kind !== "node" || fence.job_id !== binding.jobId ||
    fence.document_id !== binding.source.documentId || fence.worker_id.trim().length === 0 ||
    fence.lease_token !== binding.firstLeaseToken ||
    fence.expected_generation_id !== binding.source.baselineGenerationId ||
    fence.authority_digest !== binding.source.authorityDigest || binding.artifactGenerationId !== null ||
    !/^sha256:[0-9a-f]{64}$/.test(shadow.planEnvelope.digest) ||
    shadow.executionProfileEnvelope.digest !== binding.source.executionProfileDigest ||
    shadow.originalOriginEnvelope.digest !== binding.source.originDigest ||
    shadow.controlSnapshot.ownNodeJobs.length !== 1 || initialJob.id !== fence.job_id ||
    initialJob.document_id !== fence.document_id || initialJob.locked_by !== fence.worker_id ||
    initialJob.lease_token !== fence.lease_token ||
    initialJob.lease_expected_generation_id !== fence.expected_generation_id ||
    initialJob.lease_authority_digest !== fence.authority_digest)
    throw new Error("shadow_generation_identity_invalid");
  return fence;
}

/** Start the one worker-owned stage after the immutable claim capture and before producer work. */
export async function startIngestionShadowPipelineStage(args: {
  attempt: IngestionAttempt; shadow: ShadowWorkerContextV1; rpc: Parameters<typeof runIngestionMutation>[1];
}) {
  try {
    shadowTerminalFence(args.attempt, args.shadow);
    const result = await runIngestionMutation(args.attempt, args.rpc, "start_ingestion_job_stage", {
      p_stage: "shadow_pipeline", p_metadata: {},
    });
    if (Object.keys(result).sort().join(",") !== "ok,stage_id" || result.ok !== true ||
      typeof result.stage_id !== "string" || !shadowUuid.test(result.stage_id))
      throw new IngestionAttemptError("ingestion_rpc_invalid");
    return result.stage_id;
  } catch (error) {
    args.attempt.cancel();
    throw error;
  }
}

/** Finish the owned stage only after every producer and projection effect has settled. */
export async function finishIngestionShadowPipelineStage(args: {
  attempt: IngestionAttempt; shadow: ShadowWorkerContextV1; stageId: string;
  counts: Readonly<Record<string, unknown>>; rpc: Parameters<typeof runIngestionMutation>[1];
}) {
  try {
    shadowTerminalFence(args.attempt, args.shadow);
    if (!shadowUuid.test(args.stageId)) throw new IngestionAttemptError("ingestion_rpc_invalid");
    const counts = shadowTransportObject(args.counts);
    const result = await runIngestionMutation(args.attempt, args.rpc, "finish_ingestion_job_stage", {
      p_stage_id: args.stageId, p_ok: true, p_counts: counts, p_error: null,
    });
    if (Object.keys(result).sort().join(",") !== "ok" || result.ok !== true)
      throw new IngestionAttemptError("ingestion_rpc_invalid");
  } catch (error) {
    args.attempt.cancel();
    throw error;
  }
}

/**
 * Late private seal. A transport ambiguity or a receipt that does not reproduce
 * the admitted reservation cancels the attempt and cannot enter ordinary completion.
 */
export async function stageIngestionShadowGeneration(args: {
  attempt: IngestionAttempt; shadow: ShadowWorkerContextV1; rpc: Parameters<typeof runIngestionMutation>[1];
}) {
  return args.attempt.serialize(async () => {
    try {
      const fence = shadowTerminalFence(args.attempt, args.shadow);
      const result = await args.rpc("stage_document_index_generation", {
        p_fence: fence, p_generation: args.shadow.binding.candidateGenerationId,
      });
      if (result.error) throw new Error(result.error.message);
      const accepted = args.attempt.accept(shadowTransportObject(result.data));
      if (Object.keys(accepted).sort().join(",") !== "kind,memberContext,memberReceiptEnvelope,ok" ||
        accepted.ok !== true ||
        accepted.kind !== "shadow_staged")
        throw new IngestionAttemptError("ingestion_rpc_invalid");
      const memberContext = shadowTransportObject(accepted.memberContext);
      const receipt = readShadowMemberSealReceiptV1(accepted.memberReceiptEnvelope, memberContext);
      const preSealJob = receipt.finalInventory.preSealControl.payload.ownNodeJobs[0];
      if (!preSealJob || !sameShadowValue(receipt.payload.binding, args.shadow.binding) ||
        memberContext.planDigest !== args.shadow.planEnvelope.digest ||
        !sameShadowValue(memberContext.profileEnvelope, args.shadow.executionProfileEnvelope) ||
        !sameShadowValue(memberContext.originalOriginEnvelope, args.shadow.originalOriginEnvelope) ||
        receipt.finalInventory.preSealControl.payload.ownNodeJobs.length !== 1 ||
        preSealJob.id !== fence.job_id || preSealJob.document_id !== fence.document_id ||
        preSealJob.locked_by !== fence.worker_id || preSealJob.lease_token !== fence.lease_token ||
        preSealJob.lease_expected_generation_id !== fence.expected_generation_id ||
        preSealJob.lease_authority_digest !== fence.authority_digest)
        throw new IngestionAttemptError("ingestion_rpc_invalid");
      args.attempt.check();
      return Object.freeze({ memberReceiptEnvelope: accepted.memberReceiptEnvelope, memberContext });
    } catch (error) {
      args.attempt.cancel();
      throw error;
    }
  });
}

/** Retain full attempted inputs and partial output, atomically fail the shadow job, and stop. */
export async function recordIngestionShadowProducerFailure(args: {
  attempt: IngestionAttempt; shadow: ShadowWorkerContextV1; failure: ShadowProducerFailure;
  readControlRevision: () => Promise<unknown>; rpc: Parameters<typeof runIngestionMutation>[1];
}): Promise<never> {
  return args.attempt.serialize(async () => {
    try {
      const fence = shadowTerminalFence(args.attempt, args.shadow);
      const phases = ["cache_lookup", "image_bytes", "image_classification", "chunk_embeddings",
        "section_context", "table_facts", "visual_index_units",
        "supplemental_embedding_fields", "enrichment_policy", "summary_generation", "document_embedding_fields",
        "deep_sections", "deep_model_profile", "deep_cards", "deep_card_embeddings", "deep_index_units",
        "deep_index_embeddings", "deep_persistence"];
      const failure = args.failure;
      if (!phases.includes(failure.phase) || !["producer_failed", "producer_skipped"].includes(failure.code) ||
        (failure.code === "producer_skipped") !== (failure.phase === "enrichment_policy") ||
        (failure.artifactGenerationId !== null && (!shadowUuid.test(failure.artifactGenerationId) ||
          failure.artifactGenerationId === args.shadow.binding.candidateGenerationId ||
          failure.artifactGenerationId === args.shadow.binding.source.baselineGenerationId)) ||
        failure.phase.startsWith("deep_") !== (failure.artifactGenerationId !== null))
        throw new IngestionAttemptError("ingestion_rpc_invalid");
      const inputEnvelope = createShadowNodeJsonByteEnvelope(captureShadowProducerInputV1(failure.input), "u04-retained-evidence-v1").envelope;
      const partialEnvelope = createShadowNodeJsonByteEnvelope(captureShadowProducerInputV1(failure.partial), "u04-retained-evidence-v1").envelope;
      const { phase, code, artifactGenerationId } = failure;
      const revision = await args.readControlRevision();
      args.attempt.check();
      if (typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 1 ||
        !Number.isSafeInteger(revision + 1)) throw new IngestionAttemptError("ingestion_rpc_invalid");
      const envelope = createShadowNodeJsonByteEnvelope({ kind: "u04-producer-failure-v1", version: 1,
        binding: args.shadow.binding, expectedControlRevision: revision, artifactGenerationId,
        phase, code, inputEnvelope, partialEnvelope }, "u04-retained-evidence-v1").envelope;
      const result = await args.rpc("record_shadow_producer_failure", { p_fence: fence,
        p_generation: args.shadow.binding.candidateGenerationId, p_failure: envelope });
      if (result.error) throw new IngestionAttemptError("ingestion_rpc_invalid");
      const accepted = args.attempt.accept(shadowTransportObject(result.data));
      if (Object.keys(accepted).sort().join(",") !== "control_revision,failure_digest,kind,ok,stage_id" ||
        accepted.ok !== true ||
        accepted.kind !== "shadow_failed" || accepted.failure_digest !== envelope.digest ||
        accepted.control_revision !== revision + 1 || typeof accepted.stage_id !== "string" || !shadowUuid.test(accepted.stage_id))
        throw new IngestionAttemptError("ingestion_rpc_invalid");
      // A successful failure receipt is evidence of failure, never permission to continue.
      args.attempt.cancel();
      throw new IngestionAttemptError("completion_gate_blocked");
    } catch (error) {
      args.attempt.cancel();
      throw error;
    }
  });
}

export async function declareIngestionShadowProducer(args: {
  attempt: IngestionAttempt;
  reservation: Pick<ShadowWorkerContextV1, "binding">;
  batch: ShadowProducerBatchV1;
  readControlRevision: () => Promise<unknown>;
  rpc: Parameters<typeof runIngestionMutation>[1];
}) {
  return args.attempt.serialize(async () => {
    try {
      const fence = args.attempt.fence; const binding = args.reservation.binding;
      if (fence.job_kind !== "node" || fence.job_id !== binding.jobId || fence.document_id !== binding.source.documentId ||
        fence.lease_token !== binding.firstLeaseToken || fence.expected_generation_id !== binding.source.baselineGenerationId ||
        fence.authority_digest !== binding.source.authorityDigest) throw new Error("shadow_generation_identity_invalid");
      const revision = await args.readControlRevision();
      args.attempt.check();
      const prepared = prepareShadowProducerDeclarationV1(binding, revision, args.batch);
      const result = await args.rpc("write_shadow_generation_inventory", { p_fence: fence,
        p_generation: binding.candidateGenerationId, p_declarations: prepared.declarations, p_dispositions: [] });
      if (result.error) throw new Error(result.error.message);
      const accepted = args.attempt.accept(result.data);
      const expectedRevision = prepared.declarations.expectedControlRevision + (accepted.kind === "inventory_written" ? 1 : 0);
      if (Object.keys(accepted).sort().join(",") !== "control_revision,kind,ok,terminal_acceptance" ||
        accepted.ok !== true ||
        (accepted.kind !== "inventory_written" && accepted.kind !== "unchanged") ||
        !Number.isSafeInteger(expectedRevision) || accepted.control_revision !== expectedRevision ||
        accepted.terminal_acceptance !== "unavailable") throw new IngestionAttemptError("ingestion_rpc_invalid");
      return prepared.outputManifestEnvelope;
    } catch (error) {
      args.attempt.cancel();
      throw error;
    }
  });
}

/** Actual entry boundary, before heartbeat, progress, reset, download or provider work. */
export async function prepareIngestionJob(args: {
  job: JobRow;
  attempt: IngestionAttempt;
  loadShadowReservation: () => Promise<unknown>;
  now: () => string;
}) {
  return args.attempt.serialize(async () => {
    try {
      const { job, attempt } = args;
      const fence = attempt.fence;
      if (fence.job_kind !== "node" || job.id !== fence.job_id || job.document_id !== fence.document_id ||
        job.documents.id !== fence.document_id || job.locked_by !== fence.worker_id || job.lease_token !== fence.lease_token ||
        job.lease_authority_digest !== fence.authority_digest || job.lease_expected_generation_id !== fence.expected_generation_id)
        throw new Error("shadow_generation_identity_invalid");
      if (job.operation !== "shadow_reindex") {
        if ((job.operation !== undefined && job.operation !== "standard") || job.requested_generation_id != null || job.shadow_plan_digest != null)
          throw new Error("shadow_generation_identity_invalid");
        return null;
      }
      if (job.batch_id !== null || job.attempt_count !== 1 || job.max_attempts !== 1 ||
        job.requested_generation_id !== job.lease_write_generation_id)
        throw new Error("shadow_generation_identity_invalid");
      const persisted = await args.loadShadowReservation();
      attempt.check();
      const context = readShadowWorkerContextV1(persisted, fence, args.now());
      if (context.binding.candidateGenerationId !== job.lease_write_generation_id || context.planEnvelope.digest !== job.shadow_plan_digest)
        throw new Error("shadow_generation_identity_invalid");
      return context;
    } catch (error) {
      args.attempt.cancel();
      throw error;
    }
  });
}

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

/** Capture the actual repair decision and complete inputs before later metadata writes. */
export async function retainIngestionShadowRepairDecision(args: {
  attempt: IngestionAttempt; shadow: ShadowProducerPersistence; producerVersion: string;
  enrichmentStatus: string; enrichmentErrorMessage: string | null; optionalIndexWriteIssues: readonly unknown[];
}) {
  try {
    args.attempt.check();
    const input = { enrichmentStatus: args.enrichmentStatus, enrichmentErrorMessage: args.enrichmentErrorMessage,
      optionalIssueCount: args.optionalIndexWriteIssues.length };
    const decision = enrichmentRepairDecision(input);
    const output = createShadowNodeJsonByteEnvelope(captureShadowProducerInputV1({
      input, optionalIndexWriteIssues: args.optionalIndexWriteIssues, decision,
    }), "u04-retained-evidence-v1").envelope;
    await args.shadow.declareBatch({ groupKey: "repair", families: ["repair_audit_inputs"], artifactGenerationId: null,
      producerVersion: args.producerVersion, units: [{ family: "repair_audit_inputs", key: "enrichment-repair", output }] });
    args.attempt.check();
    return decision;
  } catch (error) { args.attempt.cancel(); throw error; }
}

/** Importable actual transport seam: transport failure cancels the whole attempt. */
export async function runIngestionMutation(
  attempt: IngestionAttempt,
  rpc: (
    name: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
  name: string | (() => { name: string; payload: Record<string, unknown> }),
  payload: Record<string, unknown> = {},
) {
  return attempt.serialize(async () => {
    attempt.check();
    try {
      const mutation = typeof name === "function" ? name() : { name, payload };
      const result = await rpc(mutation.name, { ...mutation.payload, p_fence: attempt.fence });
      if (result.error) throw new Error(result.error.message);
      return mutation.name === "commit_document_index_generation"
        ? attempt.handoff(result.data, mutation.payload.p_generation)
        : attempt.accept(result.data);
    } catch (error) {
      attempt.cancel();
      throw error;
    }
  });
}

/**
 * Actual core-persistence boundary used by processJob. A shadow core write is not
 * the terminal member seal: enrichment and complete inventory must precede that seal.
 */
export async function writeIngestionCoreGeneration(args: {
  job: JobRow;
  attempt: IngestionAttempt;
  rpc: Parameters<typeof runIngestionMutation>[1];
  generation: string;
  pageCount: number;
  chunkCount: number;
  imageCount: number;
  metadata: Record<string, unknown>;
  pages: unknown[];
  quality: Record<string, unknown>;
  shadowMember?: ShadowGenerationMember;
}) {
  let shadowWrite = false;
  const result = await runIngestionMutation(args.attempt, args.rpc, () => {
    // Read the current Fence only after prior serialized work (including a
    // possible handoff) has settled. A refusal uses the transport's fatal
    // cancellation path, so processJob cannot persist ordinary failure state.
    const fence = args.attempt.fence;
    const { job, shadowMember: member } = args;
    const refuse = () => {
      throw new Error("shadow_generation_identity_invalid");
    };
    if (
      fence.job_kind !== "node" ||
      job.id !== fence.job_id ||
      job.document_id !== fence.document_id ||
      job.documents.id !== fence.document_id ||
      job.locked_by !== fence.worker_id ||
      job.lease_token !== fence.lease_token ||
      job.lease_authority_digest !== fence.authority_digest ||
      job.lease_expected_generation_id !== fence.expected_generation_id ||
      job.lease_write_generation_id !== args.generation
    ) {
      refuse();
    }

    if (job.operation === "shadow_reindex") {
      const wave = member?.shadow_reindex_waves;
      if (
        !member ||
        !wave ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(args.generation) ||
        args.generation === fence.expected_generation_id ||
        job.requested_generation_id !== args.generation ||
        typeof job.shadow_plan_digest !== "string" ||
        !/^sha256:[0-9a-f]{64}$/.test(job.shadow_plan_digest) ||
        job.batch_id !== null ||
        member.document_id !== fence.document_id ||
        member.job_id !== fence.job_id ||
        member.index_generation_id !== args.generation ||
        member.baseline_generation_id !== fence.expected_generation_id ||
        member.first_lease_token !== fence.lease_token ||
        member.authority_digest !== fence.authority_digest ||
        wave.candidate_generation_id !== args.generation ||
        wave.plan_digest !== job.shadow_plan_digest
      ) {
        refuse();
      }
      shadowWrite = true;
      return {
        name: "write_shadow_generation_pages",
        payload: { p_generation: args.generation, p_pages: args.pages },
      };
    }

    if (
      (job.operation !== undefined && job.operation !== "standard") ||
      job.requested_generation_id != null ||
      job.shadow_plan_digest != null ||
      member !== undefined
    ) {
      refuse();
    }
    return {
      name: "commit_document_index_generation",
      payload: {
        p_generation: args.generation,
        p_page_count: args.pageCount,
        p_chunk_count: args.chunkCount,
        p_image_count: args.imageCount,
        p_metadata: args.metadata,
        p_pages: args.pages,
        p_quality: args.quality,
      },
    };
  });
  if (shadowWrite) requireSuccessfulIngestionAck(args.attempt, result);
  return result;
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
  preparedStoragePath?: string;
  row: T;
  rpc: Parameters<typeof runIngestionMutation>[1];
  upload: (storagePath: string, options: { upsert: false }) => Promise<{ error: { message: string } | null }>;
}): Promise<T & { storage_path: string }> {
  const prepared = { storage_path: args.preparedStoragePath ?? await prepareIngestionImageStorage(args) };
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
  const result = await runIngestionMutation(args.attempt, args.rpc, "write_ingestion_base_artifacts", {
    p_generation: args.generation,
    p_chunks: [],
    p_images: [row],
    p_table_facts: [],
    p_embedding_fields: [],
    p_index_units: [],
  });
  requireSuccessfulIngestionAck(args.attempt, result);
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
