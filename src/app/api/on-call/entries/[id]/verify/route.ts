import { NextResponse } from "next/server";
import { z } from "zod";

import {
  allowRateLimitInMemoryFallbackOnUnavailable,
  consumeSubjectApiRateLimit,
  rateLimitJsonResponse,
} from "@/lib/api-rate-limit";
import { isDemoMode } from "@/lib/env";
import { jsonError, publicErrorResponse } from "@/lib/http";
import { rowToOnCallEntry } from "@/lib/on-call/repository";
import { mayPublishSharedOnCallEntry, sharedOnCallEntryRefusedResponse } from "@/lib/on-call/shared-entry-publisher";
import { createAdminClient } from "@/lib/supabase/admin";
import { AuthenticationError, requireAuthenticatedUser, unauthorizedResponse } from "@/lib/supabase/auth";
import { readBoundedJson } from "@/lib/validation/body";
import { parseRouteParams } from "@/lib/validation/params";

export const runtime = "nodejs";

const onCallEntryRouteParamsSchema = z.object({ id: z.string().uuid() });
const verificationPreconditionSchema = z.object({ expectedUpdatedAt: z.string().datetime({ offset: true }) }).strict();

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: rawId } = await params;
    const { id } = parseRouteParams({ id: rawId }, onCallEntryRouteParamsSchema, "Invalid On Call entry id.");

    if (isDemoMode()) {
      return publicErrorResponse("On Call entries cannot be verified in demo mode.", 400, {
        code: "demo_mode_unavailable",
      });
    }

    const supabase = createAdminClient();
    // The owner comes from the validated session only — never from the request body or a
    // query string.
    const user = await requireAuthenticatedUser(request, supabase);

    const rateLimit = await consumeSubjectApiRateLimit({
      supabase,
      subject: { kind: "owner", ownerId: user.id },
      bucket: "on_call",
      allowInMemoryFallbackOnUnavailable: allowRateLimitInMemoryFallbackOnUnavailable(),
    });
    if (rateLimit.limited) {
      return rateLimitJsonResponse("On Call requests are rate limited. Try again shortly.", rateLimit);
    }

    const rawPrecondition = await readBoundedJson(request, 512);
    if (!rawPrecondition || typeof rawPrecondition !== "object" || !("expectedUpdatedAt" in rawPrecondition)) {
      return publicErrorResponse("Reload this entry before confirming it.", 428, {
        code: "on_call_verification_precondition_required",
      });
    }
    const precondition = verificationPreconditionSchema.safeParse(rawPrecondition);
    if (!precondition.success) return publicErrorResponse("Invalid verification precondition.", 400);

    // A shared entry's checked date is shown to every signed-in user, so only an administrator
    // may stamp one (owner decision, 25 Oct 2026); anyone else verifies their private entries.
    const mayVerifyShared = await mayPublishSharedOnCallEntry(request, supabase, user);
    const verifiable = mayVerifyShared ? [true, false] : [true];

    // Scoped by id AND owner_id on the same chain: an id the caller does not own returns no
    // row here, identically to an id that does not exist.
    const { data, error } = await supabase
      .from("on_call_entries")
      .update({ last_verified_at: new Date().toISOString() })
      .eq("id", id)
      .eq("owner_id", user.id)
      // One atomic UPDATE predicate: an edit between the reviewed read and this
      // write must not receive a verification stamp for unseen content.
      .eq("updated_at", precondition.data.expectedUpdatedAt)
      .in("is_personal", verifiable)
      .select("*")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) {
      // Say why when the caller's own entry is a shared one, rather than calling it missing.
      const { data: own, error: ownError } = await supabase
        .from("on_call_entries")
        .select("is_personal")
        .eq("id", id)
        .eq("owner_id", user.id)
        .maybeSingle();
      if (ownError) throw new Error(ownError.message);
      if (!mayVerifyShared && (own as { is_personal?: unknown } | null)?.is_personal === false)
        return sharedOnCallEntryRefusedResponse();
      if (own)
        return publicErrorResponse(
          "This entry changed while confirming. Reload it and review the latest content.",
          409,
          { code: "on_call_entry_changed" },
        );
      return publicErrorResponse("On Call entry not found.", 404, { code: "on_call_entry_not_found" });
    }

    return NextResponse.json({ entry: { ...rowToOnCallEntry(data as Record<string, unknown>), isOwn: true } });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return unauthorizedResponse();
    }
    return jsonError(error);
  }
}
