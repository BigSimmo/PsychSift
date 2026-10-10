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
import { readHospitalShortStaffed } from "@/lib/work-roles/hospital-short-staffed";
import { loadWorkRoleContext } from "@/lib/work-roles/server";

export const runtime = "nodejs";

/** Short-staffed days across one hospital's teams, for Medical Workforce and the site administrator. Counts and team names only. */

const noStore = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie, Authorization" };

export async function GET(request: Request) {
  try {
    if (isDemoMode()) {
      return publicErrorResponse("Roles can't be kept in PsychSift yet.", 503, { code: "work_roles_not_ready" });
    }
    const hospitalId = new URL(request.url).searchParams.get("hospitalId") ?? "";
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(hospitalId)) {
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
    return NextResponse.json(await readHospitalShortStaffed(supabase, context, hospitalId), { headers: noStore });
  } catch (error) {
    if (error instanceof AuthenticationError) return unauthorizedResponse();
    return jsonError(error);
  }
}
