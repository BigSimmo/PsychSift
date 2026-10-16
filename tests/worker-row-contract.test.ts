import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  WorkerRowShapeError,
  assertClaimedJobRow,
  assertEnrichmentChunkRows,
  assertEnrichmentImageRows,
  partitionClaimedJobRows,
  failRejectedClaimedJobRow,
} from "../worker/row-contracts";

vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

/**
 * A realistic `claim_ingestion_jobs` row. The fenced claim RPC in supabase/schema.sql returns
 * `setof jsonb`: the ingestion_jobs row (including its durable lease fence columns) plus
 * `job_kind` and `documents`; `documents` is `to_jsonb(d.*)`, so the fixture carries the full
 * documents column set including fields the contract leaves unpinned.
 */
function claimedDocuments(overrides: Record<string, unknown> = {}) {
  return {
    id: "3f1a2b6c-1111-4aaa-8bbb-000000000001",
    owner_id: "0b6c9e21-5555-4aaa-8bbb-000000000005",
    title: "RANZCP mood disorder guideline",
    description: null,
    file_name: "ranzcp-mood.pdf",
    file_type: "application/pdf",
    file_size: 1048576,
    storage_path: "0b6c9e21/ranzcp-mood.pdf",
    content_hash: null,
    source_path: null,
    import_batch_id: null,
    status: "queued",
    page_count: 0,
    chunk_count: 0,
    image_count: 0,
    error_message: null,
    metadata: { source: "upload" },
    created_at: "2026-08-15T00:00:00.000Z",
    updated_at: "2026-08-15T00:00:00.000Z",
    ...overrides,
  };
}

function claimedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "7d5e1a90-4444-4aaa-8bbb-000000000004",
    document_id: "3f1a2b6c-1111-4aaa-8bbb-000000000001",
    batch_id: null,
    status: "processing",
    stage: "claimed",
    progress: 0,
    error_message: null,
    attempt_count: 1,
    max_attempts: 3,
    locked_at: "2026-08-17T00:00:00.000Z",
    locked_by: "worker-host-123",
    lease_token: "7d5e1a90-4444-4aaa-8bbb-000000000014",
    lease_expected_generation_id: null,
    lease_write_generation_id: "1a2b3c4d-6666-4aaa-8bbb-000000000006",
    lease_authority_digest: `sha256:${"a".repeat(64)}`,
    lease_expires_at: "2099-01-01T00:00:00.000Z",
    lease_duration_seconds: 300,
    job_kind: "document",
    documents: claimedDocuments(),
    ...overrides,
  };
}

/** A realistic chunk read-back matching loadEnrichmentRows' select list exactly. */
function enrichmentChunk(overrides: Record<string, unknown> = {}) {
  return {
    id: "9c2f0d10-3333-4aaa-8bbb-000000000003",
    document_id: "3f1a2b6c-1111-4aaa-8bbb-000000000001",
    index_generation_id: "1a2b3c4d-6666-4aaa-8bbb-000000000006",
    page_number: 14,
    chunk_index: 7,
    section_heading: "Lithium monitoring",
    section_path: ["Mood disorders", "Lithium monitoring"],
    heading_level: 2,
    parent_heading: "Mood disorders",
    anchor_id: "lithium-monitoring",
    content: "Check serum lithium 5 days after any dose change.",
    image_ids: [],
    metadata: { index_generation_id: "1a2b3c4d-6666-4aaa-8bbb-000000000006" },
    ...overrides,
  };
}

/** A realistic image read-back matching loadEnrichmentRows' select list exactly. */
function enrichmentImage(overrides: Record<string, unknown> = {}) {
  return {
    id: "5e6f7a80-7777-4aaa-8bbb-000000000007",
    document_id: "3f1a2b6c-1111-4aaa-8bbb-000000000001",
    index_generation_id: "1a2b3c4d-6666-4aaa-8bbb-000000000006",
    page_number: 15,
    caption: "Lithium monitoring schedule table",
    image_type: "clinical_table",
    labels: ["lithium", "monitoring"],
    source_kind: "embedded",
    clinical_relevance_score: 0.9,
    metadata: { index_generation_id: "1a2b3c4d-6666-4aaa-8bbb-000000000006" },
    ...overrides,
  };
}

const enrichmentAuthority = {
  documentId: "3f1a2b6c-1111-4aaa-8bbb-000000000001",
  indexGenerationId: "1a2b3c4d-6666-4aaa-8bbb-000000000006",
};

describe("claimed job row contract", () => {
  it("accepts a realistic claimed row without mutating it", () => {
    const row: unknown = claimedRow();
    const before = structuredClone(row);

    expect(() => assertClaimedJobRow(row)).not.toThrow();

    // Assert, do not transform: the row enters the job lifecycle by the same reference
    // with its key order unchanged.
    expect(row).toEqual(before);
    expect(Object.keys(row as Record<string, unknown>)).toEqual(Object.keys(claimedRow()));
  });

  it("preserves unknown columns at both levels rather than stripping them", () => {
    // z.looseObject, not z.object: the live column set may run ahead of this repo.
    const row: unknown = claimedRow({
      next_run_at: "2026-08-17T00:05:00.000Z",
      documents: claimedDocuments({ index_generation_id: "1a2b3c4d-6666-4aaa-8bbb-000000000006" }),
    });
    assertClaimedJobRow(row);
    expect((row as Record<string, unknown>).next_run_at).toBe("2026-08-17T00:05:00.000Z");
    expect(((row as Record<string, unknown>).documents as Record<string, unknown>).index_generation_id).toBe(
      "1a2b3c4d-6666-4aaa-8bbb-000000000006",
    );
  });

  it("accepts null owner_id and batch_id, which are nullable columns", () => {
    expect(() =>
      assertClaimedJobRow(claimedRow({ batch_id: null, documents: claimedDocuments({ owner_id: null }) })),
    ).not.toThrow();
  });

  it("accepts every document status the check constraint permits", () => {
    for (const status of ["queued", "processing", "indexed", "failed"]) {
      expect(() => assertClaimedJobRow(claimedRow({ documents: claimedDocuments({ status }) }))).not.toThrow();
    }
  });

  it("rejects a documents payload missing storage_path, which downloadDocument dereferences", () => {
    const documents: Record<string, unknown> = claimedDocuments();
    delete documents.storage_path;
    expect(() => assertClaimedJobRow(claimedRow({ documents }))).toThrow(WorkerRowShapeError);
  });

  it("rejects a non-object documents payload, the to_jsonb drift case", () => {
    expect(() => assertClaimedJobRow(claimedRow({ documents: null }))).toThrow(WorkerRowShapeError);
    expect(() => assertClaimedJobRow(claimedRow({ documents: "corrupt" }))).toThrow(WorkerRowShapeError);
  });

  it("rejects a stringified attempt_count, which the retry cap compares as a number", () => {
    expect(() => assertClaimedJobRow(claimedRow({ attempt_count: "1" }))).toThrow(WorkerRowShapeError);
  });

  it("rejects a scalar documents.metadata, which downstream metadata merges spread", () => {
    expect(() => assertClaimedJobRow(claimedRow({ documents: claimedDocuments({ metadata: "corrupt" }) }))).toThrow(
      WorkerRowShapeError,
    );
  });

  it("rejects a document status outside the check constraint", () => {
    expect(() => assertClaimedJobRow(claimedRow({ documents: claimedDocuments({ status: "archived" }) }))).toThrow(
      WorkerRowShapeError,
    );
  });

  it("reports only Zod issue paths, never row content", () => {
    // Claimed rows carry document titles and storage paths; an error message that echoed
    // one would leak content into job error_message columns and Sentry.
    const secretTitle = "RANZCP mood disorder guideline";
    try {
      assertClaimedJobRow(claimedRow({ documents: claimedDocuments({ storage_path: 7 }) }));
      throw new Error("expected the contract to reject this row");
    } catch (error) {
      expect(error).toBeInstanceOf(WorkerRowShapeError);
      const message = (error as WorkerRowShapeError).message;
      expect(message).toContain("documents.storage_path");
      expect(message).not.toContain(secretTitle);
      expect(message).not.toContain("ranzcp-mood.pdf");
    }
  });

  it("caps reported issues at five plus a remainder note", () => {
    const gutted: Record<string, unknown> = claimedRow();
    delete gutted.id;
    delete gutted.document_id;
    delete gutted.attempt_count;
    delete gutted.max_attempts;
    delete gutted.batch_id;
    delete gutted.documents;
    try {
      assertClaimedJobRow(gutted);
      throw new Error("expected the contract to reject this row");
    } catch (error) {
      expect(error).toBeInstanceOf(WorkerRowShapeError);
      const issues = (error as WorkerRowShapeError).issues;
      expect(issues).toHaveLength(6);
      expect(issues[5]).toMatch(/^and \d+ more$/);
    }
  });
});

describe("claimed batch partition", () => {
  it("returns an all-valid batch by the same references in the same order", () => {
    const rows = [claimedRow(), claimedRow({ id: "8e6f2b01-8888-4aaa-8bbb-000000000008" })];
    const { accepted, rejected } = partitionClaimedJobRows(rows);
    expect(rejected).toEqual([]);
    expect(accepted).toHaveLength(2);
    expect(accepted[0]).toBe(rows[0]);
    expect(accepted[1]).toBe(rows[1]);
  });

  it("rejects only the malformed row and keeps valid siblings", () => {
    // The reason partition exists: the claim RPC has already committed leases and
    // attempt_count increments for the whole batch, so one poisoned row must not take
    // down its siblings (or, via a claim-loop throw, the worker's --once mode).
    const good = claimedRow();
    const bad = claimedRow({
      id: "8e6f2b01-8888-4aaa-8bbb-000000000008",
      documents: claimedDocuments({ metadata: "corrupt" }),
    });
    const { accepted, rejected } = partitionClaimedJobRows([bad, good]);
    expect(accepted).toHaveLength(1);
    expect(accepted[0]).toBe(good);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].error).toBeInstanceOf(WorkerRowShapeError);
    expect(rejected[0].failable?.fence).toMatchObject({
      job_id: "8e6f2b01-8888-4aaa-8bbb-000000000008",
      document_id: "3f1a2b6c-1111-4aaa-8bbb-000000000001",
      worker_id: "worker-host-123",
      lease_token: bad.lease_token,
    });
  });

  it("yields no failable identity when even the job id is untrustworthy", () => {
    const { rejected } = partitionClaimedJobRows([claimedRow({ id: 7 })]);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].failable).toBeNull();
  });

  it("rejects a row missing its batch_id key without inventing a failable identity", () => {
    const bad: Record<string, unknown> = claimedRow({ attempt_count: "1" });
    delete bad.batch_id;
    const { rejected } = partitionClaimedJobRows([bad]);
    expect(rejected[0].failable?.fence.job_id).toBe(bad.id);
  });

  it("leaves document status preservation to the server locked document", async () => {
    // Mirrors preservedStatus in worker/behavior.ts: atomic reindex failures keep the
    // document indexed rather than blanking a live index.
    const bad = claimedRow({
      attempt_count: "1",
      documents: claimedDocuments({ status: "indexed" }),
    });
    const { rejected } = partitionClaimedJobRows([bad]);
    const rpc = vi.fn().mockResolvedValue({ data: { ok: true }, error: null });
    await failRejectedClaimedJobRow(rejected[0], "worker-host-123", rpc);
    expect(rpc).toHaveBeenCalledWith("fail_or_retry_ingestion_job", {
      p_fence: rejected[0].failable?.fence,
      p_batch_id: null,
      p_retry: false,
      p_stage: "failed shape contract",
      p_error_message: rejected[0].error.message,
      p_next_run_at: null,
    });
  });

  it("uses only the job fence when documents is unreadable", () => {
    const { rejected } = partitionClaimedJobRows([claimedRow({ documents: "corrupt" })]);
    expect(rejected[0].failable?.fence.document_id).toBe(claimedRow().document_id);
    expect(rejected[0].failable).not.toHaveProperty("ownerId");
    expect(rejected[0].failable).not.toHaveProperty("documentStatus");
  });
});

describe("rejected claim terminal transition", () => {
  it.each([
    { lease_token: "bad" },
    { lease_authority_digest: "sha256:bad" },
    { lease_expected_generation_id: "bad" },
    { document_id: "bad" },
    { locked_by: "different-worker" },
    { lease_expires_at: "2020-01-01T00:00:00.000Z" },
    { lease_expires_at: "bad" },
  ])("never dispatches with invalid, expired, or foreign authority: %j", async (overrides) => {
    const { rejected } = partitionClaimedJobRows([claimedRow({ documents: null, ...overrides })]);
    const rpc = vi.fn();
    expect(await failRejectedClaimedJobRow(rejected[0], "worker-host-123", rpc)).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("terminally fails only a valid fence with bad payload, without deriving payload authority", async () => {
    const { accepted, rejected } = partitionClaimedJobRows([
      claimedRow({ documents: { id: "another-document", owner_id: "untrusted", status: "indexed" } }),
      claimedRow(),
    ]);
    const rpc = vi.fn().mockResolvedValue({ data: { ok: true }, error: null });
    expect(await failRejectedClaimedJobRow(rejected[0], "worker-host-123", rpc)).toBe(true);
    expect(accepted).toHaveLength(1);
    expect(rpc.mock.calls[0][1].p_fence.document_id).toBe(claimedRow().document_id);
    expect(rpc.mock.calls[0][1]).not.toHaveProperty("p_document_status");
  });

  it("honours server lease loss without falling back to an unfenced write", async () => {
    const good = claimedRow();
    const { accepted, rejected } = partitionClaimedJobRows([claimedRow({ documents: null }), good]);
    const rpc = vi.fn().mockResolvedValue({ data: { ok: false, reason: "lease_lost" }, error: null });
    await expect(failRejectedClaimedJobRow(rejected[0], "worker-host-123", rpc)).rejects.toThrow("lease_lost");
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(accepted).toEqual([good]);
  });
});

describe("worker claim rejection isolation", () => {
  it.each([
    { data: { ok: false, reason: "lease_lost" }, error: null },
    { data: null, error: { message: "synthetic transport failure" } },
    { data: { unexpected: true }, error: null },
  ])("returns valid siblings when the rejected row transition fails: %j", async (transition) => {
    const { createWorkerRuntime } = await import("../worker/main");
    const good = claimedRow();
    const bad = claimedRow({ id: "8e6f2b01-8888-4aaa-8bbb-000000000008", documents: null });
    const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
      if (name === "claim_ingestion_jobs") {
        good.locked_by = String(args.p_worker_id);
        bad.locked_by = good.locked_by;
        return { data: [bad, good], error: null };
      }
      if (name === "fail_or_retry_ingestion_job") return transition;
      throw new Error(`Unexpected RPC ${name}`);
    });
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const runtime = createWorkerRuntime({ client: { rpc } as unknown as SupabaseClient });
      expect(await runtime.claimJobs()).toEqual([good]);
      expect(runtime.attemptForJob(good.id).signal.aborted).toBe(false);
      expect(() => runtime.attemptForJob(bad.id)).toThrow("ingestion_attempt_required");
      expect(rpc.mock.calls.map(([name]) => name)).toEqual(["claim_ingestion_jobs", "fail_or_retry_ingestion_job"]);
    } finally {
      warning.mockRestore();
    }
  });
});

describe("enrichment read-back contracts", () => {
  it("accepts realistic rows without mutating them", () => {
    const chunks: unknown = [enrichmentChunk()];
    const images: unknown = [enrichmentImage()];
    const chunksBefore = structuredClone(chunks);
    const firstChunkReference = (chunks as unknown[])[0];

    expect(() => assertEnrichmentChunkRows(chunks)).not.toThrow();
    expect(() => assertEnrichmentImageRows(images)).not.toThrow();
    expect(() => assertEnrichmentChunkRows(chunks, enrichmentAuthority)).not.toThrow();
    expect(() => assertEnrichmentImageRows(images, enrichmentAuthority)).not.toThrow();

    expect(chunks).toEqual(chunksBefore);
    expect((chunks as unknown[])[0]).toBe(firstChunkReference);
  });

  it("accepts empty result sets, which the enrichment consumers guard themselves", () => {
    expect(() => assertEnrichmentChunkRows([])).not.toThrow();
    expect(() => assertEnrichmentImageRows([])).not.toThrow();
  });

  it("accepts nullable columns as null", () => {
    expect(() =>
      assertEnrichmentChunkRows([
        enrichmentChunk({
          page_number: null,
          section_heading: null,
          heading_level: null,
          parent_heading: null,
          anchor_id: null,
        }),
      ]),
    ).not.toThrow();
    expect(() => assertEnrichmentImageRows([enrichmentImage({ page_number: null })])).not.toThrow();
  });

  it("preserves unknown columns rather than stripping them", () => {
    const chunks: unknown = [enrichmentChunk({ retrieval_synopsis: "Lithium dosing summary." })];
    assertEnrichmentChunkRows(chunks);
    expect((chunks as Record<string, unknown>[])[0].retrieval_synopsis).toBe("Lithium dosing summary.");
  });

  it("rejects a chunk missing content, which both consumers section and summarize", () => {
    const chunk: Record<string, unknown> = enrichmentChunk();
    delete chunk.content;
    expect(() => assertEnrichmentChunkRows([chunk])).toThrow(WorkerRowShapeError);
  });

  it("rejects a scalar chunk metadata, which deep memory types as a record and mutates", () => {
    expect(() => assertEnrichmentChunkRows([enrichmentChunk({ metadata: "corrupt" })])).toThrow(WorkerRowShapeError);
  });

  it("rejects string image_ids, which would break image linking", () => {
    expect(() => assertEnrichmentChunkRows([enrichmentChunk({ image_ids: "not-an-array" })])).toThrow(
      WorkerRowShapeError,
    );
  });

  it("rejects a stringified clinical_relevance_score, the silent-misordering case", () => {
    expect(() => assertEnrichmentImageRows([enrichmentImage({ clinical_relevance_score: "0.9" })])).toThrow(
      WorkerRowShapeError,
    );
  });

  it("accepts any image_type string, since the consumers do not narrow it", () => {
    // Deliberately not enum-pinned: consumer types say string | null and the DB check list
    // diverges from ImageEvidenceCategory, so an enum would only add drift rejection risk.
    expect(() => assertEnrichmentImageRows([enrichmentImage({ image_type: "cover_page" })])).not.toThrow();
  });

  it("never reports clinical content in an error", () => {
    const secret = "Check serum lithium 5 days after any dose change.";
    try {
      assertEnrichmentChunkRows([enrichmentChunk({ chunk_index: "seven" })]);
      throw new Error("expected the contract to reject this row");
    } catch (error) {
      expect(error).toBeInstanceOf(WorkerRowShapeError);
      const message = (error as WorkerRowShapeError).message;
      expect(message).toContain("chunk_index");
      expect(message).not.toContain(secret);
      expect(message).not.toContain("seven");
    }
  });

  it("rejects a non-array payload", () => {
    expect(() => assertEnrichmentChunkRows(enrichmentChunk())).toThrow(WorkerRowShapeError);
  });
});
