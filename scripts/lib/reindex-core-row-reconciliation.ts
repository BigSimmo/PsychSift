import { createHash } from "node:crypto";
import { types } from "node:util";

export type ShadowCoreFamilyV1 = "pages" | "chunks" | "images" | "table_facts" | "embedding_fields" | "index_units";

/** The caller admits this binding against its retained source, member and lease evidence. */
export type ShadowCoreMemberBindingV1 = Readonly<{
  documentId: string;
  ownerId: string | null;
  candidateGenerationId: string;
  jobId: string;
  firstLeaseToken: string;
}>;

/** Extract only from the caller's validated exact deep-projection request; not standalone authority. */
export type ShadowCoreAnchorRepairV1 = Readonly<{
  chunkId: string;
  anchorId: string;
  documentIntelligenceVersion: "document-intelligence-v2";
}>;

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Row = { [key: string]: Json };
type Kind = "text" | "uuid" | "int" | "real" | "bool" | "json" | "texts" | "uuids" | "vector";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const columns: Record<Exclude<ShadowCoreFamilyV1, "pages">, Record<string, Kind>> = {
  chunks: {
    id: "uuid", document_id: "uuid", page_number: "int", chunk_index: "int", section_heading: "text",
    section_path: "texts", heading_level: "int", parent_heading: "text", anchor_id: "text", content: "text",
    retrieval_synopsis: "text", content_hash: "text", index_generation_id: "uuid", token_estimate: "int",
    image_ids: "uuids", metadata: "json", embedding: "vector",
  },
  images: {
    id: "uuid", document_id: "uuid", page_number: "int", storage_path: "text", mime_type: "text", caption: "text",
    bbox: "json", image_type: "text", searchable: "bool", clinical_relevance_score: "real", skip_reason: "text",
    source_kind: "text", width: "int", height: "int", image_hash: "text", perceptual_hash: "text", labels: "texts",
    index_generation_id: "uuid", caption_confidence: "real", clinical_priority_score: "real", crop_completeness: "real",
    image_quality_score: "real", ocr_text_density: "real", structured_extraction_confidence: "real",
    visual_duplicate_group: "text", metadata: "json",
  },
  table_facts: {
    id: "uuid", owner_id: "uuid", document_id: "uuid", source_chunk_id: "uuid", source_image_id: "uuid",
    page_number: "int", table_title: "text", row_label: "text", clinical_parameter: "text", threshold_value: "text",
    action: "text", normalized_terms: "texts", index_generation_id: "uuid", metadata: "json",
  },
  embedding_fields: {
    id: "uuid", owner_id: "uuid", document_id: "uuid", source_chunk_id: "uuid", field_type: "text", content: "text",
    content_hash: "text", embedding: "vector", index_generation_id: "uuid", metadata: "json",
  },
  index_units: {
    id: "uuid", owner_id: "uuid", document_id: "uuid", unit_type: "text", source_chunk_id: "uuid", source_image_id: "uuid",
    page_start: "int", page_end: "int", heading_path: "texts", title: "text", content: "text", normalized_terms: "texts",
    source_span: "json", quality_score: "real", extraction_mode: "text", index_generation_id: "uuid", producer: "text",
    artifact_generation_id: "uuid", embedding: "vector", metadata: "json",
  },
};
const required: Record<Exclude<ShadowCoreFamilyV1, "pages">, readonly string[]> = {
  chunks: ["chunk_index", "content", "section_path", "token_estimate", "image_ids", "embedding"],
  images: ["storage_path", "mime_type", "caption", "image_type", "searchable", "clinical_relevance_score", "source_kind", "labels"],
  table_facts: ["normalized_terms"],
  embedding_fields: ["field_type", "content", "content_hash", "embedding"],
  index_units: ["unit_type", "heading_path", "title", "content", "normalized_terms", "quality_score", "extraction_mode", "embedding"],
};
// These are the composite-record defaults in shadow_core_row_matches_v1, not table INSERT defaults.
const defaults: Row = {
  metadata: {}, section_path: [], heading_path: [], image_ids: [], normalized_terms: [], token_estimate: 0,
  caption: "", mime_type: "image/png", image_type: "unclear", searchable: true, clinical_relevance_score: 0,
  source_kind: "embedded", quality_score: 0.7, extraction_mode: "deterministic",
};

function refuse(): never { throw new Error("shadow_core_row_unrepresentable"); }

/** Copy only JSON data without invoking getters, proxies or custom serialization. */
function json(value: unknown, ancestors = new Set<object>()): Json {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value.includes("\u0000") || !value.isWellFormed()) refuse();
    return value;
  }
  if (typeof value === "number") { if (!Number.isFinite(value)) refuse(); return value; }
  if (typeof value !== "object" || types.isProxy(value) || ancestors.has(value)) return refuse();
  ancestors.add(value);
  try {
    const array = Array.isArray(value);
    const prototype = Object.getPrototypeOf(value);
    if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) refuse();
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const key of Reflect.ownKeys(descriptors)) {
      if (typeof key !== "string" || !("value" in descriptors[key]!) || (!descriptors[key]!.enumerable && !(array && key === "length"))) refuse();
    }
    if (array) {
      if (Object.keys(descriptors).length !== value.length + 1) refuse();
      return Array.from({ length: value.length }, (_, index) => {
        const descriptor = descriptors[String(index)];
        if (!descriptor) return refuse();
        return json(descriptor.value, ancestors);
      });
    }
    const result: Row = Object.create(null) as Row;
    for (const key of Object.keys(descriptors)) {
      json(key, ancestors);
      result[key] = json(descriptors[key]!.value, ancestors);
    }
    return result;
  } finally { ancestors.delete(value); }
}
function row(value: Json): Row {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return refuse();
  return value;
}
function exactKeys(value: Row, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
function equal(a: Json, b: Json): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, index) => equal(item, b[index]!));
  }
  return exactKeys(b, Object.keys(a)) && Object.keys(a).every(key => equal(a[key]!, b[key]!));
}
function integer(value: Json): boolean {
  return typeof value === "number" && Number.isInteger(value) && value >= -2147483648 && value <= 2147483647;
}
function timestamp(value: Json | undefined): boolean {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}(?::?\d{2})?)$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthDays = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const zone = match[8]!.replace(":", "");
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= monthDays[month - 1]! &&
    Number(match[4]) <= 23 && Number(match[5]) <= 59 && Number(match[6]) <= 59 &&
    (zone === "Z" || (Number(zone.slice(1, 3)) <= 15 && Number(zone.slice(3) || "0") <= 59));
}
function float32(value: Json): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return refuse();
  const result = Math.fround(value);
  if (!Number.isFinite(result) || (result === 0 && value !== 0)) return refuse();
  // At a binary32 midpoint, JS binary64->binary32 and PostgreSQL's decimal->
  // binary32 parsing can choose different sides. Refuse that rare ambiguity.
  if (result !== value) {
    const bytes = new DataView(new ArrayBuffer(4));
    bytes.setFloat32(0, Math.abs(result));
    const bits = bytes.getUint32(0);
    bytes.setUint32(0, bits + (Math.abs(result) < Math.abs(value) ? 1 : -1));
    const neighbor = bytes.getFloat32(0);
    if (Math.abs(value) === (Math.abs(result) + neighbor) / 2) return refuse();
  }
  return result;
}
function vector(value: Json, stored: boolean): number[] {
  if (stored) {
    if (typeof value !== "string") return refuse();
    value = json(JSON.parse(value) as unknown);
  }
  if (!Array.isArray(value) || value.length !== 1536) return refuse();
  return value.map(float32);
}
function typed(value: Json, kind: Kind, stored = false): Json {
  if (value === null) return null;
  switch (kind) {
    case "json": return value;
    case "text": if (typeof value === "string") return value; break;
    case "uuid":
      if (typeof value === "string" && uuid.test(value) && (!stored || value === value.toLowerCase())) return value.toLowerCase();
      break;
    case "int": if (integer(value)) return value; break;
    case "bool": if (typeof value === "boolean") return value; break;
    case "real": return float32(value);
    case "vector": return vector(value, stored);
    case "texts": case "uuids":
      if (Array.isArray(value)) return value.map(item => {
        if (typeof item !== "string") return refuse();
        return typed(item, kind === "texts" ? "text" : "uuid", stored);
      });
  }
  return refuse();
}
function stamps(binding: ShadowCoreMemberBindingV1): Row {
  return { index_generation_id: binding.candidateGenerationId, ingestion_job_kind: "node",
    ingestion_job_id: binding.jobId, ingestion_lease_token: binding.firstLeaseToken };
}

/**
 * Validates the retained private bytes and their exact attachment to an image
 * after-image. The caller separately admits the binding/ref inventory identity,
 * proves a unique selected image row, and runs matchesShadowCoreStoredRowV1 for
 * the complete native after-image. This predicate performs no storage access.
 */
export function matchesShadowPrivateObjectAttachmentV1(
  validatedBinding: ShadowCoreMemberBindingV1,
  plannedPrivateObject: unknown,
  fullStoredImageRow: unknown,
): boolean {
  try {
    const binding = row(json(validatedBinding));
    if (!exactKeys(binding, ["documentId", "ownerId", "candidateGenerationId", "jobId", "firstLeaseToken"]) ||
      Object.entries(binding).some(([key, value]) => key === "ownerId" && value === null ? false :
        typeof value !== "string" || !uuid.test(value) || value !== value.toLowerCase())) return false;

    const planned = row(json(plannedPrivateObject));
    if (!exactKeys(planned, ["tag", "ref", "bytes"]) || planned.tag !== "private_object") return false;
    const ref = row(planned.ref!), bytes = row(planned.bytes!);
    if (!exactKeys(ref, ["tag", "bucket", "objectPath", "objectVersion", "sha256", "byteLength", "mediaType"]) ||
      ref.tag !== "private_object" || typeof ref.bucket !== "string" || ref.bucket.length === 0 ||
      typeof ref.objectPath !== "string" || ref.objectPath.length === 0 ||
      !(ref.objectVersion === null || typeof ref.objectVersion === "string" && ref.objectVersion.length > 0) ||
      typeof ref.sha256 !== "string" || !/^sha256:[0-9a-f]{64}$/.test(ref.sha256) ||
      typeof ref.byteLength !== "number" || !Number.isSafeInteger(ref.byteLength) || ref.byteLength < 0 ||
      typeof ref.mediaType !== "string" || ref.mediaType.length === 0 ||
      !exactKeys(bytes, ["encoding", "content"]) || bytes.encoding !== "base64" || typeof bytes.content !== "string") return false;

    const decoded = Buffer.from(bytes.content, "base64");
    if (decoded.toString("base64") !== bytes.content || decoded.length !== ref.byteLength ||
      `sha256:${createHash("sha256").update(decoded).digest("hex")}` !== ref.sha256) return false;

    const stored = row(json(fullStoredImageRow));
    const metadata = row(stored.metadata!);
    return stored.document_id === binding.documentId && stored.index_generation_id === binding.candidateGenerationId &&
      stored.storage_path === ref.objectPath && stored.mime_type === ref.mediaType &&
      typeof stored.image_hash === "string" && /^[0-9a-f]{64}$/.test(stored.image_hash) &&
      ref.sha256 === `sha256:${stored.image_hash}` && metadata.index_generation_id === binding.candidateGenerationId &&
      metadata.ingestion_job_kind === "node" && metadata.ingestion_job_id === binding.jobId &&
      metadata.ingestion_lease_token === binding.firstLeaseToken && metadata.extractor === "local-worker" &&
      metadata.image_hash === stored.image_hash;
  } catch { return false; }
}
function pages(binding: ShadowCoreMemberBindingV1, output: Row, stored: Row): boolean {
  if (!exactKeys(output, ["input", "extractedPage"])) return false;
  const input = row(output.input!), native = row(output.extractedPage!);
  if (!exactKeys(input, ["document_id", "page_number", "text", "ocr_used", "metadata"]) ||
    !Object.hasOwn(native, "pageNumber") || !Object.hasOwn(native, "text") ||
    Object.keys(native).some(key => !["pageNumber", "text", "ocrUsed", "needsOcr"].includes(key)) ||
    input.document_id !== binding.documentId || !integer(input.page_number!) || Number(input.page_number) <= 0 ||
    native.pageNumber !== input.page_number || typeof native.text !== "string" || typeof input.text !== "string" ||
    input.text !== native.text.replace(/\\u0000/g, "") || typeof input.ocr_used !== "boolean" ||
    input.ocr_used !== (native.ocrUsed ?? false) ||
    ["ocrUsed", "needsOcr"].some(key => Object.hasOwn(native, key) && typeof native[key] !== "boolean")) return false;
  if (!exactKeys(stored, ["id", "document_id", "index_generation_id", "page_number", "text", "ocr_used", "metadata", "created_at"]) ||
    typeof stored.id !== "string" || !uuid.test(stored.id) || !timestamp(stored.created_at)) return false;
  const expected = { ...input, index_generation_id: binding.candidateGenerationId,
    metadata: { ...row(input.metadata!), ...stamps(binding) } };
  const { id: _id, created_at: _created, ...actual } = stored;
  return equal(expected, actual);
}

/**
 * Compares an actual core writer input with its complete database after-image.
 * For non-pages, the caller MUST first validate the original capture with
 * readShadowProducerInputV1 and pass its `.input` as validatedProducerRpcInput.
 * For pages, pass the complete original { input, extractedPage } output.
 * The caller retains/admit-checks the original envelope separately. This predicate
 * grants no source, lease, receipt or terminal authority, and does not verify generated
 * timestamps/TSV derivation; their captured identities require independent evidence.
 * An optional anchor repair MUST originate from validateShadowCandidateDeepProjectionV1's
 * validated exact request for this member, including its source/owner/attempt bindings.
 * The descriptor alone cannot establish those bindings or authorize a repair.
 * PostgreSQL string-to-scalar/array coercions, non-JSON values, ambiguous binary32
 * midpoints and underflow remain deliberately unsupported.
 */
export function matchesShadowCoreStoredRowV1(
  family: ShadowCoreFamilyV1,
  validatedBinding: ShadowCoreMemberBindingV1,
  validatedProducerRpcInput: unknown,
  fullStoredRow: unknown,
  admittedAnchorRepair?: ShadowCoreAnchorRepairV1,
): boolean {
  try {
    const binding = row(json(validatedBinding));
    if (!exactKeys(binding, ["documentId", "ownerId", "candidateGenerationId", "jobId", "firstLeaseToken"]) ||
      Object.entries(binding).some(([key, value]) => key === "ownerId" && value === null ? false : typeof value !== "string" || !uuid.test(value) || value !== value.toLowerCase())) return false;
    const input = row(json(validatedProducerRpcInput)), stored = row(json(fullStoredRow));
    const repair = admittedAnchorRepair === undefined ? null : row(json(admittedAnchorRepair));
    if (repair !== null && (family !== "chunks" || !exactKeys(repair, ["chunkId", "anchorId", "documentIntelligenceVersion"]) ||
      repair.chunkId !== stored.id || typeof repair.anchorId !== "string" || repair.anchorId !== stored.anchor_id ||
      repair.documentIntelligenceVersion !== "document-intelligence-v2")) return false;
    if (family === "pages") return pages(validatedBinding, input, stored);
    if (!Object.hasOwn(columns, family)) return false;
    const schema = columns[family];
    if (Object.keys(input).some(key => !Object.hasOwn(schema, key)) || typeof input.id !== "string" ||
      !uuid.test(input.id) || input.id !== stored.id || input.document_id !== binding.documentId) return false;
    const metadata = row(Object.hasOwn(input, "metadata") ? input.metadata! : {});
    const generated = ["created_at", ...(family === "images" ? [] : ["search_tsv"]), ...(family === "index_units" ? ["updated_at"] : [])];
    if (!exactKeys(stored, [...Object.keys(schema), ...generated]) || !timestamp(stored.created_at) ||
      (family === "index_units" && !timestamp(stored.updated_at)) ||
      (family !== "images" && stored.search_tsv !== null && typeof stored.search_tsv !== "string")) return false;
    const expected: Row = { ...defaults, ...input, index_generation_id: binding.candidateGenerationId!,
      metadata: { ...metadata, ...stamps(validatedBinding) } };
    if (["table_facts", "embedding_fields", "index_units"].includes(family)) expected.owner_id = binding.ownerId!;
    if (family === "index_units") { expected.producer = "local-worker"; expected.artifact_generation_id = null; }
    if (required[family].some(key => !Object.hasOwn(expected, key) || expected[key] === null)) return false;
    // Inspect even overwritten fields: unsupported native types cannot disappear behind stamps.
    for (const [key, value] of Object.entries(input)) typed(value, schema[key]!);
    if (repair !== null && Object.hasOwn(expected, "anchor_id") && expected.anchor_id !== null) return false;
    const afterImage: Row = repair === null ? expected : { ...expected, anchor_id: repair.anchorId!,
      metadata: { ...row(expected.metadata!), anchor_id: repair.anchorId!, anchor_repaired_by: repair.documentIntelligenceVersion! } };
    return Object.entries(schema).every(([key, kind]) => equal(
      typed(Object.hasOwn(afterImage, key) ? afterImage[key]! : null, kind), typed(stored[key]!, kind, true),
    ));
  } catch { return false; }
}
