-- Disposable PostgreSQL only. Synthetic catalog mutations; each mutation rolls back.
\set ON_ERROR_STOP on
begin;
set local statement_timeout = '60s';

create function pg_temp.assert_true(ok boolean, message text) returns void
language plpgsql as $$ begin
  if ok is distinct from true then raise exception '%', message; end if;
end $$;

create function pg_temp.assert_private_drift(label text, mutation text) returns void
language plpgsql as $$
declare before_snapshot jsonb; after_snapshot jsonb;
begin
  before_snapshot := public.schema_drift_snapshot()->'private_objects';
  begin
    execute mutation;
    after_snapshot := public.schema_drift_snapshot()->'private_objects';
    if before_snapshot is not distinct from after_snapshot then
      raise exception 'private drift invisible: %', label;
    end if;
    -- Roll back only the test mutation, preserving the assertion failure above.
    raise exception using errcode = 'P0999', message = 'rollback successful drift probe';
  exception when sqlstate 'P0999' then null;
  end;
end $$;

select pg_temp.assert_true(jsonb_array_length(public.schema_drift_snapshot()->'private_objects') > 17,
  'private inventory includes relations, functions, schema and default privileges');
select pg_temp.assert_true(not exists (
  select 1 from jsonb_array_elements(public.schema_drift_snapshot()->'private_objects') o
  where o->>'identity' like '%auth.%' or o->>'identity' like '%storage.%'
), 'platform auth/storage objects are outside the explicit private inventory');

select pg_temp.assert_private_drift('function body', $mutation$
  create or replace function ingestion_generation_evidence.immutable() returns trigger
  language plpgsql set search_path = '' as $body$ begin return old; end $body$
$mutation$);
select pg_temp.assert_private_drift('function configuration',
  $$alter function ingestion_generation_evidence.immutable() set work_mem = '1MB'$$);
select pg_temp.assert_private_drift('function ACL',
  $$grant execute on function ingestion_generation_evidence.immutable() to service_role$$);
select pg_temp.assert_private_drift('schema ACL',
  $$grant usage on schema ingestion_generation_evidence to service_role$$);
select pg_temp.assert_private_drift('table ACL',
  $$grant select on ingestion_generation_evidence.retained_artifacts to service_role$$);
select pg_temp.assert_private_drift('column ACL',
  $$grant select (artifact_bytes) on ingestion_generation_evidence.retained_artifacts to authenticated$$);
select pg_temp.assert_private_drift('schema default ACL',
  $$alter default privileges for role postgres in schema ingestion_generation_evidence grant execute on functions to authenticated$$);
select pg_temp.assert_private_drift('global default ACL',
  $$alter default privileges for role postgres grant select on tables to authenticated$$);
select pg_temp.assert_private_drift('immutability trigger enabled state',
  $$alter table ingestion_generation_evidence.retained_artifacts disable trigger evidence_immutable$$);
select pg_temp.assert_private_drift('RLS',
  $$alter table ingestion_generation_evidence.retained_artifacts disable row level security$$);
select pg_temp.assert_private_drift('FORCE RLS',
  $$alter table ingestion_generation_evidence.retained_artifacts force row level security$$);
select pg_temp.assert_private_drift('constraint validation',
  $$alter table ingestion_generation_evidence.retained_artifacts add constraint synthetic_positive_length check (byte_length > 0) not valid$$);
select pg_temp.assert_private_drift('policy',
  $$create policy synthetic_drift_probe on ingestion_generation_evidence.retained_artifacts for select to authenticated using (true)$$);
select pg_temp.assert_private_drift('index',
  $$create index synthetic_drift_probe on ingestion_generation_evidence.retained_artifacts (byte_length)$$);

-- A catalog outside the explicit application schema has no private-inventory effect.
create schema synthetic_excluded_drift;
create table synthetic_excluded_drift.unrelated (id uuid);
create temp table private_before as select public.schema_drift_snapshot()->'private_objects' as snapshot;
alter table synthetic_excluded_drift.unrelated add column harmless text;
select pg_temp.assert_true((select snapshot = public.schema_drift_snapshot()->'private_objects' from private_before),
  'unrelated schemas remain excluded');
rollback;
