import { NextResponse } from "next/server";

import {
  allowRateLimitInMemoryFallbackOnUnavailable,
  consumeSubjectApiRateLimit,
  rateLimitJsonResponse,
} from "@/lib/api-rate-limit";
import { isDemoMode } from "@/lib/env";
import { jsonError, publicErrorResponse } from "@/lib/http";
import { deleteOwnerCalendarLinks } from "@/lib/roster/calendar-links";
import { clearRosterSettings } from "@/lib/roster/settings";
import { removeAllOwnerSubscriptions } from "@/lib/roster/alerts/subscriptions";
import { removeAllOwnerLeave, withdrawRosterRequests } from "@/lib/roster/team/delete-my-data";
import { demoOnCallShifts } from "@/lib/roster/shifts/demo-shifts";
import { shiftIsInWindow } from "@/lib/roster/shifts/diff";
import { onCallShiftImportRequestSchema } from "@/lib/roster/shifts/model";
import {
  deleteOwnerShifts,
  fetchLatestShiftImport,
  fetchOwnerShifts,
  replaceOwnerShifts,
} from "@/lib/roster/shifts/repository";
import { createAdminClient } from "@/lib/supabase/admin";
import { AuthenticationError, requireAuthenticatedUser, unauthorizedResponse } from "@/lib/supabase/auth";
import { parseJsonBody } from "@/lib/validation/body";

export const runtime = "nodejs";

/**
 * My shifts: the signed-in doctor's own roster. List the last three weeks and
 * what is coming up, with the latest import (GET), save an imported roster
 * (POST), or delete all of the doctor's Roster data: calendar links, settings,
 * shifts and imports (DELETE). The owner comes from the validated session
 * only, never the request, and every query is filtered by it.
 */

const noStore = { "Cache-Control": "no-store" };

/**
 * How far back the list reaches: hours, "stayed late", Today's week and the
 * previous week, and an import's preview all need recent past shifts. The
 * calendar feed and On Call's next shift still start from now.
 */
const PAST_SHIFT_DAYS = 21;

function listFrom(now = new Date()): Date {
  return new Date(now.getTime() - PAST_SHIFT_DAYS * 24 * 60 * 60 * 1000);
}

async function authorise(request: Request) {
  const supabase = createAdminClient();
  const user = await requireAuthenticatedUser(request, supabase);
  const rateLimit = await consumeSubjectApiRateLimit({
    supabase,
    subject: { kind: "owner", ownerId: user.id },
    bucket: "roster",
    allowInMemoryFallbackOnUnavailable: allowRateLimitInMemoryFallbackOnUnavailable(),
  });
  return { supabase, user, rateLimit };
}

function demoRefusal() {
  return publicErrorResponse("Demo mode cannot save a roster. Sign in to add yours.", 400, {
    code: "demo_mode_unavailable",
  });
}

export async function GET(request: Request) {
  try {
    if (isDemoMode()) {
      return NextResponse.json(
        { shifts: demoOnCallShifts(new Date()), latestImport: null, demoMode: true },
        { headers: noStore },
      );
    }
    const { supabase, user, rateLimit } = await authorise(request);
    if (rateLimit.limited) return rateLimitJsonResponse("Too many requests. Try again shortly.", rateLimit);
    const [shifts, latestImport] = await Promise.all([
      fetchOwnerShifts(supabase, user.id, listFrom()),
      fetchLatestShiftImport(supabase, user.id),
    ]);
    // No invented sample here: an empty roster is the reader's real, empty
    // roster. The example data switch shows the sample in the browser instead.
    return NextResponse.json({ shifts, latestImport }, { headers: noStore });
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
    const body = await parseJsonBody(request, onCallShiftImportRequestSchema, "That roster could not be saved.");
    const window = { start: body.windowStart, end: body.windowEnd };
    const outOfWindow = body.shifts.some((shift) => !shiftIsInWindow(shift, window));
    if (outOfWindow) {
      return publicErrorResponse("A shift falls outside the roster's dates.", 400, { code: "invalid_body" });
    }
    await replaceOwnerShifts(supabase, user.id, body);
    const [shifts, latestImport] = await Promise.all([
      fetchOwnerShifts(supabase, user.id, listFrom()),
      fetchLatestShiftImport(supabase, user.id),
    ]);
    return NextResponse.json({ shifts, latestImport }, { headers: noStore });
  } catch (error) {
    if (error instanceof AuthenticationError) return unauthorizedResponse();
    return jsonError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    if (isDemoMode()) return demoRefusal();
    const { supabase, user, rateLimit } = await authorise(request);
    if (rateLimit.limited) return rateLimitJsonResponse("Too many requests. Try again shortly.", rateLimit);
    // Delete my data: links first (so no refresh can bring shifts back), then settings, then shifts and imports.
    await deleteOwnerCalendarLinks(supabase, user.id);
    await removeAllOwnerSubscriptions(supabase, user.id);
    await removeAllOwnerLeave(supabase, user.id);
    const cleanup = await withdrawRosterRequests(supabase, user.id);
    await clearRosterSettings(supabase, user.id);
    await deleteOwnerShifts(supabase, user.id);
    return NextResponse.json(
      {
        shifts: [],
        latestImport: null,
        ...(cleanup.skippedTeams
          ? {
              message:
                "Your own data was removed. Some team requests could not be withdrawn; check Requests. Your team keeps its rostered shifts.",
            }
          : {}),
      },
      { headers: noStore },
    );
  } catch (error) {
    if (error instanceof AuthenticationError) return unauthorizedResponse();
    return jsonError(error);
  }
}
