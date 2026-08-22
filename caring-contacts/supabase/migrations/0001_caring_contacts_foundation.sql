-- caring-contacts/supabase/migrations/0001_caring_contacts_foundation.sql
--
-- The caring-contact schema: tables, constraints, and the transactional audit guard.
--
-- THIS DIRECTORY IS NOT THE REPOSITORY'S `supabase/migrations/`. That directory replays against
-- the live Clinical KB project; nothing here may ever be placed there, and
-- tests/caring-contacts-domain-isolation.test.ts fails if a caring-contact migration appears in it.
--
-- Design notes that are load-bearing rather than stylistic:
--
--   * CULTURAL IDENTITY IS NOT ON THE PATIENT ROW. It lives in
--     caring_contacts.cultural_identity_reports, a reporting projection, so an ordinary clinical
--     read of a plan cannot surface it and de-identification has one table to clear.
--   * ONE NON-TERMINAL PLAN PER PATIENT is a unique PARTIAL index over patient_id alone -- not
--     (team_id, patient_id). Two teams each running a plan for one person is the same
--     duplicate-message hazard as one team doing it twice, and it is the hazard the rule exists for.
--   * ONE DISPATCH RECORD PER (contact, attempt), so a retried request cannot record -- or bill,
--     or later be read as -- a second message that never went out.
--   * EVERY CHANGE CARRIES ITS AUDIT EVENT IN THE SAME TRANSACTION, enforced by a DEFERRABLE
--     CONSTRAINT TRIGGER that fires at commit. A direct UPDATE with no audit event fails; the
--     change and the record of it are committed together or not at all.
--   * NO CREATE INDEX CONCURRENTLY. It cannot run inside a transaction, and every migration here
--     must be a single atomic, replayable unit.
--
-- Replay-safe: every object is created with IF NOT EXISTS, CREATE OR REPLACE, or a guarded DO
-- block, so applying the file twice is a no-op.

begin;

create schema if not exists caring_contacts;

-- ---------------------------------------------------------------------------
-- Roles
--
-- `caring_contacts_app` is what every application statement runs as. It is deliberately NOT the
-- table owner and holds no BYPASSRLS: policies are the only thing standing between one team and
-- another team's patients, so the application role must be subject to them.
--
-- `caring_contacts_anon` is the unauthenticated role. Migration 0002 grants it SELECT on purpose
-- and gives it no policy at all, so the tests prove that ROW-LEVEL SECURITY denies it rather than
-- proving only that somebody forgot a GRANT.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'caring_contacts_app') then
    create role caring_contacts_app nologin;
  end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'caring_contacts_anon') then
    create role caring_contacts_anon nologin;
  end if;
end
$$;

grant caring_contacts_app, caring_contacts_anon to current_user with admin option;

-- ---------------------------------------------------------------------------
-- Session scope
--
-- The team a statement may see is a transaction-local setting, not a column the caller supplies:
-- `set_config('caring_contacts.team_id', ..., true)`. Unset resolves to NULL, and every policy
-- compares `team_id = caring_contacts.current_team_id()`, so an unscoped session matches no row.
-- That is what "deny by default" means here.
-- ---------------------------------------------------------------------------
create or replace function caring_contacts.current_team_id()
returns text
language sql
stable
set search_path = ''
as $$
  select nullif(pg_catalog.current_setting('caring_contacts.team_id', true), '')
$$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists caring_contacts.teams (
  id text primary key,
  created_at timestamptz not null default now()
);

create table if not exists caring_contacts.actors (
  id text primary key,
  team_id text not null references caring_contacts.teams (id),
  -- Human roles and the one system role are separate columns, not one list, because the two
  -- grant tables must never overlap: software cannot acquire a clinical capability by having a
  -- role appended, and a person cannot fabricate a delivery receipt.
  roles text[] not null default '{}',
  system_role text,
  created_at timestamptz not null default now(),
  constraint actors_roles_are_known check (roles <@ array['coordinator', 'teamLead', 'auditor']),
  constraint actors_are_human_or_system check (
    (system_role is null) or (system_role = 'contactDispatcher' and cardinality(roles) = 0)
  )
);

create table if not exists caring_contacts.referrals (
  id text primary key,
  team_id text not null references caring_contacts.teams (id),
  patient_id text not null,
  state text not null check (state in ('awaitingHandover', 'accepted', 'returnedForClarification', 'declined')),
  pathway_version_id text,
  created_at timestamptz not null default now()
);

create table if not exists caring_contacts.pathway_versions (
  id text primary key,
  team_id text not null references caring_contacts.teams (id),
  state text not null check (state in ('draft', 'inReview', 'approved', 'retired')),
  author_id text,
  approver_id text,
  created_at timestamptz not null default now(),
  -- No single actor may both author and approve the same clinical message content.
  constraint pathway_versions_no_self_approval check (approver_id is null or approver_id <> author_id)
);

-- The patient row. Note what is NOT here: cultural identity.
create table if not exists caring_contacts.plans (
  id text primary key,
  team_id text not null references caring_contacts.teams (id),
  patient_id text not null,
  referral_id text not null,
  pathway_version_id text not null,
  state text not null check (state in ('draft', 'active', 'paused', 'withdrawn', 'cancelled', 'completed')),
  version integer not null check (version > 0),
  outcome text not null check (outcome in ('inProgress', 'withdrawn', 'cancelled', 'completed')),
  discharge_at timestamptz not null,
  completed_at timestamptz,
  sending_preference text not null check (sending_preference in ('morning', 'afternoon', 'earlyEvening')),
  patient_name text not null,
  patient_mobile_number text not null,
  patient_identifiers text[] not null default '{}',
  created_at timestamptz not null default now()
);

-- Rule 3. Partial, so an ended plan never blocks a new episode; over patient_id alone, so one
-- team cannot start a second concurrent plan for a person another team is already contacting.
create unique index if not exists plans_one_non_terminal_per_patient
  on caring_contacts.plans (patient_id)
  where state not in ('withdrawn', 'cancelled', 'completed');

create index if not exists plans_team_id_idx on caring_contacts.plans (team_id);

create table if not exists caring_contacts.contacts (
  id text primary key,
  plan_id text not null references caring_contacts.plans (id) on delete cascade,
  team_id text not null references caring_contacts.teams (id),
  sequence integer not null check (sequence > 0),
  state text not null check (
    state in (
      'scheduled', 'processing', 'sent', 'delivered', 'notDelivered', 'numberInvalid',
      'contactChanged', 'statusUnavailable', 'missed', 'suppressed', 'cancelled'
    )
  ),
  version integer not null check (version > 0),
  cadence_label text not null,
  calendar_day text not null,
  -- An absorbed contact keeps a real send instant so the interface can explain the plan. It is
  -- kept out of dispatch by its terminal `suppressed` state, never by hiding this column.
  send_at timestamptz not null,
  message_type text not null check (message_type in ('standard', 'first', 'closing')),
  suppressed_reason text,
  constraint contacts_unique_sequence unique (plan_id, sequence)
);

create index if not exists contacts_plan_id_idx on caring_contacts.contacts (plan_id);

-- Rule 4. One row per attempt at one contact; a replayed dispatch request cannot become a second
-- recorded message.
create table if not exists caring_contacts.contact_dispatches (
  id bigint generated always as identity primary key,
  contact_id text not null references caring_contacts.contacts (id) on delete cascade,
  team_id text not null references caring_contacts.teams (id),
  attempt integer not null check (attempt > 0),
  idempotency_key text not null,
  started_at timestamptz not null default now(),
  constraint contact_dispatches_unique_attempt unique (contact_id, attempt)
);

-- The audit trail. `txn_token` ties every event to the transaction that produced it, which is
-- what the guard below checks; it defaults from the transaction-local setting so a caller cannot
-- forget it and quietly write an orphan record.
create table if not exists caring_contacts.audit_events (
  id bigint generated always as identity primary key,
  team_id text not null references caring_contacts.teams (id),
  actor_id text not null,
  actor_roles text[] not null,
  action text not null,
  object_type text not null,
  object_id text not null,
  outcome text not null check (outcome in ('allowed', 'denied', 'failed')),
  idempotency_key text not null,
  -- The AWST ISO-8601 instant the domain builds. Held as text so the audit record is byte-identical
  -- to the one the application produced rather than reformatted by the database.
  occurred_at text not null,
  txn_token uuid default nullif(pg_catalog.current_setting('caring_contacts.audit_token', true), '')::uuid,
  recorded_at timestamptz not null default now()
);

create index if not exists audit_events_team_idx on caring_contacts.audit_events (team_id, id);
create index if not exists audit_events_txn_token_idx on caring_contacts.audit_events (txn_token);

-- Whether the service is stopped for a team. Stopping must never be blocked, so the only
-- constraint is that a stop is attributed to somebody.
create table if not exists caring_contacts.service_state (
  team_id text primary key references caring_contacts.teams (id),
  stopped boolean not null default false,
  stopped_by text,
  stopped_at timestamptz,
  restart_approved_by text,
  updated_at timestamptz not null default now(),
  constraint service_state_stop_is_attributed check (stopped = false or stopped_by is not null)
);

-- When an episode ended, and when its identifying detail was cleared. The period itself is domain
-- policy and is deliberately not encoded here.
create table if not exists caring_contacts.retention_state (
  plan_id text primary key references caring_contacts.plans (id) on delete cascade,
  team_id text not null references caring_contacts.teams (id),
  terminal_at timestamptz,
  cleared_at timestamptz,
  constraint retention_state_cleared_after_terminal check (cleared_at is null or terminal_at is not null)
);

-- The cultural-identity reporting projection. This is the ONLY place cultural identity is stored.
create table if not exists caring_contacts.cultural_identity_reports (
  plan_id text primary key references caring_contacts.plans (id) on delete cascade,
  team_id text not null references caring_contacts.teams (id),
  cultural_identity text not null,
  recorded_at timestamptz not null default now()
);

-- Replay protection. Scoped per team so one team can never replay another team's result, and
-- holding the ORIGINAL result so a replay returns the first answer rather than recomputing one.
create table if not exists caring_contacts.idempotency_records (
  team_id text not null references caring_contacts.teams (id),
  idempotency_key text not null,
  fingerprint text not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (team_id, idempotency_key)
);

-- ---------------------------------------------------------------------------
-- The transactional audit guard
--
-- A DEFERRABLE INITIALLY DEFERRED constraint trigger fires at commit, by which time any audit
-- event written in the same transaction is visible to it. So the order of the two writes does not
-- matter, only that both happened in one transaction.
--
-- SECURITY DEFINER because the guard must be able to see the audit event regardless of the
-- writer's row-level security scope; it returns nothing and leaks nothing.
-- ---------------------------------------------------------------------------
create or replace function caring_contacts.assert_change_audited()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  token uuid;
begin
  token := nullif(pg_catalog.current_setting('caring_contacts.audit_token', true), '')::uuid;
  if token is null then
    raise exception
      'caring-contacts-audit-required: % on %.% ran outside an audited transaction',
      tg_op, tg_table_schema, tg_table_name;
  end if;
  if not exists (select 1 from caring_contacts.audit_events e where e.txn_token = token) then
    raise exception
      'caring-contacts-audit-required: % on %.% wrote no audit event in its transaction',
      tg_op, tg_table_schema, tg_table_name;
  end if;
  return null;
end;
$$;

-- Attaching the guard is driven from a list rather than written out per table, so a table added
-- without the guard is a visible omission from a list. It is a FUNCTION rather than an inline
-- loop because later migrations create audited tables that do not exist when this file runs, and
-- they must attach the guard through the same mechanism instead of hand-writing their own
-- triggers. It executes DDL, so it is revoked from PUBLIC and left to the migration role.
create or replace function caring_contacts.attach_audit_guard(p_tables text[])
returns void
language plpgsql
as $$
declare
  audited_table text;
begin
  foreach audited_table in array p_tables
  loop
    execute format('drop trigger if exists require_audit on caring_contacts.%I', audited_table);
    execute format(
      'create constraint trigger require_audit
         after insert or update or delete on caring_contacts.%I
         deferrable initially deferred
         for each row execute function caring_contacts.assert_change_audited()',
      audited_table
    );
  end loop;
end;
$$;

revoke execute on function caring_contacts.attach_audit_guard(text[]) from public;

select caring_contacts.attach_audit_guard(array[
  'referrals', 'plans', 'contacts', 'contact_dispatches', 'cultural_identity_reports'
]);

-- ---------------------------------------------------------------------------
-- Cross-team questions the application must be able to ask without seeing the answer's contents
--
-- "Does this patient already have an open plan anywhere?" cannot be answered by a team-scoped
-- SELECT, and answering it wrongly is what would let two teams contact one person. These return a
-- boolean and nothing else -- no identifiers, no team, no row.
-- ---------------------------------------------------------------------------
create or replace function caring_contacts.patient_has_non_terminal_plan(p_patient_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from caring_contacts.plans p
    where p.patient_id = p_patient_id
      and p.state not in ('withdrawn', 'cancelled', 'completed')
  )
$$;

create or replace function caring_contacts.plan_exists(p_plan_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from caring_contacts.plans p where p.id = p_plan_id)
$$;

commit;
