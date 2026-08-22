-- caring-contacts/supabase/migrations/0004_caring_contacts_audit_immutability.sql
--
-- The audit trail is append-only, enforced rather than assumed.
--
-- 0002 grants `select, insert, update, delete` on every table in the schema to
-- `caring_contacts_app`, and the driven policy loop gives `audit_events` a `for all` policy. So
-- until this file the application role could rewrite or delete audit rows -- and `audit_events` is
-- deliberately OUTSIDE `attach_audit_guard`, so deleting from it required no audit event of its
-- own. A trail that can be silently edited by the thing it is auditing is not a trail.
--
-- That matters more here than the same gap would anywhere else: `audit-integrity-loss` is one of
-- the five categorised reasons that halt sending for the WHOLE service. The schema cannot both
-- treat losing the trail as a service-wide emergency and leave the trail editable in passing.
--
-- Two independent controls, answering two different questions:
--
--   1. THE TRIGGER says the row is frozen for everyone, including the schema owner and a
--      superuser -- neither of whom is stopped by a privilege or by row-level security.
--   2. THE GRANT says the application role never held the privilege to try. A refusal it produces
--      is `permission denied`, before the trigger is reached at all.
--
-- What is deliberately NOT blocked: TRUNCATE. It fires statement-level truncate triggers only,
-- never the per-row trigger below, and the offline test suite empties the schema between cases
-- that way. `caring_contacts_app` is granted no TRUNCATE privilege by 0002, so the only role that
-- can do it is the migration owner -- which is where emptying a disposable test schema belongs.
--
-- Transactional: one `begin`/`commit`, no `CREATE INDEX CONCURRENTLY`, nothing that cannot run
-- inside the single transaction the deployment applies each migration in.
--
-- Replay-safe: the function is `create or replace`, the trigger is dropped and recreated, and the
-- revoke is idempotent.

begin;

create or replace function caring_contacts.assert_audit_event_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- No allowlisted exception, and that is the whole difference from
  -- `assert_service_stop_immutable`. That guard compares `to_jsonb(new) - 'restarted_at'` because
  -- an incident has exactly one field that is meant to change later. An audit event has none: it
  -- records what happened at one instant and nothing about it is subsequently true or false in a
  -- different way. So the check is unconditional rather than a column comparison -- which keeps
  -- the property the jsonb form was chosen for, that a column added to this table LATER is frozen
  -- the moment it exists, without needing anything here to be updated.
  --
  -- If a mutable field is ever genuinely needed, express it as the same allowlist -- compare
  -- `to_jsonb(new) - '<column>'` against `to_jsonb(old) - '<column>'` -- and never as a list of
  -- the frozen columns, which defaults a new column to mutable, silently.
  if tg_op = 'DELETE' then
    raise exception 'caring-contacts-audit-immutable: a recorded audit event is never deleted';
  end if;
  raise exception 'caring-contacts-audit-immutable: a recorded audit event is never rewritten';
end;
$$;

drop trigger if exists audit_events_immutable on caring_contacts.audit_events;
create trigger audit_events_immutable
  before update or delete on caring_contacts.audit_events
  for each row execute function caring_contacts.assert_audit_event_immutable();

-- The second control. 0002's blanket `grant select, insert, update, delete on all tables` is kept
-- as it is -- it is the right default for the other twenty-odd tables -- and narrowed here for the
-- one table that is append-only. This file sorts after 0002 and 0003, so a replay of the whole
-- set re-applies the blanket grant and then re-narrows it, in that order, every time.
revoke update, delete on caring_contacts.audit_events from caring_contacts_app;

commit;
