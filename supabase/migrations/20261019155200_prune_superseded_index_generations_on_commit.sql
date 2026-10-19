-- Audit F-09 (#EG02B7, #Q4Y7TR): every reindex leaves the previous generation's artifact
-- rows and image objects in place, and the only pruner is the manual, all-tenant
-- cleanup_abandoned_document_index_generations. That pruner cannot run on the commit path:
-- it deletes every non-current generation (including the one just replaced), has no row
-- ceiling and schedules no storage cleanup.
--
-- After a generation commit moves a document's pointer, keep the new generation and the one
-- it replaced, and prune the rest for that document only, children before parents, never a
-- legacy (NULL-generation) row and never a row that a kept row still references. Image
-- objects whose rows were pruned and that no remaining row points at are queued in
-- storage_cleanup_jobs for the existing janitor; nothing is removed from Storage here.
-- Retrieval reads only the committed generation or NULL-generation rows
-- (is_committed_artifact_generation, is_visible_document_page), so pruned rows were already
-- invisible to search. The commit function itself is unchanged; a trigger on the pointer
-- covers every commit route.
--
-- What can and cannot fail the commit. The prune runs inside the committing statement, so it
-- spends that statement's time. It is bounded three ways: at most p_row_limit rows per call
-- (2000 from the trigger), deleted in batches of at most 250 rows; a deadline checked before
-- every batch, at 500 ms from the start of the prune or half of the caller's statement_timeout
-- measured from statement start, whichever is earlier (no headroom left means no prune); and
-- a 100 ms lock_timeout, so a row lock held elsewhere fails fast instead of waiting. Ordinary
-- errors, including that lock timeout, are caught, logged as a warning and rolled back to the
-- savepoint, and the commit proceeds. A statement_timeout or cancel is deliberately NOT
-- caught: once the outer statement's timer has fired, the commit must fail. The bounds make
-- that very unlikely (one batch of at most 250 rows started inside the first half of the
-- budget would have to outlast the whole second half), but this trigger cannot guarantee it.
-- Rows left behind by any cut-off are pruned by the next commit of the same document.

set local lock_timeout = '5s';
set local statement_timeout = '30s';

create function public.prune_superseded_document_index_generations(
  p_document_id uuid,
  p_keep_generation_ids uuid[],
  p_row_limit integer default 2000
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set lock_timeout = '100ms'
as $$
declare
  v_owner uuid;
  v_cover text;
  v_keep uuid[];
  v_keep_text text[];
  v_budget integer;
  v_batch integer;
  v_timeout_ms bigint;
  v_deadline timestamptz;
  v_step text;
  v_step_total integer;
  v_deleted integer;
  v_step_generations uuid[];
  v_step_paths text[];
  v_counts jsonb := '{}'::jsonb;
  v_generations uuid[] := '{}'::uuid[];
  v_paths text[] := '{}'::text[];
  v_stale_paths text[] := '{}'::text[];
  v_job uuid;
begin
  if p_document_id is null or p_row_limit is null or p_row_limit not between 1 and 50000 then
    raise exception 'invalid_index_generation_prune_request';
  end if;

  -- Time budget: 500 ms, and never past half of the caller's statement_timeout.
  select s.setting::bigint into v_timeout_ms from pg_catalog.pg_settings s where s.name = 'statement_timeout';
  v_deadline := pg_catalog.clock_timestamp() + interval '500 milliseconds';
  if coalesce(v_timeout_ms, 0) > 0 then
    v_deadline := least(v_deadline,
      pg_catalog.statement_timestamp() + pg_catalog.make_interval(secs => v_timeout_ms / 2000.0));
  end if;
  if pg_catalog.clock_timestamp() >= v_deadline then
    return jsonb_build_object('ok', true, 'document_id', p_document_id, 'skipped', 'no_time_headroom');
  end if;

  select d.owner_id, d.metadata->>'cover_image_id'
  into v_owner, v_cover
  from public.documents d
  where d.id = p_document_id;
  if not found then
    return jsonb_build_object('ok', true, 'document_id', p_document_id, 'skipped', 'document_missing');
  end if;

  -- Never prune the caller's keep set, the live pointer, any generation an open job for this
  -- document still expects or writes (an in-flight build or enrichment pass), or a staged
  -- evidence candidate whose job has not completed (it may still await an admin-gated commit).
  select coalesce(array_agg(distinct k.generation_id), '{}'::uuid[])
  into v_keep
  from (
    select unnest(coalesce(p_keep_generation_ids, '{}'::uuid[])) as generation_id
    union all
    select d.index_generation_id from public.documents d where d.id = p_document_id
    union all
    select g.generation_id
    from public.ingestion_jobs j
    cross join lateral (values (j.lease_expected_generation_id), (j.lease_write_generation_id)) g(generation_id)
    where j.document_id = p_document_id and j.status in ('pending', 'processing')
    union all
    select g.generation_id
    from public.indexing_v3_agent_jobs j
    cross join lateral (values (j.lease_expected_generation_id), (j.lease_write_generation_id)) g(generation_id)
    where j.document_id = p_document_id and j.status in ('pending', 'processing')
    union all
    select c.generation_id
    from ingestion_generation_evidence.candidates c
    where c.document_id = p_document_id
      and not exists (select 1 from public.ingestion_jobs j where j.id = c.job_id and j.status = 'completed')
  ) k
  where k.generation_id is not null;

  if cardinality(v_keep) = 0 then
    return jsonb_build_object('ok', true, 'document_id', p_document_id, 'skipped', 'no_live_generation');
  end if;
  -- A row whose metadata names a kept generation is kept even if its typed column disagrees.
  v_keep_text := array(select pg_catalog.lower(g::text) from unnest(v_keep) g);

  v_budget := p_row_limit;

  -- Children first, so a parent is reached only once its prunable children are gone and the
  -- FK cascades or set-nulls below can never reach a kept row.
  foreach v_step in array array[
    'document_embedding_fields', 'document_index_units', 'document_table_facts',
    'document_memory_cards', 'document_sections', 'document_images', 'document_pages',
    'document_chunks'
  ] loop
    v_step_total := 0;
    loop
      exit when v_budget <= 0 or pg_catalog.clock_timestamp() > v_deadline;
      v_batch := least(v_budget, 250);
      v_deleted := 0;
      v_step_generations := '{}'::uuid[];
      v_step_paths := '{}'::text[];

      if v_step = 'document_embedding_fields' then
        with victims as (
          select t.id from public.document_embedding_fields t
          where t.document_id = p_document_id and t.index_generation_id is not null
            and t.index_generation_id <> all(v_keep)
            and pg_catalog.lower(coalesce(t.metadata->>'index_generation_id', '')) <> all(v_keep_text)
          order by t.index_generation_id, t.id
          limit v_batch
        ), gone as (
          delete from public.document_embedding_fields t using victims v where t.id = v.id
          returning t.index_generation_id
        )
        select count(*)::integer, coalesce(array_agg(distinct gone.index_generation_id), '{}'::uuid[])
        into v_deleted, v_step_generations from gone;

      elsif v_step = 'document_index_units' then
        with victims as (
          select t.id from public.document_index_units t
          where t.document_id = p_document_id and t.index_generation_id is not null
            and t.index_generation_id <> all(v_keep)
            and pg_catalog.lower(coalesce(t.metadata->>'index_generation_id', '')) <> all(v_keep_text)
          order by t.index_generation_id, t.id
          limit v_batch
        ), gone as (
          delete from public.document_index_units t using victims v where t.id = v.id
          returning t.index_generation_id
        )
        select count(*)::integer, coalesce(array_agg(distinct gone.index_generation_id), '{}'::uuid[])
        into v_deleted, v_step_generations from gone;

      elsif v_step = 'document_table_facts' then
        with victims as (
          select t.id from public.document_table_facts t
          where t.document_id = p_document_id and t.index_generation_id is not null
            and t.index_generation_id <> all(v_keep)
            and pg_catalog.lower(coalesce(t.metadata->>'index_generation_id', '')) <> all(v_keep_text)
          order by t.index_generation_id, t.id
          limit v_batch
        ), gone as (
          delete from public.document_table_facts t using victims v where t.id = v.id
          returning t.index_generation_id
        )
        select count(*)::integer, coalesce(array_agg(distinct gone.index_generation_id), '{}'::uuid[])
        into v_deleted, v_step_generations from gone;

      elsif v_step = 'document_memory_cards' then
        with victims as (
          select t.id from public.document_memory_cards t
          where t.document_id = p_document_id and t.index_generation_id is not null
            and t.index_generation_id <> all(v_keep)
            and pg_catalog.lower(coalesce(t.metadata->>'index_generation_id', '')) <> all(v_keep_text)
          order by t.index_generation_id, t.id
          limit v_batch
        ), gone as (
          delete from public.document_memory_cards t using victims v where t.id = v.id
          returning t.index_generation_id
        )
        select count(*)::integer, coalesce(array_agg(distinct gone.index_generation_id), '{}'::uuid[])
        into v_deleted, v_step_generations from gone;

      elsif v_step = 'document_sections' then
        -- A memory card still pointing here is kept (or deferred by the ceiling); deleting the
        -- section would null its section_id.
        with victims as (
          select t.id from public.document_sections t
          where t.document_id = p_document_id and t.index_generation_id is not null
            and t.index_generation_id <> all(v_keep)
            and pg_catalog.lower(coalesce(t.metadata->>'index_generation_id', '')) <> all(v_keep_text)
            and not exists (select 1 from public.document_memory_cards m where m.section_id = t.id)
          order by t.index_generation_id, t.id
          limit v_batch
        ), gone as (
          delete from public.document_sections t using victims v where t.id = v.id
          returning t.index_generation_id
        )
        select count(*)::integer, coalesce(array_agg(distinct gone.index_generation_id), '{}'::uuid[])
        into v_deleted, v_step_generations from gone;

      elsif v_step = 'document_images' then
        -- Keep the live cover image and any image a remaining fact or index unit still cites.
        with victims as (
          select t.id from public.document_images t
          where t.document_id = p_document_id and t.index_generation_id is not null
            and t.index_generation_id <> all(v_keep)
            and pg_catalog.lower(coalesce(t.metadata->>'index_generation_id', '')) <> all(v_keep_text)
            and t.id::text is distinct from v_cover
            and not exists (select 1 from public.document_table_facts f where f.source_image_id = t.id)
            and not exists (select 1 from public.document_index_units u where u.source_image_id = t.id)
          order by t.index_generation_id, t.id
          limit v_batch
        ), gone as (
          delete from public.document_images t using victims v where t.id = v.id
          returning t.index_generation_id, t.storage_path
        )
        select count(*)::integer, coalesce(array_agg(distinct gone.index_generation_id), '{}'::uuid[]),
          coalesce(array_agg(distinct gone.storage_path)
            filter (where gone.storage_path is not null and pg_catalog.btrim(gone.storage_path) <> ''), '{}'::text[])
        into v_deleted, v_step_generations, v_step_paths from gone;

      elsif v_step = 'document_pages' then
        with victims as (
          select t.id from public.document_pages t
          where t.document_id = p_document_id and t.index_generation_id is not null
            and t.index_generation_id <> all(v_keep)
            and pg_catalog.lower(coalesce(t.metadata->>'index_generation_id', '')) <> all(v_keep_text)
          order by t.index_generation_id, t.id
          limit v_batch
        ), gone as (
          delete from public.document_pages t using victims v where t.id = v.id
          returning t.index_generation_id
        )
        select count(*)::integer, coalesce(array_agg(distinct gone.index_generation_id), '{}'::uuid[])
        into v_deleted, v_step_generations from gone;

      elsif v_step = 'document_chunks' then
        -- A chunk still cited by a remaining fact, field or unit is kept: its cascade would
        -- otherwise reach that row.
        with victims as (
          select t.id from public.document_chunks t
          where t.document_id = p_document_id and t.index_generation_id is not null
            and t.index_generation_id <> all(v_keep)
            and pg_catalog.lower(coalesce(t.metadata->>'index_generation_id', '')) <> all(v_keep_text)
            and not exists (select 1 from public.document_table_facts f where f.source_chunk_id = t.id)
            and not exists (select 1 from public.document_embedding_fields e where e.source_chunk_id = t.id)
            and not exists (select 1 from public.document_index_units u where u.source_chunk_id = t.id)
          order by t.index_generation_id, t.id
          limit v_batch
        ), gone as (
          delete from public.document_chunks t using victims v where t.id = v.id
          returning t.index_generation_id
        )
        select count(*)::integer, coalesce(array_agg(distinct gone.index_generation_id), '{}'::uuid[])
        into v_deleted, v_step_generations from gone;
      end if;

      v_budget := v_budget - v_deleted;
      v_step_total := v_step_total + v_deleted;
      v_generations := v_generations || v_step_generations;
      v_paths := v_paths || v_step_paths;
      exit when v_deleted < v_batch;
    end loop;
    v_counts := v_counts || jsonb_build_object(v_step, v_step_total);
  end loop;

  -- Queue only objects no remaining image row (of any document) still points at. document_id
  -- stays null: the janitor skips rows whose document still exists, because those normally
  -- mean an aborted delete. The source document is recorded in metadata instead.
  select coalesce(array_agg(p.path order by p.path), '{}'::text[])
  into v_stale_paths
  from (select distinct unnest(v_paths) as path) p
  where not exists (select 1 from public.document_images i where i.storage_path = p.path);

  if cardinality(v_stale_paths) > 0 then
    insert into public.storage_cleanup_jobs(
      owner_id, document_id, document_paths, image_bucket, image_paths, status, metadata
    ) values (
      v_owner, null, '{}'::text[], 'clinical-images', v_stale_paths, 'pending',
      jsonb_build_object(
        'operation', 'superseded_index_generation_prune',
        'source_document_id', p_document_id,
        'pruned_generation_ids', (select coalesce(jsonb_agg(distinct g), '[]'::jsonb) from unnest(v_generations) g)
      )
    )
    returning id into v_job;
  end if;

  return jsonb_build_object(
    'ok', true,
    'document_id', p_document_id,
    'kept_generation_ids', to_jsonb(v_keep),
    'pruned_generation_ids', (select coalesce(jsonb_agg(distinct g), '[]'::jsonb) from unnest(v_generations) g),
    'counts', v_counts,
    'rows_deleted', p_row_limit - v_budget,
    'row_limit', p_row_limit,
    'limit_reached', v_budget <= 0 or pg_catalog.clock_timestamp() > v_deadline,
    'storage_paths_queued', cardinality(v_stale_paths),
    'storage_cleanup_job_id', v_job
  );
end;
$$;

alter function public.prune_superseded_document_index_generations(uuid, uuid[], integer) owner to postgres;
revoke all on function public.prune_superseded_document_index_generations(uuid, uuid[], integer)
  from public, anon, authenticated, service_role;

create function public.prune_superseded_index_generations_after_commit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    perform public.prune_superseded_document_index_generations(
      new.id, array[new.index_generation_id, old.index_generation_id], 2000);
  exception when others then
    -- Ordinary errors (including the prune's own 100 ms lock_timeout) roll back to this
    -- savepoint and the commit proceeds. query_canceled is not "others" and is not caught:
    -- see the header for why a fired statement_timeout must still fail the commit.
    raise warning 'index_generation_prune_skipped document=% sqlstate=%', new.id, sqlstate;
  end;
  return null;
end;
$$;

alter function public.prune_superseded_index_generations_after_commit() owner to postgres;
revoke all on function public.prune_superseded_index_generations_after_commit()
  from public, anon, authenticated, service_role;

create trigger documents_prune_superseded_index_generations
after update of metadata on public.documents
for each row
when (new.index_generation_id is not null and old.index_generation_id is distinct from new.index_generation_id)
execute function public.prune_superseded_index_generations_after_commit();
