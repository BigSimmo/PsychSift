-- Disposable database only. Proves rollback_document_index_generation (#3718) refuses with
-- pointer_moved, ingestion_in_progress, target_not_committed and target_snapshot_missing, that a
-- successful rollback keeps both generations through the prune trigger, and that it restores the
-- target generation's worker-owned metadata and quality row (#3732). Synthetic rows; rolled back.
\set ON_ERROR_STOP on
begin;
set local statement_timeout = '60s';
create function pg_temp.assert_true(ok boolean, message text) returns void
language plpgsql as $$ begin
  if ok is distinct from true then raise exception '%', message; end if;
end $$;
create function pg_temp.uid(tag text) returns uuid language sql immutable as $$ select md5(tag)::uuid $$;

-- A committed generation: one chunk and one page row (only a generation commit writes pages).
create function pg_temp.seed(p_doc uuid, p_gen uuid, p_tag text, p_with_page boolean default true)
returns void language plpgsql as $$
begin
  insert into public.document_chunks(id, document_id, chunk_index, content, embedding, index_generation_id)
  values (pg_temp.uid(p_tag || ':chunk'), p_doc,
    (select coalesce(max(chunk_index), 0) + 1 from public.document_chunks where document_id = p_doc),
    'Synthetic chunk', array_fill(0.1::real, array[1536])::extensions.vector, p_gen);
  if p_with_page then
    insert into public.document_pages(document_id, page_number, index_generation_id) values (p_doc, 1, p_gen);
  end if;
end $$;

create function pg_temp.move_pointer(p_doc uuid, p_gen uuid) returns void language sql as $$
  update public.documents set metadata = metadata || jsonb_build_object('index_generation_id', p_gen) where id = p_doc
$$;

-- A generation commit as commit_document_index_generation does it: quality upserted first, then
-- the worker-owned metadata keys written with the pointer.
create function pg_temp.commit(p_doc uuid, p_gen uuid, p_score real, p_quality text) returns void
language plpgsql as $$
begin
  insert into public.document_index_quality(document_id, quality_score, extraction_quality)
  values (p_doc, p_score, p_quality)
  on conflict (document_id) do update
    set quality_score = excluded.quality_score, extraction_quality = excluded.extraction_quality;
  update public.documents
     set metadata = metadata || jsonb_build_object('index_generation_id', p_gen, 'extraction_quality', p_quality)
   where id = p_doc;
end $$;

create function pg_temp.generations(p_doc uuid) returns uuid[] language sql as $$
  select coalesce(array_agg(distinct g order by g), '{}'::uuid[]) from (
    select index_generation_id as g from public.document_chunks where document_id = p_doc
    union all select index_generation_id from public.document_pages where document_id = p_doc
  ) x where g is not null
$$;

create function pg_temp.rollback(p_doc uuid, p_expected uuid, p_target uuid) returns jsonb language sql as $$
  select public.rollback_document_index_generation(p_doc, p_expected, p_target)
$$;

select pg_temp.assert_true(not exists (select 1 from public.documents), 'requires an empty disposable database');
insert into auth.users(id) values ('11111111-1111-4111-8111-111111111111');
insert into public.documents(id, owner_id, title, file_name, file_type, storage_path, status, metadata)
values
  (pg_temp.uid('A'), '11111111-1111-4111-8111-111111111111', 'Synthetic A', 'a.pdf', 'application/pdf', 'synthetic/a', 'indexed', '{}'),
  (pg_temp.uid('B'), '11111111-1111-4111-8111-111111111111', 'Synthetic B', 'b.pdf', 'application/pdf', 'synthetic/b', 'indexed', '{}'),
  (pg_temp.uid('C'), '11111111-1111-4111-8111-111111111111', 'Synthetic C', 'c.pdf', 'application/pdf', 'synthetic/c', 'indexed', '{}');

-- A: g1 committed (good), then g2 committed (poor). The prune trigger keeps both, and the
-- snapshot triggers keep g1's details. An owner-edited key must survive every rollback.
update public.documents set metadata = jsonb_build_object('owner_note', 'kept') where id = pg_temp.uid('A');
select pg_temp.seed(pg_temp.uid('A'), pg_temp.uid('g1'), 'A:g1');
select pg_temp.commit(pg_temp.uid('A'), pg_temp.uid('g1'), 0.9, 'good');
select pg_temp.seed(pg_temp.uid('A'), pg_temp.uid('g2'), 'A:g2');
select pg_temp.commit(pg_temp.uid('A'), pg_temp.uid('g2'), 0.4, 'poor');
select pg_temp.assert_true(pg_temp.generations(pg_temp.uid('A')) = (select array_agg(g order by g)
  from unnest(array[pg_temp.uid('g1'), pg_temp.uid('g2')]) g), 'setup: both generations retained');

-- pointer_moved: the caller expected g1 but the live pointer is g2. Nothing changes.
select pg_temp.assert_true(
  pg_temp.rollback(pg_temp.uid('A'), pg_temp.uid('g1'), pg_temp.uid('g2'))->>'reason' = 'pointer_moved',
  'a stale expected generation must be refused with pointer_moved');
select pg_temp.assert_true((select index_generation_id from public.documents where id = pg_temp.uid('A')) = pg_temp.uid('g2'),
  'pointer_moved must not move the pointer');

-- ingestion_in_progress: a pending, then a processing, job blocks the rollback.
insert into public.ingestion_jobs(id, document_id, status) values (pg_temp.uid('A:job'), pg_temp.uid('A'), 'pending');
select pg_temp.assert_true(
  pg_temp.rollback(pg_temp.uid('A'), pg_temp.uid('g2'), pg_temp.uid('g1'))->>'reason' = 'ingestion_in_progress',
  'a pending ingestion job must refuse the rollback');
update public.ingestion_jobs
   set status = 'processing', lease_token = gen_random_uuid(), locked_by = 'synthetic-worker', locked_at = now(),
       lease_write_generation_id = pg_temp.uid('g3'), lease_authority_digest = 'sha256:' || repeat('0', 64),
       lease_expires_at = now() + interval '10 minutes', lease_duration_seconds = 600
 where id = pg_temp.uid('A:job');
select pg_temp.assert_true(
  pg_temp.rollback(pg_temp.uid('A'), pg_temp.uid('g2'), pg_temp.uid('g1'))->>'reason' = 'ingestion_in_progress',
  'a processing ingestion job must refuse the rollback');
update public.ingestion_jobs set status = 'completed', lease_token = null where id = pg_temp.uid('A:job');

-- target_not_committed: B has a staged generation with chunks but no page rows.
select pg_temp.seed(pg_temp.uid('B'), pg_temp.uid('b1'), 'B:b1');
select pg_temp.move_pointer(pg_temp.uid('B'), pg_temp.uid('b1'));
select pg_temp.seed(pg_temp.uid('B'), pg_temp.uid('b-staged'), 'B:staged', false);
select pg_temp.assert_true(
  pg_temp.rollback(pg_temp.uid('B'), pg_temp.uid('b1'), pg_temp.uid('b-staged'))->>'reason' = 'target_not_committed',
  'a generation without committed page rows must be refused with target_not_committed');
select pg_temp.assert_true((select index_generation_id from public.documents where id = pg_temp.uid('B')) = pg_temp.uid('b1'),
  'target_not_committed must not move the pointer');

-- target_snapshot_missing: C's generations were committed without a quality row for the
-- snapshot triggers to capture (as for generations committed before #3732), so it is refused.
select pg_temp.seed(pg_temp.uid('C'), pg_temp.uid('c1'), 'C:c1');
select pg_temp.move_pointer(pg_temp.uid('C'), pg_temp.uid('c1'));
select pg_temp.seed(pg_temp.uid('C'), pg_temp.uid('c2'), 'C:c2');
select pg_temp.move_pointer(pg_temp.uid('C'), pg_temp.uid('c2'));
select pg_temp.assert_true(
  pg_temp.rollback(pg_temp.uid('C'), pg_temp.uid('c2'), pg_temp.uid('c1'))->>'reason' = 'target_snapshot_missing',
  'a target generation without a complete snapshot must be refused with target_snapshot_missing');
select pg_temp.assert_true((select index_generation_id from public.documents where id = pg_temp.uid('C')) = pg_temp.uid('c2'),
  'target_snapshot_missing must not move the pointer');

-- Happy path: A rolls back g2 -> g1. The pointer moves, the audit keys are written and the
-- prune trigger keeps both g1 and g2, so the rollback is itself reversible.
select pg_temp.assert_true(
  (pg_temp.rollback(pg_temp.uid('A'), pg_temp.uid('g2'), pg_temp.uid('g1'))->>'ok')::boolean,
  'rollback to the retained previous generation must succeed');
select pg_temp.assert_true((select index_generation_id from public.documents where id = pg_temp.uid('A')) = pg_temp.uid('g1'),
  'the pointer must move to the target generation');
select pg_temp.assert_true(
  (select metadata->>'index_generation_rolled_back_from' from public.documents where id = pg_temp.uid('A')) = pg_temp.uid('g2')::text,
  'the rollback must record the generation it rolled back from');
select pg_temp.assert_true(pg_temp.generations(pg_temp.uid('A')) = (select array_agg(g order by g)
  from unnest(array[pg_temp.uid('g1'), pg_temp.uid('g2')]) g), 'the prune trigger must keep both generations after a rollback');
select pg_temp.assert_true(
  (select metadata->>'extraction_quality' from public.documents where id = pg_temp.uid('A')) = 'good'
  and (select quality_score = 0.9::real and extraction_quality = 'good'
         from public.document_index_quality where document_id = pg_temp.uid('A')),
  'the rollback must restore the target generation''s metadata and quality row');
select pg_temp.assert_true((select metadata->>'owner_note' from public.documents where id = pg_temp.uid('A')) = 'kept',
  'the rollback must not touch owner-edited metadata');

-- And it can be reversed, restoring g2's details.
select pg_temp.assert_true(
  (pg_temp.rollback(pg_temp.uid('A'), pg_temp.uid('g1'), pg_temp.uid('g2'))->>'ok')::boolean,
  'rolling forward again must succeed because the newer generation was retained');
select pg_temp.assert_true(
  (select metadata->>'extraction_quality' from public.documents where id = pg_temp.uid('A')) = 'poor'
  and (select quality_score = 0.4::real and extraction_quality = 'poor'
         from public.document_index_quality where document_id = pg_temp.uid('A'))
  and (select metadata->>'owner_note' from public.documents where id = pg_temp.uid('A')) = 'kept',
  'rolling forward must restore the newer generation''s details and keep owner metadata');

\echo REINDEX_ROLLBACK_GENERATION_SQL_PASS: pointer_moved, ingestion_in_progress, target_not_committed, target_snapshot_missing, keeps both generations, restores details
rollback;
