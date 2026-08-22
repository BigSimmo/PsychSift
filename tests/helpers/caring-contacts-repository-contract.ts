// tests/helpers/caring-contacts-repository-contract.ts
//
// The behaviour every caring-contact store must show, written once and run against each
// implementation. Task 9 runs it against the in-memory store; Task 11 runs this same function
// against the Postgres store rather than writing a second suite, which is why it takes a factory
// instead of calling a constructor.
//
// Not named *.test.ts on purpose: the vitest node project collects `tests/**/*.test.ts`, so a
// suite living here is registered only by the thin file that calls this function.
import { describe, expect, it } from "vitest";

import { AuditEventContainsPatientDataError, type AuditEvent } from "@/lib/caring-contacts/audit";
import { fixedClock, type Clock } from "@/lib/caring-contacts/clock";
import {
  actorId,
  idempotencyKey,
  pathwayVersionId,
  patientId,
  planId,
  referralId,
  teamId,
} from "@/lib/caring-contacts/ids";
import type { PathwayVersion } from "@/lib/caring-contacts/pathway-versions";
import type { Actor, CaringContactActor, CaringContactRole, SystemActor } from "@/lib/caring-contacts/permissions";
import {
  REPOSITORY_REFUSALS,
  type AuditSink,
  type CaringContactRepository,
  type CaringContactRepositoryFactory,
  type CreatePlanInput,
  type EpisodePatientDetail,
  type PlanRecord,
  type WriteContext,
} from "@/lib/caring-contacts/repository";
import { DEFAULT_RETENTION_POLICY, deidentifyEpisode, isDueForDeidentification } from "@/lib/caring-contacts/retention";

const TEAM_A = teamId("TEAM-NORTH");

const PLAN_ID = planId("PLAN-1");
const PATIENT_ID = patientId("PATIENT-1");
const REFERRAL_ID = referralId("REFERRAL-1");
const PATHWAY_VERSION_ID = pathwayVersionId("PATHWAY-1");

/** 2026-03-02 10:00 AWST. */
const DISCHARGE_AT = new Date("2026-03-02T02:00:00.000Z");
const NOW = "2026-03-02T03:00:00.000Z";

function actorWith(id: string, team: string, roles: readonly CaringContactRole[]): Actor {
  return { id: actorId(id), teamId: teamId(team), roles };
}

const COORDINATOR_A = actorWith("ACTOR-1", "TEAM-NORTH", ["coordinator"]);
const TEAM_LEAD_A = actorWith("ACTOR-2", "TEAM-NORTH", ["teamLead"]);
const AUDITOR_A = actorWith("ACTOR-3", "TEAM-NORTH", ["auditor"]);
const COORDINATOR_B = actorWith("ACTOR-4", "TEAM-SOUTH", ["coordinator"]);
const ROLELESS_A = actorWith("ACTOR-5", "TEAM-NORTH", []);

/** The non-human actor that writes contact status. It holds no human capability at all. */
const DISPATCHER_A: SystemActor = {
  id: actorId("SYSTEM-DISPATCHER"),
  teamId: teamId("TEAM-NORTH"),
  systemRole: "contactDispatcher",
};

const PATIENT_DETAIL: EpisodePatientDetail = {
  patientName: "Jordan Nguyen",
  patientMobileNumber: "+61 491 570 156",
  patientIdentifiers: ["UR-00219384"],
  culturalIdentity: null,
};

/**
 * A SECOND team lead, and the two Phase 2 governance seats. The three-person restart needs three
 * distinct actors drawn from the roles that hold `approveServiceRestart`, and dual pathway approval
 * needs the two approver seats -- neither is reachable from the five fixtures above.
 */
const SECOND_TEAM_LEAD_A = actorWith("ACTOR-7", "TEAM-NORTH", ["teamLead"]);

/**
 * A team lead in the OTHER team. Restart approvals are deliberately service-wide, so this actor
 * legitimately approves an incident that another team reported -- which is the only way to ask
 * whether `approveServiceRestart` hands a cross-team approver the reporting team's incident note.
 */
const TEAM_LEAD_B = actorWith("ACTOR-11", "TEAM-SOUTH", ["teamLead"]);
const PROGRAMME_LEAD_A = actorWith("ACTOR-8", "TEAM-NORTH", ["clinicalProgrammeLead"]);
const LIVED_EXPERIENCE_A = actorWith("ACTOR-9", "TEAM-NORTH", ["livedExperienceRepresentative"]);

/**
 * A clock that never returns the same instant twice.
 *
 * Every other fixture here uses `fixedClock`, which makes two reads of the clock indistinguishable
 * from one -- so a store that stamps a domain value from one read and persists another read of its
 * own looks correct under all of them. This is the fixture that can tell those apart.
 */
function advancingClock(startIso: string, stepMs = 1_000): Clock {
  const start = new Date(startIso).getTime();
  let reads = 0;
  return {
    now() {
      reads += 1;
      return new Date(start + reads * stepMs);
    },
  };
}

function writeContext(actor: CaringContactActor, key: string): WriteContext {
  return { actor, idempotencyKey: idempotencyKey(key) };
}

let extensionSequence = 0;

/** A fresh unapproved draft carrying synthetic wording. No real clinical text lives in a fixture. */
function draftPathwayVersion(author: Actor = COORDINATOR_A, id?: string): PathwayVersion {
  extensionSequence += 1;
  return {
    id: pathwayVersionId(id ?? `EXT-PATHWAY-${extensionSequence}`),
    teamId: author.teamId,
    state: "draft",
    authorId: author.id,
    approvals: [],
    publishedAt: null,
    retiredAt: null,
    retirementUrgency: null,
    snapshot: {
      cadenceLabels: ["Day 3"],
      messageTextByType: { standard: "Checking in.", first: "Welcome.", closing: "This is our last message." },
    },
  };
}

/**
 * The referral and pathway version `createInput` names, created through the REPOSITORY.
 *
 * They are not seeded around the store. `plans.referral_id` and `plans.pathway_version_id` are
 * same-team foreign keys in the Postgres schema, so a plan naming a parent nobody created is
 * refused by the database -- and a harness that pre-created them out of band would leave the two
 * contract runs starting from different preconditions, with neither run proving the store validates
 * its own parents.
 *
 * It appends audit events of its own, so a test that counts the trail takes its baseline AFTER
 * calling this rather than assuming an empty one.
 */
async function createPlanParents(
  store: CaringContactRepository,
  actor: Actor,
  options: { referralIds?: readonly string[]; pathwayVersionIds?: readonly string[]; keyPrefix?: string } = {},
): Promise<void> {
  const prefix = options.keyPrefix ?? "key-parents";
  for (const id of options.referralIds ?? ["REFERRAL-1", "REFERRAL-2"]) {
    unwrap(
      await store.createReferral(
        { referralId: referralId(id), patientId: patientId(`${id}-PATIENT`) },
        writeContext(actor, `${prefix}-${id}`),
      ),
    );
  }
  for (const id of options.pathwayVersionIds ?? ["PATHWAY-1"]) {
    unwrap(
      await store.savePathwayVersion(
        { version: draftPathwayVersion(actor, id) },
        writeContext(actor, `${prefix}-${id}`),
      ),
    );
  }
}

let extensionPlanSequence = 0;

/**
 * One plan already moved to `active`, on a fresh plan and patient identifier each call -- and built
 * entirely through the repository, including the referral and the pathway version it names.
 *
 * The parents go through `createReferral` and `savePathwayVersion` rather than being seeded around
 * the store because `plans.referral_id` and `plans.pathway_version_id` are same-team foreign keys in
 * the Postgres schema: a plan naming a parent nobody created is refused by the database. Creating
 * them here is what lets these tests prove the store validates its own parents.
 */
async function createActivePlan(store: CaringContactRepository, options: { actor?: Actor } = {}): Promise<PlanRecord> {
  extensionPlanSequence += 1;
  const suffix = String(extensionPlanSequence);
  const actor = options.actor ?? COORDINATOR_A;
  const referral = referralId(`EXT-REFERRAL-${suffix}`);
  const pathway = `EXT-PATHWAY-PLAN-${suffix}`;
  const patient = patientId(`EXT-PATIENT-${suffix}`);

  unwrap(
    await store.createReferral(
      { referralId: referral, patientId: patient },
      writeContext(actor, `ext-referral-${suffix}`),
    ),
  );
  unwrap(
    await store.savePathwayVersion(
      { version: draftPathwayVersion(actor, pathway) },
      writeContext(actor, `ext-pathway-${suffix}`),
    ),
  );

  const created = unwrap(
    await store.createPlan(
      {
        planId: planId(`EXT-PLAN-${suffix}`),
        referralId: referral,
        patientId: patient,
        pathwayVersionId: pathwayVersionId(pathway),
        dischargeAt: DISCHARGE_AT,
        sendingPreference: "morning",
        patientDetail: PATIENT_DETAIL,
      },
      writeContext(actor, `ext-create-${suffix}`),
    ),
  );

  return unwrap(
    await store.activatePlan(
      { planId: created.plan.id, expectedVersion: created.plan.version },
      writeContext(actor, `ext-activate-${suffix}`),
    ),
  );
}

function createInput(overrides: Partial<CreatePlanInput> = {}): CreatePlanInput {
  return {
    planId: PLAN_ID,
    referralId: REFERRAL_ID,
    patientId: PATIENT_ID,
    pathwayVersionId: PATHWAY_VERSION_ID,
    dischargeAt: DISCHARGE_AT,
    sendingPreference: "morning",
    patientDetail: PATIENT_DETAIL,
    ...overrides,
  };
}

/** A sink that can be switched to failing mid-suite, so a write can be broken part-way through. */
function togglableAuditSink(): AuditSink & { failNext: boolean; recorded: AuditEvent[] } {
  const sink = {
    failNext: false,
    recorded: [] as AuditEvent[],
    record(event: AuditEvent) {
      if (sink.failNext) throw new Error("audit-sink-unavailable");
      sink.recorded.push(event);
    },
  };
  return sink;
}

function unwrap<T>(result: { ok: true; value: T } | { ok: false; reason: string }): T {
  if (!result.ok) throw new Error(`expected an accepted write, got refusal "${result.reason}"`);
  return result.value;
}

export function describeCaringContactRepositoryContract(label: string, factory: CaringContactRepositoryFactory): void {
  describe(`CaringContactRepository contract (${label})`, () => {
    const clock: Clock = fixedClock(NOW);

    async function newStore(auditSink?: AuditSink): Promise<CaringContactRepository> {
      return await factory(clock, auditSink ? { auditSink } : undefined);
    }

    /** A store holding one plan already moved to `active`, i.e. version 2. */
    async function storeWithActivePlan(auditSink?: AuditSink) {
      const store = await newStore(auditSink);
      await createPlanParents(store, COORDINATOR_A);
      const created = unwrap(await store.createPlan(createInput(), writeContext(COORDINATOR_A, "key-create")));
      const activated = unwrap(
        await store.activatePlan(
          { planId: PLAN_ID, expectedVersion: created.plan.version },
          writeContext(COORDINATOR_A, "key-activate"),
        ),
      );
      return { store, activated };
    }

    async function auditTrail(store: CaringContactRepository): Promise<AuditEvent[]> {
      return await store.listAuditEvents({ actor: AUDITOR_A });
    }

    describe("rule 1 — every write is idempotent on its key", () => {
      it("replays the original created plan and stores no second plan", async () => {
        const store = await newStore();
        await createPlanParents(store, COORDINATOR_A);
        const first = await store.createPlan(createInput(), writeContext(COORDINATOR_A, "key-create"));
        const replay = await store.createPlan(createInput(), writeContext(COORDINATOR_A, "key-create"));

        expect(first.ok).toBe(true);
        expect(replay).toEqual(first);
        expect(await store.listPlans({ actor: COORDINATOR_A })).toHaveLength(1);
      });

      it("replays a pause without applying it a second time", async () => {
        const { store, activated } = await storeWithActivePlan();
        const context = writeContext(COORDINATOR_A, "key-pause");

        const first = unwrap(await store.pausePlan({ planId: PLAN_ID, expectedVersion: 2 }, context));
        const replay = await store.pausePlan({ planId: PLAN_ID, expectedVersion: 2 }, context);

        expect(activated.plan.version).toBe(2);
        expect(first.plan.version).toBe(3);
        expect(replay).toEqual({ ok: true, value: first });
        expect((await store.getPlan(PLAN_ID, { actor: COORDINATOR_A }))?.plan.version).toBe(3);
      });

      it("appends no second audit event for a replay", async () => {
        const { store } = await storeWithActivePlan();
        const context = writeContext(COORDINATOR_A, "key-pause");

        await store.pausePlan({ planId: PLAN_ID, expectedVersion: 2 }, context);
        const afterFirst = (await auditTrail(store)).length;
        await store.pausePlan({ planId: PLAN_ID, expectedVersion: 2 }, context);

        expect((await auditTrail(store)).length).toBe(afterFirst);
      });

      it("refuses a key reused for a different write", async () => {
        const { store } = await storeWithActivePlan();
        await store.pausePlan({ planId: PLAN_ID, expectedVersion: 2 }, writeContext(COORDINATOR_A, "key-shared"));

        const reused = await store.resumePlan(
          { planId: PLAN_ID, expectedVersion: 3 },
          writeContext(COORDINATOR_A, "key-shared"),
        );

        expect(reused).toEqual({ ok: false, reason: REPOSITORY_REFUSALS.idempotencyKeyReused });
        expect((await store.getPlan(PLAN_ID, { actor: COORDINATOR_A }))?.plan.state).toBe("paused");
      });

      it("scopes keys per team, so one team cannot replay another team's result", async () => {
        const store = await newStore();
        await createPlanParents(store, COORDINATOR_A);
        // The other team's plan names the other team's OWN referral and pathway version, created by
        // that team's own actor. A referral belongs to exactly one team, so two teams sharing one
        // referral id was fixture convenience rather than anything the domain allows; migration 0003
        // makes both links same-team foreign keys and refuses it outright. The assertions below are
        // unchanged -- this test is about idempotency keys being scoped per team.
        await createPlanParents(store, COORDINATOR_B, {
          referralIds: ["REFERRAL-3"],
          pathwayVersionIds: ["PATHWAY-2"],
          keyPrefix: "key-parents-south",
        });

        const mine = await store.createPlan(createInput(), writeContext(COORDINATOR_A, "key-create"));
        const theirs = await store.createPlan(
          createInput({
            planId: planId("PLAN-2"),
            patientId: patientId("PATIENT-2"),
            referralId: referralId("REFERRAL-3"),
            pathwayVersionId: pathwayVersionId("PATHWAY-2"),
          }),
          writeContext(COORDINATOR_B, "key-create"),
        );

        expect(mine.ok).toBe(true);
        expect(theirs.ok).toBe(true);
        expect(await store.listPlans({ actor: COORDINATOR_A })).toHaveLength(1);
        expect(await store.listPlans({ actor: COORDINATOR_B })).toHaveLength(1);
      });
    });

    describe("rule 2 — exactly one audit event, atomically with the change", () => {
      it("appends exactly one allowed event per accepted write", async () => {
        const store = await newStore();
        await createPlanParents(store, COORDINATOR_A);
        // Taken after the parents, whose creation is itself audited. The claim is unchanged: this
        // write appends exactly one event, and the next write appends exactly one more.
        const before = (await auditTrail(store)).length;
        await store.createPlan(createInput(), writeContext(COORDINATOR_A, "key-create"));

        const trail = await auditTrail(store);
        expect(trail).toHaveLength(before + 1);
        expect(trail[trail.length - 1]).toMatchObject({
          actorId: COORDINATOR_A.id,
          teamId: TEAM_A,
          outcome: "allowed",
          objectType: "plan",
          objectId: PLAN_ID,
          idempotencyKey: idempotencyKey("key-create"),
        });

        await store.activatePlan({ planId: PLAN_ID, expectedVersion: 1 }, writeContext(COORDINATOR_A, "key-activate"));
        expect(await auditTrail(store)).toHaveLength(before + 2);
      });

      it("appends exactly one denied event for a refused write, and changes nothing", async () => {
        const { store } = await storeWithActivePlan();
        const before = (await auditTrail(store)).length;

        const refused = await store.activatePlan(
          { planId: PLAN_ID, expectedVersion: 2 },
          writeContext(COORDINATOR_A, "key-reactivate"),
        );

        expect(refused).toEqual({ ok: false, reason: "plan-not-draft" });
        const trail = await auditTrail(store);
        expect(trail).toHaveLength(before + 1);
        expect(trail[trail.length - 1]).toMatchObject({ outcome: "denied" });
        expect((await store.getPlan(PLAN_ID, { actor: COORDINATOR_A }))?.plan.version).toBe(2);
      });

      it("leaves neither the change nor the audit event when the audit sink fails part-way", async () => {
        const sink = togglableAuditSink();
        const { store } = await storeWithActivePlan(sink);
        const trailBefore = await auditTrail(store);
        const recordedBefore = sink.recorded.length;

        sink.failNext = true;
        await expect(
          store.pausePlan({ planId: PLAN_ID, expectedVersion: 2 }, writeContext(COORDINATOR_A, "key-pause")),
        ).rejects.toThrow("audit-sink-unavailable");
        sink.failNext = false;

        const after = await store.getPlan(PLAN_ID, { actor: COORDINATOR_A });
        expect(after?.plan.state).toBe("active");
        expect(after?.plan.version).toBe(2);
        expect(await auditTrail(store)).toHaveLength(trailBefore.length);
        expect(sink.recorded).toHaveLength(recordedBefore);
      });

      it("leaves neither the change nor the audit event when the audit guard rejects the event", async () => {
        const store = await newStore();
        await createPlanParents(store, COORDINATOR_A);
        const before = await auditTrail(store);
        // An upstream identifier carrying something that reads as a mobile number. The change is
        // fully computed before the audit event is built, so this breaks the write part-way.
        const hostileId = planId("PLAN-0491 570 156");

        await expect(
          store.createPlan(createInput({ planId: hostileId }), writeContext(COORDINATOR_A, "key-create")),
        ).rejects.toThrow(/audit-event-contains-patient-data/);

        expect(await store.getPlan(hostileId, { actor: COORDINATOR_A })).toBeNull();
        expect(await store.listPlans({ actor: COORDINATOR_A })).toEqual([]);
        // Byte-identical to the trail before the failed write: it appended nothing at all.
        expect(await auditTrail(store)).toEqual(before);
      });

      it("does not consume the idempotency key when a write throws, so a retry still works", async () => {
        const sink = togglableAuditSink();
        const { store } = await storeWithActivePlan(sink);
        const context = writeContext(COORDINATOR_A, "key-pause");

        sink.failNext = true;
        await expect(store.pausePlan({ planId: PLAN_ID, expectedVersion: 2 }, context)).rejects.toThrow();
        sink.failNext = false;

        const retried = await store.pausePlan({ planId: PLAN_ID, expectedVersion: 2 }, context);
        expect(retried.ok).toBe(true);
        expect((await store.getPlan(PLAN_ID, { actor: COORDINATOR_A }))?.plan.state).toBe("paused");
      });
    });

    describe("rule 3 — optimistic concurrency", () => {
      it("refuses a write against a stale version and applies nothing", async () => {
        const { store } = await storeWithActivePlan();

        const stale = await store.pausePlan(
          { planId: PLAN_ID, expectedVersion: 1 },
          writeContext(COORDINATOR_A, "key-stale"),
        );

        expect(stale).toEqual({ ok: false, reason: REPOSITORY_REFUSALS.staleVersion });
        const after = await store.getPlan(PLAN_ID, { actor: COORDINATOR_A });
        expect(after?.plan.state).toBe("active");
        expect(after?.plan.version).toBe(2);
      });

      it("lets exactly one of two simultaneous pauses win, refusing the other with stale-version", async () => {
        const { store } = await storeWithActivePlan();

        const [first, second] = await Promise.all([
          store.pausePlan({ planId: PLAN_ID, expectedVersion: 2 }, writeContext(COORDINATOR_A, "key-pause-a")),
          store.pausePlan({ planId: PLAN_ID, expectedVersion: 2 }, writeContext(TEAM_LEAD_A, "key-pause-b")),
        ]);

        const accepted = [first, second].filter((result) => result.ok);
        const refused = [first, second].filter((result) => !result.ok);

        expect(accepted).toHaveLength(1);
        expect(refused).toEqual([{ ok: false, reason: REPOSITORY_REFUSALS.staleVersion }]);

        const after = await store.getPlan(PLAN_ID, { actor: COORDINATOR_A });
        expect(after?.plan.state).toBe("paused");
        expect(after?.plan.version).toBe(3);
      });
    });

    describe("rule 4 — one non-terminal plan per patient", () => {
      it("refuses a second plan for the same patient", async () => {
        const store = await newStore();
        await createPlanParents(store, COORDINATOR_A);
        await store.createPlan(createInput(), writeContext(COORDINATOR_A, "key-create"));

        const second = await store.createPlan(
          createInput({ planId: planId("PLAN-2"), referralId: referralId("REFERRAL-2") }),
          writeContext(COORDINATOR_A, "key-create-2"),
        );

        expect(second).toEqual({ ok: false, reason: REPOSITORY_REFUSALS.duplicateActivePlan });
        expect(await store.listPlans({ actor: COORDINATOR_A })).toHaveLength(1);
      });

      it("refuses a duplicate raised by another team too", async () => {
        const store = await newStore();
        await createPlanParents(store, COORDINATOR_A);
        await store.createPlan(createInput(), writeContext(COORDINATOR_A, "key-create"));

        const second = await store.createPlan(
          createInput({ planId: planId("PLAN-2"), referralId: referralId("REFERRAL-2") }),
          writeContext(COORDINATOR_B, "key-create-2"),
        );

        expect(second).toEqual({ ok: false, reason: REPOSITORY_REFUSALS.duplicateActivePlan });
      });

      it("allows a new plan once the previous one has ended", async () => {
        const { store } = await storeWithActivePlan();
        await store.withdrawPlan(
          { planId: PLAN_ID, expectedVersion: 2, origin: "patient" },
          writeContext(COORDINATOR_A, "key-withdraw"),
        );

        const second = await store.createPlan(
          createInput({ planId: planId("PLAN-2"), referralId: referralId("REFERRAL-2") }),
          writeContext(COORDINATOR_A, "key-create-2"),
        );

        expect(second.ok).toBe(true);
      });

      it("refuses a repeat of an identifier already used", async () => {
        const store = await newStore();
        await createPlanParents(store, COORDINATOR_A);
        await store.createPlan(createInput(), writeContext(COORDINATOR_A, "key-create"));

        const clash = await store.createPlan(
          createInput({ patientId: patientId("PATIENT-2") }),
          writeContext(COORDINATOR_A, "key-create-2"),
        );

        expect(clash).toEqual({ ok: false, reason: REPOSITORY_REFUSALS.planAlreadyExists });
      });
    });

    describe("rule 5 — reads are team-scoped and reveal nothing", () => {
      it("returns empty for every read made by an actor from another team", async () => {
        const store = await newStore();
        await createPlanParents(store, COORDINATOR_A);
        await store.createPlan(createInput(), writeContext(COORDINATOR_A, "key-create"));

        expect(await store.getPlan(PLAN_ID, { actor: COORDINATOR_B })).toBeNull();
        expect(await store.listPlans({ actor: COORDINATOR_B })).toEqual([]);
        expect(await store.listContacts(PLAN_ID, { actor: COORDINATOR_B })).toEqual([]);
        expect(await store.listSendableContacts(PLAN_ID, { actor: COORDINATOR_B })).toEqual([]);
        expect(await store.getEpisode(PLAN_ID, { actor: COORDINATOR_B })).toBeNull();
        expect(await store.listAuditEvents({ actor: actorWith("ACTOR-6", "TEAM-SOUTH", ["auditor"]) })).toEqual([]);

        expect(await store.getPlan(PLAN_ID, { actor: COORDINATOR_A })).not.toBeNull();
      });

      it("gives a cross-team write the same answer as a plan that does not exist", async () => {
        const store = await newStore();
        await createPlanParents(store, COORDINATOR_A);
        await store.createPlan(createInput(), writeContext(COORDINATOR_A, "key-create"));

        const crossTeam = await store.activatePlan(
          { planId: PLAN_ID, expectedVersion: 1 },
          writeContext(COORDINATOR_B, "key-activate"),
        );
        const absent = await store.activatePlan(
          { planId: planId("PLAN-ABSENT"), expectedVersion: 1 },
          writeContext(COORDINATOR_B, "key-activate-2"),
        );

        expect(crossTeam).toEqual({ ok: false, reason: REPOSITORY_REFUSALS.notFound });
        expect(crossTeam).toEqual(absent);
        expect((await store.getPlan(PLAN_ID, { actor: COORDINATOR_A }))?.plan.state).toBe("draft");
      });

      it("returns empty rather than a refusal when the actor's role does not cover the read", async () => {
        const store = await newStore();
        await createPlanParents(store, COORDINATOR_A);
        const before = (await auditTrail(store)).length;
        unwrap(await store.createPlan(createInput(), writeContext(COORDINATOR_A, "key-create")));

        // Positive controls first: the record and the trail are both genuinely readable by an
        // actor whose role covers them, so the empty results below are scoping and not absence.
        expect(await store.getPlan(PLAN_ID, { actor: COORDINATOR_A })).not.toBeNull();
        expect(await store.getEpisode(PLAN_ID, { actor: TEAM_LEAD_A })).not.toBeNull();
        expect(await store.listAuditEvents({ actor: AUDITOR_A })).toHaveLength(before + 1);

        expect(await store.getPlan(PLAN_ID, { actor: AUDITOR_A })).toBeNull();
        expect(await store.getEpisode(PLAN_ID, { actor: AUDITOR_A })).toBeNull();
        expect(await store.listAuditEvents({ actor: COORDINATOR_A })).toEqual([]);
      });

      it("refuses a write by an in-team actor whose role does not grant the action", async () => {
        const store = await newStore();
        await createPlanParents(store, COORDINATOR_A);
        await store.createPlan(createInput(), writeContext(COORDINATOR_A, "key-create"));

        const refused = await store.activatePlan(
          { planId: PLAN_ID, expectedVersion: 1 },
          writeContext(ROLELESS_A, "key-activate"),
        );

        expect(refused).toEqual({ ok: false, reason: REPOSITORY_REFUSALS.permissionDenied });
      });

      it("keeps patient-identifying detail out of plan reads and the audit trail", async () => {
        const store = await newStore();
        await createPlanParents(store, COORDINATOR_A);
        const before = (await auditTrail(store)).length;
        await store.createPlan(createInput(), writeContext(COORDINATOR_A, "key-create"));

        const record = await store.getPlan(PLAN_ID, { actor: COORDINATOR_A });
        const trail = await auditTrail(store);

        // Positive controls: both really did come back, so the absences below mean something.
        expect(record?.patientId).toBe(PATIENT_ID);
        expect(trail).toHaveLength(before + 1);

        expect(JSON.stringify(record)).not.toContain("491 570 156");
        expect(JSON.stringify(record)).not.toContain("Jordan");
        expect(JSON.stringify(trail)).not.toContain("491 570 156");
        expect(JSON.stringify(trail)).not.toContain("Jordan");

        // ...and the detail is still held, released only through the episode projection.
        expect((await store.getEpisode(PLAN_ID, { actor: TEAM_LEAD_A }))?.patientName).toBe("Jordan Nguyen");

        // WHAT THIS TEST CANNOT SEE. It reads the records a store hands BACK, and stops one table
        // short: every write also inserts an `idempotency_records` row holding a fingerprint of the
        // request, and this request's fingerprint was a faithful rendering of the four fields above.
        // A store test cannot ask that question of an in-memory Map, so the other half lives in
        // tests/caring-contacts-postgres-repository.test.ts ("no patient detail reaches
        // idempotency_records"), which reads the table itself as the migration role. ../fingerprint
        // now hashes, so neither store can write the request's text into that row.
      });
    });

    describe("dispatch never keys off sendAt", () => {
      it("stores an absorbed contact as terminal, so it can never reach a dispatch list", async () => {
        const store = await newStore();
        await createPlanParents(store, COORDINATOR_A);
        unwrap(
          await store.createPlan(
            createInput({ firstContactDate: "2026-03-09", firstContactReason: "Patient asked to start later" }),
            writeContext(COORDINATOR_A, "key-create"),
          ),
        );

        const all = await store.listContacts(PLAN_ID, { actor: COORDINATOR_A });
        const sendable = await store.listSendableContacts(PLAN_ID, { actor: COORDINATOR_A });
        const absorbed = all.filter((stored) => stored.planned.suppressed !== undefined);

        expect(all).toHaveLength(10);
        expect(absorbed).toHaveLength(1);
        expect(absorbed[0].contact.state).toBe("suppressed");
        expect(absorbed[0].planned.sendAt.getTime()).toBeGreaterThan(0);
        expect(sendable).toHaveLength(9);
        expect(sendable.map((stored) => stored.contact.id)).not.toContain(absorbed[0].contact.id);

        const days = sendable.map((stored) => stored.planned.calendarDay);
        expect(new Set(days).size).toBe(days.length);
      });
    });

    describe("a recorded death stops everything outright", () => {
      it("cancels every non-terminal contact without comparing any time to now", async () => {
        const { store } = await storeWithActivePlan();

        const outcome = unwrap(
          await store.recordHospitalStatusEvent(
            { planId: PLAN_ID, expectedVersion: 2, event: { type: "death", recordedAt: new Date(NOW) } },
            writeContext(COORDINATOR_A, "key-death"),
          ),
        );

        expect(outcome.record.plan.state).toBe("cancelled");
        expect(outcome.contactsCancelled).toBe(10);
        const contacts = await store.listContacts(PLAN_ID, { actor: COORDINATOR_A });
        expect(contacts.every((stored) => stored.contact.state === "cancelled")).toBe(true);
        expect(await store.listSendableContacts(PLAN_ID, { actor: COORDINATOR_A })).toEqual([]);
      });

      it("cancels contacts whose send instant is far in the future just the same", async () => {
        const { store } = await storeWithActivePlan();
        await store.recordHospitalStatusEvent(
          { planId: PLAN_ID, expectedVersion: 2, event: { type: "death", recordedAt: new Date(NOW) } },
          writeContext(COORDINATOR_A, "key-death"),
        );

        const contacts = await store.listContacts(PLAN_ID, { actor: COORDINATOR_A });
        const latest = contacts.reduce((a, b) => (a.planned.sendAt > b.planned.sendAt ? a : b));
        expect(latest.planned.sendAt.getTime()).toBeGreaterThan(new Date(NOW).getTime());
        expect(latest.contact.state).toBe("cancelled");
      });

      it("holds without cancelling for a readmission", async () => {
        const { store } = await storeWithActivePlan();

        const outcome = unwrap(
          await store.recordHospitalStatusEvent(
            { planId: PLAN_ID, expectedVersion: 2, event: { type: "readmission" } },
            writeContext(COORDINATOR_A, "key-readmission"),
          ),
        );

        expect(outcome.record.plan.state).toBe("paused");
        expect(outcome.contactsCancelled).toBe(0);
        expect(await store.listSendableContacts(PLAN_ID, { actor: COORDINATOR_A })).toHaveLength(10);
      });

      it("records a death as a hospital status event, not as a service safety stop", async () => {
        const { store } = await storeWithActivePlan();
        const before = (await auditTrail(store)).length;

        await store.recordHospitalStatusEvent(
          { planId: PLAN_ID, expectedVersion: 2, event: { type: "death", recordedAt: new Date(NOW) } },
          writeContext(COORDINATOR_A, "key-death"),
        );

        const event = (await auditTrail(store))[before];
        expect(event.action).toBe("recordHospitalStatusEvent:death");
        expect(event.action).not.toContain("SafetyStop");
      });

      it("never blocks a recorded death on a permission check, even for an auditor", async () => {
        const { store } = await storeWithActivePlan();

        // The auditor holds no recordHospitalStatusEvent grant...
        const readmission = await store.recordHospitalStatusEvent(
          { planId: PLAN_ID, expectedVersion: 2, event: { type: "readmission" } },
          writeContext(AUDITOR_A, "key-readmission"),
        );
        expect(readmission).toEqual({ ok: false, reason: REPOSITORY_REFUSALS.permissionDenied });

        // ...but a death still gets through, on triggerServiceSafetyStop, because a refusal here
        // would leave the plan sending to someone who has died.
        const death = unwrap(
          await store.recordHospitalStatusEvent(
            { planId: PLAN_ID, expectedVersion: 2, event: { type: "death", recordedAt: new Date(NOW) } },
            writeContext(AUDITOR_A, "key-death"),
          ),
        );
        expect(death.record.plan.state).toBe("cancelled");
        expect(death.contactsCancelled).toBe(10);
      });

      it("refuses a third-party withdrawal by name and leaves the plan alone", async () => {
        const { store } = await storeWithActivePlan();

        const refused = await store.withdrawPlan(
          { planId: PLAN_ID, expectedVersion: 2, origin: "thirdParty" },
          writeContext(COORDINATOR_A, "key-withdraw"),
        );

        expect(refused).toEqual({ ok: false, reason: "third-party-withdrawal-refused" });
        expect((await store.getPlan(PLAN_ID, { actor: COORDINATOR_A }))?.plan.state).toBe("active");
      });
    });

    describe("contact status is written by the dispatcher, and only by the dispatcher", () => {
      /** The first sendable contact of an active plan, with the version a write must state. */
      async function firstSendable(store: CaringContactRepository) {
        const sendable = await store.listSendableContacts(PLAN_ID, { actor: COORDINATOR_A });
        return sendable[0];
      }

      it("carries a contact through dispatch, so the episode's sent and delivered counts can move off zero", async () => {
        const { store } = await storeWithActivePlan();
        const target = await firstSendable(store);

        const processing = unwrap(
          await store.startContactDispatch(
            { planId: PLAN_ID, contactId: target.contact.id, expectedContactVersion: target.contact.version },
            writeContext(DISPATCHER_A, "key-dispatch"),
          ),
        );
        expect(processing.contact.state).toBe("processing");

        const sent = unwrap(
          await store.recordContactSent(
            { planId: PLAN_ID, contactId: target.contact.id, expectedContactVersion: processing.contact.version },
            writeContext(DISPATCHER_A, "key-sent"),
          ),
        );
        expect(sent.contact.state).toBe("sent");

        const delivered = unwrap(
          await store.recordContactProviderStatus(
            {
              planId: PLAN_ID,
              contactId: target.contact.id,
              expectedContactVersion: sent.contact.version,
              status: "delivered",
            },
            writeContext(DISPATCHER_A, "key-status"),
          ),
        );
        expect(delivered.contact.state).toBe("delivered");

        const episode = await store.getEpisode(PLAN_ID, { actor: TEAM_LEAD_A });
        expect(episode?.counts.contactsSent).toBe(1);
        expect(episode?.counts.contactsDelivered).toBe(1);
        // ...and the contact is out of the sendable list, so it cannot be dispatched twice.
        expect(
          (await store.listSendableContacts(PLAN_ID, { actor: COORDINATOR_A })).map((s) => s.contact.id),
        ).not.toContain(target.contact.id);
      });

      it("refuses a human actor writing a delivery receipt by hand", async () => {
        const { store } = await storeWithActivePlan();
        const target = await firstSendable(store);

        for (const actor of [COORDINATOR_A, TEAM_LEAD_A, AUDITOR_A]) {
          const refused = await store.startContactDispatch(
            { planId: PLAN_ID, contactId: target.contact.id, expectedContactVersion: target.contact.version },
            writeContext(actor, `key-human-${actor.id}`),
          );
          expect(refused).toEqual({ ok: false, reason: REPOSITORY_REFUSALS.permissionDenied });
        }
      });

      it("refuses to begin a dispatch unless the plan is active", async () => {
        const { store } = await storeWithActivePlan();
        const target = await firstSendable(store);
        await store.pausePlan({ planId: PLAN_ID, expectedVersion: 2 }, writeContext(COORDINATOR_A, "key-pause"));

        const refused = await store.startContactDispatch(
          { planId: PLAN_ID, contactId: target.contact.id, expectedContactVersion: target.contact.version },
          writeContext(DISPATCHER_A, "key-dispatch"),
        );
        expect(refused).toEqual({ ok: false, reason: REPOSITORY_REFUSALS.contactDispatchRequiresActivePlan });
      });

      it("refuses a contact-status write that states a stale contact version", async () => {
        const { store } = await storeWithActivePlan();
        const target = await firstSendable(store);
        await store.startContactDispatch(
          { planId: PLAN_ID, contactId: target.contact.id, expectedContactVersion: target.contact.version },
          writeContext(DISPATCHER_A, "key-dispatch"),
        );

        const refused = await store.recordContactSent(
          { planId: PLAN_ID, contactId: target.contact.id, expectedContactVersion: target.contact.version },
          writeContext(DISPATCHER_A, "key-sent"),
        );
        expect(refused).toEqual({ ok: false, reason: REPOSITORY_REFUSALS.staleVersion });
      });

      it("appends one audit event per contact-status write, naming the contact and the system role", async () => {
        const { store } = await storeWithActivePlan();
        const target = await firstSendable(store);
        const before = (await auditTrail(store)).length;

        await store.startContactDispatch(
          { planId: PLAN_ID, contactId: target.contact.id, expectedContactVersion: target.contact.version },
          writeContext(DISPATCHER_A, "key-dispatch"),
        );

        const trail = await auditTrail(store);
        expect(trail).toHaveLength(before + 1);
        const event = trail[trail.length - 1];
        expect(event.action).toBe("startContactDispatch");
        expect(event.objectType).toBe("contact");
        expect(event.objectId).toBe(target.contact.id);
        expect(event.actorRoles).toEqual(["contactDispatcher"]);
        expect(event.outcome).toBe("allowed");
      });

      it("gives the dispatcher no read access at all", async () => {
        const { store } = await storeWithActivePlan();
        expect(await store.getPlan(PLAN_ID, { actor: DISPATCHER_A })).toBeNull();
        expect(await store.listSendableContacts(PLAN_ID, { actor: DISPATCHER_A })).toEqual([]);
        expect(await store.listAuditEvents({ actor: DISPATCHER_A })).toEqual([]);
        expect(await store.getEpisode(PLAN_ID, { actor: DISPATCHER_A })).toBeNull();
      });
    });

    describe("the episode projection is retention's own type", () => {
      it("projects a finished plan into an Episode that retention can act on", async () => {
        const { store } = await storeWithActivePlan();
        await store.withdrawPlan(
          { planId: PLAN_ID, expectedVersion: 2, origin: "patient" },
          writeContext(COORDINATOR_A, "key-withdraw"),
        );

        const episode = await store.getEpisode(PLAN_ID, { actor: TEAM_LEAD_A });
        expect(episode).not.toBeNull();
        if (!episode) return;

        expect(episode.state).toBe("withdrawn");
        expect(episode.teamId).toBe(TEAM_A);
        expect(episode.pathwayVersionId).toBe(PATHWAY_VERSION_ID);
        expect(episode.patientMobileNumber).toBe(PATIENT_DETAIL.patientMobileNumber);
        expect(episode.planDates.completedAt).toEqual(new Date(NOW));
        expect(episode.counts.contactsScheduled).toBe(10);

        expect(deidentifyEpisode(episode)).not.toHaveProperty("patientMobileNumber");
        expect(isDueForDeidentification(episode, DEFAULT_RETENTION_POLICY, fixedClock(NOW))).toBe(false);
        expect(
          isDueForDeidentification(episode, DEFAULT_RETENTION_POLICY, fixedClock("2033-03-03T03:00:00.000Z")),
        ).toBe(true);
      });

      it("leaves completedAt null while the plan is still open", async () => {
        const { store } = await storeWithActivePlan();
        const episode = await store.getEpisode(PLAN_ID, { actor: TEAM_LEAD_A });
        expect(episode?.planDates.completedAt).toBeNull();
        expect(episode?.outcome).toBe("inProgress");
      });
    });

    // -------------------------------------------------------------------------
    // The Task 10 storage extension: referrals, pathway versions, service state, assignment,
    // dispatch reconciliation, the access trail, preferences, training and retention.
    //
    // These arrived in tests/caring-contacts-repository.test.ts, which builds the in-memory store
    // directly, so they held exactly ONE store to the behaviour. They live here now for the reason
    // this file exists at all: the service-wide safety stop, the three-person restart, and Ruling
    // 14's authored-content-only save are the last places in this domain where a silent divergence
    // between two stores could be tolerated, and they are the first places it would hurt.
    // -------------------------------------------------------------------------

    describe("workspace storage extension", () => {
      it("refuses every ordinary mutation while the service is stopped, and still accepts a death", async () => {
        const store = await newStore();
        const plan = await createActivePlan(store);

        const stop = await store.stopService(
          { reason: "wrong-recipient", note: "SYN-CONTACT-004 reached the wrong number." },
          writeContext(COORDINATOR_A, "stop-1"),
        );
        expect(stop.ok).toBe(true);

        const paused = await store.pausePlan(
          { planId: plan.plan.id, expectedVersion: plan.plan.version },
          writeContext(COORDINATOR_A, "pause-1"),
        );
        // The wire text is pinned as a LITERAL here, and deliberately only here. Every other test
        // reads the constant, so a rename of REPOSITORY_REFUSALS.serviceStopped would sail through
        // all of them; this one is what makes the reason a contract with callers rather than an
        // internal name two stores happen to share.
        expect(paused).toEqual({ ok: false, reason: "service-stopped" });

        const death = await store.recordHospitalStatusEvent(
          {
            planId: plan.plan.id,
            expectedVersion: plan.plan.version,
            event: { type: "death", recordedAt: clock.now() },
          },
          writeContext(COORDINATOR_A, "death-1"),
        );
        expect(death.ok).toBe(true);
      });

      it("still reads while the service is stopped", async () => {
        const store = await newStore();
        const plan = await createActivePlan(store);
        await store.stopService(
          { reason: "duplicate-send", note: "two sends on 2026-08-19" },
          writeContext(COORDINATOR_A, "stop-2"),
        );
        await expect(store.getPlan(plan.plan.id, { actor: COORDINATOR_A })).resolves.not.toBeNull();
      });

      it("records a view in the access trail that listAuditEvents never produced", async () => {
        const store = await newStore();
        const plan = await createActivePlan(store);
        await store.recordAccess({
          actorId: COORDINATOR_A.id,
          actorRoles: ["coordinator"],
          teamId: COORDINATOR_A.teamId,
          kind: "view",
          objectType: "plan",
          objectId: plan.plan.id,
          outcome: "allowed",
        });
        const trail = await store.listAccessTrail({ limit: 50, offset: 0 }, { actor: AUDITOR_A });
        expect(trail.map((event) => event.action)).toContain("access:view:plan");
      });

      it("resolves a dispatch discrepancy without ever resending (Ruling 2)", async () => {
        const store = await newStore();
        const plan = await createActivePlan(store);
        const contact = (await store.listSendableContacts(plan.plan.id, { actor: COORDINATOR_A }))[0];
        const dispatched = unwrap(
          await store.startContactDispatch(
            { planId: plan.plan.id, contactId: contact.contact.id, expectedContactVersion: contact.contact.version },
            writeContext(DISPATCHER_A, "dispatch-1"),
          ),
        );

        const resolved = await store.resolveDispatchDiscrepancy(
          { contactId: contact.contact.id, attempt: 1, resolution: "unresolvedNoResend", note: "provider outage" },
          writeContext(COORDINATOR_A, "resolve-1"),
        );
        if (!resolved.ok) throw new Error(resolved.reason);
        expect(resolved.value.discrepancyResolution).toBe("unresolvedNoResend");

        // The contact itself is untouched: same state, same version. There is no method anywhere in
        // this contract that re-dispatches a contact whose status is uncertain -- an
        // `unresolvedNoResend` outcome must never quietly turn into a guessed resend.
        const after = (await store.listContacts(plan.plan.id, { actor: COORDINATOR_A })).find(
          (stored) => stored.contact.id === contact.contact.id,
        );
        expect(after?.contact.state).toBe(dispatched.contact.state);
        expect(after?.contact.version).toBe(dispatched.contact.version);

        // No second dispatch attempt row was ever opened for this contact.
        const dispatches = await store.listDispatches(
          { fromIso: "2026-01-01T00:00:00.000Z", toIso: "2026-12-31T23:59:59.999Z" },
          { actor: COORDINATOR_A },
        );
        expect(dispatches.filter((record) => record.contactId === contact.contact.id)).toHaveLength(1);
      });

      it("keeps the reassignment history readable after a reassignment", async () => {
        const store = await newStore();
        const plan = await createActivePlan(store);
        await store.applyAssignment(
          { planId: plan.plan.id, action: { type: "claim", actorId: COORDINATOR_A.id } },
          writeContext(COORDINATOR_A, "claim-1"),
        );
        await store.applyAssignment(
          {
            planId: plan.plan.id,
            action: { type: "reassign", toActorId: actorId("ACTOR-NEW"), reason: "annual leave" },
          },
          writeContext(TEAM_LEAD_A, "reassign-1"),
        );
        const assignment = await store.getAssignment(plan.plan.id, { actor: COORDINATOR_A });
        expect(assignment?.reassignmentHistory).toHaveLength(1);
      });
    });

    // -------------------------------------------------------------------------
    // Ruling 3: the safety stop is one record for the whole service, never one per team.
    // -------------------------------------------------------------------------
    describe("service safety stop is a service-wide singleton (Ruling 3)", () => {
      it("makes a stop raised by team A block dispatch for a plan owned by team B", async () => {
        const store = await newStore();
        const planA = await createActivePlan(store, { actor: COORDINATOR_A });
        const planB = await createActivePlan(store, { actor: COORDINATOR_B });

        await store.stopService(
          { reason: "duplicate-send", note: "Team A saw a duplicate send this morning." },
          writeContext(COORDINATOR_A, "stop-cross-team"),
        );

        const pausedB = await store.pausePlan(
          { planId: planB.plan.id, expectedVersion: planB.plan.version },
          writeContext(COORDINATOR_B, "pause-b"),
        );
        expect(pausedB).toEqual({ ok: false, reason: REPOSITORY_REFUSALS.serviceStopped });

        const pausedA = await store.pausePlan(
          { planId: planA.plan.id, expectedVersion: planA.plan.version },
          writeContext(COORDINATOR_A, "pause-a"),
        );
        expect(pausedA).toEqual({ ok: false, reason: REPOSITORY_REFUSALS.serviceStopped });
      });

      it("returns the exact same record to every actor of every team -- one record, not one per team", async () => {
        const store = await newStore();
        await createActivePlan(store, { actor: COORDINATOR_A });
        await createActivePlan(store, { actor: COORDINATOR_B });
        await store.stopService(
          { reason: "audit-integrity-loss", note: "trail gap found" },
          writeContext(COORDINATOR_A, "stop-3"),
        );

        const seenByTeamA = await store.getServiceState({ actor: COORDINATOR_A });
        const seenByTeamB = await store.getServiceState({ actor: COORDINATOR_B });
        expect(seenByTeamA).toEqual(seenByTeamB);
        expect(seenByTeamA.stopped).toBe(true);
      });

      it("also gates a new write method beyond pausePlan, proving the gate is not method-specific", async () => {
        const store = await newStore();
        const plan = await createActivePlan(store);
        await store.stopService(
          { reason: "unauthorised-content", note: "unapproved wording sent" },
          writeContext(COORDINATOR_A, "stop-4"),
        );

        const claim = await store.applyAssignment(
          { planId: plan.plan.id, action: { type: "claim", actorId: COORDINATOR_A.id } },
          writeContext(COORDINATOR_A, "claim-blocked"),
        );
        expect(claim).toEqual({ ok: false, reason: REPOSITORY_REFUSALS.serviceStopped });

        const prefs = await store.saveNotificationPreferences(
          { actorId: COORDINATOR_A.id, optedIn: ["serviceSafetyStop"] },
          writeContext(COORDINATOR_A, "prefs-blocked"),
        );
        expect(prefs).toEqual({ ok: false, reason: REPOSITORY_REFUSALS.serviceStopped });
      });
    });

    // -------------------------------------------------------------------------
    // Service safety stop lifecycle: stopService / approveServiceRestart refusals.
    // -------------------------------------------------------------------------
    describe("stopService and approveServiceRestart", () => {
      it("refuses a second stop while one is already recorded", async () => {
        const store = await newStore();
        const first = await store.stopService(
          { reason: "wrong-recipient", note: "first incident" },
          writeContext(COORDINATOR_A, "s1"),
        );
        expect(first.ok).toBe(true);

        const second = await store.stopService(
          { reason: "duplicate-send", note: "second incident" },
          writeContext(TEAM_LEAD_A, "s2"),
        );
        expect(second).toEqual({ ok: false, reason: "service-already-stopped" });
      });

      it("refuses a blank note on the first stop", async () => {
        const store = await newStore();
        const stop = await store.stopService(
          { reason: "wrong-recipient", note: "  " },
          writeContext(COORDINATOR_A, "s-blank"),
        );
        expect(stop).toEqual({ ok: false, reason: "service-stop-note-required" });
      });

      it("refuses stopService for an actor without triggerServiceSafetyStop (the dispatcher)", async () => {
        const store = await newStore();
        const stop = await store.stopService(
          { reason: "wrong-recipient", note: "n/a" },
          writeContext(DISPATCHER_A, "s-dispatcher"),
        );
        expect(stop).toEqual({ ok: false, reason: REPOSITORY_REFUSALS.permissionDenied });
      });

      it("requires all three distinct roles from three distinct actors before restarting, then restarts on the third", async () => {
        const store = await newStore();
        await store.stopService(
          { reason: "wrong-recipient", note: "incident" },
          writeContext(COORDINATOR_A, "s-restart"),
        );

        const first = unwrap(
          await store.approveServiceRestart({ role: "incidentLead" }, writeContext(TEAM_LEAD_A, "approve-1")),
        );
        expect(first.stopped).toBe(true);

        // Same role again is refused, even from a different actor.
        const sameRole = await store.approveServiceRestart(
          { role: "incidentLead" },
          writeContext(PROGRAMME_LEAD_A, "approve-same-role"),
        );
        expect(sameRole).toEqual({ ok: false, reason: "restart-approval-role-already-recorded" });

        // The same actor cannot supply a second approval under a different role.
        const sameActor = await store.approveServiceRestart(
          { role: "privacySecurityOwner" },
          writeContext(TEAM_LEAD_A, "approve-same-actor"),
        );
        expect(sameActor).toEqual({ ok: false, reason: "restart-approval-actor-already-recorded" });

        const second = unwrap(
          await store.approveServiceRestart(
            { role: "privacySecurityOwner" },
            writeContext(PROGRAMME_LEAD_A, "approve-2"),
          ),
        );
        expect(second.stopped).toBe(true);

        const third = unwrap(
          await store.approveServiceRestart(
            { role: "clinicalProgrammeLead" },
            writeContext(SECOND_TEAM_LEAD_A, "approve-3"),
          ),
        );
        expect(third.stopped).toBe(false);

        // Once running again, an ordinary write is no longer blocked.
        const plan = await createActivePlan(store);
        const paused = await store.pausePlan(
          { planId: plan.plan.id, expectedVersion: plan.plan.version },
          writeContext(COORDINATOR_A, "pause-after-restart"),
        );
        expect(paused.ok).toBe(true);
      });

      it("hands a restart approver the stop it is approving, and never the incident note", async () => {
        // Ruling 65. Restart approvals are service-wide by design, so a TEAM-SOUTH team lead
        // legitimately approves a TEAM-NORTH incident -- and the first two approvals leave the
        // service STOPPED, so this write used to hand back the whole live record, note and all.
        // That value is also what both stores persist as the replay result, under the APPROVING
        // team's id, in a table scoped by row-level security to that team. Narrowing it at the API
        // boundary could not reach that copy; narrowing what the method returns removes it from
        // both places by construction.
        const store = await newStore();
        const note = "Jordan Nguyen was sent the same message twice on 491 570 156";
        unwrap(await store.stopService({ reason: "duplicate-send", note }, writeContext(COORDINATOR_A, "narrow-stop")));

        // Positive control: the note really was recorded and really is held, so an absence below is
        // the return value being narrow rather than the incident being empty.
        const state = await store.getServiceState({ actor: COORDINATOR_A });
        if (!state.stopped) throw new Error("expected a stopped service");
        expect(state.note).toBe(note);

        const approved = unwrap(
          await store.approveServiceRestart({ role: "incidentLead" }, writeContext(TEAM_LEAD_B, "narrow-approve")),
        );

        // The approver still gets what an approval is FOR: the stop still standing, what kind of
        // failure it was, and their own approval now recorded against it.
        if (!approved.stopped) throw new Error("expected the service to still be stopped");
        expect(approved.reason).toBe("duplicate-send");
        expect(approved.restartApprovals.map((approval) => approval.role)).toEqual(["incidentLead"]);
        expect(approved.restartApprovals[0].actorId).toBe(TEAM_LEAD_B.id);

        // ...and nothing that names the patient, the responder, or the reporting team.
        expect(approved).not.toHaveProperty("note");
        expect(approved).not.toHaveProperty("stoppedBy");
        expect(approved).not.toHaveProperty("reportedByTeamId");
        expect(JSON.stringify(approved)).not.toContain("Jordan");
        expect(JSON.stringify(approved)).not.toContain("491 570 156");

        // A replay returns the ORIGINAL answer, which is now the narrow one -- so the replay is
        // truthful and clean at the same time, rather than one at the cost of the other.
        const replay = unwrap(
          await store.approveServiceRestart({ role: "incidentLead" }, writeContext(TEAM_LEAD_B, "narrow-approve")),
        );
        expect(replay).toEqual(approved);
      });

      it("narrows the approval reply on the restart too, where there is no incident left to name", async () => {
        // The approval that COMPLETES the restart returns a running service. That variant never
        // carried the note, but it did carry `reportedByTeamId`, and the narrowed shape has to hold
        // for both variants or the discriminated union would leak through one arm.
        const store = await newStore();
        unwrap(
          await store.stopService(
            { reason: "wrong-recipient", note: "Jordan Nguyen's number was reached in error" },
            writeContext(COORDINATOR_A, "narrow-restart-stop"),
          ),
        );
        unwrap(
          await store.approveServiceRestart({ role: "incidentLead" }, writeContext(TEAM_LEAD_A, "narrow-restart-1")),
        );
        unwrap(
          await store.approveServiceRestart(
            { role: "privacySecurityOwner" },
            writeContext(PROGRAMME_LEAD_A, "narrow-restart-2"),
          ),
        );
        const restarted = unwrap(
          await store.approveServiceRestart(
            { role: "clinicalProgrammeLead" },
            writeContext(TEAM_LEAD_B, "narrow-restart-3"),
          ),
        );

        expect(restarted).toEqual({ stopped: false });
        expect(JSON.stringify(restarted)).not.toContain("Jordan");
      });

      it("reads restart approvals for the CURRENT incident only, so a new stop starts at zero", async () => {
        const store = await newStore();
        await store.stopService(
          { reason: "wrong-recipient", note: "first incident" },
          writeContext(COORDINATOR_A, "two-stop-1"),
        );
        unwrap(await store.approveServiceRestart({ role: "incidentLead" }, writeContext(TEAM_LEAD_A, "two-approve-1")));
        unwrap(
          await store.approveServiceRestart(
            { role: "privacySecurityOwner" },
            writeContext(PROGRAMME_LEAD_A, "two-approve-2"),
          ),
        );
        const restarted = unwrap(
          await store.approveServiceRestart(
            { role: "clinicalProgrammeLead" },
            writeContext(SECOND_TEAM_LEAD_A, "two-approve-3"),
          ),
        );
        expect(restarted.stopped).toBe(false);

        unwrap(
          await store.stopService(
            { reason: "duplicate-send", note: "second, unrelated incident" },
            writeContext(COORDINATOR_A, "two-stop-2"),
          ),
        );

        // A brand-new live incident that read the PREVIOUS incident's approvals would present
        // itself as already three-person approved -- a zero-approval restart.
        const state = await store.getServiceState({ actor: COORDINATOR_A });
        if (!state.stopped) throw new Error("expected a stopped service");
        expect(state.restartApprovals).toEqual([]);
        expect(state.reason).toBe("duplicate-send");
        expect(state.note).toBe("second, unrelated incident");
      });

      it("persists the instant it handed back, not a second reading of the clock", async () => {
        // A clock that never returns the same instant twice. Every other test in this file uses a
        // FIXED clock, which is exactly why none of them can see a store that reads the clock once
        // for the domain and again for the row it writes.
        const ticking = advancingClock(NOW);
        const control = { first: ticking.now().getTime(), second: ticking.now().getTime() };
        expect(control.second).toBeGreaterThan(control.first);

        const store = await factory(ticking, undefined);
        const stopped = unwrap(
          await store.stopService(
            { reason: "wrong-recipient", note: "a message reached a number nobody recognised" },
            writeContext(COORDINATOR_A, "tick-stop"),
          ),
        );
        if (!stopped.stopped) throw new Error("expected a stopped service");

        // The stop is the write this matters most for: its record is enforced immutable, so an
        // instant recorded even milliseconds away from the one the caller was handed can never be
        // corrected afterwards.
        const readBack = await store.getServiceState({ actor: COORDINATOR_A });
        if (!readBack.stopped) throw new Error("expected a stopped service");
        expect(readBack.stoppedAt).toBe(stopped.stoppedAt);

        const approved = unwrap(
          await store.approveServiceRestart({ role: "incidentLead" }, writeContext(TEAM_LEAD_A, "tick-approve")),
        );
        if (!approved.stopped) throw new Error("expected the service to still be stopped");

        const afterApproval = await store.getServiceState({ actor: COORDINATOR_A });
        if (!afterApproval.stopped) throw new Error("expected a stopped service");
        expect(afterApproval.restartApprovals.map((approval) => approval.approvedAt)).toEqual(
          approved.restartApprovals.map((approval) => approval.approvedAt),
        );
      });

      it("lets exactly one of two simultaneous first stops win, refusing the other by name", async () => {
        // The FIRST-EVER stop is the one race a row lock cannot cover: there is no singleton row to
        // take `for update` on until one of these two writes creates it. Without a guard the loser's
        // write overwrites the winner's reason, actor and incident -- and "the first record of an
        // incident is permanent" is the property ../service-state exists to hold.
        const store = await newStore();

        // This is the BEHAVIOURAL half of the proof, and it is here because both stores owe the
        // same answer. It cannot show that the race window was actually ENTERED: if scheduling ever
        // serialised these two writes the loser would be refused by the domain check instead of by
        // the store's guard, and this test would still pass. That reachability control needs the
        // incident-history table, which only one store has, so it lives beside this in
        // tests/caring-contacts-postgres-repository.test.ts. Neither half is redundant -- do not
        // delete one thinking the other covers it.
        //
        // The two responders are from DIFFERENT teams, and that is what makes this a race rather
        // than a queue. Every write registers its own team first, so two callers from ONE team
        // serialise on that row and never reach the window at all; two teams do not touch each
        // other's row and arrive together. It is also the truthful shape: the stop is service-wide,
        // so two teams finding two different incidents at once is exactly how this happens.
        await Promise.all([
          store.getServiceState({ actor: COORDINATOR_A }),
          store.getServiceState({ actor: COORDINATOR_B }),
        ]);

        const [first, second] = await Promise.all([
          store.stopService(
            { reason: "wrong-recipient", note: "the first responder's own account" },
            writeContext(COORDINATOR_A, "race-stop-a"),
          ),
          store.stopService(
            { reason: "duplicate-send", note: "a later account of something else entirely" },
            writeContext(COORDINATOR_B, "race-stop-b"),
          ),
        ]);

        const accepted = [first, second].filter((result) => result.ok);
        const refused = [first, second].filter((result) => !result.ok);
        expect(accepted).toHaveLength(1);
        expect(refused).toEqual([{ ok: false, reason: "service-already-stopped" }]);

        const winner = accepted[0];
        if (!winner.ok || !winner.value.stopped) throw new Error("expected an accepted stop");

        const state = await store.getServiceState({ actor: AUDITOR_A });
        if (!state.stopped) throw new Error("expected a stopped service");
        expect(state.reason).toBe(winner.value.reason);
        expect(state.note).toBe(winner.value.note);
        expect(state.stoppedBy).toBe(winner.value.stoppedBy);
      });

      it("refuses a restart approval while the service is running", async () => {
        const store = await newStore();
        const approval = await store.approveServiceRestart(
          { role: "incidentLead" },
          writeContext(TEAM_LEAD_A, "approve-not-stopped"),
        );
        expect(approval).toEqual({ ok: false, reason: "service-not-stopped" });
      });

      it("refuses approveServiceRestart for an actor without the grant (coordinator)", async () => {
        const store = await newStore();
        await store.stopService({ reason: "wrong-recipient", note: "incident" }, writeContext(COORDINATOR_A, "s-perm"));
        const approval = await store.approveServiceRestart(
          { role: "incidentLead" },
          writeContext(COORDINATOR_A, "approve-perm"),
        );
        expect(approval).toEqual({ ok: false, reason: REPOSITORY_REFUSALS.permissionDenied });
      });

      it("does not poison the idempotency key with a service-stopped refusal -- the same retry succeeds after the restart", async () => {
        const store = await newStore();
        const plan = await createActivePlan(store);
        await store.stopService(
          { reason: "duplicate-send", note: "a duplicate send was seen this morning" },
          writeContext(COORDINATOR_A, "s-poison"),
        );

        const refused = await store.pausePlan(
          { planId: plan.plan.id, expectedVersion: plan.plan.version },
          writeContext(COORDINATOR_A, "pause-retry"),
        );
        expect(refused).toEqual({ ok: false, reason: REPOSITORY_REFUSALS.serviceStopped });

        unwrap(
          await store.approveServiceRestart({ role: "incidentLead" }, writeContext(TEAM_LEAD_A, "poison-approve-1")),
        );
        unwrap(
          await store.approveServiceRestart(
            { role: "privacySecurityOwner" },
            writeContext(PROGRAMME_LEAD_A, "poison-approve-2"),
          ),
        );
        const restarted = unwrap(
          await store.approveServiceRestart(
            { role: "clinicalProgrammeLead" },
            writeContext(SECOND_TEAM_LEAD_A, "poison-approve-3"),
          ),
        );
        expect(restarted.stopped).toBe(false);

        // The SAME key as the refused attempt. Idempotency keys are stable across retries, so a
        // remembered service-stop refusal would refuse this write forever with a reason that is no
        // longer true -- and the resume path is the entire point of a safety stop.
        const retried = await store.pausePlan(
          { planId: plan.plan.id, expectedVersion: plan.plan.version },
          writeContext(COORDINATOR_A, "pause-retry"),
        );
        expect(retried.ok).toBe(true);
      });

      it("still replays every OTHER refusal against the same key, even once its cause is gone", async () => {
        const store = await newStore();
        const late = planId("EXT-PLAN-LATE");

        const refused = await store.markRetentionCleared({ planId: late }, writeContext(COORDINATOR_A, "late-key"));
        expect(refused).toEqual({ ok: false, reason: REPOSITORY_REFUSALS.notFound });

        unwrap(
          await store.createReferral(
            { referralId: referralId("EXT-REFERRAL-LATE"), patientId: patientId("EXT-PATIENT-LATE") },
            writeContext(COORDINATOR_A, "late-referral"),
          ),
        );
        unwrap(
          await store.savePathwayVersion(
            { version: draftPathwayVersion(COORDINATOR_A, "EXT-PATHWAY-LATE") },
            writeContext(COORDINATOR_A, "late-pathway"),
          ),
        );
        unwrap(
          await store.createPlan(
            {
              planId: late,
              referralId: referralId("EXT-REFERRAL-LATE"),
              patientId: patientId("EXT-PATIENT-LATE"),
              pathwayVersionId: pathwayVersionId("EXT-PATHWAY-LATE"),
              dischargeAt: DISCHARGE_AT,
              sendingPreference: "morning",
              patientDetail: PATIENT_DETAIL,
            },
            writeContext(COORDINATOR_A, "late-create"),
          ),
        );

        // The plan exists now, but this key already has an answer: replaying it returns the ORIGINAL
        // refusal rather than recomputing one. Only `service-stopped` is exempt from that.
        const replay = await store.markRetentionCleared({ planId: late }, writeContext(COORDINATOR_A, "late-key"));
        expect(replay).toEqual({ ok: false, reason: REPOSITORY_REFUSALS.notFound });
      });
    });

    // -------------------------------------------------------------------------
    // Referrals
    // -------------------------------------------------------------------------
    describe("referrals", () => {
      it("creates a referral, refuses a duplicate id, and refuses a role without the grant", async () => {
        const store = await newStore();
        const created = unwrap(
          await store.createReferral(
            { referralId: referralId("EXT-REF-1"), patientId: patientId("EXT-PAT-1") },
            writeContext(COORDINATOR_A, "cr-1"),
          ),
        );
        expect(created.state).toBe("awaitingHandover");

        const duplicate = await store.createReferral(
          { referralId: referralId("EXT-REF-1"), patientId: patientId("EXT-PAT-2") },
          writeContext(COORDINATOR_A, "cr-2"),
        );
        expect(duplicate).toEqual({ ok: false, reason: REPOSITORY_REFUSALS.referralAlreadyExists });

        const denied = await store.createReferral(
          { referralId: referralId("EXT-REF-2"), patientId: patientId("EXT-PAT-3") },
          writeContext(AUDITOR_A, "cr-3"),
        );
        expect(denied).toEqual({ ok: false, reason: REPOSITORY_REFUSALS.permissionDenied });
      });

      it("accepts a referral onto a pathway version, and refuses an unknown referral id", async () => {
        const store = await newStore();
        await store.createReferral(
          { referralId: referralId("EXT-REF-3"), patientId: patientId("EXT-PAT-4") },
          writeContext(COORDINATOR_A, "cr-4"),
        );

        const accepted = unwrap(
          await store.transitionReferral(
            {
              referralId: referralId("EXT-REF-3"),
              action: { type: "accept", pathwayVersionId: pathwayVersionId("EXT-PATHWAY-SEED") },
            },
            writeContext(COORDINATOR_A, "tr-1"),
          ),
        );
        expect(accepted.state).toBe("accepted");
        expect(accepted.pathwayVersionId).toBe(pathwayVersionId("EXT-PATHWAY-SEED"));

        const missing = await store.transitionReferral(
          { referralId: referralId("EXT-REF-UNKNOWN"), action: { type: "decline", reason: "not eligible" } },
          writeContext(COORDINATOR_A, "tr-2"),
        );
        expect(missing).toEqual({ ok: false, reason: REPOSITORY_REFUSALS.notFound });
      });

      it("refuses re-accepting a referral already accepted, and a blank decline reason", async () => {
        const store = await newStore();
        await store.createReferral(
          { referralId: referralId("EXT-REF-5"), patientId: patientId("EXT-PAT-5") },
          writeContext(COORDINATOR_A, "cr-5"),
        );
        await store.transitionReferral(
          {
            referralId: referralId("EXT-REF-5"),
            action: { type: "accept", pathwayVersionId: pathwayVersionId("EXT-PATHWAY-SEED") },
          },
          writeContext(COORDINATOR_A, "tr-3"),
        );

        const reaccept = await store.transitionReferral(
          {
            referralId: referralId("EXT-REF-5"),
            action: { type: "accept", pathwayVersionId: pathwayVersionId("EXT-PATHWAY-SEED") },
          },
          writeContext(COORDINATOR_A, "tr-4"),
        );
        expect(reaccept).toEqual({ ok: false, reason: "referral-not-awaiting-handover" });

        await store.createReferral(
          { referralId: referralId("EXT-REF-6"), patientId: patientId("EXT-PAT-6") },
          writeContext(COORDINATOR_A, "cr-6"),
        );
        const blankDecline = await store.transitionReferral(
          { referralId: referralId("EXT-REF-6"), action: { type: "decline", reason: "  " } },
          writeContext(COORDINATOR_A, "tr-5"),
        );
        expect(blankDecline).toEqual({ ok: false, reason: "referral-reason-required" });
      });

      it("scopes listReferrals to the actor's own team and the viewReferral grant", async () => {
        const store = await newStore();
        await store.createReferral(
          { referralId: referralId("EXT-REF-7"), patientId: patientId("EXT-PAT-7") },
          writeContext(COORDINATOR_A, "cr-7"),
        );

        expect(await store.listReferrals({ actor: COORDINATOR_A })).toHaveLength(1);
        expect(await store.listReferrals({ actor: COORDINATOR_B })).toEqual([]);
        expect(await store.listReferrals({ actor: AUDITOR_A })).toEqual([]);
      });
    });

    // -------------------------------------------------------------------------
    // Pathway versions
    // -------------------------------------------------------------------------
    describe("pathway versions", () => {
      it("saves a version, refuses a duplicate id, and refuses a role without authorPathwayVersion", async () => {
        const store = await newStore();
        const version = draftPathwayVersion();
        const saved = unwrap(await store.savePathwayVersion({ version }, writeContext(COORDINATOR_A, "sv-1")));
        expect(saved.state).toBe("draft");

        const duplicate = await store.savePathwayVersion({ version }, writeContext(COORDINATOR_A, "sv-2"));
        expect(duplicate).toEqual({ ok: false, reason: REPOSITORY_REFUSALS.pathwayVersionAlreadyExists });

        const denied = await store.savePathwayVersion(
          { version: draftPathwayVersion() },
          writeContext(AUDITOR_A, "sv-3"),
        );
        expect(denied).toEqual({ ok: false, reason: REPOSITORY_REFUSALS.permissionDenied });
      });

      it("carries a version through submit, dual approval, publish and retirement", async () => {
        const store = await newStore();
        const version = draftPathwayVersion(TEAM_LEAD_A);
        await store.savePathwayVersion({ version }, writeContext(TEAM_LEAD_A, "sv-4"));

        const submitted = unwrap(
          await store.transitionPathwayVersion(
            { pathwayVersionId: version.id, action: { type: "submitForReview" } },
            writeContext(TEAM_LEAD_A, "pv-1"),
          ),
        );
        expect(submitted.state).toBe("inReview");

        // The author holds approvePathwayVersion too, but may not approve their own version.
        const selfApproval = await store.transitionPathwayVersion(
          {
            pathwayVersionId: version.id,
            action: { type: "approve", role: "clinicalProgrammeLead", actorId: TEAM_LEAD_A.id },
          },
          writeContext(TEAM_LEAD_A, "pv-2"),
        );
        expect(selfApproval).toEqual({ ok: false, reason: "self-approval-denied" });

        const firstApproval = unwrap(
          await store.transitionPathwayVersion(
            {
              pathwayVersionId: version.id,
              action: { type: "approve", role: "clinicalProgrammeLead", actorId: PROGRAMME_LEAD_A.id },
            },
            writeContext(PROGRAMME_LEAD_A, "pv-3"),
          ),
        );
        expect(firstApproval.state).toBe("inReview");

        const secondApproval = unwrap(
          await store.transitionPathwayVersion(
            {
              pathwayVersionId: version.id,
              action: {
                type: "approve",
                role: "livedExperienceRepresentative",
                actorId: LIVED_EXPERIENCE_A.id,
              },
            },
            writeContext(LIVED_EXPERIENCE_A, "pv-4"),
          ),
        );
        expect(secondApproval.state).toBe("approved");

        // publishPathwayVersion is granted to the clinical programme lead only.
        const publishDenied = await store.transitionPathwayVersion(
          { pathwayVersionId: version.id, action: { type: "publish", actorId: TEAM_LEAD_A.id } },
          writeContext(TEAM_LEAD_A, "pv-5"),
        );
        expect(publishDenied).toEqual({ ok: false, reason: REPOSITORY_REFUSALS.permissionDenied });

        const published = unwrap(
          await store.transitionPathwayVersion(
            { pathwayVersionId: version.id, action: { type: "publish", actorId: PROGRAMME_LEAD_A.id } },
            writeContext(PROGRAMME_LEAD_A, "pv-6"),
          ),
        );
        expect(published.publishedAt).toMatch(/\+08:00$/);

        const retired = unwrap(
          await store.transitionPathwayVersion(
            { pathwayVersionId: version.id, action: { type: "retire", urgency: "routine" } },
            writeContext(TEAM_LEAD_A, "pv-7"),
          ),
        );
        expect(retired.state).toBe("retired");
      });

      it("refuses transitioning an unknown pathway version id and an approve made before submission", async () => {
        const store = await newStore();
        const missing = await store.transitionPathwayVersion(
          { pathwayVersionId: pathwayVersionId("EXT-PATHWAY-MISSING"), action: { type: "submitForReview" } },
          writeContext(COORDINATOR_A, "pv-8"),
        );
        expect(missing).toEqual({ ok: false, reason: REPOSITORY_REFUSALS.notFound });

        const version = draftPathwayVersion();
        await store.savePathwayVersion({ version }, writeContext(COORDINATOR_A, "sv-5"));
        const earlyApprove = await store.transitionPathwayVersion(
          {
            pathwayVersionId: version.id,
            action: { type: "approve", role: "clinicalProgrammeLead", actorId: PROGRAMME_LEAD_A.id },
          },
          writeContext(PROGRAMME_LEAD_A, "pv-9"),
        );
        expect(earlyApprove).toEqual({ ok: false, reason: "pathway-not-in-review" });
      });

      it("scopes getPathwayVersion/listPathwayVersions to the team, visible to author or approver roles, not the auditor", async () => {
        const store = await newStore();
        const version = draftPathwayVersion();
        await store.savePathwayVersion({ version }, writeContext(COORDINATOR_A, "sv-6"));

        expect(await store.getPathwayVersion(version.id, { actor: COORDINATOR_A })).not.toBeNull();
        expect(await store.getPathwayVersion(version.id, { actor: PROGRAMME_LEAD_A })).not.toBeNull();
        expect(await store.getPathwayVersion(version.id, { actor: AUDITOR_A })).toBeNull();
        expect(await store.getPathwayVersion(version.id, { actor: COORDINATOR_B })).toBeNull();
        expect(await store.getPathwayVersion(pathwayVersionId("EXT-NOPE"), { actor: COORDINATOR_A })).toBeNull();

        expect(await store.listPathwayVersions({ actor: COORDINATOR_A })).toHaveLength(1);
        expect(await store.listPathwayVersions({ actor: AUDITOR_A })).toEqual([]);
      });

      // ---- Ruling 14: a save persists authored content, never governance. ----
      it("persists authored content only -- state, approvals, authorId and publication are constructed server-side (Ruling 14)", async () => {
        const store = await newStore();
        const forged: PathwayVersion = {
          ...draftPathwayVersion(),
          // Everything one actor holding authorPathwayVersion might try to seed past the governance
          // lifecycle in a single call. `approved` is the state that actually lands the exploit:
          // publication is not a state of its own, so an approved version publishes on a
          // `publishedAt` alone -- see pathway-versions.
          state: "approved",
          authorId: TEAM_LEAD_A.id,
          approvals: [
            { role: "clinicalProgrammeLead", actorId: PROGRAMME_LEAD_A.id, approvedAt: "2026-03-02T11:00:00+08:00" },
            {
              role: "livedExperienceRepresentative",
              actorId: LIVED_EXPERIENCE_A.id,
              approvedAt: "2026-03-02T11:00:00+08:00",
            },
          ],
          publishedAt: "2026-03-02T11:00:00+08:00",
          retiredAt: "2026-03-02T12:00:00+08:00",
          retirementUrgency: "urgentSafety",
        };

        const saved = unwrap(
          await store.savePathwayVersion({ version: forged }, writeContext(COORDINATOR_A, "sv-forged")),
        );
        expect(saved.state).toBe("draft");
        expect(saved.approvals).toEqual([]);
        expect(saved.authorId).toBe(COORDINATOR_A.id);
        expect(saved.publishedAt).toBeNull();
        expect(saved.retiredAt).toBeNull();
        expect(saved.retirementUrgency).toBeNull();
        // The authored content itself is kept verbatim: this write persists content, not governance.
        expect(saved.snapshot).toEqual(forged.snapshot);

        // The stored record says the same, not merely the copy that came back.
        const stored = await store.getPathwayVersion(forged.id, { actor: COORDINATOR_A });
        expect(stored?.state).toBe("draft");
        expect(stored?.approvals).toEqual([]);
        expect(stored?.authorId).toBe(COORDINATOR_A.id);
        expect(stored?.publishedAt).toBeNull();
      });

      it("refuses to publish a version a caller tried to seed as already approved -- dual approval is not bypassable by a save", async () => {
        const store = await newStore();
        const forged: PathwayVersion = {
          ...draftPathwayVersion(),
          state: "approved",
          approvals: [
            { role: "clinicalProgrammeLead", actorId: PROGRAMME_LEAD_A.id, approvedAt: "2026-03-02T11:00:00+08:00" },
            {
              role: "livedExperienceRepresentative",
              actorId: LIVED_EXPERIENCE_A.id,
              approvedAt: "2026-03-02T11:00:00+08:00",
            },
          ],
        };
        unwrap(await store.savePathwayVersion({ version: forged }, writeContext(COORDINATOR_A, "sv-forged-2")));

        const published = await store.transitionPathwayVersion(
          { pathwayVersionId: forged.id, action: { type: "publish", actorId: PROGRAMME_LEAD_A.id } },
          writeContext(PROGRAMME_LEAD_A, "pv-forged-publish"),
        );
        expect(published).toEqual({ ok: false, reason: "pathway-not-approved" });
      });
    });

    // -------------------------------------------------------------------------
    // Assignment
    // -------------------------------------------------------------------------
    describe("assignment", () => {
      it("refuses claiming an already-claimed plan, reassigning an unclaimed one, and a blank reassignment reason", async () => {
        const store = await newStore();
        const plan = await createActivePlan(store);

        const reassignUnclaimed = await store.applyAssignment(
          { planId: plan.plan.id, action: { type: "reassign", toActorId: TEAM_LEAD_A.id, reason: "cover" } },
          writeContext(TEAM_LEAD_A, "aa-1"),
        );
        expect(reassignUnclaimed).toEqual({ ok: false, reason: "plan-not-claimed" });

        unwrap(
          await store.applyAssignment(
            { planId: plan.plan.id, action: { type: "claim", actorId: COORDINATOR_A.id } },
            writeContext(COORDINATOR_A, "aa-2"),
          ),
        );

        const reclaim = await store.applyAssignment(
          { planId: plan.plan.id, action: { type: "claim", actorId: TEAM_LEAD_A.id } },
          writeContext(TEAM_LEAD_A, "aa-3"),
        );
        expect(reclaim).toEqual({ ok: false, reason: "plan-already-claimed" });

        const blankReason = await store.applyAssignment(
          { planId: plan.plan.id, action: { type: "reassign", toActorId: TEAM_LEAD_A.id, reason: "  " } },
          writeContext(TEAM_LEAD_A, "aa-4"),
        );
        expect(blankReason).toEqual({ ok: false, reason: "reassignment-reason-required" });
      });

      it("refuses reassignPlan for a role that lacks the grant, and an inverted coverage window", async () => {
        const store = await newStore();
        const plan = await createActivePlan(store);
        await store.applyAssignment(
          { planId: plan.plan.id, action: { type: "claim", actorId: COORDINATOR_A.id } },
          writeContext(COORDINATOR_A, "aa-5"),
        );

        const deniedReassign = await store.applyAssignment(
          { planId: plan.plan.id, action: { type: "reassign", toActorId: TEAM_LEAD_A.id, reason: "leave" } },
          writeContext(COORDINATOR_A, "aa-6"),
        );
        expect(deniedReassign).toEqual({ ok: false, reason: REPOSITORY_REFUSALS.permissionDenied });

        const invertedWindow = await store.applyAssignment(
          {
            planId: plan.plan.id,
            action: { type: "startCoverage", actorId: TEAM_LEAD_A.id, from: "2026-03-10", until: "2026-03-05" },
          },
          writeContext(TEAM_LEAD_A, "aa-7"),
        );
        expect(invertedWindow).toEqual({ ok: false, reason: "coverage-window-invalid" });
      });

      it("refuses a coverage window that is not an AWST calendar day, by name in both stores", async () => {
        const store = await newStore();
        const plan = await createActivePlan(store);
        unwrap(
          await store.applyAssignment(
            { planId: plan.plan.id, action: { type: "claim", actorId: COORDINATOR_A.id } },
            writeContext(COORDINATOR_A, "aa-cal-claim"),
          ),
        );

        // A coverage window is an AWST calendar day (YYYY-MM-DD), which is what `effectiveResponder`
        // compares on. The only check the domain used to make was `until > from` -- a LEXICAL string
        // compare, which "cherry" > "banana" satisfies. So this pair was accepted and stored by the
        // in-memory store, where `effectiveResponder` then silently named the wrong person, while
        // the Postgres schema's own `~ '^\d{4}-\d{2}-\d{2}$'` check raised and escaped as a throw.
        // Two stores, two answers, and a throw where this domain's convention is a named refusal.
        const nonsense = await store.applyAssignment(
          {
            planId: plan.plan.id,
            action: { type: "startCoverage", actorId: TEAM_LEAD_A.id, from: "banana", until: "cherry" },
          },
          writeContext(TEAM_LEAD_A, "aa-cal-1"),
        );
        expect(nonsense).toEqual({ ok: false, reason: "coverage-window-not-calendar-day" });

        // A date that LOOKS like a calendar day but is not one. The schema's regular expression
        // accepts this; only the domain predicate rejects it, which is why the rule belongs there.
        const impossibleDay = await store.applyAssignment(
          {
            planId: plan.plan.id,
            action: { type: "startCoverage", actorId: TEAM_LEAD_A.id, from: "2026-02-30", until: "2026-03-05" },
          },
          writeContext(TEAM_LEAD_A, "aa-cal-2"),
        );
        expect(impossibleDay).toEqual({ ok: false, reason: "coverage-window-not-calendar-day" });

        // ...and nothing was stored by either store, so the refusal is a refusal rather than a
        // rejected value that still reached the assignment.
        expect((await store.getAssignment(plan.plan.id, { actor: COORDINATOR_A }))?.coveredBy).toBeNull();
      });

      it("refuses an unknown plan and returns null/unassigned for reads", async () => {
        const store = await newStore();
        const missing = await store.applyAssignment(
          { planId: planId("EXT-PLAN-MISSING"), action: { type: "claim", actorId: COORDINATOR_A.id } },
          writeContext(COORDINATOR_A, "aa-8"),
        );
        expect(missing).toEqual({ ok: false, reason: REPOSITORY_REFUSALS.notFound });

        expect(await store.getAssignment(planId("EXT-PLAN-MISSING"), { actor: COORDINATOR_A })).toBeNull();

        const plan = await createActivePlan(store);
        expect(await store.getAssignment(plan.plan.id, { actor: COORDINATOR_A })).toEqual({
          ownerId: null,
          claimedAt: null,
          coveredBy: null,
          reassignmentHistory: [],
        });
        expect(await store.getAssignment(plan.plan.id, { actor: COORDINATOR_B })).toBeNull();
      });

      it("refuses a claim that names an actor other than the caller, so the ledger and the audit trail cannot disagree", async () => {
        const store = await newStore();
        const plan = await createActivePlan(store);

        // The audit event names the caller. If the ledger were allowed to name somebody else, the
        // two records of "who took this work" would contradict each other.
        const impersonated = await store.applyAssignment(
          { planId: plan.plan.id, action: { type: "claim", actorId: TEAM_LEAD_A.id } },
          writeContext(COORDINATOR_A, "claim-impersonate"),
        );
        expect(impersonated).toEqual({ ok: false, reason: REPOSITORY_REFUSALS.permissionDenied });
        expect(await store.getAssignment(plan.plan.id, { actor: COORDINATOR_A })).toMatchObject({ ownerId: null });

        const own = unwrap(
          await store.applyAssignment(
            { planId: plan.plan.id, action: { type: "claim", actorId: COORDINATOR_A.id } },
            writeContext(COORDINATOR_A, "claim-own"),
          ),
        );
        expect(own.ownerId).toBe(COORDINATOR_A.id);
      });

      it("still lets coverage and reassignment name a third party, which is the whole point of both", async () => {
        const store = await newStore();
        const plan = await createActivePlan(store);
        unwrap(
          await store.applyAssignment(
            { planId: plan.plan.id, action: { type: "claim", actorId: COORDINATOR_A.id } },
            writeContext(COORDINATOR_A, "third-claim"),
          ),
        );

        const covered = unwrap(
          await store.applyAssignment(
            {
              planId: plan.plan.id,
              action: {
                type: "startCoverage",
                actorId: SECOND_TEAM_LEAD_A.id,
                from: "2026-03-03",
                until: "2026-03-10",
              },
            },
            writeContext(TEAM_LEAD_A, "third-cover"),
          ),
        );
        expect(covered.coveredBy?.actorId).toBe(SECOND_TEAM_LEAD_A.id);

        const reassigned = unwrap(
          await store.applyAssignment(
            {
              planId: plan.plan.id,
              action: { type: "reassign", toActorId: actorId("ACTOR-COVER"), reason: "annual leave" },
            },
            writeContext(TEAM_LEAD_A, "third-reassign"),
          ),
        );
        expect(reassigned.ownerId).toBe(actorId("ACTOR-COVER"));
      });
    });

    // -------------------------------------------------------------------------
    // Reads must not hand out a live internal reference: a caller holding one could rewrite plan
    // ownership or a live incident's account in place, with no version bump and no audit event.
    // -------------------------------------------------------------------------
    describe("reads hand back something a caller cannot rewrite in place", () => {
      it("returns a copy from getAssignment, so plan ownership cannot be rewritten without a write", async () => {
        const store = await newStore();
        const plan = await createActivePlan(store);
        unwrap(
          await store.applyAssignment(
            { planId: plan.plan.id, action: { type: "claim", actorId: COORDINATOR_A.id } },
            writeContext(COORDINATOR_A, "copy-claim"),
          ),
        );
        unwrap(
          await store.applyAssignment(
            {
              planId: plan.plan.id,
              action: {
                type: "startCoverage",
                actorId: SECOND_TEAM_LEAD_A.id,
                from: "2026-03-03",
                until: "2026-03-10",
              },
            },
            writeContext(TEAM_LEAD_A, "copy-cover"),
          ),
        );

        const first = await store.getAssignment(plan.plan.id, { actor: COORDINATOR_A });
        if (first === null) throw new Error("expected an assignment");
        first.ownerId = actorId("ACTOR-IMPOSTER");
        first.claimedAt = "1970-01-01T08:00:00+08:00";
        if (first.coveredBy !== null) first.coveredBy.actorId = actorId("ACTOR-IMPOSTER");

        const second = await store.getAssignment(plan.plan.id, { actor: COORDINATOR_A });
        expect(second?.ownerId).toBe(COORDINATOR_A.id);
        expect(second?.claimedAt).not.toBe("1970-01-01T08:00:00+08:00");
        expect(second?.coveredBy?.actorId).toBe(SECOND_TEAM_LEAD_A.id);
      });

      it("returns a service state a caller cannot rewrite in place", async () => {
        const store = await newStore();
        unwrap(
          await store.stopService(
            { reason: "wrong-recipient", note: "the original account of the incident" },
            writeContext(COORDINATOR_A, "copy-stop"),
          ),
        );

        const first = await store.getServiceState({ actor: COORDINATOR_A });
        expect(Object.isFrozen(first)).toBe(true);
        if (!first.stopped) throw new Error("expected a stopped service");
        expect(Object.isFrozen(first.restartApprovals)).toBe(true);

        const second = await store.getServiceState({ actor: AUDITOR_A });
        if (!second.stopped) throw new Error("expected a stopped service");
        expect(second.note).toBe("the original account of the incident");
        expect(second.stoppedBy).toBe(COORDINATOR_A.id);
        expect(second.reason).toBe("wrong-recipient");
      });

      it("returns a pathway version whose governed message text a caller cannot rewrite in place", async () => {
        // The one value in this store that IS the clinical message a patient receives. A reader
        // holding the live snapshot could rewrite the approved wording with no version bump, no
        // approval, and no audit event -- which is the whole of what pathway governance exists to
        // prevent. The Postgres store round-trips through `jsonb` and so copies for free; the
        // in-memory store had to be made to, which is exactly the drift a shared contract is for.
        const store = await newStore();
        const version = draftPathwayVersion(COORDINATOR_A, "EXT-PATHWAY-SNAPSHOT");
        unwrap(await store.savePathwayVersion({ version }, writeContext(COORDINATOR_A, "snapshot-save")));

        const first = await store.getPathwayVersion(version.id, { actor: COORDINATOR_A });
        if (first === null) throw new Error("expected a pathway version");
        // Positive control: the governed wording really is what the read hands back, so the
        // unchanged values below are the copy holding rather than the read returning nothing.
        expect(first.snapshot.messageTextByType.standard).toBe("Checking in.");

        const mutableSnapshot = first.snapshot as unknown as {
          cadenceLabels: string[];
          messageTextByType: Record<string, string>;
        };
        try {
          mutableSnapshot.messageTextByType.standard = "Rewritten without approval.";
          mutableSnapshot.cadenceLabels.push("Day 999");
        } catch {
          // A frozen snapshot throws in strict mode. Either defence is acceptable; what is not
          // acceptable is the write landing on the stored version.
        }

        const second = await store.getPathwayVersion(version.id, { actor: COORDINATOR_A });
        expect(second?.snapshot.messageTextByType.standard).toBe("Checking in.");
        expect(second?.snapshot.cadenceLabels).toEqual(["Day 3"]);

        const listed = (await store.listPathwayVersions({ actor: COORDINATOR_A })).find(
          (candidate) => candidate.id === version.id,
        );
        expect(listed?.snapshot.messageTextByType.standard).toBe("Checking in.");
        expect(listed?.snapshot.cadenceLabels).toEqual(["Day 3"]);

        // ...and the object the CALLER passed to `savePathwayVersion` is not the stored one either.
        const callerSnapshot = version.snapshot as unknown as { messageTextByType: Record<string, string> };
        try {
          callerSnapshot.messageTextByType.standard = "Rewritten through the caller's own object.";
        } catch {
          // Same as above: a frozen caller object is one acceptable outcome.
        }
        const third = await store.getPathwayVersion(version.id, { actor: COORDINATOR_A });
        expect(third?.snapshot.messageTextByType.standard).toBe("Checking in.");
      });
    });

    // -------------------------------------------------------------------------
    // Contact rescheduling -- Ruling 1's addition.
    // -------------------------------------------------------------------------
    describe("rescheduleContact (Ruling 1)", () => {
      it("moves a contact within its scheduled day, bumping its version", async () => {
        const store = await newStore();
        const plan = await createActivePlan(store);
        const contact = (await store.listSendableContacts(plan.plan.id, { actor: COORDINATOR_A }))[0];

        const moved = unwrap(
          await store.rescheduleContact(
            {
              planId: plan.plan.id,
              contactId: contact.contact.id,
              expectedContactVersion: contact.contact.version,
              change: { contact: contact.planned, toHour: 14, toMinute: 30 },
            },
            writeContext(COORDINATOR_A, "rc-1"),
          ),
        );
        expect(moved.planned.calendarDay).toBe(contact.planned.calendarDay);
        expect(moved.planned.sendAt.getUTCHours()).toBe(14 - 8);
        expect(moved.contact.version).toBe(contact.contact.version + 1);
      });

      it("refuses a move that leaves the scheduled day or the approved window", async () => {
        const store = await newStore();
        const plan = await createActivePlan(store);
        const contact = (await store.listSendableContacts(plan.plan.id, { actor: COORDINATOR_A }))[0];

        const outsideWindow = await store.rescheduleContact(
          {
            planId: plan.plan.id,
            contactId: contact.contact.id,
            expectedContactVersion: contact.contact.version,
            change: { contact: contact.planned, toHour: 20, toMinute: 0 },
          },
          writeContext(COORDINATOR_A, "rc-2"),
        );
        expect(outsideWindow).toEqual({ ok: false, reason: "contact-move-outside-approved-window" });
      });

      it("changes a contact's date only with a reason and a team-lead approval, refusing a blank reason or a missing approval", async () => {
        const store = await newStore();
        const plan = await createActivePlan(store);
        const contact = (await store.listSendableContacts(plan.plan.id, { actor: COORDINATOR_A }))[0];
        const targetDay = "2026-03-20";

        const blankReason = await store.rescheduleContact(
          {
            planId: plan.plan.id,
            contactId: contact.contact.id,
            expectedContactVersion: contact.contact.version,
            change: {
              contact: contact.planned,
              toCalendarDay: targetDay,
              reason: "  ",
              teamLeadApprovalActorId: TEAM_LEAD_A.id,
            },
          },
          writeContext(TEAM_LEAD_A, "rc-3"),
        );
        expect(blankReason).toEqual({ ok: false, reason: "contact-date-change-reason-required" });

        const missingApproval = await store.rescheduleContact(
          {
            planId: plan.plan.id,
            contactId: contact.contact.id,
            expectedContactVersion: contact.contact.version,
            change: {
              contact: contact.planned,
              toCalendarDay: targetDay,
              reason: "patient request",
              teamLeadApprovalActorId: null,
            },
          },
          writeContext(TEAM_LEAD_A, "rc-4"),
        );
        expect(missingApproval).toEqual({ ok: false, reason: "contact-date-change-approval-required" });

        const changed = unwrap(
          await store.rescheduleContact(
            {
              planId: plan.plan.id,
              contactId: contact.contact.id,
              expectedContactVersion: contact.contact.version,
              change: {
                contact: contact.planned,
                toCalendarDay: targetDay,
                reason: "patient request",
                teamLeadApprovalActorId: TEAM_LEAD_A.id,
              },
            },
            writeContext(TEAM_LEAD_A, "rc-5"),
          ),
        );
        expect(changed.planned.calendarDay).toBe(targetDay);
      });

      it("refuses a coordinator changing a contact's date -- only changeContactDate holders may", async () => {
        const store = await newStore();
        const plan = await createActivePlan(store);
        const contact = (await store.listSendableContacts(plan.plan.id, { actor: COORDINATOR_A }))[0];

        const denied = await store.rescheduleContact(
          {
            planId: plan.plan.id,
            contactId: contact.contact.id,
            expectedContactVersion: contact.contact.version,
            change: {
              contact: contact.planned,
              toCalendarDay: "2026-03-20",
              reason: "cover",
              teamLeadApprovalActorId: TEAM_LEAD_A.id,
            },
          },
          writeContext(COORDINATOR_A, "rc-6"),
        );
        expect(denied).toEqual({ ok: false, reason: REPOSITORY_REFUSALS.permissionDenied });
      });

      it("refuses a stale contact version", async () => {
        const store = await newStore();
        const plan = await createActivePlan(store);
        const contact = (await store.listSendableContacts(plan.plan.id, { actor: COORDINATOR_A }))[0];

        const stale = await store.rescheduleContact(
          {
            planId: plan.plan.id,
            contactId: contact.contact.id,
            expectedContactVersion: contact.contact.version + 5,
            change: { contact: contact.planned, toHour: 11, toMinute: 0 },
          },
          writeContext(COORDINATOR_A, "rc-7"),
        );
        expect(stale).toEqual({ ok: false, reason: REPOSITORY_REFUSALS.staleVersion });
      });
    });

    // -------------------------------------------------------------------------
    // Dispatch reconciliation beyond the Ruling-2 test above.
    // -------------------------------------------------------------------------
    describe("dispatch reconciliation", () => {
      async function dispatchedContact(store: CaringContactRepository) {
        const plan = await createActivePlan(store);
        const contact = (await store.listSendableContacts(plan.plan.id, { actor: COORDINATOR_A }))[0];
        await store.startContactDispatch(
          { planId: plan.plan.id, contactId: contact.contact.id, expectedContactVersion: contact.contact.version },
          writeContext(DISPATCHER_A, `dispatch-${contact.contact.id}`),
        );
        return { plan, contact };
      }

      it("refuses resolving an unknown attempt, a role without reconcileProviderDispatch, a blank note, and a repeat resolution", async () => {
        const store = await newStore();
        const { contact } = await dispatchedContact(store);

        const missing = await store.resolveDispatchDiscrepancy(
          { contactId: contact.contact.id, attempt: 99, resolution: "confirmedDelivered", note: "n/a" },
          writeContext(COORDINATOR_A, "rd-1"),
        );
        expect(missing).toEqual({ ok: false, reason: REPOSITORY_REFUSALS.notFound });

        const denied = await store.resolveDispatchDiscrepancy(
          { contactId: contact.contact.id, attempt: 1, resolution: "confirmedDelivered", note: "confirmed via portal" },
          writeContext(AUDITOR_A, "rd-2"),
        );
        expect(denied).toEqual({ ok: false, reason: REPOSITORY_REFUSALS.permissionDenied });

        const blankNote = await store.resolveDispatchDiscrepancy(
          { contactId: contact.contact.id, attempt: 1, resolution: "confirmedDelivered", note: " " },
          writeContext(COORDINATOR_A, "rd-3"),
        );
        expect(blankNote).toEqual({ ok: false, reason: REPOSITORY_REFUSALS.dispatchDiscrepancyNoteRequired });

        const resolved = unwrap(
          await store.resolveDispatchDiscrepancy(
            {
              contactId: contact.contact.id,
              attempt: 1,
              resolution: "confirmedDelivered",
              note: "confirmed via portal",
            },
            writeContext(COORDINATOR_A, "rd-4"),
          ),
        );
        expect(resolved.discrepancyResolution).toBe("confirmedDelivered");

        const repeat = await store.resolveDispatchDiscrepancy(
          { contactId: contact.contact.id, attempt: 1, resolution: "confirmedNotDelivered", note: "changed my mind" },
          writeContext(COORDINATOR_A, "rd-5"),
        );
        expect(repeat).toEqual({ ok: false, reason: REPOSITORY_REFUSALS.dispatchDiscrepancyAlreadyResolved });
      });

      it("scopes listDispatches to the actor's team and the reconcileProviderDispatch grant", async () => {
        const store = await newStore();
        await dispatchedContact(store);

        const wideRange = { fromIso: "2020-01-01T00:00:00.000Z", toIso: "2030-01-01T00:00:00.000Z" };
        expect(await store.listDispatches(wideRange, { actor: COORDINATOR_A })).toHaveLength(1);
        expect(await store.listDispatches(wideRange, { actor: COORDINATOR_B })).toEqual([]);
        expect(await store.listDispatches(wideRange, { actor: AUDITOR_A })).toEqual([]);

        const narrowRange = { fromIso: "2020-01-01T00:00:00.000Z", toIso: "2020-01-02T00:00:00.000Z" };
        expect(await store.listDispatches(narrowRange, { actor: COORDINATOR_A })).toEqual([]);
      });
    });

    // -------------------------------------------------------------------------
    // Access trail
    // -------------------------------------------------------------------------
    describe("access trail", () => {
      it("throws rather than record a non-identifier-shaped objectId (a search term or a name)", async () => {
        const store = await newStore();
        await expect(
          store.recordAccess({
            actorId: COORDINATOR_A.id,
            actorRoles: ["coordinator"],
            teamId: COORDINATOR_A.teamId,
            kind: "search",
            objectType: "patientDirectory",
            objectId: "Rowan Sample",
            outcome: "allowed",
          }),
        ).rejects.toThrow(AuditEventContainsPatientDataError);
      });

      it("still records access while the service is stopped -- the trail must not go dark mid-incident", async () => {
        const store = await newStore();
        const plan = await createActivePlan(store);
        await store.stopService(
          { reason: "audit-integrity-loss", note: "trail gap" },
          writeContext(COORDINATOR_A, "s-access"),
        );

        await store.recordAccess({
          actorId: AUDITOR_A.id,
          actorRoles: ["auditor"],
          teamId: AUDITOR_A.teamId,
          kind: "view",
          objectType: "plan",
          objectId: plan.plan.id,
          outcome: "allowed",
        });

        const trail = await store.listAccessTrail({ limit: 50, offset: 0 }, { actor: AUDITOR_A });
        expect(trail.some((event) => event.action === "access:view:plan")).toBe(true);
      });

      it("scopes listAccessTrail to viewAccessTrail (the auditor), returning empty for a coordinator", async () => {
        const store = await newStore();
        const plan = await createActivePlan(store);
        await store.recordAccess({
          actorId: COORDINATOR_A.id,
          actorRoles: ["coordinator"],
          teamId: COORDINATOR_A.teamId,
          kind: "view",
          objectType: "plan",
          objectId: plan.plan.id,
          outcome: "allowed",
        });

        expect(await store.listAccessTrail({ limit: 10, offset: 0 }, { actor: COORDINATOR_A })).toEqual([]);
        // Naming the recorded access, not merely counting: the plan writes above already put events
        // in this trail, so a non-empty count alone would pass without the access ever being visible.
        const auditorTrail = await store.listAccessTrail({ limit: 50, offset: 0 }, { actor: AUDITOR_A });
        expect(auditorTrail.map((event) => event.action)).toContain("access:view:plan");
      });

      it("applies the objectType and limit/offset filters", async () => {
        const store = await newStore();
        const plan = await createActivePlan(store);
        for (let i = 0; i < 3; i += 1) {
          await store.recordAccess({
            actorId: AUDITOR_A.id,
            actorRoles: ["auditor"],
            teamId: AUDITOR_A.teamId,
            kind: "view",
            objectType: "plan",
            objectId: plan.plan.id,
            outcome: "allowed",
          });
        }
        await store.recordAccess({
          actorId: AUDITOR_A.id,
          actorRoles: ["auditor"],
          teamId: AUDITOR_A.teamId,
          kind: "search",
          objectType: "patientDirectory",
          objectId: "patientDirectory",
          outcome: "allowed",
        });

        const onlyDirectory = await store.listAccessTrail(
          { limit: 10, offset: 0, objectType: "patientDirectory" },
          { actor: AUDITOR_A },
        );
        expect(onlyDirectory).toHaveLength(1);

        const firstOfTwo = await store.listAccessTrail(
          { limit: 2, offset: 0, objectType: "plan" },
          { actor: AUDITOR_A },
        );
        expect(firstOfTwo).toHaveLength(2);
      });
    });

    // -------------------------------------------------------------------------
    // Notification preferences
    // -------------------------------------------------------------------------
    describe("notification preferences", () => {
      it("defaults a new actor to opted in to nothing, then persists a save", async () => {
        const store = await newStore();
        const initial = await store.getNotificationPreferences({ actor: COORDINATOR_A });
        expect(initial).toEqual({ actorId: COORDINATOR_A.id, optedIn: [] });

        const saved = unwrap(
          await store.saveNotificationPreferences(
            { actorId: COORDINATOR_A.id, optedIn: ["serviceSafetyStop", "unclaimedWorkEscalation"] },
            writeContext(COORDINATOR_A, "np-1"),
          ),
        );
        expect(saved.optedIn).toEqual(["serviceSafetyStop", "unclaimedWorkEscalation"]);
        expect(await store.getNotificationPreferences({ actor: COORDINATOR_A })).toEqual(saved);
      });

      it("refuses saving another actor's preferences, and a system actor's own", async () => {
        const store = await newStore();
        const impersonating = await store.saveNotificationPreferences(
          { actorId: TEAM_LEAD_A.id, optedIn: ["serviceSafetyStop"] },
          writeContext(COORDINATOR_A, "np-2"),
        );
        expect(impersonating).toEqual({ ok: false, reason: REPOSITORY_REFUSALS.permissionDenied });

        const asDispatcher = await store.saveNotificationPreferences(
          { actorId: DISPATCHER_A.id, optedIn: ["serviceSafetyStop"] },
          writeContext(DISPATCHER_A, "np-3"),
        );
        expect(asDispatcher).toEqual({ ok: false, reason: REPOSITORY_REFUSALS.permissionDenied });
      });

      it("keeps preferences scoped per actor, not shared across the team", async () => {
        const store = await newStore();
        await store.saveNotificationPreferences(
          { actorId: COORDINATOR_A.id, optedIn: ["pathwayRetired"] },
          writeContext(COORDINATOR_A, "np-4"),
        );
        const teamLeadPrefs = await store.getNotificationPreferences({ actor: TEAM_LEAD_A });
        expect(teamLeadPrefs).toEqual({ actorId: TEAM_LEAD_A.id, optedIn: [] });
      });
    });

    // -------------------------------------------------------------------------
    // Training
    // -------------------------------------------------------------------------
    describe("training", () => {
      it("starts empty, records competencies idempotently, and refuses a role without enterTrainingMode", async () => {
        const store = await newStore();
        expect(await store.getTrainingRecord({ actor: COORDINATOR_A })).toEqual({
          actorId: COORDINATOR_A.id,
          completed: [],
        });

        const first = unwrap(
          await store.recordTrainingCompetency({ competency: "activation" }, writeContext(COORDINATOR_A, "tc-1")),
        );
        expect(first.completed).toEqual(["activation"]);

        const replayedCompetency = unwrap(
          await store.recordTrainingCompetency({ competency: "activation" }, writeContext(COORDINATOR_A, "tc-2")),
        );
        expect(replayedCompetency.completed).toEqual(["activation"]);

        const denied = await store.recordTrainingCompetency(
          { competency: "withdrawal" },
          writeContext(DISPATCHER_A, "tc-3"),
        );
        expect(denied).toEqual({ ok: false, reason: REPOSITORY_REFUSALS.permissionDenied });
      });

      it("keeps training records scoped per actor", async () => {
        const store = await newStore();
        await store.recordTrainingCompetency({ competency: "downtime" }, writeContext(COORDINATOR_A, "tc-4"));
        expect(await store.getTrainingRecord({ actor: TEAM_LEAD_A })).toEqual({
          actorId: TEAM_LEAD_A.id,
          completed: [],
        });
      });
    });

    // -------------------------------------------------------------------------
    // Clearing an episode's identifying detail
    // -------------------------------------------------------------------------
    describe("markRetentionCleared", () => {
      it("marks a plan cleared, refuses an unknown plan, and refuses a role without the grant", async () => {
        const store = await newStore();
        const plan = await createActivePlan(store);

        const denied = await store.markRetentionCleared({ planId: plan.plan.id }, writeContext(AUDITOR_A, "mrc-1"));
        expect(denied).toEqual({ ok: false, reason: REPOSITORY_REFUSALS.permissionDenied });

        // An OPEN episode has no completion instant, and ../retention's own precondition says an
        // episode that has not completed is never due for de-identification. Marking cleared
        // something that could never have been due is nonsense rather than an edge case, so it is
        // refused by name -- not accepted with nothing written, which would leave a later purge
        // unable to find the episode at all.
        const stillOpen = await store.markRetentionCleared(
          { planId: plan.plan.id },
          writeContext(COORDINATOR_A, "mrc-2"),
        );
        expect(stillOpen).toEqual({ ok: false, reason: "retention-episode-not-terminal" });

        const missing = await store.markRetentionCleared(
          { planId: planId("EXT-PLAN-MISSING") },
          writeContext(COORDINATOR_A, "mrc-3"),
        );
        expect(missing).toEqual({ ok: false, reason: REPOSITORY_REFUSALS.notFound });
      });

      it("clears an episode that has actually ended", async () => {
        const store = await newStore();
        const plan = await createActivePlan(store);
        const ended = unwrap(
          await store.withdrawPlan(
            { planId: plan.plan.id, expectedVersion: plan.plan.version, origin: "patient" },
            writeContext(COORDINATOR_A, "mrc-withdraw"),
          ),
        );
        // Positive control: the episode really did reach a terminal state and record when, so the
        // acceptance below is the rule admitting it rather than the rule not being asked.
        expect(ended.plan.state).toBe("withdrawn");
        expect(ended.completedAt).not.toBeNull();

        const cleared = await store.markRetentionCleared(
          { planId: plan.plan.id },
          writeContext(COORDINATOR_A, "mrc-5"),
        );
        expect(cleared).toEqual({ ok: true, value: undefined });
      });

      it("actually removes the identifying detail, rather than only recording that it was cleared", async () => {
        // Ruling 64. `cleared_at` used to be the ONLY thing this write touched: the plan kept the
        // patient's name, mobile number, identifiers and cultural identity, and `getEpisode` handed
        // all four back afterwards -- so anything reading the clearance record concluded a clearance
        // had happened that never had. A column named `cleared_at` must mean cleared.
        const store = await newStore();
        const plan = await createActivePlan(store);
        unwrap(
          await store.withdrawPlan(
            { planId: plan.plan.id, expectedVersion: plan.plan.version, origin: "patient" },
            writeContext(COORDINATOR_A, "mrc-deid-withdraw"),
          ),
        );

        // Positive control: every field this write must remove is genuinely present first, so the
        // absences below are the clearance acting rather than the fixture never having held them.
        const before = await store.getEpisode(plan.plan.id, { actor: TEAM_LEAD_A });
        expect(before?.patientName).toBe(PATIENT_DETAIL.patientName);
        expect(before?.patientMobileNumber).toBe(PATIENT_DETAIL.patientMobileNumber);
        expect(before?.patientIdentifiers).toEqual([...PATIENT_DETAIL.patientIdentifiers]);

        unwrap(await store.markRetentionCleared({ planId: plan.plan.id }, writeContext(COORDINATOR_A, "mrc-deid")));

        const after = await store.getEpisode(plan.plan.id, { actor: TEAM_LEAD_A });
        // The episode is still THERE -- de-identification keeps everything aggregate reporting
        // needs. It is the four identifying fields, and only those, that are gone.
        expect(after).not.toBeNull();
        expect(after?.state).toBe("withdrawn");
        expect(after?.pathwayVersionId).toBe(plan.pathwayVersionId);
        expect(after?.counts.contactsScheduled).toBe(before?.counts.contactsScheduled);
        expect(after?.planDates.completedAt).toEqual(before?.planDates.completedAt);

        expect(after?.patientName).toBe("");
        expect(after?.patientMobileNumber).toBe("");
        expect(after?.patientIdentifiers).toEqual([]);
        expect(after?.culturalIdentity).toBeNull();
        expect(JSON.stringify(after)).not.toContain("Jordan");
        expect(JSON.stringify(after)).not.toContain("491 570 156");
        expect(JSON.stringify(after)).not.toContain("UR-00219384");
      });

      it("clears the cultural-identity report too, which lives outside the plan row", async () => {
        // Cultural identity is deliberately held in its own projection rather than on the plan, so
        // a store that de-identified only the plan row would leave it behind -- and it is one of the
        // four fields ../retention names.
        const store = await newStore();
        const referral = referralId("EXT-REFERRAL-CULTURAL");
        const pathway = "EXT-PATHWAY-CULTURAL";
        const patient = patientId("EXT-PATIENT-CULTURAL");
        const cultural = planId("EXT-PLAN-CULTURAL");

        unwrap(
          await store.createReferral(
            { referralId: referral, patientId: patient },
            writeContext(COORDINATOR_A, "cul-r"),
          ),
        );
        unwrap(
          await store.savePathwayVersion(
            { version: draftPathwayVersion(COORDINATOR_A, pathway) },
            writeContext(COORDINATOR_A, "cul-p"),
          ),
        );
        const created = unwrap(
          await store.createPlan(
            {
              planId: cultural,
              referralId: referral,
              patientId: patient,
              pathwayVersionId: pathwayVersionId(pathway),
              dischargeAt: DISCHARGE_AT,
              sendingPreference: "morning",
              patientDetail: { ...PATIENT_DETAIL, culturalIdentity: "Noongar" },
            },
            writeContext(COORDINATOR_A, "cul-create"),
          ),
        );
        const activated = unwrap(
          await store.activatePlan(
            { planId: cultural, expectedVersion: created.plan.version },
            writeContext(COORDINATOR_A, "cul-activate"),
          ),
        );
        unwrap(
          await store.withdrawPlan(
            { planId: cultural, expectedVersion: activated.plan.version, origin: "patient" },
            writeContext(COORDINATOR_A, "cul-withdraw"),
          ),
        );

        expect((await store.getEpisode(cultural, { actor: TEAM_LEAD_A }))?.culturalIdentity).toBe("Noongar");

        unwrap(await store.markRetentionCleared({ planId: cultural }, writeContext(COORDINATOR_A, "cul-clear")));

        expect((await store.getEpisode(cultural, { actor: TEAM_LEAD_A }))?.culturalIdentity).toBeNull();
      });

      it("refuses while the service is stopped, like every other ordinary mutation", async () => {
        const store = await newStore();
        const plan = await createActivePlan(store);
        await store.stopService({ reason: "wrong-recipient", note: "n/a" }, writeContext(COORDINATOR_A, "s-clear"));

        const refused = await store.markRetentionCleared(
          { planId: plan.plan.id },
          writeContext(COORDINATOR_A, "mrc-4"),
        );
        expect(refused).toEqual({ ok: false, reason: REPOSITORY_REFUSALS.serviceStopped });
      });
    });

    // -------------------------------------------------------------------------
    // Every new write group routes through the audited write path.
    //
    // The shared write helper is only proof that a write CAN audit; it says nothing about whether a
    // given method goes through it. A method that committed straight to its own storage would pass
    // every other test here -- `recordAccess` already commits outside that helper by design, so this
    // is not hypothetical. One representative write per new group, checked for the exact event it
    // must append and for the fact that it appends exactly one.
    // -------------------------------------------------------------------------
    describe("every new write group appends its own audit event", () => {
      const auditedWrites: readonly {
        group: string;
        action: string;
        /** Sets the store up, then returns the single write whose audit events are measured. */
        arrange: (store: CaringContactRepository) => Promise<() => Promise<{ ok: boolean }>>;
      }[] = [
        {
          group: "referrals",
          action: "createReferral",
          arrange: async (store) => () =>
            store.createReferral(
              { referralId: referralId("EXT-REF-AUDIT"), patientId: patientId("EXT-PAT-AUDIT") },
              writeContext(COORDINATOR_A, "audit-referral"),
            ),
        },
        {
          group: "pathway versions",
          action: "savePathwayVersion",
          arrange: async (store) => {
            const version = draftPathwayVersion();
            return () => store.savePathwayVersion({ version }, writeContext(COORDINATOR_A, "audit-pathway"));
          },
        },
        {
          group: "service state",
          action: "stopService",
          arrange: async (store) => () =>
            store.stopService(
              { reason: "wrong-recipient", note: "a message reached a number nobody recognised" },
              writeContext(COORDINATOR_A, "audit-stop"),
            ),
        },
        {
          group: "assignment",
          action: "applyAssignment",
          arrange: async (store) => {
            const plan = await createActivePlan(store);
            return () =>
              store.applyAssignment(
                { planId: plan.plan.id, action: { type: "claim", actorId: COORDINATOR_A.id } },
                writeContext(COORDINATOR_A, "audit-assignment"),
              );
          },
        },
        {
          group: "dispatch reconciliation",
          action: "resolveDispatchDiscrepancy",
          arrange: async (store) => {
            const plan = await createActivePlan(store);
            const contact = (await store.listSendableContacts(plan.plan.id, { actor: COORDINATOR_A }))[0];
            await store.startContactDispatch(
              { planId: plan.plan.id, contactId: contact.contact.id, expectedContactVersion: contact.contact.version },
              writeContext(DISPATCHER_A, "audit-dispatch"),
            );
            return () =>
              store.resolveDispatchDiscrepancy(
                {
                  contactId: contact.contact.id,
                  attempt: 1,
                  resolution: "confirmedDelivered",
                  note: "confirmed in the portal",
                },
                writeContext(COORDINATOR_A, "audit-resolve"),
              );
          },
        },
        {
          group: "notification preferences",
          action: "saveNotificationPreferences",
          arrange: async (store) => () =>
            store.saveNotificationPreferences(
              { actorId: COORDINATOR_A.id, optedIn: ["serviceSafetyStop"] },
              writeContext(COORDINATOR_A, "audit-prefs"),
            ),
        },
        {
          group: "training",
          action: "recordTrainingCompetency",
          arrange: async (store) => () =>
            store.recordTrainingCompetency({ competency: "activation" }, writeContext(COORDINATOR_A, "audit-training")),
        },
        {
          group: "clearing identifying detail",
          action: "markRetentionCleared",
          arrange: async (store) => {
            const plan = await createActivePlan(store);
            // Ended first: a clearance is only admissible for an episode that has actually ended.
            unwrap(
              await store.withdrawPlan(
                { planId: plan.plan.id, expectedVersion: plan.plan.version, origin: "patient" },
                writeContext(COORDINATOR_A, "audit-clear-withdraw"),
              ),
            );
            return () =>
              store.markRetentionCleared({ planId: plan.plan.id }, writeContext(COORDINATOR_A, "audit-clear"));
          },
        },
        {
          group: "contact rescheduling",
          action: "rescheduleContact",
          arrange: async (store) => {
            const plan = await createActivePlan(store);
            const contact = (await store.listSendableContacts(plan.plan.id, { actor: COORDINATOR_A }))[0];
            return () =>
              store.rescheduleContact(
                {
                  planId: plan.plan.id,
                  contactId: contact.contact.id,
                  expectedContactVersion: contact.contact.version,
                  change: { contact: contact.planned, toHour: 14, toMinute: 0 },
                },
                writeContext(COORDINATOR_A, "audit-reschedule"),
              );
          },
        },
      ];

      for (const { group, action, arrange } of auditedWrites) {
        it(`appends exactly one "${action}" event for a ${group} write`, async () => {
          const store = await newStore();
          const write = await arrange(store);
          const before = await store.listAuditEvents({ actor: AUDITOR_A });

          const result = await write();
          expect(result.ok).toBe(true);

          const after = await store.listAuditEvents({ actor: AUDITOR_A });
          expect(after.slice(before.length).map((event) => event.action)).toEqual([action]);
        });
      }
    });

    // -------------------------------------------------------------------------
    // Cross-cutting proof that the roleless actor is refused across every new write, and every new
    // read is unusable to the dispatcher (the system actor gets no read access at all, unchanged).
    // -------------------------------------------------------------------------
    describe("cross-cutting: no-roles and system-actor boundaries hold for the new surface too", () => {
      it("refuses a roleless actor on a representative new write", async () => {
        const store = await newStore();
        const refused = await store.createReferral(
          { referralId: referralId("EXT-REF-ROLELESS"), patientId: patientId("EXT-PAT-ROLELESS") },
          writeContext(ROLELESS_A, "cr-roleless"),
        );
        expect(refused).toEqual({ ok: false, reason: REPOSITORY_REFUSALS.permissionDenied });
      });

      it("gives the dispatcher no read access to the new surfaces either", async () => {
        const store = await newStore();
        const plan = await createActivePlan(store);
        await store.createReferral(
          { referralId: referralId("EXT-REF-DISPATCHER-CHECK"), patientId: patientId("EXT-PAT-DISPATCHER-CHECK") },
          writeContext(COORDINATOR_A, "cr-dispatcher-check"),
        );

        // Positive control: the referral really is there for an actor whose role covers it.
        expect(await store.listReferrals({ actor: COORDINATOR_A })).not.toEqual([]);

        expect(await store.getAssignment(plan.plan.id, { actor: DISPATCHER_A })).toBeNull();
        expect(await store.listReferrals({ actor: DISPATCHER_A })).toEqual([]);
        expect(await store.listAccessTrail({ limit: 10, offset: 0 }, { actor: DISPATCHER_A })).toEqual([]);
      });
    });
  });
}
