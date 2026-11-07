import { createHash } from "node:crypto";
import { z } from "zod";
import { MAX_UPLOAD_MB_CEILING } from "./upload-limits";
import { parseAdministratorReindexAuthority } from "./trusted-document-admission";

export const ADMIN_REINDEX_READMISSION_VERSION = "administrator-current-reindex-readmission-v1" as const;
const hash = (value: string | Uint8Array) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const inputSchema = z
  .object({
    administratorId: z.uuid(),
    correlationId: z.uuid(),
    maxAttempts: z.number().int().min(1).max(100),
    document: z
      .object({
        id: z.uuid(),
        owner_id: z.uuid().nullable(),
        file_name: z.string().min(1).max(255),
        storage_path: z.string().min(1).max(1024),
        file_type: z.literal("application/pdf"),
        file_size: z
          .number()
          .int()
          .positive()
          .max(MAX_UPLOAD_MB_CEILING * 1024 * 1024),
        content_hash: z.string().regex(/^[0-9a-f]{64}$/),
        metadata: z.record(z.string(), z.unknown()),
      })
      .strict(),
    authority: z.unknown(),
  })
  .strict();

/** Call only with the current DB row and bytes just downloaded from THAT row's
 * original Storage path, after recent administrator authentication. */
export function prepareAdministratorDocumentReadmission(input: z.input<typeof inputSchema>, sourceBytes: Uint8Array) {
  const parsed = inputSchema.parse(input);
  const { document } = parsed;
  const shared = document.owner_id === null && document.metadata.public_corpus === true;
  if (document.owner_id !== parsed.administratorId && !shared) throw new Error("readmission_document_scope_required");
  if (
    sourceBytes.byteLength !== document.file_size ||
    hash(sourceBytes) !== `sha256:${document.content_hash}` ||
    !Buffer.from(sourceBytes.subarray(0, 5)).equals(Buffer.from("%PDF-"))
  )
    throw new Error("readmission_source_identity_mismatch");
  const authority = parseAdministratorReindexAuthority(parsed.authority);
  if (authority.providerProcessing !== "permitted") throw new Error("readmission_provider_processing_forbidden");
  return Object.freeze({
    p_document_id: document.id,
    p_correlation_id: parsed.correlationId,
    p_expected_owner_id: document.owner_id,
    p_expected_public_corpus: document.metadata.public_corpus === true,
    p_source_sha256: hash(sourceBytes),
    p_byte_count: sourceBytes.byteLength,
    p_file_name_sha256: hash(document.file_name),
    p_storage_path_sha256: hash(document.storage_path),
    p_authority: authority,
    p_max_attempts: parsed.maxAttempts,
  });
}
