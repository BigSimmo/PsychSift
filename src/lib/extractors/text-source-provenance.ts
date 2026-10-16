import { isUtf8 } from "node:buffer";
import { z } from "zod";
import { extractedTextSha256 } from "@/lib/extractors/docx-source-provenance";

const sha = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const reasonSchema = z.enum([
  "txt_utf8_replacement_unverified",
  "txt_non_utf8_bom_unsupported",
  "txt_normalization_sensitive_source",
  "txt_control_format_unverified",
  "txt_runtime_identity_unknown",
]);
export const textPageSourceProvenanceSchema = z
  .object({
    version: z.literal("extracted-page-source-v1"),
    format: z.literal("txt"),
    coordinateSpace: z.literal("txt_logical_document"),
    logicalUnitIndex: z.literal(1),
    physicalPageNumber: z.null(),
    sourceContentSha256: sha,
    sourceByteLength: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    sourceLocator: z.object({ kind: z.literal("whole_received_buffer") }).strict(),
    producer: z
      .object({
        contractVersion: z.literal("txt-node-utf8-v1"),
        route: z.literal("node_buffer_utf8"),
        nodeVersion: z.string().min(1).max(128).nullable(),
      })
      .strict(),
    decoding: z
      .object({
        decoderEncoding: z.literal("utf8"),
        validity: z.enum(["valid", "invalid"]),
        lossiness: z.enum(["none", "replacement"]),
        bom: z.enum(["utf8", "unsupported", "none"]),
        sourceEncodingClaim: z.literal("unverified"),
        bomHandling: z.literal("preserved"),
        lineEndingHandling: z.literal("unchanged"),
      })
      .strict(),
    sourceControlObservations: z
      .object({ hasNul: z.boolean(), hasLiteralBackslashU0000: z.boolean(), hasUnhandledControlOrFormat: z.boolean() })
      .strict(),
    structuralDisposition: z.enum(["retained", "unverified"]),
    reasonCodes: z.array(reasonSchema).max(5),
    textMapping: z.object({ status: z.literal("not_established"), offsets: z.null() }).strict(),
    textIdentity: z
      .object({
        originalExtractedTextSha256: sha,
        persistedTextSha256: sha,
        normalizationApplied: z.boolean(),
        metadataNormalizationApplied: z.boolean(),
        qualification: z.literal(
          "UTF-8 extracted/persisted text bytes; original received bytes identified separately; no character-span mapping",
        ),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, context) => {
    const reasons = textReasonCodes(value);
    if (
      value.reasonCodes.length !== reasons.length ||
      new Set(value.reasonCodes).size !== value.reasonCodes.length ||
      reasons.some((reason) => !value.reasonCodes.includes(reason)) ||
      value.structuralDisposition !== (reasons.length ? "unverified" : "retained") ||
      value.decoding.lossiness !== (value.decoding.validity === "valid" ? "none" : "replacement") ||
      (value.textIdentity.normalizationApplied &&
        !value.sourceControlObservations.hasNul &&
        !value.sourceControlObservations.hasLiteralBackslashU0000)
    )
      context.addIssue({ code: "custom", message: "txt_source_observations_inconsistent" });
  });
export type TextPageSourceProvenance = z.infer<typeof textPageSourceProvenanceSchema>;
export type TextSourceProvenanceErrorCode = "TXT_SOURCE_PROVENANCE_INVALID" | "TXT_SOURCE_PROVENANCE_IDENTITY_MISMATCH";
export class TextSourceProvenanceError extends Error {
  constructor(public readonly code: TextSourceProvenanceErrorCode) {
    super(code);
    this.name = "TextSourceProvenanceError";
  }
}
function textReasonCodes(value: {
  decoding: { validity: string; bom: string };
  sourceControlObservations: {
    hasNul: boolean;
    hasLiteralBackslashU0000: boolean;
    hasUnhandledControlOrFormat: boolean;
  };
  producer: { nodeVersion: string | null };
}): z.infer<typeof reasonSchema>[] {
  const reasons: z.infer<typeof reasonSchema>[] = [];
  if (value.decoding.validity === "invalid") reasons.push("txt_utf8_replacement_unverified");
  if (value.decoding.bom === "unsupported") reasons.push("txt_non_utf8_bom_unsupported");
  if (value.sourceControlObservations.hasNul || value.sourceControlObservations.hasLiteralBackslashU0000)
    reasons.push("txt_normalization_sensitive_source");
  if (value.sourceControlObservations.hasUnhandledControlOrFormat) reasons.push("txt_control_format_unverified");
  if (value.producer.nodeVersion === null) reasons.push("txt_runtime_identity_unknown");
  return reasons;
}
function observedBom(buffer: Buffer): TextPageSourceProvenance["decoding"]["bom"] {
  if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) return "utf8";
  if (
    (buffer[0] === 0xff && buffer[1] === 0xfe) ||
    (buffer[0] === 0xfe && buffer[1] === 0xff) ||
    (buffer[0] === 0 && buffer[1] === 0 && buffer[2] === 0xfe && buffer[3] === 0xff)
  )
    return "unsupported";
  return "none";
}
function observedControls(text: string, bom: string): TextPageSourceProvenance["sourceControlObservations"] {
  let hasUnhandledControlOrFormat = false;
  let index = 0;
  for (const character of text) {
    if (
      character === "\u0000" ||
      character === "\t" ||
      character === "\n" ||
      character === "\r" ||
      (index === 0 && character === "\ufeff" && bom === "utf8")
    ) {
      index += character.length;
      continue;
    }
    if (/[\p{Cc}\p{Cf}]/u.test(character)) {
      hasUnhandledControlOrFormat = true;
      break;
    }
    index += character.length;
  }
  return {
    hasNul: text.includes("\u0000"),
    hasLiteralBackslashU0000: text.includes("\\u0000"),
    hasUnhandledControlOrFormat,
  };
}
type TextPage = {
  pageNumber: number;
  text: string;
  ocrUsed?: boolean;
  needsOcr?: boolean;
  metadata?: { source_provenance?: unknown };
};

/** Fresh identity uses actual received bytes; persisted parsing preserves historical observations. */
export function validateTextSourcePages(pages: TextPage[], buffer?: Buffer) {
  if (
    pages.length !== 1 ||
    !pages[0] ||
    pages[0].pageNumber !== 1 ||
    typeof pages[0].text !== "string" ||
    pages[0].ocrUsed ||
    pages[0].needsOcr
  )
    throw new TextSourceProvenanceError("TXT_SOURCE_PROVENANCE_INVALID");
  const page = pages[0];
  const parsed = textPageSourceProvenanceSchema.safeParse(page.metadata?.source_provenance);
  if (!parsed.success || !page.text.isWellFormed())
    throw new TextSourceProvenanceError("TXT_SOURCE_PROVENANCE_INVALID");
  const value = parsed.data;
  const identity = value.textIdentity;
  const controls = observedControls(page.text, value.decoding.bom);
  if (
    identity.persistedTextSha256 !== extractedTextSha256(page.text) ||
    (!identity.normalizationApplied &&
      (identity.originalExtractedTextSha256 !== identity.persistedTextSha256 ||
        Object.keys(controls).some(
          (key) =>
            controls[key as keyof typeof controls] !== value.sourceControlObservations[key as keyof typeof controls],
        ))) ||
    (value.decoding.validity === "valid" && value.sourceContentSha256 !== identity.originalExtractedTextSha256) ||
    (value.decoding.validity === "valid" &&
      !identity.normalizationApplied &&
      value.sourceByteLength !== Buffer.byteLength(page.text, "utf8")) ||
    (value.decoding.bom === "utf8" && !page.text.startsWith("\ufeff"))
  )
    throw new TextSourceProvenanceError("TXT_SOURCE_PROVENANCE_IDENTITY_MISMATCH");
  if (buffer) {
    const decoded = buffer.toString("utf8");
    const bom = observedBom(buffer);
    const originalControls = observedControls(decoded, bom);
    if (
      page.text !== decoded ||
      value.sourceContentSha256 !== extractedTextSha256(buffer) ||
      value.sourceByteLength !== buffer.byteLength ||
      value.producer.nodeVersion !== process.version ||
      value.decoding.validity !== (isUtf8(buffer) ? "valid" : "invalid") ||
      value.decoding.bom !== bom ||
      identity.originalExtractedTextSha256 !== extractedTextSha256(decoded) ||
      identity.normalizationApplied ||
      identity.metadataNormalizationApplied ||
      Object.keys(originalControls).some(
        (key) =>
          originalControls[key as keyof typeof originalControls] !==
          value.sourceControlObservations[key as keyof typeof originalControls],
      )
    )
      throw new TextSourceProvenanceError("TXT_SOURCE_PROVENANCE_IDENTITY_MISMATCH");
  }
}

export function buildTextSourceProvenance(buffer: Buffer, text: string): TextPageSourceProvenance {
  const bom = observedBom(buffer);
  const valid = isUtf8(buffer);
  const textHash = extractedTextSha256(text);
  const observations = {
    producer: {
      contractVersion: "txt-node-utf8-v1" as const,
      route: "node_buffer_utf8" as const,
      nodeVersion: process.version || null,
    },
    decoding: {
      decoderEncoding: "utf8" as const,
      validity: valid ? ("valid" as const) : ("invalid" as const),
      lossiness: valid ? ("none" as const) : ("replacement" as const),
      bom,
      sourceEncodingClaim: "unverified" as const,
      bomHandling: "preserved" as const,
      lineEndingHandling: "unchanged" as const,
    },
    sourceControlObservations: observedControls(text, bom),
  };
  const reasons = textReasonCodes(observations);
  const result = textPageSourceProvenanceSchema.parse({
    version: "extracted-page-source-v1",
    format: "txt",
    coordinateSpace: "txt_logical_document",
    logicalUnitIndex: 1,
    physicalPageNumber: null,
    sourceContentSha256: extractedTextSha256(buffer),
    sourceByteLength: buffer.byteLength,
    sourceLocator: { kind: "whole_received_buffer" },
    ...observations,
    reasonCodes: reasons,
    structuralDisposition: reasons.length ? "unverified" : "retained",
    textMapping: { status: "not_established", offsets: null },
    textIdentity: {
      originalExtractedTextSha256: textHash,
      persistedTextSha256: textHash,
      normalizationApplied: false,
      metadataNormalizationApplied: false,
      qualification:
        "UTF-8 extracted/persisted text bytes; original received bytes identified separately; no character-span mapping",
    },
  });
  validateTextSourcePages([{ pageNumber: 1, text, ocrUsed: false, metadata: { source_provenance: result } }], buffer);
  return result;
}
