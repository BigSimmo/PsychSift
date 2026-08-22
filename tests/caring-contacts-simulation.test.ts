// tests/caring-contacts-simulation.test.ts
//
// The integration proof for the caring-contact rules layer: one twelve-month episode driven
// through the real store, the real permissions, the real lifecycles and the real calendar.
//
// The assertion that matters most is that nobody ever receives a duplicate message, and that
// nothing is ever sent at or after a recorded death. Everything else here exists to make those two
// impossible to pass by accident.
import { describe, expect, it } from "vitest";

import { assertAuditEventFreeOfPatientData, type AuditEvent } from "@/lib/caring-contacts/audit";
import { awstCalendarDay } from "@/lib/caring-contacts/clock";
import {
  actorId,
  idempotencyKey,
  pathwayVersionId,
  patientId,
  planId,
  referralId,
  teamId,
} from "@/lib/caring-contacts/ids";
import { PROVISIONAL_MESSAGE_RULES } from "@/lib/caring-contacts/message-rules";
import type { Actor, SystemActor } from "@/lib/caring-contacts/permissions";
import { DEFAULT_CONTACT_RETRY_POLICY } from "@/lib/caring-contacts/service-rules";
import type { EpisodePatientDetail, StoredContact } from "@/lib/caring-contacts/repository";
import {
  driveTwelveMonthSimulation,
  runTwelveMonthSimulation,
  type SimulationEvent,
  type SimulationInput,
  type SimulationPlanInput,
  type SimulationRun,
  type Transport,
  type TransportAttempt,
} from "@/lib/caring-contacts/simulation";

const TEAM = teamId("TEAM-NORTH");
const PLAN_ID = planId("PLAN-SIM");

const COORDINATOR: Actor = { id: actorId("ACTOR-COORDINATOR"), teamId: TEAM, roles: ["coordinator"] };
const AUDITOR: Actor = { id: actorId("ACTOR-AUDITOR"), teamId: TEAM, roles: ["auditor"] };
const DISPATCHER: SystemActor = {
  id: actorId("SYSTEM-DISPATCHER"),
  teamId: TEAM,
  systemRole: "contactDispatcher",
};

const PATIENT_DETAIL: EpisodePatientDetail = {
  patientName: "Jordan Nguyen",
  patientMobileNumber: "+61 491 570 156",
  patientIdentifiers: ["UR-00219384"],
  culturalIdentity: null,
};

/** Discharge at 2026-03-02 10:00 AWST. Every date below is derived from this one day. */
const DISCHARGE_AT = new Date("2026-03-02T02:00:00.000Z");

/** The ten calendar days a morning-preference plan discharged on 2026-03-02 produces. */
const EXPECTED_CALENDAR = [
  "2026-03-03", // Day 1
  "2026-03-09", // Week 1
  "2026-04-02", // Month 1
  "2026-05-02", // Month 2
  "2026-06-02", // Month 3
  "2026-07-02", // Month 4
  "2026-09-02", // Month 6
  "2026-11-02", // Month 8
  "2027-01-02", // Month 10
  "2027-03-02", // Month 12
];

/** 10:00 AWST on an AWST calendar day, i.e. the send instant of a morning-preference contact. */
const sendInstant = (calendarDay: string): Date => new Date(`${calendarDay}T02:00:00.000Z`);
const minutesAfter = (instant: Date, minutes: number): Date => new Date(instant.getTime() + minutes * 60_000);

const MONTH_2_AT = sendInstant("2026-05-02");
const MONTH_3_AT = sendInstant("2026-06-02");

function planInput(overrides: Partial<SimulationPlanInput> = {}): SimulationPlanInput {
  return {
    planId: PLAN_ID,
    referralId: referralId("REFERRAL-SIM"),
    patientId: patientId("PATIENT-SIM"),
    pathwayVersionId: pathwayVersionId("PATHWAY-SIM"),
    dischargeAt: DISCHARGE_AT,
    sendingPreference: "morning",
    patientDetail: PATIENT_DETAIL,
    ...overrides,
  };
}

function simulationInput(overrides: Partial<SimulationInput> = {}): SimulationInput {
  return {
    plan: planInput(),
    coordinator: COORDINATOR,
    dispatcher: DISPATCHER,
    auditor: AUDITOR,
    // retryPolicy deliberately omitted: the governed default in ./service-rules is what the
    // service actually runs, so the scenarios below exercise it rather than a fixture value.
    ...overrides,
  };
}

/** A transport that records every attempt and answers from a per-sequence script. */
function scriptedTransport(script: Record<number, readonly ("transient" | "delivered" | "notDelivered")[]>): Transport {
  return (attempt: TransportAttempt) => {
    const outcomes = script[attempt.sequence];
    const outcome = outcomes ? (outcomes[attempt.attempt - 1] ?? "delivered") : "delivered";
    if (outcome === "transient") return { type: "transientFailure" };
    return { type: "sent", status: outcome };
  };
}

const sequencesOf = (contacts: readonly { sequence: number }[]): number[] => contacts.map((c) => c.sequence);

const daysOf = (contacts: readonly { calendarDay: string }[]): string[] => contacts.map((c) => c.calendarDay);

const stateOf = (run: SimulationRun, sequence: number): string => {
  const found = run.contacts.find((entry) => entry.planned.sequence === sequence);
  if (!found) throw new Error(`no stored contact at sequence ${sequence}`);
  return found.contact.state;
};

const allowedEventsFor = (events: readonly AuditEvent[], contact: StoredContact): AuditEvent[] =>
  events.filter((event) => event.objectId === contact.contact.id && event.outcome === "allowed");

// ---------------------------------------------------------------------------
// 1. Clean run
// ---------------------------------------------------------------------------

describe("scenario 1: a clean twelve-month run", () => {
  it("dispatches exactly ten contacts, in ascending order, with zero duplicates", async () => {
    const report = await runTwelveMonthSimulation(simulationInput());

    expect(report.dispatched).toHaveLength(10);
    expect(report.missed).toEqual([]);
    expect(report.suppressed).toEqual([]);

    expect(daysOf(report.dispatched)).toEqual(EXPECTED_CALENDAR);
    expect(sequencesOf(report.dispatched)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

    // Ascending, and never two on one day.
    const instants = report.dispatched.map((contact) => contact.sendAt.getTime());
    for (let index = 1; index < instants.length; index += 1) {
      expect(instants[index]).toBeGreaterThan(instants[index - 1]);
    }
    expect(new Set(daysOf(report.dispatched)).size).toBe(10);
    expect(new Set(sequencesOf(report.dispatched)).size).toBe(10);
  });

  it("leaves every contact delivered and the episode counting ten sent", async () => {
    const run = await driveTwelveMonthSimulation(simulationInput());

    expect(run.contacts.map((entry) => entry.contact.state)).toEqual(Array(10).fill("delivered"));

    const episode = await run.store.getEpisode(PLAN_ID, { actor: COORDINATOR });
    expect(episode?.counts).toEqual({ contactsScheduled: 10, contactsSent: 10, contactsDelivered: 10 });
  });

  it("refuses every re-attempt at the end of the year, so a swept queue cannot send a second message", async () => {
    // One contact comes back `notDelivered`, which is NOT a terminal contact state -- it is exactly
    // the contact an operator's retry sweep would pick up, and exactly the one that must not be
    // sent again without a human decision.
    const run = await driveTwelveMonthSimulation(
      simulationInput({ transport: scriptedTransport({ 3: ["notDelivered"] }) }),
    );

    expect(run.report.dispatched).toHaveLength(10);
    expect(stateOf(run, 3)).toBe("notDelivered");

    const beforeTrail = (await run.store.listAuditEvents({ actor: AUDITOR })).length;
    const refusals: string[] = [];

    for (const entry of run.contacts) {
      const start = await run.store.startContactDispatch(
        {
          planId: PLAN_ID,
          contactId: entry.contact.id,
          expectedContactVersion: entry.contact.version,
        },
        { actor: DISPATCHER, idempotencyKey: idempotencyKey(`sweep-start-${entry.planned.sequence}`) },
      );
      expect(start.ok).toBe(false);
      if (!start.ok) refusals.push(start.reason);

      const sent = await run.store.recordContactSent(
        {
          planId: PLAN_ID,
          contactId: entry.contact.id,
          expectedContactVersion: entry.contact.version,
        },
        { actor: DISPATCHER, idempotencyKey: idempotencyKey(`sweep-sent-${entry.planned.sequence}`) },
      );
      expect(sent.ok).toBe(false);
      if (!sent.ok) refusals.push(sent.reason);
    }

    expect(refusals).toHaveLength(20);
    // The notDelivered contact is refused on the state machine's precondition, not on terminality.
    expect(refusals).toContain("contact-not-processing");

    // Nothing moved: no contact advanced, and the sweep produced only refusal records.
    const after = await run.store.listContacts(PLAN_ID, { actor: COORDINATOR });
    expect(after.map((entry) => entry.contact.version)).toEqual(run.contacts.map((entry) => entry.contact.version));
    const afterTrail = await run.store.listAuditEvents({ actor: AUDITOR });
    expect(afterTrail).toHaveLength(beforeTrail + 20);
    expect(afterTrail.slice(beforeTrail).every((event) => event.outcome === "denied")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. Retry
// ---------------------------------------------------------------------------

describe("scenario 2: a transient failure retries inside the original window and then stops", () => {
  it("makes exactly three attempts, sends on the third, and never makes a fourth", async () => {
    const run = await driveTwelveMonthSimulation(
      simulationInput({
        transport: scriptedTransport({ 3: ["transient", "transient", "delivered"] }),
      }),
    );

    const forMonthOne = run.attempts.filter((attempt) => attempt.sequence === 3);
    expect(forMonthOne).toHaveLength(3);
    expect(forMonthOne.map((attempt) => attempt.attempt)).toEqual([1, 2, 3]);
    expect(run.attempts.some((attempt) => attempt.attempt > 3)).toBe(false);

    // All three attempts stayed inside the contact's own day and its approved window.
    for (const attempt of forMonthOne) {
      expect(awstCalendarDay(attempt.at)).toBe("2026-04-02");
    }
    expect(forMonthOne.map((attempt) => attempt.at.toISOString())).toEqual([
      "2026-04-02T02:00:00.000Z",
      "2026-04-02T02:45:00.000Z",
      "2026-04-02T03:30:00.000Z",
    ]);

    expect(run.report.dispatched).toHaveLength(10);
    expect(stateOf(run, 3)).toBe("delivered");

    // Retrying is not resending: the message left the building exactly once.
    const contact = run.contacts[2];
    const sentEvents = allowedEventsFor(run.report.auditEvents, contact).filter(
      (event) => event.action === "recordContactSent",
    );
    expect(sentEvents).toHaveLength(1);
  });

  it("gives up after the cap and records the contact as missed, having sent nothing", async () => {
    const run = await driveTwelveMonthSimulation(
      simulationInput({
        transport: scriptedTransport({ 3: ["transient", "transient", "transient"] }),
      }),
    );

    expect(run.attempts.filter((attempt) => attempt.sequence === 3)).toHaveLength(3);
    expect(sequencesOf(run.report.missed)).toEqual([3]);
    expect(sequencesOf(run.report.dispatched)).toEqual([1, 2, 4, 5, 6, 7, 8, 9, 10]);
    expect(stateOf(run, 3)).toBe("missed");

    const contact = run.contacts[2];
    expect(allowedEventsFor(run.report.auditEvents, contact).map((event) => event.action)).toEqual([
      "recordContactMissed",
    ]);
  });
});

// ---------------------------------------------------------------------------
// The retry policy is governed configuration, not a per-caller invention
// ---------------------------------------------------------------------------

describe("the retry policy has a governed home", () => {
  it("is two retries, three attempts in total, and is the value the driver uses when none is given", async () => {
    expect(DEFAULT_CONTACT_RETRY_POLICY).toEqual({ maxAttempts: 3, retryIntervalMinutes: 45 });

    const run = await driveTwelveMonthSimulation(
      simulationInput({ transport: scriptedTransport({ 1: ["transient", "transient", "delivered"] }) }),
    );

    const forFirst = run.attempts.filter((attempt) => attempt.sequence === 1);
    expect(forFirst).toHaveLength(3);
    expect(forFirst[1].at.getTime() - forFirst[0].at.getTime()).toBe(45 * 60_000);
    expect(stateOf(run, 1)).toBe("delivered");
  });

  it("stays overridable, and an override does not disturb the default", async () => {
    const run = await driveTwelveMonthSimulation(
      simulationInput({
        retryPolicy: { ...DEFAULT_CONTACT_RETRY_POLICY, maxAttempts: 1 },
        transport: scriptedTransport({ 1: ["transient", "delivered"] }),
      }),
    );

    expect(run.attempts.filter((attempt) => attempt.sequence === 1)).toHaveLength(1);
    expect(stateOf(run, 1)).toBe("missed");
    expect(DEFAULT_CONTACT_RETRY_POLICY.maxAttempts).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// 3. Window boundary
// ---------------------------------------------------------------------------

describe("scenario 3: retries that would leave the window are abandoned, never sent late", () => {
  it("stops at the window edge and marks the contact missed even though the next attempt would have succeeded", async () => {
    // 17:00 AWST + 45 + 45 = 18:30, past the approved 18:00 boundary.
    const run = await driveTwelveMonthSimulation(
      simulationInput({
        plan: planInput({ sendingPreference: "earlyEvening" }),
        // No retryPolicy: the governed default is 3 attempts 45 minutes apart, and the third
        // landing outside the window is the interaction this scenario exists to prove.
        transport: scriptedTransport({ 3: ["transient", "transient", "delivered"] }),
      }),
    );

    const forMonthOne = run.attempts.filter((attempt) => attempt.sequence === 3);
    expect(forMonthOne).toHaveLength(2);
    expect(forMonthOne.map((attempt) => attempt.at.toISOString())).toEqual([
      "2026-04-02T09:00:00.000Z", // 17:00 AWST
      "2026-04-02T09:45:00.000Z", // 17:45 AWST
    ]);

    expect(sequencesOf(run.report.missed)).toEqual([3]);
    expect(sequencesOf(run.report.dispatched)).not.toContain(3);
    expect(stateOf(run, 3)).toBe("missed");
    expect(run.refusals).toContainEqual({
      step: "window",
      sequence: 3,
      reason: "outside-approved-send-window",
    });

    // Never sent late: no contact-status write for that contact says it went out, and the rest of
    // the year is unaffected.
    const contact = run.contacts[2];
    expect(allowedEventsFor(run.report.auditEvents, contact).map((event) => event.action)).toEqual([
      "recordContactMissed",
    ]);
    expect(run.report.dispatched).toHaveLength(9);
  });

  it("never lets a retry roll into the next day's window", async () => {
    // A retry interval long enough to land inside 09:00-18:00 of the FOLLOWING day if the day were
    // not checked: 17:00 + 17h = 10:00 the next morning, which is inside the window by hour alone.
    const run = await driveTwelveMonthSimulation(
      simulationInput({
        plan: planInput({ sendingPreference: "earlyEvening" }),
        retryPolicy: { maxAttempts: 2, retryIntervalMinutes: 17 * 60 },
        transport: scriptedTransport({ 3: ["transient", "delivered"] }),
      }),
    );

    expect(run.attempts.filter((attempt) => attempt.sequence === 3)).toHaveLength(1);
    expect(stateOf(run, 3)).toBe("missed");
    expect(sequencesOf(run.report.dispatched)).not.toContain(3);
  });
});

// ---------------------------------------------------------------------------
// 4. Pause and resume
// ---------------------------------------------------------------------------

describe("scenario 4: a pause permanently skips the contacts it covers", () => {
  const events: readonly SimulationEvent[] = [
    { when: { type: "at", instant: sendInstant("2026-04-15") }, action: { type: "pause" } },
    { when: { type: "at", instant: sendInstant("2026-06-15") }, action: { type: "resume" } },
  ];

  it("skips months 2 and 3, resumes at month 4, and dispatches eight in total", async () => {
    const run = await driveTwelveMonthSimulation(simulationInput({ events }));

    expect(sequencesOf(run.report.dispatched)).toEqual([1, 2, 3, 6, 7, 8, 9, 10]);
    expect(run.report.dispatched).toHaveLength(8);
    expect(sequencesOf(run.report.missed)).toEqual([4, 5]);
    expect(stateOf(run, 4)).toBe("missed");
    expect(stateOf(run, 5)).toBe("missed");
    expect(stateOf(run, 6)).toBe("delivered");
  });

  it("never re-sends a skipped contact after the resume, and leaves the calendar untouched", async () => {
    const run = await driveTwelveMonthSimulation(simulationInput({ events }));

    // The skipped contacts keep their original dates; nothing was rebased onto the resume.
    expect(daysOf(run.contacts.map((entry) => entry.planned))).toEqual(EXPECTED_CALENDAR);
    const skipped = run.contacts.filter((entry) => [4, 5].includes(entry.planned.sequence));
    for (const entry of skipped) {
      expect(allowedEventsFor(run.report.auditEvents, entry).map((event) => event.action)).toEqual([
        "recordContactMissed",
      ]);
    }

    const record = await run.store.getPlan(PLAN_ID, { actor: COORDINATOR });
    expect(record?.plan.state).toBe("active");
  });

  it("refuses the dispatch itself while paused, rather than the driver deciding to hold back", async () => {
    const run = await driveTwelveMonthSimulation(simulationInput({ events }));

    expect(run.refusals).toContainEqual({
      step: "startContactDispatch",
      sequence: 4,
      reason: "contact-dispatch-requires-active-plan",
    });
  });
});

// ---------------------------------------------------------------------------
// 5. Withdrawal
// ---------------------------------------------------------------------------

describe("scenario 5: a withdrawal cancels every later contact", () => {
  const events: readonly SimulationEvent[] = [
    {
      when: { type: "at", instant: sendInstant("2026-08-02") },
      action: { type: "withdraw", origin: "patient" },
    },
  ];

  it("sends nothing after the withdrawal and cancels the remaining contacts", async () => {
    const run = await driveTwelveMonthSimulation(simulationInput({ events }));

    expect(sequencesOf(run.report.dispatched)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(sequencesOf(run.report.missed)).toEqual([7, 8, 9, 10]);

    for (const sequence of [7, 8, 9, 10]) {
      expect(stateOf(run, sequence)).toBe("cancelled");
    }
    for (const sequence of [1, 2, 3, 4, 5, 6]) {
      expect(stateOf(run, sequence)).toBe("delivered");
    }

    const record = await run.store.getPlan(PLAN_ID, { actor: COORDINATOR });
    expect(record?.plan.state).toBe("withdrawn");
    expect(record?.outcome).toBe("withdrawn");
    expect(await run.store.listSendableContacts(PLAN_ID, { actor: COORDINATOR })).toEqual([]);
  });

  it("writes no contact-status event at all for a cancelled contact", async () => {
    const run = await driveTwelveMonthSimulation(simulationInput({ events }));

    const cancelled = run.contacts.filter((entry) => entry.contact.state === "cancelled");
    expect(cancelled).toHaveLength(4);
    for (const entry of cancelled) {
      expect(allowedEventsFor(run.report.auditEvents, entry)).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// 6. Readmission then discharge
// ---------------------------------------------------------------------------

describe("scenario 6: a readmission never auto-resumes and never rebases", () => {
  const events: readonly SimulationEvent[] = [
    {
      when: { type: "at", instant: sendInstant("2026-04-15") },
      action: { type: "hospitalStatus", event: { type: "readmission" } },
    },
  ];

  it("holds the plan paused for the rest of the year with no contact after the readmission", async () => {
    const run = await driveTwelveMonthSimulation(simulationInput({ events }));

    expect(sequencesOf(run.report.dispatched)).toEqual([1, 2, 3]);
    expect(sequencesOf(run.report.missed)).toEqual([4, 5, 6, 7, 8, 9, 10]);

    const record = await run.store.getPlan(PLAN_ID, { actor: COORDINATOR });
    expect(record?.plan.state).toBe("paused");
  });

  it("keeps the original calendar exactly as it was", async () => {
    const run = await driveTwelveMonthSimulation(simulationInput({ events }));
    const clean = await driveTwelveMonthSimulation(simulationInput());

    expect(daysOf(run.contacts.map((entry) => entry.planned))).toEqual(
      daysOf(clean.contacts.map((entry) => entry.planned)),
    );
    expect(daysOf(run.contacts.map((entry) => entry.planned))).toEqual(EXPECTED_CALENDAR);
  });

  it("refuses a second discharge to open a competing plan for the same patient", async () => {
    const run = await driveTwelveMonthSimulation(simulationInput({ events }));

    // The later discharge from the readmitted stay cannot rebase the year, and cannot start a
    // parallel one either -- the original episode is still open, and a human has to close it.
    const second = await run.store.createPlan(
      {
        planId: planId("PLAN-SIM-2"),
        referralId: referralId("REFERRAL-SIM-2"),
        patientId: patientId("PATIENT-SIM"),
        pathwayVersionId: pathwayVersionId("PATHWAY-SIM"),
        dischargeAt: sendInstant("2026-05-20"),
        sendingPreference: "morning",
        patientDetail: PATIENT_DETAIL,
      },
      { actor: COORDINATOR, idempotencyKey: idempotencyKey("second-discharge") },
    );

    expect(second).toEqual({ ok: false, reason: "duplicate-active-plan" });
  });
});

// ---------------------------------------------------------------------------
// 7. Death
// ---------------------------------------------------------------------------

describe("scenario 7: nothing is dispatched at or after a recorded death", () => {
  const deathAt = (instant: Date): SimulationEvent => ({
    when: { type: "at", instant },
    action: { type: "hospitalStatus", event: { type: "death", recordedAt: instant } },
  });

  it("does not send the contact due at the exact instant of the death", async () => {
    const run = await driveTwelveMonthSimulation(simulationInput({ events: [deathAt(MONTH_3_AT)] }));

    expect(sequencesOf(run.report.dispatched)).toEqual([1, 2, 3, 4]);
    expect(sequencesOf(run.report.missed)).toEqual([5, 6, 7, 8, 9, 10]);
    expect(stateOf(run, 5)).toBe("cancelled");

    const record = await run.store.getPlan(PLAN_ID, { actor: COORDINATOR });
    expect(record?.plan.state).toBe("cancelled");

    // The decisive assertion: no send-recording write happened at or after the death instant.
    const sentEvents = run.report.auditEvents.filter(
      (event) => event.action === "recordContactSent" && event.outcome === "allowed",
    );
    expect(sentEvents).toHaveLength(4);
    for (const event of sentEvents) {
      expect(new Date(event.timestamp).getTime()).toBeLessThan(MONTH_3_AT.getTime() + 8 * 60 * 60 * 1000);
    }
    for (const contact of run.report.dispatched) {
      expect(contact.sendAt.getTime()).toBeLessThan(MONTH_3_AT.getTime());
    }
  });

  it("does not send when the death lands between two retry attempts", async () => {
    const run = await driveTwelveMonthSimulation(
      simulationInput({
        events: [deathAt(minutesAfter(MONTH_3_AT, 20))],
        transport: scriptedTransport({ 5: ["transient", "delivered", "delivered"] }),
      }),
    );

    // The first attempt happened before the death and left nothing behind; the second found the
    // contact already cancelled.
    expect(run.attempts.filter((attempt) => attempt.sequence === 5)).toHaveLength(1);
    expect(sequencesOf(run.report.dispatched)).toEqual([1, 2, 3, 4]);
    expect(stateOf(run, 5)).toBe("cancelled");
    expect(run.refusals).toContainEqual({ step: "sendable", sequence: 5, reason: "not-sendable" });
  });

  it("does not send when the death lands while the contact is already processing", async () => {
    const run = await driveTwelveMonthSimulation(
      simulationInput({
        events: [
          {
            when: { type: "duringDispatchOf", sequence: 5 },
            action: { type: "hospitalStatus", event: { type: "death", recordedAt: MONTH_3_AT } },
          },
        ],
      }),
    );

    expect(sequencesOf(run.report.dispatched)).toEqual([1, 2, 3, 4]);
    expect(stateOf(run, 5)).toBe("cancelled");

    // The death cancelled the contact under the dispatcher, so the send is refused on the version
    // it stated rather than on terminality. Both guards are load-bearing, so prove the second one
    // too: a dispatcher that re-read the contact and tried again with the fresh version is still
    // refused, and by name.
    expect(run.refusals).toContainEqual({
      step: "recordContactSent",
      sequence: 5,
      reason: "stale-version",
    });

    const contact = run.contacts[4];
    const retried = await run.store.recordContactSent(
      { planId: PLAN_ID, contactId: contact.contact.id, expectedContactVersion: contact.contact.version },
      { actor: DISPATCHER, idempotencyKey: idempotencyKey("post-death-retry") },
    );
    expect(retried).toEqual({ ok: false, reason: "contact-terminal" });

    const sentEvents = allowedEventsFor(run.report.auditEvents, contact).filter(
      (event) => event.action === "recordContactSent",
    );
    expect(sentEvents).toEqual([]);
  });

  it("is not undone by a correction: the episode stays cancelled and nothing resumes", async () => {
    const run = await driveTwelveMonthSimulation(
      simulationInput({
        events: [
          deathAt(MONTH_3_AT),
          {
            when: { type: "at", instant: sendInstant("2026-06-20") },
            action: { type: "hospitalStatus", event: { type: "deathCorrection" } },
          },
        ],
      }),
    );

    expect(sequencesOf(run.report.dispatched)).toEqual([1, 2, 3, 4]);
    const record = await run.store.getPlan(PLAN_ID, { actor: COORDINATOR });
    expect(record?.plan.state).toBe("cancelled");
    expect(await run.store.listSendableContacts(PLAN_ID, { actor: COORDINATOR })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 8. Concurrent pause during dispatch
// ---------------------------------------------------------------------------

describe("scenario 8: a pause landing mid-dispatch produces exactly one outcome", () => {
  const events: readonly SimulationEvent[] = [
    { when: { type: "duringDispatchOf", sequence: 4 }, action: { type: "pause" } },
  ];

  it("records the in-flight contact once and never twice", async () => {
    const run = await driveTwelveMonthSimulation(simulationInput({ events }));

    expect(run.report.dispatched.filter((contact) => contact.sequence === 4)).toHaveLength(1);
    expect(stateOf(run, 4)).toBe("delivered");

    const contact = run.contacts[3];
    const actions = allowedEventsFor(run.report.auditEvents, contact).map((event) => event.action);
    expect(actions).toEqual(["startContactDispatch", "recordContactSent", "recordContactProviderStatus"]);
    expect(actions.filter((action) => action === "recordContactSent")).toHaveLength(1);

    // One attempt, one send: the pause did not push the contact back onto the queue.
    expect(run.attempts.filter((attempt) => attempt.sequence === 4)).toHaveLength(1);
  });

  it("stops every later contact, because the pause did take effect", async () => {
    const run = await driveTwelveMonthSimulation(simulationInput({ events }));

    expect(sequencesOf(run.report.dispatched)).toEqual([1, 2, 3, 4]);
    expect(sequencesOf(run.report.missed)).toEqual([5, 6, 7, 8, 9, 10]);
    const record = await run.store.getPlan(PLAN_ID, { actor: COORDINATOR });
    expect(record?.plan.state).toBe("paused");
  });
});

// ---------------------------------------------------------------------------
// 9. Clock jitter
// ---------------------------------------------------------------------------

describe("scenario 9: a perturbed clock produces identical dispatch days", () => {
  it("dispatches on the same days at -5, 0 and +5 minutes of skew", async () => {
    const runs = await Promise.all(
      [-5, 0, 5].map((clockSkewMinutes) => driveTwelveMonthSimulation(simulationInput({ clockSkewMinutes }))),
    );

    const [behind, exact, ahead] = runs;

    for (const run of runs) {
      expect(daysOf(run.report.dispatched)).toEqual(EXPECTED_CALENDAR);
      expect(sequencesOf(run.report.dispatched)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    }

    // The audit timestamps are real clock reads, so they are what the skew actually moved. Their
    // AWST calendar days must still be identical...
    const sentDays = (run: SimulationRun) =>
      run.report.auditEvents
        .filter((event) => event.action === "recordContactSent" && event.outcome === "allowed")
        .map((event) => event.timestamp.slice(0, 10));

    expect(sentDays(behind)).toEqual(EXPECTED_CALENDAR);
    expect(sentDays(exact)).toEqual(EXPECTED_CALENDAR);
    expect(sentDays(ahead)).toEqual(EXPECTED_CALENDAR);

    // ...and the skew must genuinely have moved the clock, or this test proves nothing.
    const firstSent = (run: SimulationRun) =>
      run.report.auditEvents.find((event) => event.action === "recordContactSent" && event.outcome === "allowed")
        ?.timestamp;
    expect(firstSent(behind)).not.toEqual(firstSent(exact));
    expect(firstSent(ahead)).not.toEqual(firstSent(exact));
  });

  it("is byte-identical between two runs of the same input", async () => {
    const first = await runTwelveMonthSimulation(simulationInput());
    const second = await runTwelveMonthSimulation(simulationInput());

    expect(JSON.stringify(second)).toEqual(JSON.stringify(first));
  });
});

// ---------------------------------------------------------------------------
// 10. Audit completeness
// ---------------------------------------------------------------------------

describe("scenario 10: every state change has exactly one audit event, carrying no patient data", () => {
  /** A run that exercises dispatch, retry, a miss, a pause, a resume and a withdrawal. */
  const busyInput = () =>
    simulationInput({
      transport: scriptedTransport({ 3: ["transient", "delivered"], 6: ["transient", "transient", "transient"] }),
      events: [
        { when: { type: "at", instant: MONTH_2_AT }, action: { type: "pause" } },
        { when: { type: "at", instant: sendInstant("2026-05-20") }, action: { type: "resume" } },
        {
          when: { type: "at", instant: sendInstant("2026-10-01") },
          action: { type: "withdraw", origin: "clinician" },
        },
      ],
    });

  it("accounts for every contact version bump with exactly one allowed audit event", async () => {
    const run = await driveTwelveMonthSimulation(busyInput());

    for (const entry of run.contacts) {
      // A cancellation is applied by the plan-level write that caused it, and that write carries
      // its own single audit event -- so it is the one version bump with no contact-level event.
      const planLevelBumps = entry.contact.state === "cancelled" ? 1 : 0;
      const contactLevelChanges = entry.contact.version - 1 - planLevelBumps;
      expect(allowedEventsFor(run.report.auditEvents, entry)).toHaveLength(contactLevelChanges);
    }
  });

  it("appends exactly one audit event per write, with no key used twice", async () => {
    const run = await driveTwelveMonthSimulation(busyInput());
    const keys = run.report.auditEvents.map((event) => event.idempotencyKey);

    expect(new Set(keys).size).toBe(keys.length);
    expect(run.report.auditEvents.length).toBeGreaterThan(20);
    for (const event of run.report.auditEvents) {
      expect(["allowed", "denied", "failed"]).toContain(event.outcome);
      expect(["plan", "contact"]).toContain(event.objectType);
      expect(event.teamId).toBe(TEAM);
    }
  });

  it("accounts for every plan state change too", async () => {
    const run = await driveTwelveMonthSimulation(busyInput());
    const record = await run.store.getPlan(PLAN_ID, { actor: COORDINATOR });
    const planEvents = run.report.auditEvents.filter(
      (event) => event.objectType === "plan" && event.outcome === "allowed",
    );

    // createPlan sets version 1; every later accepted plan write adds exactly one.
    expect(planEvents).toHaveLength((record?.plan.version ?? 0) - 1 + 1);
    expect(planEvents.map((event) => event.action)).toEqual([
      "createPlan",
      "activatePlan",
      "pausePlan",
      "resumePlan",
      "withdrawPlan",
    ]);
  });

  it("carries no mobile number, no message body and no patient name", async () => {
    const run = await driveTwelveMonthSimulation(busyInput());
    const serialised = JSON.stringify(run.report.auditEvents);

    expect(run.report.auditEvents.length).toBeGreaterThan(0);
    expect(serialised).not.toContain("491 570 156");
    expect(serialised).not.toContain("491570156");
    expect(serialised).not.toContain("Jordan");
    expect(serialised).not.toContain("UR-00219384");
    expect(serialised).not.toContain(PROVISIONAL_MESSAGE_RULES.programmeLine);
    expect(serialised).not.toContain(PROVISIONAL_MESSAGE_RULES.crisisSupportContact);

    // ...and the domain's own guard agrees, field by field, on every event.
    for (const event of run.report.auditEvents) {
      expect(() => assertAuditEventFreeOfPatientData(event as unknown as Record<string, unknown>)).not.toThrow();
    }
  });
});

// ---------------------------------------------------------------------------
// Suppression, end to end
// ---------------------------------------------------------------------------

describe("suppression: the collision case sends nine, not ten", () => {
  const collisionInput = () =>
    simulationInput({
      plan: planInput({
        firstContactDate: "2026-03-09",
        firstContactReason: "Patient asked to start after the weekend",
      }),
    });

  it("absorbs Week 1 into the first contact and dispatches exactly nine", async () => {
    const run = await driveTwelveMonthSimulation(collisionInput());

    expect(run.report.dispatched).toHaveLength(9);
    expect(run.report.suppressed).toHaveLength(1);
    expect(run.report.suppressed[0].cadenceLabel).toBe("Week 1");
    expect(run.report.suppressed[0].suppressed).toEqual({ reason: "absorbedByFirstContact" });
    expect(run.report.missed).toEqual([]);
  });

  it("never dispatches the suppressed contact, even though it carries a real sendAt", async () => {
    const run = await driveTwelveMonthSimulation(collisionInput());
    const absorbed = run.contacts.find((entry) => entry.planned.suppressed !== undefined);

    expect(absorbed).toBeDefined();
    if (!absorbed) return;
    expect(absorbed.planned.sendAt.getTime()).toBeGreaterThan(0);
    expect(absorbed.contact.state).toBe("suppressed");
    expect(sequencesOf(run.report.dispatched)).not.toContain(absorbed.planned.sequence);
    expect(run.attempts.some((attempt) => attempt.sequence === absorbed.planned.sequence)).toBe(false);
    expect(allowedEventsFor(run.report.auditEvents, absorbed)).toEqual([]);
  });

  it("puts no two caring contacts on one day", async () => {
    const run = await driveTwelveMonthSimulation(collisionInput());
    const days = daysOf(run.report.dispatched);

    expect(new Set(days).size).toBe(days.length);
    // The first contact and the absorbed Week 1 really did land on the same day -- which is the
    // whole reason the absorbed one must never be sent.
    expect(run.report.dispatched[0].calendarDay).toBe("2026-03-09");
    expect(run.report.suppressed[0].calendarDay).toBe("2026-03-09");
  });
});
