import { createHash, randomUUID } from "node:crypto";

import type { SourceLicencePolicy } from "@/lib/australian-source-catalogue";
import type { ClinicalSourceRole } from "@/lib/types";
import { MAX_UPLOAD_MB_CEILING } from "@/lib/upload-limits";

export const trustedDocumentAdmissionPolicyVersion = "trusted-document-admission-v1" as const;
export const trustedAdministratorRecentAuthenticationSeconds = 900;

const allowedMimeTypes = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
]);
const allowedSourceRoles = new Set<Exclude<ClinicalSourceRole, "reference_link">>([
  "local_guideline",
  "clinical_guideline",
  "clinical_reference",
  "service_directory",
  "form_reference",
  "tool_reference",
  "safety_alert",
  "regulatory",
  "quality_standard",
  "legal",
  "subsidy",
  "professional_review",
  "service_policy",
]);
const allowedLicencePolicies = new Set<SourceLicencePolicy>([
  "review_required",
  "public_index_permitted",
  "metadata_link_only",
  "index_forbidden",
]);
const supportedFeatureOrder = ["images", "tables", "text"] as const;
const supportedFeatures = new Set<string>(supportedFeatureOrder);
const qualifyingAuthenticationMethods = new Set(["password", "otp", "totp", "webauthn"]);
const definitiveAdmissionRefusals = [
  "administrator_assurance_required",
  "administrator_recent_authentication_required",
  "trusted_backend_authority_required",
  "trusted_backend_staging_owner_mismatch",
  "admission_replay_conflict",
  "duplicate_content",
  "document_identity_conflict",
  "invalid_trusted_document_admission",
  "invalid_trusted_document_admission_keys",
  "invalid_trusted_document_input_keys",
  "invalid_trusted_document_storage_path",
  "invalid_trusted_document_uuid",
  "invalid_trusted_document_identity",
  "invalid_administrator_admission_scope",
  "invalid_backend_admission_scope",
  "invalid_trusted_document_actor",
  "invalid_trusted_document_input",
  "invalid_trusted_document_source_path",
  "invalid_trusted_document_max_attempts",
  "invalid_trusted_document_authority",
  "invalid_trusted_document_authority_keys",
  "invalid_trusted_document_authority_binding",
  "invalid_trusted_document_authority_date",
  "invalid_trusted_document_supersedes_id",
] as const;

const canonicalUuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const bareSha256Pattern = /^[0-9a-f]{64}$/;
const prefixedSha256Pattern = /^sha256:[0-9a-f]{64}$/;
const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

export type TrustedAdmissionActor =
  | Readonly<{ kind: "administrator"; administratorId: string }>
  | Readonly<{ kind: "trusted_backend"; principal: string }>;

export type TrustedAdmissionSourceRole = Exclude<ClinicalSourceRole, "reference_link">;
export type TrustedAdmissionSupportedFeature = (typeof supportedFeatureOrder)[number];

export type TrustedAdmissionAuthority = Readonly<{
  version: 1;
  sourceRole: TrustedAdmissionSourceRole;
  authorityBasis: "administrator_template" | "backend_manifest";
  licencePolicy: SourceLicencePolicy;
  rightsEvidenceRef: string;
  publisher: string;
  jurisdiction: "Australia";
  publicationDate: string | null;
  effectiveDate: string | null;
  reviewDate: string | null;
  expiryDate: string | null;
  currentness: "current" | "unknown" | "superseded" | "withdrawn";
  supersedesDocumentId: string | null;
  purpose: "clinical_retrieval";
  supportedFeatures: readonly TrustedAdmissionSupportedFeature[];
  providerProcessing: "permitted" | "forbidden";
}>;
export type TrustedAdmissionInput = Readonly<{
  actor: TrustedAdmissionActor;
  sourceChannel: "admin_api" | "backend_import";
  documentId: string;
  stagingOwnerId: string;
  contentSha256: `sha256:${string}`;
  storagePath: string;
  originalFileName: string;
  mimeType: string;
  byteCount: number;
  correlationId: string;
  admissionPolicyVersion: typeof trustedDocumentAdmissionPolicyVersion;
  authority: TrustedAdmissionAuthority;
}>;

export type TrustedDocumentAdmission = Readonly<{
  actor: TrustedAdmissionActor;
  documentId: string;
  stagingOwnerId: string;
  sourceChannel: "admin_api" | "backend_import";
  contentSha256: `sha256:${string}`;
  fileNameSha256: `sha256:${string}`;
  storagePathSha256: `sha256:${string}`;
  mimeType: string;
  byteCount: number;
  correlationId: string;
  admissionPolicyVersion: typeof trustedDocumentAdmissionPolicyVersion;
  authority: TrustedAdmissionAuthority;
}>;

export type TrustedAdmissionRpcPayload = Readonly<{
  document_id: string;
  staging_owner_id: string;
  source_channel: "admin_api" | "backend_import";
  content_sha256: `sha256:${string}`;
  file_name_sha256: `sha256:${string}`;
  storage_path_sha256: `sha256:${string}`;
  mime_type: string;
  byte_count: number;
  correlation_id: string;
  admission_policy_version: typeof trustedDocumentAdmissionPolicyVersion;
  authority: TrustedAdmissionAuthority;
}>;

export type TrustedAdmissionDocumentInput = Readonly<{
  id: string;
  owner_id: string;
  title: string;
  description: string | null;
  file_name: string;
  file_type: string;
  file_size: number;
  storage_path: string;
  content_hash: string;
  metadata: Readonly<Record<string, unknown>>;
  max_attempts: number;
  source_path?: string | null;
  import_batch_id?: string | null;
}>;

export type TrustedAdmissionResponseRow = Readonly<Record<string, unknown>>;
export type TrustedAdmissionDispatchResult =
  | Readonly<{ outcome: "not_found" }>
  | Readonly<{
      outcome: "created" | "replayed";
      admission_event_id: string;
      document: TrustedAdmissionResponseRow & Readonly<{ id: string; owner_id: string; content_hash: string }>;
      job: TrustedAdmissionResponseRow & Readonly<{ id: string; document_id: string; status: string }>;
    }>;

export type TrustedAdmissionRpcClient = Readonly<{
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: null | Readonly<{ message?: unknown; code?: unknown }> }>;
}>;

export class TrustedDocumentAdmissionDispatchError extends Error {
  readonly kind: "rejected" | "outcome_unknown";

  constructor(kind: "rejected" | "outcome_unknown", message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "TrustedDocumentAdmissionDispatchError";
    this.kind = kind;
  }
}

export class TrustedDocumentStorageUploadError extends Error {
  readonly kind: "collision_mismatch" | "outcome_unknown";
  readonly storagePath: string | null;

  constructor(kind: "collision_mismatch" | "outcome_unknown", message: string, storagePath: string | null) {
    super(message);
    this.name = "TrustedDocumentStorageUploadError";
    this.kind = kind;
    this.storagePath = storagePath;
  }
}

type TrustedDocumentStorageError = Readonly<{
  message?: unknown;
  status?: unknown;
  statusCode?: unknown;
  code?: unknown;
}>;

export type TrustedDocumentStorageClient = Readonly<{
  upload(
    path: string,
    body: Uint8Array,
    options: Readonly<{ contentType: string; upsert: false }>,
  ): PromiseLike<{ data: unknown; error: TrustedDocumentStorageError | null }>;
  download(path: string): PromiseLike<{ data: Blob | null; error: TrustedDocumentStorageError | null }>;
}>;

function documentStoragePrefix(ownerId: string, documentId: string) {
  return `${canonicalUuid(ownerId, "storage ownerId")}/documents/${canonicalUuid(documentId, "storage documentId")}/`;
}

export function assertTrustedDocumentStoragePath(ownerId: string, documentId: string, storagePath: string) {
  const path = boundedString(storagePath, "storagePath", 1_024);
  if (!path.startsWith(documentStoragePrefix(ownerId, documentId)) || path.includes("\\")) {
    throw new Error("Trusted document storage path is outside its owner/document scope.");
  }
  const relative = path.slice(documentStoragePrefix(ownerId, documentId).length);
  if (
    !relative ||
    relative.startsWith("/") ||
    relative.split("/").some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error("Trusted document storage path is not canonical.");
  }
  return path;
}

function isConfirmedExistingObjectError(error: TrustedDocumentStorageError | null) {
  if (!error || Number(error.status) !== 409) return false;
  return error.code === "ResourceAlreadyExists" || error.statusCode === "409";
}

function contentDigest(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function uploadTrustedDocumentBytes(
  args: Readonly<{
    storage: TrustedDocumentStorageClient;
    ownerId: string;
    documentId: string;
    intendedStoragePath: string;
    bytes: Uint8Array;
    byteCount: number;
    contentSha256: string;
    contentType: string;
    createRecoveryId?: () => string;
  }>,
) {
  const intendedStoragePath = assertTrustedDocumentStoragePath(args.ownerId, args.documentId, args.intendedStoragePath);
  if (
    !Number.isSafeInteger(args.byteCount) ||
    args.byteCount < 1 ||
    args.bytes.byteLength !== args.byteCount ||
    !bareSha256Pattern.test(args.contentSha256) ||
    contentDigest(args.bytes) !== args.contentSha256
  ) {
    throw new TrustedDocumentStorageUploadError(
      "collision_mismatch",
      "Current document bytes do not match the validated content digest.",
      null,
    );
  }

  let initial: Awaited<ReturnType<TrustedDocumentStorageClient["upload"]>>;
  try {
    initial = await args.storage.upload(intendedStoragePath, args.bytes, {
      contentType: args.contentType,
      upsert: false,
    });
  } catch {
    throw new TrustedDocumentStorageUploadError(
      "outcome_unknown",
      "Document Storage upload outcome is unknown; retain the attempted path for reconciliation.",
      intendedStoragePath,
    );
  }
  if (!initial.error) return Object.freeze({ storagePath: intendedStoragePath, collisionRecovered: false });
  if (!isConfirmedExistingObjectError(initial.error)) {
    throw new TrustedDocumentStorageUploadError(
      "outcome_unknown",
      "Document Storage upload outcome is unknown; retain the attempted path for reconciliation.",
      intendedStoragePath,
    );
  }

  let existing: Awaited<ReturnType<TrustedDocumentStorageClient["download"]>>;
  try {
    existing = await args.storage.download(intendedStoragePath);
  } catch {
    throw new TrustedDocumentStorageUploadError(
      "collision_mismatch",
      "Existing document Storage bytes could not be verified.",
      null,
    );
  }
  if (existing.error || !existing.data) {
    throw new TrustedDocumentStorageUploadError(
      "collision_mismatch",
      "Existing document Storage bytes could not be verified.",
      null,
    );
  }
  const existingBytes = new Uint8Array(await existing.data.arrayBuffer());
  if (existingBytes.byteLength !== args.bytes.byteLength || contentDigest(existingBytes) !== args.contentSha256) {
    throw new TrustedDocumentStorageUploadError(
      "collision_mismatch",
      "Existing document Storage bytes do not match this admission request.",
      null,
    );
  }

  const originalName = intendedStoragePath.slice(intendedStoragePath.lastIndexOf("/") + 1);
  const recoveryId = canonicalUuid((args.createRecoveryId ?? randomUUID)(), "recovery storage UUID");
  const recoveryPath = assertTrustedDocumentStoragePath(
    args.ownerId,
    args.documentId,
    `${documentStoragePrefix(args.ownerId, args.documentId)}recovery-${recoveryId}-${originalName}`,
  );
  let recovery: Awaited<ReturnType<TrustedDocumentStorageClient["upload"]>>;
  try {
    recovery = await args.storage.upload(recoveryPath, args.bytes, {
      contentType: args.contentType,
      upsert: false,
    });
  } catch {
    throw new TrustedDocumentStorageUploadError(
      "outcome_unknown",
      "Recovery document Storage upload outcome is unknown; retain the attempted path for reconciliation.",
      recoveryPath,
    );
  }
  if (recovery.error) {
    throw new TrustedDocumentStorageUploadError(
      "outcome_unknown",
      "Recovery document Storage upload outcome is unknown; retain the attempted path for reconciliation.",
      recoveryPath,
    );
  }
  return Object.freeze({ storagePath: recoveryPath, collisionRecovered: true });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertExactKeys(record: Record<string, unknown>, expected: readonly string[], label: string) {
  const actual = Object.keys(record).toSorted();
  const canonical = [...expected].toSorted();
  if (actual.length !== canonical.length || actual.some((key, index) => key !== canonical[index])) {
    throw new Error(`${label} must contain only the versioned contract keys.`);
  }
}

function canonicalUuid(value: unknown, label: string): string {
  if (typeof value !== "string" || !canonicalUuidPattern.test(value)) {
    throw new Error(`${label} must be a canonical lower-case UUID.`);
  }
  return value;
}

function boundedString(value: unknown, label: string, maximumLength: number): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximumLength ||
    value !== value.trim() ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new Error(`${label} must be a nonempty canonical string of at most ${maximumLength} characters.`);
  }
  return value;
}

function explicitNullableIsoDate(value: unknown, label: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !isoDatePattern.test(value)) {
    throw new Error(`${label} must be an ISO date or null.`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`${label} must be a real ISO calendar date.`);
  }
  return value;
}

function prefixedSha256(value: unknown, label: string): `sha256:${string}` {
  if (typeof value !== "string" || !prefixedSha256Pattern.test(value)) {
    throw new Error(`${label} must be a lower-case prefixed SHA-256 digest.`);
  }
  return value as `sha256:${string}`;
}

function auditSha256(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function parseAuthority(
  value: unknown,
  sourceChannel: TrustedAdmissionInput["sourceChannel"],
): TrustedAdmissionAuthority {
  if (!isRecord(value)) throw new Error("Trusted admission authority must be an object.");
  assertExactKeys(
    value,
    [
      "version",
      "sourceRole",
      "authorityBasis",
      "licencePolicy",
      "rightsEvidenceRef",
      "publisher",
      "jurisdiction",
      "publicationDate",
      "effectiveDate",
      "reviewDate",
      "expiryDate",
      "currentness",
      "supersedesDocumentId",
      "purpose",
      "supportedFeatures",
      "providerProcessing",
    ],
    "Trusted admission authority",
  );
  if (value.version !== 1) throw new Error("Trusted admission authority version must be 1.");
  if (!allowedSourceRoles.has(value.sourceRole as TrustedAdmissionSourceRole)) {
    throw new Error("Trusted admission sourceRole is not eligible for content-bearing admission.");
  }
  const expectedBasis = sourceChannel === "admin_api" ? "administrator_template" : "backend_manifest";
  if (value.authorityBasis !== expectedBasis) {
    throw new Error(`Trusted admission authorityBasis must be ${expectedBasis} for ${sourceChannel}.`);
  }
  if (!allowedLicencePolicies.has(value.licencePolicy as SourceLicencePolicy)) {
    throw new Error("Trusted admission licencePolicy is invalid.");
  }
  if (value.licencePolicy === "index_forbidden" || value.licencePolicy === "metadata_link_only") {
    throw new Error("Trusted admission requires a content-indexable licence policy.");
  }
  if (value.jurisdiction !== "Australia") throw new Error("Trusted admission jurisdiction must be Australia.");
  if (!new Set(["current", "unknown", "superseded", "withdrawn"]).has(String(value.currentness))) {
    throw new Error("Trusted admission currentness is invalid.");
  }
  if (value.currentness === "withdrawn" || value.currentness === "superseded") {
    throw new Error(`A ${String(value.currentness)} document cannot enter the new admission queue.`);
  }
  if (value.purpose !== "clinical_retrieval") {
    throw new Error("Trusted admission purpose must be clinical_retrieval.");
  }
  if (!new Set(["permitted", "forbidden"]).has(String(value.providerProcessing))) {
    throw new Error("Trusted admission providerProcessing is invalid.");
  }
  if (!Array.isArray(value.supportedFeatures) || value.supportedFeatures.length < 1) {
    throw new Error("Trusted admission supportedFeatures must be a nonempty array.");
  }
  const featureList = value.supportedFeatures as unknown[];
  if (!featureList.every((feature) => typeof feature === "string" && supportedFeatures.has(feature))) {
    throw new Error("Trusted admission supportedFeatures contains an unsupported feature.");
  }
  if (new Set(featureList).size !== featureList.length) {
    throw new Error("Trusted admission supportedFeatures must be unique.");
  }
  if (featureList.join("\n") !== [...featureList].sort().join("\n")) {
    throw new Error("Trusted admission supportedFeatures must use canonical sorted order.");
  }

  return Object.freeze({
    version: 1,
    sourceRole: value.sourceRole as TrustedAdmissionSourceRole,
    authorityBasis: expectedBasis,
    licencePolicy: value.licencePolicy as SourceLicencePolicy,
    rightsEvidenceRef: boundedString(value.rightsEvidenceRef, "rightsEvidenceRef", 500),
    publisher: boundedString(value.publisher, "publisher", 300),
    jurisdiction: "Australia",
    publicationDate: explicitNullableIsoDate(value.publicationDate, "publicationDate"),
    effectiveDate: explicitNullableIsoDate(value.effectiveDate, "effectiveDate"),
    reviewDate: explicitNullableIsoDate(value.reviewDate, "reviewDate"),
    expiryDate: explicitNullableIsoDate(value.expiryDate, "expiryDate"),
    currentness: value.currentness as TrustedAdmissionAuthority["currentness"],
    supersedesDocumentId:
      value.supersedesDocumentId === null ? null : canonicalUuid(value.supersedesDocumentId, "supersedesDocumentId"),
    purpose: "clinical_retrieval",
    supportedFeatures: Object.freeze([...featureList]) as readonly TrustedAdmissionSupportedFeature[],
    providerProcessing: value.providerProcessing as TrustedAdmissionAuthority["providerProcessing"],
  });
}

function parseActor(value: unknown, sourceChannel: TrustedAdmissionInput["sourceChannel"], ownerId: string) {
  if (!isRecord(value)) throw new Error("Trusted admission actor must be an object.");
  if (sourceChannel === "admin_api") {
    assertExactKeys(value, ["kind", "administratorId"], "Administrator actor");
    if (value.kind !== "administrator") throw new Error("admin_api requires an administrator actor.");
    const administratorId = canonicalUuid(value.administratorId, "administratorId");
    if (administratorId !== ownerId) throw new Error("Administrator admission staging owner must match the actor.");
    return Object.freeze({ kind: "administrator", administratorId }) as TrustedAdmissionActor;
  }
  assertExactKeys(value, ["kind", "principal"], "Trusted backend actor");
  if (value.kind !== "trusted_backend") throw new Error("backend_import requires a trusted_backend actor.");
  return Object.freeze({
    kind: "trusted_backend",
    principal: boundedString(value.principal, "trusted backend principal", 200),
  }) as TrustedAdmissionActor;
}

export function createTrustedDocumentAdmission(input: TrustedAdmissionInput): TrustedDocumentAdmission {
  if (!isRecord(input)) throw new Error("Trusted admission input must be an object.");
  assertExactKeys(
    input,
    [
      "actor",
      "sourceChannel",
      "documentId",
      "stagingOwnerId",
      "contentSha256",
      "storagePath",
      "originalFileName",
      "mimeType",
      "byteCount",
      "correlationId",
      "admissionPolicyVersion",
      "authority",
    ],
    "Trusted admission input",
  );
  if (input.sourceChannel !== "admin_api" && input.sourceChannel !== "backend_import") {
    throw new Error("Trusted admission sourceChannel is invalid.");
  }
  const documentId = canonicalUuid(input.documentId, "documentId");
  const stagingOwnerId = canonicalUuid(input.stagingOwnerId, "stagingOwnerId");
  const correlationId = canonicalUuid(input.correlationId, "correlationId");
  if (input.admissionPolicyVersion !== trustedDocumentAdmissionPolicyVersion) {
    throw new Error(`Trusted admission policy must be ${trustedDocumentAdmissionPolicyVersion}.`);
  }
  if (!allowedMimeTypes.has(input.mimeType)) throw new Error("Trusted admission MIME type is unsupported.");
  const maximumBytes = MAX_UPLOAD_MB_CEILING * 1024 * 1024;
  if (!Number.isSafeInteger(input.byteCount) || input.byteCount < 1 || input.byteCount > maximumBytes) {
    throw new Error(`Trusted admission byteCount must be between 1 and ${maximumBytes}.`);
  }
  const originalFileName = boundedString(input.originalFileName, "originalFileName", 255);
  const storagePath = boundedString(input.storagePath, "storagePath", 1_024);
  const actor = parseActor(input.actor, input.sourceChannel, stagingOwnerId);
  const authority = parseAuthority(input.authority, input.sourceChannel);
  if (authority.supersedesDocumentId === documentId) {
    throw new Error("Trusted admission cannot supersede its own document.");
  }

  return Object.freeze({
    actor,
    documentId,
    stagingOwnerId,
    sourceChannel: input.sourceChannel,
    contentSha256: prefixedSha256(input.contentSha256, "contentSha256"),
    fileNameSha256: auditSha256(originalFileName),
    storagePathSha256: auditSha256(storagePath),
    mimeType: input.mimeType,
    byteCount: input.byteCount,
    correlationId,
    admissionPolicyVersion: trustedDocumentAdmissionPolicyVersion,
    authority,
  });
}

export function toTrustedDocumentAdmissionRpcPayload(admission: TrustedDocumentAdmission): TrustedAdmissionRpcPayload {
  return Object.freeze({
    document_id: admission.documentId,
    staging_owner_id: admission.stagingOwnerId,
    source_channel: admission.sourceChannel,
    content_sha256: admission.contentSha256,
    file_name_sha256: admission.fileNameSha256,
    storage_path_sha256: admission.storagePathSha256,
    mime_type: admission.mimeType,
    byte_count: admission.byteCount,
    correlation_id: admission.correlationId,
    admission_policy_version: admission.admissionPolicyVersion,
    authority: admission.authority,
  });
}

export function assertTrustedAdministratorAssurance(
  claims: unknown,
  administratorId: string,
  nowMs = Date.now(),
): asserts claims is Readonly<Record<string, unknown>> {
  const canonicalAdministratorId = canonicalUuid(administratorId, "administratorId");
  if (!Number.isFinite(nowMs) || nowMs < 0) throw new Error("Trusted assurance time must be finite.");
  if (!isRecord(claims)) throw new Error("administrator_assurance_required");
  if (
    claims.sub !== canonicalAdministratorId ||
    claims.role !== "authenticated" ||
    claims.aal !== "aal2" ||
    !isRecord(claims.app_metadata) ||
    claims.app_metadata.site_role !== "administrator"
  ) {
    throw new Error("administrator_assurance_required");
  }
  if (!Array.isArray(claims.amr)) throw new Error("administrator_recent_authentication_required");
  const nowSeconds = nowMs / 1_000;
  const recent = claims.amr.some(
    (entry) =>
      isRecord(entry) &&
      typeof entry.method === "string" &&
      qualifyingAuthenticationMethods.has(entry.method) &&
      Number.isSafeInteger(entry.timestamp) &&
      Number(entry.timestamp) <= nowSeconds &&
      Number(entry.timestamp) >= nowSeconds - trustedAdministratorRecentAuthenticationSeconds,
  );
  if (!recent) throw new Error("administrator_recent_authentication_required");
}

export function trustedAdmissionDocumentId(actorKey: string, correlationId: string): string {
  const actor = boundedString(actorKey, "actorKey", 256);
  const correlation = canonicalUuid(correlationId, "correlationId");
  const bytes = createHash("sha256")
    .update("trusted-document-admission-document-id-v1\u0000", "utf8")
    .update(actor, "utf8")
    .update("\u0000", "utf8")
    .update(correlation, "utf8")
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new Error("Trusted admission metadata must be JSON-compatible.");
    return encoded;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Trusted admission metadata must contain finite JSON values.");
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new Error("Trusted admission metadata must be JSON-compatible.");
    return encoded;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .toSorted()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  throw new Error("Trusted admission metadata must be JSON-compatible.");
}

function validateDocument(admission: TrustedDocumentAdmission, document: TrustedAdmissionDocumentInput) {
  if (!isRecord(document)) throw new Error("Trusted admission document must be an object.");
  const allowedKeys = [
    "id",
    "owner_id",
    "title",
    "description",
    "file_name",
    "file_type",
    "file_size",
    "storage_path",
    "content_hash",
    "metadata",
    "max_attempts",
    "source_path",
    "import_batch_id",
  ];
  if (Object.keys(document).some((key) => !allowedKeys.includes(key))) {
    throw new Error("Trusted admission document contains an unknown private input key.");
  }
  if (canonicalUuid(document.id, "document.id") !== admission.documentId) {
    throw new Error("Trusted admission document identity does not match admission.");
  }
  if (canonicalUuid(document.owner_id, "document.owner_id") !== admission.stagingOwnerId) {
    throw new Error("Trusted admission document owner does not match admission.");
  }
  boundedString(document.title, "document.title", 180);
  if (document.description !== null) boundedString(document.description, "document.description", 1_000);
  const fileName = boundedString(document.file_name, "document.file_name", 255);
  const storagePath = boundedString(document.storage_path, "document.storage_path", 1_024);
  if (auditSha256(fileName) !== admission.fileNameSha256 || auditSha256(storagePath) !== admission.storagePathSha256) {
    throw new Error("Trusted admission private file identity does not match its audit digest.");
  }
  if (document.file_type !== admission.mimeType || document.file_size !== admission.byteCount) {
    throw new Error("Trusted admission private file type or size does not match admission.");
  }
  if (typeof document.content_hash !== "string" || !bareSha256Pattern.test(document.content_hash)) {
    throw new Error("Trusted admission document content_hash must be lower-case bare SHA-256.");
  }
  if (`sha256:${document.content_hash}` !== admission.contentSha256) {
    throw new Error("Trusted admission document content hash does not match admission.");
  }
  if (!Number.isSafeInteger(document.max_attempts) || document.max_attempts < 1 || document.max_attempts > 100) {
    throw new Error("Trusted admission max_attempts must be an integer from 1 to 100.");
  }
  if (document.source_path !== undefined && document.source_path !== null) {
    boundedString(document.source_path, "document.source_path", 4_096);
  }
  if (document.import_batch_id !== undefined && document.import_batch_id !== null) {
    canonicalUuid(document.import_batch_id, "document.import_batch_id");
  }
  if (!isRecord(document.metadata)) throw new Error("Trusted admission document metadata must be an object.");
  if (document.metadata.corpus_scope !== "uploaded_local" || document.metadata.content_mode !== "indexed_content") {
    throw new Error("Trusted admission document must explicitly retain uploaded_local indexed_content intent.");
  }
  if (canonicalJson(document.metadata.authority) !== canonicalJson(admission.authority)) {
    throw new Error("Trusted admission document authority does not match admission.");
  }
  // Early compact-JSON bound; SQL also enforces its authoritative JSONB text
  // byte limit (including its formatting) and may reject near-boundary inputs.
  if (Buffer.byteLength(canonicalJson(document.metadata), "utf8") > 65_536) {
    throw new Error("Trusted admission document metadata exceeds the bounded JSON limit.");
  }
}

function definitiveAdmissionRefusal(error: unknown): string | undefined {
  if (!isRecord(error)) return undefined;
  return definitiveAdmissionRefusals.find((marker) => error.message === marker);
}

function parseDispatchResult(
  value: unknown,
  admission: TrustedDocumentAdmission,
  replayOnly: boolean,
): TrustedAdmissionDispatchResult {
  if (!isRecord(value) || typeof value.outcome !== "string") {
    throw new Error("Trusted document admission RPC returned a malformed response.");
  }
  if (value.outcome === "not_found") {
    if (!replayOnly) throw new Error("Trusted document admission unexpectedly returned not_found.");
    return Object.freeze({ outcome: "not_found" });
  }
  if (value.outcome !== "created" && value.outcome !== "replayed") {
    throw new Error("Trusted document admission RPC returned an unsupported outcome.");
  }
  if (replayOnly && value.outcome === "created") {
    throw new Error("Replay-only trusted admission unexpectedly created state.");
  }
  const admissionEventId = canonicalUuid(value.admission_event_id, "admission_event_id");
  if (!isRecord(value.document) || !isRecord(value.job)) {
    throw new Error("Trusted document admission RPC omitted document or job rows.");
  }
  const documentId = canonicalUuid(value.document.id, "response document.id");
  const ownerId = canonicalUuid(value.document.owner_id, "response document.owner_id");
  const jobId = canonicalUuid(value.job.id, "response job.id");
  const jobDocumentId = canonicalUuid(value.job.document_id, "response job.document_id");
  if (
    documentId !== admission.documentId ||
    ownerId !== admission.stagingOwnerId ||
    jobDocumentId !== admission.documentId ||
    value.document.content_hash !== admission.contentSha256.slice("sha256:".length)
  ) {
    throw new Error("Trusted document admission RPC returned mismatched identities.");
  }
  const status = boundedString(value.job.status, "response job.status", 64);
  if (value.outcome === "created" && status !== "pending") {
    throw new Error("A created trusted admission job must be pending.");
  }
  return Object.freeze({
    outcome: value.outcome,
    admission_event_id: admissionEventId,
    document: Object.freeze({ ...value.document, id: documentId, owner_id: ownerId }) as TrustedAdmissionResponseRow &
      Readonly<{ id: string; owner_id: string; content_hash: string }>,
    job: Object.freeze({ ...value.job, id: jobId, document_id: jobDocumentId, status }) as TrustedAdmissionResponseRow &
      Readonly<{ id: string; document_id: string; status: string }>,
  });
}

export async function dispatchTrustedDocumentAdmission(
  input: Readonly<{
    admission: TrustedDocumentAdmission;
    document: TrustedAdmissionDocumentInput;
    replayOnly: boolean;
    backend?: Readonly<{ principal: string; capability: string }>;
  }>,
  client: TrustedAdmissionRpcClient,
): Promise<TrustedAdmissionDispatchResult> {
  validateDocument(input.admission, input.document);
  const admissionPayload = toTrustedDocumentAdmissionRpcPayload(input.admission);
  let rpcName: "admit_administrator_document" | "admit_backend_document";
  let rpcArgs: Record<string, unknown>;
  if (input.admission.sourceChannel === "admin_api") {
    if (input.admission.actor.kind !== "administrator" || input.backend !== undefined) {
      throw new Error("Administrator admission cannot include backend credentials.");
    }
    rpcName = "admit_administrator_document";
    rpcArgs = { p_admission: admissionPayload, p_document: input.document, p_replay_only: input.replayOnly };
  } else {
    if (input.admission.actor.kind !== "trusted_backend" || !input.backend) {
      throw new Error("Backend admission requires explicit principal and capability credentials.");
    }
    const principal = boundedString(input.backend.principal, "trusted backend principal", 200);
    if (principal !== input.admission.actor.principal) {
      throw new Error("Backend credential principal does not match admission actor.");
    }
    if (!bareSha256Pattern.test(input.backend.capability)) {
      throw new Error("Trusted backend capability must be exactly 64 lower-case hexadecimal characters.");
    }
    rpcName = "admit_backend_document";
    rpcArgs = {
      p_admission: admissionPayload,
      p_document: input.document,
      p_principal: principal,
      p_capability: input.backend.capability,
      p_replay_only: input.replayOnly,
    };
  }

  let rpcResult: unknown;
  try {
    rpcResult =
      rpcName === "admit_administrator_document"
        ? await client.rpc("admit_administrator_document", rpcArgs)
        : await client.rpc("admit_backend_document", rpcArgs);
  } catch {
    throw new TrustedDocumentAdmissionDispatchError(
      "outcome_unknown",
      "Trusted document admission transport failed; reconcile the same request before Storage cleanup.",
    );
  }
  if (!isRecord(rpcResult) || !("data" in rpcResult) || !("error" in rpcResult)) {
    throw new TrustedDocumentAdmissionDispatchError(
      "outcome_unknown",
      "Trusted document admission returned a malformed envelope; reconcile before Storage cleanup.",
    );
  }
  if (rpcResult.error) {
    const refusal = definitiveAdmissionRefusal(rpcResult.error);
    const kind = refusal ? "rejected" : "outcome_unknown";
    throw new TrustedDocumentAdmissionDispatchError(
      kind,
      refusal ?? "Trusted document admission outcome is unknown; reconcile the same request before Storage cleanup.",
    );
  }
  try {
    return parseDispatchResult(rpcResult.data, input.admission, input.replayOnly);
  } catch {
    throw new TrustedDocumentAdmissionDispatchError(
      "outcome_unknown",
      "Trusted document admission returned an invalid positive response; reconcile before Storage cleanup.",
    );
  }
}
