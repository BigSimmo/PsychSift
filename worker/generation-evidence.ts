import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";
import {
  bytesDigest,
  generationEvidenceBytes,
  generationEvidenceDigest,
  generationEvidenceProfileVersion,
  generationEvidenceSlots,
  groupDeclarationSchema,
  parseGenerationDeclarations,
  parseGenerationArtifact,
  parseSourceExpectation,
  parseOriginalApplicabilityWitness,
  freezeGenerationEvidence,
  type GenerationArtifactInput,
  type GenerationUnitDeclaration,
  type GenerationGroupDeclaration,
  unitIdentity,
  parseRetainedImageDescriptor,
  type RetainedImageDescriptor,
  type SourceExpectation,
  parseIssuedAttemptControl,
  attemptClaimCheckpointSchema,
  prerequisiteQualityDiagnosticSchema,
  qualityDiagnosticInputUnit,
} from "../src/lib/ingestion-generation-evidence";
import type { JobRow } from "./types";
import type { ExtractedDocument } from "../src/lib/types";
import { MAX_UPLOAD_MB_CEILING } from "../src/lib/upload-limits";
import { DOCX_EXTRACTION_BUDGET } from "../src/lib/extractors/docx-extraction-budget";
import { PDF_EXTRACTION_BUDGET } from "../src/lib/extractors/pdf-extraction-budget";

export type CapturedGenerationImage = Readonly<{
  ordinal: number;
  bytesHex: string;
  sha256: string;
  byteLength: number;
  descriptor: RetainedImageDescriptor;
}>;
function imageDescriptor(image: ExtractedDocument["images"][number]) {
  generationEvidenceBytes(image);
  const descriptor = Object.fromEntries(Object.entries(image).filter(([key]) => key !== "path"));
  return parseRetainedImageDescriptor(descriptor);
}
function withinRoot(root: string, file: string) {
  const relative = path.relative(root, file);
  return (
    relative !== "" &&
    !path.isAbsolute(relative) &&
    relative.split(path.sep).every((part) => part !== ".." && part !== ".")
  );
}
/** Reads only this extraction's owned regular files; absolute paths never leave this boundary. */
export async function captureGenerationImages(args: {
  extracted: ExtractedDocument;
  trustedTemporaryRoots: readonly string[];
  fileName: string;
  mimeType: string;
  check?: () => void;
}): Promise<readonly CapturedGenerationImage[]> {
  if (args.extracted.images.length === 0) return Object.freeze([]);
  const pdf = args.mimeType === "application/pdf" || args.fileName.toLowerCase().endsWith(".pdf");
  const docx =
    !pdf &&
    (args.mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      args.fileName.toLowerCase().endsWith(".docx"));
  if (!pdf && !docx) throw new Error("retained_image_capture_budget_unavailable");
  const limits = pdf ? PDF_EXTRACTION_BUDGET : DOCX_EXTRACTION_BUDGET;
  if (args.extracted.images.length > limits.maxArtifacts) throw new Error("retained_image_capture_budget_exceeded");
  const roots: string[] = [];
  try {
    for (const root of args.trustedTemporaryRoots) {
      if (typeof root !== "string" || !path.isAbsolute(root) || root.split(/[\\/]/).includes(".."))
        throw new Error("invalid_root");
      const normalized = path.resolve(root);
      const info = await lstat(normalized);
      if (!info.isDirectory() || info.isSymbolicLink() || path.resolve(await realpath(normalized)) !== normalized)
        throw new Error("invalid_root");
      roots.push(normalized);
    }
  } catch {
    throw new Error("retained_image_capture_path_refused");
  }
  if (!roots.length) throw new Error("retained_image_capture_path_refused");
  const captured: CapturedGenerationImage[] = [];
  let totalBytes = 0;
  for (const [index, image] of args.extracted.images.entries()) {
    args.check?.();
    const descriptor = imageDescriptor(image);
    const descriptorText = generationEvidenceBytes(descriptor).toString("utf8");
    if (roots.some((root) => descriptorText.includes(JSON.stringify(root).slice(1, -1))))
      throw new Error("retained_image_capture_ephemeral_provenance_refused");
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      if (!path.isAbsolute(image.path) || image.path.split(/[\\/]/).includes("..")) throw new Error("invalid_path");
      const file = path.resolve(image.path);
      const root = roots.find((candidate) => withinRoot(candidate, file));
      if (!root) throw new Error("invalid_path");
      let component = root;
      const rootInfo = await lstat(root);
      if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error("invalid_root");
      for (const segment of path.relative(root, file).split(path.sep)) {
        component = path.join(component, segment);
        const info = await lstat(component);
        if (info.isSymbolicLink() || (component !== file && !info.isDirectory())) throw new Error("invalid_path");
      }
      const before = await lstat(file);
      if (!before.isFile() || before.nlink !== 1 || path.resolve(await realpath(file)) !== file)
        throw new Error("invalid_path");
      if (
        !Number.isSafeInteger(before.size) ||
        before.size < 1 ||
        before.size > limits.maxArtifactBytes ||
        (docx && before.size > DOCX_EXTRACTION_BUDGET.maxSingleArtifactBytes) ||
        totalBytes + before.size > limits.maxArtifactBytes
      )
        throw new Error("budget_exceeded");
      handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      const opened = await handle.stat();
      if (
        !opened.isFile() ||
        opened.dev !== before.dev ||
        opened.ino !== before.ino ||
        opened.size !== before.size ||
        opened.nlink !== 1 ||
        path.resolve(await realpath(file)) !== file
      )
        throw new Error("substituted_file");
      const bytes = Buffer.alloc(before.size);
      let offset = 0;
      while (offset < bytes.length) {
        args.check?.();
        const { bytesRead } = await handle.read(bytes, offset, Math.min(64 * 1024, bytes.length - offset), offset);
        if (bytesRead === 0) throw new Error("changed_file");
        offset += bytesRead;
      }
      const extra = await handle.read(Buffer.alloc(1), 0, 1, bytes.length);
      const after = await handle.stat();
      const current = await lstat(file);
      if (
        extra.bytesRead !== 0 ||
        after.size !== before.size ||
        after.mtimeMs !== before.mtimeMs ||
        after.ctimeMs !== before.ctimeMs ||
        current.isSymbolicLink() ||
        current.dev !== before.dev ||
        current.ino !== before.ino ||
        path.resolve(await realpath(file)) !== file
      )
        throw new Error("changed_file");
      totalBytes += bytes.length;
      captured.push(
        freezeGenerationEvidence({
          ordinal: index + 1,
          bytesHex: bytes.toString("hex"),
          sha256: bytesDigest(bytes),
          byteLength: bytes.length,
          descriptor,
        }),
      );
    } catch {
      throw new Error("retained_image_capture_refused");
    } finally {
      await handle?.close().catch(() => {
        throw new Error("retained_image_capture_refused");
      });
    }
  }
  return Object.freeze(captured);
}
function privateProducerDigest(units: GenerationUnitDeclaration[], images: readonly CapturedGenerationImage[]) {
  return generationEvidenceDigest(
    images.length
      ? {
          units,
          capturedImages: images.map(({ ordinal, sha256, byteLength, descriptor }) => ({
            ordinal,
            sha256,
            byteLength,
            descriptor,
          })),
        }
      : units,
  );
}

type PersistedPage = {
  document_id?: string;
  page_number: number;
  text: string;
  ocr_used: boolean;
  metadata: Record<string, unknown>;
};
function textBytes(text: string) {
  if (!text.isWellFormed()) throw new Error("unrepresentable_original_extracted_utf8");
  return Buffer.from(text, "utf8");
}
/** Select timing only from a complete, typed optional-slot inventory; never infer freshness. */
export function canDeferOptionalProducerDeclarations(inventory: unknown): boolean {
  const fail = (): never => {
    throw new Error("invalid_optional_producer_inventory");
  };
  try {
    generationEvidenceBytes(inventory);
    if (!inventory || typeof inventory !== "object" || Array.isArray(inventory)) fail();
    const groups = (inventory as Record<string, unknown>).groups;
    if (!Array.isArray(groups)) return fail();
    const optionalSlots = new Set(
      generationEvidenceSlots
        .filter(([, groupKey]) => ["deep_memory", "enrichment", "cache"].includes(groupKey))
        .map(([family, groupKey]) => JSON.stringify([family, groupKey])),
    );
    const seen = new Set<string>();
    let canDefer = true;
    for (const row of groups) {
      if (!row || typeof row !== "object" || Array.isArray(row)) fail();
      const group = row as Record<string, unknown>;
      if (
        Object.keys(group).length !== 4 ||
        !["family", "groupKey", "state", "declaration"].every((key) => Object.hasOwn(group, key)) ||
        !generationEvidenceSlots.some(([family, groupKey]) => family === group.family && groupKey === group.groupKey)
      )
        fail();
      const slot = JSON.stringify([group.family, group.groupKey]);
      if (seen.has(slot)) fail();
      seen.add(slot);
      if (group.state === "pending") {
        if (group.declaration !== null) fail();
      } else if (group.state === "declared") {
        groupDeclarationSchema.parse({
          family: group.family,
          groupKey: group.groupKey,
          declaration: group.declaration,
        });
        if (optionalSlots.has(slot)) canDefer = false;
      } else fail();
    }
    if ([...optionalSlots].some((slot) => !seen.has(slot))) fail();
    return canDefer;
  } catch {
    return fail();
  }
}
export function buildGenerationRetentionPacket(args: {
  documentId: string;
  generationId: string;
  originalBytes: Buffer;
  extracted: ExtractedDocument;
  persistedPages: PersistedPage[];
  fileSize?: number;
  maximumUploadMb?: number;
  sourceExpectation?: SourceExpectation;
  sourceExpectationWitnessBytes?: Buffer;
  documentMetadata?: unknown;
  capturedImages?: readonly CapturedGenerationImage[];
  /** Leave optional producer populations undeclared until their actual inputs/outcomes exist. */
  deferOptionalProducerDeclarations?: boolean;
}) {
  const maximumUploadMb = args.maximumUploadMb ?? MAX_UPLOAD_MB_CEILING;
  if (
    !Number.isSafeInteger(maximumUploadMb) ||
    maximumUploadMb < 1 ||
    maximumUploadMb > MAX_UPLOAD_MB_CEILING ||
    args.originalBytes.length < 1 ||
    args.originalBytes.length > maximumUploadMb * 1024 * 1024 ||
    (args.fileSize !== undefined && args.fileSize !== args.originalBytes.length)
  )
    throw new Error("retained_source_admission_size_mismatch");
  const sourceSha256 = bytesDigest(args.originalBytes);
  const capturedImages = args.capturedImages ?? [];
  generationEvidenceBytes(capturedImages);
  if (capturedImages.length !== args.extracted.images.length)
    throw new Error("retained_image_capture_population_mismatch");
  if (args.extracted.pages.length === 0) throw new Error("complete_private_objects_plan_required");
  const sourceExpectation = parseSourceExpectation(
    args.sourceExpectation ?? {
      version: 1,
      sourceSha256,
      tag: "unknown",
      units: null,
      witness: null,
      limitation: "independent_original_expectation_not_available",
    },
  );
  if (sourceExpectation.sourceSha256 !== sourceSha256) throw new Error("original_source_expectation_mismatch");
  if (
    sourceExpectation.tag === "known" &&
    (!args.sourceExpectationWitnessBytes ||
      bytesDigest(args.sourceExpectationWitnessBytes) !== sourceExpectation.witness?.sha256)
  )
    throw new Error("independent_source_witness_not_retained");
  parseOriginalApplicabilityWitness({
    sourceExpectation,
    originalBytes: args.originalBytes,
    witnessBytes: args.sourceExpectationWitnessBytes,
  });
  const artifacts: GenerationArtifactInput[] = [];
  const units: GenerationUnitDeclaration[] = [];
  function artifact(
    family: GenerationUnitDeclaration["id"]["family"],
    key: string,
    groupKey: string,
    representation: GenerationArtifactInput["representation"],
    bytes: Buffer,
    locator: string,
    dependencies: GenerationUnitDeclaration["dependencies"] = [],
  ) {
    const id = { family, key };
    units.push({
      id,
      groupKey,
      required: true,
      dependencies,
      sourceEvidenceIds: [],
      qualification:
        representation === "original_binary"
          ? "source_bytes_exact"
          : representation === "image_binary" || representation === "image_provenance"
            ? "derived_unverified"
            : "whole_logical_unit_unverified",
      representation,
    });
    artifacts.push(
      parseGenerationArtifact({
        unitId: id,
        groupKey,
        representation,
        bytesHex: bytes.toString("hex"),
        sha256: bytesDigest(bytes),
        byteLength: bytes.length,
        locator,
      }),
    );
  }
  artifact(
    "private_objects",
    "original-source",
    "private_objects",
    "original_binary",
    args.originalBytes,
    "whole_original_file",
  );
  if (args.sourceExpectationWitnessBytes)
    artifact(
      "private_objects",
      "original-source-expectation-witness",
      "private_objects",
      "source_expectation_witness",
      args.sourceExpectationWitnessBytes,
      "independent_original_expectation_witness",
    );
  const seen = new Set<number>();
  if (args.extracted.pages.length !== args.persistedPages.length) throw new Error("retained_page_population_mismatch");
  for (const page of args.extracted.pages) {
    if (!Number.isSafeInteger(page.pageNumber) || page.pageNumber < 1 || seen.has(page.pageNumber))
      throw new Error("retained_page_population_mismatch");
    seen.add(page.pageNumber);
    const persisted = args.persistedPages.find((row) => row.page_number === page.pageNumber);
    if (!persisted || (persisted.document_id !== undefined && persisted.document_id !== args.documentId))
      throw new Error("retained_page_population_mismatch");
    const key = String(page.pageNumber);
    artifact(
      "private_objects",
      `page:${key}:extracted`,
      "private_objects",
      "extracted_utf8",
      textBytes(page.text),
      `logical_page:${key}`,
    );
    artifact(
      "private_objects",
      `page:${key}:persisted`,
      "private_objects",
      "persisted_utf8",
      textBytes(persisted.text),
      `logical_page:${key}`,
    );
    artifact(
      "private_objects",
      `page:${key}:original-provenance`,
      "private_objects",
      "provenance_json",
      generationEvidenceBytes(page.metadata ?? {}),
      `logical_page:${key}:original_provenance`,
    );
    artifact(
      "private_objects",
      `page:${key}:persisted-provenance`,
      "private_objects",
      "provenance_json",
      generationEvidenceBytes(persisted.metadata),
      `logical_page:${key}:persisted_provenance`,
    );
    artifact(
      "pages",
      key,
      "worker_core",
      "page_projection",
      generationEvidenceBytes(persisted),
      `logical_page:${key}`,
      [
        { family: "private_objects", key: "original-source" },
        { family: "private_objects", key: `page:${key}:extracted` },
        { family: "private_objects", key: `page:${key}:persisted` },
        { family: "private_objects", key: `page:${key}:original-provenance` },
        { family: "private_objects", key: `page:${key}:persisted-provenance` },
      ],
    );
  }
  for (const [index, capture] of capturedImages.entries()) {
    const descriptor = imageDescriptor(args.extracted.images[index]);
    if (
      capture.ordinal !== index + 1 ||
      generationEvidenceDigest(capture.descriptor) !== generationEvidenceDigest(descriptor)
    )
      throw new Error("retained_image_capture_identity_mismatch");
    if (descriptor.pageNumber !== null && !seen.has(descriptor.pageNumber))
      throw new Error("retained_image_capture_identity_mismatch");
    const binaryKey = `image:${capture.ordinal}:binary`;
    const bytes = Buffer.from(capture.bytesHex, "hex");
    if (
      !/^(?:[0-9a-f]{2})+$/.test(capture.bytesHex) ||
      bytes.length !== capture.byteLength ||
      bytesDigest(bytes) !== capture.sha256
    )
      throw new Error("retained_artifact_bytes_mismatch");
    artifact(
      "private_objects",
      binaryKey,
      "private_objects",
      "image_binary",
      bytes,
      `extracted_image:${capture.ordinal}`,
      [{ family: "private_objects", key: "original-source" }],
    );
    artifact(
      "private_objects",
      `image:${capture.ordinal}:provenance`,
      "private_objects",
      "image_provenance",
      generationEvidenceBytes({
        version: 1,
        documentId: args.documentId,
        generationId: args.generationId,
        sourceSha256,
        placementId: String(capture.ordinal),
        qualification: "derived_unverified",
        descriptor,
        binary: {
          unitId: { family: "private_objects", key: binaryKey },
          sha256: capture.sha256,
          byteLength: capture.byteLength,
        },
      }),
      `extracted_image:${capture.ordinal}:provenance`,
      [{ family: "private_objects", key: binaryKey }],
    );
  }
  artifact(
    "document_metadata",
    "singleton",
    "projection_aggregate",
    "document_projection",
    generationEvidenceBytes({
      documentId: args.documentId,
      generationId: args.generationId,
      metadata: args.documentMetadata ?? {},
      sourceSha256,
      pageCount: args.persistedPages.length,
    }),
    "candidate_document_projection",
  );
  const groups: GenerationGroupDeclaration[] = [];
  for (const [family, groupKey] of generationEvidenceSlots) {
    const planned = units.filter((unit) => unit.id.family === family && unit.groupKey === groupKey);
    if (planned.length)
      groups.push({
        family,
        groupKey,
        declaration: {
          producer: {
            name: "worker_generation_retention",
            version: generationEvidenceProfileVersion,
            outputManifestDigest:
              family === "private_objects"
                ? privateProducerDigest(planned, capturedImages)
                : generationEvidenceDigest(planned),
          },
          artifactGenerationId: null,
          population: {
            tag: "known",
            expectedUnits: planned.map((unit) => unit.id),
            basis: [{ reference: "actual_original_source_bytes", sha256: sourceSha256 }],
            reason: null,
          },
        },
      });
    else if (family === "native_structure")
      groups.push({
        family,
        groupKey,
        declaration: {
          producer: {
            name: "worker_native",
            version: generationEvidenceProfileVersion,
            outputManifestDigest: generationEvidenceDigest({
              sourceSha256,
              capability: "required_fidelity_unassessed",
            }),
          },
          artifactGenerationId: null,
          population: {
            tag: "unknown",
            limitation: {
              code: "required_fidelity_unassessed",
              scope: "all_applicable_native_ocr_qualifications",
              capability: "source_fidelity",
            },
          },
        },
      });
    else if (
      args.deferOptionalProducerDeclarations !== true &&
      ["deep_memory", "enrichment", "cache"].includes(groupKey)
    )
      groups.push({
        family,
        groupKey,
        declaration: {
          producer: {
            name: groupKey,
            version: generationEvidenceProfileVersion,
            outputManifestDigest: generationEvidenceDigest({
              sourceSha256,
              family,
              groupKey,
              cause: "prerequisite_stage_not_executed",
            }),
          },
          artifactGenerationId: null,
          population: {
            tag: "unavailable",
            limitation: {
              code: "producer_skipped",
              scope: "prerequisite_stage_not_executed_derivative_only_no_required_dependency",
              capability: "optional_derivative",
            },
          },
        },
      });
    // Required unsupplied producers remain pending. They are never known-empty.
  }
  const declarations = parseGenerationDeclarations({ version: 1, groups, units });
  const privateGroups = declarations.groups.filter((group) => group.family === "private_objects");
  const privateUnits = declarations.units.filter((unit) => unit.id.family === "private_objects");
  return freezeGenerationEvidence({
    registration: {
      version: 1,
      profileVersion: generationEvidenceProfileVersion,
      sourceSha256,
      sourceByteLength: args.originalBytes.length,
      sourceExpectation,
      sourceExpectationHex: generationEvidenceBytes(sourceExpectation).toString("hex"),
      sourceExpectationSha256: generationEvidenceDigest(sourceExpectation),
      declarations: { version: 1, groups: privateGroups, units: privateUnits },
    },
    generationId: args.generationId,
    declarations: {
      version: 1,
      groups: declarations.groups.filter((group) => group.family !== "private_objects"),
      units: declarations.units.filter((unit) => unit.id.family !== "private_objects"),
    },
    artifacts,
    outcomes: artifacts.map((row) => ({
      unitId: row.unitId,
      groupKey: row.groupKey,
      disposition: "retained" as const,
      artifactSha256: row.sha256,
      limitation: null,
    })),
  });
}

/**
 * Resume only an explicitly registered producer plan; never upgrade its source expectation.
 * Deferral omits new local placeholders; it cannot replace any already persisted declaration.
 */
export function resumeGenerationRetentionPacket(
  args: Parameters<typeof buildGenerationRetentionPacket>[0],
  inventory: unknown,
) {
  generationEvidenceBytes(inventory);
  if (!inventory || typeof inventory !== "object" || Array.isArray(inventory))
    throw new Error("invalid_managed_generation_inventory");
  const existing = inventory as Record<string, unknown>;
  const packet = buildGenerationRetentionPacket(args);
  if (
    existing.documentId !== args.documentId ||
    existing.generationId !== args.generationId ||
    existing.sourceSha256 !== packet.registration.sourceSha256 ||
    existing.sourceByteLength !== args.originalBytes.length
  )
    throw new Error("managed_generation_source_mismatch");
  const registration = existing.registration as typeof packet.registration;
  if (
    !registration ||
    registration.version !== 1 ||
    registration.profileVersion !== generationEvidenceProfileVersion ||
    registration.sourceSha256 !== packet.registration.sourceSha256 ||
    registration.sourceByteLength !== args.originalBytes.length
  )
    throw new Error("invalid_managed_generation_registration");
  const expectation = parseSourceExpectation(registration.sourceExpectation);
  if (args.sourceExpectationWitnessBytes !== undefined)
    parseOriginalApplicabilityWitness({
      sourceExpectation: expectation,
      originalBytes: args.originalBytes,
      witnessBytes: args.sourceExpectationWitnessBytes,
    });
  if (
    expectation.sourceSha256 !== packet.registration.sourceSha256 ||
    existing.sourceExpectationDigest !== registration.sourceExpectationSha256 ||
    generationEvidenceDigest(existing.sourceExpectation) !== generationEvidenceDigest(expectation)
  )
    throw new Error("managed_generation_source_mismatch");
  if (!/^(?:[0-9a-f]{2})+$/.test(registration.sourceExpectationHex))
    throw new Error("invalid_original_expectation_bytes");
  const expectationBytes = Buffer.from(registration.sourceExpectationHex, "hex");
  if (
    bytesDigest(expectationBytes) !== registration.sourceExpectationSha256 ||
    generationEvidenceDigest(JSON.parse(expectationBytes.toString("utf8"))) !== generationEvidenceDigest(expectation)
  )
    throw new Error("original_expectation_digest_mismatch");
  const declarations = parseGenerationDeclarations(registration.declarations);
  const witness = declarations.units.find((unit) => unit.id.key === "original-source-expectation-witness");
  const actualUnits = packet.registration.declarations.units;
  const suppliedWitness = actualUnits.some(
    (unit) => unit.id.family === "private_objects" && unit.id.key === "original-source-expectation-witness",
  );
  if (
    declarations.groups.length !== 1 ||
    declarations.groups[0].family !== "private_objects" ||
    declarations.units.length !== actualUnits.length + (witness && !suppliedWitness ? 1 : 0) ||
    actualUnits.some(
      (unit) =>
        !declarations.units.some(
          (prior) =>
            unitIdentity(prior.id) === unitIdentity(unit.id) &&
            generationEvidenceDigest(prior) === generationEvidenceDigest(unit),
        ),
    )
  )
    throw new Error("immutable_generation_registration");
  const expectedGroup = packet.registration.declarations.groups[0];
  const resumedGroup = {
    ...expectedGroup,
    declaration: {
      ...expectedGroup.declaration,
      producer: {
        ...expectedGroup.declaration.producer,
        outputManifestDigest: privateProducerDigest(declarations.units, args.capturedImages ?? []),
      },
      population: { ...expectedGroup.declaration.population, expectedUnits: declarations.units.map((unit) => unit.id) },
    },
  };
  if (generationEvidenceDigest(declarations.groups[0]) !== generationEvidenceDigest(resumedGroup))
    throw new Error("immutable_generation_registration");
  if (witness) {
    if (
      expectation.tag !== "known" ||
      witness.representation !== "source_expectation_witness" ||
      !Array.isArray(existing.artifacts) ||
      !existing.artifacts.some(
        (row: Record<string, unknown>) =>
          generationEvidenceDigest(row.unitId) === generationEvidenceDigest(witness.id) &&
          row.sha256 === expectation.witness?.sha256 &&
          row.representation === "source_expectation_witness",
      )
    )
      throw new Error("independent_source_witness_not_retained");
  } else if (expectation.tag === "known") throw new Error("independent_source_witness_not_retained");
  return freezeGenerationEvidence({ ...packet, registration });
}

/** Snapshot selected issued fields before mutations; managed attachment validates them. */
export function captureIssuedAttemptControl(
  job: Pick<
    JobRow,
    | "id"
    | "document_id"
    | "locked_by"
    | "lease_token"
    | "lease_write_generation_id"
    | "lease_expected_generation_id"
    | "lease_authority_digest"
    | "attempt_count"
    | "batch_id"
  >,
) {
  return Object.freeze({
    documentId: job.document_id,
    generationId: job.lease_write_generation_id,
    jobId: job.id,
    workerId: job.locked_by,
    firstLeaseToken: job.lease_token,
    attemptNumber: job.attempt_count,
    batchId: job.batch_id,
    authorityDigest: job.lease_authority_digest,
    predecessorGenerationId: job.lease_expected_generation_id,
  });
}

/** Actual claim only; the complete plan reserves the later genuine pre-seal owner. */
export function attachAttemptControlEvidence(args: {
  packet: ReturnType<typeof buildGenerationRetentionPacket>;
  issued: ReturnType<typeof captureIssuedAttemptControl>;
  inventory: unknown;
}) {
  generationEvidenceBytes({ packet: args.packet, issued: args.issued, inventory: args.inventory });
  const issued = parseIssuedAttemptControl(args.issued);
  const packet = args.packet;
  if (!args.inventory || typeof args.inventory !== "object" || Array.isArray(args.inventory))
    throw new Error("attempt_control_claim_identity_mismatch");
  const candidate = args.inventory as Record<string, unknown>;
  if (
    candidate.documentId !== issued.documentId ||
    candidate.generationId !== issued.generationId ||
    packet.generationId !== issued.generationId ||
    candidate.jobId !== issued.jobId ||
    candidate.firstLeaseToken !== issued.firstLeaseToken ||
    candidate.authorityDigest !== issued.authorityDigest ||
    candidate.predecessorGenerationId !== issued.predecessorGenerationId ||
    candidate.sourceSha256 !== packet.registration.sourceSha256 ||
    candidate.sourceByteLength !== packet.registration.sourceByteLength ||
    candidate.sourceExpectationDigest !== packet.registration.sourceExpectationSha256
  )
    throw new Error("attempt_control_claim_identity_mismatch");
  const checkpoint = attemptClaimCheckpointSchema.parse({
    ...issued,
    version: "ingestion-attempt-control-v1",
    phase: "claim",
    qualification: "derived_unverified",
    sourceSha256: packet.registration.sourceSha256,
    sourceByteLength: packet.registration.sourceByteLength,
    sourceExpectationDigest: packet.registration.sourceExpectationSha256,
  });
  const units: GenerationUnitDeclaration[] = [
    {
      id: { family: "attempt_control", key: "claim_checkpoint" },
      groupKey: "control",
      required: true,
      dependencies: [{ family: "private_objects", key: "original-source" }],
      sourceEvidenceIds: [],
      qualification: "derived_unverified",
      representation: "provenance_json",
    },
    {
      id: { family: "attempt_control", key: "preseal_checkpoint" },
      groupKey: "control",
      required: true,
      dependencies: [
        { family: "attempt_control", key: "claim_checkpoint" },
        { family: "private_objects", key: "original-source" },
      ],
      sourceEvidenceIds: [],
      qualification: "derived_unverified",
      representation: "provenance_json",
    },
  ];
  const bytes = generationEvidenceBytes(checkpoint);
  const artifact = parseGenerationArtifact({
    unitId: units[0].id,
    groupKey: "control",
    representation: "provenance_json",
    bytesHex: bytes.toString("hex"),
    sha256: bytesDigest(bytes),
    byteLength: bytes.length,
    locator: "ingestion_attempt:claim",
  });
  const group: GenerationGroupDeclaration = {
    family: "attempt_control",
    groupKey: "control",
    declaration: {
      producer: {
        name: "worker_attempt_control",
        version: "ingestion-attempt-control-v1",
        outputManifestDigest: generationEvidenceDigest(units),
      },
      artifactGenerationId: null,
      population: {
        tag: "known",
        expectedUnits: units.map((unit) => unit.id),
        basis: [{ reference: "actual_issued_claim", sha256: artifact.sha256 }],
        reason: null,
      },
    },
  };
  const declarations = {
    version: 1,
    groups: [...packet.declarations.groups, group],
    units: [...packet.declarations.units, ...units],
  };
  parseGenerationDeclarations({
    version: 1,
    groups: [...packet.registration.declarations.groups, ...declarations.groups],
    units: [...packet.registration.declarations.units, ...declarations.units],
  });
  return freezeGenerationEvidence({
    ...packet,
    declarations,
    artifacts: [...packet.artifacts, artifact],
    outcomes: [
      ...packet.outcomes,
      {
        unitId: artifact.unitId,
        groupKey: "control",
        disposition: "retained" as const,
        artifactSha256: artifact.sha256,
        limitation: null,
      },
    ],
  });
}

/** One immutable extraction-stage diagnostic; later whole-index assessment is unavailable. */
export function attachPrerequisiteQualityDiagnostic(args: {
  documentId: string;
  packet: ReturnType<typeof buildGenerationRetentionPacket>;
  extracted: ExtractedDocument;
}) {
  const packet = args.packet;
  const declarations = parseGenerationDeclarations({
    version: 1,
    groups: [...packet.registration.declarations.groups, ...packet.declarations.groups],
    units: [...packet.registration.declarations.units, ...packet.declarations.units],
  });
  const inputs = declarations.units.filter(qualityDiagnosticInputUnit);
  const artifacts = packet.artifacts.map(parseGenerationArtifact);
  const refs = inputs
    .map((unit) => {
      const matches = artifacts.filter((row) => unitIdentity(row.unitId) === unitIdentity(unit.id));
      if (matches.length !== 1) throw new Error("quality_diagnostic_identity_mismatch");
      const row = matches[0];
      const outcomes = packet.outcomes.filter((outcome) => unitIdentity(outcome.unitId) === unitIdentity(unit.id));
      if (
        row.representation !== unit.representation ||
        row.groupKey !== unit.groupKey ||
        outcomes.length !== 1 ||
        outcomes[0].disposition !== "retained" ||
        outcomes[0].artifactSha256 !== row.sha256 ||
        outcomes[0].groupKey !== unit.groupKey ||
        outcomes[0].limitation !== null
      )
        throw new Error("quality_diagnostic_identity_mismatch");
      return { unitId: row.unitId, representation: row.representation, sha256: row.sha256, byteLength: row.byteLength };
    })
    .sort((a, b) =>
      unitIdentity(a.unitId) < unitIdentity(b.unitId) ? -1 : unitIdentity(a.unitId) > unitIdentity(b.unitId) ? 1 : 0,
    );
  const original = artifacts.find(
    (row) => row.unitId.family === "private_objects" && row.unitId.key === "original-source",
  );
  const projection = artifacts.find((row) => row.representation === "document_projection");
  if (
    !original ||
    original.sha256 !== packet.registration.sourceSha256 ||
    original.byteLength !== packet.registration.sourceByteLength ||
    !projection
  )
    throw new Error("quality_diagnostic_identity_mismatch");
  if (
    generationEvidenceDigest(parseSourceExpectation(packet.registration.sourceExpectation)) !==
      packet.registration.sourceExpectationSha256 ||
    bytesDigest(Buffer.from(packet.registration.sourceExpectationHex, "hex")) !==
      packet.registration.sourceExpectationSha256 ||
    packet.registration.sourceExpectation.sourceSha256 !== original.sha256
  )
    throw new Error("quality_diagnostic_identity_mismatch");
  const document = JSON.parse(Buffer.from(projection.bytesHex, "hex").toString("utf8"));
  if (
    document.documentId !== args.documentId ||
    document.generationId !== packet.generationId ||
    document.sourceSha256 !== original.sha256
  )
    throw new Error("quality_diagnostic_identity_mismatch");
  const observe = (value: unknown) => {
    if (value === undefined) return null;
    if (typeof value !== "boolean") throw new Error("quality_diagnostic_identity_mismatch");
    return value;
  };
  const pageObservations = args.extracted.pages.map((page) => {
    const row = artifacts.find(
      (input) => input.unitId.family === "private_objects" && input.unitId.key === `page:${page.pageNumber}:extracted`,
    );
    if (
      typeof page.text !== "string" ||
      !page.text.isWellFormed() ||
      !row ||
      row.sha256 !== bytesDigest(Buffer.from(page.text, "utf8")) ||
      row.byteLength !== Buffer.byteLength(page.text, "utf8")
    )
      throw new Error("quality_diagnostic_identity_mismatch");
    return { pageNumber: page.pageNumber, ocrUsed: observe(page.ocrUsed), needsOcr: observe(page.needsOcr) };
  });
  const pageRefs = refs.filter((ref) => ref.unitId.family === "pages");
  const imageRefs = refs.filter((ref) => ref.representation === "image_binary");
  if (
    pageRefs.length !== pageObservations.length ||
    pageRefs.some((ref) => !pageObservations.some((page) => String(page.pageNumber) === ref.unitId.key)) ||
    imageRefs.length !== args.extracted.images.length
  )
    throw new Error("quality_diagnostic_identity_mismatch");
  for (const [index, image] of args.extracted.images.entries()) {
    const provenance = artifacts.find(
      (row) => row.unitId.family === "private_objects" && row.unitId.key === `image:${index + 1}:provenance`,
    );
    if (
      !provenance ||
      generationEvidenceDigest(JSON.parse(Buffer.from(provenance.bytesHex, "hex").toString("utf8")).descriptor) !==
        generationEvidenceDigest(imageDescriptor(image))
    )
      throw new Error("quality_diagnostic_identity_mismatch");
  }
  const partition = (key: "ocrUsed" | "needsOcr") => {
    const result = { true: 0, false: 0, unknown: 0 };
    for (const page of pageObservations) result[page[key] === null ? "unknown" : page[key] ? "true" : "false"] += 1;
    return result;
  };
  const warnings = args.extracted.warnings;
  if (warnings !== undefined) generationEvidenceBytes(warnings);
  if (
    warnings !== undefined &&
    (!Array.isArray(warnings) || warnings.some((warning) => typeof warning !== "string" || !warning.isWellFormed()))
  )
    throw new Error("quality_diagnostic_identity_mismatch");
  const body = prerequisiteQualityDiagnosticSchema.parse({
    version: "ingestion-prerequisite-quality-v1",
    stage: "extraction_retention",
    qualification: "derived_unverified",
    documentId: args.documentId,
    generationId: packet.generationId,
    sourceSha256: original.sha256,
    sourceByteLength: original.byteLength,
    sourceExpectationDigest: packet.registration.sourceExpectationSha256,
    references: refs,
    pageObservations,
    observations: {
      pageCount: pageObservations.length,
      extractedUtf8ByteLength: refs
        .filter((ref) => ref.representation === "extracted_utf8")
        .reduce((sum, ref) => sum + ref.byteLength, 0),
      capturedImageCount: imageRefs.length,
      ocrUsed: partition("ocrUsed"),
      needsOcr: partition("needsOcr"),
      warnings: {
        known: warnings !== undefined,
        entries: (warnings ?? []).map((warning) => ({
          sha256: bytesDigest(Buffer.from(warning, "utf8")),
          byteLength: Buffer.byteLength(warning, "utf8"),
        })),
      },
    },
    downstream: {
      status: "unavailable",
      reason: "downstream_stages_not_executed",
      qualityScore: null,
      extractionQuality: null,
    },
  });
  const unit: GenerationUnitDeclaration = {
    id: { family: "quality", key: "singleton" },
    groupKey: "worker_core",
    required: true,
    dependencies: refs.map((ref) => ref.unitId),
    sourceEvidenceIds: [],
    qualification: "derived_unverified",
    representation: "provenance_json",
  };
  const group: GenerationGroupDeclaration = {
    family: "quality",
    groupKey: "worker_core",
    declaration: {
      producer: {
        name: "worker_prerequisite_quality",
        version: "ingestion-prerequisite-quality-v1",
        outputManifestDigest: generationEvidenceDigest([unit]),
      },
      artifactGenerationId: null,
      population: {
        tag: "known",
        expectedUnits: [unit.id],
        basis: [{ reference: "actual_extraction_retention", sha256: original.sha256 }],
        reason: null,
      },
    },
  };
  const next = {
    version: 1,
    groups: [...packet.declarations.groups, group],
    units: [...packet.declarations.units, unit],
  };
  parseGenerationDeclarations({
    version: 1,
    groups: [...packet.registration.declarations.groups, ...next.groups],
    units: [...packet.registration.declarations.units, ...next.units],
  });
  const bytes = generationEvidenceBytes(body);
  const artifact = parseGenerationArtifact({
    unitId: unit.id,
    groupKey: unit.groupKey,
    representation: "provenance_json",
    bytesHex: bytes.toString("hex"),
    sha256: bytesDigest(bytes),
    byteLength: bytes.length,
    locator: "prerequisite_quality:extraction_retention",
  });
  return freezeGenerationEvidence({
    ...packet,
    declarations: next,
    artifacts: [...packet.artifacts, artifact],
    outcomes: [
      ...packet.outcomes,
      {
        unitId: unit.id,
        groupKey: unit.groupKey,
        disposition: "retained" as const,
        artifactSha256: artifact.sha256,
        limitation: null,
      },
    ],
  });
}

/** Fixed owning stage transport. It has no publication, completion or provider capability. */
export async function stageGenerationPrerequisite(args: {
  packet: ReturnType<typeof buildGenerationRetentionPacket>;
  mutation: (name: string, payload: Record<string, unknown>) => Promise<Record<string, unknown>>;
}) {
  const { packet, mutation } = args;
  await mutation("begin_ingestion_generation_evidence", {
    p_generation: packet.generationId,
    p_registration: packet.registration,
    p_original_hex: packet.artifacts.find((row) => row.representation === "original_binary")!.bytesHex,
  });
  await mutation("declare_ingestion_generation_evidence", {
    p_generation: packet.generationId,
    p_declarations: packet.declarations,
  });
  await mutation("retain_ingestion_generation_artifacts", {
    p_generation: packet.generationId,
    p_artifacts: packet.artifacts,
  });
  await mutation("record_ingestion_generation_outcomes", {
    p_generation: packet.generationId,
    p_outcomes: packet.outcomes,
  });
  const result = await mutation("record_ingestion_generation_accounting", { p_generation: packet.generationId });
  const accounting = result.accounting;
  if (
    !accounting ||
    typeof accounting !== "object" ||
    Array.isArray(accounting) ||
    (accounting as Record<string, unknown>).result !== "unavailable"
  )
    throw new Error("invalid_prerequisite_accounting_result");
  return { result: "unavailable" as const, accounting };
}
