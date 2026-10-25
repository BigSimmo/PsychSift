import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import {
  allowRateLimitInMemoryFallbackOnUnavailable,
  consumeSubjectApiRateLimit,
  rateLimitJsonResponse,
} from "@/lib/api-rate-limit";
import { cpdYearOf } from "@/lib/cme/cpd-year";
import { DEMO_CME_ENTRIES, DEMO_CME_INSTANT, DEMO_CME_YEAR } from "@/lib/cme/demo-year";
import { deleteOwnerCmeDraft } from "@/lib/cme/drafts-repository";
import { setOwnerCmeMissedSessionReplacement } from "@/lib/cme/missed-sessions-repository";
import {
  assertNoCmeEntryPatientDetail,
  assertValidCmeLinkedIds,
  fetchOwnerCmeEntries,
  fetchOwnerCmeYear,
  insertCmeEntry,
} from "@/lib/cme/repository";
import { cmeEntryCreateSchema, cmeListQuerySchema } from "@/lib/cme/schemas";
import { cmeYearConfigurationState } from "@/lib/cme/year-configuration";
import type { CmeEntry } from "@/lib/cme/types";
import { isDemoMode } from "@/lib/env";
import { jsonError, publicErrorResponse } from "@/lib/http";
import { createAdminClient } from "@/lib/supabase/admin";
import { AuthenticationError, requireAuthenticatedUser, unauthorizedResponse } from "@/lib/supabase/auth";
import { parseJsonBody } from "@/lib/validation/body";
import { parseRequestQuery } from "@/lib/validation/query";

export const runtime = "nodejs";

/**
 * The demo corpus is a single fixed CPD year (see `DEMO_CME_INSTANT`/`DEMO_CME_YEAR` in
 * `@/lib/cme/demo-year`). A caller asking for a different year in demo mode gets an empty
 * list rather than the fixture leaking into a year it was never written for.
 */
function demoEntriesForYear(year: number): readonly CmeEntry[] {
  return year === DEMO_CME_YEAR.year ? DEMO_CME_ENTRIES : [];
}

export async function GET(request: Request) {
  try {
    const { year } = parseRequestQuery(request, cmeListQuerySchema, "Invalid CPD query.");

    if (isDemoMode()) {
      const targetYear = year ?? cpdYearOf(DEMO_CME_INSTANT);
      return NextResponse.json({ entries: demoEntriesForYear(targetYear), year: targetYear, demoMode: true });
    }

    const supabase = createAdminClient();
    // The owner comes from the validated session only — never from the request body or a
    // query string. CME is a private per-owner record, never a shared reference surface, so
    // unlike On Call's GET there is no anonymous path here at all.
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

    const targetYear = year ?? cpdYearOf(new Date());
    // An entry can only exist against a confirmed year (`cme_entries.year_id` is not null), so
    // an unconfirmed year has no entries to fetch — not an error, just nothing logged yet.
    const yearRow = await fetchOwnerCmeYear(supabase, user.id, targetYear);
    const entries = yearRow ? await fetchOwnerCmeEntries(supabase, user.id, yearRow.id) : [];
    return NextResponse.json({ entries, year: targetYear });
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
      return publicErrorResponse("CPD entries cannot be created in demo mode.", 400, {
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

    // One schema covers the whole entry — no polymorphic per-section shape the way On Call
    // has, so a single parse (reject rather than coerce) is the whole validation step.
    const body = await parseJsonBody(request, cmeEntryCreateSchema, "Invalid CPD entry.");
    assertNoCmeEntryPatientDetail(body);

    // `activity_date` is a Perth calendar date the application already computed (see
    // `cme_entries.activity_date` in the migration) — the year it belongs to is read directly
    // off that string, never recomputed from a timestamp.
    const targetYear = Number(body.date.slice(0, 4));
    const yearRow = await fetchOwnerCmeYear(supabase, user.id, targetYear);
    if (cmeYearConfigurationState(yearRow) === "unavailable") {
      return publicErrorResponse("Your saved CPD targets could not be read. They have not been changed.", 503, {
        code: "cme_year_unavailable",
      });
    }
    if (!yearRow || cmeYearConfigurationState(yearRow) !== "ready") {
      return publicErrorResponse(`Confirm your CPD targets for ${targetYear} before logging an entry.`, 400, {
        code: "cme_year_not_confirmed",
      });
    }

    const entry: CmeEntry = {
      id: randomUUID(),
      date: body.date,
      title: body.title,
      allocations: body.allocations,
      reflection: body.reflection,
      costCents: body.costCents,
      // A freshly logged entry has not yet been copied to the owner's CPD home — that only
      // happens through the explicit "Copy for your CPD home" action, never on create.
      transcribed: false,
      routineId: body.routineId,
      documentId: body.documentId,
      sourceUrl: body.sourceUrl ?? null,
      buckets: body.buckets,
      formalPeerReviewHours: body.formalPeerReviewHours,
    };

    await assertValidCmeLinkedIds(supabase, user.id, {
      routineId: entry.routineId,
      documentId: entry.documentId,
    });

    const created = await insertCmeEntry(supabase, user.id, yearRow.id, entry, body.requestId);
    // Only once the activity is saved: finish the draft it came from and link the missed session it
    // replaces. Either can fail without undoing the save; the draft or the link is simply left for
    // the owner to tidy on the log. A repeat save returns the same entry, and deleting a draft that
    // is already gone does nothing.
    const followUps = await Promise.allSettled([
      body.draftId ? deleteOwnerCmeDraft(supabase, user.id, body.draftId) : null,
      body.missedSessionId
        ? setOwnerCmeMissedSessionReplacement(supabase, user.id, body.missedSessionId, created.id)
        : null,
    ]);
    const linkedMissedSession = Boolean(body.missedSessionId) && followUps[1].status === "fulfilled";
    return NextResponse.json({ entry: created, linkedMissedSession }, { status: 201 });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return unauthorizedResponse();
    }
    return jsonError(error);
  }
}
