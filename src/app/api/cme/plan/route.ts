import { NextResponse } from "next/server";

import {
  allowRateLimitInMemoryFallbackOnUnavailable,
  consumeSubjectApiRateLimit,
  rateLimitJsonResponse,
} from "@/lib/api-rate-limit";
import { cmePlanGoalsSaveSchema } from "@/lib/cme/plan-goals";
import { saveOwnerCmePlanGoals } from "@/lib/cme/plan-goals-repository";
import { fetchOwnerCmeYear } from "@/lib/cme/repository";
import { isDemoMode } from "@/lib/env";
import { jsonError, publicErrorResponse } from "@/lib/http";
import { createAdminClient } from "@/lib/supabase/admin";
import { AuthenticationError, requireAuthenticatedUser, unauthorizedResponse } from "@/lib/supabase/auth";
import { parseJsonBody } from "@/lib/validation/body";

export const runtime = "nodejs";

/** Replace one year's development-plan goals. Refused for a closed year. */
export async function PUT(request: Request) {
  try {
    if (isDemoMode()) {
      return publicErrorResponse("These are example records. Sign in to write your plan.", 400, {
        code: "demo_mode_unavailable",
      });
    }
    const supabase = createAdminClient();
    // The owner comes from the validated session only — never from the request body.
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
    const body = await parseJsonBody(request, cmePlanGoalsSaveSchema, "Check your goals and try again.");
    const year = await fetchOwnerCmeYear(supabase, user.id, body.year);
    if (!year) {
      return publicErrorResponse(`Confirm your CPD targets for ${body.year} before writing its plan.`, 400, {
        code: "cme_year_not_confirmed",
      });
    }
    const goals = await saveOwnerCmePlanGoals(supabase, user.id, year.id, body.goals, body.expectedGoals);
    return NextResponse.json({ year: body.year, goals });
  } catch (error) {
    if (error instanceof AuthenticationError) return unauthorizedResponse();
    return jsonError(error);
  }
}
