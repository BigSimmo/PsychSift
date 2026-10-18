import type { RosterAdminClient } from "@/lib/roster/team/api";
import { rosterRead } from "@/lib/roster/team/repository";
import { addDaysToDate, perthDateOf } from "@/lib/roster/shifts/perth-time";
import { openShiftCandidates } from "@/lib/roster/team/eligibility";
import { openParties, activeRecipientIds } from "./recipients";

/** Re-read the opening, team access and eligibility; saved alert jobs confer no access. */
export async function offerRecipients(
  client: RosterAdminClient,
  actorId: string,
  serviceId: string,
  openShiftId: string,
) {
  const open = await openParties(client, serviceId, openShiftId);
  if (!open || open.status !== "open" || Date.parse(open.starts_at) <= Date.now()) return [];
  const overview = await rosterRead(client, actorId, serviceId, "overview");
  const date = perthDateOf(open.starts_at);
  const assignments = await rosterRead(client, actorId, serviceId, "assignments", {
    from: addDaysToDate(date, -7),
    to: addDaysToDate(date, 7),
  });
  const candidates = [
    ...new Set(
      openShiftCandidates(
        assignments.assignments,
        {
          startsAt: open.starts_at,
          endsAt: open.ends_at,
          minGrade: open.min_grade as never,
          assignmentId: open.assignment_id,
        },
        overview.settings,
        open.posted_by,
      ).map((c) => c.userId),
    ),
  ]
    .filter((id) => id !== actorId)
    .slice(0, 500);
  const active = await activeRecipientIds(client, serviceId, candidates);
  return candidates.filter((id) => active.has(id));
}
