-- Disposable database only. A job re-pointed at another document between the claim's
-- candidate pick and its job row lock must stay unclaimed (follow-up to #3628).
--
-- The interleaving is made deterministic by wrapping the authority lock, which the claim
-- takes after the pick and before the job row lock. The wrapper performs the concurrent
-- writer's re-point, then calls the real lock. Under READ COMMITTED the claim's later
-- statements see that write exactly as they would see another session's committed one.
-- Everything, including the wrapper, rolls back.
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
  ('00000000-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111',
   'Synthetic picked PDF', 'picked.pdf', 'application/pdf', 'synthetic/recheck-picked', 'queued', '{}'),
  ('00000000-0000-4000-8000-00000000000b', '11111111-1111-4111-8111-111111111111',
   'Synthetic out-of-scope TXT', 'other.txt', 'text/plain', 'synthetic/recheck-txt', 'queued', '{}'),
  ('00000000-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111',
   'Synthetic in-scope PDF', 'other.pdf', 'application/pdf', 'synthetic/recheck-pdf', 'queued', '{}');

alter function public.lock_ingestion_document_authority(uuid, boolean)
  rename to lock_ingestion_document_authority_under_test;
create function public.lock_ingestion_document_authority(p_document_id uuid, p_try boolean)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_job uuid := nullif(pg_catalog.current_setting('claim_recheck.job_id', true), '')::uuid;
  v_target uuid := nullif(pg_catalog.current_setting('claim_recheck.target_document_id', true), '')::uuid;
begin
  if v_job is not null then
    update public.ingestion_jobs set document_id = v_target where id = v_job and document_id = p_document_id;
    perform pg_catalog.set_config('claim_recheck.job_id', '', true);
  end if;
  return public.lock_ingestion_document_authority_under_test(p_document_id, p_try);
end $$;

-- One due job, on the picked document. The other documents have no open job, so the
-- re-point cannot collide with the one-open-job-per-document index.
create function pg_temp.reset_queue() returns void language plpgsql as $$ begin
  delete from public.ingestion_jobs;
  insert into public.ingestion_jobs(id, document_id, status, created_at)
  values ('00000000-0000-4000-9000-00000000000a', '00000000-0000-4000-8000-00000000000a', 'pending', now() - interval '1 day');
end $$;
create function pg_temp.repoint_mid_claim(p_target uuid) returns void language sql as $$
  select pg_catalog.set_config('claim_recheck.job_id', '00000000-0000-4000-9000-00000000000a', true),
         pg_catalog.set_config('claim_recheck.target_document_id', p_target::text, true);
$$;
create function pg_temp.job_untouched(p_document uuid) returns boolean language sql as $$
  select count(*) = 1 and bool_and(document_id = p_document and status = 'pending' and attempt_count = 0
    and locked_by is null and lease_token is null)
  from public.ingestion_jobs where id = '00000000-0000-4000-9000-00000000000a';
$$;

-- Control: the wrapper alone changes nothing, so the scoped claim still leases the job.
select pg_temp.reset_queue();
create temp table claims as
select job from public.claim_ingestion_jobs('synthetic-worker', 1, 45,
  array['00000000-0000-4000-8000-00000000000a']::uuid[], null::text[]) job;
select pg_temp.assert_true((select count(*) = 1 and bool_and(job->>'document_id' = '00000000-0000-4000-8000-00000000000a'
  and job->'documents'->>'id' = '00000000-0000-4000-8000-00000000000a') from claims),
  'control: an unmoved in-scope job must still be claimed');

-- 1. Document allowlist: the job moves to a document outside the allowlist mid-claim.
select pg_temp.reset_queue();
select pg_temp.repoint_mid_claim('00000000-0000-4000-8000-00000000000b');
select pg_temp.assert_true(not exists (select 1 from public.claim_ingestion_jobs('synthetic-worker', 1, 45,
  array['00000000-0000-4000-8000-00000000000a']::uuid[], null::text[])),
  'a job re-pointed outside the document allowlist after the pick must not be claimed');
select pg_temp.assert_true(pg_temp.job_untouched('00000000-0000-4000-8000-00000000000b'),
  'the re-pointed job must stay pending without a lease or a consumed attempt');

-- 2. File-type allowlist: the job moves to a TXT document while a PDF-only worker claims.
select pg_temp.reset_queue();
select pg_temp.repoint_mid_claim('00000000-0000-4000-8000-00000000000b');
select pg_temp.assert_true(not exists (select 1 from public.claim_ingestion_jobs('synthetic-worker', 1, 45,
  null::uuid[], array['application/pdf'])),
  'a job re-pointed to a disallowed file type after the pick must not be claimed');
select pg_temp.assert_true(pg_temp.job_untouched('00000000-0000-4000-8000-00000000000b'),
  'the file-type re-pointed job must stay pending without a lease or a consumed attempt');

-- 3. Unscoped: the new document is in scope, but its authority was never locked.
select pg_temp.reset_queue();
select pg_temp.repoint_mid_claim('00000000-0000-4000-8000-00000000000c');
select pg_temp.assert_true(not exists (select 1 from public.claim_ingestion_jobs('synthetic-worker', 1, 45,
  null::uuid[], null::text[])),
  'a job whose document changed after the pick must not be leased under the old document''s authority');
select pg_temp.assert_true(pg_temp.job_untouched('00000000-0000-4000-8000-00000000000c'),
  'the in-scope re-pointed job must stay pending without a lease or a consumed attempt');

-- The skipped job is not lost: the next claim picks it under its new document.
truncate claims;
insert into claims select job from public.claim_ingestion_jobs('synthetic-worker', 1, 45, null::uuid[], null::text[]) job;
select pg_temp.assert_true((select count(*) = 1 and bool_and(job->>'document_id' = '00000000-0000-4000-8000-00000000000c'
  and job->'documents'->>'id' = '00000000-0000-4000-8000-00000000000c') from claims),
  'the next claim must lease the job with its current document''s authority');
rollback;
