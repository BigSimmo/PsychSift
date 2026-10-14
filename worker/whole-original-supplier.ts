import { z } from "zod";
import { types } from "node:util";
import {
  attemptClaimCheckpointSchema,
  bytesDigest,
  freezeGenerationEvidence,
  generationEvidenceBytes,
  generationEvidenceDigest,
  generationEvidenceProfileVersion,
  generationEvidenceSlots,
  groupDeclarationSchema,
  outcomeInputSchema,
  parseGenerationArtifact,
  parseGenerationDeclarations,
  parseIssuedAttemptControl,
  parseOriginalApplicabilityWitness,
  parseRetainedImageDescriptor,
  parseSourceExpectation,
  unitIdSchema,
  unitDeclarationSchema,
  unitIdentity,
  type GenerationArtifactInput,
  type GenerationGroupDeclaration,
  type GenerationUnitDeclaration,
  type IssuedAttemptControl,
} from "../src/lib/ingestion-generation-evidence";
import { candidateImageRowSchema, candidateTableFactRowSchema, preparedRowSchema } from "./candidate-chunks";
import type { buildGenerationRetentionPacket } from "./generation-evidence";
import type { DocumentIndexUnitInput } from "../src/lib/document-index-units";
import type { EmbeddingFieldInput } from "./embedding-fields";

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const text = z.string().min(1);
const nullablePosition = z.number().int().nonnegative().safe().nullable();
const placementSchema = z
  .object({
    version: z.literal(1),
    documentId: uuid,
    generationId: uuid,
    sourceSha256: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    placementId: text,
    qualification: z.literal("derived_unverified"),
    descriptor: z.unknown(),
    binary: z
      .object({
        unitId: unitIdSchema,
        sha256: z.string().regex(/^sha256:[0-9a-f]{64}$/),
        byteLength: z.number().int().positive().safe(),
      })
      .strict(),
  })
  .strict();
type PreparedFieldInput = Omit<EmbeddingFieldInput, "field_type"> & {
  field_type: EmbeddingFieldInput["field_type"] | "section_context" | "document_title" | "document_summary";
};
const fieldSchema: z.ZodType<PreparedFieldInput> = z
  .object({
    document_id: uuid,
    owner_id: uuid.nullable(),
    source_chunk_id: uuid,
    field_type: z.enum([
      "chunk_high_yield",
      "table_row",
      "image_caption",
      "clinical_action",
      "threshold_fact",
      "section_context",
      "document_title",
      "document_summary",
    ]),
    content: text,
    metadata: z.record(z.string(), z.unknown()),
  })
  .strict();
const indexSchema: z.ZodType<DocumentIndexUnitInput> = z
  .object({
    owner_id: uuid.nullable(),
    document_id: uuid,
    unit_type: z.enum([
      "document_profile",
      "section_summary",
      "page_text",
      "chunk_evidence",
      "table_fact",
      "askable_question",
      "clinical_fact",
      "threshold",
      "workflow_step",
      "medication_monitoring",
      "alias",
      "vocabulary_term",
      "visual_summary",
      "flowchart_step",
      "diagram_decision",
      "risk_matrix_cell",
      "medication_chart_row",
      "chart_finding",
      "visual_askable_question",
      "table_threshold",
    ]),
    source_chunk_id: uuid.nullable(),
    source_image_id: uuid.nullable(),
    page_start: nullablePosition,
    page_end: nullablePosition,
    heading_path: z.array(z.string()),
    title: z.string(),
    content: text,
    normalized_terms: z.array(z.string()),
    source_span: z
      .object({
        page_number: nullablePosition,
        line_start: nullablePosition,
        line_end: nullablePosition,
        character_start: nullablePosition,
        character_end: nullablePosition,
        excerpt: z.string(),
      })
      .strict()
      .nullable(),
    quality_score: z.number().finite(),
    extraction_mode: z.enum(["deterministic", "model_heavy", "hybrid"]),
    metadata: z.record(z.string(), z.unknown()),
  })
  .strict();

const sectionSchema = z
  .object({
    document_id: uuid,
    owner_id: uuid.nullable(),
    section_index: z.number().int().nonnegative(),
    heading: z.string(),
    heading_path: z.array(z.string()),
    page_start: nullablePosition,
    page_end: nullablePosition,
    chunk_ids: z.array(uuid).min(1),
    summary: z.string(),
    tags: z.array(z.string()),
    extraction_quality: z.enum(["good", "partial", "poor"]),
    metadata: z.record(z.string(), z.unknown()),
  })
  .strict();
const memoryCardSchema = z
  .object({
    document_id: uuid,
    owner_id: uuid.nullable(),
    section_id: z.null(),
    section_index: z.number().int().nonnegative().optional(),
    card_type: z.enum([
      "section_summary",
      "askable_question",
      "table_row",
      "threshold",
      "medication",
      "risk",
      "workflow",
      "definition",
      "citation_anchor",
    ]),
    title: z.string(),
    content: z.string(),
    normalized_terms: z.array(z.string()),
    page_number: nullablePosition,
    source_chunk_ids: z.array(uuid),
    source_image_ids: z.array(uuid),
    confidence: z.number().finite().min(0).max(1),
    metadata: z.record(z.string(), z.unknown()),
  })
  .strict();
type UnitId = GenerationUnitDeclaration["id"];
export type WholeOriginalPreparedUnit = {
  declaration: GenerationUnitDeclaration;
  body: unknown;
  artifact: GenerationArtifactInput;
  /** Exact supplied provider input; null means not supplied, never completed output. */
  providerInputText: string | null;
  inputReferences: UnitId[];
  originalReferences: string[];
  auxiliary: boolean;
};
export type WholeOriginalProducerManifest = {
  group: GenerationGroupDeclaration;
  state: "prepared" | "pending" | "unavailable";
  units: WholeOriginalPreparedUnit[];
  inputReferences: UnitId[];
  /** Digest of {state, units, inputReferences}, not a provider-output receipt. */
  preparedManifestDigest: string;
};
const producerGroupInputSchema = groupDeclarationSchema.extend({
  declaration: groupDeclarationSchema.shape.declaration.extend({
    producer: groupDeclarationSchema.shape.declaration.shape.producer.omit({ outputManifestDigest: true }),
  }),
});
const preparedUnitInputSchema = z
  .object({
    declaration: unitDeclarationSchema,
    body: z.unknown(),
    /** Supplied prepared-artifact locator; it is not a persistence/readback receipt. */
    artifactLocator: text,
    providerInputText: z.string().nullable(),
    inputReferences: z.array(unitIdSchema),
    originalReferences: z.array(text),
    auxiliary: z.boolean(),
    /** Actual supplied chunk IDs only; these bindings confer no source credit. */
    qualificationChunkIds: z.array(uuid).optional(),
  })
  .strict();
const producerAssemblySchema = z
  .object({
    group: producerGroupInputSchema,
    state: z.enum(["prepared", "pending", "unavailable"]),
    units: z.array(preparedUnitInputSchema),
  })
  .strict();
export type WholeOriginalProducerAssemblyInput = z.infer<typeof producerAssemblySchema>;

/**
 * Packages actual ordinary prepared bodies under an independently supplied producer declaration.
 * The declared population is about prepared outputs, never whole-original applicability/fidelity.
 * Planning keys and derived bytes acquire no persistence identity or authenticated source credit.
 */
export function assembleWholeOriginalProducerManifest(
  args: WholeOriginalProducerAssemblyInput,
): WholeOriginalProducerManifest {
  // Copy before schema access so proxies/accessors cannot execute caller-owned code.
  const input = producerAssemblySchema.parse(copy(args));
  const { group, state } = input;
  if (
    !["chunks", "images", "embedding_fields", "index_units", "table_facts"].includes(group.family) &&
    !(["sections", "memory_cards"].includes(group.family) && group.groupKey === "deep_memory")
  )
    refuse("prepared_family_adapter_unavailable");
  if (
    (state === "prepared") !== (group.declaration.population.tag === "known") ||
    (state === "pending" && group.declaration.population.tag !== "unknown") ||
    (state === "unavailable" && group.declaration.population.tag !== "unavailable") ||
    (state !== "prepared" && input.units.length !== 0)
  )
    refuse("unavailable_is_not_empty");
  const units = input.units.map((unit): WholeOriginalPreparedUnit => {
    if (
      unit.declaration.id.family !== group.family ||
      unit.declaration.groupKey !== group.groupKey ||
      unit.declaration.representation !== "provenance_json"
    )
      refuse("producer_population_mismatch");
    if (unit.declaration.qualification !== "derived_unverified" || unit.declaration.sourceEvidenceIds.length)
      refuse("prepared_source_credit_unavailable");
    unique(unit.declaration.dependencies.map(unitIdentity), "duplicate_input_reference");
    unique(unit.inputReferences.map(unitIdentity), "duplicate_input_reference");
    unique(unit.originalReferences, "duplicate_source_reference");
    unique(unit.qualificationChunkIds ?? [], "duplicate_input_reference");
    if (unit.auxiliary && unit.originalReferences.length) refuse("auxiliary_source_credit");
    const qualifications: UnitId[] = (unit.qualificationChunkIds ?? []).map((key) => ({ family: "chunks", key }));
    const union = (refs: UnitId[]) => [...new Map(refs.map((ref) => [unitIdentity(ref), ref])).values()];
    const declaration = {
      ...unit.declaration,
      dependencies: union([...unit.declaration.dependencies, ...qualifications]),
    };
    const inputReferences = union([...unit.inputReferences, ...qualifications]);
    for (const ref of inputReferences)
      if (!declaration.dependencies.some((dependency) => same(dependency, ref))) refuse("foreign_input_reference");
    const bytes = generationEvidenceBytes(unit.body);
    return {
      declaration,
      body: unit.body,
      artifact: parseGenerationArtifact({
        unitId: declaration.id,
        groupKey: declaration.groupKey,
        representation: "provenance_json",
        bytesHex: bytes.toString("hex"),
        sha256: bytesDigest(bytes),
        byteLength: bytes.length,
        locator: unit.artifactLocator,
      }),
      providerInputText: unit.providerInputText,
      inputReferences,
      originalReferences: unit.originalReferences,
      auxiliary: unit.auxiliary,
    };
  });
  if (group.declaration.population.tag === "known") {
    const expected = group.declaration.population.expectedUnits.map(unitIdentity).sort();
    const actual = units.map((unit) => unitIdentity(unit.declaration.id)).sort();
    if (!same(expected, actual)) refuse("producer_population_mismatch");
  }
  const inputReferences = [
    ...new Map(units.flatMap((unit) => unit.inputReferences).map((ref) => [unitIdentity(ref), ref])).values(),
  ];
  const preparedManifestDigest = generationEvidenceDigest({ state, units, inputReferences });
  const completeGroup = {
    ...group,
    declaration: {
      ...group.declaration,
      producer: { ...group.declaration.producer, outputManifestDigest: preparedManifestDigest },
    },
  };
  parseGenerationDeclarations({ version: 1, groups: [completeGroup], units: units.map((unit) => unit.declaration) });
  return freezeGenerationEvidence({ group: completeGroup, state, units, inputReferences, preparedManifestDigest });
}
const literalRequirementSchema = z
  .object({
    sourceEvidenceId: text,
    role: text,
    evidence: z
      .array(
        z
          .object({
            unitId: unitIdSchema,
            byteOffset: z.number().int().nonnegative().safe(),
            bytesHex: z.string().regex(/^(?:[0-9a-f]{2})+$/),
          })
          .strict(),
      )
      .min(1),
    candidateUnits: z.array(unitIdSchema),
  })
  .strict();
const preparedArtifactCommitmentSchema = z
  .object({ sha256: z.string().regex(/^sha256:[0-9a-f]{64}$/), byteLength: z.number().int().nonnegative().safe() })
  .strict();
const tableRowBindingSchema = z
  .object({
    sourceEvidenceId: text,
    candidateUnitId: unitIdSchema,
    candidateArtifact: preparedArtifactCommitmentSchema,
    tableFactUnitId: unitIdSchema,
    tableFactArtifact: preparedArtifactCommitmentSchema,
    sourceChunkId: uuid,
    sourceChunkArtifact: preparedArtifactCommitmentSchema,
    sourceImageId: uuid,
    sourceImageArtifact: preparedArtifactCommitmentSchema,
    ownerId: uuid,
    pageNumber: z.number().int().positive().safe(),
    tableIndex: z.number().int().nonnegative().safe(),
    rowIndex: z.number().int().positive().safe(),
    columns: z.array(text).min(1),
    cells: z.array(z.string()).min(1),
    qualifications: z.array(
      z
        .object({
          sourceEvidenceId: text,
          chunkId: uuid,
          chunkArtifact: preparedArtifactCommitmentSchema,
          pageNumber: z.number().int().positive().safe(),
          contentByteOffset: z.number().int().nonnegative().safe(),
          bytesHex: z.string().regex(/^(?:[0-9a-f]{2})+$/),
        })
        .strict(),
    ),
  })
  .strict();
const roleRequirementsSchema = z
  .object({
    version: z.literal("whole-original-source-roles-v1"),
    sourceSha256: text,
    witnessSha256: text,
    sourceExpectationDigest: text,
    requirements: z.array(literalRequirementSchema),
    /** Independent declared associations and exact prepared-body pins; no native/source credit. */
    tableRows: z.array(tableRowBindingSchema).optional(),
    capabilities: z
      .object({
        captureApplicability: z.enum(["unknown", "pending"]),
        summary: z.enum(["unknown", "pending", "unavailable"]),
        model: z.enum(["unknown", "pending", "unavailable"]),
        deepMemory: z.enum(["unknown", "pending", "unavailable"]),
      })
      .strict(),
  })
  .strict();
export type WholeOriginalRoleRequirements = z.infer<typeof roleRequirementsSchema>;

function refuse(reason: string): never {
  throw new Error(`whole_original_supplier_${reason}`);
}
function copy<T>(value: T): T {
  return JSON.parse(generationEvidenceBytes(value).toString("utf8")) as T;
}
function same(a: unknown, b: unknown) {
  return generationEvidenceDigest(a) === generationEvidenceDigest(b);
}
function unique(values: string[], reason: string) {
  if (new Set(values).size !== values.length) refuse(reason);
}
function retainedBufferSnapshot(value: unknown): Buffer {
  if (
    typeof value !== "object" ||
    value === null ||
    types.isProxy(value) ||
    !Buffer.isBuffer(value) ||
    Object.getPrototypeOf(value) !== Buffer.prototype
  )
    refuse("requires_retained_buffers");
  const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
  const guardedKeys: PropertyKey[] = [
    ...Object.getOwnPropertyNames(Buffer.prototype),
    ...Object.getOwnPropertyNames(Uint8Array.prototype),
    ...Object.getOwnPropertyNames(typedArrayPrototype),
    "valueOf",
    "toJSON",
    Symbol.iterator,
    Symbol.toPrimitive,
    Symbol.toStringTag,
  ];
  if (guardedKeys.some((key) => Object.getOwnPropertyDescriptor(value, key))) refuse("requires_retained_buffers");
  // Native TypedArray access/copy reads internal slots, never caller-owned Buffer methods.
  // Numeric indexed properties cannot be decorated as accessors; do not enumerate upload bytes.
  const length = Object.getOwnPropertyDescriptor(typedArrayPrototype, "length")!.get!.call(value) as number;
  const snapshot = Buffer.alloc(length);
  Uint8Array.prototype.set.call(snapshot, value);
  return snapshot;
}
function graphClosure(units: GenerationUnitDeclaration[]) {
  const byId = new Map(units.map((unit) => [unitIdentity(unit.id), unit]));
  const done = new Set<string>();
  const active = new Set<string>();
  for (const unit of units) {
    const stack = [{ key: unitIdentity(unit.id), next: 0 }];
    while (stack.length) {
      const current = stack[stack.length - 1];
      const row = byId.get(current.key);
      if (!row) refuse("foreign_or_missing_dependency");
      active.add(current.key);
      if (current.next === row.dependencies.length) {
        done.add(current.key);
        active.delete(current.key);
        stack.pop();
        continue;
      }
      const key = unitIdentity(row.dependencies[current.next++]);
      if (!byId.has(key)) refuse("foreign_or_missing_dependency");
      if (active.has(key)) refuse("dependency_cycle");
      if (!done.has(key)) stack.push({ key, next: 0 });
    }
  }
  return byId;
}

function validateBody(unit: WholeOriginalPreparedUnit, issued: IssuedAttemptControl, unpersistedLocalMemory: boolean) {
  const family = unit.declaration.id.family;
  let body: { document_id: string; [key: string]: unknown };
  switch (family) {
    case "chunks":
      body = preparedRowSchema.parse(unit.body);
      break;
    case "images":
      body = candidateImageRowSchema.parse(unit.body);
      break;
    case "table_facts":
      body = candidateTableFactRowSchema.parse(unit.body);
      break;
    case "embedding_fields":
      body = fieldSchema.parse(unit.body);
      break;
    case "index_units":
      body = indexSchema.parse(unit.body);
      break;
    case "sections":
      if (unit.declaration.groupKey !== "deep_memory") refuse("prepared_family_adapter_unavailable");
      body = sectionSchema.parse(unit.body);
      break;
    case "memory_cards":
      if (unit.declaration.groupKey !== "deep_memory") refuse("prepared_family_adapter_unavailable");
      body = memoryCardSchema.parse(unit.body);
      break;
    default:
      return refuse("prepared_family_adapter_unavailable");
  }
  if (
    body.document_id !== issued.documentId ||
    ("index_generation_id" in body && body.index_generation_id !== issued.generationId)
  )
    refuse("body_control_mismatch");
  for (const key of ["id", "document_id", "owner_id", "index_generation_id", "source_chunk_id", "source_image_id"])
    if (body[key] !== undefined && body[key] !== null) uuid.parse(body[key]);
  if ("id" in body && body.id !== unit.declaration.id.key) refuse("body_wrapper_identity_mismatch");
  if (!same(body, unit.body) || unit.artifact.bytesHex !== generationEvidenceBytes(body).toString("hex"))
    refuse("prepared_body_bytes_mismatch");
  if (typeof unit.providerInputText !== "string" && unit.providerInputText !== null) refuse("provider_text_mismatch");
  if (
    ["sections", "memory_cards"].includes(family) ||
    (family === "index_units" && unit.declaration.groupKey === "deep_memory" && unpersistedLocalMemory)
  ) {
    if ((body.metadata as Record<string, unknown>).index_generation_id !== issued.generationId)
      refuse("body_control_mismatch");
    if (unit.providerInputText !== null) refuse("provider_text_mismatch");
  }
  if (family === "chunks" && unit.providerInputText !== body.content) refuse("main_vector_input_mismatch");
  if (family === "embedding_fields" && unit.providerInputText !== null && unit.providerInputText !== body.content)
    refuse("field_provider_input_mismatch");
  if (family === "index_units" && unit.providerInputText !== null) {
    const index = indexSchema.parse(body);
    const expected = [
      `Type: ${index.unit_type}`,
      `Title: ${index.title}`,
      index.heading_path.length ? `Path: ${index.heading_path.join(" > ")}` : "",
      `Content: ${index.content}`,
      index.normalized_terms.length ? `Terms: ${index.normalized_terms.join(", ")}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    if (unit.providerInputText !== expected) refuse("index_provider_input_mismatch");
  }
  if (unit.auxiliary && (unit.originalReferences.length || unit.declaration.sourceEvidenceIds.length))
    refuse("auxiliary_source_credit");
  return body;
}

/** Pure reconciliation of supplied manifests. It cannot assess native fidelity or activate effects. */
export function prepareWholeOriginalSupplier(args: {
  originalBytes: Buffer;
  witnessBytes?: Buffer;
  sourceExpectation: unknown;
  issued: IssuedAttemptControl;
  retentionPacket: ReturnType<typeof buildGenerationRetentionPacket>;
  roleRequirements: WholeOriginalRoleRequirements;
  producerManifests: WholeOriginalProducerManifest[];
}) {
  // Reject accessors/proxies before reading any caller-owned data (buffers are handled separately).
  if (
    !args ||
    typeof args !== "object" ||
    types.isProxy(args) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(args))
  )
    refuse("requires_plain_arguments");
  const properties = Object.getOwnPropertyDescriptors(args);
  const requiredKeys = [
    "originalBytes",
    "sourceExpectation",
    "issued",
    "retentionPacket",
    "roleRequirements",
    "producerManifests",
  ];
  if (
    requiredKeys.some((key) => !Object.hasOwn(properties, key)) ||
    Reflect.ownKeys(properties).some(
      (key) =>
        typeof key !== "string" ||
        ![...requiredKeys, "witnessBytes"].includes(key) ||
        !Object.hasOwn(properties[key], "value") ||
        !properties[key].enumerable,
    )
  )
    refuse("requires_plain_arguments");
  const originalBytes = retainedBufferSnapshot(properties.originalBytes.value);
  const witnessBytes =
    properties.witnessBytes?.value === undefined ? undefined : retainedBufferSnapshot(properties.witnessBytes.value);
  const input = copy({
    sourceExpectation: args.sourceExpectation,
    issued: args.issued,
    retentionPacket: args.retentionPacket,
    roleRequirements: args.roleRequirements,
    producerManifests: args.producerManifests,
  });
  const issued = parseIssuedAttemptControl(input.issued);
  const expectation = parseSourceExpectation(input.sourceExpectation);
  const witness = parseOriginalApplicabilityWitness({
    sourceExpectation: expectation,
    originalBytes,
    witnessBytes,
  });
  const packet = input.retentionPacket;
  const registration = packet.registration;
  if (
    registration.version !== 1 ||
    registration.profileVersion !== generationEvidenceProfileVersion ||
    packet.generationId !== issued.generationId ||
    registration.sourceSha256 !== expectation.sourceSha256 ||
    registration.sourceByteLength !== originalBytes.length ||
    !same(registration.sourceExpectation, expectation) ||
    registration.sourceExpectationSha256 !== generationEvidenceDigest(expectation) ||
    registration.sourceExpectationHex !== generationEvidenceBytes(expectation).toString("hex")
  )
    refuse("retention_source_mismatch");
  const retainedDeclarations = parseGenerationDeclarations({
    version: 1,
    groups: [...registration.declarations.groups, ...packet.declarations.groups],
    units: [...registration.declarations.units, ...packet.declarations.units],
  });
  const retained = packet.artifacts.map(parseGenerationArtifact);
  unique(
    retained.map((artifact) => unitIdentity(artifact.unitId)),
    "duplicate_retained_artifact",
  );
  const retainedUnits = new Map(retainedDeclarations.units.map((unit) => [unitIdentity(unit.id), unit]));
  for (const artifact of retained) {
    const unit = retainedUnits.get(unitIdentity(artifact.unitId));
    if (!unit || unit.groupKey !== artifact.groupKey || unit.representation !== artifact.representation)
      refuse("retention_artifact_declaration_mismatch");
    if (["document_projection", "image_provenance"].includes(artifact.representation)) {
      const projection = JSON.parse(Buffer.from(artifact.bytesHex, "hex").toString("utf8"));
      if (
        projection.documentId !== issued.documentId ||
        projection.generationId !== issued.generationId ||
        projection.sourceSha256 !== expectation.sourceSha256
      )
        refuse("retention_control_mismatch");
    }
  }
  for (const unit of retainedDeclarations.units)
    if (
      !(unit.id.family === "attempt_control" && unit.id.key === "preseal_checkpoint") &&
      !retained.some((artifact) => same(artifact.unitId, unit.id))
    )
      refuse("retained_declaration_population_missing");
  const outcomes = packet.outcomes.map((outcome) => outcomeInputSchema.parse(outcome));
  unique(
    outcomes.map((outcome) => unitIdentity(outcome.unitId)),
    "duplicate_retained_outcome",
  );
  for (const outcome of outcomes)
    if (
      outcome.disposition !== "retained" ||
      outcome.limitation !== null ||
      !retained.some(
        (artifact) =>
          same(artifact.unitId, outcome.unitId) &&
          artifact.groupKey === outcome.groupKey &&
          artifact.sha256 === outcome.artifactSha256,
      )
    )
      refuse("retained_outcome_artifact_mismatch");
  if (outcomes.length !== retained.length) refuse("retained_outcome_population_mismatch");
  const original = retained.find(
    (artifact) => artifact.unitId.family === "private_objects" && artifact.unitId.key === "original-source",
  );
  const sourceWitness = retained.find(
    (artifact) =>
      artifact.unitId.family === "private_objects" && artifact.unitId.key === "original-source-expectation-witness",
  );
  if (
    !original ||
    original.bytesHex !== originalBytes.toString("hex") ||
    (expectation.tag === "known" && (!sourceWitness || sourceWitness.sha256 !== expectation.witness!.sha256))
  )
    refuse("retained_original_or_witness_missing");
  const claim = retained.find(
    (artifact) => artifact.unitId.family === "attempt_control" && artifact.unitId.key === "claim_checkpoint",
  );
  if (!claim) refuse("issued_claim_missing");
  const checkpoint = attemptClaimCheckpointSchema.parse(
    JSON.parse(Buffer.from(claim.bytesHex, "hex").toString("utf8")),
  );
  if (
    !same(checkpoint, {
      ...issued,
      version: "ingestion-attempt-control-v1",
      phase: "claim",
      qualification: "derived_unverified",
      sourceSha256: expectation.sourceSha256,
      sourceByteLength: originalBytes.length,
      sourceExpectationDigest: registration.sourceExpectationSha256,
    })
  )
    refuse("issued_claim_mismatch");
  if (
    retained.some(
      (artifact) => artifact.unitId.family === "attempt_control" && artifact.unitId.key === "preseal_checkpoint",
    )
  )
    refuse("preseal_unavailable");
  const roles = roleRequirementsSchema.parse(input.roleRequirements);
  if (
    roles.sourceSha256 !== expectation.sourceSha256 ||
    roles.witnessSha256 !== expectation.witness?.sha256 ||
    roles.sourceExpectationDigest !== registration.sourceExpectationSha256
  )
    refuse("source_roles_identity_mismatch");
  const manifests = input.producerManifests;
  for (const manifest of manifests) {
    if (!["prepared", "pending", "unavailable"].includes(manifest.state)) refuse("producer_state_mismatch");
    if (
      manifest.preparedManifestDigest !==
      generationEvidenceDigest({
        state: manifest.state,
        units: manifest.units,
        inputReferences: manifest.inputReferences,
      })
    )
      refuse("producer_manifest_digest_mismatch");
    if (manifest.group.declaration.producer.outputManifestDigest !== manifest.preparedManifestDigest)
      refuse("producer_declaration_digest_mismatch");
    if (
      (manifest.state === "prepared") !== (manifest.group.declaration.population.tag === "known") ||
      (manifest.state === "pending" && manifest.group.declaration.population.tag !== "unknown") ||
      (manifest.state === "unavailable" && manifest.group.declaration.population.tag !== "unavailable") ||
      (manifest.state !== "prepared" && manifest.units.length !== 0)
    )
      refuse("unavailable_is_not_empty");
  }
  const declarations = parseGenerationDeclarations({
    version: 1,
    groups: [...retainedDeclarations.groups, ...manifests.map((manifest) => manifest.group)],
    units: [
      ...retainedDeclarations.units,
      ...manifests.flatMap((manifest) => manifest.units.map((unit) => unit.declaration)),
    ],
  });
  const byId = graphClosure(declarations.units);
  const sourceUnits = new Map((expectation.units ?? []).map((unit) => [unit.id, unit]));
  for (const unit of declarations.units) {
    for (const ref of unit.sourceEvidenceIds) if (!sourceUnits.has(ref)) refuse("foreign_source_reference");
  }
  const preparedUnits = manifests.flatMap((manifest) => manifest.units);
  const usedCaptureOrdinals = new Set<number>();
  for (const manifest of manifests) {
    unique(manifest.inputReferences.map(unitIdentity), "duplicate_input_reference");
    for (const ref of manifest.inputReferences) if (!byId.has(unitIdentity(ref))) refuse("foreign_input_reference");
    for (const unit of manifest.units) {
      if (unit.declaration.qualification !== "derived_unverified" || unit.declaration.sourceEvidenceIds.length)
        refuse("prepared_source_credit_unavailable");
      if (unit.declaration.id.family !== manifest.group.family || unit.declaration.groupKey !== manifest.group.groupKey)
        refuse("producer_population_mismatch");
      const artifact = parseGenerationArtifact(unit.artifact);
      if (
        !same(artifact.unitId, unit.declaration.id) ||
        artifact.groupKey !== unit.declaration.groupKey ||
        artifact.representation !== unit.declaration.representation
      )
        refuse("prepared_artifact_declaration_mismatch");
      const body = validateBody(unit, issued, manifest.group.declaration.artifactGenerationId === null);
      if (unit.declaration.id.family === "images") {
        const ordinal = body.capture_ordinal as number;
        if (usedCaptureOrdinals.has(ordinal)) refuse("duplicate_image_capture_ordinal");
        usedCaptureOrdinals.add(ordinal);
        const provenance = retained.find(
          (row) =>
            row.unitId.family === "private_objects" && row.unitId.key === `image:${body.capture_ordinal}:provenance`,
        );
        if (!provenance) refuse("image_retention_reference_missing");
        const parsedPlacement = placementSchema.safeParse(
          JSON.parse(Buffer.from(provenance.bytesHex, "hex").toString("utf8")),
        );
        if (!parsedPlacement.success) refuse("image_retention_binary_binding_mismatch");
        const placement = parsedPlacement.data;
        const descriptor = parseRetainedImageDescriptor(placement.descriptor);
        const expectedBinaryId = { family: "private_objects", key: `image:${ordinal}:binary` } as const;
        const binary = retained.find((row) => same(row.unitId, expectedBinaryId));
        const provenanceDeclaration = retainedUnits.get(unitIdentity(provenance.unitId));
        if (
          placement.version !== 1 ||
          placement.placementId !== String(ordinal) ||
          placement.qualification !== "derived_unverified" ||
          !binary ||
          !same(placement.binary?.unitId, expectedBinaryId) ||
          placement.binary.sha256 !== binary.sha256 ||
          placement.binary.byteLength !== binary.byteLength ||
          !same(provenanceDeclaration?.dependencies, [expectedBinaryId]) ||
          !same(unit.declaration.dependencies, [expectedBinaryId]) ||
          !same(unit.inputReferences, [expectedBinaryId])
        )
          refuse("image_retention_binary_binding_mismatch");
        if (
          !same(descriptor, body.descriptor) ||
          body.page_number !== descriptor.pageNumber ||
          body.source_kind !== descriptor.sourceKind
        )
          refuse("image_descriptor_mismatch");
        if (body.source_kind === "cover_page" && !unit.auxiliary) refuse("auxiliary_cover_required");
      }
      const rowLinks: UnitId[] = [];
      const metadata = body.metadata as Record<string, unknown>;
      const imageRefs: string[] = [];
      const chunkRefs: string[] = [];
      if (unit.declaration.id.family === "index_units" && unit.declaration.groupKey === "deep_memory") {
        if (metadata.chunk_ids !== undefined) chunkRefs.push(...z.array(uuid).parse(metadata.chunk_ids));
        if (metadata.source === "document_sections") {
          const sectionParents = preparedUnits.filter(
            (parent) =>
              parent.declaration.id.family === "sections" &&
              parent.declaration.groupKey === "deep_memory" &&
              same((parent.body as Record<string, unknown>).chunk_ids, metadata.chunk_ids),
          );
          if (sectionParents.length !== 1) refuse("body_reference_dependency_mismatch");
          rowLinks.push(sectionParents[0].declaration.id);
        }
      }
      if (unit.declaration.id.family === "sections") chunkRefs.push(...z.array(uuid).parse(body.chunk_ids));
      if (unit.declaration.id.family === "memory_cards") {
        chunkRefs.push(...z.array(uuid).parse(body.source_chunk_ids));
        imageRefs.push(...z.array(uuid).parse(body.source_image_ids));
        if (metadata.chunk_ids !== undefined) chunkRefs.push(...z.array(uuid).parse(metadata.chunk_ids));
        if (typeof body.section_index === "number") {
          const sectionParents = preparedUnits.filter(
            (parent) =>
              parent.declaration.id.family === "sections" &&
              parent.declaration.groupKey === "deep_memory" &&
              (parent.body as Record<string, unknown>).section_index === body.section_index,
          );
          if (
            sectionParents.length !== 1 ||
            !unit.declaration.dependencies.some((ref) => same(ref, sectionParents[0].declaration.id))
          )
            refuse("body_reference_dependency_mismatch");
          rowLinks.push(sectionParents[0].declaration.id);
        }
      }
      for (const [record, key, refs] of [
        [body, "source_image_id", imageRefs],
        [metadata, "source_image_id", imageRefs],
        [body, "source_chunk_id", chunkRefs],
        [metadata, "source_chunk_id", chunkRefs],
      ] as const) {
        const value = record[key];
        if (value !== undefined && value !== null) refs.push(uuid.parse(value));
      }
      for (const [key, refs] of [
        ["source_image_ids", imageRefs],
        ["source_chunk_ids", chunkRefs],
      ] as const) {
        if (metadata[key] !== undefined) refs.push(...z.array(uuid).parse(metadata[key]));
      }
      for (const sourceImageId of imageRefs) {
        const image = preparedUnits.find(
          (candidate) => candidate.declaration.id.family === "images" && candidate.declaration.id.key === sourceImageId,
        );
        if (!image || !unit.declaration.dependencies.some((ref) => same(ref, image.declaration.id)))
          refuse("body_reference_dependency_mismatch");
        if (
          image.auxiliary &&
          (!unit.auxiliary || unit.originalReferences.length || unit.declaration.sourceEvidenceIds.length)
        )
          refuse("auxiliary_source_credit");
      }
      for (const key of imageRefs) rowLinks.push({ family: "images", key });
      for (const key of chunkRefs) rowLinks.push({ family: "chunks", key });
      for (const [key, family] of [
        ["source_chunk_id", "chunks"],
        ["source_image_id", "images"],
      ] as const)
        if (typeof body[key] === "string") rowLinks.push({ family, key: body[key] });
      // Ordinary chunk image_ids are associations, not whole-content derivation claims.
      // Mixed prose stays nonauxiliary; its proposed original references/literal matches remain unverified.
      if (Array.isArray(body.image_ids)) for (const key of body.image_ids) rowLinks.push({ family: "images", key });
      for (const link of rowLinks)
        if (
          !byId.has(unitIdentity(link)) ||
          !unit.declaration.dependencies.some((ref) => same(ref, link)) ||
          (unit.declaration.groupKey === "deep_memory" && !unit.inputReferences.some((ref) => same(ref, link)))
        )
          refuse("body_reference_dependency_mismatch");
      unique(unit.inputReferences.map(unitIdentity), "duplicate_input_reference");
      for (const ref of unit.inputReferences)
        if (
          !byId.has(unitIdentity(ref)) ||
          !manifest.inputReferences.some((inputRef) => same(inputRef, ref)) ||
          !unit.declaration.dependencies.some((dependency) => same(dependency, ref))
        )
          refuse("foreign_input_reference");
      unique(unit.originalReferences, "duplicate_source_reference");
      for (const ref of unit.originalReferences) {
        const source = sourceUnits.get(ref);
        if (!source) refuse("foreign_source_reference");
        if (source.dependencies.some((dependency) => !unit.originalReferences.includes(dependency)))
          refuse("qualification_dependency_missing");
      }
    }
    if (
      manifest.inputReferences.some(
        (ref) => !manifest.units.some((unit) => unit.inputReferences.some((inputRef) => same(inputRef, ref))),
      )
    )
      refuse("producer_input_population_mismatch");
  }
  unique(
    roles.requirements.map((role) => role.sourceEvidenceId),
    "duplicate_source_role",
  );
  const roleIds = new Set(roles.requirements.map((role) => role.sourceEvidenceId));
  const retainedById = new Map(retained.map((artifact) => [unitIdentity(artifact.unitId), artifact]));
  const uncovered: { sourceEvidenceId: string; reason: string }[] = [];
  const retainedLiteralAvailability: {
    sourceEvidenceId: string;
    status: "available_unverified" | "missing_literal";
  }[] = [];
  const preparedCandidateCoverage: {
    sourceEvidenceId: string;
    unitId: UnitId | null;
    status: "matched_literal_unverified" | "missing_literal" | "unassessed_no_candidates" | "unassessed_nontext";
  }[] = [];
  for (const source of sourceUnits.values())
    if (source.required && !roleIds.has(source.id))
      uncovered.push({ sourceEvidenceId: source.id, reason: "source_role_missing" });
  for (const role of roles.requirements) {
    const source = sourceUnits.get(role.sourceEvidenceId);
    if (!source) refuse("foreign_source_role");
    if (source.dependencies.some((id) => !roleIds.has(id)))
      uncovered.push({ sourceEvidenceId: role.sourceEvidenceId, reason: "qualifier_role_missing" });
    unique(role.candidateUnits.map(unitIdentity), "duplicate_candidate_reference");
    for (const id of role.candidateUnits) {
      const candidate = preparedUnits.find((unit) => same(unit.declaration.id, id));
      if (!candidate) refuse("foreign_candidate_reference");
      if (candidate.auxiliary) refuse("auxiliary_source_credit");
      const body = candidate.body as Record<string, unknown>;
      const textual =
        ["chunks", "embedding_fields", "index_units"].includes(id.family) && typeof body.content === "string";
      const status = !textual
        ? "unassessed_nontext"
        : role.evidence.every((evidence) =>
              Buffer.from(body.content as string, "utf8").includes(Buffer.from(evidence.bytesHex, "hex")),
            )
          ? "matched_literal_unverified"
          : "missing_literal";
      preparedCandidateCoverage.push({ sourceEvidenceId: role.sourceEvidenceId, unitId: id, status });
    }
    if (role.candidateUnits.length === 0)
      preparedCandidateCoverage.push({
        sourceEvidenceId: role.sourceEvidenceId,
        unitId: null,
        status: "unassessed_no_candidates",
      });
    let literalMissing = false;
    for (const evidence of role.evidence) {
      const artifact = retainedById.get(unitIdentity(evidence.unitId));
      if (!artifact) refuse("foreign_literal_reference");
      const bytes = artifact ? Buffer.from(artifact.bytesHex, "hex") : Buffer.alloc(0);
      const expected = Buffer.from(evidence.bytesHex, "hex");
      if (
        evidence.byteOffset + expected.length > bytes.length ||
        !bytes.subarray(evidence.byteOffset, evidence.byteOffset + expected.length).equals(expected)
      ) {
        literalMissing = true;
        uncovered.push({ sourceEvidenceId: role.sourceEvidenceId, reason: "literal_bytes_missing_or_changed" });
      }
    }
    retainedLiteralAvailability.push({
      sourceEvidenceId: role.sourceEvidenceId,
      status: literalMissing ? "missing_literal" : "available_unverified",
    });
  }
  // An absent optional contract must leave every legacy result field and digest unchanged.
  const declaredTableAssociations =
    roles.tableRows === undefined
      ? undefined
      : (() => {
          const preparedById = new Map(preparedUnits.map((unit) => [unitIdentity(unit.declaration.id), unit]));
          const rolesById = new Map(roles.requirements.map((role) => [role.sourceEvidenceId, role]));
          unique(
            roles.tableRows!.map((row) => unitIdentity(row.candidateUnitId)),
            "duplicate_candidate_reference",
          );
          const pinned = (unit: WholeOriginalPreparedUnit, pin: z.infer<typeof preparedArtifactCommitmentSchema>) =>
            unit.artifact.sha256 === pin.sha256 && unit.artifact.byteLength === pin.byteLength;
          const matches = (actual: unknown, expected: unknown) => actual !== undefined && same(actual, expected);
          const anchored = (role: z.infer<typeof literalRequirementSchema>, page: number) =>
            role.evidence.length === 1 &&
            role.evidence.every((evidence) => {
              const retainedArtifact = retainedById.get(unitIdentity(evidence.unitId));
              if (
                !retainedArtifact ||
                evidence.unitId.family !== "private_objects" ||
                ![`page:${page}:extracted`, `page:${page}:persisted`].includes(evidence.unitId.key) ||
                !["extracted_utf8", "persisted_utf8"].includes(retainedArtifact.representation)
              )
                return false;
              const bytes = Buffer.from(retainedArtifact.bytesHex, "hex");
              const literal = Buffer.from(evidence.bytesHex, "hex");
              return bytes.subarray(evidence.byteOffset, evidence.byteOffset + literal.length).equals(literal);
            });
          const rows = roles.tableRows!.map((binding) => {
            const reasons: string[] = [];
            const candidate = preparedById.get(unitIdentity(binding.candidateUnitId));
            const fact = preparedById.get(unitIdentity(binding.tableFactUnitId));
            const chunk = preparedById.get(unitIdentity({ family: "chunks", key: binding.sourceChunkId }));
            const image = preparedById.get(unitIdentity({ family: "images", key: binding.sourceImageId }));
            if (
              !candidate ||
              !fact ||
              !chunk ||
              !image ||
              binding.candidateUnitId.family !== "index_units" ||
              binding.tableFactUnitId.family !== "table_facts"
            )
              refuse("declared_table_binding_identity_mismatch");
            const rowBody = indexSchema.parse(candidate.body);
            const factBody = candidateTableFactRowSchema.parse(fact.body);
            const chunkBody = preparedRowSchema.parse(chunk.body);
            const imageBody = candidateImageRowSchema.parse(image.body);
            const current = (body: {
              document_id: string;
              metadata: Record<string, unknown>;
              owner_id?: string | null;
              index_generation_id?: string;
            }) =>
              body.document_id === issued.documentId &&
              (body.owner_id === undefined || body.owner_id === binding.ownerId) &&
              (body.index_generation_id === undefined || body.index_generation_id === issued.generationId) &&
              (body.metadata.index_generation_id === undefined ||
                body.metadata.index_generation_id === issued.generationId) &&
              (body.metadata.ingestion_job_id === undefined || body.metadata.ingestion_job_id === issued.jobId) &&
              (body.metadata.ingestion_lease_token === undefined ||
                body.metadata.ingestion_lease_token === issued.firstLeaseToken);
            if (
              ![rowBody, factBody, chunkBody, imageBody].every(current) ||
              rowBody.metadata.index_generation_id !== issued.generationId
            )
              refuse("declared_table_binding_control_mismatch");
            if ([candidate, fact, chunk, image].some((unit) => unit.auxiliary)) refuse("auxiliary_source_credit");
            if (
              !pinned(candidate, binding.candidateArtifact) ||
              !pinned(fact, binding.tableFactArtifact) ||
              !pinned(chunk, binding.sourceChunkArtifact) ||
              !pinned(image, binding.sourceImageArtifact)
            )
              reasons.push("prepared_body_commitment_mismatch");
            const descriptor = parseRetainedImageDescriptor(imageBody.descriptor);
            const table = descriptor.metadata ?? {};
            const rowTable = rowBody.metadata.native_table_descriptor as Record<string, unknown> | null | undefined;
            const source = sourceUnits.get(binding.sourceEvidenceId);
            const rowRole = rolesById.get(binding.sourceEvidenceId);
            if (
              !source ||
              !rowRole ||
              !anchored(rowRole, binding.pageNumber) ||
              !rowRole.candidateUnits.some((id) => same(id, chunk.declaration.id)) ||
              !chunk.declaration.dependencies.some((id) =>
                same(id, { family: "pages", key: String(binding.pageNumber) }),
              )
            )
              reasons.push("independent_row_anchor_unavailable");
            else {
              const raw = Buffer.from(rowRole.evidence[0].bytesHex, "hex").toString("utf8").trim();
              const inner = raw.startsWith("|") && raw.endsWith("|") ? raw.slice(1, -1) : raw;
              if (
                !same(
                  inner.split("|").map((cell) => cell.trim()),
                  binding.cells,
                ) ||
                !Buffer.from(chunkBody.content, "utf8").includes(Buffer.from(rowRole.evidence[0].bytesHex, "hex"))
              )
                reasons.push("declared_row_literal_mismatch");
            }
            if (
              binding.columns.length !== binding.cells.length ||
              rowBody.unit_type !== "table_fact" ||
              rowBody.source_chunk_id !== binding.sourceChunkId ||
              rowBody.source_image_id !== binding.sourceImageId ||
              rowBody.page_start !== binding.pageNumber ||
              rowBody.page_end !== binding.pageNumber ||
              chunkBody.page_number !== binding.pageNumber ||
              factBody.source_chunk_id !== binding.sourceChunkId ||
              factBody.source_image_id !== binding.sourceImageId ||
              factBody.page_number !== binding.pageNumber ||
              imageBody.page_number !== binding.pageNumber ||
              descriptor.pageNumber !== binding.pageNumber ||
              descriptor.sourceKind !== "table_crop" ||
              table.table_index !== binding.tableIndex ||
              !matches(table.table_columns, binding.columns) ||
              !Array.isArray(table.table_rows) ||
              !matches(table.table_rows[binding.rowIndex], binding.cells) ||
              rowTable?.table_index !== binding.tableIndex ||
              !matches(rowTable?.table_columns, binding.columns) ||
              !Array.isArray(rowTable?.table_rows) ||
              !matches(rowTable.table_rows[binding.rowIndex], binding.cells) ||
              !matches(factBody.metadata.columns, binding.columns) ||
              !matches(factBody.metadata.cells, binding.cells) ||
              factBody.metadata.row_index !== binding.rowIndex ||
              !matches(rowBody.metadata.columns, binding.columns) ||
              !matches(rowBody.metadata.cells, binding.cells) ||
              rowBody.metadata.row_index !== binding.rowIndex ||
              !matches(rowBody.metadata.table_fact_metadata, factBody.metadata) ||
              !matches(
                rowBody.metadata.named_cells,
                binding.columns.map((column, index) => ({ column, cell: binding.cells[index] })),
              ) ||
              rowBody.content !==
                binding.columns.map((column, index) => `${column}: ${binding.cells[index]}`).join(" | ") ||
              factBody.threshold_value !== null ||
              factBody.action !== null ||
              rowBody.metadata.threshold_value !== null ||
              rowBody.metadata.action !== null ||
              rowBody.metadata.source_qualification !== "derived_unverified"
            )
              reasons.push("declared_row_association_mismatch");
            if (
              !candidate.declaration.dependencies.some((id) => same(id, binding.tableFactUnitId)) ||
              !candidate.inputReferences.some((id) => same(id, binding.tableFactUnitId))
            )
              reasons.push("declared_row_parent_missing");
            const qualifierIds = binding.qualifications.map((qualification) => qualification.sourceEvidenceId);
            unique(qualifierIds, "duplicate_source_reference");
            if (
              !source ||
              !same([...source.dependencies].sort(), [...qualifierIds].sort()) ||
              ![binding.sourceEvidenceId, ...qualifierIds].every(
                (id) => candidate.originalReferences.includes(id) && fact.originalReferences.includes(id),
              )
            )
              reasons.push("declared_qualification_association_missing");
            const qualifications = binding.qualifications.map((qualification) => {
              const qualifier = preparedById.get(unitIdentity({ family: "chunks", key: qualification.chunkId }));
              const role = rolesById.get(qualification.sourceEvidenceId);
              if (!qualifier || !role) {
                reasons.push("qualification_chunk_or_role_unavailable");
                return null;
              }
              if (qualifier.auxiliary) refuse("auxiliary_source_credit");
              const body = preparedRowSchema.parse(qualifier.body);
              const id = qualifier.declaration.id;
              const literal = Buffer.from(qualification.bytesHex, "hex");
              if (!current(body) || body.page_number !== qualification.pageNumber)
                refuse("declared_table_binding_control_mismatch");
              if (
                !anchored(role, qualification.pageNumber) ||
                role.evidence[0].bytesHex !== qualification.bytesHex ||
                !role.candidateUnits.some((candidateId) => same(candidateId, id)) ||
                !qualifier.originalReferences.includes(qualification.sourceEvidenceId) ||
                !qualifier.declaration.dependencies.some((dependency) =>
                  same(dependency, { family: "pages", key: String(qualification.pageNumber) }),
                )
              )
                reasons.push("qualification_retained_role_anchor_unavailable");
              if (
                !pinned(qualifier, qualification.chunkArtifact) ||
                !Buffer.from(body.content, "utf8")
                  .subarray(qualification.contentByteOffset, qualification.contentByteOffset + literal.length)
                  .equals(literal)
              )
                reasons.push("full_qualification_chunk_mismatch");
              if (
                ![candidate, fact].every(
                  (unit) =>
                    unit.declaration.dependencies.some((dependency) => same(dependency, id)) &&
                    unit.inputReferences.some((reference) => same(reference, id)),
                )
              )
                reasons.push("qualification_dependency_binding_missing");
              return {
                sourceEvidenceId: qualification.sourceEvidenceId,
                pageNumber: qualification.pageNumber,
                chunkId: id,
                contentByteOffset: qualification.contentByteOffset,
                bytesHex: qualification.bytesHex,
                retainedEvidence: role.evidence,
                body,
                artifact: qualifier.artifact,
              };
            });
            const identity = {
              sourceEvidenceId: binding.sourceEvidenceId,
              candidateUnitId: binding.candidateUnitId,
              tableFactUnitId: binding.tableFactUnitId,
            };
            if (reasons.length)
              return { ...identity, status: "incomplete_derived_association" as const, reasons: [...new Set(reasons)] };
            return {
              ...identity,
              status: "matched_declared_association_unverified" as const,
              reasons: [],
              row: { body: rowBody, artifact: candidate.artifact },
              sourceChunk: { body: chunkBody, artifact: chunk.artifact },
              qualifications,
            };
          });
          return {
            status:
              rows.length && rows.every((row) => row.status === "matched_declared_association_unverified")
                ? ("matched_declared_association_unverified" as const)
                : ("incomplete_derived_association" as const),
            limitation: rows.length ? null : "independent_table_associations_unavailable",
            rows,
          };
        })();
  const blockers = [
    "live_fence_unverified",
    "native_mapping_unavailable",
    "source_completeness_unavailable",
    "capture_applicability_unassessed",
    "provider_vectors_unavailable",
    "ordinary_transport_readback_unavailable",
    "preseal_unavailable",
    "publication_unavailable",
  ];
  if (witness.status !== "typed_original_requirements") blockers.push("typed_original_requirements_unavailable");
  if (uncovered.length) blockers.push("source_roles_uncovered");
  if (preparedCandidateCoverage.some((row) => row.status === "missing_literal"))
    blockers.push("prepared_candidate_literal_loss");
  if (preparedCandidateCoverage.some((row) => row.status.startsWith("unassessed")))
    blockers.push("prepared_candidate_coverage_unassessed");
  if (declaredTableAssociations?.status === "incomplete_derived_association")
    blockers.push("declared_table_association_incomplete");
  for (const [name, state] of Object.entries(roles.capabilities)) blockers.push(`${name}_${state}`);
  for (const manifest of manifests)
    if (manifest.state !== "prepared")
      blockers.push(`${manifest.group.family}:${manifest.group.groupKey}:${manifest.state}`);
  const plan = {
    version: "whole-original-prepared-supplier-v1",
    status: "prepared_blocked",
    activated: false,
    issued,
    source: {
      sha256: bytesDigest(originalBytes),
      byteLength: originalBytes.length,
      witnessSha256: witnessBytes ? bytesDigest(witnessBytes) : null,
    },
    retentionPacket: packet,
    originalApplicability: witness,
    roleRequirements: roles,
    producerManifests: manifests,
    declarations,
    uncovered,
    retainedLiteralAvailability,
    preparedCandidateCoverage,
    ...(declaredTableAssociations === undefined ? {} : { declaredTableAssociations }),
    auxiliaryUnits: preparedUnits.filter((unit) => unit.auxiliary).map((unit) => unit.declaration.id),
    blockers,
  };
  return freezeGenerationEvidence({ ...plan, digest: generationEvidenceDigest(plan) });
}

type PreparedSupplierPlan = ReturnType<typeof prepareWholeOriginalSupplier>;
export const PREPARED_SUPPLIER_READBACK_MAX_BYTES = 16 * 1024 * 1024;

/** Revalidate caller-held expectations; they are not reconstructed authority. */
function checkedPreparedSupplierPlan(value: PreparedSupplierPlan) {
  generationEvidenceBytes(value);
  const plan = copy(value);
  const original = plan.retentionPacket.artifacts.find((a) => a.representation === "original_binary");
  const witness = plan.retentionPacket.artifacts.find((a) => a.representation === "source_expectation_witness");
  if (!original) refuse("readback_original_missing");
  parseGenerationArtifact(original);
  if (witness) parseGenerationArtifact(witness);
  const checked = prepareWholeOriginalSupplier({
    originalBytes: Buffer.from(original.bytesHex, "hex"),
    ...(witness ? { witnessBytes: Buffer.from(witness.bytesHex, "hex") } : {}),
    sourceExpectation: plan.retentionPacket.registration.sourceExpectation,
    issued: plan.issued,
    retentionPacket: plan.retentionPacket,
    roleRequirements: plan.roleRequirements,
    producerManifests: plan.producerManifests,
  });
  if (!same(checked, plan)) refuse("readback_plan_mismatch");
  return checked;
}

function preparedSupplierArtifacts(plan: PreparedSupplierPlan) {
  const artifacts = [
    ...plan.retentionPacket.artifacts,
    ...plan.producerManifests.flatMap((m) => m.units.map((u) => u.artifact)),
  ].map(parseGenerationArtifact);
  unique(
    artifacts.map((a) => unitIdentity(a.unitId)),
    "readback_duplicate_artifact",
  );
  return artifacts;
}

function preparedSupplierOutcomes(plan: PreparedSupplierPlan) {
  const outcomes = [
    ...plan.retentionPacket.outcomes,
    ...plan.producerManifests.flatMap((m) =>
      m.units.map((u) => ({
        unitId: u.declaration.id,
        groupKey: u.declaration.groupKey,
        disposition: "retained",
        artifactSha256: u.artifact.sha256,
        limitation: null,
      })),
    ),
  ].map((o) => outcomeInputSchema.parse(o));
  unique(
    outcomes.map((o) => unitIdentity(o.unitId)),
    "readback_duplicate_outcome",
  );
  return outcomes;
}

/** Size only: never an issued inventory, acknowledgement or substitute readback validator. */
function assertFourPageStageTransport(
  plan: PreparedSupplierPlan,
  artifacts: ReturnType<typeof preparedSupplierArtifacts>,
  outcomes: ReturnType<typeof preparedSupplierOutcomes>,
  calls: [string, Record<string, unknown>][],
) {
  const issued = plan.issued;
  const fence = {
    job_kind: "node",
    job_id: issued.jobId,
    document_id: issued.documentId,
    worker_id: issued.workerId,
    lease_token: issued.firstLeaseToken,
    expected_generation_id: issued.predecessorGenerationId,
    authority_digest: issued.authorityDigest,
  };
  // PostgreSQL jsonb adds separator spaces and expands exponent-form numeric tokens.
  // Count outside strings; binary hex remains counted once, byte for byte.
  const sqlJsonUpperBytes = (value: unknown) => {
    const encoded = generationEvidenceBytes(value);
    const json = encoded.toString("utf8");
    let size = encoded.length;
    let quoted = false;
    for (let index = 0; index < json.length; index++) {
      const char = json[index];
      if (quoted) {
        if (char === "\\") index++;
        else if (char === '"') quoted = false;
      } else if (char === '"') quoted = true;
      else if (char === ":" || char === ",") size++;
      else if (char === "-" || /[0-9]/.test(char)) {
        const token = /^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/i.exec(json.slice(index))![0];
        const exponent = /e([+-]?\d+)$/i.exec(token);
        if (exponent) size += Math.abs(Number(exponent[1])) + 2;
        index += token.length - 1;
      }
    }
    return size;
  };
  for (const [, payload] of calls)
    if (
      sqlJsonUpperBytes({ p_fence: fence, p_generation: issued.generationId, ...payload }) >
      PREPARED_SUPPLIER_READBACK_MAX_BYTES
    )
      refuse("stage_transport_limit_exceeded");
  if (artifacts.reduce((sum, artifact) => sum + artifact.byteLength * 2, 0) > PREPARED_SUPPLIER_READBACK_MAX_BYTES)
    refuse("stage_transport_limit_exceeded");
  const identity = {
    documentId: issued.documentId,
    ownerId: "00000000-0000-4000-8000-000000000000",
    generationId: issued.generationId,
    jobId: issued.jobId,
    firstLeaseToken: issued.firstLeaseToken,
    authorityDigest: issued.authorityDigest,
    sourceSha256: plan.source.sha256,
    sourceByteLength: plan.source.byteLength,
    sourceExpectationDigest: plan.retentionPacket.registration.sourceExpectationSha256,
  };
  const inventory = {
    version: 1,
    documentId: issued.documentId,
    generationId: issued.generationId,
    jobId: issued.jobId,
    firstLeaseToken: issued.firstLeaseToken,
    authorityDigest: issued.authorityDigest,
    predecessorGenerationId: issued.predecessorGenerationId,
    sourceSha256: plan.source.sha256,
    sourceByteLength: plan.source.byteLength,
    sourceExpectation: plan.retentionPacket.registration.sourceExpectation,
    sourceExpectationDigest: plan.retentionPacket.registration.sourceExpectationSha256,
    expectedInventoryDigest: `sha256:${"0".repeat(64)}`,
    registration: plan.retentionPacket.registration,
    groups: generationEvidenceSlots.map(([family, groupKey]) => {
      const group = plan.declarations.groups.find((value) => value.family === family && value.groupKey === groupKey);
      return { family, groupKey, state: group ? "declared" : "pending", declaration: group?.declaration ?? null };
    }),
    units: plan.declarations.units,
    outcomes,
    artifacts: artifacts.map(({ bytesHex, ...metadata }) => {
      void bytesHex;
      return { ...metadata, sourceSha256: plan.source.sha256 };
    }),
  };
  // UUID owner and full digest widths bound their actual SQL identities. The closed
  // reader shape is mirrored only for sizing, with an additional 4 KiB margin.
  const upperBytes =
    sqlJsonUpperBytes({
      ok: true,
      managed: true,
      preparedSupplierArtifacts: {
        version: "ingestion-prepared-supplier-artifacts-v1",
        identity,
        inventory,
        artifacts,
      },
    }) + 4096;
  if (upperBytes > PREPARED_SUPPLIER_READBACK_MAX_BYTES) refuse("stage_transport_limit_exceeded");
}

/** Private bytes only. Existing writers retain final declarations atomically per RPC.
 * Exact same-lease replay is supported; lease takeover needs a newly prepared generation.
 * This does not write public semantic rows, mint vectors, seal or publish a candidate.
 */
export async function stageWholeOriginalSupplier(args: {
  plan: PreparedSupplierPlan;
  mutation: (name: string, payload: Record<string, unknown>) => Promise<Record<string, unknown>>;
  check: () => void;
}) {
  const plan = checkedPreparedSupplierPlan(args.plan);
  const artifacts = preparedSupplierArtifacts(plan);
  const outcomes = preparedSupplierOutcomes(plan);
  const calls: [string, Record<string, unknown>][] = [
    [
      "begin_ingestion_generation_evidence",
      {
        p_registration: plan.retentionPacket.registration,
        p_original_hex: artifacts.find((a) => a.representation === "original_binary")!.bytesHex,
      },
    ],
    ["declare_ingestion_generation_evidence", { p_declarations: plan.declarations }],
    ["retain_ingestion_generation_artifacts", { p_artifacts: artifacts }],
    ["record_ingestion_generation_outcomes", { p_outcomes: outcomes }],
    ["record_ingestion_generation_accounting", {}],
  ];
  const exactFourPagePilot =
    plan.source.sha256 === "sha256:abbc8107a09582e18f36bf4905c75f1fc78af70cd516851b89bff8919ca5bece" &&
    plan.source.byteLength === 2211561 &&
    plan.retentionPacket.registration.sourceExpectationSha256 ===
      "sha256:2a5c6ae064ef159f15042105c85edc9da4af6bd231ae1268e703baf0c447e0da";
  if (exactFourPagePilot) assertFourPageStageTransport(plan, artifacts, outcomes, calls);
  // Other sources keep the existing half-envelope reserve for inventory and SQL spacing.
  else if (generationEvidenceBytes({ plan, artifacts, outcomes }).length > PREPARED_SUPPLIER_READBACK_MAX_BYTES / 2)
    refuse("stage_transport_limit_exceeded");
  for (const [name, payload] of calls) {
    args.check();
    const result = await args.mutation(name, { p_generation: plan.issued.generationId, ...payload });
    generationEvidenceBytes(result);
    if (result.ok !== true) refuse("stage_current_attempt_required");
    if (
      name === "record_ingestion_generation_accounting" &&
      (!result.accounting ||
        typeof result.accounting !== "object" ||
        Array.isArray(result.accounting) ||
        (result.accounting as Record<string, unknown>).result !== "unavailable" ||
        (result.accounting as Record<string, unknown>).terminalSeal !== null)
    )
      refuse("stage_unexpected_accounting");
    args.check();
  }
  return freezeGenerationEvidence({
    status: "retained_unverified" as const,
    generationId: plan.issued.generationId,
    planDigest: plan.digest,
    artifactCount: artifacts.length,
    activated: false as const,
  });
}

/** Verify complete stored byte/declaration populations against caller-held expectations.
 * Provider text, roles and original references remain supplied expectations, not DB-issued authority.
 */
export function decodeWholeOriginalSupplierReadback(args: {
  expected: PreparedSupplierPlan;
  ownerId: string;
  result: unknown;
}) {
  const plan = checkedPreparedSupplierPlan(args.expected);
  const ownerId = uuid.parse(args.ownerId);
  const encoded = generationEvidenceBytes(args.result);
  if (encoded.length > PREPARED_SUPPLIER_READBACK_MAX_BYTES) refuse("readback_transport_limit_exceeded");
  const response = z
    .object({
      ok: z.literal(true),
      managed: z.literal(true),
      preparedSupplierArtifacts: z.record(z.string(), z.unknown()),
    })
    .strict()
    .parse(args.result);
  const payload = response.preparedSupplierArtifacts;
  if (
    !same(Object.keys(payload).sort(), ["artifacts", "identity", "inventory", "version"]) ||
    payload.version !== "ingestion-prepared-supplier-artifacts-v1" ||
    !same(payload.identity, {
      documentId: plan.issued.documentId,
      ownerId,
      generationId: plan.issued.generationId,
      jobId: plan.issued.jobId,
      firstLeaseToken: plan.issued.firstLeaseToken,
      authorityDigest: plan.issued.authorityDigest,
      sourceSha256: plan.source.sha256,
      sourceByteLength: plan.source.byteLength,
      sourceExpectationDigest: plan.retentionPacket.registration.sourceExpectationSha256,
    })
  )
    refuse("readback_identity_mismatch");
  const inventory = z.record(z.string(), z.unknown()).parse(payload.inventory);
  if (
    inventory.version !== 1 ||
    inventory.documentId !== plan.issued.documentId ||
    inventory.generationId !== plan.issued.generationId ||
    inventory.jobId !== plan.issued.jobId ||
    inventory.firstLeaseToken !== plan.issued.firstLeaseToken ||
    inventory.authorityDigest !== plan.issued.authorityDigest ||
    inventory.predecessorGenerationId !== plan.issued.predecessorGenerationId ||
    inventory.sourceSha256 !== plan.source.sha256 ||
    inventory.sourceByteLength !== plan.source.byteLength ||
    inventory.sourceExpectationDigest !== plan.retentionPacket.registration.sourceExpectationSha256 ||
    !same(inventory.registration, plan.retentionPacket.registration) ||
    !same(inventory.sourceExpectation, plan.retentionPacket.registration.sourceExpectation)
  )
    refuse("readback_identity_mismatch");
  const groups = z
    .array(
      z
        .object({ family: text, groupKey: text, state: z.enum(["pending", "declared"]), declaration: z.unknown() })
        .strict(),
    )
    .parse(inventory.groups);
  unique(
    groups.map((g) => `${g.family}:${g.groupKey}`),
    "readback_group_collision",
  );
  const slots = generationEvidenceSlots;
  if (
    groups.length !== slots.length ||
    groups.some((g) => !slots.some(([family, groupKey]) => family === g.family && groupKey === g.groupKey))
  )
    refuse("readback_group_population_mismatch");
  for (const group of groups) {
    const expected = plan.declarations.groups.find((g) => g.family === group.family && g.groupKey === group.groupKey);
    if (
      expected
        ? group.state !== "declared" || !same(group.declaration, expected.declaration)
        : group.state !== "pending" || group.declaration !== null
    )
      refuse("readback_group_population_mismatch");
  }
  const ordered = <T>(items: T[], identity: (item: T) => string) =>
    [...items].sort((a, b) => identity(a).localeCompare(identity(b)));
  const units = z.array(unitDeclarationSchema).parse(inventory.units);
  unique(
    units.map((u) => unitIdentity(u.id)),
    "readback_unit_collision",
  );
  if (
    !same(
      ordered(units, (u) => unitIdentity(u.id)),
      ordered(plan.declarations.units, (u) => unitIdentity(u.id)),
    )
  )
    refuse("readback_unit_population_mismatch");
  const outcomes = z.array(outcomeInputSchema).parse(inventory.outcomes);
  unique(
    outcomes.map((o) => unitIdentity(o.unitId)),
    "readback_outcome_collision",
  );
  if (
    !same(
      ordered(outcomes, (o) => unitIdentity(o.unitId)),
      ordered(preparedSupplierOutcomes(plan), (o) => unitIdentity(o.unitId)),
    )
  )
    refuse("readback_outcome_population_mismatch");
  const artifacts = z.array(z.unknown()).parse(payload.artifacts).map(parseGenerationArtifact);
  unique(
    artifacts.map((a) => unitIdentity(a.unitId)),
    "readback_artifact_collision",
  );
  const expectedArtifacts = preparedSupplierArtifacts(plan);
  if (
    !same(
      ordered(artifacts, (a) => unitIdentity(a.unitId)),
      ordered(expectedArtifacts, (a) => unitIdentity(a.unitId)),
    ) ||
    !same(
      ordered(z.array(z.unknown()).parse(inventory.artifacts), (a) =>
        unitIdentity((a as GenerationArtifactInput).unitId),
      ),
      ordered(
        expectedArtifacts.map(({ bytesHex, ...metadata }) => {
          void bytesHex;
          return { ...metadata, sourceSha256: plan.source.sha256 };
        }),
        (a) => unitIdentity(a.unitId),
      ),
    )
  )
    refuse("readback_artifact_population_mismatch");
  return freezeGenerationEvidence({
    status: "retained_unverified" as const,
    activated: false as const,
    artifactCount: artifacts.length,
    expectedPlanDigest: plan.digest,
    artifacts,
    declaredTableAssociations: plan.declaredTableAssociations ?? null,
    blockers: plan.blockers,
    qualification:
      "Caller-held roles/associations/provider-input metadata checked against full stored artifact and declaration population; not independently issued source/native/completeness or consumer authority.",
  });
}

export async function readWholeOriginalSupplier(args: {
  expected: PreparedSupplierPlan;
  ownerId: string;
  mutation: (name: string, payload: Record<string, unknown>) => Promise<Record<string, unknown>>;
  check: () => void;
}) {
  const plan = checkedPreparedSupplierPlan(args.expected);
  args.check();
  const result = await args.mutation("read_ingestion_prepared_supplier_artifacts", {
    p_generation: plan.issued.generationId,
  });
  args.check();
  return decodeWholeOriginalSupplierReadback({ expected: plan, ownerId: args.ownerId, result });
}
