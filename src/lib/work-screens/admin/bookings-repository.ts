import "server-only";

import { z } from "zod";

import { PublicApiError } from "@/lib/http";
import type { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";
import type {
  BookingCourse,
  BookingsState,
  CourseBooking,
  CourseDraft,
  CourseKind,
} from "@/lib/work-screens/admin/bookings";

/*
 * The saved (shared, multi-user) version of Admin Bookings. Every read and write
 * goes through the `work_bookings_*` SQL functions, which check in SQL on every call
 * who may see a course, who may post or change one, and how many places are left
 * (under a row lock, so two doctors cannot take the last place). The actor is always
 * the session user the route passes in, never anything the request carried.
 *
 * Rows are mapped onto the same `BookingsState` the example version uses, so the pure
 * rules in `bookings.ts` read both. Other doctors' places on a course the reader does
 * not organise arrive without a name or real id: enough to count places and waitlist
 * position, nothing more.
 */

type AdminClient = ReturnType<typeof createAdminClient>;
type RpcError = { readonly message?: string | null; readonly code?: string | null };
type SaveCourseArgs = Database["public"]["Functions"]["work_save_course"]["Args"];

/** The name shown for another doctor's place on a course the reader does not organise. */
export const OTHER_DOCTOR_LABEL = "Another doctor";

/* ------------------------------------------------------------------ errors */

const BOOKINGS_ERRORS: Record<string, { status: number; message: string }> = {
  work_bookings_auth_required: { status: 401, message: "Sign in to use bookings." },
  work_bookings_invalid_request: { status: 400, message: "Check the details and try again." },
  work_bookings_role_denied: {
    status: 403,
    message: "Only the course organiser, a manager of its team or an administrator can do that.",
  },
  work_bookings_not_found: { status: 404, message: "That course has changed. Refresh and try again." },
  work_bookings_already: { status: 409, message: "You already have a place or are on the waitlist." },
  work_bookings_course_cancelled: { status: 409, message: "This course was cancelled." },
  work_bookings_started: { status: 409, message: "This course has already started." },
  work_bookings_closed: { status: 409, message: "Booking has closed for this course." },
  work_bookings_full: { status: 409, message: "This course is full." },
  work_bookings_capacity_below_booked: {
    status: 409,
    message: "More people have booked than that. Keep at least as many places as are booked.",
  },
};

/**
 * The database answers that mean the bookings tables or functions are not there yet:
 * PostgREST's "function / table not in the schema cache" and Postgres's own
 * "undefined table / function".
 */
const NOT_SET_UP_CODES = new Set(["PGRST202", "PGRST205", "42P01", "42883"]);

/** Postgres codes for a value the database would not store: a bad request, not an outage. */
const INVALID_INPUT_SQLSTATES = new Set(["22P02", "22007", "22008", "23503", "23514"]);

export function isBookingsNotSetUp(error: RpcError | null | undefined): boolean {
  return Boolean(error?.code && NOT_SET_UP_CODES.has(error.code));
}

export function bookingsNotSetUp(): PublicApiError {
  return new PublicApiError("Bookings are not set up yet.", 503, { code: "work_bookings_not_set_up" });
}

export function bookingsUnavailable(): PublicApiError {
  return new PublicApiError("Bookings couldn't be reached. Try again shortly.", 503, {
    code: "work_bookings_unavailable",
  });
}

/** Map an RPC error to the public error a route returns. The database's own text is never echoed. */
export function bookingsApiError(error: RpcError): PublicApiError {
  const known = error.message ? BOOKINGS_ERRORS[error.message] : undefined;
  if (known) return new PublicApiError(known.message, known.status, { code: error.message! });
  if (isBookingsNotSetUp(error)) return bookingsNotSetUp();
  if (error.code === "23505") {
    const already = BOOKINGS_ERRORS.work_bookings_already;
    return new PublicApiError(already.message, already.status, { code: "work_bookings_already" });
  }
  if (error.code && INVALID_INPUT_SQLSTATES.has(error.code)) {
    const invalid = BOOKINGS_ERRORS.work_bookings_invalid_request;
    return new PublicApiError(invalid.message, invalid.status, { code: "work_bookings_invalid_request" });
  }
  return bookingsUnavailable();
}

function requireActor(actorId: string) {
  if (!actorId) throw new PublicApiError("Sign in to use bookings.", 401, { code: "work_bookings_auth_required" });
}

/* ------------------------------------------------------------------ read */

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const clock = z.string().regex(/^\d{2}:\d{2}$/);

const courseRowSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["course", "requirement"]),
  title: z.string(),
  about: z.string(),
  date: day,
  startTime: clock,
  endTime: clock,
  location: z.string(),
  capacity: z.number().int().positive(),
  closesOn: day.nullable(),
  organiser: z.string(),
  renewal: z.string().nullable(),
  waitlist: z.boolean(),
  status: z.enum(["draft", "posted", "cancelled"]),
  updatedAt: z.string(),
  change: z.object({ summary: z.string(), at: z.string() }).nullable(),
  serviceId: z.string().nullable(),
  manage: z.boolean(),
});

const bookingRowSchema = z.object({
  id: z.string().min(1),
  courseId: z.string().min(1),
  person: z.string().nullable(),
  self: z.boolean(),
  status: z.enum(["booked", "waitlisted", "cancelled", "attended"]),
  at: z.string(),
});

const readSchema = z.object({
  courses: z.array(courseRowSchema),
  bookings: z.array(bookingRowSchema),
  organiser: z.object({
    administrator: z.boolean(),
    teams: z.array(z.object({ serviceId: z.string(), name: z.string() })),
  }),
});

export type BookingsReadRows = z.infer<typeof readSchema>;

export interface ManagedCourse {
  readonly courseId: string;
  /** The team it was posted for, or null when it is open to everyone. Fixed after posting. */
  readonly serviceId: string | null;
}

export interface SavedBookingsRead {
  readonly status: "ready";
  readonly state: BookingsState;
  /** Courses this reader organises (or, as a site administrator, any course). */
  readonly managed: readonly ManagedCourse[];
  readonly organiser: {
    /** A site administrator, who may post courses open to everyone. */
    readonly administrator: boolean;
    /** Teams this reader may post courses for, as their Roster manager. */
    readonly teams: readonly { readonly serviceId: string; readonly name: string }[];
  };
}

export type SavedBookingsAnswer = SavedBookingsRead | { readonly status: "not-set-up" };

/** Map the read function's rows onto the example version's state. Throws 503 on an unknown shape. */
export function mapBookingsRead(data: unknown): SavedBookingsRead {
  const parsed = readSchema.safeParse(data);
  if (!parsed.success) throw bookingsUnavailable();
  const { courses, bookings, organiser } = parsed.data;
  const mappedCourses: BookingCourse[] = courses.map((row) => ({
    id: row.id,
    kind: row.kind,
    title: row.title,
    about: row.about,
    date: row.date,
    startTime: row.startTime,
    endTime: row.endTime,
    location: row.location,
    capacity: row.capacity,
    closesOn: row.closesOn,
    organiser: row.organiser,
    renewal: row.renewal,
    waitlist: row.waitlist,
    status: row.status,
    updatedAt: row.updatedAt,
    change: row.change ? { summary: row.change.summary, at: row.change.at } : null,
  }));
  const mappedBookings: CourseBooking[] = bookings.map((row) => ({
    id: row.id,
    courseId: row.courseId,
    person: row.person ?? OTHER_DOCTOR_LABEL,
    self: row.self,
    status: row.status,
    at: row.at,
  }));
  return {
    status: "ready",
    state: { courses: mappedCourses, bookings: mappedBookings },
    managed: courses.filter((row) => row.manage).map((row) => ({ courseId: row.id, serviceId: row.serviceId })),
    organiser: { administrator: organiser.administrator, teams: organiser.teams },
  };
}

/** Everything the Bookings and Courses pages show for this reader, or "not-set-up" before the tables land. */
export async function readSavedBookings(client: AdminClient, actorId: string): Promise<SavedBookingsAnswer> {
  requireActor(actorId);
  const { data, error } = await client.rpc("work_bookings_read", { p_actor_id: actorId });
  if (error) {
    if (isBookingsNotSetUp(error)) return { status: "not-set-up" };
    throw bookingsApiError(error);
  }
  return mapBookingsRead(data);
}

/* ------------------------------------------------------------------ doctor writes */

const bookResultSchema = z.object({
  id: z.string(),
  outcome: z.enum(["booked", "waitlisted"]),
  position: z.number().int().positive().nullable(),
});

export type SavedBookResult = z.infer<typeof bookResultSchema>;

/** Book a place, or join the waitlist when the course is full and keeps one. */
export async function bookSavedCourse(
  client: AdminClient,
  actorId: string,
  courseId: string,
): Promise<SavedBookResult> {
  requireActor(actorId);
  const { data, error } = await client.rpc("work_book_course", {
    p_actor_id: actorId,
    p_course_id: courseId,
  });
  if (error) throw bookingsApiError(error);
  const parsed = bookResultSchema.safeParse(data);
  if (!parsed.success) throw bookingsUnavailable();
  return parsed.data;
}

const cancelBookingResultSchema = z.object({
  /** What the reader held: a booked place becomes "cancelled"; a waitlist row is removed. */
  cancelled: z.enum(["booked", "waitlisted"]),
  promoted: z.number().int().nonnegative(),
});

export type SavedCancelBookingResult = z.infer<typeof cancelBookingResultSchema>;

/** Cancel the reader's place or leave the waitlist; a freed place goes to the first person waiting. */
export async function cancelSavedBooking(
  client: AdminClient,
  actorId: string,
  courseId: string,
): Promise<SavedCancelBookingResult> {
  requireActor(actorId);
  const { data, error } = await client.rpc("work_cancel_course_booking", {
    p_actor_id: actorId,
    p_course_id: courseId,
  });
  if (error) throw bookingsApiError(error);
  const parsed = cancelBookingResultSchema.safeParse(data);
  if (!parsed.success) throw bookingsUnavailable();
  return parsed.data;
}

/* ------------------------------------------------------------------ organiser writes */

export interface SaveCourseInput {
  /** Null posts a new course. */
  readonly courseId: string | null;
  /** The team it is for, or null for everyone (site administrator only). */
  readonly serviceId: string | null;
  /** Who posted it, as doctors see it. */
  readonly organiser: string;
  /** Already passed `validateCourseDraft`. */
  readonly draft: CourseDraft;
  /** True posts it (or keeps it posted); false keeps a new one as a draft. */
  readonly post: boolean;
}

const saveCourseResultSchema = z.object({
  id: z.string(),
  status: z.enum(["draft", "posted", "cancelled"]),
  changes: z.array(z.string()),
  calendarsUpdated: z.number().int().nonnegative(),
  promoted: z.number().int().nonnegative(),
});

export type SavedCourseResult = z.infer<typeof saveCourseResultSchema>;

/** The SQL arguments for a draft, trimmed the same way `bookings.ts` trims a posted course. */
export function courseRpcArgs(actorId: string, input: SaveCourseInput): SaveCourseArgs {
  const { draft } = input;
  const kind: CourseKind = draft.kind;
  return {
    p_actor_id: actorId,
    p_course_id: input.courseId,
    p_service_id: input.serviceId,
    p_organiser_label: input.organiser.trim(),
    p_kind: kind,
    p_title: draft.title.trim(),
    p_about: draft.about.trim(),
    p_course_date: draft.date,
    p_start_time: draft.startTime,
    p_end_time: draft.endTime,
    p_location: draft.location.trim(),
    p_capacity: Number(draft.capacity),
    p_closes_on: draft.closesOn || null,
    p_renewal: draft.renewal.trim().toLowerCase() || null,
    p_waitlist: draft.waitlist,
    p_post: input.post,
  };
}

/** Post a new course or save an edit. Moving a posted course records what changed for booked doctors. */
export async function saveSavedCourse(
  client: AdminClient,
  actorId: string,
  input: SaveCourseInput,
): Promise<SavedCourseResult> {
  requireActor(actorId);
  const { data, error } = await client.rpc("work_save_course", courseRpcArgs(actorId, input));
  if (error) throw bookingsApiError(error);
  const parsed = saveCourseResultSchema.safeParse(data);
  if (!parsed.success) throw bookingsUnavailable();
  return parsed.data;
}

const cancelCourseResultSchema = z.object({
  id: z.string(),
  calendarsUpdated: z.number().int().nonnegative(),
});

export type SavedCancelCourseResult = z.infer<typeof cancelCourseResultSchema>;

/** Cancel a course; every booked doctor's entry shows it cancelled. */
export async function cancelSavedCourse(
  client: AdminClient,
  actorId: string,
  courseId: string,
): Promise<SavedCancelCourseResult> {
  requireActor(actorId);
  const { data, error } = await client.rpc("work_cancel_course", {
    p_actor_id: actorId,
    p_course_id: courseId,
  });
  if (error) throw bookingsApiError(error);
  const parsed = cancelCourseResultSchema.safeParse(data);
  if (!parsed.success) throw bookingsUnavailable();
  return parsed.data;
}
