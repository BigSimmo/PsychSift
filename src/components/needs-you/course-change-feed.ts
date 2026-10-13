import type { AdminNotificationRead } from "@/components/needs-you/use-admin-notification-sources";
import { BOOKINGS_URL, readAnswer } from "@/components/work-screens/admin/use-saved-bookings";
import { withoutExampleRecords } from "@/lib/example-data/guards";
import { courseChangeNotificationItems } from "@/lib/needs-you/course-change-items";

/*
 * The course change source's read, loaded only for a reader in the
 * "course-bookings" preview, so the bell carries none of Bookings for anyone
 * else. It reads the saved courses once (`/api/work/bookings`, the read the
 * Bookings pages make) and never writes. Example courses never reach the bell.
 */

/** Read the reader's saved courses and list the ones the organiser moved or cancelled. Null once aborted. */
export async function readCourseChanges(
  input: { readonly headers: Readonly<Record<string, string>>; readonly today: string },
  signal: AbortSignal,
): Promise<AdminNotificationRead | null> {
  try {
    const response = await fetch(BOOKINGS_URL, { cache: "no-store", headers: input.headers, signal });
    if (response.status === 401) return { status: "signed-out", items: [] };
    const answer = readAnswer(response.ok ? await response.json().catch(() => null) : null);
    if (answer.status === "not-set-up") return { status: "unavailable", items: [] };
    if (answer.status !== "ready")
      return { status: answer.status === "signed-out" ? "signed-out" : "failed", items: [] };
    const state = {
      ...answer.state,
      courses: withoutExampleRecords(answer.state.courses),
      bookings: withoutExampleRecords(answer.state.bookings),
    };
    return { status: "ready", items: courseChangeNotificationItems(state, input.today) };
  } catch {
    return signal.aborted ? null : { status: "failed", items: [] };
  }
}
