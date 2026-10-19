-- Audit F-09 follow-up (Codex review on #3677; owner-approved 4th migration, 20 Oct 2026).
--
-- 20261019155200 kept an older-generation image only when a remaining table fact or index unit
-- cited it by foreign key. Chunks (image_ids), memory cards (source_image_ids) and the document
-- summary (source_image_ids) cite images through uuid arrays with no foreign key, possibly
-- across generations, so an image a kept row still names could be deleted and its object queued
-- for Storage deletion. The storage janitor only checks document_images rows, so it would then
-- really remove the file.
--
-- This replaces the prune function (same signature, owner, grants, trigger) so that:
--   * an image any remaining chunk, memory card or summary of the document names is kept, and
--     its object is never queued;
--   * images are pruned last, after chunks, memory cards and sections, so an image cited only
--     by rows pruned in the same pass is removed (and queued) in that pass rather than lingering
--     until the next commit.
-- No table, data or trigger changes; only the function body. Reversible by restoring the
-- 20261019155200 body.

set local lock_timeout = '5s';
set local statement_timeout = '30s';

create or replace function public.prune_superseded_document_index_generations(
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
  v_cited_images uuid[];
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
    'document_memory_cards', 'document_sections', 'document_pages', 'document_chunks',
    'document_images'
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
        -- Chunks, memory cards and the summary cite images through uuid arrays with no foreign
        -- key, possibly across generations, so any image any of them still names is kept too.
        v_cited_images := array(
          select distinct r.image_id from (
            select pg_catalog.unnest(c.image_ids) as image_id
            from public.document_chunks c where c.document_id = p_document_id
            union all
            select pg_catalog.unnest(m.source_image_ids)
            from public.document_memory_cards m where m.document_id = p_document_id
            union all
            select pg_catalog.unnest(s.source_image_ids)
            from public.document_summaries s where s.document_id = p_document_id
          ) r
          where r.image_id is not null
        );
        with victims as (
          select t.id from public.document_images t
          where t.document_id = p_document_id and t.index_generation_id is not null
            and t.index_generation_id <> all(v_keep)
            and pg_catalog.lower(coalesce(t.metadata->>'index_generation_id', '')) <> all(v_keep_text)
            and t.id::text is distinct from v_cover
            and t.id <> all(v_cited_images)
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
