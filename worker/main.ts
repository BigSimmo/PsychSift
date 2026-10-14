import { createHash, randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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
import { buildChunks } from "../src/lib/chunking";
import { ragEnrichmentVersion, upsertDocumentEnrichment } from "../src/lib/document-enrichment";
import { ragDeepMemoryVersion, upsertDocumentDeepMemory } from "../src/lib/deep-memory";
import { extractDocument } from "../src/lib/extractors/document";
import { assertEmbeddingDim } from "../src/lib/embedding-dimensions";
import { buildVisualDocumentIndexUnitInputs, embeddingTextForDocumentIndexUnit } from "../src/lib/document-index-units";
import {
  deterministicStructuredVisualProfile,
  normalizeStructuredVisualProfile,
  rankVisualCandidates,
  selectCaptionCandidateIndexes,
  visualIntelligenceVersion,
  type StructuredVisualProfile,
} from "../src/lib/visual-intelligence";
import {
  assessClinicalImageUse,
  cheapImageSkipReason,
  classifiedImageSkipReason,
  clinicalImagePolicyVersion,
  lowSignalImageTextSkipReason,
  lightweightPerceptualHash,
  imagePlacementDedupeKey,
} from "../src/lib/image-filtering";
import { shouldPersistJobProgress } from "../src/lib/ingestion";
import { assessDocumentIndexQuality } from "../src/lib/index-quality";
import { classifyAndCaptionImageFromBase64, embedTexts } from "../src/lib/openai";
import { safeErrorLogDetails, redactCaptionIdentifiers } from "../src/lib/privacy";
import { isAtomicReindexCandidate } from "../src/lib/reindex-pipeline";
// Deliberate exception to the "ingestion does not import rag.ts" rule in the archived
// architecture handover: after a document commits, the worker must drop that owner's cached
// retrieval results, and the cache lives in rag.ts. This one call is the only use; keep the
// import narrow and do not reach for other rag.ts exports from the worker.
import { invalidateRagCachesForDocumentMutation } from "../src/lib/rag/rag";
import { createAdminClient } from "../src/lib/supabase/admin";
import { probeSupabaseHealth } from "../src/lib/supabase/health";
import type { TablesUpdate } from "../src/lib/supabase/database.types";
import type { ExtractedDocument, ImageEvidenceCategory } from "../src/lib/types";
import { buildAdditionalEmbeddingFieldInputs } from "./embedding-fields";
import {
  assertEnrichmentChunkRows,
  assertEnrichmentImageRows,
  partitionClaimedJobRows,
  type RejectedClaimedJobRow,
} from "./row-contracts";
import {
  checkDoclingShadowPrerequisites,
  checkMedspacyPrerequisites,
  checkPythonPdfPrerequisites,
} from "./prerequisites";
import { annotateChunkAssertions, defaultAssertionTargets } from "./assertion-tagging";
import { runShadowExtraction } from "./shadow-extraction";
import { buildTableFactRows } from "./table-facts";
import {
  buildDocumentPageRowsForPersistence,
  serializeDocumentPageRowsForCommit,
  registerClaimedJobAttempt,
  runIngestionStrictCompletion,
  enrichmentRepairDecision,
  ingestionFailureDecision,
  persistIngestionImage,
  runIngestionEnrichmentStage,
  runIngestionMutation,
  runIngestionPreparedWork,
  writeIngestionTableFacts,
  visionImageRejectionSkipReason,
} from "./behavior";
import { WorkerRuntimeControl, WorkerAbortError } from "./runtime-control";
import { runWorkerLoop } from "./run-loop";
import { recordClaimProcessed, startWorkerHealthServerIfConfigured } from "./health";
import type { JobRow } from "./types";
import {
  captureGenerationImages,
  buildGenerationRetentionPacket,
  canDeferOptionalProducerDeclarations,
  resumeGenerationRetentionPacket,
  stageGenerationPrerequisite,
  captureIssuedAttemptControl,
  attachAttemptControlEvidence,
  attachPrerequisiteQualityDiagnostic,
} from "./generation-evidence";
import { decodeRetainedOriginalWitness } from "./original-witness-readback";
import { AsyncLocalStorage } from "node:async_hooks";
import { runManagedPrivateSupplier, type ManagedPreparedSupplierInput } from "./managed-prepared-supplier";
import {
  evaluateManagedAdminPdfCompletion,
  completeManagedAdminPdfAttempt,
  type ManagedAdminPdfCompletionEvidence,
} from "./managed-admin-pdf-terminal";
import {
  assertManagedProviderEmbeddingBatch,
  deriveManagedProviderEmbeddingRequestContext,
  type ManagedProviderEmbeddingBatchContext,
  type ManagedProviderEmbeddingRequestContext,
} from "./managed-provider-vectors";
import { produceManagedVectorFinalPacket, stageManagedVectorFinal } from "./managed-vector-final";
import {
  produceManagedNativeParentClosurePacket,
  stageManagedNativeParentClosure,
} from "./managed-native-parent-closure";
import {
  completeManagedPrivateFixtureAttempt,
  prepareManagedPrivateTerminalPacket,
  PRIVATE_FIXTURE_SOURCE_SHA256,
  buildFixedPrivateFixtureSourceRoles,
} from "./managed-private-terminal";
import {
  assertCandidateChunkApplicability,
  prepareCandidateChunks,
  serializeCandidateChunkRows,
  serializeChunkForPersistence,
  stageCandidateChunks,
} from "./candidate-chunks";
import {
  buildManagedAdminTextChunks,
  prepareManagedAdminTextTerminalPacket,
  prepareManagedAdminTextSections,
  stageManagedAdminTextSections,
  completeManagedAdminTextAttempt,
  type ManagedAdminTextSourceSectionLayout,
} from "./managed-admin-text-terminal";
import { loadAdminSourceRuntimeOptions, type AdminSourceInitializationContext } from "./admin-source-runtime";

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
  const supabase = options.client;
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

  type OptionalIndexWriteIssue = {
    stage: string;
    message: string;
    code?: string | null;
  };

  function supabaseStageError(
    stage: string,
    error: { message?: string; code?: string; details?: string; hint?: string },
  ) {
    const wrapped = new Error(`${stage}: ${error.message ?? "Supabase request failed"}`);
    Object.assign(wrapped, {
      code: error.code,
      details: error.details,
      hint: error.hint,
    });
    return wrapped;
  }

  const attempts = new Map<string, IngestionAttempt>();
  const documentAttempts = new Map<string, IngestionAttempt>();
  const providerContexts = new WeakMap<JobRow, IngestionProviderEgressContext>();
  const managedEmbeddingScope = new AsyncLocalStorage<
    Readonly<{
      job: JobRow;
      attempt: IngestionAttempt;
      producer: ManagedProviderEmbeddingBatchContext;
      expectedPlanDigest: string;
    }>
  >();
  function providerContextForJob(job: JobRow) {
    const context = providerContexts.get(job);
    if (!context) throw new ProviderEgressDeniedError("provider_egress_permit_invalid");
    return context;
  }
  function rethrowTerminalProviderError(error: unknown) {
    if (error instanceof ProviderEgressDeniedError || (error instanceof Error && error.name === "AbortError"))
      throw error;
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
  const mutation = (attempt: IngestionAttempt, name: string, args: Record<string, unknown> = {}) =>
    runIngestionMutation(attempt, (rpcName, payload) => ingestionRpcClient.rpc(rpcName, payload), name, args);
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

  async function updateDocument(documentId: string, _ownerId: string | null, patch: TablesUpdate<"documents">) {
    const { metadata, ...state } = patch;
    await mutation(attemptForDocument(documentId), "patch_ingestion_document_state", {
      p_state: state,
      p_metadata: sanitizeJsonbRecord(metadata ?? {}),
    });
  }

  async function completeJob(job: JobRow, stage: string) {
    await mutation(attemptForJob(job.id), "complete_ingestion_job", {
      p_batch_id: job.batch_id,
      p_stage: stage,
    });
    invalidateRagCachesForDocumentMutation(job.documents.owner_id ?? "anonymous");
  }

  async function completeStrictEnrichmentJob(job: JobRow) {
    return runIngestionStrictCompletion(
      attemptForJob(job.id),
      (name, payload) => ingestionRpcClient.rpc(name, payload),
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

  function optionalIndexWriteWarning(stage: string, error: unknown): OptionalIndexWriteIssue {
    const details = safeErrorLogDetails(error);
    console.warn(`Optional ${stage} write failed`, details);
    return {
      stage,
      message: String(details.message ?? "Optional index write failed."),
      code: typeof details.code === "string" ? details.code : null,
    };
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

    const { error } = await supabase.rpc("analyze_rag_tables");
    lastAnalyzeRagTablesAt = now;
    if (!error) return;

    optionalIndexWriteWarning("rag table statistics refresh", supabaseStageError("analyze_rag_tables", error));
  }

  function noteSkippedImage(skipReasons: Map<string, number>, reason: string) {
    skipReasons.set(reason, (skipReasons.get(reason) ?? 0) + 1);
  }

  // The declared JobRow[] return is the compile-time proof that the claim contract's
  // inferred row type stays assignable to JobRow â€” weakening the schema fails here.
  async function claimJobs(): Promise<JobRow[]> {
    const { data, error } = await supabase.rpc("claim_ingestion_jobs", {
      p_worker_id: workerId,
      p_claim_limit: env.WORKER_CONCURRENCY,
      p_stale_after_minutes: env.WORKER_STALE_AFTER_MINUTES,
    });

    if (error) throw supabaseStageError("claim ingestion jobs", error);

    // #212 T4: per-row fail-soft validation. A batch-wide throw here would bypass the job
    // lifecycle entirely â€” the run-loop claim catch backs off and repolls (and exits the
    // process under --once) â€” while the RPC has already committed leases and attempt_count
    // increments for every row, orphaning valid siblings. A row that fails the contract is
    // failed terminally instead (a shape mismatch is deterministic; retrying reruns the same
    // to_jsonb over the same columns) and never reaches processJob.
    const { accepted, rejected } = partitionClaimedJobRows(data ?? []);
    for (const job of accepted) registerClaimedJobAttempt(job, attempts, documentAttempts);
    for (const rejection of rejected) await terminallyFailRejectedClaimedRow(rejection);
    return accepted;
  }

  async function terminallyFailRejectedClaimedRow(rejection: RejectedClaimedJobRow) {
    // A rejected row has no trustworthy durable fence. Leave it to bounded lease recovery.
    console.warn("Claimed job row failed the shape contract; leaving to stale reclaim", {
      issues: rejection.error.issues,
    });
  }

  async function downloadDocument(storagePath: string) {
    const { data, error } = await supabase.storage.from(env.SUPABASE_DOCUMENT_BUCKET).download(storagePath);

    if (error) throw new Error(error.message);
    if (!data) throw new Error("Storage download returned no data.");
    return Buffer.from(await data.arrayBuffer());
  }

  function cleanString(val: string): string {
    if (typeof val !== "string") return val;
    return val
      .replace(/\u0000/g, "")
      .replace(/\\u0000/g, "")
      .toWellFormed();
  }

  function redactCaptionMetadataValue(value: unknown): unknown {
    if (typeof value === "string") {
      return redactCaptionIdentifiers(cleanString(value));
    }
    if (Array.isArray(value)) {
      return value.map((entry) => redactCaptionMetadataValue(entry));
    }
    if (value !== null && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
          key,
          redactCaptionMetadataValue(entry),
        ]),
      );
    }
    return value;
  }

  function redactImageClassification<T extends ImageClassification>(classification: T): T {
    return {
      ...classification,
      caption: redactCaptionIdentifiers(cleanString(classification.caption)),
      structured_visual_profile: redactCaptionMetadataValue(
        (classification as ImageClassificationWithVisualProfile).structured_visual_profile,
      ) as ImageClassificationWithVisualProfile["structured_visual_profile"],
    } as T;
  }

  type JsonbValue = string | number | boolean | null | { [key: string]: JsonbValue } | JsonbValue[];
  type JsonbRecord = { [key: string]: JsonbValue };

  function sanitizeJsonb(val: unknown): JsonbValue {
    if (typeof val === "string") return cleanString(val);
    if (Array.isArray(val)) return val.map((entry) => sanitizeJsonb(entry));
    if (val !== null && typeof val === "object") {
      const raw = val as { [key: string]: unknown };
      const res: JsonbRecord = {};
      for (const [key, value] of Object.entries(raw)) {
        res[key] = sanitizeJsonb(value);
      }
      return res;
    }
    return val as JsonbValue;
  }

  function sanitizeJsonbRecord(value: unknown): JsonbRecord {
    const sanitized = sanitizeJsonb(value);
    return typeof sanitized === "object" && sanitized !== null && !Array.isArray(sanitized) ? sanitized : {};
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

  async function upsertIndexQuality(quality: ReturnType<typeof buildIndexQualityPayload>) {
    await mutation(attemptForDocument(quality.document_id), "persist_ingestion_index_quality", {
      p_quality: sanitizeJsonbRecord(quality),
    });
  }

  function hashBytes(bytes: Buffer) {
    return createHash("sha256").update(bytes).digest("hex");
  }

  function hashText(text: string) {
    return createHash("sha256").update(text.replace(/\s+/g, " ").trim()).digest("hex");
  }

  function hashEmbeddingFieldContent(content: string) {
    return createHash("md5").update(content).digest("hex");
  }

  function compactSearchText(value: unknown, limit = 900) {
    const compact = String(value ?? "")
      .replace(/\s+/g, " ")
      .trim();
    if (!compact) return "";
    return compact.length > limit ? compact.slice(0, limit).trim() : compact;
  }

  type ImageClassification = Awaited<ReturnType<typeof classifyAndCaptionImageFromBase64>>;
  type ImageClassificationWithVisualProfile = ImageClassification & {
    structured_visual_profile?: StructuredVisualProfile;
    structured_extraction_confidence?: number;
  };

  const imageEvidenceCategories = new Set<ImageEvidenceCategory>([
    "clinical_table",
    "flowchart_algorithm",
    "form_checklist",
    "risk_matrix",
    "medication_chart",
    "graph",
    "screenshot_ui",
    "photo",
    "logo_decorative",
    "unclear",
  ]);
  const imageCaptionCacheVersion = "clinical-image-caption-cache-v2";
  const visionClassificationPromptVersion = "clinical-image-classification-v1";

  function metadataString(metadata: Record<string, unknown> | undefined, key: string) {
    const value = metadata?.[key];
    return typeof value === "string" && value.trim() ? value.trim() : null;
  }

  function compactMetadataText(value: string | null, limit = 1200) {
    if (!value) return null;
    const compact = value.replace(/\s+/g, " ").trim();
    if (!compact) return null;
    return compact.length > limit ? `${compact.slice(0, limit - 3).trim()}...` : compact;
  }

  function imageTableMetadata(image: ExtractedDocument["images"][number]) {
    const metadata = image.metadata ?? {};
    const tableText = metadataString(metadata, "table_text");
    const confidence = Number(metadata.table_confidence);
    return {
      candidateType: metadataString(metadata, "candidate_type"),
      tableLabel: metadataString(metadata, "table_label"),
      tableTitle: metadataString(metadata, "table_title"),
      tableRole: metadataString(metadata, "table_role"),
      tableConfidence: Number.isFinite(confidence) ? confidence : null,
      tableText,
      tableTextSnippet: compactMetadataText(tableText),
      accessibleTableMarkdown: metadataString(metadata, "accessible_table_markdown") ?? tableText,
      tableRows: Array.isArray(metadata.table_rows) ? metadata.table_rows : null,
      tableColumns: Array.isArray(metadata.table_columns) ? metadata.table_columns : null,
    };
  }

  function captionContextHash(args: {
    image: ExtractedDocument["images"][number];
    tableMetadata: ReturnType<typeof imageTableMetadata>;
    nearbyText?: string | null;
  }) {
    const fingerprint = {
      cacheVersion: imageCaptionCacheVersion,
      promptVersion: visionClassificationPromptVersion,
      policyVersion: clinicalImagePolicyVersion,
      visualIntelligenceVersion,
      visionModel: env.OPENAI_VISION_MODEL,
      sourceKind: args.image.sourceKind ?? null,
      width: args.image.width ?? null,
      height: args.image.height ?? null,
      bbox: args.image.bbox ?? null,
      candidateType: args.tableMetadata.candidateType,
      tableLabel: args.tableMetadata.tableLabel,
      tableTitle: args.tableMetadata.tableTitle,
      tableRole: args.tableMetadata.tableRole,
      tableTextSnippet: compactMetadataText(args.tableMetadata.tableText, 900),
      nearbyText: compactSearchText(args.nearbyText ?? "", 900),
    };
    return createHash("sha256").update(JSON.stringify(fingerprint)).digest("hex").slice(0, 32);
  }

  /**
   * Placeholder classification for an image the vision provider refused (audit L12).
   *
   * The image row is still written â€” with a content-free skip_reason naming the
   * rejection â€” so the document completes and the clinician can see WHICH image
   * was skipped, instead of the whole upload failing with a provider error string.
   */
  function visionRejectedClassification(args: {
    skipReason: string;
    tableMetadata: ReturnType<typeof imageTableMetadata>;
    sourceKind?: string | null;
  }) {
    const imageType: ImageEvidenceCategory = args.sourceKind === "table_crop" ? "clinical_table" : "unclear";
    const caption = "Image retained without a caption: the vision provider could not read it.";
    return {
      image_type: imageType,
      caption,
      searchable: false,
      clinical_relevance_score: 0,
      labels: ["needs-review"],
      skip_reason: args.skipReason,
      clinical_use_class: "ambiguous" as const,
      clinical_use_reason: args.skipReason,
      clinical_signal_score: 0,
      admin_signal_score: 0,
      structured_visual_profile: deterministicStructuredVisualProfile({
        imageType,
        caption,
        tableTitle: args.tableMetadata.tableTitle,
        tableLabel: args.tableMetadata.tableLabel,
        tableTextSnippet: args.tableMetadata.tableTextSnippet,
        tableRows: args.tableMetadata.tableRows as string[][] | null,
        tableColumns: args.tableMetadata.tableColumns as string[] | null,
        metadata: {},
      }),
      structured_extraction_confidence: 0,
    } satisfies ImageClassification;
  }

  function nonClinicalTableClassification(args: {
    tableMetadata: ReturnType<typeof imageTableMetadata>;
    sourceKind?: string | null;
    imageType?: ImageEvidenceCategory;
  }) {
    const assessment = assessClinicalImageUse({
      imageType: args.imageType ?? "clinical_table",
      searchable: true,
      clinicalRelevanceScore: 0.4,
      sourceKind: args.sourceKind,
      tableRole: args.tableMetadata.tableRole,
      tableText: args.tableMetadata.tableText,
      tableTitle: args.tableMetadata.tableTitle,
      tableLabel: args.tableMetadata.tableLabel,
    });
    if (assessment.clinical_use_class === "clinical_evidence" || assessment.clinical_use_class === "ambiguous") {
      return null;
    }
    return {
      image_type: args.imageType ?? ("clinical_table" as const),
      searchable: false,
      clinical_relevance_score: 0,
      labels: [],
      caption:
        assessment.clinical_use_class === "administrative"
          ? "Administrative document-control table retained for audit, not clinical evidence."
          : "Reference table retained for audit, not clinical evidence.",
      skip_reason: assessment.clinical_use_reason,
      clinical_use_class: assessment.clinical_use_class,
      clinical_use_reason: assessment.clinical_use_reason,
      clinical_signal_score: assessment.clinical_signal_score,
      admin_signal_score: assessment.admin_signal_score,
      structured_visual_profile: deterministicStructuredVisualProfile({
        imageType: args.imageType ?? "clinical_table",
        caption:
          assessment.clinical_use_class === "administrative"
            ? "Administrative document-control table retained for audit, not clinical evidence."
            : "Reference table retained for audit, not clinical evidence.",
        tableTitle: args.tableMetadata.tableTitle,
        tableLabel: args.tableMetadata.tableLabel,
        tableTextSnippet: args.tableMetadata.tableTextSnippet,
        tableRows: args.tableMetadata.tableRows as string[][] | null,
        tableColumns: args.tableMetadata.tableColumns as string[] | null,
        metadata: {},
      }),
      structured_extraction_confidence: 0.45,
    } satisfies ImageClassification;
  }

  async function uploadAndCaptionImages(
    job: JobRow,
    extracted: ExtractedDocument,
    pagesByNumber: Map<number, string>,
    indexGenerationId: string,
  ) {
    const insertedImages: Array<{
      id: string;
      caption: string;
      pageNumber: number | null;
      imageType: ImageEvidenceCategory;
      sourceKind: string | null;
      labels: string[];
      tableLabel: string | null;
      tableTitle: string | null;
      tableTextSnippet: string | null;
      tableRole: string | null;
      accessibleTableMarkdown: string | null;
      tableRows: string[][] | null;
      tableColumns: string[] | null;
      structuredVisualProfile: StructuredVisualProfile | null;
      candidatePriorityScore: number;
      imageQualityScore: number;
      cropCompleteness: number;
      ocrTextDensity: number;
    }> = [];
    let coverImageId: string | null = null;
    const seenImagePlacements = new Set<string>();
    let skippedImages = 0;
    const skipReasons = new Map<string, number>();
    const imageTypeCounts = new Map<string, number>();
    // Deliberate trade-off (audit L11): image bytes are re-read from disk at
    // each stage (hash here, caption on cache miss, upload) instead of being
    // cached, because holding every extracted image Buffer for a large document
    // (hundreds of multi-MB page images) would multiply the worker's peak
    // memory. Disk I/O is the cheaper resource for this background pipeline.
    const preparedImages: Array<{ imageHash: string; bytesLength: number; perceptualHash: string }> = [];
    for (const image of extracted.images) {
      const bytes = await readFile(image.path);
      preparedImages.push({
        imageHash: hashBytes(bytes),
        bytesLength: bytes.length,
        perceptualHash: lightweightPerceptualHash(bytes, image.width, image.height),
      });
    }
    const scoredCandidates = rankVisualCandidates(
      extracted.images.map((image, index) => ({
        pageNumber: image.pageNumber,
        width: image.width ?? null,
        height: image.height ?? null,
        bbox: image.bbox ?? null,
        sourceKind: image.sourceKind ?? null,
        imageHash: preparedImages[index]?.imageHash ?? null,
        perceptualHash: preparedImages[index]?.perceptualHash ?? null,
        metadata: image.metadata ?? {},
        nearbyText: image.pageNumber ? pagesByNumber.get(image.pageNumber) : null,
      })),
    );
    // Cover thumbnails are display-only; keep them out of the clinical caption budget.
    const selectedCaptionCandidateIndexes = selectCaptionCandidateIndexes(
      scoredCandidates.filter((candidate) => candidate.sourceKind !== "cover_page"),
      env.WORKER_MAX_CAPTIONED_IMAGES_PER_DOCUMENT,
      env.WORKER_MAX_CAPTIONED_IMAGES_PER_PAGE,
    );

    // Keep selection, de-dupe, and budget checks sequential so the chosen images
    // are deterministic; only the expensive cache/model calls run concurrently.
    type CaptionTask = {
      candidate: (typeof scoredCandidates)[number];
      index: number;
      image: ExtractedDocument["images"][number];
      perceptualHash: string;
      imageHash: string;
      nearbyText: string | undefined;
      tableMetadata: ReturnType<typeof imageTableMetadata>;
      contextHash: string;
      presetClassification: ImageClassification | null;
    };

    const captionTasks: CaptionTask[] = [];
    for (const candidate of scoredCandidates) {
      const index = candidate.originalIndex;
      const image = extracted.images[index];
      const preparedImage = preparedImages[index];
      const imageHash = preparedImage.imageHash;
      const skipReason = cheapImageSkipReason({
        bytesLength: preparedImage.bytesLength,
        imageHash,
        seenHashes: seenImagePlacements,
        image,
      });
      if (skipReason) {
        skippedImages += 1;
        noteSkippedImage(skipReasons, skipReason);
        continue;
      }
      const placementKey = imagePlacementDedupeKey({ imageHash, image });
      if (placementKey) seenImagePlacements.add(placementKey);

      const nearbyText = image.pageNumber ? pagesByNumber.get(image.pageNumber) : undefined;
      const tableMetadata = imageTableMetadata(image);
      const contextHash = captionContextHash({ image, tableMetadata, nearbyText });
      const lowSignalSkipReason = lowSignalImageTextSkipReason({
        sourceKind: image.sourceKind ?? null,
        tableRole: tableMetadata.tableRole,
        tableText: tableMetadata.tableText,
        tableTitle: tableMetadata.tableTitle,
        tableLabel: tableMetadata.tableLabel,
        width: image.width ?? null,
        height: image.height ?? null,
      });
      if (
        lowSignalSkipReason &&
        image.sourceKind !== "table_crop" &&
        image.sourceKind !== "cover_page" &&
        !["administrative table without clinical facts"].includes(lowSignalSkipReason)
      ) {
        skippedImages += 1;
        noteSkippedImage(skipReasons, lowSignalSkipReason);
        continue;
      }
      const presetClassification: ImageClassification | null =
        image.sourceKind === "cover_page"
          ? {
              image_type: "unclear",
              caption: "Document cover page preview.",
              searchable: false,
              clinical_relevance_score: 0,
              labels: ["cover-page"],
              skip_reason: "cover page thumbnail",
              clinical_use_class: "decorative_or_empty",
              clinical_use_reason: "First-page cover thumbnail for search cards; not clinical evidence.",
              clinical_signal_score: 0,
              admin_signal_score: 0,
              structured_visual_profile: deterministicStructuredVisualProfile({
                imageType: "unclear",
                caption: "Document cover page preview.",
                tableTitle: null,
                tableLabel: null,
                tableTextSnippet: null,
                tableRows: null,
                tableColumns: null,
                metadata: { source_kind: "cover_page", candidate_type: "document_cover" },
              }),
              structured_extraction_confidence: 0.1,
            }
          : image.sourceKind === "table_crop"
            ? nonClinicalTableClassification({ tableMetadata, sourceKind: image.sourceKind })
            : null;
      const retainUncaptionedForDocumentView =
        ["table_crop", "diagram_crop", "page_region"].includes(image.sourceKind ?? "") &&
        !selectedCaptionCandidateIndexes.has(index);
      if (!presetClassification && !selectedCaptionCandidateIndexes.has(index) && !retainUncaptionedForDocumentView) {
        skippedImages += 1;
        noteSkippedImage(skipReasons, "visual intelligence candidate below caption budget");
        continue;
      }
      const fallbackClassification: ImageClassification | null = retainUncaptionedForDocumentView
        ? {
            image_type: image.sourceKind === "table_crop" ? "clinical_table" : "unclear",
            caption:
              tableMetadata.tableTitle ||
              tableMetadata.tableLabel ||
              (image.sourceKind === "page_region"
                ? "Document page region retained for review."
                : "Document image retained for review."),
            searchable: false,
            clinical_relevance_score: 0,
            labels: ["needs-review"],
            skip_reason: "retained for document view without captioning",
            clinical_use_class: "ambiguous",
            clinical_use_reason: "Retained for document viewing without model captioning.",
            clinical_signal_score: 0,
            admin_signal_score: 0,
            structured_visual_profile: deterministicStructuredVisualProfile({
              imageType: image.sourceKind === "table_crop" ? "clinical_table" : "unclear",
              caption:
                tableMetadata.tableTitle ||
                tableMetadata.tableLabel ||
                (image.sourceKind === "page_region"
                  ? "Document page region retained for review."
                  : "Document image retained for review."),
              tableTitle: tableMetadata.tableTitle,
              tableLabel: tableMetadata.tableLabel,
              tableTextSnippet: tableMetadata.tableTextSnippet,
              tableRows: tableMetadata.tableRows as string[][] | null,
              tableColumns: tableMetadata.tableColumns as string[] | null,
              metadata: {},
            }),
            structured_extraction_confidence: 0.25,
          }
        : null;
      captionTasks.push({
        candidate,
        index,
        image,
        perceptualHash: preparedImage.perceptualHash,
        imageHash,
        nearbyText,
        tableMetadata,
        contextHash,
        presetClassification: presetClassification ?? fallbackClassification,
      });
    }

    const captionConcurrency = env.WORKER_VISION_CONCURRENCY;
    const resolvedTasks: Array<{
      task: CaptionTask;
      classification: ImageClassification;
      classificationCacheHit: boolean;
    }> = [];
    for (let start = 0; start < captionTasks.length; start += captionConcurrency) {
      const batch = captionTasks.slice(start, start + captionConcurrency);
      await updateJobProgress(job.id, {
        stage: `captioning images ${start + 1}-${start + batch.length}/${captionTasks.length}`,
        progress: Math.min(70, 35 + Math.round(((start + batch.length) / Math.max(captionTasks.length, 1)) * 25)),
      });
      const batchResults = await Promise.all(
        batch.map(async (task) => {
          let classification: ImageClassification | null = task.presetClassification;
          // Legacy cached classifications lack admission/source identity. Regenerate under this attempt.
          const classificationCacheHit = false;
          if (!classification) {
            const bytes = await readFile(task.image.path);
            try {
              attemptForJob(job.id).check();
              classification = await runIngestionPreparedWork(
                attemptForJob(job.id),
                () => mutation(attemptForJob(job.id), "heartbeat_ingestion_job"),
                () =>
                  classifyAndCaptionImageFromBase64({
                    signal: attemptForJob(job.id).signal,
                    ingestionEgress: providerContextForJob(job),
                    base64: bytes.toString("base64"),
                    mimeType: task.image.mimeType,
                    nearbyText: task.nearbyText,
                    sourceKind: task.image.sourceKind ?? null,
                    candidateType: task.tableMetadata.candidateType,
                    tableLabel: task.tableMetadata.tableLabel,
                    tableTitle: task.tableMetadata.tableTitle,
                    tableRole: task.tableMetadata.tableRole,
                    tableText: task.tableMetadata.tableText,
                  }),
              );
            } catch (error) {
              // A non-retryable rejection of THIS image must not fail the whole
              // document (audit L12). Anything else â€” rate limits, timeouts,
              // provider outages, unknown faults â€” still propagates.
              attemptForJob(job.id).check();
              rethrowTerminalProviderError(error);
              const skipReason = visionImageRejectionSkipReason(error);
              if (!skipReason) throw error;
              noteSkippedImage(skipReasons, skipReason);
              return {
                task,
                classification: visionRejectedClassification({
                  skipReason,
                  tableMetadata: task.tableMetadata,
                  sourceKind: task.image.sourceKind ?? null,
                }),
                classificationCacheHit: false,
              };
            }
            // Do not publish ingestion output into a legacy cache without admission/source identity.
          }
          return { task, classification, classificationCacheHit };
        }),
      );
      resolvedTasks.push(...batchResults);
    }

    for (const resolved of resolvedTasks) {
      const { task, classificationCacheHit } = resolved;
      const { candidate, image, perceptualHash, imageHash, nearbyText, tableMetadata, contextHash } = task;
      let classification = redactImageClassification(resolved.classification);
      const retainedWithoutCaptioning =
        task.presetClassification?.skip_reason === "retained for document view without captioning";
      const policyAssessment = assessClinicalImageUse({
        imageType: classification.image_type,
        searchable: classification.searchable,
        clinicalRelevanceScore: classification.clinical_relevance_score,
        sourceKind: image.sourceKind ?? null,
        tableRole: tableMetadata.tableRole,
        tableText: tableMetadata.tableText,
        tableTitle: tableMetadata.tableTitle,
        tableLabel: tableMetadata.tableLabel,
        caption: classification.caption,
        labels: classification.labels,
        skipReason: classification.skip_reason,
      });
      classification = {
        ...classification,
        searchable: policyAssessment.searchable,
        clinical_relevance_score: policyAssessment.clinical_relevance_score,
        skip_reason: policyAssessment.searchable ? classification.skip_reason : policyAssessment.clinical_use_reason,
        clinical_use_class: policyAssessment.clinical_use_class,
        clinical_use_reason: policyAssessment.clinical_use_reason,
        clinical_signal_score: policyAssessment.clinical_signal_score,
        admin_signal_score: policyAssessment.admin_signal_score,
        structured_visual_profile: normalizeStructuredVisualProfile(
          redactCaptionMetadataValue(
            (classification as ImageClassificationWithVisualProfile).structured_visual_profile,
          ),
          {
            fallbackText: [
              tableMetadata.tableTitle,
              tableMetadata.tableLabel,
              classification.caption,
              tableMetadata.tableTextSnippet,
              nearbyText,
            ]
              .filter(Boolean)
              .join(" | "),
            fallbackConfidence: classification.clinical_relevance_score,
          },
        ),
      };
      const structuredVisualProfile = (classification as ImageClassificationWithVisualProfile)
        .structured_visual_profile;
      const structuredExtractionConfidence =
        (classification as ImageClassificationWithVisualProfile).structured_extraction_confidence ??
        structuredVisualProfile?.confidence ??
        0.5;

      const classifiedSkipReason = classifiedImageSkipReason(classification);
      const retainAsCover = image.sourceKind === "cover_page";
      const retainAsAuditTable =
        image.sourceKind === "table_crop" &&
        ["administrative", "reference"].includes(policyAssessment.clinical_use_class) &&
        classification.image_type !== "logo_decorative";
      const retainForDocumentView =
        retainAsAuditTable ||
        retainAsCover ||
        (["table_crop", "diagram_crop", "page_region"].includes(image.sourceKind ?? "") && retainedWithoutCaptioning);
      if (classifiedSkipReason && !retainAsAuditTable && !retainForDocumentView) {
        skippedImages += 1;
        noteSkippedImage(skipReasons, classifiedSkipReason);
        continue;
      }
      const persistedSearchable = !retainAsCover && !retainedWithoutCaptioning && policyAssessment.searchable;
      if (persistedSearchable) {
        imageTypeCounts.set(classification.image_type, (imageTypeCounts.get(classification.image_type) ?? 0) + 1);
      }

      const ext = path.extname(image.path) || ".png";
      const bytes = await readFile(image.path);
      const attempt = attemptForJob(job.id);
      const data = await persistIngestionImage({
        attempt,
        generation: indexGenerationId,
        extension: ext.slice(1).toLowerCase(),
        rpc: (name, payload) => ingestionRpcClient.rpc(name, payload),
        upload: (storagePath, options) =>
          supabase.storage
            .from(env.SUPABASE_IMAGE_BUCKET)
            .upload(storagePath, bytes, { contentType: image.mimeType, ...options }),
        row: {
          id: randomUUID(),
          index_generation_id: indexGenerationId,
          document_id: job.document_id,
          page_number: image.pageNumber,
          mime_type: image.mimeType,
          caption: classification.caption,
          bbox: image.bbox ?? null,
          image_type: classification.image_type,
          searchable: persistedSearchable,
          clinical_relevance_score: persistedSearchable ? classification.clinical_relevance_score : 0,
          source_kind: image.sourceKind ?? "embedded",
          width: image.width ?? null,
          height: image.height ?? null,
          image_hash: imageHash,
          perceptual_hash: perceptualHash,
          labels: classification.labels.map(cleanString),
          metadata: sanitizeJsonbRecord({
            ...(image.metadata ?? {}),
            extractor: "local-worker",
            index_generation_id: indexGenerationId,
            image_hash: imageHash,
            perceptual_hash: perceptualHash,
            classification_cache_hit: classificationCacheHit,
            candidate_type: tableMetadata.candidateType ?? image.metadata?.candidate_type ?? null,
            table_label: tableMetadata.tableLabel,
            table_title: tableMetadata.tableTitle,
            table_text: tableMetadata.tableText,
            table_text_snippet: tableMetadata.tableTextSnippet,
            table_role: tableMetadata.tableRole,
            table_confidence: tableMetadata.tableConfidence,
            table_rows: tableMetadata.tableRows,
            table_columns: tableMetadata.tableColumns,
            accessible_table_markdown: tableMetadata.accessibleTableMarkdown,
            clinical_use_class: policyAssessment.clinical_use_class,
            clinical_use_reason: policyAssessment.clinical_use_reason,
            clinical_signal_score: policyAssessment.clinical_signal_score,
            admin_signal_score: policyAssessment.admin_signal_score,
            image_policy_version: clinicalImagePolicyVersion,
            visual_intelligence_version: visualIntelligenceVersion,
            image_caption_cache_version: imageCaptionCacheVersion,
            vision_classification_prompt_version: visionClassificationPromptVersion,
            caption_context_hash: contextHash,
            visual_family_id: image.metadata?.visual_family_id ?? perceptualHash,
            parent_visual_id: image.metadata?.parent_visual_id ?? null,
            candidate_priority_score: candidate.candidatePriorityScore,
            image_quality_score: candidate.imageQualityScore,
            crop_completeness: candidate.cropCompleteness,
            ocr_text_density: candidate.ocrTextDensity,
            caption_confidence: classification.clinical_relevance_score,
            structured_extraction_confidence: structuredExtractionConfidence,
            visual_duplicate_group: candidate.duplicateGroup,
            structured_visual_profile: structuredVisualProfile,
            visual_budget_class: candidate.captionBudgetClass,
            visual_priority_reasons: candidate.reasons,
            retained_for_audit: retainAsAuditTable || undefined,
            retained_for_document_view: retainForDocumentView || undefined,
            skip_reason: retainAsAuditTable ? classifiedSkipReason : classification.skip_reason,
          }),
        },
      });
      if (image.sourceKind === "cover_page" && !coverImageId) {
        coverImageId = data.id;
      }
      // View-only retained images stay out of retrieval indexes: insertedImages
      // feeds document_index_units / embedding fields. searchable=false must not enter.
      if (data.searchable !== false) {
        insertedImages.push({
          id: data.id,
          caption: data.caption,
          pageNumber: data.page_number,
          imageType: imageEvidenceCategories.has(data.image_type as ImageEvidenceCategory)
            ? (data.image_type as ImageEvidenceCategory)
            : "unclear",
          sourceKind: image.sourceKind ?? "embedded",
          labels: data.labels ?? [],
          tableLabel: tableMetadata.tableLabel,
          tableTitle: tableMetadata.tableTitle,
          tableTextSnippet: tableMetadata.tableTextSnippet,
          tableRole: tableMetadata.tableRole,
          accessibleTableMarkdown: tableMetadata.accessibleTableMarkdown,
          tableRows: tableMetadata.tableRows,
          tableColumns: tableMetadata.tableColumns,
          structuredVisualProfile: structuredVisualProfile ?? null,
          candidatePriorityScore: candidate.candidatePriorityScore,
          imageQualityScore: candidate.imageQualityScore,
          cropCompleteness: candidate.cropCompleteness,
          ocrTextDensity: candidate.ocrTextDensity,
        });
      }
    }

    return {
      insertedImages,
      coverImageId,
      skippedImages,
      skipReasons: Object.fromEntries(skipReasons.entries()),
      imageTypeCounts: Object.fromEntries(imageTypeCounts.entries()),
    };
  }

  type IndexedChunkRow = ReturnType<typeof buildChunks>[number] & {
    id: string;
    content_hash: string;
    index_generation_id: string;
    embedding: number[];
  };

  function buildEmbeddingFieldInputs(job: JobRow, chunkRows: IndexedChunkRow[]) {
    const seen = new Set<string>();
    const fields: Array<{
      document_id: string;
      owner_id: string | null;
      source_chunk_id: string;
      field_type: string;
      content: string;
      metadata: Record<string, unknown>;
    }> = [];

    for (const chunk of chunkRows) {
      const sectionPath = chunk.section_path?.length
        ? chunk.section_path.join(" > ")
        : Array.isArray(chunk.metadata?.subsection_path)
          ? (chunk.metadata.subsection_path as unknown[]).map(String).join(" > ")
          : "";
      const content = compactSearchText(
        [job.documents.title, job.documents.file_name, sectionPath, chunk.section_heading].filter(Boolean).join(" | "),
        700,
      );
      if (!content) continue;
      const key = `${chunk.id}:section_context:${content.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      fields.push({
        owner_id: job.documents.owner_id,
        document_id: job.document_id,
        source_chunk_id: chunk.id,
        field_type: "section_context",
        content,
        metadata: {
          chunk_index: chunk.chunk_index,
          page_number: chunk.page_number,
          anchor_id: chunk.anchor_id ?? null,
        },
      });
    }

    return fields;
  }

  function buildIndexQualityPayload(args: {
    job: JobRow;
    metrics: ReturnType<typeof extractionMetrics>;
    chunks: ReturnType<typeof buildChunks>;
    insertedImages: Awaited<ReturnType<typeof uploadAndCaptionImages>>["insertedImages"];
    sectionCount: number;
    memoryCardCount: number;
    documentEmbeddingFieldTypes?: string[];
    optionalIndexWriteIssues?: OptionalIndexWriteIssue[];
  }) {
    const assessment = assessDocumentIndexQuality({
      metrics: args.metrics,
      chunks: args.chunks,
      insertedImages: args.insertedImages,
      sectionCount: args.sectionCount,
      memoryCardCount: args.memoryCardCount,
      documentEmbeddingFieldTypes: args.documentEmbeddingFieldTypes,
    });
    const optionalIssues = args.optionalIndexWriteIssues ?? [];
    const optionalIssueMessages = optionalIssues.map((issue) => `Optional ${issue.stage} write failed.`);
    const extractionQuality =
      optionalIssues.length > 0 && assessment.extractionQuality === "good" ? "partial" : assessment.extractionQuality;

    return {
      document_id: args.job.document_id,
      owner_id: args.job.documents.owner_id,
      quality_score: assessment.qualityScore,
      extraction_quality: extractionQuality,
      issues: [...assessment.issues, ...optionalIssueMessages],
      metrics: {
        ...args.metrics,
        ...assessment.metrics,
        optional_index_write_issues: optionalIssues,
        search_eval_hit_rate: null,
      },
      updated_at: new Date().toISOString(),
    };
  }

  function buildChunkQualityHint(chunks: ReturnType<typeof buildChunks>) {
    const chunkCount = chunks.length;
    const fingerprints = chunks.map((chunk) => hashText(chunk.content));
    const duplicateChunkRatio = chunkCount ? 1 - new Set(fingerprints).size / Math.max(fingerprints.length, 1) : 0;
    const headingDensity = chunkCount ? chunks.filter((chunk) => chunk.section_heading).length / chunkCount : 0;
    return {
      duplicateChunkRatio: Number(duplicateChunkRatio.toFixed(3)),
      headingDensity: Number(headingDensity.toFixed(3)),
    };
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

  async function insertDocumentLevelEmbeddingFields(args: {
    job: JobRow;
    chunkRows: IndexedChunkRow[];
    summary: string | null;
  }) {
    const sourceChunkId = args.chunkRows[0]?.id;
    if (!sourceChunkId) return [];
    const inputs = [
      {
        field_type: "document_title",
        content: compactSearchText(`${args.job.documents.title} ${args.job.documents.file_name}`, 600),
      },
      {
        field_type: "document_summary",
        content: compactSearchText(`${args.job.documents.title} ${args.summary ?? ""}`, 1200),
      },
    ].filter((field) => field.content);
    if (inputs.length === 0) return [];
    const embeddings = await workerEmbedTexts(
      args.job,
      inputs.map((field) => field.content),
    );
    const rows = inputs.map((field, index) => ({
      owner_id: args.job.documents.owner_id,
      document_id: args.job.document_id,
      source_chunk_id: sourceChunkId,
      field_type: field.field_type,
      content: field.content,
      content_hash: hashEmbeddingFieldContent(field.content),
      embedding: assertEmbeddingDim(embeddings[index], `document_embedding_fields.${field.field_type}`),
      metadata: {
        source: "document_level",
        index_generation_id: args.chunkRows[0]?.index_generation_id ?? null,
      },
    }));
    await writeBaseArtifacts(args.job, args.job.lease_write_generation_id, { embeddingFields: rows });
    return rows.map((row) => row.field_type);
  }

  function buildPreparedChunks(
    job: JobRow,
    extracted: ExtractedDocument,
    insertedImages: Awaited<ReturnType<typeof uploadAndCaptionImages>>["insertedImages"],
  ) {
    const chunkMetadata = {
      source_path: job.documents.source_path ?? null,
      content_hash: job.documents.content_hash ?? null,
      index_generation_id: job.lease_write_generation_id,
      embedding_model: env.OPENAI_EMBEDDING_MODEL,
      extractor: "local-worker",
      rag_indexing_version: ragDeepMemoryVersion,
      rag_memory_version: ragDeepMemoryVersion,
    };
    return buildChunks(
      extracted.pages.map((page) => ({
        documentId: job.document_id,
        pageNumber: page.pageNumber,
        pageText: page.text,
        images: insertedImages.filter((image) => image.pageNumber === null || image.pageNumber === page.pageNumber),
        metadata: {
          ...chunkMetadata,
          ocr_used: Boolean(page.ocrUsed),
        },
      })),
    );
  }

  async function annotatePreparedChunks(chunks: ReturnType<typeof buildChunks>) {
    if (env.WORKER_MEDSPACY_ASSERTION) {
      // Fail-open (annotateChunkAssertions never throws): a broken medspaCy install
      // degrades to unannotated chunks, never a failed ingestion job.
      const assertions = await annotateChunkAssertions(
        chunks.map((chunk, index) => ({ id: String(index), text: chunk.content })),
        defaultAssertionTargets(),
      );
      chunks.forEach((chunk, index) => {
        const assertion = assertions.get(String(index));
        if (assertion) chunk.metadata = { ...chunk.metadata, assertion };
      });
    }
  }

  async function insertEmbeddedChunks(job: JobRow, extracted: ExtractedDocument) {
    const pagesByNumber = new Map(extracted.pages.map((page) => [page.pageNumber, page.text] as const));
    const indexGenerationId = job.lease_write_generation_id;
    const imageResult = await uploadAndCaptionImages(job, extracted, pagesByNumber, indexGenerationId);
    const { insertedImages } = imageResult;
    const optionalIndexWriteIssues: OptionalIndexWriteIssue[] = [];
    await updateJob(job.id, { stage: "chunking", progress: 72 });
    const chunks = buildPreparedChunks(job, extracted, insertedImages);
    await annotatePreparedChunks(chunks);
    const indexedChunkRows: IndexedChunkRow[] = [];

    for (let start = 0; start < chunks.length; start += env.WORKER_BATCH_SIZE) {
      const batch = chunks.slice(start, start + env.WORKER_BATCH_SIZE);
      await updateJobProgress(job.id, {
        stage: `embedding chunks ${start + 1}-${start + batch.length}/${chunks.length}`,
        progress: Math.min(94, 75 + Math.round((start / Math.max(chunks.length, 1)) * 18)),
      });

      const embeddings = await workerEmbedTexts(
        job,
        batch.map((chunk) => chunk.content),
      );
      const rows = batch.map((chunk, index) => ({
        ...serializeChunkForPersistence(chunk, {
          id: randomUUID(),
          generationId: indexGenerationId,
          cleanString,
          sanitizeJsonbRecord,
        }),
        embedding: assertEmbeddingDim(embeddings[index], `document_chunks.${chunk.chunk_index}`),
      })) satisfies IndexedChunkRow[];
      indexedChunkRows.push(...rows);

      await writeBaseArtifacts(job, indexGenerationId, { chunks: rows });

      const fieldInputs = buildEmbeddingFieldInputs(job, rows);
      if (fieldInputs.length > 0) {
        try {
          const fieldEmbeddings = await workerEmbedTexts(
            job,
            fieldInputs.map((field) => field.content),
          );
          const fieldRows = fieldInputs.map((field, index) => ({
            ...field,
            content: cleanString(field.content),
            content_hash: hashEmbeddingFieldContent(cleanString(field.content)),
            embedding: assertEmbeddingDim(fieldEmbeddings[index], `document_embedding_fields.section_context.${index}`),
            metadata: sanitizeJsonbRecord({ ...field.metadata, index_generation_id: indexGenerationId }),
          }));
          for (let start = 0; start < fieldRows.length; start += 50) {
            const batch = fieldRows.slice(start, start + 50);
            await writeBaseArtifacts(job, indexGenerationId, { embeddingFields: batch });
          }
        } catch (error) {
          attemptForJob(job.id).check();
          rethrowTerminalProviderError(error);
          optionalIndexWriteIssues.push(optionalIndexWriteWarning("section-context embedding field", error));
        }
      }
    }

    const tableFacts = buildTableFactRows({ job, chunkRows: indexedChunkRows, insertedImages }).map((row) => ({
      ...row,
      table_title: row.table_title ? cleanString(row.table_title) : null,
      row_label: row.row_label ? cleanString(row.row_label) : null,
      clinical_parameter: row.clinical_parameter ? cleanString(row.clinical_parameter) : null,
      threshold_value: row.threshold_value ? cleanString(row.threshold_value) : null,
      action: row.action ? cleanString(row.action) : null,
      metadata: sanitizeJsonbRecord({ ...row.metadata, index_generation_id: indexGenerationId }),
    }));
    if (tableFacts.length > 0) {
      await writeIngestionTableFacts(
        attemptForJob(job.id),
        (name, payload) => ingestionRpcClient.rpc(name, payload),
        indexGenerationId,
        tableFacts,
      );
    }

    const visualIndexUnits = buildVisualDocumentIndexUnitInputs({
      document: {
        id: job.document_id,
        owner_id: job.documents.owner_id,
        title: job.documents.title,
        file_name: job.documents.file_name,
      },
      chunks: indexedChunkRows,
      images: insertedImages,
      tableFacts,
    });
    if (visualIndexUnits.length > 0) {
      try {
        const unitEmbeddings = await workerEmbedTexts(job, visualIndexUnits.map(embeddingTextForDocumentIndexUnit));
        for (let start = 0; start < visualIndexUnits.length; start += 50) {
          const batch = visualIndexUnits.slice(start, start + 50).map((unit, index) => ({
            ...unit,
            embedding: assertEmbeddingDim(
              unitEmbeddings[start + index],
              `document_index_units.visual.${start + index}`,
            ),
            metadata: sanitizeJsonbRecord({ ...unit.metadata, index_generation_id: indexGenerationId }),
          }));
          await writeBaseArtifacts(job, indexGenerationId, { indexUnits: batch });
        }
      } catch (error) {
        attemptForJob(job.id).check();
        rethrowTerminalProviderError(error);
        optionalIndexWriteIssues.push(optionalIndexWriteWarning("visual index unit", error));
      }
    }

    const additionalFieldInputs = buildAdditionalEmbeddingFieldInputs({
      job,
      chunkRows: indexedChunkRows,
      insertedImages,
      tableFacts,
      qualityHint: buildChunkQualityHint(chunks),
    });
    if (additionalFieldInputs.length > 0) {
      try {
        const additionalEmbeddings = await workerEmbedTexts(
          job,
          additionalFieldInputs.map((field) => field.content),
        );
        const additionalRows = additionalFieldInputs.map((field, index) => {
          const content = cleanString(field.content);
          return {
            ...field,
            content,
            content_hash: hashEmbeddingFieldContent(content),
            embedding: assertEmbeddingDim(additionalEmbeddings[index], `document_embedding_fields.${field.field_type}`),
            metadata: sanitizeJsonbRecord({ ...field.metadata, index_generation_id: indexGenerationId }),
          };
        });
        for (let start = 0; start < additionalRows.length; start += 50) {
          const batch = additionalRows.slice(start, start + 50);
          await writeBaseArtifacts(job, indexGenerationId, { embeddingFields: batch });
        }
      } catch (error) {
        attemptForJob(job.id).check();
        rethrowTerminalProviderError(error);
        optionalIndexWriteIssues.push(optionalIndexWriteWarning("supplemental embedding field", error));
      }
    }

    return {
      chunks,
      indexedChunkRows,
      indexGenerationId,
      imageCount: insertedImages.length,
      insertedImages,
      coverImageId: imageResult.coverImageId,
      skippedImages: imageResult.skippedImages,
      imageSkipReasons: imageResult.skipReasons,
      imageTypeCounts: imageResult.imageTypeCounts,
      optionalIndexWriteIssues,
    };
  }

  function extractionMetrics(
    extracted: ExtractedDocument,
    skippedImages: number,
    imageSkipReasons: Record<string, number>,
    imageTypeCounts: Record<string, number>,
  ) {
    const textCharacterCount = extracted.pages.reduce((sum, page) => sum + page.text.length, 0);
    const ocrPageCount = extracted.pages.filter((page) => page.ocrUsed).length;
    // CI-6: pages the extractor flagged as image-only but could NOT OCR (JS fallback without
    // the Python OCR prerequisites). Threaded into index quality so these documents are marked
    // poor and surfaced to eval governance rather than indexed near-empty.
    const needsOcrPageCount = extracted.pages.filter((page) => page.needsOcr).length;
    const warnings = [...(extracted.warnings ?? [])];
    if (textCharacterCount < 80) warnings.push("Low extracted text volume; inspect OCR quality.");

    return {
      page_count: extracted.pages.length,
      ocr_page_count: ocrPageCount,
      needs_ocr_page_count: needsOcrPageCount,
      text_character_count: textCharacterCount,
      extracted_image_count: extracted.images.length,
      searchable_image_count: Object.values(imageTypeCounts).reduce((sum, count) => sum + count, 0),
      skipped_image_count: skippedImages,
      skipped_image_reasons: imageSkipReasons,
      image_type_counts: imageTypeCounts,
      extraction_warnings: warnings,
    };
  }

  async function loadEnrichmentRows(documentId: string, indexGenerationId: string) {
    const chunks: unknown[] = [];
    const images: unknown[] = [];
    const MAX_ENRICHMENT_CHUNKS = 5000;

    for (let start = 0; ; start += 1000) {
      const { data, error } = await supabase
        .from("document_chunks")
        .select(
          "id,document_id,index_generation_id,page_number,chunk_index,section_heading,section_path,heading_level,parent_heading,anchor_id,content,image_ids,metadata",
        )
        .eq("document_id", documentId)
        .eq("index_generation_id", indexGenerationId)
        .order("chunk_index", { ascending: true })
        .range(start, start + 999);
      if (error) throw new Error(error.message);
      chunks.push(...(data ?? []));
      if (chunks.length > MAX_ENRICHMENT_CHUNKS) {
        throw new Error(
          `Document ${documentId} exceeded maximum enrichment chunk limit of ${MAX_ENRICHMENT_CHUNKS}. Aborting enrichment to prevent memory exhaustion.`,
        );
      }
      if (!data || data.length < 1000) break;
    }

    for (let start = 0; ; start += 1000) {
      const { data, error } = await supabase
        .from("document_images")
        .select(
          "id,document_id,index_generation_id,page_number,caption,image_type,labels,source_kind,clinical_relevance_score,metadata",
        )
        .eq("document_id", documentId)
        .eq("index_generation_id", indexGenerationId)
        .eq("searchable", true)
        .order("clinical_relevance_score", { ascending: false })
        .range(start, start + 999);
      if (error) throw new Error(error.message);
      images.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }

    // #212 T4: these read-backs feed upsertDocumentEnrichment and upsertDocumentDeepMemory,
    // which previously received them through unchecked parameter casts. A contract throw is
    // contained by the inline-enrichment try in processJob: enrichment is marked failed, the
    // job still completes, and repair is queued â€” record-and-skip, never a retry loop.
    assertEnrichmentChunkRows(chunks, { documentId, indexGenerationId });
    assertEnrichmentImageRows(images, { documentId, indexGenerationId });
    return { chunks, images };
  }

  async function processJob(job: JobRow) {
    const attempt = attemptForJob(job.id);
    const issuedControlSnapshot = captureIssuedAttemptControl(job);
    const heartbeat = setInterval(
      () => {
        mutation(attempt, "heartbeat_ingestion_job").catch(() => attempt.cancel());
      },
      Math.min(60_000, jobLeaseHeartbeatMs),
    );
    let extracted: ExtractedDocument | null = null;
    let preparedPdf:
      | {
          sourceSha256: string;
          extracted: ExtractedDocument;
          capturedImages: Awaited<ReturnType<typeof captureGenerationImages>>;
        }
      | undefined;
    const atomicReindex = isAtomicReindexCandidate(job.documents);
    try {
      const ordinaryObservations = options.loadObservationsForJob?.(job, attempt);
      providerContexts.set(
        job,
        createWorkerProviderEgressContext(
          job,
          async () => {
            await mutation(attempt, "heartbeat_ingestion_job");
            const { data, error } = await supabase
              .from("documents")
              .select("id,content_hash,metadata")
              .eq("id", job.document_id)
              .single();
            attempt.check();
            if (error || !data) throw new Error("Current ingestion source unavailable");
            return data;
          },
          ordinaryObservations
            ? async (request, binding) => {
                const scoped = managedEmbeddingScope.getStore();
                if (!scoped) return ordinaryObservations(request, binding);
                if (scoped.job !== job || scoped.attempt !== attempt)
                  throw new ProviderEgressDeniedError("provider_egress_permit_invalid");
                const actual = deriveManagedProviderEmbeddingRequestContext({
                  producer: scoped.producer,
                  expectedPlanDigest: scoped.expectedPlanDigest,
                  request,
                  batchSize: env.OPENAI_EMBEDDING_BATCH_SIZE,
                  expectedModel: env.OPENAI_EMBEDDING_MODEL,
                  expectedDimensions: env.EMBEDDING_DIMENSIONS,
                });
                const inspect = options.loadObservationsForJob?.(job, attempt, actual);
                if (!inspect) throw new ProviderEgressDeniedError("provider_egress_permit_invalid");
                return inspect(request, binding);
              }
            : undefined,
        ),
      );
      // Registration is the explicit adoption authority, captured before public mutations.
      await options.initializeManagedAdminTextGeneration?.(job, attempt, {
        readInventory: () =>
          mutation(attempt, "read_ingestion_generation_inventory", {
            p_generation: job.lease_write_generation_id,
          }),
        mutation: (name, payload) => mutation(attempt, name, payload),
        async prepare(source, bytes) {
          const original = await extractDocument({
            buffer: bytes,
            fileName: job.documents.file_name,
            mimeType: job.documents.file_type,
          });
          attempt.check();
          const pages = buildDocumentPageRows(job.document_id, original);
          const originalCapturedImages =
            source.sourceFamily === "native_pdf"
              ? await captureGenerationImages({
                  extracted: original,
                  trustedTemporaryRoots: "temporaryPaths" in original ? (original.temporaryPaths ?? []) : [],
                  fileName: job.documents.file_name,
                  mimeType: job.documents.file_type,
                  check: () => attempt.check(),
                })
              : [];
          attempt.check();
          const packet = buildGenerationRetentionPacket({
            documentId: job.document_id,
            generationId: job.lease_write_generation_id,
            originalBytes: bytes,
            extracted: original,
            persistedPages: serializeDocumentPageRowsForCommit(pages, { sanitizeJsonbRecord }),
            fileSize: bytes.length,
            maximumUploadMb: env.MAX_UPLOAD_MB,
            sourceExpectation: source.sourceExpectation,
            sourceExpectationWitnessBytes: source.sourceExpectationWitnessBytes,
            documentMetadata: job.documents.metadata,
            capturedImages: originalCapturedImages,
            deferOptionalProducerDeclarations: true,
          });
          if (source.sourceFamily !== "native_pdf")
            buildManagedAdminTextChunks({
              documentId: job.document_id,
              packet,
              originalBytes: bytes,
              witnessBytes: source.sourceExpectationWitnessBytes,
              extracted: original,
              sourceSectionLayout: source.sourceSectionLayout,
            });
          if (source.sourceFamily === "native_pdf")
            preparedPdf = {
              sourceSha256: source.sourceSha256,
              extracted: original,
              capturedImages: originalCapturedImages,
            };
          return packet;
        },
      });
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
      if (preparedPdf && `sha256:${createHash("sha256").update(buffer).digest("hex")}` !== preparedPdf.sourceSha256)
        throw new Error("managed_native_pdf_source_changed_after_registration");
      extracted =
        preparedPdf?.extracted ??
        (await extractDocument({
          buffer,
          fileName: job.documents.file_name,
          mimeType: job.documents.file_type,
        }));
      attempt.check();
      const legacyExtractionWallMs = Date.now() - legacyExtractionStartedAt;
      const capturedImages =
        evidenceInventory.managed === true
          ? (preparedPdf?.capturedImages ??
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
        const originalWitness = decodeRetainedOriginalWitness({
          documentId: job.document_id,
          generationId: job.lease_write_generation_id,
          originalBytes: buffer,
          inventory: evidenceInventory.inventory,
        });
        // Validate all optional inventory slots before preparing any declaration.
        // Stored optional groups remain durable; resumption must never regenerate
        // a skipped placeholder over an actual known producer population.
        canDeferOptionalProducerDeclarations(evidenceInventory.inventory);
        const retainedPacket = resumeGenerationRetentionPacket(
          {
            documentId: job.document_id,
            generationId: job.lease_write_generation_id,
            originalBytes: buffer,
            ...(originalWitness.status === "retained"
              ? { sourceExpectationWitnessBytes: originalWitness.witnessBytes }
              : {}),
            extracted,
            persistedPages: serializeDocumentPageRowsForCommit(pageRows, { sanitizeJsonbRecord }),
            ...(typeof job.documents.file_size === "number" ? { fileSize: job.documents.file_size } : {}),
            maximumUploadMb: env.MAX_UPLOAD_MB,
            documentMetadata: job.documents.metadata,
            capturedImages,
            deferOptionalProducerDeclarations: true,
          },
          evidenceInventory.inventory,
        );
        const controlPacket = attachAttemptControlEvidence({
          packet: retainedPacket,
          issued: issuedControlSnapshot,
          inventory: evidenceInventory.inventory,
        });
        const packet = attachPrerequisiteQualityDiagnostic({
          documentId: job.document_id,
          packet: controlPacket,
          extracted,
        });
        if (
          originalWitness.status === "retained" &&
          job.documents.file_type === "text/plain" &&
          packet.registration.sourceSha256 !== PRIVATE_FIXTURE_SOURCE_SHA256
        ) {
          const candidateInput = {
            packet,
            originalBytes: buffer,
            witnessBytes: originalWitness.witnessBytes,
            extracted,
          };
          assertCandidateChunkApplicability(candidateInput);
          const sourceSectionLayout = await options.loadManagedAdminTextSectionLayout?.(
            job,
            packet.registration.sourceSha256,
          );
          attempt.check();
          const chunkRows = buildManagedAdminTextChunks({
            ...candidateInput,
            documentId: job.document_id,
            ...(sourceSectionLayout === undefined ? {} : { sourceSectionLayout }),
          });
          const chunkPlan = prepareCandidateChunks({ ...candidateInput, chunkRows });
          const sectionPlan =
            sourceSectionLayout === undefined
              ? undefined
              : prepareManagedAdminTextSections({
                  ...candidateInput,
                  issued: issuedControlSnapshot,
                  chunkRows,
                  sourceSectionLayout,
                  document: {
                    id: job.document_id,
                    owner_id: job.documents.owner_id,
                    title: job.documents.title,
                    file_name: job.documents.file_name,
                    source_path: job.documents.source_path ?? null,
                  },
                });
          const terminalPacket = prepareManagedAdminTextTerminalPacket({
            ...candidateInput,
            issued: issuedControlSnapshot,
            ownerId: job.documents.owner_id!,
            chunkRows,
            ...(sectionPlan ? { sectionPlan } : {}),
          });
          await stageGenerationPrerequisite({ packet, mutation: (name, payload) => mutation(attempt, name, payload) });
          await stageCandidateChunks({
            plan: chunkPlan,
            batchSize: env.WORKER_BATCH_SIZE,
            embed: (texts) => workerEmbedTexts(job, texts),
            assertEmbedding: assertEmbeddingDim,
            mutation: (name, payload) => mutation(attempt, name, payload),
            check: () => attempt.check(),
          });
          if (sectionPlan)
            await stageManagedAdminTextSections({
              plan: sectionPlan,
              generationId: issuedControlSnapshot.generationId,
              mutation: (name, payload) => mutation(attempt, name, payload),
            });
          await completeManagedAdminTextAttempt({
            attempt,
            packet: terminalPacket,
            stopHeartbeat: () => clearInterval(heartbeat),
            rpc: (name, payload) => ingestionRpcClient.rpc(name, payload),
          });
          invalidateRagCachesForDocumentMutation(job.documents.owner_id ?? "anonymous");
          return;
        }
        if (originalWitness.status === "retained") {
          const supplierInput: ManagedPreparedSupplierInput = {
            issued: issuedControlSnapshot,
            job,
            extracted,
            retentionPacket: packet,
            originalBytes: buffer,
            witnessBytes: originalWitness.witnessBytes,
            embeddingModel: env.OPENAI_EMBEDDING_MODEL,
            indexingVersion: ragDeepMemoryVersion,
            includeLocalMemory: true,
          };
          if (job.documents.file_type === "application/pdf") {
            if (
              packet.registration.sourceSha256 !== PRIVATE_FIXTURE_SOURCE_SHA256 &&
              !options.loadManagedAdminPdfCompletionEvidence
            )
              throw new Error("managed_admin_pdf_registered_completion_evidence_required");
            const roles = await options.loadManagedNativePdfSourceRoles?.(supplierInput);
            attempt.check();
            if (!roles) throw new Error("managed_native_pdf_independent_source_roles_required");
            supplierInput.independentSourceRoles = roles;
          } else {
            supplierInput.independentSourceRoles = buildFixedPrivateFixtureSourceRoles(supplierInput);
          }
          const { plan } = await runManagedPrivateSupplier({
            input: supplierInput,
            currentInventory: evidenceInventory.inventory,
            mutation: (name, payload) => mutation(attempt, name, payload),
            check: () => attempt.check(),
          });
          // The mutation adapter replaces p_fence; this read must preserve its tagged wrapper.
          const readRpc = (name: string, payload: Record<string, unknown>) =>
            runIngestionPreparedWork(
              attempt,
              () => mutation(attempt, "heartbeat_ingestion_job"),
              async () => {
                try {
                  const { data, error } = await ingestionRpcClient.rpc(name, payload);
                  attempt.check();
                  if (error) throw supabaseStageError("read private candidate rows", error);
                  if (!data || data.ok !== true) {
                    throw new IngestionAttemptError(
                      data?.reason === "lease_lost" ? "lease_lost" : "ingestion_rpc_invalid",
                    );
                  }
                  return data;
                } catch (error) {
                  attempt.cancel();
                  throw error;
                }
              },
            );
          const vectorInput = {
            input: supplierInput,
            expectedPlanDigest: plan.digest,
            issued: issuedControlSnapshot,
            batchSize: env.WORKER_BATCH_SIZE,
            embed: (texts: string[], batchContext: ManagedProviderEmbeddingBatchContext) =>
              workerEmbedTexts(job, texts, batchContext, plan.digest),
            assertEmbedding: assertEmbeddingDim,
            check: () => attempt.check(),
          };
          const stageInput = {
            input: supplierInput,
            expectedPlanDigest: plan.digest,
            issued: issuedControlSnapshot,
            fence: attempt.fence,
            writeRpc: (name: string, payload: Record<string, unknown>) => mutation(attempt, name, payload),
            readRpc,
            check: () => attempt.check(),
          };
          const hasPreparedImages = plan.producerManifests.some(
            (manifest) =>
              manifest.group.family === "images" &&
              manifest.group.groupKey === "worker_core" &&
              manifest.state === "prepared" &&
              manifest.units.length > 0,
          );
          if (hasPreparedImages) {
            const nativePacket = await produceManagedNativeParentClosurePacket(vectorInput);
            const nativeReadback = await stageManagedNativeParentClosure({ ...stageInput, packet: nativePacket });
            if (
              nativeReadback.identity.sourceSha256 === PRIVATE_FIXTURE_SOURCE_SHA256 &&
              nativeReadback.identity.sourceByteLength === 3300
            ) {
              await completeManagedPrivateFixtureAttempt({
                attempt,
                packet: prepareManagedPrivateTerminalPacket({
                  identity: nativeReadback.identity,
                  planDigest: nativeReadback.planDigest,
                  nativePopulationDigest: nativeReadback.sqlPopulationDigest,
                }),
                stopHeartbeat: () => clearInterval(heartbeat),
                rpc: (name, payload) => ingestionRpcClient.rpc(name, payload),
              });
              return;
            }
            if (job.documents.file_type === "application/pdf") {
              const evidence = await options.loadManagedAdminPdfCompletionEvidence?.(supplierInput);
              attempt.check();
              if (!evidence) throw new Error("managed_admin_pdf_registered_completion_evidence_required");
              const evaluated = await evaluateManagedAdminPdfCompletion({
                ...evidence,
                identity: nativeReadback.identity,
                original: buffer,
                nativeBasis: { input: supplierInput, issued: issuedControlSnapshot, expectedPlanDigest: plan.digest },
                nativePacket,
                nativeResponse: { ok: true, managedNativeParentClosure: nativeReadback },
              });
              attempt.check();
              await completeManagedAdminPdfAttempt({
                attempt,
                packet: evaluated.packet,
                stopHeartbeat: () => clearInterval(heartbeat),
                rpc: (name, payload) => ingestionRpcClient.rpc(name, payload),
              });
              invalidateRagCachesForDocumentMutation(job.documents.owner_id ?? "anonymous");
              return;
            }
          } else {
            const vectorPacket = await produceManagedVectorFinalPacket(vectorInput);
            await stageManagedVectorFinal({ ...stageInput, packet: vectorPacket });
          }
          // Prepared bodies and private candidate rows are retained and read back.
          // Independent completeness, native fidelity and remaining producers still
          // prevent candidate admission, completion and publication.
          throw new Error(
            "technical_supplier_not_implemented: private candidate rows retained; independent completeness and required fidelity unavailable",
          );
        }
        await stageGenerationPrerequisite({ packet, mutation: (name, payload) => mutation(attempt, name, payload) });
        const candidateInput = {
          packet,
          originalBytes: buffer,
          extracted,
        };
        // Check original applicability before entering any image/caption effects.
        // This slice supplies chunks only; the complete image stage is still unavailable.
        assertCandidateChunkApplicability(candidateInput);
        const preparedChunks = buildPreparedChunks(job, extracted, []);
        await annotatePreparedChunks(preparedChunks);
        const chunkPlan = prepareCandidateChunks({
          ...candidateInput,
          chunkRows: serializeCandidateChunkRows(preparedChunks, {
            documentId: job.document_id,
            generationId: job.lease_write_generation_id,
            cleanString,
            sanitizeJsonbRecord,
          }),
        });
        await stageCandidateChunks({
          plan: chunkPlan,
          batchSize: env.WORKER_BATCH_SIZE,
          embed: (texts) => workerEmbedTexts(job, texts),
          assertEmbedding: assertEmbeddingDim,
          mutation: (name, payload) => mutation(attempt, name, payload),
          check: () => attempt.check(),
        });
        // Actual prepared and persisted chunks are retained. Other producers,
        // candidate stages, source/native fidelity and publication remain incomplete.
        throw new Error(
          "technical_supplier_not_implemented: independent original expectation and required fidelity unavailable",
        );
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
      } = await insertEmbeddedChunks(job, extracted);
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

      let enrichmentStatus = env.WORKER_INLINE_ENRICHMENT ? "completed" : "pending";
      let enrichmentErrorMessage: string | null = null;
      let finalQuality = initialQuality;
      let sectionCount = 0;
      let memoryCardCount = 0;
      let enrichmentUpdatedAt: string | null = null;
      let documentEmbeddingFieldTypes: string[] = [];

      if (env.WORKER_INLINE_ENRICHMENT) {
        await updateJobProgress(job.id, { stage: "enriching indexed document", progress: 96 });
        const enrichmentOutcome = await runIngestionEnrichmentStage(attempt, async () => {
          const enrichmentRows = await loadEnrichmentRows(job.document_id, indexGenerationId);
          const { data: liveDocument, error: liveError } = await supabase
            .from("documents")
            .select("id,owner_id,title,file_name,source_path,metadata,index_generation_id")
            .eq("id", job.document_id)
            .single();
          attempt.check();
          if (liveError) throw new Error(liveError.message);
          if (!liveDocument || liveDocument.index_generation_id !== indexGenerationId) {
            attempt.cancel();
            throw new IngestionAttemptError("lease_lost");
          }
          // Callee mutations share the exact same serialization tail as heartbeat and handoff.
          const enrichmentClient: SupabaseClient = Object.create(supabase);
          enrichmentClient.rpc = ((name: string, payload: Record<string, unknown>) =>
            mutation(attempt, name, payload).then((data) => ({
              data,
              error: null,
            }))) as unknown as SupabaseClient["rpc"];
          const enrichment = await upsertDocumentEnrichment({
            indexGenerationId,
            supabase: enrichmentClient,
            fence: attempt.fence,
            signal: attempt.signal,
            ingestionEgress: providerContextForJob(job),
            document: liveDocument,
            chunks: enrichmentRows.chunks,
            images: enrichmentRows.images,
          });
          documentEmbeddingFieldTypes = await insertDocumentLevelEmbeddingFields({
            job,
            chunkRows: indexedChunkRows,
            summary: enrichment.summary.summary,
          });
          await updateJobProgress(job.id, { stage: "building structured memory", progress: 98 });
          const deepMemory = await upsertDocumentDeepMemory({
            supabase: enrichmentClient,
            fence: attempt.fence,
            signal: attempt.signal,
            ingestionEgress: providerContextForJob(job),
            document: liveDocument,
            chunks: enrichmentRows.chunks,
            images: enrichmentRows.images,
            summary: enrichment.summary.summary,
          });
          sectionCount = deepMemory.sections.length;
          memoryCardCount = deepMemory.memoryCards.length;
          finalQuality = buildIndexQualityPayload({
            job,
            metrics,
            chunks,
            insertedImages,
            sectionCount,
            memoryCardCount,
            documentEmbeddingFieldTypes,
            optionalIndexWriteIssues,
          });
          await upsertIndexQuality(finalQuality);
          enrichmentUpdatedAt = new Date().toISOString();
        });
        if (enrichmentOutcome.status === "failed") {
          const enrichmentError = enrichmentOutcome.error;
          enrichmentStatus = "failed";
          enrichmentErrorMessage = enrichmentError instanceof Error ? enrichmentError.message : String(enrichmentError);
          console.warn("Optional document enrichment failed", safeErrorLogDetails(enrichmentError));
        }
      } else {
        await updateJob(job.id, { stage: "core index complete; enrichment deferred", progress: 98 });
      }

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
          invalidateRagCachesForDocumentMutation(job.documents.owner_id ?? "anonymous");
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

    try {
      await runWorkerLoop({
        once,
        pollMs: env.WORKER_POLL_MS,
        healthBackoffMs: env.WORKER_HEALTH_BACKOFF_MS,
        maxClaimFailures: env.WORKER_MAX_CLAIM_FAILURES,
        claim: claimJobs,
        process: processJob,
        probe: () => probeSupabaseHealth(supabase),
        backoff: workerBackoffMs,
        controller,
        log: (message, level, extra) => (extra ? console[level](message, extra) : console[level](message)),
        captureException: captureWorkerException,
      });
    } finally {
      healthServer?.close();
    }
    console.log("PsychSift worker stopped gracefully");
    // Flush before exit so any buffered claim/process events are not dropped.
    await flushWorkerErrorTracking();
  }

  return { claimJobs, processJob, run: main, attemptForJob };
}

/** Upper bound on the fatal-exit alert, so a stalled webhook cannot delay the exit and restart. */
const FAILURE_WEBHOOK_TIMEOUT_MS = 5_000;

export async function runWorkerMain() {
  try {
    const client = createAdminClient({ timeoutMs: null });
    const adminSourceOptions = await loadAdminSourceRuntimeOptions(client, env.SUPABASE_DOCUMENT_BUCKET);
    await createWorkerRuntime({ client, ...adminSourceOptions }).run();
    process.exit(0);
  } catch (error) {
    const abort = error instanceof WorkerAbortError ? error : null;
    console.error(
      abort ? "PsychSift worker aborted" : "PsychSift worker stopped unexpectedly",
      safeErrorLogDetails(error),
    );
    captureWorkerException(error, "fatal");
    if (env.WORKER_FAILURE_WEBHOOK_URL) {
      try {
        await fetch(env.WORKER_FAILURE_WEBHOOK_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: `CRITICAL: PsychSift worker ${abort ? "aborted" : "stopped unexpectedly"}. Error: ${error instanceof Error ? error.message : String(error)}`,
          }),
          // Bounded so a stalled endpoint cannot hold the exit, and with it Railway's restart.
          signal: AbortSignal.timeout(FAILURE_WEBHOOK_TIMEOUT_MS),
        });
      } catch (webhookError) {
        console.error("Failed to dispatch worker failure webhook", safeErrorLogDetails(webhookError));
      }
    }
    // Flush last: the process is about to exit and buffered events would be lost.
    await flushWorkerErrorTracking();
    process.exit(abort?.exitCode ?? 1);
  }
}
