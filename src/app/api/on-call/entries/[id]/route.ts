import { NextResponse } from "next/server";
import { z } from "zod";

import {
  allowRateLimitInMemoryFallbackOnUnavailable,
  consumeSubjectApiRateLimit,
  rateLimitJsonResponse,
} from "@/lib/api-rate-limit";
import { isDemoMode } from "@/lib/env";
import { jsonError, publicErrorResponse } from "@/lib/http";
import { adminFreeTextProblem } from "@/lib/on-call/free-text-guard";
import { onCallDetailsSchemaFor, onCallEntrySchema } from "@/lib/on-call/entry-model";
import { assertValidLinkedDocumentIds, onCallEntryToRow, rowToOnCallEntry } from "@/lib/on-call/repository";
import { mayPublishSharedOnCallEntry, sharedOnCallEntryRefusedResponse } from "@/lib/on-call/shared-entry-publisher";
import { createAdminClient } from "@/lib/supabase/admin";
import { AuthenticationError, requireAuthenticatedUser, unauthorizedResponse } from "@/lib/supabase/auth";
import { parseJsonBody } from "@/lib/validation/body";
import { parseRouteParams } from "@/lib/validation/params";
import { updateOnCallEntrySchema } from "@/lib/on-call/api-schemas";

export const runtime = "nodejs";

const onCallEntryRouteParamsSchema = z.object({ id: z.string().uuid() });

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: rawId } = await params;
    const { id } = parseRouteParams({ id: rawId }, onCallEntryRouteParamsSchema, "Invalid On Call entry id.");

    if (isDemoMode()) {
      return publicErrorResponse("On Call entries cannot be edited in demo mode.", 400, {
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

    const rawBody = await parseJsonBody(request, z.unknown(), "Invalid request body.");
    const parsedEntry = updateOnCallEntrySchema.safeParse(rawBody);
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

    const entry = onCallEntrySchema.parse({ ...parsedEntry.data, id, details: parsedDetails.data });
    const row = onCallEntryToRow(entry, user.id);

    // Only an administrator may save an entry as shared (owner decision, 25 Oct 2026). Anyone may
    // still make their own entry private, which takes it off every other user's pages.
    if (!row.is_personal && !(await mayPublishSharedOnCallEntry(request, supabase, user))) {
      return sharedOnCallEntryRefusedResponse();
    }

    await assertValidLinkedDocumentIds(supabase, entry.linkedDocumentIds, user.id, row.is_personal);

    // Scoped by id AND owner_id on the same chain: a row that exists but belongs to another
    // owner returns no row here, identically to a row that does not exist at all — this
    // handler never learns which case it was.
    const { data, error } = await supabase
      .from("on_call_entries")
      .update(row)
      .eq("id", id)
      .eq("owner_id", user.id)
      .select("*")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return publicErrorResponse("On Call entry not found.", 404, { code: "on_call_entry_not_found" });

    return NextResponse.json({ entry: { ...rowToOnCallEntry(data as Record<string, unknown>), isOwn: true } });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return unauthorizedResponse();
    }
    return jsonError(error);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: rawId } = await params;
    const { id } = parseRouteParams({ id: rawId }, onCallEntryRouteParamsSchema, "Invalid On Call entry id.");

    if (isDemoMode()) {
      return publicErrorResponse("On Call entries cannot be deleted in demo mode.", 400, {
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

    // Scoped by id AND owner_id on the same chain: deleting an id the caller does not own
    // returns no row, identically to deleting an id that does not exist.
    const { data, error } = await supabase
      .from("on_call_entries")
      .delete()
      .eq("id", id)
      .eq("owner_id", user.id)
      .select("id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return publicErrorResponse("On Call entry not found.", 404, { code: "on_call_entry_not_found" });

    return NextResponse.json({ deleted: true, id });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return unauthorizedResponse();
    }
    return jsonError(error);
  }
}
