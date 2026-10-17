import { NextResponse } from "next/server";

import {
  allowRateLimitInMemoryFallbackOnUnavailable,
  consumeSubjectApiRateLimit,
  rateLimitJsonResponse,
} from "@/lib/api-rate-limit";
import { ownerHasCalendarFeed, revokeOwnerCalendarFeed, rotateOwnerCalendarFeed } from "@/lib/calendar/feed-repository";
import { isDemoMode } from "@/lib/env";
import { jsonError, publicErrorResponse } from "@/lib/http";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { AuthenticationError, requireAuthenticatedUser, unauthorizedResponse } from "@/lib/supabase/auth";

export const runtime = "nodejs";

/**
 * The signed-in owner's private calendar subscription link: whether one exists
 * (GET), make a new one that replaces any old one (POST), or turn it off
 * (DELETE). The link itself is returned only by POST, once; it is never stored.
 */

async function authorise(request: Request) {
  const supabase = createAdminClient();
  // The owner comes from the validated session only — never from the request.
  const user = await requireAuthenticatedUser(request, supabase);
  const rateLimit = await consumeSubjectApiRateLimit({
    supabase,
    subject: { kind: "owner", ownerId: user.id },
    bucket: "cme",
    allowInMemoryFallbackOnUnavailable: allowRateLimitInMemoryFallbackOnUnavailable(),
  });
  return { supabase, user, rateLimit };
}

function demoRefusal() {
  return publicErrorResponse("Demo mode has no calendar subscription. Sign in to make one.", 400, {
    code: "demo_mode_unavailable",
  });
}

const noStore = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  try {
    if (isDemoMode()) return NextResponse.json({ subscribed: false, available: false }, { headers: noStore });
    const { supabase, user, rateLimit } = await authorise(request);
    if (rateLimit.limited) return rateLimitJsonResponse("Too many requests. Try again shortly.", rateLimit);
    const subscribed = await ownerHasCalendarFeed(supabase, user.id);
    return NextResponse.json({ subscribed, available: true }, { headers: noStore });
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
    const path = await rotateOwnerCalendarFeed(supabase, user.id);
    logger.info("calendar_feed_rotated", { userId: user.id });
    return NextResponse.json({ path }, { headers: noStore });
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
    await revokeOwnerCalendarFeed(supabase, user.id);
    logger.info("calendar_feed_revoked", { userId: user.id });
    return NextResponse.json({ subscribed: false }, { headers: noStore });
  } catch (error) {
    if (error instanceof AuthenticationError) return unauthorizedResponse();
    return jsonError(error);
  }
}
