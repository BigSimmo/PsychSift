import { createHash } from "node:crypto";
import { z } from "zod";

const referenceSchema = z
  .object({
    version: z.literal("managed-pdf-image-v1"),
    documentId: z.uuid(),
    generationId: z.uuid(),
    imageOrdinal: z.number().int().positive(),
    sha256: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  })
  .strict();
export type ManagedPdfImageReference = z.infer<typeof referenceSchema>;
export function managedPdfImageReference(
  metadata: unknown,
  documentId: string,
  generationId: string | null,
  storagePath: string,
): ManagedPdfImageReference | null {
  if (!metadata || typeof metadata !== "object" || !("managed_artifact_reference" in metadata)) {
    if (storagePath.startsWith("managed-pdf/")) throw new Error("managed_pdf_image_reference_required");
    return null;
  }
  const ref = referenceSchema.parse((metadata as Record<string, unknown>).managed_artifact_reference);
  if (
    ref.documentId !== documentId ||
    ref.generationId !== generationId ||
    storagePath !== `managed-pdf/${documentId}/${generationId}/${ref.imageOrdinal}`
  )
    throw new Error("managed_pdf_image_reference_mismatch");
  return ref;
}

const maxBytes = 16 * 1024 * 1024;
const imageSchema = z
  .object({
    bytesHex: z
      .string()
      .min(2)
      .max(maxBytes * 2)
      .regex(/^(?:[a-f0-9]{2})+$/),
    sha256: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    byteLength: z.number().int().positive().max(maxBytes),
    mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]),
  })
  .strict();
/** The caller must authorize document access before invoking the service-only read RPC. */
export function decodeManagedPdfImage(value: unknown, reference: ManagedPdfImageReference) {
  const image = imageSchema.parse(value),
    bytes = Buffer.from(image.bytesHex, "hex");
  if (
    bytes.length !== image.byteLength ||
    image.sha256 !== reference.sha256 ||
    `sha256:${createHash("sha256").update(bytes).digest("hex")}` !== reference.sha256
  )
    throw new Error("managed_pdf_image_content_mismatch");
  const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const webp = bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
  if (!(image.mimeType === "image/png" ? png : image.mimeType === "image/jpeg" ? jpeg : webp))
    throw new Error("managed_pdf_image_media_mismatch");
  return { bytes, mimeType: image.mimeType };
}
