-- Merge only after the owner's explicit yes to this database change.
-- #3732 (follow-up to #3718): an index rollback must restore the generation-specific details,
-- not only the pointer.
--
-- rollback_document_index_generation (20261021150000) moves documents.metadata
-- .index_generation_id back to a retained generation, but the worker-owned metadata keys
-- (extraction quality, cover image, embedding model, enrichment state, extraction provenance and
-- the extraction metrics) and the document_index_quality row keep describing the generation that
-- was rolled back from. This migration keeps a snapshot of those details per committed generation
-- and makes the rollback restore them.
--
-- Capture, without changing any commit function:
--   * document_index_quality BEFORE UPDATE: the row is about to change while the document's
--     pointer still names the generation it describes, so the OLD row is stored as that
--     generation's quality. commit_document_index_generation upserts quality before it moves the
--     pointer, so the last capture before a commit is the outgoing generation's final quality.
--   * documents BEFORE UPDATE OF metadata, when the pointer changes: the OLD worker-owned keys are
--     stored as the outgoing generation's metadata, and snapshots of generations that are neither
--     the old nor the new pointer are deleted (the prune trigger removes their artifacts).
-- "Worker-owned keys" is exactly the patch_ingestion_document_state allow-list
-- (20261015200000) less index_generation_id, so owner-edited metadata (title, source, review
-- status) is never captured or overwritten.
--
-- Restore: the rollback now refuses with target_snapshot_missing unless the target generation has
-- both snapshots. Generations committed before this migration have none, so a rollback to them
-- is refused rather than leaving mismatched details (fail closed). It restores quality first
-- (which snapshots the current generation's quality through the trigger), then the metadata keys
-- with the pointer (which snapshots the current generation's metadata), so the rollback can
-- itself be rolled back.

set local lock_timeout = '5s';
set local statement_timeout = '30s';

create table public.document_index_generation_snapshots (
  document_id uuid not null references public.documents(id) on delete cascade,
  index_generation_id uuid not null,
  metadata jsonb,
  quality jsonb,
  captured_at timestamptz not null default now(),
  primary key (document_id, index_generation_id),
  constraint document_index_generation_snapshots_metadata_object
    check (metadata is null or jsonb_typeof(metadata) = 'object'),
  constraint document_index_generation_snapshots_quality_object
    check (quality is null or jsonb_typeof(quality) = 'object')
);

alter table public.document_index_generation_snapshots owner to postgres;
alter table public.document_index_generation_snapshots enable row level security;
revoke all on table public.document_index_generation_snapshots from public, anon, authenticated;
grant select, insert, update, delete on table public.document_index_generation_snapshots to service_role;

create function public.document_index_generation_metadata_keys()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['indexed_at','cover_image_id','rag_enrichment_version','rag_indexing_version',
    'rag_memory_version','rag_memory_updated_at','rag_enrichment_updated_at','enrichment_status',
    'enrichment_error','section_count','memory_card_count','extraction_quality',
    'index_quality_score','index_quality_issues','index_quality_metrics',
    'optional_index_write_issues','indexing_v3_agent_status','indexing_v3_agent_last_error',
    'indexing_v3_agent_repair_reason','indexing_v3_agent_updated_at','completion_gate_missing',
    'embedding_model','page_count','ocr_page_count','needs_ocr_page_count','text_character_count',
    'extracted_image_count','searchable_image_count','skipped_image_count',
    'skipped_image_reasons','image_type_counts','extraction_warnings',
    'document_embedding_field_types','shadow_extraction','extraction_provenance']::text[]
$$;

alter function public.document_index_generation_metadata_keys() owner to postgres;
revoke all on function public.document_index_generation_metadata_keys() from public, anon, authenticated;
grant execute on function public.document_index_generation_metadata_keys() to service_role;

create function public.capture_document_index_quality_snapshot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_generation uuid;
begin
  select d.index_generation_id into v_generation from public.documents d where d.id = old.document_id;
  if v_generation is not null then
    insert into public.document_index_generation_snapshots(document_id, index_generation_id, quality, captured_at)
    values (old.document_id, v_generation, to_jsonb(old) - array['document_id', 'owner_id'],
            pg_catalog.clock_timestamp())
    on conflict (document_id, index_generation_id) do update
      set quality = excluded.quality, captured_at = excluded.captured_at;
  end if;
  return new;
end;
$$;

alter function public.capture_document_index_quality_snapshot() owner to postgres;
revoke all on function public.capture_document_index_quality_snapshot() from public, anon, authenticated;

create trigger document_index_quality_capture_generation_snapshot
before update on public.document_index_quality
for each row execute function public.capture_document_index_quality_snapshot();

create function public.capture_document_index_metadata_snapshot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uuid constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_old_generation uuid;
  v_new_generation uuid;
  v_keys text[] := public.document_index_generation_metadata_keys();
begin
  -- Same parse as the documents.index_generation_id generated column: a malformed value is no
  -- pointer, never an error that would block the document update.
  if old.metadata->>'index_generation_id' ~ v_uuid then
    v_old_generation := (old.metadata->>'index_generation_id')::uuid;
  end if;
  if new.metadata->>'index_generation_id' ~ v_uuid then
    v_new_generation := (new.metadata->>'index_generation_id')::uuid;
  end if;
  if v_old_generation is not distinct from v_new_generation then
    return new;
  end if;
  if v_old_generation is not null then
    insert into public.document_index_generation_snapshots(document_id, index_generation_id, metadata, captured_at)
    values (old.id, v_old_generation,
            coalesce((select pg_catalog.jsonb_object_agg(e.key, e.value)
                      from pg_catalog.jsonb_each(old.metadata) e where e.key = any(v_keys)), '{}'::jsonb),
            pg_catalog.clock_timestamp())
    on conflict (document_id, index_generation_id) do update
      set metadata = excluded.metadata, captured_at = excluded.captured_at;
  end if;
  delete from public.document_index_generation_snapshots s
   where s.document_id = old.id
     and s.index_generation_id is distinct from v_old_generation
     and s.index_generation_id is distinct from v_new_generation;
  return new;
end;
$$;

alter function public.capture_document_index_metadata_snapshot() owner to postgres;
revoke all on function public.capture_document_index_metadata_snapshot() from public, anon, authenticated;

create trigger documents_capture_index_generation_snapshot
before update of metadata on public.documents
for each row execute function public.capture_document_index_metadata_snapshot();

create or replace function public.rollback_document_index_generation(
  p_document_id uuid,
  p_expected_generation uuid,
  p_target_generation uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_document public.documents%rowtype;
  v_snapshot public.document_index_generation_snapshots%rowtype;
  v_keys text[] := public.document_index_generation_metadata_keys();
  v_chunk_count integer;
  v_image_count integer;
  v_page_count integer;
begin
  if p_document_id is null or p_expected_generation is null or p_target_generation is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_arguments');
  end if;
  select * into v_document from public.documents where id = p_document_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'document_not_found');
  end if;
  if v_document.index_generation_id is distinct from p_expected_generation then
    return jsonb_build_object('ok', false, 'reason', 'pointer_moved',
      'current_generation', v_document.index_generation_id);
  end if;
  if p_target_generation = p_expected_generation then
    return jsonb_build_object('ok', false, 'reason', 'target_is_current');
  end if;
  if exists (select 1 from public.ingestion_jobs j
             where j.document_id = p_document_id and j.status in ('pending', 'processing')) then
    return jsonb_build_object('ok', false, 'reason', 'ingestion_in_progress');
  end if;
  select count(*) into v_page_count from public.document_pages
   where document_id = p_document_id and index_generation_id = p_target_generation;
  if v_page_count = 0 then
    return jsonb_build_object('ok', false, 'reason', 'target_not_committed');
  end if;
  select count(*) into v_chunk_count from public.document_chunks
   where document_id = p_document_id and index_generation_id = p_target_generation;
  if v_chunk_count = 0 then
    return jsonb_build_object('ok', false, 'reason', 'target_has_no_chunks');
  end if;
  select * into v_snapshot from public.document_index_generation_snapshots
   where document_id = p_document_id and index_generation_id = p_target_generation;
  if not found or v_snapshot.metadata is null or v_snapshot.quality is null then
    return jsonb_build_object('ok', false, 'reason', 'target_snapshot_missing');
  end if;
  select count(*) into v_image_count from public.document_images
   where document_id = p_document_id and index_generation_id = p_target_generation and searchable;

  -- Quality first, while the pointer still names the current generation, so the trigger stores
  -- the current quality as that generation's snapshot.
  update public.document_index_quality q
     set quality_score = coalesce((v_snapshot.quality->>'quality_score')::real, q.quality_score),
         extraction_quality = coalesce(v_snapshot.quality->>'extraction_quality', q.extraction_quality),
         anchor_coverage = (v_snapshot.quality->>'anchor_coverage')::real,
         model_fallback_rate = (v_snapshot.quality->>'model_fallback_rate')::real,
         noisy_unit_rate = (v_snapshot.quality->>'noisy_unit_rate')::real,
         retrievable_visual_hit = (v_snapshot.quality->>'retrievable_visual_hit')::boolean,
         source_span_coverage = (v_snapshot.quality->>'source_span_coverage')::real,
         typed_unit_coverage = (v_snapshot.quality->>'typed_unit_coverage')::real,
         metrics = coalesce(v_snapshot.quality->'metrics', '{}'::jsonb),
         issues = coalesce(array(select pg_catalog.jsonb_array_elements_text(v_snapshot.quality->'issues')), '{}'),
         updated_at = pg_catalog.clock_timestamp()
   where q.document_id = p_document_id;

  -- Then the worker-owned keys and the pointer together; the metadata trigger stores the current
  -- keys as the current generation's snapshot before they are replaced.
  update public.documents
     set metadata = (metadata - v_keys) || v_snapshot.metadata || jsonb_build_object(
           'index_generation_id', p_target_generation,
           'index_generation_rolled_back_from', p_expected_generation,
           'index_generation_rolled_back_at', pg_catalog.clock_timestamp()),
         page_count = v_page_count,
         chunk_count = v_chunk_count,
         image_count = v_image_count,
         updated_at = pg_catalog.clock_timestamp()
   where id = p_document_id;

  return jsonb_build_object('ok', true, 'document_id', p_document_id,
    'from_generation', p_expected_generation, 'to_generation', p_target_generation,
    'chunk_count', v_chunk_count, 'image_count', v_image_count, 'page_count', v_page_count,
    'metadata_restored', true, 'quality_restored', true);
end;
$$;

alter function public.rollback_document_index_generation(uuid, uuid, uuid) owner to postgres;
revoke all on function public.rollback_document_index_generation(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.rollback_document_index_generation(uuid, uuid, uuid) to service_role;
