import { describe, expect, it, vi } from "vitest";
import { assertExistingImportDocument, queueExistingImportDocument } from "../scripts/lib/import-document-queue";

const input = {
  documentId: "doc",
  ownerId: "owner",
  contentHash: "hash",
  batchId: "batch",
  force: true,
  maxAttempts: 3,
};
describe("bulk import existing-document queue", () => {
  it("uses one atomic owner/hash scoped operation for force, without destructive reset or separate writes", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { outcome: "enqueued" }, error: null });
    await expect(queueExistingImportDocument({ ...input, rpc })).resolves.toEqual({ outcome: "enqueued" });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("enqueue_import_document", {
      p_document_id: "doc",
      p_owner_id: "owner",
      p_content_hash: "hash",
      p_batch_id: "batch",
      p_force: true,
      p_max_attempts: 3,
    });
  });
  it("allows ordinary resume to reconcile an incomplete document instead of blindly skipping its hash", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { outcome: "enqueued" }, error: null });
    await expect(queueExistingImportDocument({ ...input, force: false, rpc })).resolves.toEqual({
      outcome: "enqueued",
    });
    expect(rpc.mock.calls[0][1].p_force).toBe(false);
  });
  it("preserves definite failure and ambiguous replies for identity replay, without compensating deletion", async () => {
    for (const result of [
      { data: null, error: { message: "insert rejected" } },
      { data: null, error: null },
    ]) {
      const rpc = vi.fn().mockResolvedValue(result);
      await expect(queueExistingImportDocument({ ...input, rpc })).rejects.toThrow();
      expect(rpc).toHaveBeenCalledTimes(1);
    }
  });
  it("refuses new backend intake before any storage or document action when admission authority is missing", () => {
    expect(() => assertExistingImportDocument(undefined)).toThrow("No bytes were uploaded");
    expect(() => assertExistingImportDocument({ id: "existing" })).not.toThrow();
  });
});
