import { NextResponse } from "next/server";

import {
  allowRateLimitInMemoryFallbackOnUnavailable,
  consumeSubjectApiRateLimit,
  rateLimitJsonResponse,
} from "@/lib/api-rate-limit";
import { isDemoMode } from "@/lib/env";
import { jsonError } from "@/lib/http";
import { createAdminClient } from "@/lib/supabase/admin";
import { AuthenticationError, requireAuthenticatedUser, unauthorizedResponse } from "@/lib/supabase/auth";
import { loadWorkRoleContext } from "@/lib/work-roles/server";

export const runtime = "nodejs";

/**
 * The signed-in person's hospital-side roles, so a screen can choose what to
 * show. Showing is all it decides: every route that acts checks again on the
 * server with `can()` from `@/lib/work-roles/server`.
 */

const noStore = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie, Authorization" };

export async function GET(request: Request) {
  try {
    if (isDemoMode()) return NextResponse.json({ grants: [], demoMode: true }, { headers: noStore });
    const supabase = createAdminClient();
    const user = await requireAuthenticatedUser(request, supabase);
    const rateLimit = await consumeSubjectApiRateLimit({
      supabase,
      subject: { kind: "owner", ownerId: user.id },
      bucket: "work_sync",
      allowInMemoryFallbackOnUnavailable: allowRateLimitInMemoryFallbackOnUnavailable(),
    });
    if (rateLimit.limited) return rateLimitJsonResponse("Too many requests. Try again shortly.", rateLimit);
    const context = await loadWorkRoleContext(supabase, user);
    return NextResponse.json({ grants: context.grants }, { headers: noStore });
  } catch (error) {
    if (error instanceof AuthenticationError) return unauthorizedResponse();
    return jsonError(error);
  }
}
