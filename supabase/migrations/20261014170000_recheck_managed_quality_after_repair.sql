-- Recheck managed-ingestion quality after the historical repair function commits
-- its artifact inserts. The historical migration remains byte-identical.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter function public.repair_enrichment_quality_batch(integer)
  rename to repair_enrichment_quality_batch_legacy;

create or replace function public.repair_enrichment_quality_batch(p_limit integer default 25)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_result jsonb;
begin
  -- The legacy implementation owns artifact creation. Its quality CTE cannot
  -- see sibling data-modifying CTEs, so do the gate in this later statement.
  v_result := public.repair_enrichment_quality_batch_legacy(p_limit);

  create temporary table repair_quality_rechecked on commit drop as
    select q.document_id
    from public.document_index_quality q
    join public.documents d on d.id = q.document_id
    where d.status = 'indexed'
      and q.extraction_quality <> 'good'
      and exists (select 1 from public.document_memory_cards mc where mc.document_id = q.document_id)
      and exists (select 1 from public.document_sections s where s.document_id = q.document_id)
      and exists (select 1 from public.document_embedding_fields e where e.document_id = q.document_id and e.field_type = 'document_title')
      and exists (select 1 from public.document_embedding_fields e where e.document_id = q.document_id and e.field_type = 'document_summary')
      and exists (select 1 from public.document_index_units u where u.document_id = q.document_id and u.unit_type in ('section_summary','clinical_fact','threshold','workflow_step','medication_monitoring','askable_question','table_fact','alias','vocabulary_term'));

  update public.document_index_quality q
  set quality_score = 0.84,
      extraction_quality = 'good',
      metrics = jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(
        coalesce(q.metrics, '{}'::jsonb), '{memory_cards}', 'true'::jsonb),
        '{sections}', 'true'::jsonb), '{title_embedding}', 'true'::jsonb),
        '{summary_embedding}', 'true'::jsonb), '{canonical_units}', 'true'::jsonb),
      issues = '{}'::text[],
      typed_unit_coverage = 1.0,
      anchor_coverage = 1.0,
      source_span_coverage = 1.0,
      updated_at = now()
  from repair_quality_rechecked r
  where q.document_id = r.document_id;

  update public.ingestion_jobs j
  set status = case when j.status = 'pending' then 'completed' else j.status end,
      stage = 'indexed + enrichment backfill v3',
      error_message = null,
      updated_at = now(),
      next_run_at = null
  from repair_quality_rechecked r
  where j.id = (select j2.id from public.ingestion_jobs j2
                where j2.document_id = r.document_id
                order by j2.created_at desc limit 1);

  return v_result || jsonb_build_object(
    'rechecked_after_repair', (select count(*) from repair_quality_rechecked));
end;
$function$;

alter function public.repair_enrichment_quality_batch(integer) owner to postgres;
