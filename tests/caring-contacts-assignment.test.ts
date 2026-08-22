import { describe, expect, it } from "vitest";

import { fixedClock } from "@/lib/caring-contacts/clock";
import { actorId } from "@/lib/caring-contacts/ids";
import {
  UNCLAIMED_ESCALATION_MINUTES,
  applyAssignmentAction,
  effectiveResponder,
  queueAgeMinutes,
  unassigned,
  type PlanAssignment,
} from "@/lib/caring-contacts/assignment";

const clock = fixedClock("2026-08-19T02:00:00.000Z");
const OWNER = actorId("ACTOR-OWNER");

function claimed(): PlanAssignment {
  const result = applyAssignmentAction(unassigned(), { type: "claim", actorId: OWNER }, clock);
  if (!result.ok) throw new Error(result.reason);
  return result.value;
}

describe("plan ownership", () => {
  it("records the owner on claim and refuses a second claim", () => {
    expect(claimed().ownerId).toBe(OWNER);
    expect(applyAssignmentAction(claimed(), { type: "claim", actorId: actorId("OTHER") }, clock)).toEqual({
      ok: false,
      reason: "plan-already-claimed",
    });
  });

  it("keeps the previous owner visible in the reassignment history", () => {
    const result = applyAssignmentAction(
      claimed(),
      { type: "reassign", toActorId: actorId("ACTOR-NEW"), reason: "annual leave" },
      clock,
    );
    if (!result.ok) throw new Error(result.reason);
    expect(result.value.ownerId).toBe(actorId("ACTOR-NEW"));
    expect(result.value.reassignmentHistory).toHaveLength(1);
    expect(result.value.reassignmentHistory[0]).toMatchObject({ fromActorId: OWNER, reason: "annual leave" });
  });

  it("covers without replacing the named coordinator", () => {
    const result = applyAssignmentAction(
      claimed(),
      { type: "startCoverage", actorId: actorId("ACTOR-COVER"), from: "2026-08-20", until: "2026-08-27" },
      clock,
    );
    if (!result.ok) throw new Error(result.reason);
    expect(result.value.ownerId).toBe(OWNER);
    expect(effectiveResponder(result.value, "2026-08-21")).toBe(actorId("ACTOR-COVER"));
    expect(effectiveResponder(result.value, "2026-08-28")).toBe(OWNER);
  });

  it("refuses a coverage window that does not move forward", () => {
    expect(
      applyAssignmentAction(
        claimed(),
        { type: "startCoverage", actorId: actorId("C"), from: "2026-08-20", until: "2026-08-20" },
        clock,
      ),
    ).toEqual({ ok: false, reason: "coverage-window-invalid" });
  });

  // The window is an AWST calendar day, which is what `effectiveResponder` compares on. `until >
  // from` alone is a LEXICAL string compare, and "cherry" > "banana" satisfies it -- so a window of
  // pure nonsense used to be accepted, stored, and then silently name the wrong responder.
  it.each([
    ["pure nonsense", "banana", "cherry"],
    ["a full ISO instant rather than a calendar day", "2026-08-20T00:00:00.000Z", "2026-08-27T00:00:00.000Z"],
    ["a day that does not exist", "2026-02-30", "2026-03-05"],
    ["a month that does not exist", "2026-13-01", "2026-13-08"],
    ["an empty string", "", "2026-08-27"],
    ["a two-digit year", "26-08-20", "26-08-27"],
  ])("refuses a coverage window that is not an AWST calendar day (%s)", (_label, from, until) => {
    expect(
      applyAssignmentAction(claimed(), { type: "startCoverage", actorId: actorId("C"), from, until }, clock),
    ).toEqual({ ok: false, reason: "coverage-window-not-calendar-day" });
  });

  it("checks the calendar-day shape before the ordering, so nonsense is never merely 'inverted'", () => {
    expect(
      applyAssignmentAction(
        claimed(),
        { type: "startCoverage", actorId: actorId("C"), from: "cherry", until: "banana" },
        clock,
      ),
    ).toEqual({ ok: false, reason: "coverage-window-not-calendar-day" });
  });

  it("still accepts a well-formed window, so the new refusal is not refusing everything", () => {
    expect(
      applyAssignmentAction(
        claimed(),
        { type: "startCoverage", actorId: actorId("C"), from: "2026-02-28", until: "2026-02-29" },
        clock,
      ).ok,
    ).toBe(false); // 2026 is not a leap year, so the 29th does not exist.
    const valid = applyAssignmentAction(
      claimed(),
      { type: "startCoverage", actorId: actorId("C"), from: "2024-02-28", until: "2024-02-29" },
      clock,
    );
    expect(valid.ok).toBe(true);
  });

  it("measures queue age against the 60-minute escalation", () => {
    expect(UNCLAIMED_ESCALATION_MINUTES).toBe(60);
    expect(queueAgeMinutes("2026-08-19T00:00:00.000Z", "2026-08-19T01:30:00.000Z")).toBe(90);
    expect(queueAgeMinutes("2026-08-19T02:00:00.000Z", "2026-08-19T01:00:00.000Z")).toBe(0);
  });

  it("refuses to reassign a plan that has never been claimed", () => {
    expect(
      applyAssignmentAction(
        unassigned(),
        { type: "reassign", toActorId: actorId("ACTOR-NEW"), reason: "leave" },
        clock,
      ),
    ).toEqual({ ok: false, reason: "plan-not-claimed" });
  });

  it("requires a non-blank reason to reassign an owned plan", () => {
    expect(
      applyAssignmentAction(claimed(), { type: "reassign", toActorId: actorId("ACTOR-NEW"), reason: "  " }, clock),
    ).toEqual({ ok: false, reason: "reassignment-reason-required" });
  });

  it("refuses to start coverage on a plan that has never been claimed", () => {
    expect(
      applyAssignmentAction(
        unassigned(),
        { type: "startCoverage", actorId: actorId("ACTOR-COVER"), from: "2026-08-20", until: "2026-08-27" },
        clock,
      ),
    ).toEqual({ ok: false, reason: "plan-not-claimed" });
  });

  it("ends coverage and falls back to the named owner", () => {
    const covered = applyAssignmentAction(
      claimed(),
      { type: "startCoverage", actorId: actorId("ACTOR-COVER"), from: "2026-08-20", until: "2026-08-27" },
      clock,
    );
    if (!covered.ok) throw new Error(covered.reason);

    const ended = applyAssignmentAction(covered.value, { type: "endCoverage" }, clock);
    if (!ended.ok) throw new Error(ended.reason);
    expect(ended.value.coveredBy).toBeNull();
    expect(ended.value.ownerId).toBe(OWNER);
    expect(effectiveResponder(ended.value, "2026-08-21")).toBe(OWNER);
  });
});
