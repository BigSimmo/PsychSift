import { createHash } from "node:crypto";
import { rm } from "node:fs/promises";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { isAdministratorUser } from "../src/lib/authorization";
import { australianSourceCatalogue, assertIndexableCatalogueEntry } from "../src/lib/australian-source-catalogue";
import { INTERNAL_BUILD_LEGAL_REVIEW_DEFERRAL, type ProviderEgressBinding } from "../src/lib/document-ingress-safety";
import { bytesDigest, generationEvidenceDigest } from "../src/lib/ingestion-generation-evidence";
import type { AdminSourceRuntimeSuppliers } from "./admin-source-runtime";
import { buildInternalRichPdfExpectation } from "./managed-full-pdf-terminal";
import { administratorReindexAuthorityFactsSchema } from "./reindex-provider-authority";
import { inspectRichPdfSource, type RichPdfInspectionResult } from "./rich-pdf-inspection";
import { workerProviderSourceBinding } from "./provider-egress";
import type { JobRow } from "./types";

const sha = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const policySchema = z
  .object({
    bucket: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,99}$/),
    allowedDocumentIds: z
      .array(z.uuid())
      .min(1)
      .max(100)
      .refine((ids) => new Set(ids).size === ids.length),
    approvalReferenceSha256: sha,
    issuedAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
  })
  .strict();
const eventSchema = z.object({
  id: z.uuid(),
  document_id: z.uuid(),
  ingestion_job_id: z.uuid(),
  staging_owner_id: z.uuid(),
  source_channel: z.literal("admin_api"),
  actor_kind: z.literal("administrator"),
  administrator_id: z.uuid(),
  backend_principal: z.null(),
  admission_policy_version: z.literal("trusted-document-admission-v1"),
  content_sha256: sha,
  file_name_sha256: sha,
  storage_path_sha256: sha,
  mime_type: z.literal("application/pdf"),
  byte_count: z.number().int().positive().max(157286400),
  admission_digest: sha,
  authority: administratorReindexAuthorityFactsSchema.shape.declaredAuthority,
});
const same = (a: unknown, b: unknown) => generationEvidenceDigest(a) === generationEvidenceDigest(b);
function refuse(reason: string): never {
  throw new Error(`internal_rich_pdf_${reason}`);
}
export type InternalRichPdfBuildOptions = z.input<typeof policySchema> & {
  inspectRichPdf: (
    bytes: Uint8Array,
    binding: ProviderEgressBinding,
    options?: { signal?: AbortSignal },
  ) => Promise<RichPdfInspectionResult>;
};

/** Finite server-owned scope. Every operation rereads actual admission/admin/source;
 * only the expensive structural/extraction result is cached for the live attempt. */
export function createInternalRichPdfBuildSuppliers(
  client: SupabaseClient,
  options: InternalRichPdfBuildOptions,
): AdminSourceRuntimeSuppliers {
  const { inspectRichPdf, ...raw } = options;
  const policy = policySchema.parse(raw);
  const allowed = new Set(policy.allowedDocumentIds);
  const issued = Date.parse(policy.issuedAt),
    expires = Date.parse(policy.expiresAt);
  const current = () => {
    const now = Date.now();
    if (issued > now || expires <= now || expires <= issued || expires - issued > 86400000)
      refuse("policy_not_current");
  };
  current();
  const cache = new WeakMap<JobRow, { key: string; result: Promise<RichPdfInspectionResult> }>();
  async function original(job: JobRow) {
    current();
    const jobDigest = generationEvidenceDigest(job),
      binding = workerProviderSourceBinding(job, job.documents);
    if (
      !allowed.has(job.document_id) ||
      job.document_id !== job.documents.id ||
      !z.uuid().safeParse(job.lease_token).success ||
      !sha.safeParse(job.lease_authority_digest).success ||
      !Number.isFinite(Date.parse(job.lease_expires_at)) ||
      Date.parse(job.lease_expires_at) <= Date.now()
    )
      refuse("attempt_binding");
    const loaded = await client
      .from("documents")
      .select("id,owner_id,title,file_name,file_type,storage_path,content_hash,file_size,metadata")
      .eq("id", job.document_id)
      .single();
    current();
    const d = loaded.data as JobRow["documents"] | null;
    if (
      loaded.error ||
      !d ||
      d.file_type !== "application/pdf" ||
      d.owner_id !== job.documents.owner_id ||
      d.file_name !== job.documents.file_name ||
      d.storage_path !== job.documents.storage_path ||
      d.file_size !== job.documents.file_size ||
      !same(d.metadata, job.documents.metadata) ||
      !same(binding, workerProviderSourceBinding(job, d))
    )
      refuse("source_binding");
    const m = d.metadata;
    if (
      !m ||
      m.rights === "denied" ||
      m.indexLicence === "not_permitted" ||
      m.licence_policy === "index_forbidden" ||
      m.licence_policy === "metadata_link_only" ||
      m.content_mode === "metadata_link_only" ||
      m.source_kind === "link_only" ||
      m.public_source_version_id !== undefined ||
      m.source_catalogue_key !== undefined
    )
      refuse("source_ineligible");
    const marker = z
      .object({
        version: z.literal("administrator-current-reindex-readmission-v1"),
        scope: z.enum(["owner_private", "existing_shared_library_stewardship"]),
        administratorId: z.uuid(),
        documentOwnerId: z.uuid().nullable(),
        sourceSha256: sha,
        origin: z.literal("historical_upload_origin_not_established"),
      })
      .passthrough()
      .parse(m.reindex_readmission);
    if (
      marker.documentOwnerId !== d.owner_id ||
      marker.sourceSha256 !== binding.contentSha256 ||
      (marker.scope === "owner_private"
        ? d.owner_id !== marker.administratorId
        : d.owner_id !== null || m.public_corpus !== true)
    )
      refuse("stewardship_scope");
    const admission = await client
      .from("document_admission_events")
      .select(
        "id,document_id,ingestion_job_id,staging_owner_id,source_channel,actor_kind,administrator_id,backend_principal,admission_policy_version,content_sha256,file_name_sha256,storage_path_sha256,mime_type,byte_count,admission_digest,authority",
      )
      .eq("id", binding.admissionEventId)
      .eq("document_id", job.document_id)
      .single();
    current();
    const e = eventSchema.parse(admission.data);
    if (
      admission.error ||
      e.id !== binding.admissionEventId ||
      e.document_id !== d.id ||
      e.ingestion_job_id !== job.id ||
      e.administrator_id !== marker.administratorId ||
      e.staging_owner_id !== e.administrator_id ||
      e.content_sha256 !== binding.contentSha256 ||
      e.byte_count !== d.file_size ||
      e.file_name_sha256 !== bytesDigest(Buffer.from(d.file_name)) ||
      e.storage_path_sha256 !== bytesDigest(Buffer.from(d.storage_path)) ||
      !same(e.authority, m.authority) ||
      m.admission_policy_version !== e.admission_policy_version
    )
      refuse("admission_binding");
    // Known exclusions are retained; an unmatched current administrator declaration
    // is internal provenance, never a resolved catalogue/public licence assertion.
    const known = australianSourceCatalogue.filter((entry) => entry.publisher === e.authority.publisher);
    for (const entry of known) assertIndexableCatalogueEntry(entry);
    const matching = known.filter(
      (entry) => entry.jurisdiction === e.authority.jurisdiction && entry.roles.includes(e.authority.sourceRole),
    );
    if (known.length && !matching.length) refuse("catalogue_authority_mismatch");
    const admin = await client.auth.admin.getUserById(e.administrator_id);
    current();
    const user = admin.data?.user;
    if (
      admin.error ||
      !user ||
      user.id !== e.administrator_id ||
      !isAdministratorUser(user) ||
      (user.banned_until &&
        (!Number.isFinite(Date.parse(user.banned_until)) || Date.parse(user.banned_until) > Date.now()))
    )
      refuse("administrator_unavailable");
    const bucket = await client.storage.getBucket(policy.bucket);
    current();
    if (bucket.error || bucket.data?.public !== false) refuse("private_bucket_required");
    const downloaded = await client.storage.from(policy.bucket).download(d.storage_path);
    current();
    if (downloaded.error || !downloaded.data || downloaded.data.size !== e.byte_count) refuse("original_unavailable");
    const bytes = Buffer.from(await downloaded.data.arrayBuffer());
    current();
    if (
      bytes.length !== e.byte_count ||
      bytesDigest(bytes) !== binding.contentSha256 ||
      jobDigest !== generationEvidenceDigest(job) ||
      Date.parse(job.lease_expires_at) <= Date.now()
    )
      refuse("original_identity");
    return {
      document: d,
      event: e,
      marker,
      binding,
      bytes,
      catalogueKey:
        matching.length === 1
          ? matching[0].key
          : `administrator-reindex:${generationEvidenceDigest(e.authority).slice(7)}`,
    };
  }
  return {
    async loadApprovedSource(job, purpose, signal) {
      signal?.throwIfAborted();
      if (purpose !== "embedding") refuse("purpose");
      const source = await original(job);
      signal?.throwIfAborted();
      const key = generationEvidenceDigest(source.binding);
      let cached = cache.get(job);
      const newlyOwned = !cached || cached.key !== key;
      if (newlyOwned) {
        cached = { key, result: inspectRichPdf(Buffer.from(source.bytes), source.binding, { signal }) };
        cache.set(job, cached);
      }
      const result = await cached!.result;
      try {
        signal?.throwIfAborted();
        current();
        inspectRichPdfSource(result.review, source.bytes, source.binding);
      } catch (error) {
        if (newlyOwned) {
          cache.delete(job);
          await Promise.all(
            (result.extracted.temporaryPaths ?? []).map((directory) => rm(directory, { recursive: true, force: true })),
          );
        }
        throw error;
      }
      return {
        ownerId: source.document.owner_id,
        stewardId: source.event.administrator_id,
        documentId: source.document.id,
        storagePath: source.document.storage_path,
        sourceSha256: source.binding.contentSha256,
        sourceByteLength: source.bytes.length,
        sourceBytes: source.bytes,
        authority: source.event.authority,
        catalogueKey: source.catalogueKey,
        sourceFamily: "rich_pdf",
        richPdf: result,
        ...buildInternalRichPdfExpectation(source.bytes, result.review),
        policyObservations: {
          binding: source.binding,
          policyVersion: "administrator-internal-rich-pdf-build-v1",
          purpose: "embedding",
          admission: "current",
          ownerScope: "permitted",
          rights: "review_deferred",
          indexLicence: "review_deferred",
          legalReviewDeferral: INTERNAL_BUILD_LEGAL_REVIEW_DEFERRAL,
          purposeClearance: "permitted",
          source: "eligible",
          sourcePolicy: "matched",
          processingScope:
            source.document.owner_id === null ? "existing_shared_library_reindex" : "owner_internal_build",
        },
      };
    },
    async loadScannerConfiguration() {
      return refuse("legacy_scanner_profile_unsupported");
    },
    async loadRichScannerConfiguration(args) {
      args.request.signal?.throwIfAborted();
      const source = await original(args.job);
      args.request.signal?.throwIfAborted();
      if (
        !same(args.binding, source.binding) ||
        (args.phase === "source" && args.contentSha256 !== source.binding.contentSha256)
      )
        refuse("scanner_binding");
      const h = createHash("sha256")
        .update(`${policy.approvalReferenceSha256}:${generationEvidenceDigest(source.binding)}`)
        .digest("hex");
      return {
        backend: "administrator_rich_unscanned_exception",
        evidence: {
          version: "administrator-rich-source-unscanned-v2",
          grant: {
            exceptionId: `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`,
            approvalReferenceSha256: policy.approvalReferenceSha256,
            status: "active",
            issuedAt: policy.issuedAt,
            expiresAt: policy.expiresAt,
            allowedPurposes: ["embedding"],
          },
          provenance: {
            documentOwnerId: source.document.owner_id,
            stewardId: source.event.administrator_id,
            administratorId: source.event.administrator_id,
            administratorActive: true,
            scope: source.marker.scope,
            existingSharedPublic: source.document.metadata?.public_corpus === true,
            admissionDigest: source.event.admission_digest,
            binding: source.binding,
          },
        },
      };
    },
  };
}
