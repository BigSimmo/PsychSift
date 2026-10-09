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
import { applyPeopleChange, peopleChangeSchema, readPeople } from "@/lib/work-roles/people";
import { loadWorkRoleContext } from "@/lib/work-roles/server";

export const runtime = "nodejs";

/**
 * People and roles: read and change who holds Medical Workforce, DCT and
 * supervisor in a hospital. The actor's own roles are read fresh on every call
 * and every change is checked against them in `@/lib/work-roles/people`.
 */

const noStore = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie, Authorization" };

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

function demoRefusal() {
  return publicErrorResponse("Roles can't be kept in PsychSift yet.", 503, { code: "work_roles_not_ready" });
}

export async function GET(request: Request) {
  try {
    if (isDemoMode()) return demoRefusal();
    const { supabase, user, rateLimit } = await authorise(request);
    if (rateLimit.limited) return rateLimitJsonResponse("Too many requests. Try again shortly.", rateLimit);
    const hospitalId = new URL(request.url).searchParams.get("hospitalId");
    const context = await loadWorkRoleContext(supabase, user);
    const view = await readPeople(
      supabase,
      context,
      hospitalId && /^[0-9a-f-]{36}$/i.test(hospitalId) ? hospitalId : null,
    );
    return NextResponse.json(view, { headers: noStore });
  } catch (error) {
    if (error instanceof AuthenticationError) return unauthorizedResponse();
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    if (isDemoMode()) return demoRefusal();
    const { supabase, user, rateLimit } = await authorise(request);
    if (rateLimit.limited) return rateLimitJsonResponse("Too many requests. Try again shortly.", rateLimit);
    const change = await parseJsonBody(request, peopleChangeSchema, "Check the role change and try again.");
    const context = await loadWorkRoleContext(supabase, user);
    const view = await applyPeopleChange(supabase, context, change);
    return NextResponse.json(view, { headers: noStore });
  } catch (error) {
    if (error instanceof AuthenticationError) return unauthorizedResponse();
    return jsonError(error);
  }
}
