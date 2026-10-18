-- Disposable database only. Exercises the real claim function and authority locks.
\set ON_ERROR_STOP on
begin;
set local statement_timeout = '60s';
create function pg_temp.assert_true(ok boolean, message text) returns void
language plpgsql as $$ begin
  if ok is distinct from true then raise exception '%', message; end if;
end $$;
select pg_temp.assert_true(not exists (select 1 from public.documents), 'requires an empty disposable database');
insert into auth.users(id) values ('11111111-1111-4111-8111-111111111111');
insert into public.documents(id, owner_id, title, file_name, file_type, storage_path, status, metadata)
values
  ('00000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111',
   'Synthetic PDF', 'fixture.pdf', 'application/pdf', 'synthetic/scope-pdf', 'queued', '{}'),
  ('00000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111',
   'Synthetic TXT', 'fixture.txt', 'TEXT/PLAIN; charset=utf-8', 'synthetic/scope-txt', 'queued', '{}');

create function pg_temp.reset_queue() returns void language plpgsql as $$ begin
  delete from public.ingestion_jobs;
  insert into public.ingestion_jobs(id, document_id, status, created_at)
  select id, id, 'pending', now() + (case file_name when 'fixture.pdf' then interval '-1 day' else interval '0' end)
  from public.documents;
end $$;
select pg_temp.reset_queue();
create temp table claims as
select job from public.claim_ingestion_jobs('synthetic-worker', 1, 45,
  array['00000000-0000-4000-8000-000000000002']::uuid[], array['text/plain']) job;
select pg_temp.assert_true((select count(*) = 1 and bool_and(job->>'document_id' =
  '00000000-0000-4000-8000-000000000002') from claims), 'mixed queue must claim the allowed TXT job');
select pg_temp.assert_true((select status = 'pending' and attempt_count = 0 from public.ingestion_jobs
  where document_id = '00000000-0000-4000-8000-000000000001'), 'excluded PDF must not acquire a lease or consume attempts');

select pg_temp.reset_queue();
select pg_temp.assert_true(not exists (select 1 from public.claim_ingestion_jobs('synthetic-worker', 1, 45,
  array['00000000-0000-4000-8000-000000000001']::uuid[], array['text/plain'])),
  'both allowlists must match');
select pg_temp.assert_true(not exists (select 1 from public.claim_ingestion_jobs('synthetic-worker', 1, 45,
  '{}'::uuid[], null::text[])), 'an explicit empty SQL allowlist must match nothing');

select pg_temp.reset_queue();
update public.ingestion_jobs set next_run_at = now() + interval '1 day'
where document_id = '00000000-0000-4000-8000-000000000002';
select pg_temp.assert_true(not exists (select 1 from public.claim_ingestion_jobs('synthetic-worker', 1, 45,
  null::uuid[], array['text/plain'])), 'future jobs must remain unclaimed');
update public.ingestion_jobs set next_run_at = now() - interval '1 second'
where document_id = '00000000-0000-4000-8000-000000000002';
select pg_temp.assert_true(exists (select 1 from public.claim_ingestion_jobs('synthetic-worker', 1, 45,
  null::uuid[], array['text/plain'])), 'newly due scoped jobs must become claimable');

select pg_temp.reset_queue();
select pg_temp.assert_true(exists (select 1 from public.claim_ingestion_jobs('synthetic-worker', 1, 45)),
  'the legacy three-argument claim remains available');
rollback;
