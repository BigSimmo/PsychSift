import "server-only";

import { z } from "zod";

import { PublicApiError } from "@/lib/http";
import type { createAdminClient } from "@/lib/supabase/admin";
import { looksLikePatientDetail } from "@/lib/work-text/patient-detail-check";
import {
  decideGrantWorkRole,
  GRANTABLE_WORK_ROLES,
  type GrantableWorkRole,
  type WorkScope,
} from "@/lib/work-roles/model";
import { can, isMissingTableError, type WorkRoleContext } from "@/lib/work-roles/server";

/**
 * People and roles (`/admin/people`): who holds Medical Workforce, DCT and
 * supervisor in a hospital, which teams the hospital holds, and the changes to
 * them. Every read and write here first checks the actor's own roles, and the
 * service-role reads are limited to the one hospital the actor may manage.
 * Nobody can give a role to themselves (also a table constraint).
 */

type Client = ReturnType<typeof createAdminClient>;

export type PeopleTeam = { serviceId: string; name: string; managers: { userId: string; name: string }[] };
export type PeoplePerson = { userId: string; name: string; serviceIds: string[] };
export type PeopleGrant = {
  id: string;
  userId: string;
  name: string;
  role: GrantableWorkRole;
  serviceId: string | null;
  serviceName: string | null;
  subjectUserId: string | null;
  subjectName: string | null;
  grantedAt: string;
  grantedByName: string | null;
};
export type PeopleView = {
  hospitals: { id: string; name: string }[];
  hospital: null | {
    id: string;
    name: string;
    teams: PeopleTeam[];
    people: PeoplePerson[];
    grants: PeopleGrant[];
  };
  viewer: { userId: string; administrator: boolean; canGrant: GrantableWorkRole[] };
  unlinkedTeams?: { serviceId: string; name: string }[];
};

const uuid = z.string().uuid();
const hospitalName = z.string().trim().min(1).max(160);
export const peopleChangeSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("grant"),
      hospitalId: uuid,
      userId: uuid.optional(),
      email: z.string().trim().email().max(320).optional(),
      role: z.enum(GRANTABLE_WORK_ROLES),
      serviceId: uuid.nullable().optional(),
      subjectUserIds: z.array(uuid).max(40).optional(),
    })
    .strict()
    .refine((value) => Boolean(value.userId) !== Boolean(value.email), { message: "Pick one person." }),
  z.object({ action: z.literal("revoke"), grantId: uuid }).strict(),
  z.object({ action: z.literal("link-team"), hospitalId: uuid, serviceId: uuid }).strict(),
  z.object({ action: z.literal("create-hospital"), name: hospitalName }).strict(),
  z.object({ action: z.literal("move-team"), serviceId: uuid, toHospitalId: uuid }).strict(),
  z.object({ action: z.literal("rename-hospital"), hospitalId: uuid, name: hospitalName }).strict(),
  z.object({ action: z.literal("archive-hospital"), hospitalId: uuid }).strict(),
]);
export type PeopleChange = z.infer<typeof peopleChangeSchema>;

export function notReady(): PublicApiError {
  return new PublicApiError("Roles can't be kept in PsychSift yet.", 503, { code: "work_roles_not_ready" });
}

function unavailable(): PublicApiError {
  return new PublicApiError("People and roles could not be loaded or changed. Try again shortly.", 503, {
    code: "work_people_unavailable",
  });
}

function denied(): PublicApiError {
  return new PublicApiError("You don't have the role needed for this.", 403, { code: "work_role_required" });
}

function check<T>(result: { data: T | null; error: { code?: string | null } | null }): T {
  if (isMissingTableError(result.error)) throw notReady();
  if (result.error || result.data === null) throw unavailable();
  return result.data;
}

const isAdministrator = (context: WorkRoleContext) => context.grants.some((grant) => grant.role === "administrator");

/** May this person open People and roles for this hospital at all? */
export function canManagePeople(context: WorkRoleContext, hospitalId: string): boolean {
  const scope: WorkScope = { kind: "hospital", hospitalId };
  return can(context, "roles.grant", scope) || can(context, "assessments.administer", scope);
}

function grantableRoles(context: WorkRoleContext, hospitalId: string): GrantableWorkRole[] {
  const scope: WorkScope = { kind: "hospital", hospitalId };
  // `decideGrantWorkRole` refuses the actor as target, so ask about a placeholder other person.
  return GRANTABLE_WORK_ROLES.filter((role) =>
    decideGrantWorkRole(context.grants, context.userId, { userId: "another-person", role, scope }),
  );
}

async function hospitalsFor(client: Client, context: WorkRoleContext): Promise<{ id: string; name: string }[]> {
  const rows = check(
    await client.from("work_hospitals").select("id,name").is("archived_at", null).order("name").limit(200),
  );
  return rows.filter((row) => canManagePeople(context, row.id));
}

const personName = (row: { display_name?: string | null; roster_name?: string | null }) =>
  row.display_name?.trim() || row.roster_name?.trim() || "Team member";

/** An account's name. Only the site administrator, who gives roles by email, sees an email in its place. */
async function accountName(client: Client, userId: string, showEmail: boolean): Promise<string> {
  const { data } = await client.auth.admin.getUserById(userId);
  const meta = (data.user?.user_metadata ?? {}) as Record<string, unknown>;
  const full = typeof meta.full_name === "string" ? meta.full_name.trim() : "";
  return full || (showEmail ? data.user?.email : null) || "PsychSift user";
}

export async function readPeople(
  client: Client,
  context: WorkRoleContext,
  requestedHospitalId: string | null,
): Promise<PeopleView> {
  if (!context.ready) throw notReady();
  const administrator = isAdministrator(context);
  const hospitals = await hospitalsFor(client, context);
  if (!hospitals.length && !administrator) throw denied();
  const selected = requestedHospitalId ? hospitals.find((row) => row.id === requestedHospitalId) : hospitals[0];
  if (requestedHospitalId && !selected) throw denied();

  const viewer = {
    userId: context.userId,
    administrator,
    canGrant: selected ? grantableRoles(context, selected.id) : [],
  };
  const unlinkedTeams = administrator ? await readUnlinkedTeams(client) : undefined;
  if (!selected) return { hospitals, hospital: null, viewer, unlinkedTeams };

  const links = check(await client.from("work_hospital_teams").select("service_id").eq("hospital_id", selected.id));
  const serviceIds = links.map((row) => row.service_id);
  const [services, members, managers, grants] = await Promise.all([
    serviceIds.length
      ? client.from("on_call_services").select("id,name").in("id", serviceIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[], error: null }),
    serviceIds.length
      ? client
          .from("on_call_service_members")
          .select("service_id,user_id,display_name")
          .in("service_id", serviceIds)
          .is("revoked_at", null)
          .limit(5000)
      : Promise.resolve({
          data: [] as { service_id: string; user_id: string; display_name: string | null }[],
          error: null,
        }),
    serviceIds.length
      ? client
          .from("roster_member_roles")
          .select("service_id,user_id,role,roster_name")
          .in("service_id", serviceIds)
          .is("revoked_at", null)
          .limit(5000)
      : Promise.resolve({
          data: [] as { service_id: string; user_id: string; role: string; roster_name: string | null }[],
          error: null,
        }),
    client
      .from("work_role_grants")
      .select("id,user_id,role,service_id,subject_user_id,granted_at,granted_by")
      .eq("hospital_id", selected.id)
      .is("revoked_at", null)
      .order("granted_at")
      .limit(2000),
  ]);
  const serviceRows = check(services);
  const memberRows = check(members);
  const roleRows = check(managers);
  const grantRows = check(grants);

  // A whole-team supervisor whose team has moved away (the move could not remove them) stays filed
  // under the hospital that gave the role, so name that team too.
  const serviceNames = new Map(serviceRows.map((row) => [row.id, row.name]));
  const elsewhere = [
    ...new Set(
      grantRows
        .map((row) => row.service_id)
        .filter((id): id is string => typeof id === "string" && !serviceNames.has(id)),
    ),
  ];
  if (elsewhere.length) {
    for (const row of check(await client.from("on_call_services").select("id,name").in("id", elsewhere))) {
      serviceNames.set(row.id, row.name);
    }
  }

  const rosterNames = new Map(roleRows.map((row) => [`${row.service_id}:${row.user_id}`, row.roster_name]));
  const names = new Map<string, string>();
  const people = new Map<string, PeoplePerson>();
  for (const row of memberRows) {
    const name = personName({
      display_name: row.display_name,
      roster_name: rosterNames.get(`${row.service_id}:${row.user_id}`),
    });
    if (!names.has(row.user_id) || names.get(row.user_id) === "Team member") names.set(row.user_id, name);
    const person = people.get(row.user_id) ?? { userId: row.user_id, name, serviceIds: [] };
    person.serviceIds.push(row.service_id);
    people.set(row.user_id, { ...person, name: names.get(row.user_id) ?? name });
  }
  const active = new Set(memberRows.map((row) => `${row.service_id}:${row.user_id}`));
  const teams: PeopleTeam[] = serviceRows
    .map((service) => ({
      serviceId: service.id,
      name: service.name,
      managers: roleRows
        .filter(
          (row) =>
            row.service_id === service.id && row.role === "manager" && active.has(`${service.id}:${row.user_id}`),
        )
        .map((row) => ({ userId: row.user_id, name: names.get(row.user_id) ?? "Team member" })),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // People outside every team (a Medical Workforce officer) are named from their account.
  const outside = [
    ...new Set(grantRows.flatMap((row) => [row.user_id, row.granted_by].filter((id): id is string => Boolean(id)))),
  ].filter((id) => !names.has(id));
  await Promise.all(
    outside.slice(0, 50).map(async (id) => names.set(id, await accountName(client, id, administrator))),
  );

  return {
    hospitals,
    hospital: {
      id: selected.id,
      name: selected.name,
      teams,
      people: [...people.values()].sort((a, b) => a.name.localeCompare(b.name)),
      grants: grantRows.map((row) => ({
        id: row.id,
        userId: row.user_id,
        name: names.get(row.user_id) ?? "PsychSift user",
        role: row.role,
        serviceId: row.service_id,
        serviceName: row.service_id ? (serviceNames.get(row.service_id) ?? null) : null,
        subjectUserId: row.subject_user_id,
        subjectName: row.subject_user_id ? (names.get(row.subject_user_id) ?? "Team member") : null,
        grantedAt: row.granted_at,
        grantedByName: row.granted_by ? (names.get(row.granted_by) ?? null) : null,
      })),
    },
    viewer,
    unlinkedTeams,
  };
}

async function readUnlinkedTeams(client: Client): Promise<{ serviceId: string; name: string }[]> {
  const [services, links] = await Promise.all([
    client.from("on_call_services").select("id,name").order("name").limit(500),
    client.from("work_hospital_teams").select("service_id").limit(5000),
  ]);
  const linked = new Set(check(links).map((row) => row.service_id));
  return check(services)
    .filter((row) => !linked.has(row.id))
    .map((row) => ({ serviceId: row.id, name: row.name }));
}

async function hospitalTeamIds(client: Client, hospitalId: string): Promise<string[]> {
  return check(await client.from("work_hospital_teams").select("service_id").eq("hospital_id", hospitalId)).map(
    (row) => row.service_id,
  );
}

async function activeMemberOf(client: Client, userId: string, serviceIds: string[]): Promise<boolean> {
  if (!serviceIds.length) return false;
  const rows = check(
    await client
      .from("on_call_service_members")
      .select("user_id")
      .eq("user_id", userId)
      .in("service_id", serviceIds)
      .is("revoked_at", null)
      .limit(1),
  );
  return rows.length > 0;
}

async function grant(client: Client, context: WorkRoleContext, change: Extract<PeopleChange, { action: "grant" }>) {
  const scope: WorkScope = { kind: "hospital", hospitalId: change.hospitalId };
  if (!canManagePeople(context, change.hospitalId)) throw denied();

  let userId = change.userId ?? null;
  if (change.email) {
    if (!isAdministrator(context)) throw denied();
    const { data, error } = await client.rpc("work_user_id_by_email", { p_email: change.email });
    if (error) throw unavailable();
    if (!data) {
      throw new PublicApiError("No PsychSift account uses that email. Ask them to sign in once first.", 404, {
        code: "work_person_not_found",
      });
    }
    userId = data;
  }
  if (!userId) throw new PublicApiError("Pick one person.", 400, { code: "work_people_invalid" });
  if (!decideGrantWorkRole(context.grants, context.userId, { userId, role: change.role, scope })) throw denied();

  const teamIds = await hospitalTeamIds(client, change.hospitalId);
  // A person picked from the list must be in one of this hospital's teams. Only the administrator,
  // by email, may give a role to someone outside them.
  if (!change.email && !(await activeMemberOf(client, userId, teamIds))) throw denied();

  const rows: {
    user_id: string;
    role: GrantableWorkRole;
    hospital_id: string;
    service_id: string | null;
    subject_user_id: string | null;
    granted_by: string;
  }[] = [];
  if (change.role === "supervisor") {
    const subjects = [...new Set(change.subjectUserIds ?? [])];
    if (Boolean(change.serviceId) === subjects.length > 0) {
      throw new PublicApiError("Choose a whole team or named doctors to supervise.", 400, {
        code: "work_people_invalid",
      });
    }
    if (change.serviceId && !teamIds.includes(change.serviceId)) throw denied();
    if (subjects.includes(userId)) {
      throw new PublicApiError("Nobody can supervise themselves.", 400, { code: "work_people_invalid" });
    }
    // Nobody chooses who signs off their own assessments either.
    if (subjects.includes(context.userId)) {
      throw new PublicApiError("You can't choose your own supervisor here.", 400, { code: "work_people_invalid" });
    }
    for (const subject of subjects) {
      if (!(await activeMemberOf(client, subject, teamIds))) throw denied();
    }
    if (change.serviceId) {
      rows.push({
        user_id: userId,
        role: "supervisor",
        hospital_id: change.hospitalId,
        service_id: change.serviceId,
        subject_user_id: null,
        granted_by: context.userId,
      });
    } else {
      for (const subject of subjects) {
        rows.push({
          user_id: userId,
          role: "supervisor",
          hospital_id: change.hospitalId,
          service_id: null,
          subject_user_id: subject,
          granted_by: context.userId,
        });
      }
    }
  } else {
    if (change.serviceId || change.subjectUserIds?.length) {
      throw new PublicApiError("This role covers the whole hospital.", 400, { code: "work_people_invalid" });
    }
    rows.push({
      user_id: userId,
      role: change.role,
      hospital_id: change.hospitalId,
      service_id: null,
      subject_user_id: null,
      granted_by: context.userId,
    });
  }

  for (const row of rows) {
    const { error } = await client.from("work_role_grants").insert(row);
    // 23505: they already hold it. Giving it again is not an error.
    if (error && error.code !== "23505") {
      if (isMissingTableError(error)) throw notReady();
      throw unavailable();
    }
  }
}

async function revoke(client: Client, context: WorkRoleContext, grantId: string): Promise<string> {
  const rows = check(
    await client
      .from("work_role_grants")
      .select("id,user_id,role,hospital_id")
      .eq("id", grantId)
      .is("revoked_at", null)
      .limit(1),
  );
  const row = rows[0];
  if (!row) throw new PublicApiError("That role was already removed.", 404, { code: "work_grant_not_found" });
  const scope: WorkScope = { kind: "hospital", hospitalId: row.hospital_id };
  // Removing follows the same rule as giving, so nobody removes a role they could not give.
  if (!decideGrantWorkRole(context.grants, context.userId, { userId: row.user_id, role: row.role, scope }))
    throw denied();
  const { error } = await client
    .from("work_role_grants")
    .update({ revoked_at: new Date().toISOString(), revoked_by: context.userId })
    .eq("id", grantId)
    .is("revoked_at", null);
  if (error) throw unavailable();
  return row.hospital_id;
}

function hospitalUnavailable(): PublicApiError {
  return new PublicApiError("That hospital is unavailable. It may have been archived.", 404, {
    code: "work_people_not_found",
  });
}

/** A failed write, in the same words every action here uses. */
function writeFailed(error: { code?: string | null }): PublicApiError {
  if (isMissingTableError(error)) return notReady();
  return unavailable();
}

/**
 * Moves a linked team to another hospital that is still open, for a team linked to the wrong one.
 * Medical Workforce and DCT reach comes from the links when roles are read (`loadWorkRoleContext`),
 * so it follows the team at once. Roster managers stay. Whole-team supervisors are removed: their
 * grant is filed under the old hospital but `work_can` matches it by team alone, so it would keep
 * working at the new hospital where nobody there could see or remove it. Supervisors of named
 * trainees are left alone, because they are scoped to the old hospital and simply stop matching.
 * There is no transaction, so the move goes first and a failed removal is reported, never hidden.
 * Answers with the hospital the team left.
 */
async function moveTeam(
  client: Client,
  context: WorkRoleContext,
  change: Extract<PeopleChange, { action: "move-team" }>,
): Promise<string> {
  if (!isAdministrator(context)) throw denied();
  const links = check(
    await client.from("work_hospital_teams").select("hospital_id").eq("service_id", change.serviceId).limit(1),
  );
  const from = links[0]?.hospital_id;
  if (!from) {
    throw new PublicApiError("That team isn't linked to a hospital. Link it instead.", 404, {
      code: "work_team_not_linked",
    });
  }
  if (from === change.toHospitalId) {
    throw new PublicApiError("That team is already in this hospital.", 409, { code: "work_team_linked" });
  }
  const target = check(
    await client.from("work_hospitals").select("id").eq("id", change.toHospitalId).is("archived_at", null).limit(1),
  );
  if (!target.length) throw hospitalUnavailable();
  // Only while it is still where it was read, so two moves at once cannot both land.
  const { data, error } = await client
    .from("work_hospital_teams")
    .update({ hospital_id: change.toHospitalId, linked_by: context.userId, linked_at: new Date().toISOString() })
    .eq("service_id", change.serviceId)
    .eq("hospital_id", from)
    .select("service_id");
  if (error?.code === "23503") throw hospitalUnavailable();
  if (error) throw writeFailed(error);
  if (!data?.length) {
    throw new PublicApiError("That team changed while you were moving it. Try again.", 409, {
      code: "work_team_changed",
    });
  }
  const { error: supervisorError } = await client
    .from("work_role_grants")
    .update({ revoked_at: new Date().toISOString(), revoked_by: context.userId })
    .eq("role", "supervisor")
    .eq("service_id", change.serviceId)
    .is("subject_user_id", null)
    .is("revoked_at", null);
  if (supervisorError) {
    throw new PublicApiError(
      "The team moved, but its whole-team supervisors weren't removed. Remove them under the hospital it left.",
      503,
      { code: "work_team_supervisors_left" },
    );
  }
  return from;
}

async function renameHospital(
  client: Client,
  context: WorkRoleContext,
  change: Extract<PeopleChange, { action: "rename-hospital" }>,
): Promise<void> {
  if (!isAdministrator(context)) throw denied();
  if (looksLikePatientDetail(change.name)) {
    throw new PublicApiError("Use the hospital's name only.", 400, { code: "work_people_invalid" });
  }
  const { data, error } = await client
    .from("work_hospitals")
    .update({ name: change.name })
    .eq("id", change.hospitalId)
    .is("archived_at", null)
    .select("id");
  // The same unique name rule as adding one: no two open hospitals share a name, whatever the case.
  if (error?.code === "23505") {
    throw new PublicApiError("A hospital with that name already exists.", 409, { code: "work_hospital_exists" });
  }
  if (error) throw writeFailed(error);
  if (!data?.length) throw hospitalUnavailable();
}

/**
 * Archives a hospital. Refused while any team is still linked to it, so no team is left in a
 * hospital nobody can open. Every role given there lapses with it (`loadWorkRoleContext` and
 * `work_can` skip archived hospitals), and the rows stay as the record.
 */
async function archiveHospital(
  client: Client,
  context: WorkRoleContext,
  change: Extract<PeopleChange, { action: "archive-hospital" }>,
): Promise<void> {
  if (!isAdministrator(context)) throw denied();
  if ((await hospitalTeamIds(client, change.hospitalId)).length) {
    throw new PublicApiError("Move its teams first. A hospital with teams can't be archived.", 409, {
      code: "work_hospital_has_teams",
    });
  }
  const { data, error } = await client
    .from("work_hospitals")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", change.hospitalId)
    .is("archived_at", null)
    .select("id");
  if (error) throw writeFailed(error);
  if (!data?.length) throw hospitalUnavailable();
}

export async function applyPeopleChange(
  client: Client,
  context: WorkRoleContext,
  change: PeopleChange,
): Promise<PeopleView> {
  if (!context.ready) throw notReady();
  switch (change.action) {
    case "grant":
      await grant(client, context, change);
      return readPeople(client, context, change.hospitalId);
    case "revoke":
      return readPeople(client, context, await revoke(client, context, change.grantId));
    case "link-team": {
      if (!isAdministrator(context)) throw denied();
      const { error } = await client
        .from("work_hospital_teams")
        .insert({ service_id: change.serviceId, hospital_id: change.hospitalId, linked_by: context.userId });
      if (error?.code === "23505") {
        throw new PublicApiError("That team already belongs to a hospital.", 409, { code: "work_team_linked" });
      }
      if (error?.code === "23503")
        throw new PublicApiError("That team or hospital is unavailable.", 404, { code: "work_people_not_found" });
      if (error) throw unavailable();
      return readPeople(client, context, change.hospitalId);
    }
    case "create-hospital": {
      if (!isAdministrator(context)) throw denied();
      if (looksLikePatientDetail(change.name)) {
        throw new PublicApiError("Use the hospital's name only.", 400, { code: "work_people_invalid" });
      }
      const { data, error } = await client
        .from("work_hospitals")
        .insert({ name: change.name, created_by: context.userId })
        .select("id")
        .single();
      if (error?.code === "23505") {
        throw new PublicApiError("A hospital with that name already exists.", 409, { code: "work_hospital_exists" });
      }
      if (error || !data) throw unavailable();
      return readPeople(client, context, data.id);
    }
    case "move-team":
      return readPeople(client, context, await moveTeam(client, context, change));
    case "rename-hospital":
      await renameHospital(client, context, change);
      return readPeople(client, context, change.hospitalId);
    case "archive-hospital":
      await archiveHospital(client, context, change);
      // It drops out of the list, so show the first hospital left.
      return readPeople(client, context, null);
  }
}
