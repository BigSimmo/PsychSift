import { createHash } from "node:crypto";
import { z } from "zod";
import {
  bytesDigest,
  freezeGenerationEvidence,
  generationEvidenceBytes,
  generationEvidenceDigest,
  issuedAttemptControlSchema,
  parseIssuedAttemptControl,
  unitIdSchema,
  type GenerationArtifactInput,
  type IssuedAttemptControl,
} from "../src/lib/ingestion-generation-evidence";
import type { IngestionFence } from "../supabase/functions/_shared/ingestion-attempt";
import { prepareManagedPrivateSupplier, type ManagedPreparedSupplierInput } from "./managed-prepared-supplier";
import { produceManagedProviderVectors, type ManagedProviderVectorRow } from "./managed-provider-vectors";
import type { WholeOriginalPreparedUnit } from "./whole-original-supplier";

const LIMIT = 16 * 1024 * 1024;
const families = ["chunks", "embedding_fields", "index_units"] as const;
type Family = (typeof families)[number];
type Basis = { input: ManagedPreparedSupplierInput; issued: IssuedAttemptControl; expectedPlanDigest: string };
type Vectors = Awaited<ReturnType<typeof produceManagedProviderVectors>>;
export type ManagedVectorFinalPacket = {
  version: "managed-vector-final-v1";
  planDigest: string;
  issued: IssuedAttemptControl;
  rows: ManagedProviderVectorRow[];
};
const refuse = (reason: string): never => {
  throw new Error(`managed_vector_final_${reason}`);
};
const copy = <T>(value: T): T => JSON.parse(generationEvidenceBytes(value).toString("utf8")) as T;
const same = (a: unknown, b: unknown) => generationEvidenceDigest(a) === generationEvidenceDigest(b);
const key = (id: { family: string; key: string }) => `${id.family}:${id.key}`;
const sorted = <T extends { family: string; rowId: string }>(rows: T[]) =>
  rows
    .slice()
    .sort((a, b) =>
      a.family < b.family ? -1 : a.family > b.family ? 1 : a.rowId < b.rowId ? -1 : a.rowId > b.rowId ? 1 : 0,
    );
const sha = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const uint = z.number().int().nonnegative().safe();
const commitment = z
  .object({ bytesHex: z.string().regex(/^(?:[0-9a-f]{2})*$/), sha256: sha, byteLength: uint })
  .strict();
const preparedPin = z
  .object({ unitId: unitIdSchema, sha256: sha, byteLength: uint, locator: z.string().min(1) })
  .strict();
const identitySchema = issuedAttemptControlSchema
  .extend({ ownerId: z.uuid(), sourceSha256: sha, sourceByteLength: uint.positive(), sourceExpectationDigest: sha })
  .strict();
const familySchema = z.enum(families);
const rowEnvelope = z
  .object({
    family: familySchema,
    rowId: z.uuid(),
    prepared: preparedPin,
    row: z.record(z.string(), z.unknown()),
    receipt: commitment,
  })
  .strict();
const finalIdentity = z
  .object({ version: z.literal("managed-vector-final-row-v1"), family: familySchema, rowId: z.uuid() })
  .strict();
const parentSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("row"),
      unitId: unitIdSchema,
      preparedSha256: sha,
      preparedByteLength: uint,
      finalIdentity,
      normalizedRowSha256: sha,
    })
    .strict(),
  z
    .object({
      kind: z.literal("retained"),
      unitId: unitIdSchema,
      sha256: sha,
      byteLength: uint,
      representation: z.string(),
    })
    .strict(),
]);
const receiptSchema = z
  .object({
    version: z.literal("managed-vector-final-row-v1"),
    qualification: z.literal("derived_unverified"),
    identity: identitySchema,
    family: familySchema,
    groupKey: z.literal("worker_core"),
    rowId: z.uuid(),
    prepared: preparedPin,
    parents: z.array(parentSchema),
    vectorInput: z.object({ sha256: sha, byteLength: uint, provenance: z.literal("supplied_unverified") }).strict(),
    row: z.record(z.string(), z.unknown()),
  })
  .strict();
const populationSchema = z
  .object({
    version: z.literal("managed-vector-final-population-v1"),
    identity: identitySchema,
    planDigest: sha,
    population: z.array(
      z
        .object({
          family: familySchema,
          rowId: z.uuid(),
          preparedSha256: sha,
          preparedByteLength: uint,
          normalizedRowSha256: sha,
          receiptSha256: sha,
        })
        .strict(),
    ),
  })
  .strict();
const readbackSchema = z
  .object({
    ok: z.literal(true),
    managedVectorFinalRows: z
      .object({
        version: z.literal("managed-vector-final-readback-v1"),
        status: z.literal("retained_unverified"),
        activated: z.literal(false),
        terminalEligibility: z.literal("unavailable"),
        providerExecution: z.literal("unverified"),
        identity: identitySchema,
        planDigest: sha,
        sqlPopulationDigest: sha,
        populationCommitment: commitment,
        counts: z.object({ chunks: uint, embedding_fields: uint, index_units: uint }).strict(),
        rows: z.array(rowEnvelope).max(500),
      })
      .strict(),
  })
  .strict();

export function checkedVector(value: unknown): number[] {
  if (
    !Array.isArray(value) ||
    value.length !== 1536 ||
    value.some((x) => typeof x !== "number" || !Number.isFinite(x) || !Number.isFinite(Math.fround(x)))
  )
    return refuse("invalid_vector");
  return value as number[];
}
export function pin(artifact: GenerationArtifactInput) {
  return {
    unitId: artifact.unitId,
    sha256: artifact.sha256,
    byteLength: artifact.byteLength,
    locator: artifact.locator,
  };
}

/** Call before provider work. All selected semantic parents must be staged by this exact protocol. */
export function preflightManagedVectorFinal(args: Basis) {
  const issued = copy(parseIssuedAttemptControl(args.issued));
  const plan = prepareManagedPrivateSupplier(args.input);
  z.uuid().parse(args.input.job.documents.owner_id);
  if (plan.digest !== args.expectedPlanDigest || !same(plan.issued, issued)) return refuse("plan_identity_mismatch");
  sha.parse(args.expectedPlanDigest);
  const selected: WholeOriginalPreparedUnit[] = [];
  for (const family of families) {
    const groups = plan.producerManifests.filter(
      (m) => m.group.family === family && m.group.groupKey === "worker_core",
    );
    if (groups.length !== 1 || groups[0].state !== "prepared") return refuse("complete_population_required");
    const group = groups[0];
    const population = group.group.declaration.population;
    if (
      population.tag !== "known" ||
      !same(
        population.expectedUnits,
        group.units.map((u) => u.declaration.id),
      )
    )
      return refuse("complete_population_required");
    selected.push(...group.units);
  }
  if (!selected.some((u) => u.declaration.id.family === "chunks") || selected.length > 500)
    return refuse("population_bound");
  const units = new Map(selected.map((u) => [key(u.declaration.id), u]));
  const artifacts = new Map(
    [...plan.retentionPacket.artifacts, ...plan.producerManifests.flatMap((m) => m.units.map((u) => u.artifact))].map(
      (a) => [key(a.unitId), a],
    ),
  );
  for (const unit of selected) {
    if (unit.providerInputText === null) return refuse("canonical_input_missing");
    const body = unit.body as Record<string, unknown>;
    const metadata = body.metadata as Record<string, unknown>;
    if (
      metadata.index_generation_id !== issued.generationId ||
      ["ingestion_job_kind", "ingestion_job_id", "ingestion_lease_token"].some((k) => Object.hasOwn(metadata, k))
    )
      return refuse("reserved_metadata_mismatch");
    if (unit.declaration.id.family !== "chunks" && body.owner_id !== args.input.job.documents.owner_id)
      return refuse("owner_identity_mismatch");
    for (const dependency of unit.declaration.dependencies) {
      if (!["chunks", "pages", "private_objects", "attempt_control"].includes(dependency.family))
        return refuse("parent_not_staged");
      if (families.includes(dependency.family as Family) && !units.has(key(dependency)))
        return refuse("parent_not_staged");
      if (!artifacts.has(key(dependency))) return refuse("parent_artifact_missing");
    }
  }
  return { plan, selected, artifacts, issued };
}

export function prepareManagedVectorFinalPacket(args: Basis & { vectors: Vectors }): ManagedVectorFinalPacket {
  const { plan, selected, issued } = preflightManagedVectorFinal(args);
  const vectors = copy(args.vectors);
  if (
    !same(Object.keys(vectors).sort(), ["issued", "planDigest", "rows"]) ||
    vectors.planDigest !== plan.digest ||
    !same(vectors.issued, issued) ||
    !Array.isArray(vectors.rows) ||
    vectors.rows.length !== selected.length
  )
    return refuse("vector_population_mismatch");
  const expected = new Map(selected.map((u) => [key(u.declaration.id), u]));
  const seen = new Set<string>();
  for (const row of vectors.rows) {
    if (!same(Object.keys(row).sort(), ["body", "family", "groupKey", "preparedArtifact", "preparedUnitId"]))
      return refuse("vector_row_shape");
    const id = key(row.preparedUnitId);
    const unit = expected.get(id);
    if (
      !unit ||
      seen.has(id) ||
      row.family !== unit.declaration.id.family ||
      row.groupKey !== "worker_core" ||
      !same(row.preparedArtifact, unit.artifact)
    )
      return refuse("vector_population_mismatch");
    seen.add(id);
    checkedVector(row.body.embedding);
    if (
      !same(row.body, {
        ...(unit.body as Record<string, unknown>),
        id: unit.declaration.id.key,
        embedding: row.body.embedding,
      })
    )
      return refuse("prepared_body_changed");
  }
  const rows = sorted(vectors.rows.map((row) => ({ ...row, rowId: row.preparedUnitId.key }))).map(
    ({ rowId, ...row }) => {
      void rowId;
      return row;
    },
  );
  const packet: ManagedVectorFinalPacket = {
    version: "managed-vector-final-v1",
    planDigest: plan.digest,
    issued,
    rows,
  };
  if (generationEvidenceBytes(packet).length > LIMIT) return refuse("transport_limit");
  return freezeGenerationEvidence(packet);
}

export async function produceManagedVectorFinalPacket(args: Parameters<typeof produceManagedProviderVectors>[0]) {
  const { check, embed, assertEmbedding } = args;
  check();
  preflightManagedVectorFinal(args);
  check();
  const vectors = await produceManagedProviderVectors({ ...args, check, embed, assertEmbedding });
  check();
  const packet = prepareManagedVectorFinalPacket({ ...args, vectors });
  check();
  return packet;
}

export function committedJson(value: z.infer<typeof commitment>) {
  const bytes = Buffer.from(value.bytesHex, "hex");
  if (bytes.length !== value.byteLength || bytesDigest(bytes) !== value.sha256)
    return refuse("receipt_commitment_mismatch");
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  return { text, body: JSON.parse(text) as unknown };
}
/** Extract a top-level JSON value's exact SQL text, preserving SQL JSONB bytes and spacing. */
export function sqlRowBytes(text: string): Buffer {
  let i = 0;
  let rowBytes: Buffer | undefined;
  const seen = new Set<string>();
  const ws = () => {
    while (/\s/.test(text[i] ?? "") && i < text.length) i++;
  };
  const stringEnd = () => {
    i++;
    while (i < text.length) {
      if (text[i] === "\\") {
        i += 2;
        continue;
      }
      if (text[i++] === '"') return;
    }
    return refuse("receipt_json_shape");
  };
  ws();
  if (text[i++] !== "{") return refuse("receipt_json_shape");
  while (i < text.length) {
    ws();
    if (text[i] === "}") break;
    if (text[i] !== '"') return refuse("receipt_json_shape");
    const ks = i;
    stringEnd();
    const property = JSON.parse(text.slice(ks, i)) as string;
    ws();
    if (text[i++] !== ":") return refuse("receipt_json_shape");
    ws();
    if (seen.has(property)) return refuse("receipt_json_shape");
    seen.add(property);
    const start = i;
    let depth = 0;
    while (i < text.length) {
      const ch = text[i];
      if (ch === '"') {
        stringEnd();
        continue;
      }
      if (ch === "{" || ch === "[") {
        depth++;
        i++;
        continue;
      }
      if (ch === "}" || ch === "]") {
        if (depth === 0) break;
        depth--;
        i++;
        continue;
      }
      if (ch === "," && depth === 0) break;
      i++;
    }
    let end = i;
    while (end > start && /\s/.test(text[end - 1])) end--;
    if (property === "row") rowBytes = Buffer.from(text.slice(start, end), "utf8");
    ws();
    if (text[i] === ",") {
      i++;
      continue;
    }
    break;
  }
  return rowBytes ?? refuse("receipt_row_missing");
}

export function expectedNormalized(row: ManagedProviderVectorRow, issued: IssuedAttemptControl) {
  const body = copy(row.body);
  const metadata = body.metadata as Record<string, unknown>;
  if (
    metadata.index_generation_id !== issued.generationId ||
    ["ingestion_job_kind", "ingestion_job_id", "ingestion_lease_token"].some((k) => Object.hasOwn(metadata, k))
  )
    return refuse("reserved_metadata_mismatch");
  body.metadata = {
    ...metadata,
    index_generation_id: issued.generationId,
    ingestion_job_kind: "node",
    ingestion_job_id: issued.jobId,
    ingestion_lease_token: issued.firstLeaseToken,
  };
  if (row.family === "embedding_fields")
    body.content_hash = createHash("md5")
      .update(body.content as string, "utf8")
      .digest("hex");
  if (row.family !== "chunks") body.index_generation_id = issued.generationId;
  if (row.family === "index_units") {
    body.producer = "local-worker";
    body.artifact_generation_id = issued.generationId;
  }
  return body;
}

/** Accept only authenticated complete SQL-issued normalized rows; this supplies no terminal authority. */
export function decodeManagedVectorFinalReadback(
  args: Basis & { packet: ManagedVectorFinalPacket; response: unknown },
) {
  const basis = preflightManagedVectorFinal(args);
  const suppliedPacket = copy(args.packet);
  const packet = prepareManagedVectorFinalPacket({
    ...args,
    vectors: { issued: suppliedPacket.issued, planDigest: suppliedPacket.planDigest, rows: suppliedPacket.rows },
  });
  if (!same(suppliedPacket, packet)) return refuse("packet_changed");
  const response = copy(args.response);
  if (generationEvidenceBytes(response).length > LIMIT) return refuse("transport_limit");
  const output = readbackSchema.parse(response).managedVectorFinalRows;
  const identity = {
    ...basis.issued,
    ownerId: args.input.job.documents.owner_id,
    sourceSha256: basis.plan.source.sha256,
    sourceByteLength: basis.plan.source.byteLength,
    sourceExpectationDigest: basis.plan.retentionPacket.registration.sourceExpectationSha256,
  };
  if (
    !same(output.identity, identity) ||
    output.planDigest !== packet.planDigest ||
    output.rows.length !== packet.rows.length
  )
    return refuse("readback_identity_mismatch");
  if (!same(output.rows, sorted(output.rows))) return refuse("readback_order_mismatch");
  const expected = new Map(packet.rows.map((row) => [`${row.family}:${row.body.id}`, row]));
  const units = new Map(basis.selected.map((unit) => [key(unit.declaration.id), unit]));
  const seen = new Map<
    string,
    { row: z.infer<typeof rowEnvelope>; body: z.infer<typeof receiptSchema>; rowSha: string }
  >();
  const counts = { chunks: 0, embedding_fields: 0, index_units: 0 };
  for (const row of output.rows) {
    const id = `${row.family}:${row.rowId}`;
    const input = expected.get(id);
    const unit = units.get(id);
    if (!input || !unit || seen.has(id) || !same(row.prepared, pin(unit.artifact)))
      return refuse("readback_population_mismatch");
    const normalized = expectedNormalized(input, basis.issued);
    const actualVector = checkedVector(row.row.embedding);
    const supplied = checkedVector(input.body.embedding);
    if (actualVector.some((value, i) => Math.fround(value) !== Math.fround(supplied[i])))
      return refuse("normalized_vector_mismatch");
    const actualWithout: Record<string, unknown> = { ...row.row };
    const expectedWithout: Record<string, unknown> = { ...normalized };
    delete actualWithout.embedding;
    delete expectedWithout.embedding;
    if (row.family === "index_units") {
      if (
        typeof actualWithout.quality_score !== "number" ||
        typeof expectedWithout.quality_score !== "number" ||
        Math.fround(actualWithout.quality_score) !== Math.fround(expectedWithout.quality_score)
      )
        return refuse("normalized_row_mismatch");
      delete actualWithout.quality_score;
      delete expectedWithout.quality_score;
    }
    if (!same(actualWithout, expectedWithout)) return refuse("normalized_row_mismatch");
    const committed = committedJson(row.receipt);
    const body = receiptSchema.parse(committed.body);
    if (
      !same(body.identity, identity) ||
      body.family !== row.family ||
      body.rowId !== row.rowId ||
      !same(body.prepared, row.prepared) ||
      !same(body.row, row.row)
    )
      return refuse("receipt_body_mismatch");
    const text = Buffer.from(unit.providerInputText!, "utf8");
    if (
      !same(body.vectorInput, { sha256: bytesDigest(text), byteLength: text.length, provenance: "supplied_unverified" })
    )
      return refuse("canonical_input_mismatch");
    seen.set(id, { row, body, rowSha: bytesDigest(sqlRowBytes(committed.text)) });
    counts[row.family]++;
  }
  if (!same(output.counts, counts)) return refuse("readback_counts_mismatch");
  const population = [];
  for (const row of output.rows) {
    const id = `${row.family}:${row.rowId}`;
    const retained = seen.get(id)!;
    const unit = units.get(id)!;
    const parents = unit.declaration.dependencies.map((dependency) => {
      const artifact = basis.artifacts.get(key(dependency))!;
      if (dependency.family === "chunks") {
        const parent = seen.get(key(dependency));
        if (!parent) return refuse("parent_not_staged");
        return {
          kind: "row",
          unitId: dependency,
          preparedSha256: artifact.sha256,
          preparedByteLength: artifact.byteLength,
          finalIdentity: { version: "managed-vector-final-row-v1", family: "chunks", rowId: dependency.key },
          normalizedRowSha256: parent.rowSha,
        };
      }
      return {
        kind: "retained",
        unitId: dependency,
        sha256: artifact.sha256,
        byteLength: artifact.byteLength,
        representation: artifact.representation,
      };
    });
    if (!same(retained.body.parents, parents)) return refuse("receipt_parent_mismatch");
    population.push({
      family: row.family,
      rowId: row.rowId,
      preparedSha256: row.prepared.sha256,
      preparedByteLength: row.prepared.byteLength,
      normalizedRowSha256: retained.rowSha,
      receiptSha256: row.receipt.sha256,
    });
  }
  const populationBody = populationSchema.parse(committedJson(output.populationCommitment).body);
  if (
    output.sqlPopulationDigest !== output.populationCommitment.sha256 ||
    !same(populationBody, {
      version: "managed-vector-final-population-v1",
      identity,
      planDigest: packet.planDigest,
      population,
    })
  )
    return refuse("population_commitment_mismatch");
  return freezeGenerationEvidence(output);
}

export async function stageManagedVectorFinal(
  args: Basis & {
    packet: ManagedVectorFinalPacket;
    fence: IngestionFence;
    writeRpc: (name: string, payload: Record<string, unknown>) => Promise<unknown>;
    readRpc: (name: string, payload: Record<string, unknown>) => Promise<unknown>;
    check: () => void;
  },
) {
  const { writeRpc, readRpc, check } = args;
  const issued = copy(parseIssuedAttemptControl(args.issued));
  const digest = args.expectedPlanDigest;
  const suppliedPacket = copy(args.packet);
  const packet = prepareManagedVectorFinalPacket({
    ...args,
    vectors: { issued: suppliedPacket.issued, planDigest: suppliedPacket.planDigest, rows: suppliedPacket.rows },
  });
  if (!same(suppliedPacket, packet)) return refuse("packet_changed");
  const fence = copy(args.fence);
  const expectedFence = {
    job_kind: "node",
    job_id: issued.jobId,
    document_id: issued.documentId,
    worker_id: issued.workerId,
    lease_token: issued.firstLeaseToken,
    expected_generation_id: issued.predecessorGenerationId,
    authority_digest: issued.authorityDigest,
  };
  if (!same(fence, expectedFence)) return refuse("fence_identity_mismatch");
  const current = () => {
    check();
    if (
      args.expectedPlanDigest !== digest ||
      !same(args.issued, issued) ||
      !same(args.fence, fence) ||
      !same(args.packet, packet)
    )
      return refuse("input_changed");
    preflightManagedVectorFinal({ input: args.input, issued, expectedPlanDigest: digest });
  };
  const write = {
    p_fence: fence,
    p_generation: issued.generationId,
    p_chunks: packet,
    p_images: [],
    p_table_facts: [],
    p_embedding_fields: [],
    p_index_units: [],
  };
  if (generationEvidenceBytes(write).length > LIMIT) return refuse("transport_limit");
  current();
  const written = await writeRpc("write_ingestion_base_artifacts", copy(write));
  current();
  const decodedWrite = decodeManagedVectorFinalReadback({ ...args, response: written });
  current();
  const response = await readRpc("read_ingestion_prepared_supplier_artifacts", {
    p_generation: issued.generationId,
    p_fence: { version: "managed-vector-final-read-v1", fence: copy(fence), expectedPlanDigest: digest },
  });
  current();
  const readback = decodeManagedVectorFinalReadback({ ...args, response });
  if (!same(decodedWrite, readback)) return refuse("write_readback_mismatch");
  current();
  return readback;
}
