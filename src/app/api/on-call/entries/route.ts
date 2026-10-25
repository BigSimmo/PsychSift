import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";

import {
  allowRateLimitInMemoryFallbackOnUnavailable,
  consumeSubjectApiRateLimit,
  rateLimitJsonResponse,
} from "@/lib/api-rate-limit";
import { isDemoMode } from "@/lib/env";
// One declaration of the request shapes, shared with the [id] route: create and
// update must not be able to drift apart.
import { createOnCallEntrySchema } from "@/lib/on-call/api-schemas";
import { DEMO_ON_CALL_ENTRIES } from "@/lib/on-call/demo-entries";
import { jsonError, publicErrorResponse } from "@/lib/http";
import { adminFreeTextProblem } from "@/lib/on-call/free-text-guard";
import {
  ON_CALL_SECTIONS,
  onCallDetailsSchemaFor,
  onCallEntrySchema,
  type OnCallSection,
} from "@/lib/on-call/entry-model";
import {
  assertValidLinkedDocumentIds,
  fetchVisibleOnCallEntries,
  onCallEntryToRow,
  rowToOnCallEntry,
} from "@/lib/on-call/repository";
import { mayPublishSharedOnCallEntry, sharedOnCallEntryRefusedResponse } from "@/lib/on-call/shared-entry-publisher";
import { publicAccessContext } from "@/lib/public-api-access";
import { createAdminClient } from "@/lib/supabase/admin";
import { AuthenticationError, requireAuthenticatedUser, unauthorizedResponse } from "@/lib/supabase/auth";
import { parseJsonBody } from "@/lib/validation/body";
import { parseRequestQuery } from "@/lib/validation/query";

export const runtime = "nodejs";

const onCallListQuerySchema = z.object({
  section: z.enum(ON_CALL_SECTIONS).optional(),
});

/**
 * Obviously synthetic, non-clinical fixture entries shown only in demo mode.
 * No real organisation, phone number, or clinical content — demo mode never
 * reaches Supabase for this mode. The corpus lives in
 * `src/lib/on-call/demo-entries.ts` so the browser suite can assert against the
 * same rows a visitor sees.
 */
function demoOnCallEntries(section: OnCallSection | undefined) {
  return section ? DEMO_ON_CALL_ENTRIES.filter((entry) => entry.section === section) : DEMO_ON_CALL_ENTRIES;
}

export async function GET(request: Request) {
  try {
    const { section } = parseRequestQuery(request, onCallListQuerySchema, "Invalid On Call query.");

    if (isDemoMode()) {
      return NextResponse.json({ entries: demoOnCallEntries(section), signedOut: false, demoMode: true });
    }

    // Anonymous callers still resolve access + rate limit, matching the registry route: every
    // caller (authenticated or not) passes the limiter before we do anything else. The database
    // is never touched below this point when the caller has no owner id.
    const supabase = createAdminClient();
    const access = await publicAccessContext(request, supabase);

    const rateLimit = await consumeSubjectApiRateLimit({
      supabase,
      subject: access.rateLimitSubject,
      bucket: "on_call",
      allowInMemoryFallbackOnUnavailable: allowRateLimitInMemoryFallbackOnUnavailable(),
    });
    if (rateLimit.limited) {
      return rateLimitJsonResponse("On Call requests are rate limited. Try again shortly.", rateLimit);
    }

    // Shared entries are readable by any signed-in user; an anonymous caller gets none (owner
    // decision 2026-09-26, reversing the 2026-09-04 anonymous read — see the visibility note on
    // fetchSharedOnCallEntries). `signedOut: true` is what the client shows its sign-in state on.
    if (!access.ownerId) return NextResponse.json({ entries: [], signedOut: true });
    const entries = await fetchVisibleOnCallEntries(supabase, access.ownerId, { section });
    return NextResponse.json({ entries, signedOut: false });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return unauthorizedResponse();
    }
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    if (isDemoMode()) {
      return publicErrorResponse("On Call entries cannot be created in demo mode.", 400, {
        code: "demo_mode_unavailable",
      });
    }

    const supabase = createAdminClient();
    // The owner comes from the validated session only — never from the request body or a
    // query string.
    const user = await requireAuthenticatedUser(request, supabase);

    const rateLimit = await consumeSubjectApiRateLimit({
      supabase,
      subject: { kind: "owner", ownerId: user.id },
      bucket: "on_call",
      allowInMemoryFallbackOnUnavailable: allowRateLimitInMemoryFallbackOnUnavailable(),
    });
    if (rateLimit.limited) {
      return rateLimitJsonResponse("On Call requests are rate limited. Try again shortly.", rateLimit);
    }

    // Read the raw (size-bounded) body first, then validate it against the entry contract and,
    // separately, its section-specific `details` shape — so a failure of either can report its
    // own Zod issues instead of one opaque "invalid body" message.
    const rawBody = await parseJsonBody(request, z.unknown(), "Invalid request body.");
    const parsedEntry = createOnCallEntrySchema.safeParse(rawBody);
    if (!parsedEntry.success) {
      // One envelope for every public error in this repository
      // (`apiErrorPayloadSchema`, enforced by tests/api-validation-contract.test.ts), so the
      // raw Zod issue list stays server-side. The two messages below are what tells a caller
      // which half of the contract it failed.
      return publicErrorResponse("Invalid On Call entry.", 400);
    }
    const parsedDetails = onCallDetailsSchemaFor(parsedEntry.data.section).safeParse(parsedEntry.data.details);
    if (!parsedDetails.success) {
      return publicErrorResponse("Invalid On Call entry details.", 400);
    }
    const problem = adminFreeTextProblem({ ...parsedEntry.data, details: parsedDetails.data });
    if (problem) return publicErrorResponse(problem, 400, { code: "free_text_identifier" });

    const entry = onCallEntrySchema.parse({
      ...parsedEntry.data,
      id: randomUUID(),
      details: parsedDetails.data,
    });
    const row = onCallEntryToRow(entry, user.id);

    // A shared entry is read by every signed-in user, so only an administrator may create one
    // (owner decision, 25 Oct 2026). Decided on the row as it will be stored, after
    // onCallEntryToRow has forced compliance requirements private.
    if (!row.is_personal && !(await mayPublishSharedOnCallEntry(request, supabase, user))) {
      return sharedOnCallEntryRefusedResponse();
    }

    await assertValidLinkedDocumentIds(supabase, entry.linkedDocumentIds, user.id, row.is_personal);

    // `owner_id` is spelled out again here (it is already the same value inside `row`, set by
    // onCallEntryToRow) so the row this owner creates carries an explicit, statically-visible
    // owner stamp on the insert call itself.
    const { data, error } = await supabase
      .from("on_call_entries")
      .insert({ ...row, owner_id: user.id })
      .select("*")
      .single();
    if (error) throw new Error(error.message);

    return NextResponse.json(
      { entry: { ...rowToOnCallEntry(data as Record<string, unknown>), isOwn: true } },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return unauthorizedResponse();
    }
    return jsonError(error);
  }
}
