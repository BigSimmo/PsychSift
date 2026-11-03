import { z } from "zod";
import type { ProviderEgressBinding } from "../src/lib/document-ingress-safety";
import {
  IngestionAttemptError,
  runIngestionPersistence,
  type IngestionAttempt,
  type IngestionFence,
} from "../supabase/functions/_shared/ingestion-attempt";
import { declaredAuthoritySchema } from "./provider-egress";

const uuid = z.uuid();
const sha = z.string().regex(/^sha256:[a-f0-9]{64}$/);
export const administratorReindexAuthorityFactsSchema = z
  .object({
    version: z.literal("administrator-reindex-authority-facts-v1"),
    scope: z.enum(["owner_private", "existing_shared_library_stewardship"]),
    documentId: uuid,
    documentOwnerId: uuid.nullable(),
    stewardId: uuid,
    jobId: uuid,
    generationId: uuid,
    authorityDigest: sha,
    sourceSha256: sha,
    sourceByteLength: z.number().int().positive().max(157286400),
    mimeType: z.literal("application/pdf"),
    fileNameSha256: sha,
    storagePathSha256: sha,
    admissionEventId: uuid,
    admissionDigest: sha,
    admissionPolicyVersion: z.literal("trusted-document-admission-v1"),
    declaredAuthority: declaredAuthoritySchema,
    currentRightsEvidence: z.literal("unavailable"),
    historicalUploadOrigin: z.literal("not_established"),
  })
  .strict();
export type AdministratorReindexAuthorityFacts = z.infer<typeof administratorReindexAuthorityFactsSchema>;

export function parseAdministratorReindexAuthorityFacts(
  value: unknown,
  fence: IngestionFence,
  generationId: string,
  binding: ProviderEgressBinding,
): AdministratorReindexAuthorityFacts {
  const result = z
    .object({ ok: z.literal(true), providerAuthority: administratorReindexAuthorityFactsSchema })
    .strict()
    .safeParse(value);
  if (!result.success) throw new IngestionAttemptError("ingestion_rpc_invalid");
  const f = result.data.providerAuthority;
  if (
    f.documentId !== fence.document_id ||
    f.jobId !== fence.job_id ||
    f.generationId !== generationId ||
    f.authorityDigest !== fence.authority_digest ||
    f.documentId !== binding.documentId ||
    f.jobId !== binding.jobId ||
    f.generationId !== binding.generationId ||
    f.authorityDigest !== binding.authorityDigest ||
    f.sourceSha256 !== binding.contentSha256 ||
    f.admissionEventId !== binding.admissionEventId ||
    binding.leaseId !== fence.lease_token ||
    (f.scope === "owner_private" ? f.documentOwnerId !== f.stewardId : f.documentOwnerId !== null) ||
    f.declaredAuthority.supersedesDocumentId === f.documentId
  )
    throw new IngestionAttemptError("ingestion_rpc_invalid");
  Object.freeze(f.declaredAuthority.supportedFeatures);
  Object.freeze(f.declaredAuthority);
  return Object.freeze(f);
}

/** Separate facts profile: an accountable administrator is never substituted for a document owner. */
export function readAdministratorReindexAuthorityFacts(args: {
  attempt: IngestionAttempt;
  generationId: string;
  sourceBinding: ProviderEgressBinding;
  rpc: (
    name: "read_administrator_reindex_authority",
    payload: { p_fence: IngestionFence; p_generation: string },
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
}) {
  const binding = Object.freeze({ ...args.sourceBinding }),
    generation = args.generationId;
  return args.attempt.serialize(async () => {
    try {
      args.attempt.check();
      const fence = Object.freeze({ ...args.attempt.fence });
      if (
        !uuid.safeParse(generation).success ||
        fence.job_kind !== "node" ||
        binding.documentId !== fence.document_id ||
        binding.jobId !== fence.job_id ||
        binding.generationId !== generation ||
        binding.leaseId !== fence.lease_token ||
        binding.authorityDigest !== fence.authority_digest
      )
        throw new IngestionAttemptError("ingestion_rpc_invalid");
      const value = await runIngestionPersistence(() =>
        args.rpc("read_administrator_reindex_authority", { p_fence: fence, p_generation: generation }),
      );
      args.attempt.check();
      if (JSON.stringify(args.attempt.fence) !== JSON.stringify(fence))
        throw new IngestionAttemptError("ingestion_rpc_invalid");
      return parseAdministratorReindexAuthorityFacts(value, fence, generation, binding);
    } catch (error) {
      args.attempt.cancel();
      throw error;
    }
  });
}
