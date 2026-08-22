-- caring-contacts/supabase/migrations/0002_caring_contacts_rls.sql
--
-- Row-level security: the control that stops one hospital team seeing another team's patients.
--
-- Three properties this file is responsible for, each proven in tests/caring-contacts-migrations.test.ts:
--
--   1. DENY BY DEFAULT. Every table has RLS enabled and FORCED, and every policy compares the row's
--      team against `caring_contacts.current_team_id()`. A session that names no team resolves that
--      to NULL, `team_id = NULL` is NULL rather than true, and no row matches. There is no policy
--      anywhere that is unconditionally true. Migration 0003 adds ONE deliberate exception to the
--      team comparison: `service_state` and `service_restart_approvals` are service-wide, not
--      per-team, and use `caring_contacts.current_team_id() is not null` instead. A team-scoped
--      policy on a service-wide safety stop would let every team but the reporting one read zero
--      rows and conclude the service was running mid-incident. That policy is still false for an
--      unscoped session, so deny-by-default holds and the claim above still stands.
--   2. A CROSS-TEAM SELECT RETURNS ZERO ROWS. It is not an error and not a refusal, because both
--      would confirm that the row exists. The other team's plan is indistinguishable from a plan
--      that was never created.
--   3. ANONYMOUS ACCESS IS DENIED. `caring_contacts_anon` is deliberately granted SELECT and given
--      NO policy. That way the anonymous test proves row-level security is doing the work; had the
--      grant been withheld, the same test would pass against a schema with no policies at all.
--
-- FORCE is set as well as ENABLE so the table owner is subject to its own policies too. A
-- superuser still bypasses row-level security entirely, which is why every test statement runs as
-- `caring_contacts_app` or `caring_contacts_anon` and never as the migration role.
--
-- Replay-safe: policies are dropped and recreated; grants are idempotent.

begin;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
grant usage on schema caring_contacts to caring_contacts_app, caring_contacts_anon;

grant select, insert, update, delete on all tables in schema caring_contacts to caring_contacts_app;

-- Granted on purpose. See note 3 above: the anonymous denial must be row-level security's doing.
grant select on all tables in schema caring_contacts to caring_contacts_anon;

-- The cross-team questions. Revoked from PUBLIC first so the SECURITY DEFINER reach is held by
-- exactly one named role.
revoke execute on function caring_contacts.patient_has_non_terminal_plan(text) from public;
revoke execute on function caring_contacts.plan_exists(text) from public;
grant execute on function caring_contacts.patient_has_non_terminal_plan(text) to caring_contacts_app;
grant execute on function caring_contacts.plan_exists(text) to caring_contacts_app;

-- ---------------------------------------------------------------------------
-- Enable and force row-level security everywhere, then attach one team-scoped policy per table.
--
-- Driven from a list rather than written out twelve times so a table added to the schema without a
-- policy is a visible omission from THIS list, not a silently unprotected table.
-- ---------------------------------------------------------------------------
do $$
declare
  scoped_table text;
begin
  -- Every table keyed by team_id.
  foreach scoped_table in array array[
    -- `service_state` is deliberately absent: migration 0003 converts it into a service-wide
    -- singleton with no `team_id` column at all, so a team-scoped policy here would not merely be
    -- wrong, it would fail to compile on replay.
    'actors', 'referrals', 'pathway_versions', 'plans', 'contacts', 'contact_dispatches',
    'audit_events', 'retention_state', 'cultural_identity_reports',
    'idempotency_records'
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

-- `teams` is keyed by the team itself rather than by a team_id column, so it gets the same rule
-- against its primary key. A session may see and register its own team and no other.
alter table caring_contacts.teams enable row level security;
alter table caring_contacts.teams force row level security;
drop policy if exists teams_team_scope on caring_contacts.teams;
create policy teams_team_scope on caring_contacts.teams
  for all to caring_contacts_app
  using (id = caring_contacts.current_team_id())
  with check (id = caring_contacts.current_team_id());

commit;
