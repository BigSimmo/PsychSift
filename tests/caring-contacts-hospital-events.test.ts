// tests/caring-contacts-hospital-events.test.ts
import { describe, expect, it } from "vitest";

import {
  applyHospitalStatusEvent,
  applyWithdrawalRequest,
  sendableContacts,
  type HospitalStatusEvent,
} from "@/lib/caring-contacts/hospital-events";
import { planId, teamId } from "@/lib/caring-contacts/ids";
import type { Plan } from "@/lib/caring-contacts/model";
import { buildApprovedSchedule } from "@/lib/caring-contacts/schedule";

const basePlan = (state: Plan["state"], version = 1): Plan => ({
  id: planId("PLAN-1"),
  teamId: teamId("TEAM-1"),
  state,
  version,
});

const DEATH_RECORDED_AT = new Date("2026-03-04T01:30:00.000Z");

const thirdPartyRequest = {
  type: "thirdPartyPauseRequest",
  requester: "Marion Okafor",
  relationship: "mother",
  note: "Rang the team and asked for the messages to stop for now.",
} as const;

const ALL_EVENTS: HospitalStatusEvent[] = [
  { type: "readmission" },
  { type: "death", recordedAt: DEATH_RECORDED_AT },
  { type: "deathCorrection" },
  { type: "mobileChanged" },
  thirdPartyRequest,
];

function expectOk<T>(result: { ok: true; value: T } | { ok: false; reason: string }): T {
  if (!result.ok) throw new Error(`expected ok, got refusal: ${result.reason}`);
  return result.value;
}

// ---------------------------------------------------------------------------
// Rule 1 — readmission
// ---------------------------------------------------------------------------

describe("rule 1: readmission pauses future contacts", () => {
  it("pauses an active plan and raises no exception or incident", () => {
    const transition = expectOk(applyHospitalStatusEvent(basePlan("active"), { type: "readmission" }));

    expect(transition.plan.state).toBe("paused");
    expect(transition.plan.version).toBe(2);
    expect(transition.exceptions).toEqual([]);
    expect(transition.incident).toBeUndefined();
    expect(transition.contactOutcome).toEqual({ type: "holdFuture" });
  });

  it("never rebases the calendar: the transition carries no dates or schedule at all", () => {
    const transition = expectOk(applyHospitalStatusEvent(basePlan("active"), { type: "readmission" }));

    expect(Object.keys(transition).sort()).toEqual(["contactOutcome", "exceptions", "plan"]);
    expect(Object.keys(transition.contactOutcome)).toEqual(["type"]);
  });

  it("never auto-resumes: no hospital status event returns a readmission-paused plan to active", () => {
    const paused = expectOk(applyHospitalStatusEvent(basePlan("active"), { type: "readmission" })).plan;

    for (const event of ALL_EVENTS) {
      const result = applyHospitalStatusEvent(paused, event);
      if (result.ok) expect(result.value.plan.state).not.toBe("active");
    }
  });

  it("is idempotent on an already-paused plan", () => {
    const transition = expectOk(applyHospitalStatusEvent(basePlan("paused", 4), { type: "readmission" }));

    expect(transition.plan.state).toBe("paused");
    expect(transition.plan.version).toBe(4);
    expect(transition.exceptions).toEqual([]);
  });

  it("refuses on a draft plan with the underlying lifecycle reason", () => {
    expect(applyHospitalStatusEvent(basePlan("draft"), { type: "readmission" })).toEqual({
      ok: false,
      reason: "plan-not-active",
    });
  });
});

// ---------------------------------------------------------------------------
// Rule 2 — death (the most important path in this module)
// ---------------------------------------------------------------------------

describe("rule 2: death irreversibly cancels every unsent contact", () => {
  it("cancels an active plan and records the death instant", () => {
    const transition = expectOk(
      applyHospitalStatusEvent(basePlan("active"), { type: "death", recordedAt: DEATH_RECORDED_AT }),
    );

    expect(transition.plan.state).toBe("cancelled");
    expect(transition.plan.version).toBe(2);
    expect(transition.contactOutcome).toEqual({
      type: "cancelUnsent",
      recordedAt: DEATH_RECORDED_AT,
      irreversible: true,
    });
  });

  it("still cancels when the plan was already paused by a readmission", () => {
    const paused = expectOk(applyHospitalStatusEvent(basePlan("active"), { type: "readmission" })).plan;
    const transition = expectOk(applyHospitalStatusEvent(paused, { type: "death", recordedAt: DEATH_RECORDED_AT }));

    expect(transition.plan.state).toBe("cancelled");
    expect(transition.contactOutcome.type).toBe("cancelUnsent");
  });

  it("cancels a draft plan too, so an unstarted plan can never wake up", () => {
    const transition = expectOk(
      applyHospitalStatusEvent(basePlan("draft"), { type: "death", recordedAt: DEATH_RECORDED_AT }),
    );

    expect(transition.plan.state).toBe("cancelled");
  });

  it("still cancels when the recorded instant is unusable, and names the exception", () => {
    const transition = expectOk(
      applyHospitalStatusEvent(basePlan("active"), { type: "death", recordedAt: new Date("not-a-date") }),
    );

    expect(transition.plan.state).toBe("cancelled");
    expect(transition.exceptions).toEqual([{ type: "deathRecordedAtUnusable" }]);
  });

  it("refuses every later moving event on the cancelled plan with plan-terminal", () => {
    const cancelled = expectOk(
      applyHospitalStatusEvent(basePlan("active"), { type: "death", recordedAt: DEATH_RECORDED_AT }),
    ).plan;

    const movingEvents: HospitalStatusEvent[] = [
      { type: "readmission" },
      { type: "death", recordedAt: new Date("2026-03-05T01:30:00.000Z") },
      { type: "mobileChanged" },
      thirdPartyRequest,
    ];

    for (const event of movingEvents) {
      expect(applyHospitalStatusEvent(cancelled, event)).toEqual({ ok: false, reason: "plan-terminal" });
    }
  });

  it("leaves the plan cancelled after every later event, including a death correction", () => {
    const cancelled = expectOk(
      applyHospitalStatusEvent(basePlan("active"), { type: "death", recordedAt: DEATH_RECORDED_AT }),
    ).plan;

    for (const event of ALL_EVENTS) {
      const result = applyHospitalStatusEvent(cancelled, event);
      if (result.ok) {
        expect(result.value.plan.state).toBe("cancelled");
        expect(result.value.plan.version).toBe(cancelled.version);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Rule 3 — death correction
// ---------------------------------------------------------------------------

describe("rule 3: death correction raises an incident but never resumes the episode", () => {
  const cancelledByDeath = () =>
    expectOk(applyHospitalStatusEvent(basePlan("active"), { type: "death", recordedAt: DEATH_RECORDED_AT })).plan;

  it("raises the deathCorrection incident and requires a new referral", () => {
    const transition = expectOk(applyHospitalStatusEvent(cancelledByDeath(), { type: "deathCorrection" }));

    expect(transition.incident).toEqual({
      type: "deathCorrection",
      episodeResumed: false,
      requiresNewReferral: true,
    });
  });

  it("leaves the plan exactly as it was — same state, same version", () => {
    const cancelled = cancelledByDeath();
    const transition = expectOk(applyHospitalStatusEvent(cancelled, { type: "deathCorrection" }));

    expect(transition.plan).toEqual(cancelled);
    expect(transition.contactOutcome).toEqual({ type: "unchanged" });
  });

  it("refuses a correction for a plan that was never cancelled", () => {
    expect(applyHospitalStatusEvent(basePlan("active"), { type: "deathCorrection" })).toEqual({
      ok: false,
      reason: "death-correction-without-cancellation",
    });
  });
});

// ---------------------------------------------------------------------------
// Rule 4 — mobile number changed
// ---------------------------------------------------------------------------

describe("rule 4: a changed mobile number pauses and raises contactChanged", () => {
  it("pauses the plan and raises the exception", () => {
    const transition = expectOk(applyHospitalStatusEvent(basePlan("active"), { type: "mobileChanged" }));

    expect(transition.plan.state).toBe("paused");
    expect(transition.exceptions).toEqual([{ type: "contactChanged" }]);
    expect(transition.contactOutcome).toEqual({ type: "holdFuture" });
  });

  it("never silently switches destination: the transition carries no destination of any kind", () => {
    const transition = expectOk(applyHospitalStatusEvent(basePlan("active"), { type: "mobileChanged" }));

    expect(Object.keys(transition).sort()).toEqual(["contactOutcome", "exceptions", "plan"]);
    expect(Object.keys(transition.exceptions[0])).toEqual(["type"]);
  });

  it("still raises the exception when the plan is already paused, so the change is never swallowed", () => {
    const transition = expectOk(applyHospitalStatusEvent(basePlan("paused", 6), { type: "mobileChanged" }));

    expect(transition.plan.version).toBe(6);
    expect(transition.exceptions).toEqual([{ type: "contactChanged" }]);
  });
});

// ---------------------------------------------------------------------------
// Rule 5 — third-party pause request and the refused withdrawal
// ---------------------------------------------------------------------------

describe("rule 5: a third party may pause but may never withdraw", () => {
  it("pauses and records requester, relationship and note", () => {
    const transition = expectOk(applyHospitalStatusEvent(basePlan("active"), thirdPartyRequest));

    expect(transition.plan.state).toBe("paused");
    expect(transition.exceptions).toEqual([
      {
        type: "thirdPartyPause",
        requester: "Marion Okafor",
        relationship: "mother",
        note: "Rang the team and asked for the messages to stop for now.",
      },
    ]);
    expect(transition.contactOutcome).toEqual({ type: "holdFuture" });
  });

  it("is idempotent on an already-paused plan and does not double-raise the exception", () => {
    const paused = expectOk(applyHospitalStatusEvent(basePlan("active"), thirdPartyRequest)).plan;
    const second = expectOk(applyHospitalStatusEvent(paused, thirdPartyRequest));

    expect(second.plan).toEqual(paused);
    expect(second.exceptions).toEqual([]);
    expect(second.contactOutcome).toEqual({ type: "holdFuture" });
  });

  it("refuses a third-party withdrawal of an active plan", () => {
    expect(applyWithdrawalRequest(basePlan("active"), { origin: "thirdParty" })).toEqual({
      ok: false,
      reason: "third-party-withdrawal-refused",
    });
  });

  it("refuses a third-party withdrawal of a plan the same third party just paused", () => {
    const paused = expectOk(applyHospitalStatusEvent(basePlan("active"), thirdPartyRequest)).plan;

    expect(applyWithdrawalRequest(paused, { origin: "thirdParty" })).toEqual({
      ok: false,
      reason: "third-party-withdrawal-refused",
    });
  });

  it("still allows the patient to withdraw", () => {
    const transition = expectOk(applyWithdrawalRequest(basePlan("active"), { origin: "patient" }));

    expect(transition.plan.state).toBe("withdrawn");
    expect(transition.contactOutcome).toEqual({ type: "stopAll" });
  });

  it("refuses a withdrawal of a cancelled plan with plan-terminal", () => {
    expect(applyWithdrawalRequest(basePlan("cancelled"), { origin: "patient" })).toEqual({
      ok: false,
      reason: "plan-terminal",
    });
  });
});

// ---------------------------------------------------------------------------
// Inherited constraint — sendability is decided by `suppressed`, never by `sendAt`
// ---------------------------------------------------------------------------

describe("sendableContacts keys off suppressed, never off the presence of sendAt", () => {
  const schedule = () => {
    // Discharge 2026-01-10 AWST; a first contact moved to discharge + 7 collides with Week 1,
    // so Week 1 is suppressed while still carrying a real sendAt.
    const result = buildApprovedSchedule({
      dischargeAt: new Date("2026-01-10T02:00:00.000Z"),
      sendingPreference: "morning",
      firstContactDate: "2026-01-17",
      firstContactReason: "Patient was interstate for the first week.",
    });
    if (!result.ok) throw new Error(`schedule fixture failed: ${result.reason}`);
    return result.contacts;
  };

  it("excludes the suppressed entry even though it still has a real sendAt", () => {
    const contacts = schedule();
    const suppressed = contacts.filter((contact) => contact.suppressed);

    expect(suppressed).toHaveLength(1);
    expect(suppressed[0].sendAt instanceof Date).toBe(true);
    expect(Number.isNaN(suppressed[0].sendAt.getTime())).toBe(false);

    const sendable = sendableContacts(contacts);
    expect(sendable).toHaveLength(contacts.length - 1);
    expect(sendable.some((contact) => contact.suppressed)).toBe(false);
  });

  it("returns every entry when nothing is suppressed", () => {
    const result = buildApprovedSchedule({
      dischargeAt: new Date("2026-01-10T02:00:00.000Z"),
      sendingPreference: "morning",
    });
    if (!result.ok) throw new Error(`schedule fixture failed: ${result.reason}`);

    expect(sendableContacts(result.contacts)).toHaveLength(result.contacts.length);
  });
});

// ---------------------------------------------------------------------------
// Refusals are always named
// ---------------------------------------------------------------------------

describe("every refusal is a named machine-readable reason", () => {
  it("names an unrecognised event rather than throwing or silently succeeding", () => {
    const result = applyHospitalStatusEvent(basePlan("active"), { type: "transferredToAnotherHospital" } as never);

    expect(result).toEqual({ ok: false, reason: "unknown-hospital-status-event" });
  });

  it("names an unrecognised withdrawal origin", () => {
    const result = applyWithdrawalRequest(basePlan("active"), { origin: "anonymousCaller" } as never);

    expect(result).toEqual({ ok: false, reason: "unknown-withdrawal-origin" });
  });
});
