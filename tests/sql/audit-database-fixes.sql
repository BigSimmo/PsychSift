-- Disposable database only (`npm run test:sql`). Proves the 24 Oct 2026 audit database fixes
-- (20261025150000_audit_database_fixes.sql). The open-shift retry fix (#1) is in
-- roster-behaviour.sql with the rest of the open-shift checks.
--   #0 deleting an account with audit-log rows succeeds and clears only owner_id; every other
--      audit-log change is still refused;
--   #2 deleting an administrator whose admission record remains clears the account's ids from
--      it and keeps the record; every other change to it is still refused;
--   #5 the generation snapshot keys include the deep-memory keys;
--   #6 the unused roster_open_post_alerts table is gone;
--   #7 the roster alert outbox cascade foreign keys are indexed;
--   #8 the site-content administrator check refuses a banned or soft-deleted account;
--   #9 expired and cancelled EPA links are deleted 30 days later, and completed ones are kept.
-- Synthetic rows only; everything rolls back.
\set ON_ERROR_STOP on
begin;
set local statement_timeout = '60s';

create function pg_temp.assert_true(ok boolean, message text) returns void
language plpgsql as $$ begin
  if ok is distinct from true then raise exception '%', message; end if;
end $$;
create function pg_temp.refused(p_sql text, p_message text) returns boolean
language plpgsql as $$
begin
  execute p_sql;
  return false;
exception when others then
  if sqlerrm not like p_message then raise exception 'expected "%", got "%": %', p_message, sqlerrm, p_sql; end if;
  return true;
end $$;

insert into auth.users(id, email, raw_app_meta_data) values
  ('a0000000-0000-4000-8000-000000000001', 'leaver@example.org', '{}'),
  ('a0000000-0000-4000-8000-000000000002', 'stayer@example.org', '{}'),
  ('a0000000-0000-4000-8000-000000000003', 'admin-leaver@example.org', '{"site_role":"administrator"}'),
  ('a0000000-0000-4000-8000-000000000004', 'admin@example.org', '{"site_role":"administrator"}'),
  ('a0000000-0000-4000-8000-000000000005', 'trainee@example.org', '{}');

-- #0 ------------------------------------------------------------------------------------------
insert into public.audit_logs(id, owner_id, action, resource_type, metadata) values
  ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'synthetic.action', 'synthetic', '{"n":1}'),
  ('b0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002', 'synthetic.action', 'synthetic', '{"n":2}');

select pg_temp.assert_true(pg_temp.refused(
  $q$update public.audit_logs set action = 'changed' where id = 'b0000000-0000-4000-8000-000000000001'$q$,
  'audit_logs is append-only: UPDATE not allowed'), 'an ordinary audit-log update must be refused');
select pg_temp.assert_true(pg_temp.refused(
  $q$update public.audit_logs set owner_id = null where id = 'b0000000-0000-4000-8000-000000000002'$q$,
  'audit_logs is append-only: UPDATE not allowed'), 'clearing the owner of a live account must be refused');
select pg_temp.assert_true(pg_temp.refused(
  $q$update public.audit_logs set owner_id = null, action = 'changed' where id = 'b0000000-0000-4000-8000-000000000001'$q$,
  'audit_logs is append-only: UPDATE not allowed'), 'clearing the owner together with another change must be refused');
select pg_temp.assert_true(pg_temp.refused(
  $q$delete from public.audit_logs where id = 'b0000000-0000-4000-8000-000000000001'$q$,
  'audit_logs is append-only: DELETE not allowed'), 'deleting an audit-log row must be refused');

delete from auth.users where id = 'a0000000-0000-4000-8000-000000000001';
select pg_temp.assert_true(
  (select owner_id is null and action = 'synthetic.action' and metadata = '{"n":1}'::jsonb
     from public.audit_logs where id = 'b0000000-0000-4000-8000-000000000001'),
  'deleting the account must keep its audit-log row with only owner_id cleared');

-- #2 ------------------------------------------------------------------------------------------
insert into public.document_admission_events(
  id, document_id, ingestion_job_id, staging_owner_id, source_channel, actor_kind, administrator_id,
  correlation_id, admission_policy_version, content_sha256, file_name_sha256, storage_path_sha256,
  mime_type, byte_count, authority, admission_digest, document_input_digest, request_digest)
values (
  'c0000000-0000-4000-8000-000000000001', gen_random_uuid(), gen_random_uuid(),
  'a0000000-0000-4000-8000-000000000003', 'admin_api', 'administrator', 'a0000000-0000-4000-8000-000000000003',
  gen_random_uuid(), 'trusted-document-admission-v1', 'sha256:' || repeat('1', 64), 'sha256:' || repeat('2', 64),
  'sha256:' || repeat('3', 64), 'text/plain', 10, '{"version":1}', 'sha256:' || repeat('4', 64),
  'sha256:' || repeat('5', 64), 'sha256:' || repeat('6', 64));

select pg_temp.assert_true(pg_temp.refused(
  $q$update public.document_admission_events set mime_type = 'application/pdf' where id = 'c0000000-0000-4000-8000-000000000001'$q$,
  'document_admission_events_append_only'), 'an ordinary admission-record update must be refused');
select pg_temp.assert_true(pg_temp.refused(
  $q$update public.document_admission_events set staging_owner_id = null where id = 'c0000000-0000-4000-8000-000000000001'$q$,
  'document_admission_events_append_only'), 'clearing the owner of a live account must be refused');
select pg_temp.assert_true(pg_temp.refused(
  $q$delete from public.document_admission_events where id = 'c0000000-0000-4000-8000-000000000001'$q$,
  'document_admission_events_append_only'), 'deleting an admission record must be refused');

delete from auth.users where id = 'a0000000-0000-4000-8000-000000000003';
select pg_temp.assert_true(
  (select staging_owner_id is null and administrator_id is null and actor_kind = 'administrator'
          and content_sha256 = 'sha256:' || repeat('1', 64)
     from public.document_admission_events where id = 'c0000000-0000-4000-8000-000000000001'),
  'deleting the administrator must keep the admission record with both account ids cleared');
select pg_temp.assert_true(pg_temp.refused(
  $q$update public.document_admission_events set mime_type = 'application/pdf' where id = 'c0000000-0000-4000-8000-000000000001'$q$,
  'document_admission_events_append_only'), 'the cleared record must stay append-only');

-- #5 ------------------------------------------------------------------------------------------
select pg_temp.assert_true(
  public.document_index_generation_metadata_keys() @> array['document_intelligence_version',
    'document_intelligence_updated_at', 'index_unit_count', 'index_unit_counts_by_type',
    'repaired_anchor_count', 'deep_memory_generations', 'extraction_provenance'],
  'the generation snapshot keys must include the deep-memory keys');

-- #6 and #7 -----------------------------------------------------------------------------------
select pg_temp.assert_true(to_regclass('public.roster_open_post_alerts') is null,
  'the unused roster_open_post_alerts table must be dropped');
select pg_temp.assert_true(
  (select count(*) from pg_index i
     join pg_attribute a on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
    where (i.indrelid = 'public.roster_offer_alert_devices'::regclass and a.attname in ('subscription_id', 'owner_id'))
       or (i.indrelid = 'public.roster_offer_alert_outbox'::regclass and a.attname in ('service_id', 'actor_id'))) = 4,
  'each roster alert outbox cascade foreign key must lead an index');

-- #8 ------------------------------------------------------------------------------------------
create function pg_temp.assurance(p_sub uuid) returns text language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_sub::text, true);
  perform set_config('request.jwt.claims', pg_catalog.jsonb_build_object(
    'sub', p_sub::text, 'role', 'authenticated', 'aal', 'aal2',
    'app_metadata', pg_catalog.jsonb_build_object('site_role', 'administrator'),
    'amr', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('method', 'totp',
      'timestamp', floor(extract(epoch from pg_catalog.statement_timestamp()))::bigint - 30)))::text, true);
  perform public.require_recent_site_content_administrator_assurance();
  return 'ok';
exception when others then
  return sqlerrm;
end $$;

select pg_temp.assert_true(pg_temp.assurance('a0000000-0000-4000-8000-000000000004') = 'ok',
  'a current administrator with a fresh multi-factor sign-in must pass');
-- The ban and soft-delete columns exist on the hosted platform and CI's local stack, but not in
-- the bare image npm run test:sql uses, so these cases run only where the columns exist.
do $banned$
begin
  if (select count(*) from information_schema.columns
       where table_schema = 'auth' and table_name = 'users' and column_name in ('banned_until', 'deleted_at')) < 2 then
    raise notice 'auth.users has no banned_until/deleted_at here: ban and soft-delete cases skipped';
    return;
  end if;
  execute $u$update auth.users set banned_until = now() + interval '1 day' where id = 'a0000000-0000-4000-8000-000000000004'$u$;
  perform pg_temp.assert_true(pg_temp.assurance('a0000000-0000-4000-8000-000000000004') = 'administrator_assurance_required',
    'a banned administrator must be refused even with a valid token');
  execute $u$update auth.users set banned_until = now() - interval '1 minute' where id = 'a0000000-0000-4000-8000-000000000004'$u$;
  perform pg_temp.assert_true(pg_temp.assurance('a0000000-0000-4000-8000-000000000004') = 'ok',
    'an administrator whose ban has ended must pass again');
  execute $u$update auth.users set banned_until = null, deleted_at = now() where id = 'a0000000-0000-4000-8000-000000000004'$u$;
  perform pg_temp.assert_true(pg_temp.assurance('a0000000-0000-4000-8000-000000000004') = 'administrator_assurance_required',
    'a soft-deleted administrator must be refused even with a valid token');
end $banned$;

-- #9 ------------------------------------------------------------------------------------------
insert into public.teaching_epa_magic_links(
  id, registrar_id, token_hash, epa_number, trainee_name, supervisor_name, supervisor_role,
  status, response, created_at, expires_at, completed_at, revoked_at)
values
  ('d0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000005', repeat('a', 64), 1,
   'Trainee', 'Supervisor', 'Consultant', 'pending', null, now() - interval '60 days', now() - interval '46 days', null, null),
  ('d0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000005', repeat('b', 64), 1,
   'Trainee', 'Supervisor', 'Consultant', 'pending', null, now() - interval '30 days', now() - interval '16 days', null, null),
  ('d0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000005', repeat('c', 64), 1,
   'Trainee', 'Supervisor', 'Consultant', 'revoked', null, now() - interval '50 days', now() - interval '36 days', null, now() - interval '45 days'),
  ('d0000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000005', repeat('d', 64), 1,
   'Trainee', 'Supervisor', 'Consultant', 'completed', '{"comment":"synthetic"}', now() - interval '90 days', now() - interval '76 days', now() - interval '85 days', null),
  ('d0000000-0000-4000-8000-000000000005', 'a0000000-0000-4000-8000-000000000005', repeat('e', 64), 1,
   'Trainee', 'Supervisor', 'Consultant', 'pending', null, now(), now() + interval '14 days', null, null);

select pg_temp.assert_true(pg_temp.refused('select public.purge_stale_teaching_epa_magic_links(0)',
  'retention days must be positive'), 'a zero retention period must be refused');
select pg_temp.assert_true(public.purge_stale_teaching_epa_magic_links(30) = 2,
  'the purge must delete exactly the expired and the cancelled link past 30 days');
select pg_temp.assert_true(
  (select array_agg(id order by id) from public.teaching_epa_magic_links
    where registrar_id = 'a0000000-0000-4000-8000-000000000005')
  = array['d0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000004',
          'd0000000-0000-4000-8000-000000000005']::uuid[],
  'a recent expiry, a live link and a completed link with feedback must all be kept');
select pg_temp.assert_true(not has_function_privilege(r.role,
    'public.purge_stale_teaching_epa_magic_links(integer)'::regprocedure, 'EXECUTE'),
  r.role || ' can call the EPA link purge')
from (values ('anon'), ('authenticated')) r(role);

\echo AUDIT_DATABASE_FIXES_SQL_PASS: audit-log erasure, admission record erasure, snapshot keys, dropped table, outbox indexes, banned administrator, EPA link purge
rollback;
