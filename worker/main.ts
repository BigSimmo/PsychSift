import type { SupabaseClient } from "@supabase/supabase-js";
import { IngestionAttempt, IngestionAttemptError } from "../supabase/functions/_shared/ingestion-attempt";
import { createHash, randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { captureWorkerException, flushWorkerErrorTracking } from "./observability";
import { env } from "../src/lib/env";
import { buildChunks } from "../src/lib/chunking";
import {
  assertSourceAnchoredSummaryPreflight,
  ragEnrichmentVersion,
  upsertDocumentEnrichment,
} from "../src/lib/document-enrichment";
import {
  SOURCE_ANCHORED_MAX_CHUNKS,
  SOURCE_ANCHORED_MAX_IMAGES,
  SOURCE_ANCHORED_SOURCE_PAGE_SIZE,
} from "../supabase/functions/_shared/source-anchored-summary";
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
import { invalidateRagCachesForDocumentMutation } from "../src/lib/rag/rag";
import { createAdminClient } from "../src/lib/supabase/admin";
import { probeSupabaseHealth } from "../src/lib/supabase/health";
import type { Json, TablesUpdate } from "../src/lib/supabase/database.types";
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
  claimedJobFence,
  prepareIngestionJob,
  selectIngestionEnrichmentGeneration,
  collectIngestionShadowCoreRows,
  persistIngestionShadowCoreFamily,
  persistIngestionQuality,
  persistIngestionShadowWorkerProjection,
  prepareIngestionImageStorage,
  declareIngestionShadowProducer,
  recordIngestionShadowProducerFailure,
  declareIngestionShadowClaimControl,
  retainIngestionShadowRepairDecision,
  startIngestionShadowPipelineStage,
  finishIngestionShadowPipelineStage,
  stageIngestionShadowGeneration,
  runIngestionMutation,
  writeIngestionCoreGeneration,
  persistIngestionImage,
  runIngestionPreparedWork,
  runIngestionEnrichmentStage,
  enrichmentRepairDecision,
  ingestionFailureDecision,
} from "./behavior";
import { WorkerRuntimeControl, WorkerAbortError } from "./runtime-control";
import { runWorkerLoop } from "./run-loop";
import type { JobRow, ShadowWorkerReservation, ShadowProducerPersistence, ShadowCoreProducerRows } from "./types";
import {
  createShadowNodeJsonByteEnvelope,
  shadowPrivateObjectIdentityV1,
  captureShadowProducerInputV1,
  readShadowProducerInputV1,
} from "../scripts/lib/reindex-eval-session";

const supabase = createAdminClient();
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
  await mutation(attemptForJob(job.id), "complete_ingestion_job", { p_batch_id: job.batch_id, p_stage: stage });
  invalidateRagCachesForDocumentMutation(job.documents.owner_id ?? "anonymous");
}
async function completeStrictEnrichmentJob(job: JobRow) {
  const attempt = attemptForJob(job.id);
  return attempt.serialize(async () => {
    try {
      const { data, error } = await supabase.rpc("complete_strict_enrichment_job", {
        p_fence: attempt.fence,
        p_stage: "indexed; enrichment completed",
        p_agent_version: "visual-core-v3",
        p_visual_indexing_version: "visual-v3",
      });
      if (error) {
        attempt.cancel();
        throw new Error(error.message);
      }
      if (
        data &&
        typeof data === "object" &&
        !Array.isArray(data) &&
        data.ok === false &&
        data.reason === "completion_gate_blocked"
      ) {
        const missing = Array.isArray(data.missing) ? data.missing.map(String) : ["strict_completion_gate_blocked"];
        return { completed: false, missing, message: "Strict enrichment completion blocked" };
      }
      attempt.accept(data);
      return { completed: true, missing: [] as string[], message: null };
    } catch (error) {
      attempt.cancel();
      throw error;
    }
  });
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
  if (error instanceof IngestionAttemptError) throw error;
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

function noteSkippedImage(skipReasons: Map<string, number>, reason: string) {
  skipReasons.set(reason, (skipReasons.get(reason) ?? 0) + 1);
}

// The declared JobRow[] return is the compile-time proof that the claim contract's
// inferred row type stays assignable to JobRow — weakening the schema fails here.
async function claimJobs(): Promise<JobRow[]> {
  const { data, error } = await supabase.rpc("claim_ingestion_jobs", {
    p_worker_id: workerId,
    p_claim_limit: env.WORKER_CONCURRENCY,
    p_stale_after_minutes: env.WORKER_STALE_AFTER_MINUTES,
  });

  if (error) throw supabaseStageError("claim ingestion jobs", error);

  // #212 T4: per-row fail-soft validation. A batch-wide throw here would bypass the job
  // lifecycle entirely — the run-loop claim catch backs off and repolls (and exits the
  // process under --once) — while the RPC has already committed leases and attempt_count
  // increments for every row, orphaning valid siblings. A row that fails the contract is
  // refused without mutation because a malformed row supplies no trusted Fence; valid
  // siblings still enter processJob and the bounded invalid lease is left for reclaim.
  const { accepted, rejected } = partitionClaimedJobRows(data ?? []);
  for (const rejection of rejected) await terminallyFailRejectedClaimedRow(rejection);
  for (const job of accepted) {
    const attempt = new IngestionAttempt(claimedJobFence(job, "node"));
    attempts.set(job.id, attempt);
    documentAttempts.set(job.document_id, attempt);
  }
  return accepted;
}

async function terminallyFailRejectedClaimedRow(rejection: RejectedClaimedJobRow) {
  console.warn("Malformed claimed row has no trusted attempt; leaving bounded lease for reclaim", {
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
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, redactCaptionMetadataValue(entry)]),
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

async function resetDocumentIndex(documentId: string) {
  const attempt = attemptForDocument(documentId);
  const job = activeJobs.get(attempt.fence.job_id);
  if (!job) throw new IngestionAttemptError("ingestion_attempt_required");
  await mutation(attempt, "reset_ingestion_attempt_artifacts", { p_generation: job.lease_write_generation_id });
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
  const job = activeJobs.get(args.jobId);
  if (!job) throw new IngestionAttemptError("ingestion_attempt_required");
  const shadow = activeShadowReservations.get(args.jobId);
  await writeIngestionCoreGeneration({
    job,
    attempt: attemptForJob(args.jobId),
    rpc: (name, payload) => ingestionRpcClient.rpc(name, payload),
    generation: args.indexGenerationId,
    pageCount: args.pageCount,
    chunkCount: args.chunkCount,
    imageCount: args.imageCount,
    metadata: sanitizeJsonbRecord(args.metadata),
    pages: args.pages,
    quality: sanitizeJsonbRecord(args.quality),
    shadowMember: shadow ? {
      document_id: shadow.binding.source.documentId,
      index_generation_id: shadow.binding.candidateGenerationId,
      baseline_generation_id: shadow.binding.source.baselineGenerationId,
      job_id: shadow.binding.jobId,
      first_lease_token: shadow.binding.firstLeaseToken,
      authority_digest: shadow.binding.source.authorityDigest,
      shadow_reindex_waves: { candidate_generation_id: shadow.binding.candidateGenerationId, plan_digest: shadow.planEnvelope.digest },
    } : undefined,
  });
}
const activeJobs = new Map<string, JobRow>();
const activeShadowReservations = new Map<string, ShadowWorkerReservation>();
const activeShadowCoreRows = new Map<string, ShadowCoreProducerRows>();
function shadowProducerPersistence(job: JobRow): ShadowProducerPersistence | undefined {
  const reservation = activeShadowReservations.get(job.id);
  if (!reservation) return undefined;
  const readControlRevision = async () => {
      const { data, error } = await supabase.from("document_index_generations").select("control_revision")
        .eq("document_id", job.document_id).eq("index_generation_id", job.lease_write_generation_id).eq("job_id", job.id).single();
      if (error || !data) throw new Error("shadow_checkpoint_read_failed");
      return data.control_revision;
  };
  return { binding: reservation.binding,
    declareBatch: (batch) => declareIngestionShadowProducer({
      attempt: attemptForJob(job.id), reservation, batch, readControlRevision,
      rpc: (name, payload) => ingestionRpcClient.rpc(name, payload),
    }),
    recordFailure: (failure) => recordIngestionShadowProducerFailure({
      attempt: attemptForJob(job.id), shadow: reservation, failure, readControlRevision,
      rpc: (name, payload) => ingestionRpcClient.rpc(name, payload),
    }),
  };
}
async function writeBaseArtifacts(
  job: JobRow,
  rows: {
    chunks?: unknown[];
    images?: unknown[];
    tableFacts?: unknown[];
    embeddingFields?: unknown[];
    indexUnits?: unknown[];
  },
) {
  const pending = activeShadowCoreRows.get(job.id);
  if (pending) {
    if (rows.images?.length) throw new Error("shadow_image_publication_requires_own_declaration");
    for (const [family, values] of [["chunks", rows.chunks], ["table_facts", rows.tableFacts],
      ["embedding_fields", rows.embeddingFields], ["index_units", rows.indexUnits]] as const) {
      if (values) collectIngestionShadowCoreRows(pending, family, values);
    }
    return;
  }
  return mutation(attemptForJob(job.id), "write_ingestion_base_artifacts", {
    p_generation: job.lease_write_generation_id,
    p_chunks: rows.chunks ?? [],
    p_images: rows.images ?? [],
    p_table_facts: rows.tableFacts ?? [],
    p_embedding_fields: rows.embeddingFields ?? [],
    p_index_units: rows.indexUnits ?? [],
  });
}
async function flushShadowCoreFamily(job: JobRow, family: keyof ShadowCoreProducerRows) {
  const pending = activeShadowCoreRows.get(job.id); const shadow = shadowProducerPersistence(job);
  if (!pending || !shadow) return;
  return persistIngestionShadowCoreFamily({ attempt: attemptForJob(job.id), shadow, pending, family,
    producerVersion: ragDeepMemoryVersion, rpc: (name, payload) => ingestionRpcClient.rpc(name, payload) });
}

async function retainShadowProducerFailure(
  job: JobRow,
  phase: "image_bytes" | "image_classification" | "chunk_embeddings" | "section_context" |
    "table_facts" | "visual_index_units" | "supplemental_embedding_fields" | "document_embedding_fields",
  input: unknown,
  partial: unknown,
  error: unknown,
): Promise<never> {
  const attempt = attemptForJob(job.id);
  if (error instanceof IngestionAttemptError || attempt.signal.aborted) throw error;
  const shadow = shadowProducerPersistence(job);
  if (!shadow) throw error;
  return shadow.recordFailure({
    phase,
    code: "producer_failed",
    artifactGenerationId: null,
    input,
    partial,
  });
}

function bindShadowProducerFailureValue(value: unknown) {
  return readShadowProducerInputV1(captureShadowProducerInputV1(value)).nativeInput;
}

async function readImageBytesWithShadowFailureRetention(args: {
  job: JobRow;
  path: string;
  input: unknown;
  partial: unknown;
}) {
  if (!shadowProducerPersistence(args.job)) return readFile(args.path);
  const input = bindShadowProducerFailureValue(args.input);
  try {
    return await readFile(args.path);
  } catch (error) {
    // The serial caller has not resumed, so its owned partial arrays are unchanged.
    const partial = bindShadowProducerFailureValue(args.partial);
    return retainShadowProducerFailure(args.job, "image_bytes", input, partial, error);
  }
}

function shadowCoreFailurePartial(job: JobRow, family: keyof ShadowCoreProducerRows) {
  return { rows: activeShadowCoreRows.get(job.id)?.[family] ?? [] };
}

function buildDocumentPageRows(documentId: string, extracted: ExtractedDocument) {
  return extracted.pages.map((page) => ({
    document_id: documentId,
    page_number: page.pageNumber,
    text: cleanString(page.text),
    ocr_used: Boolean(page.ocrUsed),
    metadata: {},
  }));
}

async function upsertIndexQuality(quality: ReturnType<typeof buildIndexQualityPayload>) {
  const attempt = attemptForDocument(quality.document_id);
  const job = activeJobs.get(attempt.fence.job_id);
  if (!job) throw new IngestionAttemptError("ingestion_attempt_required");
  const shadow = shadowProducerPersistence(job);
  await persistIngestionQuality({ attempt, shadow, quality: sanitizeJsonbRecord(quality), producerVersion: ragDeepMemoryVersion,
    rpc: (name, payload) => ingestionRpcClient.rpc(name, payload),
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

function cachedImageMetadata(value: unknown) {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function cachedImageLabels(labels: unknown) {
  if (!Array.isArray(labels)) return [];
  return labels
    .map((label) => String(label).trim())
    .filter(Boolean)
    .slice(0, 6);
}

function metadataString(metadata: Record<string, unknown> | undefined, key: string) {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function metadataNumber(metadata: Record<string, unknown> | undefined, key: string) {
  const value = metadata?.[key];
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
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

type ImageClassificationCacheLookup =
  | { kind: "hit"; classification: ImageClassification }
  | { kind: "miss" }
  | { kind: "failed" };

async function getCachedImageClassification(
  ownerId: string | null,
  imageHash: string,
  contextHash: string,
): Promise<ImageClassificationCacheLookup> {
  if (!ownerId) return { kind: "miss" };

  const { data, error } = await supabase
    .from("image_caption_cache")
    .select("caption,metadata")
    .eq("owner_id", ownerId)
    .eq("image_hash", imageHash)
    .eq("model", env.OPENAI_VISION_MODEL)
    .maybeSingle();

  if (error) {
    console.warn("Image caption cache lookup failed", safeErrorLogDetails(error));
    return { kind: "failed" };
  }
  if (!data) return { kind: "miss" };

  const metadata = cachedImageMetadata(data.metadata);
  if (
    metadata.image_caption_cache_version !== imageCaptionCacheVersion ||
    metadata.image_policy_version !== clinicalImagePolicyVersion ||
    metadata.visual_intelligence_version !== visualIntelligenceVersion ||
    metadata.vision_classification_prompt_version !== visionClassificationPromptVersion ||
    metadata.caption_context_hash !== contextHash
  ) {
    return { kind: "miss" };
  }
  const imageType = imageEvidenceCategories.has(metadata.image_type as ImageEvidenceCategory)
    ? (metadata.image_type as ImageEvidenceCategory)
    : "unclear";
  const score = Number(metadata.clinical_relevance_score);
  const labels = cachedImageLabels(metadata.labels);
  const cachedCaption = redactCaptionIdentifiers(
    cleanString(String(data.caption || "").trim() || "Extracted source image."),
  );
  const assessment = assessClinicalImageUse({
    imageType,
    searchable: Boolean(metadata.searchable),
    clinicalRelevanceScore: score,
    caption: cachedCaption,
    labels,
    skipReason: typeof metadata.skip_reason === "string" ? metadata.skip_reason : null,
  });
  const structuredProfile = normalizeStructuredVisualProfile(
    redactCaptionMetadataValue(metadata.structured_visual_profile),
    {
      fallbackText: cachedCaption,
      fallbackConfidence: score,
    },
  );

  return {
    kind: "hit",
    classification: {
      image_type: imageType,
      searchable: assessment.searchable && imageType !== "logo_decorative",
      clinical_relevance_score: assessment.clinical_relevance_score,
      labels,
      caption: cachedCaption,
      skip_reason:
        typeof metadata.skip_reason === "string" && metadata.skip_reason.trim() ? metadata.skip_reason.trim() : null,
      clinical_use_class: assessment.clinical_use_class,
      clinical_use_reason: assessment.clinical_use_reason,
      clinical_signal_score: assessment.clinical_signal_score,
      admin_signal_score: assessment.admin_signal_score,
      structured_visual_profile: structuredProfile,
      structured_extraction_confidence:
        metadataNumber(metadata, "structured_extraction_confidence") ?? structuredProfile.confidence,
    },
  };
}

async function setCachedImageClassification(args: {
  job: JobRow;
  ownerId: string | null;
  imageHash: string;
  contextHash: string;
  mimeType: string;
  classification: ImageClassification;
}) {
  const classification = redactImageClassification(args.classification);
  if (!args.ownerId || !classification.caption.trim()) return;
  // Candidate cache/model inputs are retained in the declared cache family.
  // The ordinary shared cache remains untouched by a shadow attempt.
  if (activeShadowReservations.has(args.job.id)) return;

  await mutation(attemptForJob(args.job.id), "persist_ingestion_image_caption_cache", {
    p_cache: {
      owner_id: args.ownerId,
      image_hash: args.imageHash,
      model: env.OPENAI_VISION_MODEL,
      caption: classification.caption,
      mime_type: args.mimeType,
      metadata: {
        extractor: "local-worker",
        image_type: classification.image_type,
        searchable: classification.searchable,
        clinical_relevance_score: classification.clinical_relevance_score,
        labels: classification.labels,
        skip_reason: classification.skip_reason,
        clinical_use_class: classification.clinical_use_class,
        clinical_use_reason: classification.clinical_use_reason,
        clinical_signal_score: classification.clinical_signal_score,
        admin_signal_score: classification.admin_signal_score,
        structured_visual_profile: (classification as ImageClassificationWithVisualProfile).structured_visual_profile,
        structured_extraction_confidence: (classification as ImageClassificationWithVisualProfile)
          .structured_extraction_confidence,
        image_policy_version: clinicalImagePolicyVersion,
        visual_intelligence_version: visualIntelligenceVersion,
        image_caption_cache_version: imageCaptionCacheVersion,
        vision_classification_prompt_version: visionClassificationPromptVersion,
        caption_context_hash: args.contextHash,
        // JSON-serializable at runtime; structured_visual_profile's type is
        // wider than the generated Json shape.
      } as unknown as Json,
      updated_at: new Date().toISOString(),
    },
  });
}

async function uploadAndCaptionImages(
  job: JobRow,
  extracted: ExtractedDocument,
  pagesByNumber: Map<number, string>,
  indexGenerationId: string,
) {
  const shadow = shadowProducerPersistence(job);
  const plannedImageUnits: { family: "images"; key: string; output: unknown }[] = [];
  const plannedObjectUnits: { family: "private_objects"; key: string; output: unknown }[] = [];
  const pendingUploads: (() => Promise<unknown>)[] = [];
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
  for (const [imageIndex, image] of extracted.images.entries()) {
    const bytes = await readImageBytesWithShadowFailureRetention({
      job,
      path: image.path,
      input: { stage: "image_preparation", imageIndex, image },
      partial: { preparedImages },
    });
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
    const shadowCacheLookups = shadow
      ? await Promise.all(
          batch.map((task) =>
            task.presetClassification
              ? Promise.resolve({ kind: "miss" } as const)
              : getCachedImageClassification(job.documents.owner_id, task.imageHash, task.contextHash)
                .catch(() => ({ kind: "failed" as const })),
          ),
        )
      : null;
    const failedCacheIndexes =
      shadowCacheLookups?.flatMap((lookup, index) => (lookup.kind === "failed" ? [index] : [])) ?? [];
    if (shadow && shadowCacheLookups && failedCacheIndexes.length > 0) {
      return shadow.recordFailure({
        phase: "cache_lookup",
        code: "producer_failed",
        artifactGenerationId: null,
        input: {
          ownerId: job.documents.owner_id,
          model: env.OPENAI_VISION_MODEL,
          tasks: batch,
        },
        partial: {
          resolvedTasks,
          lookups: shadowCacheLookups.map((lookup, index) => ({
            index: batch[index]!.index,
            kind: lookup.kind,
            ...(lookup.kind === "hit" ? { classification: lookup.classification } : {}),
          })),
        },
      });
    }
    const boundBatchInput = shadow
      ? bindShadowProducerFailureValue({
          ownerId: job.documents.owner_id,
          model: env.OPENAI_VISION_MODEL,
          tasks: batch,
        })
      : null;
    const batchOutcomes = await Promise.all(
      batch.map(async (task, index) => {
        let classification: ImageClassification | null = task.presetClassification;
        let classificationCacheHit = false;
        const cacheLookup =
          shadowCacheLookups?.[index] ??
          (task.presetClassification
            ? ({ kind: "miss" } as const)
            : await getCachedImageClassification(job.documents.owner_id, task.imageHash, task.contextHash));
        if (!classification && cacheLookup.kind === "hit") {
          classification = cacheLookup.classification;
          classificationCacheHit = true;
        }
        if (!classification) {
          let bytes: Buffer;
          try {
            bytes = await readFile(task.image.path);
          } catch (error) {
            if (!shadow) throw error;
            return {
              kind: "failure" as const,
              phase: "image_bytes" as const,
              input: bindShadowProducerFailureValue({
                stage: "image_classification",
                task,
              }),
              partial: { failure: safeErrorLogDetails(error) },
              error,
            };
          }
          attemptForJob(job.id).check();
          const classificationInput = {
            base64: bytes.toString("base64"),
            mimeType: task.image.mimeType,
            nearbyText: task.nearbyText,
            sourceKind: task.image.sourceKind ?? null,
            candidateType: task.tableMetadata.candidateType,
            tableLabel: task.tableMetadata.tableLabel,
            tableTitle: task.tableMetadata.tableTitle,
            tableRole: task.tableMetadata.tableRole,
            tableText: task.tableMetadata.tableText,
          };
          const boundClassificationInput = shadow
            ? bindShadowProducerFailureValue({
                model: env.OPENAI_VISION_MODEL,
                ...classificationInput,
              })
            : null;
          try {
            classification = await classifyAndCaptionImageFromBase64({
              signal: attemptForJob(job.id).signal,
              ...classificationInput,
            });
            attemptForJob(job.id).check();
            await setCachedImageClassification({
              job,
              ownerId: job.documents.owner_id,
              imageHash: task.imageHash,
              contextHash: task.contextHash,
              mimeType: task.image.mimeType,
              classification,
            });
          } catch (error) {
            if (!shadow || error instanceof IngestionAttemptError || attemptForJob(job.id).signal.aborted) throw error;
            return {
              kind: "failure" as const,
              phase: "image_classification" as const,
              input: boundClassificationInput,
              partial: {
                classification,
                failure: safeErrorLogDetails(error),
              },
              error,
            };
          }
        }
        return {
          kind: "success" as const,
          value: { task, classification, classificationCacheHit },
        };
      }),
    );
    const firstFailure = batchOutcomes.find(
      (outcome): outcome is Extract<(typeof batchOutcomes)[number], { kind: "failure" }> =>
        outcome.kind === "failure",
    );
    if (firstFailure) {
      const input = bindShadowProducerFailureValue({
        batch: boundBatchInput,
        failures: batchOutcomes.flatMap((outcome) =>
          outcome.kind === "failure"
            ? [{ phase: outcome.phase, input: outcome.input }]
            : [],
        ),
      });
      const partial = bindShadowProducerFailureValue({
        resolvedTasks,
        outcomes: batchOutcomes.map((outcome) =>
          outcome.kind === "success"
            ? outcome
            : {
                kind: outcome.kind,
                phase: outcome.phase,
                input: outcome.input,
                partial: outcome.partial,
              }),
      });
      return retainShadowProducerFailure(
        job,
        firstFailure.phase,
        input,
        partial,
        firstFailure.error,
      );
    }
    const batchResults = batchOutcomes.flatMap((outcome) =>
      outcome.kind === "success" ? [outcome.value] : [],
    );
    resolvedTasks.push(...batchResults);
  }

  if (shadow) {
    await shadow.declareBatch({ groupKey: "cache", families: ["cache_inputs"], artifactGenerationId: null,
      producerVersion: imageCaptionCacheVersion, units: resolvedTasks.map(resolved => ({ family: "cache_inputs",
        key: String(resolved.task.index), output: createShadowNodeJsonByteEnvelope(captureShadowProducerInputV1({
          task: resolved.task, classification: resolved.classification, classificationCacheHit: resolved.classificationCacheHit,
          ownerId: job.documents.owner_id, model: env.OPENAI_VISION_MODEL,
        }), "u04-retained-evidence-v1").envelope })) });
  }

  for (const resolved of resolvedTasks) {
    const { task, classificationCacheHit } = resolved;
    const { candidate, index, image, perceptualHash, imageHash, nearbyText, tableMetadata, contextHash } = task;
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
        redactCaptionMetadataValue((classification as ImageClassificationWithVisualProfile).structured_visual_profile),
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
    const structuredVisualProfile = (classification as ImageClassificationWithVisualProfile).structured_visual_profile;
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
    const bytes = await readImageBytesWithShadowFailureRetention({
      job,
      path: image.path,
      input: {
        stage: "image_publication",
        task: resolved.task,
        classification: resolved.classification,
      },
      partial: { insertedImages, plannedImageUnits, plannedObjectUnits },
    });
    const imageRow = {
      id: randomUUID(),
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
    };
    const publication = {
      attempt: attemptForJob(job.id),
      generation: indexGenerationId,
      extension: ext.replace(/^\./, "").toLowerCase(),
      row: imageRow,
      rpc: (name: string, payload: Record<string, unknown>) => ingestionRpcClient.rpc(name, payload),
      upload: (storagePath: string, options: { upsert: false }) =>
        supabase.storage
          .from(env.SUPABASE_IMAGE_BUCKET)
          .upload(storagePath, bytes, { contentType: image.mimeType, ...options }),
    };
    let data: typeof imageRow & { storage_path: string };
    if (shadow) {
      const storagePath = await prepareIngestionImageStorage(publication);
      data = { ...imageRow, storage_path: storagePath };
      const ref = { tag: "private_object" as const, bucket: env.SUPABASE_IMAGE_BUCKET, objectPath: storagePath,
        objectVersion: null, sha256: `sha256:${hashBytes(bytes)}`, byteLength: bytes.length, mediaType: image.mimeType };
      plannedImageUnits.push({ family: "images", key: imageRow.id, output: captureShadowProducerInputV1(data) });
      plannedObjectUnits.push({ family: "private_objects", key: shadowPrivateObjectIdentityV1(ref),
        output: { tag: "private_object", ref, bytes: { encoding: "base64", content: bytes.toString("base64") } } });
      pendingUploads.push(() => persistIngestionImage({ ...publication, preparedStoragePath: storagePath }));
    } else data = await persistIngestionImage(publication);
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

  if (shadow) {
    await shadow.declareBatch({ groupKey: "worker_core", families: ["images"], artifactGenerationId: null,
      producerVersion: ragDeepMemoryVersion, units: plannedImageUnits });
    await shadow.declareBatch({ groupKey: "private_objects", families: ["private_objects"], artifactGenerationId: null,
      producerVersion: ragDeepMemoryVersion, units: plannedObjectUnits });
    for (const publish of pendingUploads) await publish();
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
  const embeddings = await embedTexts(
    inputs.map((field) => field.content),
    { signal: attemptForJob(args.job.id).signal },
  );
  attemptForJob(args.job.id).check();
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
  await writeBaseArtifacts(args.job, { embeddingFields: rows });
  return rows.map((row) => row.field_type);
}

async function insertEmbeddedChunks(job: JobRow, extracted: ExtractedDocument) {
  const pagesByNumber = new Map(extracted.pages.map((page) => [page.pageNumber, page.text] as const));
  const indexGenerationId = job.lease_write_generation_id;
  const imageResult = await uploadAndCaptionImages(job, extracted, pagesByNumber, indexGenerationId);
  const { insertedImages } = imageResult;
  const optionalIndexWriteIssues: OptionalIndexWriteIssue[] = [];

  await updateJob(job.id, { stage: "chunking", progress: 72 });
  const chunkMetadata = {
    source_path: job.documents.source_path ?? null,
    content_hash: job.documents.content_hash ?? null,
    index_generation_id: indexGenerationId,
    embedding_model: env.OPENAI_EMBEDDING_MODEL,
    extractor: "local-worker",
    rag_indexing_version: ragDeepMemoryVersion,
    rag_memory_version: ragDeepMemoryVersion,
  };
  const chunks = buildChunks(
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
  const indexedChunkRows: IndexedChunkRow[] = [];

  for (let start = 0; start < chunks.length; start += env.WORKER_BATCH_SIZE) {
    const batch = chunks.slice(start, start + env.WORKER_BATCH_SIZE);
    await updateJobProgress(job.id, {
      stage: `embedding chunks ${start + 1}-${start + batch.length}/${chunks.length}`,
      progress: Math.min(94, 75 + Math.round((start / Math.max(chunks.length, 1)) * 18)),
    });

    const embeddingInput = shadowProducerPersistence(job)
      ? bindShadowProducerFailureValue({
          model: env.OPENAI_EMBEDDING_MODEL,
          chunks: batch,
        })
      : null;
    let embeddings: number[][] = [];
    let rows: IndexedChunkRow[];
    try {
      embeddings = await embedTexts(
        batch.map((chunk) => chunk.content),
        { signal: attemptForJob(job.id).signal },
      );
      attemptForJob(job.id).check();
      rows = batch.map((chunk, index) => ({
        id: randomUUID(),
        document_id: chunk.document_id,
        page_number: chunk.page_number,
        chunk_index: chunk.chunk_index,
        section_heading: chunk.section_heading ? cleanString(chunk.section_heading) : null,
        section_path: Array.isArray(chunk.section_path) ? chunk.section_path.map(cleanString) : [],
        heading_level: chunk.heading_level,
        parent_heading: chunk.parent_heading ? cleanString(chunk.parent_heading) : null,
        anchor_id: chunk.anchor_id ? cleanString(chunk.anchor_id) : null,
        content: cleanString(chunk.content),
        retrieval_synopsis: chunk.retrieval_synopsis ? cleanString(chunk.retrieval_synopsis) : undefined,
        token_estimate: chunk.token_estimate,
        image_ids: chunk.image_ids,
        content_hash: hashText(`${chunk.section_heading ?? ""}\n${chunk.content}`),
        index_generation_id: indexGenerationId,
        embedding: assertEmbeddingDim(embeddings[index], `document_chunks.${chunk.chunk_index}`),
        metadata: sanitizeJsonbRecord(chunk.metadata),
      })) satisfies IndexedChunkRow[];
    } catch (error) {
      const failurePartial = shadowProducerPersistence(job)
        ? bindShadowProducerFailureValue({
            rows: shadowCoreFailurePartial(job, "chunks").rows,
            embeddings,
            nativeResponse: error instanceof Error
              ? Object.getOwnPropertyDescriptor(error, "nativeResponse")?.value
              : undefined,
            failure: safeErrorLogDetails(error),
          })
        : null;
      return retainShadowProducerFailure(
        job,
        "chunk_embeddings",
        embeddingInput,
        failurePartial,
        error,
      );
    }
    indexedChunkRows.push(...rows);

    await writeBaseArtifacts(job, { chunks: rows });

    const fieldInputs = buildEmbeddingFieldInputs(job, rows);
    if (fieldInputs.length > 0) {
      try {
        const fieldEmbeddings = await embedTexts(
          fieldInputs.map((field) => field.content),
          { signal: attemptForJob(job.id).signal },
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
          await writeBaseArtifacts(job, { embeddingFields: batch });
        }
      } catch (error) {
        if (shadowProducerPersistence(job)) {
          await retainShadowProducerFailure(
            job,
            "section_context",
            { fields: fieldInputs },
            shadowCoreFailurePartial(job, "embedding_fields"),
            error,
          );
        }
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
    try {
      for (let start = 0; start < tableFacts.length; start += 100) {
        await writeBaseArtifacts(job, { tableFacts: tableFacts.slice(start, start + 100) });
      }
    } catch (error) {
      if (shadowProducerPersistence(job)) {
        await retainShadowProducerFailure(
          job,
          "table_facts",
          { tableFacts },
          shadowCoreFailurePartial(job, "table_facts"),
          error,
        );
      }
      optionalIndexWriteIssues.push(optionalIndexWriteWarning("table fact", error));
    }
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
      const unitEmbeddings = await embedTexts(visualIndexUnits.map(embeddingTextForDocumentIndexUnit), {
        signal: attemptForJob(job.id).signal,
      });
      for (let start = 0; start < visualIndexUnits.length; start += 50) {
        const batch = visualIndexUnits.slice(start, start + 50).map((unit, index) => ({
          ...unit,
          embedding: assertEmbeddingDim(unitEmbeddings[start + index], `document_index_units.visual.${start + index}`),
          metadata: sanitizeJsonbRecord({ ...unit.metadata, index_generation_id: indexGenerationId }),
        }));
        await writeBaseArtifacts(job, { indexUnits: batch });
      }
    } catch (error) {
      if (shadowProducerPersistence(job)) {
        await retainShadowProducerFailure(
          job,
          "visual_index_units",
          { indexUnits: visualIndexUnits },
          shadowCoreFailurePartial(job, "index_units"),
          error,
        );
      }
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
      const additionalEmbeddings = await embedTexts(
        additionalFieldInputs.map((field) => field.content),
        { signal: attemptForJob(job.id).signal },
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
        await writeBaseArtifacts(job, { embeddingFields: batch });
      }
    } catch (error) {
      if (shadowProducerPersistence(job)) {
        await retainShadowProducerFailure(
          job,
          "supplemental_embedding_fields",
          { fields: additionalFieldInputs },
          shadowCoreFailurePartial(job, "embedding_fields"),
          error,
        );
      }
      optionalIndexWriteIssues.push(optionalIndexWriteWarning("supplemental embedding field", error));
    }
  }

  await flushShadowCoreFamily(job, "chunks");
  await flushShadowCoreFamily(job, "table_facts");
  await flushShadowCoreFamily(job, "index_units");
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

  for (let start = 0; ; start += SOURCE_ANCHORED_SOURCE_PAGE_SIZE) {
    const { data, error } = await supabase
      .from("document_chunks")
      .select(
        "id,document_id,index_generation_id,page_number,chunk_index,section_heading,section_path,heading_level,parent_heading,anchor_id,content,image_ids,metadata",
      )
      .eq("document_id", documentId)
      .eq("index_generation_id", indexGenerationId)
      .order("chunk_index", { ascending: true })
      .order("id", { ascending: true })
      .range(start, start + SOURCE_ANCHORED_SOURCE_PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    chunks.push(...(data ?? []));
    if (chunks.length > SOURCE_ANCHORED_MAX_CHUNKS) {
      throw new Error("source_anchored_summary_source_limit_exceeded");
    }
    if (!data || data.length < SOURCE_ANCHORED_SOURCE_PAGE_SIZE) break;
  }

  for (let start = 0; ; start += SOURCE_ANCHORED_SOURCE_PAGE_SIZE) {
    const { data, error } = await supabase
      .from("document_images")
      .select(
        "id,document_id,index_generation_id,page_number,caption,image_type,labels,source_kind,clinical_relevance_score,metadata",
      )
      .eq("document_id", documentId)
      .eq("index_generation_id", indexGenerationId)
      .eq("searchable", true)
      .order("clinical_relevance_score", { ascending: false, nullsFirst: false })
      .order("page_number", { ascending: true, nullsFirst: false })
      .order("id", { ascending: true })
      .range(start, start + SOURCE_ANCHORED_SOURCE_PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    images.push(...(data ?? []));
    if (images.length > SOURCE_ANCHORED_MAX_IMAGES) {
      throw new Error("source_anchored_summary_source_limit_exceeded");
    }
    if (!data || data.length < SOURCE_ANCHORED_SOURCE_PAGE_SIZE) break;
  }

  // #212 T4: these read-backs feed upsertDocumentEnrichment and upsertDocumentDeepMemory,
  // which previously received them through unchecked parameter casts. A contract throw is
  // contained by the inline-enrichment try in processJob: enrichment is marked failed, the
  // job still completes, and repair is queued — record-and-skip, never a retry loop.
  assertEnrichmentChunkRows(chunks);
  assertEnrichmentImageRows(images);
  return { chunks, images };
}

async function loadLiveEnrichmentDocument(documentId: string) {
  const { data, error } = await supabase
    .from("documents")
    .select("id,owner_id,title,file_name,source_path,index_generation_id,metadata")
    .eq("id", documentId)
    .single();
  if (error) throw supabaseStageError("load live enrichment document", error);
  if (!data) throw new Error("source_anchored_summary_requires_active_generation");
  return data;
}

async function processJob(job: JobRow) {
  activeJobs.set(job.id, job);
  const attempt = attemptForJob(job.id);
  let leaseHeartbeat: ReturnType<typeof setInterval> | undefined;
  let shadowPipelineStageId: string | null = null;
  const atomicReindex = isAtomicReindexCandidate(job.documents);
  let extracted: ExtractedDocument | null = null;

  try {
    const shadow = await prepareIngestionJob({
      job, attempt, now: () => new Date().toISOString(),
      loadShadowReservation: async () => {
        const [member, wave, baseline] = await Promise.all([
          supabase.from("document_index_generations").select("*").eq("document_id", job.document_id)
            .eq("index_generation_id", job.lease_write_generation_id).eq("job_id", job.id).single(),
          supabase.from("shadow_reindex_waves").select("*").eq("candidate_generation_id", job.lease_write_generation_id).single(),
          supabase.from("document_generation_baselines").select("*").eq("document_id", job.document_id)
            .eq("candidate_generation_id", job.lease_write_generation_id).single(),
        ]);
        if (member.error || wave.error || baseline.error) throw new Error("shadow_reservation_read_failed");
        return { member: member.data, wave: wave.data, baseline: baseline.data, document: job.documents };
      },
    });
    if (shadow) {
      activeShadowReservations.set(job.id, shadow);
      activeShadowCoreRows.set(job.id, { chunks: [], table_facts: [], embedding_fields: [], index_units: [] });
      await declareIngestionShadowClaimControl({ attempt, shadow: shadowProducerPersistence(job)!,
        controlSnapshot: shadow.controlSnapshot, producerVersion: ragDeepMemoryVersion });
      shadowPipelineStageId = await startIngestionShadowPipelineStage({ attempt, shadow,
        rpc: (name, payload) => ingestionRpcClient.rpc(name, payload) });
    }
    leaseHeartbeat = setInterval(
      () => { mutation(attempt, "heartbeat_ingestion_job").catch(() => attempt.cancel()); },
      Math.max(1000, Math.floor((job.lease_duration_seconds * 1000) / 3)),
    );
    await updateJobProgress(job.id, {
      stage: "downloading",
      progress: 5,
    });
    if (shadow) {
      // The live document and every retained G0 row stay unchanged. All fixed
      // shadow writers independently recheck the persisted reservation/Fence.
    } else if (atomicReindex) {
      await updateDocument(job.document_id, job.documents.owner_id, { error_message: null });
    } else {
      await updateDocument(job.document_id, job.documents.owner_id, { status: "processing", error_message: null });
    }

    if (!shadow) await resetDocumentIndex(job.document_id);
    attempt.check();
    const buffer = await downloadDocument(job.documents.storage_path);
    attempt.check();
    await updateJobProgress(job.id, { stage: "extracting text/images", progress: 20 });
    // Finding #7: Ingestion Worker Heartbeat. Prevent stale locks during long PDF extractions.
    let leaseLost = false;
    const heartbeat = setInterval(
      () => {
        updateJobProgress(job.id, { stage: "extracting text/images", progress: 20 }).catch(() => {
          leaseLost = true;
          attempt.cancel();
        });
      },
      Math.min(60_000, jobLeaseHeartbeatMs),
    );
    // Legacy extraction wall clock is recorded alongside any B4 shadow measurement so the
    // docling-vs-legacy latency comparison uses the same document on the same host.
    const legacyExtractionStartedAt = Date.now();
    try {
      extracted = await extractDocument({
        buffer,
        fileName: job.documents.file_name,
        mimeType: job.documents.file_type,
      });
      if (leaseLost) {
        throw new IngestionAttemptError("lease_lost");
      }
    } finally {
      clearInterval(heartbeat);
    }
    const legacyExtractionWallMs = Date.now() - legacyExtractionStartedAt;

    await updateJobProgress(job.id, { stage: "saving pages", progress: 32 });
    const pageRows = buildDocumentPageRows(job.document_id, extracted);
    const producerPersistence = shadowProducerPersistence(job);
    if (producerPersistence) {
      const imageBytes: Array<{ path: string; encoding: "base64"; content: string }> = [];
      for (const [imageIndex, image] of extracted.images.entries()) {
        const bytes = await readImageBytesWithShadowFailureRetention({
          job,
          path: image.path,
          input: { stage: "native_structure", imageIndex, image, extracted },
          partial: { imageBytes },
        });
        imageBytes.push({ path: image.path, encoding: "base64", content: bytes.toString("base64") });
      }
      attempt.check();
      const native = createShadowNodeJsonByteEnvelope(captureShadowProducerInputV1({ extracted, imageBytes }), "u04-retained-evidence-v1").envelope;
      await producerPersistence.declareBatch({ groupKey: "worker_native", families: ["native_structure"],
        artifactGenerationId: null, producerVersion: ragDeepMemoryVersion,
        units: [{ family: "native_structure", key: "extracted-document", output: native }] });
      await producerPersistence.declareBatch({ groupKey: "worker_core", families: ["pages"], artifactGenerationId: null,
        producerVersion: ragDeepMemoryVersion, units: pageRows.map((input, index) => ({ family: "pages",
          key: String(input.page_number), output: { input, extractedPage: extracted!.pages[index] } })) });
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
    // Data-safety gate: never commit an empty generation. In the atomic-reindex
    // path (no pre-reset) this would otherwise swap a previously-good index for
    // nothing — e.g. an image-only PDF OCR could not read. With 0 chunks and 0
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
    let shadowEnrichmentInput: unknown = {
      documentId: job.document_id,
      candidateGenerationId: indexGenerationId,
      workerInlineEnrichment: env.WORKER_INLINE_ENRICHMENT,
    };
    let shadowEnrichmentPartial: unknown = {};

    if (env.WORKER_INLINE_ENRICHMENT) {
      await updateJobProgress(job.id, { stage: "enriching indexed document", progress: 96 });
      const enrichmentOutcome = await runIngestionEnrichmentStage(attempt, async () => {
        const enrichmentRows = await loadEnrichmentRows(job.document_id, indexGenerationId);
        shadowEnrichmentInput = {
          documentId: job.document_id,
          indexGenerationId,
          chunks: enrichmentRows.chunks,
          images: enrichmentRows.images,
        };
        const enrichmentDocument = await loadLiveEnrichmentDocument(job.document_id);
        const producerGenerationId = selectIngestionEnrichmentGeneration({ job, attempt, document: enrichmentDocument,
          ...(shadow ? { shadow } : {}) });
        shadowEnrichmentInput = {
          fence: attempt.fence,
          document: enrichmentDocument,
          indexGenerationId: producerGenerationId,
          chunks: enrichmentRows.chunks,
          images: enrichmentRows.images,
        };
        if (!shadow) assertSourceAnchoredSummaryPreflight({
          documentMetadata: enrichmentDocument.metadata,
          indexGenerationId: producerGenerationId,
          chunks: enrichmentRows.chunks,
          images: enrichmentRows.images,
        });
        const enrichment = await upsertDocumentEnrichment({
          supabase,
          fence: attempt.fence,
          signal: attempt.signal,
          document: enrichmentDocument,
          indexGenerationId: producerGenerationId,
          shadow: shadowProducerPersistence(job),
          chunks: enrichmentRows.chunks,
          images: enrichmentRows.images,
        });
        shadowEnrichmentPartial = { enrichment };
        try {
          documentEmbeddingFieldTypes = await insertDocumentLevelEmbeddingFields({
            job,
            chunkRows: indexedChunkRows,
            summary: enrichment.summary.summary,
          });
          shadowEnrichmentPartial = { enrichment, documentEmbeddingFieldTypes };
        } catch (error) {
          if (shadow) {
            await retainShadowProducerFailure(
              job,
              "document_embedding_fields",
              { chunkRows: indexedChunkRows, summary: enrichment.summary.summary },
              { enrichment, rows: shadowCoreFailurePartial(job, "embedding_fields").rows },
              error,
            );
          }
          throw error;
        }
        await flushShadowCoreFamily(job, "embedding_fields");
        await updateJobProgress(job.id, { stage: "building structured memory", progress: 98 });
        const deepMemory = await upsertDocumentDeepMemory({
          supabase,
          fence: attempt.fence,
          signal: attempt.signal,
          document: job.documents,
          chunks: enrichmentRows.chunks,
          images: enrichmentRows.images,
          summary: enrichment.summary.summary,
          shadow: shadowProducerPersistence(job),
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
        if (!shadow) await upsertIndexQuality(finalQuality);
        enrichmentUpdatedAt = new Date().toISOString();
      });
      if (enrichmentOutcome.status === "failed") {
        const enrichmentError = enrichmentOutcome.error;
        if (shadow) {
          if (enrichmentError instanceof IngestionAttemptError || attempt.signal.aborted) throw enrichmentError;
          await shadowProducerPersistence(job)!.recordFailure({
            phase: "summary_generation",
            code: "producer_failed",
            artifactGenerationId: null,
            input: shadowEnrichmentInput,
            partial: shadowEnrichmentPartial,
          });
        }
        enrichmentStatus = "failed";
        enrichmentErrorMessage = enrichmentError instanceof Error ? enrichmentError.message : String(enrichmentError);
        console.warn("Optional document enrichment failed", safeErrorLogDetails(enrichmentError));
      }
    } else {
      if (shadow) {
        await shadowProducerPersistence(job)!.recordFailure({
          phase: "enrichment_policy",
          code: "producer_skipped",
          artifactGenerationId: null,
          input: {
            workerInlineEnrichment: env.WORKER_INLINE_ENRICHMENT,
            binding: shadow.binding,
            executionProfileEnvelope: shadow.executionProfileEnvelope,
            executionProfile: shadow.executionProfile,
          },
          partial: { coreRows: activeShadowCoreRows.get(job.id) ?? null },
        });
      }
      await updateJob(job.id, { stage: "core index complete; enrichment deferred", progress: 98 });
      await flushShadowCoreFamily(job, "embedding_fields");
    }

    // Shadow quality is declared once, after the enrichment outcome is known,
    // including preserved partial/failure output. The ordinary timing is unchanged.
    if (shadow) {
      finalQuality = buildIndexQualityPayload({ job, metrics, chunks, insertedImages, sectionCount, memoryCardCount,
        documentEmbeddingFieldTypes, optionalIndexWriteIssues });
      await upsertIndexQuality(finalQuality);
    }

    // Packet B4 — docling shadow extraction. Runs ONLY here: after the legacy generation is
    // committed (the live index never depends on it) and before the final metadata merge
    // (so the aggregate record rides the existing worker-owned write — no new write site,
    // no document_index_quality / chunk / embedding / index-unit / table-fact write).
    // Fail-open and bounded (worker/shadow-extraction.ts); null when the mode is "legacy"
    // or the document is outside the cohort, in which case nothing is written.
    let shadowExtraction: Awaited<ReturnType<typeof runShadowExtraction>> = null;
    if (env.WORKER_DOCUMENT_EXTRACTOR_MODE === "shadow") {
      const shadowLegacy = extracted;
      // Optional shadow failures stay fail-open; lost attempt authority stops all further work.
      const shadowHeartbeat = setInterval(
        () => {
          updateJobProgress(job.id, { stage: "indexed; shadow extraction (docling)", progress: 98 }).catch(() => {
            attempt.cancel();
          });
        },
        Math.min(60_000, jobLeaseHeartbeatMs),
      );
      try {
        shadowExtraction = await runIngestionPreparedWork(
          attempt,
          () => updateJobProgress(job.id, { stage: "indexed; shadow extraction (docling)", progress: 98 }),
          () =>
            runShadowExtraction(
              {
                documentId: job.document_id,
                indexGenerationId,
                fileName: job.documents.file_name,
                mimeType: job.documents.file_type,
                buffer,
                legacy: shadowLegacy,
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
            ),
        );
      } finally {
        clearInterval(shadowHeartbeat);
        attempt.check();
      }
    }

    const repair = shadow ? await retainIngestionShadowRepairDecision({ attempt,
      shadow: shadowProducerPersistence(job)!, producerVersion: ragDeepMemoryVersion,
      enrichmentStatus, enrichmentErrorMessage, optionalIndexWriteIssues,
    }) : enrichmentRepairDecision({
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
    };

    if (shadow) {
      await persistIngestionShadowWorkerProjection({ attempt, shadow: shadowProducerPersistence(job)!,
        producerVersion: ragDeepMemoryVersion, rpc: (name, payload) => ingestionRpcClient.rpc(name, payload),
        metadata: sanitizeJsonbRecord({ ...committedCoreMetadata, ...finalMetadata }),
        counts: { page_count: extracted.pages.length, chunk_count: chunks.length, image_count: imageCount,
          status: "indexed", error_message: null },
      });
      if (shadowPipelineStageId === null) {
        attempt.cancel();
        throw new Error("shadow_pipeline_stage_unavailable");
      }
      await finishIngestionShadowPipelineStage({ attempt, shadow, stageId: shadowPipelineStageId,
        counts: { page_count: extracted.pages.length, chunk_count: chunks.length, image_count: imageCount,
          section_count: sectionCount, memory_card_count: memoryCardCount },
        rpc: (name, payload) => ingestionRpcClient.rpc(name, payload) });
      clearInterval(leaseHeartbeat);
      leaseHeartbeat = undefined;
      await stageIngestionShadowGeneration({ attempt, shadow,
        rpc: (name, payload) => ingestionRpcClient.rpc(name, payload) });
      return;
    }

    await updateDocument(job.document_id, job.documents.owner_id, {
      metadata: finalMetadata,
    });

    let completionStage = enrichmentStatus === "completed" ? "indexed" : "indexed; enrichment deferred";
    if (enrichmentStatus === "completed") {
      const strictCompletion = await completeStrictEnrichmentJob(job);
      if (strictCompletion.completed) return;
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
  } catch (error) {
    if (error instanceof IngestionAttemptError) {
      attempt.cancel();
      throw error;
    }
    attempt.check();
    console.error("Ingestion job failed", safeErrorLogDetails(error));
    const decision = ingestionFailureDecision({
      error,
      attemptCount: job.attempt_count,
      maxAttempts: job.max_attempts,
      atomicReindex,
    });
    await failOrRetryJob({ job, ...decision });
  } finally {
    clearInterval(leaseHeartbeat);
    await cleanupExtractedTemporaryPaths(extracted);
    // The progress-throttle entry is only needed while this job is processing;
    // drop it so the module-level map does not grow for the worker's lifetime.
    progressUpdateState.delete(job.id);
    activeJobs.delete(job.id);
    activeShadowReservations.delete(job.id);
    activeShadowCoreRows.delete(job.id);
    attempts.delete(job.id);
    documentAttempts.delete(job.document_id);
  }
}

async function main() {
  const once = process.argv.includes("--once");
  const controller = new WorkerRuntimeControl();
  controller.attachSignals();

  const prereqs = await checkPythonPdfPrerequisites();
  console.log(`Clinical KB worker started. worker=${workerId}`);
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
      console.warn(`Docling shadow prerequisite warning (shadow extraction will fail open): ${doclingPrereqs.detail}`);
    }
  }

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
  console.log("Clinical KB worker stopped gracefully");
  // Flush before exit so any buffered claim/process events are not dropped.
  await flushWorkerErrorTracking();
  process.exit(0);
}

main().catch(async (error) => {
  const abort = error instanceof WorkerAbortError ? error : null;
  console.error(
    abort ? "Clinical KB worker aborted" : "Clinical KB worker stopped unexpectedly",
    safeErrorLogDetails(error),
  );
  captureWorkerException(error, "fatal");
  if (env.WORKER_FAILURE_WEBHOOK_URL) {
    try {
      await fetch(env.WORKER_FAILURE_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: `CRITICAL: Clinical KB worker ${abort ? "aborted" : "stopped unexpectedly"}. Error: ${error instanceof Error ? error.message : String(error)}`,
        }),
      });
    } catch (webhookError) {
      console.error("Failed to dispatch worker failure webhook", safeErrorLogDetails(webhookError));
    }
  }
  // Flush last: the process is about to exit and buffered events would be lost.
  await flushWorkerErrorTracking();
  process.exit(abort?.exitCode ?? 1);
});
