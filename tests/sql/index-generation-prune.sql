-- Disposable database only. Proves a generation commit keeps the live and the previous
-- generation, prunes older ones for that document only, respects the row ceiling and queues
-- unreferenced image objects for the storage janitor. Synthetic rows; rolled back.
\set ON_ERROR_STOP on
begin;
set local statement_timeout = '60s';
create function pg_temp.assert_true(ok boolean, message text) returns void
language plpgsql as $$ begin
  if ok is distinct from true then raise exception '%', message; end if;
end $$;
create function pg_temp.uid(tag text) returns uuid language sql immutable as $$ select md5(tag)::uuid $$;

-- One row per artifact table for one generation, wired the way the worker wires them.
-- The real commit writes the generation's page rows itself, so it seeds without a page.
create function pg_temp.seed(p_doc uuid, p_gen uuid, p_tag text, p_with_page boolean default true)
returns void language plpgsql as $$
declare
  v_owner uuid;
  v_vec extensions.vector := array_fill(0.1::real, array[1536])::extensions.vector;
begin
  select owner_id into v_owner from public.documents where id = p_doc;
  insert into public.document_chunks(id, document_id, chunk_index, content, embedding, index_generation_id)
  values (pg_temp.uid(p_tag || ':chunk'), p_doc,
    (select coalesce(max(chunk_index), 0) + 1 from public.document_chunks where document_id = p_doc),
    'Synthetic chunk', v_vec, p_gen);
  insert into public.document_images(id, document_id, storage_path, index_generation_id)
  values (pg_temp.uid(p_tag || ':image'), p_doc,
    p_doc::text || '/' || p_gen::text || '/' || pg_temp.uid(p_tag || ':image')::text || '.png', p_gen);
  insert into public.document_table_facts(document_id, owner_id, row_label, source_chunk_id, source_image_id, index_generation_id)
  values (p_doc, v_owner, 'Synthetic fact', pg_temp.uid(p_tag || ':chunk'), pg_temp.uid(p_tag || ':image'), p_gen);
  insert into public.document_embedding_fields(document_id, owner_id, field_type, content, content_hash, embedding,
    source_chunk_id, index_generation_id)
  values (p_doc, v_owner, 'document_title', 'Fixture', p_tag, v_vec, pg_temp.uid(p_tag || ':chunk'), p_gen);
  insert into public.document_index_units(document_id, unit_type, title, content, embedding, source_chunk_id,
    source_image_id, index_generation_id)
  values (p_doc, 'section_summary', 'Synthetic unit', 'Fixture', v_vec, pg_temp.uid(p_tag || ':chunk'),
    pg_temp.uid(p_tag || ':image'), p_gen);
  insert into public.document_sections(id, document_id, section_index, heading, index_generation_id)
  values (pg_temp.uid(p_tag || ':section'), p_doc,
    (select coalesce(max(section_index), 0) + 1 from public.document_sections where document_id = p_doc),
    'Synthetic section', p_gen);
  insert into public.document_memory_cards(document_id, card_type, title, content, embedding, section_id, index_generation_id)
  values (p_doc, 'section_summary', 'Synthetic card', 'Fixture', v_vec, pg_temp.uid(p_tag || ':section'), p_gen);
  if p_with_page then
    insert into public.document_pages(document_id, page_number, index_generation_id) values (p_doc, 1, p_gen);
  end if;
end $$;

create function pg_temp.generations(p_doc uuid) returns uuid[] language sql as $$
  select coalesce(array_agg(distinct g order by g), '{}'::uuid[]) from (
    select index_generation_id as g from public.document_chunks where document_id = p_doc
    union all select index_generation_id from public.document_images where document_id = p_doc
    union all select index_generation_id from public.document_table_facts where document_id = p_doc
    union all select index_generation_id from public.document_embedding_fields where document_id = p_doc
    union all select index_generation_id from public.document_index_units where document_id = p_doc
    union all select index_generation_id from public.document_sections where document_id = p_doc
    union all select index_generation_id from public.document_memory_cards where document_id = p_doc
    union all select index_generation_id from public.document_pages where document_id = p_doc
  ) x where g is not null
$$;

create function pg_temp.row_digest(p_doc uuid) returns text language sql as $$
  select md5(concat_ws('|',
    (select string_agg(id::text, ',' order by id) from public.document_chunks where document_id = p_doc),
    (select string_agg(id::text, ',' order by id) from public.document_images where document_id = p_doc),
    (select string_agg(id::text, ',' order by id) from public.document_table_facts where document_id = p_doc),
    (select string_agg(id::text, ',' order by id) from public.document_embedding_fields where document_id = p_doc),
    (select string_agg(id::text, ',' order by id) from public.document_index_units where document_id = p_doc),
    (select string_agg(id::text, ',' order by id) from public.document_sections where document_id = p_doc),
    (select string_agg(id::text, ',' order by id) from public.document_memory_cards where document_id = p_doc),
    (select string_agg(id::text, ',' order by id) from public.document_pages where document_id = p_doc)))
$$;

-- Stands in for the pointer move commit_document_index_generation makes.
create function pg_temp.move_pointer(p_doc uuid, p_gen uuid, p_extra jsonb default '{}'::jsonb) returns void language sql as $$
  update public.documents set metadata = metadata || p_extra || jsonb_build_object('index_generation_id', p_gen)
  where id = p_doc
$$;

select pg_temp.assert_true(not exists (select 1 from public.documents), 'requires an empty disposable database');
insert into auth.users(id) values ('11111111-1111-4111-8111-111111111111'), ('22222222-2222-4222-8222-222222222222');
insert into public.documents(id, owner_id, title, file_name, file_type, storage_path, status, metadata)
values
  (pg_temp.uid('A'), '11111111-1111-4111-8111-111111111111', 'Synthetic A', 'a.pdf', 'application/pdf', 'synthetic/a', 'indexed', '{}'),
  (pg_temp.uid('B'), '11111111-1111-4111-8111-111111111111', 'Synthetic B', 'b.pdf', 'application/pdf', 'synthetic/b', 'indexed', '{}'),
  (pg_temp.uid('C'), '22222222-2222-4222-8222-222222222222', 'Synthetic C', 'c.pdf', 'application/pdf', 'synthetic/c', 'indexed', '{}'),
  (pg_temp.uid('D'), '11111111-1111-4111-8111-111111111111', 'Synthetic D', 'd.pdf', 'application/pdf', 'synthetic/d', 'indexed', '{}');

-- Neighbours: another document of the same owner and a document of another owner, each with
-- two committed generations that must never be touched by A's commits.
select pg_temp.seed(pg_temp.uid('B'), pg_temp.uid('b1'), 'B:b1');
select pg_temp.move_pointer(pg_temp.uid('B'), pg_temp.uid('b1'));
select pg_temp.seed(pg_temp.uid('C'), pg_temp.uid('c1'), 'C:c1');
select pg_temp.move_pointer(pg_temp.uid('C'), pg_temp.uid('c1'));
select pg_temp.seed(pg_temp.uid('C'), pg_temp.uid('c2'), 'C:c2');
select pg_temp.move_pointer(pg_temp.uid('C'), pg_temp.uid('c2'));
create temp table neighbours as
select id, pg_temp.row_digest(id) as digest from public.documents where id in (pg_temp.uid('B'), pg_temp.uid('C'));

-- Legacy rows with no generation are visible to retrieval and must survive every prune.
insert into public.document_chunks(document_id, chunk_index, content, embedding)
values (pg_temp.uid('A'), 1000, 'Legacy chunk', array_fill(0.1::real, array[1536])::extensions.vector);
insert into public.document_images(document_id, storage_path)
values (pg_temp.uid('A'), 'legacy/' || pg_temp.uid('A')::text || '/image.png');

-- Initial index, then two reindexes.
select pg_temp.seed(pg_temp.uid('A'), pg_temp.uid('g1'), 'A:g1');
select pg_temp.move_pointer(pg_temp.uid('A'), pg_temp.uid('g1'));
select pg_temp.seed(pg_temp.uid('A'), pg_temp.uid('g2'), 'A:g2');
select pg_temp.move_pointer(pg_temp.uid('A'), pg_temp.uid('g2'));
select pg_temp.assert_true(pg_temp.generations(pg_temp.uid('A')) @> array[pg_temp.uid('g1'), pg_temp.uid('g2')]
  and cardinality(pg_temp.generations(pg_temp.uid('A'))) = 2, 'the first reindex must keep the replaced generation');
select pg_temp.assert_true(not exists (select 1 from public.storage_cleanup_jobs), 'nothing is queued while only two generations exist');

-- A g1 image row that shares its object with a g2 image: the object is still live.
insert into public.document_images(document_id, storage_path, index_generation_id)
select pg_temp.uid('A'), storage_path, pg_temp.uid('g1') from public.document_images where id = pg_temp.uid('A:g2:image');

select pg_temp.seed(pg_temp.uid('A'), pg_temp.uid('g3'), 'A:g3');
select pg_temp.move_pointer(pg_temp.uid('A'), pg_temp.uid('g3'));
select pg_temp.assert_true(pg_temp.generations(pg_temp.uid('A')) @> array[pg_temp.uid('g2'), pg_temp.uid('g3')]
  and cardinality(pg_temp.generations(pg_temp.uid('A'))) = 2,
  'after two reindexes at most two generations remain: the live one and the one it replaced');
select pg_temp.assert_true((select count(*) = 1 from public.document_chunks where document_id = pg_temp.uid('A') and index_generation_id is null)
  and (select count(*) = 1 from public.document_images where document_id = pg_temp.uid('A') and index_generation_id is null),
  'legacy NULL-generation rows must never be pruned');
select pg_temp.assert_true((select count(*) = 1 from public.document_chunks where document_id = pg_temp.uid('A') and index_generation_id = pg_temp.uid('g3'))
  and (select count(*) = 1 from public.document_chunks where document_id = pg_temp.uid('A') and index_generation_id = pg_temp.uid('g2')),
  'the live and previous generations must be intact');
select pg_temp.assert_true(not exists (select 1 from neighbours n where pg_temp.row_digest(n.id) <> n.digest),
  'pruning must not touch another document or another owner');
select pg_temp.assert_true((select count(*) = 1 from public.storage_cleanup_jobs), 'one storage cleanup job per pruning commit');
select pg_temp.assert_true((
  select owner_id = '11111111-1111-4111-8111-111111111111' and document_id is null and status = 'pending'
    and image_bucket = 'clinical-images' and document_paths = '{}'::text[]
    and image_paths = array[pg_temp.uid('A')::text || '/' || pg_temp.uid('g1')::text || '/' || pg_temp.uid('A:g1:image')::text || '.png']
    and metadata->>'operation' = 'superseded_index_generation_prune'
    and metadata->>'source_document_id' = pg_temp.uid('A')::text
    and metadata->'pruned_generation_ids' = jsonb_build_array(pg_temp.uid('g1'))
  from public.storage_cleanup_jobs), 'only unreferenced image objects of the pruned generation are queued, never inline-deleted');

-- Idempotent: a repeat prune with the same keep set does nothing and queues nothing.
create temp table repeat_run as
select public.prune_superseded_document_index_generations(pg_temp.uid('A'), array[pg_temp.uid('g3'), pg_temp.uid('g2')], 10000) as r;
select pg_temp.assert_true((select (r->>'rows_deleted')::int = 0 and r->'storage_cleanup_job_id' = 'null'::jsonb from repeat_run)
  and (select count(*) = 1 from public.storage_cleanup_jobs), 'a repeat prune must be a no-op');

-- An open job's generation is protected; an abandoned staged generation is pruned.
select pg_temp.seed(pg_temp.uid('A'), pg_temp.uid('gx'), 'A:gx');
select pg_temp.seed(pg_temp.uid('A'), pg_temp.uid('gy'), 'A:gy');
insert into public.ingestion_jobs(document_id, status, stage, created_at, locked_at, locked_by, lease_token,
  lease_expected_generation_id, lease_write_generation_id, lease_authority_digest, lease_expires_at, lease_duration_seconds)
values (pg_temp.uid('A'), 'processing', 'synthetic', now(), now(), 'synthetic-worker', gen_random_uuid(),
  pg_temp.uid('g3'), pg_temp.uid('gy'), 'sha256:' || repeat('0', 64), now() + interval '1 hour', 3600);
select pg_temp.seed(pg_temp.uid('A'), pg_temp.uid('g4'), 'A:g4');
select pg_temp.move_pointer(pg_temp.uid('A'), pg_temp.uid('g4'));
select pg_temp.assert_true(pg_temp.generations(pg_temp.uid('A')) = (
  select array_agg(g order by g) from unnest(array[pg_temp.uid('g3'), pg_temp.uid('g4'), pg_temp.uid('gy')]) g),
  'an open job''s generation must survive; the abandoned one and the older committed one are pruned');

-- Guards: a kept row that cites an old chunk keeps that chunk; the live cover image is kept.
select pg_temp.seed(pg_temp.uid('D'), pg_temp.uid('d1'), 'D:d1');
select pg_temp.move_pointer(pg_temp.uid('D'), pg_temp.uid('d1'));
select pg_temp.seed(pg_temp.uid('D'), pg_temp.uid('d2'), 'D:d2');
select pg_temp.move_pointer(pg_temp.uid('D'), pg_temp.uid('d2'));
select pg_temp.seed(pg_temp.uid('D'), pg_temp.uid('d3'), 'D:d3');
insert into public.document_table_facts(id, document_id, owner_id, row_label, source_chunk_id, index_generation_id)
values (pg_temp.uid('D:d3:cross'), pg_temp.uid('D'), '11111111-1111-4111-8111-111111111111', 'Cross-generation fact',
  pg_temp.uid('D:d1:chunk'), pg_temp.uid('d3'));
insert into public.document_images(id, document_id, storage_path, index_generation_id)
values (pg_temp.uid('D:d1:cover'), pg_temp.uid('D'), 'synthetic/d1-cover.png', pg_temp.uid('d1'));
-- Kept chunks and memory cards cite images through uuid arrays with no foreign key.
insert into public.document_images(id, document_id, storage_path, index_generation_id)
values (pg_temp.uid('D:d1:chunk-cited'), pg_temp.uid('D'), 'synthetic/d1-chunk-cited.png', pg_temp.uid('d1')),
  (pg_temp.uid('D:d1:card-cited'), pg_temp.uid('D'), 'synthetic/d1-card-cited.png', pg_temp.uid('d1')),
  (pg_temp.uid('D:d1:summary-cited'), pg_temp.uid('D'), 'synthetic/d1-summary-cited.png', pg_temp.uid('d1'));
insert into public.document_summaries(document_id, summary, source_image_ids)
values (pg_temp.uid('D'), 'Synthetic summary citing an older image', array[pg_temp.uid('D:d1:summary-cited')])
on conflict (document_id) do update set source_image_ids = excluded.source_image_ids;
insert into public.document_chunks(document_id, chunk_index, content, embedding, image_ids, index_generation_id)
values (pg_temp.uid('D'), 1000, 'Synthetic chunk citing an older image',
  array_fill(0.1::real, array[1536])::extensions.vector, array[pg_temp.uid('D:d1:chunk-cited')], pg_temp.uid('d3'));
insert into public.document_memory_cards(document_id, card_type, title, content, embedding, source_image_ids, index_generation_id)
values (pg_temp.uid('D'), 'section_summary', 'Synthetic card citing an older image', 'Fixture',
  array_fill(0.1::real, array[1536])::extensions.vector, array[pg_temp.uid('D:d1:card-cited')], pg_temp.uid('d3'));
-- An older image that only an older (prunable) chunk names: images are pruned after chunks,
-- so it goes, and is queued, in the same pass.
insert into public.document_images(id, document_id, storage_path, index_generation_id)
values (pg_temp.uid('D:d1:old-cited'), pg_temp.uid('D'), 'synthetic/d1-old-cited.png', pg_temp.uid('d1'));
insert into public.document_chunks(document_id, chunk_index, content, embedding, image_ids, index_generation_id)
values (pg_temp.uid('D'), 1001, 'Synthetic older chunk citing an older image',
  array_fill(0.1::real, array[1536])::extensions.vector, array[pg_temp.uid('D:d1:old-cited')], pg_temp.uid('d1'));
-- The summary, kept sections and kept memory cards cite chunks through uuid arrays with no
-- foreign key; a chunk only a pruned older section names goes in the same pass.
insert into public.document_chunks(id, document_id, chunk_index, content, embedding, index_generation_id)
values
  (pg_temp.uid('D:d1:summary-chunk'), pg_temp.uid('D'), 1002, 'Synthetic older chunk the summary cites',
    array_fill(0.1::real, array[1536])::extensions.vector, pg_temp.uid('d1')),
  (pg_temp.uid('D:d1:section-chunk'), pg_temp.uid('D'), 1003, 'Synthetic older chunk a kept section cites',
    array_fill(0.1::real, array[1536])::extensions.vector, pg_temp.uid('d1')),
  (pg_temp.uid('D:d1:card-chunk'), pg_temp.uid('D'), 1004, 'Synthetic older chunk a kept card cites',
    array_fill(0.1::real, array[1536])::extensions.vector, pg_temp.uid('d1')),
  (pg_temp.uid('D:d1:old-section-chunk'), pg_temp.uid('D'), 1005, 'Synthetic older chunk only an older section cites',
    array_fill(0.1::real, array[1536])::extensions.vector, pg_temp.uid('d1'));
update public.document_summaries set source_chunk_ids = array[pg_temp.uid('D:d1:summary-chunk')]
where document_id = pg_temp.uid('D');
update public.document_sections set chunk_ids = array[pg_temp.uid('D:d1:section-chunk')]
where id = pg_temp.uid('D:d3:section');
insert into public.document_memory_cards(document_id, card_type, title, content, embedding, source_chunk_ids, index_generation_id)
values (pg_temp.uid('D'), 'section_summary', 'Synthetic card citing an older chunk', 'Fixture',
  array_fill(0.1::real, array[1536])::extensions.vector, array[pg_temp.uid('D:d1:card-chunk')], pg_temp.uid('d3'));
insert into public.document_sections(id, document_id, section_index, heading, chunk_ids, index_generation_id)
values (pg_temp.uid('D:d1:old-section'), pg_temp.uid('D'), 1000, 'Synthetic older section',
  array[pg_temp.uid('D:d1:old-section-chunk')], pg_temp.uid('d1'));
select pg_temp.move_pointer(pg_temp.uid('D'), pg_temp.uid('d3'), jsonb_build_object('cover_image_id', pg_temp.uid('D:d1:cover')));
select pg_temp.assert_true(exists (select 1 from public.document_chunks where id = pg_temp.uid('D:d1:chunk'))
  and exists (select 1 from public.document_table_facts where id = pg_temp.uid('D:d3:cross')),
  'a chunk still cited by a kept row must survive so its cascade cannot reach the kept row');
select pg_temp.assert_true(exists (select 1 from public.document_images where id = pg_temp.uid('D:d1:cover')),
  'the live cover image must survive');
select pg_temp.assert_true(exists (select 1 from public.document_images where id = pg_temp.uid('D:d1:chunk-cited'))
  and exists (select 1 from public.document_images where id = pg_temp.uid('D:d1:card-cited'))
  and exists (select 1 from public.document_images where id = pg_temp.uid('D:d1:summary-cited'))
  and not exists (select 1 from public.storage_cleanup_jobs
    where metadata->>'source_document_id' = pg_temp.uid('D')::text
      and image_paths && array['synthetic/d1-chunk-cited.png', 'synthetic/d1-card-cited.png', 'synthetic/d1-summary-cited.png']),
  'an older image a kept chunk, memory card or summary still names in its image array must survive and stay unqueued');
select pg_temp.assert_true(not exists (select 1 from public.document_images where id = pg_temp.uid('D:d1:old-cited'))
  and not exists (select 1 from public.document_chunks where document_id = pg_temp.uid('D') and chunk_index = 1001)
  and exists (select 1 from public.storage_cleanup_jobs
    where metadata->>'source_document_id' = pg_temp.uid('D')::text
      and 'synthetic/d1-old-cited.png' = any(image_paths)),
  'an older image cited only by a pruned older chunk is pruned and queued in the same pass');
select pg_temp.assert_true(exists (select 1 from public.document_chunks where id = pg_temp.uid('D:d1:summary-chunk'))
  and exists (select 1 from public.document_chunks where id = pg_temp.uid('D:d1:section-chunk'))
  and exists (select 1 from public.document_chunks where id = pg_temp.uid('D:d1:card-chunk')),
  'an older chunk the summary, a kept section or a kept memory card still names in its chunk array must survive');
select pg_temp.assert_true(not exists (select 1 from public.document_sections where id = pg_temp.uid('D:d1:old-section'))
  and not exists (select 1 from public.document_chunks where id = pg_temp.uid('D:d1:old-section-chunk')),
  'an older chunk named only by a pruned older section is pruned in the same pass');
select pg_temp.assert_true(not exists (select 1 from public.document_embedding_fields
    where document_id = pg_temp.uid('D') and index_generation_id = pg_temp.uid('d1'))
  and not exists (select 1 from public.document_images where id = pg_temp.uid('D:d1:image')),
  'uncited rows of the pruned generation are removed');

-- Row ceiling: one call never deletes more than p_row_limit rows; repeating finishes the job.
select pg_temp.seed(pg_temp.uid('B'), pg_temp.uid('b0'), 'B:b0');
create temp table capped as
select public.prune_superseded_document_index_generations(pg_temp.uid('B'), array[pg_temp.uid('b1')], 1) as r;
select pg_temp.assert_true((select (r->>'rows_deleted')::int = 1 and (r->>'limit_reached')::boolean from capped)
  and pg_temp.uid('b0') = any(pg_temp.generations(pg_temp.uid('B'))), 'a capped call must stop at its ceiling');
select public.prune_superseded_document_index_generations(pg_temp.uid('B'), array[pg_temp.uid('b1')], 50000);
select pg_temp.assert_true(pg_temp.generations(pg_temp.uid('B')) = array[pg_temp.uid('b1')], 'a repeat call finishes the prune');
select pg_temp.assert_true((select n.digest = pg_temp.row_digest(n.id) from neighbours n where n.id = pg_temp.uid('C')),
  'the other owner''s document is never touched');

-- Through the real fenced commit: a failing or slow prune never costs the commit its pointer.
insert into public.documents(id, owner_id, title, file_name, file_type, storage_path, status, metadata)
values (pg_temp.uid('E'), '11111111-1111-4111-8111-111111111111', 'Synthetic E', 'e.pdf', 'application/pdf',
  'synthetic/e', 'queued', '{}');
create function pg_temp.real_commit(p_doc uuid, p_tag text, p_sleep double precision default 0) returns uuid
language plpgsql as $$
declare v_job jsonb; v_fence jsonb; v_gen uuid; v_result jsonb;
begin
  -- Optional time already spent by the committing statement before the commit runs.
  perform pg_sleep(p_sleep);
  insert into public.ingestion_jobs(document_id, status, created_at) values (p_doc, 'pending', now() - interval '1 day');
  select c.job into v_job from public.claim_ingestion_jobs('synthetic-worker', 1, 45) as c(job);
  if v_job is null or v_job->>'document_id' is distinct from p_doc::text then
    raise exception 'synthetic claim failed';
  end if;
  v_gen := (v_job->>'lease_write_generation_id')::uuid;
  v_fence := jsonb_build_object('job_kind', 'node', 'job_id', v_job->>'id', 'document_id', p_doc,
    'worker_id', 'synthetic-worker', 'lease_token', v_job->>'lease_token',
    'expected_generation_id', v_job->'lease_expected_generation_id', 'authority_digest', v_job->>'lease_authority_digest');
  perform pg_temp.seed(p_doc, v_gen, p_tag, false);
  v_result := public.commit_document_index_generation(v_fence, v_gen, 1, 1, 1, '{}'::jsonb,
    '[{"page_number":1,"text":"Synthetic page","ocr_used":false,"metadata":{}}]'::jsonb,
    '{"quality_score":1,"extraction_quality":"good","metrics":{},"issues":[]}'::jsonb);
  if v_result->'ok' is distinct from 'true'::jsonb then raise exception 'synthetic commit failed: %', v_result; end if;
  delete from public.ingestion_jobs where id = (v_job->>'id')::uuid;
  return v_gen;
end $$;
create function pg_temp.live_generation(p_doc uuid) returns uuid language sql as $$
  select index_generation_id from public.documents where id = p_doc
$$;
create temp table e_commits(step text primary key, generation uuid not null);
insert into e_commits select 'e1', pg_temp.real_commit(pg_temp.uid('E'), 'E:e1');
insert into e_commits select 'e2', pg_temp.real_commit(pg_temp.uid('E'), 'E:e2');

-- A prune that errors is rolled back to its savepoint; the commit still lands.
create function public.synthetic_fail_prune() returns trigger language plpgsql as $$
begin raise exception 'synthetic prune failure'; end $$;
create trigger synthetic_fail_prune before delete on public.document_embedding_fields
  for each statement execute function public.synthetic_fail_prune();
insert into e_commits select 'e3', pg_temp.real_commit(pg_temp.uid('E'), 'E:e3');
drop trigger synthetic_fail_prune on public.document_embedding_fields;
drop function public.synthetic_fail_prune();
select pg_temp.assert_true(pg_temp.live_generation(pg_temp.uid('E')) = (select generation from e_commits where step = 'e3')
  and (select generation from e_commits where step = 'e1') = any(pg_temp.generations(pg_temp.uid('E')))
  and exists (select 1 from public.document_embedding_fields where document_id = pg_temp.uid('E')
    and index_generation_id = (select generation from e_commits where step = 'e1')),
  'a failing prune must leave its rows untouched and must not stop the commit');

-- A slow prune stops at its deadline, well inside the caller's statement_timeout. Every delete
-- statement takes 1.5 s here, so a prune that ran two of them would exhaust the 3 s budget and
-- cancel the commit; the per-batch deadline stops it after the first.
create function public.synthetic_slow_prune() returns trigger language plpgsql as $$
begin perform pg_sleep(1.5); return null; end $$;
do $$ declare t text; begin
  foreach t in array array['document_embedding_fields', 'document_index_units', 'document_table_facts',
    'document_memory_cards', 'document_sections', 'document_images', 'document_pages', 'document_chunks'] loop
    execute format('create trigger synthetic_slow_prune before delete on public.%I for each statement '
      'execute function public.synthetic_slow_prune()', t);
  end loop;
end $$;
set local statement_timeout = '3s';
insert into e_commits select 'e4', pg_temp.real_commit(pg_temp.uid('E'), 'E:e4');
set local statement_timeout = '60s';
do $$ declare t text; begin
  foreach t in array array['document_embedding_fields', 'document_index_units', 'document_table_facts',
    'document_memory_cards', 'document_sections', 'document_images', 'document_pages', 'document_chunks'] loop
    execute format('drop trigger synthetic_slow_prune on public.%I', t);
  end loop;
end $$;
drop function public.synthetic_slow_prune();
select pg_temp.assert_true(pg_temp.live_generation(pg_temp.uid('E')) = (select generation from e_commits where step = 'e4')
  and exists (select 1 from public.document_chunks where document_id = pg_temp.uid('E')
    and index_generation_id = (select generation from e_commits where step = 'e1')),
  'a slow prune must stop at its deadline and leave the commit in place');

-- With less than half the statement budget left, the prune does not start at all.
set local statement_timeout = '4s';
insert into e_commits select 'e5', pg_temp.real_commit(pg_temp.uid('E'), 'E:e5', 2.5);
set local statement_timeout = '60s';
select pg_temp.assert_true(pg_temp.live_generation(pg_temp.uid('E')) = (select generation from e_commits where step = 'e5')
  and cardinality(pg_temp.generations(pg_temp.uid('E'))) = 5,
  'a commit with no time headroom must land without pruning');

-- The next ordinary commit finishes the job: at most two generations remain.
insert into e_commits select 'e6', pg_temp.real_commit(pg_temp.uid('E'), 'E:e6');
select pg_temp.assert_true(pg_temp.generations(pg_temp.uid('E')) = (
  select array_agg(generation order by generation) from e_commits where step in ('e5', 'e6')),
  'through the real commit, two reindexes later only the live and previous generations remain');

select pg_temp.assert_true(
  not has_function_privilege('anon', 'public.prune_superseded_document_index_generations(uuid,uuid[],integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.prune_superseded_document_index_generations(uuid,uuid[],integer)', 'execute')
  and not has_function_privilege('service_role', 'public.prune_superseded_document_index_generations(uuid,uuid[],integer)', 'execute'),
  'the pruner is reachable only through the commit trigger');
rollback;
\echo INDEX_GENERATION_PRUNE_SQL_PASS: keep live and previous, document-scoped, ceiling, storage queue, guards, grants
