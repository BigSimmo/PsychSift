import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { IngestionAttempt } from "../supabase/functions/_shared/ingestion-attempt";
import {
  claimedJobFence,
  collectIngestionShadowCoreRows,
  persistIngestionShadowCoreFamily,
  persistIngestionQuality,
  persistIngestionShadowWorkerProjection,
  declareIngestionShadowProducer,
  declareIngestionShadowClaimControl,
  retainIngestionShadowRepairDecision,
  startIngestionShadowPipelineStage,
  finishIngestionShadowPipelineStage,
  stageIngestionShadowGeneration,
  recordIngestionShadowProducerFailure,
  selectIngestionEnrichmentGeneration,
  enrichmentRepairDecision,
  ingestionFailureDecision,
  runIngestionMutation,
  writeIngestionCoreGeneration,
  persistIngestionImage,
} from "../worker/behavior";
import type { JobRow, ShadowGenerationMember } from "../worker/types";
import { encodeShadowNodeJsonCanonicalPayload, prepareShadowProducerDeclarationV1, readShadowProducerInputV1,
  type ShadowRawEnvelope, type ShadowWorkerContextV1 } from "../scripts/lib/reindex-eval-session";
import * as shadowSession from "../scripts/lib/reindex-eval-session";

const unexpectedShadowFailure = async (): Promise<never> => { throw new Error("Unexpected shadow producer failure"); };

describe("ingestion worker behavior", () => {
  it("validates the original core row before reading identifiers or invoking getters", () => {
    const pending = { chunks: [], table_facts: [], embedding_fields: [], index_units: [] };
    const getter = vi.fn(() => "id");
    const row = Object.defineProperty({}, "id", { get: getter, enumerable: true });
    expect(() => collectIngestionShadowCoreRows(pending, "chunks", [row])).toThrow();
    expect(getter).not.toHaveBeenCalled();
    const trap = vi.fn(() => "id");
    expect(() => collectIngestionShadowCoreRows(pending, "chunks", [new Proxy({}, { get: trap })])).toThrow();
    expect(trap).not.toHaveBeenCalled();
    expect(pending.chunks).toEqual([]);
  });

  it("plans an id while preserving native own-undefined data without mutating the source", () => {
    const pending: { chunks: Record<string, unknown>[]; table_facts: []; embedding_fields: []; index_units: [] } =
      { chunks: [], table_facts: [], embedding_fields: [], index_units: [] };
    const source = { content: "full native text", retrieval_synopsis: undefined, metadata: { exact: " café\n " } };
    collectIngestionShadowCoreRows(pending, "chunks", [source]);
    expect(pending.chunks[0]).toMatchObject(source);
    expect(pending.chunks[0]?.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(Object.hasOwn(pending.chunks[0]!, "retrieval_synopsis")).toBe(true);
    expect(Object.hasOwn(source, "id")).toBe(false);
  });

  it("retries transient failures while preserving a previously indexed document", () => {
    const decision = ingestionFailureDecision({
      error: new Error("network connection reset"),
      attemptCount: 2,
      maxAttempts: 4,
      atomicReindex: true,
    });

    expect(decision).toMatchObject({
      retry: true,
      documentStatus: "indexed",
      stage: "retry scheduled after attempt 2/4",
      errorMessage: "network connection reset",
    });
    expect(decision.nextRunAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("fails closed for a partial generation write instead of automatically retrying", () => {
    const decision = ingestionFailureDecision({
      error: new Error('duplicate key value violates unique constraint "document_chunks_pkey"'),
      attemptCount: 1,
      maxAttempts: 4,
      atomicReindex: false,
    });

    expect(decision).toEqual({
      retry: false,
      documentStatus: "failed",
      stage: "needs recovery after partial index write",
      errorMessage:
        'duplicate key value violates unique constraint "document_chunks_pkey". Run npm run recover:ingestion -- --apply before retrying this document.',
    });
  });

  it("does not retry a transient failure after the attempt budget is exhausted", () => {
    expect(
      ingestionFailureDecision({
        error: Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }),
        attemptCount: 4,
        maxAttempts: 4,
        atomicReindex: false,
      }),
    ).toEqual({ retry: false, documentStatus: "failed", stage: "failed", errorMessage: "timeout" });
  });

  it("queues agent repair when optional writes fail despite inline enrichment succeeding", () => {
    expect(
      enrichmentRepairDecision({
        enrichmentStatus: "completed",
        enrichmentErrorMessage: null,
        optionalIssueCount: 2,
      }),
    ).toEqual({
      enrichmentStatus: "pending",
      enrichmentErrorMessage: "Optional index artifact writes failed; queued for indexing-v3-agent repair.",
      repairRequired: true,
      repairReason: "optional_index_write_issues",
      repairMessage: "Optional index artifact writes failed; queued for indexing-v3-agent repair.",
    });
  });

  it("marks a fully enriched generation complete without sticky repair metadata", () => {
    expect(
      enrichmentRepairDecision({
        enrichmentStatus: "completed",
        enrichmentErrorMessage: null,
        optionalIssueCount: 0,
      }),
    ).toMatchObject({ repairRequired: false, enrichmentStatus: "completed" });
  });
});

describe("U04 worker shadow terminal staging", () => {
  function envelope(domain: ShadowRawEnvelope["domain"], digest: string): ShadowRawEnvelope {
    return { version: 1, domain, encoding: "pg-jsonb-text-v1", canonicalPayload: "{}",
      digest: `sha256:${digest.repeat(64)}` };
  }

  function fixture() {
    const fence = { job_kind: "node" as const, job_id: "44444444-4444-4444-8444-444444444444",
      document_id: "55555555-5555-4555-8555-555555555555", worker_id: "synthetic-worker",
      lease_token: "66666666-6666-4666-8666-666666666666",
      expected_generation_id: "11111111-1111-4111-8111-111111111111",
      authority_digest: `sha256:${"a".repeat(64)}` };
    const planEnvelope = envelope("plan", "e");
    const executionProfileEnvelope = envelope("u04-execution-profile-v1", "c");
    const originalOriginEnvelope = envelope("baseline", "b");
    const binding = { tag: "candidate" as const, source: { version: 1 as const,
      originDigest: originalOriginEnvelope.digest, executionProfileDigest: executionProfileEnvelope.digest,
      documentId: fence.document_id, ownerId: null, contentHash: `sha256:${"d".repeat(64)}`,
      authorityDigest: fence.authority_digest, sourcePolicyVersion: "synthetic-policy-v1", manualAliasIds: [],
      baselineGenerationId: fence.expected_generation_id, source: { tag: "document_owned" as const } },
      candidateGenerationId: "22222222-2222-4222-8222-222222222222", jobId: fence.job_id,
      firstLeaseToken: fence.lease_token, artifactGenerationId: null };
    const shadow = { kind: "shadow-worker-reservation-readback", binding, planEnvelope,
      executionProfileEnvelope, executionProfile: {}, originalOriginEnvelope,
      baselineBundleEnvelope: envelope("baseline", "f"), controlRevision: 4,
      controlSnapshot: { controlRevision: 4, ownNodeJobs: [{ id: fence.job_id, document_id: fence.document_id,
        locked_by: fence.worker_id, lease_token: fence.lease_token,
        lease_expected_generation_id: fence.expected_generation_id,
        lease_authority_digest: fence.authority_digest }], ownStages: [] },
      inventoryManifest: {} } as unknown as ShadowWorkerContextV1;
    const memberReceiptEnvelope = envelope("member_receipt", "9");
    const memberContext = { memberRowEnvelope: envelope("baseline", "8"), profileEnvelope: executionProfileEnvelope,
      inventoryRowEnvelopes: [], originalOriginEnvelope, planDigest: planEnvelope.digest };
    const attempt = new IngestionAttempt(fence);
    const trace: string[] = [];
    const rpc = vi.fn(async (name: string, payload: Record<string, unknown>):
      Promise<{ data: unknown; error: { message: string } | null }> => {
      trace.push(name);
      expect(payload.p_fence).toEqual(fence);
      if (name === "start_ingestion_job_stage") return { data: { ok: true,
        stage_id: "77777777-7777-4777-8777-777777777777" }, error: null };
      if (name === "finish_ingestion_job_stage") return { data: { ok: true }, error: null };
      if (name === "stage_document_index_generation") return { data: { ok: true, kind: "shadow_staged",
        memberReceiptEnvelope, memberContext }, error: null };
      throw new Error("unexpected synthetic RPC");
    });
    const validated = { payload: { binding }, finalInventory: { preSealControl: { payload: { ownNodeJobs: [{
      id: fence.job_id, document_id: fence.document_id, locked_by: fence.worker_id, lease_token: fence.lease_token,
      lease_expected_generation_id: fence.expected_generation_id, lease_authority_digest: fence.authority_digest,
    }] } } } };
    const reader = vi.spyOn(shadowSession, "readShadowMemberSealReceiptV1").mockReturnValue(validated as never);
    return { attempt, binding, shadow, rpc, trace, reader, validated, memberReceiptEnvelope, memberContext };
  }

  it("orders the actual owned stage around producer completion and validates the returned receipt", async () => {
    const f = fixture();
    try {
      const stageId = await startIngestionShadowPipelineStage({ attempt: f.attempt, shadow: f.shadow, rpc: f.rpc });
      f.trace.push("all-final-producers");
      await finishIngestionShadowPipelineStage({ attempt: f.attempt, shadow: f.shadow, stageId,
        counts: { page_count: 1, chunk_count: 2, image_count: 0 }, rpc: f.rpc });
      f.trace.push("heartbeat-cleared");
      const staged = await stageIngestionShadowGeneration({ attempt: f.attempt, shadow: f.shadow, rpc: f.rpc });
      expect(f.trace).toEqual(["start_ingestion_job_stage", "all-final-producers", "finish_ingestion_job_stage",
        "heartbeat-cleared", "stage_document_index_generation"]);
      expect(f.reader).toHaveBeenCalledExactlyOnceWith(f.memberReceiptEnvelope, f.memberContext);
      expect(staged).toMatchObject({ memberReceiptEnvelope: f.memberReceiptEnvelope, memberContext: f.memberContext });
      expect(f.attempt.signal.aborted).toBe(false);
    } finally {
      f.reader.mockRestore();
    }
  });

  it.each(["start", "finish"] as const)("refuses a negative %s-stage acknowledgment and cancels", async phase => {
    const f = fixture();
    try {
      f.rpc.mockImplementation(async (name) => {
        if (name === "start_ingestion_job_stage") {
          return { data: { ok: false, stage_id: "77777777-7777-4777-8777-777777777777" }, error: null };
        }
        if (name === "finish_ingestion_job_stage") return { data: { ok: false }, error: null };
        throw new Error("unexpected synthetic RPC");
      });
      const action = phase === "start"
        ? startIngestionShadowPipelineStage({ attempt: f.attempt, shadow: f.shadow, rpc: f.rpc })
        : finishIngestionShadowPipelineStage({ attempt: f.attempt, shadow: f.shadow,
            stageId: "77777777-7777-4777-8777-777777777777", counts: {}, rpc: f.rpc });
      await expect(action).rejects.toThrow("ingestion_rpc_invalid");
      expect(f.attempt.signal.aborted).toBe(true);
    } finally {
      f.reader.mockRestore();
    }
  });

  it("retains full failed producer input and partial output before permanently stopping the attempt", async () => {
    const f = fixture();
    const input = { text: "complete evidence café\n".repeat(5000), ownUndefined: undefined };
    const partial = { rows: [{ content: "first complete row", optional: undefined }], completed: 1 };
    const expectedInput = structuredClone(input); const expectedPartial = structuredClone(partial);
    let retained: Record<string, unknown> | undefined;
    f.rpc.mockImplementation(async (name, payload) => {
      expect(name).toBe("record_shadow_producer_failure");
      expect(payload.p_fence).toEqual(f.attempt.fence);
      const bytes = payload.p_failure as ShadowRawEnvelope;
      expect(Buffer.byteLength(bytes.canonicalPayload)).toBeGreaterThan(65536);
      retained = JSON.parse(bytes.canonicalPayload);
      expect(retained).toMatchObject({ kind: "u04-producer-failure-v1", version: 1,
        phase: "table_facts", code: "producer_failed", expectedControlRevision: 4,
        artifactGenerationId: null, binding: f.binding });
      return { data: { ok: true, kind: "shadow_failed", control_revision: 5,
        stage_id: "77777777-7777-4777-8777-777777777777", failure_digest: bytes.digest }, error: null };
    });
    try {
      await expect(recordIngestionShadowProducerFailure({ attempt: f.attempt, shadow: f.shadow,
        failure: { phase: "table_facts", code: "producer_failed", artifactGenerationId: null, input, partial },
        readControlRevision: async () => {
          input.text = "mutated after capture"; partial.rows.length = 0;
          return 4;
        }, rpc: f.rpc })).rejects.toThrow("completion_gate_blocked");
      const read = (key: string) => readShadowProducerInputV1(JSON.parse(
        (retained![key] as ShadowRawEnvelope).canonicalPayload)).nativeInput;
      expect(read("inputEnvelope")).toEqual(expectedInput);
      expect(Object.hasOwn(read("inputEnvelope") as object, "ownUndefined")).toBe(true);
      expect(read("partialEnvelope")).toEqual(expectedPartial);
      expect(f.attempt.signal.aborted).toBe(true);
      const later = vi.fn(async () => ({ data: { ok: true }, error: null }));
      await expect(runIngestionMutation(f.attempt, later, "complete_ingestion_job")).rejects.toThrow("lease_lost");
      expect(later).not.toHaveBeenCalled();
      expect(f.rpc).toHaveBeenCalledTimes(1);
    } finally { f.reader.mockRestore(); }
  });

  it.each(["image_bytes", "image_classification", "chunk_embeddings"] as const)(
    "accepts the truthful %s required-producer failure phase and then stops",
    async phase => {
      const f = fixture();
      f.rpc.mockImplementation(async (_name, payload) => {
        const failure = payload.p_failure as ShadowRawEnvelope;
        expect(JSON.parse(failure.canonicalPayload).phase).toBe(phase);
        return { data: { ok: true, kind: "shadow_failed", control_revision: 5,
          stage_id: "77777777-7777-4777-8777-777777777777", failure_digest: failure.digest }, error: null };
      });
      try {
        await expect(recordIngestionShadowProducerFailure({
          attempt: f.attempt,
          shadow: f.shadow,
          failure: { phase, code: "producer_failed", artifactGenerationId: null,
            input: { complete: true }, partial: { retained: true } },
          readControlRevision: async () => 4,
          rpc: f.rpc,
        })).rejects.toThrow("completion_gate_blocked");
        expect(f.attempt.signal.aborted).toBe(true);
      } finally {
        f.reader.mockRestore();
      }
    },
  );

  it.each(["foreign digest", "stale revision", "negative acknowledgment", "ambiguous response", "cancelled response"] as const)(
    "refuses failed producer %s without retry or fallback", async fault => {
      const f = fixture();
      f.rpc.mockImplementation(async (_name, payload) => {
        if (fault === "ambiguous response") throw new Error("synthetic lost response");
        if (fault === "cancelled response") f.attempt.cancel();
        return { data: { ok: fault !== "negative acknowledgment", kind: "shadow_failed",
          control_revision: fault === "stale revision" ? 4 : 5,
          stage_id: "77777777-7777-4777-8777-777777777777",
          failure_digest: fault === "foreign digest" ? `sha256:${"0".repeat(64)}` :
            (payload.p_failure as ShadowRawEnvelope).digest }, error: null };
      });
      try {
        const args = { attempt: f.attempt, shadow: f.shadow,
          failure: { phase: "deep_cards" as const, code: "producer_failed" as const,
            artifactGenerationId: "33333333-3333-4333-8333-333333333333", input: {}, partial: { cards: [] } },
          readControlRevision: async () => 4, rpc: f.rpc };
        await expect(recordIngestionShadowProducerFailure(args)).rejects.toThrow();
        await expect(recordIngestionShadowProducerFailure(args)).rejects.toThrow("lease_lost");
        expect(f.rpc).toHaveBeenCalledTimes(1);
        expect(f.attempt.signal.aborted).toBe(true);
      } finally { f.reader.mockRestore(); }
    });

  it.each(["missing deep generation", "foreign claim", "already cancelled"] as const)(
    "refuses failed producer %s before dispatch", async fault => {
      const f = fixture(); const readControlRevision = vi.fn(async () => 4);
      if (fault === "already cancelled") f.attempt.cancel();
      const shadow = fault === "foreign claim" ? { ...f.shadow,
        binding: { ...f.binding, firstLeaseToken: "77777777-7777-4777-8777-777777777777" } } : f.shadow;
      try {
        await expect(recordIngestionShadowProducerFailure({ attempt: f.attempt, shadow,
          failure: { phase: fault === "missing deep generation" ? "deep_cards" : "table_facts",
            code: "producer_failed", artifactGenerationId: null, input: {}, partial: {} },
          readControlRevision, rpc: f.rpc })).rejects.toThrow();
        expect(readControlRevision).not.toHaveBeenCalled(); expect(f.rpc).not.toHaveBeenCalled();
      } finally { f.reader.mockRestore(); }
    });

  it("refuses a self-consistent receipt for a different reserved member", async () => {
    const f = fixture();
    try {
      f.reader.mockReturnValue({ ...f.validated, payload: { binding: { ...f.binding,
        candidateGenerationId: "33333333-3333-4333-8333-333333333333" } } } as never);
      await expect(stageIngestionShadowGeneration({ attempt: f.attempt, shadow: f.shadow, rpc: f.rpc }))
        .rejects.toThrow("ingestion_rpc_invalid");
      expect(f.attempt.signal.aborted).toBe(true);
    } finally {
      f.reader.mockRestore();
    }
  });

  it.each(["returned error", "malformed response", "negative acknowledgment", "receipt refusal", "cancel after dispatch"] as const)(
    "cancels on %s and cannot dispatch a later ordinary completion", async fault => {
      const f = fixture();
      try {
        if (fault === "receipt refusal") f.reader.mockImplementation(() => {
          throw new Error("Invalid shadow comparison record.");
        });
        f.rpc.mockImplementation(async (name: string) => {
          if (name !== "stage_document_index_generation") throw new Error("unexpected synthetic RPC");
          if (fault === "returned error") return { data: null, error: { message: "response lost after dispatch" } };
          if (fault === "malformed response") return { data: { ok: true }, error: null };
          if (fault === "cancel after dispatch") f.attempt.cancel();
          return { data: { ok: fault !== "negative acknowledgment", kind: "shadow_staged",
            memberReceiptEnvelope: f.memberReceiptEnvelope, memberContext: f.memberContext }, error: null };
        });
        await expect(stageIngestionShadowGeneration({ attempt: f.attempt, shadow: f.shadow, rpc: f.rpc })).rejects.toThrow();
        expect(f.attempt.signal.aborted).toBe(true);
        const later = vi.fn(async () => ({ data: { ok: true }, error: null }));
        await expect(runIngestionMutation(f.attempt, later, "complete_ingestion_job")).rejects.toThrow("lease_lost");
        expect(later).not.toHaveBeenCalled();
      } finally {
        f.reader.mockRestore();
      }
    },
  );

  it("wires claim capture, one pipeline stage, heartbeat stop, and late seal before ordinary completion", () => {
    const source = readFileSync(new URL("../worker/main.ts", import.meta.url), "utf8");
    const claim = source.indexOf("await declareIngestionShadowClaimControl");
    const start = source.indexOf("await startIngestionShadowPipelineStage", claim);
    const heartbeat = source.indexOf("leaseHeartbeat = setInterval", start);
    const projection = source.indexOf("await persistIngestionShadowWorkerProjection", heartbeat);
    const finish = source.indexOf("await finishIngestionShadowPipelineStage", projection);
    const clear = source.indexOf("clearInterval(leaseHeartbeat)", finish);
    const seal = source.indexOf("await stageIngestionShadowGeneration", clear);
    const ordinary = source.indexOf("await updateDocument(job.document_id", seal);
    expect([claim, start, heartbeat, projection, finish, clear, seal, ordinary].every(index => index >= 0)).toBe(true);
    expect(claim).toBeLessThan(start); expect(start).toBeLessThan(heartbeat);
    expect(projection).toBeLessThan(finish); expect(finish).toBeLessThan(clear);
    expect(clear).toBeLessThan(seal); expect(seal).toBeLessThan(ordinary);
    expect(source).not.toContain("shadow_terminal_semantics_unavailable");
  });

  it("retains bound required image and chunk failures before shadow cancellation", () => {
    const source = readFileSync(new URL("../worker/main.ts", import.meta.url), "utf8");
    expect(source.match(/readImageBytesWithShadowFailureRetention\(\{/g)).toHaveLength(3);

    const captionStart = source.indexOf("const boundBatchInput = shadow");
    const captionEnd = source.indexOf("resolvedTasks.push(...batchResults)", captionStart);
    const caption = source.slice(captionStart, captionEnd);
    expect(caption).toContain('phase: "image_bytes" as const');
    expect(caption).toContain('phase: "image_classification" as const');
    expect(caption).toContain("const batchOutcomes = await Promise.all(");
    expect(caption).toContain("bindShadowProducerFailureValue({");
    expect(caption).toContain("return retainShadowProducerFailure(");

    const chunksStart = source.indexOf("const embeddingInput = shadowProducerPersistence(job)");
    const chunksEnd = source.indexOf("indexedChunkRows.push(...rows)", chunksStart);
    const chunks = source.slice(chunksStart, chunksEnd);
    expect(chunks).toContain('model: env.OPENAI_EMBEDDING_MODEL');
    expect(chunks).toContain('"chunk_embeddings"');
    expect(chunks).toContain('rows: shadowCoreFailurePartial(job, "chunks").rows');
    expect(chunks).toContain("embeddings,");
    expect(chunks).toContain("failure: safeErrorLogDetails(error)");
  });
});

describe("worker core generation persistence", () => {
  const baselineGeneration = "11111111-1111-4111-8111-111111111111";
  const candidateGeneration = "22222222-2222-4222-8222-222222222222";
  const differentId = "33333333-3333-4333-8333-333333333333";
  const planDigest = `sha256:${"a".repeat(64)}`;
  type CoreArgs = Parameters<typeof writeIngestionCoreGeneration>[0];

  function fixture(operation: "standard" | "shadow_reindex") {
    const job: JobRow = {
      id: "44444444-4444-4444-8444-444444444444",
      document_id: "55555555-5555-4555-8555-555555555555",
      locked_by: "synthetic-worker",
      lease_token: "66666666-6666-4666-8666-666666666666",
      lease_expected_generation_id: baselineGeneration,
      lease_write_generation_id: candidateGeneration,
      lease_authority_digest: `sha256:${"b".repeat(64)}`,
      lease_expires_at: "2099-01-01T00:00:00.000Z",
      lease_duration_seconds: 60,
      operation,
      requested_generation_id: operation === "shadow_reindex" ? candidateGeneration : null,
      shadow_plan_digest: operation === "shadow_reindex" ? planDigest : null,
      batch_id: null,
      attempt_count: 1,
      max_attempts: 4,
      documents: {
        id: "55555555-5555-4555-8555-555555555555",
        owner_id: null,
        title: "Synthetic core boundary fixture",
        file_name: "synthetic.txt",
        file_type: "text/plain",
        storage_path: "synthetic/unused.txt",
        status: "indexed",
        metadata: { index_generation_id: baselineGeneration },
      },
    };
    const shadowMember: ShadowGenerationMember = {
      document_id: job.document_id,
      index_generation_id: candidateGeneration,
      baseline_generation_id: baselineGeneration,
      job_id: job.id,
      first_lease_token: job.lease_token,
      authority_digest: job.lease_authority_digest,
      shadow_reindex_waves: { candidate_generation_id: candidateGeneration, plan_digest: planDigest },
    };
    const attempt = new IngestionAttempt(claimedJobFence(job, "node"));
    const originalFence = attempt.fence;
    let liveGeneration = baselineGeneration;
    // Fake only the persistence transport. The exercised decision is the same
    // writeIngestionCoreGeneration call reached by processJob in main.ts.
    const rpc = vi.fn(async (name: string, payload: Record<string, unknown>) => {
      if (name === "commit_document_index_generation") {
        liveGeneration = payload.p_generation as string;
        return {
          data: { ok: true, fence: { ...originalFence, expected_generation_id: liveGeneration } },
          error: null,
        };
      }
      if (name === "write_shadow_generation_pages") return { data: { ok: true }, error: null };
      throw new Error(`Unexpected core RPC: ${name}`);
    });
    const args: CoreArgs = {
      job,
      attempt,
      rpc,
      generation: candidateGeneration,
      pageCount: 1,
      chunkCount: 1,
      imageCount: 0,
      pages: [{ page_number: 1, text: "Synthetic retained evidence" }],
      metadata: { index_generation_id: candidateGeneration },
      quality: { quality_score: 90, issues: [] },
      ...(operation === "shadow_reindex" ? { shadowMember } : {}),
    };
    return { args, rpc, originalFence, liveGeneration: () => liveGeneration };
  }

  it("preserves the standard commit payload and real U03 Fence handoff", async () => {
    const { args, rpc, originalFence, liveGeneration } = fixture("standard");

    await writeIngestionCoreGeneration(args);

    expect(rpc.mock.calls).toEqual([
      [
        "commit_document_index_generation",
        {
          p_fence: originalFence,
          p_generation: candidateGeneration,
          p_page_count: 1,
          p_chunk_count: 1,
          p_image_count: 0,
          p_metadata: args.metadata,
          p_pages: args.pages,
          p_quality: args.quality,
        },
      ],
    ]);
    expect(liveGeneration()).toBe(candidateGeneration);
    expect(args.attempt.fence).toEqual({ ...originalFence, expected_generation_id: candidateGeneration });
  });

  function enrichmentFixture(baseline: string | null = baselineGeneration) {
    const { args, originalFence } = fixture("shadow_reindex");
    args.job.lease_expected_generation_id = baseline;
    const attempt = new IngestionAttempt({ ...originalFence, expected_generation_id: baseline });
    const binding: NonNullable<Parameters<typeof selectIngestionEnrichmentGeneration>[0]["shadow"]>["binding"] = {
      tag: "candidate", source: { version: 1, documentId: args.job.document_id, ownerId: null,
        originDigest: `sha256:${"c".repeat(64)}`, executionProfileDigest: `sha256:${"d".repeat(64)}`,
        contentHash: `sha256:${"e".repeat(64)}`, authorityDigest: originalFence.authority_digest,
        sourcePolicyVersion: "synthetic-policy-v1", manualAliasIds: [], baselineGenerationId: baseline,
        source: { tag: "document_owned" } }, candidateGenerationId: candidateGeneration,
      jobId: args.job.id, firstLeaseToken: originalFence.lease_token, artifactGenerationId: null,
    };
    return { job: args.job, attempt, document: { id: args.job.document_id, owner_id: null,
      index_generation_id: baseline, metadata: { ...(baseline === null ? {} : { index_generation_id: baseline }),
        retained_manual_metadata: "original" } }, shadow: { binding } };
  }

  it.each([baselineGeneration, null])("selects actual candidate enrichment C while preserving live G0=%s and Fence", baseline => {
    const input = enrichmentFixture(baseline);
    const before = encodeShadowNodeJsonCanonicalPayload({ document: input.document, fence: input.attempt.fence });
    expect(selectIngestionEnrichmentGeneration(input)).toBe(candidateGeneration);
    expect(encodeShadowNodeJsonCanonicalPayload({ document: input.document, fence: input.attempt.fence })).toBe(before);
    expect(input.attempt.signal.aborted).toBe(false);
  });

  it("uses the handed-off live generation for ordinary enrichment", async () => {
    const { args } = fixture("standard");
    await writeIngestionCoreGeneration(args);
    expect(selectIngestionEnrichmentGeneration({ job: args.job, attempt: args.attempt,
      document: { id: args.job.document_id, owner_id: null, index_generation_id: candidateGeneration,
        metadata: { index_generation_id: candidateGeneration } } })).toBe(candidateGeneration);
  });

  it.each(["live changed", "metadata changed", "token changed", "missing reservation"] as const)(
    "cancels actual candidate enrichment before producers when %s", fault => {
      const input: Parameters<typeof selectIngestionEnrichmentGeneration>[0] = enrichmentFixture();
      if (fault === "live changed") input.document.index_generation_id = candidateGeneration;
      if (fault === "metadata changed") input.document.metadata = { index_generation_id: candidateGeneration };
      if (fault === "token changed") input.shadow = { binding: { ...input.shadow!.binding, firstLeaseToken: differentId } };
      if (fault === "missing reservation") delete input.shadow;
      expect(() => selectIngestionEnrichmentGeneration(input)).toThrow();
      expect(input.attempt.signal.aborted).toBe(true);
    },
  );

  it("writes shadow C core pages under original G0 without committing or prematurely sealing the member", async () => {
    const { args, rpc, originalFence, liveGeneration } = fixture("shadow_reindex");

    await writeIngestionCoreGeneration(args);

    // Exact call set excludes normal commit/completion/reset and terminal shadow
    // seal. Quality/enrichment projections and final seal belong to later stages.
    expect.soft(rpc.mock.calls).toEqual([
      [
        "write_shadow_generation_pages",
        { p_fence: originalFence, p_generation: candidateGeneration, p_pages: args.pages },
      ],
    ]);
    expect.soft(liveGeneration()).toBe(baselineGeneration);
    expect.soft(args.attempt.fence).toEqual(originalFence);
  });

  it("refuses a negative shadow-pages acknowledgment and cancels before later effects", async () => {
    const { args, rpc, liveGeneration } = fixture("shadow_reindex");
    rpc.mockResolvedValueOnce({ data: { ok: false }, error: null });

    await expect(writeIngestionCoreGeneration(args)).rejects.toThrow("ingestion_rpc_invalid");

    expect(liveGeneration()).toBe(baselineGeneration);
    expect(args.attempt.signal.aborted).toBe(true);
    await expect(runIngestionMutation(args.attempt, rpc, "complete_ingestion_job")).rejects.toThrow("lease_lost");
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("preserves a legacy standard claim without the new operation columns", async () => {
    const { args, rpc, originalFence, liveGeneration } = fixture("standard");
    delete args.job.operation;
    delete args.job.requested_generation_id;
    delete args.job.shadow_plan_digest;

    await writeIngestionCoreGeneration(args);

    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc.mock.calls[0]).toEqual([
      "commit_document_index_generation",
      {
        p_fence: originalFence,
        p_generation: candidateGeneration,
        p_page_count: args.pageCount,
        p_chunk_count: args.chunkCount,
        p_image_count: args.imageCount,
        p_metadata: args.metadata,
        p_pages: args.pages,
        p_quality: args.quality,
      },
    ]);
    expect(liveGeneration()).toBe(candidateGeneration);
    expect(args.attempt.fence).toEqual({ ...originalFence, expected_generation_id: candidateGeneration });
  });

  const contradictions: Array<[string, (args: CoreArgs) => void]> = [
    [
      "standard operation with shadow identity",
      (args) => {
        args.job.operation = "standard";
      },
    ],
    [
      "missing persisted member",
      (args) => {
        delete args.shadowMember;
      },
    ],
    [
      "requested generation differs from C",
      (args) => {
        args.job.requested_generation_id = differentId;
      },
    ],
    [
      "write generation differs from C",
      (args) => {
        args.job.lease_write_generation_id = differentId;
      },
    ],
    [
      "payload generation differs from C",
      (args) => {
        args.generation = differentId;
      },
    ],
    [
      "job plan differs from wave",
      (args) => {
        args.job.shadow_plan_digest = `sha256:${"c".repeat(64)}`;
      },
    ],
    [
      "member document differs from job",
      (args) => {
        args.shadowMember!.document_id = differentId;
      },
    ],
    [
      "member job differs from claim",
      (args) => {
        args.shadowMember!.job_id = differentId;
      },
    ],
    [
      "member generation differs from C",
      (args) => {
        args.shadowMember!.index_generation_id = differentId;
      },
    ],
    [
      "wave generation differs from C",
      (args) => {
        args.shadowMember!.shadow_reindex_waves.candidate_generation_id = differentId;
      },
    ],
    [
      "member baseline differs from G0",
      (args) => {
        args.shadowMember!.baseline_generation_id = differentId;
      },
    ],
    [
      "member first token differs from claim",
      (args) => {
        args.shadowMember!.first_lease_token = differentId;
      },
    ],
    [
      "member authority differs from Fence",
      (args) => {
        args.shadowMember!.authority_digest = `sha256:${"c".repeat(64)}`;
      },
    ],
    [
      "shadow job has a batch",
      (args) => {
        args.job.batch_id = differentId;
      },
    ],
    [
      "unknown persisted operation",
      (args) => {
        Reflect.set(args.job, "operation", "unexpected_operation");
        args.job.requested_generation_id = null;
        args.job.shadow_plan_digest = null;
        delete args.shadowMember;
      },
    ],
    [
      "null persisted operation",
      (args) => {
        Reflect.set(args.job, "operation", null);
        args.job.requested_generation_id = null;
        args.job.shadow_plan_digest = null;
        delete args.shadowMember;
      },
    ],
    [
      "legacy operation with shadow markers",
      (args) => {
        delete args.job.operation;
      },
    ],
    [
      "C equals G0",
      (args) => {
        args.generation = baselineGeneration;
        args.job.lease_write_generation_id = baselineGeneration;
        args.job.requested_generation_id = baselineGeneration;
        args.shadowMember!.index_generation_id = baselineGeneration;
        args.shadowMember!.shadow_reindex_waves.candidate_generation_id = baselineGeneration;
      },
    ],
    [
      "mutually consistent job and member substitution",
      (args) => {
        args.job.id = differentId;
        args.shadowMember!.job_id = differentId;
      },
    ],
    [
      "mutually consistent document substitution",
      (args) => {
        args.job.document_id = differentId;
        args.job.documents.id = differentId;
        args.shadowMember!.document_id = differentId;
      },
    ],
    [
      "mutually consistent first-token substitution",
      (args) => {
        args.job.lease_token = differentId;
        args.shadowMember!.first_lease_token = differentId;
      },
    ],
    [
      "mutually consistent authority substitution",
      (args) => {
        args.job.lease_authority_digest = `sha256:${"c".repeat(64)}`;
        args.shadowMember!.authority_digest = args.job.lease_authority_digest;
      },
    ],
    [
      "mutually consistent baseline substitution",
      (args) => {
        args.job.lease_expected_generation_id = differentId;
        args.shadowMember!.baseline_generation_id = differentId;
      },
    ],
    [
      "worker identity substitution",
      (args) => {
        args.job.locked_by = "another-synthetic-worker";
      },
    ],
    [
      "document snapshot substitution",
      (args) => {
        args.job.documents.id = differentId;
      },
    ],
    [
      "non-Node actual Fence",
      (args) => {
        args.attempt = new IngestionAttempt({ ...args.attempt.fence, job_kind: "indexing_v3" });
      },
    ],
  ];

  it.each(contradictions)("refuses %s before any persistence", async (_name, contradict) => {
    const { args, rpc, liveGeneration } = fixture("shadow_reindex");
    contradict(args);

    await expect.soft(writeIngestionCoreGeneration(args)).rejects.toThrow("shadow_generation_identity_invalid");
    expect.soft(rpc).not.toHaveBeenCalled();
    expect.soft(liveGeneration()).toBe(baselineGeneration);
    expect(args.attempt.signal.aborted).toBe(true);
    await expect(runIngestionMutation(args.attempt, rpc, "heartbeat_ingestion_job")).rejects.toThrow("lease_lost");
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["standard", "request"],
    ["standard", "plan"],
    ["standard", "member"],
    ["legacy", "request"],
    ["legacy", "plan"],
    ["legacy", "member"],
  ] as const)("refuses a lone shadow %s/%s marker", async (operation, marker) => {
    const { args, rpc } = fixture("standard");
    if (operation === "legacy") delete args.job.operation;
    if (marker === "request") args.job.requested_generation_id = candidateGeneration;
    if (marker === "plan") args.job.shadow_plan_digest = planDigest;
    if (marker === "member") args.shadowMember = fixture("shadow_reindex").args.shadowMember;

    await expect(writeIngestionCoreGeneration(args)).rejects.toThrow("shadow_generation_identity_invalid");

    expect(rpc).not.toHaveBeenCalled();
    expect(args.attempt.signal.aborted).toBe(true);
  });

  it("validates the actual Fence after an earlier queued handoff before dispatching shadow pages", async () => {
    const { args, rpc, originalFence } = fixture("shadow_reindex");
    let release!: () => void;
    let entered!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const earlierCommit = runIngestionMutation(
      args.attempt,
      async () => {
        entered();
        await blocked;
        return {
          data: { ok: true, fence: { ...originalFence, expected_generation_id: differentId } },
          error: null,
        };
      },
      "commit_document_index_generation",
      { p_generation: differentId },
    );
    await started;
    const queuedCore = writeIngestionCoreGeneration(args);
    const refusal = expect(queuedCore).rejects.toThrow("shadow_generation_identity_invalid");
    release();

    await earlierCommit;
    await refusal;

    expect(rpc).not.toHaveBeenCalled();
    expect(args.attempt.signal.aborted).toBe(true);
  });

  it("refuses a claim changed while its core persistence is queued", async () => {
    const { args, rpc, liveGeneration } = fixture("shadow_reindex");
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const earlierWork = args.attempt.serialize(() => blocked);
    const queuedCore = writeIngestionCoreGeneration(args);
    const refusal = expect(queuedCore).rejects.toThrow("shadow_generation_identity_invalid");
    args.job.lease_token = differentId;
    args.shadowMember!.first_lease_token = differentId;
    release();

    await earlierWork;
    await refusal;

    expect(rpc).not.toHaveBeenCalled();
    expect(liveGeneration()).toBe(baselineGeneration);
    expect(args.attempt.signal.aborted).toBe(true);
  });
});

describe("actual shadow producer declaration transport", () => {
  type DeclareArgs = Parameters<typeof declareIngestionShadowProducer>[0];
  type Fault = "none" | "replay" | "returned error" | "rejected request" | "malformed acknowledgment" |
    "negative acknowledgment" | "wrong revision" | "stale revision" | "cancel after commit";
  function declarationFixture(fault: Fault = "none") {
    const fence = { job_kind: "node" as const, job_id: "44444444-4444-4444-8444-444444444444",
      document_id: "55555555-5555-4555-8555-555555555555", worker_id: "synthetic-worker",
      lease_token: "66666666-6666-4666-8666-666666666666", expected_generation_id: "11111111-1111-4111-8111-111111111111",
      authority_digest: `sha256:${"a".repeat(64)}` };
    const binding: DeclareArgs["reservation"]["binding"] = { tag: "candidate", source: { version: 1,
      originDigest: `sha256:${"b".repeat(64)}`, executionProfileDigest: `sha256:${"c".repeat(64)}`,
      documentId: fence.document_id, ownerId: null, contentHash: `sha256:${"d".repeat(64)}`,
      authorityDigest: fence.authority_digest, sourcePolicyVersion: "synthetic-policy-v1", manualAliasIds: [],
      baselineGenerationId: fence.expected_generation_id, source: { tag: "document_owned" } },
      candidateGenerationId: "22222222-2222-4222-8222-222222222222", jobId: fence.job_id,
      firstLeaseToken: fence.lease_token, artifactGenerationId: null };
    const batch: DeclareArgs["batch"] = { groupKey: "enrichment", families: ["generated_labels", "summary"],
      artifactGenerationId: null, producerVersion: "rag-deep-memory-v1",
      units: [{ family: "summary", key: "singleton", output: { originalText: "Complete synthetic producer output\nwith exact Unicode é",
        source_chunk_ids: ["77777777-7777-4777-8777-777777777777"], partialEvidence: [1, null, "retained"] } }] };
    const attempt = new IngestionAttempt(fence);
    const expected = prepareShadowProducerDeclarationV1(binding, 4, batch);
    // This models only the owning inventory transaction, not SQL execution or
    // actual durability. The original transport body supplies the retained bytes.
    const durableDeclarations: unknown[] = fault === "replay" ? [structuredClone(expected.declarations)] : [];
    const readControlRevision = vi.fn(async () => 4);
    const rpc = vi.fn(async (name: string, payload: Record<string, unknown>) => {
      expect(name).toBe("write_shadow_generation_inventory");
      expect(payload).toEqual({ p_fence: fence, p_generation: binding.candidateGenerationId,
        p_declarations: expected.declarations, p_dispositions: [] });
      if (fault === "stale revision") return { data: null, error: { message: "invalid_shadow_inventory_write" } };
      if (fault !== "replay") durableDeclarations.push(structuredClone(payload.p_declarations));
      if (fault === "returned error") return { data: null, error: { message: "synthetic response lost after commit" } };
      if (fault === "rejected request") throw new Error("synthetic connection lost after commit");
      if (fault === "malformed acknowledgment") return { data: { ok: true }, error: null };
      if (fault === "cancel after commit") attempt.cancel();
      return { data: { ok: fault !== "negative acknowledgment",
        kind: fault === "replay" ? "unchanged" : "inventory_written",
        control_revision: fault === "wrong revision" ? 6 : fault === "replay" ? 4 : 5, terminal_acceptance: "unavailable" }, error: null };
    });
    const args: DeclareArgs = { attempt, reservation: { binding }, batch, readControlRevision, rpc };
    return { args, expected, durableDeclarations, fence, rpc, readControlRevision };
  }
  describe("U04 control-repair native producer capture", () => {
    it("retains the prior claim checkpoint before a later declaration can mutate its source", async () => {
      const { args } = declarationFixture();
      const checkpoint = { controlRevision: 4, ownNodeJobs: [{ id: args.reservation.binding.jobId, stage: "claimed" }], ownStages: [] };
      const original = structuredClone(checkpoint);
      let prepared: ReturnType<typeof prepareShadowProducerDeclarationV1> | undefined;
      const shadow = { binding: args.reservation.binding, recordFailure: unexpectedShadowFailure, declareBatch: async (batch: DeclareArgs["batch"]) => {
        prepared = prepareShadowProducerDeclarationV1(args.reservation.binding, 4, batch);
        checkpoint.controlRevision = 5; checkpoint.ownNodeJobs[0]!.stage = "downloading";
        return prepared.outputManifestEnvelope;
      } };
      await declareIngestionShadowClaimControl({ attempt: args.attempt, shadow, controlSnapshot: checkpoint,
        producerVersion: "rag-deep-memory-v1" });
      const unit = JSON.parse(prepared!.outputManifestEnvelope.canonicalPayload).units[0];
      expect(unit.family).toBe("attempt_control"); expect(unit.key).toBe(shadow.binding.jobId);
      expect(readShadowProducerInputV1(JSON.parse(unit.output.canonicalPayload)).nativeInput).toEqual(original);
      expect(prepared!.declarations.units[0]!.required).toBe(true);
      expect(args.attempt.signal.aborted).toBe(false);
    });
    it("retains all actual repair inputs and returns the same decision despite later source mutation", async () => {
      const { args } = declarationFixture();
      const issues = [{ family: "index_units", message: "Exact failed write\né", detail: undefined }];
      const original = structuredClone(issues);
      let prepared: ReturnType<typeof prepareShadowProducerDeclarationV1> | undefined;
      const shadow = { binding: args.reservation.binding, recordFailure: unexpectedShadowFailure, declareBatch: async (batch: DeclareArgs["batch"]) => {
        prepared = prepareShadowProducerDeclarationV1(args.reservation.binding, 4, batch);
        issues[0]!.message = "changed after capture"; issues.length = 0;
        return prepared.outputManifestEnvelope;
      } };
      const input = { enrichmentStatus: "completed", enrichmentErrorMessage: null, optionalIssueCount: 1 };
      const decision = await retainIngestionShadowRepairDecision({ attempt: args.attempt, shadow,
        producerVersion: "rag-deep-memory-v1", enrichmentStatus: input.enrichmentStatus,
        enrichmentErrorMessage: input.enrichmentErrorMessage, optionalIndexWriteIssues: issues });
      const unit = JSON.parse(prepared!.outputManifestEnvelope.canonicalPayload).units[0];
      expect(unit.family).toBe("repair_audit_inputs"); expect(unit.key).toBe("enrichment-repair");
      expect(readShadowProducerInputV1(JSON.parse(unit.output.canonicalPayload)).nativeInput)
        .toEqual({ input, optionalIndexWriteIssues: original, decision: enrichmentRepairDecision(input) });
      expect(decision).toEqual(enrichmentRepairDecision(input));
      expect(prepared!.declarations.units[0]!.required).toBe(true);
    });
    it.each(["control", "repair"] as const)("cancels %s capture on a failed durable declaration", async kind => {
      const { args } = declarationFixture();
      const declareBatch = vi.fn(async () => { throw new Error("declaration refused"); });
      const common = { attempt: args.attempt, shadow: { binding: args.reservation.binding, declareBatch, recordFailure: unexpectedShadowFailure },
        producerVersion: "rag-deep-memory-v1" };
      const action = kind === "control"
        ? declareIngestionShadowClaimControl({ ...common, controlSnapshot: { controlRevision: 4, ownNodeJobs: [], ownStages: [] } })
        : retainIngestionShadowRepairDecision({ ...common, enrichmentStatus: "completed",
          enrichmentErrorMessage: null, optionalIndexWriteIssues: [] });
      await expect(action).rejects.toThrow("declaration refused");
      expect(args.attempt.signal.aborted).toBe(true); expect(declareBatch).toHaveBeenCalledTimes(1);
    });
  });
  function projectionFixture(kind: "quality" | "worker", fault = "none") {
    const { args, fence } = declarationFixture();
    const binding = args.reservation.binding;
    const quality = { document_id: fence.document_id, owner_id: null, issues: ["original issue"], metrics: { count: 1 } };
    const metadata = { index_generation_id: binding.candidateGenerationId, enrichment_error: null, index_quality_issues: ["original issue"] };
    const counts = { page_count: 1, chunk_count: 2, image_count: 0, status: "indexed", error_message: null };
    let declared: ReturnType<typeof prepareShadowProducerDeclarationV1> | undefined;
    const shadow: NonNullable<Parameters<typeof persistIngestionQuality>[0]["shadow"]> = { binding, recordFailure: unexpectedShadowFailure, declareBatch: async batch => {
      declared = prepareShadowProducerDeclarationV1(binding, 4, batch);
      quality.issues[0] = "changed after declaration";
      metadata.index_quality_issues[0] = "changed after declaration";
      counts.chunk_count = 99;
      if (fault === "declaration") throw new Error("declaration refused");
      if (fault === "cancelled") args.attempt.cancel();
      return declared.outputManifestEnvelope;
    } };
    const rpc = vi.fn(async (name: string, payload: Record<string, unknown>) => {
      expect(name).toBe(kind === "quality" ? "persist_shadow_quality_projection" : "persist_shadow_worker_projection");
      expect(payload.p_fence).toEqual(fence);
      expect(payload.p_generation).toBe(binding.candidateGenerationId);
      expect(payload.p_output_manifest).toEqual(declared!.outputManifestEnvelope);
      const native = JSON.parse(declared!.outputManifestEnvelope.canonicalPayload).units[0].output;
      if (kind === "quality") expect(payload.p_quality).toEqual(native);
      else {
        expect(payload.p_metadata).toEqual(native.worker_metadata);
        expect(payload.p_counts).toEqual(native.document_counts);
      }
      return { data: fault === "acknowledgment" ? { ok: true } : {
        ok: fault !== "negative acknowledgment",
        kind: kind === "quality" ? "quality_projected" : "worker_projected",
        projection_digest: `sha256:${"e".repeat(64)}`,
      }, error: null };
    });
    const common = { attempt: args.attempt, rpc, shadow, producerVersion: "rag-deep-memory-v1" };
    const run = () => kind === "quality" ? persistIngestionQuality({ ...common, quality }) :
      persistIngestionShadowWorkerProjection({ ...common, metadata, counts });
    return { run, rpc, attempt: args.attempt, quality, metadata, counts, fence };
  }

  it.each(["quality", "worker"] as const)("retains the exact %s projection snapshot across declaration", async kind => {
    const f = projectionFixture(kind);
    await f.run();
    expect(f.rpc).toHaveBeenCalledOnce();
    const payload = f.rpc.mock.calls[0]![1];
    if (kind === "quality") expect(payload.p_quality).toMatchObject({ issues: ["original issue"] });
    else {
      expect(payload.p_metadata).toMatchObject({ enrichment_error: null, index_quality_issues: ["original issue"] });
      expect(Object.hasOwn(payload.p_metadata as object, "completion_gate_missing")).toBe(false);
      expect(payload.p_counts).toMatchObject({ chunk_count: 2 });
    }
    expect(f.attempt.fence).toEqual(f.fence);
    expect(f.attempt.signal.aborted).toBe(false);
  });

  it.each([
    ["quality", "declaration"], ["quality", "cancelled"], ["quality", "acknowledgment"],
    ["quality", "negative acknowledgment"],
    ["worker", "declaration"], ["worker", "cancelled"], ["worker", "acknowledgment"],
    ["worker", "negative acknowledgment"],
  ] as const)("stops %s projection after %s failure without later live effects", async (kind, fault) => {
    const f = projectionFixture(kind, fault);
    await expect(f.run()).rejects.toThrow();
    expect(f.rpc).toHaveBeenCalledTimes(
      fault === "acknowledgment" || fault === "negative acknowledgment" ? 1 : 0,
    );
    expect(f.attempt.signal.aborted).toBe(true);
    const later = vi.fn(async () => ({ data: { ok: true }, error: null }));
    await expect(runIngestionMutation(f.attempt, later, "complete_ingestion_job")).rejects.toThrow();
    expect(later).not.toHaveBeenCalled();
  });

  it("preserves the ordinary quality RPC and original payload", async () => {
    const { args, fence } = declarationFixture();
    const quality = { document_id: fence.document_id, quality_score: 0.5 };
    const rpc = vi.fn(async () => ({ data: { ok: true }, error: null }));
    await persistIngestionQuality({ attempt: args.attempt, rpc, quality, producerVersion: "rag-deep-memory-v1" });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("persist_ingestion_index_quality", { p_fence: fence, p_quality: quality });
    expect(args.attempt.fence).toEqual(fence);
  });

  async function expectCancelledWithoutFurtherEffects(fixture: ReturnType<typeof declarationFixture>) {
    expect(fixture.args.attempt.signal.aborted).toBe(true);
    const later = vi.fn(async () => ({ data: { ok: true }, error: null }));
    await expect(runIngestionMutation(fixture.args.attempt, later, "persist_shadow_summary_projection")).rejects.toThrow("lease_lost");
    await expect(runIngestionMutation(fixture.args.attempt, later, "complete_ingestion_job")).rejects.toThrow("lease_lost");
    expect(later).not.toHaveBeenCalled();
  }
  it("persists the declared snapshot across declaration and batch awaits", async () => {
    const fixture = declarationFixture();
    const sourceRows = Array.from({ length: 51 }, (_, index) => ({
      id: `row-${index}`, content: `original-${index}`, retrieval_synopsis: undefined,
      metadata: { exact: " café\n " },
    }));
    const originalRows = structuredClone(sourceRows);
    const pending = { chunks: sourceRows, table_facts: [], embedding_fields: [], index_units: [] };
    const declareBatch = vi.fn(async (batch: DeclareArgs["batch"]) => {
      const prepared = prepareShadowProducerDeclarationV1(fixture.args.reservation.binding, 4, batch);
      sourceRows[0]!.content = "changed during declaration";
      sourceRows[0]!.metadata.exact = "changed nested value";
      pending.chunks.push({ ...sourceRows[0]!, id: "undeclared" });
      return prepared.outputManifestEnvelope;
    });
    const writes: unknown[][] = [];
    const rpc = vi.fn(async (name: string, payload: Record<string, unknown>) => {
      expect(name).toBe("write_ingestion_base_artifacts");
      expect(payload.p_generation).toBe(fixture.args.reservation.binding.candidateGenerationId);
      writes.push(structuredClone(payload.p_chunks as unknown[]));
      sourceRows[50]!.content = "changed during first batch";
      return { data: { ok: true }, error: null };
    });
    const persisted = await persistIngestionShadowCoreFamily({
      attempt: fixture.args.attempt, shadow: { binding: fixture.args.reservation.binding, declareBatch, recordFailure: unexpectedShadowFailure },
      pending, family: "chunks", producerVersion: "synthetic-core-v1", rpc,
    });
    expect(writes.map(batch => batch.length)).toEqual([50, 1]);
    expect(writes.flat()).toEqual(originalRows);
    expect(persisted).toEqual(originalRows);
    expect(Object.hasOwn(persisted[0]!, "retrieval_synopsis")).toBe(true);
    expect(declareBatch.mock.calls[0]![0].units).toHaveLength(51);
    expect(declareBatch.mock.calls[0]![0].units[0]!.output).toMatchObject({
      input: { content: "original-0", metadata: { exact: " café\n " } },
      ownUndefinedPaths: [["retrieval_synopsis"]],
    });
  });

  it("refuses a negative core-family acknowledgment and cancels", async () => {
    const fixture = declarationFixture();
    const pending = { chunks: [{ id: "row-1", content: "complete row" }],
      table_facts: [], embedding_fields: [], index_units: [] };
    const declareBatch = vi.fn(async (batch: DeclareArgs["batch"]) =>
      prepareShadowProducerDeclarationV1(fixture.args.reservation.binding, 4, batch).outputManifestEnvelope);
    const rpc = vi.fn(async () => ({ data: { ok: false }, error: null }));

    await expect(persistIngestionShadowCoreFamily({
      attempt: fixture.args.attempt,
      shadow: { binding: fixture.args.reservation.binding, declareBatch, recordFailure: unexpectedShadowFailure },
      pending,
      family: "chunks",
      producerVersion: "synthetic-core-v1",
      rpc,
    })).rejects.toThrow("ingestion_rpc_invalid");

    expect(fixture.args.attempt.signal.aborted).toBe(true);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("refuses a negative base-artifact acknowledgment after immutable image upload", async () => {
    const fixture = declarationFixture();
    const generation = fixture.args.reservation.binding.candidateGenerationId;
    const storagePath =
      `${fixture.fence.document_id}/${fixture.fence.lease_token}/${generation}/77777777-7777-4777-8777-777777777777.png`;
    const rpc = vi.fn(async () => ({ data: { ok: false }, error: null }));
    const upload = vi.fn(async () => ({ error: null }));

    await expect(persistIngestionImage({
      attempt: fixture.args.attempt,
      generation,
      extension: "png",
      preparedStoragePath: storagePath,
      row: { id: "image-1", document_id: fixture.fence.document_id },
      rpc,
      upload,
    })).rejects.toThrow("ingestion_rpc_invalid");

    expect(upload).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(fixture.args.attempt.signal.aborted).toBe(true);
  });
  it.each(["none", "replay"] as const)("retains the complete declared batch with an exact %s acknowledgment and unchanged G0", async fault => {
    const fixture = declarationFixture(fault);
    const original = encodeShadowNodeJsonCanonicalPayload(fixture.args.batch);
    const output = await declareIngestionShadowProducer(fixture.args);
    expect(output).toEqual(fixture.expected.outputManifestEnvelope);
    expect(fixture.durableDeclarations).toEqual([fixture.expected.declarations]);
    expect(encodeShadowNodeJsonCanonicalPayload(fixture.args.batch)).toBe(original);
    expect(fixture.args.attempt.fence).toEqual(fixture.fence);
    expect(fixture.readControlRevision).toHaveBeenCalledTimes(1);
    expect(fixture.rpc).toHaveBeenCalledTimes(1);
  });
  it.each(["returned error", "rejected request", "malformed acknowledgment", "negative acknowledgment",
    "wrong revision", "cancel after commit"] as const)(
    "cancels on %s while retaining the complete modeled committed declaration", async fault => {
      const fixture = declarationFixture(fault);
      await expect(declareIngestionShadowProducer(fixture.args)).rejects.toThrow();
      await expectCancelledWithoutFurtherEffects(fixture);
      expect(fixture.durableDeclarations).toEqual([fixture.expected.declarations]);
      expect(fixture.rpc).toHaveBeenCalledTimes(1);
    },
  );
  it("keeps pre-commit stale-revision refusal incomplete with unavailable new-output retention", async () => {
    const fixture = declarationFixture("stale revision");
    await expect(declareIngestionShadowProducer(fixture.args)).rejects.toThrow("invalid_shadow_inventory_write");
    await expectCancelledWithoutFurtherEffects(fixture);
    expect(fixture.durableDeclarations).toEqual([]);
    expect(fixture.rpc).toHaveBeenCalledTimes(1);
  });
  it("rejects a different actual Fence before reading revision or persisting a declaration", async () => {
    const fixture = declarationFixture();
    fixture.args.attempt = new IngestionAttempt({ ...fixture.fence, lease_token: "88888888-8888-4888-8888-888888888888" });
    await expect(declareIngestionShadowProducer(fixture.args)).rejects.toThrow("shadow_generation_identity_invalid");
    await expectCancelledWithoutFurtherEffects(fixture);
    expect(fixture.readControlRevision).not.toHaveBeenCalled();
    expect(fixture.rpc).not.toHaveBeenCalled();
    expect(fixture.durableDeclarations).toEqual([]);
  });
  it("honours cancellation during the revision read without a post-cancellation retention writer", async () => {
    const fixture = declarationFixture();
    fixture.args.readControlRevision = async () => { fixture.args.attempt.cancel(); return 4; };
    await expect(declareIngestionShadowProducer(fixture.args)).rejects.toThrow("lease_lost");
    await expectCancelledWithoutFurtherEffects(fixture);
    expect(fixture.rpc).not.toHaveBeenCalled();
    expect(fixture.durableDeclarations).toEqual([]);
  });
});
