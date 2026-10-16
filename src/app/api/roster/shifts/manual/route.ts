import { NextResponse } from "next/server";

import {
  allowRateLimitInMemoryFallbackOnUnavailable,
  consumeSubjectApiRateLimit,
  rateLimitJsonResponse,
} from "@/lib/api-rate-limit";
import { isDemoMode } from "@/lib/env";
import { jsonError, publicErrorResponse } from "@/lib/http";
import { detectOwnShiftConflicts } from "@/lib/roster/shifts/diff";
import { onCallManualShiftRequestSchema, type OnCallShift } from "@/lib/roster/shifts/model";
import { addManualShifts, fetchOwnerShiftsBetween } from "@/lib/roster/shifts/repository";
import { createAdminClient } from "@/lib/supabase/admin";
import { AuthenticationError, requireAuthenticatedUser, unauthorizedResponse } from "@/lib/supabase/auth";
import { parseJsonBody } from "@/lib/validation/body";

export const runtime = "nodejs";

/** Add a shift by hand to Roster, optionally repeating weekly. Never touched by an import. */

const noStore = { "Cache-Control": "no-store" };

/**
 * Overlaps between the shifts just added and anything already on the owner's roster. The new rows are already
 * stored, so they are left out of the stored set (or each would overlap itself), and only pairs that involve a
 * new shift are reported.
 */
async function conflictsWithNewShifts(
  supabase: ReturnType<typeof createAdminClient>,
  ownerId: string,
  created: OnCallShift[],
) {
  if (created.length === 0) return [];
  const createdIds = new Set(created.map((shift) => shift.id));
  const from = new Date(Math.min(...created.map((shift) => Date.parse(shift.startsAt))));
  const to = new Date(Math.max(...created.map((shift) => Date.parse(shift.endsAt))));
  const others = (await fetchOwnerShiftsBetween(supabase, ownerId, from, to)).filter(
    (stored) => !createdIds.has(stored.id),
  );
  const added = new Set<unknown>(created);
  // The conflict pairs hold the very objects passed in, so membership is by identity.
  return detectOwnShiftConflicts([...others, ...created]).filter(
    (conflict) => added.has(conflict.first) || added.has(conflict.second),
  );
}

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
    const conflicts = await conflictsWithNewShifts(supabase, user.id, shifts);
    return NextResponse.json({ shifts, conflicts }, { headers: noStore });
  } catch (error) {
    if (error instanceof AuthenticationError) return unauthorizedResponse();
    return jsonError(error);
  }
}
