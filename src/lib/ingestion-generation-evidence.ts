import { createHash } from "node:crypto";
import { isUtf8 } from "node:buffer";
import { types } from "node:util";
import { z } from "zod";

export const generationEvidenceProfileVersion = "u10-u12-prerequisite-profile-v1" as const;
export const generationEvidenceSlots = [
  ["pages", "worker_core"],
  ["native_structure", "worker_native"],
  ["chunks", "worker_core"],
  ["images", "worker_core"],
  ["table_facts", "worker_core"],
  ["embedding_fields", "worker_core"],
  ["index_units", "worker_core"],
  ["index_units", "deep_memory"],
  ["sections", "deep_memory"],
  ["memory_cards", "deep_memory"],
  ["summary", "enrichment"],
  ["generated_labels", "enrichment"],
  ["quality", "worker_core"],
  ["document_metadata", "projection_aggregate"],
  ["producer_aliases", "deep_memory"],
  ["private_objects", "private_objects"],
  ["attempt_control", "control"],
  ["cache_inputs", "cache"],
  ["repair_audit_inputs", "repair"],
] as const;
export const generationEvidenceFamilies = [
  "pages",
  "native_structure",
  "chunks",
  "images",
  "table_facts",
  "embedding_fields",
  "index_units",
  "sections",
  "memory_cards",
  "summary",
  "generated_labels",
  "quality",
  "document_metadata",
  "producer_aliases",
  "private_objects",
  "attempt_control",
  "cache_inputs",
  "repair_audit_inputs",
] as const;
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const digest = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const text = z
  .string()
  .min(1)
  .refine((value) => value.isWellFormed() && !value.includes("\0"));
const uint = z.number().int().nonnegative().safe();
export const unitIdSchema = z.object({ family: z.enum(generationEvidenceFamilies), key: text }).strict();
export type GenerationEvidenceUnitId = z.infer<typeof unitIdSchema>;
export const issuedAttemptControlSchema = z
  .object({
    documentId: uuid,
    generationId: uuid,
    jobId: uuid,
    workerId: text,
    firstLeaseToken: uuid,
    attemptNumber: uint.positive(),
    batchId: uuid.nullable(),
    authorityDigest: digest,
    predecessorGenerationId: uuid.nullable(),
  })
  .strict();
export const attemptClaimCheckpointSchema = issuedAttemptControlSchema
  .extend({
    version: z.literal("ingestion-attempt-control-v1"),
    phase: z.literal("claim"),
    qualification: z.literal("derived_unverified"),
    sourceSha256: digest,
    sourceByteLength: uint.positive(),
    sourceExpectationDigest: digest,
  })
  .strict();
export type IssuedAttemptControl = z.infer<typeof issuedAttemptControlSchema>;
export function parseIssuedAttemptControl(value: unknown): IssuedAttemptControl {
  assertDataOnly(value);
  return issuedAttemptControlSchema.parse(value);
}
const witnessSchema = z.object({ reference: text, sha256: digest }).strict();
const sourceUnitSchema = z
  .object({
    id: text,
    required: z.boolean(),
    dependencies: z.array(text),
    locator: text,
    nativeMapping: z.literal("unavailable"),
  })
  .strict();
export const sourceExpectationSchema = z
  .object({
    version: z.literal(1),
    sourceSha256: digest,
    tag: z.enum(["known", "unknown", "unavailable"]),
    units: z.array(sourceUnitSchema).nullable(),
    witness: witnessSchema.nullable(),
    limitation: text.nullable(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.tag === "known") {
      if (!value.units?.length || !value.witness || value.limitation !== null)
        ctx.addIssue({ code: "custom", message: "independent_source_expectation_required" });
      const ids = new Set(value.units?.map((unit) => unit.id));
      if (
        ids.size !== value.units?.length ||
        value.units?.some(
          (unit) =>
            new Set(unit.dependencies).size !== unit.dependencies.length ||
            unit.dependencies.some((id) => !ids.has(id) || id === unit.id),
        )
      )
        ctx.addIssue({ code: "custom", message: "source_dependency_population_mismatch" });
    } else if (value.units !== null || value.witness !== null || !value.limitation)
      ctx.addIssue({ code: "custom", message: "source_expectation_unknown_is_not_empty" });
  });
export type SourceExpectation = z.infer<typeof sourceExpectationSchema>;
export const originalApplicabilityFamilies = [
  "chunks",
  "images",
  "table_facts",
  "embedding_fields",
  "index_units",
] as const;
const originalRequirementSchema = z
  .object({
    id: text,
    required: z.literal(true),
    sourceEvidenceIds: z.array(text).min(1),
  })
  .strict();
const originalApplicabilityGroupSchema = z
  .object({
    family: z.enum(originalApplicabilityFamilies),
    population: z.discriminatedUnion("tag", [
      z
        .object({
          tag: z.literal("known"),
          requirements: z.array(originalRequirementSchema),
          basis: z
            .object({ scope: z.literal("whole_original"), kind: z.literal("independent_original_declaration") })
            .strict(),
          reason: z.literal("no_original_requirements_in_scope").nullable(),
        })
        .strict(),
      z.object({ tag: z.literal("unknown"), limitation: text }).strict(),
    ]),
  })
  .strict();
const originalApplicabilityWitnessSchema = z
  .object({
    version: z.literal("ingestion-original-applicability-v1"),
    qualification: z.literal("independently_declared_unverified"),
    sourceSha256: digest,
    sourceByteLength: uint.positive(),
    sourceUnits: z.array(sourceUnitSchema),
    groups: z.array(originalApplicabilityGroupSchema),
  })
  .strict();
export type OriginalApplicabilityGroup = z.infer<typeof originalApplicabilityGroupSchema>;
export type OriginalApplicabilityWitness = z.infer<typeof originalApplicabilityWitnessSchema>;

/** Interprets bound original obligations, never producer output counts or author authority. */
export function parseOriginalApplicabilityWitness(args: {
  sourceExpectation: unknown;
  originalBytes: Buffer;
  witnessBytes?: Buffer;
}) {
  const expectation = parseSourceExpectation(args.sourceExpectation);
  if (!Buffer.isBuffer(args.originalBytes) || bytesDigest(args.originalBytes) !== expectation.sourceSha256)
    throw new Error("original_applicability_source_mismatch");
  const unavailable = (
    reason: "source_expectation_unavailable" | "source_witness_missing" | "untyped_source_witness",
  ) =>
    freezeGenerationEvidence({
      status: "unavailable" as const,
      reason,
      nativeMapping: "unavailable" as const,
      sourceCompleteness: "unavailable" as const,
      producerCoverage: "unavailable" as const,
    });
  if (expectation.tag !== "known") return unavailable("source_expectation_unavailable");
  if (args.witnessBytes === undefined) return unavailable("source_witness_missing");
  if (!Buffer.isBuffer(args.witnessBytes) || bytesDigest(args.witnessBytes) !== expectation.witness!.sha256)
    throw new Error("original_applicability_witness_mismatch");
  if (!isUtf8(args.witnessBytes)) return unavailable("untyped_source_witness");
  let input: unknown;
  try {
    input = JSON.parse(args.witnessBytes.toString("utf8"));
  } catch {
    return unavailable("untyped_source_witness");
  }
  assertDataOnly(input);
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    (input as Record<string, unknown>).version !== "ingestion-original-applicability-v1"
  )
    return unavailable("untyped_source_witness");
  const parsed = originalApplicabilityWitnessSchema.safeParse(input);
  if (!parsed.success) throw new Error("invalid_original_applicability_witness");
  const body = parsed.data;
  if (
    body.sourceSha256 !== expectation.sourceSha256 ||
    body.sourceByteLength !== args.originalBytes.length ||
    generationEvidenceDigest(body.sourceUnits) !== generationEvidenceDigest(expectation.units)
  )
    throw new Error("original_applicability_source_units_mismatch");
  const units = new Map(body.sourceUnits.map((unit) => [unit.id, unit]));
  // Iterative graph traversal: cyclic dependencies cannot be treated as qualification closure.
  const colors = new Map<string, "active" | "done">();
  for (const unit of body.sourceUnits) {
    if (colors.get(unit.id) === "done") continue;
    const stack = [{ id: unit.id, dependencyIndex: 0 }];
    colors.set(unit.id, "active");
    while (stack.length) {
      const next = stack[stack.length - 1];
      const current = units.get(next.id);
      if (!current) throw new Error("original_applicability_source_reference_mismatch");
      if (next.dependencyIndex === current.dependencies.length) {
        colors.set(next.id, "done");
        stack.pop();
      } else {
        const id = current.dependencies[next.dependencyIndex++];
        if (!units.has(id)) throw new Error("original_applicability_source_reference_mismatch");
        if (colors.get(id) === "active") throw new Error("original_applicability_dependency_cycle");
        if (colors.get(id) !== "done") {
          colors.set(id, "active");
          stack.push({ id, dependencyIndex: 0 });
        }
      }
    }
  }
  if (
    body.groups.length !== originalApplicabilityFamilies.length ||
    new Set(body.groups.map((group) => group.family)).size !== originalApplicabilityFamilies.length
  )
    throw new Error("original_applicability_group_population_mismatch");
  for (const group of body.groups) {
    if (group.population.tag === "unknown") continue;
    const { requirements, reason } = group.population;
    if ((requirements.length === 0) !== (reason === "no_original_requirements_in_scope"))
      throw new Error("original_applicability_empty_basis_required");
    if (new Set(requirements.map((requirement) => requirement.id)).size !== requirements.length)
      throw new Error("original_applicability_duplicate_requirement");
    for (const requirement of requirements) {
      const refs = new Set(requirement.sourceEvidenceIds);
      if (refs.size !== requirement.sourceEvidenceIds.length || [...refs].some((id) => !units.has(id)))
        throw new Error("original_applicability_source_reference_mismatch");
      for (const id of refs)
        // Closure under every direct edge also includes every transitive qualifier.
        if (units.get(id)!.dependencies.some((dependency) => !refs.has(dependency)))
          throw new Error("original_applicability_qualification_dependency_missing");
    }
  }
  return freezeGenerationEvidence({
    status: "typed_original_requirements" as const,
    qualification: body.qualification,
    sourceSha256: body.sourceSha256,
    sourceByteLength: body.sourceByteLength,
    witnessSha256: expectation.witness!.sha256,
    sourceUnitsDigest: generationEvidenceDigest(body.sourceUnits),
    groups: body.groups,
    nativeMapping: "unavailable" as const,
    sourceCompleteness: "unavailable" as const,
    producerCoverage: "unavailable" as const,
  });
}
const limitationSchema = z
  .object({
    code: z.enum([
      "required_fidelity_unassessed",
      "producer_unavailable",
      "producer_failed",
      "producer_skipped",
      "dependency_unknown",
    ]),
    scope: text,
    capability: z.enum(["source_fidelity", "native_mapping", "optional_derivative", "source_inventory"]),
  })
  .strict();
const populationSchema = z.discriminatedUnion("tag", [
  z
    .object({
      tag: z.literal("known"),
      expectedUnits: z.array(unitIdSchema),
      basis: z.array(witnessSchema).min(1),
      reason: z.literal("no_units_expected").nullable(),
    })
    .strict(),
  z.object({ tag: z.literal("unknown"), limitation: limitationSchema }).strict(),
  z.object({ tag: z.literal("unavailable"), limitation: limitationSchema }).strict(),
]);
export const groupDeclarationSchema = z
  .object({
    family: z.enum(generationEvidenceFamilies),
    groupKey: text,
    declaration: z
      .object({
        producer: z.object({ name: text, version: text, outputManifestDigest: digest }).strict(),
        artifactGenerationId: uuid.nullable(),
        population: populationSchema,
      })
      .strict(),
  })
  .strict();
export const representationSchema = z.enum([
  "original_binary",
  "extracted_utf8",
  "persisted_utf8",
  "provenance_json",
  "page_projection",
  "document_projection",
  "source_expectation_witness",
  "image_binary",
  "image_provenance",
]);
const observationPartitionSchema = z.object({ true: uint, false: uint, unknown: uint }).strict();
export const prerequisiteQualityDiagnosticSchema = z
  .object({
    version: z.literal("ingestion-prerequisite-quality-v1"),
    stage: z.literal("extraction_retention"),
    qualification: z.literal("derived_unverified"),
    documentId: uuid,
    generationId: uuid,
    sourceSha256: digest,
    sourceByteLength: uint.positive(),
    sourceExpectationDigest: digest,
    references: z
      .array(
        z
          .object({ unitId: unitIdSchema, representation: representationSchema, sha256: digest, byteLength: uint })
          .strict(),
      )
      .min(1),
    pageObservations: z
      .array(
        z
          .object({ pageNumber: uint.positive(), ocrUsed: z.boolean().nullable(), needsOcr: z.boolean().nullable() })
          .strict(),
      )
      .min(1),
    observations: z
      .object({
        pageCount: uint.positive(),
        extractedUtf8ByteLength: uint,
        capturedImageCount: uint,
        ocrUsed: observationPartitionSchema,
        needsOcr: observationPartitionSchema,
        warnings: z
          .object({ known: z.boolean(), entries: z.array(z.object({ sha256: digest, byteLength: uint }).strict()) })
          .strict(),
      })
      .strict(),
    downstream: z
      .object({
        status: z.literal("unavailable"),
        reason: z.literal("downstream_stages_not_executed"),
        qualityScore: z.null(),
        extractionQuality: z.null(),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const fail = () => ctx.addIssue({ code: "custom", message: "quality_diagnostic_identity_mismatch" });
    if (
      value.pageObservations.length !== value.observations.pageCount ||
      new Set(value.pageObservations.map((page) => page.pageNumber)).size !== value.pageObservations.length
    )
      fail();
    for (const key of ["ocrUsed", "needsOcr"] as const) {
      const expected = { true: 0, false: 0, unknown: 0 };
      for (const page of value.pageObservations)
        expected[page[key] === null ? "unknown" : page[key] ? "true" : "false"] += 1;
      if (generationEvidenceDigest(expected) !== generationEvidenceDigest(value.observations[key])) fail();
    }
    if (!value.observations.warnings.known && value.observations.warnings.entries.length !== 0) fail();
    if (new Set(value.references.map((ref) => unitIdentity(ref.unitId))).size !== value.references.length) fail();
    const expected = new Map<string, string>([
      [unitIdentity({ family: "private_objects", key: "original-source" }), "original_binary"],
    ]);
    for (const page of value.pageObservations) {
      expected.set(unitIdentity({ family: "pages", key: String(page.pageNumber) }), "page_projection");
      for (const [suffix, representation] of [
        ["extracted", "extracted_utf8"],
        ["persisted", "persisted_utf8"],
        ["original-provenance", "provenance_json"],
        ["persisted-provenance", "provenance_json"],
      ] as const)
        expected.set(
          unitIdentity({ family: "private_objects", key: `page:${page.pageNumber}:${suffix}` }),
          representation,
        );
    }
    const imageBinaries = value.references.filter((ref) => ref.representation === "image_binary");
    if (imageBinaries.length !== value.observations.capturedImageCount) fail();
    for (const ref of imageBinaries) {
      if (ref.unitId.family !== "private_objects" || !/^image:[1-9][0-9]*:binary$/.test(ref.unitId.key)) {
        fail();
        continue;
      }
      expected.set(unitIdentity(ref.unitId), "image_binary");
      expected.set(
        unitIdentity({ family: "private_objects", key: ref.unitId.key.replace(/:binary$/, ":provenance") }),
        "image_provenance",
      );
    }
    if (
      expected.size !== value.references.length ||
      value.references.some((ref) => expected.get(unitIdentity(ref.unitId)) !== ref.representation)
    )
      fail();
    if (
      value.references
        .filter((ref) => ref.representation === "extracted_utf8")
        .reduce((sum, ref) => sum + ref.byteLength, 0) !== value.observations.extractedUtf8ByteLength
    )
      fail();
  });
export function qualityDiagnosticInputUnit(unit: { id: GenerationEvidenceUnitId; representation: string | null }) {
  return (
    (unit.id.family === "pages" && unit.representation === "page_projection") ||
    (unit.id.family === "private_objects" &&
      (unit.id.key === "original-source" ||
        /^page:[1-9][0-9]*:(extracted|persisted|original-provenance|persisted-provenance)$/.test(unit.id.key) ||
        /^image:[1-9][0-9]*:(binary|provenance)$/.test(unit.id.key)))
  );
}
export const retainedImageDescriptorSchema = z
  .object({
    pageNumber: z.number().int().positive().safe().nullable(),
    mimeType: text,
    bbox: z
      .tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()])
      .nullable()
      .optional(),
    width: z.number().int().positive().safe().nullable().optional(),
    height: z.number().int().positive().safe().nullable().optional(),
    sourceKind: z.enum(["embedded", "table_crop", "diagram_crop", "page_region", "fallback", "cover_page"]).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
export type RetainedImageDescriptor = z.infer<typeof retainedImageDescriptorSchema>;
export function parseRetainedImageDescriptor(value: unknown): RetainedImageDescriptor {
  assertDataOnly(value);
  return retainedImageDescriptorSchema.parse(value);
}
export const unitDeclarationSchema = z
  .object({
    id: unitIdSchema,
    groupKey: text,
    required: z.boolean(),
    dependencies: z.array(unitIdSchema),
    sourceEvidenceIds: z.array(text),
    qualification: z.enum(["source_bytes_exact", "whole_logical_unit_unverified", "derived_unverified"]),
    representation: representationSchema.nullable(),
  })
  .strict();
export const artifactInputSchema = z
  .object({
    unitId: unitIdSchema,
    groupKey: text,
    representation: representationSchema,
    bytesHex: z.string().regex(/^(?:[0-9a-f]{2})*$/),
    sha256: digest,
    byteLength: uint,
    locator: text,
  })
  .strict();
export const outcomeInputSchema = z
  .object({
    unitId: unitIdSchema,
    groupKey: text,
    disposition: z.enum(["retained", "excluded", "failed", "skipped"]),
    artifactSha256: digest.nullable(),
    limitation: limitationSchema.nullable(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.unitId.family === "attempt_control" && value.unitId.key === "preseal_checkpoint")
      ctx.addIssue({ code: "custom", message: "attempt_control_preseal_unavailable" });
  });
export type GenerationArtifactInput = z.infer<typeof artifactInputSchema>;
export type GenerationUnitDeclaration = z.infer<typeof unitDeclarationSchema>;
export type GenerationGroupDeclaration = z.infer<typeof groupDeclarationSchema>;
export type GenerationOutcomeInput = z.infer<typeof outcomeInputSchema>;

function assertDataOnly(value: unknown, ancestors = new Set<object>()): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (
    typeof value === "number" &&
    Number.isFinite(value) &&
    (Number.isInteger(value) ? Number.isSafeInteger(value) : true)
  )
    return;
  if (typeof value !== "object" || types.isProxy(value) || ancestors.has(value))
    throw new Error("generation_evidence_requires_plain_data");
  const prototype = Object.getPrototypeOf(value);
  if (Array.isArray(value) ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null)
    throw new Error("generation_evidence_requires_plain_data");
  ancestors.add(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string") throw new Error("generation_evidence_requires_plain_data");
    const descriptor = descriptors[key];
    if (!Object.hasOwn(descriptor, "value") || (!descriptor.enumerable && !(Array.isArray(value) && key === "length")))
      throw new Error("generation_evidence_requires_plain_data");
    if (Array.isArray(value) && key === "length") continue;
    assertDataOnly(descriptor.value, ancestors);
  }
  if (
    Array.isArray(value) &&
    (Object.keys(descriptors).length !== value.length + 1 ||
      Array.from({ length: value.length }, (_, index) => String(index)).some((key) => !Object.hasOwn(descriptors, key)))
  )
    throw new Error("generation_evidence_array_hole");
  ancestors.delete(value);
}
function canonicalData(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalData);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, child]) => [key, canonicalData(child)]),
    );
  return value;
}
export function generationEvidenceBytes(value: unknown) {
  assertDataOnly(value);
  return Buffer.from(JSON.stringify(canonicalData(value)), "utf8");
}
export function generationEvidenceDigest(value: unknown) {
  return bytesDigest(generationEvidenceBytes(value));
}
export function bytesDigest(bytes: Uint8Array) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}
export function parseSourceExpectation(value: unknown): SourceExpectation {
  assertDataOnly(value);
  return sourceExpectationSchema.parse(value);
}
export function freezeGenerationEvidence<T>(value: T): T {
  assertDataOnly(value);
  function freeze(child: unknown) {
    if (child && typeof child === "object") {
      for (const nested of Object.values(child)) freeze(nested);
      Object.freeze(child);
    }
  }
  freeze(value);
  return value;
}
export function unitIdentity(id: GenerationEvidenceUnitId) {
  return JSON.stringify([id.family, id.key]);
}
export function parseGenerationDeclarations(value: unknown) {
  assertDataOnly(value);
  const parsed = z
    .object({ version: z.literal(1), groups: z.array(groupDeclarationSchema), units: z.array(unitDeclarationSchema) })
    .strict()
    .parse(value);
  const groups = new Map<string, GenerationGroupDeclaration>();
  const ids = new Set<string>();
  for (const group of parsed.groups) {
    if (!generationEvidenceSlots.some(([family, key]) => family === group.family && key === group.groupKey))
      throw new Error("unknown_generation_producer_slot");
    const slot = JSON.stringify([group.family, group.groupKey]);
    if (groups.has(slot)) throw new Error("duplicate_generation_producer_slot");
    groups.set(slot, group);
    if (group.declaration.artifactGenerationId !== null && group.groupKey !== "deep_memory")
      throw new Error("generation_artifact_owner_mismatch");
    if (group.declaration.population.tag === "known") {
      const population = group.declaration.population;
      if ((population.expectedUnits.length === 0) !== (population.reason === "no_units_expected"))
        throw new Error("generation_empty_population_basis_required");
      for (const unit of population.expectedUnits) {
        if (unit.family !== group.family || ids.has(unitIdentity(unit)))
          throw new Error("generation_producer_group_collision");
        ids.add(unitIdentity(unit));
      }
    }
  }
  const declared = new Set<string>();
  const quality = groups.get(JSON.stringify(["quality", "worker_core"]));
  if (quality) {
    const population = quality.declaration.population;
    if (
      population.tag !== "known" ||
      population.reason !== null ||
      population.expectedUnits.length !== 1 ||
      population.expectedUnits[0].family !== "quality" ||
      population.expectedUnits[0].key !== "singleton" ||
      population.basis.length !== 1 ||
      population.basis[0].reference !== "actual_extraction_retention"
    )
      throw new Error("invalid_quality_diagnostic_plan");
  }
  const control = groups.get(JSON.stringify(["attempt_control", "control"]));
  if (control) {
    const expected = [
      { family: "attempt_control", key: "claim_checkpoint" },
      { family: "attempt_control", key: "preseal_checkpoint" },
    ];
    const population = control.declaration.population;
    if (
      population.tag !== "known" ||
      population.reason !== null ||
      population.expectedUnits.length !== 2 ||
      expected.some(
        (id) =>
          !population.expectedUnits.some((unit) => unitIdentity(unit) === unitIdentity(id as GenerationEvidenceUnitId)),
      ) ||
      population.basis.length !== 1 ||
      population.basis[0].reference !== "actual_issued_claim"
    )
      throw new Error("invalid_attempt_control_plan");
  }
  for (const unit of parsed.units) {
    const group = groups.get(JSON.stringify([unit.id.family, unit.groupKey]));
    if (
      !group ||
      group.declaration.population.tag !== "known" ||
      !group.declaration.population.expectedUnits.some((id) => unitIdentity(id) === unitIdentity(unit.id)) ||
      declared.has(unitIdentity(unit.id))
    )
      throw new Error("generation_unit_population_mismatch");
    declared.add(unitIdentity(unit.id));
    if (unit.id.family === "quality") {
      const expected = parsed.units
        .filter(qualityDiagnosticInputUnit)
        .map((input) => unitIdentity(input.id))
        .sort();
      if (
        unit.id.key !== "singleton" ||
        unit.groupKey !== "worker_core" ||
        !unit.required ||
        unit.representation !== "provenance_json" ||
        unit.qualification !== "derived_unverified" ||
        unit.sourceEvidenceIds.length !== 0 ||
        generationEvidenceDigest(unit.dependencies.map(unitIdentity).sort()) !== generationEvidenceDigest(expected)
      )
        throw new Error("invalid_quality_diagnostic_plan");
    }
    if (unit.id.family === "attempt_control") {
      const dependencies =
        unit.id.key === "claim_checkpoint"
          ? [{ family: "private_objects", key: "original-source" }]
          : [
              { family: "attempt_control", key: "claim_checkpoint" },
              { family: "private_objects", key: "original-source" },
            ];
      if (
        !["claim_checkpoint", "preseal_checkpoint"].includes(unit.id.key) ||
        unit.groupKey !== "control" ||
        !unit.required ||
        unit.representation !== "provenance_json" ||
        unit.qualification !== "derived_unverified" ||
        unit.sourceEvidenceIds.length !== 0 ||
        generationEvidenceDigest(unit.dependencies) !== generationEvidenceDigest(dependencies)
      )
        throw new Error("invalid_attempt_control_plan");
    }
    if (
      [
        "pages",
        "native_structure",
        "chunks",
        "quality",
        "document_metadata",
        "private_objects",
        "attempt_control",
      ].includes(unit.id.family) &&
      !unit.required
    )
      throw new Error("required_generation_unit_relabelled");
    if (unit.representation === "image_binary" || unit.representation === "image_provenance") {
      const suffix = unit.representation === "image_binary" ? "binary" : "provenance";
      if (
        unit.id.family !== "private_objects" ||
        unit.groupKey !== "private_objects" ||
        unit.qualification !== "derived_unverified" ||
        !new RegExp(`^image:[1-9][0-9]*:${suffix}$`).test(unit.id.key)
      )
        throw new Error("invalid_retained_image_declaration");
      const dependency =
        unit.representation === "image_binary" ? "original-source" : unit.id.key.replace(/:provenance$/, ":binary");
      if (
        unit.dependencies.length !== 1 ||
        unit.dependencies[0].family !== "private_objects" ||
        unit.dependencies[0].key !== dependency
      )
        throw new Error("invalid_retained_image_declaration");
    }
    if (
      new Set(unit.dependencies.map(unitIdentity)).size !== unit.dependencies.length ||
      unit.dependencies.some((id) => unitIdentity(id) === unitIdentity(unit.id))
    )
      throw new Error("generation_dependency_mismatch");
    if (new Set(unit.sourceEvidenceIds).size !== unit.sourceEvidenceIds.length)
      throw new Error("generation_source_dependency_duplicate");
  }
  if (declared.size !== ids.size) throw new Error("generation_unit_population_mismatch");
  return parsed;
}
export function parseGenerationArtifact(value: unknown): GenerationArtifactInput {
  assertDataOnly(value);
  const artifact = artifactInputSchema.parse(value);
  const bytes = Buffer.from(artifact.bytesHex, "hex");
  if (bytes.byteLength !== artifact.byteLength || bytesDigest(bytes) !== artifact.sha256)
    throw new Error("retained_artifact_bytes_mismatch");
  if (artifact.unitId.family === "quality") {
    try {
      if (
        artifact.unitId.key !== "singleton" ||
        artifact.groupKey !== "worker_core" ||
        artifact.representation !== "provenance_json" ||
        artifact.locator !== "prerequisite_quality:extraction_retention" ||
        !isUtf8(bytes)
      )
        throw new Error("invalid");
      const value: unknown = JSON.parse(bytes.toString("utf8"));
      assertDataOnly(value);
      prerequisiteQualityDiagnosticSchema.parse(value);
    } catch {
      throw new Error("quality_diagnostic_identity_mismatch");
    }
  }
  if (artifact.unitId.family === "attempt_control") {
    if (artifact.unitId.key === "preseal_checkpoint") throw new Error("attempt_control_preseal_unavailable");
    if (
      artifact.unitId.key !== "claim_checkpoint" ||
      artifact.groupKey !== "control" ||
      artifact.representation !== "provenance_json" ||
      artifact.locator !== "ingestion_attempt:claim" ||
      !isUtf8(bytes)
    )
      throw new Error("attempt_control_claim_identity_mismatch");
    try {
      const value: unknown = JSON.parse(bytes.toString("utf8"));
      assertDataOnly(value);
      attemptClaimCheckpointSchema.parse(value);
    } catch {
      throw new Error("attempt_control_claim_identity_mismatch");
    }
  }
  return artifact;
}
export type DocumentPageStorageSnapshot = Readonly<{
  documentId: string;
  mode: "legacy_unqualified" | "typed_exact";
  generationId: string | null;
  metadataDigest: string;
}>;
export function pageStorageSnapshot(document: {
  id: string;
  page_storage_mode?: unknown;
  metadata?: unknown;
  index_generation_id?: unknown;
}): DocumentPageStorageSnapshot {
  const metadata =
    document.metadata && typeof document.metadata === "object" && !Array.isArray(document.metadata)
      ? (document.metadata as Record<string, unknown>)
      : {};
  const generationId =
    Object.hasOwn(metadata, "index_generation_id") && metadata.index_generation_id !== null
      ? uuid.parse(metadata.index_generation_id)
      : null;
  const mode = z.enum(["legacy_unqualified", "typed_exact"]).parse(document.page_storage_mode ?? "legacy_unqualified");
  if (
    mode === "typed_exact" &&
    (!generationId || (document.index_generation_id !== undefined && document.index_generation_id !== generationId))
  )
    throw new Error("typed_page_pointer_mismatch");
  return Object.freeze({
    documentId: uuid.parse(document.id),
    mode,
    generationId,
    metadataDigest: generationEvidenceDigest(metadata),
  });
}
/** Explicit requested generation is a v1/exact request; it never resolves legacy pages. */
export function visiblePageGeneration(snapshot: DocumentPageStorageSnapshot, requestedGeneration?: string | null) {
  if (requestedGeneration !== undefined && snapshot.mode === "legacy_unqualified")
    throw new Error("unqualified_legacy_pages");
  if (requestedGeneration !== undefined && requestedGeneration !== snapshot.generationId)
    throw new Error("page_generation_mismatch");
  return snapshot.mode === "legacy_unqualified" ? null : snapshot.generationId;
}
export function assertPageStorageSnapshot(
  snapshot: DocumentPageStorageSnapshot,
  current: Parameters<typeof pageStorageSnapshot>[0],
) {
  const next = pageStorageSnapshot(current);
  if (
    next.documentId !== snapshot.documentId ||
    next.mode !== snapshot.mode ||
    next.generationId !== snapshot.generationId ||
    next.metadataDigest !== snapshot.metadataDigest
  )
    throw new Error("page_storage_changed");
}
