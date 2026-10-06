import { NextResponse } from "next/server";
import { z } from "zod";

import {
  allowRateLimitInMemoryFallbackOnUnavailable,
  consumeSubjectApiRateLimit,
  rateLimitJsonResponse,
} from "@/lib/api-rate-limit";
import {
  amendClosedCmeEntry,
  assertValidCmeLinkedIds,
  setCmeEntryArchived,
  saveCmeEntry,
  fetchOwnerCmeYear,
  markCmeEntryTranscribed,
  clearCmeEntryTranscribed,
} from "@/lib/cme/repository";
import { cmeEntryAmendSchema, cmeEntryUpdateSchema } from "@/lib/cme/schemas";
import { cmeYearConfigurationState } from "@/lib/cme/year-configuration";
import type { CmeEntry } from "@/lib/cme/types";
import { isDemoMode } from "@/lib/env";
import { jsonError, publicErrorResponse } from "@/lib/http";
import { createAdminClient } from "@/lib/supabase/admin";
import { AuthenticationError, requireAuthenticatedUser, unauthorizedResponse } from "@/lib/supabase/auth";
import { parseJsonBody } from "@/lib/validation/body";
import { parseRouteParams } from "@/lib/validation/params";

export const runtime = "nodejs";

const cmeEntryRouteParamsSchema = z.object({ id: z.string().uuid() });

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: rawId } = await params;
    const { id } = parseRouteParams({ id: rawId }, cmeEntryRouteParamsSchema, "Invalid CPD entry id.");

    if (isDemoMode()) {
      return publicErrorResponse("CPD entries cannot be edited in demo mode.", 400, {
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
      bucket: "cme",
      allowInMemoryFallbackOnUnavailable: allowRateLimitInMemoryFallbackOnUnavailable(),
    });
    if (rateLimit.limited) {
      return rateLimitJsonResponse("CPD requests are rate limited. Try again shortly.", rateLimit);
    }

    // Accepted bodies (plus `{ "archived": boolean }`, handled below):
    // 1. `{ "transcribed": boolean }` — stamp or clear transcribed_at for Copy next / Undo.
    // 2. A full-replace `cmeEntryUpdateSchema` body (every create field required), so a partial
    //    edit cannot silently blank reflection/cost/links via create-schema defaults.
    let rawBody: unknown;
    try {
      rawBody = await parseJsonBody(request);
    } catch {
      return publicErrorResponse("Invalid CPD entry.", 400);
    }
    const copyStateBody =
      rawBody !== null &&
      typeof rawBody === "object" &&
      !Array.isArray(rawBody) &&
      Object.keys(rawBody as object).length === 1 &&
      typeof (rawBody as { transcribed?: unknown }).transcribed === "boolean";

    if (copyStateBody) {
      const entry = (rawBody as { transcribed: boolean }).transcribed
        ? await markCmeEntryTranscribed(supabase, user.id, id)
        : await clearCmeEntryTranscribed(supabase, user.id, id);
      return NextResponse.json({ entry });
    }

    const archiveBody = z.object({ archived: z.boolean() }).strict().safeParse(rawBody);
    if (archiveBody.success) {
      const entry = await setCmeEntryArchived(supabase, user.id, id, archiveBody.data.archived);
      return NextResponse.json({ entry });
    }

    // 3. An amendment to an activity in a closed year: the complete record plus a reason. The
    //    database keeps the previous version, the new one and the reason, dated, beside the
    //    closing snapshot, which never changes.
    if (rawBody !== null && typeof rawBody === "object" && !Array.isArray(rawBody) && "amendmentReason" in rawBody) {
      const amendment = cmeEntryAmendSchema.safeParse(rawBody);
      if (!amendment.success) {
        return publicErrorResponse("Invalid CPD amendment. A reason of 3 to 1000 characters is required.", 400);
      }
      const { amendmentReason, ...fields } = amendment.data;
      await assertValidCmeLinkedIds(supabase, user.id, {
        routineId: fields.routineId,
        documentId: fields.documentId,
      });
      const amended = await amendClosedCmeEntry(
        supabase,
        user.id,
        {
          id,
          date: fields.date,
          title: fields.title,
          allocations: fields.allocations,
          reflection: fields.reflection,
          costCents: fields.costCents,
          // Not written by an amendment; the database keeps the stored value.
          transcribed: false,
          routineId: fields.routineId,
          documentId: fields.documentId,
          sourceUrl: fields.sourceUrl,
          buckets: fields.buckets,
          formalPeerReviewHours: fields.formalPeerReviewHours,
        },
        amendmentReason,
      );
      return NextResponse.json({ entry: amended });
    }

    const parsed = cmeEntryUpdateSchema.safeParse(rawBody);
    if (!parsed.success) return publicErrorResponse("Invalid CPD entry.", 400);
    const body = parsed.data;

    // `transcribed` is not part of a full replace — read it off the existing row and carry
    // it forward so editing title/cost cannot silently un-transcribe the entry.
    const { data: existingRow, error: existingError } = await supabase
      .from("cme_entries")
      .select("transcribed_at, source_url")
      .eq("id", id)
      .eq("owner_id", user.id)
      .maybeSingle();
    if (existingError) throw new Error(existingError.message);
    if (!existingRow) return publicErrorResponse("CPD entry not found.", 404, { code: "cme_entry_not_found" });

    const targetYear = Number(body.date.slice(0, 4));
    const yearRow = await fetchOwnerCmeYear(supabase, user.id, targetYear);
    if (cmeYearConfigurationState(yearRow) === "unavailable") {
      return publicErrorResponse("Your saved CPD targets could not be read. They have not been changed.", 503, {
        code: "cme_year_unavailable",
      });
    }
    if (!yearRow || cmeYearConfigurationState(yearRow) !== "ready") {
      return publicErrorResponse(`Confirm your CPD targets for ${targetYear} before moving an entry there.`, 400, {
        code: "cme_year_not_confirmed",
      });
    }

    await assertValidCmeLinkedIds(supabase, user.id, {
      routineId: body.routineId,
      documentId: body.documentId,
    });

    const entry: CmeEntry = {
      id,
      date: body.date,
      title: body.title,
      allocations: body.allocations,
      reflection: body.reflection,
      costCents: body.costCents,
      transcribed: (existingRow as Record<string, unknown>).transcribed_at != null,
      routineId: body.routineId,
      documentId: body.documentId,
      sourceUrl: body.sourceUrl === undefined ? (existingRow.source_url ?? null) : body.sourceUrl,
      buckets: body.buckets,
      formalPeerReviewHours: body.formalPeerReviewHours,
    };
    const saved = await saveCmeEntry(supabase, user.id, yearRow.id, entry);
    return NextResponse.json({ entry: saved });
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
    const { id } = parseRouteParams({ id: rawId }, cmeEntryRouteParamsSchema, "Invalid CPD entry id.");

    if (isDemoMode()) {
      return publicErrorResponse("CPD entries cannot be deleted in demo mode.", 400, {
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
      bucket: "cme",
      allowInMemoryFallbackOnUnavailable: allowRateLimitInMemoryFallbackOnUnavailable(),
    });
    if (rateLimit.limited) {
      return rateLimitJsonResponse("CPD requests are rate limited. Try again shortly.", rateLimit);
    }

    // Retain records and evidence; the legacy DELETE endpoint now archives reversibly.
    const entry = await setCmeEntryArchived(supabase, user.id, id, true);
    return NextResponse.json({ archived: true, entry });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return unauthorizedResponse();
    }
    return jsonError(error);
  }
}
