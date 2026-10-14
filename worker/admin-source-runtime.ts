import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { IngestionAttempt } from "../supabase/functions/_shared/ingestion-attempt";
import { parseOriginalApplicabilityWitness, parseSourceExpectation } from "../src/lib/ingestion-generation-evidence";
import {
  ADMIN_TEXT_INSPECTION_MAX_BYTES,
  createAdminTextInspectionLoader,
  type AdminTextCurrentFacts,
  type AdminTextScannerConfiguration,
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

/** Server-owned current permission plus independent original inputs. The supplier
 * must reread operative permission and pinned licence/source-review evidence on
 * every call. Admission declarations and document metadata cannot produce it. */
export type ApprovedAdminSource = Readonly<{
  ownerId: string;
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
  sourceFamily?: "admin_text" | "native_pdf";
  nativeInspection?: AdminTextCurrentFacts["nativePdf"];
  sourceSectionLayout?: ManagedAdminTextSourceSectionLayout;
}>;

export type AdminSourceRuntimeSuppliers = Readonly<{
  /** Undefined revokes permission for this exact current job/source/purpose. */
  loadApprovedSource: (job: JobRow, purpose: "embedding") => Promise<ApprovedAdminSource | undefined>;
  loadScannerConfiguration: () => Promise<AdminTextScannerConfiguration>;
  loadManagedAdminPdfCompletionEvidence?: (
    input: ManagedPreparedSupplierInput,
  ) => Promise<ManagedAdminPdfCompletionEvidence | undefined>;
  loadManagedNativePdfSourceRoles?: (
    input: ManagedPreparedSupplierInput,
  ) => Promise<NonNullable<ManagedPreparedSupplierInput["independentSourceRoles"]>>;
}>;

export type AdminSourceInitializationContext = {
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
  if (
    !(
      (source.sourceFamily === "native_pdf" && job.documents.file_type === "application/pdf") ||
      (source.sourceFamily !== "native_pdf" && job.documents.file_type === "text/plain")
    ) ||
    !job.documents.owner_id ||
    source.ownerId !== job.documents.owner_id ||
    source.documentId !== job.document_id ||
    source.storagePath !== job.documents.storage_path ||
    source.sourceSha256 !== binding.contentSha256 ||
    !Buffer.isBuffer(source.sourceBytes) ||
    source.sourceByteLength !== source.sourceBytes.length ||
    source.sourceByteLength < 1 ||
    source.sourceByteLength >
      (source.sourceFamily === "native_pdf" ? MAX_UPLOAD_MB_CEILING * 1024 * 1024 : ADMIN_TEXT_INSPECTION_MAX_BYTES) ||
    digest(source.sourceBytes) !== source.sourceSha256 ||
    (job.documents.file_size != null && job.documents.file_size !== source.sourceByteLength) ||
    !same(source.authority, job.documents.metadata?.authority) ||
    !same(policy.binding, binding) ||
    policy.purpose !== "embedding" ||
    policy.admission !== "current" ||
    policy.ownerScope !== "permitted" ||
    policy.rights !== "permitted" ||
    policy.purposeClearance !== "permitted" ||
    policy.source !== "eligible" ||
    policy.indexLicence !== "permitted" ||
    policy.sourcePolicy !== "matched" ||
    !policy.policyVersion ||
    !source.catalogueKey ||
    (source.sourceFamily === "native_pdf"
      ? source.sourceSectionLayout !== undefined
      : source.sourceSectionLayout?.sourceSha256 !== source.sourceSha256)
  )
    return refuse();
  const expectation = parseSourceExpectation(source.sourceExpectation);
  if (expectation.tag !== "known" || expectation.sourceSha256 !== source.sourceSha256) return refuse();
  parseOriginalApplicabilityWitness({
    sourceExpectation: expectation,
    originalBytes: source.sourceBytes,
    witnessBytes: source.sourceExpectationWitnessBytes,
  });
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
> {
  async function current(job: JobRow, attempt?: IngestionAttempt) {
    attempt?.check();
    const source = await suppliers.loadApprovedSource(job, "embedding");
    attempt?.check();
    return source === undefined ? undefined : validateSource(job, source);
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
    const result = await client.storage.from(bucket).download(data.storage_path);
    attempt.check();
    if (result.error || !result.data) return refuse();
    const bytes = Buffer.from(await result.data.arrayBuffer());
    attempt.check();
    if (!bytes.equals(source.sourceBytes)) return refuse();
    return { bytes, metadata: data.metadata };
  }
  return {
    loadObservationsForJob(job, attempt, batchContext?: ManagedProviderEmbeddingRequestContext) {
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
            ...(source.sourceFamily === "native_pdf" ? { nativePdf: source.nativeInspection } : {}),
            policyObservations: source.policyObservations,
          };
        },
        async loadScannerConfiguration() {
          attempt.check();
          const config = await suppliers.loadScannerConfiguration();
          attempt.check();
          return config;
        },
      });
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
      const source = await current(job, attempt);
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
          (source.sourceFamily !== "native_pdf" && !same(latest.sourceSectionLayout, source.sourceSectionLayout))
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
        (source.sourceFamily !== "native_pdf" && !same(latest.sourceSectionLayout, source.sourceSectionLayout))
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

/** Explicit server-controlled local module/mount. No remote or request paths. */
export async function loadAdminSourceRuntimeOptions(
  client: SupabaseClient,
  bucket: string,
  modulePath = process.env.WORKER_ADMIN_SOURCE_RUNTIME_MODULE,
) {
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
      async loadScannerConfiguration() {
        await currentModule();
        const scanner = await suppliers.loadScannerConfiguration();
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
