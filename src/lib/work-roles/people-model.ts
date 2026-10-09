import { formatRecordedDate } from "@/lib/admin/renewal-dates";
import {
  decideGrantWorkRole,
  GRANTABLE_WORK_ROLES,
  isGrantableWorkRole,
  type GrantableWorkRole,
  type WorkRoleGrant,
} from "@/lib/work-roles/model";
import { checkPatientDetail } from "@/lib/work-text/patient-detail-check";
import { zonedDateOf } from "@/lib/work-time/format";

/**
 * People and roles (`/admin/people`): the shapes the people API sends, and the
 * pure rules the screen uses to lay them out, decide which buttons to show and
 * check a request before it goes. Nothing here is a permission: the server
 * checks every write again with the same model.
 */

export type PeopleHospitalRef = { readonly id: string; readonly name: string };

export type PeopleTeam = {
  readonly serviceId: string;
  readonly name: string;
  readonly managers: readonly { readonly userId: string; readonly name: string }[];
};

export type PeoplePerson = { readonly userId: string; readonly name: string; readonly serviceIds: readonly string[] };

export type PeopleGrant = {
  readonly id: string;
  readonly userId: string;
  readonly name: string;
  readonly role: GrantableWorkRole;
  readonly serviceId: string | null;
  readonly serviceName: string | null;
  readonly subjectUserId: string | null;
  readonly subjectName: string | null;
  readonly grantedAt: string;
  readonly grantedByName: string | null;
};

export type PeopleHospital = {
  readonly id: string;
  readonly name: string;
  readonly teams: readonly PeopleTeam[];
  readonly people: readonly PeoplePerson[];
  readonly grants: readonly PeopleGrant[];
};

export type LinkableTeam = { readonly serviceId: string; readonly name: string };

export type PeopleViewer = {
  readonly userId: string;
  readonly administrator: boolean;
  /**
   * The roles the server says this viewer may give in the selected hospital.
   * Absent from an older answer, when the screen works it out from the model.
   */
  readonly canGrant?: readonly GrantableWorkRole[];
};

export type WorkPeopleResponse = {
  readonly hospitals: readonly PeopleHospitalRef[];
  readonly hospital: PeopleHospital | null;
  readonly viewer: PeopleViewer;
  /** Teams not linked to any hospital yet, for "Link a team". Sent to the administrator only. */
  readonly unlinkedTeams: readonly LinkableTeam[];
};

type GrantCover = {
  readonly hospitalId: string;
  readonly role: GrantableWorkRole;
  readonly serviceId?: string | null;
  readonly subjectUserIds?: readonly string[];
};

export type WorkPeopleAction =
  | (GrantCover & { readonly action: "grant"; readonly userId: string; readonly email?: never })
  /** By email, for someone in no team yet (Medical Workforce often is not). The administrator only. */
  | (GrantCover & { readonly action: "grant"; readonly email: string; readonly userId?: never })
  | { readonly action: "revoke"; readonly grantId: string }
  | { readonly action: "link-team"; readonly hospitalId: string; readonly serviceId: string }
  | { readonly action: "create-hospital"; readonly name: string };

/* --------------------------------------------------------------- parsing */

const isString = (value: unknown): value is string => typeof value === "string";
const isNullableString = (value: unknown): value is string | null => value === null || typeof value === "string";
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function parseList<T>(value: unknown, parse: (item: unknown) => T | null): T[] | null {
  if (!Array.isArray(value)) return null;
  const out: T[] = [];
  for (const item of value) {
    const parsed = parse(item);
    if (parsed === null) return null;
    out.push(parsed);
  }
  return out;
}

function parseRef(value: unknown): PeopleHospitalRef | null {
  if (!isRecord(value) || !isString(value.id) || !isString(value.name)) return null;
  return { id: value.id, name: value.name };
}

function parseNamed(value: unknown): { userId: string; name: string } | null {
  if (!isRecord(value) || !isString(value.userId) || !isString(value.name)) return null;
  return { userId: value.userId, name: value.name };
}

function parseTeam(value: unknown): PeopleTeam | null {
  if (!isRecord(value) || !isString(value.serviceId) || !isString(value.name)) return null;
  const managers = parseList(value.managers ?? [], parseNamed);
  if (!managers) return null;
  return { serviceId: value.serviceId, name: value.name, managers };
}

function parseLinkable(value: unknown): LinkableTeam | null {
  if (!isRecord(value) || !isString(value.serviceId) || !isString(value.name)) return null;
  return { serviceId: value.serviceId, name: value.name };
}

function parsePerson(value: unknown): PeoplePerson | null {
  if (!isRecord(value) || !isString(value.userId) || !isString(value.name)) return null;
  const serviceIds = Array.isArray(value.serviceIds) ? value.serviceIds.filter(isString) : [];
  return { userId: value.userId, name: value.name, serviceIds };
}

function parseGrant(value: unknown): PeopleGrant | null {
  if (!isRecord(value)) return null;
  const { id, userId, name, role, serviceId, serviceName, subjectUserId, subjectName, grantedAt, grantedByName } =
    value;
  if (!isString(id) || !isString(userId) || !isString(name) || !isGrantableWorkRole(role)) return null;
  if (!isString(grantedAt)) return null;
  return {
    id,
    userId,
    name,
    role,
    serviceId: isNullableString(serviceId) ? serviceId : null,
    serviceName: isNullableString(serviceName) ? serviceName : null,
    subjectUserId: isNullableString(subjectUserId) ? subjectUserId : null,
    subjectName: isNullableString(subjectName) ? subjectName : null,
    grantedAt,
    grantedByName: isNullableString(grantedByName) ? grantedByName : null,
  };
}

function parseHospital(value: unknown): PeopleHospital | null {
  if (!isRecord(value) || !isString(value.id) || !isString(value.name)) return null;
  const teams = parseList(value.teams ?? [], parseTeam);
  const people = parseList(value.people ?? [], parsePerson);
  const grants = parseList(value.grants ?? [], parseGrant);
  if (!teams || !people || !grants) return null;
  return { id: value.id, name: value.name, teams, people, grants };
}

/** The people API's answer, checked field by field. Null when anything is missing or the wrong type. */
export function parseWorkPeopleResponse(value: unknown): WorkPeopleResponse | null {
  if (!isRecord(value)) return null;
  const hospitals = parseList(value.hospitals ?? [], parseRef);
  const hospital = value.hospital === null || value.hospital === undefined ? null : parseHospital(value.hospital);
  if (!hospitals || (value.hospital && !hospital)) return null;
  const unlinkedTeams = parseList(value.unlinkedTeams ?? [], parseLinkable);
  const viewer = value.viewer;
  if (!unlinkedTeams || !isRecord(viewer) || !isString(viewer.userId)) return null;
  const canGrant = Array.isArray(viewer.canGrant)
    ? GRANTABLE_WORK_ROLES.filter((role) => (viewer.canGrant as unknown[]).includes(role))
    : undefined;
  return {
    hospitals,
    hospital,
    unlinkedTeams,
    viewer: { userId: viewer.userId, administrator: viewer.administrator === true, ...(canGrant ? { canGrant } : {}) },
  };
}

/* ---------------------------------------------------------------- layout */

export type SupervisorRow = {
  readonly userId: string;
  readonly name: string;
  /** "Whole hospital", "All of Ward A team", or the trainees' names. */
  readonly cover: string;
  readonly grants: readonly PeopleGrant[];
};

export type TeamRow = {
  readonly serviceId: string;
  readonly name: string;
  readonly managers: readonly string[];
  readonly needsManager: boolean;
};

export type PeopleSections = {
  readonly workforce: readonly PeopleGrant[];
  readonly dct: readonly PeopleGrant[];
  readonly supervisors: readonly SupervisorRow[];
  readonly teams: readonly TeamRow[];
};

const byName = <T extends { readonly name: string }>(a: T, b: T) =>
  a.name.localeCompare(b.name, "en-AU", { sensitivity: "base" });

/** Joins names the way a sentence reads: "A", "A and B", "A, B and C". */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** What one supervisor covers, from all their supervisor grants in this hospital. */
export function supervisorCover(grants: readonly PeopleGrant[]): string {
  const supervisor = grants.filter((grant) => grant.role === "supervisor");
  if (supervisor.some((grant) => !grant.serviceId && !grant.subjectUserId)) return "Whole hospital";
  const teams = [
    ...new Set(supervisor.filter((grant) => !grant.subjectUserId && grant.serviceId).map((g) => g.serviceName)),
  ].map((name) => `All of ${name ?? "a team"}`);
  const trainees = [
    ...new Set(supervisor.filter((grant) => grant.subjectUserId).map((grant) => grant.subjectName ?? "A trainee")),
  ];
  return [...teams, ...trainees].join(", ");
}

/** The screen's four sections, each sorted by name, with one supervisor row per person. */
export function peopleSections(hospital: PeopleHospital): PeopleSections {
  const ofRole = (role: GrantableWorkRole) => [...hospital.grants.filter((grant) => grant.role === role)].sort(byName);
  const supervisorsByUser = new Map<string, PeopleGrant[]>();
  for (const grant of ofRole("supervisor")) {
    const list = supervisorsByUser.get(grant.userId) ?? [];
    list.push(grant);
    supervisorsByUser.set(grant.userId, list);
  }
  const supervisors = [...supervisorsByUser.values()]
    .map((grants) => ({
      userId: grants[0]!.userId,
      name: grants[0]!.name,
      cover: supervisorCover(grants),
      grants,
    }))
    .sort(byName);
  const teams = hospital.teams
    .map((team) => ({
      serviceId: team.serviceId,
      name: team.name,
      managers: team.managers.map((manager) => manager.name),
      needsManager: team.managers.length === 0,
    }))
    .sort(byName);
  return { workforce: ofRole("workforce"), dct: ofRole("dct"), supervisors, teams };
}

/** What one grant covers, in words: "Every team at X", "All of Ward A team", a trainee's name, "Whole hospital". */
export function grantCoverLabel(grant: PeopleGrant, hospitalName: string): string {
  if (grant.role !== "supervisor") return `Every team at ${hospitalName}`;
  if (grant.subjectUserId) return grant.subjectName ?? "One trainee";
  if (grant.serviceId) return `All of ${grant.serviceName ?? "a team"}`;
  return "Whole hospital";
}

/** "By Dr Sam Karri on 1 Jul 2026", in the work time zone. */
export function grantedLine(grant: PeopleGrant, zone: string): string {
  const parsed = Date.parse(grant.grantedAt);
  const on = Number.isNaN(parsed) ? null : formatRecordedDate(zonedDateOf(parsed, zone));
  if (grant.grantedByName && on) return `By ${grant.grantedByName} on ${on}`;
  if (grant.grantedByName) return `By ${grant.grantedByName}`;
  return on ? `On ${on}` : "Not recorded";
}

/* ------------------------------------------------------------ who may do */

/** The viewer's grants as the model reads them, with the API's administrator flag folded in. */
export function viewerGrants(viewer: PeopleViewer, grants: readonly WorkRoleGrant[]): WorkRoleGrant[] {
  const all = [...grants];
  if (viewer.administrator && !all.some((grant) => grant.role === "administrator")) all.push({ role: "administrator" });
  return all;
}

/** A target that is never the viewer, for asking "could they give this role to someone here". */
const SOMEONE_ELSE = "\u0000someone-else";

/**
 * The roles the viewer may give in this hospital, in the fixed order. The
 * server's `canGrant` wins when it sent one, and it can only narrow the model.
 */
export function rolesViewerMayGive(
  grants: readonly WorkRoleGrant[],
  viewerId: string,
  hospitalId: string,
  serverCanGrant?: readonly GrantableWorkRole[],
): GrantableWorkRole[] {
  if (serverCanGrant) return GRANTABLE_WORK_ROLES.filter((role) => serverCanGrant.includes(role));
  return GRANTABLE_WORK_ROLES.filter((role) =>
    decideGrantWorkRole(grants, viewerId, {
      userId: SOMEONE_ELSE,
      role,
      scope: { kind: "hospital", hospitalId },
    }),
  );
}

/** Whether the viewer may remove this grant. Never their own: nobody narrows or widens themselves here. */
export function mayRemoveGrant(
  grants: readonly WorkRoleGrant[],
  viewerId: string,
  hospitalId: string,
  grant: PeopleGrant,
): boolean {
  return decideGrantWorkRole(grants, viewerId, {
    userId: grant.userId,
    role: grant.role,
    scope: { kind: "hospital", hospitalId },
  });
}

/** Why the viewer cannot remove this grant, in one sentence. */
export function removeBlockedReason(grant: PeopleGrant, viewerId: string): string {
  if (grant.userId === viewerId) return "You can't remove your own role.";
  if (grant.role === "workforce") return "Only a site administrator can remove this role.";
  if (grant.role === "dct") return "Only Medical Workforce or a site administrator can remove this role.";
  return "Only Medical Workforce, the DCT or a site administrator can remove this role.";
}

/**
 * Who the reader is in the example: the same kind of role holder they are for
 * real, so the example shows only what they could do. A signed-out reader, an
 * administrator, or anyone else looking around sees the administrator's view.
 */
export function exampleViewerGrants(
  state: ExampleWorkPeople,
  real: readonly WorkRoleGrant[] | null,
): { readonly administrator: boolean; readonly grants: WorkRoleGrant[] } {
  const held = (role: WorkRoleGrant["role"]) => real?.some((grant) => grant.role === role) ?? false;
  const hospitalRole = held("administrator") ? null : held("workforce") ? "workforce" : held("dct") ? "dct" : null;
  if (!real || !hospitalRole) return { administrator: true, grants: [{ role: "administrator" }] };
  return {
    administrator: false,
    grants: state.hospitals.map((hospital) => ({
      role: hospitalRole,
      hospitalId: hospital.id,
      hospitalName: hospital.name,
      serviceIds: hospital.teams.map((team) => team.serviceId),
    })),
  };
}

/** Whether the screen is for this viewer: the administrator, Medical Workforce or the DCT. */
export function peopleScreenAllowed(grants: readonly WorkRoleGrant[]): boolean {
  return grants.some((grant) => grant.role === "administrator" || grant.role === "workforce" || grant.role === "dct");
}

/* ----------------------------------------------------------- give a role */

export type SupervisorCoverKind = "trainees" | "team";

export type GrantDraft = {
  readonly userId: string | null;
  /** Typed instead of picking, administrator only. Page memory only: never stored on the device. */
  readonly email: string;
  readonly role: GrantableWorkRole | null;
  readonly cover: SupervisorCoverKind;
  readonly serviceId: string | null;
  readonly subjectUserIds: readonly string[];
};

export const EMPTY_GRANT_DRAFT: GrantDraft = {
  userId: null,
  email: "",
  role: null,
  cover: "trainees",
  serviceId: null,
  subjectUserIds: [],
};

/** People the viewer may pick for a role: everyone in the hospital but themselves, by name. */
export function pickablePeople(people: readonly PeoplePerson[], viewerId: string): PeoplePerson[] {
  return people.filter((person) => person.userId !== viewerId).sort(byName);
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const EMAIL_MAX = 254;

/** What is wrong with a typed email, or null. It is sent, so it passes the shared patient-detail check too. */
export function grantEmailProblem(email: string): string | null {
  const trimmed = email.trim();
  if (!trimmed) return "Type their email.";
  if (trimmed.length > EMAIL_MAX || !EMAIL.test(trimmed)) return "That doesn't look like an email address.";
  const problem = checkPatientDetail(trimmed, { allowName: true, allowCapitals: true });
  return problem ? problem.body : null;
}

/** What stops this draft being sent, in a few words, or null when it is ready. */
export function grantDraftProblem(
  draft: GrantDraft,
  viewerId: string,
  options: { readonly viewerEmail?: string | null } = {},
): string | null {
  const byEmail = !draft.userId && draft.email.trim() !== "";
  if (byEmail) {
    const problem = grantEmailProblem(draft.email);
    if (problem) return problem;
    const own = options.viewerEmail?.trim().toLowerCase();
    if (own && own === draft.email.trim().toLowerCase()) return "You can't give yourself a role.";
  } else {
    if (!draft.userId) return "Pick a person.";
    if (draft.userId === viewerId) return "You can't give yourself a role.";
  }
  if (!draft.role) return "Pick a role.";
  if (draft.role !== "supervisor") return null;
  if (draft.cover === "team") return draft.serviceId ? null : "Pick a team.";
  if (draft.subjectUserIds.length === 0) return "Pick at least one trainee.";
  if (draft.userId && draft.subjectUserIds.includes(draft.userId)) return "Nobody can supervise themselves.";
  return null;
}

/** The request for a ready draft. Call only when `grantDraftProblem` is null. */
export function grantRequest(draft: GrantDraft, hospitalId: string): WorkPeopleAction | null {
  if (!draft.role) return null;
  const cover: GrantCover =
    draft.role !== "supervisor"
      ? { hospitalId, role: draft.role }
      : draft.cover === "team"
        ? { hospitalId, role: "supervisor", serviceId: draft.serviceId }
        : { hospitalId, role: "supervisor", serviceId: null, subjectUserIds: [...draft.subjectUserIds] };
  if (draft.userId) return { action: "grant", userId: draft.userId, ...cover };
  const email = draft.email.trim();
  return email ? { action: "grant", email, ...cover } : null;
}

/** One plain sentence of what the role lets the person see and do. */
export function roleSentence(
  role: GrantableWorkRole,
  context: {
    readonly hospitalName: string;
    readonly teamName?: string | null;
    readonly traineeNames?: readonly string[];
  },
): string {
  switch (role) {
    case "workforce":
      return `They see starters, sick calls, staffing, rotations and courses for every team at ${context.hospitalName}, and can give the DCT and supervisor roles there.`;
    case "dct":
      return `They see the assessment overview for every team at ${context.hospitalName}, review and sign assessments, run courses and assign supervisors.`;
    case "supervisor": {
      if (context.teamName) return `They can review and sign assessments for everyone in ${context.teamName}.`;
      const names = context.traineeNames ?? [];
      if (names.length === 0) return "They can review and sign assessments for the trainees you pick.";
      return `They can review and sign assessments for ${joinNames(names)}, and nobody else.`;
    }
  }
}

/* ------------------------------------------------------- add a hospital */

export const HOSPITAL_NAME_MAX = 80;

/** What is wrong with a new hospital name, or null. Free text, so it passes the shared patient-detail check. */
export function hospitalNameProblem(name: string, existing: readonly PeopleHospitalRef[]): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "Type the hospital's name.";
  if (trimmed.length > HOSPITAL_NAME_MAX) return `Keep it to ${HOSPITAL_NAME_MAX} characters.`;
  const problem = checkPatientDetail(trimmed, { allowCapitals: true });
  if (problem) return problem.body;
  const key = trimmed.toLocaleLowerCase("en-AU");
  if (existing.some((hospital) => hospital.name.trim().toLocaleLowerCase("en-AU") === key)) {
    return "That hospital is already listed.";
  }
  return null;
}

/* ------------------------------------------------------- example memory */

/** The example records: every hospital in full, kept in page memory only. */
export type ExampleWorkPeople = {
  readonly viewer: { readonly userId: string; readonly administrator: boolean; readonly name: string };
  readonly hospitals: readonly PeopleHospital[];
  /** Teams linked to no example hospital yet. */
  readonly unlinkedTeams: readonly LinkableTeam[];
};

/** The example records answered the way the API would answer for one hospital. */
export function exampleResponse(state: ExampleWorkPeople, hospitalId: string | null): WorkPeopleResponse {
  const hospitals = state.hospitals.map((hospital) => ({ id: hospital.id, name: hospital.name }));
  const hospital = state.hospitals.find((entry) => entry.id === hospitalId) ?? state.hospitals[0] ?? null;
  const viewer = { userId: state.viewer.userId, administrator: state.viewer.administrator };
  const unlinkedTeams = state.viewer.administrator ? state.unlinkedTeams : [];
  return { hospitals, hospital, viewer, unlinkedTeams };
}

/**
 * Applies one write to the example records, in page memory, the way the
 * server would. Returns the new records and the hospital to show, or a
 * problem in words when the server would refuse it.
 */
export function applyExampleAction(
  state: ExampleWorkPeople,
  action: WorkPeopleAction,
  context: { readonly now: string; readonly newId: (kind: string) => string },
):
  | { readonly ok: true; readonly state: ExampleWorkPeople; readonly hospitalId: string }
  | { readonly ok: false; readonly problem: string } {
  const replace = (hospital: PeopleHospital) => ({
    ...state,
    hospitals: state.hospitals.map((entry) => (entry.id === hospital.id ? hospital : entry)),
  });
  switch (action.action) {
    case "create-hospital": {
      const problem = hospitalNameProblem(action.name, state.hospitals);
      if (problem) return { ok: false, problem };
      const hospital: PeopleHospital = {
        id: context.newId("hospital"),
        name: action.name.trim(),
        teams: [],
        people: [],
        grants: [],
      };
      return { ok: true, state: { ...state, hospitals: [...state.hospitals, hospital] }, hospitalId: hospital.id };
    }
    case "link-team": {
      const hospital = state.hospitals.find((entry) => entry.id === action.hospitalId);
      const team = state.unlinkedTeams.find((entry) => entry.serviceId === action.serviceId);
      if (!hospital || !team) return { ok: false, problem: "That team can't be linked now." };
      // A team belongs to one hospital, so it leaves the unlinked list.
      return {
        ok: true,
        state: {
          ...replace({
            ...hospital,
            teams: [...hospital.teams, { serviceId: team.serviceId, name: team.name, managers: [] }],
          }),
          unlinkedTeams: state.unlinkedTeams.filter((entry) => entry.serviceId !== team.serviceId),
        },
        hospitalId: hospital.id,
      };
    }
    case "revoke": {
      const hospital = state.hospitals.find((entry) => entry.grants.some((grant) => grant.id === action.grantId));
      if (!hospital) return { ok: false, problem: "That role was already removed." };
      return {
        ok: true,
        state: replace({ ...hospital, grants: hospital.grants.filter((grant) => grant.id !== action.grantId) }),
        hospitalId: hospital.id,
      };
    }
    case "grant": {
      const found = state.hospitals.find((entry) => entry.id === action.hospitalId);
      if (!found) return { ok: false, problem: "That hospital isn't listed." };
      let hospital: PeopleHospital = found;
      let person: PeoplePerson | undefined;
      if (action.email !== undefined) {
        if (!state.viewer.administrator) return { ok: false, problem: "Only a site administrator can add by email." };
        const problem = grantEmailProblem(action.email);
        if (problem) return { ok: false, problem };
        // No example account has an email, so an example one is made up from what was typed.
        const name = action.email.trim().split("@")[0]!;
        person = { userId: context.newId("user"), name, serviceIds: [] };
        hospital = { ...hospital, people: [...hospital.people, person] };
      } else {
        person = hospital.people.find((entry) => entry.userId === action.userId);
      }
      if (!person) return { ok: false, problem: "That person isn't in this hospital." };
      const holder: PeoplePerson = person;
      if (holder.userId === state.viewer.userId) return { ok: false, problem: "You can't give yourself a role." };
      const nameOf = (userId: string) => hospital.people.find((entry) => entry.userId === userId)?.name ?? null;
      const teamName = action.serviceId
        ? (hospital.teams.find((team) => team.serviceId === action.serviceId)?.name ?? null)
        : null;
      const base = {
        userId: holder.userId,
        name: holder.name,
        role: action.role,
        grantedAt: context.now,
        grantedByName: state.viewer.name,
      };
      const same = (grant: PeopleGrant, serviceId: string | null, subjectUserId: string | null) =>
        grant.userId === holder.userId &&
        grant.role === action.role &&
        grant.serviceId === serviceId &&
        grant.subjectUserId === subjectUserId;
      const rows: PeopleGrant[] =
        action.role === "supervisor" && action.subjectUserIds?.length
          ? action.subjectUserIds
              .filter((subject) => subject !== holder.userId)
              .map((subject) => ({
                ...base,
                id: context.newId("grant"),
                serviceId: null,
                serviceName: null,
                subjectUserId: subject,
                subjectName: nameOf(subject),
              }))
          : [
              {
                ...base,
                id: context.newId("grant"),
                serviceId: action.role === "supervisor" ? (action.serviceId ?? null) : null,
                serviceName: action.role === "supervisor" ? teamName : null,
                subjectUserId: null,
                subjectName: null,
              },
            ];
      const fresh = rows.filter(
        (row) => !hospital.grants.some((grant) => same(grant, row.serviceId, row.subjectUserId)),
      );
      if (fresh.length === 0) return { ok: false, problem: `${holder.name} already has that role.` };
      return {
        ok: true,
        state: replace({ ...hospital, grants: [...hospital.grants, ...fresh] }),
        hospitalId: hospital.id,
      };
    }
  }
}
