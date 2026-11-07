import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { createInternalAdminBuildSuppliers } from "./internal-admin-build-suppliers";
import { inspectNativePdfBytes } from "./general-pdf-inspection-producer";
import { inspectRichPdfBytes } from "./rich-pdf-inspection-producer";
import { createInternalRichPdfBuildSuppliers, renderedReviewPolicySchema } from "./internal-rich-pdf-suppliers";
import { inspectRichPdfSource } from "./rich-pdf-inspection";
import { readAdministratorReindexAuthorityFacts } from "./reindex-provider-authority";
import { createReviewedRenderedPdfInspectionLoader } from "./reviewed-rendered-pdf-provider-egress";
import { assertValidatedRenderedPdfReview, type RenderedPdfReviewResult } from "./rendered-pdf-review";
import { createRichPdfInspectionLoader } from "./rich-pdf-provider-egress";
import type { RichAdminUnscannedEvidence } from "../supabase/functions/_shared/rich-admin-unscanned-exception";
import { resolveWorkerClaimScopeFilter } from "./claim-scope";
import { hasInternalBuildLegalReviewDeferral } from "../src/lib/document-ingress-safety";
import { inspectGeneralPdfSource, type GeneralPdfInspectionReview } from "./general-pdf-inspection";
import type { IngestionAttempt } from "../supabase/functions/_shared/ingestion-attempt";
import { parseOriginalApplicabilityWitness, parseSourceExpectation } from "../src/lib/ingestion-generation-evidence";
import {
  ADMIN_TEXT_INSPECTION_MAX_BYTES,
  createAdminTextInspectionLoader,
  type AdminTextCurrentFacts,
  type AdminTextScannerConfiguration,
  type AdminTextInspectionOptions,
} from "./admin-text-inspection";
import type { ManagedAdminTextSourceSectionLayout } from "./managed-admin-text-terminal";
import { prepareManagedPrivateSupplier, type ManagedPreparedSupplierInput } from "./managed-prepared-supplier";
import type { ManagedProviderEmbeddingRequestContext } from "./managed-provider-vectors";
import type { ManagedAdminPdfCompletionEvidence } from "./managed-admin-pdf-terminal";
import { MAX_UPLOAD_MB_CEILING } from "../src/lib/upload-limits";
import { generationEvidenceBytes } from "../src/lib/ingestion-generation-evidence";
import type { buildGenerationRetentionPacket } from "./generation-evidence";
import { decodeRetainedOriginalWitness } from "./original-witness-readback";
import {
  readWorkerProviderAuthorityFacts,
  workerProviderSourceBinding,
  type WorkerProviderAuthorityFacts,
} from "./provider-egress";
import type { JobRow } from "./types";
import type { WorkerRuntimeOptions } from "./main";
import {
  expectedManagedPdfSummaryEvidence,
  expectedManagedRenderedPdfSummaryEvidence,
  type ManagedPdfSummaryContext,
} from "./managed-pdf-summary";

/** Server-owned current permission plus independent original inputs. The supplier
 * must reread operative permission and pinned licence/source-review evidence on
 * every call. Admission declarations and document metadata cannot produce it. */
export type ApprovedAdminSource = Readonly<{
  ownerId: string | null;
  stewardId?: string;
  documentId: string;
  storagePath: string;
  sourceSha256: string;
  sourceByteLength: number;
  sourceBytes: Buffer;
  authority: WorkerProviderAuthorityFacts["declaredAuthority"];
  catalogueKey: string;
  policyObservations: AdminTextCurrentFacts["policyObservations"];
  sourceExpectation: Parameters<typeof buildGenerationRetentionPacket>[0]["sourceExpectation"];
  sourceExpectationWitnessBytes: Buffer;
  // Existing TXT suppliers remain valid. PDF has no synthetic TXT section layout.
  sourceFamily?: "admin_text" | "native_pdf" | "rich_pdf" | "reviewed_rendered_pdf";
  nativeInspection?: AdminTextCurrentFacts["nativePdf"];
  generalPdf?: GeneralPdfInspectionReview;
  richPdf?: import("./rich-pdf-inspection").RichPdfInspectionResult;
  renderedPdf?: {
    acceptedReview: RenderedPdfReviewResult;
    extracted: import("../src/lib/types").ExtractedDocument;
    capturedImages: readonly import("./generation-evidence").CapturedGenerationImage[];
    renderedRasterBytes: Buffer;
  };
  summaryEnabled?: boolean;
  sourceSectionLayout?: ManagedAdminTextSourceSectionLayout;
}>;

export type AdminSourceRuntimeSuppliers = Readonly<{
  /** Undefined revokes permission for this exact current job/source/purpose. */
  loadApprovedSource: (
    job: JobRow,
    purpose: "embedding",
    signal?: AbortSignal,
  ) => Promise<ApprovedAdminSource | undefined>;
  /** Fresh server-owned scanner policy; exception records include independent admin-admission provenance. */
  loadScannerConfiguration: (
    args: Parameters<AdminTextInspectionOptions["loadScannerConfiguration"]>[0] & Readonly<{ job: JobRow }>,
  ) => Promise<AdminTextScannerConfiguration>;
  loadRichScannerConfiguration?: (args: {
    job: JobRow;
    request: import("../src/lib/ingestion-provider-egress").IngestionProviderEgressRequest;
    binding: Readonly<import("../src/lib/document-ingress-safety").ProviderEgressBinding>;
    contentSha256: import("../src/lib/document-ingress-safety").ContentSha256;
    phase: "source" | "payload";
  }) => Promise<{ backend: "administrator_rich_unscanned_exception"; evidence: RichAdminUnscannedEvidence }>;
  loadManagedAdminPdfCompletionEvidence?: (
    input: ManagedPreparedSupplierInput,
  ) => Promise<ManagedAdminPdfCompletionEvidence | undefined>;
  loadManagedNativePdfSourceRoles?: (
    input: ManagedPreparedSupplierInput,
  ) => Promise<NonNullable<ManagedPreparedSupplierInput["independentSourceRoles"]>>;
}>;

export type AdminSourceInitializationContext = {
  adoptPreparedExtraction?: (extracted: import("../src/lib/types").ExtractedDocument) => void;
  readInventory: () => Promise<Record<string, unknown>>;
  prepare: (source: ApprovedAdminSource, bytes: Buffer) => Promise<ReturnType<typeof buildGenerationRetentionPacket>>;
  mutation: (name: string, payload: Record<string, unknown>) => Promise<Record<string, unknown>>;
};

const digest = (bytes: Buffer) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const same = (a: unknown, b: unknown) => generationEvidenceBytes(a).equals(generationEvidenceBytes(b));
const refuse = (): never => {
  throw new Error("admin_source_runtime_current_input_required");
};

function registeredOriginalInputs(job: JobRow, source: ApprovedAdminSource, reply: Record<string, unknown>) {
  const inventory = reply.inventory as Record<string, unknown> | null;
  if (
    reply.ok !== true ||
    reply.managed !== true ||
    !inventory ||
    inventory.jobId !== job.id ||
    inventory.authorityDigest !== job.lease_authority_digest ||
    inventory.predecessorGenerationId !== job.lease_expected_generation_id ||
    inventory.documentId !== job.document_id ||
    inventory.generationId !== job.lease_write_generation_id ||
    inventory.sourceSha256 !== source.sourceSha256 ||
    inventory.sourceByteLength !== source.sourceByteLength ||
    !same(inventory.sourceExpectation, source.sourceExpectation) ||
    !Array.isArray(inventory.artifacts)
  )
    return refuse();
  const witness = decodeRetainedOriginalWitness({
    documentId: job.document_id,
    generationId: job.lease_write_generation_id,
    originalBytes: source.sourceBytes,
    inventory,
  });
  if (
    (witness.status === "unavailable" && witness.reason !== "witness_not_retained") ||
    (witness.status === "retained" && !witness.witnessBytes.equals(source.sourceExpectationWitnessBytes))
  )
    return refuse();
  const originals = [
    {
      key: "original-source",
      representation: "original_binary",
      bytes: source.sourceBytes,
      locator: "whole_original_file",
    },
    {
      key: "original-source-expectation-witness",
      representation: "source_expectation_witness",
      bytes: source.sourceExpectationWitnessBytes,
      locator: "independent_original_expectation_witness",
    },
  ];
  const missing = originals
    .filter((expected) => {
      const rows = (inventory.artifacts as Record<string, unknown>[]).filter((row) =>
        same(row.unitId, { family: "private_objects", key: expected.key }),
      );
      if (rows.length > 1) return refuse();
      if (!rows.length) return true;
      const row = rows[0];
      if (
        row.groupKey !== "private_objects" ||
        row.representation !== expected.representation ||
        row.sourceSha256 !== source.sourceSha256 ||
        row.sha256 !== digest(expected.bytes) ||
        row.byteLength !== expected.bytes.length ||
        row.locator !== expected.locator
      )
        return refuse();
      return false;
    })
    .map((expected) => expected.key);
  return { inventory, missing };
}

function validateSource(job: JobRow, source: ApprovedAdminSource): ApprovedAdminSource {
  const binding = workerProviderSourceBinding(job, job.documents);
  const policy = source.policyObservations;
  const rich =
    (source.sourceFamily === "rich_pdf" || source.sourceFamily === "reviewed_rendered_pdf") &&
    (source.richPdf !== undefined || source.renderedPdf !== undefined) &&
    typeof source.stewardId === "string" &&
    z.uuid().safeParse(source.stewardId).success &&
    (source.ownerId === source.stewardId ||
      (source.ownerId === null && job.documents.metadata?.public_corpus === true)) &&
    job.documents.metadata?.reindex_readmission !== undefined;
  const pdf = source.sourceFamily === "native_pdf" || rich;
  const deferred = rich
    ? policy.rights === "review_deferred" &&
      policy.indexLicence === "review_deferred" &&
      policy.legalReviewDeferral === "owner-internal-build-2026-11-03"
    : hasInternalBuildLegalReviewDeferral(policy, job.documents.metadata?.corpus_scope);
  if (
    !((pdf && job.documents.file_type === "application/pdf") || (!pdf && job.documents.file_type === "text/plain")) ||
    (!rich && !job.documents.owner_id) ||
    source.ownerId !== job.documents.owner_id ||
    source.documentId !== job.document_id ||
    source.storagePath !== job.documents.storage_path ||
    source.sourceSha256 !== binding.contentSha256 ||
    !Buffer.isBuffer(source.sourceBytes) ||
    source.sourceByteLength !== source.sourceBytes.length ||
    source.sourceByteLength < 1 ||
    source.sourceByteLength > (pdf ? MAX_UPLOAD_MB_CEILING * 1024 * 1024 : ADMIN_TEXT_INSPECTION_MAX_BYTES) ||
    digest(source.sourceBytes) !== source.sourceSha256 ||
    (job.documents.file_size != null && job.documents.file_size !== source.sourceByteLength) ||
    !same(source.authority, job.documents.metadata?.authority) ||
    !same(policy.binding, binding) ||
    policy.purpose !== "embedding" ||
    policy.admission !== "current" ||
    policy.ownerScope !== "permitted" ||
    (policy.rights !== "permitted" && !deferred) ||
    policy.purposeClearance !== "permitted" ||
    policy.source !== "eligible" ||
    (policy.indexLicence !== "permitted" && !deferred) ||
    policy.sourcePolicy !== "matched" ||
    !policy.policyVersion ||
    !source.catalogueKey ||
    (source.generalPdf !== undefined &&
      (source.sourceFamily !== "native_pdf" || source.nativeInspection !== undefined)) ||
    (pdf
      ? source.sourceSectionLayout !== undefined
      : source.sourceSectionLayout !== undefined && source.sourceSectionLayout.sourceSha256 !== source.sourceSha256)
  )
    return refuse();
  const expectation = parseSourceExpectation(source.sourceExpectation);
  if (expectation.tag !== "known" || expectation.sourceSha256 !== source.sourceSha256) return refuse();
  parseOriginalApplicabilityWitness({
    sourceExpectation: expectation,
    originalBytes: source.sourceBytes,
    witnessBytes: source.sourceExpectationWitnessBytes,
  });
  if (source.sourceFamily === "rich_pdf") {
    if (!source.richPdf || source.renderedPdf) return refuse();
    inspectRichPdfSource(source.richPdf.review, source.sourceBytes, binding);
  }
  if (source.sourceFamily === "reviewed_rendered_pdf") {
    if (!source.renderedPdf || source.richPdf || source.summaryEnabled !== true) return refuse();
    assertValidatedRenderedPdfReview(source.renderedPdf.acceptedReview);
    if (source.renderedPdf.acceptedReview.review.sourceSha256 !== source.sourceSha256) return refuse();
  }
  // Detached evidence prevents a supplier from mutating a returned plan while awaited.
  return {
    ...source,
    sourceBytes: Buffer.from(source.sourceBytes),
    sourceExpectationWitnessBytes: Buffer.from(source.sourceExpectationWitnessBytes),
    sourceExpectation: JSON.parse(generationEvidenceBytes(expectation).toString("utf8")),
    ...(source.sourceSectionLayout === undefined
      ? {}
      : { sourceSectionLayout: JSON.parse(generationEvidenceBytes(source.sourceSectionLayout).toString("utf8")) }),
    authority: JSON.parse(generationEvidenceBytes(source.authority).toString("utf8")),
    policyObservations: JSON.parse(generationEvidenceBytes(policy).toString("utf8")),
    ...(source.renderedPdf === undefined
      ? {}
      : {
          renderedPdf: {
            acceptedReview: source.renderedPdf.acceptedReview,
            extracted: structuredClone(source.renderedPdf.extracted),
            capturedImages: structuredClone(source.renderedPdf.capturedImages),
            renderedRasterBytes: Buffer.from(source.renderedPdf.renderedRasterBytes),
          },
        }),
    ...(source.generalPdf === undefined
      ? {}
      : {
          generalPdf: JSON.parse(generationEvidenceBytes(source.generalPdf).toString("utf8")),
        }),
  };
}

/** No imports, downloads, claims, scans or provider requests occur at construction. */
export function createAdminSourceRuntimeOptions(
  client: SupabaseClient,
  suppliers: AdminSourceRuntimeSuppliers,
  bucket: string,
): Pick<
  WorkerRuntimeOptions,
  | "loadObservationsForJob"
  | "loadManagedAdminTextSectionLayout"
  | "loadManagedNativePdfSourceRoles"
  | "loadManagedAdminPdfCompletionEvidence"
  | "initializeManagedAdminTextGeneration"
  | "loadManagedGeneralPdfInspection"
  | "loadManagedRichPdfInspection"
  | "loadManagedRenderedPdfInspection"
> {
  const attemptProfiles = new WeakMap<
    JobRow,
    { family: ApprovedAdminSource["sourceFamily"]; sourceSha256: string; reviewSha256?: string }
  >();
  async function current(
    job: JobRow,
    attempt?: IngestionAttempt,
    adoptPreparedExtraction?: AdminSourceInitializationContext["adoptPreparedExtraction"],
  ) {
    attempt?.check();
    const source = await suppliers.loadApprovedSource(job, "embedding", attempt?.signal);
    // Transfer newly produced temporary ownership before cancellation/validation
    // can fail. processJob's existing finally then owns every failure path.
    if (source?.richPdf) adoptPreparedExtraction?.(source.richPdf.extracted);
    if (source?.renderedPdf) adoptPreparedExtraction?.(source.renderedPdf.extracted);
    attempt?.check();
    if (source === undefined) return undefined;
    const validated = validateSource(job, source);
    const profile = {
      family: validated.sourceFamily,
      sourceSha256: validated.sourceSha256,
      reviewSha256: validated.renderedPdf?.acceptedReview.reviewSha256,
    };
    const pinned = attemptProfiles.get(job);
    // A changed approved record belongs to a new attempt, never an in-flight
    // plan whose existing summary and embedding rows describe the old record.
    if (
      pinned &&
      (pinned.reviewSha256 || profile.reviewSha256) &&
      (pinned.family !== profile.family ||
        pinned.sourceSha256 !== profile.sourceSha256 ||
        pinned.reviewSha256 !== profile.reviewSha256)
    )
      return refuse();
    if (!pinned) attemptProfiles.set(job, profile);
    return validated;
  }
  async function actual(job: JobRow, source: ApprovedAdminSource, attempt: IngestionAttempt) {
    const { data, error } = await client
      .from("documents")
      .select("id,owner_id,storage_path,content_hash,metadata")
      .eq("id", job.document_id)
      .single();
    attempt.check();
    if (
      error ||
      !data ||
      data.owner_id !== source.ownerId ||
      data.storage_path !== source.storagePath ||
      !same(workerProviderSourceBinding(job, data), source.policyObservations.binding) ||
      !same(data.metadata?.authority, source.authority)
    )
      return refuse();
    // Rich suppliers just downloaded and hash-checked the current original. Avoid
    // a duplicate full-file transfer after this fresh DB identity check.
    if (source.sourceFamily === "rich_pdf" || source.sourceFamily === "reviewed_rendered_pdf")
      return { bytes: Buffer.from(source.sourceBytes), metadata: data.metadata };
    const result = await client.storage.from(bucket).download(data.storage_path);
    attempt.check();
    if (result.error || !result.data) return refuse();
    const bytes = Buffer.from(await result.data.arrayBuffer());
    attempt.check();
    if (!bytes.equals(source.sourceBytes)) return refuse();
    return { bytes, metadata: data.metadata };
  }
  return {
    loadObservationsForJob(
      job,
      attempt,
      batchContext?: ManagedProviderEmbeddingRequestContext,
      summaryContext?: ManagedPdfSummaryContext,
    ) {
      if (job.documents.metadata?.reindex_readmission !== undefined && job.documents.file_type === "application/pdf") {
        // Profile selection is a server-owned supplier capability. The loader
        // reselects from fresh policy/source on each dispatch; metadata cannot opt in.
        return async (request, binding) => {
          const selected = await current(job, attempt);
          if (selected?.renderedPdf) {
            return createReviewedRenderedPdfInspectionLoader({
              attempt,
              binding: workerProviderSourceBinding(job, job.documents),
              nativePdfBatch: batchContext,
              async expectedPayloadForPurpose(purpose, source) {
                if (purpose !== "summary" || !summaryContext || !selected.summaryEnabled) return undefined;
                if (
                  summaryContext.sourceInput.document.id !== binding.documentId ||
                  summaryContext.sourceInput.indexGenerationId !== binding.generationId
                )
                  return refuse();
                return expectedManagedRenderedPdfSummaryEvidence(
                  summaryContext,
                  source.acceptedReview,
                  source.sourceBytes,
                );
              },
              async loadCurrent(_request, currentBinding) {
                const source = await current(job, attempt);
                if (
                  !source?.renderedPdf ||
                  !source.stewardId ||
                  !source.summaryEnabled ||
                  !same(currentBinding, source.policyObservations.binding)
                )
                  return refuse();
                const facts = await readAdministratorReindexAuthorityFacts({
                  attempt,
                  generationId: currentBinding.generationId,
                  sourceBinding: currentBinding,
                  rpc: client.rpc.bind(client),
                });
                if (
                  facts.documentOwnerId !== source.ownerId ||
                  facts.stewardId !== source.stewardId ||
                  facts.sourceByteLength !== source.sourceByteLength ||
                  !same(facts.declaredAuthority, source.authority)
                )
                  return refuse();
                const loaded = await actual(job, source, attempt);
                return {
                  facts,
                  binding: currentBinding,
                  sourceMetadata: loaded.metadata,
                  sourceBytes: loaded.bytes,
                  acceptedReview: source.renderedPdf.acceptedReview,
                  capturedImages: source.renderedPdf.capturedImages,
                  identifierTexts: [job.documents.title, job.documents.file_name, job.documents.source_path ?? ""],
                  policyObservations: {
                    policyVersion: source.policyObservations.policyVersion,
                    rights: "review_deferred",
                    indexLicence: "review_deferred",
                    legalReviewDeferral: "owner-internal-build-2026-11-03",
                    purposeClearance: "permitted",
                  },
                };
              },
              async loadScannerConfiguration(args) {
                if (!suppliers.loadRichScannerConfiguration) return refuse();
                return suppliers.loadRichScannerConfiguration({ ...args, job });
              },
            })(request, binding);
          }
          return createRichPdfInspectionLoader({
            attempt,
            binding: workerProviderSourceBinding(job, job.documents),
            nativePdfBatch: batchContext,
            async expectedPayloadForPurpose(purpose, source) {
              if (purpose !== "summary" || !summaryContext) return undefined;
              const currentSource = await current(job, attempt);
              if (!currentSource?.summaryEnabled) return refuse();
              return expectedManagedPdfSummaryEvidence(summaryContext, source.review, source.sourceBytes);
            },
            async loadCurrent(request, binding) {
              const source = await current(job, attempt);
              if (!source?.richPdf || !source.stewardId || !same(binding, source.policyObservations.binding))
                return refuse();
              const facts = await readAdministratorReindexAuthorityFacts({
                attempt,
                generationId: binding.generationId,
                sourceBinding: binding,
                rpc: client.rpc.bind(client),
              });
              if (
                facts.documentOwnerId !== source.ownerId ||
                facts.stewardId !== source.stewardId ||
                facts.sourceByteLength !== source.sourceByteLength ||
                !same(facts.declaredAuthority, source.authority)
              )
                return refuse();
              const loaded = await actual(job, source, attempt);
              return {
                facts,
                binding,
                sourceMetadata: loaded.metadata,
                sourceBytes: loaded.bytes,
                review: source.richPdf.review,
                capturedImages: source.richPdf.capturedImages,
                policyObservations: {
                  policyVersion: source.policyObservations.policyVersion,
                  rights: "review_deferred",
                  indexLicence: "review_deferred",
                  legalReviewDeferral: "owner-internal-build-2026-11-03",
                  purposeClearance: "permitted",
                },
              };
            },
            async loadScannerConfiguration(args) {
              if (!suppliers.loadRichScannerConfiguration) return refuse();
              return suppliers.loadRichScannerConfiguration({ ...args, job });
            },
          })(request, binding);
        };
      }
      return createAdminTextInspectionLoader({
        attempt,
        ownerId: job.documents.owner_id ?? "",
        ...(job.documents.file_type === "application/pdf" && batchContext !== undefined
          ? { nativePdfBatch: batchContext }
          : {}),
        async loadCurrent(request, binding) {
          if (request.purpose !== "embedding") return refuse();
          const source = await current(job, attempt);
          if (!source || !same(binding, source.policyObservations.binding)) return refuse();
          const facts = await readWorkerProviderAuthorityFacts({
            attempt,
            generationId: binding.generationId,
            sourceBinding: binding,
            rpc: client.rpc.bind(client),
          });
          if (
            facts.ownerId !== source.ownerId ||
            facts.sourceByteLength !== source.sourceByteLength ||
            !same(facts.declaredAuthority, source.authority)
          )
            return refuse();
          const loaded = await actual(job, source, attempt);
          return {
            facts,
            binding,
            catalogueKey: source.catalogueKey,
            sourceMetadata: loaded.metadata,
            sourceBytes: loaded.bytes,
            ...(source.sourceFamily === "native_pdf"
              ? source.generalPdf
                ? { generalPdf: source.generalPdf }
                : { nativePdf: source.nativeInspection }
              : {}),
            policyObservations: source.policyObservations,
          };
        },
        async loadScannerConfiguration(args) {
          attempt.check();
          const config = await suppliers.loadScannerConfiguration({ ...args, job });
          attempt.check();
          return config;
        },
      });
    },
    async loadManagedRenderedPdfInspection(job, sourceSha256, attempt) {
      const source = await current(job, attempt);
      if (!source?.renderedPdf || !source.stewardId) return undefined;
      if (source.sourceSha256 !== sourceSha256 || source.summaryEnabled !== true) return refuse();
      await actual(job, source, attempt);
      assertValidatedRenderedPdfReview(source.renderedPdf.acceptedReview);
      return { ...source.renderedPdf, stewardId: source.stewardId, summaryEnabled: true };
    },
    async loadManagedRichPdfInspection(job, sourceSha256, attempt) {
      const source = await current(job, attempt);
      if (!source?.richPdf || !source.stewardId) return undefined;
      if (source.sourceSha256 !== sourceSha256) return refuse();
      await actual(job, source, attempt);
      inspectRichPdfSource(source.richPdf.review, source.sourceBytes, workerProviderSourceBinding(job, job.documents));
      return { ...source.richPdf, stewardId: source.stewardId, summaryEnabled: source.summaryEnabled === true };
    },
    async loadManagedGeneralPdfInspection(job, sourceSha256, attempt) {
      const source = await current(job, attempt);
      if (!source?.generalPdf) return undefined;
      if (sourceSha256 !== source.sourceSha256) return refuse();
      const loaded = await actual(job, source, attempt);
      inspectGeneralPdfSource(source.generalPdf, loaded.bytes, workerProviderSourceBinding(job, job.documents));
      attempt.check();
      return source.generalPdf;
    },
    async loadManagedAdminTextSectionLayout(job, sourceSha256) {
      const source = await current(job);
      if (!source) return undefined;
      if (sourceSha256 !== source.sourceSha256) return refuse();
      return source.sourceFamily === "native_pdf" ? undefined : source.sourceSectionLayout;
    },
    ...(suppliers.loadManagedNativePdfSourceRoles
      ? {
          async loadManagedNativePdfSourceRoles(input: ManagedPreparedSupplierInput) {
            const source = await current(input.job);
            if (
              source?.sourceFamily !== "native_pdf" ||
              source.sourceSha256 !== input.retentionPacket.registration.sourceSha256
            )
              return refuse();
            const roles = await suppliers.loadManagedNativePdfSourceRoles!(input);
            const latest = await current(input.job);
            if (
              !latest ||
              latest.sourceFamily !== "native_pdf" ||
              !same(latest.sourceExpectation, source.sourceExpectation) ||
              !latest.sourceExpectationWitnessBytes.equals(source.sourceExpectationWitnessBytes)
            )
              return refuse();
            return roles;
          },
        }
      : {}),
    ...(suppliers.loadManagedAdminPdfCompletionEvidence
      ? {
          async loadManagedAdminPdfCompletionEvidence(input: ManagedPreparedSupplierInput) {
            const source = await current(input.job);
            if (
              !source ||
              source.sourceFamily !== "native_pdf" ||
              source.sourceSha256 !== input.retentionPacket.registration.sourceSha256 ||
              !source.sourceBytes.equals(input.originalBytes) ||
              !source.sourceExpectationWitnessBytes.equals(input.witnessBytes)
            )
              return refuse();
            const evidence = await suppliers.loadManagedAdminPdfCompletionEvidence!(input);
            const latest = await current(input.job);
            if (
              !latest ||
              latest.sourceFamily !== "native_pdf" ||
              !latest.sourceBytes.equals(source.sourceBytes) ||
              !same(latest.policyObservations, source.policyObservations) ||
              !same(latest.authority, source.authority) ||
              !same(latest.sourceExpectation, source.sourceExpectation) ||
              !latest.sourceExpectationWitnessBytes.equals(source.sourceExpectationWitnessBytes)
            )
              return refuse();
            if (
              evidence &&
              (evidence.admission.documentId !== input.issued.documentId ||
                evidence.admission.ownerId !== source.ownerId ||
                evidence.admission.generationId !== input.issued.generationId ||
                evidence.admission.sourceSha256 !== source.sourceSha256)
            )
              return refuse();
            return evidence;
          },
        }
      : {}),
    async initializeManagedAdminTextGeneration(job, attempt, context) {
      const source = await current(job, attempt, context.adoptPreparedExtraction);
      if (!source) return;
      const inventory = await context.readInventory();
      attempt.check();
      if (inventory.ok !== true || typeof inventory.managed !== "boolean") return refuse();
      if (inventory.managed) {
        const retained = registeredOriginalInputs(job, source, inventory);
        if (!retained.missing.length) return;
        const { bytes } = await actual(job, source, attempt);
        const packet = await context.prepare(source, bytes);
        attempt.check();
        // Recovery must match the entire immutable registration, never re-begin it.
        if (!same(packet.registration, retained.inventory.registration)) return refuse();
        const latest = await current(job, attempt);
        if (
          !latest ||
          !same(latest.sourceExpectation, source.sourceExpectation) ||
          !latest.sourceExpectationWitnessBytes.equals(source.sourceExpectationWitnessBytes) ||
          latest.sourceFamily !== source.sourceFamily ||
          (source.sourceFamily !== "native_pdf" &&
            !same(latest.sourceSectionLayout ?? null, source.sourceSectionLayout ?? null))
        )
          return refuse();
        const result = await context.mutation("retain_ingestion_generation_artifacts", {
          p_generation: job.lease_write_generation_id,
          p_artifacts: packet.artifacts.filter(
            (artifact) =>
              artifact.unitId.family === "private_objects" && retained.missing.includes(artifact.unitId.key),
          ),
        });
        attempt.check();
        if (result.ok !== true) return refuse();
        const after = registeredOriginalInputs(job, source, await context.readInventory());
        attempt.check();
        if (after.missing.length || !same(after.inventory.registration, retained.inventory.registration))
          return refuse();
        return;
      }
      if (inventory.inventory !== null) return refuse();
      const { bytes } = await actual(job, source, attempt);
      const packet = await context.prepare(source, bytes);
      attempt.check();
      // Main's prepare validates the original partition/heading plan before registration.
      const latest = await current(job, attempt);
      if (
        !latest ||
        !same(latest.sourceExpectation, source.sourceExpectation) ||
        !latest.sourceExpectationWitnessBytes.equals(source.sourceExpectationWitnessBytes) ||
        latest.sourceFamily !== source.sourceFamily ||
        (source.sourceFamily !== "native_pdf" &&
          !same(latest.sourceSectionLayout ?? null, source.sourceSectionLayout ?? null))
      )
        return refuse();
      const first = await context.mutation("begin_ingestion_generation_evidence", {
        p_generation: job.lease_write_generation_id,
        p_registration: packet.registration,
        p_original_hex: bytes.toString("hex"),
      });
      attempt.check();
      if (first.ok !== true) return refuse();
      const retained = await context.mutation("retain_ingestion_generation_artifacts", {
        p_generation: job.lease_write_generation_id,
        p_artifacts: packet.artifacts.filter(
          (a) => a.representation === "original_binary" || a.representation === "source_expectation_witness",
        ),
      });
      attempt.check();
      if (retained.ok !== true) return refuse();
      const verified = registeredOriginalInputs(job, source, await context.readInventory());
      attempt.check();
      if (verified.missing.length || !same(verified.inventory.registration, packet.registration)) return refuse();
    },
  };
}

/**
 * Audit 2026-10-20 CH-04: without the scanner module there is no malware verdict, so every
 * ingestion provider call is refused and each job ends as `scanner_unavailable`. Say so once at
 * start-up. Only whether the setting is present is reported, never its value.
 */
export function adminSourceRuntimeStartupWarning(
  modulePath = process.env.WORKER_ADMIN_SOURCE_RUNTIME_MODULE,
  internalPolicy = process.env.WORKER_INTERNAL_ADMIN_BUILD_POLICY_JSON,
  richPolicy = process.env.WORKER_INTERNAL_RICH_PDF_BUILD_POLICY_JSON,
) {
  if (modulePath !== undefined && modulePath !== "") return null;
  // Presence is not readiness: the loader validates the policy before claims.
  if (internalPolicy !== undefined && internalPolicy !== "") return null;
  if (richPolicy !== undefined && richPolicy !== "") return null;
  return (
    "WORKER_ADMIN_SOURCE_RUNTIME_MODULE is not set: there is no malware scanner, so every ingestion " +
    "provider call will be refused and jobs will fail as scanner_unavailable (see docs/worker-deploy-runbook.md)."
  );
}

/** Explicit server-controlled local module/mount. No remote or request paths. */
export async function loadAdminSourceRuntimeOptions(
  client: SupabaseClient,
  bucket: string,
  modulePath = process.env.WORKER_ADMIN_SOURCE_RUNTIME_MODULE,
  internalPolicy = process.env.WORKER_INTERNAL_ADMIN_BUILD_POLICY_JSON,
  claimEnvironment: Record<string, string | undefined> = process.env,
  richPolicy = process.env.WORKER_INTERNAL_RICH_PDF_BUILD_POLICY_JSON,
) {
  if (richPolicy) {
    if (modulePath || internalPolicy || Buffer.byteLength(richPolicy, "utf8") > 32768) return refuse();
    let value: unknown;
    try {
      value = JSON.parse(richPolicy);
    } catch {
      return refuse();
    }
    const policy = z
      .object({
        allowedDocumentIds: z
          .array(z.uuid().transform((id) => id.toLowerCase()))
          .min(1)
          .max(100),
        approvalReferenceSha256: z.string().regex(/^sha256:[a-f0-9]{64}$/),
        issuedAt: z.iso.datetime(),
        expiresAt: z.iso.datetime(),
        enableSourceAnchoredSummary: z.boolean().optional(),
        renderedReview: renderedReviewPolicySchema.optional(),
      })
      .strict()
      .parse(value);
    const scope = resolveWorkerClaimScopeFilter(claimEnvironment),
      allowed = new Set(policy.allowedDocumentIds);
    if (
      scope.claimsNothing ||
      !scope.allowedDocumentIds.size ||
      [...scope.allowedDocumentIds].some((id) => !allowed.has(id))
    )
      return refuse();
    return createAdminSourceRuntimeOptions(
      client,
      createInternalRichPdfBuildSuppliers(client, { ...policy, bucket, inspectRichPdf: inspectRichPdfBytes }),
      bucket,
    );
  }
  if (internalPolicy !== undefined && internalPolicy !== "") {
    if (modulePath || Buffer.byteLength(internalPolicy, "utf8") > 32768) return refuse();
    let value: unknown;
    try {
      value = JSON.parse(internalPolicy);
    } catch {
      return refuse();
    }
    const policy = z
      .object({
        allowedDocumentIds: z
          .array(z.uuid().transform((value) => value.toLowerCase()))
          .min(1)
          .max(100),
        approvalReferenceSha256: z.string().regex(/^sha256:[0-9a-f]{64}$/),
        issuedAt: z.iso.datetime(),
        expiresAt: z.iso.datetime(),
      })
      .strict()
      .safeParse(value);
    if (!policy.success) return refuse();
    // Refuse before claims rather than consuming attempts on unrelated jobs.
    const claimScope = resolveWorkerClaimScopeFilter(claimEnvironment);
    const allowed = new Set(policy.data.allowedDocumentIds);
    if (
      claimScope.claimsNothing ||
      !claimScope.allowedDocumentIds.size ||
      [...claimScope.allowedDocumentIds].some((id) => !allowed.has(id))
    )
      return refuse();
    return createAdminSourceRuntimeOptions(
      client,
      createInternalAdminBuildSuppliers(client, {
        ...policy.data,
        bucket,
        inspectNativePdf: inspectNativePdfBytes,
      }),
      bucket,
    );
  }
  if (modulePath === undefined || modulePath === "") return {};
  if (!path.isAbsolute(modulePath) || /^(?:https?|data|node):/i.test(modulePath)) return refuse();
  const moduleBytes = await readFile(modulePath);
  const mountedModule = await import(pathToFileURL(modulePath).href);
  if (!(await readFile(modulePath)).equals(moduleBytes)) return refuse();
  const suppliers: AdminSourceRuntimeSuppliers =
    typeof mountedModule.createAdminSourceRuntimeSuppliers === "function"
      ? await mountedModule.createAdminSourceRuntimeSuppliers({
          rpc: client.rpc.bind(client),
          prepareManagedPrivateSupplier,
        })
      : mountedModule;
  if (!(await readFile(modulePath)).equals(moduleBytes)) return refuse();
  if (typeof suppliers.loadApprovedSource !== "function" || typeof suppliers.loadScannerConfiguration !== "function")
    return refuse();
  async function currentModule() {
    if (!(await readFile(modulePath!)).equals(moduleBytes)) return refuse();
  }
  await currentModule();
  return createAdminSourceRuntimeOptions(
    client,
    {
      async loadApprovedSource(job, purpose) {
        await currentModule();
        const source = await suppliers.loadApprovedSource(job, purpose);
        await currentModule();
        return source;
      },
      async loadScannerConfiguration(args) {
        await currentModule();
        const scanner = await suppliers.loadScannerConfiguration(args);
        await currentModule();
        return scanner;
      },
      ...(suppliers.loadManagedAdminPdfCompletionEvidence
        ? {
            async loadManagedAdminPdfCompletionEvidence(input: ManagedPreparedSupplierInput) {
              await currentModule();
              const evidence = await suppliers.loadManagedAdminPdfCompletionEvidence!(input);
              await currentModule();
              return evidence;
            },
          }
        : {}),
      ...(suppliers.loadManagedNativePdfSourceRoles
        ? {
            async loadManagedNativePdfSourceRoles(input: ManagedPreparedSupplierInput) {
              await currentModule();
              const roles = await suppliers.loadManagedNativePdfSourceRoles!(input);
              await currentModule();
              return roles;
            },
          }
        : {}),
    },
    bucket,
  );
}
