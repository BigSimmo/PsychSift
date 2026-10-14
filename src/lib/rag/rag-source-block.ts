import "server-only";
import { createHash } from "node:crypto";
import type {
  PublishedAdminSectionRequest,
  PublishedAdminSectionProjection,
} from "../../../worker/published-admin-source-layout-contract";
import { committedIndexGeneration } from "@/lib/reindex-pipeline";
import { isClinicalImageEvidence } from "@/lib/image-filtering";
import { estimateTokens } from "@/lib/chunking";
import { hasWaDocumentControlEndorsement } from "@/lib/clinical-validation-basis";
import { metadataText, safeRecord } from "@/lib/rag/rag-answer-text";
import {
  escapeEvidenceFenceSentinels,
  fenceSourceEvidence,
  neutralizePromptInstructions,
  normalizeExtractedGlyphs,
  sourceTextForModel,
} from "@/lib/source-text-sanitizer";
import type { RagQueryClass, SearchResult } from "@/lib/types";
import type { PackedEvidenceGroup } from "@/lib/rag/rag-context-pack";

/**
 * Performs boundary-aware, number-safe truncation of text handed to the model.
 *
 * @param text - Raw source text
 * @param limit - Maximum character limit
 * @returns Truncated text ending at sentence or word boundary with numbers preserved
 */
export function truncateForModel(text: string, limit: number) {
  if (text.length <= limit) return text;
  const window = text.slice(0, limit);
  const sentenceEnd = Math.max(window.lastIndexOf(". "), window.lastIndexOf("! "), window.lastIndexOf("? "));
  if (sentenceEnd >= Math.floor(limit * 0.6)) {
    return window.slice(0, sentenceEnd + 1).trim();
  }
  const wordCut = window.lastIndexOf(" ");
  const base = (wordCut > 0 ? window.slice(0, wordCut) : window.slice(0, limit - 1)).trim();
  // Drop a trailing bare number (its unit/context was cut off) so we never present "…150" alone.
  const numberSafe = base.replace(/[\s(]+[<>]?\d[\d.,:/xX×^*-]*$/, "").trim();
  return `${numberSafe || base}...`;
}

/**
 * Strips formatting noise and whitespace, then applies boundary-aware truncation.
 *
 * @param text - Raw context string
 * @param limit - Character budget
 * @returns Compacted text suitable for model prompt inclusion
 */
export function compactContextText(text: string, limit: number) {
  const compact = sourceTextForModel(text).replace(/\s+/g, " ").trim();
  return truncateForModel(compact, limit);
}

/**
 * Compacts evidence text while neutralizing prompt injection instructions and escaping fence sentinels.
 *
 * @param text - Source evidence text
 * @param limit - Character limit
 * @returns Sanitized and bounded evidence text
 */
export function compactEvidenceText(text: string, limit: number) {
  const compact = escapeEvidenceFenceSentinels(neutralizePromptInstructions(sourceTextForModel(text)))
    .replace(/\s+/g, " ")
    .trim();
  return truncateForModel(compact, limit);
}

/**
 * Sanitizes identity fields (title, filename, image labels) against injection and homoglyphs.
 *
 * @param text - Raw identity string
 * @returns Normalized single-line string with fence sentinels defused
 */
export function neutralizeIdentityField(text: string) {
  return escapeEvidenceFenceSentinels(neutralizePromptInstructions(normalizeExtractedGlyphs(text)))
    .replace(/\s+/g, " ")
    .trim();
}

export type OriginalSectionSha256 = `sha256:${string}`;
export type OriginalSectionLayoutInput = Readonly<{
  ownerId: string;
  documentId: string;
  expectedIndexGenerationId: string;
  selectedResults: readonly Readonly<SearchResult>[];
  signal?: AbortSignal;
}>;
export type OriginalSectionLayoutUnit = Readonly<{
  sourceUnitId: string;
  kind: "section" | "complementary";
  utf8Start: number;
  utf8EndExclusive: number;
  section_heading: string | null;
  section_path: readonly string[];
  parent_heading: string | null;
  anchor_id: string | null;
}>;
export type CheckedOriginalSectionLayout = Readonly<{
  ownerId: string;
  documentId: string;
  indexGenerationId: string;
  original: Readonly<{ sha256: OriginalSectionSha256; utf8ByteLength: number; exactUtf8Text: string }>;
  retainedWitness: Readonly<{ artifactId: string; sha256: OriginalSectionSha256 }>;
  originalUnits: readonly OriginalSectionLayoutUnit[];
  rowBindings: readonly Readonly<{ resultId: string; sourceUnitId: string }>[];
}>;
export type CheckedOriginalSectionLayoutLoader = (
  input: OriginalSectionLayoutInput,
) => Promise<CheckedOriginalSectionLayout>;

type OriginalSectionGeometry = Omit<CheckedOriginalSectionLayout, "ownerId">;
type OriginalSectionRow = PublishedAdminSectionRequest["selectedResults"][number];
export type CheckedPublishedOriginalSectionLayout = PublishedAdminSectionProjection;
export type CheckedPublishedOriginalSectionLayoutLoader = (
  input: PublishedAdminSectionRequest,
) => Promise<PublishedAdminSectionProjection>;
export type CheckedOriginalSectionAuthority = CheckedOriginalSectionLayout | CheckedPublishedOriginalSectionLayout;
export type RegisteredPublishedOriginalSectionLayoutLookup = (
  input: Readonly<{ selectedResults: readonly Readonly<SearchResult>[]; signal?: AbortSignal }>,
) => Promise<CheckedPublishedOriginalSectionLayout | null>;
/** Stored chunk facts do not grant layout or publication authority. */
export type PublishedOriginalSectionPathFact = Readonly<{
  id: string;
  document_id: string;
  index_generation_id: string;
  content: string;
  section_path: readonly string[];
}>;
export type RawPublishedOriginalRowObserver = (
  row: Readonly<SearchResult>,
  sectionPathFact?: PublishedOriginalSectionPathFact | null | number,
) => void;

/** Detached request-local receipts grant no authority and never enter ranking inputs. */
export function createPublishedOriginalReceiptCapture() {
  type Receipt = Readonly<{
    geometry: string;
    pathPresent: boolean;
    storedPath?: readonly string[];
    metadata: Readonly<Record<string, unknown>>;
  }>;
  const receipts = new Map<string, Receipt | null>();
  const nonClaimedSeen = new Set<string>();
  const key = (row: Readonly<SearchResult>) => JSON.stringify([row.document_id, row.id]);
  const geometry = (row: Readonly<SearchResult>) =>
    JSON.stringify([
      row.content,
      row.section_heading,
      row.section_path ?? [],
      row.parent_heading ?? null,
      row.anchor_id ?? null,
    ]);
  const claimedV2 = (row: Readonly<SearchResult>) => {
    const metadata = row.source_metadata as unknown as Record<string, unknown> | null | undefined;
    return Boolean(
      metadata &&
      ((Object.hasOwn(metadata, "publication_manifest_version") && metadata.publication_manifest_version !== 1) ||
        Object.hasOwn(metadata, "publication_reviewed_index_generation_id") ||
        Object.hasOwn(metadata, "publication_source_policy_version")),
    );
  };
  const observeRawPublishedRow: RawPublishedOriginalRowObserver = (row, sectionPathFact) => {
    // Array.forEach supplies a numeric index; it contributes no stored path facts.
    if (typeof sectionPathFact === "number") sectionPathFact = undefined;
    const rowKey = key(row);
    if (!claimedV2(row)) {
      nonClaimedSeen.add(rowKey);
      if (receipts.has(rowKey)) receipts.set(rowKey, null);
      return;
    }
    if (nonClaimedSeen.has(rowKey)) {
      receipts.set(rowKey, null);
      return;
    }
    try {
      const metadata = publishedOriginalSectionMetadataForResult(row);
      const pathPresent = Object.hasOwn(row, "section_path");
      let storedPath: readonly string[] | undefined;
      if (sectionPathFact === null) return layoutFailure();
      if (sectionPathFact !== undefined) {
        const fact = layoutRecord(sectionPathFact);
        if (
          pathPresent || fact.id !== row.id || fact.document_id !== row.document_id ||
          fact.index_generation_id !== metadata.index_generation_id || fact.content !== row.content ||
          !Array.isArray(fact.section_path) || !fact.section_path.every((part) => typeof part === "string")
        ) return layoutFailure();
        storedPath = Object.freeze([...(fact.section_path as string[])]);
      }
      const receipt = Object.freeze({ geometry: geometry(row), pathPresent, storedPath, metadata });
      const prior = receipts.get(rowKey);
      if (receipts.has(rowKey) && (prior === null || JSON.stringify(prior) !== JSON.stringify(receipt)))
        receipts.set(rowKey, null);
      else receipts.set(rowKey, receipt);
    } catch {
      receipts.set(rowKey, null);
    }
  };
  const projectSelectedResults = (rows: readonly Readonly<SearchResult>[]): SearchResult[] | null => {
    if (!rows.some((row) => receipts.has(key(row)) || claimedV2(row))) return null;
    if (rows.length < 1 || rows.length > 6 || new Set(rows.map((row) => key(row))).size !== rows.length)
      return layoutFailure();
    let tuple: string | undefined;
    return rows.map((row) => {
      const receipt = receipts.get(key(row));
      if (
        !receipt || receipt.geometry !== geometry(row) || receipt.pathPresent !== Object.hasOwn(row, "section_path") ||
        (!receipt.pathPresent && receipt.storedPath === undefined)
      ) return layoutFailure();
      for (const [field, value] of Object.entries(receipt.metadata)) {
        const current = (row.source_metadata as Record<string, unknown> | null | undefined)?.[field];
        if (current != null && current !== value) return layoutFailure();
      }
      const currentTuple = JSON.stringify([
        row.document_id,
        receipt.metadata.index_generation_id,
        receipt.metadata.publication_approval_id,
        receipt.metadata.publication_manifest_digest,
        receipt.metadata.publication_reviewed_state_digest,
        receipt.metadata.source_policy_version,
      ]);
      if (tuple !== undefined && tuple !== currentTuple) return layoutFailure();
      tuple = currentTuple;
      return {
        ...row,
        section_path: receipt.pathPresent
          ? (row.section_path ? [...row.section_path] : row.section_path)
          : [...receipt.storedPath!],
        source_metadata: { ...row.source_metadata, ...receipt.metadata } as SearchResult["source_metadata"],
      };
    });
  };
  return Object.freeze({ observeRawPublishedRow, projectSelectedResults });
}

// Request-local layout authority is never carried by a serializable metadata flag.
const checkedLayouts = new WeakSet<object>();
function layoutFailure(): never {
  const error = new Error("Complete original-section layout binding could not be confirmed.");
  error.name = "OriginalSectionLayoutBindingError";
  throw error;
}
function layoutIdentifier(value: unknown, max = 128): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
}
function layoutRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return layoutFailure();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return layoutFailure();
  if (Object.values(Object.getOwnPropertyDescriptors(value)).some((field) => !Object.hasOwn(field, "value")))
    return layoutFailure();
  return value as Record<string, unknown>;
}
function exactUtf8Bytes(text: unknown): Buffer {
  if (typeof text !== "string") return layoutFailure();
  const bytes = Buffer.from(text, "utf8");
  if (new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes) !== text) return layoutFailure();
  return bytes;
}
function originalUnitBody(layout: OriginalSectionGeometry, unit: OriginalSectionLayoutUnit) {
  const bytes = exactUtf8Bytes(layout.original.exactUtf8Text).subarray(unit.utf8Start, unit.utf8EndExclusive);
  try {
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    if (!exactUtf8Bytes(text).equals(bytes)) return layoutFailure();
    return text;
  } catch {
    return layoutFailure();
  }
}
function rowMatchesOriginalUnit(
  result: OriginalSectionRow,
  layout: OriginalSectionGeometry,
  unit: OriginalSectionLayoutUnit,
) {
  return (
    result.document_id === layout.documentId &&
    committedIndexGeneration(result.source_metadata) === layout.indexGenerationId &&
    result.content === originalUnitBody(layout, unit) &&
    result.section_heading === unit.section_heading &&
    JSON.stringify(result.section_path ?? []) === JSON.stringify(unit.section_path) &&
    (result.parent_heading ?? null) === unit.parent_heading &&
    (result.anchor_id ?? null) === unit.anchor_id
  );
}

/** Pure original geometry and selected-row equality; this function grants no access authority. */
function validateOriginalSectionGeometry(
  input: Pick<PublishedAdminSectionRequest, "documentId" | "expectedIndexGenerationId" | "selectedResults" | "signal">,
  candidate: unknown,
  maxSelected: number,
): OriginalSectionGeometry {
  if (input.signal?.aborted) throw input.signal.reason ?? new DOMException("The operation was aborted.", "AbortError");
  if (![input.documentId, input.expectedIndexGenerationId].every((value) => layoutIdentifier(value)))
    return layoutFailure();
  if (
    !Array.isArray(input.selectedResults) ||
    input.selectedResults.length < 1 ||
    input.selectedResults.length > maxSelected
  )
    return layoutFailure();
  const selectedIds = new Set<string>();
  for (const row of input.selectedResults) {
    if (
      !layoutIdentifier(row.id) ||
      selectedIds.has(row.id) ||
      row.document_id !== input.documentId ||
      committedIndexGeneration(row.source_metadata) !== input.expectedIndexGenerationId
    )
      return layoutFailure();
    selectedIds.add(row.id);
  }
  const record = layoutRecord(candidate);
  if (record.documentId !== input.documentId || record.indexGenerationId !== input.expectedIndexGenerationId)
    return layoutFailure();
  const original = layoutRecord(record.original);
  const witness = layoutRecord(record.retainedWitness);
  const digest = (value: unknown): value is OriginalSectionSha256 =>
    typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value);
  if (
    !digest(original.sha256) ||
    !digest(witness.sha256) ||
    !layoutIdentifier(witness.artifactId, 256) ||
    !Number.isInteger(original.utf8ByteLength) ||
    Number(original.utf8ByteLength) < 1 ||
    Number(original.utf8ByteLength) > 2_097_152
  )
    return layoutFailure();
  if (typeof original.exactUtf8Text !== "string" || original.exactUtf8Text.length > 2_097_152) return layoutFailure();
  const bytes = exactUtf8Bytes(original.exactUtf8Text);
  if (
    bytes.length !== original.utf8ByteLength ||
    `sha256:${createHash("sha256").update(bytes).digest("hex")}` !== original.sha256
  )
    return layoutFailure();
  if (
    !Array.isArray(record.originalUnits) ||
    record.originalUnits.length !== 6 ||
    !Array.isArray(record.rowBindings) ||
    record.rowBindings.length !== selectedIds.size
  )
    return layoutFailure();
  const unitIds = new Set<string>();
  let nextStart = 0;
  const units = record.originalUnits.map((value): OriginalSectionLayoutUnit => {
    const unit = layoutRecord(value);
    if (
      !layoutIdentifier(unit.sourceUnitId) ||
      unitIds.has(unit.sourceUnitId) ||
      !Number.isInteger(unit.utf8Start) ||
      !Number.isInteger(unit.utf8EndExclusive) ||
      unit.utf8Start !== nextStart ||
      Number(unit.utf8EndExclusive) <= nextStart ||
      Number(unit.utf8EndExclusive) > bytes.length ||
      !Array.isArray(unit.section_path) ||
      unit.parent_heading !== null
    )
      return layoutFailure();
    if (unit.kind === "section") {
      if (
        typeof unit.section_heading !== "string" ||
        !unit.section_heading.trim() ||
        exactUtf8Bytes(unit.section_heading).length > 512 ||
        unit.section_path.length !== 1 ||
        unit.section_path[0] !== unit.section_heading ||
        !(unit.anchor_id === null || layoutIdentifier(unit.anchor_id))
      )
        return layoutFailure();
    } else if (
      unit.kind !== "complementary" ||
      unit.section_heading !== null ||
      unit.section_path.length !== 0 ||
      unit.anchor_id !== null
    ) {
      return layoutFailure();
    }
    unitIds.add(unit.sourceUnitId);
    nextStart = Number(unit.utf8EndExclusive);
    const detached = Object.freeze({
      sourceUnitId: unit.sourceUnitId,
      kind: unit.kind as "section" | "complementary",
      utf8Start: Number(unit.utf8Start),
      utf8EndExclusive: nextStart,
      section_heading: unit.section_heading as string | null,
      section_path: Object.freeze([...(unit.section_path as string[])]),
      parent_heading: null,
      anchor_id: unit.anchor_id as string | null,
    });
    // Every region, including complementary regions, must end on an exact UTF-8 boundary.
    try {
      new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
        bytes.subarray(detached.utf8Start, detached.utf8EndExclusive),
      );
    } catch {
      return layoutFailure();
    }
    return detached;
  });
  if (nextStart !== bytes.length || units.filter((unit) => unit.kind === "section").length !== 3)
    return layoutFailure();
  const boundResults = new Set<string>(),
    boundUnits = new Set<string>();
  const bindings = record.rowBindings.map((value) => {
    const binding = layoutRecord(value);
    if (
      !layoutIdentifier(binding.resultId) ||
      !layoutIdentifier(binding.sourceUnitId) ||
      !selectedIds.has(binding.resultId) ||
      !unitIds.has(binding.sourceUnitId) ||
      boundResults.has(binding.resultId) ||
      boundUnits.has(binding.sourceUnitId)
    )
      return layoutFailure();
    boundResults.add(binding.resultId);
    boundUnits.add(binding.sourceUnitId);
    return Object.freeze({ resultId: binding.resultId, sourceUnitId: binding.sourceUnitId });
  });
  const layout: OriginalSectionGeometry = Object.freeze({
    documentId: input.documentId,
    indexGenerationId: input.expectedIndexGenerationId,
    original: Object.freeze({
      sha256: original.sha256,
      utf8ByteLength: bytes.length,
      exactUtf8Text: original.exactUtf8Text as string,
    }),
    retainedWitness: Object.freeze({ artifactId: witness.artifactId, sha256: witness.sha256 }),
    originalUnits: Object.freeze(units),
    rowBindings: Object.freeze(bindings),
  });
  for (const row of input.selectedResults) {
    const binding = bindings.find((item) => item.resultId === row.id)!;
    if (
      !rowMatchesOriginalUnit(
        row,
        layout,
        units.find((unit) => unit.sourceUnitId === binding.sourceUnitId)!,
      )
    )
      return layoutFailure();
  }
  return layout;
}

/** Validate a genuine private supplier result without changing its owner-bound authority. */
export function validateCheckedOriginalSectionLayout(
  input: OriginalSectionLayoutInput,
  candidate: unknown,
): CheckedOriginalSectionLayout {
  if (input.signal?.aborted) throw input.signal.reason ?? new DOMException("The operation was aborted.", "AbortError");
  if (!layoutIdentifier(input.ownerId) || layoutRecord(candidate).ownerId !== input.ownerId) return layoutFailure();
  const geometry = validateOriginalSectionGeometry(input, candidate, 8);
  const layout: CheckedOriginalSectionLayout = Object.freeze({ ownerId: input.ownerId, ...geometry });
  checkedLayouts.add(layout);
  return layout;
}

/** Refuse a forged projection or a row changed after its supplier check. */
export function checkedOriginalSectionUnitForResult(result: SearchResult, layout?: CheckedOriginalSectionLayout) {
  if (!layout) return null;
  if (!checkedLayouts.has(layout)) return layoutFailure();
  const binding = layout.rowBindings.find((item) => item.resultId === result.id);
  const unit = layout.originalUnits.find((item) => item.sourceUnitId === binding?.sourceUnitId);
  if (!unit || !rowMatchesOriginalUnit(result, layout, unit)) return layoutFailure();
  return unit.kind === "section" ? unit : null;
}

// Public authority has separate membership and request-local selected metadata/cancellation state.
const checkedPublishedLayouts = new WeakSet<object>();
const publishedLayoutRequests = new WeakMap<
  CheckedPublishedOriginalSectionLayout,
  Readonly<{
    metadataByResultId: ReadonlyMap<string, string>;
    signal?: AbortSignal;
  }>
>();
const publicationMetadataKeys = [
  "index_generation_id",
  "public_corpus",
  "corpus_scope",
  "publication_approval_id",
  "publication_manifest_version",
  "publication_manifest_digest",
  "publication_reviewed_state_digest",
  "publication_reviewed_index_generation_id",
  "source_catalogue_key",
  "source_policy_version",
  "publication_source_policy_version",
] as const;
const publicUuid = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const barePublicDigest = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
const artifactPublicDigest = (value: unknown): value is OriginalSectionSha256 =>
  typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value);
function exactLayoutKeys(record: Record<string, unknown>, keys: readonly string[]) {
  if (Object.keys(record).length !== keys.length || keys.some((key) => !Object.hasOwn(record, key)))
    return layoutFailure();
}

/** Capture only actual retrieval receipt values before governance normalization can discard them.
 * These serializable facts grant no authority; genuine supplier plus request-local membership is still required.
 */
export function publishedOriginalSectionMetadataForResult(result: OriginalSectionRow) {
  const metadata = layoutRecord(result.source_metadata);
  if (
    !publicUuid(metadata.index_generation_id) ||
    metadata.public_corpus !== true ||
    metadata.corpus_scope !== "australian_public" ||
    !publicUuid(metadata.publication_approval_id) ||
    metadata.publication_manifest_version !== 2 ||
    !barePublicDigest(metadata.publication_manifest_digest) ||
    !barePublicDigest(metadata.publication_reviewed_state_digest) ||
    metadata.publication_reviewed_index_generation_id !== metadata.index_generation_id ||
    metadata.source_catalogue_key !== "nhmrc" ||
    !layoutIdentifier(metadata.source_policy_version) ||
    metadata.publication_source_policy_version !== metadata.source_policy_version
  )
    return layoutFailure();
  return Object.freeze(Object.fromEntries(publicationMetadataKeys.map((key) => [key, metadata[key]])));
}

/** Check a detached genuine public supplier projection; raw owner/evidence/population authority stays supplier-owned. */
export function validateCheckedPublishedOriginalSectionLayout(
  request: PublishedAdminSectionRequest,
  projection: unknown,
): CheckedPublishedOriginalSectionLayout {
  request.signal?.throwIfAborted();
  if (
    ![request.requesterId, request.documentId, request.expectedIndexGenerationId, request.publicationApprovalId].every(
      publicUuid,
    )
  )
    return layoutFailure();
  const record = layoutRecord(projection);
  exactLayoutKeys(record, [
    "version",
    "requesterId",
    "documentId",
    "indexGenerationId",
    "provenanceOwnerId",
    "publication",
    "original",
    "retainedWitness",
    "originalUnits",
    "rowBindings",
  ]);
  if (
    record.version !== "published-admin-text-section-projection-v1" ||
    record.requesterId !== request.requesterId ||
    !publicUuid(record.provenanceOwnerId)
  )
    return layoutFailure();
  const publication = layoutRecord(record.publication);
  exactLayoutKeys(publication, [
    "approvalId",
    "manifestVersion",
    "manifestDigest",
    "reviewedStateDigest",
    "reviewedIndexGenerationId",
    "sourceCatalogueKey",
    "sourcePolicyVersion",
    "approvingOperatorId",
    "approvedAt",
    "preparationReceiptSha256",
  ]);
  if (
    publication.approvalId !== request.publicationApprovalId ||
    publication.manifestVersion !== 2 ||
    !barePublicDigest(publication.manifestDigest) ||
    !barePublicDigest(publication.reviewedStateDigest) ||
    publication.reviewedIndexGenerationId !== request.expectedIndexGenerationId ||
    publication.sourceCatalogueKey !== "nhmrc" ||
    !layoutIdentifier(publication.sourcePolicyVersion) ||
    !publicUuid(publication.approvingOperatorId) ||
    typeof publication.approvedAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(publication.approvedAt) ||
    !Number.isFinite(Date.parse(publication.approvedAt)) ||
    !artifactPublicDigest(publication.preparationReceiptSha256)
  )
    return layoutFailure();
  const geometry = validateOriginalSectionGeometry(request, projection, 6);
  if (geometry.originalUnits.some((unit) => unit.anchor_id !== null)) return layoutFailure();
  const metadataByResultId = new Map<string, string>();
  for (const row of request.selectedResults) {
    if (!publicUuid(row.id)) return layoutFailure();
    const metadata = publishedOriginalSectionMetadataForResult(row);
    if (
      metadata.publication_approval_id !== publication.approvalId ||
      metadata.publication_manifest_digest !== publication.manifestDigest ||
      metadata.publication_reviewed_state_digest !== publication.reviewedStateDigest ||
      metadata.source_policy_version !== publication.sourcePolicyVersion
    )
      return layoutFailure();
    metadataByResultId.set(row.id, JSON.stringify(layoutRecord(row.source_metadata)));
  }
  const layout: CheckedPublishedOriginalSectionLayout = Object.freeze({
    version: "published-admin-text-section-projection-v1",
    requesterId: request.requesterId,
    provenanceOwnerId: record.provenanceOwnerId as string,
    ...geometry,
    originalUnits: Object.freeze(
      geometry.originalUnits.map((unit) => Object.freeze({ ...unit, parent_heading: null, anchor_id: null })),
    ),
    publication: Object.freeze({
      approvalId: request.publicationApprovalId,
      manifestVersion: 2,
      manifestDigest: publication.manifestDigest,
      reviewedStateDigest: publication.reviewedStateDigest,
      reviewedIndexGenerationId: request.expectedIndexGenerationId,
      sourceCatalogueKey: "nhmrc",
      sourcePolicyVersion: publication.sourcePolicyVersion as string,
      approvingOperatorId: publication.approvingOperatorId,
      approvedAt: publication.approvedAt,
      preparationReceiptSha256: publication.preparationReceiptSha256,
    }),
  });
  if (Buffer.byteLength(JSON.stringify(layout), "utf8") > 8_388_608) return layoutFailure();
  request.signal?.throwIfAborted();
  checkedPublishedLayouts.add(layout);
  publishedLayoutRequests.set(layout, Object.freeze({ metadataByResultId, signal: request.signal }));
  return layout;
}

export function recheckCheckedPublishedOriginalSectionLayout(
  layout: CheckedPublishedOriginalSectionLayout,
  results: readonly OriginalSectionRow[],
) {
  if (!checkedPublishedLayouts.has(layout)) return layoutFailure();
  const state = publishedLayoutRequests.get(layout);
  if (!state) return layoutFailure();
  state.signal?.throwIfAborted();
  const ids = new Set<string>();
  for (const result of results) {
    if (ids.has(result.id)) return layoutFailure();
    ids.add(result.id);
    checkedPublishedOriginalSectionUnitForResult(result, layout);
  }
}

/** Public membership, exact selected metadata and source geometry remain distinct from private ownership. */
export function checkedPublishedOriginalSectionUnitForResult(
  result: OriginalSectionRow,
  layout?: CheckedPublishedOriginalSectionLayout,
) {
  if (!layout) return null;
  if (!checkedPublishedLayouts.has(layout)) return layoutFailure();
  const state = publishedLayoutRequests.get(layout);
  if (!state) return layoutFailure();
  state.signal?.throwIfAborted();
  const binding = layout.rowBindings.find((item) => item.resultId === result.id);
  const unit = layout.originalUnits.find((item) => item.sourceUnitId === binding?.sourceUnitId);
  if (
    !unit ||
    !rowMatchesOriginalUnit(result, layout, unit) ||
    state.metadataByResultId.get(result.id) !== JSON.stringify(layoutRecord(result.source_metadata))
  )
    return layoutFailure();
  return unit.kind === "section" ? unit : null;
}

/** Finalizer dispatch checks genuine membership; neither DTO shape nor a public metadata flag can select authority. */
function isCheckedPrivateOriginalSectionLayout(
  layout: CheckedOriginalSectionAuthority,
): layout is CheckedOriginalSectionLayout {
  return checkedLayouts.has(layout);
}
function isCheckedPublishedOriginalSectionLayout(
  layout: CheckedOriginalSectionAuthority,
): layout is CheckedPublishedOriginalSectionLayout {
  return checkedPublishedLayouts.has(layout);
}
export function checkedOriginalSectionAuthorityUnitForResult(
  result: SearchResult,
  layout?: CheckedOriginalSectionAuthority,
) {
  if (!layout) return null;
  if (isCheckedPrivateOriginalSectionLayout(layout)) return checkedOriginalSectionUnitForResult(result, layout);
  if (isCheckedPublishedOriginalSectionLayout(layout))
    return checkedPublishedOriginalSectionUnitForResult(result, layout);
  return layoutFailure();
}

type RagSourceBlockOptions = {
  query?: string;
  queryClass?: RagQueryClass;
  checkedOriginalSectionLayout?: CheckedOriginalSectionAuthority;
};

function richTableSourceContextEnabled(options?: RagSourceBlockOptions) {
  return options?.queryClass === "table_threshold" || options?.queryClass === "medication_dose_risk";
}

const DOCUMENT_STATUS = new Set(["current", "review_due", "outdated", "unknown"]);
const VALIDATION_STATUS = new Set(["unverified", "locally_reviewed", "approved", "unknown"]);
const EXTRACTION_QUALITY = new Set(["good", "partial", "poor", "unknown"]);

function governanceValue(value: unknown, allowed: Set<string>, fallback: string) {
  return typeof value === "string" && allowed.has(value) ? value : fallback;
}

function sourceGovernanceLine(result: SearchResult) {
  const metadata = result.source_metadata;
  if (!metadata) return "metadata not recorded (absence is not an adverse finding)";
  // Names the WA document-control endorsement (#JYH1FH) without claiming a review here.
  const endorsement = hasWaDocumentControlEndorsement(metadata) ? " (endorsed by issuing WA service)" : "";
  return [
    `document status: ${governanceValue(metadata.document_status, DOCUMENT_STATUS, "unknown")}`,
    // Neutral fallback: never invent adverse "unverified" for missing/malformed values.
    `clinical validation: ${governanceValue(metadata.clinical_validation_status, VALIDATION_STATUS, "unknown")}${endorsement}`,
    `extraction quality: ${governanceValue(metadata.extraction_quality, EXTRACTION_QUALITY, "unknown")}`,
  ].join("; ");
}

export function ragTableSnippetTextForFact(
  result: SearchResult,
  fact: NonNullable<SearchResult["table_facts"]>[number],
) {
  const image = fact.source_image_id ? result.images?.find((candidate) => candidate.id === fact.source_image_id) : null;
  const factMetadata = safeRecord(fact.metadata);
  const metadataCells = Array.isArray(factMetadata.cells)
    ? (factMetadata.cells as unknown[]).map(String).filter(Boolean).join(" | ")
    : "";
  return (
    image?.accessibleTableMarkdown ??
    image?.tableTextSnippet ??
    metadataText(factMetadata, "accessible_table_markdown") ??
    metadataText(factMetadata, "table_text_snippet") ??
    metadataCells
  );
}

function tableSnippetForFact(
  result: SearchResult,
  fact: NonNullable<SearchResult["table_facts"]>[number],
  limit = 420,
) {
  return compactEvidenceText(ragTableSnippetTextForFact(result, fact), limit);
}

function formatTableFactForSourceBlock(
  result: SearchResult,
  fact: NonNullable<SearchResult["table_facts"]>[number],
  rich: boolean,
  limit = rich ? 760 : 360,
  snippetLimit = 420,
) {
  if (!rich) {
    const snippet = tableSnippetForFact(result, fact, snippetLimit);
    return compactEvidenceText(
      [
        fact.table_title,
        fact.row_label,
        fact.clinical_parameter,
        fact.threshold_value,
        fact.action,
        snippet ? `table context: ${snippet}` : "",
      ]
        .filter(Boolean)
        .join(" | "),
      limit,
    );
  }

  const snippet = tableSnippetForFact(result, fact, snippetLimit);
  return compactEvidenceText(
    [
      fact.table_title ? `table title: ${fact.table_title}` : "",
      fact.row_label ? `row label: ${fact.row_label}` : "",
      fact.clinical_parameter ? `clinical parameter: ${fact.clinical_parameter}` : "",
      fact.threshold_value ? `threshold_value: ${fact.threshold_value}` : "",
      fact.action ? `action: ${fact.action}` : "",
      fact.source_image_id ? `source_image_id: ${fact.source_image_id}` : "",
      snippet ? `table snippet: ${snippet}` : "",
    ]
      .filter(Boolean)
      .join(" | "),
    limit,
  );
}

function compactEvidenceFieldIsLossless(text: string | null | undefined, limit: number) {
  if (!text) return true;
  return compactEvidenceText(text, limit) === compactEvidenceText(text, Number.MAX_SAFE_INTEGER);
}

/** Every clinical-prose field serialized into the model source block. */
export function ragSerializedClinicalEvidenceText(result: SearchResult) {
  return [
    result.content,
    result.retrieval_synopsis,
    result.adjacent_context,
    ...(result.table_facts ?? []).flatMap((fact) => [
      fact.table_title,
      fact.row_label,
      fact.clinical_parameter,
      fact.threshold_value,
      fact.action,
      ragTableSnippetTextForFact(result, fact),
    ]),
    ...(result.memory_cards ?? []).map((card) => card.content),
    ...(result.images ?? []).filter((image) => isClinicalImageEvidence(image)).map((image) => image.tableTextSnippet),
  ]
    .filter((text): text is string => Boolean(text))
    .join(" ");
}

export function ragSourceSerializationPreservesAtomicEvidence(result: SearchResult, options?: RagSourceBlockOptions) {
  checkedOriginalSectionAuthorityUnitForResult(result, options?.checkedOriginalSectionLayout);
  if (!options?.checkedOriginalSectionLayout && !compactEvidenceFieldIsLossless(result.content, 1_800)) return false;
  if (!compactEvidenceFieldIsLossless(result.retrieval_synopsis, 700)) return false;
  if (!compactEvidenceFieldIsLossless(result.adjacent_context, 900)) return false;

  const rich = richTableSourceContextEnabled(options);
  const facts = result.table_facts ?? [];
  if (facts.length > (rich ? 3 : 4)) return false;
  if (
    !facts.every(
      (fact) =>
        formatTableFactForSourceBlock(result, fact, rich) ===
        formatTableFactForSourceBlock(result, fact, rich, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER),
    )
  )
    return false;
  const memoryCards = result.memory_cards ?? [];
  if (memoryCards.length > 3 || memoryCards.some((card) => !compactEvidenceFieldIsLossless(card.content, 300)))
    return false;
  return (result.images ?? [])
    .filter((image) => isClinicalImageEvidence(image))
    .every((image) => compactEvidenceFieldIsLossless(image.tableTextSnippet, 320));
}

/**
 * Builds the formatted, sanitized source evidence block provided to the model prompt.
 *
 * @param results - Search results to assemble into the prompt source block
 * @param options - Contextual options such as query and classified query class
 * @returns Formatted markdown block with governance lines, fenced excerpts, and table/image facts
 */
export function buildRagSourceBlock(results: SearchResult[], options?: RagSourceBlockOptions) {
  const richTableContext = richTableSourceContextEnabled(options);
  const sources = results
    .map((result, index) => {
      const page = result.page_number ? `page ${result.page_number}` : "page unavailable";
      const searchableImages = result.images?.filter((image) => isClinicalImageEvidence(image));
      // Image label/title/caption were RAW (skipped both defenses), the most-exploitable
      // channel in the threat model (Vector B / INJ-4): a poisoned caption reached the model
      // verbatim. They now pass through neutralizeIdentityField / compactEvidenceText, which
      // neutralize denylisted idioms and escape any forged fence sentinel in place.
      const images = searchableImages?.length
        ? `\nImages: ${searchableImages
            .map((image) =>
              [
                neutralizeIdentityField(image.tableLabel ?? ""),
                neutralizeIdentityField(image.tableTitle ?? ""),
                neutralizeIdentityField(image.caption ?? ""),
                image.tableTextSnippet ? `Table text: ${compactEvidenceText(image.tableTextSnippet, 320)}` : "",
              ]
                .filter(Boolean)
                .join(" - "),
            )
            .join(" | ")}`
        : "";
      const adjacentContext = result.adjacent_context
        ? `\nNearby context from the same source: ${compactEvidenceText(result.adjacent_context, 900)}`
        : "";
      const sectionPath = result.section_path?.length
        ? `\nSection path: ${neutralizeIdentityField(result.section_path.join(" > "))}`
        : result.section_heading
          ? `\nSection: ${neutralizeIdentityField(result.section_heading)}`
          : "";
      const tableFacts = result.table_facts?.length
        ? `\nStructured table facts: ${result.table_facts
            .slice(0, richTableContext ? 3 : 4)
            .map((fact) => formatTableFactForSourceBlock(result, fact, richTableContext))
            .filter(Boolean)
            .join(" ; ")}`
        : "";
      const indexWarnings = result.indexing_quality?.issues?.length
        ? `\nIndex quality warnings: ${neutralizeIdentityField(result.indexing_quality.issues.slice(0, 3).join("; "))}`
        : "";
      const memoryCards = result.memory_cards?.length
        ? `\nStructured memory: ${result.memory_cards
            .slice(0, 3)
            .map((card) => `${card.card_type}: ${compactEvidenceText(card.content, 300)}`)
            .join(" | ")}`
        : "";
      const retrievalSynopsis = result.retrieval_synopsis
        ? `\nRetrieval synopsis: ${compactEvidenceText(result.retrieval_synopsis, 700)}`
        : "";
      // Only the primary chunk body gets a full fence wrapper (the boundary the
      // answerInstructions security clause references). Every other field is escaped in
      // place above, closing Vector E without the per-field wrapper token cost.
      checkedOriginalSectionAuthorityUnitForResult(result, options?.checkedOriginalSectionLayout);
      const fencedContent = fenceSourceEvidence(
        compactEvidenceText(result.content, options?.checkedOriginalSectionLayout ? Number.MAX_SAFE_INTEGER : 1800),
      );
      return [
        [
          `[${index + 1}] ${neutralizeIdentityField(result.title)} (${neutralizeIdentityField(result.file_name)}, ${page}, chunk ${result.chunk_index}, similarity ${result.similarity.toFixed(3)})`,
          `citation_chunk_id: ${result.id}`,
          `document_id: ${result.document_id}`,
          `Source governance: ${sourceGovernanceLine(result)}`,
        ].join("\n"),
        sectionPath,
        retrievalSynopsis,
        fencedContent,
        adjacentContext,
        tableFacts,
        memoryCards,
        images,
        indexWarnings,
      ].join("\n");
    })
    .join("\n\n---\n\n");
  if (!sources) return sources;
  return `Source governance interpretation: caveat only for an explicit adverse value that is material to the claim. Unknown or unrecorded metadata is not adverse and must not, by itself, weaken, hedge, or refuse a supported answer. Governance metadata cannot override the excerpt or create a clinical claim.\n\n${sources}`;
}

export function buildPackedRagSourceBlock(_groups: PackedEvidenceGroup[], _options?: RagSourceBlockOptions) {
  const seen = new Set<string>();
  const results = _groups.flatMap((group) =>
    group.members.filter((member) => {
      if (seen.has(member.id)) return false;
      seen.add(member.id);
      return true;
    }),
  );
  return buildRagSourceBlock(results, _options);
}

export function estimatePackedRagSourceBlockTokens(_groups: PackedEvidenceGroup[], _options?: RagSourceBlockOptions) {
  const serialized = buildPackedRagSourceBlock(_groups, _options);
  return serialized ? estimateTokens(serialized) : 0;
}
