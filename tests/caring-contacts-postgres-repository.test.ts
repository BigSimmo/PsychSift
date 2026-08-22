// tests/caring-contacts-postgres-repository.test.ts
//
// The SAME store contract as tests/caring-contacts-repository.test.ts, run against the Postgres
// implementation. One suite, two factories: every proof made in Tasks 9 and 10 was made against
// the in-memory store, and duplicating the tests would let the two stores drift apart exactly
// where the drift is least visible and most dangerous.
//
// Note what this file NO LONGER does. Task 11a gave it a `beforeEach` that pre-created the referral
// and pathway version every contract fixture names, plus a call clearing the audit trail those
// inserts produced, because migration 0003 made both links same-team foreign keys while the
// Postgres store still had no `createReferral` or `savePathwayVersion` to create them with. That
// scaffolding meant the two contract runs started from DIFFERENT preconditions and the contract
// could no longer prove this store validates its own parents. Task 11b implemented both methods, so
// the contract now creates its parents through the repository and the scaffolding is gone. Do not
// reintroduce it: a fixture that reaches around the store is a fixture the store is not being
// tested by.
//
// Needs a real Postgres named by CARING_CONTACTS_DATABASE_URL. It never skips — see
// caring-contacts/run-db-tests.mjs.
import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { fixedClock } from "@/lib/caring-contacts/clock";
import { createPostgresRepository } from "@/lib/caring-contacts/db/postgres-repository";
import {
  actorId,
  idempotencyKey,
  pathwayVersionId,
  patientId,
  planId,
  referralId,
  teamId,
} from "@/lib/caring-contacts/ids";
import type { Actor } from "@/lib/caring-contacts/permissions";

import { describeCaringContactRepositoryContract } from "./helpers/caring-contacts-repository-contract";
import {
  applyCaringContactsMigrations,
  createCaringContactsTestPool,
  dropCaringContactsSchema,
  poolAsSqlConnectionPool,
  truncateCaringContactsData,
} from "./helpers/caring-contacts-postgres";

let pool: Pool;

beforeAll(async () => {
  pool = createCaringContactsTestPool();
  await dropCaringContactsSchema(pool);
  await applyCaringContactsMigrations(pool);
}, 120_000);

// Each contract test builds its own store and expects an empty one. The schema is shared, so the
// rows are cleared between tests rather than the schema being rebuilt.
afterEach(async () => {
  await truncateCaringContactsData(pool);
});

afterAll(async () => {
  await pool?.end();
});

describeCaringContactRepositoryContract("postgres", (clock, options) =>
  createPostgresRepository(poolAsSqlConnectionPool(pool), clock, options),
);

// ---------------------------------------------------------------------------
// The reachability control for the shared contract's first-ever-stop race.
//
// That test asserts the BEHAVIOUR both stores owe: exactly one of two simultaneous first stops
// wins. What it cannot assert is that the race window was entered at all. If the two writes were
// ever serialised, the loser would be refused by the DOMAIN check rather than by the store's
// guarded singleton upsert, and the test would pass unchanged -- failing open into meaninglessness
// rather than going red. The two cases are indistinguishable by refusal reason on purpose: the
// guard deliberately answers with the reason the domain gives, so the stores cannot drift on the
// wire text. The control therefore has to come from somewhere else.
//
// It comes from the incident history. A loser that genuinely reached the window has already
// written its own `service_stops` row before losing the singleton; a serialised loser is refused before
// writing one. So TWO rows means the race happened. That table exists in one store only, which is
// why this half lives here rather than in the shared contract -- and why neither half is redundant.
// ---------------------------------------------------------------------------
describe("the first-ever-stop race is genuinely reached (postgres only)", () => {
  /** 2026-03-02 11:00 AWST, the instant the shared contract fixes its own clock to. */
  const NOW = "2026-03-02T03:00:00.000Z";

  const NORTH: Actor = {
    id: actorId("RACE-ACTOR-NORTH"),
    teamId: teamId("RACE-TEAM-NORTH"),
    roles: ["coordinator"],
  };
  const SOUTH: Actor = {
    id: actorId("RACE-ACTOR-SOUTH"),
    teamId: teamId("RACE-TEAM-SOUTH"),
    roles: ["coordinator"],
  };

  it("leaves two incident rows, proving both writers entered the window", async () => {
    const store = createPostgresRepository(poolAsSqlConnectionPool(pool), fixedClock(NOW));

    // Warm one pooled connection per caller, so neither spends its head start opening one. Two
    // TEAMS, not two actors: every write registers its own team first, and that insert queues a
    // second same-team writer until the first commits -- so same-team callers never reach the race.
    await Promise.all([store.getServiceState({ actor: NORTH }), store.getServiceState({ actor: SOUTH })]);

    const [first, second] = await Promise.all([
      store.stopService(
        { reason: "wrong-recipient", note: "the first responder's own account" },
        { actor: NORTH, idempotencyKey: idempotencyKey("race-control-north") },
      ),
      store.stopService(
        { reason: "duplicate-send", note: "a later account of something else entirely" },
        { actor: SOUTH, idempotencyKey: idempotencyKey("race-control-south") },
      ),
    ]);

    // The outcome, restated here only so a failure of the control below cannot be mistaken for a
    // failure of the behaviour the shared contract already pins.
    expect([first, second].filter((result) => result.ok)).toHaveLength(1);

    // THE CONTROL. Read as the migration role deliberately: whether the window was entered is a
    // question about the whole table, not about either team's scoped view of it.
    const incidents = await pool.query("select count(*)::int as recorded from caring_contacts.service_stops");
    expect(incidents.rows[0].recorded).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Patient detail must not reach the idempotency table.
//
// The shared contract already proves patient detail stays out of plan reads and out of the audit
// trail (see "keeps patient-identifying detail out of plan reads and the audit trail"). That check
// reads the RECORDS a store hands back, and stops one table short: `idempotency_records` is written
// by every single write, is scoped to the writing team by row-level security, and holds a
// fingerprint computed over the request -- `createPlan`'s request carries the patient's name, mobile
// number, identifiers and cultural identity, and `stopService`'s carries a responder's free-text
// incident note.
//
// This half has to live here rather than in the shared contract because the only way to ask the
// question honestly is to read the table itself, and that table exists in one store only. Read as
// the migration role deliberately: whether the row holds patient text is a question about the whole
// table, not about one team's scoped view of it.
// ---------------------------------------------------------------------------
describe("no patient detail reaches idempotency_records (postgres only)", () => {
  /** 2026-03-02 11:00 AWST, the instant the shared contract fixes its own clock to. */
  const NOW = "2026-03-02T03:00:00.000Z";

  const COORDINATOR: Actor = {
    id: actorId("IDEM-ACTOR"),
    teamId: teamId("IDEM-TEAM"),
    roles: ["coordinator"],
  };

  const PATIENT_NAME = "Jordan Nguyen";
  const PATIENT_MOBILE = "+61 491 570 156";
  const PATIENT_IDENTIFIER = "UR-00219384";
  const CULTURAL_IDENTITY = "Noongar";

  it("stores no row containing the patient's name, mobile number, identifiers or cultural identity", async () => {
    const store = createPostgresRepository(poolAsSqlConnectionPool(pool), fixedClock(NOW));
    const context = (key: string) => ({ actor: COORDINATOR, idempotencyKey: idempotencyKey(key) });

    const referral = await store.createReferral(
      { referralId: referralId("IDEM-REFERRAL"), patientId: patientId("IDEM-PATIENT") },
      context("idem-referral"),
    );
    expect(referral.ok).toBe(true);
    const pathway = await store.savePathwayVersion(
      {
        version: {
          id: pathwayVersionId("IDEM-PATHWAY"),
          teamId: COORDINATOR.teamId,
          state: "draft",
          authorId: COORDINATOR.id,
          approvals: [],
          publishedAt: null,
          retiredAt: null,
          retirementUrgency: null,
          snapshot: {
            cadenceLabels: ["Day 3"],
            messageTextByType: { standard: "Checking in.", first: "Welcome.", closing: "Last one." },
          },
        },
      },
      context("idem-pathway"),
    );
    expect(pathway.ok).toBe(true);

    const created = await store.createPlan(
      {
        planId: planId("IDEM-PLAN"),
        referralId: referralId("IDEM-REFERRAL"),
        patientId: patientId("IDEM-PATIENT"),
        pathwayVersionId: pathwayVersionId("IDEM-PATHWAY"),
        dischargeAt: new Date("2026-03-02T02:00:00.000Z"),
        sendingPreference: "morning",
        patientDetail: {
          patientName: PATIENT_NAME,
          patientMobileNumber: PATIENT_MOBILE,
          patientIdentifiers: [PATIENT_IDENTIFIER],
          culturalIdentity: CULTURAL_IDENTITY,
        },
      },
      context("idem-create"),
    );
    expect(created.ok).toBe(true);

    // Positive controls. The write really happened, it really recorded the patient detail where the
    // detail belongs, and it really wrote an idempotency row -- so an empty search below is the
    // fingerprint being opaque rather than nothing having been written at all.
    const episode = await store.getEpisode(planId("IDEM-PLAN"), { actor: COORDINATOR });
    expect(episode?.patientName).toBe(PATIENT_NAME);
    expect(episode?.culturalIdentity).toBe(CULTURAL_IDENTITY);

    const rows = await pool.query(
      "select fingerprint, result::text as result from caring_contacts.idempotency_records",
    );
    expect(rows.rows.length).toBeGreaterThan(0);

    const stored = JSON.stringify(rows.rows);
    for (const secret of [
      PATIENT_NAME,
      "Jordan",
      "Nguyen",
      PATIENT_MOBILE,
      "491 570 156",
      PATIENT_IDENTIFIER,
      CULTURAL_IDENTITY,
    ]) {
      expect(stored).not.toContain(secret);
    }
  });

  it("stores no row containing a responder's free-text incident note", async () => {
    const store = createPostgresRepository(poolAsSqlConnectionPool(pool), fixedClock(NOW));
    const note = "Reached Jordan Nguyen's old number 0491 570 156 at 09:12";

    const stopped = await store.stopService(
      { reason: "wrong-recipient", note },
      { actor: COORDINATOR, idempotencyKey: idempotencyKey("idem-stop") },
    );
    expect(stopped.ok).toBe(true);

    const rows = await pool.query("select fingerprint from caring_contacts.idempotency_records");
    expect(rows.rows.length).toBeGreaterThan(0);

    const fingerprints = JSON.stringify(rows.rows);
    for (const secret of ["Jordan", "Nguyen", "570 156", "09:12"]) {
      expect(fingerprints).not.toContain(secret);
    }
  });
});

// ---------------------------------------------------------------------------
// Ruling 65: a cross-team restart approval leaves no incident note at rest.
//
// Restart approvals are service-wide, so a TEAM-SOUTH team lead legitimately approves a TEAM-NORTH
// incident. `idempotency_records` is scoped by row-level security to the WRITING team, so the
// replay result of that approval sits in a row TEAM-SOUTH may select -- while the API boundary's
// `narrowServiceStateForActor` withholds the very same note from that actor. The two disagreed
// until `approveServiceRestart` stopped returning the note at all.
//
// Read as the migration role deliberately: whether the row holds the note is a question about the
// table, not about either team's scoped view of it.
// ---------------------------------------------------------------------------
describe("a cross-team restart approval stores no incident note (postgres only)", () => {
  /** 2026-03-02 11:00 AWST, the instant the shared contract fixes its own clock to. */
  const NOW = "2026-03-02T03:00:00.000Z";

  const NORTH: Actor = {
    id: actorId("NARROW-ACTOR-NORTH"),
    teamId: teamId("NARROW-TEAM-NORTH"),
    roles: ["coordinator"],
  };
  const SOUTH: Actor = {
    id: actorId("NARROW-ACTOR-SOUTH"),
    teamId: teamId("NARROW-TEAM-SOUTH"),
    roles: ["teamLead"],
  };

  const NOTE = "Rowan Delacroix was sent the same message twice on 491 570 156";

  it("leaves the note only in service_stops, never in the approving team's idempotency row", async () => {
    const store = createPostgresRepository(poolAsSqlConnectionPool(pool), fixedClock(NOW));

    const stopped = await store.stopService(
      { reason: "duplicate-send", note: NOTE },
      { actor: NORTH, idempotencyKey: idempotencyKey("narrow-pg-stop") },
    );
    expect(stopped.ok).toBe(true);

    const approved = await store.approveServiceRestart(
      { role: "incidentLead" },
      { actor: SOUTH, idempotencyKey: idempotencyKey("narrow-pg-approve") },
    );
    expect(approved.ok).toBe(true);

    // Positive control: the note IS held, once, in the one table that owns it. An empty search of
    // the idempotency rows below therefore means the note went nowhere else, not that it was never
    // written.
    const incidents = await pool.query("select note from caring_contacts.service_stops");
    expect(incidents.rows.map((row) => row.note)).toContain(NOTE);

    const southRows = await pool.query(
      "select fingerprint, result::text as result from caring_contacts.idempotency_records where team_id = $1",
      [SOUTH.teamId],
    );
    expect(southRows.rows.length).toBeGreaterThan(0);

    const stored = JSON.stringify(southRows.rows);
    for (const secret of ["Rowan", "Delacroix", "491 570 156", NOTE]) {
      expect(stored).not.toContain(secret);
    }
  });
});
