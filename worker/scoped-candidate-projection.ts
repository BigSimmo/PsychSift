import { buildImageTag } from "../src/lib/chunking";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  bytesDigest,
  freezeGenerationEvidence,
  generationEvidenceBytes,
  generationEvidenceDigest,
  parseGenerationArtifact,
  parseOriginalApplicabilityWitness,
  unitIdSchema,
  unitIdentity,
} from "../src/lib/ingestion-generation-evidence";
import {
  candidateImageRowSchema,
  candidateTableFactRowSchema,
  preparedRowSchema,
  retainedCandidateImages,
} from "./candidate-chunks";
import type { buildGenerationRetentionPacket } from "./generation-evidence";
import type { ExtractedDocument } from "../src/lib/types";

const uuid = z.uuid();
const digest = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const family = z.enum(["images", "chunks", "table_facts"]);
const positive = z.number().int().positive().safe();
const MAX_ARTIFACT_BYTES = 2 * 1024 * 1024;
const MAX_TRANSPORT_BYTES = 16 * 1024 * 1024;

/** Matches the pinned PostgreSQL 17 jsonb::text final-artifact serializer.
 * Compatibility requires actual SQL rows, rather than JS mock output.
 */
export function scopedPostgresFinalBytes(value: unknown): Buffer {
  const normalized: unknown = JSON.parse(generationEvidenceBytes(value).toString("utf8"));
  const render = (item: unknown): string => {
    if (item === null) return "null";
    if (typeof item === "string" || typeof item === "boolean") return JSON.stringify(item);
    if (typeof item === "number") {
      const text = JSON.stringify(item);
      const match = /^(-?)(\d+)(?:\.(\d+))?e([+-]?\d+)$/i.exec(text);
      if (!match) return text;
      const digits = match[2] + (match[3] ?? "");
      const point = match[2].length + Number(match[4]);
      const decimal =
        point <= 0
          ? "0." + "0".repeat(-point) + digits
          : point >= digits.length
            ? digits + "0".repeat(point - digits.length)
            : digits.slice(0, point) + "." + digits.slice(point);
      return match[1] + decimal;
    }
    if (Array.isArray(item)) return "[" + item.map(render).join(", ") + "]";
    if (typeof item !== "object") refuse();
    const object = item as Record<string, unknown>;
    const keys = Object.keys(object).sort((a, b) => {
      const left = Buffer.from(a, "utf8");
      const right = Buffer.from(b, "utf8");
      return left.length - right.length || Buffer.compare(left, right);
    });
    return "{" + keys.map((key) => JSON.stringify(key) + ": " + render(object[key])).join(", ") + "}";
  };
  return Buffer.from(render(normalized), "utf8");
}
const blobSchema = z
  .object({
    bytesHex: z.string().regex(/^(?:[0-9a-f]{2})+$/),
    sha256: digest,
    byteLength: positive.max(MAX_ARTIFACT_BYTES),
  })
  .strict();
const referenceSchema = z
  .object({ unitId: unitIdSchema, sha256: digest, byteLength: positive, representation: z.string().min(1) })
  .strict();
const entrySchema = z
  .object({
    family,
    row: z.record(z.string(), z.unknown()),
    dependencies: z.array(z.object({ family, rowId: uuid }).strict()).max(2),
    references: z.array(referenceSchema).min(1).max(32),
    sourceEvidenceIds: z.array(z.never()).max(0),
  })
  .strict();
export const scopedProjectionManifestSchema = z
  .object({
    version: z.literal("ingestion-private-scoped-manifest-v1"),
    projectionId: uuid,
    scope: z.literal("fixed_capture_projection"),
    qualification: z.literal("derived_unverified"),
    identity: z
      .object({
        documentId: uuid,
        ownerId: uuid,
        generationId: uuid,
        jobId: uuid,
        leaseToken: uuid,
        authorityDigest: digest,
        admissionEventId: uuid,
        sourceSha256: digest,
        sourceByteLength: positive,
        sourceExpectationDigest: digest,
      })
      .strict(),
    basis: z
      .array(z.object({ reference: z.string().min(1), sha256: digest }).strict())
      .min(1)
      .max(16),
    originalUnits: z
      .array(
        z
          .object({
            id: z.string().min(1),
            required: z.literal(true),
            dependencies: z.array(z.string()),
            locator: z.string().min(1),
            nativeMapping: z.literal("unavailable"),
          })
          .strict(),
      )
      .length(8),
    qualificationText: z.string().min(1),
    generatedImageAnnotation: z.string(),
    expectedRows: z.array(entrySchema).length(5),
    wholeOriginalFamilies: z.literal("unknown"),
    sourceCompleteness: z.literal("unavailable"),
    nativeMapping: z.literal("unavailable"),
  })
  .strict();
export type ScopedProjectionManifest = z.infer<typeof scopedProjectionManifestSchema>;
type Blob = z.infer<typeof blobSchema>;
function refuse(): never {
  throw new Error("private_scoped_projection_identity_mismatch");
}
const same = (a: unknown, b: unknown) => generationEvidenceDigest(a) === generationEvidenceDigest(b);
const normalize = (text: string) => text.replace(/\s+/g, " ").trim();
function blob(value: unknown): { value: Blob; bytes: Buffer } {
  generationEvidenceBytes(value);
  const parsed = blobSchema.safeParse(value);
  if (!parsed.success) refuse();
  const bytes = Buffer.from(parsed.data.bytesHex, "hex");
  if (bytes.length !== parsed.data.byteLength || bytesDigest(bytes) !== parsed.data.sha256) refuse();
  return { value: parsed.data, bytes };
}
function retain(bytes: Buffer): Blob {
  return blob({ bytesHex: bytes.toString("hex"), sha256: bytesDigest(bytes), byteLength: bytes.length }).value;
}

/** Structural, qualified transport validation; this never authenticates a native producer. */
export function validateScopedProjectionManifest(value: unknown) {
  generationEvidenceBytes(value);
  const parsed = scopedProjectionManifestSchema.safeParse(value);
  if (!parsed.success) refuse();
  const m = parsed.data;
  const ids = new Set<string>();
  for (const entry of m.expectedRows) {
    const schema =
      entry.family === "images"
        ? candidateImageRowSchema
        : entry.family === "chunks"
          ? preparedRowSchema
          : candidateTableFactRowSchema;
    const checked = schema.safeParse(entry.row);
    if (!checked.success) refuse();
    const row = checked.data;
    if (
      ids.has(row.id) ||
      row.document_id !== m.identity.documentId ||
      row.index_generation_id !== m.identity.generationId ||
      ("owner_id" in row && row.owner_id !== m.identity.ownerId) ||
      row.metadata.index_generation_id !== m.identity.generationId ||
      ["ingestion_job_id", "ingestion_job_kind", "ingestion_lease_token"].some((key) => key in row.metadata) ||
      new Set(entry.references.map((ref) => unitIdentity(ref.unitId))).size !== entry.references.length
    )
      refuse();
    const required = ["original-source", "original-source-expectation-witness"];
    if (entry.family === "images" && "capture_ordinal" in row)
      required.push(`image:${row.capture_ordinal}:binary`, `image:${row.capture_ordinal}:provenance`);
    else required.push("page:2:persisted", "image:1:binary", "image:1:provenance");
    if (
      required.some(
        (key) => !entry.references.some((ref) => ref.unitId.family === "private_objects" && ref.unitId.key === key),
      )
    )
      refuse();
    ids.add(row.id);
  }
  const images = m.expectedRows.filter((e) => e.family === "images").map((e) => candidateImageRowSchema.parse(e.row));
  const chunks = m.expectedRows.filter((e) => e.family === "chunks").map((e) => preparedRowSchema.parse(e.row));
  const facts = m.expectedRows
    .filter((e) => e.family === "table_facts")
    .map((e) => candidateTableFactRowSchema.parse(e.row));
  if (
    !same(
      m.expectedRows.map((e) => e.family),
      ["images", "images", "chunks", "table_facts", "table_facts"],
    ) ||
    images.length !== 2 ||
    chunks.length !== 1 ||
    facts.length !== 2 ||
    images[0].capture_ordinal !== 1 ||
    images[0].page_number !== 2 ||
    images[0].source_kind !== "table_crop" ||
    images[1].capture_ordinal !== 2 ||
    images[1].page_number !== 1 ||
    images[1].source_kind !== "cover_page" ||
    chunks[0].page_number !== 2 ||
    !same(chunks[0].image_ids, [images[0].id]) ||
    !normalize(chunks[0].content).includes(normalize(m.qualificationText))
  )
    refuse();
  const descriptor = images[0].descriptor as {
    metadata?: Record<string, unknown>;
    pageNumber?: number;
    sourceKind?: string;
  };
  const metadata = descriptor?.metadata ?? {};
  const tableText = typeof metadata.table_text === "string" ? normalize(metadata.table_text) : undefined;
  if (m.generatedImageAnnotation) {
    if (!tableText || tableText.length > 220 || metadata.table_title != null || metadata.table_label != null) refuse();
    const generated = buildImageTag({
      id: images[0].id,
      caption: "",
      sourceKind: images[0].source_kind,
      tableRole: typeof metadata.table_role === "string" ? metadata.table_role : null,
      tableTextSnippet: tableText,
    });
    if (m.generatedImageAnnotation !== generated) refuse();
  }
  const columns = descriptor?.metadata?.table_columns;
  const rows = descriptor?.metadata?.table_rows;
  if (
    !Array.isArray(columns) ||
    columns.length !== 5 ||
    !Array.isArray(rows) ||
    rows.length !== 3 ||
    !same(rows[0], columns)
  )
    refuse();
  for (const [index, image] of images.entries()) {
    const d = image.descriptor as { pageNumber?: number; sourceKind?: string; metadata?: Record<string, unknown> };
    if (
      d.pageNumber !== image.page_number ||
      d.sourceKind !== image.source_kind ||
      !same(image.metadata, { ...d.metadata, index_generation_id: m.identity.generationId }) ||
      m.expectedRows[index].dependencies.length !== 0
    )
      refuse();
  }
  if (!same(m.expectedRows[2].dependencies, [{ family: "images", rowId: images[0].id }])) refuse();
  if (
    chunks[0].content_hash !==
    createHash("sha256")
      .update(normalize(`${chunks[0].section_heading ?? ""}\n${chunks[0].content}`))
      .digest("hex")
  )
    refuse();
  for (const [index, fact] of facts.entries()) {
    if (
      fact.page_number !== 2 ||
      fact.source_image_id !== images[0].id ||
      fact.source_chunk_id !== chunks[0].id ||
      fact.metadata.row_index !== index + 1 ||
      !same(fact.metadata.columns, columns) ||
      !same(fact.metadata.cells, rows[index + 1]) ||
      !Array.isArray(rows[index + 1]) ||
      rows[index + 1].length !== 5 ||
      fact.row_label !== rows[index + 1][0] ||
      fact.threshold_value !== null ||
      fact.action !== null ||
      fact.table_title !== null ||
      !same(m.expectedRows[index + 3].dependencies, [
        { family: "images", rowId: images[0].id },
        { family: "chunks", rowId: chunks[0].id },
      ])
    )
      refuse();
    const cells = rows[index + 1] as unknown[];
    let position = 0;
    for (const cell of cells) {
      if (typeof cell !== "string") refuse();
      const next = chunks[0].content.indexOf(cell, position);
      if (next < 0) refuse();
      position = next + cell.length;
    }
  }
  const originalIds = new Set(m.originalUnits.map((u) => u.id));
  if (
    originalIds.size !== 8 ||
    m.originalUnits.some((u) => u.dependencies.some((d) => !originalIds.has(d) || d === u.id))
  )
    refuse();
  return m;
}

/** All scoped populations and exact bytes are supplied independently before any effects. */
export function prepareScopedCandidateProjection(args: {
  packet: ReturnType<typeof buildGenerationRetentionPacket>;
  originalBytes: Buffer;
  witnessBytes: Buffer;
  extracted: ExtractedDocument;
  manifest: ScopedProjectionManifest;
}) {
  generationEvidenceBytes(args.packet);
  generationEvidenceBytes(args.extracted);
  const m = validateScopedProjectionManifest(args.manifest);
  const applicability = parseOriginalApplicabilityWitness({
    sourceExpectation: args.packet.registration.sourceExpectation,
    originalBytes: args.originalBytes,
    witnessBytes: args.witnessBytes,
  });
  if (
    applicability.status !== "typed_original_requirements" ||
    applicability.groups.some((g) => g.population.tag !== "unknown") ||
    !same(m.originalUnits, args.packet.registration.sourceExpectation.units) ||
    m.identity.generationId !== args.packet.generationId ||
    m.identity.sourceSha256 !== bytesDigest(args.originalBytes) ||
    m.identity.sourceByteLength !== args.originalBytes.length ||
    m.identity.sourceExpectationDigest !== args.packet.registration.sourceExpectationSha256
  )
    refuse();
  const artifacts = args.packet.artifacts.map(parseGenerationArtifact);
  const captures = retainedCandidateImages(args.packet);
  if (captures.length !== 2 || captures.some((c) => c.sourceEvidenceIds.length !== 0)) refuse();
  for (const entry of m.expectedRows) {
    for (const ref of entry.references) {
      const matches = artifacts.filter((a) => unitIdentity(a.unitId) === unitIdentity(ref.unitId));
      if (
        matches.length !== 1 ||
        !same(
          ref,
          Object.fromEntries(
            ["unitId", "sha256", "byteLength", "representation"].map((k) => [
              k,
              matches[0][k as keyof (typeof matches)[0]],
            ]),
          ),
        )
      )
        refuse();
    }
    const required = ["original-source", "original-source-expectation-witness"];
    if (entry.family === "images") {
      const image = candidateImageRowSchema.parse(entry.row);
      const capture = captures.find((c) => c.ordinal === image.capture_ordinal);
      const extracted = args.extracted.images[image.capture_ordinal - 1];
      if (
        !capture ||
        !extracted ||
        capture.documentId !== m.identity.documentId ||
        !same(image.descriptor, capture.descriptor) ||
        !same(image.descriptor, Object.fromEntries(Object.entries(extracted).filter(([key]) => key !== "path")))
      )
        refuse();
      required.push(`image:${image.capture_ordinal}:binary`, `image:${image.capture_ordinal}:provenance`);
    } else required.push("page:2:persisted", "image:1:binary", "image:1:provenance");
    if (
      required.some(
        (key) => !entry.references.some((ref) => ref.unitId.family === "private_objects" && ref.unitId.key === key),
      )
    )
      refuse();
  }
  const chunk = preparedRowSchema.parse(m.expectedRows[2].row);
  const sourcePage = artifacts.find(
    (a) => a.unitId.family === "private_objects" && a.unitId.key === "page:2:persisted",
  );
  if (
    !sourcePage ||
    normalize(chunk.content) !==
      normalize(Buffer.from(sourcePage.bytesHex, "hex").toString("utf8") + " " + m.generatedImageAnnotation)
  )
    refuse();
  const manifest = retain(generationEvidenceBytes(m));
  const prepared = m.expectedRows.map((entry) => ({
    family: entry.family,
    rowId: entry.row.id as string,
    ...retain(
      generationEvidenceBytes({
        version: "ingestion-private-scoped-prepared-v1",
        projectionId: m.projectionId,
        manifestSha256: manifest.sha256,
        ...entry,
      }),
    ),
  }));
  return freezeGenerationEvidence({
    generationId: m.identity.generationId,
    projectionId: m.projectionId,
    manifest,
    manifestData: structuredClone(m),
    registration: {
      version: "ingestion-private-scoped-projection-registration-v1",
      registration: args.packet.registration,
      projection: manifest,
    },
    prepared,
    wholeOriginalReadiness: "unavailable" as const,
    sourceCompleteness: "unavailable" as const,
    nativeMapping: "unavailable" as const,
  });
}

/** Only existing fenced RPCs; private row writes never declare a whole-original producer. */
export async function stageScopedCandidateProjection(args: {
  plan: ReturnType<typeof prepareScopedCandidateProjection>;
  originalBytes: Buffer;
  mutation: (name: string, payload: Record<string, unknown>) => Promise<Record<string, unknown>>;
  check: () => void;
}) {
  const { plan, mutation } = args;
  if (bytesDigest(args.originalBytes) !== plan.manifestData.identity.sourceSha256) refuse();
  args.check();
  const registration = await mutation("begin_ingestion_generation_evidence", {
    p_generation: plan.generationId,
    p_registration: plan.registration,
    p_original_hex: args.originalBytes.toString("hex"),
  });
  if (registration.ok !== true || registration.projectionId !== plan.projectionId) refuse();
  args.check();
  const prepared = await mutation("retain_ingestion_generation_artifacts", {
    p_generation: plan.generationId,
    p_artifacts: {
      version: "ingestion-private-scoped-projection-write-v1",
      projectionId: plan.projectionId,
      phase: "prepared",
      artifacts: plan.prepared,
    },
  });
  if (prepared.ok !== true || prepared.preparedCount !== 5 || prepared.projectionId !== plan.projectionId) refuse();
  for (const f of ["images", "chunks", "table_facts"] as const) {
    args.check();
    const rows = plan.manifestData.expectedRows.filter((e) => e.family === f).map((e) => e.row);
    const result = await mutation("retain_ingestion_generation_artifacts", {
      p_generation: plan.generationId,
      p_artifacts: {
        version: "ingestion-private-scoped-projection-write-v1",
        projectionId: plan.projectionId,
        phase: "rows",
        family: f,
        rows,
      },
    });
    generationEvidenceBytes(result);
    const parsed = z
      .object({ ok: z.literal(true), projectionId: uuid, family, rowCount: positive })
      .strict()
      .safeParse(result);
    if (
      !parsed.success ||
      parsed.data.projectionId !== plan.projectionId ||
      parsed.data.family !== f ||
      parsed.data.rowCount !== rows.length
    )
      refuse();
  }
  return freezeGenerationEvidence({
    projectionId: plan.projectionId,
    readiness: "scoped_only" as const,
    wholeOriginalReadiness: "unavailable" as const,
  });
}

export function decodeScopedCandidateProjection(args: { expected: ScopedProjectionManifest; result: unknown }) {
  const expected = validateScopedProjectionManifest(args.expected);
  const resultBytes = generationEvidenceBytes(args.result);
  if (resultBytes.length > MAX_TRANSPORT_BYTES) refuse();
  const rpc = z
    .object({ ok: z.literal(true), managed: z.literal(true), privateScopedProjection: z.unknown() })
    .strict()
    .safeParse(args.result);
  if (!rpc.success) refuse();
  const projection = z
    .object({
      version: z.literal("ingestion-private-scoped-projection-inputs-v1"),
      kind: z.literal("private_scoped_projection"),
      status: z.enum(["projection_ready", "pending"]),
      readiness: z.literal("scoped_only"),
      wholeOriginalReadiness: z.literal("unavailable"),
      sourceCompleteness: z.literal("unavailable"),
      nativeMapping: z.literal("unavailable"),
      manifest: blobSchema,
      retainedReferences: z.array(referenceSchema.extend({ bytesHex: z.string() }).strict()).max(32),
      rows: z
        .array(
          z
            .object({ family, row: z.record(z.string(), z.unknown()), prepared: blobSchema, final: blobSchema })
            .strict(),
        )
        .max(5),
    })
    .strict()
    .safeParse(rpc.data.privateScopedProjection);
  if (!projection.success) refuse();
  const p = projection.data;
  const manifest = blob(p.manifest);
  if (!manifest.bytes.equals(generationEvidenceBytes(expected))) refuse();
  let decoded: unknown;
  try {
    decoded = JSON.parse(manifest.bytes.toString("utf8"));
  } catch {
    refuse();
  }
  if (!same(validateScopedProjectionManifest(decoded), expected)) refuse();
  if (p.status !== "projection_ready") throw new Error("private_scoped_projection_pending");
  if (p.rows.length !== 5) refuse();
  const refs = new Map(p.retainedReferences.map((ref) => [unitIdentity(ref.unitId), ref]));
  const wanted = new Set(
    expected.expectedRows.flatMap((entry) => entry.references.map((ref) => unitIdentity(ref.unitId))),
  );
  if (refs.size !== p.retainedReferences.length || refs.size !== wanted.size) refuse();
  for (const entry of expected.expectedRows)
    for (const ref of entry.references) {
      const actual = refs.get(unitIdentity(ref.unitId));
      if (
        !actual ||
        !same(ref, {
          unitId: actual.unitId,
          representation: actual.representation,
          sha256: actual.sha256,
          byteLength: actual.byteLength,
        })
      )
        refuse();
      const bytes = Buffer.from(actual.bytesHex, "hex");
      if (
        !/^(?:[0-9a-f]{2})+$/.test(actual.bytesHex) ||
        bytes.length !== actual.byteLength ||
        bytesDigest(bytes) !== actual.sha256
      )
        refuse();
    }
  for (const [index, actual] of p.rows.entries()) {
    const entry = expected.expectedRows[index];
    if (actual.family !== entry.family) refuse();
    const prepared = blob(actual.prepared);
    const final = blob(actual.final);
    let pb: unknown;
    let fb: unknown;
    try {
      pb = JSON.parse(prepared.bytes.toString("utf8"));
      fb = JSON.parse(final.bytes.toString("utf8"));
    } catch {
      refuse();
    }
    if (!prepared.bytes.equals(generationEvidenceBytes(pb)) || !final.bytes.equals(scopedPostgresFinalBytes(fb)))
      refuse();
    const stored = {
      ...entry.row,
      metadata: {
        ...(entry.row.metadata as Record<string, unknown>),
        ingestion_job_id: expected.identity.jobId,
        ingestion_job_kind: "node",
        ingestion_lease_token: expected.identity.leaseToken,
      },
    };
    if (
      !same(actual.row, stored) ||
      !same(pb, {
        version: "ingestion-private-scoped-prepared-v1",
        projectionId: expected.projectionId,
        manifestSha256: manifest.value.sha256,
        ...entry,
      }) ||
      !same(fb, {
        version: "ingestion-private-scoped-final-v1",
        projectionId: expected.projectionId,
        manifestSha256: manifest.value.sha256,
        preparedSha256: prepared.value.sha256,
        family: entry.family,
        row: actual.row,
      })
    )
      refuse();
  }
  return freezeGenerationEvidence(structuredClone(p));
}

export async function readScopedCandidateProjection(args: {
  expected: ScopedProjectionManifest;
  fence: Record<string, unknown>;
  mutation: (name: string, payload: Record<string, unknown>) => Promise<Record<string, unknown>>;
}) {
  const expected = validateScopedProjectionManifest(args.expected);
  generationEvidenceBytes(args.fence);
  const fence = z
    .object({
      job_kind: z.literal("node"),
      job_id: uuid,
      document_id: uuid,
      worker_id: z.string().min(1),
      lease_token: uuid,
      expected_generation_id: uuid.nullable(),
      authority_digest: digest,
    })
    .strict()
    .safeParse(args.fence);
  if (
    !fence.success ||
    fence.data.job_id !== expected.identity.jobId ||
    fence.data.document_id !== expected.identity.documentId ||
    fence.data.lease_token !== expected.identity.leaseToken ||
    fence.data.authority_digest !== expected.identity.authorityDigest
  )
    refuse();
  const result = await args.mutation("read_ingestion_generation_inventory", {
    p_generation: expected.identity.generationId,
    p_fence: {
      version: "ingestion-private-scoped-projection-read-v1",
      fence: args.fence,
      projectionId: expected.projectionId,
    },
  });
  return decodeScopedCandidateProjection({ expected, result });
}
