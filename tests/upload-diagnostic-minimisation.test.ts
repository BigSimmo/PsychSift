import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  admin: vi.fn(),
  dispatch: vi.fn(),
  upload: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));
const ownerId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

vi.mock("@/lib/env", () => ({
  env: {
    MAX_UPLOAD_MB: 150,
    MAX_CONCURRENT_UPLOADS: 1,
    MAX_IN_FLIGHT_UPLOAD_MB: 151,
    SUPABASE_DOCUMENT_BUCKET: "clinical-documents",
    SUPABASE_IMAGE_BUCKET: "clinical-images",
    WORKER_MAX_ATTEMPTS: 3,
  },
}));
vi.mock("@/lib/logger", () => ({ logger: { info: mocks.info, warn: mocks.warn, error: mocks.error } }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
vi.mock("@/lib/supabase/auth", async (original) => ({
  ...(await original<typeof import("@/lib/supabase/auth")>()),
  requireAuthenticatedUser: async () => ({ id: ownerId, appMetadata: { site_role: "administrator" } }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      getClaims: async () => ({
        data: {
          claims: {
            sub: ownerId,
            role: "authenticated",
            aal: "aal2",
            app_metadata: { site_role: "administrator" },
            amr: [{ method: "totp", timestamp: Math.floor(Date.now() / 1000) - 5 }],
          },
        },
        error: null,
      }),
    },
  }),
}));
vi.mock("@/lib/api-rate-limit", () => ({ consumeSubjectApiRateLimit: async () => ({ limited: false }) }));
vi.mock("@/lib/supabase/health", () => ({ probeSupabaseHealth: async () => ({ ok: true }) }));
vi.mock("@/lib/upload-structure", () => ({ assertUploadStructure: async () => undefined }));
vi.mock("@/lib/document-naming", () => ({
  planDocumentName: async ({ fileName }: { fileName: string }) => ({
    title: "Synthetic document",
    baseTitle: "Synthetic document",
    originalTitle: null,
    originalFileName: fileName,
    duplicateIndex: 1,
    duplicateGroupKey: "synthetic-group",
    duplicateReason: "none",
  }),
}));
vi.mock("@/lib/trusted-document-admission", async (original) => ({
  ...(await original<typeof import("@/lib/trusted-document-admission")>()),
  dispatchTrustedDocumentAdmission: mocks.dispatch,
  uploadTrustedDocumentBytes: mocks.upload,
}));

import { POST } from "@/app/api/upload/route";
import { TrustedDocumentAdmissionDispatchError } from "@/lib/trusted-document-admission";

// Wholly invented identifiers; deliberately not a pattern-dependent MRN redaction case.
const filename = "Synthetic_Mira_Quinn_DOB_1982-03-04.pdf";
const providerText = `Provider refused owner/private/${filename}; contact synthetic-person@example.invalid; token synthetic-private-value`;
const authority = {
  version: 1,
  sourceRole: "clinical_guideline",
  authorityBasis: "administrator_template",
  licencePolicy: "review_required",
  rightsEvidenceRef: "synthetic-rights-evidence",
  publisher: "Synthetic Publisher",
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

function request() {
  const form = new FormData();
  form.set("file", new File(["%PDF-1.7\n%%EOF"], filename, { type: "application/pdf" }));
  form.set("authority", JSON.stringify(authority));
  return new Request("http://localhost/api/upload", {
    method: "POST",
    body: form,
    headers: { "Idempotency-Key": "11111111-1111-4111-8111-111111111111" },
  });
}

function client({ ledgerFails = false, documentFails = false } = {}) {
  const remove = vi.fn(async () => ({ error: { message: providerText } }));
  const insert = vi.fn(async () => ({ error: ledgerFails ? { message: providerText } : null }));
  const maybeSingle = vi.fn(async () => ({ data: null, error: documentFails ? { message: providerText } : null }));
  const query = { select: () => query, eq: () => query, maybeSingle };
  const from = vi.fn((table: string) => {
    if (table === "storage_cleanup_jobs") return { insert };
    if (table === "documents") return query;
    throw new Error("Unexpected test table");
  });
  return { storage: { from: vi.fn(() => ({ remove })) }, from, remove, insert, maybeSingle };
}

async function assertSafeFailure(operation: Promise<Response>) {
  const settled = await operation.then(
    (response) => ({ response, rejected: null }),
    (rejected: unknown) => ({ response: null, rejected }),
  );
  const body = settled.response ? await settled.response.text() : "";
  const diagnostics = JSON.stringify({
    body,
    rejected: settled.rejected instanceof Error ? settled.rejected.message : settled.rejected,
    logs: [...mocks.info.mock.calls, ...mocks.warn.mock.calls, ...mocks.error.mock.calls],
  });
  for (const privateText of [
    filename,
    "Mira",
    "1982-03-04",
    "synthetic-person@example.invalid",
    "synthetic-private-value",
    "Provider refused",
  ]) {
    expect(diagnostics).not.toContain(privateText);
  }
  expect(settled.rejected).toBeNull();
  expect(settled.response?.status).toBe(500);
  expect(JSON.parse(body)).toMatchObject({ error: "Request failed.", code: "internal_error" });
  expect(JSON.parse(body)).not.toHaveProperty("duplicate");
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.dispatch.mockImplementation(async ({ replayOnly }: { replayOnly: boolean }) => {
    if (replayOnly) return { outcome: "not_found" };
    throw new TrustedDocumentAdmissionDispatchError("rejected", "duplicate_content");
  });
  mocks.upload.mockImplementation(async ({ intendedStoragePath }: { intendedStoragePath: string }) => ({
    storagePath: intendedStoragePath,
    collisionRecovered: false,
  }));
});

describe("upload diagnostics omit filenames and provider error content", () => {
  it("fails closed with a safe response when duplicate storage removal and the exact-path cleanup ledger both fail", async () => {
    const supabase = client({ ledgerFails: true });
    mocks.admin.mockReturnValue(supabase);

    await assertSafeFailure(POST(request()));

    expect(mocks.dispatch).toHaveBeenCalledTimes(2);
    expect(mocks.upload).toHaveBeenCalledTimes(1);
    const path = mocks.upload.mock.calls[0]![0].intendedStoragePath as string;
    expect(path).toContain(filename);
    expect(supabase.remove).toHaveBeenCalledExactlyOnceWith([path]);
    expect(supabase.insert).toHaveBeenCalledExactlyOnceWith({
      document_bucket: "clinical-documents",
      document_paths: [path],
      owner_id: ownerId,
      status: "pending",
      image_bucket: "clinical-images",
      image_paths: [],
    });
    // Diagnostics retain an opaque correlation reference, while only the scoped recovery row gets the exact path.
    expect(mocks.warn).toHaveBeenCalledWith("Duplicate upload storage cleanup failed", {
      storageObjectRef: createHash("sha256").update(path).digest("hex"),
      errorType: "UnknownError",
    });
    expect(mocks.error).toHaveBeenCalledTimes(1);
    expect(mocks.error.mock.calls[0]![1]).toEqual({ errorType: "Error" });
  });

  it("logs only the content-free error envelope for an ordinary provider failure", async () => {
    const supabase = client({ documentFails: true });
    mocks.admin.mockReturnValue(supabase);

    await assertSafeFailure(POST(request()));

    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.dispatch).not.toHaveBeenCalled();
    expect(mocks.warn).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalledTimes(1);
    expect(mocks.error.mock.calls[0]![0]).toEqual(expect.any(String));
    expect(mocks.error.mock.calls[0]![1]).toEqual({ errorType: "Error" });
  });
});
