import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { env } from "@/lib/env";
import { assertAllowedFile, assertFileContentSignature, jsonError, PublicApiError } from "@/lib/http";
import { logger } from "@/lib/logger";
import { writeAuditLog } from "@/lib/audit";
import { consumeSubjectApiRateLimit, rateLimitJsonResponse } from "@/lib/api-rate-limit";
import { planDocumentName, type DocumentNamePlan, type DocumentNameSupabase } from "@/lib/document-naming";
import { createAdminClient } from "@/lib/supabase/admin";
import { AuthenticationError, requireAuthenticatedUser, unauthorizedResponse } from "@/lib/supabase/auth";
import { probeSupabaseHealth } from "@/lib/supabase/health";
import { createSupabaseBearerServerClient, createSupabaseServerClient } from "@/lib/supabase/server";
import {
  assertTrustedAdministratorAssurance,
  createTrustedDocumentAdmission,
  dispatchTrustedDocumentAdmission,
  TrustedDocumentAdmissionDispatchError,
  trustedAdmissionDocumentId,
  type TrustedAdmissionAuthority,
  type TrustedDocumentAdmission,
} from "@/lib/trusted-document-admission";
import { optionalFormText, parseFormDataFields } from "@/lib/validation/form-data";
import { acquireUploadAdmission, parseUploadContentLength } from "@/lib/upload-admission";
import { assertUploadStructure } from "@/lib/upload-structure";

export const runtime = "nodejs";

const uploadMetadataSchema = z
  .object({
    title: optionalFormText(180),
    description: optionalFormText(1_000),
    authority: z.string().trim().min(2).max(10_000),
  })
  .strict();

const correlationSchema = z
  .string()
  .uuid()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

function bearerAccessToken(request: Request) {
  return request.headers.get("authorization")?.match(/^Bearer\s+([^\s]+)$/i)?.[1] ?? null;
}

function parseAuthority(value: string): TrustedAdmissionAuthority {
  try {
    return JSON.parse(value) as TrustedAdmissionAuthority;
  } catch {
    throw new PublicApiError("Upload authority is invalid JSON.", 400, { code: "invalid_authority" });
  }
}

function persistedNamePlan(
  row: unknown,
  expected: { documentId: string; fileName: string; requestedTitle: string | null; description: string | null },
): DocumentNamePlan | null {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  const record = row as Record<string, unknown>;
  if (record.id !== expected.documentId) return null;
  const metadata =
    record.metadata && typeof record.metadata === "object" && !Array.isArray(record.metadata)
      ? (record.metadata as Record<string, unknown>)
      : null;
  if (!metadata) throw new PublicApiError("Stored admission naming metadata is invalid.", 409);
  if (
    record.file_name !== expected.fileName ||
    record.description !== expected.description ||
    (metadata.original_title ?? null) !== expected.requestedTitle
  ) {
    throw new PublicApiError("Idempotency-Key was already used with changed upload metadata.", 409, {
      code: "admission_replay_conflict",
    });
  }
  const requiredStrings = [
    "source_title",
    "smart_title_base",
    "smart_title_group_key",
    "smart_title_duplicate_reason",
  ] as const;
  if (
    typeof record.title !== "string" ||
    requiredStrings.some((key) => typeof metadata[key] !== "string") ||
    !Number.isSafeInteger(metadata.smart_title_duplicate_index) ||
    Number(metadata.smart_title_duplicate_index) < 1 ||
    (metadata.smart_title_duplicate_reason !== "none" &&
      metadata.smart_title_duplicate_reason !== "same_title_or_filename")
  ) {
    throw new PublicApiError("Stored admission naming metadata is invalid.", 409);
  }
  return {
    title: metadata.source_title as string,
    baseTitle: metadata.smart_title_base as string,
    originalTitle: expected.requestedTitle,
    originalFileName: expected.fileName,
    duplicateIndex: metadata.smart_title_duplicate_index as number,
    duplicateGroupKey: metadata.smart_title_group_key as string,
    duplicateReason: metadata.smart_title_duplicate_reason,
  };
}

function isContentHashDuplicateError(error: unknown) {
  return (
    error instanceof TrustedDocumentAdmissionDispatchError &&
    error.kind === "rejected" &&
    error.message === "duplicate_content"
  );
}

function assertUploadNotAborted(request: Request) {
  if (request.signal.aborted) {
    throw new PublicApiError("Upload cancelled by client.", 499, { code: "client_cancelled" });
  }
}

async function duplicateUploadResponse(args: {
  supabase: ReturnType<typeof createAdminClient>;
  ownerId: string;
  contentHash: string;
  storagePath: string | null;
}) {
  if (args.storagePath) {
    const { error: cleanupStorageError } = await args.supabase.storage
      .from(env.SUPABASE_DOCUMENT_BUCKET)
      .remove([args.storagePath]);
    if (cleanupStorageError) {
      logger.warn("Duplicate upload storage cleanup failed", {
        storagePath: args.storagePath,
        message: cleanupStorageError.message,
      });
      const { error: cleanupLedgerError } = await args.supabase.from("storage_cleanup_jobs").insert({
        document_bucket: env.SUPABASE_DOCUMENT_BUCKET,
        document_paths: [args.storagePath],
        owner_id: args.ownerId,
        status: "pending",
        image_bucket: env.SUPABASE_IMAGE_BUCKET,
        image_paths: [],
      });
      if (cleanupLedgerError) {
        // Keep the duplicate response path fail-closed for orphaned objects: without a
        // ledger row there is no durable recovery record after storage.remove() failed.
        throw new Error(`Duplicate upload cleanup ledger insert failed: ${cleanupLedgerError.message}`);
      }
    }
  }

  const { data: duplicate, error: duplicateError } = await args.supabase
    .from("documents")
    .select("id,title,file_name,status,page_count,chunk_count,image_count,created_at")
    .eq("owner_id", args.ownerId)
    .eq("content_hash", args.contentHash)
    .maybeSingle();

  if (duplicateError) throw new Error(duplicateError.message);
  if (!duplicate?.id) {
    throw new PublicApiError(
      "Upload conflicted with an existing document but the duplicate could not be resolved.",
      409,
    );
  }

  return NextResponse.json({
    document: duplicate,
    duplicate: true,
    duplicateReason: "exact_content_hash",
    message: `Exact copy already exists as "${duplicate.title}"; no duplicate job was queued.`,
  });
}

export async function POST(request: Request) {
  let supabase: ReturnType<typeof createAdminClient> | null = null;
  let uploadedPath: string | null = null;
  let cleanupOwnerId = "";
  let releaseAdmission: (() => void) | null = null;
  let durableAdmission = false;
  let preserveUploadedArtifact = false;

  try {
    supabase = createAdminClient();
    const adminSupabase = supabase;
    const administrator = await requireAuthenticatedUser(request, adminSupabase, { administrator: true });
    const uploadOwnerId = administrator.id;
    cleanupOwnerId = uploadOwnerId;
    const bearer = bearerAccessToken(request);
    const userSupabase = bearer ? createSupabaseBearerServerClient(bearer) : await createSupabaseServerClient();
    if (!userSupabase) throw new AuthenticationError("Authenticated administrator session is required.");
    const { data: claimsData, error: claimsError } = await userSupabase.auth.getClaims(bearer ?? undefined);
    if (claimsError || !claimsData?.claims)
      throw new AuthenticationError("Verified administrator claims are required.");
    try {
      assertTrustedAdministratorAssurance(claimsData.claims, uploadOwnerId);
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : "administrator_assurance_required";
      throw new PublicApiError("Recent multi-factor administrator authentication is required.", 403, { code });
    }

    const rateLimit = await consumeSubjectApiRateLimit({
      supabase: adminSupabase,
      subject: { kind: "owner", ownerId: administrator.id },
      bucket: "document_upload",
      allowInMemoryFallbackOnUnavailable: false,
    });
    if (rateLimit.limited) {
      return rateLimitJsonResponse(
        "Document upload is temporarily rate limited because too many requests were received. Retry shortly.",
        rateLimit,
        { bucket: "document_upload" },
      );
    }

    const multipartOverheadBytes = 1024 * 1024;
    const maximumBodyBytes = env.MAX_UPLOAD_MB * 1024 * 1024 + multipartOverheadBytes;
    const contentLength = parseUploadContentLength(request.headers.get("content-length"));
    if (contentLength !== null && contentLength > maximumBodyBytes) {
      throw new PublicApiError("Upload body exceeds the configured size limit.", 413, {
        code: "upload_body_too_large",
      });
    }
    const admission = acquireUploadAdmission({
      bytes: contentLength ?? maximumBodyBytes,
      maxConcurrent: env.MAX_CONCURRENT_UPLOADS,
      maxBytes: env.MAX_IN_FLIGHT_UPLOAD_MB * 1024 * 1024,
    });
    if (!admission.ok) {
      throw new PublicApiError("Upload capacity is temporarily exhausted. Retry shortly.", 503, {
        code: admission.reason === "bytes" ? "upload_byte_budget_exhausted" : "upload_capacity_exhausted",
      });
    }
    releaseAdmission = admission.release;
    assertUploadNotAborted(request);

    const formData = await request.formData().catch((cause) => {
      throw new PublicApiError("Invalid upload form data.", 400, {
        code: "invalid_form_data",
        causeName: cause instanceof Error ? cause.name : null,
        causeMessage: cause instanceof Error ? cause.message : null,
      });
    });
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Missing file field." }, { status: 400 });
    }

    assertAllowedFile(file, env.MAX_UPLOAD_MB);
    const uploadMetadata = parseFormDataFields(
      formData,
      uploadMetadataSchema,
      ["title", "description", "authority"],
      "Upload metadata is invalid.",
    );

    const correlation = correlationSchema.safeParse(request.headers.get("idempotency-key") ?? randomUUID());
    if (!correlation.success) {
      throw new PublicApiError("Idempotency-Key must be a UUID.", 400, { code: "invalid_idempotency_key" });
    }
    const correlationId = correlation.data;
    const documentId = trustedAdmissionDocumentId(`administrator:${uploadOwnerId}`, correlationId);
    const safeName = file.name.replace(/[^\w.\-() ]+/g, "_");
    const storagePath = `${uploadOwnerId}/documents/${documentId}/${safeName}`;
    assertUploadNotAborted(request);
    const buffer = Buffer.from(await file.arrayBuffer());
    // The declared MIME type is client-supplied; verify the real byte signature
    // and the actual document structure before persisting a clinical document.
    assertFileContentSignature(file.type, buffer);
    await assertUploadStructure(file.type, buffer);
    const contentHash = createHash("sha256").update(buffer).digest("hex");
    const authority = parseAuthority(uploadMetadata.authority);

    const { data: persistedDocument, error: persistedDocumentError } = await adminSupabase
      .from("documents")
      .select("id,title,description,file_name,metadata")
      .eq("owner_id", uploadOwnerId)
      .eq("id", documentId)
      .maybeSingle();
    if (persistedDocumentError) throw new Error(persistedDocumentError.message);
    const namingSupabase: DocumentNameSupabase = {
      from: ((table) => adminSupabase.from(table)) as DocumentNameSupabase["from"],
    };
    const namePlan =
      persistedNamePlan(persistedDocument, {
        documentId,
        fileName: file.name,
        requestedTitle: uploadMetadata.title,
        description: uploadMetadata.description,
      }) ??
      (await planDocumentName({
        supabase: namingSupabase,
        ownerId: uploadOwnerId,
        fileName: file.name,
        requestedTitle: uploadMetadata.title,
        contentHash,
      }));
    const title = namePlan.title;
    const description = uploadMetadata.description;
    // Upload filename/title/storage-path identity is user-controlled and must not mint
    // Official/Trusted publisher_code. The separate authority object is validated by
    // the admission contract and retained without inferring authority from the filename.

    assertUploadNotAborted(request);
    const documentPayload = {
      id: documentId,
      owner_id: uploadOwnerId,
      title,
      description,
      file_name: file.name,
      file_type: file.type,
      file_size: file.size,
      storage_path: storagePath,
      content_hash: contentHash,
      max_attempts: env.WORKER_MAX_ATTEMPTS,
      metadata: {
        source_title: title,
        publisher_code: null,
        publisher: null,
        jurisdiction: "Australia/WA",
        version: null,
        publication_date: null,
        review_date: null,
        indexed_at: null,
        uploaded_by: uploadOwnerId,
        original_file_name: namePlan.originalFileName,
        original_title: namePlan.originalTitle,
        smart_title_base: namePlan.baseTitle,
        smart_title_group_key: namePlan.duplicateGroupKey,
        smart_title_duplicate_index: namePlan.duplicateIndex,
        smart_title_duplicate_reason: namePlan.duplicateReason,
        document_status: "unknown",
        clinical_validation_status: "unverified",
        extraction_quality: "unknown",
        max_upload_mb: env.MAX_UPLOAD_MB,
        admission_max_attempts: env.WORKER_MAX_ATTEMPTS,
        confidentiality_scope: "guidelines-only",
        corpus_scope: "uploaded_local",
        content_mode: "indexed_content",
        authority,
        content_hash: contentHash,
      },
    };

    let trustedAdmission: TrustedDocumentAdmission;
    try {
      trustedAdmission = createTrustedDocumentAdmission({
        actor: { kind: "administrator", administratorId: uploadOwnerId },
        sourceChannel: "admin_api",
        documentId,
        stagingOwnerId: uploadOwnerId,
        contentSha256: `sha256:${contentHash}`,
        storagePath,
        originalFileName: file.name,
        mimeType: file.type,
        byteCount: file.size,
        correlationId,
        admissionPolicyVersion: "trusted-document-admission-v1",
        authority,
      });
    } catch {
      throw new PublicApiError("Upload authority or admission metadata is invalid.", 400, {
        code: "invalid_authority",
      });
    }

    const replay = await dispatchTrustedDocumentAdmission(
      { admission: trustedAdmission, document: documentPayload, replayOnly: true },
      userSupabase,
    );
    if (replay.outcome !== "not_found") {
      return NextResponse.json({ document: replay.document, job: replay.job });
    }

    const { data: duplicate, error: duplicateError } = await adminSupabase
      .from("documents")
      .select("id,title,file_name,status,page_count,chunk_count,image_count,created_at")
      .eq("owner_id", uploadOwnerId)
      .eq("content_hash", contentHash)
      .maybeSingle();
    if (duplicateError) throw new Error(duplicateError.message);
    if (duplicate?.id) {
      return NextResponse.json({
        document: duplicate,
        duplicate: true,
        duplicateReason: "exact_content_hash",
        message: `Exact copy already exists as "${duplicate.title}"; no duplicate job was queued.`,
      });
    }

    const health = await probeSupabaseHealth(adminSupabase);
    if (!health.ok) return NextResponse.json({ error: `Upload is paused. ${health.message}` }, { status: 503 });

    assertUploadNotAborted(request);
    const upload = await adminSupabase.storage.from(env.SUPABASE_DOCUMENT_BUCKET).upload(storagePath, buffer, {
      contentType: file.type,
      upsert: false,
    });
    if (upload.error) throw new Error(upload.error.message);
    uploadedPath = storagePath;

    assertUploadNotAborted(request);
    let uploadRecord;
    try {
      uploadRecord = await dispatchTrustedDocumentAdmission(
        { admission: trustedAdmission, document: documentPayload, replayOnly: false },
        userSupabase,
      );
    } catch (dispatchError) {
      if (dispatchError instanceof TrustedDocumentAdmissionDispatchError && dispatchError.kind === "outcome_unknown") {
        try {
          const recovered = await dispatchTrustedDocumentAdmission(
            { admission: trustedAdmission, document: documentPayload, replayOnly: true },
            userSupabase,
          );
          if (recovered.outcome !== "not_found") {
            durableAdmission = true;
            return NextResponse.json({ document: recovered.document, job: recovered.job }, { status: 201 });
          }
        } catch {
          // An ambiguous commit must retain the exact object for replay recovery.
        }
        preserveUploadedArtifact = true;
      }
      if (isContentHashDuplicateError(dispatchError)) {
        // The duplicate response helper exclusively owns exact-path compensation
        // and its durable cleanup-ledger fallback.
        preserveUploadedArtifact = true;
        return duplicateUploadResponse({ supabase, ownerId: uploadOwnerId, contentHash, storagePath: uploadedPath });
      }
      throw dispatchError;
    }
    if (uploadRecord.outcome === "not_found") throw new Error("Admission unexpectedly returned not_found.");
    const { document, job } = uploadRecord;
    durableAdmission = true;
    await writeAuditLog(supabase, {
      ownerId: uploadOwnerId,
      action: "document_upload",
      resourceType: "document",
      resourceId: documentId,
      // `audit_logs` is retained indefinitely. Keep only operational facts there;
      // the user-controlled filename and content hash remain on the scoped document
      // record, not in the durable audit trail.
      metadata: { fileType: file.type, fileSize: file.size },
    });

    return NextResponse.json({ document, job }, { status: 201 });
  } catch (error) {
    if (!durableAdmission && !preserveUploadedArtifact && uploadedPath && supabase) {
      try {
        const { error: cleanupStorageError } = await supabase.storage
          .from(env.SUPABASE_DOCUMENT_BUCKET)
          .remove([uploadedPath]);
        if (cleanupStorageError) {
          logger.error("Upload cleanup failed; storage object may be orphaned", {
            storagePath: uploadedPath,
            message: cleanupStorageError.message,
          });
          const { error: cleanupLedgerError } = await supabase.from("storage_cleanup_jobs").insert({
            document_bucket: env.SUPABASE_DOCUMENT_BUCKET,
            document_paths: [uploadedPath],
            owner_id: cleanupOwnerId,
            status: "pending",
            image_bucket: env.SUPABASE_IMAGE_BUCKET,
            image_paths: [],
          });
          if (cleanupLedgerError) {
            logger.error("Upload cleanup ledger insert failed", { message: cleanupLedgerError.message });
          }
        }
      } catch (cleanupError) {
        // Cleanup is best-effort, but a silent failure leaves an orphaned storage
        // object. Record the path so it can be reconciled instead of dropping it.
        logger.error("Upload cleanup failed; storage object may be orphaned", {
          storagePath: uploadedPath,
          message: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
        });
        try {
          const { error: cleanupLedgerError } = await supabase.from("storage_cleanup_jobs").insert({
            document_bucket: env.SUPABASE_DOCUMENT_BUCKET,
            document_paths: [uploadedPath],
            owner_id: cleanupOwnerId,
            status: "pending",
            image_bucket: env.SUPABASE_IMAGE_BUCKET,
            image_paths: [],
          });
          if (cleanupLedgerError) {
            logger.error("Upload cleanup ledger insert failed", { message: cleanupLedgerError.message });
          }
        } catch (cleanupLedgerError) {
          logger.error("Upload cleanup ledger insert failed", {
            message: cleanupLedgerError instanceof Error ? cleanupLedgerError.message : String(cleanupLedgerError),
          });
        }
      }
    }

    if (error instanceof AuthenticationError) {
      return unauthorizedResponse();
    }
    if (
      error instanceof TrustedDocumentAdmissionDispatchError &&
      error.kind === "rejected" &&
      /admission_replay_conflict|document_identity_conflict/.test(error.message)
    ) {
      return NextResponse.json({ error: "Idempotency-Key conflicts with the admitted request." }, { status: 409 });
    }

    return jsonError(error);
  } finally {
    releaseAdmission?.();
  }
}
