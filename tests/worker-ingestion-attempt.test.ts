import { describe, expect, it, vi } from "vitest";
import { IngestionAttempt, type IngestionFence } from "../supabase/functions/_shared/ingestion-attempt";
import {
  registerClaimedJobAttempt,
  persistIngestionImage,
  runIngestionMutation,
  runIngestionStrictCompletion,
  writeIngestionTableFacts,
} from "../worker/behavior";

const generation = "88888888-8888-4888-8888-888888888888";
const fence: IngestionFence = {
  job_kind: "node",
  job_id: "11111111-1111-4111-8111-111111111111",
  document_id: "22222222-2222-4222-8222-222222222222",
  worker_id: "synthetic-worker",
  lease_token: "33333333-3333-4333-8333-333333333333",
  expected_generation_id: null,
  authority_digest: `sha256:${"a".repeat(64)}`,
};

function claimedJob(token = fence.lease_token) {
  return {
    id: fence.job_id,
    document_id: fence.document_id,
    locked_by: fence.worker_id,
    lease_token: token,
    lease_expected_generation_id: null,
    lease_write_generation_id: generation,
    lease_authority_digest: fence.authority_digest,
  };
}

describe("Node claimed attempt ownership", () => {
  it("registers one shared attempt in both maps without prematurely activating the reserved generation", () => {
    const jobs = new Map<string, IngestionAttempt>();
    const documents = new Map<string, IngestionAttempt>();
    const attempt = registerClaimedJobAttempt(claimedJob(), jobs, documents);
    expect(jobs.get(fence.job_id)).toBe(attempt);
    expect(documents.get(fence.document_id)).toBe(attempt);
    expect(attempt.fence).toEqual(fence);
  });

  it("cancels the previous owner when a replacement claim is registered", async () => {
    const jobs = new Map<string, IngestionAttempt>();
    const documents = new Map<string, IngestionAttempt>();
    const old = registerClaimedJobAttempt(claimedJob(), jobs, documents);
    const replacement = registerClaimedJobAttempt(claimedJob("44444444-4444-4444-8444-444444444444"), jobs, documents);
    const rpc = vi.fn();
    await expect(runIngestionMutation(old, rpc, "write_ingestion_base_artifacts")).rejects.toMatchObject({
      code: "lease_lost",
    });
    expect(rpc).not.toHaveBeenCalled();
    expect(documents.get(fence.document_id)).toBe(replacement);
  });
});

describe("Node mutation handoff and cancellation", () => {
  it.each(["complete_ingestion_job", "fail_or_retry_ingestion_job"])(
    "revokes authority within serialized %s success before a queued heartbeat dispatches",
    async (name) => {
      const attempt = new IngestionAttempt({ ...fence, expected_generation_id: generation });
      const rpc = vi.fn().mockResolvedValue({ data: { ok: true }, error: null });
      const terminal = runIngestionMutation(attempt, rpc, name);
      const heartbeat = runIngestionMutation(attempt, rpc, "heartbeat_ingestion_job");
      await expect(terminal).resolves.toMatchObject({ ok: true });
      await expect(heartbeat).rejects.toMatchObject({ code: "lease_lost" });
      expect(attempt.signal.aborted).toBe(true);
      expect(rpc).toHaveBeenCalledTimes(1);
    },
  );
  it("captures the heartbeat fence after the serialized generation commit response", async () => {
    const attempt = new IngestionAttempt(fence);
    let release!: (value: { data: unknown; error: null }) => void;
    const rpc = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      )
      .mockResolvedValueOnce({ data: { ok: true }, error: null });
    const committed = runIngestionMutation(attempt, rpc, "commit_document_index_generation", {
      p_generation: generation,
    });
    await Promise.resolve();
    const heartbeat = runIngestionMutation(attempt, rpc, "heartbeat_ingestion_job");
    expect(rpc).toHaveBeenCalledTimes(1);
    release({ data: { ok: true, fence: { ...fence, expected_generation_id: generation } }, error: null });
    await committed;
    await heartbeat;
    expect(rpc.mock.calls[1][1].p_fence.expected_generation_id).toBe(generation);
  });

  it("stops queued writes after an uncertain persistence result", async () => {
    const attempt = new IngestionAttempt(fence);
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "synthetic transport failure" } });
    const first = runIngestionMutation(attempt, rpc, "persist_ingestion_index_quality");
    const late = runIngestionMutation(attempt, rpc, "patch_ingestion_document_state");
    await expect(first).rejects.toThrow("synthetic transport failure");
    await expect(late).rejects.toMatchObject({ code: "lease_lost" });
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});

describe("Node strict completion object contract", () => {
  it("cancels after a transport failure and does not authorize a repair write", async () => {
    const attempt = new IngestionAttempt({ ...fence, expected_generation_id: generation });
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "synthetic persistence uncertainty" } });
    await expect(runIngestionStrictCompletion(attempt, rpc, {})).rejects.toThrow("synthetic persistence uncertainty");
    expect(attempt.signal.aborted).toBe(true);
    await expect(runIngestionMutation(attempt, rpc, "patch_ingestion_document_state")).rejects.toMatchObject({
      code: "lease_lost",
    });
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it("accepts the new object result rather than requiring a legacy SETOF array", async () => {
    const attempt = new IngestionAttempt({ ...fence, expected_generation_id: generation });
    const rpc = vi.fn().mockResolvedValue({ data: { ok: true }, error: null });
    await expect(runIngestionStrictCompletion(attempt, rpc, { p_stage: "indexed" })).resolves.toEqual({
      completed: true,
      missing: [],
      message: null,
    });
    expect(rpc.mock.calls[0]).toEqual([
      "complete_strict_enrichment_job",
      { p_stage: "indexed", p_fence: { ...fence, expected_generation_id: generation } },
    ]);
    expect(attempt.signal.aborted).toBe(true);
  });

  it("revokes strict success before a heartbeat queued behind completion can dispatch", async () => {
    const attempt = new IngestionAttempt({ ...fence, expected_generation_id: generation });
    const rpc = vi.fn().mockResolvedValue({ data: { ok: true }, error: null });
    const terminal = runIngestionStrictCompletion(attempt, rpc, {});
    const heartbeat = runIngestionMutation(attempt, rpc, "heartbeat_ingestion_job");
    await expect(terminal).resolves.toMatchObject({ completed: true });
    await expect(heartbeat).rejects.toMatchObject({ code: "lease_lost" });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("keeps authority usable on an explicit gate refusal so repair metadata can be written", async () => {
    const attempt = new IngestionAttempt({ ...fence, expected_generation_id: generation });
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        data: { ok: false, reason: "completion_gate_blocked", missing: ["summary"] },
        error: null,
      })
      .mockResolvedValueOnce({ data: { ok: true }, error: null });
    await expect(runIngestionStrictCompletion(attempt, rpc, {})).resolves.toMatchObject({
      completed: false,
      missing: ["summary"],
    });
    await runIngestionMutation(attempt, rpc, "patch_ingestion_document_state", {
      p_metadata: { enrichment_status: "pending" },
    });
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it.each([
    [{ ok: false, reason: "lease_lost" }, null, "lease_lost"],
    [[], null, "ingestion_rpc_invalid"],
    [{}, null, "ingestion_rpc_invalid"],
    [{ ok: true, status: "failed" }, null, "ingestion_rpc_invalid"],
    [{ ok: true, reason: "lease_lost" }, null, "ingestion_rpc_invalid"],
    [{ ok: true, unexpected: true }, null, "ingestion_rpc_invalid"],
    [{ ok: false, reason: "completion_gate_blocked", missing: "summary" }, null, "ingestion_rpc_invalid"],
  ])("cancels on unusable strict result %j", async (data, error, code) => {
    const attempt = new IngestionAttempt({ ...fence, expected_generation_id: generation });
    const rpc = vi.fn().mockResolvedValue({ data, error });
    await expect(runIngestionStrictCompletion(attempt, rpc, {})).rejects.toMatchObject({ code });
    expect(attempt.signal.aborted).toBe(true);
    await expect(runIngestionMutation(attempt, rpc, "complete_ingestion_job")).rejects.toMatchObject({
      code: "lease_lost",
    });
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});

describe("Node table-fact RPC limits", () => {
  it("publishes all 800 facts from two dense image tables in batches no larger than 500", async () => {
    const attempt = new IngestionAttempt(fence);
    const facts = Array.from({ length: 800 }, (_, index) => ({
      id: `synthetic-fact-${index}`,
      source_image_id: index < 400 ? "image-one" : "image-two",
    }));
    const rpc = vi.fn().mockResolvedValue({ data: { ok: true }, error: null });
    await writeIngestionTableFacts(attempt, rpc, generation, facts);
    expect(rpc).toHaveBeenCalledTimes(2);
    const published = rpc.mock.calls.flatMap(([name, payload]) => {
      expect(name).toBe("write_ingestion_base_artifacts");
      expect(payload.p_generation).toBe(generation);
      expect(payload.p_fence).toEqual(fence);
      expect(payload.p_table_facts.length).toBeLessThanOrEqual(500);
      expect(payload.p_chunks).toEqual([]);
      expect(payload.p_images).toEqual([]);
      expect(payload.p_embedding_fields).toEqual([]);
      expect(payload.p_index_units).toEqual([]);
      return payload.p_table_facts;
    });
    expect(published).toEqual(facts);
  });

  it("stops later fact batches when the first persistence result is uncertain", async () => {
    const attempt = new IngestionAttempt(fence);
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "synthetic uncertain first batch" } });
    await expect(
      writeIngestionTableFacts(
        attempt,
        rpc,
        generation,
        Array.from({ length: 800 }, () => ({ synthetic: true })),
      ),
    ).rejects.toThrow("synthetic uncertain first batch");
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(attempt.signal.aborted).toBe(true);
  });
});

describe("Node late image publication", () => {
  it("retains the uncertain upload and prevents publication after cancellation", async () => {
    const attempt = new IngestionAttempt(fence);
    const storagePath = `${fence.document_id}/${fence.lease_token}/${generation}/55555555-5555-4555-8555-555555555555.png`;
    const rpc = vi.fn().mockResolvedValue({ data: { ok: true, storage_path: storagePath }, error: null });
    let release!: () => void;
    const upload = vi.fn(
      () =>
        new Promise<{ error: null }>((resolve) => {
          release = () => resolve({ error: null });
        }),
    );
    const publication = persistIngestionImage({
      attempt,
      generation,
      extension: "png",
      row: { id: "synthetic-image" },
      rpc,
      upload,
    });
    await vi.waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    attempt.cancel();
    release();
    await expect(publication).rejects.toMatchObject({ code: "lease_lost" });
    expect(upload).toHaveBeenCalledWith(storagePath, { upsert: false });
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
