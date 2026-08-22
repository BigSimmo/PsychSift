import { describe, expect, it } from "vitest";

import { fixedClock } from "@/lib/caring-contacts/clock";
import { actorId, pathwayVersionId, teamId } from "@/lib/caring-contacts/ids";
import {
  REQUIRED_PATHWAY_APPROVAL_ROLES,
  applyPathwayVersionTransition,
  retirementPausesFutureContacts,
  type PathwayVersion,
} from "@/lib/caring-contacts/pathway-versions";

const clock = fixedClock("2026-08-19T02:00:00.000Z");
const AUTHOR = actorId("ACTOR-AUTHOR");

function draftVersion(): PathwayVersion {
  return {
    id: pathwayVersionId("SYN-PATHWAY-002"),
    teamId: teamId("TEAM-A"),
    state: "draft",
    authorId: AUTHOR,
    approvals: [],
    publishedAt: null,
    retiredAt: null,
    retirementUrgency: null,
    snapshot: Object.freeze({
      cadenceLabels: ["Day 1", "Week 1", "Month 1"],
      messageTextByType: Object.freeze({ standard: "s", first: "f", closing: "c" }),
    }),
  };
}

function advance(version: PathwayVersion, action: Parameters<typeof applyPathwayVersionTransition>[1]): PathwayVersion {
  const result = applyPathwayVersionTransition(version, action, clock);
  if (!result.ok) throw new Error(`refused: ${result.reason}`);
  return result.value;
}

describe("pathway version lifecycle", () => {
  it("needs both approval roles before it is approved", () => {
    let version = advance(draftVersion(), { type: "submitForReview" });
    expect(REQUIRED_PATHWAY_APPROVAL_ROLES).toHaveLength(2);

    version = advance(version, { type: "approve", role: "clinicalProgrammeLead", actorId: actorId("A") });
    expect(version.state).toBe("inReview");

    version = advance(version, { type: "approve", role: "livedExperienceRepresentative", actorId: actorId("B") });
    expect(version.state).toBe("approved");
    expect(version.approvals.map((approval) => approval.role)).toEqual([...REQUIRED_PATHWAY_APPROVAL_ROLES]);
  });

  it("refuses the author approving their own version, with the shared reason", () => {
    const inReview = advance(draftVersion(), { type: "submitForReview" });
    expect(
      applyPathwayVersionTransition(
        inReview,
        { type: "approve", role: "clinicalProgrammeLead", actorId: AUTHOR },
        clock,
      ),
    ).toEqual({ ok: false, reason: "self-approval-denied" });
  });

  it("refuses one person supplying both approvals", () => {
    let version = advance(draftVersion(), { type: "submitForReview" });
    version = advance(version, { type: "approve", role: "clinicalProgrammeLead", actorId: actorId("SOLO") });
    expect(
      applyPathwayVersionTransition(
        version,
        { type: "approve", role: "livedExperienceRepresentative", actorId: actorId("SOLO") },
        clock,
      ),
    ).toEqual({ ok: false, reason: "pathway-approval-actor-already-recorded" });
  });

  it("refuses publication before approval", () => {
    const inReview = advance(draftVersion(), { type: "submitForReview" });
    expect(applyPathwayVersionTransition(inReview, { type: "publish", actorId: actorId("A") }, clock)).toEqual({
      ok: false,
      reason: "pathway-not-approved",
    });
  });

  it("pauses future contacts only for an urgent safety retirement", () => {
    let version = advance(draftVersion(), { type: "submitForReview" });
    version = advance(version, { type: "approve", role: "clinicalProgrammeLead", actorId: actorId("A") });
    version = advance(version, { type: "approve", role: "livedExperienceRepresentative", actorId: actorId("B") });

    const routine = advance(version, { type: "retire", urgency: "routine" });
    expect(routine.state).toBe("retired");
    expect(retirementPausesFutureContacts(routine)).toBe(false);
    expect(routine.retiredAt).not.toBeNull();
    expect(routine.retiredAt).toMatch(/\+08:00$/);

    const urgent = advance(version, { type: "retire", urgency: "urgentSafety" });
    expect(retirementPausesFutureContacts(urgent)).toBe(true);
    expect(urgent.retiredAt).not.toBeNull();
    expect(urgent.retiredAt).toMatch(/\+08:00$/);
  });

  it("refuses retirement from every state except approved", () => {
    const draft = draftVersion();
    expect(applyPathwayVersionTransition(draft, { type: "retire", urgency: "routine" }, clock)).toEqual({
      ok: false,
      reason: "pathway-not-retirable",
    });

    const inReview = advance(draft, { type: "submitForReview" });
    expect(applyPathwayVersionTransition(inReview, { type: "retire", urgency: "routine" }, clock)).toEqual({
      ok: false,
      reason: "pathway-not-retirable",
    });

    let approved = advance(inReview, { type: "approve", role: "clinicalProgrammeLead", actorId: actorId("A") });
    approved = advance(approved, { type: "approve", role: "livedExperienceRepresentative", actorId: actorId("B") });
    const retired = advance(approved, { type: "retire", urgency: "routine" });
    expect(applyPathwayVersionTransition(retired, { type: "retire", urgency: "urgentSafety" }, clock)).toEqual({
      ok: false,
      reason: "pathway-not-retirable",
    });
  });

  it("never mutates the snapshot an active plan depends on", () => {
    const original = draftVersion();
    const published = advance(
      advance(
        advance(advance(original, { type: "submitForReview" }), {
          type: "approve",
          role: "clinicalProgrammeLead",
          actorId: actorId("A"),
        }),
        { type: "approve", role: "livedExperienceRepresentative", actorId: actorId("B") },
      ),
      { type: "publish", actorId: actorId("A") },
    );
    expect(published.snapshot).toEqual(original.snapshot);
    expect(Object.isFrozen(published.snapshot)).toBe(true);
    expect(published.publishedAt).not.toBeNull();
    expect(published.publishedAt).toMatch(/\+08:00$/);
  });
});
