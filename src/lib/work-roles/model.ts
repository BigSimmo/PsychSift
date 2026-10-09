/**
 * The one hospital-side role and permission model for work mode.
 *
 * Every screen that a hospital role opens (Medical Workforce, a supervisor or
 * assessor, the DCT, a team's roster manager, the site administrator) asks one
 * question through this module: can this person do this thing here? Rotation
 * preferences, Course bookings and Assessments all ask it the same way, so a
 * role is granted once and works everywhere.
 *
 * Roles:
 * - administrator: the site administrator (`app_metadata.site_role`). Everywhere.
 * - manager: a team's roster manager (`roster_member_roles.role = 'manager'`). One team.
 * - workforce: Medical Workforce. One hospital, which covers every team linked to it.
 * - dct: the Director of Clinical Training. One hospital.
 * - supervisor: an assessor or supervisor. One trainee, or a whole team.
 *
 * This file is pure. It never reads a server, so the same rules run on the
 * server (the real check) and on a phone (only to choose what to show).
 */

export const WORK_ROLES = ["administrator", "workforce", "dct", "supervisor", "manager"] as const;
export type WorkRole = (typeof WORK_ROLES)[number];

/** Roles kept in `work_role_grants`. The administrator and manager roles already live elsewhere. */
export const GRANTABLE_WORK_ROLES = ["workforce", "dct", "supervisor"] as const;
export type GrantableWorkRole = (typeof GRANTABLE_WORK_ROLES)[number];

export const WORK_CAPABILITIES = [
  "courses.manage",
  "rotations.manage",
  "assessments.review",
  "assessments.overview",
  "assessments.administer",
  "starters.view",
  "sick.inbox",
  "staffing.manage",
  "roles.grant",
] as const;
export type WorkCapability = (typeof WORK_CAPABILITIES)[number];

/** Where a check applies. A team is an `on_call_services` row. A hospital groups teams. */
export type WorkScope =
  | { readonly kind: "everyone" }
  | { readonly kind: "hospital"; readonly hospitalId: string }
  | { readonly kind: "team"; readonly serviceId: string }
  | { readonly kind: "trainee"; readonly userId: string; readonly serviceId?: string | null };

/**
 * One role a person holds. `serviceIds` on a hospital grant lists the teams
 * linked to that hospital when the grants were read, so a team check can be
 * answered without another read.
 */
export type WorkRoleGrant =
  | { readonly role: "administrator" }
  | { readonly role: "manager"; readonly serviceId: string }
  | {
      readonly role: "workforce" | "dct";
      readonly hospitalId: string;
      readonly hospitalName?: string | null;
      readonly serviceIds: readonly string[];
    }
  | {
      readonly role: "supervisor";
      /** The hospital that gave the role, for display and for who may remove it. */
      readonly hospitalId?: string | null;
      /** A whole-team supervisor. */
      readonly serviceId?: string | null;
      /** A supervisor of one trainee. */
      readonly subjectUserId?: string | null;
    };

type CapabilityRule = {
  /** True when the site administrator may do it. Signing an assessment is a clinical act, so it is not. */
  readonly administrator: boolean;
  /** Roles that hold it for every team in their hospital, and for the hospital itself. */
  readonly hospital: readonly ("workforce" | "dct")[];
  /** Roles that hold it for their own team. */
  readonly team: readonly ("manager" | "supervisor")[];
  /** True when a one-trainee supervisor holds it for that trainee. */
  readonly trainee: boolean;
};

export const WORK_CAPABILITY_RULES: Record<WorkCapability, CapabilityRule> = {
  "courses.manage": { administrator: true, hospital: ["workforce", "dct"], team: ["manager"], trainee: false },
  "rotations.manage": { administrator: true, hospital: ["workforce"], team: ["manager"], trainee: false },
  "assessments.review": { administrator: false, hospital: ["dct"], team: ["supervisor"], trainee: true },
  "assessments.overview": { administrator: true, hospital: ["dct", "workforce"], team: [], trainee: false },
  "assessments.administer": { administrator: true, hospital: ["dct"], team: [], trainee: false },
  "starters.view": { administrator: true, hospital: ["workforce"], team: [], trainee: false },
  "sick.inbox": { administrator: true, hospital: ["workforce"], team: ["manager"], trainee: false },
  "staffing.manage": { administrator: true, hospital: ["workforce"], team: ["manager"], trainee: false },
  "roles.grant": { administrator: true, hospital: ["workforce"], team: [], trainee: false },
};

export function isWorkCapability(value: unknown): value is WorkCapability {
  return typeof value === "string" && (WORK_CAPABILITIES as readonly string[]).includes(value);
}

export function isGrantableWorkRole(value: unknown): value is GrantableWorkRole {
  return typeof value === "string" && (GRANTABLE_WORK_ROLES as readonly string[]).includes(value);
}

function hospitalCovers(grant: { hospitalId: string; serviceIds: readonly string[] }, scope: WorkScope): boolean {
  switch (scope.kind) {
    case "hospital":
      return grant.hospitalId === scope.hospitalId;
    case "team":
      return grant.serviceIds.includes(scope.serviceId);
    case "trainee":
      return Boolean(scope.serviceId) && grant.serviceIds.includes(scope.serviceId as string);
    case "everyone":
      return false;
  }
}

function teamCovers(serviceId: string | null | undefined, scope: WorkScope): boolean {
  if (!serviceId) return false;
  if (scope.kind === "team") return scope.serviceId === serviceId;
  if (scope.kind === "trainee") return scope.serviceId === serviceId;
  return false;
}

/** The decision itself. Fails closed: an unknown capability or scope is a no. */
export function decideWorkCapability(
  grants: readonly WorkRoleGrant[],
  capability: WorkCapability,
  scope: WorkScope,
): boolean {
  const rule = WORK_CAPABILITY_RULES[capability];
  if (!rule) return false;
  return grants.some((grant) => {
    switch (grant.role) {
      case "administrator":
        return rule.administrator;
      case "workforce":
      case "dct":
        return rule.hospital.includes(grant.role) && hospitalCovers(grant, scope);
      case "manager":
        return rule.team.includes("manager") && teamCovers(grant.serviceId, scope);
      case "supervisor":
        if (rule.team.includes("supervisor") && teamCovers(grant.serviceId, scope)) return true;
        return rule.trainee && scope.kind === "trainee" && grant.subjectUserId === scope.userId;
      default:
        return false;
    }
  });
}

/**
 * Who may give or remove a role. Only the administrator gives Medical
 * Workforce. Medical Workforce gives DCT and supervisor in their hospital. The
 * DCT assigns supervisors in their hospital. Nobody grants a role to themselves
 * here, so one person cannot widen their own reach.
 */
export function decideGrantWorkRole(
  grants: readonly WorkRoleGrant[],
  actorId: string,
  target: { readonly userId: string; readonly role: GrantableWorkRole; readonly scope: WorkScope },
): boolean {
  if (target.userId === actorId) return false;
  if (grants.some((grant) => grant.role === "administrator")) return true;
  if (target.role === "workforce") return false;
  if (target.role === "dct") return decideWorkCapability(grants, "roles.grant", target.scope);
  return (
    decideWorkCapability(grants, "roles.grant", target.scope) ||
    decideWorkCapability(grants, "assessments.administer", target.scope)
  );
}

/** Plain-language labels, Australian spelling, for every screen that names a role. */
export const WORK_ROLE_LABEL: Record<WorkRole, string> = {
  administrator: "Site administrator",
  workforce: "Medical Workforce",
  dct: "Director of Clinical Training",
  supervisor: "Supervisor or assessor",
  manager: "Roster manager",
};

export const WORK_ROLE_SHORT_LABEL: Record<WorkRole, string> = {
  administrator: "Administrator",
  workforce: "Workforce",
  dct: "DCT",
  supervisor: "Supervisor",
  manager: "Manager",
};

/** The roles a person holds, deduplicated and in a fixed order, for chips and menus. */
export function heldWorkRoles(grants: readonly WorkRoleGrant[]): WorkRole[] {
  const held = new Set(grants.map((grant) => grant.role));
  return WORK_ROLES.filter((role) => held.has(role));
}
