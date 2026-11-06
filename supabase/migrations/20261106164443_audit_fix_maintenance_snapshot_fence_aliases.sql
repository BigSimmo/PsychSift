-- Correct the snapshot fences in replace_document_maintenance_artifacts (20261105144251).
-- Its `unnest(...) id ... x.id=id` checks resolved the bare `id` to the inner table's own
-- column, so the label, summary-source and visual image generation fences were always
-- satisfied. Alias the unnest as s(id) and compare against s.id. Body otherwise unchanged.
-- Draft only. Applying/merging this migration requires the owner's own database approval.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create or replace function public.replace_document_maintenance_artifacts(
  p_document_id uuid, p_owner_id uuid, p_expected_updated_at timestamptz,
  p_expected_generation_id uuid, p_operation text, p_payload jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  d public.documents; item jsonb; patch jsonb; image_ids uuid[]; source_ids uuid[];
  unit public.document_index_units; field public.document_embedding_fields; image public.document_images; summary_row public.document_summaries;
  visual_types text[] := array['visual_summary','flowchart_step','diagram_decision','risk_matrix_cell','medication_chart_row','chart_finding','visual_askable_question','table_threshold'];
begin
  if auth.role() is distinct from 'service_role' then raise exception 'service_role_required' using errcode='42501'; end if;
  if p_expected_updated_at is null or p_operation is null or p_operation not in ('labels','enrichment','visual','images','stamp','embedding-fields','registry')
    or jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'invalid_maintenance_request' using errcode='22023'; end if;
  select * into d from public.documents where id=p_document_id for update;
  if not found or d.owner_id is distinct from p_owner_id or d.updated_at is distinct from p_expected_updated_at
    or d.index_generation_id is distinct from p_expected_generation_id or d.status is distinct from 'indexed' then
    raise exception 'maintenance_snapshot_conflict' using errcode='40001';
  end if;
  if d.metadata ?| array['admission_event_id','public_source_version_id','source_catalogue_key','public_source_activation_event_id'] or d.metadata->>'corpus_scope'='australian_public' then raise exception 'managed_evidence_requires_fenced_worker' using errcode='42501'; end if;
  perform 1 from public.ingestion_jobs where document_id=d.id and status in ('pending','processing') for update;
  if found then raise exception 'maintenance_active_ingestion_job' using errcode='40001'; end if;
  perform 1 from public.indexing_v3_agent_jobs where document_id=d.id and status in ('pending','processing') for update;
  if found then raise exception 'maintenance_active_agent_job' using errcode='40001'; end if;
  patch:=coalesce(p_payload->'metadata_patch','{}'::jsonb);
  if p_operation='registry' then
    if d.file_type is distinct from 'application/vnd.clinical-kb.registry+json'
      or patch->>'source_kind' is distinct from 'registry_record'
      or (patch->>'registry_record_kind' in ('service','form','medication','differential')) is not true
      or d.storage_path is distinct from 'registry://'||(patch->>'registry_record_kind')||'/'||(patch->>'registry_record_id')
      or d.source_path is distinct from 'registry://'||(patch->>'registry_record_kind')||'/'||(patch->>'registry_record_slug')
      or jsonb_typeof(patch) is distinct from 'object' or exists(select 1 from jsonb_object_keys(patch) k where k<>all(array[
        'source_kind','registry_record_kind','registry_record_subkind','registry_record_id','registry_record_slug','source_title',
        'document_status','clinical_validation_status','clinical_validation_evidence','source_role','extraction_quality','publisher','jurisdiction'])) then
      raise exception 'invalid_registry_maintenance_scope' using errcode='22023'; end if;
  else
  if jsonb_typeof(patch) is distinct from 'object' or exists(select 1 from jsonb_object_keys(patch) k
    where k<>all(array['rag_enrichment_version','rag_indexing_version','rag_memory_version','rag_enrichment_updated_at',
      'generated_label_count','organization_profile','organization_profile_version','coverage_profile',
      'enrichment_prompt_strategy','enrichment_prompt_chunk_ids','version_stamped_at',
      'searchable_image_count','skipped_image_count','image_enriched_at'])) then
    raise exception 'invalid_maintenance_metadata_keys' using errcode='22023';
  end if;
  end if;

  if p_operation in ('labels','enrichment') then
    if jsonb_typeof(p_payload->'labels') is distinct from 'array' or jsonb_array_length(p_payload->'labels')>5000 then
      raise exception 'invalid_maintenance_labels' using errcode='22023'; end if;
    for item in select value from jsonb_array_elements(p_payload->'labels') loop
      if jsonb_typeof(item) is distinct from 'object' or nullif(btrim(item->>'label'),'') is null
        or jsonb_typeof(item->'metadata') is distinct from 'object' then raise exception 'invalid_maintenance_label' using errcode='22023'; end if;
    end loop;
    -- The delete and all replacement inserts share this transaction; insert failure restores A.
    delete from public.document_labels where document_id=d.id and source='generated';
    insert into public.document_labels(document_id,owner_id,label,label_type,source,confidence,metadata)
      select d.id,d.owner_id,r.label,r.label_type,'generated',r.confidence,r.metadata
      from jsonb_to_recordset(p_payload->'labels') r(label text,label_type text,confidence real,metadata jsonb);
  end if;
  if p_operation='registry' then
    if jsonb_typeof(p_payload->'label_ids_to_delete') is distinct from 'array' or jsonb_typeof(p_payload->'labels_to_upsert') is distinct from 'array'
      or jsonb_array_length(p_payload->'label_ids_to_delete')>5000 or jsonb_array_length(p_payload->'labels_to_upsert')>5000 then
      raise exception 'invalid_registry_label_population' using errcode='22023'; end if;
    select coalesce(array_agg(value::uuid),'{}'::uuid[]) into source_ids from jsonb_array_elements_text(p_payload->'label_ids_to_delete');
    if exists(select 1 from unnest(source_ids) as s(id) where not exists(select 1 from public.document_labels l where l.id=s.id
      and l.document_id=d.id and l.owner_id is not distinct from d.owner_id and l.source='generated' and l.label_type in ('site','document_intent'))) then
      raise exception 'registry_label_snapshot_conflict' using errcode='40001'; end if;
    for item in select value from jsonb_array_elements(p_payload->'labels_to_upsert') loop
      if item->>'label_type' is distinct from 'document_intent' or item->>'label' is distinct from
        (case patch->>'registry_record_kind' when 'service' then 'operational-process' when 'form' then 'documentation-requirement'
          when 'medication' then 'medication-instruction' when 'differential' then 'decision-support' end)
        or jsonb_typeof(item->'metadata') is distinct from 'object' then
        raise exception 'invalid_registry_intent_label' using errcode='22023'; end if;
    end loop;
    delete from public.document_labels where document_id=d.id and owner_id is not distinct from d.owner_id
      and source='generated' and id=any(source_ids);
    insert into public.document_labels(document_id,owner_id,label,label_type,source,confidence,metadata)
      select d.id,d.owner_id,r.label,'document_intent','generated',r.confidence,r.metadata
      from jsonb_to_recordset(p_payload->'labels_to_upsert') r(label text,confidence real,metadata jsonb)
      on conflict(document_id,label_type,label,source) do update set confidence=excluded.confidence,metadata=excluded.metadata;
  end if;

  if p_operation='enrichment' then
    item:=p_payload->'summary';
    if jsonb_typeof(item) is distinct from 'object' or nullif(btrim(item->>'summary'),'') is null
      or jsonb_typeof(item->'metadata') is distinct from 'object'
      or jsonb_typeof(item->'source_chunk_ids') is distinct from 'array'
      or jsonb_typeof(item->'source_image_ids') is distinct from 'array' then
      raise exception 'invalid_maintenance_summary' using errcode='22023'; end if;
    select coalesce(array_agg(value::uuid),'{}'::uuid[]) into source_ids from jsonb_array_elements_text(item->'source_chunk_ids');
    if exists(select 1 from unnest(source_ids) as s(id) where not exists(select 1 from public.document_chunks c
      where c.id=s.id and c.document_id=d.id and c.index_generation_id is not distinct from p_expected_generation_id)) then
      raise exception 'maintenance_source_generation_conflict' using errcode='40001'; end if;
    select coalesce(array_agg(value::uuid),'{}'::uuid[]) into image_ids from jsonb_array_elements_text(item->'source_image_ids');
    if exists(select 1 from unnest(image_ids) as s(id) where not exists(select 1 from public.document_images i
      where i.id=s.id and i.document_id=d.id and i.index_generation_id is not distinct from p_expected_generation_id)) then
      raise exception 'maintenance_source_generation_conflict' using errcode='40001'; end if;
    insert into public.document_summaries(document_id,owner_id,summary,clinical_specifics,source_chunk_ids,source_image_ids,model,metadata,generated_at,updated_at)
      values(d.id,d.owner_id,item->>'summary',coalesce(item->'clinical_specifics','{}'::jsonb),source_ids,image_ids,item->>'model',item->'metadata',(item->>'generated_at')::timestamptz,(item->>'updated_at')::timestamptz)
      on conflict(document_id) do update set owner_id=excluded.owner_id,summary=excluded.summary,clinical_specifics=excluded.clinical_specifics,
        source_chunk_ids=excluded.source_chunk_ids,source_image_ids=excluded.source_image_ids,model=excluded.model,metadata=excluded.metadata,
        generated_at=excluded.generated_at,updated_at=excluded.updated_at returning * into summary_row;
  end if;

  if p_operation='visual' then
    if jsonb_typeof(p_payload->'image_ids') is distinct from 'array' or jsonb_typeof(p_payload->'units') is distinct from 'array'
      or jsonb_array_length(p_payload->'image_ids')>1000 or jsonb_array_length(p_payload->'units')>10000 then
      raise exception 'invalid_maintenance_visual_population' using errcode='22023'; end if;
    select coalesce(array_agg(value::uuid),'{}'::uuid[]) into image_ids from jsonb_array_elements_text(p_payload->'image_ids');
    if exists(select 1 from unnest(image_ids) as s(id) where not exists(select 1 from public.document_images i
      where i.id=s.id and i.document_id=d.id and i.index_generation_id is not distinct from p_expected_generation_id)) then
      raise exception 'maintenance_source_generation_conflict' using errcode='40001'; end if;
    -- Validate the complete packet before replacing anything. Row/table constraints are still authoritative.
    for item in select value from jsonb_array_elements(p_payload->'units') loop
      unit:=jsonb_populate_record(null::public.document_index_units,item);
      if unit.document_id is distinct from d.id or unit.owner_id is distinct from d.owner_id
        or unit.index_generation_id is distinct from p_expected_generation_id or unit.source_image_id is null
        or not(unit.source_image_id=any(image_ids)) or unit.unit_type is null or not(unit.unit_type=any(visual_types)) then
        raise exception 'invalid_maintenance_visual_identity' using errcode='22023'; end if;
      if unit.source_chunk_id is not null and not exists(select 1 from public.document_chunks c where c.id=unit.source_chunk_id
        and c.document_id=d.id and c.index_generation_id is not distinct from p_expected_generation_id) then
        raise exception 'maintenance_source_generation_conflict' using errcode='40001'; end if;
    end loop;
    delete from public.document_index_units where document_id=d.id and index_generation_id is not distinct from p_expected_generation_id
      and source_image_id=any(image_ids) and unit_type=any(visual_types);
    for item in select value from jsonb_array_elements(p_payload->'units') loop
      unit:=jsonb_populate_record(null::public.document_index_units,item);
      insert into public.document_index_units(owner_id,document_id,unit_type,source_chunk_id,source_image_id,page_start,page_end,
        heading_path,title,content,normalized_terms,source_span,quality_score,extraction_mode,index_generation_id,embedding,metadata)
      values(d.owner_id,d.id,unit.unit_type,unit.source_chunk_id,unit.source_image_id,unit.page_start,unit.page_end,
        coalesce(unit.heading_path,'{}'),unit.title,unit.content,coalesce(unit.normalized_terms,'{}'),unit.source_span,
        coalesce(unit.quality_score,0.7),coalesce(unit.extraction_mode,'deterministic'),p_expected_generation_id,unit.embedding,coalesce(unit.metadata,'{}'));
    end loop;
  end if;

  if p_operation in ('visual','images') then
    if jsonb_typeof(p_payload->'image_patches') is distinct from 'array' or jsonb_array_length(p_payload->'image_patches')>1000 then
      raise exception 'invalid_maintenance_image_population' using errcode='22023'; end if;
    for item in select value from jsonb_array_elements(p_payload->'image_patches') loop
      select * into image from public.document_images i where i.id=(item->>'id')::uuid and i.document_id=d.id
        and i.index_generation_id is not distinct from p_expected_generation_id for update;
      if not found or (p_operation='visual' and not(image.id=any(image_ids))) then
        raise exception 'maintenance_source_generation_conflict' using errcode='40001'; end if;
      if jsonb_typeof(item) is distinct from 'object' or exists(select 1 from jsonb_object_keys(item) k where k<>all(array[
        'id','metadata','caption','image_type','searchable','clinical_relevance_score','skip_reason','image_hash','perceptual_hash','labels']))
        or (item ? 'metadata' and jsonb_typeof(item->'metadata') is distinct from 'object') then
        raise exception 'invalid_maintenance_image_patch' using errcode='22023'; end if;
      image:=jsonb_populate_record(image,item-'id'-'metadata');
      update public.document_images set caption=image.caption,image_type=image.image_type,searchable=image.searchable,
        clinical_relevance_score=image.clinical_relevance_score,skip_reason=image.skip_reason,image_hash=image.image_hash,
        perceptual_hash=image.perceptual_hash,labels=image.labels,metadata=coalesce(metadata,'{}')||coalesce(item->'metadata','{}')
        where id=image.id;
    end loop;
  end if;
  if p_operation='embedding-fields' then
    if jsonb_typeof(p_payload->'fields') is distinct from 'array' or jsonb_array_length(p_payload->'fields')>1000 then
      raise exception 'invalid_maintenance_embedding_fields' using errcode='22023'; end if;
    for item in select value from jsonb_array_elements(p_payload->'fields') loop
      field:=jsonb_populate_record(null::public.document_embedding_fields,item);
      if field.document_id is distinct from d.id or field.owner_id is distinct from d.owner_id or field.source_chunk_id is null
        or field.field_type not in ('document_title','document_summary') or not exists(select 1 from public.document_chunks c
          where c.id=field.source_chunk_id and c.document_id=d.id and c.index_generation_id is not distinct from p_expected_generation_id) then
        raise exception 'maintenance_source_generation_conflict' using errcode='40001'; end if;
      insert into public.document_embedding_fields(owner_id,document_id,source_chunk_id,field_type,content,content_hash,embedding,index_generation_id,metadata)
        values(d.owner_id,d.id,field.source_chunk_id,field.field_type,field.content,field.content_hash,field.embedding,p_expected_generation_id,
          coalesce(field.metadata,'{}')||jsonb_build_object('index_generation_id',p_expected_generation_id));
    end loop;
  end if;

  if p_operation='stamp' then
    update public.document_summaries set metadata=coalesce(metadata,'{}')||patch where document_id=d.id;
    update public.document_labels set metadata=coalesce(metadata,'{}')||patch where document_id=d.id and source='generated';
  end if;
  if p_operation='images' and (jsonb_typeof(p_payload->'image_count') is distinct from 'number'
    or (p_payload->>'image_count')::numeric < 0 or (p_payload->>'image_count')::numeric<>trunc((p_payload->>'image_count')::numeric)) then
    raise exception 'invalid_maintenance_image_count' using errcode='22023'; end if;
  update public.documents set metadata=coalesce(metadata,'{}')||patch,
    image_count=case when p_operation='images' then (p_payload->>'image_count')::integer else image_count end
    where id=d.id returning * into d;
  return jsonb_build_object('updated_at',d.updated_at,'metadata',d.metadata,'summary',to_jsonb(summary_row));
end $$;
alter function public.replace_document_maintenance_artifacts(uuid,uuid,timestamptz,uuid,text,jsonb) owner to postgres;
revoke all on function public.replace_document_maintenance_artifacts(uuid,uuid,timestamptz,uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.replace_document_maintenance_artifacts(uuid,uuid,timestamptz,uuid,text,jsonb) to service_role;
