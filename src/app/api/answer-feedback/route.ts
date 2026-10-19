import { NextResponse } from "next/server";
import { z } from "zod";
import {
  allowRateLimitInMemoryFallbackOnUnavailable,
  consumeSubjectApiRateLimit,
  rateLimitJsonResponse,
} from "@/lib/api-rate-limit";
import { isDemoMode } from "@/lib/env";
import { jsonError, publicErrorResponse, PublicApiError } from "@/lib/http";
import { publicAccessContext } from "@/lib/public-api-access";
import { createAdminClient } from "@/lib/supabase/admin";
import type { TablesInsert } from "@/lib/supabase/database.types";
import { AuthenticationError, unauthorizedResponse } from "@/lib/supabase/auth";
import { parseJsonBody } from "@/lib/validation/body";
import { createHash, randomUUID } from "node:crypto";
import { verifyAnswerFeedbackToken } from "@/lib/answer-feedback-token";
import { ANSWER_FEEDBACK_NOTE_MAX_LENGTH, answerFeedbackTypes, feedbackRecordIdPattern } from "@/lib/answer-feedback";
import { rejectPatientDetailFeedbackNote } from "@/lib/clinical-question-patient-check-server";
import { getMedicationRecord } from "@/lib/medication-snapshot";
import { findTherapyRecord } from "@/lib/therapies";

export const runtime = "nodejs";

const uuid = z.string().uuid();
// Optional reviewer note. Trimmed, capped, and checked for patient details before saving; it is
// never logged or echoed back.
const note = z.string().trim().max(ANSWER_FEEDBACK_NOTE_MAX_LENGTH).optional();
const answerFeedbackBodySchema = z
  .object({
    recordType: z.literal("answer").optional(),
    interactionId: uuid,
    feedbackCategory: z.enum(answerFeedbackTypes),
    answerHash: z.string().regex(/^[a-f0-9]{64}$/),
    feedbackToken: z.string().trim().min(1).max(1024),
    citedSourceIds: z.array(uuid).max(80).optional().default([]),
    sourceIds: z.array(uuid).max(80).optional().default([]),
    route: z.string().trim().max(100).nullable().optional().default(null),
    model: z.string().trim().max(100).nullable().optional().default(null),
    providerRequestIds: z.array(z.string().trim().min(1).max(200)).max(10).optional().default([]),
    note,
  })
  .strict();
// A report on a medication or therapy record. There is no generated answer to sign, so the
// record is named by its public slug and the report gets its own id.
const recordFeedbackBodySchema = z
  .object({
    recordType: z.enum(["medication", "therapy"]),
    recordId: z.string().regex(feedbackRecordIdPattern),
    feedbackCategory: z.enum(answerFeedbackTypes),
    note,
  })
  .strict();
const feedbackBodySchema = z.union([answerFeedbackBodySchema, recordFeedbackBodySchema]);

/** True only for an exact slug in the canonical medication or therapy catalogue. */
function isCatalogueRecord(recordType: "medication" | "therapy", recordId: string): boolean {
  if (recordType === "therapy") return findTherapyRecord(recordId)?.slug === recordId;
  return getMedicationRecord(recordId)?.slug === recordId;
}

export async function POST(request: Request) {
  try {
    if (isDemoMode())
      return publicErrorResponse("Answer feedback is unavailable in demo mode.", 400, {
        code: "demo_mode_unavailable",
      });
    const body = await parseJsonBody(request, feedbackBodySchema, "Invalid answer feedback.");
    const noteText = body.note ? body.note : null;
    const supabase = createAdminClient();
    const access = await publicAccessContext(request, supabase);
    // Rate limit first, so the patient-detail screen below cannot be probed without limit.
    const rateLimit = await consumeSubjectApiRateLimit({
      supabase,
      subject: access.rateLimitSubject,
      bucket: "answer_feedback",
      allowInMemoryFallbackOnUnavailable: allowRateLimitInMemoryFallbackOnUnavailable(),
    });
    if (rateLimit.limited) return rateLimitJsonResponse("Too many feedback requests. Retry shortly.", rateLimit);
    // Before any storage or logging, so an identifying note never reaches the database.
    rejectPatientDetailFeedbackNote(noteText);

    let row: Omit<TablesInsert<"rag_answer_feedback">, "owner_id">;
    if ("recordId" in body) {
      // An answer report is bound to a signed answer token; a record report has no such proof,
      // so free-text reports on records are accepted only from a signed-in reader.
      if (!access.authenticated) {
        throw new PublicApiError("Sign in to report a problem with this record.", 401, {
          code: "sign_in_required",
        });
      }
      // Only a real catalogue slug is stored, so the record id can never carry free text.
      if (!isCatalogueRecord(body.recordType, body.recordId)) {
        throw new PublicApiError("This record could not be found. Reload the page and try again.", 400, {
          code: "unknown_feedback_record",
        });
      }
      row = {
        interaction_id: randomUUID(),
        feedback_category: body.feedbackCategory,
        // Content-free identity of the reported record, so answer_hash stays populated.
        answer_hash: createHash("sha256").update(`${body.recordType}:${body.recordId}`, "utf8").digest("hex"),
        record_type: body.recordType,
        record_id: body.recordId,
        note: noteText,
      };
    } else {
      if (
        !verifyAnswerFeedbackToken({
          token: body.feedbackToken,
          interactionId: body.interactionId,
          answerHash: body.answerHash,
        })
      ) {
        throw new PublicApiError("Answer feedback could not be verified. Run the question again.", 400, {
          code: "invalid_feedback_token",
        });
      }
      row = {
        interaction_id: body.interactionId,
        feedback_category: body.feedbackCategory,
        answer_hash: body.answerHash,
        cited_source_ids: [...new Set(body.citedSourceIds)],
        source_ids: [...new Set(body.sourceIds)],
        route: body.route,
        model: body.model,
        provider_request_ids: [...new Set(body.providerRequestIds)],
        record_type: "answer",
        note: noteText,
      };
    }

    const { error } = await supabase.from("rag_answer_feedback").insert({ ...row, owner_id: access.ownerId ?? null });
    if (error) {
      if (error.code === "23505") {
        return publicErrorResponse("Feedback has already been recorded for this answer.", 409, {
          code: "feedback_already_recorded",
        });
      }
      throw new PublicApiError("Answer feedback could not be saved.", 500, { code: "feedback_insert_failed" });
    }
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    if (error instanceof AuthenticationError) return unauthorizedResponse();
    if (error instanceof PublicApiError) return jsonError(error, error.status);
    return jsonError(error, 500);
  }
}
