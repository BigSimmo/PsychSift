import { isExampleRecord } from "@/lib/example-data/guards";
import type { NotificationItem } from "@/lib/needs-you/feed";
import { myBooking, type BookingsState } from "@/lib/work-screens/admin/bookings";
import { ADMIN_WORK_SCREEN_HREFS } from "@/lib/work-screens/admin/hrefs";

/**
 * The Notification centre's course change items, for a doctor with a place on
 * a course (booked or on the waitlist) that the organiser moved or cancelled.
 * The same courses My bookings lists under "Changed by the organiser", plus
 * waitlisted ones, so a doctor waiting for a place hears about it too. A
 * course already past, or one the doctor left or attended, is not shown.
 *
 * Each item is an update: a booked place's calendar entry has already moved or come off.
 * The id carries the change's time, so a later change shows again even after
 * the last one was snoozed.
 */

export function courseChangeItemId(courseId: string, changedAt: string): string {
  return `my-work:course-change:${courseId}:${changedAt}`;
}

/** `today` is `YYYY-MM-DD` in the work time zone, the same day Bookings uses. */
export function courseChangeNotificationItems(state: BookingsState, today: string): NotificationItem[] {
  const items: NotificationItem[] = [];
  for (const course of state.courses) {
    const change = course.change;
    if (!change || isExampleRecord(course.id) || course.date <= today) continue;
    if (course.status === "draft") continue;
    const mine = myBooking(state, course.id);
    if (!mine || isExampleRecord(mine.id) || (mine.status !== "booked" && mine.status !== "waitlisted")) continue;
    const cancelled = course.status === "cancelled";
    items.push({
      id: courseChangeItemId(course.id, change.at),
      title: cancelled ? `Course cancelled: ${course.title}` : `Course moved: ${course.title}`,
      detail: !cancelled
        ? change.summary
        : mine.status === "booked"
          ? "It is off your calendar"
          : "You were on the waitlist",
      due: course.date,
      area: "my-work",
      href: ADMIN_WORK_SCREEN_HREFS.bookingCourse(course.id),
      kind: "update",
    });
  }
  return items.sort((a, b) => (a.due ?? "").localeCompare(b.due ?? "") || a.id.localeCompare(b.id));
}
