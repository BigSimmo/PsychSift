import { describe, expect, it, vi } from "vitest";
import type { ProviderEgressBinding } from "../src/lib/document-ingress-safety";
import { IngestionAttempt, type IngestionFence } from "../supabase/functions/_shared/ingestion-attempt";
import { parseWorkerProviderAuthorityFacts, readWorkerProviderAuthorityFacts } from "../worker/provider-egress";

const documentId = "10000000-0000-4000-8000-000000000001";
const jobId = "10000000-0000-4000-8000-000000000002";
const generationId = "10000000-0000-4000-8000-000000000003";
const leaseId = "10000000-0000-4000-8000-000000000004";
const admissionEventId = "10000000-0000-4000-8000-000000000005";
const ownerId = "10000000-0000-4000-8000-000000000006";
const expectedGenerationId = "10000000-0000-4000-8000-000000000007";
const foreignId = "10000000-0000-4000-8000-000000000008";
const authorityDigest = `sha256:${"a".repeat(64)}`;
const sourceSha256 = `sha256:${"b".repeat(64)}`;
const fence: IngestionFence = {
  job_kind: "node",
  job_id: jobId,
  document_id: documentId,
  worker_id: "offline-worker",
  lease_token: leaseId,
  expected_generation_id: null,
  authority_digest: authorityDigest,
};
const binding: ProviderEgressBinding = {
  documentId,
  jobId,
  generationId,
  leaseId,
  attemptId: `${jobId}:2:${leaseId}`,
  admissionEventId,
  authorityDigest: authorityDigest as ProviderEgressBinding["authorityDigest"],
  contentSha256: sourceSha256 as ProviderEgressBinding["contentSha256"],
};
// Independently frozen response contract: historical admission job is deliberately absent.
const response = () => ({
  ok: true,
  providerAuthority: {
    version: "ingestion-provider-authority-facts-v1",
    status: "observed",
    documentId,
    ownerId,
    jobKind: "node",
    jobId,
    generationId,
    expectedGenerationId: null as string | null,
    authorityDigest,
    sourceSha256,
    sourceByteLength: 123,
    mimeType: "text/plain",
    fileNameSha256: `sha256:${"c".repeat(64)}`,
    storagePathSha256: `sha256:${"d".repeat(64)}`,
    admissionEventId,
    admissionPolicyVersion: "trusted-document-admission-v1",
    admissionDigest: `sha256:${"e".repeat(64)}`,
    declaredAuthority: {
      version: 1,
      sourceRole: "clinical_reference",
      authorityBasis: "backend_manifest",
      licencePolicy: "review_required",
      rightsEvidenceRef: "synthetic-reference",
      publisher: "Synthetic publisher",
      jurisdiction: "Australia",
      publicationDate: null,
      effectiveDate: null,
      reviewDate: "2026-10-01",
      expiryDate: null,
      currentness: "unknown",
      supersedesDocumentId: null,
      purpose: "clinical_retrieval",
      supportedFeatures: ["text"],
      providerProcessing: "permitted",
    },
    currentRightsEvidence: "unavailable",
    safetyEvidence: "unavailable",
  },
});
function read(data: unknown, currentFence = fence, currentBinding = binding) {
  const attempt = new IngestionAttempt(currentFence);
  const rpc = vi.fn(async () => ({ data, error: null }));
  return {
    attempt,
    rpc,
    result: readWorkerProviderAuthorityFacts({ attempt, rpc, generationId, sourceBinding: currentBinding }),
  };
}
describe("worker current-authority facts read", () => {
  it("forwards the exact captured fence and returns frozen declarations with rights and safety unavailable", async () => {
    const expected = response();
    const { attempt, rpc, result } = read(expected);
    const facts = await result;
    expect(facts).toEqual(expected.providerAuthority);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("read_ingestion_generation_inventory", {
      p_fence: { version: "ingestion-provider-authority-read-v1", fence },
      p_generation: generationId,
    });
    expect(Object.isFrozen(facts)).toBe(true);
    expect(Object.isFrozen(facts.declaredAuthority.supportedFeatures)).toBe(true);
    expect(attempt.signal.aborted).toBe(false);
    expect(facts).not.toHaveProperty("permitted");
    expect(facts).not.toHaveProperty("leaseId");
  });
  it("accepts a current reindex job without an original-admission-job equality contract", async () => {
    const data = response();
    data.providerAuthority.jobKind = "indexing_v3";
    data.providerAuthority.expectedGenerationId = expectedGenerationId;
    const { result } = read(data, { ...fence, job_kind: "indexing_v3", expected_generation_id: expectedGenerationId });
    expect((await result).jobId).toBe(jobId);
  });
  it.each([
    [
      "foreign document",
      (r: ReturnType<typeof response>) => {
        r.providerAuthority.documentId = foreignId;
      },
    ],
    [
      "foreign job",
      (r: ReturnType<typeof response>) => {
        r.providerAuthority.jobId = foreignId;
      },
    ],
    [
      "foreign generation",
      (r: ReturnType<typeof response>) => {
        r.providerAuthority.generationId = foreignId;
      },
    ],
    [
      "foreign admission",
      (r: ReturnType<typeof response>) => {
        r.providerAuthority.admissionEventId = foreignId;
      },
    ],
    [
      "changed source",
      (r: ReturnType<typeof response>) => {
        r.providerAuthority.sourceSha256 = `sha256:${"f".repeat(64)}`;
      },
    ],
    [
      "changed authority",
      (r: ReturnType<typeof response>) => {
        r.providerAuthority.authorityDigest = `sha256:${"f".repeat(64)}`;
      },
    ],
    [
      "extra envelope",
      (r: ReturnType<typeof response>) => {
        Object.assign(r, { managed: true });
      },
    ],
    [
      "extra facts",
      (r: ReturnType<typeof response>) => {
        Object.assign(r.providerAuthority, { workerId: "foreign" });
      },
    ],
    [
      "extra declaration",
      (r: ReturnType<typeof response>) => {
        Object.assign(r.providerAuthority.declaredAuthority, { approval: true });
      },
    ],
    [
      "rights invention",
      (r: ReturnType<typeof response>) => {
        r.providerAuthority.currentRightsEvidence = "permitted";
      },
    ],
    [
      "bad date",
      (r: ReturnType<typeof response>) => {
        r.providerAuthority.declaredAuthority.reviewDate = "2026-02-30";
      },
    ],
    [
      "missing key",
      (r: ReturnType<typeof response>) => {
        Reflect.deleteProperty(r.providerAuthority, "ownerId");
      },
    ],
  ] as const)("cancels on %s", async (_name, mutate) => {
    const data = response();
    mutate(data);
    const { attempt, result } = read(data);
    await expect(result).rejects.toMatchObject({ code: "ingestion_rpc_invalid" });
    expect(attempt.signal.aborted).toBe(true);
  });
  it("refuses malformed envelopes and unsupported declarations independently of the transport", () => {
    for (const data of [null, [], {}, { ...response(), ok: false }])
      expect(() => parseWorkerProviderAuthorityFacts(data, fence, generationId, binding)).toThrow(
        "ingestion_rpc_invalid",
      );
    const data = response();
    data.providerAuthority.declaredAuthority.supportedFeatures = ["text", "images"];
    expect(() => parseWorkerProviderAuthorityFacts(data, fence, generationId, binding)).toThrow(
      "ingestion_rpc_invalid",
    );
  });
  it("refuses foreign input bindings before dispatch", async () => {
    const { attempt, rpc, result } = read(response(), fence, { ...binding, documentId: foreignId });
    await expect(result).rejects.toMatchObject({ code: "ingestion_rpc_invalid" });
    expect(rpc).not.toHaveBeenCalled();
    expect(attempt.signal.aborted).toBe(true);
  });
  it.each(["lease refusal", "RPC error"])("cancels on %s", async (mode) => {
    const attempt = new IngestionAttempt(fence);
    const rpc = vi.fn(async () =>
      mode === "lease refusal"
        ? { data: { ok: false, reason: "lease_lost" }, error: null }
        : { data: null, error: { message: "synthetic read error" } },
    );
    await expect(
      readWorkerProviderAuthorityFacts({ attempt, rpc, generationId, sourceBinding: binding }),
    ).rejects.toMatchObject({ code: mode === "lease refusal" ? "lease_lost" : "ingestion_rpc_invalid" });
    expect(attempt.signal.aborted).toBe(true);
  });
  it.each(["cancel", "handoff"])("rejects %s during the awaited read", async (mode) => {
    const attempt = new IngestionAttempt(fence);
    let finish!: (value: { data: unknown; error: null }) => void;
    let started!: () => void;
    const dispatched = new Promise<void>((resolve) => {
      started = resolve;
    });
    const rpc = vi.fn(
      () =>
        new Promise<{ data: unknown; error: null }>((resolve) => {
          finish = resolve;
          started();
        }),
    );
    const result = readWorkerProviderAuthorityFacts({ attempt, rpc, generationId, sourceBinding: binding });
    await dispatched;
    if (mode === "cancel") attempt.cancel();
    else
      attempt.handoff(
        { ok: true, fence: { ...fence, expected_generation_id: expectedGenerationId } },
        expectedGenerationId,
      );
    finish({ data: response(), error: null });
    await expect(result).rejects.toMatchObject({ code: mode === "cancel" ? "lease_lost" : "ingestion_rpc_invalid" });
    expect(attempt.signal.aborted).toBe(true);
  });
  it("keeps cancellation bound to the original attempt when caller arguments change during the read", async () => {
    const original = new IngestionAttempt(fence);
    let finish!: (value: { data: unknown; error: null }) => void;
    let started!: () => void;
    const dispatched = new Promise<void>((resolve) => {
      started = resolve;
    });
    const rpc = vi.fn(
      () =>
        new Promise<{ data: unknown; error: null }>((resolve) => {
          finish = resolve;
          started();
        }),
    );
    const args = { attempt: original, rpc, generationId, sourceBinding: binding };
    const result = readWorkerProviderAuthorityFacts(args);
    await dispatched;
    args.attempt = new IngestionAttempt(fence);
    original.cancel();
    finish({ data: response(), error: null });
    await expect(result).rejects.toMatchObject({ code: "lease_lost" });
    expect(original.signal.aborted).toBe(true);
    expect(args.attempt.signal.aborted).toBe(false);
  });
  it("keeps the original RPC transport when caller arguments change while queued", async () => {
    const attempt = new IngestionAttempt(fence);
    let unblock!: () => void;
    const blocker = attempt.serialize(
      () =>
        new Promise<void>((resolve) => {
          unblock = resolve;
        }),
    );
    const rpc = vi.fn(async () => ({ data: response(), error: null }));
    const replacement = vi.fn(async () => ({ data: response(), error: null }));
    const args = { attempt, rpc, generationId, sourceBinding: binding };
    const result = readWorkerProviderAuthorityFacts(args);
    args.rpc = replacement;
    await Promise.resolve();
    unblock();
    await blocker;
    expect(await result).toEqual(response().providerAuthority);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(replacement).not.toHaveBeenCalled();
  });
  it("does not dispatch an already cancelled attempt", async () => {
    const attempt = new IngestionAttempt(fence);
    attempt.cancel();
    const rpc = vi.fn(async () => ({ data: response(), error: null }));
    await expect(
      readWorkerProviderAuthorityFacts({ attempt, rpc, generationId, sourceBinding: binding }),
    ).rejects.toMatchObject({ code: "lease_lost" });
    expect(rpc).not.toHaveBeenCalled();
  });
});
