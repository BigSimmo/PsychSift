import { createHash } from "node:crypto";
import { z } from "zod";
import { australianSourcePolicyVersion } from "./australian-source-catalogue";

const uuid = z.uuid();
const digest = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const bareDigest = z.string().regex(/^[0-9a-f]{64}$/);
const field = z
  .object({ beforePresent: z.boolean(), beforeValue: z.unknown(), afterValue: z.string() })
  .strict()
  .superRefine((value, context) => {
    if (!Object.hasOwn(value, "beforeValue") || (!value.beforePresent && value.beforeValue !== null))
      context.addIssue({ code: "custom", message: "Absent before keys require an explicit null witness" });
  });
const comparison = z
  .object({
    scope: z.literal("retained-current-vs-admitted-original"),
    sourceSha256: digest,
    expectationDigest: digest,
    sourceByteLength: z.number().int().positive().max(2097152),
    evidenceReference: z.string().min(1).max(500),
    changeState: z.literal("unchanged"),
  })
  .strict();

/** Historical invocation actor/time is deliberately absent: later approval supplies attestation. */
export const adminReferencePreparationReceiptSchema = z
  .object({
    version: z.literal("admin-text-reference-preparation-v1"),
    documentId: uuid,
    generationId: uuid,
    provenanceOwnerId: uuid,
    admission: z.object({ eventId: uuid, digest }).strict(),
    candidate: z.object({ authorityDigest: digest, registrationDigest: digest, sourceSnapshotDigest: digest }).strict(),
    sealDigest: digest,
    source: z
      .object({
        sha256: digest,
        byteLength: z.number().int().positive().max(2097152),
        expectationDigest: digest,
        witnessDigest: digest,
      })
      .strict(),
    populations: z.object({ chunksDigest: digest, sectionsDigest: digest }).strict(),
    completedDocumentDigest: digest,
    preparedDocumentDigest: digest,
    preparedReviewedStateDigest: bareDigest,
    delta: z
      .object({
        corpus_scope: field,
        source_catalogue_key: field,
        source_policy_version: field,
        publisher_code: field,
        change_state: field,
      })
      .strict(),
    comparison,
  })
  .strict()
  .superRefine((receipt, context) => {
    if (
      receipt.delta.corpus_scope.afterValue !== "australian_public" ||
      receipt.delta.source_catalogue_key.afterValue !== "nhmrc" ||
      receipt.delta.source_policy_version.afterValue !== australianSourcePolicyVersion ||
      receipt.delta.publisher_code.afterValue !== "NHMRC" ||
      receipt.delta.change_state.afterValue !== "unchanged" ||
      receipt.comparison.sourceSha256 !== receipt.source.sha256 ||
      receipt.comparison.expectationDigest !== receipt.source.expectationDigest ||
      receipt.comparison.sourceByteLength !== receipt.source.byteLength
    )
      context.addIssue({
        code: "custom",
        message: "Preparation receipt delta and comparison must bind the exact NHMRC source",
      });
  });

export type AdminReferencePreparationReceipt = z.infer<typeof adminReferencePreparationReceiptSchema>;
export const adminReferencePreparationReceiptByteLimit = 13500;
const prefix = "admin-txt-prep-v1:";
const partPattern = /^admin-txt-prep-v1:([0-9a-f]{64}):([0-9]{2})\/([0-9]{2}):([A-Za-z0-9+/]+={0,2})$/;
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

function fail(): never {
  throw new Error("admin_reference_preparation_evidence_invalid");
}

function parseBytes(bytes: Buffer) {
  if (!bytes.length || bytes.length > adminReferencePreparationReceiptByteLimit) fail();
  let text: string;
  try {
    text = new TextDecoder("utf8", { fatal: true }).decode(bytes);
  } catch {
    return fail();
  }
  if (!Buffer.from(text, "utf8").equals(bytes)) fail();
  return adminReferencePreparationReceiptSchema.parse(JSON.parse(text));
}

/** Receives canonical SQL jsonb::text bytes; it does not replace them with JS serialization. */
export function encodeAdminReferencePreparationEvidence(bytes: Buffer): readonly string[] {
  parseBytes(bytes);
  const encoded = bytes.toString("base64"),
    sha256 = hash(bytes);
  const total = Math.ceil(encoded.length / 400);
  if (total < 1 || total > 45) fail();
  return Object.freeze(
    Array.from(
      { length: total },
      (_, index) =>
        `${prefix}${sha256}:${String(index + 1).padStart(2, "0")}/${String(total).padStart(2, "0")}:${encoded.slice(index * 400, (index + 1) * 400)}`,
    ),
  );
}

/** Only actual immutable approval evidence may be passed by the published server supplier. */
export function decodeAdminReferencePreparationEvidence(references: readonly string[]) {
  if (
    references.length < 1 ||
    references.length > 50 ||
    references.some((ref) => typeof ref !== "string" || !ref.length || ref.length > 500 || ref.trim() !== ref)
  )
    fail();
  const parts = references.filter((ref) => ref.startsWith(prefix));
  if (!parts.length || parts.length > 45) fail();
  const parsed = parts.map((part) => partPattern.exec(part) ?? fail());
  const sha256 = parsed[0][1],
    total = Number(parsed[0][3]);
  if (
    total !== parts.length ||
    total < 1 ||
    total > 45 ||
    parsed.some(
      (part, index) =>
        part[1] !== sha256 ||
        Number(part[3]) !== total ||
        Number(part[2]) !== index + 1 ||
        part[4].length > 400 ||
        (index < total - 1 && (part[4].length !== 400 || part[4].includes("="))),
    )
  )
    fail();
  const base64 = parsed.map((part) => part[4]).join("");
  const bytes = Buffer.from(base64, "base64");
  if (bytes.toString("base64") !== base64 || hash(bytes) !== sha256) fail();
  const receipt = parseBytes(bytes);
  // Enforce the exact encoding, preserving order among unrelated evidence references.
  if (encodeAdminReferencePreparationEvidence(bytes).some((part, index) => part !== parts[index])) fail();
  return Object.freeze({ receipt, bytes: Buffer.from(bytes), sha256: `sha256:${sha256}` as const });
}
