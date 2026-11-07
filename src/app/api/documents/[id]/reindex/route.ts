import { NextResponse } from "next/server";
import { z } from "zod";
import { env, isDemoMode } from "@/lib/env";
import { jsonError, publicErrorResponse, PublicApiError } from "@/lib/http";
import {
  activeIngestionJobColumns,
  buildActiveJobsSafetyResult,
  checkIngestionMutationSafety,
  hasActiveAgentEnrichmentJob,
  ingestionMutationSafetyPayload,
  type IngestionJobRow,
} from "@/lib/ingestion-mutation-safety";
import { consumeApiRateLimit, rateLimitJsonResponse } from "@/lib/api-rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  AuthenticationError,
  requireAuthenticatedUser,
  requireAuthenticatedUserContext,
  unauthorizedResponse,
} from "@/lib/supabase/auth";
import { readBoundedJson } from "@/lib/validation/body";
import { parseRouteParams } from "@/lib/validation/params";
import { prepareAdministratorDocumentReadmission } from "@/lib/admin-document-readmission";
import { parseAdministratorReindexAuthority } from "@/lib/trusted-document-admission";
import { MAX_UPLOAD_MB_CEILING } from "@/lib/upload-limits";
import { withOwnerReadScope } from "@/lib/public-api-access";

export const runtime = "nodejs";

const reindexModeSchema = z
  .object({
    mode: z.preprocess((value) => (value === "enrichment" ? "enrichment" : "full"), z.enum(["full", "enrichment"])),
  })
  .default({ mode: "full" });
const reindexRouteParamsSchema = z.object({
  id: z.string().uuid(),
});
const readmissionRequestSchema = z
  .object({
    mode: z.literal("full").default("full"),
    readmission: z
      .object({
        correlationId: z.uuid(),
        authority: z.unknown().refine((value) => value !== undefined && value !== null),
      })
      .strict(),
  })
  .strict();
const readmissionResultSchema = z
  .object({
    outcome: z.enum(["created", "replayed"]),
    admissionEventId: z.uuid(),
    jobId: z.uuid(),
    scope: z.enum(["owner_private", "existing_shared_library_stewardship"]),
    documentOwnerId: z.uuid().nullable(),
    stewardId: z.uuid(),
    generationActivated: z.literal(false).optional(),
  })
  .refine((result) => result.outcome !== "created" || result.generationActivated === false);
const reindexRequestResultSchema = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("not_found") }),
  z.object({ outcome: z.literal("agent_enrichment_active") }),
  z.object({ outcome: z.literal("ingestion_active") }),
  z.object({ outcome: z.literal("queued"), job: z.object({ id: z.string() }).passthrough() }),
]);

async function readInput(
  request: Request,
): Promise<{ mode: "full" | "enrichment"; readmission?: { correlationId: string; authority: unknown } }> {
  const body = await readBoundedJson(request);
  if (body && typeof body === "object" && Object.hasOwn(body, "readmission")) {
    const parsed = readmissionRequestSchema.safeParse(body);
    if (!parsed.success)
      throw new PublicApiError("Explicit current readmission is invalid.", 400, { code: "invalid_readmission" });
    try {
      parseAdministratorReindexAuthority(parsed.data.readmission.authority);
    } catch {
      throw new PublicApiError("Current administrator authority is invalid.", 400, {
        code: "invalid_readmission_authority",
      });
    }
    return parsed.data;
  }
  const parsed = reindexModeSchema.safeParse(body);
  return parsed.success ? parsed.data : { mode: "full" };
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (isDemoMode())
      return publicErrorResponse("Reindex is unavailable in demo mode.", 400, { code: "demo_mode_unavailable" });

    const { id: rawId } = await params;
    const { id } = parseRouteParams({ id: rawId }, reindexRouteParamsSchema, "Invalid document id.");
    const supabase = createAdminClient();
    const { mode, readmission } = await readInput(request);
    const current = readmission
      ? await requireAuthenticatedUserContext(request, supabase, { administrator: true })
      : undefined;
    const user = current?.user ?? (await requireAuthenticatedUser(request, supabase, { administrator: true }));
    const rateLimit = await consumeApiRateLimit({ supabase, ownerId: user.id, bucket: "document_reindex" });
    if (rateLimit.limited)
      return rateLimitJsonResponse("Too many document reindex requests. Retry shortly.", rateLimit);

    const documentById = withOwnerReadScope(
      supabase
        .from("documents")
        .select(
          "id,owner_id,title,file_name,file_type,file_size,storage_path,content_hash,source_path,import_batch_id,status,error_message,page_count,chunk_count,image_count,metadata",
        )
        .eq("id", id),
      user.id,
    );
    // Shared-library stewardship is available only through explicit readmission.
    const documentQuery = readmission ? documentById : documentById.eq("owner_id", user.id);
    const { data: document, error: documentError } = await documentQuery.maybeSingle();

    if (documentError) throw new Error(documentError.message);
    if (!document) return publicErrorResponse("Document not found.", 404, { code: "document_not_found" });
    if (!readmission && document.owner_id !== user.id)
      return publicErrorResponse("Document not found.", 404, { code: "document_not_found" });

    if (readmission && current) {
      const metadata =
        document.metadata && typeof document.metadata === "object" && !Array.isArray(document.metadata)
          ? (document.metadata as Record<string, unknown>)
          : {};
      const shared = document.owner_id === null && metadata.public_corpus === true;
      if (document.owner_id !== user.id && !shared)
        return publicErrorResponse("Document not found.", 404, { code: "document_not_found" });
      const size = Number(document.file_size);
      if (
        document.file_type !== "application/pdf" ||
        !document.storage_path ||
        !Number.isSafeInteger(size) ||
        size < 1 ||
        size > MAX_UPLOAD_MB_CEILING * 1024 * 1024
      )
        return publicErrorResponse("Current readmission requires a stored PDF original with a bounded identity.", 409, {
          code: "readmission_source_identity_mismatch",
        });
      const source = await supabase.storage.from(env.SUPABASE_DOCUMENT_BUCKET).download(document.storage_path);
      if (source.error || !source.data)
        return publicErrorResponse("The original document could not be loaded for current readmission.", 503, {
          code: "readmission_original_unavailable",
        });
      if (source.data.size !== size)
        return publicErrorResponse("The stored original no longer matches the document identity.", 409, {
          code: "readmission_source_identity_mismatch",
        });
      let payload: ReturnType<typeof prepareAdministratorDocumentReadmission>;
      try {
        payload = prepareAdministratorDocumentReadmission(
          {
            administratorId: user.id,
            correlationId: readmission.correlationId,
            maxAttempts: env.WORKER_MAX_ATTEMPTS,
            authority: readmission.authority,
            document: {
              id: document.id,
              owner_id: document.owner_id,
              file_name: document.file_name,
              storage_path: document.storage_path,
              file_type: document.file_type,
              file_size: size,
              content_hash: document.content_hash ?? "",
              metadata,
            },
          },
          new Uint8Array(await source.data.arrayBuffer()),
        );
      } catch {
        return publicErrorResponse(
          "The stored original or current authority could not be verified for readmission.",
          409,
          { code: "readmission_source_identity_mismatch" },
        );
      }
      // This authenticated RPC performs current AAL2/admin checks, admission and
      // concurrency-safe queuing atomically. Never queue again with service-role authority.
      type ReadmitRpc = (
        name: "readmit_administrator_document_for_reindex",
        args: typeof payload,
      ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
      const rpc = current.publicationClient.rpc as ReadmitRpc;
      const result = await rpc.call(current.publicationClient, "readmit_administrator_document_for_reindex", payload);
      if (result.error) {
        const assurance = ["administrator_assurance_required", "administrator_recent_authentication_required"].includes(
          result.error.message,
        );
        if (assurance)
          return publicErrorResponse("Recent administrator multi-factor authentication is required.", 403, {
            code: "readmission_assurance_required",
          });
        if (result.error.message === "readmission_active_attempt")
          return publicErrorResponse(
            "Current readmission is blocked by active indexing work. Retry with the same correlation ID after it finishes.",
            409,
            { code: "readmission_conflict" },
          );
        const refused = [
          "readmission_invalid_identity",
          "readmission_document_scope_required",
          "readmission_source_identity_mismatch",
          "readmission_governed_source_requires_its_existing_control_plane",
          "readmission_invalid_authority",
          "readmission_invalid_features",
          "readmission_invalid_date",
          "readmission_source_not_current",
          "readmission_invalid_supersession",
          "readmission_replay_conflict",
        ].includes(result.error.message);
        return refused
          ? publicErrorResponse(
              "Current readmission was refused. Review source eligibility, authority, and request identity before submitting again.",
              422,
              { code: "readmission_refused" },
            )
          : publicErrorResponse(
              "The readmission service could not verify the request. Retry with the same correlation ID once it is available.",
              502,
              { code: "readmission_unavailable" },
            );
      }
      const decoded = readmissionResultSchema.safeParse(result.data);
      if (
        !decoded.success ||
        decoded.data.stewardId !== user.id ||
        decoded.data.documentOwnerId !== document.owner_id ||
        decoded.data.scope !== (shared ? "existing_shared_library_stewardship" : "owner_private")
      )
        return publicErrorResponse(
          "The readmission result could not be verified. Retry with the same correlation ID.",
          502,
          { code: "readmission_result_unverified" },
        );
      return NextResponse.json(
        { mode, job: { id: decoded.data.jobId }, readmission: decoded.data, generationActivated: false },
        { status: decoded.data.outcome === "created" ? 201 : 200 },
      );
    }

    const safety = await checkIngestionMutationSafety({
      supabase,
      documentIds: [id],
      action: "Reindex",
      checkActiveJobs: true,
      checkActiveAgentEnrichmentJobs: mode !== "enrichment",
      staleAfterMinutes: env.WORKER_STALE_AFTER_MINUTES,
    });
    if (!safety.ok) return NextResponse.json(ingestionMutationSafetyPayload(safety), { status: safety.status });

    // Full reindex deletes/rebuilds the same enrichment artifact families the
    // agent writes. Block only while a fresh agent lease is live; enrichment
    // mode keeps its own RPC concurrency (`request_indexing_v3_enrichment`).
    if (mode !== "enrichment") {
      const enrichmentActive = await hasActiveAgentEnrichmentJob({
        supabase,
        documentId: id,
        staleAfterMinutes: env.WORKER_STALE_AFTER_MINUTES,
      });
      if (enrichmentActive) {
        return publicErrorResponse("Reindex is paused while enrichment is active.", 409, { code: "enrichment_active" });
      }
    }

    if (mode === "enrichment") {
      const { data: queued, error: queueError } = await supabase.rpc("request_indexing_v3_enrichment", {
        p_document_id: id,
        p_owner_id: user.id,
      });
      if (queueError) {
        return publicErrorResponse("Enrichment is already active or could not be queued safely.", 409, {
          code: "enrichment_queue_conflict",
        });
      }
      return NextResponse.json({ mode, queued }, { status: 202 });
    }

    if (document.file_type === "application/pdf")
      return publicErrorResponse(
        "PDF reindexing requires an explicit current-administrator authority declaration and source readmission.",
        409,
        { code: "readmission_required" },
      );

    const staleBefore = new Date(Date.now() - env.WORKER_STALE_AFTER_MINUTES * 60_000).toISOString();
    const { data: reindexResult, error: reindexError } = await supabase.rpc("request_ingestion_reindex_if_agent_idle", {
      p_document_id: id,
      p_owner_id: user.id,
      p_stale_before: staleBefore,
      p_max_attempts: env.WORKER_MAX_ATTEMPTS,
    });
    if (reindexError) throw new Error(reindexError.message);

    const parsedResult = reindexRequestResultSchema.safeParse(reindexResult);
    if (!parsedResult.success) throw new Error("request_ingestion_reindex_if_agent_idle returned an invalid result.");
    if (parsedResult.data.outcome === "not_found") {
      return publicErrorResponse("Document was deleted while reindexing. Refresh the document list and retry.", 409, {
        code: "document_deleted_during_reindex",
      });
    }
    if (parsedResult.data.outcome === "agent_enrichment_active") {
      return publicErrorResponse(
        "Document has active agent enrichment work. Wait for it to finish before reindexing.",
        409,
        { code: "enrichment_active" },
      );
    }
    if (parsedResult.data.outcome === "ingestion_active") {
      const { data: competingJobs, error: competingJobsError } = await supabase
        .from("ingestion_jobs")
        .select(activeIngestionJobColumns)
        .eq("document_id", id)
        .in("status", ["pending", "processing"]);
      if (competingJobsError) {
        throw new Error(`Atomic reindex found competing work but could not load it: ${competingJobsError.message}`);
      }
      if ((competingJobs?.length ?? 0) > 0) {
        const safety = buildActiveJobsSafetyResult(
          competingJobs as IngestionJobRow[],
          env.WORKER_STALE_AFTER_MINUTES,
          new Date().toISOString(),
        );
        return NextResponse.json(ingestionMutationSafetyPayload(safety), { status: 409 });
      }
      return publicErrorResponse("Document already has active indexing work.", 409, { code: "indexing_active" });
    }
    return NextResponse.json({ job: parsedResult.data.job }, { status: 201 });
  } catch (error) {
    if (error instanceof AuthenticationError) return unauthorizedResponse();
    return jsonError(error);
  }
}
