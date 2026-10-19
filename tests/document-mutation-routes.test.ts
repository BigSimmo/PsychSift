import { afterEach, describe, expect, it, vi } from "vitest";

const ownerId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const documentId = "11111111-1111-4111-8111-111111111111";
const missingDocumentId = "22222222-2222-4222-8222-222222222222";
const factId = "33333333-3333-4333-8333-333333333333";
const imageId = "44444444-4444-4444-8444-444444444444";
const committedGeneration = "55555555-5555-4555-8555-555555555555";
const replacementGeneration = "66666666-6666-4666-8666-666666666666";
// Synthetic `updated_at` row versions: what the route read, and what a worker commit wrote.
const readVersion = "2026-10-19T01:00:00.000001+00:00";
const workerCommitVersion = "2026-10-19T01:00:05.000002+00:00";

type QueryError = { message: string };
type QueryResult = { data: unknown; error: QueryError | null };
type QueryOperation = "select" | "update" | "upsert" | "delete";
type QueryCall = {
  table: string;
  operation: QueryOperation;
  selected?: string;
  payload?: unknown;
  options?: unknown;
  filters: Array<{ column: string; value: unknown }>;
  inFilters: Array<{ column: string; values: unknown[] }>;
};
type QueryResolver = (call: QueryCall) => QueryResult;

class QueryBuilder implements PromiseLike<QueryResult> {
  constructor(
    private readonly call: QueryCall,
    private readonly resolveCall: QueryResolver,
  ) {}

  select(selected?: string) {
    this.call.selected = selected;
    return this;
  }

  update(payload: unknown) {
    this.call.operation = "update";
    this.call.payload = payload;
    return this;
  }

  upsert(payload: unknown, options?: unknown) {
    this.call.operation = "upsert";
    this.call.payload = payload;
    this.call.options = options;
    return this;
  }

  delete() {
    this.call.operation = "delete";
    return this;
  }

  eq(column: string, value: unknown) {
    this.call.filters.push({ column, value });
    return this;
  }

  in(column: string, values: unknown[]) {
    this.call.inFilters.push({ column, values });
    return this;
  }

  maybeSingle() {
    return this.resolve();
  }

  single() {
    return this.resolve();
  }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.resolve().then(onfulfilled, onrejected);
  }

  private resolve() {
    return Promise.resolve(this.resolveCall(this.call));
  }
}

function createSupabaseMock(resolveCall: QueryResolver) {
  const calls: QueryCall[] = [];
  return {
    calls,
    client: {
      from: vi.fn((table: string) => {
        const call: QueryCall = {
          table,
          operation: "select",
          filters: [],
          inFilters: [],
        };
        calls.push(call);
        return new QueryBuilder(call, resolveCall);
      }),
      rpc: vi.fn(async (name: string) => {
        // The document-admin routes consult the rate limiter before touching tables.
        // Return a not-limited row so these functional tests exercise the happy path.
        if (name === "consume_api_rate_limit" || name === "consume_api_subject_rate_limit") {
          return {
            data: [
              {
                limited: false,
                limit_value: 60,
                remaining: 59,
                retry_after_seconds: 60,
                reset_at: new Date(Date.now() + 60_000).toISOString(),
              },
            ],
            error: null,
          };
        }
        return { data: [], error: null };
      }),
    },
  };
}

// A version-matched document update that reaches its row returns that row's id.
function committedDocumentUpdate(): QueryResult {
  return { data: [{ id: documentId }], error: null };
}

function filterValue(call: QueryCall, column: string) {
  return call.filters.find((filter) => filter.column === column)?.value;
}

function mockRouteRuntime(client: ReturnType<typeof createSupabaseMock>["client"]) {
  const invalidateRagCachesForOwner = vi.fn();
  class AuthenticationError extends Error {}
  vi.doMock("@/lib/env", () => ({ isDemoMode: () => false }));
  vi.doMock("@/lib/supabase/admin", () => ({ createAdminClient: () => client }));
  vi.doMock("@/lib/supabase/auth", () => ({
    AuthenticationError,
    requireAuthenticatedUser: vi.fn(async () => ({ id: ownerId })),
    unauthorizedResponse: () => Response.json({ error: "Authentication required." }, { status: 401 }),
  }));
  vi.doMock("@/lib/rag/rag", () => ({ invalidateRagCachesForOwner }));
  return { invalidateRagCachesForOwner };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("/api/documents/bulk", () => {
  it.each([
    ["current source status", { sourceStatus: "current" }],
    ["review-due source status", { sourceStatus: "review_due" }],
    ["outdated source status", { sourceStatus: "outdated" }],
    ["unknown source status", { sourceStatus: "unknown" }],
    ["unverified validation", { validationStatus: "unverified" }],
    ["locally reviewed validation", { validationStatus: "locally_reviewed" }],
    ["approved validation", { validationStatus: "approved" }],
  ])("rejects every bulk governance status write through %s", async (label, metadata) => {
    const supabase = createSupabaseMock(() => ({ data: null, error: null }));
    mockRouteRuntime(supabase.client);
    const { POST } = await import("../src/app/api/documents/bulk/route");

    const response = await POST(
      new Request("http://localhost/api/documents/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ documentIds: [documentId], metadata }),
      }),
    );

    expect(response.status, label).toBe(400);
    expect(supabase.calls).toHaveLength(0);
  });

  it.each([
    ["publisher identity", { publisherCode: "BMJ" }],
    ["extraction quality", { extractionQuality: "good" }],
  ])("rejects changing protected %s without an auditable demotion", async (label, metadata) => {
    const supabase = createSupabaseMock((call) => {
      if (call.table === "documents" && call.operation === "select") {
        return {
          data: [
            {
              id: documentId,
              title: "Reviewed local guidance",
              metadata: {
                document_status: "current",
                clinical_validation_status: "approved",
                provenance_basis: "reviewer_verified",
              },
            },
          ],
          error: null,
        };
      }
      return { data: null, error: null };
    });
    const { invalidateRagCachesForOwner } = mockRouteRuntime(supabase.client);
    const { POST } = await import("../src/app/api/documents/bulk/route");

    const response = await POST(
      new Request("http://localhost/api/documents/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ documentIds: [documentId], metadata }),
      }),
    );

    expect(response.status, label).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error:
        "Identity or provenance edits are unavailable for reviewed sources; record an auditable source-review disposition first.",
      message:
        "Identity or provenance edits are unavailable for reviewed sources; record an auditable source-review disposition first.",
      code: "reviewed_source_edit_blocked",
    });
    expect(supabase.calls.filter((call) => call.operation !== "select")).toEqual([]);
    expect(invalidateRagCachesForOwner).not.toHaveBeenCalled();
  });

  // #JYH1FH: the WA document-control endorsement keeps the WA authority tier, so its publisher
  // identity stays as protected as it was under the old `locally_reviewed` stamp.
  it("rejects identity edits on a WA document-control endorsed source", async () => {
    const supabase = createSupabaseMock((call) => {
      if (call.table === "documents" && call.operation === "select") {
        return {
          data: [
            {
              id: documentId,
              title: "Endorsed WA guidance",
              metadata: {
                document_status: "review_due",
                clinical_validation_status: "unverified",
                clinical_validation_evidence: { status: "unverified", basis: "wa_document_control_endorsement" },
              },
            },
          ],
          error: null,
        };
      }
      return { data: null, error: null };
    });
    const { invalidateRagCachesForOwner } = mockRouteRuntime(supabase.client);
    const { POST } = await import("../src/app/api/documents/bulk/route");

    const response = await POST(
      new Request("http://localhost/api/documents/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ documentIds: [documentId], metadata: { publisherCode: "BMJ" } }),
      }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: "reviewed_source_edit_blocked" });
    expect(supabase.calls.filter((call) => call.operation !== "select")).toEqual([]);
    expect(invalidateRagCachesForOwner).not.toHaveBeenCalled();
  });

  it("applies owner-scoped metadata, title, and label edits", async () => {
    const supabase = createSupabaseMock((call) => {
      if (call.table === "documents" && call.operation === "select") {
        return {
          data: [{ id: documentId, title: "Old title", metadata: { retained: true }, updated_at: readVersion }],
          error: null,
        };
      }
      if (call.table === "documents" && call.operation === "update") return committedDocumentUpdate();
      return { data: null, error: null };
    });
    const { invalidateRagCachesForOwner } = mockRouteRuntime(supabase.client);
    const { POST } = await import("../src/app/api/documents/bulk/route");

    const response = await POST(
      new Request("http://localhost/api/documents/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          documentIds: [documentId, missingDocumentId],
          metadata: { publisher: "WA Health" },
          titleEdit: { prefix: "Updated: ", find: "Old", replace: "New" },
          labels: {
            add: [{ label: "Cardiology", label_type: "topic", confidence: 0.9 }],
            remove: [{ label: "Legacy", label_type: "topic" }],
          },
        }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      ok: true,
      updatedCount: 1,
      missingDocumentIds: [missingDocumentId],
      results: [{ documentId, updated: true }],
    });

    const labelInsert = supabase.calls.find((call) => call.table === "document_labels" && call.operation === "upsert");
    expect(labelInsert?.payload).toEqual([
      expect.objectContaining({
        owner_id: ownerId,
        document_id: documentId,
        label: "cardiology",
        label_type: "topic",
        source: "manual",
      }),
    ]);

    const labelDelete = supabase.calls.find((call) => call.table === "document_labels" && call.operation === "delete");
    expect(labelDelete?.filters).toEqual(
      expect.arrayContaining([
        { column: "owner_id", value: ownerId },
        { column: "label", value: "legacy" },
        { column: "label_type", value: "topic" },
      ]),
    );
    expect(labelDelete?.inFilters).toContainEqual({ column: "document_id", values: [documentId] });

    const documentUpdate = supabase.calls.find((call) => call.table === "documents" && call.operation === "update");
    expect(documentUpdate?.payload).toMatchObject({
      title: "Updated: New title",
      metadata: {
        retained: true,
        publisher: "WA Health",
        bulk_metadata_updated_by: ownerId,
      },
    });
    expect(documentUpdate?.filters).toEqual(
      expect.arrayContaining([
        { column: "id", value: documentId },
        { column: "owner_id", value: ownerId },
        { column: "updated_at", value: readVersion },
      ]),
    );
    expect(invalidateRagCachesForOwner).toHaveBeenCalledWith(ownerId);
  });

  // F-08: a worker commit landing between the route's read and its write must not be
  // overwritten by the stale metadata object the route read.
  it("keeps an index pointer the worker commits between the read and the write", async () => {
    const stored = {
      id: documentId,
      title: "Lithium monitoring",
      metadata: { index_generation_id: committedGeneration, retained: true } as Record<string, unknown>,
      updated_at: readVersion,
    };
    const snapshot = () => ({ ...stored, metadata: { ...stored.metadata } });
    let workerCommitted = false;
    const supabase = createSupabaseMock((call) => {
      if (call.table !== "documents") return { data: null, error: null };
      if (call.operation === "select") {
        return call.inFilters.length ? { data: [snapshot()], error: null } : { data: snapshot(), error: null };
      }
      if (call.operation === "update") {
        if (!workerCommitted) {
          // The worker commits a replacement generation just before the route's write lands.
          workerCommitted = true;
          stored.metadata = { ...stored.metadata, index_generation_id: replacementGeneration };
          stored.updated_at = workerCommitVersion;
        }
        if (filterValue(call, "updated_at") !== stored.updated_at) return { data: [], error: null };
        const payload = call.payload as { metadata: Record<string, unknown> };
        stored.metadata = payload.metadata;
        stored.updated_at = "2026-10-19T01:00:06.000003+00:00";
        return committedDocumentUpdate();
      }
      return { data: null, error: null };
    });
    mockRouteRuntime(supabase.client);
    const { POST } = await import("../src/app/api/documents/bulk/route");

    const response = await POST(
      new Request("http://localhost/api/documents/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ documentIds: [documentId], metadata: { collection: "Mood disorders" } }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, updatedCount: 1 });
    expect(stored.metadata).toMatchObject({
      index_generation_id: replacementGeneration,
      retained: true,
      collection: "Mood disorders",
    });
    const updates = supabase.calls.filter((call) => call.table === "documents" && call.operation === "update");
    expect(updates.map((call) => filterValue(call, "updated_at"))).toEqual([readVersion, workerCommitVersion]);
  });

  it("reports a per-document conflict instead of writing when the row keeps changing", async () => {
    const supabase = createSupabaseMock((call) => {
      if (call.table !== "documents") return { data: null, error: null };
      if (call.operation === "select") {
        const row = {
          id: documentId,
          title: "Lithium monitoring",
          metadata: { index_generation_id: committedGeneration },
          updated_at: readVersion,
        };
        return call.inFilters.length ? { data: [row], error: null } : { data: row, error: null };
      }
      // Every write races another commit, so the version match never reaches the row.
      if (call.operation === "update") return { data: [], error: null };
      return { data: null, error: null };
    });
    const { invalidateRagCachesForOwner } = mockRouteRuntime(supabase.client);
    const { POST } = await import("../src/app/api/documents/bulk/route");

    const response = await POST(
      new Request("http://localhost/api/documents/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ documentIds: [documentId], metadata: { collection: "Mood disorders" } }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      ok: false,
      updatedCount: 0,
      results: [
        {
          documentId,
          updated: false,
          error: "This document changed while the edit was saving (for example, indexing finished). Retry the edit.",
        },
      ],
    });
    expect(supabase.calls.filter((call) => call.table === "documents" && call.operation === "update")).toHaveLength(3);
    expect(invalidateRagCachesForOwner).toHaveBeenCalledWith(ownerId);
  });

  it("stops an identity edit when the re-read row became a reviewed source", async () => {
    let reads = 0;
    const supabase = createSupabaseMock((call) => {
      if (call.table !== "documents") return { data: null, error: null };
      if (call.operation === "select") {
        reads += 1;
        const metadata =
          reads === 1
            ? { index_generation_id: committedGeneration }
            : { index_generation_id: committedGeneration, clinical_validation_status: "approved" };
        const row = { id: documentId, title: "Lithium monitoring", metadata, updated_at: readVersion };
        return call.inFilters.length ? { data: [row], error: null } : { data: row, error: null };
      }
      if (call.operation === "update") return { data: [], error: null };
      return { data: null, error: null };
    });
    mockRouteRuntime(supabase.client);
    const { POST } = await import("../src/app/api/documents/bulk/route");

    const response = await POST(
      new Request("http://localhost/api/documents/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ documentIds: [documentId], metadata: { publisher: "WA Health" } }),
      }),
    );
    const payload = await response.json();

    expect(payload).toMatchObject({ ok: false, results: [{ documentId, updated: false }] });
    expect(payload.results[0].error).toContain("reviewed sources");
    expect(supabase.calls.filter((call) => call.table === "documents" && call.operation === "update")).toHaveLength(1);
  });

  it("does not leak the raw database error in a per-document bulk failure", async () => {
    const rawDbError = 'duplicate key value violates unique constraint "documents_secret_internal_idx"';
    const supabase = createSupabaseMock((call) => {
      if (call.table === "documents" && call.operation === "select") {
        return { data: [{ id: documentId, title: "Old title", metadata: {} }], error: null };
      }
      if (call.table === "documents" && call.operation === "update") {
        return { data: null, error: { message: rawDbError } };
      }
      return { data: null, error: null };
    });
    mockRouteRuntime(supabase.client);
    const { POST } = await import("../src/app/api/documents/bulk/route");

    const response = await POST(
      new Request("http://localhost/api/documents/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ documentIds: [documentId], metadata: { publisher: "WA Health" } }),
      }),
    );
    const payload = (await response.json()) as {
      ok: boolean;
      updatedCount: number;
      results: Array<{ documentId: string; updated: boolean; error?: string }>;
    };

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({ ok: false, updatedCount: 0 });
    expect(payload.results[0]).toMatchObject({
      documentId,
      updated: false,
      error: "Bulk edit failed for this document.",
    });
    // The raw DB constraint text must never reach the client.
    expect(JSON.stringify(payload)).not.toContain("documents_secret_internal_idx");
    expect(JSON.stringify(payload)).not.toContain("unique constraint");
  });

  it("clears a stale publisher_code when publisherCode is null", async () => {
    const supabase = createSupabaseMock((call) => {
      if (call.table === "documents" && call.operation === "select") {
        return {
          data: [
            {
              id: documentId,
              title: "WACHS lithium",
              metadata: {
                publisher_code: "WACHS",
                publisher: "WA Country Health Service",
                jurisdiction: "Australia/WA",
              },
            },
          ],
          error: null,
        };
      }
      if (call.table === "documents" && call.operation === "update") return committedDocumentUpdate();
      return { data: null, error: null };
    });
    mockRouteRuntime(supabase.client);
    const { POST } = await import("../src/app/api/documents/bulk/route");

    const response = await POST(
      new Request("http://localhost/api/documents/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          documentIds: [documentId],
          metadata: { publisherCode: null, publisher: "Unknown clinic", jurisdiction: null },
        }),
      }),
    );
    const payload = await response.json();
    const documentUpdate = supabase.calls.find((call) => call.table === "documents" && call.operation === "update");

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({ ok: true, updatedCount: 1 });
    expect(documentUpdate?.payload).toMatchObject({
      metadata: {
        publisher: "Unknown clinic",
        bulk_metadata_updated_by: ownerId,
      },
    });
    expect(documentUpdate?.payload).toEqual(
      expect.objectContaining({
        metadata: expect.not.objectContaining({
          publisher_code: expect.anything(),
          jurisdiction: expect.anything(),
        }),
      }),
    );
  });

  it("clears a stale publisher_code when only publisher/jurisdiction are corrected", async () => {
    const supabase = createSupabaseMock((call) => {
      if (call.table === "documents" && call.operation === "select") {
        return {
          data: [
            {
              id: documentId,
              title: "Misclassified note",
              metadata: {
                publisher_code: "WACHS",
                publisher: "WA Country Health Service",
                jurisdiction: "Australia/WA",
              },
            },
          ],
          error: null,
        };
      }
      if (call.table === "documents" && call.operation === "update") return committedDocumentUpdate();
      return { data: null, error: null };
    });
    mockRouteRuntime(supabase.client);
    const { POST } = await import("../src/app/api/documents/bulk/route");

    const response = await POST(
      new Request("http://localhost/api/documents/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          documentIds: [documentId],
          metadata: { publisher: "Local clinic handout", jurisdiction: "Australia/WA" },
        }),
      }),
    );
    const documentUpdate = supabase.calls.find((call) => call.table === "documents" && call.operation === "update");

    expect(response.status).toBe(200);
    expect(documentUpdate?.payload).toMatchObject({
      metadata: {
        publisher: "Local clinic handout",
        jurisdiction: "Australia/WA",
      },
    });
    expect(
      (documentUpdate?.payload as { metadata?: Record<string, unknown> } | undefined)?.metadata,
    ).not.toHaveProperty("publisher_code");
  });

  it("rejects an unknown publisherCode with HTTP 400 before per-document updates", async () => {
    const supabase = createSupabaseMock(() => ({ data: null, error: null }));
    mockRouteRuntime(supabase.client);
    const { POST } = await import("../src/app/api/documents/bulk/route");

    const response = await POST(
      new Request("http://localhost/api/documents/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          documentIds: [documentId],
          metadata: { publisherCode: "NOT_A_REAL_CODE" },
        }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toMatchObject({ error: "Unknown publisher code." });
    expect(supabase.calls.some((call) => call.table === "documents")).toBe(false);
  });

  it("applies a registered publisherCode and overwrites publisher locality fields", async () => {
    const supabase = createSupabaseMock((call) => {
      if (call.table === "documents" && call.operation === "select") {
        return {
          data: [
            {
              id: documentId,
              title: "Lithium",
              metadata: { publisher_code: "BMJ", publisher: "BMJ Best Practice", jurisdiction: "International" },
            },
          ],
          error: null,
        };
      }
      if (call.table === "documents" && call.operation === "update") return committedDocumentUpdate();
      return { data: null, error: null };
    });
    mockRouteRuntime(supabase.client);
    const { POST } = await import("../src/app/api/documents/bulk/route");

    const response = await POST(
      new Request("http://localhost/api/documents/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          documentIds: [documentId],
          metadata: { publisherCode: "WACHS" },
        }),
      }),
    );
    const documentUpdate = supabase.calls.find((call) => call.table === "documents" && call.operation === "update");

    expect(response.status).toBe(200);
    expect(documentUpdate?.payload).toMatchObject({
      metadata: {
        publisher_code: "WACHS",
        publisher: "WA Country Health Service",
        jurisdiction: "Australia/WA",
      },
    });
  });
});

describe("/api/documents/[id]/table-facts", () => {
  it("rejects an invalid document UUID before querying UUID columns", async () => {
    const supabase = createSupabaseMock(() => ({ data: null, error: null }));
    mockRouteRuntime(supabase.client);
    const { GET } = await import("../src/app/api/documents/[id]/table-facts/route");

    const response = await GET(new Request("http://localhost/api/documents/not-a-uuid/table-facts"), {
      params: Promise.resolve({ id: "not-a-uuid" }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "Invalid document id.",
      code: "invalid_route_params",
    });
    expect(supabase.calls).toHaveLength(0);
  });

  it("updates a committed table fact and its linked source image", async () => {
    const supabase = createSupabaseMock((call) => {
      if (call.table === "documents") {
        return { data: { id: documentId, metadata: { index_generation_id: committedGeneration } }, error: null };
      }
      if (call.table === "document_table_facts" && call.operation === "select") {
        return {
          data: {
            id: factId,
            document_id: documentId,
            owner_id: ownerId,
            source_image_id: imageId,
            metadata: { index_generation_id: committedGeneration },
          },
          error: null,
        };
      }
      if (call.table === "document_table_facts" && call.operation === "update") {
        return { data: { id: factId, metadata: call.payload }, error: null };
      }
      if (call.table === "document_images" && call.operation === "select") {
        return { data: { id: imageId, metadata: { index_generation_id: committedGeneration } }, error: null };
      }
      return { data: null, error: null };
    });
    const { invalidateRagCachesForOwner } = mockRouteRuntime(supabase.client);
    const { PATCH } = await import("../src/app/api/documents/[id]/table-facts/route");

    const response = await PATCH(
      new Request(`http://localhost/api/documents/${documentId}/table-facts`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          factId,
          reviewClass: "clinical_useful",
          notes: "Verified against the source table",
          confidence: 0.95,
        }),
      }),
      { params: Promise.resolve({ id: documentId }) },
    );

    expect(response.status).toBe(200);
    const factUpdate = supabase.calls.find(
      (call) => call.table === "document_table_facts" && call.operation === "update",
    );
    expect(factUpdate?.payload).toMatchObject({
      metadata: expect.objectContaining({
        index_generation_id: committedGeneration,
        review_class: "clinical_useful",
        reviewed_by: ownerId,
        review_confidence: 0.95,
      }),
    });
    const imageUpdate = supabase.calls.find((call) => call.table === "document_images" && call.operation === "update");
    expect(imageUpdate?.payload).toMatchObject({
      searchable: true,
      metadata: expect.objectContaining({
        index_generation_id: committedGeneration,
        review_class: "clinical_useful",
        reviewed_by: ownerId,
      }),
    });
    expect(invalidateRagCachesForOwner).toHaveBeenCalledWith(ownerId);
  });

  it("rejects a stale linked image before mutating the committed fact", async () => {
    const supabase = createSupabaseMock((call) => {
      if (call.table === "documents") {
        return { data: { id: documentId, metadata: { index_generation_id: committedGeneration } }, error: null };
      }
      if (call.table === "document_table_facts" && call.operation === "select") {
        return {
          data: {
            id: factId,
            document_id: documentId,
            owner_id: ownerId,
            source_image_id: imageId,
            metadata: { index_generation_id: committedGeneration },
          },
          error: null,
        };
      }
      if (call.table === "document_table_facts" && call.operation === "update") {
        return { data: { id: factId, metadata: call.payload }, error: null };
      }
      if (call.table === "document_images" && call.operation === "select") {
        return { data: { id: imageId, metadata: { index_generation_id: replacementGeneration } }, error: null };
      }
      return { data: null, error: null };
    });
    const { invalidateRagCachesForOwner } = mockRouteRuntime(supabase.client);
    const { PATCH } = await import("../src/app/api/documents/[id]/table-facts/route");

    const response = await PATCH(
      new Request(`http://localhost/api/documents/${documentId}/table-facts`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ factId, reviewClass: "bad_extraction" }),
      }),
      { params: Promise.resolve({ id: documentId }) },
    );

    expect(response.status).toBe(404);
    expect(supabase.calls.some((call) => call.table === "document_table_facts" && call.operation === "update")).toBe(
      false,
    );
    expect(supabase.calls.some((call) => call.table === "document_images" && call.operation === "update")).toBe(false);
    expect(invalidateRagCachesForOwner).not.toHaveBeenCalled();
  });
});
