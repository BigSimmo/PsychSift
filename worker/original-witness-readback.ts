import { isUtf8 } from "node:buffer";
import { z } from "zod";
import {
  bytesDigest,
  generationEvidenceBytes,
  generationEvidenceDigest,
  parseGenerationDeclarations,
  parseOriginalApplicabilityWitness,
  parseSourceExpectation,
  unitIdSchema,
} from "../src/lib/ingestion-generation-evidence";

const digest = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const length = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const artifactLength = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const witnessId = { family: "private_objects", key: "original-source-expectation-witness" } as const;
const unavailableSchema = z
  .object({
    status: z.literal("unavailable"),
    reason: z.enum(["source_expectation_unavailable", "witness_not_retained"]),
  })
  .strict();
const retainedSchema = z
  .object({
    status: z.literal("retained"),
    documentId: z.string().uuid(),
    generationId: z.string().uuid(),
    sourceSha256: digest,
    sourceByteLength: length,
    sourceExpectationDigest: digest,
    unitId: z
      .object({ family: z.literal("private_objects"), key: z.literal("original-source-expectation-witness") })
      .strict(),
    representation: z.literal("source_expectation_witness"),
    bytesHex: z.string().regex(/^(?:[0-9a-f]{2})*$/),
    sha256: digest,
    byteLength: artifactLength,
  })
  .strict();
const inventorySchema = z
  .object({
    version: z.literal(1),
    documentId: z.string().uuid(),
    generationId: z.string().uuid(),
    sourceSha256: digest,
    sourceByteLength: length,
    sourceExpectation: z.unknown(),
    sourceExpectationDigest: digest,
    registration: z
      .object({
        version: z.literal(1),
        sourceSha256: digest,
        sourceByteLength: length,
        sourceExpectation: z.unknown(),
        sourceExpectationHex: z.string().regex(/^(?:[0-9a-f]{2})+$/),
        sourceExpectationSha256: digest,
        declarations: z.unknown(),
      })
      .passthrough(),
    artifacts: z.array(
      z
        .object({
          unitId: unitIdSchema,
          groupKey: z.string(),
          representation: z.string(),
          sourceSha256: digest,
          sha256: digest,
          byteLength: artifactLength,
        })
        .passthrough(),
    ),
    retainedOriginalWitness: z.unknown().optional(),
  })
  .passthrough();

function refuse(): never {
  throw new Error("retained_original_witness_identity_mismatch");
}

/** Private transport decoder. The caller must obtain inventory through the current fenced RPC.
 * Byte binding cannot establish the independent author's trust, native fidelity or coverage.
 */
export function decodeRetainedOriginalWitness(args: {
  documentId: string;
  generationId: string;
  originalBytes: Buffer;
  inventory: unknown;
}) {
  generationEvidenceBytes(args.inventory);
  const parsed = inventorySchema.safeParse(args.inventory);
  if (!parsed.success || !Buffer.isBuffer(args.originalBytes)) refuse();
  const inventory = parsed.data;
  const registration = inventory.registration;
  let source: ReturnType<typeof parseSourceExpectation>;
  try {
    source = parseSourceExpectation(inventory.sourceExpectation);
  } catch (error) {
    if (error instanceof z.ZodError) refuse();
    throw error;
  }
  const expectationBytes = Buffer.from(registration.sourceExpectationHex, "hex");
  if (!isUtf8(expectationBytes)) refuse();
  let encodedExpectation: unknown;
  try {
    encodedExpectation = JSON.parse(expectationBytes.toString("utf8"));
  } catch {
    refuse();
  }
  if (
    inventory.documentId !== args.documentId ||
    inventory.generationId !== args.generationId ||
    inventory.sourceSha256 !== bytesDigest(args.originalBytes) ||
    inventory.sourceByteLength !== args.originalBytes.length ||
    source.sourceSha256 !== inventory.sourceSha256 ||
    registration.sourceSha256 !== inventory.sourceSha256 ||
    registration.sourceByteLength !== inventory.sourceByteLength ||
    registration.sourceExpectationSha256 !== inventory.sourceExpectationDigest ||
    bytesDigest(expectationBytes) !== inventory.sourceExpectationDigest ||
    generationEvidenceDigest(encodedExpectation) !== generationEvidenceDigest(source) ||
    generationEvidenceDigest(registration.sourceExpectation) !== generationEvidenceDigest(source)
  )
    refuse();
  const refs = inventory.artifacts.filter(
    (row) => row.unitId.family === witnessId.family && row.unitId.key === witnessId.key,
  );
  if (refs.length > 1) refuse();
  if (inventory.retainedOriginalWitness === undefined)
    return Object.freeze({ status: "unavailable" as const, reason: "legacy_inventory_payload_missing" as const });
  const unavailable = unavailableSchema.safeParse(inventory.retainedOriginalWitness);
  if (unavailable.success) {
    if (
      refs.length !== 0 ||
      (unavailable.data.reason === "source_expectation_unavailable") !== (source.tag !== "known")
    )
      refuse();
    return Object.freeze(unavailable.data);
  }
  const retained = retainedSchema.safeParse(inventory.retainedOriginalWitness);
  if (!retained.success || source.tag !== "known" || refs.length !== 1) refuse();
  const payload = retained.data;
  const ref = refs[0];
  let declarations: ReturnType<typeof parseGenerationDeclarations>;
  try {
    declarations = parseGenerationDeclarations(registration.declarations);
  } catch (error) {
    if (error instanceof z.ZodError) refuse();
    throw error;
  }
  const declared = declarations.units.filter(
    (unit) => unit.id.family === witnessId.family && unit.id.key === witnessId.key,
  );
  if (
    declared.length !== 1 ||
    declared[0].groupKey !== "private_objects" ||
    declared[0].representation !== "source_expectation_witness" ||
    ref.groupKey !== "private_objects" ||
    ref.representation !== "source_expectation_witness" ||
    ref.sourceSha256 !== inventory.sourceSha256 ||
    ref.sha256 !== payload.sha256 ||
    ref.byteLength !== payload.byteLength ||
    payload.documentId !== args.documentId ||
    payload.generationId !== args.generationId ||
    payload.sourceSha256 !== inventory.sourceSha256 ||
    payload.sourceByteLength !== inventory.sourceByteLength ||
    payload.sourceExpectationDigest !== inventory.sourceExpectationDigest ||
    payload.sha256 !== source.witness!.sha256 ||
    payload.bytesHex.length !== payload.byteLength * 2
  )
    refuse();
  const bytes = Buffer.from(payload.bytesHex, "hex");
  if (bytes.length !== payload.byteLength || bytesDigest(bytes) !== payload.sha256) refuse();
  // Typed witnesses are validated; genuinely opaque legacy bytes remain opaque.
  parseOriginalApplicabilityWitness({
    sourceExpectation: source,
    originalBytes: args.originalBytes,
    witnessBytes: bytes,
  });
  return Object.freeze({ status: "retained" as const, witnessBytes: bytes });
}
