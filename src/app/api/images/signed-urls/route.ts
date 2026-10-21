import { NextResponse } from "next/server";
import { z } from "zod";
import { rateLimitJsonResponse } from "@/lib/api-rate-limit";
import { getDemoImage } from "@/lib/demo-data";
import { env } from "@/lib/env";
import { isDemoMode } from "@/lib/env";
import { jsonError, PublicApiError } from "@/lib/http";
import { committedIndexGeneration, isCommittedGenerationMetadata } from "@/lib/reindex-pipeline";
import { createAdminClient } from "@/lib/supabase/admin";
import { AuthenticationError, unauthorizedResponse } from "@/lib/supabase/auth";
import { requireSignedInClinicalAccess } from "@/lib/clinical-access";
import { enforceDocumentReadRateLimit, withOwnerReadScope } from "@/lib/public-api-access";
import { parseJsonBody } from "@/lib/validation/body";

export const runtime = "nodejs";

const signedUrlTtlSeconds = env.DOCUMENT_SIGNED_URL_TTL_SECONDS;
const batchRequestSchema = z.object({
  imageIds: z.array(z.string().uuid()).max(100),
});

export async function POST(request: Request) {
  try {
    const { imageIds } = await parseJsonBody(request, batchRequestSchema, "Invalid request body.");

    if (imageIds.length === 0) {
      return NextResponse.json({ urls: {} });
    }

    if (isDemoMode()) {
      const urls: Record<
        string,
        { url: string; mimeType: string | null; caption: string | null; expiresAt: string; demoMode: true }
      > = {};
      for (const id of imageIds) {
        const image = getDemoImage(id);
        if (image) {
          urls[id] = {
            url: image.signed_url ?? image.storage_path,
            mimeType: image.mime_type,
            caption: image.caption,
            expiresAt: new Date(Date.now() + signedUrlTtlSeconds * 1000).toISOString(),
            demoMode: true,
          };
        }
      }
      return NextResponse.json({ urls });
    }

    const supabase = createAdminClient();
    const { access, rateLimit } = await enforceDocumentReadRateLimit(request, supabase);
    requireSignedInClinicalAccess(access);
    if (rateLimit.limited) {
      return rateLimitJsonResponse("Document requests are rate limited. Try again shortly.", rateLimit);
    }

    // Fetch images
    const { data: images, error: imagesError } = await supabase
      .from("document_images")
      .select("id,document_id,storage_path,mime_type,caption,metadata")
      .in("id", imageIds);

    if (imagesError) throw new Error(imagesError.message);
    if (!images || images.length === 0) {
      return NextResponse.json({ urls: {} });
    }

    // Fetch distinct document IDs
    const documentIds = Array.from(new Set(images.map((img) => img.document_id)));

    // Verify document access
    const { data: documents, error: documentError } = await withOwnerReadScope(
      supabase.from("documents").select("id,owner_id,metadata").in("id", documentIds),
      access.ownerId,
    );

    if (documentError) throw new Error(documentError.message);
    if (!documents || documents.length === 0) {
      return NextResponse.json({ urls: {} });
    }

    const documentMap = new Map(documents.map((doc) => [doc.id, doc]));
    const validImages = images.filter((img) => {
      const doc = documentMap.get(img.document_id);
      if (!doc) return false;
      return isCommittedGenerationMetadata({
        rowMetadata: img.metadata,
        committedGeneration: committedIndexGeneration(doc.metadata),
      });
    });

    if (validImages.length === 0) {
      return NextResponse.json({ urls: {} });
    }

    // Sign all valid images uniformly. The single-image route (/api/images/[id]/signed-url)
    // always signs regardless of corpus visibility; doing the same here avoids a silent
    // breakage if the image bucket policy is ever tightened from public to private.
    const urls: Record<string, { url: string; mimeType: string | null; caption: string | null; expiresAt: string }> =
      {};

    const storagePaths = validImages.map((img) => img.storage_path);
    const signed = await supabase.storage
      .from(env.SUPABASE_IMAGE_BUCKET)
      .createSignedUrls(storagePaths, signedUrlTtlSeconds);

    if (signed.error) throw new Error(signed.error.message);
    if (!signed.data) {
      throw new Error("Failed to generate signed URLs for images.");
    }

    const itemWithError = signed.data.find((res) => res.error);
    if (itemWithError) {
      throw new PublicApiError(`Failed to generate signed URL for image: ${itemWithError.error}`, 500);
    }

    const signedUrlMap = new Map(signed.data.map((res) => [res.path, res.signedUrl]));

    for (const img of validImages) {
      const signedUrl = signedUrlMap.get(img.storage_path);
      if (signedUrl) {
        urls[img.id] = {
          url: signedUrl,
          mimeType: img.mime_type,
          caption: img.caption,
          expiresAt: new Date(Date.now() + signedUrlTtlSeconds * 1000).toISOString(),
        };
      }
    }

    return NextResponse.json({ urls });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return unauthorizedResponse();
    }
    return jsonError(error);
  }
}
