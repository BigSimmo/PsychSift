import { describe, expect, it, vi } from "vitest";
import { IngestionAttempt } from "../supabase/functions/_shared/ingestion-attempt";
import {
  parseEdgeIngestionClaim,
  parseEdgeCompletionResult,
  runEdgeIngestionMutation,
  runEdgeIngestionTransport,
  ensureEdgeSummaryProjection,
} from "../supabase/functions/indexing-v3-agent/behavior";
import {
  buildSourceAnchoredFallbackPayload,
  normalizeSourceAnchoredSummary,
  projectSourceAnchoredLabels,
} from "../supabase/functions/_shared/source-anchored-summary";

const documentId = "11111111-1111-4111-8111-111111111111";
const generation = "22222222-2222-4222-8222-222222222222";
const jobId = "33333333-3333-4333-8333-333333333333";
const token = "44444444-4444-4444-8444-444444444444";
const now = Date.parse("2026-09-23T12:00:00.000Z");
const claim = () => ({
  id: jobId,
  document_id: documentId,
  job_kind: "indexing_v3",
  locked_by: "edge-worker",
  lease_token: token,
  lease_expected_generation_id: generation,
  lease_write_generation_id: generation,
  lease_authority_digest: `sha256:${"a".repeat(64)}`,
  lease_expires_at: "2026-09-23T12:45:00.000Z",
  lease_duration_seconds: 2700,
  documents: { id: documentId, index_generation_id: generation, metadata: {} },
});

describe("Edge source-anchored summary selection", () => {
  const authority = () => ({
    documentId,
    indexGenerationId: generation,
    expectedStructuredModel: "test-structured-model",
    expectedStructuredModelVersion: "rag-deep-memory-v1",
    selectedChunks: [{ id: jobId, page_number: 1, index_generation_id: generation }],
    selectedImages: [],
  });

  it("writes a source-only provisional fallback with no generated labels", async () => {
    const persist = vi.fn(async () => ({ ok: true }));
    const payload = await ensureEdgeSummaryProjection({ authority: authority(), existing: null, labels: [], persist });
    expect(payload.summary_kind).toBe("heuristic_fallback");
    expect(payload.index_generation_id).toBe(generation);
    expect(payload.source_chunk_ids).toEqual([jobId]);
    expect(payload.labels).toEqual([]);
    expect(persist).toHaveBeenCalledOnce();
    expect(persist).toHaveBeenCalledWith(payload);
  });

  it("does not silently promote a previously persisted provisional summary", async () => {
    const fallback = buildSourceAnchoredFallbackPayload(authority());
    const persist = vi.fn(async () => ({ ok: true }));
    const payload = await ensureEdgeSummaryProjection({
      authority: authority(),
      labels: [],
      persist,
      existing: {
        ...fallback,
        metadata: { source_anchored_summary_v1: fallback, source_anchored_summary_projection_complete_v1: false },
      },
    });
    expect(payload.summary_kind).toBe("heuristic_fallback");
    expect(payload.labels).toEqual([]);
  });

  it("rejects generation-mismatched selected source rows before publication", async () => {
    const persist = vi.fn(async () => ({ ok: true }));
    await expect(
      ensureEdgeSummaryProjection({
        authority: { ...authority(), selectedChunks: [{ id: jobId, page_number: 1, index_generation_id: token }] },
        existing: null,
        labels: [],
        persist,
      }),
    ).rejects.toThrow();
    expect(persist).not.toHaveBeenCalled();
  });

  it("propagates persistence uncertainty rather than returning an unpersisted summary", async () => {
    await expect(
      ensureEdgeSummaryProjection({
        authority: authority(),
        existing: null,
        labels: [],
        persist: async () => {
          throw new Error("persistence uncertain");
        },
      }),
    ).rejects.toThrow("persistence uncertain");
  });

  const corpus = () => ({
    ...authority(),
    selectedChunks: Array.from({ length: 37 }, (_, index) => ({
      id: `55555555-5555-4555-8555-${String(index + 1).padStart(12, "0")}`,
      page_number: index + 1,
      index_generation_id: generation,
    })),
    selectedImages: Array.from({ length: 65 }, (_, index) => ({
      id: `66666666-6666-4666-8666-${String(index + 1).padStart(12, "0")}`,
      page_number: index + 1,
      index_generation_id: generation,
    })),
  });

  it("bounds a 37-chunk and 65-image corpus before constructing its provisional fallback", async () => {
    const sources = corpus();
    const persist = vi.fn(async () => ({ ok: true }));
    const payload = await ensureEdgeSummaryProjection({ authority: sources, existing: null, labels: [], persist });
    expect(payload.summary_kind).toBe("heuristic_fallback");
    expect(payload.source_chunk_ids).toEqual(sources.selectedChunks.slice(0, 36).map((row) => row.id));
    expect(payload.source_image_ids).toEqual(sources.selectedImages.slice(0, 64).map((row) => row.id));
    expect(payload.labels).toEqual([]);
    expect(persist).toHaveBeenCalledOnce();
  });

  it("retains valid persisted structured anchors and order from a larger exact-generation corpus", async () => {
    const sources = corpus();
    const selected = {
      ...sources,
      selectedChunks: [sources.selectedChunks[36], sources.selectedChunks[2]],
      selectedImages: [sources.selectedImages[64], sources.selectedImages[0]],
    };
    const fallback = buildSourceAnchoredFallbackPayload(selected, { generatedAt: "2026-09-23T12:00:00.000Z" });
    const action = "Synthetic review occurs every 14 days.";
    const profile = {
      ...fallback.clinical_specifics.profile,
      overview: `- ${action}`,
      source_quality_notes: [],
      key_clinical_actions: [
        {
          text: action,
          source_chunk_ids: [selected.selectedChunks[0].id],
          source_image_ids: [selected.selectedImages[0].id],
          pages: [37, 65],
          evidence_type: "mixed",
          support: "direct",
        },
      ],
    };
    const structured = normalizeSourceAnchoredSummary(
      {
        ...fallback,
        summary_kind: "structured",
        heuristic_fallback: false,
        model: selected.expectedStructuredModel,
        model_version: selected.expectedStructuredModelVersion,
        summary: `- ${action}`,
        clinical_specifics: { ...fallback.clinical_specifics, profile, actions: [action] },
        labels: [{ label: "synthetic review", label_type: "workflow", confidence: 0.9 }],
      },
      selected,
    );
    const existing = {
      ...structured,
      metadata: { source_anchored_summary_v1: structured, source_anchored_summary_projection_complete_v1: true },
    };
    const labels = projectSourceAnchoredLabels(structured).map((label) => ({
      label: label.label,
      label_type: label.label_type,
      confidence: label.confidence,
      metadata: {
        index_generation_id: generation,
        summary_version: structured.summary_version,
        source_chunk_ids: label.source_chunk_ids,
        source_image_ids: label.source_image_ids,
        pages: label.pages,
      },
    }));
    const persist = vi.fn(async () => ({ ok: true }));
    expect(await ensureEdgeSummaryProjection({ authority: sources, existing, labels, persist })).toEqual(structured);
    expect(persist).not.toHaveBeenCalled();
  });
});
const attempt = () => new IngestionAttempt(parseEdgeIngestionClaim(claim(), "edge-worker", now));

describe("Edge ingestion attempt boundary", () => {
  it("binds the actual claim to current document and reserved generation", () => {
    expect(parseEdgeIngestionClaim(claim(), "edge-worker", now)).toEqual({
      job_kind: "indexing_v3",
      job_id: jobId,
      document_id: documentId,
      worker_id: "edge-worker",
      lease_token: token,
      expected_generation_id: generation,
      authority_digest: `sha256:${"a".repeat(64)}`,
    });
  });

  it.each([
    { job_kind: "node" },
    { locked_by: "another-worker" },
    { lease_token: "bad" },
    { id: "bad" },
    { lease_expected_generation_id: null },
    { lease_write_generation_id: token },
    { lease_authority_digest: "bad" },
    { lease_expires_at: "2026-09-23T12:00:00.000Z" },
    { lease_expires_at: "invalid" },
    { lease_duration_seconds: 0 },
    { lease_duration_seconds: 2700.1 },
    { lease_duration_seconds: 86401 },
    { documents: { id: token, index_generation_id: generation, metadata: {} } },
    { documents: { id: documentId, index_generation_id: token, metadata: {} } },
  ])("rejects invalid claim authority before work: %j", (patch) => {
    expect(() => parseEdgeIngestionClaim({ ...claim(), ...patch }, "edge-worker", now)).toThrow();
  });

  it("serializes heartbeat and artifact transport through the same attempt", async () => {
    const current = attempt();
    const order: string[] = [];
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = runEdgeIngestionMutation(current, async (fence) => {
      expect(fence.lease_token).toBe(token);
      order.push("heartbeat-start");
      await blocked;
      order.push("heartbeat-finish");
      return { ok: true };
    });
    const second = runEdgeIngestionMutation(current, async () => {
      order.push("artifact");
      return { ok: true };
    });
    await Promise.resolve();
    expect(order).toEqual(["heartbeat-start"]);
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(["heartbeat-start", "heartbeat-finish", "artifact"]);
  });

  it.each([{ ok: false, reason: "lease_lost" }, undefined, { ok: true, reason: "unexpected" }])(
    "cancels the attempt on stale or malformed persistence and blocks queued writes: %j",
    async (result) => {
      const current = attempt();
      const later = vi.fn(async () => ({ ok: true }));
      await expect(runEdgeIngestionMutation(current, async () => result)).rejects.toThrow();
      await expect(runEdgeIngestionMutation(current, later)).rejects.toThrow();
      expect(later).not.toHaveBeenCalled();
      expect(current.signal.aborted).toBe(true);
    },
  );

  it("cancels on uncertain persistence exceptions", async () => {
    const current = attempt();
    await expect(
      runEdgeIngestionMutation(current, async () => {
        throw new Error("connection lost");
      }),
    ).rejects.toThrow("connection lost");
    expect(current.signal.aborted).toBe(true);
  });

  it("keeps an explicit completion gate refusal recoverable under the same fence", async () => {
    const current = attempt();
    const refusal = { ok: false, reason: "completion_gate_blocked", missing: ["sections"] };
    expect(await runEdgeIngestionMutation(current, async () => refusal, true, true)).toEqual(refusal);
    expect(current.signal.aborted).toBe(false);
    await expect(runEdgeIngestionMutation(current, async () => ({ ok: true }))).resolves.toEqual({ ok: true });
  });

  it("blocks queued heartbeat or status dispatch after terminal release", async () => {
    const current = attempt();
    const later = vi.fn(async () => ({ ok: true }));
    const complete = runEdgeIngestionMutation(current, async () => ({ ok: true, status: "completed" }), true, true);
    const heartbeat = runEdgeIngestionMutation(current, later);
    await expect(complete).resolves.toEqual({ ok: true, status: "completed" });
    await expect(heartbeat).rejects.toThrow();
    expect(later).not.toHaveBeenCalled();
  });

  it("passes a combined timeout and attempt signal and rejects late provider responses", async () => {
    const current = attempt();
    const timeout = new AbortController();
    await expect(
      runEdgeIngestionTransport(current, timeout.signal, async (signal) => {
        expect(signal).not.toBe(current.signal);
        expect(signal).not.toBe(timeout.signal);
        current.cancel();
        expect(signal.aborted).toBe(true);
        return "late response";
      }),
    ).rejects.toThrow();
  });

  it("prevents dispatch when timeout already aborted", async () => {
    const current = attempt();
    const timeout = new AbortController();
    timeout.abort();
    const dispatch = vi.fn(async () => "response");
    await expect(runEdgeIngestionTransport(current, timeout.signal, dispatch)).rejects.toThrow();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("accepts only strict successful completion", () => {
    expect(parseEdgeCompletionResult({ ok: true, status: "completed" })).toEqual({
      ok: true,
      status: "completed",
    });
  });

  it.each([
    undefined,
    { ok: true },
    { ok: "true", status: "completed" },
    { ok: false, reason: "completion_gate_blocked", missing: ["sections"] },
    { ok: true, status: "processing" },
    { ok: true, status: "completed", reason: "lease_lost" },
  ])("rejects malformed or contradictory completion: %j", (result) => {
    expect(() => parseEdgeCompletionResult(result)).toThrow();
  });
});
