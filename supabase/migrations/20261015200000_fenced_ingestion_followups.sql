-- Fenced ingestion follow-ups to 20261015185000: null-safe staging ownership, provenance key.
--
-- The ownership test used `and not (<owned by this lease>)`. When a staged row lacks
-- metadata.ingestion_lease_token or metadata.ingestion_job_id, that conjunction is NULL, NOT NULL
-- is NULL, and the row was not flagged as a conflict. Such a row could then be cleaned up or
-- counted by the commit as if this lease owned it. `(<owned by this lease>) is not true` treats
-- a missing key as "not owned", so the guard refuses instead.
--
-- Also: the worker records metadata.extraction_provenance (which reader produced the pages) on
-- ordinary completion, but patch_ingestion_document_state's allow-list omitted that key, so the
-- final metadata patch raised invalid_ingestion_document_patch after the core work was done.
-- The allow-list below adds exactly that one worker-owned key; the body is otherwise unchanged.
--
-- Function body replacements only: same signatures, owners and grants. No data change.

set local lock_timeout = '10s';
set local statement_timeout = '60s';

create or replace function ingestion_generation_evidence.assert_deep_memory_staging_owner(
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
        and (producer = 'local-worker' and artifact_generation_id = p_artifact_generation
          and index_generation_id = p_artifact_generation
          and metadata->>'ingestion_lease_token' = p_fence->>'lease_token'
          and metadata->>'ingestion_job_id' = p_fence->>'job_id') is not true)
    or exists(
      select 1 from public.document_memory_cards
      where document_id = v_document_id
        and (artifact_generation_id = p_artifact_generation or index_generation_id = p_artifact_generation)
        and (producer = 'local-worker' and artifact_generation_id = p_artifact_generation
          and index_generation_id = p_artifact_generation
          and metadata->>'ingestion_lease_token' = p_fence->>'lease_token'
          and metadata->>'ingestion_job_id' = p_fence->>'job_id') is not true)
    or exists(
      select 1 from public.document_index_units
      where document_id = v_document_id
        and (artifact_generation_id = p_artifact_generation or index_generation_id = p_artifact_generation)
        and (producer = 'local-worker' and artifact_generation_id = p_artifact_generation
          and index_generation_id = p_artifact_generation
          and metadata->>'ingestion_lease_token' = p_fence->>'lease_token'
          and metadata->>'ingestion_job_id' = p_fence->>'job_id') is not true)
  then raise exception 'deep_memory_staging_generation_conflict'; end if;
end $$;

alter function ingestion_generation_evidence.assert_deep_memory_staging_owner(jsonb, jsonb, uuid) owner to postgres;
revoke all on function ingestion_generation_evidence.assert_deep_memory_staging_owner(jsonb, jsonb, uuid) from public, anon, authenticated, service_role;


create or replace function public.patch_ingestion_document_state(p_fence jsonb, p_state jsonb, p_metadata jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_locked jsonb; v_document_id uuid;
begin
  v_locked := public.assert_current_ingestion_attempt(p_fence, null);
  if v_locked is null then return jsonb_build_object('ok', false, 'reason', 'lease_lost'); end if;
  if exists(select 1 from ingestion_generation_evidence.candidates where document_id=(p_fence->>'document_id')::uuid and job_id=(p_fence->>'job_id')::uuid)
    and (p_metadata is distinct from '{}'::jsonb or (p_state ? 'status' and p_state->>'status'='indexed' and v_locked->'document'->>'status' is distinct from 'indexed')) then
    return jsonb_build_object('ok',false,'reason','technical_supplier_not_implemented');
  end if;
  v_document_id := (p_fence->>'document_id')::uuid;
  if jsonb_typeof(p_state) is distinct from 'object' or jsonb_typeof(p_metadata) is distinct from 'object'
    or exists(select 1 from jsonb_object_keys(p_state) k where k <> all(array['status','error_message']))
    or exists(select 1 from jsonb_object_keys(p_metadata) k where k <> all(array['indexed_at','cover_image_id','rag_enrichment_version','rag_indexing_version','rag_memory_version','rag_memory_updated_at','rag_enrichment_updated_at','enrichment_status','enrichment_error','section_count','memory_card_count','extraction_quality','index_quality_score','index_quality_issues','index_quality_metrics','optional_index_write_issues','indexing_v3_agent_status','indexing_v3_agent_last_error','indexing_v3_agent_repair_reason','indexing_v3_agent_updated_at','completion_gate_missing','embedding_model','page_count','ocr_page_count','needs_ocr_page_count','text_character_count','extracted_image_count','searchable_image_count','skipped_image_count','skipped_image_reasons','image_type_counts','extraction_warnings','document_embedding_field_types','shadow_extraction','extraction_provenance','index_generation_id']))
    or (p_metadata ? 'index_generation_id' and p_metadata->>'index_generation_id' is distinct from p_fence->>'expected_generation_id')
    or (p_state ? 'status' and coalesce(p_state->>'status','') not in ('queued','processing','indexed','failed')) then raise exception 'invalid_ingestion_document_patch'; end if;
  update public.documents set status=case when p_state ? 'status' then p_state->>'status' else status end,
    error_message=case when p_state ? 'error_message' then p_state->>'error_message' else error_message end,
    metadata=public.jsonb_merge_deep(metadata,p_metadata),updated_at=pg_catalog.clock_timestamp() where id=v_document_id;
  return jsonb_build_object('ok',true);
end $$;

alter function public.patch_ingestion_document_state(jsonb, jsonb, jsonb) owner to postgres;
revoke all on function public.patch_ingestion_document_state(jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.patch_ingestion_document_state(jsonb, jsonb, jsonb) to service_role;
