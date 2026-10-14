import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { IngestionAttempt } from "../supabase/functions/_shared/ingestion-attempt";
import {
  bytesDigest,
  generationEvidenceBytes,
  originalApplicabilityFamilies,
  type OriginalApplicabilityWitness,
  type SourceExpectation,
} from "../src/lib/ingestion-generation-evidence";
import { buildGenerationRetentionPacket } from "../worker/generation-evidence";
import {
  createAdminSourceRuntimeOptions,
  loadAdminSourceRuntimeOptions,
  type ApprovedAdminSource,
  type AdminSourceInitializationContext,
} from "../worker/admin-source-runtime";
import { workerProviderSourceBinding } from "../worker/provider-egress";
import type { JobRow } from "../worker/types";

function fixture() {
  const sourceBytes = Buffer.from("Synthetic whole text reference.\n");
  const sourceSha256 = bytesDigest(sourceBytes);
  const sourceUnits: NonNullable<SourceExpectation["units"]> = [
    {
      id: "whole",
      required: true,
      dependencies: [],
      locator: `utf8-bytes:0:${sourceBytes.length}`,
      nativeMapping: "unavailable",
    },
  ];
  const witness: OriginalApplicabilityWitness = {
    version: "ingestion-original-applicability-v1",
    qualification: "independently_declared_unverified",
    sourceSha256,
    sourceByteLength: sourceBytes.length,
    sourceUnits,
    groups: originalApplicabilityFamilies.map((family) => ({
      family,
      population: {
        tag: "known",
        requirements: family === "chunks" ? [{ id: "chunks", required: true, sourceEvidenceIds: ["whole"] }] : [],
        basis: { scope: "whole_original", kind: "independent_original_declaration" },
        reason: family === "chunks" ? null : "no_original_requirements_in_scope",
      },
    })),
  };
  const witnessBytes = generationEvidenceBytes(witness);
  const sourceExpectation: SourceExpectation = {
    version: 1,
    sourceSha256,
    tag: "known",
    units: sourceUnits,
    witness: { reference: "independent-synthetic-source", sha256: bytesDigest(witnessBytes) },
    limitation: null,
  };
  const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const authority: ApprovedAdminSource["authority"] = {
    version: 1,
    sourceRole: "clinical_reference",
    authorityBasis: "backend_manifest",
    licencePolicy: "public_index_permitted",
    rightsEvidenceRef: "synthetic-review",
    publisher: "Synthetic",
    jurisdiction: "Australia",
    publicationDate: null,
    effectiveDate: null,
    reviewDate: null,
    expiryDate: null,
    currentness: "current",
    supersedesDocumentId: null,
    purpose: "clinical_retrieval",
    supportedFeatures: ["text"],
    providerProcessing: "permitted",
  };
  const job: JobRow = {
    id: uuid(3),
    document_id: uuid(1),
    locked_by: "synthetic-worker",
    lease_token: uuid(4),
    lease_expected_generation_id: null,
    lease_write_generation_id: uuid(2),
    lease_authority_digest: `sha256:${"a".repeat(64)}`,
    lease_expires_at: "2026-10-10T00:00:00Z",
    lease_duration_seconds: 2700,
    batch_id: null,
    attempt_count: 1,
    max_attempts: 3,
    documents: {
      id: uuid(1),
      owner_id: uuid(5),
      title: "Synthetic",
      file_name: "synthetic.txt",
      file_type: "text/plain",
      storage_path: "synthetic/source.txt",
      content_hash: sourceSha256.slice(7),
      file_size: sourceBytes.length,
      metadata: { authority, admission_event_id: uuid(6) },
    },
  };
  const attempt = new IngestionAttempt({
    job_kind: "node",
    job_id: job.id,
    document_id: job.document_id,
    worker_id: job.locked_by,
    lease_token: job.lease_token,
    expected_generation_id: null,
    authority_digest: job.lease_authority_digest,
  });
  const source: ApprovedAdminSource = {
    documentId: job.document_id,
    ownerId: job.documents.owner_id!,
    storagePath: job.documents.storage_path,
    sourceBytes,
    sourceByteLength: sourceBytes.length,
    sourceSha256,
    authority,
    catalogueKey: "synthetic",
    sourceExpectation,
    sourceExpectationWitnessBytes: witnessBytes,
    sourceSectionLayout: {
      sourceSha256,
      units: [{ sourceUnitId: "whole", headingByteStart: null, headingByteEnd: null }],
    },
    policyObservations: {
      binding: workerProviderSourceBinding(job, job.documents),
      policyVersion: "synthetic-current-policy",
      purpose: "embedding",
      admission: "current",
      ownerScope: "permitted",
      rights: "permitted",
      purposeClearance: "permitted",
      source: "eligible",
      indexLicence: "permitted",
      sourcePolicy: "matched",
    },
  };
  const packet = buildGenerationRetentionPacket({
    documentId: job.document_id,
    generationId: job.lease_write_generation_id,
    originalBytes: sourceBytes,
    extracted: { pages: [{ pageNumber: 1, text: sourceBytes.toString(), ocrUsed: false }], images: [] },
    persistedPages: [
      { document_id: job.document_id, page_number: 1, text: sourceBytes.toString(), ocr_used: false, metadata: {} },
    ],
    sourceExpectation,
    sourceExpectationWitnessBytes: witnessBytes,
    capturedImages: [],
    deferOptionalProducerDeclarations: true,
  });
  const client = {
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: job.documents, error: null }) }) }) }),
    storage: { from: () => ({ download: async () => ({ data: new Blob([sourceBytes]), error: null }) }) },
  } as unknown as SupabaseClient;
  const loadApprovedSource = vi.fn().mockResolvedValue(source);
  const hooks = createAdminSourceRuntimeOptions(
    client,
    { loadApprovedSource, loadScannerConfiguration: vi.fn().mockRejectedValue(new Error("scanner not provisioned")) },
    "synthetic-bucket",
  );
  const originalArtifacts = packet.artifacts.filter(
    (a) => a.representation === "original_binary" || a.representation === "source_expectation_witness",
  );
  function registeredInventory(artifacts = originalArtifacts) {
    const rows = artifacts.map(({ bytesHex: _bytesHex, ...artifact }) => {
      void _bytesHex;
      return { ...artifact, sourceSha256 };
    });
    const witnessArtifact = artifacts.find((a) => a.representation === "source_expectation_witness");
    return {
      ok: true,
      managed: true,
      inventory: {
        version: 1,
        documentId: job.document_id,
        generationId: job.lease_write_generation_id,
        jobId: job.id,
        authorityDigest: job.lease_authority_digest,
        predecessorGenerationId: job.lease_expected_generation_id,
        firstLeaseToken: job.lease_token,
        sourceSha256,
        sourceByteLength: source.sourceByteLength,
        sourceExpectation,
        sourceExpectationDigest: packet.registration.sourceExpectationSha256,
        registration: packet.registration,
        artifacts: rows,
        retainedOriginalWitness: witnessArtifact
          ? {
              status: "retained",
              documentId: job.document_id,
              generationId: job.lease_write_generation_id,
              sourceSha256,
              sourceByteLength: source.sourceByteLength,
              sourceExpectationDigest: packet.registration.sourceExpectationSha256,
              unitId: witnessArtifact.unitId,
              representation: "source_expectation_witness",
              bytesHex: witnessArtifact.bytesHex,
              sha256: witnessArtifact.sha256,
              byteLength: witnessArtifact.byteLength,
            }
          : { status: "unavailable", reason: "witness_not_retained" },
      },
    };
  }
  let begun = false;
  let retained = false;
  const context: AdminSourceInitializationContext = {
    readInventory: vi.fn(async () =>
      begun
        ? registeredInventory(
            retained ? originalArtifacts : originalArtifacts.filter((a) => a.representation === "original_binary"),
          )
        : { ok: true, managed: false, inventory: null },
    ),
    prepare: vi.fn().mockResolvedValue(packet),
    mutation: vi.fn(async (name: string) => {
      if (name === "begin_ingestion_generation_evidence") begun = true;
      if (name === "retain_ingestion_generation_artifacts") retained = true;
      return { ok: true };
    }),
  };
  return { job, attempt, source, packet, hooks, context, client, loadApprovedSource, registeredInventory };
}

describe("approved admin source normal runtime composition", () => {
  it("keeps unconfigured and unmatched sources on the existing path without inventory or writes", async () => {
    const f = fixture();
    expect(await loadAdminSourceRuntimeOptions(f.client, "synthetic-bucket", "")).toEqual({});
    f.loadApprovedSource.mockResolvedValue(undefined);
    await f.hooks.initializeManagedAdminTextGeneration!(f.job, f.attempt, f.context);
    expect(f.context.readInventory).not.toHaveBeenCalled();
    expect(f.context.mutation).not.toHaveBeenCalled();
  });
  it("uses genuine unregistered inventory and existing begin/retain payloads in order", async () => {
    const f = fixture();
    await f.hooks.initializeManagedAdminTextGeneration!(f.job, f.attempt, f.context);
    expect(f.context.readInventory).toHaveBeenCalledTimes(2);
    expect(f.context.prepare).toHaveBeenCalledWith(
      expect.objectContaining({ sourceExpectation: f.source.sourceExpectation }),
      f.source.sourceBytes,
    );
    expect(vi.mocked(f.context.mutation).mock.calls.map(([name]) => name)).toEqual([
      "begin_ingestion_generation_evidence",
      "retain_ingestion_generation_artifacts",
    ]);
    expect(vi.mocked(f.context.mutation).mock.calls[0][1]).toEqual({
      p_generation: f.job.lease_write_generation_id,
      p_registration: f.packet.registration,
      p_original_hex: f.source.sourceBytes.toString("hex"),
    });
    expect(vi.mocked(f.context.mutation).mock.calls[1][1].p_artifacts).toEqual(
      f.packet.artifacts.filter(
        (a) => a.representation === "original_binary" || a.representation === "source_expectation_witness",
      ),
    );
  });
  it("preserves matching registered evidence and rejects ambiguous/mismatched inventory", async () => {
    const f = fixture();
    vi.mocked(f.context.readInventory).mockResolvedValue(f.registeredInventory());
    await f.hooks.initializeManagedAdminTextGeneration!(f.job, f.attempt, f.context);
    expect(f.context.prepare).not.toHaveBeenCalled();
    expect(f.context.mutation).not.toHaveBeenCalled();
    vi.mocked(f.context.readInventory).mockResolvedValue({ ok: true, managed: false });
    await expect(f.hooks.initializeManagedAdminTextGeneration!(f.job, f.attempt, f.context)).rejects.toThrow(
      "current_input_required",
    );
    expect(f.context.mutation).not.toHaveBeenCalled();
  });
  it.each(["begin response lost", "witness retain failed"])(
    "repairs matching missing witness after %s without re-beginning",
    async (failure) => {
      const f = fixture();
      const realMutation = vi.mocked(f.context.mutation).getMockImplementation()!;
      if (failure === "begin response lost") {
        vi.mocked(f.context.mutation).mockImplementationOnce(async (...args) => {
          await realMutation(...args);
          throw new Error("begin response lost");
        });
      } else {
        vi.mocked(f.context.mutation)
          .mockImplementationOnce(realMutation)
          .mockRejectedValueOnce(new Error("witness retain failed"));
      }
      await expect(f.hooks.initializeManagedAdminTextGeneration!(f.job, f.attempt, f.context)).rejects.toThrow(failure);
      vi.mocked(f.context.mutation).mockClear();
      await f.hooks.initializeManagedAdminTextGeneration!(f.job, f.attempt, f.context);
      expect(vi.mocked(f.context.mutation).mock.calls.map(([name]) => name)).toEqual([
        "retain_ingestion_generation_artifacts",
      ]);
      expect(vi.mocked(f.context.mutation).mock.calls[0][1]).toEqual({
        p_generation: f.job.lease_write_generation_id,
        p_artifacts: f.packet.artifacts.filter((a) => a.representation === "source_expectation_witness"),
      });
      expect(await f.context.readInventory()).toEqual(f.registeredInventory());
    },
  );
  it("refuses registered repair with different immutable registration, revoked permission or lost fence", async () => {
    const missing = (f: ReturnType<typeof fixture>) =>
      f.registeredInventory(f.packet.artifacts.filter((a) => a.representation === "original_binary"));
    const mismatch = fixture();
    const changed = missing(mismatch);
    changed.inventory.registration = {
      ...changed.inventory.registration,
      profileVersion: "wrong-profile",
    } as unknown as typeof changed.inventory.registration;
    vi.mocked(mismatch.context.readInventory).mockResolvedValue(changed);
    await expect(
      mismatch.hooks.initializeManagedAdminTextGeneration!(mismatch.job, mismatch.attempt, mismatch.context),
    ).rejects.toThrow("current_input_required");
    expect(mismatch.context.mutation).not.toHaveBeenCalled();
    const revoked = fixture();
    vi.mocked(revoked.context.readInventory).mockResolvedValue(missing(revoked));
    revoked.loadApprovedSource.mockResolvedValueOnce(revoked.source).mockResolvedValueOnce(undefined);
    await expect(
      revoked.hooks.initializeManagedAdminTextGeneration!(revoked.job, revoked.attempt, revoked.context),
    ).rejects.toThrow("current_input_required");
    expect(revoked.context.mutation).not.toHaveBeenCalled();
    const fenced = fixture();
    vi.mocked(fenced.context.readInventory).mockResolvedValue(missing(fenced));
    vi.mocked(fenced.context.mutation).mockResolvedValue({ ok: false, reason: "lease_lost" });
    await expect(
      fenced.hooks.initializeManagedAdminTextGeneration!(fenced.job, fenced.attempt, fenced.context),
    ).rejects.toThrow("current_input_required");
    expect(vi.mocked(fenced.context.mutation).mock.calls.map(([name]) => name)).toEqual([
      "retain_ingestion_generation_artifacts",
    ]);
  });
  it("refuses revoked permission between preparation and begin, and wrong owner/source bindings", async () => {
    const f = fixture();
    f.loadApprovedSource.mockResolvedValueOnce(f.source).mockResolvedValueOnce(undefined);
    await expect(f.hooks.initializeManagedAdminTextGeneration!(f.job, f.attempt, f.context)).rejects.toThrow(
      "current_input_required",
    );
    expect(f.context.mutation).not.toHaveBeenCalled();
    f.loadApprovedSource.mockResolvedValue({ ...f.source, ownerId: f.job.document_id });
    await expect(f.hooks.loadManagedAdminTextSectionLayout!(f.job, f.source.sourceSha256)).rejects.toThrow(
      "current_input_required",
    );
    await expect(
      loadAdminSourceRuntimeOptions(f.client, "synthetic-bucket", "https://example.invalid/source.mjs"),
    ).rejects.toThrow("current_input_required");
  });
});
