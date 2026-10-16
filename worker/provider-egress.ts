import type { ProviderEgressBinding } from "../src/lib/document-ingress-safety";
import {
  createIngestionProviderEgressContext,
  IngestionProviderEgressRefusal,
  type IngestionProviderEgressContextOptions,
  type IngestionProviderEgressRequest,
} from "../src/lib/ingestion-provider-egress";
import { createUnavailableIngestionProviderEgressContext } from "../supabase/functions/_shared/unavailable-ingestion-provider-egress";
import type { JobDocument, JobRow } from "./types";
import { z } from "zod";
import {
  IngestionAttemptError,
  runIngestionPersistence,
  type IngestionAttempt,
  type IngestionFence,
} from "../supabase/functions/_shared/ingestion-attempt";

const authorityUuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const authorityHash = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const authorityDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  })
  .nullable();
const authorityText = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((value) => value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value));
// Decode admitted declarations, not a new rights or clinical-policy decision.
const declaredAuthoritySchema = z
  .object({
    version: z.literal(1),
    sourceRole: z.enum([
      "local_guideline",
      "clinical_guideline",
      "clinical_reference",
      "service_directory",
      "form_reference",
      "tool_reference",
      "safety_alert",
      "regulatory",
      "quality_standard",
      "legal",
      "subsidy",
      "professional_review",
      "service_policy",
    ]),
    authorityBasis: z.enum(["administrator_template", "backend_manifest"]),
    licencePolicy: z.enum(["review_required", "public_index_permitted"]),
    rightsEvidenceRef: authorityText(500),
    publisher: authorityText(300),
    jurisdiction: z.literal("Australia"),
    publicationDate: authorityDate,
    effectiveDate: authorityDate,
    reviewDate: authorityDate,
    expiryDate: authorityDate,
    currentness: z.enum(["current", "unknown"]),
    supersedesDocumentId: authorityUuid.nullable(),
    purpose: z.literal("clinical_retrieval"),
    supportedFeatures: z
      .array(z.enum(["images", "tables", "text"]))
      .min(1)
      .max(3)
      .refine((values) => values.join() === [...new Set(values)].sort().join()),
    providerProcessing: z.literal("permitted"),
  })
  .strict();
const providerAuthorityFactsSchema = z
  .object({
    version: z.literal("ingestion-provider-authority-facts-v1"),
    status: z.literal("observed"),
    documentId: authorityUuid,
    ownerId: authorityUuid,
    jobKind: z.enum(["node", "indexing_v3"]),
    jobId: authorityUuid,
    generationId: authorityUuid,
    expectedGenerationId: authorityUuid.nullable(),
    authorityDigest: authorityHash,
    sourceSha256: authorityHash,
    sourceByteLength: z.number().int().min(1).max(157286400),
    mimeType: z.enum([
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "text/plain",
    ]),
    fileNameSha256: authorityHash,
    storagePathSha256: authorityHash,
    admissionEventId: authorityUuid,
    admissionPolicyVersion: z.literal("trusted-document-admission-v1"),
    admissionDigest: authorityHash,
    declaredAuthority: declaredAuthoritySchema,
    currentRightsEvidence: z.literal("unavailable"),
    safetyEvidence: z.literal("unavailable"),
  })
  .strict();
export type WorkerProviderAuthorityFacts = z.infer<typeof providerAuthorityFactsSchema>;

/** These facts cannot be used as a provider permission or safety verdict. */
export function parseWorkerProviderAuthorityFacts(
  value: unknown,
  fence: IngestionFence,
  generationId: string,
  sourceBinding: Readonly<ProviderEgressBinding>,
): Readonly<WorkerProviderAuthorityFacts> {
  const parsed = z
    .object({ ok: z.literal(true), providerAuthority: providerAuthorityFactsSchema })
    .strict()
    .safeParse(value);
  if (!parsed.success) throw new IngestionAttemptError("ingestion_rpc_invalid");
  const facts = parsed.data.providerAuthority;
  if (
    facts.documentId !== fence.document_id ||
    facts.jobKind !== fence.job_kind ||
    facts.jobId !== fence.job_id ||
    facts.generationId !== generationId ||
    facts.expectedGenerationId !== fence.expected_generation_id ||
    facts.authorityDigest !== fence.authority_digest ||
    facts.documentId !== sourceBinding.documentId ||
    facts.jobId !== sourceBinding.jobId ||
    facts.generationId !== sourceBinding.generationId ||
    facts.authorityDigest !== sourceBinding.authorityDigest ||
    facts.sourceSha256 !== sourceBinding.contentSha256 ||
    facts.admissionEventId !== sourceBinding.admissionEventId ||
    sourceBinding.leaseId !== fence.lease_token ||
    (facts.jobKind === "indexing_v3" && facts.expectedGenerationId === null) ||
    facts.declaredAuthority.supersedesDocumentId === facts.documentId
  ) {
    throw new IngestionAttemptError("ingestion_rpc_invalid");
  }
  Object.freeze(facts.declaredAuthority.supportedFeatures);
  Object.freeze(facts.declaredAuthority);
  return Object.freeze(facts);
}

/** Explicit serialized read only; ordinary worker startup does not call this transport. */
export function readWorkerProviderAuthorityFacts(args: {
  attempt: IngestionAttempt;
  generationId: string;
  sourceBinding: Readonly<ProviderEgressBinding>;
  rpc: (
    name: "read_ingestion_generation_inventory",
    payload: {
      p_fence: { version: "ingestion-provider-authority-read-v1"; fence: IngestionFence };
      p_generation: string;
    },
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
}) {
  const binding = Object.freeze({ ...args.sourceBinding });
  const generationId = args.generationId;
  const attempt = args.attempt;
  const rpc = args.rpc;
  return attempt.serialize(async () => {
    try {
      attempt.check();
      const fence = Object.freeze({ ...attempt.fence });
      if (
        !authorityUuid.safeParse(generationId).success ||
        binding.documentId !== fence.document_id ||
        binding.jobId !== fence.job_id ||
        binding.leaseId !== fence.lease_token ||
        binding.authorityDigest !== fence.authority_digest ||
        binding.generationId !== generationId
      )
        throw new IngestionAttemptError("ingestion_rpc_invalid");
      const result = await runIngestionPersistence(() =>
        rpc("read_ingestion_generation_inventory", {
          p_fence: { version: "ingestion-provider-authority-read-v1", fence },
          p_generation: generationId,
        }),
      );
      attempt.check();
      if (JSON.stringify(attempt.fence) !== JSON.stringify(fence))
        throw new IngestionAttemptError("ingestion_rpc_invalid");
      return parseWorkerProviderAuthorityFacts(result, fence, generationId, binding);
    } catch (error) {
      attempt.cancel();
      throw error;
    }
  });
}

/** The current admission marker is an identity, never a scanner verdict. */
export function workerProviderSourceBinding(
  job: JobRow,
  document: Pick<JobDocument, "id" | "content_hash" | "metadata">,
): ProviderEgressBinding {
  return {
    admissionEventId:
      typeof document.metadata?.admission_event_id === "string" ? document.metadata.admission_event_id : "",
    documentId: document.id,
    generationId: job.lease_write_generation_id,
    jobId: job.id,
    attemptId: `${job.id}:${job.attempt_count}:${job.lease_token}`,
    leaseId: job.lease_token,
    contentSha256: `sha256:${document.content_hash ?? ""}`,
    authorityDigest: job.lease_authority_digest as ProviderEgressBinding["authorityDigest"],
  };
}

/** Optional observations are supplied only by server/worker integration, never request input. */
export function createWorkerProviderEgressContext(
  job: JobRow,
  loadCurrentDocument: () => Promise<Pick<JobDocument, "id" | "content_hash" | "metadata">>,
  loadObservations?: (
    request: IngestionProviderEgressRequest,
    sourceBinding: Readonly<ProviderEgressBinding>,
  ) => Promise<Omit<Awaited<ReturnType<IngestionProviderEgressContextOptions["loadCurrent"]>>, "sourceBinding">>,
) {
  if (loadObservations) {
    const binding = Object.freeze(workerProviderSourceBinding(job, job.documents));
    return createIngestionProviderEgressContext({
      binding,
      async loadCurrent(request) {
        const revalidate = async () => {
          request.signal?.throwIfAborted();
          const document = await loadCurrentDocument();
          request.signal?.throwIfAborted();
          const current = workerProviderSourceBinding(job, document);
          if (document.id !== job.document_id || JSON.stringify(current) !== JSON.stringify(binding)) {
            throw new IngestionProviderEgressRefusal("provider_egress_binding_mismatch");
          }
        };
        await revalidate();
        // The server-owned loader supplies genuine current authority/safety observations.
        // Binding rechecks alone do not establish current rights or scanner clearance.
        const observations = await loadObservations(request, binding);
        await revalidate();
        return {
          sourceBinding: binding,
          sourceObservations: observations.sourceObservations,
          observations: observations.observations,
        };
      },
    });
  }
  return createUnavailableIngestionProviderEgressContext({
    binding: workerProviderSourceBinding(job, job.documents),
    async loadCurrentSourceBinding() {
      return workerProviderSourceBinding(job, await loadCurrentDocument());
    },
  });
}
