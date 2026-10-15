import { z } from "zod";
import {
  bytesDigest,
  freezeGenerationEvidence,
  generationEvidenceBytes,
  generationEvidenceDigest,
  groupDeclarationSchema,
  issuedAttemptControlSchema,
  parseIssuedAttemptControl,
  sourceExpectationSchema,
  unitDeclarationSchema,
  unitIdSchema,
  type GenerationArtifactInput,
  type IssuedAttemptControl,
} from "../src/lib/ingestion-generation-evidence";
import type { IngestionFence } from "../supabase/functions/_shared/ingestion-attempt";
import { candidateImageRowSchema, candidateTableFactRowSchema, retainedCandidateImages } from "./candidate-chunks";
import { prepareManagedPrivateSupplier, type ManagedPreparedSupplierInput } from "./managed-prepared-supplier";
import { produceManagedProviderVectors, type ManagedProviderVectorRow } from "./managed-provider-vectors";
import { checkedVector, committedJson, expectedNormalized, pin, sqlRowBytes } from "./managed-vector-final";
import type { WholeOriginalPreparedUnit } from "./whole-original-supplier";

const LIMIT = 16 * 1024 * 1024;
const BLOB_LIMIT = 2 * 1024 * 1024;
const families = ["chunks", "embedding_fields", "images", "index_units", "table_facts"] as const;
type Family = (typeof families)[number];
type Basis = { input: ManagedPreparedSupplierInput; issued: IssuedAttemptControl; expectedPlanDigest: string };
type Vectors = Awaited<ReturnType<typeof produceManagedProviderVectors>>;
export type ManagedNativeParentClosurePacket = {
  version: "managed-native-parent-closure-v1";
  planDigest: string;
  issued: IssuedAttemptControl;
  rows: ManagedProviderVectorRow[];
  parents: Array<{
    family: "images" | "table_facts";
    groupKey: "worker_core";
    preparedUnitId: { family: "images" | "table_facts"; key: string };
    preparedArtifact: { sha256: string; byteLength: number; locator: string };
  }>;
};
const refuse = (reason: string): never => {
  throw new Error(`managed_native_parent_closure_${reason}`);
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
const blob = z
  .object({
    bytesHex: z.string().regex(/^(?:[0-9a-f]{2})+$/),
    sha256: sha,
    byteLength: uint.positive().max(BLOB_LIMIT),
  })
  .strict();
const preparedPin = z
  .object({ unitId: unitIdSchema, sha256: sha, byteLength: uint.positive(), locator: z.string().min(1) })
  .strict();
const identitySchema = issuedAttemptControlSchema
  .extend({ ownerId: z.uuid(), sourceSha256: sha, sourceByteLength: uint.positive(), sourceExpectationDigest: sha })
  .strict();
const familySchema = z.enum(families);
const rowKindSchema = z.enum([
  "private_image_capture_capsule",
  "private_local_native_table_fact",
  "private_supplied_vector_row",
]);
const retainedPin = z
  .object({
    kind: z.literal("retained"),
    unitId: unitIdSchema,
    sha256: sha,
    byteLength: uint.positive(),
    representation: z.string(),
  })
  .strict();
const parentSchema = z.discriminatedUnion("kind", [
  retainedPin,
  z
    .object({
      kind: z.literal("row"),
      unitId: unitIdSchema,
      preparedSha256: sha,
      preparedByteLength: uint.positive(),
      finalIdentity: z
        .object({ version: z.literal("managed-native-parent-closure-row-v1"), family: familySchema, rowId: z.uuid() })
        .strict(),
      normalizedRowSha256: sha,
    })
    .strict(),
]);
const vectorInput = z
  .object({ sha256: sha, byteLength: uint.positive(), provenance: z.literal("supplied_unverified") })
  .strict();
const rowEnvelope = z
  .object({
    family: familySchema,
    rowId: z.uuid(),
    rowKind: rowKindSchema,
    prepared: preparedPin,
    row: z.record(z.string(), z.unknown()),
    receipt: blob,
  })
  .strict();
const receiptSchema = z
  .object({
    version: z.literal("managed-native-parent-closure-row-v1"),
    qualification: z.literal("derived_unverified"),
    identity: identitySchema,
    planDigest: sha,
    projectionId: z.uuid(),
    family: familySchema,
    groupKey: z.literal("worker_core"),
    rowId: z.uuid(),
    rowKind: rowKindSchema,
    prepared: preparedPin,
    parents: z.array(parentSchema),
    retainedReferences: z.array(retainedPin).max(1),
    vectorInput: vectorInput.nullable(),
    row: z.record(z.string(), z.unknown()),
  })
  .strict();
const manifestSchema = z
  .object({
    version: z.literal("managed-native-parent-closure-manifest-v1"),
    qualification: z.literal("derived_unverified"),
    scope: z.literal("complete_known_local_worker_core_output"),
    identity: identitySchema,
    planDigest: sha,
    projectionId: z.uuid(),
    sourceExpectation: sourceExpectationSchema,
    groups: z
      .array(
        z
          .object({
            family: familySchema,
            groupKey: z.literal("worker_core"),
            declaration: groupDeclarationSchema.shape.declaration,
          })
          .strict(),
      )
      .length(5),
    units: z.array(z.object({ declaration: unitDeclarationSchema, prepared: preparedPin }).strict()).max(500),
  })
  .strict();
const populationSchema = z
  .object({
    version: z.literal("managed-native-parent-closure-population-v1"),
    identity: identitySchema,
    planDigest: sha,
    projectionId: z.uuid(),
    manifestSha256: sha,
    population: z
      .array(
        z
          .object({
            family: familySchema,
            rowId: z.uuid(),
            rowKind: rowKindSchema,
            preparedSha256: sha,
            preparedByteLength: uint.positive(),
            normalizedRowSha256: sha,
            receiptSha256: sha,
          })
          .strict(),
      )
      .max(500),
  })
  .strict();
const readbackSchema = z
  .object({
    ok: z.literal(true),
    managedNativeParentClosure: z
      .object({
        version: z.literal("managed-native-parent-closure-readback-v1"),
        status: z.literal("retained_unverified"),
        activated: z.literal(false),
        terminalEligibility: z.literal("unavailable"),
        providerExecution: z.literal("unverified"),
        imageProcessing: z.literal("capture_capsules_only"),
        sourceAssessment: z.literal("unverified"),
        identity: identitySchema,
        planDigest: sha,
        projectionId: z.uuid(),
        manifest: blob,
        sqlPopulationDigest: sha,
        populationCommitment: blob,
        counts: z
          .object({ chunks: uint, embedding_fields: uint, images: uint, index_units: uint, table_facts: uint })
          .strict(),
        rows: z.array(rowEnvelope).max(500),
      })
      .strict(),
  })
  .strict();
const rowKind = (family: Family) =>
  family === "images"
    ? ("private_image_capture_capsule" as const)
    : family === "table_facts"
      ? ("private_local_native_table_fact" as const)
      : ("private_supplied_vector_row" as const);
const retained = (artifact: GenerationArtifactInput) => ({
  kind: "retained" as const,
  unitId: artifact.unitId,
  sha256: artifact.sha256,
  byteLength: artifact.byteLength,
  representation: artifact.representation,
});

/** Representative native pilot only. Invokes the existing exact capture/table/graph validator before any egress. */
export function preflightManagedNativeParentClosure(args: Basis) {
  const issued = copy(parseIssuedAttemptControl(args.issued));
  sha.parse(args.expectedPlanDigest);
  const plan = prepareManagedPrivateSupplier(args.input);
  z.uuid().parse(args.input.job.documents.owner_id);
  if (plan.digest !== args.expectedPlanDigest || !same(plan.issued, issued)) return refuse("issued_mismatch");
  const selected: WholeOriginalPreparedUnit[] = [];
  const groups = families.map((family) => {
    const matches = plan.producerManifests.filter(
      (m) => m.group.family === family && m.group.groupKey === "worker_core",
    );
    if (matches.length !== 1 || matches[0].state !== "prepared") return refuse("population_mismatch");
    const group = matches[0];
    const declaration = group.group.declaration;
    if (
      declaration.population.tag !== "known" ||
      declaration.artifactGenerationId !== null ||
      declaration.producer.name !== `managed-local-prepared-${family}` ||
      declaration.producer.version !== "managed-private-preparation-v1" ||
      !same(
        declaration.population.expectedUnits,
        group.units.map((u) => u.declaration.id),
      )
    )
      return refuse("population_mismatch");
    selected.push(...group.units);
    return group.group;
  });
  if (
    selected.length > 500 ||
    !selected.some((u) => u.declaration.id.family === "chunks") ||
    !selected.some((u) => u.declaration.id.family === "images") ||
    args.input.extracted.pages.length > 256 ||
    selected.filter((u) => u.declaration.id.family === "images").length > 256
  )
    return refuse("transport_limit");
  // Optional prepared outputs remain retained outside this final-row protocol.
  // Required unsupported outputs, and unsupported parents of selected rows, still refuse.
  if (
    plan.producerManifests.some((m) =>
      m.units.some(
        (unit) =>
          unit.declaration.required &&
          !(families.includes(unit.declaration.id.family as Family) && unit.declaration.groupKey === "worker_core") &&
          !["pages", "private_objects", "attempt_control", "quality"].includes(unit.declaration.id.family),
      ),
    )
  )
    return refuse("parent_not_staged");
  const units = new Map(selected.map((u) => [key(u.declaration.id), u]));
  if (units.size !== selected.length) return refuse("population_mismatch");
  const artifacts = new Map(
    [...plan.retentionPacket.artifacts, ...selected.map((u) => u.artifact)].map((a) => [key(a.unitId), a]),
  );
  const images = retainedCandidateImages(plan.retentionPacket);
  const provenance = new Map<string, GenerationArtifactInput>();
  const allowed: Record<Family, string[]> = {
    images: [],
    chunks: ["images", "chunks"],
    table_facts: ["images", "chunks"],
    embedding_fields: ["images", "chunks", "table_facts"],
    index_units: ["images", "chunks", "table_facts"],
  };
  for (const unit of selected) {
    const family = unit.declaration.id.family as Family;
    z.uuid().parse(unit.declaration.id.key);
    if (
      unit.declaration.groupKey !== "worker_core" ||
      unit.declaration.qualification !== "derived_unverified" ||
      unit.declaration.representation !== "provenance_json" ||
      unit.declaration.sourceEvidenceIds.length ||
      unit.artifact.byteLength > BLOB_LIMIT ||
      unit.artifact.locator !== `prepared:${family}:${unit.declaration.id.key}`
    )
      return refuse("prepared_mismatch");
    const body = unit.body as Record<string, unknown>;
    if (family === "images") {
      const image = candidateImageRowSchema.parse(body);
      const capture = images.find((c) => c.ordinal === image.capture_ordinal);
      if (
        !capture ||
        capture.documentId !== issued.documentId ||
        !same(image.descriptor, capture.descriptor) ||
        image.page_number !== capture.descriptor.pageNumber ||
        image.source_kind !== capture.descriptor.sourceKind ||
        !same(image.metadata, capture.descriptor.metadata ?? {}) ||
        capture.sourceEvidenceIds.length ||
        !args.input.extracted.pages.some((p) => p.pageNumber === image.page_number)
      )
        return refuse("capture_mismatch");
      provenance.set(key(unit.declaration.id), capture.provenance);
    } else if (family === "table_facts") candidateTableFactRowSchema.parse(body);
    else {
      if (unit.providerInputText === null) return refuse("body_mismatch");
      const metadata = body.metadata as Record<string, unknown>;
      if (
        metadata.index_generation_id !== issued.generationId ||
        ["ingestion_job_kind", "ingestion_job_id", "ingestion_lease_token"].some((k) => Object.hasOwn(metadata, k))
      )
        return refuse("body_mismatch");
    }
    for (const dep of unit.declaration.dependencies) {
      if (!artifacts.has(key(dep))) return refuse("parent_not_staged");
      if (families.includes(dep.family as Family)) {
        if (!units.has(key(dep)) || !allowed[family].includes(dep.family)) return refuse("parent_mismatch");
      } else if (!["pages", "private_objects", "attempt_control"].includes(dep.family))
        return refuse("parent_not_staged");
    }
  }
  const visited = new Set<string>();
  const active = new Set<string>();
  const visit = (id: string) => {
    if (active.has(id)) return refuse("parent_cycle");
    if (visited.has(id)) return;
    active.add(id);
    for (const dep of units.get(id)!.declaration.dependencies) if (units.has(key(dep))) visit(key(dep));
    active.delete(id);
    visited.add(id);
  };
  for (const id of units.keys()) visit(id);
  return { plan, selected, groups, units, artifacts, provenance, issued };
}

export function prepareManagedNativeParentClosurePacket(
  args: Basis & { vectors: Vectors },
): ManagedNativeParentClosurePacket {
  const basis = preflightManagedNativeParentClosure(args);
  const vectors = copy(args.vectors);
  const selected = basis.selected.filter((u) => !["images", "table_facts"].includes(u.declaration.id.family));
  if (
    !same(Object.keys(vectors).sort(), ["issued", "planDigest", "rows"]) ||
    !same(vectors.issued, basis.issued) ||
    vectors.planDigest !== basis.plan.digest ||
    !Array.isArray(vectors.rows) ||
    vectors.rows.length !== selected.length
  )
    return refuse("population_mismatch");
  const expected = new Map(selected.map((u) => [key(u.declaration.id), u]));
  const seen = new Set<string>();
  for (const row of vectors.rows) {
    if (!same(Object.keys(row).sort(), ["body", "family", "groupKey", "preparedArtifact", "preparedUnitId"]))
      return refuse("invalid_packet");
    const id = key(row.preparedUnitId);
    const unit = expected.get(id);
    if (
      !unit ||
      seen.has(id) ||
      row.family !== unit.declaration.id.family ||
      row.groupKey !== "worker_core" ||
      !same(row.preparedArtifact, unit.artifact)
    )
      return refuse("prepared_mismatch");
    checkedVector(row.body.embedding);
    seen.add(id);
    if (
      !same(row.body, {
        ...(unit.body as Record<string, unknown>),
        id: unit.declaration.id.key,
        embedding: row.body.embedding,
      })
    )
      return refuse("body_mismatch");
  }
  const rows = sorted(vectors.rows.map((row) => ({ ...row, rowId: row.preparedUnitId.key }))).map(
    ({ rowId, ...row }) => {
      void rowId;
      return row;
    },
  );
  const parents = sorted(
    basis.selected
      .filter((u) => ["images", "table_facts"].includes(u.declaration.id.family))
      .map((u) => ({
        family: u.declaration.id.family as "images" | "table_facts",
        groupKey: "worker_core" as const,
        preparedUnitId: u.declaration.id as { family: "images" | "table_facts"; key: string },
        preparedArtifact: { sha256: u.artifact.sha256, byteLength: u.artifact.byteLength, locator: u.artifact.locator },
        rowId: u.declaration.id.key,
      })),
  ).map(({ rowId, ...parent }) => {
    void rowId;
    return parent;
  });
  const packet: ManagedNativeParentClosurePacket = {
    version: "managed-native-parent-closure-v1",
    planDigest: basis.plan.digest,
    issued: basis.issued,
    rows,
    parents,
  };
  if (generationEvidenceBytes(packet).length > LIMIT) return refuse("transport_limit");
  return freezeGenerationEvidence(packet);
}

export async function produceManagedNativeParentClosurePacket(
  args: Parameters<typeof produceManagedProviderVectors>[0],
) {
  const { check, embed, assertEmbedding } = args;
  check();
  preflightManagedNativeParentClosure(args);
  check();
  const vectors = await produceManagedProviderVectors({ ...args, check, embed, assertEmbedding });
  check();
  const packet = prepareManagedNativeParentClosurePacket({ ...args, vectors });
  check();
  return packet;
}

/** Authenticate all five SQL-issued representations. This grants neither source completeness nor activation. */
export function decodeManagedNativeParentClosureReadback(
  args: Basis & { packet: ManagedNativeParentClosurePacket; response: unknown },
) {
  const basis = preflightManagedNativeParentClosure(args);
  const supplied = copy(args.packet);
  const packet = prepareManagedNativeParentClosurePacket({
    ...args,
    vectors: { issued: supplied.issued, planDigest: supplied.planDigest, rows: supplied.rows },
  });
  if (!same(supplied, packet)) return refuse("invalid_packet");
  const response = copy(args.response);
  if (generationEvidenceBytes(response).length > LIMIT) return refuse("transport_limit");
  const output = readbackSchema.parse(response).managedNativeParentClosure;
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
    output.projectionId !== basis.issued.generationId
  )
    return refuse("issued_mismatch");
  const ordered = sorted(
    basis.selected.map((u) => ({ family: u.declaration.id.family, rowId: u.declaration.id.key, unit: u })),
  );
  const manifest = manifestSchema.parse(committedJson(output.manifest).body);
  if (
    !same(manifest, {
      version: "managed-native-parent-closure-manifest-v1",
      qualification: "derived_unverified",
      scope: "complete_known_local_worker_core_output",
      identity,
      planDigest: packet.planDigest,
      projectionId: basis.issued.generationId,
      sourceExpectation: basis.plan.retentionPacket.registration.sourceExpectation,
      groups: basis.groups.map((g) => ({ family: g.family, groupKey: g.groupKey, declaration: g.declaration })),
      units: ordered.map(({ unit }) => ({ declaration: unit.declaration, prepared: pin(unit.artifact) })),
    })
  )
    return refuse("prepared_mismatch");
  if (output.rows.length !== ordered.length || !same(output.rows, sorted(output.rows)))
    return refuse("population_mismatch");
  const vectors = new Map(packet.rows.map((r) => [key(r.preparedUnitId), r]));
  const seen = new Map<string, { body: z.infer<typeof receiptSchema>; rowSha: string }>();
  const counts = { chunks: 0, embedding_fields: 0, images: 0, index_units: 0, table_facts: 0 };
  for (const row of output.rows) {
    const id = key({ family: row.family, key: row.rowId });
    const unit = basis.units.get(id);
    if (!unit || seen.has(id) || row.rowKind !== rowKind(row.family) || !same(row.prepared, pin(unit.artifact)))
      return refuse("population_mismatch");
    const vector = vectors.get(id);
    if (vector) {
      const normalized = expectedNormalized(vector, basis.issued);
      const actual = checkedVector(row.row.embedding);
      const suppliedVector = checkedVector(vector.body.embedding);
      if (actual.some((n, i) => Math.fround(n) !== Math.fround(suppliedVector[i]))) return refuse("invalid_vector");
      const a: Record<string, unknown> = { ...row.row };
      const b: Record<string, unknown> = { ...normalized };
      delete a.embedding;
      delete b.embedding;
      if (row.family === "index_units") {
        if (
          typeof a.quality_score !== "number" ||
          typeof b.quality_score !== "number" ||
          Math.fround(a.quality_score) !== Math.fround(b.quality_score)
        )
          return refuse("body_mismatch");
        delete a.quality_score;
        delete b.quality_score;
      }
      if (!same(a, b)) return refuse("body_mismatch");
    } else if (!same(row.row, unit.body)) return refuse("body_mismatch");
    const committed = committedJson(row.receipt);
    const body = receiptSchema.parse(committed.body);
    const text = vector ? Buffer.from(unit.providerInputText!, "utf8") : null;
    if (
      !same(body.identity, identity) ||
      body.planDigest !== packet.planDigest ||
      body.projectionId !== basis.issued.generationId ||
      body.family !== row.family ||
      body.rowId !== row.rowId ||
      body.rowKind !== row.rowKind ||
      !same(body.prepared, row.prepared) ||
      !same(body.row, row.row) ||
      !same(
        body.vectorInput,
        text ? { sha256: bytesDigest(text), byteLength: text.length, provenance: "supplied_unverified" } : null,
      )
    )
      return refuse("body_mismatch");
    seen.set(id, { body, rowSha: bytesDigest(sqlRowBytes(committed.text)) });
    counts[row.family]++;
  }
  if (!same(output.counts, counts)) return refuse("population_mismatch");
  const population = output.rows.map((row) => {
    const id = key({ family: row.family, key: row.rowId });
    const unit = basis.units.get(id)!;
    const item = seen.get(id)!;
    const parents = unit.declaration.dependencies.map((dep) => {
      const artifact = basis.artifacts.get(key(dep))!;
      if (!families.includes(dep.family as Family)) return retained(artifact);
      const parent = seen.get(key(dep));
      if (!parent) return refuse("parent_not_staged");
      return {
        kind: "row",
        unitId: dep,
        preparedSha256: artifact.sha256,
        preparedByteLength: artifact.byteLength,
        finalIdentity: { version: "managed-native-parent-closure-row-v1", family: dep.family, rowId: dep.key },
        normalizedRowSha256: parent.rowSha,
      };
    });
    const provenance = basis.provenance.get(id);
    if (
      !same(item.body.parents, parents) ||
      !same(item.body.retainedReferences, provenance ? [retained(provenance)] : [])
    )
      return refuse("parent_mismatch");
    return {
      family: row.family,
      rowId: row.rowId,
      rowKind: row.rowKind,
      preparedSha256: row.prepared.sha256,
      preparedByteLength: row.prepared.byteLength,
      normalizedRowSha256: item.rowSha,
      receiptSha256: row.receipt.sha256,
    };
  });
  const committedPopulation = populationSchema.parse(committedJson(output.populationCommitment).body);
  if (
    output.sqlPopulationDigest !== output.populationCommitment.sha256 ||
    !same(committedPopulation, {
      version: "managed-native-parent-closure-population-v1",
      identity,
      planDigest: packet.planDigest,
      projectionId: basis.issued.generationId,
      manifestSha256: output.manifest.sha256,
      population,
    })
  )
    return refuse("stored_mismatch");
  return freezeGenerationEvidence(output);
}

export async function stageManagedNativeParentClosure(
  args: Basis & {
    packet: ManagedNativeParentClosurePacket;
    fence: IngestionFence;
    writeRpc: (name: string, payload: Record<string, unknown>) => Promise<unknown>;
    readRpc: (name: string, payload: Record<string, unknown>) => Promise<unknown>;
    check: () => void;
  },
) {
  const { writeRpc, readRpc, check } = args;
  const issued = copy(parseIssuedAttemptControl(args.issued));
  const digest = args.expectedPlanDigest;
  const supplied = copy(args.packet);
  const packet = prepareManagedNativeParentClosurePacket({
    ...args,
    vectors: { issued: supplied.issued, planDigest: supplied.planDigest, rows: supplied.rows },
  });
  if (!same(supplied, packet)) return refuse("invalid_packet");
  const fence = copy(args.fence);
  if (
    !same(fence, {
      job_kind: "node",
      job_id: issued.jobId,
      document_id: issued.documentId,
      worker_id: issued.workerId,
      lease_token: issued.firstLeaseToken,
      expected_generation_id: issued.predecessorGenerationId,
      authority_digest: issued.authorityDigest,
    })
  )
    return refuse("issued_mismatch");
  const current = () => {
    check();
    if (
      args.expectedPlanDigest !== digest ||
      !same(args.issued, issued) ||
      !same(args.packet, packet) ||
      !same(args.fence, fence)
    )
      return refuse("issued_mismatch");
    preflightManagedNativeParentClosure({ input: args.input, issued, expectedPlanDigest: digest });
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
  const response = await writeRpc("write_ingestion_base_artifacts", copy(write));
  current();
  const written = decodeManagedNativeParentClosureReadback({ ...args, response });
  current();
  const read = await readRpc("read_ingestion_prepared_supplier_artifacts", {
    p_generation: issued.generationId,
    p_fence: { version: "managed-native-parent-closure-read-v1", fence: copy(fence), expectedPlanDigest: digest },
  });
  current();
  const decoded = decodeManagedNativeParentClosureReadback({ ...args, response: read });
  if (!same(written, decoded)) return refuse("replay_mismatch");
  current();
  return decoded;
}
