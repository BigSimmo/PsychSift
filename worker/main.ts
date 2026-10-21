import { startRosterOfferAlertConsumer } from "../src/lib/roster/alerts/outbox";
import { createHash, randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import os from "node:os";
import type { SupabaseClient } from "@supabase/supabase-js";
import { IngestionAttempt, IngestionAttemptError } from "../supabase/functions/_shared/ingestion-attempt";
import { ProviderEgressDeniedError } from "../src/lib/document-ingress-safety";
import {
  revokeIngestionProviderEgressContext,
  type IngestionProviderEgressContext,
} from "../src/lib/ingestion-provider-egress";
import { createWorkerProviderEgressContext } from "./provider-egress";
import { captureWorkerException, flushWorkerErrorTracking } from "./observability";
import { env } from "../src/lib/env";
import { ragEnrichmentVersion } from "../src/lib/document-enrichment";
import { ragDeepMemoryVersion } from "../src/lib/deep-memory";
import { extractDocument } from "../src/lib/extractors/document";
import { shouldPersistJobProgress } from "../src/lib/ingestion";
import { embedTexts } from "../src/lib/openai";
import { contentFreeErrorDetails, safeErrorLogDetails } from "../src/lib/privacy";
import { isAtomicReindexCandidate } from "../src/lib/reindex-pipeline";
// Deliberate exception to the "ingestion does not import rag.ts" rule in the archived
// architecture handover: after a document commits, the worker must drop that owner's cached
// retrieval results, and the cache lives in rag.ts. This one call is the only use; keep the
// import narrow and do not reach for other rag.ts exports from the worker.
import { invalidateRagCachesForDocumentMutation } from "../src/lib/rag/rag";
import { createAdminClient } from "../src/lib/supabase/admin";
import { probeSupabaseHealth } from "../src/lib/supabase/health";
import type { TablesUpdate } from "../src/lib/supabase/database.types";
import type { ExtractedDocument } from "../src/lib/types";
import { partitionClaimedJobRows, failRejectedClaimedJobRow, type RejectedClaimedJobRow } from "./row-contracts";
import {
  checkDoclingShadowPrerequisites,
  checkMedspacyPrerequisites,
  checkPythonPdfPrerequisites,
} from "./prerequisites";
import { runShadowExtraction } from "./shadow-extraction";
import {
  CONTROL_PLANE_RPCS,
  WORKER_CONTROL_PLANE_TIMEOUT_MS,
  WORKER_DATA_PLANE_TIMEOUT_MS,
  WORKER_SUPABASE_TIMEOUT_MS,
  resolveWorkerControlPlaneTimeoutMs,
  resolveWorkerDataPlaneTimeoutMs,
  resolveWorkerSupabaseTimeoutMs,
  controlPlaneAbortSignal,
  dataPlaneAbortSignal,
  withControlPlaneAbortClient,
  buildDocumentPageRowsForPersistence,
  serializeDocumentPageRowsForCommit,
  registerClaimedJobAttempt,
  runIngestionStrictCompletion,
  enrichmentRepairDecision,
  ingestionFailureDecision,
  runIngestionMutation,
  startIngestionHeartbeat,
  runIngestionPreparedWork,
  resolveWorkerClaimScopeFilter,
  isPreClaimCandidateAllowed,
  isClaimableIngestionJobCandidate,
} from "./behavior";
import { WorkerRuntimeControl, WorkerAbortError } from "./runtime-control";
import { runWorkerLoop } from "./run-loop";
import { isWorkerClaimLoopPaused, recordClaimProcessed, startWorkerHealthServerIfConfigured } from "./health";
import type { JobRow } from "./types";

export {
  CONTROL_PLANE_RPCS,
  WORKER_CONTROL_PLANE_TIMEOUT_MS,
  WORKER_DATA_PLANE_TIMEOUT_MS,
  WORKER_SUPABASE_TIMEOUT_MS,
  resolveWorkerControlPlaneTimeoutMs,
  resolveWorkerDataPlaneTimeoutMs,
  resolveWorkerSupabaseTimeoutMs,
  controlPlaneAbortSignal,
  dataPlaneAbortSignal,
  withControlPlaneAbortClient,
  isWorkerClaimLoopPaused,
  resolveWorkerClaimScopeFilter,
  isPreClaimCandidateAllowed,
  isClaimableIngestionJobCandidate,
};
import { captureGenerationImages, captureIssuedAttemptControl } from "./generation-evidence";
import { AsyncLocalStorage } from "node:async_hooks";
import type { ManagedPreparedSupplierInput } from "./managed-prepared-supplier";
import type { ManagedAdminPdfCompletionEvidence } from "./managed-admin-pdf-terminal";
import {
  assertManagedProviderEmbeddingBatch,
  type ManagedProviderEmbeddingBatchContext,
  type ManagedProviderEmbeddingRequestContext,
} from "./managed-provider-vectors";
import type { ManagedAdminTextSourceSectionLayout } from "./managed-admin-text-terminal";
import {
  adminSourceRuntimeStartupWarning,
  loadAdminSourceRuntimeOptions,
  type AdminSourceInitializationContext,
} from "./admin-source-runtime";
// The ingestion stages below were extracted from this closure; each receives the runtime's
// services through IngestionStageContext rather than closing over them.
import { insertEmbeddedChunks } from "./chunk-indexing";
import { buildIndexQualityPayload, extractionMetrics } from "./index-quality-payload";
import { runInlineEnrichmentStage } from "./inline-enrichment";
import { optionalIndexWriteWarning, supabaseStageError } from "./ingestion-errors";
import { cleanString, sanitizeJsonbRecord } from "./ingestion-sanitize";
import type { IngestionStageContext, ManagedEmbeddingScope } from "./ingestion-stage-context";
import { createJobProviderEgressContext, initializeManagedAdminGeneration } from "./job-attempt-setup";
import { runManagedGenerationJob } from "./managed-generation-job";

export type WorkerRuntimeOptions = {
  client: SupabaseClient;
  once?: boolean;
  loadObservationsForJob?: (
    job: JobRow,
    attempt: IngestionAttempt,
    batchContext?: ManagedProviderEmbeddingRequestContext,
  ) => Parameters<typeof createWorkerProviderEgressContext>[2];
  /** Optional server-owned original layout; never supplied by document metadata or HTTP input. */
  loadManagedAdminTextSectionLayout?: (
    job: JobRow,
    sourceSha256: string,
  ) => ManagedAdminTextSourceSectionLayout | undefined | Promise<ManagedAdminTextSourceSectionLayout | undefined>;
  /** Server-owned PDF roles must reference actual retained bytes and candidate IDs. */
  loadManagedNativePdfSourceRoles?: (
    input: ManagedPreparedSupplierInput,
  ) => Promise<NonNullable<ManagedPreparedSupplierInput["independentSourceRoles"]>>;
  /** Current authenticated source evidence; ordinary job metadata cannot supply this. */
  loadManagedAdminPdfCompletionEvidence?: (
    input: ManagedPreparedSupplierInput,
  ) => Promise<ManagedAdminPdfCompletionEvidence | undefined>;
  initializeManagedAdminTextGeneration?: (
    job: JobRow,
    attempt: IngestionAttempt,
    context: AdminSourceInitializationContext,
  ) => Promise<void>;
};

/** Importing this module neither creates a provider client nor claims work. */
export function createWorkerRuntime(options: WorkerRuntimeOptions) {
  let activeStopSignal: AbortSignal | undefined;
  const supabase = withControlPlaneAbortClient(options.client, (stopSignal) =>
    controlPlaneAbortSignal(stopSignal ?? activeStopSignal),
  );
  // Dynamic fixed-operation transport is validated by the shared response parser and SQL payload guards.
  const ingestionRpcClient: SupabaseClient = supabase;
  const workerId = `${os.hostname()}-${process.pid}-${randomUUID().slice(0, 8)}`;
  const progressUpdateState = new Map<string, { updatedAt: number; progress: number; stage: string }>();
  const progressUpdateMinIntervalMs = env.WORKER_PROGRESS_UPDATE_MIN_INTERVAL_MS;
  const progressUpdateMinDelta = 4;
  // Audit R1: force a lease-refreshing progress write at least this often so a
  // long silent phase cannot let locked_at age past WORKER_STALE_AFTER_MINUTES
  // and get the live job reclaimed. One-third of the stale window guarantees
  // several heartbeats before staleness; floored at 30s.
  const jobLeaseHeartbeatMs = Math.max(30_000, Math.floor((env.WORKER_STALE_AFTER_MINUTES * 60_000) / 3));
  const maxSupabaseBackoffMs = env.WORKER_HEALTH_BACKOFF_MS;
  const analyzeRagTablesThrottleMs = 45_000;
  let lastAnalyzeRagTablesAt = 0;

  const attempts = new Map<string, IngestionAttempt>();
  const documentAttempts = new Map<string, IngestionAttempt>();
  const providerContexts = new WeakMap<JobRow, IngestionProviderEgressContext>();
  const managedEmbeddingScope: ManagedEmbeddingScope = new AsyncLocalStorage();
  function providerContextForJob(job: JobRow) {
    const context = providerContexts.get(job);
    if (!context) throw new ProviderEgressDeniedError("provider_egress_permit_invalid");
    return context;
  }
  function attemptForJob(jobId: string) {
    const attempt = attempts.get(jobId);
    if (!attempt) throw new IngestionAttemptError("ingestion_attempt_required");
    attempt.check();
    return attempt;
  }
  function attemptForDocument(documentId: string) {
    const attempt = documentAttempts.get(documentId);
    if (!attempt) throw new IngestionAttemptError("ingestion_attempt_required");
    attempt.check();
    return attempt;
  }
  const mutation = (
    attempt: IngestionAttempt,
    name: string,
    args: Record<string, unknown> = {},
    options?: Parameters<typeof runIngestionMutation>[4],
  ) =>
    runIngestionMutation(
      attempt,
      (rpcName, payload) =>
        ingestionRpcClient
          .rpc(rpcName, payload)
          .abortSignal(
            CONTROL_PLANE_RPCS.has(rpcName)
              ? controlPlaneAbortSignal(attempt.signal)
              : dataPlaneAbortSignal(attempt.signal),
          ),
      name,
      args,
      options,
    );
  // The runtime services the extracted ingestion stages use. Every member is the same
  // closure-owned function or client the stages called when they lived in this closure.
  const stageContext: IngestionStageContext = Object.freeze({
    supabase,
    ingestionRpcClient,
    attemptForJob,
    attemptForDocument,
    mutation,
    providerContextForJob,
    updateJob,
    updateJobProgress,
    workerEmbedTexts,
    writeBaseArtifacts,
  });
  async function updateJob(jobId: string, patch: { stage?: string; progress?: number }) {
    await updateJobProgress(jobId, { stage: patch.stage ?? "processing", progress: patch.progress ?? 0 });
  }

  async function updateJobProgress(jobId: string, patch: { stage: string; progress: number }) {
    const attempt = attemptForJob(jobId);
    const previous = progressUpdateState.get(jobId);
    const now = Date.now();

    if (
      !shouldPersistJobProgress({
        previous,
        next: patch,
        now,
        minIntervalMs: progressUpdateMinIntervalMs,
        minDelta: progressUpdateMinDelta,
        heartbeatMs: jobLeaseHeartbeatMs,
      })
    )
      return;
    await mutation(attempt, "update_ingestion_job_progress", { p_stage: patch.stage, p_progress: patch.progress });
    progressUpdateState.set(jobId, { updatedAt: now, ...patch });
  }

  async function patchDocumentState(documentId: string, _ownerId: string | null, patch: TablesUpdate<"documents">) {
    const { metadata, ...state } = patch;
    await mutation(attemptForDocument(documentId), "patch_ingestion_document_state", {
      p_state: state,
      p_metadata: sanitizeJsonbRecord(metadata ?? {}),
    });
  }

  async function updateDocument(documentId: string, ownerId: string | null, patch: TablesUpdate<"documents">) {
    await patchDocumentState(documentId, ownerId, patch);
  }

  async function completeJob(job: JobRow, stage: string) {
    await mutation(attemptForJob(job.id), "complete_ingestion_job", {
      p_batch_id: job.batch_id,
      p_stage: stage,
    });
    invalidateRagCachesForDocumentMutation(job.documents.owner_id ?? "anonymous", {
      affectsPublicCorpus: !job.documents.owner_id,
    });
  }

  async function completeStrictEnrichmentJob(job: JobRow) {
    const attempt = attemptForJob(job.id);
    return runIngestionStrictCompletion(
      attempt,
      (name, payload) => ingestionRpcClient.rpc(name, payload).abortSignal(dataPlaneAbortSignal(attempt.signal)),
      {
        p_stage: "indexed; enrichment completed",
        p_agent_version: "visual-core-v3",
        p_visual_indexing_version: "visual-v3",
      },
    );
  }

  async function failOrRetryJob(args: {
    job: JobRow;
    retry: boolean;
    documentStatus: "queued" | "failed" | "indexed";
    stage: string;
    errorMessage: string;
    nextRunAt?: string;
  }) {
    await mutation(attemptForJob(args.job.id), "fail_or_retry_ingestion_job", {
      p_batch_id: args.job.batch_id,
      p_retry: args.retry,
      p_stage: args.stage,
      p_error_message: args.errorMessage,
      p_next_run_at: args.nextRunAt ?? null,
    });
  }

  function workerBackoffMs(failures: number) {
    return Math.min(maxSupabaseBackoffMs, env.WORKER_POLL_MS * 2 ** Math.max(0, failures - 1));
  }

  async function cleanupExtractedTemporaryPaths(extracted: ExtractedDocument | null) {
    const temporaryPaths = Array.from(new Set(extracted?.temporaryPaths ?? []));
    for (const temporaryPath of temporaryPaths) {
      try {
        await rm(temporaryPath, { recursive: true, force: true });
      } catch (error) {
        console.warn("Temporary extraction cleanup failed", safeErrorLogDetails(error));
      }
    }
  }

  async function refreshRagTableStats() {
    const now = Date.now();
    if (now - lastAnalyzeRagTablesAt < analyzeRagTablesThrottleMs) return;

    const { error } = await supabase.rpc("analyze_rag_tables").abortSignal(controlPlaneAbortSignal(activeStopSignal));
    lastAnalyzeRagTablesAt = now;
    if (!error) return;

    optionalIndexWriteWarning("rag table statistics refresh", supabaseStageError("analyze_rag_tables", error));
  }

  // The declared JobRow[] return is the compile-time proof that the claim contract's
  // inferred row type stays assignable to JobRow — weakening the schema fails here.
  let reportedClaimScopeError: string | null = null;
  async function claimJobs(stopSignal?: AbortSignal): Promise<JobRow[]> {
    if (isWorkerClaimLoopPaused(process.env)) {
      return [];
    }
    const scopeFilter = resolveWorkerClaimScopeFilter(process.env);
    // A malformed allowlist (e.g. "," or a non-UUID ID) must never fall through to the
    // unscoped claim, nor reach the uuid[] RPC parameter and fail every poll.
    if (scopeFilter.claimsNothing) {
      if (scopeFilter.configurationError !== reportedClaimScopeError) {
        reportedClaimScopeError = scopeFilter.configurationError;
        console.error(`Worker claim scope rejected; claiming no jobs: ${scopeFilter.configurationError}`);
      }
      return [];
    }
    const { data, error } = await supabase
      .rpc("claim_ingestion_jobs", {
        p_worker_id: workerId,
        p_claim_limit: env.WORKER_CONCURRENCY,
        p_stale_after_minutes: env.WORKER_STALE_AFTER_MINUTES,
        ...(scopeFilter.active
          ? {
              p_allowed_document_ids: scopeFilter.allowedDocumentIds.size ? [...scopeFilter.allowedDocumentIds] : null,
              p_allowed_file_types: scopeFilter.allowedFileTypes.size ? [...scopeFilter.allowedFileTypes] : null,
            }
          : {}),
      })
      .abortSignal(controlPlaneAbortSignal(stopSignal ?? activeStopSignal));

    if (error) throw supabaseStageError("claim ingestion jobs", error);

    // #212 T4: per-row fail-soft validation. A batch-wide throw here would bypass the job
    // lifecycle entirely — the run-loop claim catch backs off and repolls (and exits the
    // process under --once) — while the RPC has already committed leases and attempt_count
    // increments for every row, orphaning valid siblings. A row that fails the contract is
    // failed terminally instead (a shape mismatch is deterministic; retrying reruns the same
    // to_jsonb over the same columns) and never reaches processJob. Only a row whose claim
    // identity independently parses into a current fence for this worker can be failed.
    const { accepted, rejected } = partitionClaimedJobRows(data ?? []);
    for (const job of accepted) registerClaimedJobAttempt(job, attempts, documentAttempts);
    for (const rejection of rejected) await terminallyFailRejectedClaimedRow(rejection);
    return accepted;
  }

  async function terminallyFailRejectedClaimedRow(rejection: RejectedClaimedJobRow) {
    try {
      if (
        await failRejectedClaimedJobRow(rejection, workerId, (name, payload) =>
          ingestionRpcClient.rpc(name, payload).abortSignal(controlPlaneAbortSignal(activeStopSignal)),
        )
      )
        return;
      console.warn("Claimed job row failed the shape contract without a current worker fence", {
        issues: rejection.error.issues,
      });
    } catch (error) {
      // A stale/replaced fence or a transport failure must not strand valid siblings.
      console.warn("Rejected claimed job terminal transition failed", safeErrorLogDetails(error));
    }
  }

  async function downloadDocument(storagePath: string) {
    const { data, error } = await supabase.storage.from(env.SUPABASE_DOCUMENT_BUCKET).download(storagePath);

    if (error) throw new Error(error.message);
    if (!data) throw new Error("Storage download returned no data.");
    return Buffer.from(await data.arrayBuffer());
  }

  async function resetDocumentIndex(documentId: string, generation: string) {
    await mutation(attemptForDocument(documentId), "reset_ingestion_attempt_artifacts", { p_generation: generation });
  }

  async function commitDocumentIndexGeneration(args: {
    jobId: string;
    documentId: string;
    indexGenerationId: string;
    pageCount: number;
    chunkCount: number;
    imageCount: number;
    metadata: Record<string, unknown>;
    pages: ReturnType<typeof buildDocumentPageRows>;
    quality: ReturnType<typeof buildIndexQualityPayload>;
  }) {
    // Audit L9: p_image_count is searchable-only (insertedImages excludes
    // audit-retained non-searchable rows). Retrieval filters searchable=true, so
    // the persisted count intentionally differs from extracted_image_count.
    await mutation(attemptForJob(args.jobId), "commit_document_index_generation", {
      p_generation: args.indexGenerationId,
      p_page_count: args.pageCount,
      p_chunk_count: args.chunkCount,
      p_image_count: args.imageCount,
      p_metadata: sanitizeJsonbRecord(args.metadata),
      p_pages: serializeDocumentPageRowsForCommit(args.pages, { sanitizeJsonbRecord }),
      p_quality: sanitizeJsonbRecord(args.quality),
    });
    // The fenced response hands the reserved generation to the same serialized attempt.
  }

  function buildDocumentPageRows(documentId: string, extracted: ExtractedDocument) {
    return buildDocumentPageRowsForPersistence(documentId, extracted, { cleanString, sanitizeJsonbRecord });
  }

  async function workerEmbedTexts(
    job: JobRow,
    texts: string[],
    batchContext?: ManagedProviderEmbeddingBatchContext,
    expectedPlanDigest?: string,
  ) {
    const attempt = attemptForJob(job.id);
    if (batchContext) assertManagedProviderEmbeddingBatch(batchContext, expectedPlanDigest ?? "", texts);
    return runIngestionPreparedWork(
      attempt,
      () => mutation(attempt, "heartbeat_ingestion_job"),
      () => {
        const dispatch = () =>
          embedTexts(texts, {
            signal: attempt.signal,
            ingestionEgress: providerContextForJob(job),
            ingestionPurpose: "embedding",
          });
        if (!batchContext) return dispatch();
        assertManagedProviderEmbeddingBatch(batchContext, expectedPlanDigest ?? "", texts);
        return managedEmbeddingScope.run(
          Object.freeze({ job, attempt, producer: batchContext, expectedPlanDigest: expectedPlanDigest! }),
          dispatch,
        );
      },
    );
  }

  async function writeBaseArtifacts(
    job: JobRow,
    generation: string,
    rows: {
      chunks?: unknown[];
      images?: unknown[];
      tableFacts?: unknown[];
      embeddingFields?: unknown[];
      indexUnits?: unknown[];
    },
  ) {
    await mutation(attemptForJob(job.id), "write_ingestion_base_artifacts", {
      p_generation: generation,
      p_chunks: rows.chunks ?? [],
      p_images: rows.images ?? [],
      p_table_facts: rows.tableFacts ?? [],
      p_embedding_fields: rows.embeddingFields ?? [],
      p_index_units: rows.indexUnits ?? [],
    });
  }
  async function processJob(job: JobRow) {
    const attempt = attemptForJob(job.id);
    const issuedControlSnapshot = captureIssuedAttemptControl(job);
    const heartbeat = startIngestionHeartbeat(
      attempt,
      () => mutation(attempt, "heartbeat_ingestion_job", {}, { revokeOnUncertainOutcome: false }),
      { intervalMs: Math.min(60_000, jobLeaseHeartbeatMs), toleranceMs: jobLeaseHeartbeatMs },
    );
    let extracted: ExtractedDocument | null = null;
    const atomicReindex = isAtomicReindexCandidate(job.documents);
    try {
      providerContexts.set(
        job,
        createJobProviderEgressContext(stageContext, options, managedEmbeddingScope, job, attempt),
      );
      // Registration is the explicit adoption authority, captured before public mutations.
      const managedPreparation = await initializeManagedAdminGeneration(
        stageContext,
        options,
        job,
        attempt,
        (original) => {
          extracted = original;
        },
      );
      attempt.check();
      const evidenceInventory = await mutation(attempt, "read_ingestion_generation_inventory", {
        p_generation: job.lease_write_generation_id,
      });
      if (typeof evidenceInventory.managed !== "boolean") throw new Error("invalid_managed_generation_inventory");
      await updateJobProgress(job.id, { stage: "downloading", progress: 5 });
      if (evidenceInventory.managed !== true) {
        if (atomicReindex) {
          await updateDocument(job.document_id, job.documents.owner_id, { error_message: null });
        } else {
          await updateDocument(job.document_id, job.documents.owner_id, { status: "processing", error_message: null });
        }
        await resetDocumentIndex(job.document_id, job.lease_write_generation_id);
      }
      const buffer = await downloadDocument(job.documents.storage_path);
      await updateJobProgress(job.id, { stage: "extracting text/images", progress: 20 });
      const legacyExtractionStartedAt = Date.now();
      if (
        managedPreparation.pdf &&
        `sha256:${createHash("sha256").update(buffer).digest("hex")}` !== managedPreparation.pdf.sourceSha256
      )
        throw new Error("managed_native_pdf_source_changed_after_registration");
      extracted =
        managedPreparation.pdf?.extracted ??
        (await extractDocument({
          buffer,
          fileName: job.documents.file_name,
          mimeType: job.documents.file_type,
        }));
      attempt.check();
      const legacyExtractionWallMs = Date.now() - legacyExtractionStartedAt;
      const capturedImages =
        evidenceInventory.managed === true
          ? (managedPreparation.pdf?.capturedImages ??
            (await captureGenerationImages({
              extracted,
              trustedTemporaryRoots: extracted.temporaryPaths ?? [],
              fileName: job.documents.file_name,
              mimeType: job.documents.file_type,
              check: () => attempt.check(),
            })))
          : [];

      await updateJobProgress(job.id, { stage: "saving pages", progress: 32 });
      const pageRows = buildDocumentPageRows(job.document_id, extracted);
      if (evidenceInventory.managed === true) {
        // Every managed path either completes its own fenced terminal or throws.
        await runManagedGenerationJob(stageContext, options, {
          job,
          attempt,
          heartbeat,
          buffer,
          extracted,
          capturedImages,
          pageRows,
          evidenceInventory,
          issuedControlSnapshot,
        });
        recordClaimProcessed(); // A managed terminal is a successful claim for the health check too
        return;
      }
      const {
        chunks,
        indexedChunkRows,
        indexGenerationId,
        imageCount,
        insertedImages,
        coverImageId,
        skippedImages,
        imageSkipReasons,
        imageTypeCounts,
        optionalIndexWriteIssues,
      } = await insertEmbeddedChunks(stageContext, job, extracted);
      const metrics = extractionMetrics(extracted, skippedImages, imageSkipReasons, imageTypeCounts);

      const initialQuality = buildIndexQualityPayload({
        job,
        metrics,
        chunks,
        insertedImages,
        sectionCount: 0,
        memoryCardCount: 0,
        optionalIndexWriteIssues,
      });

      const indexedAt = new Date().toISOString();
      const coreAgentMessage = "Core index committed; enrichment pending.";
      // R5: send only worker-owned key deltas. apply_document_metadata_patch /
      // commit_document_index_generation deep-merge onto live metadata so
      // concurrent renames and agent patches are not clobbered by a stale job snapshot.
      const committedCoreMetadata = {
        indexed_at: indexedAt,
        index_generation_id: indexGenerationId,
        cover_image_id: coverImageId,
        rag_enrichment_version: ragEnrichmentVersion,
        rag_indexing_version: ragDeepMemoryVersion,
        rag_memory_version: ragDeepMemoryVersion,
        rag_memory_updated_at: null,
        rag_enrichment_updated_at: null,
        enrichment_status: "pending",
        section_count: 0,
        memory_card_count: 0,
        extraction_quality: initialQuality.extraction_quality,
        index_quality_score: initialQuality.quality_score,
        index_quality_issues: initialQuality.issues,
        index_quality_metrics: initialQuality.metrics,
        optional_index_write_issues: optionalIndexWriteIssues,
        indexing_v3_agent_status: "pending",
        indexing_v3_agent_last_error: coreAgentMessage,
        indexing_v3_agent_repair_reason: "core_index_committed",
        indexing_v3_agent_updated_at: indexedAt,
        embedding_model: env.OPENAI_EMBEDDING_MODEL,
        ...metrics,
      };
      // Data-safety gate: never commit an empty generation. Attempt reset touches only
      // this claim's reserved generation, so an empty commit must preserve the previously-good index rather than
      // nothing â€” e.g. an image-only PDF OCR could not read. With 0 chunks and 0
      // searchable images there is nothing to retrieve, so fail the job: the prior
      // committed generation stays live and the document is surfaced to eval
      // governance instead of being silently blanked.
      if (chunks.length === 0 && imageCount === 0) {
        throw new Error(
          `Refusing to commit an empty index generation for document ${job.document_id}: ` +
            "extraction/OCR produced 0 chunks and 0 searchable images.",
        );
      }
      await commitDocumentIndexGeneration({
        jobId: job.id,
        documentId: job.document_id,
        indexGenerationId,
        pageCount: extracted.pages.length,
        chunkCount: chunks.length,
        imageCount,
        metadata: committedCoreMetadata,
        pages: pageRows,
        quality: initialQuality,
      });

      const enrichment = await runInlineEnrichmentStage(stageContext, {
        job,
        attempt,
        indexGenerationId,
        indexedChunkRows,
        metrics,
        chunks,
        insertedImages,
        optionalIndexWriteIssues,
        initialQuality,
      });
      let enrichmentStatus = enrichment.enrichmentStatus;
      let enrichmentErrorMessage = enrichment.enrichmentErrorMessage;
      const { finalQuality, sectionCount, memoryCardCount, enrichmentUpdatedAt } = enrichment;

      // Packet B4 â€” docling shadow extraction. Runs ONLY here: after the legacy generation is
      // committed (the live index never depends on it) and before the final metadata merge
      // (so the aggregate record rides the existing worker-owned write â€” no new write site,
      // no document_index_quality / chunk / embedding / index-unit / table-fact write).
      // Fail-open and bounded (worker/shadow-extraction.ts); null when the mode is "legacy"
      // or the document is outside the cohort, in which case nothing is written.
      let shadowExtraction: Awaited<ReturnType<typeof runShadowExtraction>> = null;
      if (env.WORKER_DOCUMENT_EXTRACTOR_MODE === "shadow") {
        await updateJobProgress(job.id, { stage: "indexed; shadow extraction (docling)", progress: 98 });
        try {
          shadowExtraction = await runShadowExtraction(
            {
              documentId: job.document_id,
              indexGenerationId,
              fileName: job.documents.file_name,
              mimeType: job.documents.file_type,
              buffer,
              legacy: extracted,
              legacyWallMs: legacyExtractionWallMs,
              quality: { issues: finalQuality.issues, metrics: finalQuality.metrics },
            },
            {
              config: {
                mode: env.WORKER_DOCUMENT_EXTRACTOR_MODE,
                cohortPercent: env.WORKER_SHADOW_EXTRACTION_COHORT_PERCENT,
                pythonBin: env.WORKER_DOCLING_PYTHON_BIN,
              },
            },
          );
        } finally {
          attempt.check();
        }
      }

      const repair = enrichmentRepairDecision({
        enrichmentStatus,
        enrichmentErrorMessage,
        optionalIssueCount: optionalIndexWriteIssues.length,
      });
      enrichmentStatus = repair.enrichmentStatus;
      enrichmentErrorMessage = repair.enrichmentErrorMessage;
      const finalMetadata = {
        ...committedCoreMetadata,
        indexed_at: indexedAt,
        index_generation_id: indexGenerationId,
        rag_enrichment_version: ragEnrichmentVersion,
        rag_indexing_version: ragDeepMemoryVersion,
        rag_memory_version: ragDeepMemoryVersion,
        rag_memory_updated_at: enrichmentUpdatedAt,
        rag_enrichment_updated_at: enrichmentUpdatedAt,
        enrichment_status: enrichmentStatus,
        enrichment_error: enrichmentErrorMessage,
        section_count: sectionCount,
        memory_card_count: memoryCardCount,
        extraction_quality: finalQuality.extraction_quality,
        index_quality_score: finalQuality.quality_score,
        index_quality_issues: finalQuality.issues,
        index_quality_metrics: finalQuality.metrics,
        optional_index_write_issues: optionalIndexWriteIssues,
        ...(repair.repairRequired
          ? {
              indexing_v3_agent_status: "pending",
              indexing_v3_agent_last_error: repair.repairMessage,
              indexing_v3_agent_repair_reason: repair.repairReason,
              indexing_v3_agent_updated_at: new Date().toISOString(),
            }
          : {
              indexing_v3_agent_status: "completed",
              // JSON null deletes sticky keys via jsonb_merge_deep (R5).
              indexing_v3_agent_last_error: null,
              indexing_v3_agent_repair_reason: null,
              completion_gate_missing: null,
              indexing_v3_agent_updated_at: enrichmentUpdatedAt ?? new Date().toISOString(),
            }),
        embedding_model: env.OPENAI_EMBEDDING_MODEL,
        ...metrics,
        // B4: aggregate numbers only; absent (not null) outside shadow mode / the cohort so a
        // legacy-mode run never touches an earlier shadow record on the row.
        ...(shadowExtraction ? { shadow_extraction: shadowExtraction } : {}),
        // Audit F04: which reader produced these pages, so a parser defect can be traced to the
        // documents it touched. A document without this key was extracted before it was recorded.
        ...(extracted?.extractor ? { extraction_provenance: { ...extracted.extractor, recorded_at: indexedAt } } : {}),
      };

      await updateDocument(job.document_id, job.documents.owner_id, {
        metadata: finalMetadata,
      });

      let completionStage = enrichmentStatus === "completed" ? "indexed" : "indexed; enrichment deferred";
      if (enrichmentStatus === "completed") {
        const strictCompletion = await completeStrictEnrichmentJob(job);
        if (strictCompletion.completed) {
          recordClaimProcessed(); // Strict completion finished the job; count it for the health check
          invalidateRagCachesForDocumentMutation(job.documents.owner_id ?? "anonymous", {
            affectsPublicCorpus: !job.documents.owner_id,
          });
          await refreshRagTableStats();
          return;
        }
        if (!strictCompletion.completed) {
          completionStage = "indexed; enrichment deferred";
          const strictCompletionMessage = strictCompletion.message ?? "Strict enrichment completion blocked.";
          const strictCompletionRepairReason = strictCompletion.missing.includes("strict_completion_rpc_failed")
            ? "strict_completion_rpc_failed"
            : "strict_completion_gate_blocked";
          await updateDocument(job.document_id, job.documents.owner_id, {
            metadata: {
              ...finalMetadata,
              enrichment_status: "pending",
              enrichment_error: strictCompletionMessage,
              indexing_v3_agent_status: "pending",
              indexing_v3_agent_last_error: strictCompletionMessage,
              indexing_v3_agent_repair_reason: strictCompletionRepairReason,
              indexing_v3_agent_updated_at: new Date().toISOString(),
              completion_gate_missing: strictCompletion.missing,
            },
          });
        }
      }

      await completeJob(job, completionStage);
      recordClaimProcessed(); // Record successful claim processing for health check
      await refreshRagTableStats();
    } catch (error) {
      if (attempt.signal.aborted || error instanceof IngestionAttemptError) {
        attempt.cancel();
        console.warn("Ingestion attempt abandoned; lease recovery owns its outcome");
        return;
      }
      console.error("Ingestion job failed", safeErrorLogDetails(error));
      const decision = ingestionFailureDecision({
        error,
        attemptCount: job.attempt_count,
        maxAttempts: job.max_attempts,
        atomicReindex,
      });
      await failOrRetryJob({ job, ...decision });
    } finally {
      clearInterval(heartbeat);
      const providerContext = providerContexts.get(job);
      if (providerContext) revokeIngestionProviderEgressContext(providerContext);
      providerContexts.delete(job);
      attempt.cancel();
      if (attempts.get(job.id) === attempt) attempts.delete(job.id);
      if (documentAttempts.get(job.document_id) === attempt) documentAttempts.delete(job.document_id);
      await cleanupExtractedTemporaryPaths(extracted);
      // The progress-throttle entry is only needed while this job is processing;
      // drop it so the module-level map does not grow for the worker's lifetime.
      progressUpdateState.delete(job.id);
    }
  }

  async function main() {
    const once = options.once ?? process.argv.includes("--once");
    // The bootstrap entrypoint owns the health server. Keep claim tracking here
    // so /health can report ingestion progress without binding a second port.
    const healthServer = startWorkerHealthServerIfConfigured();
    const controller = new WorkerRuntimeControl();
    controller.attachSignals();
    activeStopSignal = controller.signal;

    const prereqs = await checkPythonPdfPrerequisites();
    console.log(`PsychSift worker started. worker=${workerId}`);
    if (!prereqs.ok) {
      console.warn(`PDF/OCR prerequisite warning: ${prereqs.detail}`);
    }
    if (env.WORKER_MEDSPACY_ASSERTION) {
      const medspacyPrereqs = await checkMedspacyPrerequisites();
      if (!medspacyPrereqs.ok) {
        console.warn(`medspaCy assertion prerequisite warning (tagging will fail open): ${medspacyPrereqs.detail}`);
      }
    }
    if (env.WORKER_DOCUMENT_EXTRACTOR_MODE === "shadow") {
      console.log(
        `Docling shadow extraction enabled (packet B4): cohort ${env.WORKER_SHADOW_EXTRACTION_COHORT_PERCENT}% of ` +
          "index-quality-selected PDFs after legacy commit; aggregate metadata only. Rollback: set WORKER_DOCUMENT_EXTRACTOR_MODE=legacy, then deploy.",
      );
      const doclingPrereqs = await checkDoclingShadowPrerequisites();
      if (!doclingPrereqs.ok) {
        console.warn(
          `Docling shadow prerequisite warning (shadow extraction will fail open): ${doclingPrereqs.detail}`,
        );
      }
    }

    const stopOfferAlerts = startRosterOfferAlertConsumer(supabase, controller.signal);
    try {
      await runWorkerLoop({
        once,
        pollMs: env.WORKER_POLL_MS,
        healthBackoffMs: env.WORKER_HEALTH_BACKOFF_MS,
        maxClaimFailures: env.WORKER_MAX_CLAIM_FAILURES,
        claim: () => claimJobs(controller.signal),
        process: processJob,
        probe: () => probeSupabaseHealth(supabase, controlPlaneAbortSignal(controller.signal)),
        backoff: workerBackoffMs,
        controller,
        isPaused: () => isWorkerClaimLoopPaused(process.env),
        log: (message, level, extra) => (extra ? console[level](message, extra) : console[level](message)),
        captureException: captureWorkerException,
      });
    } finally {
      await stopOfferAlerts();
      healthServer?.close();
    }
    console.log("PsychSift worker stopped gracefully");
    // Flush before exit so any buffered claim/process events are not dropped.
    await flushWorkerErrorTracking();
  }

  return { claimJobs, processJob, run: main, attemptForJob, patchDocumentState };
}

/** Upper bound on the fatal-exit alert, so a stalled webhook cannot delay the exit and restart. */
const FAILURE_WEBHOOK_TIMEOUT_MS = 5_000;

export async function runWorkerMain() {
  try {
    const client = withControlPlaneAbortClient(
      createAdminClient({ timeoutMs: resolveWorkerSupabaseTimeoutMs(process.env) }),
      (stopSignal) => controlPlaneAbortSignal(stopSignal),
    );
    const scannerWarning = adminSourceRuntimeStartupWarning();
    if (scannerWarning) console.warn(scannerWarning);
    const adminSourceOptions = await loadAdminSourceRuntimeOptions(client, env.SUPABASE_DOCUMENT_BUCKET);
    await createWorkerRuntime({ client, ...adminSourceOptions }).run();
    process.exit(0);
  } catch (error) {
    const abort = error instanceof WorkerAbortError ? error : null;
    console.error(
      abort ? "PsychSift worker aborted" : "PsychSift worker stopped unexpectedly",
      contentFreeErrorDetails(error),
    );
    captureWorkerException(error, "fatal");
    const failureDetails = contentFreeErrorDetails(error);
    // WorkerAbortError wraps the underlying failure in `cause`; read its allowlisted code too.
    const failureCode =
      failureDetails.errorCode ??
      (abort?.cause ? contentFreeErrorDetails(abort.cause).errorCode : undefined) ??
      "unclassified";
    if (env.WORKER_FAILURE_WEBHOOK_URL) {
      try {
        await fetch(env.WORKER_FAILURE_WEBHOOK_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: `CRITICAL: PsychSift worker ${abort ? "aborted" : "stopped unexpectedly"}. errorType=${failureDetails.errorType} errorCode=${failureCode}.`,
          }),
          // Bounded so a stalled endpoint cannot hold the exit, and with it Railway's restart.
          signal: AbortSignal.timeout(FAILURE_WEBHOOK_TIMEOUT_MS),
        });
      } catch (webhookError) {
        console.error("Failed to dispatch worker failure webhook", contentFreeErrorDetails(webhookError));
      }
    }
    // Flush last: the process is about to exit and buffered events would be lost.
    await flushWorkerErrorTracking();
    process.exit(abort?.exitCode ?? 1);
  }
}
