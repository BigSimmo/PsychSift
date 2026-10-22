-- Merge only after the owner's explicit yes to this database change.
-- Operator rollback of a document's committed index generation pointer (scripts/reindex-rollback.ts).
--
-- commit_document_index_generation moves documents.metadata.index_generation_id to the new
-- generation, and the documents_prune_superseded_index_generations trigger (20261019155200)
-- keeps that generation and the one it replaced. This function moves the pointer back to a
-- retained, previously committed generation. It refuses unless:
--   * the pointer still equals p_expected_generation (no commit raced the operator),
--   * no ingestion job for the document is pending or processing,
--   * the target generation was committed (it has typed document_pages rows, which only a
--     generation commit inserts), and
--   * the target generation still has at least one chunk.
-- Moving the pointer fires the same prune trigger with keep = {target, current}, so the
-- generation being rolled back from is retained and the rollback can itself be reversed.

set local lock_timeout = '5s';
set local statement_timeout = '30s';

create function public.rollback_document_index_generation(
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
  select count(*) into v_image_count from public.document_images
   where document_id = p_document_id and index_generation_id = p_target_generation and searchable;

  update public.documents
     set metadata = metadata || jsonb_build_object(
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
    'chunk_count', v_chunk_count, 'image_count', v_image_count, 'page_count', v_page_count);
end;
$$;

alter function public.rollback_document_index_generation(uuid, uuid, uuid) owner to postgres;
revoke all on function public.rollback_document_index_generation(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.rollback_document_index_generation(uuid, uuid, uuid) to service_role;
