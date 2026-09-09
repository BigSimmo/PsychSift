import { describe, expect, it, vi } from "vitest";
import { compensateUploadedArtifactAndThrow } from "@/lib/storage-upload-compensation";

describe("compensateUploadedArtifactAndThrow", () => {
  it("removes exactly the uploaded path and rethrows the persistence error", async () => {
    const persistenceError = new Error("image row insert failed");
    const remove = vi.fn().mockResolvedValue({ error: null });
    const from = vi.fn().mockReturnValue({ remove });

    await expect(
      compensateUploadedArtifactAndThrow({
        storage: { from },
        bucket: "clinical-images",
        path: "owner/images/document/generation/image-1.png",
        persistenceError,
      }),
    ).rejects.toBe(persistenceError);

    expect(from).toHaveBeenCalledWith("clinical-images");
    expect(remove).toHaveBeenCalledWith(["owner/images/document/generation/image-1.png"]);
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("reports both errors when compensation fails", async () => {
    const remove = vi.fn().mockResolvedValue({ error: { message: "storage remove failed" } });

    await expect(
      compensateUploadedArtifactAndThrow({
        storage: { from: () => ({ remove }) },
        bucket: "clinical-images",
        path: "owner/images/document/generation/image-1.png",
        persistenceError: new Error("image row insert failed"),
      }),
    ).rejects.toThrow("image row insert failed; uploaded artifact cleanup failed: storage remove failed");
  });
});

import { IngestionAttempt, type IngestionFence } from "../supabase/functions/_shared/ingestion-attempt";
import { persistIngestionImage } from "../worker/behavior";
const uploadFence: IngestionFence = {
  job_kind: "node",
  job_id: "11111111-1111-4111-8111-111111111111",
  document_id: "22222222-2222-4222-8222-222222222222",
  worker_id: "worker",
  lease_token: "33333333-3333-4333-8333-333333333333",
  expected_generation_id: null,
  authority_digest: `sha256:${"a".repeat(64)}`,
};
const uploadGeneration = "44444444-4444-4444-8444-444444444444";
const immutablePath = `${uploadFence.document_id}/${uploadFence.lease_token}/${uploadGeneration}/55555555-5555-4555-8555-555555555555.png`;
describe("actual ingestion image publication", () => {
  it("always disables overwrite and attaches the exact server-assigned path", async () => {
    const rpc = vi.fn(async (name: string) => ({
      data: name === "prepare_ingestion_image_upload" ? { ok: true, storage_path: immutablePath } : { ok: true },
      error: null,
    }));
    const upload = vi.fn(async () => ({ error: null }));
    const result = await persistIngestionImage({
      attempt: new IngestionAttempt(uploadFence),
      generation: uploadGeneration,
      extension: "png",
      row: { document_id: uploadFence.document_id },
      rpc,
      upload,
    });
    expect(upload).toHaveBeenCalledWith(immutablePath, { upsert: false });
    expect(result.storage_path).toBe(immutablePath);
    expect(rpc).toHaveBeenLastCalledWith(
      "write_ingestion_base_artifacts",
      expect.objectContaining({ p_fence: uploadFence, p_images: [result] }),
    );
  });
  it("refuses late upload attachment after the attempt is canceled", async () => {
    const attempt = new IngestionAttempt(uploadFence);
    const rpc = vi.fn(async () => ({ data: { ok: true, storage_path: immutablePath }, error: null }));
    const upload = vi.fn(async () => {
      attempt.cancel();
      return { error: null };
    });
    await expect(
      persistIngestionImage({
        attempt,
        generation: uploadGeneration,
        extension: "png",
        row: { document_id: uploadFence.document_id },
        rpc,
        upload,
      }),
    ).rejects.toMatchObject({ code: "lease_lost" });
    expect(rpc).toHaveBeenCalledOnce();
    expect(upload).toHaveBeenCalledOnce();
  });
  it("retains uploaded bytes when attachment committed but its response was lost", async () => {
    let attached = false;
    const rpc = vi.fn(async (name: string) => {
      if (name === "prepare_ingestion_image_upload")
        return { data: { ok: true, storage_path: immutablePath }, error: null };
      attached = true;
      return { data: null, error: { message: "response lost" } };
    });
    const upload = vi.fn(async () => ({ error: null }));
    await expect(
      persistIngestionImage({
        attempt: new IngestionAttempt(uploadFence),
        generation: uploadGeneration,
        extension: "png",
        row: { document_id: uploadFence.document_id },
        rpc,
        upload,
      }),
    ).rejects.toThrow("response lost");
    expect(attached).toBe(true);
    expect(upload).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledTimes(2);
  });
});
