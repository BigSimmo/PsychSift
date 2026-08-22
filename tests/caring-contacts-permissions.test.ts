// tests/caring-contacts-permissions.test.ts
import { describe, expect, it } from "vitest";

import { actorId, teamId } from "@/lib/caring-contacts/ids";
import {
  ALL_ACTIONS,
  ROLE_ACTIONS,
  SYSTEM_ROLE_ACTIONS,
  UNGRANTED_ACTIONS,
  actorRoleNames,
  canApproveOwnAuthoredVersion,
  canPerformCaringContactAction,
  isSystemActor,
  type Actor,
  type CaringContactAction,
  type CaringContactRole,
  type CaringContactSystemRole,
  type Resource,
  type SystemActor,
} from "@/lib/caring-contacts/permissions";

const TEAM_A = teamId("TEAM-A");
const TEAM_B = teamId("TEAM-B");
// DERIVED from the grant tables, never hand-written. `ROLE_ACTIONS` is a
// `Record<CaringContactRole, ...>`, so a sixth role is FORCED into the production table by the
// compiler -- but a hand-written array here typed `readonly CaringContactRole[]` (not a tuple) is
// never required to be exhaustive, so the new role would be silently absent from every "for every
// role" claim in this file, including the one that keeps `triggerServiceSafetyStop` unblockable and
// the one holding the human and system grant tables disjoint. `permissions.ts` already derives
// `ALL_ACTIONS` from a `Record<Union, true>` registry for exactly this reason; the same pattern was
// simply never applied to roles.
const ROLES: readonly CaringContactRole[] = Object.keys(ROLE_ACTIONS) as CaringContactRole[];
const SYSTEM_ROLES: readonly CaringContactSystemRole[] = Object.keys(SYSTEM_ROLE_ACTIONS) as CaringContactSystemRole[];

const resourceIn = (team = TEAM_A): Resource => ({ teamId: team });

const actorWith = (roles: readonly CaringContactRole[], team = TEAM_A): Actor => ({
  id: actorId("ACTOR-1"),
  teamId: team,
  roles,
});

const dispatcherIn = (team = TEAM_A): SystemActor => ({
  id: actorId("SYSTEM-DISPATCHER"),
  teamId: team,
  systemRole: "contactDispatcher",
});

// ---------------------------------------------------------------------------
// Rule 1 — deny by default
// ---------------------------------------------------------------------------

describe("rule 1: deny by default", () => {
  it("denies an action not granted to any of the actor's roles", () => {
    const coordinator = actorWith(["coordinator"]);
    const decision = canPerformCaringContactAction(coordinator, "approveServiceRestart", resourceIn());
    expect(decision).toEqual({ allowed: false, reason: "action-not-granted" });
  });

  it("denies when the actor holds several roles but none is granted the action", () => {
    const actor = actorWith(["coordinator", "auditor"]);
    const decision = canPerformCaringContactAction(actor, "approvePathwayVersion", resourceIn());
    expect(decision).toEqual({ allowed: false, reason: "action-not-granted" });
  });
});

// ---------------------------------------------------------------------------
// Rule 2 — team scope is checked before the role grant
// ---------------------------------------------------------------------------

describe("rule 2: team scope precedes the role grant", () => {
  it("denies with cross-team-denied when the resource belongs to another team", () => {
    const teamLead = actorWith(["teamLead"], TEAM_A);
    const decision = canPerformCaringContactAction(teamLead, "changeContactDate", resourceIn(TEAM_B));
    expect(decision).toEqual({ allowed: false, reason: "cross-team-denied" });
  });

  it("returns cross-team-denied rather than action-not-granted, so a cross-team actor never learns which actions exist", () => {
    const auditor = actorWith(["auditor"], TEAM_A);
    const decision = canPerformCaringContactAction(auditor, "reassignPlan", resourceIn(TEAM_B));
    expect(decision).toEqual({ allowed: false, reason: "cross-team-denied" });
  });

  it("allows a same-team actor holding the right role", () => {
    const teamLead = actorWith(["teamLead"], TEAM_A);
    const decision = canPerformCaringContactAction(teamLead, "reassignPlan", resourceIn(TEAM_A));
    expect(decision).toEqual({ allowed: true });
  });
});

// ---------------------------------------------------------------------------
// Rule 3 — auditor may only viewAccessTrail
// ---------------------------------------------------------------------------

describe("rule 3: auditor is confined to viewAccessTrail", () => {
  const auditor = actorWith(["auditor"]);

  it("allows viewAccessTrail", () => {
    expect(canPerformCaringContactAction(auditor, "viewAccessTrail", resourceIn())).toEqual({ allowed: true });
  });

  it("denies viewing a referral", () => {
    expect(canPerformCaringContactAction(auditor, "viewReferral", resourceIn())).toEqual({
      allowed: false,
      reason: "action-not-granted",
    });
  });

  it("denies every mutating action", () => {
    const mutations: readonly CaringContactAction[] = [
      "acceptReferral",
      "claimPlan",
      "activatePlan",
      "pausePlan",
      "resumePlan",
      "withdrawPlan",
      "reassignPlan",
      "moveContactWithinDay",
      "changeContactDate",
      "authorPathwayVersion",
      "approvePathwayVersion",
      "approveServiceRestart",
      "recordHospitalStatusEvent",
    ];
    for (const action of mutations) {
      expect(canPerformCaringContactAction(auditor, action, resourceIn())).toEqual({
        allowed: false,
        reason: "action-not-granted",
      });
    }
  });

  it("denies generating a clinical record summary", () => {
    expect(canPerformCaringContactAction(auditor, "generateClinicalRecordSummary", resourceIn())).toEqual({
      allowed: false,
      reason: "action-not-granted",
    });
  });

  it("contrast: a coordinator (not an auditor) may generate a clinical record summary", () => {
    const coordinator = actorWith(["coordinator"]);
    expect(canPerformCaringContactAction(coordinator, "generateClinicalRecordSummary", resourceIn())).toEqual({
      allowed: true,
    });
  });
});

// ---------------------------------------------------------------------------
// Rule 4 — contact date changes and plan reassignment require teamLead
// ---------------------------------------------------------------------------

describe("rule 4: changeContactDate and reassignPlan require teamLead", () => {
  it("denies changeContactDate to coordinator", () => {
    const coordinator = actorWith(["coordinator"]);
    expect(canPerformCaringContactAction(coordinator, "changeContactDate", resourceIn())).toEqual({
      allowed: false,
      reason: "action-not-granted",
    });
  });

  it("allows changeContactDate to teamLead", () => {
    const teamLead = actorWith(["teamLead"]);
    expect(canPerformCaringContactAction(teamLead, "changeContactDate", resourceIn())).toEqual({ allowed: true });
  });

  it("denies reassignPlan to coordinator", () => {
    const coordinator = actorWith(["coordinator"]);
    expect(canPerformCaringContactAction(coordinator, "reassignPlan", resourceIn())).toEqual({
      allowed: false,
      reason: "action-not-granted",
    });
  });

  it("allows reassignPlan to teamLead", () => {
    const teamLead = actorWith(["teamLead"]);
    expect(canPerformCaringContactAction(teamLead, "reassignPlan", resourceIn())).toEqual({ allowed: true });
  });

  it("allows moveContactWithinDay to coordinator", () => {
    const coordinator = actorWith(["coordinator"]);
    expect(canPerformCaringContactAction(coordinator, "moveContactWithinDay", resourceIn())).toEqual({
      allowed: true,
    });
  });
});

// ---------------------------------------------------------------------------
// Rule 5 — pathway version authoring, approval, and the self-approval guard
// ---------------------------------------------------------------------------

describe("rule 5: pathway version approval requires teamLead and forbids self-approval", () => {
  it("denies approvePathwayVersion to coordinator", () => {
    const coordinator = actorWith(["coordinator"]);
    expect(canPerformCaringContactAction(coordinator, "approvePathwayVersion", resourceIn())).toEqual({
      allowed: false,
      reason: "action-not-granted",
    });
  });

  it("allows approvePathwayVersion to teamLead", () => {
    const teamLead = actorWith(["teamLead"]);
    expect(canPerformCaringContactAction(teamLead, "approvePathwayVersion", resourceIn())).toEqual({
      allowed: true,
    });
  });

  it("allows authorPathwayVersion to coordinator", () => {
    const coordinator = actorWith(["coordinator"]);
    expect(canPerformCaringContactAction(coordinator, "authorPathwayVersion", resourceIn())).toEqual({
      allowed: true,
    });
  });

  it("denies self-approval when the author and the approver are the same actor", () => {
    const author = actorId("ACTOR-1");
    expect(canApproveOwnAuthoredVersion(author, author)).toEqual({
      allowed: false,
      reason: "self-approval-denied",
    });
  });

  it("allows approval when the approver differs from the author", () => {
    const author = actorId("ACTOR-1");
    const approver = actorId("ACTOR-2");
    expect(canApproveOwnAuthoredVersion(author, approver)).toEqual({ allowed: true });
  });
});

// ---------------------------------------------------------------------------
// Rule 6 — the safety stop is never blocked; the restart needs teamLead
// ---------------------------------------------------------------------------

describe("rule 6: triggerServiceSafetyStop is unblockable; approveServiceRestart requires teamLead", () => {
  it.each(ROLES)("allows triggerServiceSafetyStop for role %s", (role) => {
    const actor = actorWith([role]);
    expect(canPerformCaringContactAction(actor, "triggerServiceSafetyStop", resourceIn())).toEqual({
      allowed: true,
    });
  });

  it("denies approveServiceRestart to coordinator", () => {
    const coordinator = actorWith(["coordinator"]);
    expect(canPerformCaringContactAction(coordinator, "approveServiceRestart", resourceIn())).toEqual({
      allowed: false,
      reason: "action-not-granted",
    });
  });

  it("denies approveServiceRestart to auditor", () => {
    const auditor = actorWith(["auditor"]);
    expect(canPerformCaringContactAction(auditor, "approveServiceRestart", resourceIn())).toEqual({
      allowed: false,
      reason: "action-not-granted",
    });
  });

  it("allows approveServiceRestart to teamLead", () => {
    const teamLead = actorWith(["teamLead"]);
    expect(canPerformCaringContactAction(teamLead, "approveServiceRestart", resourceIn())).toEqual({
      allowed: true,
    });
  });
});

// ---------------------------------------------------------------------------
// Rule 7 — an actor with no roles is denied everything
// ---------------------------------------------------------------------------

describe("rule 7: an actor with no roles is denied everything", () => {
  it("denies with no-roles for an ordinary action", () => {
    const actor = actorWith([]);
    expect(canPerformCaringContactAction(actor, "viewReferral", resourceIn())).toEqual({
      allowed: false,
      reason: "no-roles",
    });
  });

  it("denies with no-roles even for triggerServiceSafetyStop", () => {
    const actor = actorWith([]);
    expect(canPerformCaringContactAction(actor, "triggerServiceSafetyStop", resourceIn())).toEqual({
      allowed: false,
      reason: "no-roles",
    });
  });

  it("still checks team scope before the no-roles refusal", () => {
    const actor = actorWith([], TEAM_A);
    expect(canPerformCaringContactAction(actor, "viewReferral", resourceIn(TEAM_B))).toEqual({
      allowed: false,
      reason: "cross-team-denied",
    });
  });
});

// ---------------------------------------------------------------------------
// Rule 7a — hospital status events are a clinical write, not a service safety stop
// ---------------------------------------------------------------------------

describe("rule 7a: recordHospitalStatusEvent is a coordinator/teamLead clinical write", () => {
  it.each(["coordinator", "teamLead"] as const)("allows recordHospitalStatusEvent to %s", (role) => {
    expect(canPerformCaringContactAction(actorWith([role]), "recordHospitalStatusEvent", resourceIn())).toEqual({
      allowed: true,
    });
  });

  it("denies recordHospitalStatusEvent to the auditor, who stays confined to reading", () => {
    expect(canPerformCaringContactAction(actorWith(["auditor"]), "recordHospitalStatusEvent", resourceIn())).toEqual({
      allowed: false,
      reason: "action-not-granted",
    });
  });

  it("still leaves every role holding triggerServiceSafetyStop, which is what keeps a death unblockable", () => {
    for (const role of ROLES) {
      expect(canPerformCaringContactAction(actorWith([role]), "triggerServiceSafetyStop", resourceIn())).toEqual({
        allowed: true,
      });
    }
  });
});

// ---------------------------------------------------------------------------
// Rule 8 — the system actor writes contact status and nothing else
// ---------------------------------------------------------------------------

const CONTACT_STATUS_ACTIONS: readonly CaringContactAction[] = [
  "startContactDispatch",
  "recordContactSent",
  "recordContactProviderStatus",
  "recordContactMissed",
];

describe("rule 8: a system actor holds exactly the contact-status actions", () => {
  it.each(CONTACT_STATUS_ACTIONS)("allows %s to the dispatcher", (action) => {
    expect(canPerformCaringContactAction(dispatcherIn(), action, resourceIn())).toEqual({ allowed: true });
  });

  it("denies the dispatcher every action outside the contact-status set", () => {
    const dispatcher = dispatcherIn();
    for (const action of ALL_ACTIONS) {
      if (CONTACT_STATUS_ACTIONS.includes(action)) continue;
      expect(canPerformCaringContactAction(dispatcher, action, resourceIn())).toEqual({
        allowed: false,
        reason: "action-not-granted",
      });
    }
  });

  it("denies the dispatcher the three that matter most: activating, withdrawing, and approving", () => {
    const dispatcher = dispatcherIn();
    for (const action of ["activatePlan", "withdrawPlan", "approvePathwayVersion"] as const) {
      expect(canPerformCaringContactAction(dispatcher, action, resourceIn())).toEqual({
        allowed: false,
        reason: "action-not-granted",
      });
    }
  });

  it("checks team scope for a system actor before anything else", () => {
    expect(canPerformCaringContactAction(dispatcherIn(TEAM_A), "recordContactSent", resourceIn(TEAM_B))).toEqual({
      allowed: false,
      reason: "cross-team-denied",
    });
  });

  it.each(ROLES)("denies every contact-status action to human role %s", (role) => {
    const actor = actorWith([role]);
    for (const action of CONTACT_STATUS_ACTIONS) {
      expect(canPerformCaringContactAction(actor, action, resourceIn())).toEqual({
        allowed: false,
        reason: "action-not-granted",
      });
    }
  });

  it("ignores human roles smuggled onto a system actor", () => {
    const smuggled = {
      ...dispatcherIn(),
      roles: ["teamLead"] as readonly CaringContactRole[],
    } as unknown as SystemActor;

    expect(isSystemActor(smuggled)).toBe(true);
    expect(canPerformCaringContactAction(smuggled, "withdrawPlan", resourceIn())).toEqual({
      allowed: false,
      reason: "action-not-granted",
    });
    expect(canPerformCaringContactAction(smuggled, "recordContactSent", resourceIn())).toEqual({ allowed: true });
  });

  it("names the system role, not a human role, for the audit trail", () => {
    expect(actorRoleNames(dispatcherIn())).toEqual(["contactDispatcher"]);
    expect(actorRoleNames(actorWith(["coordinator"]))).toEqual(["coordinator"]);
    expect(isSystemActor(actorWith(["coordinator"]))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Table-driven completeness: no action can silently default to allowed
// ---------------------------------------------------------------------------

describe("every CaringContactAction is explicitly classified", () => {
  it.each(ALL_ACTIONS)("%s is granted to a human role, a system role, or listed as ungranted", (action) => {
    const grantedToSomeRole = ROLES.some((role) => ROLE_ACTIONS[role].includes(action));
    const grantedToSomeSystemRole = SYSTEM_ROLES.some((role) => SYSTEM_ROLE_ACTIONS[role].includes(action));
    const explicitlyUngranted = UNGRANTED_ACTIONS.includes(action);
    expect(grantedToSomeRole || grantedToSomeSystemRole || explicitlyUngranted).toBe(true);
  });

  it("has no action that is both granted and marked ungranted", () => {
    const grantedActions = new Set([
      ...ROLES.flatMap((role) => ROLE_ACTIONS[role]),
      ...SYSTEM_ROLES.flatMap((role) => SYSTEM_ROLE_ACTIONS[role]),
    ]);
    for (const action of UNGRANTED_ACTIONS) {
      expect(grantedActions.has(action)).toBe(false);
    }
  });

  it("keeps the human and system grant tables disjoint", () => {
    const humanActions = new Set(ROLES.flatMap((role) => ROLE_ACTIONS[role]));
    const systemActions = SYSTEM_ROLES.flatMap((role) => SYSTEM_ROLE_ACTIONS[role]);
    expect(systemActions.length).toBeGreaterThan(0);
    for (const action of systemActions) {
      expect(humanActions.has(action)).toBe(false);
    }
  });

  it("covers every action in ALL_ACTIONS with no leftovers on either side", () => {
    const covered = new Set<CaringContactAction>([
      ...ROLES.flatMap((role) => ROLE_ACTIONS[role]),
      ...SYSTEM_ROLES.flatMap((role) => SYSTEM_ROLE_ACTIONS[role]),
      ...UNGRANTED_ACTIONS,
    ]);
    expect([...covered].sort()).toEqual([...ALL_ACTIONS].sort());
  });

  it("falls through to action-not-granted for an action absent from every grant list (deny-by-default sanity check)", () => {
    const coordinator = actorWith(["coordinator"]);
    const decision = canPerformCaringContactAction(
      coordinator,
      "someHypotheticalFutureAction" as CaringContactAction,
      resourceIn(),
    );
    expect(decision).toEqual({ allowed: false, reason: "action-not-granted" });
  });
});

// ---------------------------------------------------------------------------
// The grant tables are looked up by own property, never by prototype inheritance
//
// `ROLE_ACTIONS` and `SYSTEM_ROLE_ACTIONS` are frozen OBJECT LITERALS, so every key an ordinary
// object inherits resolves to something: `ROLE_ACTIONS["constructor"]` is a function, and calling
// `.includes` on a function is a TypeError. An unknown-shaped role therefore used to CRASH the
// capability check rather than refuse it -- and the `?? []` guard beside it never fired, because a
// function is not nullish.
//
// This exact shape has been found and fixed twice already on this branch, in
// caring-contacts-overlay-definitions and in the overlay host's block-reason wording, and neither
// fix travelled. The check has to be repeated per lookup, so it is asserted per lookup.
// ---------------------------------------------------------------------------
describe("an unknown-shaped role is refused rather than throwing", () => {
  const INHERITED_KEYS = [
    "constructor",
    "toString",
    "valueOf",
    "hasOwnProperty",
    "__proto__",
    "isPrototypeOf",
    "propertyIsEnumerable",
    "toLocaleString",
  ] as const;

  it.each(INHERITED_KEYS)("refuses a human role named %s with action-not-granted", (key) => {
    const actor = actorWith([key as CaringContactRole]);
    expect(canPerformCaringContactAction(actor, "viewReferral", resourceIn())).toEqual({
      allowed: false,
      reason: "action-not-granted",
    });
  });

  it.each(INHERITED_KEYS)("refuses a system role named %s with action-not-granted", (key) => {
    const actor: SystemActor = {
      id: actorId("SYSTEM-UNKNOWN"),
      teamId: TEAM_A,
      systemRole: key as CaringContactSystemRole,
    };
    expect(canPerformCaringContactAction(actor, "startContactDispatch", resourceIn())).toEqual({
      allowed: false,
      reason: "action-not-granted",
    });
  });

  it("refuses a plain unknown role, and still allows a real role alongside it", () => {
    const actor = actorWith(["notARole" as CaringContactRole]);
    expect(canPerformCaringContactAction(actor, "viewReferral", resourceIn())).toEqual({
      allowed: false,
      reason: "action-not-granted",
    });

    const mixed = actorWith(["constructor" as CaringContactRole, "coordinator"]);
    expect(canPerformCaringContactAction(mixed, "viewReferral", resourceIn())).toEqual({ allowed: true });
  });
});

// ---------------------------------------------------------------------------
// The role lists this file iterates are DERIVED, not hand-written
//
// `ROLES` and `SYSTEM_ROLES` were literal arrays typed `readonly CaringContactRole[]` rather than
// tuples, so TypeScript never required them to be exhaustive. `ROLE_ACTIONS` is a
// `Record<CaringContactRole, ...>`, so a sixth role is FORCED into the production grant table and
// silently absent from a hand-written list here -- and every "for every role" claim in this file,
// including the one that keeps a safety stop unblockable, would have gone on passing green while
// saying nothing about the new role.
// ---------------------------------------------------------------------------
describe("the role lists cannot fall behind the grant tables", () => {
  it("derives every role from the grant table itself", () => {
    expect([...ROLES].sort()).toEqual(Object.keys(ROLE_ACTIONS).sort());
    expect([...SYSTEM_ROLES].sort()).toEqual(Object.keys(SYSTEM_ROLE_ACTIONS).sort());
    expect(ROLES.length).toBeGreaterThan(0);
    expect(SYSTEM_ROLES.length).toBeGreaterThan(0);
  });
});

describe("roles and actions added for the Phase 2 workspace", () => {
  const team = teamId("TEAM-A");
  const resource = { teamId: team };
  const withRoles = (...roles: CaringContactRole[]): Actor => ({
    id: actorId("ACTOR-1"),
    teamId: team,
    roles,
  });

  it("names every new action exactly once", () => {
    const added = [
      "createReferral",
      "returnReferralForClarification",
      "declineReferral",
      "publishPathwayVersion",
      "retirePathwayVersion",
      "reconcileProviderDispatch",
      "manageNotificationPreferences",
      "enterTrainingMode",
      "viewPatientRecord",
      "coverCoordinator",
    ] as const;
    for (const action of added) {
      expect(ALL_ACTIONS).toContain(action);
      expect(ALL_ACTIONS.filter((candidate) => candidate === action)).toHaveLength(1);
    }
  });

  it("gives both approval roles the power to approve a pathway version", () => {
    for (const role of ["clinicalProgrammeLead", "livedExperienceRepresentative"] as const) {
      expect(canPerformCaringContactAction(withRoles(role), "approvePathwayVersion", resource)).toEqual({
        allowed: true,
      });
    }
  });

  it("lets only the clinical programme lead publish a pathway version", () => {
    expect(
      canPerformCaringContactAction(withRoles("clinicalProgrammeLead"), "publishPathwayVersion", resource),
    ).toEqual({ allowed: true });
    for (const role of ["coordinator", "teamLead", "auditor", "livedExperienceRepresentative"] as const) {
      expect(canPerformCaringContactAction(withRoles(role), "publishPathwayVersion", resource)).toEqual({
        allowed: false,
        reason: "action-not-granted",
      });
    }
  });

  it("keeps the safety stop available to every human role", () => {
    for (const role of [
      "coordinator",
      "teamLead",
      "auditor",
      "clinicalProgrammeLead",
      "livedExperienceRepresentative",
    ] as const) {
      expect(canPerformCaringContactAction(withRoles(role), "triggerServiceSafetyStop", resource)).toEqual({
        allowed: true,
      });
    }
  });

  it("keeps the auditor read-only — it may never change a plan", () => {
    for (const action of [
      "createReferral",
      "publishPathwayVersion",
      "reconcileProviderDispatch",
      "coverCoordinator",
    ] as const) {
      expect(canPerformCaringContactAction(withRoles("auditor"), action, resource)).toEqual({
        allowed: false,
        reason: "action-not-granted",
      });
    }
  });

  it("still refuses a cross-team actor before it considers the action", () => {
    const outsider: Actor = { id: actorId("ACTOR-2"), teamId: teamId("TEAM-B"), roles: ["clinicalProgrammeLead"] };
    expect(canPerformCaringContactAction(outsider, "approvePathwayVersion", resource)).toEqual({
      allowed: false,
      reason: "cross-team-denied",
    });
  });
});
