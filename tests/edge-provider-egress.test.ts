import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { IngestionAttempt, type IngestionFence } from "../supabase/functions/_shared/ingestion-attempt";
import {
  createIngestionProviderEgressContext,
  IngestionProviderEgressRefusal,
  revokeIngestionProviderEgressContext,
  type IngestionProviderEgressRequest,
} from "../src/lib/ingestion-provider-egress";
import { createUnavailableIngestionProviderEgressContext } from "../supabase/functions/_shared/unavailable-ingestion-provider-egress";
import {
  agentFailureDecision,
  edgeProviderEgressBinding,
  edgeProviderEgressFailure,
  runClaimedJobBatch,
  runEdgeProviderEgressTransport,
} from "../supabase/functions/indexing-v3-agent/behavior";

const fence: IngestionFence = {
  job_kind: "indexing_v3",
  job_id: "11111111-1111-4111-8111-111111111111",
  document_id: "22222222-2222-4222-8222-222222222222",
  worker_id: "synthetic-edge",
  lease_token: "33333333-3333-4333-8333-333333333333",
  expected_generation_id: "44444444-4444-4444-8444-444444444444",
  authority_digest: `sha256:${"a".repeat(64)}`,
};
const source = {
  document_id: fence.document_id,
  index_generation_id: fence.expected_generation_id,
  admission_event_id: "55555555-5555-4555-8555-555555555555",
  document_content_hash: "b".repeat(64),
  content_sha256: `sha256:${"b".repeat(64)}`,
};
const binding = edgeProviderEgressBinding(fence, 2, source);
function current(request: IngestionProviderEgressRequest) {
  const clean = (bound: typeof binding) => ({
    binding: bound,
    purpose: request.purpose,
    policyVersion: "synthetic-v1",
    admission: "current",
    ownerScope: "permitted",
    rights: "permitted",
    purposeClearance: "permitted",
    scanner: { verdict: "clean", scannerVersion: "synthetic-v1", contentSha256: bound.contentSha256 },
    activeContent: "absent",
    identifiers: "absent",
    hiddenText: "consistent",
    encryption: "not_encrypted",
    source: "eligible",
    indexLicence: "permitted",
    sourcePolicy: "matched",
  });
  return {
    sourceBinding: binding,
    sourceObservations: clean(binding),
    observations: clean({ ...binding, contentSha256: request.payloadSha256 }),
  };
}

describe("Edge provider egress boundary", () => {
  it("pins admission, raw hash and complete live claim identity", () => {
    expect(binding).toMatchObject({
      admissionEventId: source.admission_event_id,
      contentSha256: source.content_sha256,
      generationId: fence.expected_generation_id,
      jobId: fence.job_id,
      attemptId: `${fence.job_id}:2`,
      leaseId: fence.lease_token,
      authorityDigest: fence.authority_digest,
    });
    expect(() => edgeProviderEgressBinding(fence, 2, { ...source, index_generation_id: fence.lease_token })).toThrow(
      "provider_egress_binding_mismatch",
    );
    expect(() => edgeProviderEgressBinding(fence, 2, { ...source, admission_event_id: null })).toThrow(
      "provider_egress_denied",
    );
    expect(() => edgeProviderEgressBinding(fence, 2, { ...source, document_content_hash: "c".repeat(64) })).toThrow(
      "provider_egress_binding_mismatch",
    );
  });

  it("default unconfigured source scanner refuses with zero actual fetches", async () => {
    const reload = vi.fn(async () => binding);
    const context = createUnavailableIngestionProviderEgressContext({ binding, loadCurrentSourceBinding: reload });
    const fetch = vi.fn(async () => new Response("synthetic"));
    await expect(
      runEdgeProviderEgressTransport(
        new IngestionAttempt(fence),
        new AbortController().signal,
        context,
        "embedding",
        '{"input":["synthetic"]}',
        fetch,
      ),
    ).rejects.toMatchObject({
      name: "IngestionProviderEgressRefusal",
      codes: expect.arrayContaining(["scanner_unavailable"]),
    });
    expect(reload).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("checks exact serialized body on each retry and dispatches that same immutable string", async () => {
    const loader = vi.fn(async (request: IngestionProviderEgressRequest) => current(request));
    const context = createIngestionProviderEgressContext({ binding, loadCurrent: loader });
    const body = JSON.stringify({ model: "synthetic-model", input: ["synthetic"], dimensions: 3 });
    const fetch = vi.fn(async (_signal: AbortSignal, payload: string) => payload);
    const attempt = new IngestionAttempt(fence);
    const timeout = new AbortController();
    await runEdgeProviderEgressTransport(attempt, timeout.signal, context, "embedding", body, fetch);
    await runEdgeProviderEgressTransport(attempt, timeout.signal, context, "embedding", body, fetch);
    expect(loader).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(loader.mock.calls.map(([request]) => request.payload)).toEqual([body, body]);
    expect(fetch.mock.calls.map(([, payload]) => payload)).toEqual([body, body]);
  });

  it("denies the next retry after revocation without another actual fetch", async () => {
    const context = createIngestionProviderEgressContext({ binding, loadCurrent: async (request) => current(request) });
    const fetch = vi.fn(async () => {
      revokeIngestionProviderEgressContext(context);
      return "synthetic-retry";
    });
    const attempt = new IngestionAttempt(fence);
    const timeout = new AbortController();
    await expect(
      runEdgeProviderEgressTransport(attempt, timeout.signal, context, "embedding", "synthetic", fetch),
    ).rejects.toMatchObject({ code: "provider_egress_permit_revoked" });
    await expect(
      runEdgeProviderEgressTransport(attempt, timeout.signal, context, "embedding", "synthetic", fetch),
    ).rejects.toMatchObject({ code: "provider_egress_permit_revoked" });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("abandons after lease loss during a current-authority reload", async () => {
    const attempt = new IngestionAttempt(fence);
    const context = createIngestionProviderEgressContext({
      binding,
      loadCurrent: async (request) => {
        attempt.cancel();
        return current(request);
      },
    });
    const fetch = vi.fn(async () => "synthetic");
    await expect(
      runEdgeProviderEgressTransport(attempt, new AbortController().signal, context, "embedding", "synthetic", fetch),
    ).rejects.toMatchObject({ code: "lease_lost" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refuses a late successful response after a sibling denial before persistence", async () => {
    let release!: () => void;
    const pendingResponse = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const fetchEntered = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const context = createIngestionProviderEgressContext({
      binding,
      loadCurrent: async (request) => {
        const loaded = current(request);
        if (request.payload === "synthetic-denied") loaded.observations.identifiers = "detected";
        return loaded;
      },
    });
    const persist = vi.fn();
    const attempt = new IngestionAttempt(fence);
    const timeout = new AbortController();
    const first = runEdgeProviderEgressTransport(
      attempt,
      timeout.signal,
      context,
      "embedding",
      "synthetic-pending",
      async () => {
        entered();
        await pendingResponse;
        return "synthetic-success";
      },
    ).then((result) => {
      persist(result);
      return result;
    });
    await fetchEntered;
    const deniedFetch = vi.fn(async () => "synthetic-never");
    await expect(
      runEdgeProviderEgressTransport(attempt, timeout.signal, context, "embedding", "synthetic-denied", deniedFetch),
    ).rejects.toMatchObject({ code: "provider_egress_denied" });
    release();
    await expect(first).rejects.toMatchObject({ code: "provider_egress_denied" });
    expect(persist).not.toHaveBeenCalled();
    expect(deniedFetch).not.toHaveBeenCalled();
  });

  it("retains typed refusal across batch failure handling and forces terminal safe metadata", async () => {
    const refusal = new IngestionProviderEgressRefusal("provider_egress_denied", [
      { code: "identifier_detected", action: "remove_or_quarantine_unsafe_content" },
    ]);
    const record = vi.fn(async (_job: { id: string }, message: string, error?: unknown) => {
      expect(error).toBe(refusal);
      expect(message).toBe("provider_egress_denied");
      expect(
        agentFailureDecision({ attemptCount: 1, maxAttempts: 5, nowMs: 0, retryDelayMs: 10, error }),
      ).toMatchObject({
        shouldRetry: false,
        status: "failed",
        nextRunAt: null,
      });
      expect(edgeProviderEgressFailure(error)).toEqual({
        code: "provider_egress_denied",
        codes: ["identifier_detected"],
        reasons: [{ code: "identifier_detected", action: "remove_or_quarantine_unsafe_content" }],
        actions: ["remove_or_quarantine_unsafe_content"],
      });
    });
    const batch = await runClaimedJobBatch([{ id: "synthetic-a" }, { id: "synthetic-b" }], {
      processJob: async (job) => {
        if (job.id.endsWith("a")) throw refusal;
        return { status: "completed", missing: [] };
      },
      markJobFailure: record,
    });
    expect(batch).toMatchObject({ failed: 1, processed: 1 });
    expect(record).toHaveBeenCalledOnce();
  });

  it("actual Edge embedding loop uses the guarded transport and original typed failure", () => {
    const index = readFileSync(new URL("../supabase/functions/indexing-v3-agent/index.ts", import.meta.url), "utf8");
    const start = index.indexOf("async function fetchEmbeddingBatch(");
    const end = index.indexOf("async function embeddingBatch(", start);
    const transport = index.slice(start, end);
    expect(transport).toContain("runEdgeProviderEgressTransport(");
    expect(transport).toMatch(/egressContext,\s*"embedding",\s*serializedBody/);
    expect(transport).toContain("if (e instanceof ProviderEgressDeniedError) throw e;");
    expect(index).toContain("createUnavailableIngestionProviderEgressContext({");
    expect(index).toContain("markJobFailure: (job, message, error) => markJobFailure(job, message, error)");
    expect(index).toContain('document_ingress_safety: { verdict: "quarantine", ...refusal }');
  });
});
