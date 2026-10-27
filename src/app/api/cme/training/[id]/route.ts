import { NextResponse } from "next/server";
import { z } from "zod";

import {
  allowRateLimitInMemoryFallbackOnUnavailable,
  consumeSubjectApiRateLimit,
  rateLimitJsonResponse,
} from "@/lib/api-rate-limit";
import { parseTrainingRecordInput, trainingRecordBodySchema, trainingRecordTypeSchema } from "@/lib/cme/training-api";
import {
  deleteOwnerTrainingMilestone,
  deleteOwnerTrainingPeriod,
  updateOwnerTrainingMilestone,
  updateOwnerTrainingPeriod,
} from "@/lib/cme/training-repository";
import { isDemoMode } from "@/lib/env";
import { jsonError, publicErrorResponse } from "@/lib/http";
import { createAdminClient } from "@/lib/supabase/admin";
import { AuthenticationError, requireAuthenticatedUser, unauthorizedResponse } from "@/lib/supabase/auth";
import { parseJsonBody, parseJsonBodyOrDefault } from "@/lib/validation/body";
import { parseRouteParams } from "@/lib/validation/params";
import { parseSchema } from "@/lib/validation/http";

export const runtime = "nodejs";

const idParamsSchema = z.object({ id: z.string().uuid() });

function demoRefusal() {
  return publicErrorResponse("These are example records. Sign in to record your training.", 400, {
    code: "demo_mode_unavailable",
  });
}

async function ownerFor(request: Request) {
  const supabase = createAdminClient();
  // The owner comes from the validated session only — never from the request.
  const user = await requireAuthenticatedUser(request, supabase);
  const limit = await consumeSubjectApiRateLimit({
    supabase,
    subject: { kind: "owner", ownerId: user.id },
    bucket: "cme",
    allowInMemoryFallbackOnUnavailable: allowRateLimitInMemoryFallbackOnUnavailable(),
  });
  return { supabase, user, limit };
}

/** Replace one period or milestone in full; an omitted field can never silently erase a stored one. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (isDemoMode()) return demoRefusal();
    const { supabase, user, limit } = await ownerFor(request);
    if (limit.limited) return rateLimitJsonResponse("CPD requests are rate limited. Try again shortly.", limit);
    const { id } = parseRouteParams(await params, idParamsSchema, "Invalid training record ID.");
    const body = await parseJsonBody(request, trainingRecordBodySchema, "Check the training details and try again.");
    const record = parseTrainingRecordInput(body);
    if (record.type === "period") {
      return NextResponse.json({ period: await updateOwnerTrainingPeriod(supabase, user.id, id, record.input) });
    }
    return NextResponse.json({ milestone: await updateOwnerTrainingMilestone(supabase, user.id, id, record.input) });
  } catch (error) {
    if (error instanceof AuthenticationError) return unauthorizedResponse();
    return jsonError(error);
  }
}

/** Delete one period or milestone. The record type comes from `?type=` or, failing that, the body. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (isDemoMode()) return demoRefusal();
    const { supabase, user, limit } = await ownerFor(request);
    if (limit.limited) return rateLimitJsonResponse("CPD requests are rate limited. Try again shortly.", limit);
    const { id } = parseRouteParams(await params, idParamsSchema, "Invalid training record ID.");
    const queryType = new URL(request.url).searchParams.get("type");
    const bodyType = queryType
      ? undefined
      : (await parseJsonBodyOrDefault(request, z.object({ type: trainingRecordTypeSchema.optional() }), {})).type;
    // A missing type is refused rather than defaulted, so a delete never lands on the wrong table.
    const type = parseSchema(
      trainingRecordTypeSchema,
      queryType ?? bodyType,
      "Say whether this is a period or a milestone.",
    );
    if (type === "period") await deleteOwnerTrainingPeriod(supabase, user.id, id);
    else await deleteOwnerTrainingMilestone(supabase, user.id, id);
    return NextResponse.json({ deleted: true, type, id });
  } catch (error) {
    if (error instanceof AuthenticationError) return unauthorizedResponse();
    return jsonError(error);
  }
}
