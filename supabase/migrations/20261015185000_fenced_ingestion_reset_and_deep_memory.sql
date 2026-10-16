-- Fenced ingestion RPCs the worker already calls but no migration defined.
--
-- The fenced worker (worker/main.ts, worker/behavior.ts) and src/lib/deep-memory.ts call five
-- service-role RPCs through the lease-fenced mutation helper. None existed, so every legacy
-- (non-managed) ingest, every image upload and every fenced deep-memory build failed at the
-- first call. This migration adds them. Every function:
--   * validates the caller's lease with public.assert_current_ingestion_attempt (the same
--     fence the other fenced writers use) and answers {ok:false, reason:'lease_lost'} when the
--     lease is no longer current, so a superseded worker can never write or delete;
--   * answers {ok:true, ...} on success, which is the only shape the worker accepts;
--   * is SECURITY DEFINER with an empty search_path, owned by postgres, and executable by
--     service_role only.
--
-- Atomic reindex is preserved. commit_document_index_generation never deletes the generation it
-- replaces, and search serves only documents.metadata.index_generation_id. Nothing here deletes
-- rows of that served generation:
--   * reset_ingestion_attempt_artifacts deletes only rows of the attempt's own, never-committed
--     write generation, and refuses the served generation and managed generations outright.
--   * deep-memory staging rows carry their own staging generation id, so retrieval (which
--     filters on the committed generation) cannot see them until the commit re-points them.
--   * the deep-memory commit replaces only earlier local-worker deep-memory rows that are visible
--     for the served generation; base artifacts of that generation (including local-worker
--     visual index units, whose artifact generation is the index generation) are never touched.
--
-- Plain transactional DDL only: no CONCURRENTLY, no data backfill.

set local lock_timeout = '10s';
set local statement_timeout = '60s';

-- ---------------------------------------------------------------------------------------------
-- Shared staging-ownership guard for the three deep-memory RPCs.
-- A staging generation must be a fresh id owned by exactly this lease: it is not the served
-- generation, not the attempt's index write generation, never used as an index generation, and
-- every row already carrying it is still staged and was written under this same lease and job.
-- ---------------------------------------------------------------------------------------------
create function ingestion_generation_evidence.assert_deep_memory_staging_owner(
  p_fence jsonb, p_locked jsonb, p_artifact_generation uuid)
returns void language plpgsql security definer set search_path = '' set lock_timeout = '10s' as $$
declare v_document_id uuid; v_committed uuid;
begin
  v_document_id := (p_fence->>'document_id')::uuid;
  v_committed := (p_fence->>'expected_generation_id')::uuid;
  if p_artifact_generation is null or v_committed is null
    or p_artifact_generation = v_committed
    or p_artifact_generation is not distinct from (p_locked->'job'->>'lease_write_generation_id')::uuid
    or p_artifact_generation is not distinct from (p_locked->'document'->>'index_generation_id')::uuid
  then raise exception 'deep_memory_staging_generation_invalid'; end if;
  if exists(select 1 from public.document_chunks where document_id = v_document_id and index_generation_id = p_artifact_generation)
    or exists(select 1 from public.document_images where document_id = v_document_id and index_generation_id = p_artifact_generation)
    or exists(select 1 from public.document_pages where document_id = v_document_id and index_generation_id = p_artifact_generation)
    or exists(select 1 from ingestion_generation_evidence.candidates where document_id = v_document_id and generation_id = p_artifact_generation)
  then raise exception 'deep_memory_staging_generation_invalid'; end if;
  if exists(
      select 1 from public.document_sections
      where document_id = v_document_id
        and (artifact_generation_id = p_artifact_generation or index_generation_id = p_artifact_generation)
        and not (producer = 'local-worker' and artifact_generation_id = p_artifact_generation
          and index_generation_id = p_artifact_generation
          and metadata->>'ingestion_lease_token' = p_fence->>'lease_token'
          and metadata->>'ingestion_job_id' = p_fence->>'job_id'))
    or exists(
      select 1 from public.document_memory_cards
      where document_id = v_document_id
        and (artifact_generation_id = p_artifact_generation or index_generation_id = p_artifact_generation)
        and not (producer = 'local-worker' and artifact_generation_id = p_artifact_generation
          and index_generation_id = p_artifact_generation
          and metadata->>'ingestion_lease_token' = p_fence->>'lease_token'
          and metadata->>'ingestion_job_id' = p_fence->>'job_id'))
    or exists(
      select 1 from public.document_index_units
      where document_id = v_document_id
        and (artifact_generation_id = p_artifact_generation or index_generation_id = p_artifact_generation)
        and not (producer = 'local-worker' and artifact_generation_id = p_artifact_generation
          and index_generation_id = p_artifact_generation
          and metadata->>'ingestion_lease_token' = p_fence->>'lease_token'
          and metadata->>'ingestion_job_id' = p_fence->>'job_id'))
  then raise exception 'deep_memory_staging_generation_conflict'; end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- reset_ingestion_attempt_artifacts: clear a legacy attempt's own write generation before it
-- (re)writes base artifacts. The write generation is minted fresh by claim_ingestion_jobs, so
-- this is normally a no-op; it exists so a write generation can never carry rows from anything
-- but the attempt that is about to fill it. It never touches the served generation, older
-- committed generations, or managed generations. Image Storage objects are not deleted here.
-- ---------------------------------------------------------------------------------------------
create function public.reset_ingestion_attempt_artifacts(p_fence jsonb, p_generation uuid)
returns jsonb language plpgsql security definer set search_path = '' set lock_timeout = '10s' as $$
declare
  v_locked jsonb; v_document_id uuid;
  v_cards integer; v_units integer; v_fields integer; v_facts integer; v_sections integer; v_chunks integer; v_images integer;
begin
  if p_generation is null or p_fence->>'job_kind' is distinct from 'node' then raise exception 'ingestion_attempt_required'; end if;
  -- Proves the lease is current AND that p_generation is this job's lease_write_generation_id.
  v_locked := public.assert_current_ingestion_attempt(p_fence, p_generation);
  if v_locked is null then return jsonb_build_object('ok', false, 'reason', 'lease_lost'); end if;
  v_document_id := (p_fence->>'document_id')::uuid;
  if p_generation is not distinct from (v_locked->'document'->>'index_generation_id')::uuid
    or p_generation is not distinct from (p_fence->>'expected_generation_id')::uuid
    or exists(select 1 from public.document_pages where document_id = v_document_id and index_generation_id = p_generation)
  then raise exception 'ingestion_reset_committed_generation_forbidden'; end if;
  if exists(select 1 from ingestion_generation_evidence.candidates
      where document_id = v_document_id and (generation_id = p_generation or job_id = (p_fence->>'job_id')::uuid))
  then raise exception 'ingestion_reset_managed_generation_forbidden'; end if;

  delete from public.document_memory_cards where document_id = v_document_id and index_generation_id = p_generation;
  get diagnostics v_cards = row_count;
  delete from public.document_index_units where document_id = v_document_id and index_generation_id = p_generation;
  get diagnostics v_units = row_count;
  delete from public.document_embedding_fields where document_id = v_document_id and index_generation_id = p_generation;
  get diagnostics v_fields = row_count;
  delete from public.document_table_facts where document_id = v_document_id and index_generation_id = p_generation;
  get diagnostics v_facts = row_count;
  delete from public.document_sections where document_id = v_document_id and index_generation_id = p_generation;
  get diagnostics v_sections = row_count;
  delete from public.document_chunks where document_id = v_document_id and index_generation_id = p_generation;
  get diagnostics v_chunks = row_count;
  delete from public.document_images where document_id = v_document_id and index_generation_id = p_generation;
  get diagnostics v_images = row_count;

  return jsonb_build_object('ok', true, 'generation', p_generation, 'deleted', jsonb_build_object(
    'memory_cards', v_cards, 'index_units', v_units, 'embedding_fields', v_fields, 'table_facts', v_facts,
    'sections', v_sections, 'chunks', v_chunks, 'images', v_images));
end $$;

-- ---------------------------------------------------------------------------------------------
-- prepare_ingestion_image_upload: reserve the only Storage path write_ingestion_base_artifacts
-- accepts for an image of this attempt's write generation. Writes nothing.
-- ---------------------------------------------------------------------------------------------
create function public.prepare_ingestion_image_upload(p_fence jsonb, p_generation uuid, p_extension text)
returns jsonb language plpgsql security definer set search_path = '' set lock_timeout = '10s' as $$
declare v_locked jsonb; v_extension text;
begin
  if p_generation is null or p_fence->>'job_kind' is distinct from 'node' then raise exception 'ingestion_attempt_required'; end if;
  v_locked := public.assert_current_ingestion_attempt(p_fence, p_generation);
  if v_locked is null then return jsonb_build_object('ok', false, 'reason', 'lease_lost'); end if;
  if exists(select 1 from ingestion_generation_evidence.candidates
      where document_id = (p_fence->>'document_id')::uuid and job_id = (p_fence->>'job_id')::uuid)
  then return jsonb_build_object('ok', false, 'reason', 'technical_supplier_not_implemented'); end if;
  v_extension := lower(coalesce(p_extension, ''));
  if v_extension not in ('png', 'jpg', 'jpeg', 'webp') then raise exception 'ingestion_image_extension_invalid'; end if;
  return jsonb_build_object('ok', true, 'storage_path',
    (p_fence->>'document_id') || '/' || (p_fence->>'lease_token') || '/' || p_generation::text || '/'
      || gen_random_uuid()::text || '.' || v_extension);
end $$;

-- ---------------------------------------------------------------------------------------------
-- stage_ingestion_deep_memory: write one batch of invisible deep-memory rows (sections, memory
-- cards, index units) under a staging generation. Rows get producer 'local-worker', the
-- document's owner, and index_generation_id = the staging id, so no retrieval path that filters
-- on the served generation can see them. Every source chunk/image must belong to the served
-- generation; a card's section must belong to the same staging generation.
-- ---------------------------------------------------------------------------------------------
create function public.stage_ingestion_deep_memory(
  p_fence jsonb, p_artifact_generation uuid, p_sections jsonb, p_cards jsonb, p_units jsonb)
returns jsonb language plpgsql security definer set search_path = '' set lock_timeout = '10s' as $$
declare
  v_locked jsonb; v_document_id uuid; v_committed uuid; v_owner jsonb; v_row jsonb; v_stamp jsonb;
  v_section record; v_sections jsonb := '[]'::jsonb; v_cards integer := 0; v_units integer := 0;
begin
  if p_artifact_generation is null or p_fence->>'job_kind' is distinct from 'node'
    or p_fence->>'expected_generation_id' is null then raise exception 'ingestion_attempt_required'; end if;
  v_locked := public.assert_current_ingestion_attempt(p_fence, null);
  if v_locked is null then return jsonb_build_object('ok', false, 'reason', 'lease_lost'); end if;
  v_document_id := (p_fence->>'document_id')::uuid;
  -- assert_current_ingestion_attempt proved expected_generation_id is the served generation.
  v_committed := (p_fence->>'expected_generation_id')::uuid;
  v_owner := v_locked->'document'->'owner_id';
  perform ingestion_generation_evidence.assert_deep_memory_staging_owner(p_fence, v_locked, p_artifact_generation);
  if jsonb_typeof(p_sections) is distinct from 'array' or jsonb_array_length(p_sections) > 500
    or jsonb_typeof(p_cards) is distinct from 'array' or jsonb_array_length(p_cards) > 500
    or jsonb_typeof(p_units) is distinct from 'array' or jsonb_array_length(p_units) > 500
  then raise exception 'invalid_ingestion_artifact_batch'; end if;
  v_stamp := jsonb_build_object('generated_by', 'local-worker', 'artifact_generation_id', p_artifact_generation,
    'index_generation_id', p_artifact_generation, 'ingestion_lease_token', p_fence->>'lease_token',
    'ingestion_job_kind', p_fence->>'job_kind', 'ingestion_job_id', p_fence->>'job_id');

  for v_row in select value from jsonb_array_elements(p_sections) loop
    if jsonb_typeof(v_row) is distinct from 'object' or v_row->>'document_id' is distinct from v_document_id::text
      then raise exception 'ingestion_artifact_document_mismatch'; end if;
    perform public.assert_ingestion_artifact_sources(v_row, v_document_id, v_committed, p_artifact_generation);
    v_row := v_row || jsonb_build_object('id', gen_random_uuid(), 'owner_id', v_owner, 'producer', 'local-worker',
      'artifact_generation_id', p_artifact_generation, 'index_generation_id', p_artifact_generation,
      'metadata', (case when jsonb_typeof(v_row->'metadata') = 'object' then v_row->'metadata' else '{}'::jsonb end) || v_stamp);
    insert into public.document_sections(id,document_id,owner_id,section_index,heading,heading_path,page_start,page_end,chunk_ids,summary,tags,extraction_quality,index_generation_id,producer,artifact_generation_id,metadata)
      select r.id,r.document_id,r.owner_id,r.section_index,r.heading,coalesce(r.heading_path,'{}'),r.page_start,r.page_end,coalesce(r.chunk_ids,'{}'),coalesce(r.summary,''),coalesce(r.tags,'{}'),coalesce(r.extraction_quality,'unknown'),r.index_generation_id,r.producer,r.artifact_generation_id,r.metadata
      from jsonb_populate_record(null::public.document_sections, v_row) r
      returning id, section_index into v_section;
    v_sections := v_sections || jsonb_build_array(jsonb_build_object('id', v_section.id, 'section_index', v_section.section_index));
  end loop;

  for v_row in select value from jsonb_array_elements(p_cards) loop
    if jsonb_typeof(v_row) is distinct from 'object' or v_row->>'document_id' is distinct from v_document_id::text
      then raise exception 'ingestion_artifact_document_mismatch'; end if;
    perform public.assert_ingestion_artifact_sources(v_row, v_document_id, v_committed, p_artifact_generation);
    if jsonb_typeof(v_row->'embedding') is distinct from 'array' then raise exception 'invalid_ingestion_artifact'; end if;
    v_row := v_row || jsonb_build_object('id', gen_random_uuid(), 'owner_id', v_owner, 'producer', 'local-worker',
      'artifact_generation_id', p_artifact_generation, 'index_generation_id', p_artifact_generation,
      'metadata', (case when jsonb_typeof(v_row->'metadata') = 'object' then v_row->'metadata' else '{}'::jsonb end) || v_stamp,
      'embedding', (v_row->'embedding')::text);
    insert into public.document_memory_cards(id,document_id,owner_id,section_id,card_type,title,content,normalized_terms,page_number,source_chunk_ids,source_image_ids,confidence,index_generation_id,producer,artifact_generation_id,metadata,embedding)
      select r.id,r.document_id,r.owner_id,r.section_id,r.card_type,r.title,r.content,coalesce(r.normalized_terms,'{}'),r.page_number,coalesce(r.source_chunk_ids,'{}'),coalesce(r.source_image_ids,'{}'),coalesce(r.confidence,0.5),r.index_generation_id,r.producer,r.artifact_generation_id,r.metadata,r.embedding
      from jsonb_populate_record(null::public.document_memory_cards, v_row) r;
    v_cards := v_cards + 1;
  end loop;

  for v_row in select value from jsonb_array_elements(p_units) loop
    if jsonb_typeof(v_row) is distinct from 'object' or v_row->>'document_id' is distinct from v_document_id::text
      then raise exception 'ingestion_artifact_document_mismatch'; end if;
    perform public.assert_ingestion_artifact_sources(v_row, v_document_id, v_committed, p_artifact_generation);
    if jsonb_typeof(v_row->'embedding') is distinct from 'array' then raise exception 'invalid_ingestion_artifact'; end if;
    v_row := v_row || jsonb_build_object('id', gen_random_uuid(), 'owner_id', v_owner, 'producer', 'local-worker',
      'artifact_generation_id', p_artifact_generation, 'index_generation_id', p_artifact_generation,
      'metadata', (case when jsonb_typeof(v_row->'metadata') = 'object' then v_row->'metadata' else '{}'::jsonb end) || v_stamp,
      'embedding', (v_row->'embedding')::text);
    insert into public.document_index_units(id,owner_id,document_id,unit_type,source_chunk_id,source_image_id,page_start,page_end,heading_path,title,content,normalized_terms,source_span,quality_score,extraction_mode,index_generation_id,producer,artifact_generation_id,embedding,metadata)
      select r.id,r.owner_id,r.document_id,r.unit_type,r.source_chunk_id,r.source_image_id,r.page_start,r.page_end,coalesce(r.heading_path,'{}'),r.title,r.content,coalesce(r.normalized_terms,'{}'),r.source_span,coalesce(r.quality_score,0.7),coalesce(r.extraction_mode,'deterministic'),r.index_generation_id,r.producer,r.artifact_generation_id,r.embedding,r.metadata
      from jsonb_populate_record(null::public.document_index_units, v_row) r;
    v_units := v_units + 1;
  end loop;

  return jsonb_build_object('ok', true, 'artifact_generation_id', p_artifact_generation,
    'sections', v_sections, 'memory_card_count', v_cards, 'index_unit_count', v_units);
end $$;

-- ---------------------------------------------------------------------------------------------
-- cleanup_ingestion_deep_memory_staging: remove this lease's still-staged rows after a local
-- pre-commit failure. Only rows whose index_generation_id is still the staging id are deleted,
-- so rows a lost-response commit already activated are never removed.
-- ---------------------------------------------------------------------------------------------
create function public.cleanup_ingestion_deep_memory_staging(p_fence jsonb, p_artifact_generation uuid)
returns jsonb language plpgsql security definer set search_path = '' set lock_timeout = '10s' as $$
declare v_locked jsonb; v_document_id uuid; v_cards integer; v_units integer; v_sections integer;
begin
  if p_artifact_generation is null or p_fence->>'job_kind' is distinct from 'node'
    or p_fence->>'expected_generation_id' is null then raise exception 'ingestion_attempt_required'; end if;
  v_locked := public.assert_current_ingestion_attempt(p_fence, null);
  if v_locked is null then return jsonb_build_object('ok', false, 'reason', 'lease_lost'); end if;
  v_document_id := (p_fence->>'document_id')::uuid;
  perform ingestion_generation_evidence.assert_deep_memory_staging_owner(p_fence, v_locked, p_artifact_generation);
  delete from public.document_memory_cards where document_id = v_document_id and producer = 'local-worker'
    and artifact_generation_id = p_artifact_generation and index_generation_id = p_artifact_generation;
  get diagnostics v_cards = row_count;
  delete from public.document_index_units where document_id = v_document_id and producer = 'local-worker'
    and artifact_generation_id = p_artifact_generation and index_generation_id = p_artifact_generation;
  get diagnostics v_units = row_count;
  delete from public.document_sections where document_id = v_document_id and producer = 'local-worker'
    and artifact_generation_id = p_artifact_generation and index_generation_id = p_artifact_generation;
  get diagnostics v_sections = row_count;
  return jsonb_build_object('ok', true, 'artifact_generation_id', p_artifact_generation, 'deleted',
    jsonb_build_object('memory_cards', v_cards, 'index_units', v_units, 'sections', v_sections));
end $$;

-- ---------------------------------------------------------------------------------------------
-- commit_document_deep_memory_generation (fenced overload): atomically make a fully staged
-- deep-memory generation the live one for the served index generation.
--   1. checks the staged row counts exactly match what the worker says it staged;
--   2. re-points the staged rows to the served generation (they become visible);
--   3. removes the earlier local-worker deep-memory rows that were visible for the served
--      generation (and legacy unlabelled local-worker rows with no generation), never base
--      artifacts of the served generation, never other producers' rows, never older generations;
--   4. repairs missing chunk anchors on the served generation only, records model aliases
--      (replacing this document's earlier fenced local-worker aliases), and stamps metadata.
-- Any failure rolls the whole commit back. The unfenced overload is unchanged.
-- ---------------------------------------------------------------------------------------------
create function public.commit_document_deep_memory_generation(
  p_fence jsonb,
  p_artifact_generation uuid,
  p_rag_memory_version text,
  p_document_intelligence_version text,
  p_section_count integer,
  p_memory_card_count integer,
  p_index_unit_counts_by_type jsonb,
  p_anchors jsonb,
  p_aliases jsonb
)
returns jsonb language plpgsql security definer set search_path = '' set lock_timeout = '10s' as $$
declare
  v_locked jsonb; v_document_id uuid; v_committed uuid; v_owner uuid; v_row jsonb;
  v_total_sections integer; v_total_cards integer; v_total_units integer;
  v_sections integer; v_cards integer; v_units integer; v_expected_units integer; v_units_by_type jsonb;
  v_anchor text; v_anchor_count integer := 0; v_alias_count integer := 0; v_updated integer; v_weight real;
begin
  if p_artifact_generation is null or p_fence->>'job_kind' is distinct from 'node'
    or p_fence->>'expected_generation_id' is null then raise exception 'ingestion_attempt_required'; end if;
  if nullif(btrim(p_rag_memory_version), '') is null or nullif(btrim(p_document_intelligence_version), '') is null
    or p_section_count is null or p_memory_card_count is null or p_section_count < 0 or p_memory_card_count < 0
    or jsonb_typeof(p_index_unit_counts_by_type) is distinct from 'object'
    or jsonb_typeof(p_anchors) is distinct from 'array' or jsonb_array_length(p_anchors) > 100000
    or jsonb_typeof(p_aliases) is distinct from 'array' or jsonb_array_length(p_aliases) > 1000
  then raise exception 'invalid_deep_memory_commit'; end if;
  if exists(select 1 from jsonb_each(p_index_unit_counts_by_type) item
      where jsonb_typeof(item.value) <> 'number' or (item.value #>> '{}')::numeric < 0
        or trunc((item.value #>> '{}')::numeric) <> (item.value #>> '{}')::numeric
        or (item.value #>> '{}')::numeric > 2147483647)
  then raise exception 'invalid_deep_memory_commit'; end if;

  v_locked := public.assert_current_ingestion_attempt(p_fence, null);
  if v_locked is null then return jsonb_build_object('ok', false, 'reason', 'lease_lost'); end if;
  v_document_id := (p_fence->>'document_id')::uuid;
  v_committed := (p_fence->>'expected_generation_id')::uuid;
  v_owner := (v_locked->'document'->>'owner_id')::uuid;
  perform ingestion_generation_evidence.assert_deep_memory_staging_owner(p_fence, v_locked, p_artifact_generation);

  -- 1. Exact staged inventory.
  select count(*) into v_total_sections from public.document_sections
    where document_id = v_document_id and artifact_generation_id = p_artifact_generation;
  select count(*) into v_total_cards from public.document_memory_cards
    where document_id = v_document_id and artifact_generation_id = p_artifact_generation;
  select count(*) into v_total_units from public.document_index_units
    where document_id = v_document_id and artifact_generation_id = p_artifact_generation;
  select count(*) into v_sections from public.document_sections
    where document_id = v_document_id and producer = 'local-worker' and artifact_generation_id = p_artifact_generation
      and index_generation_id = p_artifact_generation and owner_id is not distinct from v_owner
      and metadata->>'generated_by' = 'local-worker' and metadata->>'index_generation_id' = p_artifact_generation::text;
  select count(*) into v_cards from public.document_memory_cards
    where document_id = v_document_id and producer = 'local-worker' and artifact_generation_id = p_artifact_generation
      and index_generation_id = p_artifact_generation and owner_id is not distinct from v_owner
      and metadata->>'generated_by' = 'local-worker' and metadata->>'index_generation_id' = p_artifact_generation::text;
  select coalesce(sum(n), 0)::integer, coalesce(jsonb_object_agg(unit_type, n), '{}'::jsonb)
    into v_units, v_units_by_type
    from (select unit_type, count(*)::integer n from public.document_index_units
      where document_id = v_document_id and producer = 'local-worker' and artifact_generation_id = p_artifact_generation
        and index_generation_id = p_artifact_generation and owner_id is not distinct from v_owner
        and metadata->>'generated_by' = 'local-worker' and metadata->>'index_generation_id' = p_artifact_generation::text
      group by unit_type) staged;
  select coalesce(sum(value::integer), 0) into v_expected_units from jsonb_each_text(p_index_unit_counts_by_type);
  if v_total_sections <> v_sections or v_total_cards <> v_cards or v_total_units <> v_units
    or v_sections <> p_section_count or v_cards <> p_memory_card_count or v_units <> v_expected_units
    or v_units_by_type <> (select coalesce(jsonb_object_agg(key, value), '{}'::jsonb)
                            from jsonb_each(p_index_unit_counts_by_type) where (value #>> '{}')::numeric > 0)
    or v_sections + v_cards = 0
  then raise exception 'deep_memory_staged_counts_mismatch'; end if;
  if exists(select 1 from public.document_memory_cards card
      left join public.document_sections section on section.id = card.section_id and section.document_id = v_document_id
        and section.producer = 'local-worker' and section.artifact_generation_id = p_artifact_generation
      where card.document_id = v_document_id and card.artifact_generation_id = p_artifact_generation
        and card.section_id is not null and section.id is null)
  then raise exception 'deep_memory_card_section_outside_generation'; end if;

  -- Refuse to null another producer's card -> section link through ON DELETE SET NULL.
  if exists(select 1 from public.document_memory_cards card
      join public.document_sections section on section.id = card.section_id
      where section.document_id = v_document_id
        and section.artifact_generation_id is distinct from p_artifact_generation
        and section.artifact_generation_id is distinct from v_committed
        and (
          (section.index_generation_id = v_committed and section.producer = 'local-worker'
            and section.metadata->>'generated_by' = 'local-worker')
          or (section.index_generation_id is null and section.artifact_generation_id is null
            and (section.producer = 'local-worker' or section.producer is null)
            and (section.metadata->>'generated_by' = 'local-worker'
              or (nullif(section.metadata->>'generated_by', '') is null
                and section.metadata->>'rag_indexing_version' in ('rag-deep-memory-v1', 'rag-deep-memory-v2')))))
        and coalesce(card.producer, card.metadata->>'generated_by', 'local-worker') <> 'local-worker')
  then raise exception 'deep_memory_foreign_section_reference'; end if;

  -- 2. Activate: staged rows join the served generation.
  update public.document_sections set index_generation_id = v_committed,
    metadata = metadata || jsonb_build_object('generated_by', 'local-worker', 'artifact_generation_id', p_artifact_generation, 'index_generation_id', v_committed)
    where document_id = v_document_id and producer = 'local-worker' and artifact_generation_id = p_artifact_generation;
  update public.document_memory_cards set index_generation_id = v_committed,
    metadata = metadata || jsonb_build_object('generated_by', 'local-worker', 'artifact_generation_id', p_artifact_generation, 'index_generation_id', v_committed)
    where document_id = v_document_id and producer = 'local-worker' and artifact_generation_id = p_artifact_generation;
  update public.document_index_units set index_generation_id = v_committed,
    metadata = metadata || jsonb_build_object('generated_by', 'local-worker', 'artifact_generation_id', p_artifact_generation, 'index_generation_id', v_committed)
    where document_id = v_document_id and producer = 'local-worker' and artifact_generation_id = p_artifact_generation;

  -- 3. Supersede earlier local-worker deep memory visible for the served generation.
  delete from public.document_memory_cards
    where document_id = v_document_id
      and artifact_generation_id is distinct from p_artifact_generation
      and artifact_generation_id is distinct from v_committed
      and ((index_generation_id = v_committed and producer = 'local-worker' and metadata->>'generated_by' = 'local-worker')
        or (index_generation_id is null and artifact_generation_id is null
          and (producer = 'local-worker' or producer is null)
          and (metadata->>'generated_by' = 'local-worker'
            or (nullif(metadata->>'generated_by', '') is null
              and metadata->>'rag_indexing_version' in ('rag-deep-memory-v1', 'rag-deep-memory-v2')))));
  delete from public.document_index_units
    where document_id = v_document_id
      and artifact_generation_id is distinct from p_artifact_generation
      and artifact_generation_id is distinct from v_committed
      and ((index_generation_id = v_committed and producer = 'local-worker' and metadata->>'generated_by' = 'local-worker')
        or (index_generation_id is null and artifact_generation_id is null
          and (producer = 'local-worker' or producer is null)
          and (metadata->>'generated_by' = 'local-worker'
            or (nullif(metadata->>'generated_by', '') is null
              and metadata->>'rag_indexing_version' in ('rag-deep-memory-v1', 'rag-deep-memory-v2')))));
  delete from public.document_sections
    where document_id = v_document_id
      and artifact_generation_id is distinct from p_artifact_generation
      and artifact_generation_id is distinct from v_committed
      and ((index_generation_id = v_committed and producer = 'local-worker' and metadata->>'generated_by' = 'local-worker')
        or (index_generation_id is null and artifact_generation_id is null
          and (producer = 'local-worker' or producer is null)
          and (metadata->>'generated_by' = 'local-worker'
            or (nullif(metadata->>'generated_by', '') is null
              and metadata->>'rag_indexing_version' in ('rag-deep-memory-v1', 'rag-deep-memory-v2')))));

  -- 4a. Anchor repair, served generation only, never overwriting an existing anchor.
  for v_row in select value from jsonb_array_elements(p_anchors) loop
    v_anchor := v_row->>'anchor_id';
    if jsonb_typeof(v_row) is distinct from 'object' or jsonb_typeof(v_row->'id') is distinct from 'string'
      or coalesce(v_row->>'id', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or nullif(btrim(coalesce(v_anchor, '')), '') is null or length(v_anchor) > 500
    then raise exception 'invalid_deep_memory_anchor'; end if;
    update public.document_chunks set anchor_id = v_anchor,
      metadata = metadata || jsonb_build_object('anchor_id', v_anchor, 'anchor_repaired_by', p_document_intelligence_version)
      where id = (v_row->>'id')::uuid and document_id = v_document_id and index_generation_id = v_committed and anchor_id is null;
    get diagnostics v_updated = row_count;
    v_anchor_count := v_anchor_count + v_updated;
  end loop;

  -- 4b. Model aliases. Invalid entries are skipped, matching the unfenced best-effort insert.
  delete from public.rag_aliases
    where metadata->>'document_id' = v_document_id::text
      and coalesce(nullif(metadata->>'generated_by', ''), 'local-worker') = 'local-worker'
      and metadata->>'source' = 'model_index_profile'
      and owner_id is not distinct from v_owner;
  for v_row in select value from jsonb_array_elements(p_aliases) loop
    if jsonb_typeof(v_row) = 'object'
      and nullif(btrim(coalesce(v_row->>'alias', '')), '') is not null and length(v_row->>'alias') <= 500
      and nullif(btrim(coalesce(v_row->>'canonical', '')), '') is not null and length(v_row->>'canonical') <= 500
      and v_row->>'alias_type' in ('medication', 'document_title', 'acronym', 'service', 'workflow', 'typo', 'clinical_term', 'custom')
    then
      v_weight := case when jsonb_typeof(v_row->'weight') = 'number'
        then least(1.5, greatest(0.5, (v_row->>'weight')::real)) else 1.0 end;
      insert into public.rag_aliases(owner_id, alias, canonical, alias_type, weight, enabled, metadata)
      values (v_owner, v_row->>'alias', v_row->>'canonical', v_row->>'alias_type', v_weight, true,
        (case when jsonb_typeof(v_row->'metadata') = 'object' then v_row->'metadata' else '{}'::jsonb end)
          || jsonb_build_object('source', 'model_index_profile', 'document_id', v_document_id,
            'generated_by', 'local-worker', 'artifact_generation_id', p_artifact_generation));
      v_alias_count := v_alias_count + 1;
    end if;
  end loop;

  -- 4c. Final logical mutation: advertise the new deep-memory generation.
  perform public.apply_document_metadata_patch(v_document_id, jsonb_build_object(
    'rag_indexing_version', p_rag_memory_version,
    'rag_memory_version', p_rag_memory_version,
    'rag_memory_updated_at', pg_catalog.clock_timestamp(),
    'document_intelligence_version', p_document_intelligence_version,
    'document_intelligence_updated_at', pg_catalog.clock_timestamp(),
    'section_count', p_section_count,
    'memory_card_count', p_memory_card_count,
    'index_unit_count', v_expected_units,
    'index_unit_counts_by_type', p_index_unit_counts_by_type,
    'repaired_anchor_count', v_anchor_count,
    'deep_memory_generations', jsonb_build_object('local-worker', p_artifact_generation)));

  return jsonb_build_object('ok', true, 'artifact_generation_id', p_artifact_generation,
    'index_generation_id', v_committed, 'section_count', p_section_count, 'memory_card_count', p_memory_card_count,
    'index_unit_count', v_expected_units, 'repaired_anchor_count', v_anchor_count, 'alias_count', v_alias_count);
end $$;

alter function ingestion_generation_evidence.assert_deep_memory_staging_owner(jsonb, jsonb, uuid) owner to postgres;
revoke all on function ingestion_generation_evidence.assert_deep_memory_staging_owner(jsonb, jsonb, uuid) from public, anon, authenticated, service_role;

alter function public.reset_ingestion_attempt_artifacts(jsonb, uuid) owner to postgres;
revoke all on function public.reset_ingestion_attempt_artifacts(jsonb, uuid) from public, anon, authenticated;
grant execute on function public.reset_ingestion_attempt_artifacts(jsonb, uuid) to service_role;

alter function public.prepare_ingestion_image_upload(jsonb, uuid, text) owner to postgres;
revoke all on function public.prepare_ingestion_image_upload(jsonb, uuid, text) from public, anon, authenticated;
grant execute on function public.prepare_ingestion_image_upload(jsonb, uuid, text) to service_role;

alter function public.stage_ingestion_deep_memory(jsonb, uuid, jsonb, jsonb, jsonb) owner to postgres;
revoke all on function public.stage_ingestion_deep_memory(jsonb, uuid, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.stage_ingestion_deep_memory(jsonb, uuid, jsonb, jsonb, jsonb) to service_role;

alter function public.cleanup_ingestion_deep_memory_staging(jsonb, uuid) owner to postgres;
revoke all on function public.cleanup_ingestion_deep_memory_staging(jsonb, uuid) from public, anon, authenticated;
grant execute on function public.cleanup_ingestion_deep_memory_staging(jsonb, uuid) to service_role;

alter function public.commit_document_deep_memory_generation(jsonb, uuid, text, text, integer, integer, jsonb, jsonb, jsonb) owner to postgres;
revoke all on function public.commit_document_deep_memory_generation(jsonb, uuid, text, text, integer, integer, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.commit_document_deep_memory_generation(jsonb, uuid, text, text, integer, integer, jsonb, jsonb, jsonb) to service_role;
