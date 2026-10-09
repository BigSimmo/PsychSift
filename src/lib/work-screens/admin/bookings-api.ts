import "server-only";

import { NextResponse } from "next/server";
import { z } from "zod";

import {
  allowRateLimitInMemoryFallbackOnUnavailable,
  consumeSubjectApiRateLimit,
  rateLimitJsonResponse,
} from "@/lib/api-rate-limit";
import { isDemoMode } from "@/lib/env";
import { jsonError, publicErrorResponse } from "@/lib/http";
import { createAdminClient } from "@/lib/supabase/admin";
import { AuthenticationError, requireAuthenticatedUser, unauthorizedResponse } from "@/lib/supabase/auth";
import {
  COURSE_ABOUT_MAX,
  COURSE_LOCATION_MAX,
  COURSE_TITLE_MAX,
  validateCourseDraft,
  type CourseDraftErrors,
} from "@/lib/work-screens/admin/bookings";
import { zonedToday } from "@/lib/work-time/format";
import { DEFAULT_WORK_TIME_ZONE } from "@/lib/work-time/zones";

export type BookingsAdminClient = ReturnType<typeof createAdminClient>;

/**
 * The one wrapper both bookings routes use: the actor comes from the session only,
 * the `work_bookings` rate-limit bucket applies, and nothing enters a shared HTTP
 * cache, denied answers included. In synthetic demo mode a read answers `demo`
 * (the pages then show their own "not set up" card) and every write is refused.
 */
export async function withBookingsApi(
  request: Request,
  operation: (client: BookingsAdminClient, actorId: string) => Promise<unknown>,
  options: { readonly demo?: () => unknown } = {},
): Promise<Response> {
  let response: Response;
  try {
    if (isDemoMode()) {
      response = options.demo
        ? NextResponse.json(options.demo())
        : publicErrorResponse("Demo mode can't save bookings. Sign in to book.", 400, {
            code: "demo_mode_unavailable",
          });
    } else {
      const client = createAdminClient();
      const user = await requireAuthenticatedUser(request, client);
      const rate = await consumeSubjectApiRateLimit({
        supabase: client,
        subject: { kind: "owner", ownerId: user.id },
        bucket: "work_bookings",
        allowInMemoryFallbackOnUnavailable: allowRateLimitInMemoryFallbackOnUnavailable(),
      });
      if (rate.limited) response = rateLimitJsonResponse("Too many requests. Try again shortly.", rate);
      else {
        const result = await operation(client, user.id);
        response = result instanceof Response ? result : NextResponse.json(result);
      }
    }
  } catch (error) {
    response = error instanceof AuthenticationError ? unauthorizedResponse() : jsonError(error);
  }
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Vary", "Cookie, Authorization");
  return response;
}

/* ------------------------------------------------------------------ request bodies */

/** Any 8-4-4-4-12 hex id; the database casts it to uuid. */
const id = z.guid();

export const bookingsActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("book"),
    courseId: id,
  }),
  z.object({ action: z.literal("cancel"), courseId: id }),
]);

export type BookingsAction = z.infer<typeof bookingsActionSchema>;

const draftSchema = z.object({
  kind: z.enum(["course", "requirement"]),
  title: z.string().max(COURSE_TITLE_MAX * 2),
  about: z.string().max(COURSE_ABOUT_MAX * 2),
  date: z.string().max(10),
  startTime: z.string().max(5),
  endTime: z.string().max(5),
  location: z.string().max(COURSE_LOCATION_MAX * 2),
  capacity: z.string().max(4),
  closesOn: z.string().max(10),
  waitlist: z.boolean(),
  renewal: z.string().max(80),
});

export const coursesActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("save"),
    courseId: id.nullable(),
    serviceId: id.nullable(),
    organiser: z.string().trim().min(1).max(80),
    draft: draftSchema,
    post: z.boolean(),
  }),
  z.object({ action: z.literal("cancel"), courseId: id }),
]);

export type CoursesAction = z.infer<typeof coursesActionSchema>;

/**
 * The same checks the organiser's form runs, repeated on the server (title, times,
 * places, closing day, and text that looks like patient details), in the work time
 * zone the database enforces. On an edit, a closing day already past is let through
 * here and checked in SQL against the saved one, which only allows it unchanged.
 */
export function serverCourseDraftErrors(
  draft: z.infer<typeof draftSchema>,
  options: { readonly editing: boolean; readonly now?: number },
): CourseDraftErrors {
  const today = zonedToday(DEFAULT_WORK_TIME_ZONE, options.now);
  return validateCourseDraft(draft, {
    today,
    ...(options.editing ? { savedClosesOn: draft.closesOn || null } : {}),
  });
}

/** The 400 for a draft that fails the form's checks, carrying the field messages. */
export function invalidCourseResponse(errors: CourseDraftErrors): Response {
  return NextResponse.json(
    {
      error: "Check the course details and try again.",
      message: "Check the course details and try again.",
      code: "work_bookings_invalid_course",
      fields: errors,
    },
    { status: 400 },
  );
}

/** The 400 for a "Posted by" name that looks like patient details. Doctors see it on every course. */
export function invalidOrganiserResponse(): Response {
  const message = "Posted by should be a team or department name, with no patient details.";
  return NextResponse.json({ error: message, message, code: "work_bookings_invalid_course" }, { status: 400 });
}
