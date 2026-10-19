-- Site-content administrator RPCs require a recent multi-factor sign-in inside the database
-- (migration 20261019170000). Proves, for publish_site_content_record,
-- retire_site_content_record and record_site_content_reconciliation_plan:
--   * an administrator token at aal1, with an amr entry older than 900 seconds, with a
--     future-dated amr entry, or with only a non-qualifying method is refused;
--   * an aal2 administrator token with a fresh qualifying amr entry gets past the check (it
--     reaches the function's own stale-epoch conflict or plan validation);
--   * an ordinary doctor is still refused by the existing administrator check;
--   * service_role behaves exactly as before: the existing role check refuses it before the
--     new assurance check is reached;
--   * the helper itself is not callable by any API role.
-- Disposable database only (`npm run test:sql`); everything rolls back.
\set ON_ERROR_STOP on
begin;
set local statement_timeout = '60s';

create function pg_temp.assert_true(ok boolean, message text) returns void
language plpgsql as $$ begin
  if ok is distinct from true then raise exception '%', message; end if;
end $$;
select pg_temp.assert_true(to_regprocedure('auth.jwt()') is not null,
  'auth.jwt() is missing: run through npm run test:sql, which installs the platform definition');
select pg_temp.assert_true(exists (select 1 from public.site_content_sync_state where singleton),
  'requires the site_content_sync_state singleton from schema replay');

insert into auth.users(id, email, raw_app_meta_data) values
  ('5c000000-0000-4000-8000-00000000a001', 'admin@example.org', '{"site_role":"administrator"}'),
  ('5c000000-0000-4000-8000-00000000d001', 'doctor@example.org', '{"site_role":"doctor"}');

-- Claims the way the platform issues them. p_amr_age_seconds is how long ago the sign-in
-- happened (negative = in the future); null omits amr.
create function pg_temp.claims(p_sub uuid, p_role text, p_site_role text, p_aal text,
  p_method text, p_amr_age_seconds integer) returns jsonb language sql stable as $$
  select pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
    'sub', p_sub::text,
    'role', p_role,
    'aal', p_aal,
    'app_metadata', pg_catalog.jsonb_build_object('site_role', p_site_role),
    'amr', case when p_amr_age_seconds is null then null else pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('method', p_method, 'timestamp',
        floor(extract(epoch from pg_catalog.statement_timestamp()))::bigint - p_amr_age_seconds)) end))
$$;

-- Runs p_sql as the given database role with the given JWT claims, the way PostgREST does,
-- and returns 'ok:<first column>' or 'error:<message>'.
create function pg_temp.outcome(p_db_role text, p_claims jsonb, p_sql text) returns text
language plpgsql as $$
declare
  v_result text;
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_claims->>'sub', ''), true);
  perform set_config('request.jwt.claim.role', coalesce(p_claims->>'role', ''), true);
  perform set_config('request.jwt.claims', p_claims::text, true);
  perform set_config('role', p_db_role, true);
  begin
    execute p_sql into v_result;
    v_result := 'ok:' || coalesce(v_result, '<null>');
  exception when others then
    v_result := 'error:' || sqlerrm;
  end;
  perform set_config('role', 'postgres', true);
  return v_result;
end $$;

create temp table rpc(name text primary key, call text not null, passed text not null, not_admin text not null);
insert into rpc values
  ('publish',
   $q$select outcome || ':' || coalesce(conflict_code, '') from public.publish_site_content_record(
      'service', '5c000000-0000-4000-8000-0000000000f1', 'v', 987654321, null, null, null)$q$,
   'ok:conflict:stale_change_epoch', 'error:site_content_administrator_required'),
  ('retire',
   $q$select outcome || ':' || coalesce(conflict_code, '') from public.retire_site_content_record(
      'service', '5c000000-0000-4000-8000-0000000000f1', 'v', 987654321, null, null, null)$q$,
   'ok:conflict:stale_change_epoch', 'error:site_content_administrator_required'),
  ('reconciliation',
   $q$select public.record_site_content_reconciliation_plan('{}'::jsonb)::text$q$,
   'error:site_content_reconciliation_unresolved', 'error:site_content_administrator_authorization_required');

create temp table cases(label text primary key, db_role text not null, claims jsonb not null, expected text);
insert into cases values
  ('aal1 administrator', 'authenticated',
   pg_temp.claims('5c000000-0000-4000-8000-00000000a001', 'authenticated', 'administrator', 'aal1', 'password', 5),
   'error:administrator_assurance_required'),
  ('aal2 administrator without amr', 'authenticated',
   pg_temp.claims('5c000000-0000-4000-8000-00000000a001', 'authenticated', 'administrator', 'aal2', null, null),
   'error:administrator_assurance_required'),
  ('aal2 administrator, sign-in 901 seconds ago', 'authenticated',
   pg_temp.claims('5c000000-0000-4000-8000-00000000a001', 'authenticated', 'administrator', 'aal2', 'totp', 901),
   'error:administrator_recent_authentication_required'),
  ('aal2 administrator, sign-in dated in the future', 'authenticated',
   pg_temp.claims('5c000000-0000-4000-8000-00000000a001', 'authenticated', 'administrator', 'aal2', 'totp', -60),
   'error:administrator_recent_authentication_required'),
  ('aal2 administrator, fresh non-qualifying method', 'authenticated',
   pg_temp.claims('5c000000-0000-4000-8000-00000000a001', 'authenticated', 'administrator', 'aal2', 'oauth', 5),
   'error:administrator_recent_authentication_required'),
  ('aal2 token missing the administrator claim', 'authenticated',
   pg_temp.claims('5c000000-0000-4000-8000-00000000a001', 'authenticated', null, 'aal2', 'totp', 5),
   'error:administrator_assurance_required'),
  ('fresh aal2 administrator', 'authenticated',
   pg_temp.claims('5c000000-0000-4000-8000-00000000a001', 'authenticated', 'administrator', 'aal2', 'totp', 5),
   null),
  ('fresh aal2 administrator, sign-in 890 seconds ago', 'authenticated',
   pg_temp.claims('5c000000-0000-4000-8000-00000000a001', 'authenticated', 'administrator', 'aal2', 'password', 890),
   null),
  ('fresh aal2 ordinary doctor', 'authenticated',
   pg_temp.claims('5c000000-0000-4000-8000-00000000d001', 'authenticated', 'doctor', 'aal2', 'totp', 5),
   'not_admin'),
  ('service_role', 'service_role',
   '{"role":"service_role"}'::jsonb,
   'not_admin');

create temp table results as
  select r.name, c.label, c.expected,
    case c.expected when 'not_admin' then r.not_admin else coalesce(c.expected, r.passed) end as want,
    pg_temp.outcome(c.db_role, c.claims, r.call) as got
  from rpc r cross join cases c;

select pg_temp.assert_true(not exists (select 1 from results where got is distinct from want),
  'unexpected outcome: ' || coalesce((
    select string_agg(name || ' / ' || label || ': wanted "' || want || '", got "' || got || '"', '; '
      order by name, label)
    from results where got is distinct from want), ''));
select pg_temp.assert_true((select count(*) from results) = 30, 'expected 3 functions x 10 cases');

-- The fresh-administrator calls stopped at their own conflict or validation, so nothing was
-- published, retired or recorded.
select pg_temp.assert_true(not exists (select 1 from public.site_content_publications)
  and not exists (select 1 from public.site_content_reconciliation_plans),
  'the probe calls must not write publication or reconciliation rows');

-- The helper is internal: no API role can call it directly.
select pg_temp.assert_true(not has_function_privilege(r.role,
    'public.require_recent_site_content_administrator_assurance()'::regprocedure, 'EXECUTE'),
  r.role || ' can call the assurance helper directly')
from (values ('anon'), ('authenticated'), ('service_role')) r(role);
select pg_temp.assert_true(
  (select p.prosecdef = false and p.proconfig @> array['search_path=""']
   from pg_proc p where p.oid = 'public.require_recent_site_content_administrator_assurance()'::regprocedure),
  'the assurance helper must be security invoker with an empty search_path');

-- Grants on the three RPCs are unchanged: authenticated and service_role only.
select pg_temp.assert_true(
  has_function_privilege('authenticated', f::regprocedure, 'EXECUTE')
    and has_function_privilege('service_role', f::regprocedure, 'EXECUTE')
    and not has_function_privilege('anon', f::regprocedure, 'EXECUTE'),
  f || ' grants changed')
from (values
  ('public.publish_site_content_record(text, uuid, text, bigint, text, text, text)'),
  ('public.retire_site_content_record(text, uuid, text, bigint, text, text, text)'),
  ('public.record_site_content_reconciliation_plan(jsonb)')) v(f);

select 'site-content RPC recent administrator assurance: 30 cases' as result;
rollback;
