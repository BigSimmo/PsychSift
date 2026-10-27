import { NextResponse } from "next/server";

import {
  allowRateLimitInMemoryFallbackOnUnavailable,
  consumeSubjectApiRateLimit,
  rateLimitJsonResponse,
} from "@/lib/api-rate-limit";
import { cmePlanGoalCarrySchema } from "@/lib/cme/plan-goals";
import { carryOwnerCmePlanGoal } from "@/lib/cme/plan-goals-repository";
import { isDemoMode } from "@/lib/env";
import { jsonError, publicErrorResponse } from "@/lib/http";
import { createAdminClient } from "@/lib/supabase/admin";
import { AuthenticationError, requireAuthenticatedUser, unauthorizedResponse } from "@/lib/supabase/auth";
import { parseJsonBody } from "@/lib/validation/body";

export const runtime = "nodejs";

/** Carry one of the owner's goals into the confirmed next year; duplicates are harmless. */
export async function POST(request: Request) {
  try {
    if (isDemoMode()) {
      return publicErrorResponse("These are example records. Sign in to carry a goal.", 400, {
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
    const body = await parseJsonBody(request, cmePlanGoalCarrySchema, "Check the goal and try again.");
    const result = await carryOwnerCmePlanGoal(supabase, user.id, body.sourceYear, body.goalId);
    return NextResponse.json(
      { year: body.sourceYear + 1, ...result },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    if (error instanceof AuthenticationError) return unauthorizedResponse();
    return jsonError(error);
  }
}
