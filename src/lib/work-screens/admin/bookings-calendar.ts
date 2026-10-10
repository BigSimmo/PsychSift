import type { CalendarEvent } from "@/lib/calendar/calendar-event";
import type { BookingCourse, BookingsState, CourseKind } from "@/lib/work-screens/admin/bookings";
import { zonedWallToIso } from "@/lib/work-time/format";

/*
 * The calendar side of Admin Bookings: the reader's booked courses as calendar entries. It is kept
 * apart from `bookings.ts` (which re-exports it) and imports only types from there, so the Roster and
 * My Day calendars carry these few functions and not the booking rules, drafts and words.
 */

export const COURSE_KIND_LABELS: Readonly<Record<CourseKind, string>> = {
  course: "Course",
  requirement: "Work requirement",
};

/* ------------------------------------------------------------------ calendar */

/** The calendar id for a course, stable across edits so calendars update in place. */
export function bookingCalendarId(courseId: string): string {
  return `booking-${courseId.replace(/^example:/, "example-")}`;
}

/** Minutes from start to end, for `CalendarEvent.durationMinutes`. */
export function courseMinutes(course: Pick<BookingCourse, "startTime" | "endTime">): number {
  return minutesOf(course.endTime) - minutesOf(course.startTime);
}

/**
 * The reader's calendar entries: one per booked or attended course. A booking
 * the reader cancelled, or a course the organiser cancelled, stays as a
 * cancelled entry so a subscribed calendar removes it rather than keeping a
 * stale copy. Waitlist places are not in the calendar until they become bookings.
 */
export function bookingCalendarEvents(state: BookingsState, href: (courseId: string) => string): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  for (const course of state.courses) {
    if (course.status === "draft") continue;
    const own = state.bookings
      .filter((booking) => booking.courseId === course.id)
      .filter((booking) => booking.self && booking.status !== "waitlisted");
    if (!own.length) continue;
    const live = own.some((booking) => booking.status === "booked" || booking.status === "attended");
    const cancelled = course.status === "cancelled" || !live;
    events.push({
      id: bookingCalendarId(course.id),
      title: course.title,
      date: course.date,
      startTime: course.startTime,
      durationMinutes: courseMinutes(course),
      kind: course.kind === "course" ? "teaching" : "other",
      location: course.location,
      notes: `Booked in PsychSift. Posted by ${course.organiser}.`,
      href: href(course.id),
      ...(cancelled ? { status: "cancelled" as const } : {}),
    });
  }
  return events.sort((a, b) => `${a.date}${a.startTime}`.localeCompare(`${b.date}${b.startTime}`));
}

/**
 * The same courses in the shared work calendar's entry shape (`WorkCalendarEntry`, owned by
 * Rotation preferences in `src/lib/work-calendar/entries.ts`), typed structurally here so this file
 * does not depend on that module before it lands. Ids are `booking:<courseId>`, and an example
 * course's id starts `example:` as the shared calendar's example guard expects.
 */
export interface BookingWorkCalendarEntry {
  readonly id: string;
  readonly kind: "course";
  readonly title: string;
  readonly detail: string;
  readonly start: string;
  readonly end: string;
  readonly startTime: string;
  readonly endTime: string;
  /** The exact start, when the zone the course's times were recorded in is known. */
  readonly startsAt?: string;
  readonly location: string;
  readonly status: "confirmed" | "cancelled";
  readonly href: string;
  readonly updatedAt: string;
  readonly isExample: boolean;
}

export function bookingWorkCalendarId(courseId: string): string {
  return courseId.startsWith("example:") ? `example:booking:${courseId.slice(8)}` : `booking:${courseId}`;
}

export function bookingWorkCalendarEntries(
  state: BookingsState,
  href: (courseId: string) => string,
  zone?: string,
): BookingWorkCalendarEntry[] {
  return bookingCalendarEvents(state, href).flatMap((event) => {
    const course = state.courses.find((item) => bookingCalendarId(item.id) === event.id);
    if (!course) return [];
    // Course times are on the reader's work clock; the exact start lets an export place them anywhere.
    const startsAt = zone ? zonedWallToIso(course.date, course.startTime, zone) : null;
    return [
      {
        id: bookingWorkCalendarId(course.id),
        kind: "course" as const,
        title: course.title,
        detail: `${COURSE_KIND_LABELS[course.kind]} · ${course.organiser}`,
        start: course.date,
        end: course.date,
        startTime: course.startTime,
        endTime: course.endTime,
        ...(startsAt ? { startsAt } : {}),
        location: course.location,
        status: event.status === "cancelled" ? ("cancelled" as const) : ("confirmed" as const),
        href: event.href ?? href(course.id),
        updatedAt: course.change?.at ?? course.updatedAt,
        isExample: course.id.startsWith("example:"),
      },
    ];
  });
}

function minutesOf(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}
