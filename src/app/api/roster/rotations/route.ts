import { NextResponse } from "next/server";

import { isDemoMode } from "@/lib/env";
import { withRosterApi } from "@/lib/roster/team/api";
import {
  createRotationRound,
  createRoundBodySchema,
  readRotations,
  rotationRuleToPublicError,
  ROTATIONS_NOT_LIVE_MESSAGE,
} from "@/lib/roster/rotations/repository";
import { parseJsonBody } from "@/lib/validation/body";

export const runtime = "nodejs";

/**
 * Rotation preference rounds for the signed-in doctor: the rounds they are in,
 * the rounds they run, and (for a new round) their team and its people. POST
 * creates a draft round. The actor is the session user only; every body is
 * strict, so a body naming an actor is refused with 400.
 *
 * In demo mode and while the real-staff release is held there is no real
 * round to show, so the answer is 503 and the screens offer the example
 * (Roster's example data, kept on the device).
 */

function notLive(): Response {
  return NextResponse.json(
    { error: ROTATIONS_NOT_LIVE_MESSAGE, code: "rotations_not_live" },
    { status: 503, headers: { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie, Authorization" } },
  );
}

export async function GET(request: Request) {
  if (isDemoMode()) return notLive();
  return withRosterApi(request, async (client, actorId) => readRotations(client, actorId), { sample: notLive });
}

export async function POST(request: Request) {
  if (isDemoMode()) return notLive();
  return withRosterApi(
    request,
    async (client, actorId) => {
      const body = await parseJsonBody(request, createRoundBodySchema, "Check the round details and try again.");
      try {
        return await createRotationRound(client, actorId, body);
      } catch (error) {
        throw rotationRuleToPublicError(error);
      }
    },
    { sample: notLive },
  );
}
