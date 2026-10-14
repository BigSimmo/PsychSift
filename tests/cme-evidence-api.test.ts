import { beforeEach, describe, expect, it, vi } from "vitest";

type QueryResult = {
  data?: unknown;
  error?: { code?: string; message?: string } | null;
  count?: number;
  thrown?: Error;
};
const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  auth: vi.fn(),
  demo: vi.fn(),
  rate: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
  signed: vi.fn(),
  form: vi.fn(),
  validate: vi.fn(),
  release: vi.fn(),
  storageBucket: vi.fn(),
  rpc: vi.fn(),
  clientTimeout: vi.fn(),
  uploadClientTimeout: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: (options?: { timeoutMs?: number | null }) => {
    mocks.clientTimeout(options?.timeoutMs);
    return {
      from: mocks.from,
      rpc: mocks.rpc,
      storage: {
        from: (bucket: string) => {
          mocks.storageBucket(bucket);
          return {
            upload: (...args: unknown[]) => {
              mocks.uploadClientTimeout(options?.timeoutMs);
              return mocks.upload(...args);
            },
            remove: mocks.remove,
            createSignedUrl: mocks.signed,
          };
        },
      },
    };
  },
}));
vi.mock("@/lib/supabase/auth", () => ({
  requireAuthenticatedUser: mocks.auth,
  AuthenticationError: class extends Error {},
  unauthorizedResponse: () => Response.json({ error: "Sign in" }, { status: 401 }),
}));
vi.mock("@/lib/env", () => ({ isDemoMode: mocks.demo }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/api-rate-limit", () => ({
  consumeSubjectApiRateLimit: mocks.rate,
  rateLimitJsonResponse: () => Response.json({}, { status: 429 }),
  allowRateLimitInMemoryFallbackOnUnavailable: () => false,
}));
vi.mock("@/lib/upload-admission", () => ({ acquireUploadAdmission: () => ({ ok: true, release: mocks.release }) }));
vi.mock("@/lib/cme/evidence-upload", () => ({
  readCmeEvidenceForm: mocks.form,
  validateCmeEvidenceFile: mocks.validate,
}));

import { GET as list, POST as upload } from "@/app/api/cme/entries/[id]/evidence/route";
import { DELETE as remove, GET as download } from "@/app/api/cme/entries/[id]/evidence/[evidenceId]/route";
import { AuthenticationError } from "@/lib/supabase/auth";
import { CME_EVIDENCE_BUCKET } from "@/lib/cme/evidence-model";

const ownerId = "11111111-1111-4111-8111-111111111111";
const entryId = "22222222-2222-4222-8222-222222222222";
const evidenceId = "33333333-3333-4333-8333-333333333333";
const yearId = "44444444-4444-4444-8444-444444444444";
const context = { params: Promise.resolve({ id: entryId }) };
const downloadContext = { params: Promise.resolve({ id: entryId, evidenceId }) };
const entry = { id: entryId, year_id: yearId, archived_at: null };
const evidence = {
  id: evidenceId,
  owner_id: ownerId,
  entry_id: entryId,
  file_name: "Synthetic certificate.pdf",
  content_type: "application/pdf",
  byte_size: 13,
  kind: "certificate",
  uploaded_at: "2026-09-22T00:00:00Z",
  storage_path: `${ownerId}/${entryId}/${evidenceId}`,
  sha256: "a".repeat(64),
  redaction_confirmed: true,
  preview_confirmed: true,
};
const results: QueryResult[] = [];
const queries: { table: string; eq: ReturnType<typeof vi.fn>; insert: ReturnType<typeof vi.fn> }[] = [];

function request() {
  return new Request(`https://example.org/api/cme/entries/${entryId}/evidence`, { method: "POST" });
}
function form() {
  const data = new FormData();
  data.set("file", new File(["Synthetic PDF"], "Synthetic certificate.pdf", { type: "application/pdf" }));
  data.set("kind", "certificate");
  data.set("previewConfirmed", "true");
  data.set("redactionConfirmed", "true");
  return data;
}
function admitUpload() {
  results.push(
    { data: entry, error: null },
    { data: { closed_at: null }, error: null },
    { data: null, error: null },
    { count: 0, error: null },
  );
}
function assertOwnerScope() {
  for (const query of queries.filter((query) => query.table !== "storage_cleanup_jobs")) {
    if (query.insert.mock.calls.length)
      expect(query.insert).toHaveBeenCalledWith(expect.objectContaining({ owner_id: ownerId }));
    else expect(query.eq).toHaveBeenCalledWith("owner_id", ownerId);
  }
}
beforeEach(() => {
  vi.clearAllMocks();
  results.length = 0;
  queries.length = 0;
  mocks.auth.mockResolvedValue({ id: ownerId });
  mocks.demo.mockReturnValue(false);
  mocks.rate.mockResolvedValue({ limited: false });
  mocks.form.mockResolvedValue(form());
  mocks.validate.mockResolvedValue(Buffer.from("Synthetic PDF"));
  mocks.upload.mockResolvedValue({ data: {}, error: null });
  mocks.remove.mockResolvedValue({ data: [], error: null });
  mocks.signed.mockResolvedValue({
    data: { signedUrl: "https://storage.example.org/private?token=synthetic" },
    error: null,
  });
  mocks.from.mockImplementation((table: string) => {
    const outcome = results.shift();
    if (!outcome) throw new Error(`Unexpected database query: ${table}`);
    const settle = () => (outcome.thrown ? Promise.reject(outcome.thrown) : Promise.resolve(outcome));
    const query = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn(settle),
      single: vi.fn(settle),
      then: (resolve: (value: QueryResult) => unknown, reject?: (cause: unknown) => unknown) =>
        settle().then(resolve, reject),
    };
    queries.push({ table, eq: query.eq, insert: query.insert });
    return query;
  });
});

describe("private CME evidence API", () => {
  it("requires authentication for list, upload and download before storage or record access", async () => {
    mocks.auth.mockRejectedValue(new AuthenticationError());
    expect((await list(request(), context)).status).toBe(401);
    expect((await upload(request(), context)).status).toBe(401);
    expect((await download(request(), downloadContext)).status).toBe(401);
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.signed).not.toHaveBeenCalled();
  });
  it("returns no evidence for a foreign activity and never signs its object", async () => {
    results.push({ data: null, error: null }, { data: null, error: null });
    expect((await list(request(), context)).status).toBe(404);
    expect((await download(request(), downloadContext)).status).toBe(404);
    assertOwnerScope();
    expect(mocks.signed).not.toHaveBeenCalled();
  });
  it("lists owner-scoped metadata only with private no-store headers", async () => {
    results.push({ data: entry, error: null }, { data: [evidence], error: null });
    const response = await list(request(), context);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    const body = await response.json();
    expect(body.evidence).toHaveLength(1);
    expect(body.evidence[0]).not.toHaveProperty("storagePath");
    expect(body.evidence[0]).not.toHaveProperty("ownerId");
    assertOwnerScope();
    // An ordinary read keeps the default service-role deadline.
    expect(mocks.clientTimeout.mock.calls.every(([timeoutMs]) => timeoutMs === undefined)).toBe(true);
    expect(queries[1].eq).toHaveBeenCalledWith("entry_id", entryId);
  });
  it.each(["previewConfirmed", "redactionConfirmed"])(
    "rejects missing %s before admitting bytes to storage",
    async (field) => {
      results.push({ data: entry, error: null }, { data: { closed_at: null }, error: null });
      const data = form();
      data.delete(field);
      mocks.form.mockResolvedValue(data);
      expect((await upload(request(), context)).status).toBe(400);
      expect(mocks.upload).not.toHaveBeenCalled();
      expect(mocks.validate).not.toHaveBeenCalled();
      expect(mocks.release).toHaveBeenCalledOnce();
    },
  );
  it.each(["archived", "closed"])("blocks upload into an %s record before reading the file", async (state) => {
    results.push(
      { data: { ...entry, archived_at: state === "archived" ? "2026-09-22" : null }, error: null },
      { data: { closed_at: state === "closed" ? "2026-09-22" : null }, error: null },
    );
    expect((await upload(request(), context)).status).toBe(409);
    expect(mocks.form).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
  });
  it("returns an existing identical file without uploading or creating duplicate metadata", async () => {
    results.push(
      { data: entry, error: null },
      { data: { closed_at: null }, error: null },
      { data: evidence, error: null },
    );
    const response = await upload(request(), context);
    expect(response.status).toBe(200);
    expect((await response.json()).duplicate).toBe(true);
    expect(mocks.upload).not.toHaveBeenCalled();
    assertOwnerScope();
  });
  it("stores a unique owner/entry path and records both explicit confirmations", async () => {
    admitUpload();
    results.push({ data: evidence, error: null });
    const response = await upload(request(), context);
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.upload.mock.calls[0][0]).toMatch(new RegExp(`^${ownerId}/${entryId}/[a-f0-9-]+$`));
    expect(mocks.upload.mock.calls[0][2]).toMatchObject({ upsert: false, contentType: "application/pdf" });
    // Only the Storage transfer is unbounded; auth, rate limiting and record writes keep the deadline.
    expect(mocks.uploadClientTimeout).toHaveBeenCalledWith(null);
    expect(mocks.clientTimeout.mock.calls.filter(([timeoutMs]) => timeoutMs === null)).toHaveLength(1);
    expect(queries[4].insert).toHaveBeenCalledWith(
      expect.objectContaining({
        owner_id: ownerId,
        entry_id: entryId,
        preview_confirmed: true,
        redaction_confirmed: true,
      }),
    );
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(mocks.release).toHaveBeenCalledOnce();
  });
  it("keeps the uploaded object when an unknown transport failure is followed by an empty read", async () => {
    admitUpload();
    results.push({ thrown: new Error("Synthetic response loss") }, { data: null, error: null });
    const response = await upload(request(), context);
    expect(response.status).toBe(503);
    expect((await response.json()).message).toContain("uncertain");
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(queries.some((query) => query.table === "storage_cleanup_jobs")).toBe(false);
  });
  it.each(["08007", "40003"])("retains the object for indeterminate PostgreSQL outcome %s", async (code) => {
    admitUpload();
    results.push({ data: null, error: { code } }, { data: null, error: null });
    expect((await upload(request(), context)).status).toBe(503);
    expect(mocks.remove).not.toHaveBeenCalled();
  });
  it("retains positively reconciled metadata after a lost response", async () => {
    admitUpload();
    results.push({ thrown: new Error("Synthetic response loss") }, { data: evidence, error: null });
    const response = await upload(request(), context);
    expect(response.status).toBe(200);
    expect((await response.json()).evidence.id).toBe(evidenceId);
    expect(mocks.remove).not.toHaveBeenCalled();
    assertOwnerScope();
  });
  it("retains the object when reconciliation itself is unavailable", async () => {
    admitUpload();
    results.push({ data: null, error: { code: "23514" } }, { data: null, error: { code: "08006" } });
    expect((await upload(request(), context)).status).toBe(503);
    expect(mocks.remove).not.toHaveBeenCalled();
  });
  it("cleans a proven rolled-back insert after a definitive constraint rejection", async () => {
    admitUpload();
    results.push({ data: null, error: { code: "23514" } }, { data: null, error: null });
    expect((await upload(request(), context)).status).toBe(409);
    expect(mocks.remove).toHaveBeenCalledWith([mocks.upload.mock.calls[0][0]]);
  });
  it("queues compensation if deletion of a proven unlinked upload fails", async () => {
    admitUpload();
    results.push({ data: null, error: { code: "23514" } }, { data: null, error: null }, { data: null, error: null });
    mocks.remove.mockResolvedValue({ error: { message: "Synthetic outage" } });
    expect((await upload(request(), context)).status).toBe(409);
    expect(queries.at(-1)?.table).toBe("storage_cleanup_jobs");
    expect(queries.at(-1)?.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        owner_id: ownerId,
        document_bucket: CME_EVIDENCE_BUCKET,
        document_paths: [mocks.upload.mock.calls[0][0]],
        status: "pending",
      }),
    );
  });
  it("cleans only the losing object's path on a concurrent duplicate insert", async () => {
    admitUpload();
    results.push(
      { data: null, error: { code: "23505" } },
      { data: null, error: null },
      { data: evidence, error: null },
    );
    const response = await upload(request(), context);
    expect(response.status).toBe(200);
    expect((await response.json()).duplicate).toBe(true);
    expect(mocks.remove).toHaveBeenCalledWith([mocks.upload.mock.calls[0][0]]);
    expect(mocks.remove).not.toHaveBeenCalledWith([evidence.storage_path]);
  });
  it("issues only a short owner-and-entry-scoped attachment download without exposing metadata", async () => {
    results.push({ data: entry, error: null }, { data: evidence, error: null });
    const response = await download(request(), downloadContext);
    expect(response.status).toBe(303);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(mocks.signed).toHaveBeenCalledWith(evidence.storage_path, 60, { download: evidence.file_name });
    expect(mocks.storageBucket).toHaveBeenCalledWith(CME_EVIDENCE_BUCKET);
    assertOwnerScope();
    expect(queries[1].eq).toHaveBeenCalledWith("entry_id", entryId);
    expect(queries[1].eq).toHaveBeenCalledWith("id", evidenceId);
  });
  it("denies a mismatched evidence id without creating a signed URL", async () => {
    results.push({ data: entry, error: null }, { data: null, error: null });
    expect((await download(request(), downloadContext)).status).toBe(404);
    expect(mocks.signed).not.toHaveBeenCalled();
    assertOwnerScope();
  });
});

describe("removing a CME evidence file", () => {
  function removeRequest(body: unknown) {
    return new Request(`https://example.org/api/cme/entries/${entryId}/evidence/${evidenceId}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }
  const removedRow = {
    ...evidence,
    file_name: "Removed file",
    removed_at: "2026-09-24T01:00:00Z",
    removal_reason: "Contains a patient name",
  };

  it("records the reason, deletes the stored file, and returns the tombstone", async () => {
    results.push({ data: entry, error: null }, { data: { ...evidence, removed_at: null }, error: null });
    mocks.rpc.mockResolvedValue({ data: removedRow, error: null });
    const response = await remove(removeRequest({ reason: "Contains a patient name" }), downloadContext);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.evidence).toMatchObject({ removalReason: "Contains a patient name", fileName: "Removed file" });
    expect(mocks.rpc).toHaveBeenCalledWith("cme_remove_evidence", {
      p_owner_id: ownerId,
      p_evidence_id: evidenceId,
      p_reason: "Contains a patient name",
    });
    expect(mocks.remove).toHaveBeenCalledWith([evidence.storage_path]);
    assertOwnerScope();
  });

  it("refuses a removal without a reason, before touching the record", async () => {
    const response = await remove(removeRequest({ reason: " " }), downloadContext);
    expect(response.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("works in a closed year, because removal is for privacy", async () => {
    // No year lookup happens for a removal: assertEvidenceEntry is called read-only.
    results.push(
      { data: { ...entry, archived_at: "2026-09-01T00:00:00Z" }, error: null },
      { data: evidence, error: null },
    );
    mocks.rpc.mockResolvedValue({ data: removedRow, error: null });
    expect((await remove(removeRequest({ reason: "Wrong file uploaded" }), downloadContext)).status).toBe(200);
  });

  it("queues cleanup when storage does not answer, and still reports success", async () => {
    results.push({ data: entry, error: null }, { data: evidence, error: null }, { data: null, error: null });
    mocks.rpc.mockResolvedValue({ data: removedRow, error: null });
    mocks.remove.mockResolvedValue({ data: null, error: { message: "storage down" } });
    expect((await remove(removeRequest({ reason: "Wrong file uploaded" }), downloadContext)).status).toBe(200);
    expect(queries.at(-1)?.table).toBe("storage_cleanup_jobs");
  });

  it("says not found for a file already removed or owned by someone else", async () => {
    results.push({ data: entry, error: null }, { data: null, error: null });
    expect((await remove(removeRequest({ reason: "Wrong file uploaded" }), downloadContext)).status).toBe(404);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
