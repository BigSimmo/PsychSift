import { NextResponse } from "next/server";
import { z } from "zod";

import {
  allowRateLimitInMemoryFallbackOnUnavailable,
  consumeSubjectApiRateLimit,
  rateLimitJsonResponse,
} from "@/lib/api-rate-limit";
import { cmeEntryGoalSchema } from "@/lib/cme/plan-goals";
import { setOwnerCmeEntryGoal } from "@/lib/cme/plan-goals-repository";
import { isDemoMode } from "@/lib/env";
import { jsonError, publicErrorResponse } from "@/lib/http";
import { createAdminClient } from "@/lib/supabase/admin";
import { AuthenticationError, requireAuthenticatedUser, unauthorizedResponse } from "@/lib/supabase/auth";
import { parseJsonBody } from "@/lib/validation/body";

export const runtime = "nodejs";

const entryIdSchema = z.string().uuid();

/** Set, change or clear which development-plan goal one activity served. */
export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    if (isDemoMode()) {
      return publicErrorResponse("These are example records. Sign in to link activities to your plan.", 400, {
        code: "demo_mode_unavailable",
      });
    }
    const { id } = await context.params;
    const entryId = entryIdSchema.safeParse(id);
    if (!entryId.success) return publicErrorResponse("CPD entry not found.", 404, { code: "cme_entry_not_found" });
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
    const body = await parseJsonBody(request, cmeEntryGoalSchema, "Choose a goal from your plan.");
    await setOwnerCmeEntryGoal(supabase, user.id, entryId.data, body.goalId);
    return NextResponse.json({ entryId: entryId.data, goalId: body.goalId });
  } catch (error) {
    if (error instanceof AuthenticationError) return unauthorizedResponse();
    return jsonError(error);
  }
}
