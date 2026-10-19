// The two set-up steps processJob runs before any document mutation: build the job's
// provider egress context, then let a registered admin source adopt the generation.
// Moved from processJob in worker/main.ts; the runtime services arrive through
// IngestionStageContext.
import { rm } from "node:fs/promises";
import { contentFreeErrorDetails } from "../src/lib/privacy";
import type { IngestionAttempt } from "../supabase/functions/_shared/ingestion-attempt";
import { ProviderEgressDeniedError } from "../src/lib/document-ingress-safety";
import { env } from "../src/lib/env";
import { extractDocument } from "../src/lib/extractors/document";
import type { ExtractedDocument } from "../src/lib/types";
import { buildDocumentPageRowsForPersistence, serializeDocumentPageRowsForCommit } from "./behavior";
import { buildGenerationRetentionPacket, captureGenerationImages } from "./generation-evidence";
import { cleanString, sanitizeJsonbRecord } from "./ingestion-sanitize";
import type { IngestionStageContext, ManagedEmbeddingScope } from "./ingestion-stage-context";
import type { WorkerRuntimeOptions } from "./main";
import { buildManagedAdminTextChunks } from "./managed-admin-text-terminal";
import { deriveManagedProviderEmbeddingRequestContext } from "./managed-provider-vectors";
import { createWorkerProviderEgressContext } from "./provider-egress";
import type { JobRow } from "./types";

export type PreparedManagedPdf = {
  sourceSha256: string;
  extracted: ExtractedDocument;
  capturedImages: Awaited<ReturnType<typeof captureGenerationImages>>;
};

export function createJobProviderEgressContext(
  ctx: IngestionStageContext,
  options: Pick<WorkerRuntimeOptions, "loadObservationsForJob">,
  managedEmbeddingScope: ManagedEmbeddingScope,
  job: JobRow,
  attempt: IngestionAttempt,
) {
  const { supabase, mutation } = ctx;
  const ordinaryObservations = options.loadObservationsForJob?.(job, attempt);
  return createWorkerProviderEgressContext(
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
  );
}

/**
 * Registration is the explicit adoption authority, captured before public mutations.
 * Native PDF extraction ownership transfers immediately to processJob, before checks or
 * registration can fail. Other preparations stay locally owned until cleanup.
 */
export async function initializeManagedAdminGeneration(
  ctx: IngestionStageContext,
  options: Pick<WorkerRuntimeOptions, "initializeManagedAdminTextGeneration">,
  job: JobRow,
  attempt: IngestionAttempt,
  adoptNativeExtraction?: (extracted: ExtractedDocument) => void,
) {
  const { mutation } = ctx;
  const prepared: { pdf?: PreparedManagedPdf } = {};
  const locallyOwned = new Set<ExtractedDocument>();
  try {
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
        locallyOwned.add(original);
        if (source.sourceFamily === "native_pdf" && adoptNativeExtraction) {
          // Ownership transfers only after the callback returns successfully.
          adoptNativeExtraction(original);
          locallyOwned.delete(original);
        }
        attempt.check();
        const pages = buildDocumentPageRowsForPersistence(job.document_id, original, {
          cleanString,
          sanitizeJsonbRecord,
        });
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
          prepared.pdf = {
            sourceSha256: source.sourceSha256,
            extracted: original,
            capturedImages: originalCapturedImages,
          };
        return packet;
      },
    });
    // Without an adoption callback, a successful native result belongs to the caller.
    if (prepared.pdf) locallyOwned.delete(prepared.pdf.extracted);
    return prepared;
  } finally {
    const temporaryPaths = new Set([...locallyOwned].flatMap((original) => original.temporaryPaths ?? []));
    for (const temporaryPath of temporaryPaths) {
      try {
        await rm(temporaryPath, { recursive: true, force: true });
      } catch (error) {
        console.warn("Temporary extraction cleanup failed", contentFreeErrorDetails(error));
      }
    }
  }
}
