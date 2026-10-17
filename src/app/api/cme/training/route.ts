import { NextResponse } from "next/server";

import {
  allowRateLimitInMemoryFallbackOnUnavailable,
  consumeSubjectApiRateLimit,
  rateLimitJsonResponse,
} from "@/lib/api-rate-limit";
import { parseTrainingRecordInput, trainingRecordBodySchema } from "@/lib/cme/training-api";
import {
  createOwnerTrainingMilestone,
  createOwnerTrainingPeriod,
  fetchOwnerRegistrarMilestones,
  fetchOwnerTrainingMilestones,
  fetchOwnerTrainingPeriods,
  mergeTrainingAndRegistrarMilestones,
} from "@/lib/cme/training-repository";
import { isDemoMode } from "@/lib/env";
import { jsonError, publicErrorResponse } from "@/lib/http";
import { createAdminClient } from "@/lib/supabase/admin";
import { AuthenticationError, requireAuthenticatedUser, unauthorizedResponse } from "@/lib/supabase/auth";
import { parseJsonBody } from "@/lib/validation/body";

export const runtime = "nodejs";

/** The trainee's own stages, rotations, breaks and milestones. Demo mode has none. */
export async function GET(request: Request) {
  try {
    if (isDemoMode())
      return NextResponse.json({ periods: [], milestones: [], registrarMilestones: [], demoMode: true });
    const supabase = createAdminClient();
    // The owner comes from the validated session only — never from the request.
    const user = await requireAuthenticatedUser(request, supabase);
    const limit = await consumeSubjectApiRateLimit({
      supabase,
      subject: { kind: "owner", ownerId: user.id },
      bucket: "cme",
      allowInMemoryFallbackOnUnavailable: allowRateLimitInMemoryFallbackOnUnavailable(),
    });
    if (limit.limited) return rateLimitJsonResponse("CPD requests are rate limited. Try again shortly.", limit);
    const [periods, rawMilestones, registrarMilestones] = await Promise.all([
      fetchOwnerTrainingPeriods(supabase, user.id),
      fetchOwnerTrainingMilestones(supabase, user.id, { syncRegistrar: false }),
      fetchOwnerRegistrarMilestones(supabase, user.id),
    ]);
    const milestones = mergeTrainingAndRegistrarMilestones(rawMilestones, registrarMilestones);
    return NextResponse.json(
      { periods, milestones, registrarMilestones },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    if (error instanceof AuthenticationError) return unauthorizedResponse();
    return jsonError(error);
  }
}

/** Add one period (`type: "period"`) or milestone (`type: "milestone"`). */
export async function POST(request: Request) {
  try {
    if (isDemoMode()) {
      return publicErrorResponse("Demo mode is read-only. Sign in to record your training.", 400, {
        code: "demo_mode_unavailable",
      });
    }
    const supabase = createAdminClient();
    const user = await requireAuthenticatedUser(request, supabase);
    const limit = await consumeSubjectApiRateLimit({
      supabase,
      subject: { kind: "owner", ownerId: user.id },
      bucket: "cme",
      allowInMemoryFallbackOnUnavailable: allowRateLimitInMemoryFallbackOnUnavailable(),
    });
    if (limit.limited) return rateLimitJsonResponse("CPD requests are rate limited. Try again shortly.", limit);
    const body = await parseJsonBody(request, trainingRecordBodySchema, "Check the training details and try again.");
    const record = parseTrainingRecordInput(body);
    if (record.type === "period") {
      const period = await createOwnerTrainingPeriod(supabase, user.id, record.input);
      return NextResponse.json({ period }, { status: 201 });
    }
    const milestone = await createOwnerTrainingMilestone(supabase, user.id, record.input);
    return NextResponse.json({ milestone }, { status: 201 });
  } catch (error) {
    if (error instanceof AuthenticationError) return unauthorizedResponse();
    return jsonError(error);
  }
}
