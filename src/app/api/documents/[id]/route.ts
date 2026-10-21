import { NextResponse } from "next/server";
import type { Json } from "@/lib/supabase/database.types";
import { z } from "zod";
import { rateLimitJsonResponse } from "@/lib/api-rate-limit";
import { env, isDemoMode } from "@/lib/env";
import { jsonError, publicErrorResponse, PublicApiError } from "@/lib/http";
import { buildStorageCleanupJobUpdate } from "@/lib/ingestion";
import { invalidateRagCachesForDocumentMutation } from "@/lib/rag/rag";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireRecentAdministratorAssurance } from "@/lib/supabase/admin-assurance";
import { AuthenticationError, requireAuthenticatedUser, unauthorizedResponse } from "@/lib/supabase/auth";
import { writeAuditLog } from "@/lib/audit";
import {
  DocumentDetailRateLimitError,
  documentDetailApiQuerySchema,
  loadAuthorizedDocumentDetail,
} from "@/lib/document-detail";
import { parseJsonBody } from "@/lib/validation/body";
import { parseRouteParams } from "@/lib/validation/params";
import { parseRequestQuery } from "@/lib/validation/query";

export const runtime = "nodejs";

const renameSchema = z
  .object({
    title: z.string().trim().min(1).max(180),
  })
  .strict();
const documentRouteParamsSchema = z.object({
  id: z.string().uuid(),
});
const deleteDocumentResultSchema = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("not_found") }),
  z.object({
    outcome: z.literal("active_job"),
    job_id: z.string().uuid(),
    job_status: z.enum(["pending", "processing"]),
  }),
  z.object({
    outcome: z.literal("deleted"),
    cleanup_job_id: z.string().uuid(),
    document_title: z.string(),
    source_path: z.string().nullable(),
    image_paths: z.array(z.string()),
  }),
]);

// Bounded optimistic-concurrency attempts for a metadata read-modify-write (F-08).
const DOCUMENT_METADATA_WRITE_ATTEMPTS = 3;

function safeMetadata(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function storageWarningsFrom(error: unknown, label: string) {
  const message =
    error && typeof error === "object" && "message" in error ? String(error.message) : "Storage cleanup failed.";
  return `${label}: ${message}`;
}

async function removeStorageObjects(args: {
  supabase: ReturnType<typeof createAdminClient>;
  sourcePath: string | null;
  imagePaths: string[];
}) {
  const warnings: string[] = [];
  let storageRemoved = 0;

  if (args.sourcePath) {
    const sourceRemove = await args.supabase.storage.from(env.SUPABASE_DOCUMENT_BUCKET).remove([args.sourcePath]);
    if (sourceRemove.error) {
      warnings.push(storageWarningsFrom(sourceRemove.error, "Source PDF"));
    } else {
      storageRemoved += sourceRemove.data?.length ?? 0;
    }
  }

  const uniqueImagePaths = Array.from(new Set(args.imagePaths.filter(Boolean)));
  for (let start = 0; start < uniqueImagePaths.length; start += 1000) {
    const paths = uniqueImagePaths.slice(start, start + 1000);
    const imageRemove = await args.supabase.storage.from(env.SUPABASE_IMAGE_BUCKET).remove(paths);
    if (imageRemove.error) {
      warnings.push(storageWarningsFrom(imageRemove.error, "Extracted images"));
    } else {
      storageRemoved += imageRemove.data?.length ?? 0;
    }
  }

  return { storageRemoved, storageWarnings: warnings };
}

async function updateStorageCleanupJob(args: {
  supabase: ReturnType<typeof createAdminClient>;
  cleanupJobId: string;
  status: "completed" | "failed";
  storageRemoved: number;
  warnings: string[];
  // Audit R11: set on every DELETE abort path so the ledger row's storage paths
  // are cleared — the document survives the abort, so the janitor must never see
  // its live paths queued for removal.
  aborted?: boolean;
}) {
  const { error } = await args.supabase
    .from("storage_cleanup_jobs")
    .update(
      buildStorageCleanupJobUpdate({
        status: args.status,
        storageRemoved: args.storageRemoved,
        warnings: args.warnings,
        aborted: args.aborted,
      }),
    )
    .eq("id", args.cleanupJobId);

  return error ? storageWarningsFrom(error, "Cleanup ledger") : null;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: rawId } = await params;
    const detailQuery = parseRequestQuery(request, documentDetailApiQuerySchema, "Invalid document detail query.");
    const payload = await loadAuthorizedDocumentDetail({ request, rawId, query: detailQuery });
    return NextResponse.json(payload);
  } catch (error) {
    if (error instanceof DocumentDetailRateLimitError) {
      return rateLimitJsonResponse("Document requests are rate limited. Try again shortly.", error.rateLimit);
    }
    if (error instanceof AuthenticationError) {
      return unauthorizedResponse();
    }
    return jsonError(error);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: rawId } = await params;
    if (isDemoMode()) {
      return publicErrorResponse("Demo documents cannot be renamed.", 400, { code: "demo_mode_unavailable" });
    }

    const { id } = parseRouteParams({ id: rawId }, documentRouteParamsSchema, "Invalid document id.");
    const body = await parseJsonBody(request, renameSchema, "Enter a document title between 1 and 180 characters.");

    const supabase = createAdminClient();
    const user = await requireAuthenticatedUser(request, supabase, { administrator: true });

    // F-08: the metadata JSON carries the committed index pointer (the generated
    // `index_generation_id` column mirrors it), and the ingestion worker can commit a
    // new pointer between this read and the write below. Writing the whole object back
    // unconditionally would restore the stale pointer. The write matches the row's
    // `updated_at` (bumped by the documents_updated_at trigger on every update), so a
    // concurrent commit makes it match nothing; re-read and retry a bounded number of times.
    let updated: Record<string, unknown> | null = null;
    for (let attempt = 0; attempt < DOCUMENT_METADATA_WRITE_ATTEMPTS && !updated; attempt += 1) {
      const { data: document, error: documentError } = await supabase
        .from("documents")
        .select("id,owner_id,title,file_name,storage_path,content_hash,metadata,updated_at")
        .eq("id", id)
        .eq("owner_id", user.id)
        .maybeSingle();

      if (documentError) throw new Error(documentError.message);
      if (!document) return publicErrorResponse("Document not found.", 404, { code: "document_not_found" });
      if (document.title.trim() === body.title) {
        throw new PublicApiError("Document title is unchanged.");
      }

      const metadata = safeMetadata(document.metadata);
      const { data: updatedRow, error: updateError } = await supabase
        .from("documents")
        .update({
          title: body.title,
          metadata: {
            ...metadata,
            renamed_at: new Date().toISOString(),
            previous_title: document.title,
            original_file_name: metadata.original_file_name ?? document.file_name,
            // JSON-serializable; the inferred literal type is wider than Json.
          } as unknown as Json,
        })
        .eq("id", id)
        .eq("owner_id", user.id)
        .eq("updated_at", document.updated_at)
        .select("*")
        .maybeSingle();

      if (updateError) throw new Error(updateError.message);
      updated = updatedRow;
    }

    if (!updated) {
      return publicErrorResponse("The document changed while it was being renamed. Try again.", 409, {
        code: "document_changed_concurrently",
      });
    }
    invalidateRagCachesForDocumentMutation(user.id, { affectsPublicCorpus: false });
    await writeAuditLog(supabase, {
      ownerId: user.id,
      action: "document_rename",
      resourceType: "document",
      resourceId: id,
      // Audit the rename event and resource without retaining user-controlled
      // titles indefinitely in the service-role audit log.
      metadata: {},
    });
    return NextResponse.json({ document: updated });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return unauthorizedResponse();
    }
    return jsonError(error);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: rawId } = await params;
    if (isDemoMode()) {
      return publicErrorResponse("Demo documents cannot be deleted.", 400, { code: "demo_mode_unavailable" });
    }

    const { id } = parseRouteParams({ id: rawId }, documentRouteParamsSchema, "Invalid document id.");
    const supabase = createAdminClient();
    const user = await requireAuthenticatedUser(request, supabase, { administrator: true });
    await requireRecentAdministratorAssurance(request, supabase, user.id);
    const { data, error } = await supabase.rpc("delete_document_if_idle", {
      p_document_id: id,
      p_owner_id: user.id,
      p_document_bucket: env.SUPABASE_DOCUMENT_BUCKET,
      p_image_bucket: env.SUPABASE_IMAGE_BUCKET,
    });
    if (error) throw new Error(error.message);

    const parsedResult = deleteDocumentResultSchema.safeParse(data);
    if (!parsedResult.success) throw new Error("delete_document_if_idle returned an invalid result.");
    const result = parsedResult.data;
    if (result.outcome === "not_found") {
      return publicErrorResponse("Document not found.", 404, { code: "document_not_found" });
    }
    if (result.outcome === "active_job") {
      throw new PublicApiError(
        "Document has pending or processing indexing work. Wait for it to finish, or recover a job stuck on its last attempt, before deleting.",
        409,
        { code: "document_indexing_active" },
      );
    }

    const cleanup = await removeStorageObjects({
      supabase,
      sourcePath: result.source_path,
      imagePaths: result.image_paths,
    });
    const ledgerWarning = await updateStorageCleanupJob({
      supabase,
      cleanupJobId: result.cleanup_job_id,
      status: cleanup.storageWarnings.length > 0 ? "failed" : "completed",
      storageRemoved: cleanup.storageRemoved,
      warnings: cleanup.storageWarnings,
    });
    if (ledgerWarning) cleanup.storageWarnings.push(ledgerWarning);

    invalidateRagCachesForDocumentMutation(user.id, { affectsPublicCorpus: false });
    await writeAuditLog(supabase, {
      ownerId: user.id,
      action: "document_delete",
      resourceType: "document",
      resourceId: id,
      // The deleted title can contain patient information. Retain only the
      // operational cleanup result alongside the resource id and action.
      metadata: { storageRemoved: cleanup.storageRemoved },
    });
    return NextResponse.json({
      deleted: true,
      documentId: id,
      storageRemoved: cleanup.storageRemoved,
      storageWarnings: cleanup.storageWarnings,
    });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return unauthorizedResponse();
    }
    return jsonError(error);
  }
}
