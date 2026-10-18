// The managed-generation branch of processJob: a job whose generation inventory is managed
// either reaches one of its fenced terminal completions or refuses with a
// technical_supplier_not_implemented error. It never falls through to the legacy core index.
// Moved from processJob in worker/main.ts; the runtime services arrive through
// IngestionStageContext and every terminal path returns (or throws) exactly as before.
import { IngestionAttemptError, type IngestionAttempt } from "../supabase/functions/_shared/ingestion-attempt";
import { env } from "../src/lib/env";
import { ragDeepMemoryVersion } from "../src/lib/deep-memory";
import { assertEmbeddingDim } from "../src/lib/embedding-dimensions";
// See the note on this import in worker/main.ts: this cache drop is the worker's only rag.ts use.
import { invalidateRagCachesForDocumentMutation } from "../src/lib/rag/rag";
import type { ExtractedDocument } from "../src/lib/types";
import {
  CONTROL_PLANE_RPCS,
  controlPlaneAbortSignal,
  dataPlaneAbortSignal,
  runIngestionPreparedWork,
  serializeDocumentPageRowsForCommit,
  type buildDocumentPageRowsForPersistence,
} from "./behavior";
import {
  assertCandidateChunkApplicability,
  prepareCandidateChunks,
  serializeCandidateChunkRows,
  stageCandidateChunks,
} from "./candidate-chunks";
import { annotatePreparedChunks, buildPreparedChunks } from "./chunk-indexing";
import {
  attachAttemptControlEvidence,
  attachPrerequisiteQualityDiagnostic,
  canDeferOptionalProducerDeclarations,
  resumeGenerationRetentionPacket,
  stageGenerationPrerequisite,
  type captureGenerationImages,
  type captureIssuedAttemptControl,
} from "./generation-evidence";
import { supabaseStageError } from "./ingestion-errors";
import { cleanString, sanitizeJsonbRecord } from "./ingestion-sanitize";
import type { IngestionMutation, IngestionStageContext } from "./ingestion-stage-context";
import type { WorkerRuntimeOptions } from "./main";
import { evaluateManagedAdminPdfCompletion, completeManagedAdminPdfAttempt } from "./managed-admin-pdf-terminal";
import {
  buildManagedAdminTextChunks,
  completeManagedAdminTextAttempt,
  prepareManagedAdminTextSections,
  prepareManagedAdminTextTerminalPacket,
  stageManagedAdminTextSections,
} from "./managed-admin-text-terminal";
import {
  produceManagedNativeParentClosurePacket,
  stageManagedNativeParentClosure,
} from "./managed-native-parent-closure";
import { runManagedPrivateSupplier, type ManagedPreparedSupplierInput } from "./managed-prepared-supplier";
import {
  buildFixedPrivateFixtureSourceRoles,
  completeManagedPrivateFixtureAttempt,
  PRIVATE_FIXTURE_SOURCE_SHA256,
  prepareManagedPrivateTerminalPacket,
} from "./managed-private-terminal";
import type { ManagedProviderEmbeddingBatchContext } from "./managed-provider-vectors";
import { produceManagedVectorFinalPacket, stageManagedVectorFinal } from "./managed-vector-final";
import { decodeRetainedOriginalWitness } from "./original-witness-readback";
import type { JobRow } from "./types";

export type ManagedGenerationLoaders = Pick<
  WorkerRuntimeOptions,
  "loadManagedAdminTextSectionLayout" | "loadManagedNativePdfSourceRoles" | "loadManagedAdminPdfCompletionEvidence"
>;

export async function runManagedGenerationJob(
  ctx: IngestionStageContext,
  options: ManagedGenerationLoaders,
  args: {
    job: JobRow;
    attempt: IngestionAttempt;
    heartbeat: ReturnType<typeof setInterval>;
    buffer: Buffer;
    extracted: ExtractedDocument;
    capturedImages: Awaited<ReturnType<typeof captureGenerationImages>>;
    pageRows: ReturnType<typeof buildDocumentPageRowsForPersistence>;
    evidenceInventory: Awaited<ReturnType<IngestionMutation>>;
    issuedControlSnapshot: ReturnType<typeof captureIssuedAttemptControl>;
  },
): Promise<void> {
  const { ingestionRpcClient, mutation, workerEmbedTexts } = ctx;
  const {
    job,
    attempt,
    heartbeat,
    buffer,
    extracted,
    capturedImages,
    pageRows,
    evidenceInventory,
    issuedControlSnapshot,
  } = args;
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
      ...(originalWitness.status === "retained" ? { sourceExpectationWitnessBytes: originalWitness.witnessBytes } : {}),
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
      rpc: (name, payload) =>
        ingestionRpcClient
          .rpc(name, payload)
          .abortSignal(
            CONTROL_PLANE_RPCS.has(name)
              ? controlPlaneAbortSignal(attempt.signal)
              : dataPlaneAbortSignal(attempt.signal),
          ),
    });
    invalidateRagCachesForDocumentMutation(job.documents.owner_id ?? "anonymous", {
      affectsPublicCorpus: !job.documents.owner_id,
    });
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
              throw new IngestionAttemptError(data?.reason === "lease_lost" ? "lease_lost" : "ingestion_rpc_invalid");
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
          rpc: (name, payload) =>
            ingestionRpcClient
              .rpc(name, payload)
              .abortSignal(
                CONTROL_PLANE_RPCS.has(name)
                  ? controlPlaneAbortSignal(attempt.signal)
                  : dataPlaneAbortSignal(attempt.signal),
              ),
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
          rpc: (name, payload) =>
            ingestionRpcClient
              .rpc(name, payload)
              .abortSignal(
                CONTROL_PLANE_RPCS.has(name)
                  ? controlPlaneAbortSignal(attempt.signal)
                  : dataPlaneAbortSignal(attempt.signal),
              ),
        });
        invalidateRagCachesForDocumentMutation(job.documents.owner_id ?? "anonymous", {
          affectsPublicCorpus: !job.documents.owner_id,
        });
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
