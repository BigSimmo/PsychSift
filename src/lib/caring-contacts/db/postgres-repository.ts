// src/lib/caring-contacts/db/postgres-repository.ts
//
// The Postgres caring-contact store. It implements the same contract as the in-memory store in
// ../in-memory-repository, and it is exercised by the SAME suite -- one contract, two factories --
// because every proof made in Tasks 9 and 10 was made against the in-memory store, and a Postgres
// store that behaved differently would carry none of them over.
//
// Two behaviours are reproduced deliberately rather than incidentally, because Task 10's findings
// depend on them:
//
//   * VERSION-CHECK ORDERING. A contact-status write resolves plan scope, then capability, then
//     the CONTACT's version, and only then asks whether the plan is still active. So a death that
//     lands while a contact is `processing` refuses on `stale-version` (the cancellation bumped
//     the contact) rather than on the plan gate -- and a dispatcher that re-reads the fresh
//     version is then refused by the contact lifecycle. Both guards are load-bearing; swapping
//     the order would silently retire one of them.
//   * THE ACTIVE-PLAN DISPATCH GATE applies to `startContactDispatch` and to nothing else. Once a
//     contact is `processing` the send is committed, and a plan change arriving mid-flight must
//     let that one contact finish rather than strand it in a state with no exit.
//
// How the database carries each contract guarantee:
//
//   idempotency  -> a (team_id, idempotency_key) primary key holding the ORIGINAL result, read
//                   inside the same transaction, so a replay returns the first answer and writes
//                   nothing;
//   atomic audit -> the change and its audit row commit together. A deferred constraint trigger
//                   fires at commit and fails the transaction if the change carries no audit event,
//                   so a direct UPDATE that bypasses this module cannot commit either;
//   concurrency  -> `SELECT ... FOR UPDATE` then `UPDATE ... WHERE version = $expected`, which is
//                   what the in-memory store's serialised write queue approximates in one process;
//   team scope   -> a transaction-local team setting plus row-level security. A cross-team read
//                   returns zero rows before this module's own capability check ever runs, so the
//                   database and the domain refuse it independently.
//
// This module names no SQL driver. It takes a minimal connection abstraction so the domain stays
// free of a `pg` dependency (the driver is a devDependency, used only by the test adapter) and so
// ../../caring-contacts remains importable without one.
import { buildAccessAuditEvent, type AccessRecord } from "../access-audit";
import { applyAssignmentAction, unassigned, type AssignmentAction, type PlanAssignment } from "../assignment";
import { buildAuditEvent, type AuditEvent, type AuditOutcome } from "../audit";
import { awstIsoTimestamp, type Clock } from "../clock";
import { changeContactDate, moveContactWithinDay } from "../contact-rescheduling";
import { applyHospitalStatusEvent, applyWithdrawalRequest, sendableContacts } from "../hospital-events";
import { fingerprintOf } from "../fingerprint";
import { actorId as toActorId, contactId, idempotencyKey as toIdempotencyKey, teamId as toTeamId } from "../ids";
import type { PathwayVersionId, PatientId, PlanId, ReferralId, TeamId } from "../ids";
import { DISPATCHED_CONTACT_STATES, applyContactTransition, applyPlanTransition } from "../model";
import type {
  Contact,
  ContactAction,
  ContactState,
  PathwayVersionState,
  Plan,
  PlanState,
  ProviderStatus,
  Referral,
  ReferralState,
  TransitionResult,
} from "../model";
import {
  defaultNotificationPreferences,
  type AlertClass,
  type NotificationPreferences,
} from "../notification-preferences";
import {
  applyPathwayVersionTransition,
  type PathwayApproval,
  type PathwayApprovalRole,
  type PathwayRetirementUrgency,
  type PathwayVersion,
  type PathwayVersionSnapshot,
} from "../pathway-versions";
import {
  actorRoleNames,
  canPerformCaringContactAction,
  type CaringContactAction,
  type CaringContactActor,
} from "../permissions";
import { applyReferralTransition } from "../referrals";
import { admitRetentionClearance } from "../retention";
import {
  applyServiceRestartApproval,
  applyServiceStop,
  restartOutcomeOf,
  runningService,
  serviceStopBlocksDispatch,
  type ServiceRestartApproval,
  type ServiceRestartApprovalRole,
  type ServiceRestartOutcome,
  type ServiceState,
  type ServiceStopReason,
} from "../service-state";
import { emptyTrainingRecord, recordCompetency, type TrainingCompetency, type TrainingRecord } from "../training";
import {
  CLEARED_PATIENT_DETAIL,
  PATHWAY_VERSION_READ_ACTIONS,
  READ_ACTIONS,
  REPOSITORY_REFUSALS,
  SERVICE_STATE_UNSET_TEAM,
  contactIdentifierFor,
  isTerminalPlan,
  outcomeFor,
  type AccessTrailQuery,
  type CaringContactRepository,
  type ContactProviderStatusInput,
  type ContactStatusInput,
  type CreatePlanInput,
  type CreateReferralInput,
  type DispatchDiscrepancyResolution,
  type DispatchRecord,
  type EpisodePatientDetail,
  type HospitalStatusInput,
  type HospitalStatusOutcome,
  type PathwayVersionTransitionInput,
  type PlanLifecycleInput,
  type PlanOutcome,
  type PlanRecord,
  type ReadContext,
  type ReferralTransitionInput,
  type RepositoryOptions,
  type ResolveDiscrepancyInput,
  type SavePathwayVersionInput,
  type StoredContact,
  type WithdrawPlanInput,
  type WriteContext,
} from "../repository";
import type { Episode } from "../episode";
import { buildApprovedSchedule, type PlannedContact } from "../schedule";

// ---------------------------------------------------------------------------
// The connection abstraction
// ---------------------------------------------------------------------------

export type SqlValue = string | number | boolean | Date | null | readonly string[];
export type SqlRow = Record<string, unknown>;
export type SqlResult = { rows: SqlRow[]; rowCount: number };

/** One connection, held for the length of a transaction. */
export type SqlConnection = { query(text: string, values?: readonly SqlValue[]): Promise<SqlResult> };

/**
 * A source of connections. `withConnection` must hold ONE connection for the whole callback --
 * every transaction here spans several statements, and a pool that handed out a different
 * connection per statement would break both the transaction and the transaction-local team scope.
 */
export type SqlConnectionPool = { withConnection<T>(work: (connection: SqlConnection) => Promise<T>): Promise<T> };

// ---------------------------------------------------------------------------
// Shared constants
//
// `TERMINAL_PLAN_STATES` and `DISPATCHED_CONTACT_STATES` now come from ../model, and `READ_ACTIONS`,
// `PATHWAY_VERSION_READ_ACTIONS`, `isTerminalPlan` and `outcomeFor` from ../repository. Each of them
// used to be declared here AND in the in-memory store, with a comment saying the two copies were
// "kept identical on purpose" -- which is a promise, not a mechanism. `READ_ACTIONS` is the one that
// carried real risk: it is the map from read surface to required capability, so two copies meant a
// change to who may read an episode could land in one store only.
// ---------------------------------------------------------------------------

/**
 * The two ways a single person could otherwise supply a second restart approval, keyed by the
 * CONSTRAINT that refuses each. Mapping on the name rather than on the message text is what keeps
 * this stable: an error string is a presentation detail of whatever server version is running, and
 * a store that pattern-matched one would answer a duplicate approval differently after an upgrade.
 * The domain refuses both cases first (../service-state); this catches two approvals that raced
 * each other into the same transaction window, where there was nothing yet to see.
 */
const RESTART_APPROVAL_REFUSALS: Readonly<Record<string, string>> = Object.freeze({
  service_restart_approvals_unique_stop_role: "restart-approval-role-already-recorded",
  service_restart_approvals_unique_stop_actor: "restart-approval-actor-already-recorded",
});

/** A fixed identifier, never interpolated from input -- a savepoint name cannot be parameterised. */
const INSERT_SAVEPOINT = "caring_contacts_insert";

const PLAN_COLUMNS = `id, team_id, patient_id, referral_id, pathway_version_id, state, version, outcome,
  discharge_at, completed_at, sending_preference, patient_name, patient_mobile_number, patient_identifiers`;

const CONTACT_COLUMNS = `id, plan_id, team_id, sequence, state, version, cadence_label, calendar_day,
  send_at, message_type, suppressed_reason`;

const REFERRAL_COLUMNS = "id, team_id, patient_id, state, pathway_version_id";

const PATHWAY_VERSION_COLUMNS = `id, team_id, state, author_id, published_at, retired_at,
  retirement_urgency, snapshot`;

const AUDIT_EVENT_COLUMNS = `team_id, actor_id, actor_roles, action, object_type, object_id, outcome,
  idempotency_key, occurred_at`;

const DISPATCH_COLUMNS = `d.contact_id, c.plan_id, d.attempt, d.started_at, d.reported_status,
  d.discrepancy_resolved_at, d.discrepancy_resolution`;

// ---------------------------------------------------------------------------
// Result storage
//
// A replay must return the ORIGINAL result, not a freshly derived one: by the time a `createPlan`
// is replayed the plan may have been activated, and re-deriving would answer a different question.
// JSON cannot carry a Date, so instants are marked and revived.
// ---------------------------------------------------------------------------

const DATE_MARKER = "__caringContactInstant";

function encodeStoredValue(value: unknown): unknown {
  if (value instanceof Date) return { [DATE_MARKER]: value.getTime() };
  if (Array.isArray(value)) return value.map(encodeStoredValue);
  if (value !== null && typeof value === "object") {
    const encoded: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (entry === undefined) continue;
      encoded[key] = encodeStoredValue(entry);
    }
    return encoded;
  }
  return value;
}

function decodeStoredValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decodeStoredValue);
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record[DATE_MARKER] === "number") return new Date(record[DATE_MARKER] as number);
    const decoded: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(record)) decoded[key] = decodeStoredValue(entry);
    return decoded;
  }
  return value;
}

// ---------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------

/** A column the database left empty. Both spellings, because a driver may hand back either. */
function isAbsent(value: unknown): boolean {
  return value === null || value === undefined;
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value : String(value);
}

function numberOf(value: unknown): number {
  return typeof value === "number" ? value : Number(value);
}

function instantOf(value: unknown): Date {
  return value instanceof Date ? new Date(value.getTime()) : new Date(String(value));
}

function toPlan(row: SqlRow): Plan {
  return {
    id: textOf(row.id) as PlanId,
    teamId: toTeamId(textOf(row.team_id)),
    state: textOf(row.state) as PlanState,
    version: numberOf(row.version),
  };
}

function toPlanned(row: SqlRow): PlannedContact {
  const planned: PlannedContact = {
    sequence: numberOf(row.sequence),
    cadenceLabel: textOf(row.cadence_label),
    calendarDay: textOf(row.calendar_day),
    sendAt: instantOf(row.send_at),
    messageType: textOf(row.message_type) as PlannedContact["messageType"],
  };
  // Present only when the entry really was absorbed, so a stored contact round-trips to exactly
  // the shape the in-memory store produces.
  if (row.suppressed_reason !== null && row.suppressed_reason !== undefined) {
    planned.suppressed = { reason: textOf(row.suppressed_reason) as "absorbedByFirstContact" };
  }
  return planned;
}

function toStoredContact(row: SqlRow): StoredContact {
  const contact: Contact = {
    id: contactId(textOf(row.id)),
    planId: textOf(row.plan_id) as PlanId,
    state: textOf(row.state) as ContactState,
    version: numberOf(row.version),
  };
  return { contact, planned: toPlanned(row) };
}

function toPlanRecord(planRow: SqlRow, contactRows: readonly SqlRow[]): PlanRecord {
  return {
    plan: toPlan(planRow),
    patientId: textOf(planRow.patient_id) as PatientId,
    referralId: textOf(planRow.referral_id) as ReferralId,
    pathwayVersionId: textOf(planRow.pathway_version_id) as PathwayVersionId,
    dischargeAt: instantOf(planRow.discharge_at),
    completedAt:
      planRow.completed_at === null || planRow.completed_at === undefined ? null : instantOf(planRow.completed_at),
    outcome: textOf(planRow.outcome) as PlanOutcome,
    contacts: contactRows.map(toStoredContact),
  };
}

function toAuditEvent(row: SqlRow): AuditEvent {
  return {
    actorId: toActorId(textOf(row.actor_id)),
    actorRoles: Object.freeze([...((row.actor_roles as string[] | null) ?? [])]),
    teamId: toTeamId(textOf(row.team_id)),
    action: textOf(row.action),
    objectType: textOf(row.object_type),
    objectId: textOf(row.object_id),
    outcome: textOf(row.outcome) as AuditOutcome,
    idempotencyKey: toIdempotencyKey(textOf(row.idempotency_key)),
    timestamp: textOf(row.occurred_at),
  };
}

/**
 * The name of the constraint a refusal came from, read as a field rather than parsed out of the
 * message. Migration 0003 named every constraint deliberately so a store never has to read prose.
 */
function constraintNameOf(error: unknown): string | null {
  if (error === null || typeof error !== "object") return null;
  const constraint = (error as { constraint?: unknown }).constraint;
  return typeof constraint === "string" ? constraint : null;
}

type SavepointOutcome<T> = { ok: true; value: T } | { ok: false; constraint: string | null; error: unknown };

/**
 * Runs one statement a constraint may legitimately refuse, inside a savepoint.
 *
 * Without the savepoint a refused INSERT aborts the whole transaction, and the transaction is where
 * the audit event for that very refusal has to be written -- so the store would be unable to record
 * the refusal it wants to return. Rolling back to a savepoint leaves the surrounding transaction
 * usable and the deferred audit guard still fires at commit as normal.
 */
async function withSavepoint<T>(
  connection: SqlConnection,
  name: string,
  work: () => Promise<T>,
): Promise<SavepointOutcome<T>> {
  await connection.query(`savepoint ${name}`);
  try {
    const value = await work();
    await connection.query(`release savepoint ${name}`);
    return { ok: true, value };
  } catch (error) {
    await connection.query(`rollback to savepoint ${name}`);
    return { ok: false, constraint: constraintNameOf(error), error };
  }
}

/** The one place an audit event becomes a row, so no write path can invent a second shape for it. */
async function insertAuditEvent(connection: SqlConnection, event: AuditEvent, token: string | null): Promise<void> {
  await connection.query(
    `insert into caring_contacts.audit_events
       (team_id, actor_id, actor_roles, action, object_type, object_id, outcome, idempotency_key,
        occurred_at, txn_token)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::uuid)`,
    [
      event.teamId,
      event.actorId,
      [...event.actorRoles],
      event.action,
      event.objectType,
      event.objectId,
      event.outcome,
      event.idempotencyKey,
      event.timestamp,
      token,
    ],
  );
}

/**
 * A clock pinned to one instant.
 *
 * Where a domain function stamps a time into the value it returns AND this store persists that
 * same time, the two must be the same instant BY CONSTRUCTION -- not by two reads of a real clock
 * landing close enough together. `service_stops` is enforced immutable, so a stop whose recorded
 * time differs from the one its caller was handed can never be corrected by an UPDATE afterwards;
 * and a second read is the store re-deriving something the domain has already decided. Every
 * fixture in the suite uses a fixed clock, which is precisely why no test could see the difference.
 */
function pinnedClock(at: Date): Clock {
  return Object.freeze({ now: () => new Date(at.getTime()) });
}

/** Transaction audit tokens. Deterministic per store instance, unique within it. */
function auditTokenFactory(): () => string {
  let issued = 0;
  const prefix = Math.floor(Math.random() * 0xffff_ffff)
    .toString(16)
    .padStart(8, "0");
  return () => {
    issued += 1;
    return `${prefix}-0000-4000-8000-${String(issued).padStart(12, "0")}`;
  };
}

type WriteSpec<T> = {
  /** Part of the idempotency fingerprint, so one key cannot cover two different operations. */
  method: string;
  input: unknown;
  context: WriteContext;
  auditAction: string;
  objectId: string;
  objectType?: string;
  /**
   * True only for `stopService`, `approveServiceRestart`, and `recordHospitalStatusEvent` -- the
   * three writes that must always be reachable regardless of the service-wide safety stop. Every
   * other write is gated inside `runWrite` itself, so a future method cannot forget the gate by
   * simply not checking for it.
   */
  bypassServiceStopGate?: boolean;
  stage: (connection: SqlConnection) => Promise<TransitionResult<T>>;
};

export function createPostgresRepository(
  pool: SqlConnectionPool,
  clock: Clock,
  options: RepositoryOptions = {},
): CaringContactRepository {
  const nextAuditToken = auditTokenFactory();

  /**
   * Opens a transaction scoped to one team, as the non-privileged application role.
   *
   * `set local role` is what makes row-level security apply at all: the migration role is a
   * superuser and bypasses every policy, so a store that skipped this would be team-scoped only by
   * its own SQL — one forgotten predicate away from cross-team disclosure.
   */
  async function inTransaction<T>(
    team: TeamId,
    auditToken: string | null,
    work: (connection: SqlConnection) => Promise<T>,
  ): Promise<T> {
    return pool.withConnection(async (connection) => {
      await connection.query("begin");
      try {
        await connection.query("select set_config('caring_contacts.team_id', $1, true)", [team]);
        await connection.query("select set_config('caring_contacts.audit_token', $1, true)", [auditToken ?? ""]);
        await connection.query("set local role caring_contacts_app");
        const value = await work(connection);
        await connection.query("commit");
        return value;
      } catch (error) {
        await connection.query("rollback").catch(() => undefined);
        throw error;
      }
    });
  }

  function mayRead(actor: CaringContactActor, action: CaringContactAction, resourceTeamId: TeamId): boolean {
    return canPerformCaringContactAction(actor, action, { teamId: resourceTeamId }).allowed;
  }

  /** The team is the actor's own: a read of another team's row returns nothing, never a refusal. */
  function mayReadOwnTeam(context: ReadContext, action: CaringContactAction): boolean {
    return mayRead(context.actor, action, context.actor.teamId);
  }

  /** True if the actor holds ANY of the given read capabilities for their own team. */
  function mayReadAnyOwnTeam(context: ReadContext, actions: readonly CaringContactAction[]): boolean {
    return actions.some((action) => mayReadOwnTeam(context, action));
  }

  /**
   * Registers the team this transaction writes as, and INCIDENTALLY SERIALISES CONCURRENT WRITERS
   * FROM THE SAME TEAM -- which is a load-bearing accident, so it is written down here.
   *
   * Two transactions inserting the same team id contend on the primary key: the second blocks until
   * the first commits or rolls back, even though `on conflict do nothing` means it will ultimately
   * write nothing. Because this is the FIRST statement of every write, two same-team writers queue
   * here and never overlap anywhere later in the write path. Nothing designed that; it falls out of
   * the key, and every write in this store currently relies on it without saying so.
   *
   * The cross-team case has no such queue -- two teams touch different rows and arrive together --
   * which is why the guarded singleton upsert in `stopService` exists, and why the test that proves
   * it has to use two teams to reach the race at all.
   *
   * SO: moving this insert later, making it conditional (an "only if absent" read first, a cache, a
   * one-time bootstrap), or optimising it away widens the concurrency surface of EVERY write in this
   * store at once, silently and without a failing test. Treat any such change as a concurrency
   * change, not a performance one.
   */
  async function ensureTeam(connection: SqlConnection, team: TeamId): Promise<void> {
    await connection.query("insert into caring_contacts.teams (id) values ($1) on conflict (id) do nothing", [team]);
  }

  async function selectPlanForUpdate(connection: SqlConnection, planId: PlanId): Promise<SqlRow | null> {
    const result = await connection.query(
      `select ${PLAN_COLUMNS} from caring_contacts.plans where id = $1 for update`,
      [planId],
    );
    return result.rows[0] ?? null;
  }

  async function selectContacts(connection: SqlConnection, planId: PlanId): Promise<SqlRow[]> {
    const result = await connection.query(
      `select ${CONTACT_COLUMNS} from caring_contacts.contacts where plan_id = $1 order by sequence`,
      [planId],
    );
    return result.rows;
  }

  async function selectContactsForUpdate(connection: SqlConnection, planId: PlanId): Promise<SqlRow[]> {
    const result = await connection.query(
      `select ${CONTACT_COLUMNS} from caring_contacts.contacts where plan_id = $1 order by sequence for update`,
      [planId],
    );
    return result.rows;
  }

  /** Applies a plan transition row, asserting the optimistic guard actually matched. */
  async function writePlan(connection: SqlConnection, plan: Plan, completedAt: Date | null): Promise<void> {
    const result = await connection.query(
      `update caring_contacts.plans
         set state = $2, version = $3, outcome = $4, completed_at = $5
       where id = $1 and version = $6`,
      [plan.id, plan.state, plan.version, outcomeFor(plan.state), completedAt, plan.version - 1],
    );
    if (result.rowCount !== 1) {
      throw new Error(`caring-contacts: plan ${plan.id} moved under an optimistic write that held a row lock`);
    }
  }

  async function writeContact(connection: SqlConnection, contact: Contact): Promise<void> {
    const result = await connection.query(
      "update caring_contacts.contacts set state = $2, version = $3 where id = $1 and version = $4",
      [contact.id, contact.state, contact.version, contact.version - 1],
    );
    if (result.rowCount !== 1) {
      throw new Error(`caring-contacts: contact ${contact.id} moved under an optimistic write that held a row lock`);
    }
  }

  /**
   * Cancels every contact the lifecycle still accepts a cancellation for. As in the in-memory
   * store, nothing here compares `send_at` to now: on a recorded death, such a filter is exactly
   * the defect that lets a message reach someone afterwards.
   */
  async function cancelAllNonTerminalContacts(connection: SqlConnection, rows: readonly SqlRow[]): Promise<number> {
    let cancelled = 0;
    for (const row of rows) {
      const stored = toStoredContact(row);
      const transition = applyContactTransition(stored.contact, { type: "cancel" });
      if (!transition.ok) continue;
      await writeContact(connection, transition.value);
      cancelled += 1;
    }
    return cancelled;
  }

  /**
   * The one path every write takes.
   *
   * Order is the guarantee, exactly as in the in-memory store: the change is fully staged, then
   * the audit event is built and offered to the sink, and only then is anything committed. A throw
   * anywhere before the commit rolls the transaction back, so the store is left byte-identical and
   * the idempotency key is NOT consumed — the caller may retry.
   */
  async function runWrite<T>(spec: WriteSpec<T>): Promise<TransitionResult<T>> {
    const { actor, idempotencyKey } = spec.context;
    const token = nextAuditToken();
    const fingerprint = fingerprintOf({ method: spec.method, input: spec.input });

    return inTransaction(actor.teamId, token, async (connection) => {
      await ensureTeam(connection, actor.teamId);

      const existing = await connection.query(
        `select fingerprint, result from caring_contacts.idempotency_records
         where team_id = $1 and idempotency_key = $2`,
        [actor.teamId, idempotencyKey],
      );
      const previous = existing.rows[0] ?? null;

      // A true replay returns the original answer and appends nothing at all.
      if (previous && textOf(previous.fingerprint) === fingerprint) {
        return decodeStoredValue(previous.result) as TransitionResult<T>;
      }

      // The service-wide safety-stop gate (Ruling 9). It lives HERE, not in each method, so a future
      // write cannot forget it by simply not asking; and it reads the singleton -- the one record for
      // the whole service -- so a stop raised by one team's actor blocks another team's plan too.
      // Checked after the replay short-circuit, because a replay reports the ORIGINAL decision rather
      // than today's, and before `spec.stage()` so a refused write still produces exactly one
      // "denied" audit event through the same path every other refusal does.
      const blockedByServiceStop =
        spec.bypassServiceStopGate !== true &&
        !previous &&
        serviceStopBlocksDispatch(await readServiceState(connection));

      const staged: TransitionResult<T> = previous
        ? { ok: false, reason: REPOSITORY_REFUSALS.idempotencyKeyReused }
        : blockedByServiceStop
          ? { ok: false, reason: REPOSITORY_REFUSALS.serviceStopped }
          : await spec.stage(connection);

      const outcome: AuditOutcome = staged.ok ? "allowed" : "denied";
      const event = buildAuditEvent(
        {
          actorId: actor.id,
          actorRoles: actorRoleNames(actor),
          teamId: actor.teamId,
          action: spec.auditAction,
          objectType: spec.objectType ?? "plan",
          objectId: spec.objectId,
          outcome,
          idempotencyKey,
        },
        clock,
      );
      await options.auditSink?.record(event);

      await insertAuditEvent(connection, event, token);

      // A key reused for a different request must not overwrite the original write's result.
      //
      // A `service-stopped` refusal is deliberately NOT remembered (Ruling 15). Idempotency keys are
      // stable across retries, so caching it would poison that key permanently: the identical retry
      // sent after the three-role restart approval would be refused for a reason that is no longer
      // true, and the resume path is the entire point of a safety stop. Every OTHER refusal is still
      // recorded, so the general replay semantics -- one key, one answer -- are unchanged.
      if (!previous && !blockedByServiceStop) {
        await connection.query(
          `insert into caring_contacts.idempotency_records (team_id, idempotency_key, fingerprint, result)
           values ($1, $2, $3, $4::jsonb)`,
          [actor.teamId, idempotencyKey, fingerprint, JSON.stringify(encodeStoredValue(staged))],
        );
      }
      return staged;
    });
  }

  /**
   * Resolves an existing plan for a write: team scope, then capability, then version. `actions` is
   * a list because one write may be reachable by more than one capability -- a recorded death is
   * the case, and it is a safety property rather than a convenience.
   */
  async function resolveForWrite(
    connection: SqlConnection,
    input: PlanLifecycleInput,
    actor: CaringContactActor,
    actions: readonly CaringContactAction[],
  ): Promise<TransitionResult<SqlRow>> {
    // Row-level security already excludes another team's plan, so this returns nothing for it --
    // the same answer as for a plan that does not exist.
    const row = await selectPlanForUpdate(connection, input.planId);
    if (!row) return { ok: false, reason: REPOSITORY_REFUSALS.notFound };

    const team = toTeamId(textOf(row.team_id));
    const permitted = actions.some((action) => canPerformCaringContactAction(actor, action, { teamId: team }).allowed);
    if (!permitted) return { ok: false, reason: REPOSITORY_REFUSALS.permissionDenied };
    if (numberOf(row.version) !== input.expectedVersion) {
      return { ok: false, reason: REPOSITORY_REFUSALS.staleVersion };
    }
    return { ok: true, value: row };
  }

  async function lifecycleWrite(
    method: string,
    action: CaringContactAction,
    transition: "activate" | "pause" | "resume",
    input: PlanLifecycleInput,
    context: WriteContext,
  ): Promise<TransitionResult<PlanRecord>> {
    return runWrite<PlanRecord>({
      method,
      input,
      context,
      auditAction: method,
      objectId: input.planId,
      stage: async (connection) => {
        const resolved = await resolveForWrite(connection, input, context.actor, [action]);
        if (!resolved.ok) return resolved;
        const moved = applyPlanTransition(toPlan(resolved.value), { type: transition });
        if (!moved.ok) return moved;

        const completedAt = isTerminalPlan(moved.value.state) ? clock.now() : null;
        await writePlan(connection, moved.value, completedAt);

        // Re-read rather than patching the row in memory: what the caller gets back is then what
        // the database actually holds, including any default or constraint it applied.
        const stored = await readPlanRecord(connection, input.planId);
        if (!stored) throw new Error(`caring-contacts: plan ${input.planId} vanished inside its own transaction`);
        return { ok: true, value: toPlanRecord(stored.planRow, stored.contactRows) };
      },
    });
  }

  /**
   * The one path every contact-status write takes. `requiresActivePlan` is true only for the write
   * that BEGINS a dispatch — see the module header for why the ordering of the checks below is
   * itself a contract.
   */
  async function contactStatusWrite(
    method: string,
    permission: CaringContactAction,
    input: ContactStatusInput,
    action: ContactAction,
    context: WriteContext,
    requiresActivePlan: boolean,
    recordDispatchAttempt = false,
    /** Set only by `recordContactProviderStatus`: the half of the reconciliation pair the provider reported. */
    reportedStatus?: ProviderStatus,
  ): Promise<TransitionResult<StoredContact>> {
    return runWrite<StoredContact>({
      method,
      input,
      context,
      auditAction: method,
      objectType: "contact",
      objectId: input.contactId,
      stage: async (connection) => {
        const planRow = await selectPlanForUpdate(connection, input.planId);
        if (!planRow) return { ok: false, reason: REPOSITORY_REFUSALS.notFound };

        const team = toTeamId(textOf(planRow.team_id));
        if (!canPerformCaringContactAction(context.actor, permission, { teamId: team }).allowed) {
          return { ok: false, reason: REPOSITORY_REFUSALS.permissionDenied };
        }

        const contactResult = await connection.query(
          `select ${CONTACT_COLUMNS} from caring_contacts.contacts where plan_id = $1 and id = $2 for update`,
          [input.planId, input.contactId],
        );
        const contactRow = contactResult.rows[0];
        if (!contactRow) return { ok: false, reason: REPOSITORY_REFUSALS.notFound };
        if (numberOf(contactRow.version) !== input.expectedContactVersion) {
          return { ok: false, reason: REPOSITORY_REFUSALS.staleVersion };
        }

        // Deliberately AFTER the version check. See the module header.
        if (requiresActivePlan && textOf(planRow.state) !== "active") {
          return { ok: false, reason: REPOSITORY_REFUSALS.contactDispatchRequiresActivePlan };
        }

        const stored = toStoredContact(contactRow);
        const moved = applyContactTransition(stored.contact, action);
        if (!moved.ok) return moved;
        await writeContact(connection, moved.value);

        if (recordDispatchAttempt) {
          // One row per attempt at one contact. The unique (contact_id, attempt) constraint is what
          // stops a replayed dispatch becoming a second recorded message.
          const attempts = await connection.query(
            "select coalesce(max(attempt), 0) + 1 as attempt from caring_contacts.contact_dispatches where contact_id = $1",
            [input.contactId],
          );
          await connection.query(
            `insert into caring_contacts.contact_dispatches
               (contact_id, team_id, attempt, idempotency_key, started_at)
             values ($1, $2, $3, $4, $5)`,
            [input.contactId, team, numberOf(attempts.rows[0].attempt), context.idempotencyKey, clock.now()],
          );
        }

        if (reportedStatus !== undefined) {
          // Recorded against the OPEN attempt -- the latest one this contact has -- which is the half
          // `resolveDispatchDiscrepancy` compares against. A contact with no attempt on record simply
          // has nothing to reconcile, so this updates nothing rather than inventing an attempt.
          await connection.query(
            `update caring_contacts.contact_dispatches set reported_status = $2
              where id = (
                select id from caring_contacts.contact_dispatches where contact_id = $1
                 order by attempt desc limit 1
              )`,
            [input.contactId, reportedStatus],
          );
        }

        return { ok: true, value: { contact: moved.value, planned: stored.planned } };
      },
    });
  }

  /** Reads run in their own team-scoped transaction; they write nothing and need no audit token. */
  async function runRead<T>(context: ReadContext, work: (connection: SqlConnection) => Promise<T>): Promise<T> {
    return inTransaction(context.actor.teamId, null, work);
  }

  async function readPlanRecord(
    connection: SqlConnection,
    planId: PlanId,
  ): Promise<{ planRow: SqlRow; contactRows: SqlRow[] } | null> {
    const result = await connection.query(`select ${PLAN_COLUMNS} from caring_contacts.plans where id = $1`, [planId]);
    const planRow = result.rows[0];
    if (!planRow) return null;
    return { planRow, contactRows: await selectContacts(connection, planId) };
  }

  // -------------------------------------------------------------------------
  // Reading the workspace tables back into domain values
  // -------------------------------------------------------------------------

  function toReferral(row: SqlRow): Referral {
    return {
      id: textOf(row.id) as ReferralId,
      teamId: toTeamId(textOf(row.team_id)),
      patientId: textOf(row.patient_id) as PatientId,
      state: textOf(row.state) as ReferralState,
      pathwayVersionId: isAbsent(row.pathway_version_id) ? null : (textOf(row.pathway_version_id) as PathwayVersionId),
    };
  }

  function toPathwayApproval(row: SqlRow): PathwayApproval {
    return {
      role: textOf(row.role) as PathwayApprovalRole,
      actorId: toActorId(textOf(row.actor_id)),
      approvedAt: awstIsoTimestamp(instantOf(row.approved_at)),
    };
  }

  function toPathwayVersion(row: SqlRow, approvals: readonly PathwayApproval[]): PathwayVersion {
    return {
      id: textOf(row.id) as PathwayVersionId,
      teamId: toTeamId(textOf(row.team_id)),
      state: textOf(row.state) as PathwayVersionState,
      authorId: toActorId(textOf(row.author_id)),
      approvals,
      publishedAt: isAbsent(row.published_at) ? null : awstIsoTimestamp(instantOf(row.published_at)),
      retiredAt: isAbsent(row.retired_at) ? null : awstIsoTimestamp(instantOf(row.retired_at)),
      retirementUrgency: isAbsent(row.retirement_urgency)
        ? null
        : (textOf(row.retirement_urgency) as PathwayRetirementUrgency),
      snapshot: row.snapshot as PathwayVersionSnapshot,
    };
  }

  async function readPathwayVersion(connection: SqlConnection, versionId: string): Promise<PathwayVersion | null> {
    const result = await connection.query(
      `select ${PATHWAY_VERSION_COLUMNS} from caring_contacts.pathway_versions where id = $1`,
      [versionId],
    );
    const row = result.rows[0];
    if (!row) return null;
    const approvals = await connection.query(
      `select role, actor_id, approved_at from caring_contacts.pathway_version_approvals
       where pathway_version_id = $1 order by id`,
      [versionId],
    );
    return toPathwayVersion(row, approvals.rows.map(toPathwayApproval));
  }

  /** Two queries and a group, the shape `listPlans` already uses -- never one query per version. */
  async function readAllPathwayVersions(connection: SqlConnection): Promise<PathwayVersion[]> {
    const versions = await connection.query(
      `select ${PATHWAY_VERSION_COLUMNS} from caring_contacts.pathway_versions order by id`,
    );
    const approvals = await connection.query(
      `select pathway_version_id, role, actor_id, approved_at
       from caring_contacts.pathway_version_approvals order by id`,
    );

    const byVersion = new Map<string, PathwayApproval[]>();
    for (const row of approvals.rows) {
      const key = textOf(row.pathway_version_id);
      const bucket = byVersion.get(key);
      if (bucket) bucket.push(toPathwayApproval(row));
      else byVersion.set(key, [toPathwayApproval(row)]);
    }

    return versions.rows.map((row) => toPathwayVersion(row, byVersion.get(textOf(row.id)) ?? []));
  }

  // -------------------------------------------------------------------------
  // The service-wide safety stop
  //
  // `service_state` is a singleton and `service_stops` holds one immutable row per incident, so the
  // CURRENT incident's reason and note are reached by `stop_id` rather than copied onto the
  // singleton -- and the restart approvals are read for that stop alone. An unfiltered read would
  // hand a brand-new incident the previous one's three approvals, which is a zero-approval restart.
  // -------------------------------------------------------------------------

  async function readRestartApprovals(
    connection: SqlConnection,
    stopId: string,
  ): Promise<readonly ServiceRestartApproval[]> {
    const result = await connection.query(
      `select role, actor_id, approved_at from caring_contacts.service_restart_approvals
       where stop_id = $1::uuid order by id`,
      [stopId],
    );
    return Object.freeze(
      result.rows.map((row) =>
        Object.freeze({
          role: textOf(row.role) as ServiceRestartApprovalRole,
          actorId: toActorId(textOf(row.actor_id)),
          approvedAt: awstIsoTimestamp(instantOf(row.approved_at)),
        }),
      ),
    );
  }

  /**
   * The singleton joined to the incident it names. Frozen on the way out for the same reason the
   * in-memory store freezes: a caller holding a mutable stopped state could rewrite the reason, the
   * note, who raised it, or the restart approvals of a live incident in place -- with no audit event
   * and nothing to show it happened.
   */
  async function serviceStateFrom(connection: SqlConnection, row: SqlRow | null): Promise<ServiceState> {
    if (!row) return runningService(SERVICE_STATE_UNSET_TEAM);

    const reportedByTeamId = isAbsent(row.reported_by_team_id)
      ? SERVICE_STATE_UNSET_TEAM
      : toTeamId(textOf(row.reported_by_team_id));
    if (row.stopped !== true) return runningService(reportedByTeamId);

    return Object.freeze({
      stopped: true as const,
      reportedByTeamId,
      reason: textOf(row.reason) as ServiceStopReason,
      stoppedBy: toActorId(textOf(row.stopped_by)),
      stoppedAt: awstIsoTimestamp(instantOf(row.stopped_at)),
      note: isAbsent(row.note) ? "" : textOf(row.note),
      restartApprovals: await readRestartApprovals(connection, textOf(row.stop_id)),
    });
  }

  async function selectServiceState(connection: SqlConnection, forUpdate: boolean): Promise<SqlRow | null> {
    const result = await connection.query(
      `select s.stopped, s.reported_by_team_id, s.stop_id, s.stopped_by, s.stopped_at, i.reason, i.note
         from caring_contacts.service_state s
         left join caring_contacts.service_stops i on i.stop_id = s.stop_id
        where s.singleton${forUpdate ? " for update of s" : ""}`,
    );
    return result.rows[0] ?? null;
  }

  async function readServiceState(connection: SqlConnection, forUpdate = false): Promise<ServiceState> {
    return serviceStateFrom(connection, await selectServiceState(connection, forUpdate));
  }

  // -------------------------------------------------------------------------
  // Assignment and cover
  // -------------------------------------------------------------------------

  async function readAssignment(connection: SqlConnection, planId: PlanId): Promise<PlanAssignment> {
    const current = await connection.query(
      `select owner_id, claimed_at, covered_by, coverage_from, coverage_until
       from caring_contacts.plan_assignments where plan_id = $1`,
      [planId],
    );
    const history = await connection.query(
      `select from_actor_id, to_actor_id, reason, at
       from caring_contacts.plan_reassignments where plan_id = $1 order by id`,
      [planId],
    );
    const reassignmentHistory = history.rows.map((row) => ({
      fromActorId: toActorId(textOf(row.from_actor_id)),
      toActorId: toActorId(textOf(row.to_actor_id)),
      reason: textOf(row.reason),
      at: awstIsoTimestamp(instantOf(row.at)),
    }));

    const row = current.rows[0];
    if (!row) return { ...unassigned(), reassignmentHistory };
    return {
      ownerId: isAbsent(row.owner_id) ? null : toActorId(textOf(row.owner_id)),
      claimedAt: isAbsent(row.claimed_at) ? null : awstIsoTimestamp(instantOf(row.claimed_at)),
      coveredBy: isAbsent(row.covered_by)
        ? null
        : {
            actorId: toActorId(textOf(row.covered_by)),
            from: textOf(row.coverage_from),
            until: textOf(row.coverage_until),
          },
      reassignmentHistory,
    };
  }

  /**
   * Persists one applied assignment action. Only the reassignment entries the transition actually
   * appended are inserted: `applyAssignmentAction` returns the WHOLE history every time, and
   * re-inserting it would duplicate every earlier handover on each later one.
   */
  async function writeAssignment(
    connection: SqlConnection,
    planId: PlanId,
    team: TeamId,
    assignment: PlanAssignment,
    alreadyRecordedHandovers: number,
  ): Promise<void> {
    await connection.query(
      `insert into caring_contacts.plan_assignments
         (plan_id, team_id, owner_id, claimed_at, covered_by, coverage_from, coverage_until)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (plan_id) do update
         set owner_id = excluded.owner_id, claimed_at = excluded.claimed_at,
             covered_by = excluded.covered_by, coverage_from = excluded.coverage_from,
             coverage_until = excluded.coverage_until`,
      [
        planId,
        team,
        assignment.ownerId,
        assignment.claimedAt === null ? null : new Date(assignment.claimedAt),
        assignment.coveredBy?.actorId ?? null,
        assignment.coveredBy?.from ?? null,
        assignment.coveredBy?.until ?? null,
      ],
    );

    for (const entry of assignment.reassignmentHistory.slice(alreadyRecordedHandovers)) {
      await connection.query(
        `insert into caring_contacts.plan_reassignments (plan_id, team_id, from_actor_id, to_actor_id, reason, at)
         values ($1, $2, $3, $4, $5, $6)`,
        [planId, team, entry.fromActorId, entry.toActorId, entry.reason, new Date(entry.at)],
      );
    }
  }

  // -------------------------------------------------------------------------
  // Dispatch reconciliation
  // -------------------------------------------------------------------------

  function toDispatchRecord(row: SqlRow): DispatchRecord {
    return {
      contactId: contactId(textOf(row.contact_id)),
      planId: textOf(row.plan_id) as PlanId,
      attempt: numberOf(row.attempt),
      startedAt: instantOf(row.started_at),
      // There is no `expected_status` column and nothing writes one: the dispatcher records what the
      // provider REPORTED, and the expectation it is reconciled against lives with the caller. The
      // in-memory store leaves this null for the same reason.
      expectedStatus: null,
      reportedStatus: isAbsent(row.reported_status) ? null : (textOf(row.reported_status) as ProviderStatus),
      discrepancyResolvedAt: isAbsent(row.discrepancy_resolved_at) ? null : instantOf(row.discrepancy_resolved_at),
      discrepancyResolution: isAbsent(row.discrepancy_resolution)
        ? null
        : (textOf(row.discrepancy_resolution) as DispatchDiscrepancyResolution),
    };
  }

  return {
    async createPlan(input: CreatePlanInput, context: WriteContext) {
      return runWrite<PlanRecord>({
        method: "createPlan",
        input,
        context,
        auditAction: "createPlan",
        objectId: input.planId,
        stage: async (connection) => {
          const { actor } = context;
          if (!canPerformCaringContactAction(actor, "claimPlan", { teamId: actor.teamId }).allowed) {
            return { ok: false, reason: REPOSITORY_REFUSALS.permissionDenied };
          }

          // Both questions cross team boundaries, so both are asked through SECURITY DEFINER
          // functions that answer with a boolean and disclose nothing else. A team-scoped SELECT
          // would answer "no" for another team's plan, which is how two teams end up contacting one
          // person on the same day.
          const exists = await connection.query("select caring_contacts.plan_exists($1) as present", [input.planId]);
          if (exists.rows[0].present === true) {
            return { ok: false, reason: REPOSITORY_REFUSALS.planAlreadyExists };
          }
          const open = await connection.query("select caring_contacts.patient_has_non_terminal_plan($1) as present", [
            input.patientId,
          ]);
          if (open.rows[0].present === true) {
            return { ok: false, reason: REPOSITORY_REFUSALS.duplicateActivePlan };
          }

          const schedule = buildApprovedSchedule({
            dischargeAt: input.dischargeAt,
            sendingPreference: input.sendingPreference,
            firstContactDate: input.firstContactDate,
            firstContactReason: input.firstContactReason,
          });
          if (!schedule.ok) return schedule;

          await connection.query(
            `insert into caring_contacts.plans
               (id, team_id, patient_id, referral_id, pathway_version_id, state, version, outcome,
                discharge_at, completed_at, sending_preference, patient_name, patient_mobile_number,
                patient_identifiers)
             values ($1, $2, $3, $4, $5, 'draft', 1, 'inProgress', $6, null, $7, $8, $9, $10)`,
            [
              input.planId,
              actor.teamId,
              input.patientId,
              input.referralId,
              input.pathwayVersionId,
              input.dischargeAt,
              input.sendingPreference,
              input.patientDetail.patientName,
              input.patientDetail.patientMobileNumber,
              [...input.patientDetail.patientIdentifiers],
            ],
          );

          // Sendability comes from `sendableContacts`, never from `send_at`: an absorbed entry
          // carries a real send instant and would otherwise go out as a second message that day.
          // Storing it terminal means it cannot be dispatched at all.
          const sendable = new Set(sendableContacts(schedule.contacts).map((planned) => planned.sequence));
          for (const planned of schedule.contacts) {
            await connection.query(
              `insert into caring_contacts.contacts
                 (id, plan_id, team_id, sequence, state, version, cadence_label, calendar_day, send_at,
                  message_type, suppressed_reason)
               values ($1, $2, $3, $4, $5, 1, $6, $7, $8, $9, $10)`,
              [
                contactIdentifierFor(input.planId, planned.sequence),
                input.planId,
                actor.teamId,
                planned.sequence,
                sendable.has(planned.sequence) ? "scheduled" : "suppressed",
                planned.cadenceLabel,
                planned.calendarDay,
                planned.sendAt,
                planned.messageType,
                planned.suppressed?.reason ?? null,
              ],
            );
          }

          // Cultural identity goes to the reporting projection and nowhere near the plan row.
          if (input.patientDetail.culturalIdentity !== null) {
            await connection.query(
              `insert into caring_contacts.cultural_identity_reports (plan_id, team_id, cultural_identity)
               values ($1, $2, $3)`,
              [input.planId, actor.teamId, input.patientDetail.culturalIdentity],
            );
          }

          const stored = await readPlanRecord(connection, input.planId);
          if (!stored) throw new Error(`caring-contacts: plan ${input.planId} vanished inside its own transaction`);
          return { ok: true, value: toPlanRecord(stored.planRow, stored.contactRows) };
        },
      });
    },

    async activatePlan(input, context) {
      return lifecycleWrite("activatePlan", "activatePlan", "activate", input, context);
    },

    async pausePlan(input, context) {
      return lifecycleWrite("pausePlan", "pausePlan", "pause", input, context);
    },

    async resumePlan(input, context) {
      return lifecycleWrite("resumePlan", "resumePlan", "resume", input, context);
    },

    async withdrawPlan(input: WithdrawPlanInput, context: WriteContext) {
      return runWrite<PlanRecord>({
        method: "withdrawPlan",
        input,
        context,
        auditAction: "withdrawPlan",
        objectId: input.planId,
        stage: async (connection) => {
          const resolved = await resolveForWrite(connection, input, context.actor, ["withdrawPlan"]);
          if (!resolved.ok) return resolved;

          // The third-party refusal lives in ../hospital-events and is not restated here.
          const withdrawal = applyWithdrawalRequest(toPlan(resolved.value), { origin: input.origin });
          if (!withdrawal.ok) return withdrawal;

          const completedAt = isTerminalPlan(withdrawal.value.plan.state) ? clock.now() : null;
          await writePlan(connection, withdrawal.value.plan, completedAt);
          await cancelAllNonTerminalContacts(connection, await selectContactsForUpdate(connection, input.planId));

          const stored = await readPlanRecord(connection, input.planId);
          if (!stored) throw new Error(`caring-contacts: plan ${input.planId} vanished inside its own transaction`);
          return { ok: true, value: toPlanRecord(stored.planRow, stored.contactRows) };
        },
      });
    },

    async recordHospitalStatusEvent(input: HospitalStatusInput, context: WriteContext) {
      // A death and its correction additionally accept triggerServiceSafetyStop, the one capability
      // every role holds. Recording a death must never be blocked by a permission check: a refusal
      // would leave a plan sending to someone who has died.
      const actions: readonly CaringContactAction[] =
        input.event.type === "death" || input.event.type === "deathCorrection"
          ? ["recordHospitalStatusEvent", "triggerServiceSafetyStop"]
          : ["recordHospitalStatusEvent"];

      return runWrite<HospitalStatusOutcome>({
        method: "recordHospitalStatusEvent",
        input,
        context,
        auditAction: `recordHospitalStatusEvent:${input.event.type}`,
        objectId: input.planId,
        // A death must always be recordable -- the same reasoning as the always-available
        // triggerServiceSafetyStop capability above. A refusal here would leave a plan sending to
        // someone who has died.
        bypassServiceStopGate: true,
        stage: async (connection) => {
          const resolved = await resolveForWrite(connection, input, context.actor, actions);
          if (!resolved.ok) return resolved;

          const applied = applyHospitalStatusEvent(toPlan(resolved.value), input.event);
          if (!applied.ok) return applied;

          const completedAt = isTerminalPlan(applied.value.plan.state) ? clock.now() : null;
          if (applied.value.plan.version !== numberOf(resolved.value.version)) {
            await writePlan(connection, applied.value.plan, completedAt);
          }

          const { contactOutcome } = applied.value;
          const stopsEverything = contactOutcome.type === "cancelUnsent" || contactOutcome.type === "stopAll";
          const cancelled = stopsEverything
            ? await cancelAllNonTerminalContacts(connection, await selectContactsForUpdate(connection, input.planId))
            : 0;

          const stored = await readPlanRecord(connection, input.planId);
          if (!stored) throw new Error(`caring-contacts: plan ${input.planId} vanished inside its own transaction`);

          const value: HospitalStatusOutcome = {
            record: toPlanRecord(stored.planRow, stored.contactRows),
            exceptions: applied.value.exceptions,
            contactsCancelled: cancelled,
          };
          if (applied.value.incident) value.incident = applied.value.incident;
          return { ok: true, value };
        },
      });
    },

    async startContactDispatch(input: ContactStatusInput, context: WriteContext) {
      return contactStatusWrite(
        "startContactDispatch",
        "startContactDispatch",
        input,
        { type: "startProcessing" },
        context,
        true,
        true,
      );
    },

    async recordContactSent(input: ContactStatusInput, context: WriteContext) {
      return contactStatusWrite("recordContactSent", "recordContactSent", input, { type: "markSent" }, context, false);
    },

    async recordContactProviderStatus(input: ContactProviderStatusInput, context: WriteContext) {
      return contactStatusWrite(
        "recordContactProviderStatus",
        "recordContactProviderStatus",
        input,
        { type: "providerStatus", status: input.status },
        context,
        false,
        false,
        input.status,
      );
    },

    async recordContactMissed(input: ContactStatusInput, context: WriteContext) {
      // Not gated on an active plan: a window that closed while the plan was paused still has to be
      // recorded as missed, and recording it sends nothing.
      return contactStatusWrite(
        "recordContactMissed",
        "recordContactMissed",
        input,
        { type: "markMissed" },
        context,
        false,
      );
    },

    async rescheduleContact(input, context: WriteContext) {
      const permission: CaringContactAction = "toHour" in input.change ? "moveContactWithinDay" : "changeContactDate";
      return runWrite<StoredContact>({
        method: "rescheduleContact",
        input,
        context,
        auditAction: "rescheduleContact",
        objectType: "contact",
        objectId: input.contactId,
        stage: async (connection) => {
          const planRow = await selectPlanForUpdate(connection, input.planId);
          if (!planRow) return { ok: false, reason: REPOSITORY_REFUSALS.notFound };

          const team = toTeamId(textOf(planRow.team_id));
          if (!canPerformCaringContactAction(context.actor, permission, { teamId: team }).allowed) {
            return { ok: false, reason: REPOSITORY_REFUSALS.permissionDenied };
          }

          const contactResult = await connection.query(
            `select ${CONTACT_COLUMNS} from caring_contacts.contacts where plan_id = $1 and id = $2 for update`,
            [input.planId, input.contactId],
          );
          const contactRow = contactResult.rows[0];
          if (!contactRow) return { ok: false, reason: REPOSITORY_REFUSALS.notFound };
          if (numberOf(contactRow.version) !== input.expectedContactVersion) {
            return { ok: false, reason: REPOSITORY_REFUSALS.staleVersion };
          }

          // The STORED `planned` is the source of truth, never the caller's copy: a request built
          // from a stale or fabricated PlannedContact must not be able to smuggle a different
          // calendarDay/sendAt past the two rules below.
          const stored = toStoredContact(contactRow);
          const moved =
            "toHour" in input.change
              ? moveContactWithinDay({
                  contact: stored.planned,
                  toHour: input.change.toHour,
                  toMinute: input.change.toMinute,
                })
              : changeContactDate(
                  {
                    contact: stored.planned,
                    toCalendarDay: input.change.toCalendarDay,
                    reason: input.change.reason,
                    teamLeadApprovalActorId: input.change.teamLeadApprovalActorId,
                  },
                  clock,
                );
          if (!moved.ok) return moved;

          // Only the calendar entry changes; `state` is untouched. The version still advances, so a
          // second, concurrent reschedule of the same contact is refused as stale -- the same
          // optimistic-concurrency guarantee every other contact write gives.
          const nextVersion = stored.contact.version + 1;
          const written = await connection.query(
            `update caring_contacts.contacts
                set calendar_day = $2, send_at = $3, version = $4
              where id = $1 and version = $5`,
            [input.contactId, moved.value.calendarDay, moved.value.sendAt, nextVersion, stored.contact.version],
          );
          if (written.rowCount !== 1) {
            throw new Error(
              `caring-contacts: contact ${input.contactId} moved under an optimistic write that held a row lock`,
            );
          }

          return { ok: true, value: { contact: { ...stored.contact, version: nextVersion }, planned: moved.value } };
        },
      });
    },

    // ---------------------------------------------------------------------
    // Referrals
    // ---------------------------------------------------------------------

    async createReferral(input: CreateReferralInput, context: WriteContext) {
      return runWrite<Referral>({
        method: "createReferral",
        input,
        context,
        auditAction: "createReferral",
        objectType: "referral",
        objectId: input.referralId,
        stage: async (connection) => {
          const { actor } = context;
          if (!canPerformCaringContactAction(actor, "createReferral", { teamId: actor.teamId }).allowed) {
            return { ok: false, reason: REPOSITORY_REFUSALS.permissionDenied };
          }

          const referral: Referral = {
            id: input.referralId,
            teamId: actor.teamId,
            patientId: input.patientId,
            state: "awaitingHandover",
            pathwayVersionId: null,
          };

          // The primary key IS the uniqueness rule, so it is asked rather than re-derived by a
          // preceding SELECT. That also answers correctly for an identifier another team already
          // holds, which a team-scoped SELECT cannot see at all.
          const inserted = await withSavepoint(connection, INSERT_SAVEPOINT, () =>
            connection.query(
              `insert into caring_contacts.referrals (id, team_id, patient_id, state, pathway_version_id)
               values ($1, $2, $3, $4, null)`,
              [referral.id, referral.teamId, referral.patientId, referral.state],
            ),
          );
          if (!inserted.ok) {
            if (inserted.constraint === "referrals_pkey") {
              return { ok: false, reason: REPOSITORY_REFUSALS.referralAlreadyExists };
            }
            throw inserted.error;
          }

          return { ok: true, value: referral };
        },
      });
    },

    async transitionReferral(input: ReferralTransitionInput, context: WriteContext) {
      const permission: CaringContactAction =
        input.action.type === "accept"
          ? "acceptReferral"
          : input.action.type === "returnForClarification"
            ? "returnReferralForClarification"
            : "declineReferral";
      return runWrite<Referral>({
        method: "transitionReferral",
        input,
        context,
        auditAction: "transitionReferral",
        objectType: "referral",
        objectId: input.referralId,
        stage: async (connection) => {
          // Row-level security already excludes another team's referral, so this returns nothing for
          // it -- the same answer as for a referral that does not exist.
          const result = await connection.query(
            `select ${REFERRAL_COLUMNS} from caring_contacts.referrals where id = $1 for update`,
            [input.referralId],
          );
          const row = result.rows[0];
          if (!row) return { ok: false, reason: REPOSITORY_REFUSALS.notFound };

          const stored = toReferral(row);
          if (!canPerformCaringContactAction(context.actor, permission, { teamId: stored.teamId }).allowed) {
            return { ok: false, reason: REPOSITORY_REFUSALS.permissionDenied };
          }

          const transitioned = applyReferralTransition(stored, input.action);
          if (!transitioned.ok) return transitioned;

          await connection.query(
            "update caring_contacts.referrals set state = $2, pathway_version_id = $3 where id = $1",
            [input.referralId, transitioned.value.state, transitioned.value.pathwayVersionId],
          );
          return { ok: true, value: transitioned.value };
        },
      });
    },

    async listReferrals(context: ReadContext) {
      if (!mayReadOwnTeam(context, READ_ACTIONS.referral)) return [];
      return runRead(context, async (connection) => {
        const result = await connection.query(`select ${REFERRAL_COLUMNS} from caring_contacts.referrals order by id`);
        return result.rows.map(toReferral);
      });
    },

    // ---------------------------------------------------------------------
    // Pathway versions
    // ---------------------------------------------------------------------

    async savePathwayVersion(input: SavePathwayVersionInput, context: WriteContext) {
      return runWrite<PathwayVersion>({
        method: "savePathwayVersion",
        input,
        context,
        auditAction: "savePathwayVersion",
        objectType: "pathwayVersion",
        objectId: input.version.id,
        stage: async (connection) => {
          const { actor } = context;
          if (!canPerformCaringContactAction(actor, "authorPathwayVersion", { teamId: actor.teamId }).allowed) {
            return { ok: false, reason: REPOSITORY_REFUSALS.permissionDenied };
          }

          // AUTHORED CONTENT ONLY (Ruling 14). The caller supplies the identifier and the snapshot;
          // every governance field below is constructed here, server-side, whatever the caller sent.
          // `authorPathwayVersion` is held by the plain coordinator role, so trusting a caller's
          // `state`/`approvals` would let one actor seed a version straight into `approved` and have
          // a later legitimate publish succeed on a version nobody approved -- publication is not a
          // state of its own, it is a `publishedAt` recorded on an already approved version (see
          // ../pathway-versions). A caller-supplied `authorId` would equally defeat
          // `self-approval-denied`, which compares approvals against the STORED author. Every
          // governance transition therefore lives in `transitionPathwayVersion` alone.
          const version: PathwayVersion = {
            id: input.version.id,
            teamId: actor.teamId,
            state: "draft",
            authorId: actor.id,
            approvals: Object.freeze([]),
            publishedAt: null,
            retiredAt: null,
            retirementUrgency: null,
            snapshot: input.version.snapshot,
          };

          const inserted = await withSavepoint(connection, INSERT_SAVEPOINT, () =>
            connection.query(
              // `approver_id` is written null and never written again, deliberately. It is the
              // single-approver column from 0001, superseded by `pathway_version_approvals`, which
              // is where dual approval actually lives -- one column could only ever hold one name,
              // which is the single-person approval the two-role rule exists to make impossible.
              // The column is left in place rather than dropped; read it as vestigial, never as
              // state.
              `insert into caring_contacts.pathway_versions
                 (id, team_id, state, author_id, approver_id, published_at, retired_at, retirement_urgency, snapshot)
               values ($1, $2, $3, $4, null, null, null, null, $5::jsonb)`,
              [version.id, version.teamId, version.state, version.authorId, JSON.stringify(version.snapshot)],
            ),
          );
          if (!inserted.ok) {
            if (inserted.constraint === "pathway_versions_pkey") {
              return { ok: false, reason: REPOSITORY_REFUSALS.pathwayVersionAlreadyExists };
            }
            throw inserted.error;
          }

          return { ok: true, value: version };
        },
      });
    },

    async transitionPathwayVersion(input: PathwayVersionTransitionInput, context: WriteContext) {
      const permission: CaringContactAction =
        input.action.type === "submitForReview"
          ? "authorPathwayVersion"
          : input.action.type === "approve"
            ? "approvePathwayVersion"
            : input.action.type === "publish"
              ? "publishPathwayVersion"
              : "retirePathwayVersion";
      return runWrite<PathwayVersion>({
        method: "transitionPathwayVersion",
        input,
        context,
        auditAction: "transitionPathwayVersion",
        objectType: "pathwayVersion",
        objectId: input.pathwayVersionId,
        stage: async (connection) => {
          const locked = await connection.query(
            "select id from caring_contacts.pathway_versions where id = $1 for update",
            [input.pathwayVersionId],
          );
          if (!locked.rows[0]) return { ok: false, reason: REPOSITORY_REFUSALS.notFound };

          const stored = await readPathwayVersion(connection, input.pathwayVersionId);
          if (!stored) return { ok: false, reason: REPOSITORY_REFUSALS.notFound };
          if (!canPerformCaringContactAction(context.actor, permission, { teamId: stored.teamId }).allowed) {
            return { ok: false, reason: REPOSITORY_REFUSALS.permissionDenied };
          }

          const transitioned = applyPathwayVersionTransition(stored, input.action, clock);
          if (!transitioned.ok) return transitioned;

          // Only the approvals this transition actually appended: the domain returns the whole list
          // every time, and re-inserting it would duplicate every earlier approval on each later one.
          for (const approval of transitioned.value.approvals.slice(stored.approvals.length)) {
            await connection.query(
              `insert into caring_contacts.pathway_version_approvals
                 (pathway_version_id, team_id, author_id, role, actor_id, approved_at)
               values ($1, $2, $3, $4, $5, $6)`,
              [
                stored.id,
                stored.teamId,
                stored.authorId,
                approval.role,
                approval.actorId,
                new Date(approval.approvedAt),
              ],
            );
          }

          await connection.query(
            `update caring_contacts.pathway_versions
                set state = $2, published_at = $3, retired_at = $4, retirement_urgency = $5
              where id = $1`,
            [
              stored.id,
              transitioned.value.state,
              transitioned.value.publishedAt === null ? null : new Date(transitioned.value.publishedAt),
              transitioned.value.retiredAt === null ? null : new Date(transitioned.value.retiredAt),
              transitioned.value.retirementUrgency,
            ],
          );

          return { ok: true, value: transitioned.value };
        },
      });
    },

    async getPathwayVersion(id: PathwayVersionId, context: ReadContext) {
      if (!mayReadAnyOwnTeam(context, PATHWAY_VERSION_READ_ACTIONS)) return null;
      return runRead(context, (connection) => readPathwayVersion(connection, id));
    },

    async listPathwayVersions(context: ReadContext) {
      if (!mayReadAnyOwnTeam(context, PATHWAY_VERSION_READ_ACTIONS)) return [];
      return runRead(context, (connection) => readAllPathwayVersions(connection));
    },

    // ---------------------------------------------------------------------
    // Service state -- one record for the whole service, never one per team (Ruling 3).
    // ---------------------------------------------------------------------

    async getServiceState(context: ReadContext) {
      return runRead(context, (connection) => readServiceState(connection));
    },

    async stopService(input: { reason: ServiceStopReason; note: string }, context: WriteContext) {
      return runWrite<ServiceState>({
        method: "stopService",
        input,
        context,
        auditAction: "stopService",
        objectType: "serviceState",
        objectId: "service",
        bypassServiceStopGate: true,
        stage: async (connection) => {
          const { actor } = context;
          if (!canPerformCaringContactAction(actor, "triggerServiceSafetyStop", { teamId: actor.teamId }).allowed) {
            return { ok: false, reason: REPOSITORY_REFUSALS.permissionDenied };
          }

          // The reporting team is stamped onto the pre-stop snapshot here, not inside
          // applyServiceStop -- that function only ever carries `reportedByTeamId` forward. It never
          // scopes the stop: every team is blocked regardless.
          // ONE read of the clock, for the domain and for the rows alike -- see `pinnedClock`.
          const at = clock.now();
          const stamped = pinnedClock(at);

          const seeded: ServiceState = {
            ...(await readServiceState(connection, true)),
            reportedByTeamId: actor.teamId,
          };
          const applied = applyServiceStop(
            seeded,
            { reason: input.reason, actorId: actor.id, note: input.note },
            stamped,
          );
          if (!applied.ok) return applied;
          const stopped = applied.value;
          if (!stopped.stopped) throw new Error("caring-contacts: an accepted stop must be a stopped state");

          // THE STORE MINTS THE INCIDENT IDENTIFIER. The domain has no `stopId` concept -- neither
          // `ServiceState` nor `stopService({ reason, note })` mentions one -- and
          // `service_state_stop_is_identified` requires the singleton to name its incident. Without
          // this the constraint would turn a safety stop into a refused write, which is the one write
          // in this system that must never be blocked. It stays a persistence detail: surfacing it on
          // the sealed `ServiceState` would force the in-memory store, which has no incident history
          // to mint one from, to invent a fake (controller Ruling 36).
          const incident = await connection.query(
            `insert into caring_contacts.service_stops
               (stop_id, reason, note, stopped_by, stopped_at, reported_by_team_id)
             values (gen_random_uuid(), $1, $2, $3, $4, $5)
             returning stop_id`,
            [stopped.reason, stopped.note, stopped.stoppedBy, at, actor.teamId],
          );
          const stopId = textOf(incident.rows[0].stop_id);

          // THE CONFLICT UPDATE IS GUARDED, and that guard is the whole point of it. The FIRST-EVER
          // stop is the one race a row lock cannot cover: until one of two simultaneous callers
          // creates the singleton there is no row for `for update` to hold, so both pass the domain
          // check above. An unguarded `do update` would then let the loser overwrite the winner's
          // reason, actor and incident -- and ../service-state exists to hold the opposite: the
          // FIRST record of an incident is permanent.
          const singleton = await connection.query(
            `insert into caring_contacts.service_state
               (singleton, stopped, stopped_by, stopped_at, reported_by_team_id, stop_id, updated_at)
             values (true, true, $1, $2, $3, $4::uuid, $2)
             on conflict (singleton) do update
               set stopped = true, stopped_by = excluded.stopped_by, stopped_at = excluded.stopped_at,
                   reported_by_team_id = excluded.reported_by_team_id, stop_id = excluded.stop_id,
                   updated_at = excluded.updated_at
               where service_state.stopped = false`,
            [stopped.stoppedBy, at, actor.teamId, stopId],
          );

          if (singleton.rowCount !== 1) {
            // Lost that race. The incident row inserted above stays: it is a real account a real
            // responder wrote, and the schema keeps one row per incident. Only the singleton names
            // the CURRENT one, and it still names the winner's.
            //
            // The reason is asked of the domain rather than spelled here, so the two stores cannot
            // drift on the wire text a caller sees for a second stop.
            const secondStop = applyServiceStop(
              stopped,
              { reason: input.reason, actorId: actor.id, note: input.note },
              stamped,
            );
            if (secondStop.ok) {
              throw new Error("caring-contacts: the service-stop rule no longer refuses a second stop");
            }
            return secondStop;
          }

          return { ok: true, value: stopped };
        },
      });
    },

    async approveServiceRestart(input: { role: ServiceRestartApprovalRole }, context: WriteContext) {
      return runWrite<ServiceRestartOutcome>({
        method: "approveServiceRestart",
        input,
        context,
        auditAction: "approveServiceRestart",
        objectType: "serviceState",
        objectId: "service",
        bypassServiceStopGate: true,
        stage: async (connection) => {
          const { actor } = context;
          if (!canPerformCaringContactAction(actor, "approveServiceRestart", { teamId: actor.teamId }).allowed) {
            return { ok: false, reason: REPOSITORY_REFUSALS.permissionDenied };
          }

          // ONE read of the clock, as in `stopService`. It also covers the awkward case: the
          // approval that COMPLETES the restart returns a running state carrying no approvals at
          // all, so there is no domain instant left to read back out of the result -- `at` is the
          // only thing that can be both stamped and persisted.
          const at = clock.now();
          const stamped = pinnedClock(at);

          const row = await selectServiceState(connection, true);
          const current = await serviceStateFrom(connection, row);
          const applied = applyServiceRestartApproval(current, { role: input.role, actorId: actor.id }, stamped);
          if (!applied.ok) return applied;
          if (!row) throw new Error("caring-contacts: an accepted restart approval must name an incident");

          const stopId = textOf(row.stop_id);
          const recorded = await withSavepoint(connection, INSERT_SAVEPOINT, () =>
            connection.query(
              `insert into caring_contacts.service_restart_approvals
                 (stop_id, role, actor_id, approved_at, approved_by_team_id)
               values ($1::uuid, $2, $3, $4, $5)`,
              [stopId, input.role, actor.id, at, actor.teamId],
            ),
          );
          if (!recorded.ok) {
            // Two approvals racing each other reach the database rather than the check above. Mapped
            // by CONSTRAINT NAME, never by reading the message text, so both stores answer a
            // duplicate role and a duplicate person with the reasons ../service-state uses.
            //
            // Looked up by OWN property. This is a frozen object literal indexed by a string read
            // off a driver error, so `RESTART_APPROVAL_REFUSALS["toString"]` would be a FUNCTION and
            // `if (refusal)` would treat it as a mapped refusal -- returning a function as the
            // reason instead of rethrowing an unrecognised constraint. Same shape as the
            // capability-table lookup in ../permissions; see the note there.
            const constraint = recorded.constraint ?? "";
            const refusal = Object.hasOwn(RESTART_APPROVAL_REFUSALS, constraint)
              ? RESTART_APPROVAL_REFUSALS[constraint]
              : undefined;
            if (refusal !== undefined) return { ok: false, reason: refusal };
            throw recorded.error;
          }

          // Only the approval that completes the third distinct role restarts the service.
          if (!applied.value.stopped) {
            await connection.query(
              "update caring_contacts.service_stops set restarted_at = $2 where stop_id = $1::uuid",
              [stopId, at],
            );
            await connection.query(
              "update caring_contacts.service_state set stopped = false, stop_id = null, updated_at = $1 where singleton",
              [at],
            );
          }

          // Ruling 65: the OUTCOME, not the record. The stored replay result is whatever this
          // returns, and it is stored under the APPROVING team's id -- which for a service-wide
          // restart approval may not be the reporting team. `restartOutcomeOf` is the domain's own
          // projection, so both stores narrow identically. The commit below still writes the whole
          // state; it is only what leaves this method that is narrow.
          return { ok: true, value: restartOutcomeOf(applied.value) };
        },
      });
    },

    // ---------------------------------------------------------------------
    // Assignment
    // ---------------------------------------------------------------------

    async getAssignment(planId: PlanId, context: ReadContext) {
      if (!mayReadOwnTeam(context, READ_ACTIONS.plan)) return null;
      return runRead(context, async (connection) => {
        const stored = await readPlanRecord(connection, planId);
        if (!stored) return null;
        return readAssignment(connection, planId);
      });
    },

    async applyAssignment(input: { planId: PlanId; action: AssignmentAction }, context: WriteContext) {
      const permission: CaringContactAction =
        input.action.type === "claim"
          ? "claimPlan"
          : input.action.type === "reassign"
            ? "reassignPlan"
            : "coverCoordinator";
      return runWrite<PlanAssignment>({
        method: "applyAssignment",
        input,
        context,
        auditAction: "applyAssignment",
        objectId: input.planId,
        stage: async (connection) => {
          const planRow = await selectPlanForUpdate(connection, input.planId);
          if (!planRow) return { ok: false, reason: REPOSITORY_REFUSALS.notFound };

          const team = toTeamId(textOf(planRow.team_id));
          if (!canPerformCaringContactAction(context.actor, permission, { teamId: team }).allowed) {
            return { ok: false, reason: REPOSITORY_REFUSALS.permissionDenied };
          }
          // A claim records who TOOK the work, and the audit event for this write names the caller.
          // Letting the ledger name somebody else would leave the two records of "who owns this plan"
          // contradicting each other. Scoped to `claim` alone: `startCoverage`'s `actorId` and
          // `reassign`'s `toActorId` legitimately name a third party, which is the point of both.
          if (input.action.type === "claim" && input.action.actorId !== context.actor.id) {
            return { ok: false, reason: REPOSITORY_REFUSALS.permissionDenied };
          }

          const current = await readAssignment(connection, input.planId);
          const transitioned = applyAssignmentAction(current, input.action, clock);
          if (!transitioned.ok) return transitioned;

          await writeAssignment(connection, input.planId, team, transitioned.value, current.reassignmentHistory.length);
          return { ok: true, value: transitioned.value };
        },
      });
    },

    // ---------------------------------------------------------------------
    // Reconciliation
    // ---------------------------------------------------------------------

    async listDispatches(input: { fromIso: string; toIso: string }, context: ReadContext) {
      if (!mayReadOwnTeam(context, "reconcileProviderDispatch")) return [];
      return runRead(context, async (connection) => {
        const result = await connection.query(
          `select ${DISPATCH_COLUMNS} from caring_contacts.contact_dispatches d
             join caring_contacts.contacts c on c.id = d.contact_id
            where d.started_at >= $1 and d.started_at <= $2
            order by d.contact_id, d.attempt`,
          [new Date(input.fromIso), new Date(input.toIso)],
        );
        return result.rows.map(toDispatchRecord);
      });
    },

    async resolveDispatchDiscrepancy(input: ResolveDiscrepancyInput, context: WriteContext) {
      return runWrite<DispatchRecord>({
        method: "resolveDispatchDiscrepancy",
        input,
        context,
        auditAction: "resolveDispatchDiscrepancy",
        objectType: "contact",
        objectId: input.contactId,
        stage: async (connection) => {
          // Row-level security scopes both tables, so another team's attempt returns nothing here --
          // the same answer as an attempt that was never opened.
          const result = await connection.query(
            `select ${DISPATCH_COLUMNS}, d.id as dispatch_id from caring_contacts.contact_dispatches d
               join caring_contacts.contacts c on c.id = d.contact_id
              where d.contact_id = $1 and d.attempt = $2
              for update of d`,
            [input.contactId, input.attempt],
          );
          const row = result.rows[0];
          if (!row) return { ok: false, reason: REPOSITORY_REFUSALS.notFound };

          if (
            !canPerformCaringContactAction(context.actor, "reconcileProviderDispatch", {
              teamId: context.actor.teamId,
            }).allowed
          ) {
            return { ok: false, reason: REPOSITORY_REFUSALS.permissionDenied };
          }
          if (!isAbsent(row.discrepancy_resolved_at)) {
            return { ok: false, reason: REPOSITORY_REFUSALS.dispatchDiscrepancyAlreadyResolved };
          }
          if (input.note.trim() === "") {
            return { ok: false, reason: REPOSITORY_REFUSALS.dispatchDiscrepancyNoteRequired };
          }

          // Only the resolution, its note and its timestamp are recorded. Nothing here touches the
          // contact at all -- there is no re-dispatch, for any resolution including
          // `unresolvedNoResend`.
          const resolvedAt = clock.now();
          await connection.query(
            `update caring_contacts.contact_dispatches
                set discrepancy_resolved_at = $2, discrepancy_resolution = $3, discrepancy_note = $4
              where id = $1`,
            [numberOf(row.dispatch_id), resolvedAt, input.resolution, input.note],
          );

          return {
            ok: true,
            value: {
              ...toDispatchRecord(row),
              discrepancyResolvedAt: resolvedAt,
              discrepancyResolution: input.resolution,
            },
          };
        },
      });
    },

    // ---------------------------------------------------------------------
    // Access trail
    // ---------------------------------------------------------------------

    async recordAccess(record: AccessRecord) {
      // Deliberately outside `runWrite`: this is a best-effort append with no refusal to report (the
      // interface returns void), no idempotency key, and no service-stop gate -- blocking it would
      // take the trail dark for exactly the incidents, `audit-integrity-loss` included, it exists to
      // prove happened. The event is built first, so a non-identifier-shaped objectId throws before
      // any storage is touched.
      const event = buildAccessAuditEvent(record, clock);
      await options.auditSink?.record(event);
      await inTransaction(record.teamId, null, async (connection) => {
        await ensureTeam(connection, record.teamId);
        await insertAuditEvent(connection, event, null);
      });
    },

    async listAccessTrail(input: AccessTrailQuery, context: ReadContext) {
      if (!mayReadOwnTeam(context, READ_ACTIONS.auditTrail)) return [];
      return runRead(context, async (connection) => {
        const conditions: string[] = [];
        const values: SqlValue[] = [];
        const placeholder = (value: SqlValue): string => {
          values.push(value);
          return `$${values.length}`;
        };

        // `occurred_at` holds the AWST instant as the domain rendered it, so it is compared as a
        // timestamp rather than as text -- a lexical comparison would be wrong the moment a caller
        // passed a range in any other ISO form.
        if (input.fromIso !== undefined) {
          conditions.push(`occurred_at::timestamptz >= ${placeholder(new Date(input.fromIso))}`);
        }
        if (input.toIso !== undefined) {
          conditions.push(`occurred_at::timestamptz <= ${placeholder(new Date(input.toIso))}`);
        }
        if (input.actorId !== undefined) conditions.push(`actor_id = ${placeholder(input.actorId)}`);
        if (input.objectType !== undefined) conditions.push(`object_type = ${placeholder(input.objectType)}`);

        const where = conditions.length === 0 ? "" : ` where ${conditions.join(" and ")}`;
        const result = await connection.query(
          `select ${AUDIT_EVENT_COLUMNS} from caring_contacts.audit_events${where}
            order by id offset ${placeholder(input.offset)} limit ${placeholder(input.limit)}`,
          values,
        );
        return result.rows.map(toAuditEvent);
      });
    },

    // ---------------------------------------------------------------------
    // Preferences, training, and clearing an episode's identifying detail
    // ---------------------------------------------------------------------

    async getNotificationPreferences(context: ReadContext) {
      return runRead(context, async (connection) => {
        const result = await connection.query(
          "select actor_id, opted_in from caring_contacts.notification_preferences where actor_id = $1",
          [context.actor.id],
        );
        const row = result.rows[0];
        if (!row) return defaultNotificationPreferences(context.actor.id);
        return Object.freeze({
          actorId: toActorId(textOf(row.actor_id)),
          optedIn: Object.freeze([...((row.opted_in as string[] | null) ?? [])] as AlertClass[]),
        });
      });
    },

    async saveNotificationPreferences(input: NotificationPreferences, context: WriteContext) {
      return runWrite<NotificationPreferences>({
        method: "saveNotificationPreferences",
        input,
        context,
        auditAction: "saveNotificationPreferences",
        objectType: "notificationPreferences",
        objectId: context.actor.id,
        stage: async (connection) => {
          const { actor } = context;
          if (input.actorId !== actor.id) return { ok: false, reason: REPOSITORY_REFUSALS.permissionDenied };
          if (
            !canPerformCaringContactAction(actor, "manageNotificationPreferences", { teamId: actor.teamId }).allowed
          ) {
            return { ok: false, reason: REPOSITORY_REFUSALS.permissionDenied };
          }

          const saved: NotificationPreferences = Object.freeze({
            actorId: input.actorId,
            optedIn: Object.freeze([...input.optedIn]),
          });
          await connection.query(
            `insert into caring_contacts.notification_preferences (actor_id, team_id, opted_in)
             values ($1, $2, $3)
             on conflict (actor_id) do update set team_id = excluded.team_id, opted_in = excluded.opted_in`,
            [saved.actorId, actor.teamId, [...saved.optedIn]],
          );
          return { ok: true, value: saved };
        },
      });
    },

    async getTrainingRecord(context: ReadContext) {
      return runRead(context, async (connection) => {
        const result = await connection.query(
          "select actor_id, completed from caring_contacts.training_records where actor_id = $1",
          [context.actor.id],
        );
        const row = result.rows[0];
        if (!row) return emptyTrainingRecord(context.actor.id);
        return Object.freeze({
          actorId: toActorId(textOf(row.actor_id)),
          completed: Object.freeze([...((row.completed as string[] | null) ?? [])] as TrainingCompetency[]),
        });
      });
    },

    async recordTrainingCompetency(input: { competency: TrainingCompetency }, context: WriteContext) {
      return runWrite<TrainingRecord>({
        method: "recordTrainingCompetency",
        input,
        context,
        auditAction: "recordTrainingCompetency",
        objectType: "trainingRecord",
        objectId: context.actor.id,
        stage: async (connection) => {
          const { actor } = context;
          if (!canPerformCaringContactAction(actor, "enterTrainingMode", { teamId: actor.teamId }).allowed) {
            return { ok: false, reason: REPOSITORY_REFUSALS.permissionDenied };
          }

          const existing = await connection.query(
            "select completed from caring_contacts.training_records where actor_id = $1 for update",
            [actor.id],
          );
          const row = existing.rows[0];
          const current: TrainingRecord = row
            ? {
                actorId: actor.id,
                completed: [...((row.completed as string[] | null) ?? [])] as TrainingCompetency[],
              }
            : emptyTrainingRecord(actor.id);

          const updated = recordCompetency(current, input.competency);
          await connection.query(
            `insert into caring_contacts.training_records (actor_id, team_id, completed)
             values ($1, $2, $3)
             on conflict (actor_id) do update set team_id = excluded.team_id, completed = excluded.completed`,
            [actor.id, actor.teamId, [...updated.completed]],
          );
          return { ok: true, value: updated };
        },
      });
    },

    async markRetentionCleared(input: { planId: PlanId }, context: WriteContext) {
      return runWrite<void>({
        method: "markRetentionCleared",
        input,
        context,
        auditAction: "markRetentionCleared",
        objectId: input.planId,
        stage: async (connection) => {
          const planRow = await selectPlanForUpdate(connection, input.planId);
          if (!planRow) return { ok: false, reason: REPOSITORY_REFUSALS.notFound };

          const team = toTeamId(textOf(planRow.team_id));
          if (
            !canPerformCaringContactAction(context.actor, "generateClinicalRecordSummary", { teamId: team }).allowed
          ) {
            return { ok: false, reason: REPOSITORY_REFUSALS.permissionDenied };
          }

          // Admissibility is ../retention's rule, not this store's: an episode that has not ended
          // has no instant to clear against, and the schema's own check refuses the row for exactly
          // that reason. Asking the domain is what keeps the two stores answering identically, and
          // it leaves no conditional here -- an admitted clearance ALWAYS writes its row, so a later
          // purge can find the episode.
          const admitted = admitRetentionClearance({
            state: textOf(planRow.state) as PlanState,
            planDates: { completedAt: isAbsent(planRow.completed_at) ? null : instantOf(planRow.completed_at) },
          });
          if (!admitted.ok) return admitted;

          await connection.query(
            `insert into caring_contacts.retention_state
               (plan_id, team_id, terminal_at, cleared_at)
             values ($1, $2, $3, $4)
             on conflict (plan_id) do update
               set terminal_at = excluded.terminal_at, cleared_at = excluded.cleared_at`,
            [input.planId, team, admitted.value, clock.now()],
          );

          // Ruling 64: PERFORM the clearance, in the SAME transaction that records it. Writing
          // `cleared_at` and nothing else left the patient's name, mobile number, identifiers and
          // cultural identity all in place -- `getEpisode` handed every one of them back afterwards
          // -- while anything reading `cleared_at` concluded they had been removed. Same transaction
          // rather than a later sweep, so a committed clearance record and un-cleared detail cannot
          // coexist: if the de-identification fails, the record does not commit either.
          //
          // The four fields are exactly ../retention's list. `patient_name` and
          // `patient_mobile_number` are `not null` in the schema, so the cleared value is the empty
          // string ../repository fixes for both stores; cultural identity lives in its own
          // projection and is DELETED, because that table holds nothing but the identity itself.
          await connection.query(
            `update caring_contacts.plans
                set patient_name = $2, patient_mobile_number = $3, patient_identifiers = $4
              where id = $1`,
            [
              input.planId,
              CLEARED_PATIENT_DETAIL.patientName,
              CLEARED_PATIENT_DETAIL.patientMobileNumber,
              [...CLEARED_PATIENT_DETAIL.patientIdentifiers],
            ],
          );
          await connection.query("delete from caring_contacts.cultural_identity_reports where plan_id = $1", [
            input.planId,
          ]);

          return { ok: true, value: undefined };
        },
      });
    },

    async getPlan(planId: PlanId, context: ReadContext) {
      if (!mayReadOwnTeam(context, READ_ACTIONS.plan)) return null;
      return runRead(context, async (connection) => {
        const stored = await readPlanRecord(connection, planId);
        return stored ? toPlanRecord(stored.planRow, stored.contactRows) : null;
      });
    },

    async listPlans(context: ReadContext) {
      if (!mayReadOwnTeam(context, READ_ACTIONS.plan)) return [];
      return runRead(context, async (connection) => {
        const plans = await connection.query(`select ${PLAN_COLUMNS} from caring_contacts.plans order by id`);
        const contacts = await connection.query(
          `select ${CONTACT_COLUMNS} from caring_contacts.contacts order by plan_id, sequence`,
        );
        const byPlan = new Map<string, SqlRow[]>();
        for (const row of contacts.rows) {
          const key = textOf(row.plan_id);
          const bucket = byPlan.get(key);
          if (bucket) bucket.push(row);
          else byPlan.set(key, [row]);
        }
        return plans.rows.map((row) => toPlanRecord(row, byPlan.get(textOf(row.id)) ?? []));
      });
    },

    async listContacts(planId: PlanId, context: ReadContext) {
      if (!mayReadOwnTeam(context, READ_ACTIONS.contacts)) return [];
      return runRead(context, async (connection) => {
        // Scoped through the plan, so a contact whose plan is invisible is invisible too.
        const stored = await readPlanRecord(connection, planId);
        return stored ? stored.contactRows.map(toStoredContact) : [];
      });
    },

    async listSendableContacts(planId: PlanId, context: ReadContext) {
      if (!mayReadOwnTeam(context, READ_ACTIONS.contacts)) return [];
      return runRead(context, async (connection) => {
        const stored = await readPlanRecord(connection, planId);
        if (!stored) return [];
        // Keyed off the stored contact state, set from `sendableContacts` at creation and then only
        // ever moved by the lifecycle. Nothing here looks at `send_at`.
        return stored.contactRows.filter((row) => textOf(row.state) === "scheduled").map(toStoredContact);
      });
    },

    async listAuditEvents(context: ReadContext) {
      if (!mayReadOwnTeam(context, READ_ACTIONS.auditTrail)) return [];
      return runRead(context, async (connection) => {
        const result = await connection.query(
          `select ${AUDIT_EVENT_COLUMNS} from caring_contacts.audit_events order by id`,
        );
        return result.rows.map(toAuditEvent);
      });
    },

    async getEpisode(planId: PlanId, context: ReadContext): Promise<Episode | null> {
      if (!mayReadOwnTeam(context, READ_ACTIONS.episode)) return null;
      return runRead(context, async (connection) => {
        const stored = await readPlanRecord(connection, planId);
        if (!stored) return null;
        const { planRow, contactRows } = stored;

        // Cultural identity is read from the projection, never from the plan row -- the plan row
        // has no such column, which is the point.
        const cultural = await connection.query(
          "select cultural_identity from caring_contacts.cultural_identity_reports where plan_id = $1",
          [planId],
        );
        const culturalIdentity = cultural.rows[0] ? textOf(cultural.rows[0].cultural_identity) : null;

        const detail: EpisodePatientDetail = {
          patientName: textOf(planRow.patient_name),
          patientMobileNumber: textOf(planRow.patient_mobile_number),
          patientIdentifiers: [...((planRow.patient_identifiers as string[] | null) ?? [])],
          culturalIdentity,
        };
        const states = contactRows.map((row) => textOf(row.state) as ContactState);

        return {
          state: textOf(planRow.state) as PlanState,
          patientName: detail.patientName,
          patientMobileNumber: detail.patientMobileNumber,
          patientIdentifiers: detail.patientIdentifiers,
          culturalIdentity: detail.culturalIdentity,
          planDates: {
            dischargeAt: instantOf(planRow.discharge_at),
            completedAt:
              planRow.completed_at === null || planRow.completed_at === undefined
                ? null
                : instantOf(planRow.completed_at),
          },
          pathwayVersionId: textOf(planRow.pathway_version_id) as PathwayVersionId,
          teamId: toTeamId(textOf(planRow.team_id)),
          outcome: textOf(planRow.outcome),
          counts: {
            contactsScheduled: contactRows.filter(
              (row) => row.suppressed_reason === null || row.suppressed_reason === undefined,
            ).length,
            contactsSent: states.filter((state) => DISPATCHED_CONTACT_STATES.includes(state)).length,
            contactsDelivered: states.filter((state) => state === "delivered").length,
          },
        };
      });
    },
  };
}
