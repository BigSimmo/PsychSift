import { mkdtemp, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildGenerationRetentionPacket,
  captureGenerationImages,
  resumeGenerationRetentionPacket,
} from "../worker/generation-evidence";
import { bytesDigest, generationEvidenceDigest } from "@/lib/ingestion-generation-evidence";
import type { ExtractedDocument } from "@/lib/types";

const id = "00000000-0000-4000-8000-000000000001";
const generation = "00000000-0000-4000-8000-000000000002";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
  "base64",
);
async function ownedFixture(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(path.join(tmpdir(), "generation-image-test-"));
  try {
    await run(root);
  } finally {
    if (
      path.dirname(path.resolve(root)) !== path.resolve(tmpdir()) ||
      !path.basename(root).startsWith("generation-image-test-")
    )
      throw new Error("test_cleanup_scope_changed");
    await rm(root, { recursive: true, force: true });
  }
}
function base(extracted: ExtractedDocument) {
  return {
    documentId: id,
    generationId: generation,
    originalBytes: Buffer.from("original docx"),
    extracted,
    persistedPages: [{ page_number: 1, text: "qualified source text", ocr_used: false, metadata: {} }],
  };
}
function capture(extracted: ExtractedDocument, root: string) {
  return captureGenerationImages({
    extracted,
    trustedTemporaryRoots: [root],
    fileName: "synthetic.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
}
describe("qualified extracted-image private retention", () => {
  it("retains actual owned PNG bytes for distinct placements without source-image completeness", async () => {
    await ownedFixture(async (root) => {
      const imagePath = path.join(root, "image.png");
      await writeFile(imagePath, png);
      const extracted: ExtractedDocument = {
        pages: [{ pageNumber: 1, text: "qualified source text" }],
        images: [
          {
            path: imagePath,
            pageNumber: null,
            mimeType: "image/png",
            bbox: null,
            width: null,
            height: null,
            sourceKind: "embedded",
            metadata: { file_name: "word/media/image1.png", source_kind: "docx_media" },
          },
          { path: imagePath, pageNumber: 1, mimeType: "image/png", bbox: [0, 1, 2, 3], width: 1, height: 1 },
        ],
      };
      const capturedImages = await capture(extracted, root);
      const packet = buildGenerationRetentionPacket({ ...base(extracted), capturedImages });
      const binaries = packet.artifacts.filter((row) => row.representation === "image_binary");
      const provenance = packet.artifacts
        .filter((row) => row.representation === "image_provenance")
        .map((row) => JSON.parse(Buffer.from(row.bytesHex, "hex").toString("utf8")));
      expect(binaries.map((row) => row.unitId.key)).toEqual(["image:1:binary", "image:2:binary"]);
      expect(binaries.map((row) => row.sha256)).toEqual([bytesDigest(png), bytesDigest(png)]);
      expect(binaries.every((row) => row.bytesHex === png.toString("hex") && row.byteLength === png.length)).toBe(true);
      expect(provenance[0]).toMatchObject({
        documentId: id,
        generationId: generation,
        placementId: "1",
        qualification: "derived_unverified",
        descriptor: { pageNumber: null, bbox: null, width: null, height: null, metadata: extracted.images[0].metadata },
      });
      expect(provenance[1].descriptor).not.toHaveProperty("sourceKind");
      expect(provenance[1].descriptor).not.toHaveProperty("metadata");
      expect(JSON.stringify(provenance)).not.toContain(JSON.stringify(root).slice(1, -1));
      expect(provenance.every((row) => !Object.hasOwn(row.descriptor, "path"))).toBe(true);
      expect(
        packet.registration.declarations.units
          .filter((unit) => unit.id.key.startsWith("image:"))
          .every((unit) => unit.qualification === "derived_unverified" && unit.required),
      ).toBe(true);
      expect(packet.declarations.groups.some((group) => group.family === "images")).toBe(false);
      expect(packet.registration.sourceExpectation.tag).toBe("unknown");
      const inventory = {
        documentId: id,
        generationId: generation,
        sourceSha256: packet.registration.sourceSha256,
        sourceByteLength: packet.registration.sourceByteLength,
        sourceExpectation: packet.registration.sourceExpectation,
        sourceExpectationDigest: packet.registration.sourceExpectationSha256,
        registration: packet.registration,
        artifacts: packet.artifacts,
      };
      expect(resumeGenerationRetentionPacket({ ...base(extracted), capturedImages }, inventory).registration).toEqual(
        packet.registration,
      );
      await writeFile(imagePath, Buffer.concat([png, Buffer.from("changed")]));
      const changed = await capture(extracted, root);
      expect(() => resumeGenerationRetentionPacket({ ...base(extracted), capturedImages: changed }, inventory)).toThrow(
        "immutable_generation_registration",
      );
      expect(() =>
        buildGenerationRetentionPacket({
          ...base(extracted),
          capturedImages: [{ ...capturedImages[0], bytesHex: capturedImages[0].bytesHex.slice(2) }, capturedImages[1]],
        }),
      ).toThrow("retained_artifact_bytes_mismatch");
      expect(() =>
        buildGenerationRetentionPacket({
          ...base(extracted),
          capturedImages: [
            { ...capturedImages[0], bytesHex: "", byteLength: 0, sha256: bytesDigest(Buffer.alloc(0)) },
            capturedImages[1],
          ],
        }),
      ).toThrow("retained_artifact_bytes_mismatch");
      expect(() =>
        buildGenerationRetentionPacket({
          ...base(extracted),
          capturedImages: [{ ...capturedImages[0], ordinal: 2 }, capturedImages[1]],
        }),
      ).toThrow("retained_image_capture_identity_mismatch");
      expect(() =>
        buildGenerationRetentionPacket({
          ...base(extracted),
          capturedImages: [
            { ...capturedImages[0], descriptor: { ...capturedImages[0].descriptor, pageNumber: 2 } },
            capturedImages[1],
          ],
        }),
      ).toThrow("retained_image_capture_identity_mismatch");
    });
  });
  it("refuses missing, foreign, traversed and symlinked files before retained bytes", async () => {
    await ownedFixture(async (root) => {
      const imagePath = path.join(root, "image.png");
      const extracted: ExtractedDocument = {
        pages: [{ pageNumber: 1, text: "source" }],
        images: [{ path: imagePath, pageNumber: null, mimeType: "image/png" }],
      };
      await expect(capture(extracted, root)).rejects.toThrow("retained_image_capture_refused");
      await writeFile(imagePath, png);
      // An unnormalized traversal is rejected even when it resolves to an owned file.
      await expect(
        capture(
          {
            ...extracted,
            images: [
              { ...extracted.images[0], path: root + path.sep + "child" + path.sep + ".." + path.sep + "image.png" },
            ],
          },
          root,
        ),
      ).rejects.toThrow("retained_image_capture_refused");
      await ownedFixture(async (foreign) => {
        const foreignPath = path.join(foreign, "foreign.png");
        await writeFile(foreignPath, png);
        await expect(
          capture({ ...extracted, images: [{ ...extracted.images[0], path: foreignPath }] }, root),
        ).rejects.toThrow("retained_image_capture_refused");
        const linkedDirectory = path.join(root, "linked");
        await symlink(foreign, linkedDirectory, process.platform === "win32" ? "junction" : "dir");
        await expect(
          capture(
            { ...extracted, images: [{ ...extracted.images[0], path: path.join(linkedDirectory, "foreign.png") }] },
            root,
          ),
        ).rejects.toThrow("retained_image_capture_refused");
      });
      await writeFile(imagePath, Buffer.alloc(0));
      await expect(capture(extracted, root)).rejects.toThrow("retained_image_capture_refused");
    });
  });
  it("keeps the no-image plan byte-identical and rejects malformed placement data", async () => {
    const extracted: ExtractedDocument = { pages: [{ pageNumber: 1, text: "qualified source text" }], images: [] };
    expect(
      await captureGenerationImages({
        extracted,
        trustedTemporaryRoots: [],
        fileName: "plain.txt",
        mimeType: "text/plain",
      }),
    ).toEqual([]);
    expect(generationEvidenceDigest(buildGenerationRetentionPacket(base(extracted)))).toBe(
      generationEvidenceDigest(buildGenerationRetentionPacket({ ...base(extracted), capturedImages: [] })),
    );
    await ownedFixture(async (root) => {
      const imagePath = path.join(root, "image.png");
      await writeFile(imagePath, png);
      await expect(
        capture(
          {
            ...extracted,
            images: [{ path: imagePath, pageNumber: null, mimeType: "image/png", bbox: [0, 1, Number.NaN, 3] }],
          },
          root,
        ),
      ).rejects.toThrow();
    });
  });
});
