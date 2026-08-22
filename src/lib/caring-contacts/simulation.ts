// src/lib/caring-contacts/simulation.ts
//
// A deterministic twelve-month driver over the caring-contact domain.
//
// This module holds NO rules. Every decision that matters -- who may write what, whether a contact
// may still go out, what a death does, whether a plan may move -- is made by ./permissions,
// ./model, ./hospital-events, ./schedule and the store. The driver's whole job is to walk a
// timeline, ask, and record the answer. Where it appears to decide something, it is reading a
// value that another module owns:
//
//   * what may be sent          -> the store's `listSendableContacts`, which keys off contact
//                                  state and never off `sendAt`. A suppressed contact is stored
//                                  terminal, so it cannot appear there at all;
//   * whether a send is on time -> `isWithinApprovedSendWindow` from ./schedule, plus the
//                                  contact's own calendar day, so a retry can never roll into a
//                                  later day and be sent late;
//   * whether a send may happen -> the store refuses; the driver does not pre-empt it.
//
// The retry policy used to be a required caller input, because no module owned one. It now has a
// governed home in ./service-rules, so `retryPolicy` is OPTIONAL and defaults to
// DEFAULT_CONTACT_RETRY_POLICY. The driver still invents nothing -- it reads a value another
// module owns, which is the same discipline, with the value somewhere a service owner can find it.
//
// Determinism: the only clock is the simulated one below, and the only source of provider
// behaviour is the caller's `transport`. The same input always produces the same report.
import type { AuditEvent } from "./audit";
import type { Clock } from "./clock";
import { awstCalendarDay } from "./clock";
import type { HospitalStatusEvent, WithdrawalOrigin } from "./hospital-events";
import { idempotencyKey } from "./ids";
import type { PathwayVersionId, PatientId, PlanId, ReferralId } from "./ids";
import type { ProviderStatus, SendingPreference, TransitionResult } from "./model";
import { DEFAULT_CONTACT_RETRY_POLICY, type ContactRetryPolicy } from "./service-rules";
import { createInMemoryRepository } from "./in-memory-repository";
import type { Actor, SystemActor } from "./permissions";
import type { CaringContactRepository, EpisodePatientDetail, StoredContact, WriteContext } from "./repository";
import { isWithinApprovedSendWindow, type PlannedContact } from "./schedule";

/**
 * How many times a transient provider failure may be retried, and how far apart.
 *
 * The type is ./service-rules' own, re-exported unchanged so existing callers keep resolving. This
 * is a relocation, not a second policy shape.
 */
export type RetryPolicy = ContactRetryPolicy;

export type TransportAttempt = {
  sequence: number;
  cadenceLabel: string;
  attempt: number;
  /** The simulated instant of this attempt, already carrying any clock skew. */
  at: Date;
};

/**
 * What the provider would do for one attempt. `transientFailure` means nothing left: the contact
 * is untouched in the store and stays `scheduled`, which is the only state the contact lifecycle
 * lets a caller later mark `missed` from.
 */
export type TransportOutcome = { type: "sent"; status: ProviderStatus } | { type: "transientFailure" };

export type Transport = (attempt: TransportAttempt) => TransportOutcome;

export type SimulationAction =
  | { type: "pause" }
  | { type: "resume" }
  | { type: "withdraw"; origin: WithdrawalOrigin }
  | { type: "hospitalStatus"; event: HospitalStatusEvent };

/**
 * When an event lands. `duringDispatchOf` is the honest single-threaded expression of "concurrent":
 * the event is applied after the store has moved the contact to `processing` and before the send is
 * recorded -- the exact interleaving in which a duplicate send would be produced by a driver that
 * re-queued the contact.
 */
export type SimulationWhen = { type: "at"; instant: Date } | { type: "duringDispatchOf"; sequence: number };

export type SimulationEvent = { when: SimulationWhen; action: SimulationAction };

export type SimulationPlanInput = {
  planId: PlanId;
  referralId: ReferralId;
  patientId: PatientId;
  pathwayVersionId: PathwayVersionId;
  dischargeAt: Date;
  sendingPreference: SendingPreference;
  firstContactDate?: string;
  firstContactReason?: string;
  patientDetail: EpisodePatientDetail;
};

export type SimulationInput = {
  plan: SimulationPlanInput;
  /** Performs the plan lifecycle writes and the reads the driver needs. */
  coordinator: Actor;
  /** Writes contact status. A human actor is refused these writes by ./permissions. */
  dispatcher: SystemActor;
  /** Reads the audit trail for the report; holds no other capability. */
  auditor: Actor;
  /** Defaults to DEFAULT_CONTACT_RETRY_POLICY. Override only to model a different service rule. */
  retryPolicy?: RetryPolicy;
  events?: readonly SimulationEvent[];
  /** Defaults to a provider that accepts and delivers every message on the first attempt. */
  transport?: Transport;
  /** Perturbs every instant the driver acts at, in minutes. Used to prove clock insensitivity. */
  clockSkewMinutes?: number;
};

export type SimulationReport = {
  /** Contacts that actually went out, in dispatch order. */
  dispatched: PlannedContact[];
  /** Sendable contacts that did not go out: a closed window, a paused plan, a withdrawal, a death. */
  missed: PlannedContact[];
  /** Contacts absorbed by the first contact. They carry a real `sendAt` and are never sent. */
  suppressed: PlannedContact[];
  auditEvents: AuditEvent[];
};

/** One recorded refusal. Kept so a test can name why a contact did not go out. */
export type SimulationRefusal = { step: string; sequence: number | null; reason: string };

export type SimulationRun = {
  report: SimulationReport;
  /** The store the run was driven against, so a caller can inspect or re-attack it. */
  store: CaringContactRepository;
  /** Every stored contact at the end of the run, in schedule order. */
  contacts: StoredContact[];
  /** Every provider attempt, in order. A fourth attempt under a cap of three would appear here. */
  attempts: TransportAttempt[];
  refusals: SimulationRefusal[];
};

const DEFAULT_TRANSPORT: Transport = () => ({ type: "sent", status: "delivered" });
const MILLISECONDS_PER_MINUTE = 60_000;

function bySendAt(a: StoredContact, b: StoredContact): number {
  return a.planned.sendAt.getTime() - b.planned.sendAt.getTime();
}

function byInstant(a: SimulationEvent, b: SimulationEvent): number {
  const left = a.when.type === "at" ? a.when.instant.getTime() : 0;
  const right = b.when.type === "at" ? b.when.instant.getTime() : 0;
  return left - right;
}

function reasonOf(result: TransitionResult<unknown>): string {
  return result.ok ? "" : result.reason;
}

/**
 * Drives one twelve-month episode and returns the report together with the store it ran against.
 * Throws only when the run could not be set up at all (the plan could not be created or activated);
 * every domain refusal after that is data in `refusals`, not an exception.
 */
export async function driveTwelveMonthSimulation(input: SimulationInput): Promise<SimulationRun> {
  const skewMs = (input.clockSkewMinutes ?? 0) * MILLISECONDS_PER_MINUTE;
  const transport = input.transport ?? DEFAULT_TRANSPORT;
  const retryPolicy = input.retryPolicy ?? DEFAULT_CONTACT_RETRY_POLICY;
  const attempts: TransportAttempt[] = [];
  const refusals: SimulationRefusal[] = [];

  let current = new Date(input.plan.dischargeAt.getTime() + skewMs);
  const clock: Clock = { now: () => new Date(current.getTime()) };
  const advanceTo = (instant: Date): void => {
    const next = instant.getTime() + skewMs;
    if (next > current.getTime()) current = new Date(next);
  };

  const store = createInMemoryRepository(clock);
  const { planId } = input.plan;

  // Deterministic, never-reused keys. Reuse would be refused by the store, so a driver bug that
  // repeated a write shows up as a refusal rather than as a silent second send.
  let writes = 0;
  const nextKey = (label: string) => idempotencyKey(`sim-${String((writes += 1)).padStart(4, "0")}-${label}`);
  const asCoordinator = (label: string): WriteContext => ({
    actor: input.coordinator,
    idempotencyKey: nextKey(label),
  });
  const asDispatcher = (label: string): WriteContext => ({
    actor: input.dispatcher,
    idempotencyKey: nextKey(label),
  });

  const created = await store.createPlan(
    {
      planId,
      referralId: input.plan.referralId,
      patientId: input.plan.patientId,
      pathwayVersionId: input.plan.pathwayVersionId,
      dischargeAt: input.plan.dischargeAt,
      sendingPreference: input.plan.sendingPreference,
      firstContactDate: input.plan.firstContactDate,
      firstContactReason: input.plan.firstContactReason,
      patientDetail: input.plan.patientDetail,
    },
    asCoordinator("create"),
  );
  if (!created.ok) throw new Error(`simulation could not create the plan: ${created.reason}`);

  const activated = await store.activatePlan(
    { planId, expectedVersion: created.value.plan.version },
    asCoordinator("activate"),
  );
  if (!activated.ok) throw new Error(`simulation could not activate the plan: ${activated.reason}`);

  async function planVersion(): Promise<number | null> {
    const record = await store.getPlan(planId, { actor: input.coordinator });
    return record ? record.plan.version : null;
  }

  async function applyAction(action: SimulationAction, sequence: number | null): Promise<void> {
    const expectedVersion = await planVersion();
    if (expectedVersion === null) {
      refusals.push({ step: action.type, sequence, reason: "not-found" });
      return;
    }
    const result =
      action.type === "pause"
        ? await store.pausePlan({ planId, expectedVersion }, asCoordinator("pause"))
        : action.type === "resume"
          ? await store.resumePlan({ planId, expectedVersion }, asCoordinator("resume"))
          : action.type === "withdraw"
            ? await store.withdrawPlan({ planId, expectedVersion, origin: action.origin }, asCoordinator("withdraw"))
            : await store.recordHospitalStatusEvent(
                { planId, expectedVersion, event: action.event },
                asCoordinator(`hospital-${action.event.type}`),
              );
    if (!result.ok) refusals.push({ step: action.type, sequence, reason: reasonOf(result) });
  }

  const timedEvents = [...(input.events ?? [])].filter((event) => event.when.type === "at").sort(byInstant);
  const interleavedEvents = (input.events ?? []).filter((event) => event.when.type === "duringDispatchOf");
  let nextTimedEvent = 0;

  /** Applies every timed event due at or before `boundary`, moving the clock to each in turn. */
  async function applyTimedEventsUpTo(boundary: Date): Promise<void> {
    while (nextTimedEvent < timedEvents.length) {
      const event = timedEvents[nextTimedEvent];
      if (event.when.type !== "at") break;
      if (event.when.instant.getTime() > boundary.getTime()) break;
      nextTimedEvent += 1;
      advanceTo(event.when.instant);
      await applyAction(event.action, null);
    }
  }

  async function applyInterleavedEvents(sequence: number): Promise<void> {
    for (const event of interleavedEvents) {
      if (event.when.type !== "duringDispatchOf" || event.when.sequence !== sequence) continue;
      await applyAction(event.action, sequence);
    }
  }

  const schedule = (await store.listContacts(planId, { actor: input.coordinator })).sort(bySendAt);

  const dispatched: PlannedContact[] = [];
  const missed: PlannedContact[] = [];
  const suppressed: PlannedContact[] = [];

  for (const entry of schedule) {
    const { planned } = entry;

    await applyTimedEventsUpTo(planned.sendAt);

    let wentOut = false;

    for (let attempt = 1; attempt <= retryPolicy.maxAttempts; attempt += 1) {
      const at = new Date(
        planned.sendAt.getTime() + (attempt - 1) * retryPolicy.retryIntervalMinutes * MILLISECONDS_PER_MINUTE,
      );
      advanceTo(at);

      // Events land between retry attempts too, not only between contacts. A death recorded while
      // a contact is mid-retry must reach the store before the next attempt asks whether that
      // contact may still go out.
      await applyTimedEventsUpTo(current);

      // The original window, on the contact's own day. A retry that would land outside it is
      // abandoned rather than sent late -- the day check is what stops a retry rolling over
      // midnight into the next day's window.
      if (!isWithinApprovedSendWindow(current) || awstCalendarDay(current) !== planned.calendarDay) {
        refusals.push({ step: "window", sequence: planned.sequence, reason: "outside-approved-send-window" });
        break;
      }

      const sendable = await store.listSendableContacts(planId, { actor: input.coordinator });
      const live = sendable.find((candidate) => candidate.contact.id === entry.contact.id);
      if (!live) {
        refusals.push({ step: "sendable", sequence: planned.sequence, reason: "not-sendable" });
        break;
      }

      const probe: TransportAttempt = {
        sequence: planned.sequence,
        cadenceLabel: planned.cadenceLabel,
        attempt,
        at: new Date(current.getTime()),
      };
      attempts.push(probe);
      const outcome = transport(probe);
      if (outcome.type === "transientFailure") continue;

      const started = await store.startContactDispatch(
        { planId, contactId: live.contact.id, expectedContactVersion: live.contact.version },
        asDispatcher(`start-${planned.sequence}`),
      );
      if (!started.ok) {
        refusals.push({ step: "startContactDispatch", sequence: planned.sequence, reason: reasonOf(started) });
        break;
      }

      await applyInterleavedEvents(planned.sequence);

      const sent = await store.recordContactSent(
        {
          planId,
          contactId: live.contact.id,
          expectedContactVersion: started.value.contact.version,
        },
        asDispatcher(`sent-${planned.sequence}`),
      );
      if (!sent.ok) {
        refusals.push({ step: "recordContactSent", sequence: planned.sequence, reason: reasonOf(sent) });
        break;
      }

      const status = await store.recordContactProviderStatus(
        {
          planId,
          contactId: live.contact.id,
          expectedContactVersion: sent.value.contact.version,
          status: outcome.status,
        },
        asDispatcher(`status-${planned.sequence}`),
      );
      if (!status.ok) {
        refusals.push({ step: "recordContactProviderStatus", sequence: planned.sequence, reason: reasonOf(status) });
      }

      dispatched.push(planned);
      wentOut = true;
      break;
    }

    if (wentOut) continue;

    // Classification, not a dispatch decision. The decision of what may be sent was made above by
    // the store's sendable list, which is the only thing standing between an absorbed contact and
    // a second caring contact on one day -- so this driver deliberately does NOT pre-filter on
    // `planned.suppressed`. If the store ever offered an absorbed contact, it would be dispatched
    // here and the suppression tests would go red, which is the point.
    if (planned.suppressed !== undefined) {
      suppressed.push(planned);
      continue;
    }

    missed.push(planned);

    // Recorded as missed only while the contact is still scheduled. A contact the store already
    // moved (cancelled by a death or a withdrawal) carries its own record of that, and asking for
    // a second one would be a refusal, not a fact.
    const stillScheduled = (await store.listContacts(planId, { actor: input.coordinator })).find(
      (candidate) => candidate.contact.id === entry.contact.id && candidate.contact.state === "scheduled",
    );
    if (stillScheduled) {
      const marked = await store.recordContactMissed(
        {
          planId,
          contactId: stillScheduled.contact.id,
          expectedContactVersion: stillScheduled.contact.version,
        },
        asDispatcher(`missed-${planned.sequence}`),
      );
      if (!marked.ok) {
        refusals.push({ step: "recordContactMissed", sequence: planned.sequence, reason: reasonOf(marked) });
      }
    }
  }

  // Anything scheduled after the last contact still has to happen.
  await applyTimedEventsUpTo(new Date(8_640_000_000_000_000));

  const contacts = (await store.listContacts(planId, { actor: input.coordinator })).sort(bySendAt);
  const auditEvents = await store.listAuditEvents({ actor: input.auditor });

  return {
    report: { dispatched, missed, suppressed, auditEvents },
    store,
    contacts,
    attempts,
    refusals,
  };
}

/** The twelve-month simulation. See `driveTwelveMonthSimulation` for the store and the attempts. */
export async function runTwelveMonthSimulation(input: SimulationInput): Promise<SimulationReport> {
  return (await driveTwelveMonthSimulation(input)).report;
}
