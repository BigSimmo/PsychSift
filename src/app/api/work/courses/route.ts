import { hasDraftErrors } from "@/lib/work-screens/admin/bookings";
import { parseJsonBody } from "@/lib/validation/body";
import { checkPatientDetail } from "@/lib/work-text/patient-detail-check";
import {
  coursesActionSchema,
  invalidCourseResponse,
  invalidOrganiserResponse,
  serverCourseDraftErrors,
  withBookingsApi,
} from "@/lib/work-screens/admin/bookings-api";
import { cancelSavedCourse, saveSavedCourse } from "@/lib/work-screens/admin/bookings-repository";

export const runtime = "nodejs";

/**
 * Admin · Courses, the organiser's side of saved Bookings: post a course, save an
 * edit, or cancel a course. The draft is checked here with the form's own rules;
 * who may post for which team (work_can 'courses.manage': a site administrator,
 * that team's Roster manager, or Medical Workforce or the DCT of its hospital), capacity and what moved for booked doctors are checked in SQL.
 */
export async function POST(request: Request) {
  return withBookingsApi(request, async (client, actorId) => {
    const body = await parseJsonBody(request, coursesActionSchema, "That course could not be read.");
    if (body.action === "cancel") {
      const result = await cancelSavedCourse(client, actorId, body.courseId);
      return { ok: true, action: "cancel", ...result };
    }
    const errors = serverCourseDraftErrors(body.draft, { editing: body.courseId !== null });
    if (hasDraftErrors(errors)) return invalidCourseResponse(errors);
    if (checkPatientDetail(body.organiser, { allowCapitals: true })) return invalidOrganiserResponse();
    const result = await saveSavedCourse(client, actorId, {
      courseId: body.courseId,
      serviceId: body.serviceId,
      organiser: body.organiser,
      draft: body.draft,
      post: body.post,
    });
    return { ok: true, action: "save", ...result };
  });
}
