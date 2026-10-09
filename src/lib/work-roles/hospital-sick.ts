import "server-only";

import { PublicApiError } from "@/lib/http";
import type { createAdminClient } from "@/lib/supabase/admin";
import { notReady } from "@/lib/work-roles/people";
import { can, isMissingTableError, type WorkRoleContext } from "@/lib/work-roles/server";

/**
 * Sick calls across a hospital, for Medical Workforce (and the site
 * administrator). A sick call is a shift a doctor said they can't make: an
 * open shift that came off their roster (`assignment_id` set). Its status says
 * where cover stands. No reason or health detail exists to show; the team's
 * own manager still decides cover in Manage team.
 */

type Client = ReturnType<typeof createAdminClient>;

export type HospitalSickStatus = "needs-cover" | "offered" | "asked" | "covered";

export type HospitalSickCall = {
  id: string;
  serviceId: string;
  teamName: string;
  name: string;
  kind: "day" | "evening" | "night" | "on_call" | "other";
  shiftCode: string;
  startsAt: string;
  endsAt: string;
  reportedAt: string;
  status: HospitalSickStatus;
};

export type HospitalSickView = {
  hospital: { id: string; name: string };
  teams: { serviceId: string; name: string }[];
  calls: HospitalSickCall[];
};

const STATUS: Record<string, HospitalSickStatus | undefined> = {
  reported: "needs-cover",
  open: "offered",
  claimed: "asked",
  approved: "covered",
};

/** From yesterday to a week ahead: what Workforce acts on today. */
export function hospitalSickWindow(now: Date): { from: string; to: string } {
  return {
    from: new Date(now.getTime() - 24 * 3_600_000).toISOString(),
    to: new Date(now.getTime() + 8 * 24 * 3_600_000).toISOString(),
  };
}

function unavailable(): PublicApiError {
  return new PublicApiError("Sick calls could not be loaded. Try again shortly.", 503, {
    code: "work_sick_unavailable",
  });
}

export async function readHospitalSickCalls(
  client: Client,
  context: WorkRoleContext,
  hospitalId: string,
  now = new Date(),
): Promise<HospitalSickView> {
  if (!context.ready) throw notReady();
  if (!can(context, "sick.inbox", { kind: "hospital", hospitalId })) {
    throw new PublicApiError("You don't have the role needed for this.", 403, { code: "work_role_required" });
  }
  const hospital = await client.from("work_hospitals").select("id,name").eq("id", hospitalId).is("archived_at", null);
  if (isMissingTableError(hospital.error)) throw notReady();
  if (hospital.error || !hospital.data) throw unavailable();
  if (!hospital.data[0])
    throw new PublicApiError("That hospital is unavailable.", 404, { code: "work_hospital_not_found" });

  const links = await client.from("work_hospital_teams").select("service_id").eq("hospital_id", hospitalId);
  if (links.error || !links.data) throw unavailable();
  const serviceIds = links.data.map((row) => row.service_id);
  if (!serviceIds.length) return { hospital: hospital.data[0], teams: [], calls: [] };

  const window = hospitalSickWindow(now);
  const [services, shifts] = await Promise.all([
    client.from("on_call_services").select("id,name").in("id", serviceIds),
    client
      .from("roster_open_shifts")
      .select("id,service_id,assignment_id,starts_at,ends_at,shift_code,kind,status,reported_at")
      .in("service_id", serviceIds)
      // Only shifts reported as "I can't make it". A give-away or a manager's post is never a sick call.
      .not("reported_at", "is", null)
      .in("status", ["reported", "open", "claimed", "approved"])
      .not("assignment_id", "is", null)
      .gte("starts_at", window.from)
      .lte("starts_at", window.to)
      .order("starts_at")
      .limit(500),
  ]);
  if (services.error || !services.data || shifts.error || !shifts.data) throw unavailable();

  // The doctor is whoever the shift was rostered to, not whoever reported it (a manager can report for them).
  const assignmentIds = [
    ...new Set(shifts.data.map((row) => row.assignment_id).filter((id): id is string => Boolean(id))),
  ];
  const assignments = assignmentIds.length
    ? await client.from("roster_assignments").select("id,user_id").in("id", assignmentIds)
    : { data: [] as { id: string; user_id: string | null }[], error: null };
  if (assignments.error || !assignments.data) throw unavailable();
  const doctorOf = new Map(assignments.data.map((row) => [row.id, row.user_id]));
  const doctors = [...new Set(assignments.data.map((row) => row.user_id).filter((id): id is string => Boolean(id)))];
  const members = doctors.length
    ? await client
        .from("on_call_service_members")
        .select("service_id,user_id,display_name")
        .in("service_id", serviceIds)
        .in("user_id", doctors)
    : { data: [] as { service_id: string; user_id: string; display_name: string | null }[], error: null };
  if (members.error || !members.data) throw unavailable();
  const names = new Map(members.data.map((row) => [`${row.service_id}:${row.user_id}`, row.display_name?.trim()]));
  const teamNames = new Map(services.data.map((row) => [row.id, row.name]));

  return {
    hospital: hospital.data[0],
    teams: services.data
      .map((row) => ({ serviceId: row.id, name: row.name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    calls: shifts.data.flatMap((row) => {
      const status = STATUS[row.status];
      if (!status || !row.reported_at) return [];
      const doctor = row.assignment_id ? doctorOf.get(row.assignment_id) : null;
      return [
        {
          id: row.id,
          serviceId: row.service_id,
          teamName: teamNames.get(row.service_id) ?? "Team",
          name: (doctor && names.get(`${row.service_id}:${doctor}`)) || "Team member",
          kind: row.kind as HospitalSickCall["kind"],
          shiftCode: row.shift_code,
          startsAt: row.starts_at,
          endsAt: row.ends_at,
          reportedAt: row.reported_at,
          status,
        },
      ];
    }),
  };
}
