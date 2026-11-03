import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ parent: true, clinical: true, stale: false, rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: state.from, rpc: state.rpc }) }));
vi.mock("@/lib/api-rate-limit", () => ({
  rateLimitJsonResponse: () => Response.json({ error: "limited" }, { status: 429 }),
}));
vi.mock("@/lib/public-api-access", () => ({
  enforceDocumentReadRateLimit: async () => ({
    access: { ownerId: "10000000-0000-4000-8000-000000000009" },
    rateLimit: { limited: false },
  }),
  withOwnerReadScope: (query: unknown) => query,
}));
vi.mock("@/lib/clinical-access", () => ({
  requireSignedInClinicalAccess: () => {
    if (!state.clinical) throw new Error("clinical_access_required");
  },
}));
vi.mock("@/lib/supabase/auth", () => ({
  AuthenticationError: class extends Error {},
  unauthorizedResponse: () => Response.json({ error: "unauthorized" }, { status: 401 }),
}));
vi.mock("@/lib/http", () => ({
  publicErrorResponse: (message: string, status = 400) => Response.json({ message }, { status }),
  jsonError: () => Response.json({ error: "failed" }, { status: 500 }),
}));
import { GET } from "../src/app/api/images/[id]/content/route";
const id = "10000000-0000-4000-8000-000000000001",
  documentId = "10000000-0000-4000-8000-000000000002",
  generationId = "10000000-0000-4000-8000-000000000003";
const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const sha256 = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
beforeEach(() => {
  state.parent = true;
  state.clinical = true;
  state.stale = false;
  vi.clearAllMocks();
  state.from.mockImplementation((table: string) => {
    const query = {
      select: () => query,
      eq: () => query,
      maybeSingle: async () => ({
        error: null,
        data:
          table === "documents"
            ? state.parent
              ? { id: documentId, metadata: { index_generation_id: generationId } }
              : null
            : {
                document_id: documentId,
                storage_path: `managed-pdf/${documentId}/${generationId}/1`,
                metadata: {
                  index_generation_id: state.stale ? id : generationId,
                  artifact_generation_id: state.stale ? id : generationId,
                  managed_artifact_reference: {
                    version: "managed-pdf-image-v1",
                    documentId,
                    generationId,
                    imageOrdinal: 1,
                    sha256,
                  },
                },
              },
      }),
    };
    return query;
  });
  state.rpc.mockResolvedValue({
    error: null,
    data: { bytesHex: bytes.toString("hex"), sha256, byteLength: bytes.length, mimeType: "image/png" },
  });
});
const get = () =>
  GET(new Request(`https://synthetic.invalid/api/images/${id}/content`), { params: Promise.resolve({ id }) });
describe("managed PDF image content route", () => {
  it("returns bounded private bytes only after parent access and active generation checks", async () => {
    const result = await get();
    expect(result.status).toBe(200);
    expect(Buffer.from(await result.arrayBuffer())).toEqual(bytes);
    expect(result.headers.get("cache-control")).toBe("private, no-store");
    expect(result.headers.get("x-content-type-options")).toBe("nosniff");
    expect(state.rpc).toHaveBeenCalledExactlyOnceWith("read_managed_pdf_image", {
      p_image_id: id,
      p_document_id: documentId,
      p_generation: generationId,
    });
  });
  it("does not read retained bytes for an inaccessible parent", async () => {
    state.parent = false;
    expect((await get()).status).toBe(404);
    expect(state.rpc).not.toHaveBeenCalled();
  });
  it("does not read retained bytes for an inactive generation", async () => {
    state.stale = true;
    expect((await get()).status).toBe(404);
    expect(state.rpc).not.toHaveBeenCalled();
  });
  it("does not query image or bytes before clinical access", async () => {
    state.clinical = false;
    expect((await get()).status).toBe(500);
    expect(state.from).not.toHaveBeenCalled();
    expect(state.rpc).not.toHaveBeenCalled();
  });
  it("refuses corrupt retained content", async () => {
    state.rpc.mockResolvedValue({
      error: null,
      data: { bytesHex: "00", sha256, byteLength: 1, mimeType: "image/png" },
    });
    expect((await get()).status).toBe(500);
  });
});
