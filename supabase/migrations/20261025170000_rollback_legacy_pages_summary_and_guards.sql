-- Merge only after the owner's explicit yes to this database change.
-- Audit 2026-10-24 follow-ups to the index rollback (20261021150000, 20261021170000).
--
-- E2E-01: documents last indexed before 13 Oct 2026 keep their pages without a generation stamp
--   (20261013075944 added document_pages.index_generation_id with no backfill). The first typed
--   commit after that switches the document to page_storage_mode 'typed_exact' and leaves those
--   unstamped pages in place, but a rollback to the earlier generation was refused with
--   target_not_committed because it only counted stamped pages. The rollback now accepts such a
--   target when the document is in typed_exact mode, the target has no stamped pages, unstamped
--   pages exist, the target still has chunks and its snapshot was captured when the pointer left
--   it. It switches page_storage_mode back to 'legacy_unqualified' so the unstamped pages are the
--   visible ones again. Rolling forward again to a typed generation switches it back to
--   'typed_exact'. Every typed commit stamps its pages, so a generation with chunks but no stamped
--   pages can only be the one committed before the cutover, which owns the unstamped pages.
--
-- DB-N1 / ING-S-N1: there is one summary row and one set of generated labels per document, and
--   every re-index replaced them, so a rollback left the newer version's summary, clinical
--   specifics and topic labels beside the restored passages. When the pointer moves, the snapshot
--   now also keeps the outgoing summary and generated labels, unless their metadata names a
--   different generation (rows from before generation stamps carry none, and are what was shown
--   with the outgoing generation). The rollback restores them when present.
--
-- DB-N2: the rollback also refuses with ingestion_in_progress while the background enrichment
--   queue (indexing_v3_agent_jobs) has a pending or processing job for the document, which could
--   otherwise overwrite the restored details afterwards.
--
-- ING-S-N10: the rolled_back_from/_at markers are cleared when a later commit moves the pointer,
--   so they describe only the most recent move and never a rollback that has since been replaced.

set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.document_index_generation_snapshots
  add column summary jsonb,
  add column labels jsonb,
  add constraint document_index_generation_snapshots_summary_object
    check (summary is null or jsonb_typeof(summary) = 'object'),
  add constraint document_index_generation_snapshots_labels_array
    check (labels is null or jsonb_typeof(labels) = 'array');

create or replace function public.capture_document_index_metadata_snapshot()
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
  v_summary jsonb;
  v_labels jsonb;
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
  -- ING-S-N10: a pointer move that did not itself stamp a rollback clears the old markers.
  if new.metadata->'index_generation_rolled_back_at' is not distinct from old.metadata->'index_generation_rolled_back_at' then
    new.metadata := new.metadata - array['index_generation_rolled_back_from', 'index_generation_rolled_back_at'];
  end if;
  if v_old_generation is not null then
    -- DB-N1: keep the outgoing summary and generated labels unless they say they were built from
    -- another generation, so a restore can never bring back details from a third version. Rows
    -- written before generation stamps carry none; they are what was shown with this generation.
    select to_jsonb(s) - array['id', 'document_id', 'owner_id', 'created_at', 'updated_at']
      into v_summary
      from public.document_summaries s
     where s.document_id = old.id
       and coalesce(s.metadata->>'index_generation_id', v_old_generation::text) = v_old_generation::text;
    if not exists (select 1 from public.document_labels l
                    where l.document_id = old.id and l.source = 'generated'
                      and coalesce(l.metadata->>'index_generation_id', v_old_generation::text)
                          <> v_old_generation::text) then
      select coalesce(pg_catalog.jsonb_agg(to_jsonb(l) - array['id', 'document_id', 'owner_id', 'created_at', 'updated_at']
                                           order by l.label_type, l.label), '[]'::jsonb)
        into v_labels
        from public.document_labels l
       where l.document_id = old.id and l.source = 'generated';
    end if;
    insert into public.document_index_generation_snapshots(document_id, index_generation_id, metadata, summary, labels, captured_at)
    values (old.id, v_old_generation,
            coalesce((select pg_catalog.jsonb_object_agg(e.key, e.value)
                      from pg_catalog.jsonb_each(old.metadata) e where e.key = any(v_keys)), '{}'::jsonb),
            v_summary, v_labels, pg_catalog.clock_timestamp())
    on conflict (document_id, index_generation_id) do update
      set metadata = excluded.metadata, summary = excluded.summary, labels = excluded.labels,
          captured_at = excluded.captured_at;
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
  v_page_mode text := 'typed_exact';
  v_summary_restored boolean := false;
  v_labels_restored boolean := false;
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
             where j.document_id = p_document_id and j.status in ('pending', 'processing'))
     or exists (select 1 from public.indexing_v3_agent_jobs a
                where a.document_id = p_document_id and a.status in ('pending', 'processing')) then
    return jsonb_build_object('ok', false, 'reason', 'ingestion_in_progress');
  end if;
  select count(*) into v_page_count from public.document_pages
   where document_id = p_document_id and index_generation_id = p_target_generation;
  if v_page_count = 0 and v_document.page_storage_mode = 'typed_exact' then
    -- E2E-01: a generation committed before the 13 Oct cutover owns the unstamped pages.
    select count(*) into v_page_count from public.document_pages
     where document_id = p_document_id and index_generation_id is null;
    if v_page_count > 0 then
      v_page_mode := 'legacy_unqualified';
    end if;
  end if;
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
  -- Unstamped images are visible in either page mode; count them only with the unstamped pages.
  select count(*) into v_image_count from public.document_images
   where document_id = p_document_id and searchable
     and (index_generation_id = p_target_generation
          or (v_page_mode = 'legacy_unqualified' and index_generation_id is null));

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

  -- Then the worker-owned keys, the pointer and the page mode together; the metadata trigger stores
  -- the current keys, summary and labels as the current generation's snapshot before they change.
  -- guard_page_mode allows the mode change only for this document, as postgres, inside this call.
  perform pg_catalog.set_config('psychsift.page_commit_owner', p_document_id::text, true);
  update public.documents
     set metadata = (metadata - v_keys) || v_snapshot.metadata || jsonb_build_object(
           'index_generation_id', p_target_generation,
           'index_generation_rolled_back_from', p_expected_generation,
           'index_generation_rolled_back_at', pg_catalog.clock_timestamp()),
         page_storage_mode = v_page_mode,
         page_count = v_page_count,
         chunk_count = v_chunk_count,
         image_count = v_image_count,
         updated_at = pg_catalog.clock_timestamp()
   where id = p_document_id;
  perform pg_catalog.set_config('psychsift.page_commit_owner', '', true);

  -- DB-N1: the target's own summary and generated labels, when they were kept.
  if v_snapshot.summary is not null
     and coalesce(v_snapshot.summary->'metadata'->>'index_generation_id', p_target_generation::text)
         = p_target_generation::text then
    insert into public.document_summaries(document_id, owner_id, summary, clinical_specifics, source_chunk_ids,
      source_image_ids, model, metadata, generated_at, updated_at)
    values (p_document_id, v_document.owner_id, v_snapshot.summary->>'summary',
      coalesce(v_snapshot.summary->'clinical_specifics', '{}'::jsonb),
      coalesce(array(select pg_catalog.jsonb_array_elements_text(v_snapshot.summary->'source_chunk_ids'))::uuid[], '{}'),
      coalesce(array(select pg_catalog.jsonb_array_elements_text(v_snapshot.summary->'source_image_ids'))::uuid[], '{}'),
      v_snapshot.summary->>'model', coalesce(v_snapshot.summary->'metadata', '{}'::jsonb),
      coalesce((v_snapshot.summary->>'generated_at')::timestamptz, pg_catalog.clock_timestamp()),
      pg_catalog.clock_timestamp())
    on conflict (document_id) do update set summary = excluded.summary,
      clinical_specifics = excluded.clinical_specifics, source_chunk_ids = excluded.source_chunk_ids,
      source_image_ids = excluded.source_image_ids, model = excluded.model, metadata = excluded.metadata,
      generated_at = excluded.generated_at, updated_at = excluded.updated_at;
    v_summary_restored := true;
  end if;
  if v_snapshot.labels is not null then
    delete from public.document_labels where document_id = p_document_id and source = 'generated';
    insert into public.document_labels(document_id, owner_id, label, label_type, source, confidence, metadata)
    select p_document_id, v_document.owner_id, l->>'label', l->>'label_type', 'generated',
           coalesce((l->>'confidence')::real, 0.5), coalesce(l->'metadata', '{}'::jsonb)
      from pg_catalog.jsonb_array_elements(v_snapshot.labels) l
    on conflict (document_id, label_type, label, source) do nothing;
    v_labels_restored := true;
  end if;

  return jsonb_build_object('ok', true, 'document_id', p_document_id,
    'from_generation', p_expected_generation, 'to_generation', p_target_generation,
    'chunk_count', v_chunk_count, 'image_count', v_image_count, 'page_count', v_page_count,
    'page_storage_mode', v_page_mode, 'metadata_restored', true, 'quality_restored', true,
    'summary_restored', v_summary_restored, 'labels_restored', v_labels_restored);
end;
$$;

alter function public.rollback_document_index_generation(uuid, uuid, uuid) owner to postgres;
revoke all on function public.rollback_document_index_generation(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.rollback_document_index_generation(uuid, uuid, uuid) to service_role;
