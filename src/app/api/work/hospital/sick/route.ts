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
import { readHospitalSickCalls } from "@/lib/work-roles/hospital-sick";
import { loadWorkRoleContext } from "@/lib/work-roles/server";

export const runtime = "nodejs";

/** Sick calls across one hospital's teams, for Medical Workforce and the site administrator. */

const noStore = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie, Authorization" };

export async function GET(request: Request) {
  try {
    if (isDemoMode()) {
      return publicErrorResponse("Roles can't be kept in PsychSift yet.", 503, { code: "work_roles_not_ready" });
    }
    const hospitalId = new URL(request.url).searchParams.get("hospitalId") ?? "";
    if (!/^[0-9a-f-]{36}$/i.test(hospitalId)) {
      return publicErrorResponse("Choose a hospital.", 400, { code: "work_people_invalid" });
    }
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
    return NextResponse.json(await readHospitalSickCalls(supabase, context, hospitalId), { headers: noStore });
  } catch (error) {
    if (error instanceof AuthenticationError) return unauthorizedResponse();
    return jsonError(error);
  }
}
