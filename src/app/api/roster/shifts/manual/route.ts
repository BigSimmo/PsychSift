import { NextResponse } from "next/server";

import {
  allowRateLimitInMemoryFallbackOnUnavailable,
  consumeSubjectApiRateLimit,
  rateLimitJsonResponse,
} from "@/lib/api-rate-limit";
import { isDemoMode } from "@/lib/env";
import { jsonError, publicErrorResponse } from "@/lib/http";
import { detectOwnShiftConflicts } from "@/lib/roster/shifts/diff";
import { onCallManualShiftRequestSchema } from "@/lib/roster/shifts/model";
import { addManualShifts, fetchOwnerShifts } from "@/lib/roster/shifts/repository";
import { createAdminClient } from "@/lib/supabase/admin";
import { AuthenticationError, requireAuthenticatedUser, unauthorizedResponse } from "@/lib/supabase/auth";
import { parseJsonBody } from "@/lib/validation/body";

export const runtime = "nodejs";

/** Add a shift by hand to Roster, optionally repeating weekly. Never touched by an import. */

const noStore = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  try {
    if (isDemoMode()) {
      return publicErrorResponse("Demo mode cannot save a roster. Sign in to add yours.", 400, {
        code: "demo_mode_unavailable",
      });
    }
    const supabase = createAdminClient();
    const user = await requireAuthenticatedUser(request, supabase);
    const rateLimit = await consumeSubjectApiRateLimit({
      supabase,
      subject: { kind: "owner", ownerId: user.id },
      bucket: "roster",
      allowInMemoryFallbackOnUnavailable: allowRateLimitInMemoryFallbackOnUnavailable(),
    });
    if (rateLimit.limited) return rateLimitJsonResponse("Too many requests. Try again shortly.", rateLimit);
    const body = await parseJsonBody(request, onCallManualShiftRequestSchema, "That shift could not be saved.");
    const shifts = await addManualShifts(supabase, user.id, [body.shift], body.repeatWeeks);
    const storedShifts = await fetchOwnerShifts(supabase, user.id, new Date(0));
    const conflicts = detectOwnShiftConflicts([...storedShifts, ...shifts]).filter((conflict) =>
      shifts.some((created) => created.id === conflict.first.id || created.id === conflict.second.id),
    );
    return NextResponse.json({ shifts, conflicts }, { headers: noStore });
  } catch (error) {
    if (error instanceof AuthenticationError) return unauthorizedResponse();
    return jsonError(error);
  }
}
