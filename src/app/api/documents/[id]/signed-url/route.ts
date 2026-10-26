import { NextResponse } from "next/server";
import { z } from "zod";
import { rateLimitJsonResponse } from "@/lib/api-rate-limit";
import { getDemoDocument } from "@/lib/demo-data";
import { env } from "@/lib/env";
import { isDemoMode } from "@/lib/env";
import { jsonError, PublicApiError, publicErrorResponse } from "@/lib/http";
import { registryCorpusDetailHref } from "@/lib/registry-corpus-links";
import { normalizeSourceMetadata } from "@/lib/source-metadata";
import { createAdminClient } from "@/lib/supabase/admin";
import { AuthenticationError, unauthorizedResponse } from "@/lib/supabase/auth";
import { requireSignedInClinicalAccess } from "@/lib/clinical-access";
import { requireOriginalDocumentAccess } from "@/lib/original-document-access";
import { enforceDocumentReadRateLimit, withOwnerReadScope } from "@/lib/public-api-access";

export const runtime = "nodejs";

const signedUrlTtlSeconds = env.DOCUMENT_SIGNED_URL_TTL_SECONDS;
const routeIdSchema = z.string().uuid();

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const requestUrl = new URL(_request.url);
    const shouldDownload = ["1", "true"].includes((requestUrl.searchParams.get("download") ?? "").toLowerCase());
    if (isDemoMode()) {
      const document = getDemoDocument(id);
      if (!document) return publicErrorResponse("Demo document not found.", 404);
      return NextResponse.json({
        url: shouldDownload ? `${document.storage_path}?download=1` : document.storage_path,
        fileType: document.file_type,
        expiresAt: new Date(Date.now() + signedUrlTtlSeconds * 1000).toISOString(),
        demoMode: true,
      });
    }

    if (!routeIdSchema.safeParse(id).success) throw new PublicApiError("Invalid document id.");

    const supabase = createAdminClient();
    const { access, rateLimit } = await enforceDocumentReadRateLimit(_request, supabase);
    requireSignedInClinicalAccess(access);
    if (rateLimit.limited) {
      return rateLimitJsonResponse("Document requests are rate limited. Try again shortly.", rateLimit);
    }
    const { data: document, error } = await withOwnerReadScope(
      supabase.from("documents").select("owner_id,storage_path,file_type,metadata").eq("id", id),
      access.ownerId,
    ).maybeSingle();

    if (error) throw new Error(error.message);
    if (!document) return publicErrorResponse("Document not found.", 404);

    const metadata =
      document.metadata && typeof document.metadata === "object" ? (document.metadata as Record<string, unknown>) : {};
    const source = normalizeSourceMetadata(metadata);
    const registryHref =
      (typeof metadata.registry_detail_href === "string" && metadata.registry_detail_href) ||
      registryCorpusDetailHref({
        kind: metadata.registry_record_kind as string | undefined,
        slug: metadata.registry_record_slug as string | undefined,
        subkind: metadata.registry_record_subkind as string | undefined,
        recordId: metadata.registry_record_id as string | undefined,
      });
    if (source.source_kind === "registry_record" && registryHref) {
      return NextResponse.json({
        url: registryHref,
        fileType: document.file_type,
        registrySource: true,
        expiresAt: null,
      });
    }

    if (document.storage_path.startsWith("registry://")) {
      return publicErrorResponse(
        "Registry summaries open on their registry detail page, not as stored documents.",
        409,
      );
    }

    // Only the original file is gated here; registry summaries above open their public page.
    await requireOriginalDocumentAccess(access, document, supabase);

    const storage = supabase.storage.from(env.SUPABASE_DOCUMENT_BUCKET);
    const signed = shouldDownload
      ? await storage.createSignedUrl(document.storage_path, signedUrlTtlSeconds, { download: true })
      : await storage.createSignedUrl(document.storage_path, signedUrlTtlSeconds);

    if (signed.error) throw new Error(signed.error.message);
    return NextResponse.json({
      url: signed.data.signedUrl,
      fileType: document.file_type,
      expiresAt: new Date(Date.now() + signedUrlTtlSeconds * 1000).toISOString(),
    });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return unauthorizedResponse();
    }
    return jsonError(error);
  }
}
