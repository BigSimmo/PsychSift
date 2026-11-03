import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { isAdministratorUser } from "../src/lib/authorization";
import {
  australianSourceCatalogue,
  australianSourcePolicyVersion,
  assertIndexableCatalogueEntry,
} from "../src/lib/australian-source-catalogue";
import {
  INTERNAL_BUILD_LEGAL_REVIEW_DEFERRAL,
  type ContentSha256,
  type ProviderEgressBinding,
} from "../src/lib/document-ingress-safety";
import {
  bytesDigest,
  generationEvidenceBytes,
  generationEvidenceDigest,
  originalApplicabilityFamilies,
  parseOriginalApplicabilityWitness,
  type OriginalApplicabilityWitness,
  type SourceExpectation,
} from "../src/lib/ingestion-generation-evidence";
import {
  assertTrustedDocumentStoragePath,
  createTrustedDocumentAdmission,
  type TrustedAdmissionAuthority,
} from "../src/lib/trusted-document-admission";
import {
  ADMIN_UNSCANNED_EXCEPTION_POLICY,
  ADMIN_UNSCANNED_EXCEPTION_MAX_VALIDITY_MS,
  snapshotAdminUnscannedExceptionEvidence,
} from "../supabase/functions/_shared/admin-unscanned-exception";
import type { AdminSourceRuntimeSuppliers } from "./admin-source-runtime";
import {
  generalPdfInspectionReviewSchema,
  inspectGeneralPdfSource,
  type GeneralPdfInspectionReview,
} from "./general-pdf-inspection";
import { workerProviderSourceBinding } from "./provider-egress";
import type { JobRow } from "./types";

export const INTERNAL_ADMIN_BUILD_POLICY_VERSION = `owner-internal-admin-build-v1:${australianSourcePolicyVersion}`;
const uuid = z.uuid();
const sha = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const policySchema = z
  .object({
    bucket: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,99}$/),
    allowedDocumentIds: z
      .array(uuid)
      .min(1)
      .refine((ids) => new Set(ids).size === ids.length),
    approvalReferenceSha256: sha,
    issuedAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
  })
  .strict();
const eventSchema = z.object({
  id: uuid,
  document_id: uuid,
  staging_owner_id: uuid,
  source_channel: z.literal("admin_api"),
  actor_kind: z.literal("administrator"),
  administrator_id: uuid,
  backend_principal: z.null(),
  correlation_id: uuid,
  admission_policy_version: z.literal("trusted-document-admission-v1"),
  content_sha256: sha,
  file_name_sha256: sha,
  storage_path_sha256: sha,
  mime_type: z.literal("application/pdf"),
  byte_count: z.number().int().positive().max(157286400),
  authority: z.record(z.string(), z.unknown()),
  admission_digest: sha,
});
const same = (a: unknown, b: unknown) => generationEvidenceDigest(a) === generationEvidenceDigest(b);
function refuse(reason: string): never {
  throw new Error(`internal_admin_build_${reason}`);
}

export type InternalAdminBuildOptions = Readonly<{
  bucket: string;
  allowedDocumentIds: readonly string[];
  approvalReferenceSha256: string;
  issuedAt: string;
  expiresAt: string;
  inspectNativePdf: (
    bytes: Uint8Array,
    binding: Readonly<ProviderEgressBinding>,
  ) => Promise<GeneralPdfInspectionReview>;
}>;

/** Only structural page obligations in the independently inspected native-text profile.
 * This is not a clinical, visual, semantic, legal or public-publication assessment. */
export function buildInternalNativePdfExpectation(originalBytes: Buffer, inspection: GeneralPdfInspectionReview) {
  inspectGeneralPdfSource(inspection, originalBytes, inspection.binding);
  const units: NonNullable<SourceExpectation["units"]> = inspection.pages.map((page) => ({
    id: `native-page-${page.pageNumber}-${page.textSha256.slice(7)}`,
    required: true,
    dependencies: [],
    locator: `pdf-page:${page.pageNumber}:native-text:${page.textSha256}`,
    nativeMapping: "unavailable",
  }));
  const witness: OriginalApplicabilityWitness = {
    version: "ingestion-original-applicability-v1",
    qualification: "independently_declared_unverified",
    sourceSha256: bytesDigest(originalBytes),
    sourceByteLength: originalBytes.length,
    sourceUnits: units,
    groups: originalApplicabilityFamilies.map((family) => ({
      family,
      population: {
        tag: "known",
        requirements:
          family === "chunks"
            ? units.map((unit) => ({ id: `chunks-${unit.id}`, required: true, sourceEvidenceIds: [unit.id] }))
            : [],
        basis: { scope: "whole_original", kind: "independent_original_declaration" },
        reason: family === "chunks" ? null : "no_original_requirements_in_scope",
      },
    })),
  };
  const sourceExpectationWitnessBytes = generationEvidenceBytes(witness);
  const sourceExpectation: SourceExpectation = {
    version: 1,
    sourceSha256: bytesDigest(originalBytes),
    tag: "known",
    units,
    witness: {
      reference: "independent-native-text-structural-profile-v1",
      sha256: bytesDigest(sourceExpectationWitnessBytes),
    },
    limitation: null,
  };
  parseOriginalApplicabilityWitness({ sourceExpectation, originalBytes, witnessBytes: sourceExpectationWitnessBytes });
  return { sourceExpectation, sourceExpectationWitnessBytes };
}

/** Disabled unless explicitly constructed by the server with a finite current policy.
 * No construction-time reads, scanner work, environment fallback or provider requests. */
export function createInternalAdminBuildSuppliers(
  client: SupabaseClient,
  options: InternalAdminBuildOptions,
): AdminSourceRuntimeSuppliers {
  if (!options || typeof options.inspectNativePdf !== "function") refuse("configuration_required");
  const { inspectNativePdf, ...rawPolicy } = options;
  const parsed = policySchema.safeParse(rawPolicy);
  if (!parsed.success) refuse("configuration_invalid");
  const policy = Object.freeze(parsed.data);
  const allowed = new Set(policy.allowedDocumentIds);
  const issued = Date.parse(policy.issuedAt),
    expires = Date.parse(policy.expiresAt);
  // Only source inspection is reusable, and only for the same live job and exact
  // source/attempt binding. Permission, admission, user and bytes are always reread.
  const inspected = new WeakMap<
    JobRow,
    { key: string; expiresAt: number; review: Promise<GeneralPdfInspectionReview> }
  >();
  const current = () => {
    const now = Date.now();
    if (
      issued > now ||
      expires <= now ||
      expires <= issued ||
      expires - issued > ADMIN_UNSCANNED_EXCEPTION_MAX_VALIDITY_MS
    )
      refuse("policy_not_current");
  };
  current();

  async function original(job: JobRow) {
    current();
    if (
      !allowed.has(job.document_id) ||
      job.document_id !== job.documents.id ||
      !uuid.safeParse(job.id).success ||
      !uuid.safeParse(job.lease_token).success ||
      !uuid.safeParse(job.lease_write_generation_id).success ||
      !sha.safeParse(job.lease_authority_digest).success ||
      !Number.isSafeInteger(job.attempt_count) ||
      job.attempt_count < 1 ||
      !Number.isFinite(Date.parse(job.lease_expires_at)) ||
      Date.parse(job.lease_expires_at) <= Date.now()
    )
      refuse("job_binding_invalid");
    const captured = generationEvidenceDigest(job);
    const initial = workerProviderSourceBinding(job, job.documents);
    const result = await client
      .from("documents")
      .select("id,owner_id,title,file_name,file_type,storage_path,content_hash,file_size,metadata")
      .eq("id", job.document_id)
      .single();
    current();
    const document = result.data as JobRow["documents"] | null;
    if (
      result.error ||
      !document ||
      document.id !== job.document_id ||
      !uuid.safeParse(document.owner_id).success ||
      document.owner_id !== job.documents.owner_id ||
      document.file_type !== "application/pdf" ||
      document.file_name !== job.documents.file_name ||
      document.storage_path !== job.documents.storage_path ||
      document.file_size !== job.documents.file_size ||
      !same(document.metadata, job.documents.metadata) ||
      !same(workerProviderSourceBinding(job, document), initial)
    )
      refuse("source_binding_mismatch");
    const metadata = document.metadata;
    if (
      !metadata ||
      metadata.corpus_scope !== "uploaded_local" ||
      metadata.content_mode !== "indexed_content" ||
      metadata.publisher_code !== null ||
      (metadata.source_kind !== undefined && metadata.source_kind !== "document") ||
      metadata.source_catalogue_key !== undefined ||
      metadata.source_policy_version !== undefined ||
      metadata.rights === "denied" ||
      metadata.indexLicence === "not_permitted" ||
      metadata.admission_policy_version !== "trusted-document-admission-v1" ||
      metadata.content_hash !== initial.contentSha256.slice(7)
    )
      refuse("internal_draft_required");
    const read = await client
      .from("document_admission_events")
      .select(
        "id,document_id,staging_owner_id,source_channel,actor_kind,administrator_id,backend_principal,correlation_id,admission_policy_version,content_sha256,file_name_sha256,storage_path_sha256,mime_type,byte_count,authority,admission_digest",
      )
      .eq("id", initial.admissionEventId)
      .eq("document_id", job.document_id)
      .single();
    current();
    const decoded = eventSchema.safeParse(read.data);
    if (read.error || !decoded.success) refuse("admission_unavailable");
    const event = decoded.data;
    const admission = createTrustedDocumentAdmission({
      actor: { kind: "administrator", administratorId: event.administrator_id },
      sourceChannel: "admin_api",
      documentId: event.document_id,
      stagingOwnerId: event.staging_owner_id,
      contentSha256: event.content_sha256 as ContentSha256,
      storagePath: document.storage_path,
      originalFileName: document.file_name,
      mimeType: event.mime_type,
      byteCount: event.byte_count,
      correlationId: event.correlation_id,
      admissionPolicyVersion: event.admission_policy_version,
      authority: event.authority as TrustedAdmissionAuthority,
    });
    const authority = admission.authority;
    if (
      event.id !== initial.admissionEventId ||
      event.document_id !== job.document_id ||
      admission.stagingOwnerId !== document.owner_id ||
      admission.contentSha256 !== initial.contentSha256 ||
      admission.fileNameSha256 !== event.file_name_sha256 ||
      admission.storagePathSha256 !== event.storage_path_sha256 ||
      event.byte_count !== document.file_size ||
      !same(authority, metadata.authority) ||
      authority.authorityBasis !== "administrator_template" ||
      authority.providerProcessing !== "permitted" ||
      !["current", "unknown"].includes(authority.currentness) ||
      !["review_required", "public_index_permitted"].includes(authority.licencePolicy) ||
      metadata.publisher !== authority.publisher ||
      metadata.jurisdiction !== authority.jurisdiction ||
      metadata.source_role !== authority.sourceRole ||
      metadata.licence_policy !== authority.licencePolicy ||
      metadata.document_status !== authority.currentness ||
      metadata.authority_basis !== authority.authorityBasis ||
      metadata.rights_evidence_ref !== authority.rightsEvidenceRef
    )
      refuse("admission_binding_mismatch");
    assertTrustedDocumentStoragePath(document.owner_id!, document.id, document.storage_path);
    const entries = australianSourceCatalogue.filter(
      (entry) =>
        entry.publisher === authority.publisher &&
        entry.jurisdiction === authority.jurisdiction &&
        entry.roles.includes(authority.sourceRole),
    );
    if (entries.length !== 1) refuse("catalogue_unsupported");
    const entry = entries[0]!;
    assertIndexableCatalogueEntry(entry);
    const admin = await client.auth.admin.getUserById(event.administrator_id);
    current();
    const user = admin.data?.user;
    if (
      admin.error ||
      !user ||
      user.id !== event.administrator_id ||
      !isAdministratorUser(user) ||
      (user.banned_until &&
        (!Number.isFinite(Date.parse(user.banned_until)) || Date.parse(user.banned_until) > Date.now()))
    )
      refuse("administrator_unavailable");
    const bucket = await client.storage.getBucket(policy.bucket);
    current();
    if (bucket.error || !bucket.data || bucket.data.public !== false) refuse("private_bucket_required");
    const download = await client.storage.from(policy.bucket).download(document.storage_path);
    current();
    if (download.error || !download.data || download.data.size !== event.byte_count) refuse("original_unavailable");
    const bytes = Buffer.from(await download.data.arrayBuffer());
    current();
    if (
      bytes.length !== event.byte_count ||
      bytesDigest(bytes) !== initial.contentSha256 ||
      captured !== generationEvidenceDigest(job) ||
      Date.parse(job.lease_expires_at) <= Date.now()
    )
      refuse("original_binding_mismatch");
    return { document, event, authority, catalogueKey: entry.key, binding: initial, bytes, jobDigest: captured };
  }

  return {
    async loadApprovedSource(job, purpose) {
      if (purpose !== "embedding") refuse("purpose_unsupported");
      const source = await original(job);
      const key = generationEvidenceDigest(source.binding);
      let cached = inspected.get(job);
      if (!cached || cached.key !== key || cached.expiresAt <= Date.now()) {
        const entry: { key: string; expiresAt: number; review: Promise<GeneralPdfInspectionReview> } = {
          key,
          expiresAt: expires,
          review: Promise.resolve().then(async () => {
            const review = generalPdfInspectionReviewSchema.parse(
              await inspectNativePdf(Buffer.from(source.bytes), { ...source.binding }),
            );
            current();
            inspectGeneralPdfSource(review, source.bytes, source.binding);
            entry.expiresAt = Math.min(expires, Date.parse(review.expiresAt));
            return review;
          }),
        };
        inspected.set(job, entry);
        cached = entry;
      }
      // Zod detaches nested page/binding records so callers cannot rewrite a
      // cached inspection by mutating an earlier returned ApprovedAdminSource.
      const review = generalPdfInspectionReviewSchema.parse(await cached.review);
      current();
      if (Date.parse(job.lease_expires_at) <= Date.now() || generationEvidenceDigest(job) !== source.jobDigest)
        refuse("job_binding_invalid");
      inspectGeneralPdfSource(review, source.bytes, source.binding);
      const deferred = source.authority.licencePolicy === "review_required";
      return {
        ownerId: source.document.owner_id!,
        documentId: source.document.id,
        storagePath: source.document.storage_path,
        sourceSha256: source.binding.contentSha256,
        sourceByteLength: source.bytes.length,
        sourceBytes: source.bytes,
        authority: JSON.parse(JSON.stringify(source.authority)),
        catalogueKey: source.catalogueKey,
        sourceFamily: "native_pdf",
        generalPdf: review,
        ...buildInternalNativePdfExpectation(source.bytes, review),
        policyObservations: {
          binding: source.binding,
          policyVersion: INTERNAL_ADMIN_BUILD_POLICY_VERSION,
          purpose: "embedding",
          admission: "current",
          ownerScope: "permitted",
          rights: deferred ? "review_deferred" : "permitted",
          indexLicence: deferred ? "review_deferred" : "permitted",
          purposeClearance: "permitted",
          source: "eligible",
          sourcePolicy: "matched",
          processingScope: "owner_internal_build",
          ...(deferred ? { legalReviewDeferral: INTERNAL_BUILD_LEGAL_REVIEW_DEFERRAL } : {}),
        },
      };
    },
    async loadScannerConfiguration(args) {
      args.request.signal?.throwIfAborted();
      if (args.request.purpose !== "embedding" || !sha.safeParse(args.contentSha256).success)
        refuse("purpose_unsupported");
      const source = await original(args.job);
      args.request.signal?.throwIfAborted();
      if (
        !same(args.binding, source.binding) ||
        (args.phase === "source" && args.contentSha256 !== source.binding.contentSha256)
      )
        refuse("scanner_binding_mismatch");
      const hex = createHash("sha256")
        .update(generationEvidenceBytes({ approval: policy.approvalReferenceSha256, binding: source.binding }))
        .digest("hex");
      const exceptionId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
      return {
        backend: "admin_unscanned_exception",
        evidence: snapshotAdminUnscannedExceptionEvidence({
          grant: {
            policyVersion: ADMIN_UNSCANNED_EXCEPTION_POLICY,
            exceptionId,
            status: "active",
            administratorId: source.event.administrator_id,
            ownerId: source.document.owner_id,
            binding: source.binding,
            admissionDigest: source.event.admission_digest,
            catalogueKey: source.catalogueKey,
            mimeType: "application/pdf",
            sourceByteLength: source.bytes.length,
            purpose: "embedding",
            approvalReferenceSha256: policy.approvalReferenceSha256,
            issuedAt: policy.issuedAt,
            expiresAt: policy.expiresAt,
          },
          admission: {
            sourceChannel: "admin_api",
            actorKind: "administrator",
            administratorId: source.event.administrator_id,
            administratorActive: true,
            ownerId: source.document.owner_id,
            documentId: source.document.id,
            admissionEventId: source.event.id,
            admissionDigest: source.event.admission_digest,
            sourceSha256: source.binding.contentSha256,
          },
        }),
      };
    },
  };
}
