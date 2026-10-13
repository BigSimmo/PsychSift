import { NextResponse } from "next/server";
import { z } from "zod";

import {
  allowRateLimitInMemoryFallbackOnUnavailable,
  consumeSubjectApiRateLimit,
  rateLimitJsonResponse,
} from "@/lib/api-rate-limit";
import { isDemoMode } from "@/lib/env";
import { jsonError, publicErrorResponse } from "@/lib/http";
import { cmeMissedSessionCreateSchema, cmeMissedSessionReplacementSchema } from "@/lib/cme/missed-sessions";
import {
  deleteOwnerCmeMissedSession,
  setOwnerCmeMissedSessionReplacement,
  updateOwnerCmeMissedSession,
} from "@/lib/cme/missed-sessions-repository";
import { createAdminClient } from "@/lib/supabase/admin";
import { AuthenticationError, requireAuthenticatedUser, unauthorizedResponse } from "@/lib/supabase/auth";
import { readBoundedJson } from "@/lib/validation/body";
import { parseRouteParams } from "@/lib/validation/params";

export const runtime = "nodejs";

const missedSessionRouteParamsSchema = z.object({ id: z.string().uuid() });

/**
 * Edit a missed session, or set/clear its replacement link.
 *
 * Accepted bodies:
 * 1. `{ "replacementEntryId": "<uuid>" | null }` — link or unlink the ordinary
 *    activity that replaced this session. A replacement the owner does not own
 *    fails the database's composite foreign key, mapped to a 400 below.
 * 2. A full-replace body (every create field), matching `cmeEntryUpdateSchema`'s
 *    idiom so a partial edit cannot silently blank a field.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = parseRouteParams(await params, missedSessionRouteParamsSchema, "Invalid missed session ID.");

    if (isDemoMode()) {
      return publicErrorResponse("Missed sessions cannot be changed in demo mode.", 400, {
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
      bucket: "cme",
      allowInMemoryFallbackOnUnavailable: allowRateLimitInMemoryFallbackOnUnavailable(),
    });
    if (rateLimit.limited) {
      return rateLimitJsonResponse("CPD requests are rate limited. Try again shortly.", rateLimit);
    }

    // Size-capped read (413 over the limit); malformed JSON yields null and fails the schemas below.
    const rawBody = await readBoundedJson(request);

    const replacement = cmeMissedSessionReplacementSchema.safeParse(rawBody);
    if (replacement.success) {
      const missedSession = await setOwnerCmeMissedSessionReplacement(
        supabase,
        user.id,
        id,
        replacement.data.replacementEntryId,
      );
      return NextResponse.json({ missedSession });
    }

    // An edit is a full replace, so it takes the same body as a create.
    const parsed = cmeMissedSessionCreateSchema.safeParse(rawBody);
    if (!parsed.success) return publicErrorResponse("Invalid missed session.", 400);
    const missedSession = await updateOwnerCmeMissedSession(supabase, user.id, id, parsed.data);
    return NextResponse.json({ missedSession });
  } catch (error) {
    if (error instanceof AuthenticationError) return unauthorizedResponse();
    return jsonError(error);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = parseRouteParams(await params, missedSessionRouteParamsSchema, "Invalid missed session ID.");

    if (isDemoMode()) {
      return publicErrorResponse("Missed sessions cannot be deleted in demo mode.", 400, {
        code: "demo_mode_unavailable",
      });
    }

    const supabase = createAdminClient();
    const user = await requireAuthenticatedUser(request, supabase);

    const rateLimit = await consumeSubjectApiRateLimit({
      supabase,
      subject: { kind: "owner", ownerId: user.id },
      bucket: "cme",
      allowInMemoryFallbackOnUnavailable: allowRateLimitInMemoryFallbackOnUnavailable(),
    });
    if (rateLimit.limited) {
      return rateLimitJsonResponse("CPD requests are rate limited. Try again shortly.", rateLimit);
    }

    await deleteOwnerCmeMissedSession(supabase, user.id, id);
    return NextResponse.json({ deleted: true });
  } catch (error) {
    if (error instanceof AuthenticationError) return unauthorizedResponse();
    return jsonError(error);
  }
}
