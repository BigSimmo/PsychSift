import { NextResponse } from "next/server";
import { z } from "zod";

import {
  allowRateLimitInMemoryFallbackOnUnavailable,
  consumeSubjectApiRateLimit,
  rateLimitJsonResponse,
} from "@/lib/api-rate-limit";
import { PublicApiError } from "@/lib/http";
import { createAdminClient } from "@/lib/supabase/admin";
import { AuthenticationError, requireAuthenticatedUser, unauthorizedResponse } from "@/lib/supabase/auth";
import { teachingErrorResponse, teachingNoStore } from "@/lib/teaching/api";
import { requireActiveServiceMember, requireAssessmentReviewer } from "@/lib/teaching/assessments/access";
import {
  AssessmentAccessDeniedError,
  DurableClinicalAssessmentRepository,
  projectAssessmentForActor,
  resolveAssessmentStore,
} from "@/lib/teaching/assessments/dual-sign-off";
import { readBoundedJson } from "@/lib/validation/body";

export const runtime = "nodejs";

const ratingValueSchema = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]);

const domainRatingsSchema = z.object({
  1: ratingValueSchema.optional(),
  2: ratingValueSchema.optional(),
  3: ratingValueSchema.optional(),
  4: ratingValueSchema.optional(),
});

const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create_draft"),
    serviceId: z.string().uuid(),
    supervisorId: z.string().uuid(),
    title: z.string().min(3).max(200),
    clinicalSetting: z.string().min(2).max(100),
    traineeReflection: z.string().min(1).max(10000),
    traineeSelfRatings: domainRatingsSchema.optional(),
  }),
  z.object({
    action: z.literal("update_draft"),
    assessmentId: z.string().uuid(),
    title: z.string().min(3).max(200).optional(),
    clinicalSetting: z.string().min(2).max(100).optional(),
    traineeReflection: z.string().min(1).max(10000).optional(),
    traineeSelfRatings: domainRatingsSchema.optional(),
  }),
  z.object({
    action: z.literal("submit_for_review"),
    assessmentId: z.string().uuid(),
  }),
  z.object({
    action: z.literal("supervisor_sign_off"),
    assessmentId: z.string().uuid(),
    supervisorFeedback: z.string().min(10).max(10000),
    supervisorRatings: domainRatingsSchema,
    globalRecommendation: z.enum(["sat", "cond", "unsat"]),
  }),
  z.object({
    action: z.literal("request_revision"),
    assessmentId: z.string().uuid(),
    revisionReason: z.string().min(5).max(2000),
  }),
  z.object({
    action: z.literal("resubmit"),
    assessmentId: z.string().uuid(),
    updatedReflection: z.string().min(1).max(10000).optional(),
  }),
  z.object({
    action: z.literal("cancel"),
    assessmentId: z.string().uuid(),
    reason: z.string().max(500).optional(),
  }),
  z.object({
    action: z.literal("restart_draft"),
    cancelledId: z.string().uuid(),
  }),
]);

/**
 * The durable store checks that the trainee belongs to the team and that the named supervisor
 * really holds `assessments.review` for them (work_can), at creation and again at sign-off, so a
 * trainee cannot route their sign-off to an arbitrary or second account. The in-memory store is a
 * non-production fallback with no membership data, so it skips these checks.
 */
async function requireReviewPairing(
  client: unknown,
  store: ReturnType<typeof resolveAssessmentStore>,
  pairing: { serviceId: string; traineeId: string; supervisorId: string },
): Promise<void> {
  if (!(store instanceof DurableClinicalAssessmentRepository)) return;
  await requireActiveServiceMember(
    client,
    pairing.traineeId,
    pairing.serviceId,
    () => new AssessmentAccessDeniedError("The trainee is not a member of this service."),
  );
  await requireAssessmentReviewer(
    client,
    pairing.supervisorId,
    pairing.serviceId,
    pairing.traineeId,
    () => new AssessmentAccessDeniedError("The named supervisor cannot review assessments for this trainee."),
  );
}

export async function GET(request: Request) {
  try {
    const client = createAdminClient();
    const user = await requireAuthenticatedUser(request, client);
    {
      const rateLimit = await consumeSubjectApiRateLimit({
        supabase: client,
        subject: { kind: "owner", ownerId: user.id },
        bucket: "teaching",
        allowInMemoryFallbackOnUnavailable: allowRateLimitInMemoryFallbackOnUnavailable(),
      });
      if (rateLimit.limited) {
        return teachingNoStore(
          rateLimitJsonResponse("Teaching requests are rate limited. Try again shortly.", rateLimit),
        );
      }
    }

    const store = resolveAssessmentStore(client);
    const { searchParams } = new URL(request.url);

    const id = searchParams.get("id");
    const role = searchParams.get("role");

    if (id) {
      const record = await store.getRecord(id);
      const safeView = projectAssessmentForActor(record, user.id);
      return teachingNoStore(NextResponse.json({ assessment: safeView }));
    }

    if (role === "supervisor") {
      const pendingList = await store.listForSupervisor(user.id, "pending_supervisor");
      return teachingNoStore(NextResponse.json({ pendingAssessments: pendingList }));
    }

    if (role === "trainee") {
      const myList = await store.listForTrainee(user.id);
      return teachingNoStore(NextResponse.json({ assessments: myList }));
    }

    throw new PublicApiError("Missing 'id' or 'role' query parameter.", 400, {
      code: "invalid_query",
    });
  } catch (error) {
    if (error instanceof AuthenticationError) return unauthorizedResponse();
    return teachingNoStore(teachingErrorResponse(error));
  }
}

export async function POST(request: Request) {
  try {
    const client = createAdminClient();
    const user = await requireAuthenticatedUser(request, client);
    {
      const rateLimit = await consumeSubjectApiRateLimit({
        supabase: client,
        subject: { kind: "owner", ownerId: user.id },
        bucket: "teaching",
        allowInMemoryFallbackOnUnavailable: allowRateLimitInMemoryFallbackOnUnavailable(),
      });
      if (rateLimit.limited) {
        return teachingNoStore(
          rateLimitJsonResponse("Teaching requests are rate limited. Try again shortly.", rateLimit),
        );
      }
    }

    const store = resolveAssessmentStore(client);

    let body: unknown;
    try {
      body = await readBoundedJson(request);
    } catch (error) {
      if (error instanceof PublicApiError && error.status === 413) throw error;
      body = null;
    }
    if (!body || typeof body !== "object") {
      throw new PublicApiError("Invalid JSON request body.", 400, { code: "invalid_json" });
    }

    const parsed = actionSchema.safeParse(body);
    if (!parsed.success) {
      throw new PublicApiError(parsed.error.issues[0]?.message ?? "Invalid action payload.", 400, {
        code: "invalid_payload",
      });
    }

    const payload = parsed.data;

    switch (payload.action) {
      case "create_draft": {
        await requireReviewPairing(client, store, {
          serviceId: payload.serviceId,
          traineeId: user.id,
          supervisorId: payload.supervisorId,
        });
        const created = await store.createDraft({
          serviceId: payload.serviceId,
          traineeId: user.id,
          supervisorId: payload.supervisorId,
          title: payload.title,
          clinicalSetting: payload.clinicalSetting,
          traineeReflection: payload.traineeReflection,
          traineeSelfRatings: payload.traineeSelfRatings,
        });
        return teachingNoStore(
          NextResponse.json({ assessment: projectAssessmentForActor(created, user.id) }, { status: 201 }),
        );
      }

      case "update_draft": {
        const updated = await store.updateDraft(user.id, payload.assessmentId, {
          title: payload.title,
          clinicalSetting: payload.clinicalSetting,
          traineeReflection: payload.traineeReflection,
          traineeSelfRatings: payload.traineeSelfRatings,
        });
        return teachingNoStore(NextResponse.json({ assessment: projectAssessmentForActor(updated, user.id) }));
      }

      case "submit_for_review": {
        const submitted = await store.submitForReview(user.id, payload.assessmentId);
        return teachingNoStore(NextResponse.json({ assessment: projectAssessmentForActor(submitted, user.id) }));
      }

      case "supervisor_sign_off": {
        const record = await store.getRecord(payload.assessmentId);
        if (record.supervisorId === user.id) {
          await requireReviewPairing(client, store, {
            serviceId: record.serviceId,
            traineeId: record.traineeId,
            supervisorId: user.id,
          });
        }
        const approved = await store.supervisorSignOff(user.id, payload.assessmentId, {
          supervisorFeedback: payload.supervisorFeedback,
          supervisorRatings: payload.supervisorRatings,
          globalRecommendation: payload.globalRecommendation,
        });
        return teachingNoStore(NextResponse.json({ assessment: projectAssessmentForActor(approved, user.id) }));
      }

      case "request_revision": {
        const revised = await store.requestRevision(user.id, payload.assessmentId, payload.revisionReason);
        return teachingNoStore(NextResponse.json({ assessment: projectAssessmentForActor(revised, user.id) }));
      }

      case "resubmit": {
        if (payload.updatedReflection) {
          await store.updateDraft(user.id, payload.assessmentId, {
            traineeReflection: payload.updatedReflection,
          });
        }
        const resubmitted = await store.submitForReview(user.id, payload.assessmentId);
        return teachingNoStore(NextResponse.json({ assessment: projectAssessmentForActor(resubmitted, user.id) }));
      }

      case "cancel": {
        const cancelled = await store.cancelAssessment(user.id, payload.assessmentId, payload.reason);
        return teachingNoStore(NextResponse.json({ assessment: projectAssessmentForActor(cancelled, user.id) }));
      }

      case "restart_draft": {
        const restarted = await store.restartDraft(user.id, payload.cancelledId);
        return teachingNoStore(
          NextResponse.json({ assessment: projectAssessmentForActor(restarted, user.id) }, { status: 201 }),
        );
      }
    }
  } catch (error) {
    if (error instanceof AuthenticationError) return unauthorizedResponse();
    return teachingNoStore(teachingErrorResponse(error));
  }
}
