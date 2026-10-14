import {
  IngestionAttempt,
  IngestionAttemptError,
  parseIngestionFence,
  type IngestionFence,
  // @ts-expect-error -- Node's tsconfig disallows .ts module extensions; Deno requires this explicit extension.
} from "../_shared/ingestion-attempt.ts";
import {
  buildSourceAnchoredFallbackPayload,
  normalizeSourceAnchoredSummary,
  persistedSourceAnchoredSummaryProjectionMatches,
  projectSourceAnchoredLabels,
  SOURCE_ANCHORED_MAX_CHUNKS,
  SOURCE_ANCHORED_MAX_IMAGES,
  SOURCE_ANCHORED_MAX_PROMPT_IMAGES,
  type SourceAnchoredSummaryAuthority,
  type SourceAnchoredSummaryPayload,
  type PersistedSourceAnchoredSummaryProjection,
  // @ts-expect-error -- Node's tsconfig disallows .ts module extensions; Deno requires this explicit extension.
} from "../_shared/source-anchored-summary.ts";

import {
  ProviderEgressDeniedError,
  type ProviderEgressBinding,
  type ProviderEgressPurpose,
  // @ts-expect-error -- Node's tsconfig disallows .ts module extensions; Deno requires this explicit extension.
} from "../_shared/document-ingress-safety.ts";
import {
  assertIngestionProviderEgress,
  assertIngestionProviderEgressContextActive,
  IngestionProviderEgressRefusal,
  type IngestionProviderEgressContext,
  // @ts-expect-error -- Node's tsconfig disallows .ts module extensions; Deno requires this explicit extension.
} from "../_shared/ingestion-provider-egress.ts";

export function edgeProviderEgressBinding(
  fence: IngestionFence,
  attemptCount: number,
  source: unknown,
): ProviderEgressBinding {
  const row = asObjectRecord(source);
  if (!row || row.document_id !== fence.document_id || row.index_generation_id !== fence.expected_generation_id) {
    throw new IngestionProviderEgressRefusal("provider_egress_binding_mismatch");
  }
  if (typeof row.admission_event_id !== "string" || !row.admission_event_id.trim()) {
    throw new IngestionProviderEgressRefusal("provider_egress_denied", [
      { code: "admission_missing", action: "obtain_current_admission" },
    ]);
  }
  if (
    typeof row.content_sha256 !== "string" ||
    !/^sha256:[0-9a-f]{64}$/.test(row.content_sha256) ||
    typeof row.document_content_hash !== "string" ||
    !/^[0-9a-f]{64}$/.test(row.document_content_hash) ||
    row.content_sha256 !== `sha256:${row.document_content_hash}` ||
    !Number.isSafeInteger(attemptCount) ||
    attemptCount < 0
  ) {
    throw new IngestionProviderEgressRefusal("provider_egress_binding_mismatch");
  }
  return Object.freeze({
    admissionEventId: row.admission_event_id,
    documentId: fence.document_id,
    generationId: fence.expected_generation_id!,
    jobId: fence.job_id,
    attemptId: `${fence.job_id}:${attemptCount}`,
    leaseId: fence.lease_token,
    contentSha256: row.content_sha256 as ProviderEgressBinding["contentSha256"],
    authorityDigest: fence.authority_digest as ProviderEgressBinding["authorityDigest"],
  });
}

/** Authorize exact immutable bytes immediately before each actual Edge dispatch. */
export async function runEdgeProviderEgressTransport<T>(
  attempt: IngestionAttempt,
  timeoutSignal: AbortSignal,
  context: IngestionProviderEgressContext,
  purpose: ProviderEgressPurpose,
  payload: string,
  execute: (signal: AbortSignal, payload: string) => Promise<T>,
): Promise<T> {
  return runEdgeIngestionTransport(attempt, timeoutSignal, async (signal) => {
    await assertIngestionProviderEgress(context, purpose, payload, signal);
    assertIngestionProviderEgressContextActive(context, signal);
    attempt.check();
    const result = await execute(signal, payload);
    assertIngestionProviderEgressContextActive(context, signal);
    attempt.check();
    return result;
  });
}

export function edgeProviderEgressFailure(error: unknown) {
  if (!(error instanceof ProviderEgressDeniedError)) return null;
  const refusal =
    error instanceof IngestionProviderEgressRefusal ? error : new IngestionProviderEgressRefusal(error.code);
  const reasons = refusal.reasons;
  return Object.freeze({
    code: error.code,
    codes: Object.freeze(reasons.map((reason) => reason.code)),
    reasons,
    actions: Object.freeze([...new Set(reasons.map((reason) => reason.action))]),
  });
}

export function parseEdgeIngestionClaim(value: unknown, workerId: string, nowMs = Date.now()): IngestionFence {
  const row = asObjectRecord(value);
  const document = asObjectRecord(row?.documents);
  const expiry = typeof row?.lease_expires_at === "string" ? Date.parse(row.lease_expires_at) : NaN;
  if (
    !row ||
    !document ||
    row.job_kind !== "indexing_v3" ||
    row.locked_by !== workerId ||
    document.id !== row.document_id ||
    document.index_generation_id !== row.lease_expected_generation_id ||
    row.lease_write_generation_id !== row.lease_expected_generation_id ||
    !Number.isFinite(nowMs) ||
    !Number.isFinite(expiry) ||
    expiry <= nowMs ||
    !Number.isInteger(row.lease_duration_seconds) ||
    (row.lease_duration_seconds as number) < 1 ||
    (row.lease_duration_seconds as number) > 86400
  ) {
    throw new IngestionAttemptError("ingestion_attempt_required");
  }
  return parseIngestionFence({
    job_kind: row.job_kind,
    job_id: row.id,
    document_id: row.document_id,
    worker_id: row.locked_by,
    lease_token: row.lease_token,
    expected_generation_id: row.lease_expected_generation_id,
    authority_digest: row.lease_authority_digest,
  });
}

export async function runEdgeIngestionMutation(
  attempt: IngestionAttempt,
  execute: (fence: IngestionFence) => Promise<unknown>,
  allowGateRefusal = false,
  releaseOnSuccess = false,
) {
  return attempt.serialize(async () => {
    try {
      const value = await execute(attempt.fence);
      attempt.check();
      const result = asObjectRecord(value);
      if (
        allowGateRefusal &&
        result?.ok === false &&
        result.reason === "completion_gate_blocked" &&
        Array.isArray(result.missing) &&
        result.missing.every((item) => typeof item === "string")
      )
        return result;
      const accepted = attempt.accept(value);
      if (releaseOnSuccess) attempt.cancel();
      return accepted;
    } catch (error) {
      attempt.cancel();
      throw error;
    }
  });
}

export async function runEdgeIngestionTransport<T>(
  attempt: IngestionAttempt,
  timeoutSignal: AbortSignal,
  execute: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  attempt.check();
  const signal = AbortSignal.any([attempt.signal, timeoutSignal]);
  signal.throwIfAborted();
  const result = await execute(signal);
  signal.throwIfAborted();
  attempt.check();
  return result;
}

export function parseEdgeCompletionResult(value: unknown): { ok: true; status: "completed" } {
  const row = asObjectRecord(value);
  if (row?.ok === false && row.reason === "completion_gate_blocked")
    throw new IngestionAttemptError("completion_gate_blocked");
  if (!row || row.ok !== true || row.status !== "completed" || Object.keys(row).length !== 2)
    throw new IngestionAttemptError("ingestion_rpc_invalid");
  return { ok: true, status: "completed" };
}

export async function ensureEdgeSummaryProjection(args: {
  authority: SourceAnchoredSummaryAuthority;
  existing: PersistedSourceAnchoredSummaryProjection | null | undefined;
  labels: ReadonlyArray<{
    label: string;
    label_type: string;
    confidence: number;
    metadata: Record<string, unknown> | null;
  }>;
  persist: (payload: SourceAnchoredSummaryPayload) => Promise<unknown>;
}): Promise<SourceAnchoredSummaryPayload> {
  const corpus = args.authority;
  if (
    corpus.selectedChunks.length > SOURCE_ANCHORED_MAX_CHUNKS ||
    corpus.selectedImages.length > SOURCE_ANCHORED_MAX_IMAGES
  )
    throw new Error("source_anchored_summary_source_limit_exceeded");
  // Loaded rows establish membership; they are not the model's bounded selection.
  const seen = new Set<string>();
  for (const row of [...corpus.selectedChunks, ...corpus.selectedImages]) {
    if (row.index_generation_id !== corpus.indexGenerationId)
      throw new Error("source_anchored_summary_source_generation_mismatch");
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(row.id) ||
      seen.has(row.id) ||
      (row.page_number !== null && (!Number.isInteger(row.page_number) || row.page_number <= 0))
    )
      throw new Error("source_anchored_summary_source_invalid");
    seen.add(row.id);
  }
  let payload: SourceAnchoredSummaryPayload | undefined;
  const raw = asObjectRecord(asObjectRecord(args.existing?.metadata)?.source_anchored_summary_v1);
  if (raw?.summary_kind === "structured") {
    try {
      const select = (ids: unknown, rows: SourceAnchoredSummaryAuthority["selectedChunks"], max: number) => {
        if (
          !Array.isArray(ids) ||
          ids.length > max ||
          ids.some((id) => typeof id !== "string") ||
          new Set(ids).size !== ids.length
        )
          throw new Error("source_anchored_summary_cached_anchors_invalid");
        const byId = new Map(rows.map((row) => [row.id, row]));
        return ids.map((id) => {
          const row = byId.get(id);
          if (!row) throw new Error("source_anchored_summary_cached_anchor_missing");
          return row;
        });
      };
      // Preserve the payload's anchor order, including anchors beyond fallback cutoffs.
      const selected = {
        ...corpus,
        selectedChunks: select(raw.source_chunk_ids, corpus.selectedChunks, 36),
        selectedImages: select(raw.source_image_ids, corpus.selectedImages, SOURCE_ANCHORED_MAX_PROMPT_IMAGES),
      };
      payload = normalizeSourceAnchoredSummary(raw, selected);
    } catch {
      /* Rebuild only from the current exact-generation corpus. */
    }
  }
  if (!payload)
    payload = buildSourceAnchoredFallbackPayload({
      ...corpus,
      selectedChunks: corpus.selectedChunks.slice(0, 36),
      selectedImages: corpus.selectedImages.slice(0, SOURCE_ANCHORED_MAX_PROMPT_IMAGES),
    });
  const labels = projectSourceAnchoredLabels(payload);
  const projectionMatches =
    labels.length === args.labels.length &&
    labels.every((label) =>
      args.labels.some(
        (row) =>
          row.label === label.label &&
          row.label_type === label.label_type &&
          row.confidence === label.confidence &&
          row.metadata?.index_generation_id === payload.index_generation_id &&
          row.metadata?.summary_version === payload.summary_version &&
          JSON.stringify(row.metadata?.source_chunk_ids) === JSON.stringify(label.source_chunk_ids) &&
          JSON.stringify(row.metadata?.source_image_ids) === JSON.stringify(label.source_image_ids) &&
          JSON.stringify(row.metadata?.pages) === JSON.stringify(label.pages),
      ),
    );
  if (
    payload.summary_kind === "structured" &&
    projectionMatches &&
    persistedSourceAnchoredSummaryProjectionMatches(args.existing, payload)
  )
    return payload;
  await args.persist(payload);
  return payload;
}

export type CompletionGate = {
  counts: {
    sections: number;
    memory_cards: number;
    generated_labels: number;
    index_units: number;
  };
  presence: {
    title_embedding: boolean;
    summary_embedding: boolean;
  };
  quality: {
    extraction_quality: string;
    score: number;
  };
  missing: string[];
  result: "complete" | "deferred";
};

export type CompletionGateRow = {
  sections: number;
  memory_cards: number;
  generated_labels: number;
  index_units: number;
  title_embedding: boolean;
  summary_embedding: boolean;
  quality_extraction_quality: string;
  quality_score: number;
  missing: string[];
  gate_passed: boolean;
};

export type MissingArtifactPlan = {
  needs_sections: boolean;
  needs_memory: boolean;
  needs_labels: boolean;
  needs_index_units: boolean;
  needs_title_embedding: boolean;
  needs_summary_embedding: boolean;
  needs_core_embeddings: boolean;
  needs_quality_promotion: boolean;
};

export type DeferralDecision = {
  deferral_count: number;
  terminal: boolean;
  status: "deferred" | "needs_enrichment_artifacts";
  enrichment_status: "pending" | "needs_enrichment_artifacts";
  next_run_at: string | null;
  details: {
    code: "completion_gate_deferred" | "needs_enrichment_artifacts";
    missing: string[];
    counts: CompletionGate["counts"];
    presence: CompletionGate["presence"];
    deferral_count: number;
    max_deferrals: number;
  };
};

export type JobStatusRpcResult = {
  ok: boolean;
  gate_passed: boolean;
  missing: string[] | null;
  status: string;
};

export function agentFailureDecision(args: {
  attemptCount: number;
  maxAttempts: number;
  nowMs: number;
  retryDelayMs: number;
  error?: unknown;
}) {
  const shouldRetry = !(args.error instanceof ProviderEgressDeniedError) && args.attemptCount < args.maxAttempts;
  return {
    shouldRetry,
    status: shouldRetry ? "retry_pending" : "failed",
    jobStatus: shouldRetry ? "pending" : "failed",
    enrichmentStatus: shouldRetry ? "pending" : "failed",
    nextRunAt: shouldRetry ? new Date(args.nowMs + args.retryDelayMs).toISOString() : null,
  } as const;
}

function asObjectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export function parseJobStatusRpcResult(row: unknown, rpcName: string): JobStatusRpcResult | null {
  const direct = asObjectRecord(row);
  const nested = asObjectRecord(direct?.[rpcName]);
  const candidate = direct?.ok !== undefined ? direct : nested;
  if (!candidate) return null;

  const ok = candidate.ok === true;
  const gatePassed = candidate.gate_passed === true;
  const status = typeof candidate.status === "string" ? candidate.status : "missing_result";
  const missing =
    candidate.missing === null
      ? []
      : Array.isArray(candidate.missing)
        ? candidate.missing.map((item) => String(item))
        : ["completion_rpc_failed"];

  return { ok, gate_passed: gatePassed, status, missing };
}

export function completionGateFromRow(row: CompletionGateRow): CompletionGate {
  return {
    counts: {
      sections: row.sections,
      memory_cards: row.memory_cards,
      generated_labels: row.generated_labels,
      index_units: row.index_units,
    },
    presence: {
      title_embedding: row.title_embedding,
      summary_embedding: row.summary_embedding,
    },
    quality: {
      extraction_quality: row.quality_extraction_quality,
      score: row.quality_score,
    },
    missing: row.missing,
    result: row.gate_passed ? "complete" : "deferred",
  };
}

export function missingArtifactPlan(gate: CompletionGate): MissingArtifactPlan {
  const missing = new Set(gate.missing);
  const needsTitle = missing.has("title_embedding");
  const needsSummary = missing.has("summary_embedding");
  return {
    needs_sections: missing.has("sections"),
    needs_memory: missing.has("memory_cards"),
    needs_labels: missing.has("generated_labels"),
    needs_index_units: missing.has("index_units"),
    needs_title_embedding: needsTitle,
    needs_summary_embedding: needsSummary,
    needs_core_embeddings: needsTitle || needsSummary,
    needs_quality_promotion: gate.result === "complete" && gate.quality.extraction_quality !== "good",
  };
}

export function shouldRunVisualArtifacts(args: { eligible_images: number; generated_visual_units: number }): boolean {
  return args.eligible_images > 0 && args.generated_visual_units === 0;
}

export function metadataNumber(
  metadata: Record<string, unknown> | null | undefined,
  key: string,
  fallback = 0,
): number {
  const value = Number(metadata?.[key]);
  return Number.isFinite(value) ? value : fallback;
}

export function deferralDecision(args: {
  metadata: Record<string, unknown> | null | undefined;
  gate: CompletionGate;
  maxDeferrals: number;
  nowMs: number;
}): DeferralDecision {
  const deferralCount = metadataNumber(args.metadata, "indexing_v3_agent_deferral_count") + 1;
  const terminal = deferralCount >= args.maxDeferrals || args.gate.missing.includes("sections");
  const status = terminal ? "needs_enrichment_artifacts" : "deferred";
  const nextRunAt = terminal
    ? null
    : new Date(args.nowMs + Math.min(24 * 60 * 60_000, 15 * 60_000 * deferralCount)).toISOString();
  return {
    deferral_count: deferralCount,
    terminal,
    status,
    enrichment_status: terminal ? "needs_enrichment_artifacts" : "pending",
    next_run_at: nextRunAt,
    details: {
      code: terminal ? "needs_enrichment_artifacts" : "completion_gate_deferred",
      missing: args.gate.missing,
      counts: args.gate.counts,
      presence: args.gate.presence,
      deferral_count: deferralCount,
      max_deferrals: args.maxDeferrals,
    },
  };
}

/**
 * Claim limit for the agent endpoint.
 *
 * `Number(url.searchParams.get("limit"))` alone lets `?limit=abc` reach the
 * claim RPC as `NaN::integer`, which Postgres rejects with a cast error — a 500
 * before a single job is claimed. Mirror the ingestion-worker function: finite
 * check first, then truncate and clamp.
 */
export const AGENT_CLAIM_LIMIT_DEFAULT = 8;
export const AGENT_CLAIM_LIMIT_MAX = 50;

export function parseAgentClaimLimit(
  raw: string | null | undefined,
  fallback = AGENT_CLAIM_LIMIT_DEFAULT,
  max = AGENT_CLAIM_LIMIT_MAX,
): number {
  if (raw === null || raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(max, Math.trunc(parsed)));
}

/** The endpoint claims and mutates jobs; only POST may reach it. */
export function isAllowedAgentMethod(method: string): boolean {
  return method === "POST";
}

export type ClaimedBatchResult<TJob> = {
  processed: number;
  deferred: number;
  failed: number;
  deferrals: Array<{ job: TJob; missing: string[] }>;
  failures: Array<{ job: TJob; error: string; failure_record_error: string | null }>;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : JSON.stringify(error);
}

/**
 * Run one claimed batch, isolating BOTH the per-job work and the per-job
 * failure recording.
 *
 * The bug this exists to prevent (audit L13): `markJobFailure` throws whenever
 * the status RPC returns `ok:false` or the database errors. Called unguarded in
 * the loop's catch, that throw escaped to the request-level catch and returned
 * 500 with every not-yet-processed job in the batch still `processing` under
 * its lock — invisible until the 45-minute stale reclaim, each one attempt
 * closer to the terminal `failed` state that is never re-queued. One job's
 * failure must never abandon its siblings, so the failure-recording call gets
 * its own guard and the loop continues.
 */
export async function runClaimedJobBatch<TJob>(
  jobs: readonly TJob[],
  handlers: {
    processJob: (job: TJob) => Promise<{ status: "completed" | "deferred"; missing: string[] }>;
    markJobFailure: (job: TJob, message: string, error?: unknown) => Promise<unknown>;
  },
): Promise<ClaimedBatchResult<TJob>> {
  const result: ClaimedBatchResult<TJob> = {
    processed: 0,
    deferred: 0,
    failed: 0,
    deferrals: [],
    failures: [],
  };

  for (const job of jobs) {
    try {
      const outcome = await handlers.processJob(job);
      if (outcome.status === "completed") {
        result.processed += 1;
      } else {
        result.deferred += 1;
        result.deferrals.push({ job, missing: outcome.missing });
      }
    } catch (error) {
      const message = errorMessage(error);
      let failureRecordError: string | null = null;
      try {
        await handlers.markJobFailure(job, message, error);
      } catch (recordError) {
        failureRecordError = errorMessage(recordError);
      }
      result.failed += 1;
      result.failures.push({ job, error: message, failure_record_error: failureRecordError });
    }
  }

  return result;
}
