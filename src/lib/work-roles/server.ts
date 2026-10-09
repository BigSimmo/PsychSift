import "server-only";

import { isAdministratorAppMetadata } from "@/lib/authorization";
import { PublicApiError } from "@/lib/http";
import type { createAdminClient } from "@/lib/supabase/admin";
import type { AuthenticatedUser } from "@/lib/supabase/auth";
import { decideWorkCapability, type WorkCapability, type WorkRoleGrant, type WorkScope } from "@/lib/work-roles/model";

type Client = ReturnType<typeof createAdminClient>;

/** Who is asking and every role they hold, read once per request. */
export type WorkRoleContext = {
  readonly userId: string;
  readonly grants: readonly WorkRoleGrant[];
  /** False when the role grants table is not in this database yet. */
  readonly ready: boolean;
};

/** PostgREST and Postgres codes for a table that does not exist yet. */
export function isMissingTableError(error: { code?: string | null } | null | undefined): boolean {
  return error?.code === "PGRST205" || error?.code === "42P01";
}

function unavailable(): PublicApiError {
  return new PublicApiError("Your roles could not be checked. Try again shortly.", 503, {
    code: "work_roles_unavailable",
  });
}

/**
 * Reads the signed-in person's roles. The administrator role comes from the
 * live session's app_metadata, and a manager role counts only while the person
 * is still an active member of that team. Any read failure throws, so a check
 * never passes on missing data.
 *
 * Medical Workforce, DCT and supervisor grants come from `work_role_grants`. A
 * hospital grant carries the teams linked to its hospital, so a team check is
 * answered without another read. Before that table exists (a database that has
 * not had the migration yet) those roles are simply absent and `ready` is false.
 */
export async function loadWorkRoleContext(client: Client, user: AuthenticatedUser): Promise<WorkRoleContext> {
  const grants: WorkRoleGrant[] = [];
  // The administrator role is read fresh from Auth, never from a proxy-forwarded claim.
  if (isAdministratorAppMetadata(user.appMetadata)) {
    const { data, error } = await client.auth.admin.getUserById(user.id);
    if (error) throw unavailable();
    if (isAdministratorAppMetadata(data.user?.app_metadata)) grants.push({ role: "administrator" });
  }

  const { data: managerRows, error: managerError } = await client
    .from("roster_member_roles")
    .select("service_id")
    .eq("user_id", user.id)
    .eq("role", "manager")
    .is("revoked_at", null);
  if (managerError || !managerRows) throw unavailable();

  const serviceIds = [...new Set(managerRows.map((row) => row.service_id))];
  if (serviceIds.length) {
    const { data: memberRows, error: memberError } = await client
      .from("on_call_service_members")
      .select("service_id")
      .eq("user_id", user.id)
      .is("revoked_at", null)
      .in("service_id", serviceIds);
    if (memberError || !memberRows) throw unavailable();
    const active = new Set(memberRows.map((row) => row.service_id));
    for (const serviceId of serviceIds) if (active.has(serviceId)) grants.push({ role: "manager", serviceId });
  }

  const ready = await addGrantedRoles(client, user.id, grants);
  return { userId: user.id, grants, ready };
}

async function addGrantedRoles(client: Client, userId: string, grants: WorkRoleGrant[]): Promise<boolean> {
  const { data: rows, error } = await client
    .from("work_role_grants")
    .select("role,hospital_id,service_id,subject_user_id")
    .eq("user_id", userId)
    .is("revoked_at", null);
  if (isMissingTableError(error)) return false;
  if (error || !rows) throw unavailable();

  const hospitalIds = [
    ...new Set(rows.filter((row) => row.role === "workforce" || row.role === "dct").map((row) => row.hospital_id)),
  ];
  const teamsByHospital = new Map<string, string[]>();
  const namesByHospital = new Map<string, string>();
  if (hospitalIds.length) {
    const [teams, hospitals] = await Promise.all([
      client.from("work_hospital_teams").select("service_id,hospital_id").in("hospital_id", hospitalIds),
      client.from("work_hospitals").select("id,name").in("id", hospitalIds).is("archived_at", null),
    ]);
    if (teams.error || !teams.data || hospitals.error || !hospitals.data) throw unavailable();
    for (const team of teams.data) {
      teamsByHospital.set(team.hospital_id, [...(teamsByHospital.get(team.hospital_id) ?? []), team.service_id]);
    }
    for (const hospital of hospitals.data) namesByHospital.set(hospital.id, hospital.name);
  }

  for (const row of rows) {
    if (row.role === "supervisor") {
      grants.push({
        role: "supervisor",
        hospitalId: row.hospital_id,
        serviceId: row.service_id,
        subjectUserId: row.subject_user_id,
      });
    } else if (namesByHospital.has(row.hospital_id)) {
      // An archived hospital's grants lapse with it.
      grants.push({
        role: row.role,
        hospitalId: row.hospital_id,
        hospitalName: namesByHospital.get(row.hospital_id) ?? null,
        serviceIds: teamsByHospital.get(row.hospital_id) ?? [],
      });
    }
  }
  return true;
}

/** The one check. True only when a role the person holds covers this scope. Nobody reviews their own assessments. */
export function can(context: WorkRoleContext, capability: WorkCapability, scope: WorkScope): boolean {
  if (capability === "assessments.review" && scope.kind === "trainee" && scope.userId === context.userId) return false;
  return decideWorkCapability(context.grants, capability, scope);
}

/** Throws a plain 403 when the check fails. Use at the top of a route or server action. */
export function requireWorkCapability(context: WorkRoleContext, capability: WorkCapability, scope: WorkScope): void {
  if (!can(context, capability, scope)) {
    throw new PublicApiError("You don't have the role needed for this.", 403, { code: "work_role_required" });
  }
}

/** Post, edit and cancel courses, and see who booked. `everyone` means a course open to all. */
export function canManageCourses(context: WorkRoleContext, scope: WorkScope): boolean {
  return can(context, "courses.manage", scope);
}

/** Open a rotation preference round for a team, see submissions, allocate and publish. */
export function canManageRotations(context: WorkRoleContext, serviceId: string): boolean {
  return can(context, "rotations.manage", { kind: "team", serviceId });
}

/** Review and sign a trainee's assessment. Pass the trainee's team so a whole-team supervisor or the DCT counts. */
export function canReviewAssessments(context: WorkRoleContext, traineeId: string, serviceId?: string | null): boolean {
  return can(context, "assessments.review", { kind: "trainee", userId: traineeId, serviceId: serviceId ?? null });
}
