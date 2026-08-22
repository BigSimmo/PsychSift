// tests/helpers/caring-contacts-postgres.ts
//
// Connection, migration, and transaction plumbing for the caring-contact database suites.
//
// Two rules this file exists to hold:
//
//   * it NEVER skips. `caringContactsDatabaseUrl()` throws, naming the variable, when no database
//     is configured. Row-level security is the control that stops one hospital team seeing
//     another team's patients; a suite that goes green when the database is absent has proven
//     nothing and said it proved everything.
//   * every statement runs as `caring_contacts_app` or `caring_contacts_anon`, never as the
//     migration superuser. A superuser bypasses row-level security entirely, so a policy test run
//     as one is a test that cannot fail.
//
// Not named *.test.ts on purpose: helpers here are collected by no vitest project.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { Pool, type PoolClient } from "pg";

import type { SqlConnectionPool, SqlRow } from "@/lib/caring-contacts/db/postgres-repository";

export const CARING_CONTACTS_DATABASE_URL_VARIABLE = "CARING_CONTACTS_DATABASE_URL";

export const CARING_CONTACTS_MIGRATIONS_DIR = path.join(process.cwd(), "caring-contacts", "supabase", "migrations");

/** The application role every repository statement runs as. Holds no BYPASSRLS. */
export const APP_ROLE = "caring_contacts_app";
/** The unauthenticated role. Granted SELECT, matched by no policy — so it sees nothing. */
export const ANON_ROLE = "caring_contacts_anon";

/** Throws, naming the variable, rather than letting a suite skip itself into a false green. */
export function caringContactsDatabaseUrl(): string {
  const raw = process.env[CARING_CONTACTS_DATABASE_URL_VARIABLE];
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new Error(
      `${CARING_CONTACTS_DATABASE_URL_VARIABLE} is not set, so the caring-contact database suites ` +
        "cannot run. They are never skipped. Start a disposable local Postgres, for example " +
        "`docker run --rm -d --name caring-contacts-pg -e POSTGRES_PASSWORD=caring-contacts-local " +
        "-p 54329:5432 postgres:17`, then set " +
        `${CARING_CONTACTS_DATABASE_URL_VARIABLE}=postgres://postgres:caring-contacts-local@127.0.0.1:54329/postgres`,
    );
  }
  return raw.trim();
}

export type CaringContactMigration = { name: string; sql: string };

/**
 * Every `.sql` file under `caring-contacts/supabase/migrations`, in lexical order. Throws when the
 * directory is missing or empty: an empty migration set silently applying nothing is how a schema
 * suite reports green against a schema that does not exist.
 */
export function caringContactsMigrations(): CaringContactMigration[] {
  if (!existsSync(CARING_CONTACTS_MIGRATIONS_DIR)) {
    throw new Error(`no caring-contact migration directory at ${CARING_CONTACTS_MIGRATIONS_DIR}`);
  }
  const names = readdirSync(CARING_CONTACTS_MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  if (names.length === 0) {
    throw new Error(`no caring-contact migrations found in ${CARING_CONTACTS_MIGRATIONS_DIR}`);
  }
  return names.map((name) => ({
    name,
    sql: readFileSync(path.join(CARING_CONTACTS_MIGRATIONS_DIR, name), "utf8"),
  }));
}

export function createCaringContactsTestPool(): Pool {
  return new Pool({ connectionString: caringContactsDatabaseUrl(), max: 8 });
}

/** Drops the schema so a run always starts from the migrations rather than from leftovers. */
export async function dropCaringContactsSchema(pool: Pool): Promise<void> {
  await pool.query("drop schema if exists caring_contacts cascade");
}

export async function applyCaringContactsMigrations(pool: Pool): Promise<void> {
  for (const migration of caringContactsMigrations()) {
    try {
      await pool.query(migration.sql);
    } catch (error) {
      throw new Error(`caring-contact migration ${migration.name} failed: ${(error as Error).message}`);
    }
  }
}

/** Every table the suites write to, child-first, so truncation between tests is FK-safe. */
export const CARING_CONTACTS_DATA_TABLES: readonly string[] = Object.freeze([
  "caring_contacts.contact_dispatches",
  "caring_contacts.cultural_identity_reports",
  "caring_contacts.retention_state",
  "caring_contacts.plan_reassignments",
  "caring_contacts.plan_assignments",
  "caring_contacts.contacts",
  "caring_contacts.plans",
  "caring_contacts.referrals",
  "caring_contacts.pathway_version_approvals",
  "caring_contacts.pathway_versions",
  "caring_contacts.notification_preferences",
  "caring_contacts.training_records",
  "caring_contacts.idempotency_records",
  "caring_contacts.audit_events",
  // The service stop is a singleton rather than per-team data, and it is truncated between tests
  // ON PURPOSE. It is the one row whose presence changes the answer for every other test in the
  // file: a stop left standing would have the domain refuse every subsequent send, and the
  // resulting cascade of failures would read as a schema fault rather than as leaked state.
  "caring_contacts.service_restart_approvals",
  "caring_contacts.service_state",
  "caring_contacts.service_stops",
  "caring_contacts.actors",
  "caring_contacts.teams",
]);

/** Runs as the migration superuser deliberately: emptying the schema is not a policy question. */
export async function truncateCaringContactsData(pool: Pool): Promise<void> {
  await pool.query(`truncate table ${CARING_CONTACTS_DATA_TABLES.join(", ")} restart identity cascade`);
}

export type SessionOptions = {
  /** The team the session is scoped to. Omit to prove the deny-by-default path. */
  teamId?: string | null;
  role?: string;
  /** Set to open an audited transaction. Omit to prove that an unaudited change is refused. */
  auditToken?: string | null;
};

/**
 * Runs `work` inside one transaction as a non-superuser role, with the team scope (and optionally
 * the audit token) set transaction-locally. The commit is inside the try, so a deferred constraint
 * trigger firing at commit surfaces as a rejection from this call rather than being swallowed.
 */
export async function runInTeamSession<T>(
  pool: Pool,
  options: SessionOptions,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    try {
      await client.query("select set_config('caring_contacts.team_id', $1, true)", [options.teamId ?? ""]);
      await client.query("select set_config('caring_contacts.audit_token', $1, true)", [options.auditToken ?? ""]);
      await client.query(`set local role ${options.role ?? APP_ROLE}`);
      const value = await work(client);
      await client.query("commit");
      return value;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    }
  } finally {
    client.release();
  }
}

let auditTokenCounter = 0;

/** A fresh transaction audit token. Deterministic, so a failure names the write that produced it. */
export function nextAuditToken(): string {
  auditTokenCounter += 1;
  return `00000000-0000-4000-8000-${String(auditTokenCounter).padStart(12, "0")}`;
}

export type AuditEventRow = {
  teamId: string;
  actorId: string;
  actorRoles: readonly string[];
  action: string;
  objectType: string;
  objectId: string;
  outcome: "allowed" | "denied" | "failed";
  idempotencyKey: string;
  occurredAt?: string;
};

export async function insertAuditEvent(client: PoolClient, event: AuditEventRow): Promise<void> {
  await client.query(
    `insert into caring_contacts.audit_events
       (team_id, actor_id, actor_roles, action, object_type, object_id, outcome, idempotency_key, occurred_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      event.teamId,
      event.actorId,
      [...event.actorRoles],
      event.action,
      event.objectType,
      event.objectId,
      event.outcome,
      event.idempotencyKey,
      event.occurredAt ?? "2026-03-02T11:00:00.000+08:00",
    ],
  );
}

/** A minimal, synthetic governed-content snapshot. No real clinical wording lives in a fixture. */
const SEED_PATHWAY_SNAPSHOT = Object.freeze({
  cadenceLabels: ["Contact 1", "Contact 2"],
  messageTextByType: Object.freeze({
    standard: "Thinking of you.",
    first: "Thinking of you after your stay.",
    closing: "This is the last of these notes. Thinking of you.",
  }),
});

export type SeedPlanOptions = {
  teamId: string;
  planId: string;
  patientId: string;
  state?: string;
  contactCount?: number;
};

/** Provisions a team and one plan with contacts, through the audited path a real write uses. */
export async function seedPlan(pool: Pool, options: SeedPlanOptions): Promise<void> {
  const { teamId, planId, patientId } = options;
  const state = options.state ?? "active";
  const contactCount = options.contactCount ?? 2;

  await runInTeamSession(pool, { teamId, auditToken: nextAuditToken() }, async (client) => {
    await client.query("insert into caring_contacts.teams (id) values ($1) on conflict (id) do nothing", [teamId]);
    await insertAuditEvent(client, {
      teamId,
      actorId: "SEED-ACTOR",
      actorRoles: ["coordinator"],
      action: "createPlan",
      objectType: "plan",
      objectId: planId,
      outcome: "allowed",
      idempotencyKey: `seed-${planId}`,
    });
    const terminal = ["withdrawn", "cancelled", "completed"].includes(state);
    // The parent rows the two composite foreign keys on `plans` now require. Both are created in
    // this same audited transaction and in this same team, because `plans (referral_id, team_id)`
    // and `plans (pathway_version_id, team_id)` are same-team keys: a fixture that reached across
    // teams for either one would be refused by the database exactly as a real write would be.
    await client.query(
      `insert into caring_contacts.pathway_versions
         (id, team_id, state, author_id, approver_id, published_at, snapshot)
       values ($1, $2, 'approved', 'SEED-AUTHOR', 'SEED-APPROVER', now(), $3::jsonb)
       on conflict (id) do nothing`,
      [`${planId}-PATHWAY`, teamId, JSON.stringify(SEED_PATHWAY_SNAPSHOT)],
    );
    await client.query(
      `insert into caring_contacts.referrals (id, team_id, patient_id, state, pathway_version_id)
       values ($1, $2, $3, 'accepted', $4)
       on conflict (id) do nothing`,
      [`${planId}-REFERRAL`, teamId, patientId, `${planId}-PATHWAY`],
    );
    await client.query(
      `insert into caring_contacts.plans
         (id, team_id, patient_id, referral_id, pathway_version_id, state, version, outcome,
          discharge_at, completed_at, sending_preference, patient_name, patient_mobile_number, patient_identifiers)
       values ($1, $2, $3, $4, $5, $6, 1, $7, '2026-03-02T02:00:00.000Z', $8, 'morning',
               'Seed Patient', '+61 491 570 156', array['UR-1'])`,
      [
        planId,
        teamId,
        patientId,
        `${planId}-REFERRAL`,
        `${planId}-PATHWAY`,
        state,
        terminal ? state : "inProgress",
        terminal ? "2026-03-04T02:00:00.000Z" : null,
      ],
    );
    for (let sequence = 1; sequence <= contactCount; sequence += 1) {
      await client.query(
        `insert into caring_contacts.contacts
           (id, plan_id, team_id, sequence, state, version, cadence_label, calendar_day, send_at, message_type)
         values ($1, $2, $3, $4, 'scheduled', 1, $5, '2026-03-03', '2026-03-03T02:00:00.000Z', 'standard')`,
        [`${planId}--contact-${sequence}`, planId, teamId, sequence, `Contact ${sequence}`],
      );
    }
  });
}

/**
 * Adapts a `pg` pool to the driver-free connection abstraction the Postgres store takes.
 *
 * `withConnection` holds ONE connection for the whole callback: every store transaction spans
 * several statements, and a pool that handed out a different connection per statement would break
 * both the transaction and the transaction-local team scope it depends on.
 */
export function poolAsSqlConnectionPool(pool: Pool): SqlConnectionPool {
  return {
    async withConnection(work) {
      const client = await pool.connect();
      try {
        return await work({
          async query(text, values) {
            const result = await client.query(text, values ? [...values] : undefined);
            return { rows: result.rows as SqlRow[], rowCount: result.rowCount ?? 0 };
          },
        });
      } finally {
        client.release();
      }
    },
  };
}
