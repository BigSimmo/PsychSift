-- Execute with psql ON_ERROR_STOP on an empty disposable schema replay.
-- Uses real tables, the real strict gate, and service-role RPC calls; no provider calls.
\set ON_ERROR_STOP on
begin;
set local statement_timeout = '60s';
create function pg_temp.assert_true(ok boolean, message text) returns void
language plpgsql as $$ begin
  if ok is distinct from true then raise exception '%', message; end if;
end $$;
select pg_temp.assert_true(not exists (select 1 from public.documents), 'requires an empty disposable database');
insert into auth.users(id) values ('11111111-1111-4111-8111-111111111111');
create temp table cases as select n,
  ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid as id
from generate_series(1, 9) n;
insert into public.documents(id, owner_id, title, file_name, file_type, storage_path, status, metadata, updated_at)
select id, '11111111-1111-4111-8111-111111111111', 'Synthetic repair case ' || n,
  'fixture.txt', 'text/plain', 'synthetic/' || n, 'indexed',
  jsonb_build_object('indexing_v3_agent_status', case n when 1 then 'needs_enrichment_artifacts'
    when 2 then 'failed' when 3 then 'pending' when 6 then 'pending' when 7 then 'processing' else 'completed' end,
    'enrichment_status', case n when 1 then 'needs_enrichment_artifacts' when 2 then 'failed'
    when 3 then 'pending' when 6 then 'pending' when 7 then 'processing' else 'completed' end,
    'indexing_v3_agent_deferral_count', 6),
  now() - interval '1 day' + n * interval '1 second'
from cases;

-- Four passing gates retain artifacts from an earlier generation.
insert into public.document_sections(document_id, section_index, heading)
select id, 0, 'Synthetic section' from cases where n in (4, 6, 7, 8);
insert into public.document_memory_cards(document_id, card_type, title, content, embedding)
select id, 'section_summary', 'Synthetic card', 'Fixture', array_fill(0.1::real, array[1536])::extensions.vector
from cases where n in (4, 6, 7, 8);
insert into public.document_labels(document_id, label, label_type)
select id, 'fixture', 'custom' from cases where n in (4, 6, 7, 8);
insert into public.document_index_units(document_id, unit_type, title, content, embedding)
select id, 'section_summary', 'Synthetic unit', 'Fixture', array_fill(0.1::real, array[1536])::extensions.vector
from cases where n in (4, 6, 7, 8);
insert into public.document_embedding_fields(document_id, field_type, content, content_hash, embedding)
select id, kind, 'Fixture', kind, array_fill(0.1::real, array[1536])::extensions.vector
from cases cross join (values ('document_title'), ('document_summary')) kinds(kind)
where n in (4, 6, 7, 8);
insert into public.document_index_quality(document_id, quality_score, extraction_quality)
select id, 1, 'good' from cases where n in (4, 6, 7, 8);

insert into public.indexing_v3_agent_jobs(document_id, status, enrichment_status, attempt_count, max_attempts,
  locked_by, locked_at, created_at, updated_at, lease_token, lease_expected_generation_id,
  lease_write_generation_id, lease_authority_digest, lease_expires_at, lease_duration_seconds)
select id, case n when 1 then 'needs_enrichment_artifacts' when 2 then 'failed' when 7 then 'processing' else 'pending' end,
  case n when 1 then 'needs_enrichment_artifacts' when 2 then 'failed' when 7 then 'processing' else 'pending' end,
  case when n in (1, 2, 3) then 3 else 1 end, 3,
  case when n = 7 then 'synthetic-worker' end, case when n = 7 then now() end,
  now() - interval '2 hours', now() - interval '2 hours',
  -- A processing row must carry the full lease tuple (indexing_v3_agent_jobs_lease_tuple).
  case when n = 7 then gen_random_uuid() end, case when n = 7 then gen_random_uuid() end,
  case when n = 7 then gen_random_uuid() end, case when n = 7 then 'sha256:' || repeat('0', 64) end,
  case when n = 7 then now() + interval '1 hour' end, case when n = 7 then 3600 end
from cases where n in (1, 2, 3, 6, 7);
insert into public.ingestion_jobs(document_id, status, stage, next_run_at, created_at, locked_at, locked_by,
  lease_token, lease_write_generation_id, lease_authority_digest, lease_expires_at, lease_duration_seconds)
select id, case when n = 8 then 'processing' else 'pending' end, 'queued',
  case when n = 5 then now() + interval '1 day' else now() end,
  now() - interval '2 hours', case when n = 8 then now() - interval '2 hours' end,
  case when n = 8 then 'expired-worker' end,
  -- Full lease tuple (ingestion_jobs_lease_tuple), expired an hour ago.
  case when n = 8 then gen_random_uuid() end, case when n = 8 then gen_random_uuid() end,
  case when n = 8 then 'sha256:' || repeat('0', 64) end,
  case when n = 8 then now() - interval '1 hour' end, case when n = 8 then 3600 end
from cases where n in (4, 5, 8);
create temp table before_documents as select d.* from public.documents d join cases c on c.id = d.id where n in (4, 5, 6, 7);
create temp table before_jobs as select j.* from public.ingestion_jobs j join cases c on c.id = j.document_id where n in (4, 5);
create temp table before_agent as select a.* from public.indexing_v3_agent_jobs a join cases c on c.id = a.document_id where n in (6, 7);

-- Capturing preview is optional only for reproducing the old RPC, which has no preview.
create temp table preview(document_id uuid);
do $$ begin
  if to_regprocedure('public.preview_strict_enrichment_gate_repair(integer)') is not null then
    execute 'insert into preview select document_id from public.preview_strict_enrichment_gate_repair(50)';
  end if;
end $$;
set local role service_role;
create temp table actual as select * from public.repair_strict_enrichment_gate_batch(50);
reset role;
select pg_temp.assert_true((select count(*) = 3 from public.indexing_v3_agent_jobs a
  join cases c on c.id = a.document_id where n in (1, 2, 3) and status = 'pending' and attempt_count = 0),
  'terminal and exhausted jobs must receive a fresh attempt budget');
select pg_temp.assert_true(not exists (
  select 1 from before_documents b join public.documents d on d.id = b.id where to_jsonb(d) <> to_jsonb(b)
), 'pending ingestion, pending agent, and fresh processing documents must remain byte-identical');
select pg_temp.assert_true(not exists (
  select 1 from before_jobs b join public.ingestion_jobs j on j.id = b.id where to_jsonb(j) <> to_jsonb(b)
), 'old pending and future retry jobs must remain byte-identical');
select pg_temp.assert_true(not exists (
  select 1 from before_agent b join public.indexing_v3_agent_jobs a on a.id = b.id where to_jsonb(a) <> to_jsonb(b)
), 'old pending agents and fresh processing leases must remain byte-identical');
select pg_temp.assert_true((select count(*) = 4 from public.ingestion_jobs where stage = 'strict_gate_repair'),
  'only missing-artifact repair candidates must queue ingestion');
select pg_temp.assert_true((select count(*) = 3 from public.documents d join cases c on c.id = d.id
  where n in (1, 2, 3) and metadata->>'indexing_v3_agent_deferral_count' = '0'), 'repair must renew exhausted deferrals');
select pg_temp.assert_true((select status = 'completed' from public.ingestion_jobs j
  join cases c on c.id = j.document_id where n = 8), 'stale processing job with a passing gate must reconcile');
select pg_temp.assert_true((select array_agg(document_id order by document_id) from preview)
  = (select array_agg(document_id order by document_id) from actual), 'preview and apply must select the same batch');
select pg_temp.assert_true((select count(*) = 5 from actual), 'repair must select precisely the five eligible cases');
set local role service_role;
create temp table second_pass as select * from public.repair_strict_enrichment_gate_batch(50);
reset role;
select pg_temp.assert_true(not exists (select 1 from second_pass), 'repeating repair must not queue duplicate work');
select pg_temp.assert_true(not has_function_privilege('anon', 'public.preview_strict_enrichment_gate_repair(integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.preview_strict_enrichment_gate_repair(integer)', 'execute'),
  'preview must stay service-role-only');
rollback;
\echo ENRICHMENT_REPAIR_SQL_PASS: terminal recovery, queues, leases, exact preview, idempotence, grants
