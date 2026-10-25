import { NextResponse } from "next/server";

import {
  allowRateLimitInMemoryFallbackOnUnavailable,
  consumeSubjectApiRateLimit,
  rateLimitJsonResponse,
} from "@/lib/api-rate-limit";
import { isDemoMode } from "@/lib/env";
import { demoRosterLeave } from "@/lib/roster/team/demo-team";
import { rosterTeamReleaseEnabled } from "@/lib/roster/team/release";
import { jsonError, publicErrorResponse } from "@/lib/http";
import {
  createOwnerLeave,
  createLeaveSchema,
  deleteOwnerLeave,
  deleteLeaveSchema,
  listOwnerLeave,
  updateOwnerLeave,
  updateLeaveSchema,
} from "@/lib/roster/leave";
import { createAdminClient } from "@/lib/supabase/admin";
import { AuthenticationError, requireAuthenticatedUser, unauthorizedResponse } from "@/lib/supabase/auth";
import { parseJsonBody } from "@/lib/validation/body";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie, Authorization" };

async function authorised(request: Request) {
  const client = createAdminClient();
  const user = await requireAuthenticatedUser(request, client);
  const rate = await consumeSubjectApiRateLimit({
    supabase: client,
    subject: { kind: "owner", ownerId: user.id },
    bucket: "roster",
    allowInMemoryFallbackOnUnavailable: allowRateLimitInMemoryFallbackOnUnavailable(),
  });
  return { client, ownerId: user.id, rate };
}

/**
 * Release held: the signed-in reader sees the sample team's example leave, and
 * a change is checked and answered as if it were saved. Nothing is stored. The
 * same `roster` rate limit applies, because each answer still parses the body.
 */
async function sampleLeave(request: Request, operation: "GET" | "POST" | "PATCH" | "DELETE") {
  const { rate } = await authorised(request);
  if (rate.limited) return rateLimitJsonResponse("Too many requests. Try again shortly.", rate);
  const [example] = demoRosterLeave();
  if (operation === "GET") return NextResponse.json({ leave: [example] }, { headers });
  if (operation === "POST") {
    const body = await parseJsonBody(request, createLeaveSchema, "Check the leave details and try again.");
    return NextResponse.json({ leave: { id: crypto.randomUUID(), ...body } }, { status: 201, headers });
  }
  if (operation === "PATCH") {
    const body = await parseJsonBody(request, updateLeaveSchema, "Check the leave details and try again.");
    return NextResponse.json({ leave: { ...example, ...body } }, { headers });
  }
  await parseJsonBody(request, deleteLeaveSchema, "Choose the leave entry to delete.");
  return NextResponse.json({ ok: true }, { headers });
}

async function run(request: Request, operation: "GET" | "POST" | "PATCH" | "DELETE") {
  try {
    if (isDemoMode()) {
      if (operation === "GET") return NextResponse.json({ leave: demoRosterLeave() }, { headers });
      return publicErrorResponse("Sign in to use your own leave.", 400, { code: "demo_mode_unavailable" });
    }
    if (!rosterTeamReleaseEnabled()) return await sampleLeave(request, operation);
    const { client, ownerId, rate } = await authorised(request);
    if (rate.limited) return rateLimitJsonResponse("Too many requests. Try again shortly.", rate);
    if (operation === "GET") return NextResponse.json({ leave: await listOwnerLeave(client, ownerId) }, { headers });
    if (operation === "POST") {
      const body = await parseJsonBody(request, createLeaveSchema, "Check the leave details and try again.");
      return NextResponse.json({ leave: await createOwnerLeave(client, ownerId, body) }, { status: 201, headers });
    }
    if (operation === "PATCH") {
      const body = await parseJsonBody(request, updateLeaveSchema, "Check the leave details and try again.");
      return NextResponse.json({ leave: await updateOwnerLeave(client, ownerId, body) }, { headers });
    }
    const body = await parseJsonBody(request, deleteLeaveSchema, "Choose the leave entry to delete.");
    await deleteOwnerLeave(client, ownerId, body.id);
    return NextResponse.json({ ok: true }, { headers });
  } catch (error) {
    const response = error instanceof AuthenticationError ? unauthorizedResponse() : jsonError(error);
    for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
    return response;
  }
}

export const GET = (request: Request) => run(request, "GET");
export const POST = (request: Request) => run(request, "POST");
export const PATCH = (request: Request) => run(request, "PATCH");
export const DELETE = (request: Request) => run(request, "DELETE");
