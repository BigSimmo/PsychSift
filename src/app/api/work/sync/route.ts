import { NextResponse } from "next/server";

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
import { fetchWorkSyncState, workSyncPutSchema, writeWorkSyncSection } from "@/lib/work-sync/account-work-sync";

export const runtime = "nodejs";

/**
 * The account copy of the work-mode choices that follow the doctor between
 * devices (saved work pages, My Day's hidden cards, moved-to-tomorrow items and
 * quick note). Stored at `user_preferences.preferences.work`; see
 * `@/lib/work-sync/account-work-sync` for why this is the only route that
 * writes that key.
 */

const noStore = { "Cache-Control": "no-store" };

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

export async function GET(request: Request) {
  try {
    if (isDemoMode()) return NextResponse.json({ sections: {}, demoMode: true }, { headers: noStore });
    const { supabase, user, rateLimit } = await authorise(request);
    if (rateLimit.limited) return rateLimitJsonResponse("Too many requests. Try again shortly.", rateLimit);
    const sections = await fetchWorkSyncState(supabase, user.id);
    return NextResponse.json({ sections }, { headers: noStore });
  } catch (error) {
    if (error instanceof AuthenticationError) return unauthorizedResponse();
    return jsonError(error);
  }
}

export async function PUT(request: Request) {
  try {
    if (isDemoMode()) {
      return publicErrorResponse("Demo mode keeps choices on this device only.", 400, {
        code: "demo_mode_unavailable",
      });
    }
    const { supabase, user, rateLimit } = await authorise(request);
    if (rateLimit.limited) return rateLimitJsonResponse("Too many requests. Try again shortly.", rateLimit);
    const body = await parseJsonBody(request, workSyncPutSchema, "That choice could not be saved to your account.");
    const entry = await writeWorkSyncSection(supabase, user.id, body.section, body.value);
    return NextResponse.json({ section: body.section, ...entry }, { headers: noStore });
  } catch (error) {
    if (error instanceof AuthenticationError) return unauthorizedResponse();
    return jsonError(error);
  }
}
