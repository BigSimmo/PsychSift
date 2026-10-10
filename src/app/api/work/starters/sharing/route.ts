import { NextResponse } from "next/server";
import { z } from "zod";

import {
  allowRateLimitInMemoryFallbackOnUnavailable,
  consumeSubjectApiRateLimit,
  rateLimitJsonResponse,
} from "@/lib/api-rate-limit";
import { isDemoMode } from "@/lib/env";
import { jsonError, publicErrorResponse } from "@/lib/http";
import { createAdminClient } from "@/lib/supabase/admin";
import { AuthenticationError, requireAuthenticatedUser, unauthorizedResponse } from "@/lib/supabase/auth";
import { parseJsonBody } from "@/lib/validation/body";
import { fetchStarterSharing, writeStarterSharing } from "@/lib/work-roles/starter-sharing";

export const runtime = "nodejs";

/**
 * The signed-in doctor's own choice to share their New job progress with Medical Workforce. Off
 * until they turn it on. Reads and writes only their own `user_preferences` row; see
 * `@/lib/work-roles/starter-sharing`.
 */

const noStore = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie, Authorization" };

const putSchema = z.object({ share: z.boolean() }).strict();

async function authorise(request: Request) {
  const supabase = createAdminClient();
  const user = await requireAuthenticatedUser(request, supabase);
  const rateLimit = await consumeSubjectApiRateLimit({
    supabase,
    subject: { kind: "owner", ownerId: user.id },
    bucket: "work_sync",
    allowInMemoryFallbackOnUnavailable: allowRateLimitInMemoryFallbackOnUnavailable(),
  });
  return { supabase, user, rateLimit };
}

function demoUnavailable() {
  return publicErrorResponse("Sharing can't be kept in PsychSift yet.", 503, { code: "work_roles_not_ready" });
}

export async function GET(request: Request) {
  try {
    if (isDemoMode()) return demoUnavailable();
    const { supabase, user, rateLimit } = await authorise(request);
    if (rateLimit.limited) return rateLimitJsonResponse("Too many requests. Try again shortly.", rateLimit);
    const choice = await fetchStarterSharing(supabase, user.id);
    return NextResponse.json({ share: choice.workforce }, { headers: noStore });
  } catch (error) {
    if (error instanceof AuthenticationError) return unauthorizedResponse();
    return jsonError(error);
  }
}

export async function PUT(request: Request) {
  try {
    if (isDemoMode()) return demoUnavailable();
    const { supabase, user, rateLimit } = await authorise(request);
    if (rateLimit.limited) return rateLimitJsonResponse("Too many requests. Try again shortly.", rateLimit);
    const body = await parseJsonBody(request, putSchema, "That choice could not be saved.");
    const choice = await writeStarterSharing(supabase, user.id, body.share);
    return NextResponse.json({ share: choice.workforce }, { headers: noStore });
  } catch (error) {
    if (error instanceof AuthenticationError) return unauthorizedResponse();
    return jsonError(error);
  }
}
