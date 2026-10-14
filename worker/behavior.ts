import type { ExtractedDocument } from "../src/lib/types";
import { extractedTextSha256 } from "../src/lib/extractors/docx-source-provenance";
import { PdfSourceProvenanceError } from "../src/lib/extractors/pdf-source-provenance";
import { TextSourceProvenanceError } from "../src/lib/extractors/text-source-provenance";
import {
  XlsxSourceProvenanceError,
  hasFreshXlsxBinding,
  validateFreshXlsxDocument,
  validateXlsxSourcePages,
  refreshXlsxAfterSanitation,
  xlsxPageSourceProvenanceSchema,
} from "../src/lib/extractors/xlsx-source-provenance";
import { boundedXlsxJson, XLSX_SOURCE_LIMITS } from "../src/lib/extractors/xlsx-original-zip";
import {
  IngestionAttempt,
  IngestionAttemptError,
  type IngestionFence,
} from "../supabase/functions/_shared/ingestion-attempt";
import { isPartialIndexWriteConflict, isRetryableIngestionError, nextRetryAt } from "../src/lib/ingestion";
import { ProviderEgressDeniedError } from "../src/lib/document-ingress-safety";
import { IngestionProviderEgressRefusal } from "../src/lib/ingestion-provider-egress";

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
  const error = args.error;
  const errorMessage = error instanceof Error ? error.message : String(error);
  const preservedStatus = args.atomicReindex ? "indexed" : "failed";

  if (
    error instanceof PdfSourceProvenanceError ||
    error instanceof TextSourceProvenanceError ||
    error instanceof XlsxSourceProvenanceError
  ) {
    return { retry: false, documentStatus: preservedStatus, stage: "failed", errorMessage: error.code };
  }

  if (error instanceof ProviderEgressDeniedError) {
    const refusal =
      error instanceof IngestionProviderEgressRefusal
        ? error
        : new IngestionProviderEgressRefusal(error.code);
    const details = `; reasons=${refusal.codes.join(",")}; actions=${refusal.actions.join(",")}`;
    return {
      retry: false,
      documentStatus: preservedStatus,
      stage: "blocked by ingress safety checks",
      errorMessage: `${refusal.code}${details}`,
    };
  }

  if (isPartialIndexWriteConflict(error)) {
    return {
      retry: false,
      documentStatus: preservedStatus,
      stage: "needs recovery after partial index write",
      errorMessage: `${errorMessage}. Run npm run recover:ingestion -- --apply before retrying this document.`,
    };
  }

  if (isRetryableIngestionError(error) && args.attemptCount < args.maxAttempts) {
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
      const accepted =
        name === "commit_document_index_generation"
          ? attempt.handoff(result.data, payload.p_generation)
          : attempt.accept(result.data);
      if (name === "complete_ingestion_job" || name === "fail_or_retry_ingestion_job") attempt.cancel();
      return accepted;
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

export function registerClaimedJobAttempt(
  job: Parameters<typeof claimedJobFence>[0],
  jobs: Map<string, IngestionAttempt>,
  documents: Map<string, IngestionAttempt>,
) {
  const attempt = new IngestionAttempt(claimedJobFence(job, "node"));
  jobs.get(job.id)?.cancel();
  documents.get(job.document_id)?.cancel();
  jobs.set(job.id, attempt);
  documents.set(job.document_id, attempt);
  return attempt;
}

/** A gate refusal permits repair; all ambiguous persistence outcomes revoke the attempt. */
export function runIngestionStrictCompletion(
  attempt: IngestionAttempt,
  rpc: Parameters<typeof runIngestionMutation>[1],
  payload: Record<string, unknown>,
) {
  return attempt.serialize(async () => {
    try {
      const { data, error } = await rpc("complete_strict_enrichment_job", { ...payload, p_fence: attempt.fence });
      if (error) throw new Error(error.message);
      attempt.check();
      if (data && typeof data === "object" && !Array.isArray(data)) {
        const result = data as Record<string, unknown>;
        if (result.ok === false && result.reason === "completion_gate_blocked") {
          if (!Array.isArray(result.missing) || !result.missing.every((item) => typeof item === "string")) {
            throw new IngestionAttemptError("ingestion_rpc_invalid");
          }
          return {
            completed: false,
            missing: result.missing as string[],
            message: "Strict enrichment completion blocked.",
          };
        }
      }
      const accepted = attempt.accept(data);
      if (Object.keys(accepted).length !== 1) throw new IngestionAttemptError("ingestion_rpc_invalid");
      // Strict completion's Node transaction already terminally completes the job.
      // Revoke before releasing the serialization tail to any queued heartbeat.
      attempt.cancel();
      return { completed: true, missing: [] as string[], message: null };
    } catch (error) {
      attempt.cancel();
      throw error;
    }
  });
}

/** Respect the SQL artifact limit without truncating facts from dense image tables. */
export async function writeIngestionTableFacts(
  attempt: IngestionAttempt,
  rpc: Parameters<typeof runIngestionMutation>[1],
  generation: string,
  facts: readonly unknown[],
) {
  for (let start = 0; start < facts.length; start += 500) {
    await runIngestionMutation(attempt, rpc, "write_ingestion_base_artifacts", {
      p_generation: generation,
      p_chunks: [],
      p_images: [],
      p_table_facts: facts.slice(start, start + 500),
      p_embedding_fields: [],
      p_index_units: [],
    });
  }
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
    if (error instanceof ProviderEgressDeniedError || (error instanceof Error && error.name === "AbortError"))
      throw error;
    if (error instanceof IngestionAttemptError) {
      attempt.cancel();
      throw error;
    }
    return { status: "failed" as const, error };
  }
}

/**
 * Per-image vision-rejection isolation (audit L12).
 *
 * One embedded image the vision provider refuses used to fail the WHOLE
 * document: the provider error escaped the caption batch, the job was recorded
 * failed with an OpenAI error string, and the clinician saw a failed upload
 * with no hint that the fix is "skip that image". The Python extractor now
 * normalises non-web formats to PNG, but a provider can still refuse a
 * particular image, so the worker needs its own per-task guard.
 *
 * The guard is deliberately an ALLOWLIST. Anything not recognised as a
 * non-retryable per-image rejection is rethrown, because silently skipping every
 * image during a rate-limit or provider outage would produce a document that
 * completes with no visual evidence at all — worse than a job that retries.
 */
const NON_RETRYABLE_VISION_REJECTION_CODES = new Set(["openai_invalid_request", "openai_content_filtered"]);

const VISION_IMAGE_REJECTION_MESSAGE =
  /(unsupported image|invalid image|invalid_image|image[_ ]parse[_ ]error|unrecognized (?:file|image) format|corrupt(?:ed)? image)/i;

function errorDetailCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const details = (error as { details?: unknown }).details;
  if (!details || typeof details !== "object") return null;
  const code = (details as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

/**
 * A stable, content-free skip reason for an image the provider refused, or null
 * when the error must propagate and fail/retry the job as before.
 *
 * The returned string never quotes the provider message: it is persisted on the
 * image row and read back in the UI, so it stays a fixed phrase plus the
 * provider's own error code.
 */
export function visionImageRejectionSkipReason(error: unknown): string | null {
  if (isRetryableIngestionError(error)) return null;
  const code = errorDetailCode(error);
  if (code && NON_RETRYABLE_VISION_REJECTION_CODES.has(code)) {
    return `vision provider rejected this image (${code})`;
  }
  if (code) return null;
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (VISION_IMAGE_REJECTION_MESSAGE.test(message)) {
    return "vision provider rejected this image (unsupported or unreadable image data)";
  }
  return null;
}

/** Same page rows consumed by main's existing fenced p_pages serialization; no worker startup. */
export function buildDocumentPageRowsForPersistence(
  documentId: string,
  extracted: ExtractedDocument,
  sanitation: {
    cleanString: (value: string) => string;
    sanitizeJsonbRecord: (value: unknown) => Record<string, unknown>;
  },
) {
  const hasXlsx =
    hasFreshXlsxBinding(extracted) ||
    extracted.pages.some((page) => page.metadata?.source_provenance?.format === "xlsx");
  if (hasXlsx) validateFreshXlsxDocument(extracted);
  const rows = extracted.pages.map((page) => {
    const suppliedProvenance = page.metadata?.source_provenance;
    const provenance =
      suppliedProvenance?.format === "xlsx"
        ? xlsxPageSourceProvenanceSchema.parse(suppliedProvenance)
        : suppliedProvenance;
    const text = sanitation.cleanString(page.text);
    const originalMetadata = page.metadata ?? {};
    const metadata = sanitation.sanitizeJsonbRecord(originalMetadata);
    if (provenance?.format === "xlsx") {
      metadata.source_provenance = refreshXlsxAfterSanitation(
        provenance,
        metadata.source_provenance,
        page.text,
        text,
        false,
      );
    } else if (provenance) {
      const sanitizedProvenance = metadata.source_provenance as typeof provenance;
      metadata.source_provenance = {
        ...sanitizedProvenance,
        textIdentity: {
          ...sanitizedProvenance.textIdentity,
          // Original here is the UTF-8 extracted stream, never original source bytes/spans.
          originalExtractedTextSha256: extractedTextSha256(page.text),
          persistedTextSha256: extractedTextSha256(text),
          normalizationApplied: text !== page.text,
          metadataNormalizationApplied: JSON.stringify(originalMetadata) !== JSON.stringify(metadata),
        },
      };
    }
    return { document_id: documentId, page_number: page.pageNumber, text, ocr_used: Boolean(page.ocrUsed), metadata };
  });
  if (hasXlsx) {
    validateXlsxSourcePages(
      rows.map((row) => ({
        pageNumber: row.page_number,
        text: row.text,
        ocrUsed: row.ocr_used,
        metadata: row.metadata,
      })),
    );
    boundedXlsxJson(rows, XLSX_SOURCE_LIMITS.resultBytes);
  }
  return rows;
}

/** Exact final p_pages: unchanged text and the existing second metadata sanitation. */
export function serializeDocumentPageRowsForCommit(
  pages: Array<{ page_number: number; text: string; ocr_used: boolean; metadata: Record<string, unknown> }>,
  sanitation: { sanitizeJsonbRecord: (value: unknown) => Record<string, unknown> },
) {
  const hasXlsx = pages.some(
    (page) => (page.metadata.source_provenance as { format?: string } | undefined)?.format === "xlsx",
  );
  if (hasXlsx)
    validateXlsxSourcePages(
      pages.map((page) => ({
        pageNumber: page.page_number,
        text: page.text,
        ocrUsed: page.ocr_used,
        metadata: page.metadata,
      })),
    );
  const rows = pages.map((page) => {
    const supplied = page.metadata.source_provenance;
    const provenance =
      supplied && typeof supplied === "object" && "format" in supplied && supplied.format === "xlsx"
        ? xlsxPageSourceProvenanceSchema.parse(supplied)
        : supplied;
    const metadata = sanitation.sanitizeJsonbRecord(page.metadata);
    if (provenance && typeof provenance === "object" && "format" in provenance && provenance.format === "xlsx") {
      // Validated above; refresh and revalidate the actual second-pass payload before RPC.
      const parsed = provenance as import("../src/lib/extractors/xlsx-source-provenance").XlsxPageSourceProvenance;
      metadata.source_provenance = refreshXlsxAfterSanitation(
        parsed,
        metadata.source_provenance,
        page.text,
        page.text,
        true,
      );
    }
    return { page_number: page.page_number, text: page.text, ocr_used: page.ocr_used, metadata };
  });
  if (hasXlsx) {
    validateXlsxSourcePages(
      rows.map((row) => ({
        pageNumber: row.page_number,
        text: row.text,
        ocrUsed: row.ocr_used,
        metadata: row.metadata,
      })),
    );
    boundedXlsxJson(rows, XLSX_SOURCE_LIMITS.resultBytes);
  }
  return rows;
}
