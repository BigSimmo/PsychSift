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
  BookingAccessDeniedError,
  DurableSupervisorBookingRepository,
  resolveSupervisorBookingStore,
  type SupervisorBookingState,
} from "@/lib/teaching/assessments/supervisor-bookings";
import { readBoundedJson } from "@/lib/validation/body";

export const runtime = "nodejs";

const assessmentTypeSchema = z.enum(["epa", "wba", "ita", "general"]);
const bookingStateSchema = z.enum(["open", "booked", "completed", "cancelled"]);
const roleQuerySchema = z.enum(["supervisor", "trainee", "open"]);

/**
 * Team membership and supervisor checks need the durable store's database; the in-memory store is
 * a non-production fallback with no membership data, so the checks only run against the durable one.
 */
function accessChecksFor(client: unknown, store: ReturnType<typeof resolveSupervisorBookingStore>) {
  const durable = store instanceof DurableSupervisorBookingRepository;
  return {
    async member(userId: string, serviceId: string) {
      if (!durable) return;
      await requireActiveServiceMember(
        client,
        userId,
        serviceId,
        () => new BookingAccessDeniedError("You are not a member of this service."),
      );
    },
    async supervisor(userId: string, serviceId: string, traineeId: string | null) {
      if (!durable) return;
      await requireAssessmentReviewer(
        client,
        userId,
        serviceId,
        traineeId,
        () => new BookingAccessDeniedError("Supervisor access for this service is required."),
      );
    },
  };
}

const bookingActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create_slot"),
    serviceId: z.string().uuid(),
    supervisorId: z.string().uuid().optional(),
    traineeId: z.string().uuid().optional(),
    title: z.string().min(2).max(200).optional(),
    startsAt: z.string().min(1),
    endsAt: z.string().min(1),
    locationOrLink: z.string().min(1).max(500).optional(),
    assessmentType: assessmentTypeSchema.optional(),
    notes: z.string().max(2000).optional(),
  }),
  z.object({
    action: z.literal("book_slot"),
    slotId: z.string().uuid(),
    traineeId: z.string().uuid().optional(),
    assessmentType: assessmentTypeSchema.optional(),
    notes: z.string().max(2000).optional(),
  }),
  z.object({
    action: z.literal("cancel_booking"),
    slotId: z.string().uuid(),
    reason: z.string().max(500).optional(),
  }),
]);

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

    const store = resolveSupervisorBookingStore(client);
    const access = accessChecksFor(client, store);
    const { searchParams } = new URL(request.url);

    const id = searchParams.get("id");
    if (id) {
      if (!z.string().uuid().safeParse(id).success) {
        throw new PublicApiError("Invalid booking identifier.", 400, { code: "invalid_id" });
      }
      const slot = await store.getSlot(id);
      if (slot.bookingState === "open") {
        await access.member(user.id, slot.serviceId);
      }
      const canView = slot.supervisorId === user.id || slot.traineeId === user.id || slot.bookingState === "open";
      if (!canView) {
        throw new BookingAccessDeniedError("Access denied: You are not a participant on this supervision booking.");
      }
      return teachingNoStore(NextResponse.json({ booking: slot }));
    }

    const rawRole = searchParams.get("role");
    const parsedRole = rawRole ? roleQuerySchema.safeParse(rawRole) : null;
    if (parsedRole && !parsedRole.success) {
      throw new PublicApiError("Invalid 'role' query parameter. Expected supervisor, trainee, or open.", 400, {
        code: "invalid_query",
      });
    }

    const rawState = searchParams.get("state");
    const parsedState = rawState ? bookingStateSchema.safeParse(rawState) : null;
    if (parsedState && !parsedState.success) {
      throw new PublicApiError("Invalid 'state' query parameter.", 400, {
        code: "invalid_query",
      });
    }

    const serviceId = searchParams.get("serviceId") ?? undefined;
    if (parsedRole?.data === "open" && !serviceId) {
      throw new PublicApiError("serviceId is required for open-slot listings.", 400, { code: "service_required" });
    }
    if (serviceId && !z.string().uuid().safeParse(serviceId).success) {
      throw new PublicApiError("Invalid 'serviceId' query parameter.", 400, {
        code: "invalid_query",
      });
    }

    if (serviceId && (parsedRole?.data === "open" || !parsedRole)) {
      await access.member(user.id, serviceId);
    }

    const bookings = await store.listBookingsForActor({
      actorId: user.id,
      role: parsedRole?.data,
      serviceId,
      bookingState: parsedState?.data as SupervisorBookingState | undefined,
    });

    return teachingNoStore(NextResponse.json({ bookings }));
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

    const store = resolveSupervisorBookingStore(client);
    const access = accessChecksFor(client, store);

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

    const parsed = bookingActionSchema.safeParse(body);
    if (!parsed.success) {
      throw new PublicApiError(parsed.error.issues[0]?.message ?? "Invalid booking action payload.", 400, {
        code: "invalid_payload",
      });
    }

    const payload = parsed.data;

    switch (payload.action) {
      case "create_slot": {
        if (payload.supervisorId && payload.supervisorId !== user.id) {
          throw new BookingAccessDeniedError("You can only publish supervision availability slots for yourself.");
        }
        await access.member(user.id, payload.serviceId);
        // A self-assigned trainee is refused by the store with a 400, so it is not a reviewer scope.
        const subject = payload.traineeId && payload.traineeId !== user.id ? payload.traineeId : null;
        await access.supervisor(user.id, payload.serviceId, subject);
        if (payload.traineeId) await access.member(payload.traineeId, payload.serviceId);
        const created = await store.createAvailabilitySlot({
          serviceId: payload.serviceId,
          supervisorId: user.id,
          traineeId: payload.traineeId,
          title: payload.title,
          startsAt: payload.startsAt,
          endsAt: payload.endsAt,
          locationOrLink: payload.locationOrLink,
          assessmentType: payload.assessmentType,
          notes: payload.notes,
        });
        return teachingNoStore(NextResponse.json({ booking: created }, { status: 201 }));
      }

      case "book_slot": {
        if (payload.traineeId && payload.traineeId !== user.id) {
          throw new BookingAccessDeniedError("You can only book supervision slots for yourself.");
        }
        const slot = await store.getSlot(payload.slotId);
        await access.member(user.id, slot.serviceId);
        const booked = await store.bookSupervisorSlot({
          slotId: payload.slotId,
          traineeId: user.id,
          assessmentType: payload.assessmentType,
          notes: payload.notes,
        });
        return teachingNoStore(NextResponse.json({ booking: booked }));
      }

      case "cancel_booking": {
        const cancelled = await store.cancelBooking({
          slotId: payload.slotId,
          actorId: user.id,
          reason: payload.reason,
        });
        return teachingNoStore(NextResponse.json({ booking: cancelled }));
      }
    }
  } catch (error) {
    if (error instanceof AuthenticationError) return unauthorizedResponse();
    return teachingNoStore(teachingErrorResponse(error));
  }
}
