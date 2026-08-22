import { describe, expect, it } from "vitest";

import {
  assertSingleCurrentVersion,
  getCurrentPatientPlanVersion,
  getOpenManagementDraft,
  isPatientPlanVersionStale,
} from "@/components/care-plan/mockups/domain";
import { PROTOTYPE_NOW } from "@/components/care-plan/mockups/fixtures";
import {
  createInitialPrototypeState,
  getPrototypeMutationBlockReason,
  nextPresentationId,
  nextSyntheticId,
  prototypeReducer,
} from "@/components/care-plan/mockups/prototype-state";
import type {
  CarePlanPrototypeAction,
  CarePlanPrototypeState,
  ManagementDraftInput,
  NewEdPresentationInput,
  PrototypeScenario,
  SafetyPlanDraftInput,
  SyntheticId,
} from "@/components/care-plan/mockups/types";

const ED_CLINICIAN = "SYN-USER-ED-001";
const LIAISON = "SYN-USER-LIAISON-001";
const SENIOR = "SYN-USER-SENIOR-001";
const COORDINATOR = "SYN-USER-COORD-001";

const ROWAN = "SYN-PATIENT-001";
const MIRA = "SYN-PATIENT-002";
const JORDAN = "SYN-PATIENT-003";
const EVELYN = "SYN-PATIENT-004";

const ROWAN_PLAN = "SYN-MGMT-PLAN-001";
const MIRA_PLAN = "SYN-MGMT-PLAN-002";
const EVELYN_PLAN = "SYN-MGMT-PLAN-004";
const ROWAN_CURRENT_VERSION = "SYN-MGMT-VERSION-002";
const MIRA_AWAITING_VERSION = "SYN-MGMT-VERSION-004";

function withUser(state: CarePlanPrototypeState, userId: string): CarePlanPrototypeState {
  return prototypeReducer(state, { type: "set-active-user", userId: userId as `SYN-${string}` });
}

function run(scenario: PrototypeScenario, userId: string, ...actions: CarePlanPrototypeAction[]) {
  return actions.reduce(
    (state, action) => prototypeReducer(state, action),
    withUser(createInitialPrototypeState(scenario), userId),
  );
}

function presentationInput(overrides: Partial<NewEdPresentationInput> = {}): NewEdPresentationInput {
  return {
    patientId: ROWAN,
    arrivedAt: PROTOTYPE_NOW,
    siteId: "SYN-ED-001",
    presentingIndication: "",
    assessmentOutcome: "",
    note: "Arrived in the evening and went home the same night after assessment.",
    disposition: "discharged_home",
    cmhtContactAttempt: "not_attempted",
    cmhtContactOutcome: "",
    managementPlanVersionId: ROWAN_CURRENT_VERSION,
    planAvailability: "available",
    planUse: "used",
    planHelpfulness: "helpful",
    deviationOccurred: false,
    deviationReason: null,
    reviewSuggested: false,
    reviewReason: null,
    ...overrides,
  };
}

function draftInput(overrides: Partial<ManagementDraftInput> = {}): ManagementDraftInput {
  return {
    ownerId: LIAISON,
    reviewDueAt: "2027-08-20T14:30:00+08:00",
    revisionReason: "Contact details for the community team changed.",
    participationState: "co_produced",
    consentedSupportPeople: [],
    content: {
      howToApproach: ["Introduce yourself by name and say how long the wait is likely to be."],
      whatHelps: ["A quiet space away from the main corridor, offered on arrival."],
      whatMakesItWorse: ["Repeating the whole history to each new clinician instead of reading the plan first."],
      agreedEdApproach: ["Agreed with the community team and the consultant on 14 August 2026."],
      whatWouldMakeThisDifferent: ["New confusion or drowsiness, or a head injury before arrival."],
      whyThisPlanExists: "To keep the approach consistent between departments.",
      whatThePersonWants: [],
      practicalNeeds: [],
      physicalHealthAndMedication: [],
      whoElseIsInvolved: [],
      reviewTriggers: [],
    },
    ...overrides,
  };
}

function safetyDraftInput(overrides: Partial<SafetyPlanDraftInput> = {}): SafetyPlanDraftInput {
  return {
    reviewDueAt: "2027-08-20T14:30:00+08:00",
    patientConfirmation: "confirmed",
    collaborationNote: "Written together over one session. Jordan chose the wording and asked for a printed copy.",
    content: {
      warningSigns: ["Two or three nights of broken sleep in a row."],
      saferSurroundings: ["Ask my brother to hold my medicines for a few days."],
      reasonsForLiving: ["My dog, and my brother."],
      selfStrategies: ["Walk to the river and back before I decide anything."],
      connectionPeopleAndPlaces: ["The community garden on Saturday mornings."],
      personalSupports: [{ name: "Sam Placeholder", relationship: "brother", phone: "0491 570 991" }],
      professionalAndEmergencySupport: ["Wandoo District CMHT during working hours."],
    },
    ...overrides,
  };
}

/** Complete the conversion's deliberate gaps without changing the resource list.
 * The state tests care about the document lifecycle, not its prose. */
function completePatientPlanDraft(state: CarePlanPrototypeState, patientId: SyntheticId): CarePlanPrototypeState {
  const withDraft = prototypeReducer(state, { type: "create-patient-plan-draft", patientId });
  const draft = withDraft.patientPlanVersions.find((version) => version.state === "draft");
  if (draft === undefined) throw new Error("the Patient Plan draft was not created");
  return prototypeReducer(withDraft, {
    type: "save-patient-plan-draft",
    versionId: draft.id,
    input: {
      sections: draft.sections.map((section) => ({
        ...section,
        body: section.body.length > 0 ? section.body : ["Written with the person before approval."],
        gap: false,
        gapReason: null,
      })),
      resources: draft.resources,
    },
  });
}

/** The lines this application may never write: it knows what it asked an
 *  external application to do, and nothing about what happened afterwards. */
const OVERCLAIMING_LANGUAGE = [
  /\bmessage sent\b/i,
  /\bemail sent\b/i,
  /\bwas sent\b/i,
  /\bdelivered\b/i,
  /\bcontact completed\b/i,
  /\bcall answered\b/i,
  /\bspoke (?:to|with)\b/i,
  /\bwas printed\b/i,
  /\bthey replied\b/i,
];

function overclaims(line: string): boolean {
  return OVERCLAIMING_LANGUAGE.some((pattern) => pattern.test(line));
}

// --- The two contracts the task brief names first -------------------------------

describe("Care Plan Management Plan lifecycle", () => {
  it("approves an awaiting version atomically and preserves exactly one Current Plan", () => {
    let state = createInitialPrototypeState("overdue-plan");
    state = prototypeReducer(state, { type: "set-active-user", userId: SENIOR });
    const awaitingId = getOpenManagementDraft(state.managementPlanVersions, MIRA_PLAN)!.id;
    const next = prototypeReducer(state, { type: "approve-management-version", versionId: awaitingId });
    const versions = next.managementPlanVersions.filter(({ planId }) => planId === MIRA_PLAN);

    expect(versions.filter(({ state }) => state === "current")).toHaveLength(1);
    expect(versions.find(({ id }) => id === awaitingId)?.state).toBe("current");
    expect(versions.find(({ version }) => version === 1)?.state).toBe("superseded");
    expect(next.managementPlans.find(({ id }) => id === MIRA_PLAN)?.currentVersionId).toBe(awaitingId);
    expect(() => assertSingleCurrentVersion(next.managementPlanVersions)).not.toThrow();
    expect(next.auditEvents.filter(({ type }) => type === "management_version_approved")).toHaveLength(1);
  });

  it("adds a visible amendment without changing the original ED Presentation", () => {
    const state = createInitialPrototypeState();
    const original = state.edPresentations.find(({ id }) => id === "SYN-PRESENTATION-001")!;
    const next = prototypeReducer(state, {
      type: "amend-presentation",
      presentationId: original.id,
      field: "assessmentOutcome",
      replacementValue: "Discharged after senior review and follow-up confirmation.",
      reason: "Clarify the recorded outcome.",
    });

    expect(next.edPresentations.find(({ id }) => id === original.id)?.assessmentOutcome).toBe(
      original.assessmentOutcome,
    );
    expect(next.presentationAmendments.at(-1)).toMatchObject({
      presentationId: original.id,
      field: "assessmentOutcome",
    });
  });
});

// --- Approval, return, withdrawal, formal review ---------------------------------

describe("Care Plan approval guards", () => {
  it("refuses approval by a user whose role is not a named senior clinician", () => {
    const state = withUser(createInitialPrototypeState("overdue-plan"), LIAISON);
    const next = prototypeReducer(state, { type: "approve-management-version", versionId: MIRA_AWAITING_VERSION });

    // Negative controls: if the reducer wrongly permitted this, each of these fails.
    expect(next.managementPlanVersions).toEqual(state.managementPlanVersions);
    expect(next.managementPlans).toEqual(state.managementPlans);
    expect(next.auditEvents).toEqual(state.auditEvents);
    expect(next.lastOutcome?.kind).toBe("blocked");
    expect(next.lastOutcome?.message).toMatch(/does not carry this action/i);
  });

  it("refuses approval of a version whose required sections are empty", () => {
    let state = withUser(createInitialPrototypeState(), LIAISON);
    state = prototypeReducer(state, { type: "create-management-draft", patientId: JORDAN });
    const draftId = getOpenManagementDraft(state.managementPlanVersions, "SYN-MGMT-PLAN-003")!.id;
    state = prototypeReducer(state, { type: "submit-management-draft", versionId: draftId });
    const submitted = state;
    const next = prototypeReducer(withUser(submitted, SENIOR), {
      type: "approve-management-version",
      versionId: draftId,
    });

    expect(next.managementPlanVersions.find(({ id }) => id === draftId)?.state).toBe("awaiting_approval");
    expect(next.managementPlans.find(({ id }) => id === "SYN-MGMT-PLAN-003")?.currentVersionId).toBeNull();
    expect(next.lastOutcome?.message).toMatch(/required sections are empty/i);
  });

  it("refuses approval of a version with no stated reason for existing", () => {
    const state = run(
      "normal",
      LIAISON,
      { type: "create-management-draft", patientId: ROWAN },
      { type: "submit-management-draft", versionId: "SYN-MGMT-VERSION-007" },
      { type: "set-active-user", userId: SENIOR },
    );
    // The content came across from the Current Plan, so the reason is the only
    // thing missing.
    expect(state.managementPlanVersions.find(({ id }) => id === "SYN-MGMT-VERSION-007")?.revisionReason).toBe("");

    const next = prototypeReducer(state, {
      type: "approve-management-version",
      versionId: "SYN-MGMT-VERSION-007",
    });

    expect(next.managementPlanVersions.find(({ id }) => id === "SYN-MGMT-VERSION-007")?.state).toBe(
      "awaiting_approval",
    );
    expect(next.managementPlans.find(({ id }) => id === ROWAN_PLAN)?.currentVersionId).toBe(ROWAN_CURRENT_VERSION);
    expect(next.reviewTriggers).toEqual(state.reviewTriggers);
    expect(next.lastOutcome?.message).toMatch(/stated reason/i);
  });

  it("keeps a new Draft separate from the Current Plan", () => {
    const state = run("normal", LIAISON, { type: "create-management-draft", patientId: ROWAN });
    const plan = state.managementPlans.find(({ id }) => id === ROWAN_PLAN)!;
    const draft = getOpenManagementDraft(state.managementPlanVersions, ROWAN_PLAN)!;

    expect(draft.state).toBe("draft");
    expect(plan.currentVersionId).toBe(ROWAN_CURRENT_VERSION);
    expect(state.managementPlanVersions.find(({ id }) => id === ROWAN_CURRENT_VERSION)?.state).toBe("current");
    expect(plan.versionIds).toContain(draft.id);
    expect(draft.id).toBe("SYN-MGMT-VERSION-007");
  });

  it("refuses a second open draft while one is already being written", () => {
    const first = run("normal", LIAISON, { type: "create-management-draft", patientId: ROWAN });
    const second = prototypeReducer(first, { type: "create-management-draft", patientId: ROWAN });

    expect(second.managementPlanVersions).toEqual(first.managementPlanVersions);
    expect(second.auditEvents).toEqual(first.auditEvents);
    expect(second.lastOutcome?.message).toMatch(/already open/i);
  });

  it("refuses to save a draft whose next review date cannot be read as a date", () => {
    const state = run("normal", LIAISON, { type: "create-management-draft", patientId: ROWAN });
    const draftId = getOpenManagementDraft(state.managementPlanVersions, ROWAN_PLAN)!.id;
    const next = prototypeReducer(state, {
      type: "save-management-draft",
      versionId: draftId,
      input: draftInput({ reviewDueAt: "next winter" }),
    });

    expect(next.managementPlanVersions).toEqual(state.managementPlanVersions);
    expect(next.auditEvents).toEqual(state.auditEvents);
    expect(next.lastOutcome?.message).toMatch(/could not be read as a date/i);
  });

  it("refuses to edit a version that is awaiting approval", () => {
    const state = withUser(createInitialPrototypeState("overdue-plan"), LIAISON);
    const next = prototypeReducer(state, {
      type: "save-management-draft",
      versionId: MIRA_AWAITING_VERSION,
      input: draftInput(),
    });

    expect(next.managementPlanVersions).toEqual(state.managementPlanVersions);
    expect(next.lastOutcome?.message).toMatch(/awaiting approval and read-only/i);
  });

  it("returns an Awaiting Approval version to Draft without touching the Current Plan", () => {
    const state = withUser(createInitialPrototypeState("overdue-plan"), SENIOR);
    const next = prototypeReducer(state, {
      type: "return-management-version",
      versionId: MIRA_AWAITING_VERSION,
      reason: "Name who agreed the assessment order and on what date.",
    });

    expect(next.managementPlanVersions.find(({ id }) => id === MIRA_AWAITING_VERSION)?.state).toBe("draft");
    expect(next.managementPlanVersions.find(({ id }) => id === MIRA_AWAITING_VERSION)?.returnedReason).toMatch(
      /Name who agreed/,
    );
    expect(next.managementPlanVersions.find(({ id }) => id === "SYN-MGMT-VERSION-003")?.state).toBe("current");
    expect(next.managementPlans.find(({ id }) => id === MIRA_PLAN)?.currentVersionId).toBe("SYN-MGMT-VERSION-003");
  });

  it("refuses to return a version without a reason", () => {
    const state = withUser(createInitialPrototypeState("overdue-plan"), SENIOR);
    const next = prototypeReducer(state, {
      type: "return-management-version",
      versionId: MIRA_AWAITING_VERSION,
      reason: "   ",
    });

    expect(next.managementPlanVersions).toEqual(state.managementPlanVersions);
    expect(next.auditEvents).toEqual(state.auditEvents);
    expect(next.lastOutcome?.message).toMatch(/needs a reason/i);
  });

  it("leaves no Current Plan after withdrawal and never restores a superseded version", () => {
    const state = withUser(createInitialPrototypeState(), SENIOR);
    const next = prototypeReducer(state, {
      type: "withdraw-current-management-version",
      patientId: ROWAN,
      reason: "Rowan asked for the plan to be taken out of use while a new one is written with them.",
    });
    const versions = next.managementPlanVersions.filter(({ planId }) => planId === ROWAN_PLAN);

    expect(next.managementPlans.find(({ id }) => id === ROWAN_PLAN)?.currentVersionId).toBeNull();
    expect(versions.filter(({ state }) => state === "current")).toHaveLength(0);
    expect(versions.find(({ id }) => id === ROWAN_CURRENT_VERSION)).toMatchObject({
      state: "withdrawn",
      withdrawnBy: SENIOR,
    });
    expect(versions.find(({ id }) => id === "SYN-MGMT-VERSION-001")?.state).toBe("superseded");
  });

  it("refuses withdrawal without a reason and refuses it from a non-senior role", () => {
    const senior = withUser(createInitialPrototypeState(), SENIOR);
    const withoutReason = prototypeReducer(senior, {
      type: "withdraw-current-management-version",
      patientId: ROWAN,
      reason: "",
    });
    expect(withoutReason.managementPlanVersions).toEqual(senior.managementPlanVersions);
    expect(withoutReason.managementPlans).toEqual(senior.managementPlans);
    expect(withoutReason.lastOutcome?.message).toMatch(/needs a recorded reason/i);

    const liaison = withUser(createInitialPrototypeState(), LIAISON);
    const wrongRole = prototypeReducer(liaison, {
      type: "withdraw-current-management-version",
      patientId: ROWAN,
      reason: "A stated reason that should still not be enough.",
    });
    expect(wrongRole.managementPlanVersions).toEqual(liaison.managementPlanVersions);
    expect(wrongRole.managementPlans).toEqual(liaison.managementPlans);
    expect(wrongRole.lastOutcome?.kind).toBe("blocked");
  });

  it("records a formal review by moving the review date without creating a version", () => {
    const state = withUser(createInitialPrototypeState(), SENIOR);
    const next = prototypeReducer(state, {
      type: "record-formal-management-review",
      patientId: ROWAN,
      reason: "Reviewed with Rowan and the community team; the plan still describes what happens.",
      nextReviewDueAt: "2027-08-20T09:00:00+08:00",
    });

    expect(next.managementPlanVersions).toHaveLength(state.managementPlanVersions.length);
    expect(next.managementPlanVersions.find(({ id }) => id === ROWAN_CURRENT_VERSION)).toMatchObject({
      state: "current",
      reviewDueAt: "2027-08-20T09:00:00+08:00",
    });
    expect(next.auditEvents.at(-1)?.type).toBe("management_review_recorded");
  });

  it("refuses a formal review whose next review date cannot be read as a date", () => {
    const state = withUser(createInitialPrototypeState(), SENIOR);
    const next = prototypeReducer(state, {
      type: "record-formal-management-review",
      patientId: ROWAN,
      reason: "Reviewed at the August meeting.",
      nextReviewDueAt: "sometime next year",
    });

    expect(next.managementPlanVersions).toEqual(state.managementPlanVersions);
    expect(next.auditEvents).toEqual(state.auditEvents);
    expect(next.lastOutcome?.message).toMatch(/could not be read as a date/i);
  });
});

// --- Participation: approving a plan written without the person -------------------

describe("Care Plan participation triggers", () => {
  it("raises one open participation Review Trigger when a version is approved without the person's involvement", () => {
    const before = withUser(createInitialPrototypeState("overdue-plan"), SENIOR);
    expect(before.managementPlanVersions.find(({ id }) => id === MIRA_AWAITING_VERSION)?.participationState).toBe(
      "patient_unavailable",
    );

    const next = prototypeReducer(before, { type: "approve-management-version", versionId: MIRA_AWAITING_VERSION });
    const added = next.reviewTriggers.filter((trigger) => !before.reviewTriggers.some(({ id }) => id === trigger.id));

    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({
      source: "participation",
      status: "open",
      patientId: MIRA,
      managementPlanId: MIRA_PLAN,
      sourceId: MIRA_AWAITING_VERSION,
      resolvedAt: null,
      resolution: null,
    });
    // The version is still approved: participation never blocks approval.
    expect(next.managementPlanVersions.find(({ id }) => id === MIRA_AWAITING_VERSION)?.state).toBe("current");
    expect(next.auditEvents.filter(({ type }) => type === "management_version_approved")).toHaveLength(1);
    expect(next.lastOutcome?.kind).toBe("success");
  });

  it.each(["co_produced", "discussed"] as const)(
    "raises no participation Review Trigger when involvement is recorded as %s",
    (participationState) => {
      const state = run(
        "normal",
        LIAISON,
        { type: "create-management-draft", patientId: ROWAN },
        {
          type: "save-management-draft",
          versionId: "SYN-MGMT-VERSION-007",
          input: draftInput({ participationState }),
        },
        { type: "submit-management-draft", versionId: "SYN-MGMT-VERSION-007" },
        { type: "set-active-user", userId: SENIOR },
      );
      const next = prototypeReducer(state, {
        type: "approve-management-version",
        versionId: "SYN-MGMT-VERSION-007",
      });

      expect(next.managementPlanVersions.find(({ id }) => id === "SYN-MGMT-VERSION-007")?.state).toBe("current");
      // Negative control: the guard is not simply always-on.
      expect(next.reviewTriggers).toEqual(state.reviewTriggers);
    },
  );

  it("does not raise a second participation Review Trigger while one is already open on the plan", () => {
    const first = run(
      "normal",
      LIAISON,
      { type: "create-management-draft", patientId: ROWAN },
      {
        type: "save-management-draft",
        versionId: "SYN-MGMT-VERSION-007",
        input: draftInput({ participationState: "declined" }),
      },
      { type: "submit-management-draft", versionId: "SYN-MGMT-VERSION-007" },
      { type: "set-active-user", userId: SENIOR },
      { type: "approve-management-version", versionId: "SYN-MGMT-VERSION-007" },
    );
    expect(
      first.reviewTriggers.filter(
        (trigger) =>
          trigger.managementPlanId === ROWAN_PLAN && trigger.source === "participation" && trigger.status === "open",
      ),
    ).toHaveLength(1);

    const secondRound: CarePlanPrototypeAction[] = [
      { type: "set-active-user", userId: LIAISON },
      { type: "create-management-draft", patientId: ROWAN },
      {
        type: "save-management-draft",
        versionId: "SYN-MGMT-VERSION-008",
        input: draftInput({ participationState: "patient_unavailable" }),
      },
      { type: "submit-management-draft", versionId: "SYN-MGMT-VERSION-008" },
      { type: "set-active-user", userId: SENIOR },
      { type: "approve-management-version", versionId: "SYN-MGMT-VERSION-008" },
    ];
    const second = secondRound.reduce((state, action) => prototypeReducer(state, action), first);

    expect(second.managementPlanVersions.find(({ id }) => id === "SYN-MGMT-VERSION-008")?.state).toBe("current");
    expect(second.reviewTriggers).toEqual(first.reviewTriggers);
  });

  it("writes both participation trigger reasons without blaming the person", () => {
    const blaming = /\b(difficult|refus\w*|uncooperative|non-compliant|declined to engage|failed to)\b/i;
    // Negative control: the guard rejects the wording it exists to keep out.
    expect(blaming.test("The patient refuses to engage with the plan.")).toBe(true);

    const unavailable = prototypeReducer(withUser(createInitialPrototypeState("overdue-plan"), SENIOR), {
      type: "approve-management-version",
      versionId: MIRA_AWAITING_VERSION,
    }).reviewTriggers.find(({ source }) => source === "participation")!;
    expect(unavailable.reason).toMatch(/no involvement recorded/i);
    // Nobody recorded anything, so the record must not assert that they were absent.
    expect(unavailable.reason).not.toMatch(/was not available/i);
    expect(unavailable.reason).not.toMatch(blaming);

    const declined = run(
      "normal",
      LIAISON,
      { type: "create-management-draft", patientId: ROWAN },
      {
        type: "save-management-draft",
        versionId: "SYN-MGMT-VERSION-007",
        input: draftInput({ participationState: "declined" }),
      },
      { type: "submit-management-draft", versionId: "SYN-MGMT-VERSION-007" },
      { type: "set-active-user", userId: SENIOR },
      { type: "approve-management-version", versionId: "SYN-MGMT-VERSION-007" },
    ).reviewTriggers.find(({ source }) => source === "participation")!;
    expect(declined.reason).toMatch(/chose not to take part/i);
    expect(declined.reason).not.toMatch(blaming);
  });
});

// --- ED Presentations: append-only, and what they raise ---------------------------

describe("Care Plan ED Presentation recording", () => {
  it("appends an episode and one audit event", () => {
    const state = createInitialPrototypeState();
    const id = nextPresentationId(state);
    const next = prototypeReducer(state, {
      type: "record-presentation",
      presentationId: id,
      input: presentationInput(),
    });

    expect(id).toBe("SYN-PRESENTATION-021");
    expect(next.edPresentations).toHaveLength(state.edPresentations.length + 1);
    expect(next.edPresentations.at(-1)).toMatchObject({ id, recordedBy: ED_CLINICIAN });
    expect(next.auditEvents.filter(({ type }) => type === "presentation_recorded")).toHaveLength(1);
  });

  it("raises one open Review Trigger when the plan-use feedback says it helped only in part", () => {
    const state = createInitialPrototypeState();
    const next = prototypeReducer(state, {
      type: "record-presentation",
      presentationId: nextPresentationId(state),
      input: presentationInput({ planUse: "partially_used", planHelpfulness: "mixed" }),
    });
    const added = next.reviewTriggers.filter((trigger) => !state.reviewTriggers.some(({ id }) => id === trigger.id));

    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ managementPlanId: ROWAN_PLAN, source: "plan_use_feedback", status: "open" });
    // A trigger asks a person to look; it never changes the plan.
    expect(next.managementPlanVersions).toEqual(state.managementPlanVersions);
    expect(next.managementPlans).toEqual(state.managementPlans);
  });

  it("does not raise a second open Review Trigger for a reason already open on the plan", () => {
    // Rowan's plan already carries an open `presentation_outcome` trigger in the
    // fixtures, so an admission must not add another of the same kind.
    const state = createInitialPrototypeState();
    const openOutcomeTriggersBefore = state.reviewTriggers.filter(
      (trigger) =>
        trigger.managementPlanId === ROWAN_PLAN &&
        trigger.source === "presentation_outcome" &&
        trigger.status === "open",
    );
    expect(openOutcomeTriggersBefore).toHaveLength(1);

    const next = prototypeReducer(state, {
      type: "record-presentation",
      presentationId: nextPresentationId(state),
      input: presentationInput({ disposition: "mental_health_admission" }),
    });

    expect(next.reviewTriggers).toEqual(state.reviewTriggers);
    expect(next.edPresentations).toHaveLength(state.edPresentations.length + 1);
  });

  it("deduplicates across two consecutive episodes recorded for the same reason", () => {
    const first = createInitialPrototypeState();
    const second = prototypeReducer(first, {
      type: "record-presentation",
      presentationId: nextPresentationId(first),
      input: presentationInput({ planHelpfulness: "not_helpful" }),
    });
    const third = prototypeReducer(second, {
      type: "record-presentation",
      presentationId: nextPresentationId(second),
      input: presentationInput({ planHelpfulness: "not_helpful" }),
    });

    expect(second.reviewTriggers).toHaveLength(first.reviewTriggers.length + 1);
    expect(third.reviewTriggers).toEqual(second.reviewTriggers);
  });

  it("raises no Review Trigger for an episode that gives no reason to reconsider the plan", () => {
    const state = createInitialPrototypeState();
    const next = prototypeReducer(state, {
      type: "record-presentation",
      presentationId: nextPresentationId(state),
      input: presentationInput(),
    });

    expect(next.reviewTriggers).toEqual(state.reviewTriggers);
  });

  it("raises no Review Trigger for a person who has never had a Management Plan version", () => {
    const state = createInitialPrototypeState();
    const next = prototypeReducer(state, {
      type: "record-presentation",
      presentationId: nextPresentationId(state),
      input: presentationInput({
        patientId: JORDAN,
        siteId: "SYN-ED-003",
        managementPlanVersionId: null,
        planAvailability: "not_applicable",
        planUse: "not_applicable",
        planHelpfulness: "not_helpful",
      }),
    });

    expect(next.reviewTriggers).toEqual(state.reviewTriggers);
    expect(next.edPresentations).toHaveLength(state.edPresentations.length + 1);
  });

  it("raises a Review Trigger for a person whose plan was withdrawn and who then presents", () => {
    // The cohort the Reviews queue exists for. Evelyn has no Current version
    // because hers was withdrawn, but there is still a plan to reconsider, and
    // gating the trigger on a live Current version would drop her silently.
    const state = createInitialPrototypeState();
    expect(state.managementPlans.find(({ id }) => id === EVELYN_PLAN)?.currentVersionId).toBeNull();
    expect(state.managementPlanVersions.some(({ planId }) => planId === EVELYN_PLAN)).toBe(true);

    const next = prototypeReducer(state, {
      type: "record-presentation",
      presentationId: nextPresentationId(state),
      input: presentationInput({
        patientId: EVELYN,
        managementPlanVersionId: null,
        planAvailability: "unavailable",
        planUse: "not_applicable",
        planHelpfulness: "not_assessed",
        disposition: "mental_health_admission",
      }),
    });
    const added = next.reviewTriggers.filter((trigger) => !state.reviewTriggers.some(({ id }) => id === trigger.id));

    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({
      patientId: EVELYN,
      managementPlanId: EVELYN_PLAN,
      source: "presentation_outcome",
      status: "open",
    });
  });

  it("refuses an episode identifier that is already used or is not a synthetic presentation identifier", () => {
    const state = createInitialPrototypeState();

    const duplicate = prototypeReducer(state, {
      type: "record-presentation",
      presentationId: "SYN-PRESENTATION-001",
      input: presentationInput(),
    });
    expect(duplicate.edPresentations).toEqual(state.edPresentations);
    expect(duplicate.auditEvents).toEqual(state.auditEvents);
    expect(duplicate.lastOutcome?.message).toMatch(/already exists/i);

    const wrongPrefix = prototypeReducer(state, {
      type: "record-presentation",
      presentationId: "SYN-AMENDMENT-900",
      input: presentationInput(),
    });
    expect(wrongPrefix.edPresentations).toEqual(state.edPresentations);
    expect(wrongPrefix.auditEvents).toEqual(state.auditEvents);
    expect(wrongPrefix.lastOutcome?.message).toMatch(/synthetic presentation series/i);
  });

  it("refuses an episode that suggests review or records a deviation without a reason", () => {
    const state = createInitialPrototypeState();

    const noReviewReason = prototypeReducer(state, {
      type: "record-presentation",
      presentationId: nextPresentationId(state),
      input: presentationInput({ reviewSuggested: true, reviewReason: null }),
    });
    expect(noReviewReason.edPresentations).toEqual(state.edPresentations);
    expect(noReviewReason.reviewTriggers).toEqual(state.reviewTriggers);
    expect(noReviewReason.lastOutcome?.message).toMatch(/needs a reason/i);

    const noDeviationReason = prototypeReducer(state, {
      type: "record-presentation",
      presentationId: nextPresentationId(state),
      input: presentationInput({ deviationOccurred: true, deviationReason: "  " }),
    });
    expect(noDeviationReason.edPresentations).toEqual(state.edPresentations);
    expect(noDeviationReason.lastOutcome?.message).toMatch(/needs a reason/i);
  });

  it("refuses a correction whose replacement is not a recorded disposition", () => {
    const state = createInitialPrototypeState();
    const next = prototypeReducer(state, {
      type: "amend-presentation",
      presentationId: "SYN-PRESENTATION-001",
      field: "disposition",
      replacementValue: "sent home",
      reason: "Correct the disposition recorded at the end of the shift.",
    });

    expect(next.presentationAmendments).toEqual(state.presentationAmendments);
    expect(next.auditEvents).toEqual(state.auditEvents);
    expect(next.lastOutcome?.message).toMatch(/not one of the recorded answers/i);

    const accepted = prototypeReducer(state, {
      type: "amend-presentation",
      presentationId: "SYN-PRESENTATION-001",
      field: "disposition",
      replacementValue: "short_stay",
      reason: "Correct the disposition recorded at the end of the shift.",
    });
    expect(accepted.presentationAmendments.at(-1)).toMatchObject({
      field: "disposition",
      originalValue: "mental_health_admission",
      replacementValue: "short_stay",
    });
    expect(accepted.edPresentations.find(({ id }) => id === "SYN-PRESENTATION-001")?.disposition).toBe(
      "mental_health_admission",
    );
  });

  it("refuses a correction without a reason", () => {
    const state = createInitialPrototypeState();
    const next = prototypeReducer(state, {
      type: "amend-presentation",
      presentationId: "SYN-PRESENTATION-001",
      field: "note",
      replacementValue: "A corrected one-line account of the episode.",
      reason: " ",
    });

    expect(next.presentationAmendments).toEqual(state.presentationAmendments);
    expect(next.auditEvents).toEqual(state.auditEvents);
    expect(next.lastOutcome?.message).toMatch(/needs a reason/i);
  });

  it("corrects the value a reader currently sees, not the value already replaced", () => {
    const first = createInitialPrototypeState();
    const second = prototypeReducer(first, {
      type: "amend-presentation",
      presentationId: "SYN-PRESENTATION-001",
      field: "planHelpfulness",
      replacementValue: "mixed",
      reason: "On reflection only part of the plan could be followed.",
    });
    const third = prototypeReducer(second, {
      type: "amend-presentation",
      presentationId: "SYN-PRESENTATION-001",
      field: "planHelpfulness",
      replacementValue: "not_helpful",
      reason: "Discussed with the person afterwards; the plan did not help on the night.",
    });

    expect(third.presentationAmendments.at(-1)).toMatchObject({
      originalValue: "mixed",
      replacementValue: "not_helpful",
    });
    // Two corrections, both preserved, and the episode itself still untouched.
    expect(third.presentationAmendments).toHaveLength(first.presentationAmendments.length + 2);
    expect(third.edPresentations.find(({ id }) => id === "SYN-PRESENTATION-001")?.planHelpfulness).toBe("helpful");
  });

  it("raises each applicable review trigger from corrected effective values, once", () => {
    const withoutOpenTriggers = { ...createInitialPrototypeState(), reviewTriggers: [] };
    const lessHelpful = prototypeReducer(withoutOpenTriggers, {
      type: "amend-presentation",
      presentationId: "SYN-PRESENTATION-001",
      field: "planHelpfulness",
      replacementValue: "not_helpful",
      reason: "The original account was corrected after speaking with Rowan.",
    });
    const twiceCorrected = prototypeReducer(lessHelpful, {
      type: "amend-presentation",
      presentationId: "SYN-PRESENTATION-001",
      field: "planHelpfulness",
      replacementValue: "mixed",
      reason: "A further correction recorded the more precise account.",
    });
    const admission = prototypeReducer(twiceCorrected, {
      type: "amend-presentation",
      presentationId: "SYN-PRESENTATION-002",
      field: "disposition",
      replacementValue: "mental_health_admission",
      reason: "The final disposition was corrected from the contemporaneous record.",
    });

    expect(lessHelpful.reviewTriggers.filter((trigger) => trigger.source === "plan_use_feedback")).toHaveLength(1);
    expect(twiceCorrected.reviewTriggers.filter((trigger) => trigger.source === "plan_use_feedback")).toHaveLength(1);
    expect(admission.reviewTriggers.filter((trigger) => trigger.source === "presentation_outcome")).toHaveLength(1);
    expect(admission.lastOutcome?.message).toMatch(/Review Trigger was raised/i);
  });
});

describe("Care Plan Patient Plan source currency", () => {
  it("marks a current patient copy stale and raises a review trigger when its source is withdrawn", () => {
    let state = completePatientPlanDraft(createInitialPrototypeState(), ROWAN);
    const draft = state.patientPlanVersions.find((version) => version.state === "draft")!;
    state = prototypeReducer(state, { type: "approve-patient-plan-version", versionId: draft.id });
    const currentCopy = getCurrentPatientPlanVersion(state.patientPlanVersions, state.patientPlans[0]!.id);
    expect(currentCopy).not.toBeNull();

    const withdrawn = prototypeReducer(withUser(state, SENIOR), {
      type: "withdraw-current-management-version",
      patientId: ROWAN,
      reason: "The current plan was withdrawn while it is rewritten with Rowan.",
    });

    expect(isPatientPlanVersionStale(currentCopy, null)).toBe(true);
    expect(withdrawn.reviewTriggers).toContainEqual(
      expect.objectContaining({ source: "patient_plan_stale", sourceId: currentCopy?.id }),
    );
    expect(withdrawn.lastOutcome?.message).toMatch(/needs updating/i);
  });

  it("refuses approval of a completed draft after its Management Plan source is superseded", () => {
    let state = completePatientPlanDraft(createInitialPrototypeState("overdue-plan"), MIRA);
    const patientDraft = state.patientPlanVersions.find((version) => version.state === "draft")!;
    state = prototypeReducer(withUser(state, SENIOR), {
      type: "approve-management-version",
      versionId: MIRA_AWAITING_VERSION,
    });
    const before = state.auditEvents;

    const refused = prototypeReducer(state, { type: "approve-patient-plan-version", versionId: patientDraft.id });

    expect(refused.patientPlanVersions.find((version) => version.id === patientDraft.id)?.state).toBe("draft");
    expect(refused.auditEvents).toEqual(before);
    expect(refused.lastOutcome?.message).toMatch(/no longer Current/i);
  });
});

// --- Personal Safety Plan --------------------------------------------------------

describe("Care Plan Personal Safety Plan", () => {
  it("lets an emergency department clinician publish a draft without any senior approval", () => {
    const state = createInitialPrototypeState();
    const next = prototypeReducer(state, {
      type: "make-safety-plan-current",
      versionId: "SYN-SAFETY-VERSION-003",
    });

    expect(state.activeUserId).toBe(ED_CLINICIAN);
    expect(next.personalSafetyPlanVersions.find(({ id }) => id === "SYN-SAFETY-VERSION-003")?.state).toBe("current");
    expect(next.personalSafetyPlans.find(({ id }) => id === "SYN-SAFETY-PLAN-003")?.currentVersionId).toBe(
      "SYN-SAFETY-VERSION-003",
    );
    // The Management Plan is untouched, and no senior approval was consulted.
    expect(next.managementPlanVersions).toEqual(state.managementPlanVersions);
    expect(next.auditEvents.at(-1)?.type).toBe("safety_plan_made_current");
  });

  it("supersedes the previous current Personal Safety Plan when a new one is published", () => {
    let state = withUser(createInitialPrototypeState(), LIAISON);
    state = prototypeReducer(state, { type: "create-safety-plan-draft", patientId: ROWAN });
    const draft = state.personalSafetyPlanVersions.find(
      (version) => version.planId === "SYN-SAFETY-PLAN-001" && version.state === "draft",
    )!;
    const next = prototypeReducer(state, { type: "make-safety-plan-current", versionId: draft.id });
    const versions = next.personalSafetyPlanVersions.filter(({ planId }) => planId === "SYN-SAFETY-PLAN-001");

    expect(versions.filter(({ state }) => state === "current")).toHaveLength(1);
    expect(versions.find(({ id }) => id === "SYN-SAFETY-VERSION-001")?.state).toBe("superseded");
    expect(next.personalSafetyPlans.find(({ id }) => id === "SYN-SAFETY-PLAN-001")?.currentVersionId).toBe(draft.id);
  });

  it("saves a draft and copies its content rather than sharing the arrays it was handed", () => {
    const state = createInitialPrototypeState();
    const input = safetyDraftInput();
    const next = prototypeReducer(state, {
      type: "save-safety-plan-draft",
      versionId: "SYN-SAFETY-VERSION-003",
      input,
    });
    const saved = next.personalSafetyPlanVersions.find(({ id }) => id === "SYN-SAFETY-VERSION-003")!;

    expect(saved).toMatchObject({
      state: "draft",
      reviewDueAt: "2027-08-20T14:30:00+08:00",
      patientConfirmation: "confirmed",
    });
    expect(saved.content.warningSigns).toEqual(input.content.warningSigns);
    expect(saved.collaborationNote).toMatch(/chose the wording/);
    expect(next.auditEvents.at(-1)).toMatchObject({
      type: "safety_plan_draft_saved",
      objectId: "SYN-SAFETY-VERSION-003",
      patientId: JORDAN,
    });

    // Two records must never share one array. Changing the input after the save
    // must not reach the saved record.
    (input.content.warningSigns as string[]).push("A line added after the save.");
    expect(saved.content.warningSigns).toHaveLength(1);
  });

  it("refuses a draft whose next review date cannot be read as a date", () => {
    const state = createInitialPrototypeState();
    const next = prototypeReducer(state, {
      type: "save-safety-plan-draft",
      versionId: "SYN-SAFETY-VERSION-003",
      input: safetyDraftInput({ reviewDueAt: "when we next meet" }),
    });

    expect(next.personalSafetyPlanVersions).toEqual(state.personalSafetyPlanVersions);
    expect(next.auditEvents).toEqual(state.auditEvents);
    expect(next.lastOutcome?.message).toMatch(/could not be read as a date/i);
  });

  it("refuses to edit a version that is no longer a draft", () => {
    const state = createInitialPrototypeState();
    const next = prototypeReducer(state, {
      type: "save-safety-plan-draft",
      versionId: "SYN-SAFETY-VERSION-001",
      input: safetyDraftInput(),
    });

    expect(next.personalSafetyPlanVersions).toEqual(state.personalSafetyPlanVersions);
    expect(next.auditEvents).toEqual(state.auditEvents);
    expect(next.lastOutcome?.message).toMatch(/only a draft can be edited/i);
  });

  it("refuses to publish a version that is not a draft, and refuses authorship by the non-clinical role", () => {
    const state = createInitialPrototypeState();
    const notADraft = prototypeReducer(state, {
      type: "make-safety-plan-current",
      versionId: "SYN-SAFETY-VERSION-001",
    });
    expect(notADraft.personalSafetyPlanVersions).toEqual(state.personalSafetyPlanVersions);
    expect(notADraft.personalSafetyPlans).toEqual(state.personalSafetyPlans);
    expect(notADraft.lastOutcome?.message).toMatch(/only a draft/i);

    const coordinator = withUser(createInitialPrototypeState(), COORDINATOR);
    const wrongRole = prototypeReducer(coordinator, {
      type: "make-safety-plan-current",
      versionId: "SYN-SAFETY-VERSION-003",
    });
    expect(wrongRole.personalSafetyPlanVersions).toEqual(coordinator.personalSafetyPlanVersions);
    expect(wrongRole.lastOutcome?.kind).toBe("blocked");
  });

  it("records only that a print view was opened", () => {
    const state = createInitialPrototypeState();
    const next = prototypeReducer(state, { type: "record-safety-plan-print-intent", patientId: ROWAN });

    expect(next.auditEvents).toHaveLength(1);
    expect(next.auditEvents[0]).toMatchObject({
      type: "safety_plan_print_intent_opened",
      objectId: "SYN-SAFETY-VERSION-001",
    });
    expect(overclaims(next.auditEvents[0]!.evidence)).toBe(false);
    expect(next.personalSafetyPlanVersions).toEqual(state.personalSafetyPlanVersions);
  });
});

// --- Management Plan print intent -------------------------------------------------

describe("Care Plan management plan print intent", () => {
  it("records only that a print view was opened, against the Current version", () => {
    const state = createInitialPrototypeState();
    const next = prototypeReducer(state, { type: "record-management-plan-print-intent", patientId: ROWAN });

    expect(next.auditEvents).toHaveLength(1);
    expect(next.auditEvents[0]).toMatchObject({
      type: "management_plan_print_intent_opened",
      patientId: ROWAN,
      objectId: ROWAN_CURRENT_VERSION,
    });
    // It never claims paper, a printer, or a reader — this application sees none
    // of them.
    expect(overclaims(next.auditEvents[0]!.evidence)).toBe(false);
    expect(next.auditEvents[0]!.evidence).toMatch(/not evidence that anything reached a printer/i);
    expect(next.lastOutcome?.kind).toBe("info");
  });

  it("changes no clinical record", () => {
    const state = createInitialPrototypeState();
    const next = prototypeReducer(state, { type: "record-management-plan-print-intent", patientId: ROWAN });

    expect(next.managementPlanVersions).toEqual(state.managementPlanVersions);
    expect(next.managementPlans).toEqual(state.managementPlans);
    expect(next.reviewTriggers).toEqual(state.reviewTriggers);
    expect(next.edPresentations).toEqual(state.edPresentations);
  });

  // A withdrawn plan is not a plan in use, and paper cannot be recalled once it
  // has left the room.
  it("refuses when there is no Current Plan to print", () => {
    const state = createInitialPrototypeState();
    const withdrawn = prototypeReducer(state, { type: "record-management-plan-print-intent", patientId: EVELYN });
    expect(withdrawn.auditEvents).toEqual([]);
    expect(withdrawn.lastOutcome?.message).toMatch(/no Current Plan to print/i);

    const never = prototypeReducer(state, { type: "record-management-plan-print-intent", patientId: JORDAN });
    expect(never.auditEvents).toEqual([]);
    expect(never.lastOutcome?.message).toMatch(/no Current Plan to print/i);
  });

  /**
   * The exemption exists because a print intent changes no clinical record and
   * because printing is what you most want when systems are down — both
   * properties of the action, not of which document it prints.
   *
   * The failure it prevents is specific and one-directional. `BrowserPrintButton`
   * calls `window.print()` unconditionally and ignores anything the caller's
   * hook returns, so a refusal here cannot stop the dialogue opening. Without the
   * exemption the offline specimen let a clinical document leave the building
   * while `auditEvents` stayed empty and the reader was told nothing had
   * changed — the application underclaiming what it did, which is the direction
   * this prototype's audit discipline exists to prevent.
   */
  it("still records the print intent when the device is offline", () => {
    const offline = createInitialPrototypeState("offline");
    const next = prototypeReducer(offline, { type: "record-management-plan-print-intent", patientId: ROWAN });

    expect(next.lastOutcome?.kind).toBe("info");
    expect(next.auditEvents).toHaveLength(1);
    expect(next.auditEvents[0]).toMatchObject({
      type: "management_plan_print_intent_opened",
      objectId: ROWAN_CURRENT_VERSION,
    });
    // The two print intents are the same operation and must not diverge.
    const safetyPlan = prototypeReducer(offline, { type: "record-safety-plan-print-intent", patientId: ROWAN });
    expect(safetyPlan.auditEvents).toHaveLength(1);
    expect(next.lastOutcome?.kind).toBe(safetyPlan.lastOutcome?.kind);
  });

  // Connectivity is the only block the exemption skips. Printing the wrong
  // person's plan is a real harm, and paper cannot be recalled.
  it("is still blocked offline by identity uncertainty, permission, and a version conflict", () => {
    for (const scenario of ["identity-uncertain", "permission-unavailable", "version-conflict"] as const) {
      const state = { ...createInitialPrototypeState(scenario), connectivity: { online: false } };
      const next = prototypeReducer(state, { type: "record-management-plan-print-intent", patientId: ROWAN });
      expect(next.auditEvents, `${scenario} must still block the print intent`).toEqual([]);
      expect(next.lastOutcome?.kind).toBe("blocked");
    }
  });

  it("refuses an unknown synthetic patient and a record not confirmed as the right person", () => {
    const unknown = prototypeReducer(createInitialPrototypeState(), {
      type: "record-management-plan-print-intent",
      patientId: "SYN-PATIENT-999",
    });
    expect(unknown.auditEvents).toEqual([]);
    expect(unknown.lastOutcome?.kind).toBe("error");

    const uncertain = prototypeReducer(createInitialPrototypeState("identity-uncertain"), {
      type: "record-management-plan-print-intent",
      patientId: ROWAN,
    });
    expect(uncertain.auditEvents).toEqual([]);
    expect(uncertain.lastOutcome?.kind).toBe("blocked");
  });
});

// --- Identification review and contact actions ------------------------------------

describe("Care Plan identification review", () => {
  it("records a manual referral without creating a plan, a version, or a Review Trigger", () => {
    const state = createInitialPrototypeState();
    const next = prototypeReducer(state, {
      type: "create-identification-review",
      patientId: MIRA,
      reason: "Asked the team to consider whether a coordinated plan would help after the last two episodes.",
    });

    expect(next.identificationReviews).toHaveLength(state.identificationReviews.length + 1);
    expect(next.identificationReviews.at(-1)).toMatchObject({
      id: "SYN-IDENT-REVIEW-004",
      patientId: MIRA,
      status: "open",
      referredBy: ED_CLINICIAN,
      decision: null,
    });
    expect(next.managementPlans).toEqual(state.managementPlans);
    expect(next.managementPlanVersions).toEqual(state.managementPlanVersions);
    expect(next.reviewTriggers).toEqual(state.reviewTriggers);
    expect(next.auditEvents.at(-1)?.type).toBe("identification_review_created");
  });

  it("refuses a referral with no stated reason, because no numeric rule exists", () => {
    const state = createInitialPrototypeState();
    const next = prototypeReducer(state, { type: "create-identification-review", patientId: MIRA, reason: "" });

    expect(next.identificationReviews).toEqual(state.identificationReviews);
    expect(next.auditEvents).toEqual(state.auditEvents);
    expect(next.lastOutcome?.message).toMatch(/needs a stated reason/i);
  });

  it("closes an open review with a decision and creates no plan on any decision", () => {
    const state = withUser(createInitialPrototypeState(), LIAISON);
    const next = prototypeReducer(state, {
      type: "close-identification-review",
      reviewId: "SYN-IDENT-REVIEW-001",
      decision: "proceed_to_plan",
      decisionReason: "The team agreed a coordinated plan would help, and Jordan wants to take part in writing it.",
    });

    expect(next.identificationReviews.find(({ id }) => id === "SYN-IDENT-REVIEW-001")).toMatchObject({
      status: "closed",
      decision: "proceed_to_plan",
      decidedBy: LIAISON,
    });
    // `proceed_to_plan` is a conclusion, not an action: nothing was created.
    expect(next.managementPlans).toEqual(state.managementPlans);
    expect(next.managementPlanVersions).toEqual(state.managementPlanVersions);
    expect(next.auditEvents.filter(({ type }) => type === "identification_review_closed")).toHaveLength(1);
  });

  it("leaves an already-closed review unchanged and says so", () => {
    const state = withUser(createInitialPrototypeState(), LIAISON);
    const next = prototypeReducer(state, {
      type: "close-identification-review",
      reviewId: "SYN-IDENT-REVIEW-002",
      decision: "not_needed_now",
      decisionReason: "A second attempt to close the same referral.",
    });

    expect(next.identificationReviews).toEqual(state.identificationReviews);
    expect(next.auditEvents).toEqual(state.auditEvents);
    expect(next.lastOutcome?.message).toMatch(/already closed/i);
  });

  it("refuses to close a review without a reason", () => {
    const state = withUser(createInitialPrototypeState(), LIAISON);
    const next = prototypeReducer(state, {
      type: "close-identification-review",
      reviewId: "SYN-IDENT-REVIEW-001",
      decision: "revisit_later",
      decisionReason: "\t",
    });

    expect(next.identificationReviews).toEqual(state.identificationReviews);
    expect(next.lastOutcome?.message).toMatch(/needs a short reason/i);
  });
});

describe("Care Plan contact and worklist actions", () => {
  it("records an email or telephone action as an intent only", () => {
    const state = createInitialPrototypeState();
    const emailed = prototypeReducer(state, {
      type: "record-contact-intent",
      patientId: ROWAN,
      cmhtId: "SYN-CMHT-001",
      channel: "email",
    });
    const called = prototypeReducer(emailed, {
      type: "record-contact-intent",
      patientId: ROWAN,
      cmhtId: "SYN-CMHT-001",
      channel: "call",
    });

    expect(emailed.auditEvents.at(-1)?.type).toBe("email_intent_opened");
    expect(called.auditEvents.at(-1)?.type).toBe("call_intent_opened");
    for (const event of called.auditEvents) {
      expect(overclaims(event.evidence), `audit evidence overclaims: ${event.evidence}`).toBe(false);
    }
    expect(overclaims(called.lastOutcome?.message ?? "")).toBe(false);
    // Nothing about the clinical record changed.
    expect(called.cmhtContacts).toEqual(state.cmhtContacts);
    expect(called.managementPlanVersions).toEqual(state.managementPlanVersions);
  });

  it("proves the overclaiming guard rejects the phrases it is meant to catch", () => {
    expect(overclaims("An email was sent to the team.")).toBe(true);
    expect(overclaims("The message sent to the shared mailbox was delivered.")).toBe(true);
    expect(overclaims("Spoke to the duty clinician, who confirmed the appointment.")).toBe(true);
    expect(overclaims("The Personal Safety Plan was printed for the person to take home.")).toBe(true);
    expect(overclaims("An external email application was asked to open with a generic subject.")).toBe(false);
  });

  it("records a contact verification as a check of the displayed details", () => {
    const state = withUser(createInitialPrototypeState("unverified-contact"), LIAISON);
    const next = prototypeReducer(state, { type: "verify-cmht-contact", cmhtId: "SYN-CMHT-003" });

    expect(next.cmhtContacts.find(({ id }) => id === "SYN-CMHT-003")?.verificationState).toBe("verified");
    expect(next.auditEvents.at(-1)?.type).toBe("cmht_contact_verified");
    expect(next.auditEvents.at(-1)?.evidence).toMatch(/not a guarantee that the service is available/i);
  });

  it("resolves an open Review Trigger without changing any plan", () => {
    const state = withUser(createInitialPrototypeState(), LIAISON);
    const next = prototypeReducer(state, {
      type: "resolve-review-trigger",
      triggerId: "SYN-TRIGGER-002",
      resolution: "Discussed at the August meeting; the agreed approach still describes what happens.",
    });

    expect(next.reviewTriggers.find(({ id }) => id === "SYN-TRIGGER-002")).toMatchObject({
      status: "resolved",
      resolution: expect.stringMatching(/still describes what happens/),
    });
    expect(next.managementPlanVersions).toEqual(state.managementPlanVersions);

    const again = prototypeReducer(next, {
      type: "resolve-review-trigger",
      triggerId: "SYN-TRIGGER-002",
      resolution: "A second attempt.",
    });
    expect(again.reviewTriggers).toEqual(next.reviewTriggers);
    expect(again.lastOutcome?.message).toMatch(/already resolved/i);
  });
});

/**
 * Recording that the person has been shown their own plan. It is a record of
 * something a clinician did with the document, not a transformation of it: it
 * writes one date and one audit event, and it produces no Patient Plan.
 */
describe("Care Plan sharing the plan with the person", () => {
  it("records the date against the Current version and audits it", () => {
    const state = createInitialPrototypeState("overdue-plan");
    const next = prototypeReducer(state, { type: "record-plan-shared-with-patient", patientId: MIRA });

    expect(next.managementPlanVersions.find(({ id }) => id === "SYN-MGMT-VERSION-003")?.sharedWithPatientAt).toEqual(
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    );
    expect(next.auditEvents).toHaveLength(1);
    expect(next.auditEvents[0]).toMatchObject({
      type: "management_plan_shared_with_patient",
      patientId: MIRA,
      objectId: "SYN-MGMT-VERSION-003",
    });
    expect(next.lastOutcome?.kind).toBe("success");
  });

  // Task 9 writes the patient-facing edition. This action must not quietly do it.
  it("creates no Patient Plan and changes no plan content", () => {
    const state = createInitialPrototypeState("overdue-plan");
    const next = prototypeReducer(state, { type: "record-plan-shared-with-patient", patientId: MIRA });

    expect(next.patientPlans).toEqual([]);
    expect(next.patientPlanVersions).toEqual([]);
    const before = state.managementPlanVersions.find(({ id }) => id === "SYN-MGMT-VERSION-003");
    const after = next.managementPlanVersions.find(({ id }) => id === "SYN-MGMT-VERSION-003");
    expect(after?.content).toEqual(before?.content);
    expect(after?.state).toBe("current");
    expect(next.reviewTriggers).toEqual(state.reviewTriggers);
  });

  it("refuses when there is no Current Plan to show anyone", () => {
    const state = createInitialPrototypeState();
    for (const patientId of [EVELYN, JORDAN] as const) {
      const next = prototypeReducer(state, { type: "record-plan-shared-with-patient", patientId });
      expect(next.auditEvents, `${patientId} has no Current Plan`).toEqual([]);
      expect(next.lastOutcome?.message).toMatch(/no Current Plan/i);
    }
  });

  /**
   * `sharedWithPatientAt` is one date, so a second record would silently replace
   * a recorded fact with a different one and the first sharing would vanish from
   * the record without anything saying so.
   */
  it("refuses a second record and names the date already held", () => {
    const state = createInitialPrototypeState();
    const again = prototypeReducer(state, { type: "record-plan-shared-with-patient", patientId: ROWAN });

    expect(again.auditEvents).toEqual([]);
    expect(again.lastOutcome?.kind).toBe("info");
    expect(again.lastOutcome?.message).toMatch(/already recorded/i);
    expect(again.managementPlanVersions).toEqual(state.managementPlanVersions);
  });

  it("is blocked offline, like every other action that changes a record", () => {
    const offline = createInitialPrototypeState("offline");
    const next = prototypeReducer(
      { ...offline, selectedPatientId: MIRA },
      {
        type: "record-plan-shared-with-patient",
        patientId: MIRA,
      },
    );

    expect(next.lastOutcome?.kind).toBe("blocked");
    expect(next.auditEvents).toEqual([]);
    expect(next.managementPlanVersions).toEqual(offline.managementPlanVersions);
  });
});

// --- Degraded states, scenarios, and determinism ------------------------------------

describe("Care Plan degraded states", () => {
  const degraded: readonly [PrototypeScenario, RegExp][] = [
    ["offline", /offline/i],
    ["permission-unavailable", /permission/i],
    ["identity-uncertain", /not been confirmed as the right person/i],
    ["version-conflict", /newer version/i],
  ];

  it.each(degraded)("refuses every clinical change in the %s scenario", (scenario, expected) => {
    const state = createInitialPrototypeState(scenario);
    const next = prototypeReducer(state, {
      type: "amend-presentation",
      presentationId: "SYN-PRESENTATION-001",
      field: "note",
      replacementValue: "A corrected one-line account of the episode.",
      reason: "Correct the recorded account.",
    });

    // Negative controls: each of these fails if the guard stops refusing.
    expect(next.presentationAmendments).toEqual(state.presentationAmendments);
    expect(next.edPresentations).toEqual(state.edPresentations);
    expect(next.auditEvents).toEqual([]);
    expect(next.lastOutcome?.kind).toBe("blocked");
    expect(next.lastOutcome?.message).toMatch(expected);
  });

  it("records a Personal Safety Plan print intent while offline, and blocks it on every other degraded state", () => {
    const offline = createInitialPrototypeState("offline");
    const printed = prototypeReducer(offline, { type: "record-safety-plan-print-intent", patientId: ROWAN });

    // The one action you most want available when systems are down. It appends
    // an audit event and changes no clinical record.
    expect(printed.auditEvents).toHaveLength(1);
    expect(printed.auditEvents[0]).toMatchObject({ type: "safety_plan_print_intent_opened" });
    expect(printed.personalSafetyPlanVersions).toEqual(offline.personalSafetyPlanVersions);

    // Connectivity is the only exemption. Printing the wrong person safety plan
    // is a real harm, so identity uncertainty still blocks it.
    const uncertain = prototypeReducer(createInitialPrototypeState("identity-uncertain"), {
      type: "record-safety-plan-print-intent",
      patientId: ROWAN,
    });
    expect(uncertain.auditEvents).toEqual([]);
    expect(uncertain.lastOutcome?.kind).toBe("blocked");
    expect(uncertain.lastOutcome?.message).toMatch(/not been confirmed as the right person/i);

    const noPermission = prototypeReducer(createInitialPrototypeState("permission-unavailable"), {
      type: "record-safety-plan-print-intent",
      patientId: ROWAN,
    });
    expect(noPermission.auditEvents).toEqual([]);
    expect(noPermission.lastOutcome?.kind).toBe("blocked");

    // And the exemption is for this action alone: everything else stays blocked.
    expect(
      getPrototypeMutationBlockReason(offline, {
        type: "record-contact-intent",
        patientId: ROWAN,
        cmhtId: "SYN-CMHT-001",
        channel: "email",
      }),
    ).toMatch(/offline/i);
  });

  it("still allows the actions that change no clinical record", () => {
    const state = createInitialPrototypeState("offline");
    expect(getPrototypeMutationBlockReason(state, { type: "select-patient", patientId: EVELYN })).toBeNull();
    expect(getPrototypeMutationBlockReason(state, { type: "clear-outcome" })).toBeNull();
    expect(getPrototypeMutationBlockReason(state, { type: "reset" })).toBeNull();

    const selected = prototypeReducer(state, { type: "select-patient", patientId: EVELYN });
    expect(selected.selectedPatientId).toBe(EVELYN);
    expect(selected.connectivity.online).toBe(false);
  });

  it("names a blocking reason for every clinical action and none for the rest", () => {
    const offline = createInitialPrototypeState("offline");
    expect(
      getPrototypeMutationBlockReason(offline, {
        type: "approve-management-version",
        versionId: MIRA_AWAITING_VERSION,
      }),
    ).toMatch(/offline/i);
    expect(
      getPrototypeMutationBlockReason(createInitialPrototypeState(), {
        type: "approve-management-version",
        versionId: MIRA_AWAITING_VERSION,
      }),
    ).toMatch(/does not carry this action/i);
    expect(
      getPrototypeMutationBlockReason(withUser(createInitialPrototypeState(), SENIOR), {
        type: "approve-management-version",
        versionId: MIRA_AWAITING_VERSION,
      }),
    ).toBeNull();
  });
});

describe("Care Plan scenarios, reset, and determinism", () => {
  it("builds each scenario's deterministic world without a browser API", () => {
    expect(createInitialPrototypeState()).toMatchObject({
      scenario: "normal",
      persistence: "memory-only",
      activeUserId: ED_CLINICIAN,
      selectedPatientId: ROWAN,
      connectivity: { online: true },
      permission: { available: true },
      identity: { certain: true },
      versionConflict: { active: false },
      patientPlans: [],
      patientPlanVersions: [],
      auditEvents: [],
      lastOutcome: null,
    });
    /**
     * The two Patient Plan collections start empty because a patient copy is
     * produced when somebody makes one, and seeding an edition would put
     * patient-facing wording on the record that nobody wrote.
     *
     * The resource catalogue is not an edition of anything. It is the list a
     * clinician chooses from, so Task 9 seeds it: an empty one would mean every
     * patient copy started with nothing to offer, and the housing and money
     * entries are frequently the whole point of the sheet.
     */
    expect(createInitialPrototypeState().patientResources.length).toBeGreaterThan(0);
    expect(createInitialPrototypeState().patientResources.every((resource) => resource.id.startsWith("SYN-"))).toBe(
      true,
    );
    expect(createInitialPrototypeState("empty").selectedPatientId).toBeNull();
    expect(createInitialPrototypeState("overdue-plan").selectedPatientId).toBe(MIRA);
    expect(createInitialPrototypeState("withdrawn-plan").selectedPatientId).toBe(EVELYN);
    expect(createInitialPrototypeState("no-current-plan").selectedPatientId).toBe(JORDAN);
  });

  it("does not share mutable fixture state between two prototype states", () => {
    const first = createInitialPrototypeState();
    const second = createInitialPrototypeState();
    expect(first.patients).not.toBe(second.patients);
    expect(first.patients[0]).not.toBe(second.patients[0]);
    expect(first.patients).toEqual(second.patients);
  });

  it("reconstructs the world when the specimen scenario changes, and no-ops when it does not", () => {
    const worked = prototypeReducer(createInitialPrototypeState(), {
      type: "record-presentation",
      presentationId: nextPresentationId(createInitialPrototypeState()),
      input: presentationInput(),
    });
    expect(worked.edPresentations).toHaveLength(21);

    const switched = prototypeReducer(worked, { type: "apply-scenario", scenario: "withdrawn-plan" });
    expect(switched).toEqual(createInitialPrototypeState("withdrawn-plan"));

    const same = prototypeReducer(worked, { type: "apply-scenario", scenario: "normal" });
    expect(same).toBe(worked);
  });

  it("returns to the deterministic fixture world on reset", () => {
    const worked = run("normal", SENIOR, {
      type: "withdraw-current-management-version",
      patientId: ROWAN,
      reason: "Taken out of use while a new version is written with Rowan.",
    });
    expect(prototypeReducer(worked, { type: "reset" })).toEqual(createInitialPrototypeState());
  });

  it("clears the last outcome without touching anything else", () => {
    const blocked = prototypeReducer(createInitialPrototypeState(), {
      type: "approve-management-version",
      versionId: MIRA_AWAITING_VERSION,
    });
    expect(blocked.lastOutcome?.kind).toBe("blocked");
    const cleared = prototypeReducer(blocked, { type: "clear-outcome" });
    expect(cleared.lastOutcome).toBeNull();
    expect({ ...cleared, lastOutcome: null }).toEqual({ ...blocked, lastOutcome: null });
  });

  it("allocates identifiers from the identifiers already present", () => {
    expect(nextSyntheticId("SYN-AUDIT", [])).toBe("SYN-AUDIT-001");
    expect(nextSyntheticId("SYN-TRIGGER", ["SYN-TRIGGER-001", "SYN-TRIGGER-003"])).toBe("SYN-TRIGGER-004");
    expect(nextSyntheticId("SYN-MGMT-VERSION", ["SYN-SAFETY-VERSION-009"])).toBe("SYN-MGMT-VERSION-001");
    expect(nextSyntheticId("SYN-TRIGGER", ["SYN-TRIGGER-0012"])).toBe("SYN-TRIGGER-013");
  });

  it("produces the same state twice from the same action sequence, from PROTOTYPE_NOW alone", () => {
    const sequence: CarePlanPrototypeAction[] = [
      { type: "create-management-draft", patientId: ROWAN },
      { type: "save-management-draft", versionId: "SYN-MGMT-VERSION-007", input: draftInput() },
      { type: "submit-management-draft", versionId: "SYN-MGMT-VERSION-007" },
      { type: "record-contact-intent", patientId: ROWAN, cmhtId: "SYN-CMHT-001", channel: "email" },
    ];
    const first = run("normal", LIAISON, ...sequence);
    const second = run("normal", LIAISON, ...sequence);

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.auditEvents.map(({ id }) => id)).toEqual([
      "SYN-AUDIT-001",
      "SYN-AUDIT-002",
      "SYN-AUDIT-003",
      "SYN-AUDIT-004",
    ]);
    // Every timestamp is `PROTOTYPE_NOW` advanced by whole minutes, so no wall
    // clock and no random source can have been consulted.
    expect(PROTOTYPE_NOW).toBe("2026-08-20T14:30:00+08:00");
    expect(first.auditEvents.map(({ occurredAt }) => occurredAt)).toEqual([
      "2026-08-20T14:31:00+08:00",
      "2026-08-20T14:32:00+08:00",
      "2026-08-20T14:33:00+08:00",
      "2026-08-20T14:34:00+08:00",
    ]);
  });

  it("never changes the state object it was given", () => {
    const state = withUser(createInitialPrototypeState(), SENIOR);
    const before = JSON.stringify(state);

    prototypeReducer(state, { type: "approve-management-version", versionId: MIRA_AWAITING_VERSION });
    prototypeReducer(state, {
      type: "withdraw-current-management-version",
      patientId: ROWAN,
      reason: "A reason recorded for the withdrawal.",
    });
    prototypeReducer(state, {
      type: "record-presentation",
      presentationId: nextPresentationId(state),
      input: presentationInput({ planHelpfulness: "not_helpful" }),
    });

    expect(JSON.stringify(state)).toBe(before);
  });
});
