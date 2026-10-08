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
};

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
 * Medical Workforce, DCT and supervisor grants join here once their table is
 * approved; callers do not change.
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

  return { userId: user.id, grants };
}

/** The one check. True only when a role the person holds covers this scope. */
export function can(context: WorkRoleContext, capability: WorkCapability, scope: WorkScope): boolean {
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
  if (traineeId === context.userId) return false;
  return can(context, "assessments.review", { kind: "trainee", userId: traineeId, serviceId: serviceId ?? null });
}
