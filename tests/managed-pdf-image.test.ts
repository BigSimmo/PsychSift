import { createHash } from "node:crypto";
import { describe, it, expect } from "vitest";
import { decodeManagedPdfImage, managedPdfImageReference } from "../src/lib/managed-pdf-image";
const documentId = "10000000-0000-4000-8000-000000000001",
  generationId = "10000000-0000-4000-8000-000000000002";
const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const ref = {
  version: "managed-pdf-image-v1" as const,
  documentId,
  generationId,
  imageOrdinal: 1,
  sha256: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
};
const path = `managed-pdf/${documentId}/${generationId}/1`;
describe("private managed PDF image reads", () => {
  it("binds exact document, committed generation, ordinal and retained bytes", () => {
    const parsed = managedPdfImageReference({ managed_artifact_reference: ref }, documentId, generationId, path)!;
    expect(
      decodeManagedPdfImage(
        { bytesHex: bytes.toString("hex"), sha256: ref.sha256, byteLength: bytes.length, mimeType: "image/png" },
        parsed,
      ).bytes,
    ).toEqual(bytes);
  });
  it("preserves existing Storage images", () =>
    expect(managedPdfImageReference({}, documentId, generationId, "old/image.png")).toBeNull());
  it("refuses sentinel paths without a valid reference", () =>
    expect(() => managedPdfImageReference({}, documentId, generationId, path)).toThrow());
  it.each([null, "10000000-0000-4000-8000-000000000003"])("refuses stale or absent generation %s", (generation) =>
    expect(() => managedPdfImageReference({ managed_artifact_reference: ref }, documentId, generation, path)).toThrow(),
  );
  it("refuses another document and mismatching ordinal path", () => {
    expect(() =>
      managedPdfImageReference({ managed_artifact_reference: ref }, generationId, generationId, path),
    ).toThrow();
    expect(() =>
      managedPdfImageReference({ managed_artifact_reference: ref }, documentId, generationId, path + "1"),
    ).toThrow();
  });
  it("refuses corrupt retained image bytes, counts and MIME", () => {
    const value = {
      bytesHex: bytes.toString("hex"),
      sha256: ref.sha256,
      byteLength: bytes.length,
      mimeType: "image/png",
    };
    for (const change of [
      { bytesHex: "00" },
      { byteLength: 7 },
      { mimeType: "image/jpeg" },
      { sha256: `sha256:${"a".repeat(64)}` },
    ])
      expect(() => decodeManagedPdfImage({ ...value, ...change }, ref)).toThrow();
  });
});
