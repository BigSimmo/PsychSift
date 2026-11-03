import { NextResponse } from "next/server";
import { z } from "zod";
import { rateLimitJsonResponse } from "@/lib/api-rate-limit";
import { requireSignedInClinicalAccess } from "@/lib/clinical-access";
import { jsonError, publicErrorResponse } from "@/lib/http";
import { decodeManagedPdfImage, managedPdfImageReference } from "@/lib/managed-pdf-image";
import { enforceDocumentReadRateLimit, withOwnerReadScope } from "@/lib/public-api-access";
import { committedIndexGeneration, isCommittedGenerationMetadata } from "@/lib/reindex-pipeline";
import { createAdminClient } from "@/lib/supabase/admin";
import { AuthenticationError, unauthorizedResponse } from "@/lib/supabase/auth";

export const runtime = "nodejs";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!z.uuid().safeParse(id).success) return publicErrorResponse("Invalid image id.", 400);
    const client = createAdminClient();
    const { access, rateLimit } = await enforceDocumentReadRateLimit(request, client);
    requireSignedInClinicalAccess(access);
    if (rateLimit.limited)
      return rateLimitJsonResponse("Document requests are rate limited. Try again shortly.", rateLimit);
    const image = await client
      .from("document_images")
      .select("document_id,storage_path,metadata")
      .eq("id", id)
      .maybeSingle();
    if (image.error) throw new Error(image.error.message);
    if (!image.data) return publicErrorResponse("Image not found.", 404);
    const document = await withOwnerReadScope(
      client.from("documents").select("id,metadata").eq("id", image.data.document_id),
      access.ownerId,
    ).maybeSingle();
    if (document.error) throw new Error(document.error.message);
    if (
      !document.data ||
      !isCommittedGenerationMetadata({
        rowMetadata: image.data.metadata,
        committedGeneration: committedIndexGeneration(document.data.metadata),
      })
    )
      return publicErrorResponse("Image not found.", 404);
    const reference = managedPdfImageReference(
      image.data.metadata,
      document.data.id,
      committedIndexGeneration(document.data.metadata),
      image.data.storage_path,
    );
    if (!reference) return publicErrorResponse("Image not found.", 404);
    const result = await client.rpc("read_managed_pdf_image", {
      p_image_id: id,
      p_document_id: document.data.id,
      p_generation: reference.generationId,
    });
    if (result.error) throw new Error(result.error.message);
    const decoded = decodeManagedPdfImage(result.data, reference);
    return new NextResponse(new Uint8Array(decoded.bytes), {
      headers: {
        "Content-Type": decoded.mimeType,
        "Content-Length": String(decoded.bytes.length),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  } catch (error) {
    if (error instanceof AuthenticationError) return unauthorizedResponse();
    return jsonError(error);
  }
}
