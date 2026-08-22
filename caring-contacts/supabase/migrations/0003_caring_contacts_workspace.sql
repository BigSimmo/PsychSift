-- caring-contacts/supabase/migrations/0003_caring_contacts_workspace.sql
--
-- The workspace schema: the tables and keys the rules layer needs once assignment, coverage,
-- pathway governance, delivery-discrepancy handling and the service-wide safety stop are real.
--
-- THIS DIRECTORY IS NOT THE REPOSITORY'S `supabase/migrations/`. That directory replays against
-- the live Clinical KB project; nothing here may ever be placed there, and both
-- tests/caring-contacts-domain-isolation.test.ts and tests/caring-contacts-migrations.test.ts
-- fail if a caring-contact migration appears in it.
--
-- Four decisions here are load-bearing rather than stylistic:
--
--   * THE SERVICE STOP IS A SINGLETON. `service_state` arrived in 0001 keyed by team, one row per
--     team. That shape is the failure it exists to prevent: a stop raised by the ward that found a
--     wrong-recipient message would have read as "stopped" on that team's screens while every
--     other team kept sending straight through the incident. The table is converted to a single
--     row whose key is pinned by the schema, and the old team column becomes
--     `reported_by_team_id` -- attribution, never a scoping key. The name is deliberately not
--     `team_id` so the old mistake cannot be made by reading the column list.
--
--   * EVERY INCIDENT GETS ITS OWN IMMUTABLE ROW. `service_stops` holds one row per incident and
--     `service_state` is a singleton pointing at the current one. That is what lets
--     `service_restart_approvals.stop_id` be a REAL foreign key: a key onto the singleton's own
--     `stop_id` could not be, because that column is cleared on restart and replaced by the next
--     incident's, so the key would either refuse the second incident outright or -- with ON UPDATE
--     CASCADE -- silently rewrite the first incident's three approvals onto the new stop and
--     present a brand-new live incident as already three-person approved. Immutable incident rows
--     move that guarantee out of "the store must remember a WHERE clause" and into "the schema
--     cannot express the wrong thing". Immutability is enforced by a trigger, not by convention,
--     and `service_stops` is also the SINGLE place the current incident's reason and note live.
--
--   * RESTART APPROVALS ARE KEYED ON THE STOP, NEVER ON THE TEAM. Three roles held by three
--     different people must approve a restart. Keyed on the team, the approvals recorded for a
--     first incident would permanently bar their approvers from approving any later one, so a
--     team's second incident could become unrestartable -- an incident-response control that
--     degrades with use. Keyed on the stop instance, "three different people per restart" holds
--     for every incident, and the earlier incident's record survives untouched.
--
--   * THE TWO NEW FOREIGN KEYS CARRY THE TEAM. Foreign-key checks are performed by the system and
--     are NOT subject to row-level security, so a bare `plans.referral_id references referrals
--     (id)` would happily let one hospital team's plan point at another team's referral. Both new
--     keys are composite on `(id, team_id)` so a link that crosses teams is refused by the
--     database rather than merely discouraged by the application.
--
--   * COVERAGE WINDOWS ARE AWST CALENDAR DAYS, NOT INSTANTS. `coverage_from` / `coverage_until`
--     are `text` in `YYYY-MM-DD` form, checked by pattern. A timestamptz would silently re-anchor
--     a Perth working day to UTC and move somebody's cover by eight hours.
--
-- Replay-safe: every statement is `if not exists`, `drop ... if exists`, or guarded inside a `do`
-- block, because tests/caring-contacts-migrations.test.ts re-applies the whole set and asserts it
-- does not error. NO CREATE INDEX CONCURRENTLY -- it cannot run inside a transaction.

begin;

-- ---------------------------------------------------------------------------
-- A migration-local helper so constraints are added from a driven list rather than by wrapping
-- each one in its own hand-written existence check. Dropped again at the end of the file: a
-- function that executes arbitrary DDL should not outlive the migration that needed it.
-- ---------------------------------------------------------------------------
create or replace function caring_contacts.add_constraint_if_absent(
  p_table text,
  p_constraint text,
  p_definition text
)
returns void
language plpgsql
as $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint c
    join pg_catalog.pg_class t on t.oid = c.conrelid
    join pg_catalog.pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'caring_contacts' and t.relname = p_table and c.conname = p_constraint
  ) then
    execute format('alter table caring_contacts.%I add constraint %I %s', p_table, p_constraint, p_definition);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- The service-wide safety stop
-- ---------------------------------------------------------------------------

-- One row per incident, written when the stop is recorded and never rewritten afterwards.
-- `restarted_at` is the ONLY field that changes after insert; everything else is the record of
-- what a responder found and when, and the restart approvals hang off `stop_id` by foreign key.
--
-- TO WHOEVER WRITES THE POSTGRES STORE: there is no stopId anywhere in the domain. Neither
-- `ServiceState` nor `stopService({ reason, note })` in src/lib/caring-contacts/service-state.ts
-- mentions one, so THE STORE MUST MINT THE UUID ITSELF on every stop and carry it into both this
-- table and `service_state.stop_id`. If it does not, `service_state_stop_is_identified` below
-- turns a safety stop into a refused write -- the one write in this system that must never fail.
create table if not exists caring_contacts.service_stops (
  stop_id uuid primary key,
  -- The five categorised reasons, copied verbatim from `ServiceStopReason` in
  -- src/lib/caring-contacts/service-state.ts.
  reason text not null,
  -- Free text written by a responder mid-incident. Treat it as patient data.
  note text,
  stopped_by text not null,
  stopped_at timestamptz not null default now(),
  -- Attribution only. It does NOT scope the stop: a stop halts sending for every team.
  reported_by_team_id text references caring_contacts.teams (id),
  restarted_at timestamptz,
  constraint service_stops_reason_is_known check (
    reason in (
      'wrong-recipient', 'duplicate-send', 'unauthorised-content',
      'privacy-or-security-incident', 'audit-integrity-loss'
    )
  )
);

-- Only `restarted_at` may ever change. Enforced rather than left to convention: this table is the
-- durable record of safety incidents, and `audit-integrity-loss` is itself one of the five stop
-- reasons -- a history whose closed rows can be silently rewritten undercuts the very thing it
-- was added for. The primary key alone only guarantees that a stop_id is never reused; it says
-- nothing about the reason or the responder recorded against it.
create or replace function caring_contacts.assert_service_stop_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- An ALLOWLIST, not a blocklist. The whole row is compared as jsonb with the one mutable field
  -- removed, rather than naming the frozen columns: a hand-written list defaults any column added
  -- LATER to mutable, silently, and this table is being extended while the build is in flight. The
  -- safe default for an immutability guard is that everything is frozen except the named exception,
  -- so a new column is covered the moment it exists. `to_jsonb` and the `jsonb - text` operator
  -- both live in pg_catalog, which Postgres searches implicitly even under `set search_path = ''`.
  if to_jsonb(new) - 'restarted_at' is distinct from to_jsonb(old) - 'restarted_at' then
    raise exception
      'caring-contacts-service-stop-immutable: a recorded incident may only change its restarted_at';
  end if;
  -- And `restarted_at` is WRITE-ONCE, not merely writable. null -> a value is the restart being
  -- recorded, and that stays allowed; once set, any further change is a rewrite of a closed
  -- incident. Clearing it back to null would make a restarted stop read as never restarted, and
  -- moving it would report a shorter outage than the one that happened. Both are exactly the
  -- silent rewriting this trigger exists to prevent, so "the only field that changes" has to mean
  -- it changes ONCE.
  if old.restarted_at is not null and new.restarted_at is distinct from old.restarted_at then
    raise exception
      'caring-contacts-service-stop-immutable: a recorded restart is never rewritten';
  end if;
  return new;
end;
$$;

drop trigger if exists service_stops_immutable on caring_contacts.service_stops;
create trigger service_stops_immutable
  before update on caring_contacts.service_stops
  for each row execute function caring_contacts.assert_service_stop_immutable();

-- DELETE is deliberately NOT blocked here, and that is a decision rather than an oversight.
-- `caring_contacts_app` holds DELETE on this table, and a restarted incident with no approval rows
-- is referenced by nothing -- the singleton's `stop_id` is cleared on restart -- so a
-- delete-then-reinsert of the same `stop_id` could rewrite an incident wholesale. That is a real
-- gap in an immutability story and it is left open knowingly.
--
-- Owner decision, 2026-08-21: patient case notes stay an available capability and the record is
-- KEPT, built brief and lightweight now to be extended later. So this table needs no purge or
-- de-identification path at this stage, and DELETE is left where a future removal path can still
-- reach it. `note` is still free text a responder wrote mid-incident, so the
-- `-- Treat it as patient data.` classification on that column stands and every privacy control
-- over it stands with it -- retained is not the same as not sensitive.
--
-- If DELETE is ever blocked, a removal path MUST land in the same change. The guard above already
-- forbids nulling `note` by UPDATE, so blocking DELETE alone would make that field permanently
-- unremovable -- the worst of both dispositions. Tracked for the phase that builds case notes
-- properly: docs/outstanding-issues-inbox/049e0356-b6ad-4382-8f34-958d2681c60e.json.

-- Convert the per-team table into a singleton. Guarded on the old column so a replay, where the
-- rename has already happened, is a no-op.
do $$
begin
  if exists (
    select 1 from pg_catalog.pg_attribute a
    where a.attrelid = 'caring_contacts.service_state'::regclass
      and a.attname = 'team_id'
      and a.attnum > 0
      and not a.attisdropped
  ) then
    alter table caring_contacts.service_state drop constraint if exists service_state_pkey;
    alter table caring_contacts.service_state rename column team_id to reported_by_team_id;
    alter table caring_contacts.service_state alter column reported_by_team_id drop not null;
  end if;
end
$$;

alter table caring_contacts.service_state add column if not exists singleton boolean not null default true;
alter table caring_contacts.service_state add column if not exists stop_id uuid;

-- Superseded by service_restart_approvals: a single text column could only ever hold one name,
-- which is the single-person restart the three-role rule exists to make impossible.
alter table caring_contacts.service_state drop column if exists restart_approved_by;

-- The current incident's reason and note live ONCE, on `service_stops`, reached by `stop_id`.
-- They were briefly held here as well; two copies of a safety incident's reason can drift, and
-- the worst place for that to surface is the banner rendering the stale one on every screen.
-- Removing the duplication needs no constraint to police it. Dropping these columns also drops
-- the checks that named them, which is why the narrowed check is (re)added below.
alter table caring_contacts.service_state drop column if exists stopped_reason;
alter table caring_contacts.service_state drop column if exists stop_note;

select caring_contacts.add_constraint_if_absent(
  'service_state', 'service_state_is_singleton', 'check (singleton)'
);
select caring_contacts.add_constraint_if_absent(
  'service_state', 'service_state_pkey', 'primary key (singleton)'
);
-- The singleton names the CURRENT incident, or null while the service is running.
select caring_contacts.add_constraint_if_absent(
  'service_state',
  'service_state_stop_fk',
  'foreign key (stop_id) references caring_contacts.service_stops (stop_id)'
);
-- Stopping must never be blocked, so this asks only for the identifier the incident row and the
-- restart approvals are both keyed to -- which the responder's own stop already minted. The
-- reason is carried by `service_stops.reason not null` on the far side of `service_state_stop_fk`,
-- so it needs no second check here. Without this, a stop could exist that no approval could name.
select caring_contacts.add_constraint_if_absent(
  'service_state',
  'service_state_stop_is_identified',
  'check (stopped = false or stop_id is not null)'
);

-- The restart approvals. `stop_id` points at the immutable INCIDENT row above, never at the
-- singleton's own `stop_id` -- see the header note. An approval therefore names one specific
-- incident permanently, an approval for an incident nobody recorded is refused outright, and the
-- rows from a closed incident stay exactly as they were recorded without ever being reachable
-- from the next one.
create table if not exists caring_contacts.service_restart_approvals (
  id bigint generated always as identity primary key,
  stop_id uuid not null,
  role text not null,
  actor_id text not null,
  approved_at timestamptz not null default now(),
  -- Attribution only, like reported_by_team_id above. It does not scope the approval.
  approved_by_team_id text references caring_contacts.teams (id),
  -- `ServiceRestartApprovalRole` in src/lib/caring-contacts/service-state.ts.
  constraint service_restart_approvals_role_is_known check (
    role in ('incidentLead', 'privacySecurityOwner', 'clinicalProgrammeLead')
  ),
  -- Together the two uniques below are what makes a single-person restart impossible in the
  -- database rather than only in TypeScript.
  constraint service_restart_approvals_stop_fk
    foreign key (stop_id) references caring_contacts.service_stops (stop_id),
  -- One approval per role, and one approval per person, PER INCIDENT.
  constraint service_restart_approvals_unique_stop_role unique (stop_id, role),
  constraint service_restart_approvals_unique_stop_actor unique (stop_id, actor_id)
);

-- ---------------------------------------------------------------------------
-- Pathway version governance
-- ---------------------------------------------------------------------------

alter table caring_contacts.pathway_versions add column if not exists published_at timestamptz;
alter table caring_contacts.pathway_versions add column if not exists retired_at timestamptz;
alter table caring_contacts.pathway_versions add column if not exists retirement_urgency text;
-- The governed message content itself. Added with a default so an existing row backfills without
-- an UPDATE, then the default is dropped: a pathway version with no snapshot is not a thing the
-- schema should offer to create for you.
alter table caring_contacts.pathway_versions
  add column if not exists snapshot jsonb not null default '{}'::jsonb;
alter table caring_contacts.pathway_versions alter column snapshot drop default;

-- `state` is deliberately untouched. It already matches `PathwayVersionState` exactly
-- (draft, inReview, approved, retired); publishing is `published_at`, not a fifth state.
select caring_contacts.add_constraint_if_absent(
  'pathway_versions',
  'pathway_versions_retirement_urgency_is_known',
  $def$check (retirement_urgency is null or retirement_urgency in ('routine', 'urgentSafety'))$def$
);

-- Referencable targets for the composite keys below. Both are redundant given the primary key on
-- `id`; being referencable is their only job.
select caring_contacts.add_constraint_if_absent(
  'pathway_versions', 'pathway_versions_id_team_key', 'unique (id, team_id)'
);
select caring_contacts.add_constraint_if_absent(
  'pathway_versions', 'pathway_versions_id_team_author_key', 'unique (id, team_id, author_id)'
);
select caring_contacts.add_constraint_if_absent(
  'referrals', 'referrals_id_team_key', 'unique (id, team_id)'
);

-- Approvals of a pathway version. `team_id` is denormalised so the standard team-scope policy
-- attaches without a join, and `author_id` is denormalised so the no-self-approval rule can be a
-- CHECK. Both are kept honest by the composite foreign key: they must be the parent's own team
-- and the parent's own author, not whatever the writer felt like claiming.
--
-- ONE TRAP, stated rather than left to be discovered: `pathway_versions.author_id` is nullable
-- while this column is not, so a version with NO author can never have an approval recorded
-- against it, and the refusal names the composite foreign key rather than the missing author.
-- That is arguably the right behaviour -- an unauthored version has nothing to approve -- and the
-- domain type `PathwayVersion.authorId` is non-optional, so it should not arise in practice. It
-- is a consequence of the parent column's nullability, not a decision taken here.
create table if not exists caring_contacts.pathway_version_approvals (
  id bigint generated always as identity primary key,
  pathway_version_id text not null,
  team_id text not null references caring_contacts.teams (id),
  author_id text not null,
  role text not null,
  actor_id text not null,
  approved_at timestamptz not null default now(),
  -- `PathwayApprovalRole` in src/lib/caring-contacts/pathway-versions.ts.
  constraint pathway_version_approvals_role_is_known check (
    role in ('clinicalProgrammeLead', 'livedExperienceRepresentative')
  ),
  -- The same rule the parent carries: no single actor may both author and approve the same
  -- clinical message content.
  constraint pathway_version_approvals_no_self_approval check (actor_id <> author_id),
  constraint pathway_version_approvals_unique_version_role unique (pathway_version_id, role),
  constraint pathway_version_approvals_unique_version_actor unique (pathway_version_id, actor_id),
  constraint pathway_version_approvals_version_fk
    foreign key (pathway_version_id, team_id, author_id)
    references caring_contacts.pathway_versions (id, team_id, author_id)
);

-- ---------------------------------------------------------------------------
-- Plans: the two links that were bare text until now (Phase 1 open item 2)
-- ---------------------------------------------------------------------------
-- Referencable target for the assignment tables below, redundant given the primary key on `id`.
select caring_contacts.add_constraint_if_absent('plans', 'plans_id_team_key', 'unique (id, team_id)');

select caring_contacts.add_constraint_if_absent(
  'plans',
  'plans_referral_fk',
  'foreign key (referral_id, team_id) references caring_contacts.referrals (id, team_id)'
);
select caring_contacts.add_constraint_if_absent(
  'plans',
  'plans_pathway_version_fk',
  'foreign key (pathway_version_id, team_id) references caring_contacts.pathway_versions (id, team_id)'
);

-- ---------------------------------------------------------------------------
-- Assignment and cover
-- ---------------------------------------------------------------------------
-- `plan_id` is joined to the plan by a COMPOSITE key for the same reason `plans` is joined to its
-- referral by one. A bare `plan_id references plans (id)` would accept a row written by TEAM-SOUTH
-- against TEAM-NORTH's plan while claiming `team_id = 'TEAM-SOUTH'`: foreign-key checks bypass
-- row-level security, and the policy's WITH CHECK validates only the team the writer CLAIMED, not
-- the team that owns the plan. The row would then be visible to the wrong team and invisible to
-- the right one, which misplaces the assignment's entire scope.
create table if not exists caring_contacts.plan_assignments (
  plan_id text primary key,
  team_id text not null references caring_contacts.teams (id),
  owner_id text,
  claimed_at timestamptz,
  covered_by text,
  -- AWST calendar days in YYYY-MM-DD form. Not instants: a timestamptz would re-anchor a Perth
  -- working day to UTC and move somebody's cover by eight hours.
  coverage_from text,
  coverage_until text,
  constraint plan_assignments_plan_fk
    foreign key (plan_id, team_id) references caring_contacts.plans (id, team_id) on delete cascade,
  constraint plan_assignments_coverage_is_calendar_days check (
    (coverage_from is null or coverage_from ~ '^\d{4}-\d{2}-\d{2}$')
    and (coverage_until is null or coverage_until ~ '^\d{4}-\d{2}-\d{2}$')
  )
);

create table if not exists caring_contacts.plan_reassignments (
  id bigint generated always as identity primary key,
  plan_id text not null,
  team_id text not null references caring_contacts.teams (id),
  from_actor_id text,
  to_actor_id text,
  -- A handover with no stated reason is not a handover anybody can review later.
  reason text not null,
  at timestamptz not null default now(),
  -- Composite for the same reason as plan_assignments_plan_fk above.
  constraint plan_reassignments_plan_fk
    foreign key (plan_id, team_id) references caring_contacts.plans (id, team_id) on delete cascade
);

create index if not exists plan_reassignments_plan_id_idx on caring_contacts.plan_reassignments (plan_id);

-- ---------------------------------------------------------------------------
-- Delivery discrepancies
-- ---------------------------------------------------------------------------
alter table caring_contacts.contact_dispatches add column if not exists reported_status text;
alter table caring_contacts.contact_dispatches add column if not exists discrepancy_resolved_at timestamptz;
alter table caring_contacts.contact_dispatches add column if not exists discrepancy_resolution text;
alter table caring_contacts.contact_dispatches add column if not exists discrepancy_note text;

select caring_contacts.add_constraint_if_absent(
  'contact_dispatches',
  'contact_dispatches_discrepancy_resolution_is_known',
  $def$check (
    discrepancy_resolution is null or discrepancy_resolution in (
      'confirmedDelivered', 'confirmedNotDelivered', 'unresolvedNoResend'
    )
  )$def$
);

-- ---------------------------------------------------------------------------
-- Per-person workspace settings
-- ---------------------------------------------------------------------------
create table if not exists caring_contacts.notification_preferences (
  actor_id text primary key,
  team_id text not null references caring_contacts.teams (id),
  opted_in text[] not null default '{}'
);

create table if not exists caring_contacts.training_records (
  actor_id text primary key,
  team_id text not null references caring_contacts.teams (id),
  completed text[] not null default '{}'
);

-- ---------------------------------------------------------------------------
-- Privileges
--
-- 0002's `grant ... on all tables in schema` is a snapshot of the tables that existed when it ran,
-- and every table above was created afterwards. Re-granting here is what stops the new tables
-- being unreachable by the application role -- and, just as deliberately, keeps `caring_contacts_anon`
-- holding SELECT with no policy, so the anonymous denial is row-level security's doing rather than
-- a missing GRANT.
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on all tables in schema caring_contacts to caring_contacts_app;
grant select on all tables in schema caring_contacts to caring_contacts_anon;

-- ---------------------------------------------------------------------------
-- Row-level security
--
-- Driven from lists rather than written out table by table, so a new table without a policy is a
-- visible omission from a list instead of a silently unprotected table.
-- ---------------------------------------------------------------------------
do $$
declare
  scoped_table text;
begin
  foreach scoped_table in array array[
    'pathway_version_approvals', 'plan_assignments', 'plan_reassignments',
    'notification_preferences', 'training_records'
  ]
  loop
    execute format('alter table caring_contacts.%I enable row level security', scoped_table);
    execute format('alter table caring_contacts.%I force row level security', scoped_table);
    execute format('drop policy if exists %I on caring_contacts.%I', scoped_table || '_team_scope', scoped_table);
    execute format(
      'create policy %I on caring_contacts.%I
         for all to caring_contacts_app
         using (team_id = caring_contacts.current_team_id())
         with check (team_id = caring_contacts.current_team_id())',
      scoped_table || '_team_scope',
      scoped_table
    );
  end loop;
end
$$;

-- The three service-wide tables, and the ONE deliberate exception to the team-scope rule.
--
-- 0002 says every policy compares the row's team against `caring_contacts.current_team_id()`.
-- These two do not, and that is the point: a team-scoped policy on a service-wide stop IS the
-- leak. Every team other than the one that reported the incident would read zero rows and
-- conclude the service was running, while the sending path they had all been told to halt kept
-- running. So the stop and its restart approvals are visible to any session that has named a
-- team.
--
-- Deny-by-default is untouched. `current_team_id() is not null` is false for an unscoped session,
-- so a session that names no team still matches no row, and no policy anywhere is unconditionally
-- true. 0002 has been amended to drop `service_state` from its driven list, so the two files do
-- not disagree about which policy this table carries.
do $$
declare
  service_wide_table text;
begin
  foreach service_wide_table in array array['service_stops', 'service_state', 'service_restart_approvals']
  loop
    execute format('alter table caring_contacts.%I enable row level security', service_wide_table);
    execute format('alter table caring_contacts.%I force row level security', service_wide_table);
    -- Dropped, not supplemented: Postgres ORs permissive policies together, so leaving 0002's
    -- team-scoped policy in place beside this one would make it redundant rather than replaced.
    execute format(
      'drop policy if exists %I on caring_contacts.%I',
      service_wide_table || '_team_scope',
      service_wide_table
    );
    execute format(
      'drop policy if exists %I on caring_contacts.%I',
      service_wide_table || '_service_wide',
      service_wide_table
    );
    execute format(
      'create policy %I on caring_contacts.%I
         for all to caring_contacts_app
         using (caring_contacts.current_team_id() is not null)
         with check (caring_contacts.current_team_id() is not null)',
      service_wide_table || '_service_wide',
      service_wide_table
    );
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- The transactional audit guard, extended to the new mutating tables
--
-- Attached through the same driven helper 0001 uses. It cannot simply be added to 0001's array:
-- 0001 runs before these tables exist, so the list there would name relations that are not yet
-- created on a first apply.
-- ---------------------------------------------------------------------------
-- `service_stops` and `service_state` are included even though `service_state` is not new. As
-- first built, restarting the service was forced to write an audit event and STOPPING it was not,
-- which is the asymmetry backwards: raising the service-wide safety stop is the most
-- audit-worthy mutation in the system. 0001's "stopping must never be blocked" is not a
-- counter-argument -- every write goes through the store's audited transaction anyway, and an
-- `audit-integrity-loss` stop exists precisely to preserve that trail.
select caring_contacts.attach_audit_guard(array[
  'service_stops', 'service_state', 'service_restart_approvals', 'pathway_version_approvals',
  'plan_assignments', 'plan_reassignments', 'notification_preferences', 'training_records'
]);

drop function if exists caring_contacts.add_constraint_if_absent(text, text, text);

commit;
