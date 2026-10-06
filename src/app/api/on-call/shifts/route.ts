import { NextResponse } from "next/server";
import { z } from "zod";

import {
  allowRateLimitInMemoryFallbackOnUnavailable,
  consumeSubjectApiRateLimit,
  rateLimitJsonResponse,
} from "@/lib/api-rate-limit";
import { GET as rosterGet, POST as rosterPost } from "@/app/api/roster/shifts/route";
import { isDemoMode } from "@/lib/env";
import { jsonError, publicErrorResponse } from "@/lib/http";
import { deleteOwnerShifts } from "@/lib/roster/shifts/repository";
import { createAdminClient } from "@/lib/supabase/admin";
import { AuthenticationError, requireAuthenticatedUser, unauthorizedResponse } from "@/lib/supabase/auth";
import { parseJsonBody } from "@/lib/validation/body";
import { onCallShiftInputSchema, ON_CALL_SHIFT_IMPORT_MAX } from "@/lib/roster/shifts/model";

const perthDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const legacyOnCallShiftImportSchema = z
  .object({
    format: z.enum(["ics", "csv", "xlsx", "pdf", "link"]),
    windowStart: perthDate,
    windowEnd: perthDate,
    shifts: z.array(onCallShiftInputSchema).max(ON_CALL_SHIFT_IMPORT_MAX),
  })
  .strict()
  .refine((body) => body.windowEnd >= body.windowStart, { message: "The roster dates are the wrong way round." });
/**
 * My shifts moved to Roster. This path stays live so a page opened before the
 * move keeps working, on the terms it was written for: a save without a
 * workplace or file name, and a delete of shifts and import records only.
 * Calendar links and Roster settings did not exist for that page, so its
 * delete never touches them. Roster's own delete is `DELETE /api/roster/shifts`.
 */
export const runtime = "nodejs";

const noStore = { "Cache-Control": "no-store" };

/**
 * Roster's own read, minus its example roster: On Call must never treat the
 * sample doctor's invented shifts as the reader's real shift.
 */
export async function GET(request: Request) {
  const response = await rosterGet(request);
  if (!response.ok) return response;
  const body: unknown = await response
    .clone()
    .json()
    .catch(() => null);
  if (isRecord(body) && body.sample === true) {
    return NextResponse.json({ shifts: [], latestImport: null }, { headers: noStore });
  }
  return response;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await parseJsonBody(request, legacyOnCallShiftImportSchema, "That roster could not be saved.");
  } catch (error) {
    return jsonError(error);
  }
  // An old page sends no workplace or file name: its roster belonged to no named workplace.
  const adapted = isRecord(body) ? { workplace: null, fileName: null, ...body } : body;
  const headers = new Headers(request.headers);
  headers.delete("content-length");
  return rosterPost(new Request(request.url, { method: "POST", headers, body: JSON.stringify(adapted) }));
}

export async function DELETE(request: Request) {
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
    await deleteOwnerShifts(supabase, user.id);
    return NextResponse.json({ shifts: [], latestImport: null }, { headers: noStore });
  } catch (error) {
    if (error instanceof AuthenticationError) return unauthorizedResponse();
    return jsonError(error);
  }
}
