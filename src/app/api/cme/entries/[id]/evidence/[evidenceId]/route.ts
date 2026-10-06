import { NextResponse } from "next/server";
import { z } from "zod";
import { consumeSubjectApiRateLimit, rateLimitJsonResponse } from "@/lib/api-rate-limit";
import { CME_EVIDENCE_BUCKET, cmeEvidenceRemovalSchema } from "@/lib/cme/evidence-model";
import { assertEvidenceEntry, removeCmeEvidence } from "@/lib/cme/evidence-repository";
import { isDemoMode } from "@/lib/env";
import { jsonError, PublicApiError } from "@/lib/http";
import { createAdminClient } from "@/lib/supabase/admin";
import { AuthenticationError, requireAuthenticatedUser, unauthorizedResponse } from "@/lib/supabase/auth";
import { readBoundedJson } from "@/lib/validation/body";

export const runtime = "nodejs";
export async function GET(request: Request, { params }: { params: Promise<{ id: string; evidenceId: string }> }) {
  try {
    if (isDemoMode()) throw new PublicApiError("Demo evidence is not stored.", 404);
    const parsed = z.object({ id: z.uuid(), evidenceId: z.uuid() }).parse(await params);
    const client = createAdminClient();
    const user = await requireAuthenticatedUser(request, client);
    const rate = await consumeSubjectApiRateLimit({
      supabase: client,
      subject: { kind: "owner", ownerId: user.id },
      bucket: "cme",
      allowInMemoryFallbackOnUnavailable: false,
    });
    if (rate.limited) return rateLimitJsonResponse("Evidence downloads are temporarily rate limited.", rate);
    await assertEvidenceEntry(client, user.id, parsed.id);
    const { data, error } = await client
      .from("cme_evidence")
      .select("storage_path,file_name")
      .eq("owner_id", user.id)
      .eq("entry_id", parsed.id)
      .eq("id", parsed.evidenceId)
      .is("removed_at", null)
      .maybeSingle();
    if (error) throw new PublicApiError("Evidence could not be loaded.", 503);
    if (!data) throw new PublicApiError("Evidence not found.", 404);
    const signed = await client.storage
      .from(CME_EVIDENCE_BUCKET)
      .createSignedUrl(data.storage_path, 60, { download: data.file_name });
    if (signed.error || !signed.data?.signedUrl) throw new PublicApiError("Download unavailable. Try again.", 503);
    return NextResponse.redirect(signed.data.signedUrl, {
      status: 303,
      headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" },
    });
  } catch (error) {
    return error instanceof AuthenticationError
      ? unauthorizedResponse()
      : jsonError(error, error instanceof z.ZodError ? 400 : 500, { log: false });
  }
}

/**
 * Removes one evidence file at its owner's request, with a reason. The row
 * stays as a record of when and why; the stored file is deleted.
 */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string; evidenceId: string }> }) {
  try {
    if (isDemoMode()) throw new PublicApiError("Demo evidence is not stored.", 404);
    const parsed = z.object({ id: z.uuid(), evidenceId: z.uuid() }).parse(await params);
    const client = createAdminClient();
    const user = await requireAuthenticatedUser(request, client);
    const rate = await consumeSubjectApiRateLimit({
      supabase: client,
      subject: { kind: "owner", ownerId: user.id },
      bucket: "cme",
      allowInMemoryFallbackOnUnavailable: false,
    });
    if (rate.limited) return rateLimitJsonResponse("Evidence changes are temporarily rate limited.", rate);
    const body = cmeEvidenceRemovalSchema.safeParse(await readBoundedJson(request).catch(() => null));
    if (!body.success) throw new PublicApiError("Say why the file is being removed (3 to 500 characters).", 400);
    const evidence = await removeCmeEvidence(client, user.id, parsed.id, parsed.evidenceId, body.data.reason);
    return NextResponse.json({ evidence }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return error instanceof AuthenticationError
      ? unauthorizedResponse()
      : jsonError(error, error instanceof z.ZodError ? 400 : 500, { log: false });
  }
}
