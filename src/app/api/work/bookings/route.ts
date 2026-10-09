import { parseJsonBody } from "@/lib/validation/body";
import { bookingsActionSchema, withBookingsApi } from "@/lib/work-screens/admin/bookings-api";
import { bookSavedCourse, cancelSavedBooking, readSavedBookings } from "@/lib/work-screens/admin/bookings-repository";

export const runtime = "nodejs";

/**
 * Admin · Bookings, saved version. GET answers the courses this doctor can see,
 * their own bookings, and, for courses they organise, who has booked. Before the
 * bookings tables exist it answers `{ status: "not-set-up" }` with 200, so the
 * pages show their "not set up" card instead of an error. Who may see what is
 * checked in SQL on every call; the actor is the session user only.
 */
export async function GET(request: Request) {
  return withBookingsApi(request, (client, actorId) => readSavedBookings(client, actorId), {
    demo: () => ({ status: "not-set-up" }),
  });
}

/** Book a place (or join the waitlist), or cancel one's own place (or leave the waitlist). */
export async function POST(request: Request) {
  return withBookingsApi(request, async (client, actorId) => {
    const body = await parseJsonBody(request, bookingsActionSchema, "That booking could not be read.");
    if (body.action === "book") {
      const result = await bookSavedCourse(client, actorId, body.courseId);
      return { ok: true, action: "book", ...result };
    }
    const result = await cancelSavedBooking(client, actorId, body.courseId);
    return { ok: true, action: "cancel", ...result };
  });
}
