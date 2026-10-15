-- Proposed function-only migration. The apply_migration tool owns one atomic transaction.
-- Exact live pg_get_functiondef SHA-256 supplied by the hosted preimage readback:
-- 0572fa30fe908128e6f452d207d965eac1c6d9657546f27c1cd084c2c10460d5
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $preimage_guard$
declare
  v_oid oid := to_regprocedure('public.repair_enrichment_quality_batch(integer)')::oid;
  v_hash text;
  v_proc pg_proc%rowtype;
begin
  if current_user <> 'postgres' then
    raise exception 'repair_quality_expected_postgres_role';
  end if;
  if v_oid is null then
    raise exception 'repair_quality_function_missing';
  end if;
  select * into strict v_proc from pg_proc where oid = v_oid;
  v_hash := encode(extensions.digest(convert_to(pg_get_functiondef(v_oid), 'UTF8'), 'sha256'), 'hex');
  if v_hash is distinct from '0572fa30fe908128e6f452d207d965eac1c6d9657546f27c1cd084c2c10460d5' then
    raise exception 'repair_quality_live_definition_mismatch: %', v_hash;
  end if;
  if pg_get_userbyid(v_proc.proowner) <> 'postgres'
     or not v_proc.prosecdef
     or v_proc.prorettype <> 'jsonb'::regtype
     or v_proc.proconfig is distinct from array['search_path=public, extensions, pg_temp']::text[] then
    raise exception 'repair_quality_function_contract_mismatch';
  end if;
  create temporary table repair_quality_preimage on commit drop as
    select oid, proowner, proacl, prosecdef, proconfig, prorettype
    from pg_proc where oid = v_oid;
end;
$preimage_guard$;

CREATE OR REPLACE FUNCTION public.repair_enrichment_quality_batch(p_limit integer DEFAULT 25)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 25), 100));
  v_result jsonb;
begin
  with candidate_docs as (
    select d.id as document_id, d.owner_id, d.title
    from public.documents d
    left join public.document_index_quality q on q.document_id = d.id
    where d.status = 'indexed'
      and not exists (
        select 1
        from ingestion_generation_evidence.candidates owned
        where owned.document_id = d.id
          and owned.generation_id = d.index_generation_id
      )
      and (
        q.document_id is null
        or q.extraction_quality in ('partial','poor','unknown')
        or not exists (select 1 from public.document_embedding_fields e where e.document_id = d.id and e.field_type = 'document_title')
      )
    order by d.updated_at asc nulls first
    limit v_limit
  ),
  doc_avg_embedding as (
    select c.document_id,
           avg(ch.embedding) as avg_embedding,
           (array_agg(ch.id order by ch.chunk_index asc))[1] as sample_chunk_id
    from candidate_docs c
    join public.document_chunks ch on ch.document_id = c.document_id
    where ch.embedding is not null
    group by c.document_id
  ),
  ensured_summary as (
    insert into public.document_summaries (id, document_id, owner_id, summary, clinical_specifics, source_chunk_ids, source_image_ids, model, metadata)
    select gen_random_uuid(), c.document_id, c.owner_id,
           left(coalesce((select string_agg(left(ch.content, 300), E'\n\n' order by ch.chunk_index) from (select * from public.document_chunks ch where ch.document_id = c.document_id order by ch.chunk_index limit 3) ch), c.title, 'Document summary unavailable'), 3000),
           '{}'::jsonb,
           coalesce((select array_agg(ch.id order by ch.chunk_index) from (select * from public.document_chunks ch where ch.document_id = c.document_id order by ch.chunk_index limit 5) ch), '{}'::uuid[]),
           '{}'::uuid[],
           'deterministic-repair-v1',
           jsonb_build_object('repair_source','db_repair','anchored',true)
    from candidate_docs c
    where not exists (select 1 from public.document_summaries s where s.document_id = c.document_id)
    returning document_id
  ),
  ensured_sections as (
    insert into public.document_sections (id, document_id, owner_id, section_index, heading, heading_path, page_start, page_end, chunk_ids, summary, tags, extraction_quality, metadata)
    select gen_random_uuid(), c.document_id, c.owner_id, 1,
           coalesce(nullif(trim((select ch.section_heading from public.document_chunks ch where ch.document_id = c.document_id order by ch.chunk_index asc limit 1)), ''), 'Main Section'),
           coalesce((select ch.section_path from public.document_chunks ch where ch.document_id = c.document_id order by ch.chunk_index asc limit 1), array['Main Section']::text[]),
           coalesce((select min(ch.page_number) from public.document_chunks ch where ch.document_id = c.document_id), 1),
           coalesce((select max(ch.page_number) from public.document_chunks ch where ch.document_id = c.document_id), 1),
           coalesce((select array_agg(ch.id order by ch.chunk_index) from public.document_chunks ch where ch.document_id = c.document_id), '{}'::uuid[]),
           left(coalesce((select summary from public.document_summaries s where s.document_id = c.document_id limit 1), c.title, 'Section summary unavailable'), 3000),
           array['repair_generated']::text[], 'partial', jsonb_build_object('repair_source','db_repair','anchored',true)
    from candidate_docs c
    where not exists (select 1 from public.document_sections s where s.document_id = c.document_id)
    returning document_id
  ),
  ensured_memory_cards as (
    insert into public.document_memory_cards (id, document_id, owner_id, section_id, card_type, title, content, normalized_terms, page_number, source_chunk_ids, source_image_ids, confidence, metadata, embedding)
    select gen_random_uuid(), s.document_id, s.owner_id, s.id, 'section_summary',
           left(coalesce(nullif(trim(s.heading),''), 'Section Memory'), 200), left(s.summary, 4000),
           array_remove(regexp_split_to_array(lower(coalesce(s.heading,'')), '\\W+'), '')::text[],
           coalesce(s.page_start, 1), coalesce(s.chunk_ids, '{}'::uuid[]), '{}'::uuid[], 0.70,
           jsonb_build_object('repair_source','db_repair','anchored',true,'from','document_sections.summary'),
           coalesce((select ch.embedding from public.document_chunks ch where ch.id = any(s.chunk_ids) and ch.embedding is not null order by ch.chunk_index asc limit 1), dae.avg_embedding)
    from public.document_sections s
    join candidate_docs c on c.document_id = s.document_id
    left join doc_avg_embedding dae on dae.document_id = s.document_id
    where not exists (select 1 from public.document_memory_cards mc where mc.document_id = s.document_id)
      and length(trim(coalesce(s.summary,''))) > 0
      and coalesce((select ch.embedding from public.document_chunks ch where ch.id = any(s.chunk_ids) and ch.embedding is not null order by ch.chunk_index asc limit 1), dae.avg_embedding) is not null
    returning document_id
  ),
  ensured_title_embedding as (
    insert into public.document_embedding_fields (id, owner_id, document_id, source_chunk_id, field_type, content, embedding, metadata, content_hash)
    select gen_random_uuid(), c.owner_id, c.document_id, dae.sample_chunk_id, 'document_title',
           left(coalesce(nullif(trim(c.title),''), 'Untitled document'), 2000), dae.avg_embedding,
           jsonb_build_object('repair_source','db_repair','anchored',true,'derived_embedding','avg_chunk_embedding'),
           encode(digest(coalesce(c.title,'Untitled document'),'sha256'),'hex')
    from candidate_docs c
    join doc_avg_embedding dae on dae.document_id = c.document_id
    where not exists (select 1 from public.document_embedding_fields e where e.document_id = c.document_id and e.field_type = 'document_title')
    returning document_id
  ),
  ensured_summary_embedding as (
    insert into public.document_embedding_fields (id, owner_id, document_id, source_chunk_id, field_type, content, embedding, metadata, content_hash)
    select gen_random_uuid(), c.owner_id, c.document_id, dae.sample_chunk_id, 'document_summary',
           left(coalesce((select s.summary from public.document_summaries s where s.document_id = c.document_id limit 1), c.title, 'Document summary unavailable'), 4000),
           dae.avg_embedding,
           jsonb_build_object('repair_source','db_repair','anchored',true,'derived_embedding','avg_chunk_embedding'),
           encode(digest(coalesce((select s.summary from public.document_summaries s where s.document_id = c.document_id limit 1), c.title, 'Document summary unavailable'),'sha256'),'hex')
    from candidate_docs c
    join doc_avg_embedding dae on dae.document_id = c.document_id
    where not exists (select 1 from public.document_embedding_fields e where e.document_id = c.document_id and e.field_type = 'document_summary')
    returning document_id
  ),
  ensured_index_units_section as (
    insert into public.document_index_units (id, owner_id, document_id, unit_type, source_chunk_id, source_image_id, page_start, page_end, heading_path, title, content, normalized_terms, source_span, quality_score, extraction_mode, embedding, metadata)
    select gen_random_uuid(), c.owner_id, s.document_id, 'section_summary',
           (select ch.id from public.document_chunks ch where ch.id = any(s.chunk_ids) order by ch.chunk_index asc limit 1),
           null, s.page_start, s.page_end, coalesce(s.heading_path, array[s.heading]::text[]),
           left(coalesce(nullif(trim(s.heading),''), 'Section summary'), 200), left(s.summary, 4000),
           array_remove(regexp_split_to_array(lower(coalesce(s.heading,'')), '\\W+'), '')::text[],
           jsonb_build_object('anchor','section','section_id',s.id,'chunk_ids',s.chunk_ids),
           0.72, 'deterministic',
           coalesce((select ch.embedding from public.document_chunks ch where ch.id = any(s.chunk_ids) and ch.embedding is not null order by ch.chunk_index asc limit 1), dae.avg_embedding),
           jsonb_build_object('repair_source','db_repair','anchored',true,'unit_origin','section_summary')
    from public.document_sections s
    join candidate_docs c on c.document_id = s.document_id
    left join doc_avg_embedding dae on dae.document_id = s.document_id
    where length(trim(coalesce(s.summary,''))) > 0
      and coalesce((select ch.embedding from public.document_chunks ch where ch.id = any(s.chunk_ids) and ch.embedding is not null order by ch.chunk_index asc limit 1), dae.avg_embedding) is not null
      and not exists (select 1 from public.document_index_units u where u.document_id = s.document_id and u.unit_type = 'section_summary')
    returning document_id
  ),
  ensured_index_units_table as (
    insert into public.document_index_units (id, owner_id, document_id, unit_type, source_chunk_id, source_image_id, page_start, page_end, heading_path, title, content, normalized_terms, source_span, quality_score, extraction_mode, embedding, metadata)
    select gen_random_uuid(), tf.owner_id, tf.document_id, 'table_fact', tf.source_chunk_id, tf.source_image_id,
           tf.page_number, tf.page_number, array[coalesce(tf.table_title,'Table')]::text[],
           left(coalesce(tf.table_title, 'Table fact'), 200),
           left(concat_ws(' | ', nullif(tf.row_label,''), nullif(tf.clinical_parameter,''), nullif(tf.threshold_value,''), nullif(tf.action,'')), 4000),
           coalesce(tf.normalized_terms, '{}'::text[]),
           jsonb_build_object('anchor','table_fact','table_fact_id',tf.id,'page',tf.page_number,'source_image_id',tf.source_image_id),
           0.78, 'hybrid',
           coalesce((select ch.embedding from public.document_chunks ch where ch.id = tf.source_chunk_id and ch.embedding is not null), dae.avg_embedding),
           jsonb_build_object('repair_source','db_repair','anchored',true,'unit_origin','table_fact')
    from public.document_table_facts tf
    join candidate_docs c on c.document_id = tf.document_id
    left join doc_avg_embedding dae on dae.document_id = tf.document_id
    where length(trim(concat_ws(' ', nullif(tf.row_label,''), nullif(tf.clinical_parameter,''), nullif(tf.threshold_value,''), nullif(tf.action,'')))) > 0
      and coalesce((select ch.embedding from public.document_chunks ch where ch.id = tf.source_chunk_id and ch.embedding is not null), dae.avg_embedding) is not null
      and not exists (
        select 1 from public.document_index_units u
        where u.document_id = tf.document_id and u.unit_type = 'table_fact' and u.source_span ->> 'table_fact_id' = tf.id::text
      )
    returning document_id
  ),
  ensured_index_units_questions as (
    insert into public.document_index_units (id, owner_id, document_id, unit_type, source_chunk_id, source_image_id, page_start, page_end, heading_path, title, content, normalized_terms, source_span, quality_score, extraction_mode, embedding, metadata)
    select gen_random_uuid(), c.owner_id, ch.document_id, 'askable_question', ch.id, null, ch.page_number, ch.page_number,
           coalesce(ch.section_path, array[coalesce(ch.section_heading,'Section')]::text[]), 'Askable question',
           left(regexp_replace(ch.content, E'\\s+', ' ', 'g'), 4000),
           array_remove(regexp_split_to_array(lower(coalesce(ch.section_heading,'')), '\\W+'), '')::text[],
           jsonb_build_object('anchor','chunk','chunk_id',ch.id,'page',ch.page_number), 0.66, 'deterministic', ch.embedding,
           jsonb_build_object('repair_source','db_repair','anchored',true,'unit_origin','question_like_chunk')
    from candidate_docs c
    join lateral (
      select ch.* from public.document_chunks ch
      where ch.document_id = c.document_id and ch.embedding is not null and ch.content ~* '\\?'
      order by ch.chunk_index asc limit 2
    ) ch on true
    where not exists (select 1 from public.document_index_units u where u.document_id = ch.document_id and u.unit_type = 'askable_question' and u.source_chunk_id = ch.id)
    returning document_id
  ),
  gate as (
    select c.document_id,
           exists (select 1 from public.document_memory_cards mc where mc.document_id = c.document_id) as has_memory,
           exists (select 1 from public.document_sections s where s.document_id = c.document_id) as has_sections,
           exists (select 1 from public.document_embedding_fields e where e.document_id = c.document_id and e.field_type = 'document_title') as has_title_emb,
           exists (select 1 from public.document_embedding_fields e where e.document_id = c.document_id and e.field_type = 'document_summary') as has_summary_emb,
           exists (select 1 from public.document_index_units u where u.document_id = c.document_id and u.unit_type in ('section_summary','clinical_fact','threshold','workflow_step','medication_monitoring','askable_question','table_fact','alias','vocabulary_term')) as has_canonical_units
    from candidate_docs c
  ),
  upsert_quality as (
    insert into public.document_index_quality (document_id, owner_id, quality_score, extraction_quality, metrics, issues, updated_at, retrievable_visual_hit, typed_unit_coverage, anchor_coverage, source_span_coverage, model_fallback_rate, noisy_unit_rate)
    select g.document_id, d.owner_id,
           case when g.has_memory and g.has_sections and g.has_title_emb and g.has_summary_emb and g.has_canonical_units then 0.84 else 0.68 end,
           case when g.has_memory and g.has_sections and g.has_title_emb and g.has_summary_emb and g.has_canonical_units then 'good' else 'partial' end,
           jsonb_build_object('memory_cards', g.has_memory, 'sections', g.has_sections, 'title_embedding', g.has_title_emb, 'summary_embedding', g.has_summary_emb, 'canonical_units', g.has_canonical_units, 'quality_gate','db_repair_v1'),
           array_remove(array[
             case when not g.has_memory then 'no memory cards' end,
             case when not g.has_sections then 'no structured sections' end,
             case when not g.has_title_emb then 'missing document title embedding' end,
             case when not g.has_summary_emb then 'missing document summary embedding' end,
             case when not g.has_canonical_units then 'missing canonical index units' end
           ]::text[], null),
           now(), false,
           case when g.has_canonical_units then 1.0 else 0.0 end,
           case when g.has_sections then 1.0 else 0.0 end,
           case when g.has_canonical_units then 1.0 else 0.0 end,
           0.0, 0.0
    from gate g join public.documents d on d.id = g.document_id
    on conflict (document_id) do update set
      quality_score = excluded.quality_score,
      extraction_quality = excluded.extraction_quality,
      metrics = excluded.metrics,
      issues = excluded.issues,
      updated_at = excluded.updated_at,
      retrievable_visual_hit = excluded.retrievable_visual_hit,
      typed_unit_coverage = excluded.typed_unit_coverage,
      anchor_coverage = excluded.anchor_coverage,
      source_span_coverage = excluded.source_span_coverage,
      model_fallback_rate = excluded.model_fallback_rate,
      noisy_unit_rate = excluded.noisy_unit_rate
    returning document_id, extraction_quality
  ),
  defer_jobs as (
    update public.ingestion_jobs j
    set status = case when q.extraction_quality = 'good' then j.status else 'pending' end,
        stage = case when q.extraction_quality = 'good' then 'indexed + enrichment backfill v3' else 'indexed; enrichment deferred' end,
        error_message = case when q.extraction_quality = 'good' then null else 'quality gate: missing required enrichment artifacts' end,
        updated_at = now(),
        next_run_at = case when q.extraction_quality = 'good' then j.next_run_at else now() + interval '10 minutes' end
    from (select uq.document_id, uq.extraction_quality from upsert_quality uq) q
    where j.id = (select j2.id from public.ingestion_jobs j2 where j2.document_id = q.document_id order by j2.created_at desc limit 1)
    returning j.document_id
  )
  select jsonb_build_object(
    'processed_docs', (select count(*) from candidate_docs),
    'summaries_inserted', (select count(*) from ensured_summary),
    'sections_inserted', (select count(*) from ensured_sections),
    'memory_cards_inserted', (select count(*) from ensured_memory_cards),
    'title_embeddings_inserted', (select count(*) from ensured_title_embedding),
    'summary_embeddings_inserted', (select count(*) from ensured_summary_embedding),
    'section_units_inserted', (select count(*) from ensured_index_units_section),
    'table_units_inserted', (select count(*) from ensured_index_units_table),
    'question_units_inserted', (select count(*) from ensured_index_units_questions),
    'quality_rows_upserted', (select count(*) from upsert_quality),
    'jobs_gated', (select count(*) from defer_jobs),
    'good_after_gate', (select count(*) from upsert_quality where extraction_quality = 'good'),
    'partial_after_gate', (select count(*) from upsert_quality where extraction_quality <> 'good')
  ) into v_result;

  return v_result;
end;
$function$;

do $postimage_guard$
declare
  v_before record;
  v_after pg_proc%rowtype;
begin
  select * into strict v_before from pg_temp.repair_quality_preimage;
  select * into strict v_after from pg_proc
    where oid = to_regprocedure('public.repair_enrichment_quality_batch(integer)')::oid;
  if v_after.oid is distinct from v_before.oid
     or v_after.proowner is distinct from v_before.proowner
     or v_after.proacl is distinct from v_before.proacl
     or v_after.prosecdef is distinct from v_before.prosecdef
     or v_after.proconfig is distinct from v_before.proconfig
     or v_after.prorettype is distinct from v_before.prorettype then
    raise exception 'repair_quality_signature_owner_acl_or_security_changed';
  end if;
end;
$postimage_guard$;

