-- Draft only. Applying/merging this migration requires the owner's own database approval.
-- Existing source identities only; no backend admission, scanner or supplier authority is minted.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create function public.enqueue_import_document(
  p_document_id uuid, p_owner_id uuid, p_content_hash text, p_batch_id uuid,
  p_force boolean, p_max_attempts integer
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare d public.documents; j public.ingestion_jobs;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'service_role_required' using errcode='42501'; end if;
  if p_owner_id is null or p_content_hash is null or p_content_hash = '' or p_force is null
    or p_max_attempts is null or p_max_attempts not between 1 and 100 then
    raise exception 'invalid_import_queue_request' using errcode='22023';
  end if;
  select * into d from public.documents where id=p_document_id for update;
  if not found or d.owner_id is distinct from p_owner_id or d.content_hash is distinct from p_content_hash then
    raise exception 'import_document_identity_conflict' using errcode='40001';
  end if;
  perform 1 from public.import_batches where id=p_batch_id and owner_id=p_owner_id for share;
  if not found then raise exception 'import_batch_owner_conflict' using errcode='40001'; end if;
  select * into j from public.ingestion_jobs where document_id=d.id and status in ('pending','processing') order by id limit 1 for update;
  if found then return jsonb_build_object('outcome','already_active','job_id',j.id); end if;
  perform 1 from public.indexing_v3_agent_jobs where document_id=d.id and status in ('pending','processing') for update;
  if found then raise exception 'maintenance_active_agent_job' using errcode='40001'; end if;
  if d.status='indexed' and not p_force then return jsonb_build_object('outcome','skipped'); end if;
  -- Generation A and its counters remain usable until a fenced worker promotes B.
  insert into public.ingestion_jobs(document_id,batch_id,status,stage,progress,max_attempts)
    values(d.id,p_batch_id,'pending','queued',0,p_max_attempts) returning * into j;
  update public.documents set status=case when d.status='indexed' then d.status else 'queued' end,
    error_message=null where id=d.id;
  return jsonb_build_object('outcome','enqueued','job_id',j.id);
end $$;
alter function public.enqueue_import_document(uuid,uuid,text,uuid,boolean,integer) owner to postgres;
revoke all on function public.enqueue_import_document(uuid,uuid,text,uuid,boolean,integer) from public,anon,authenticated,service_role;
grant execute on function public.enqueue_import_document(uuid,uuid,text,uuid,boolean,integer) to service_role;

-- One transaction replaces only the current public projection. Generation-retained evidence is
-- never a maintenance target. Managed documents continue through their existing fenced worker.
create function public.replace_document_maintenance_artifacts(
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

-- Snapshot-fenced legacy local producer commit. Current-generation cleanup only; retained
-- generations remain available to rollback. The fenced worker overload is unchanged.
create function public.commit_document_maintenance_deep_memory(
  p_document_id uuid,
  p_owner_id uuid,
  p_expected_updated_at timestamptz,
  p_expected_generation_id uuid,
  p_chunk_patches jsonb,
  p_aliases jsonb,
  p_producer text,
  p_artifact_generation_id uuid,
  p_rag_memory_version text,
  p_document_intelligence_version text,
  p_section_count integer,
  p_memory_card_count integer,
  p_index_unit_counts_by_type jsonb,
  p_repaired_anchor_count integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_document_metadata jsonb;
  v_document_updated_at timestamptz;
  v_chunk_patch jsonb;
  v_chunk_count integer;
  v_live_document public.documents;
  v_document_owner_id uuid;
  v_committed_index_generation uuid;
  v_total_section_count integer;
  v_total_memory_card_count integer;
  v_total_index_unit_count integer;
  v_section_count integer;
  v_memory_card_count integer;
  v_index_unit_count integer;
  v_expected_index_unit_count integer;
  v_index_unit_counts_by_type jsonb;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'service_role_required' using errcode='42501'; end if;
  if p_producer is distinct from 'local-worker' then raise exception 'maintenance_local_producer_required' using errcode='42501'; end if;
  if nullif(btrim(p_producer), '') is null
    or nullif(btrim(p_rag_memory_version), '') is null
    or nullif(btrim(p_document_intelligence_version), '') is null
  then
    raise exception 'Deep-memory producer must be non-empty.' using errcode = '22023';
  end if;
  if p_artifact_generation_id is null then
    raise exception 'Deep-memory artifact generation must be set.' using errcode = '22023';
  end if;
  if p_section_count is null or p_memory_card_count is null or p_repaired_anchor_count is null
    or p_section_count < 0 or p_memory_card_count < 0 or p_repaired_anchor_count < 0
  then
    raise exception 'Deep-memory counts cannot be negative.' using errcode = '22023';
  end if;
  if p_index_unit_counts_by_type is null or jsonb_typeof(p_index_unit_counts_by_type) <> 'object' then
    raise exception 'Deep-memory index-unit counts must be an object.' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_each(p_index_unit_counts_by_type) item
    where jsonb_typeof(item.value) <> 'number'
      or (item.value #>> '{}')::numeric < 0
      or trunc((item.value #>> '{}')::numeric) <> (item.value #>> '{}')::numeric
      or (item.value #>> '{}')::numeric > 2147483647
  ) then
    raise exception 'Deep-memory index-unit counts must be nonnegative integers.' using errcode = '22023';
  end if;

  select coalesce(d.metadata, '{}'::jsonb), d.owner_id, d.updated_at
  into v_document_metadata, v_document_owner_id, v_document_updated_at
  from public.documents d
  where d.id = p_document_id
  for update;

  if not found then
    raise exception 'Document % does not exist.', p_document_id using errcode = 'P0002';
  end if;

  perform 1 from public.documents where id=p_document_id and status='indexed';
  if not found then raise exception 'maintenance_snapshot_conflict' using errcode='40001'; end if;
  if p_expected_updated_at is null or v_document_updated_at is distinct from p_expected_updated_at
    or v_document_owner_id is distinct from p_owner_id
    or (nullif(v_document_metadata->>'index_generation_id',''))::uuid is distinct from p_expected_generation_id then
    raise exception 'maintenance_snapshot_conflict' using errcode='40001';
  end if;
  if v_document_metadata ?| array['admission_event_id','public_source_version_id','source_catalogue_key','public_source_activation_event_id'] or v_document_metadata->>'corpus_scope'='australian_public' then raise exception 'managed_evidence_requires_fenced_worker' using errcode='42501'; end if;
  perform 1 from public.ingestion_jobs where document_id=p_document_id and status in ('pending','processing') for update;
  if found then raise exception 'maintenance_active_ingestion_job' using errcode='40001'; end if;
  perform 1 from public.indexing_v3_agent_jobs where document_id=p_document_id and status in ('pending','processing') for update;
  if found then raise exception 'maintenance_active_agent_job' using errcode='40001'; end if;
  -- NULL legacy lineage cannot be assigned to a retained generation without evidence.
  -- Refuse instead of deleting potential rollback rows or publishing duplicate visible rows.
  if exists(select 1 from public.document_sections where document_id=p_document_id and index_generation_id is null)
    or exists(select 1 from public.document_memory_cards where document_id=p_document_id and index_generation_id is null)
    or exists(select 1 from public.document_index_units where document_id=p_document_id and index_generation_id is null) then
    raise exception 'legacy_generation_lineage_requires_fenced_reindex' using errcode='23514';
  end if;
  if jsonb_typeof(p_chunk_patches) is distinct from 'array' then raise exception 'invalid_maintenance_chunk_patches' using errcode='22023'; end if;
  for v_chunk_patch in select value from jsonb_array_elements(p_chunk_patches) loop
    if jsonb_typeof(v_chunk_patch) is distinct from 'object' or jsonb_typeof(v_chunk_patch->'metadata') is distinct from 'object'
      or exists(select 1 from jsonb_object_keys(v_chunk_patch->'metadata') k where k<>all(array[
        'anchor_id','anchor_repaired_by','rag_indexing_version','rag_memory_version','rag_memory_updated_at','document_intelligence_version'])) then
      raise exception 'invalid_maintenance_chunk_patch' using errcode='22023'; end if;
    update public.document_chunks set
      anchor_id=coalesce(anchor_id,v_chunk_patch->>'anchor_id'),
      metadata=coalesce(metadata,'{}')||(v_chunk_patch->'metadata')
      where id=(v_chunk_patch->>'id')::uuid and document_id=p_document_id
        and index_generation_id is not distinct from p_expected_generation_id;
    get diagnostics v_chunk_count=row_count;
    if v_chunk_count<>1 then raise exception 'maintenance_source_generation_conflict' using errcode='40001'; end if;
  end loop;

  begin
    v_committed_index_generation := nullif(v_document_metadata->>'index_generation_id', '')::uuid;
  exception when invalid_text_representation then
    raise exception 'Document % has an invalid committed index generation.', p_document_id using errcode = '22023';
  end;
  if v_committed_index_generation is null then
    raise exception 'Document % has no committed index generation.', p_document_id using errcode = '23514';
  end if;
  if v_committed_index_generation = p_artifact_generation_id then
    raise exception 'Staged deep-memory generation must differ from the committed index generation.' using errcode = '23514';
  end if;

  -- A generation UUID is a single-producer staging boundary. Reject collisions
  -- rather than interpreting another producer's rows as part of this commit.
  if exists (
    select 1 from public.document_sections
    where document_id = p_document_id
      and artifact_generation_id = p_artifact_generation_id
      and producer is distinct from p_producer
  ) or exists (
    select 1 from public.document_memory_cards
    where document_id = p_document_id
      and artifact_generation_id = p_artifact_generation_id
      and producer is distinct from p_producer
  ) or exists (
    select 1 from public.document_index_units
    where document_id = p_document_id
      and artifact_generation_id = p_artifact_generation_id
      and producer is distinct from p_producer
  ) then
    raise exception 'Deep-memory artifact generation belongs to another producer.' using errcode = '23514';
  end if;

  -- Re-check producer evidence inside the transaction. Legacy NULL-generation
  -- local-worker rows predate explicit producer metadata and are the only
  -- unlabelled shape eligible for producer-scoped replacement.
  if exists (
    select 1 from public.document_sections
    where document_id = p_document_id
      and (
        (producer is not null and nullif(metadata->>'generated_by', '') is distinct from producer)
        or (producer is null and nullif(metadata->>'generated_by', '') is not null and metadata->>'generated_by' <> p_producer)
        or (producer is null and artifact_generation_id is not null)
        or (
          producer is null
          and nullif(metadata->>'generated_by', '') is null
          and not (
            p_producer = 'local-worker'
            and artifact_generation_id is null
            and metadata->>'rag_indexing_version' in ('rag-deep-memory-v1', 'rag-deep-memory-v2')
          )
        )
      )
  ) or exists (
    select 1 from public.document_memory_cards
    where document_id = p_document_id
      and (
        (producer is not null and nullif(metadata->>'generated_by', '') is distinct from producer)
        or (producer is null and nullif(metadata->>'generated_by', '') is not null and metadata->>'generated_by' <> p_producer)
        or (producer is null and artifact_generation_id is not null)
        or (
          producer is null
          and nullif(metadata->>'generated_by', '') is null
          and not (p_producer = 'local-worker' and artifact_generation_id is null)
        )
      )
  ) or exists (
    select 1 from public.document_index_units
    where document_id = p_document_id
      and (
        (producer is not null and nullif(metadata->>'generated_by', '') is distinct from producer)
        or (producer is null and nullif(metadata->>'generated_by', '') is not null and metadata->>'generated_by' <> p_producer)
        or (producer is null and artifact_generation_id is not null)
        or (
          producer is null
          and nullif(metadata->>'generated_by', '') is null
          and not (p_producer = 'local-worker' and artifact_generation_id is null)
        )
      )
  ) then
    raise exception 'Deep-memory artifact producer evidence is contradictory or ambiguous.' using errcode = '23514';
  end if;

  select count(*) into v_total_section_count
  from public.document_sections
  where document_id = p_document_id
    and artifact_generation_id = p_artifact_generation_id;

  select count(*) into v_total_memory_card_count
  from public.document_memory_cards
  where document_id = p_document_id
    and artifact_generation_id = p_artifact_generation_id;

  select count(*) into v_total_index_unit_count
  from public.document_index_units
  where document_id = p_document_id
    and artifact_generation_id = p_artifact_generation_id;

  select count(*) into v_section_count
  from public.document_sections
  where document_id = p_document_id
    and producer = p_producer
    and artifact_generation_id = p_artifact_generation_id
    and index_generation_id = p_artifact_generation_id
    and owner_id is not distinct from v_document_owner_id
    and metadata->>'generated_by' = p_producer
    and metadata->>'artifact_generation_id' = p_artifact_generation_id::text
    and metadata->>'index_generation_id' = p_artifact_generation_id::text;

  select count(*) into v_memory_card_count
  from public.document_memory_cards
  where document_id = p_document_id
    and producer = p_producer
    and artifact_generation_id = p_artifact_generation_id
    and index_generation_id = p_artifact_generation_id
    and owner_id is not distinct from v_document_owner_id
    and metadata->>'generated_by' = p_producer
    and metadata->>'artifact_generation_id' = p_artifact_generation_id::text
    and metadata->>'index_generation_id' = p_artifact_generation_id::text;

  select coalesce(sum(unit_count), 0)::integer, coalesce(jsonb_object_agg(unit_type, unit_count), '{}'::jsonb)
  into v_index_unit_count, v_index_unit_counts_by_type
  from (
    select unit_type, count(*)::integer as unit_count
    from public.document_index_units
    where document_id = p_document_id
      and producer = p_producer
      and artifact_generation_id = p_artifact_generation_id
      and index_generation_id = p_artifact_generation_id
      and owner_id is not distinct from v_document_owner_id
      and metadata->>'generated_by' = p_producer
      and metadata->>'artifact_generation_id' = p_artifact_generation_id::text
      and metadata->>'index_generation_id' = p_artifact_generation_id::text
    group by unit_type
  ) staged_index_units;

  select coalesce(sum(value::integer), 0)
  into v_expected_index_unit_count
  from jsonb_each_text(coalesce(p_index_unit_counts_by_type, '{}'::jsonb));

  if v_total_section_count <> v_section_count
    or v_total_memory_card_count <> v_memory_card_count
    or v_total_index_unit_count <> coalesce(v_index_unit_count, 0)
    or v_section_count <> p_section_count
    or v_memory_card_count <> p_memory_card_count
    or coalesce(v_index_unit_count, 0) <> v_expected_index_unit_count
    or v_index_unit_counts_by_type <> coalesce(p_index_unit_counts_by_type, '{}'::jsonb)
  then
    raise exception 'Staged deep-memory artifact counts do not match the commit contract.' using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.document_memory_cards card
    left join public.document_sections section
      on section.id = card.section_id
      and section.document_id = p_document_id
      and section.producer = p_producer
      and section.artifact_generation_id = p_artifact_generation_id
    where card.document_id = p_document_id
      and card.producer = p_producer
      and card.artifact_generation_id = p_artifact_generation_id
      and card.section_id is not null
      and section.id is null
  ) then
    raise exception 'Staged memory cards reference a section outside the staged generation.' using errcode = '23514';
  end if;

  -- Refuse to null another producer's section reference through ON DELETE SET
  -- NULL. This keeps the "other producers untouched" guarantee literal.
  if exists (
    select 1
    from public.document_memory_cards card
    join public.document_sections section on section.id = card.section_id
    where section.document_id = p_document_id
      and section.artifact_generation_id is distinct from p_artifact_generation_id
      and (
        section.producer = p_producer
        or (
          section.producer is null
          and (
            section.metadata->>'generated_by' = p_producer
            or (
              p_producer = 'local-worker'
              and nullif(section.metadata->>'generated_by', '') is null
              and section.metadata->>'rag_indexing_version' in ('rag-deep-memory-v1', 'rag-deep-memory-v2')
            )
          )
        )
      )
      and not (
        (card.producer = p_producer and card.metadata->>'generated_by' = p_producer)
        or (card.producer is null and card.metadata->>'generated_by' = p_producer)
        or (
          p_producer = 'local-worker'
          and card.producer is null
          and card.artifact_generation_id is null
          and nullif(card.metadata->>'generated_by', '') is null
        )
      )
  ) then
    raise exception 'Another producer references an older section owned by this producer.' using errcode = '23514';
  end if;

  update public.document_sections
  set
    index_generation_id = v_committed_index_generation,
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'generated_by', p_producer,
      'artifact_generation_id', p_artifact_generation_id,
      'index_generation_id', v_committed_index_generation
    ),
    updated_at = now()
  where document_id = p_document_id
    and producer = p_producer
    and artifact_generation_id = p_artifact_generation_id;

  update public.document_memory_cards
  set
    index_generation_id = v_committed_index_generation,
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'generated_by', p_producer,
      'artifact_generation_id', p_artifact_generation_id,
      'index_generation_id', v_committed_index_generation
    ),
    updated_at = now()
  where document_id = p_document_id
    and producer = p_producer
    and artifact_generation_id = p_artifact_generation_id;

  update public.document_index_units
  set
    index_generation_id = v_committed_index_generation,
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'generated_by', p_producer,
      'artifact_generation_id', p_artifact_generation_id,
      'index_generation_id', v_committed_index_generation
    ),
    updated_at = now()
  where document_id = p_document_id
    and producer = p_producer
    and artifact_generation_id = p_artifact_generation_id;

  delete from public.document_memory_cards
  where document_id = p_document_id
    and index_generation_id is not distinct from p_expected_generation_id
    and artifact_generation_id is distinct from p_artifact_generation_id
    and (
      (producer = p_producer and metadata->>'generated_by' = p_producer)
      or (producer is null and metadata->>'generated_by' = p_producer)
      or (
        p_producer = 'local-worker'
        and producer is null
        and artifact_generation_id is null
        and nullif(metadata->>'generated_by', '') is null
      )
    );

  delete from public.document_index_units
  where document_id = p_document_id
    and index_generation_id is not distinct from p_expected_generation_id
    and artifact_generation_id is distinct from p_artifact_generation_id
    and (
      (producer = p_producer and metadata->>'generated_by' = p_producer)
      or (producer is null and metadata->>'generated_by' = p_producer)
      or (
        p_producer = 'local-worker'
        and producer is null
        and artifact_generation_id is null
        and nullif(metadata->>'generated_by', '') is null
      )
    );

  delete from public.document_sections
  where document_id = p_document_id
    and index_generation_id is not distinct from p_expected_generation_id
    and artifact_generation_id is distinct from p_artifact_generation_id
    and (
      (producer = p_producer and metadata->>'generated_by' = p_producer)
      or (
        producer is null
        and (
          metadata->>'generated_by' = p_producer
          or (
            p_producer = 'local-worker'
            and nullif(metadata->>'generated_by', '') is null
            and metadata->>'rag_indexing_version' in ('rag-deep-memory-v1', 'rag-deep-memory-v2')
          )
        )
      )
    );

  if jsonb_typeof(p_aliases) is distinct from 'array' then raise exception 'invalid_maintenance_aliases' using errcode='22023'; end if;
  -- Alias suggestions remain optional, but any accepted insert shares this exact snapshot.
  begin
    insert into public.rag_aliases(owner_id,alias,canonical,alias_type,weight,enabled,metadata)
      select p_owner_id,r.alias,r.canonical,r.alias_type,r.weight,r.enabled,
        coalesce(r.metadata,'{}')||jsonb_build_object('document_id',p_document_id)
      from jsonb_to_recordset(p_aliases) r(alias text,canonical text,alias_type text,weight real,enabled boolean,metadata jsonb);
  exception when check_violation or not_null_violation or unique_violation then null;
  end;

  -- This is deliberately the final logical mutation. Any error above rolls
  -- back both activation and producer-scoped cleanup before metadata advertises
  -- the new deep-memory generation.
  perform public.apply_document_metadata_patch(
    p_document_id,
    jsonb_build_object(
      'rag_indexing_version', p_rag_memory_version,
      'rag_memory_version', p_rag_memory_version,
      'rag_memory_updated_at', now(),
      'document_intelligence_version', p_document_intelligence_version,
      'document_intelligence_updated_at', now(),
      'section_count', p_section_count,
      'memory_card_count', p_memory_card_count,
      'index_unit_count', v_expected_index_unit_count,
      'index_unit_counts_by_type', coalesce(p_index_unit_counts_by_type, '{}'::jsonb),
      'repaired_anchor_count', p_repaired_anchor_count,
      'deep_memory_generations', jsonb_build_object(p_producer, p_artifact_generation_id)
    )
  );

  select * into v_live_document from public.documents where id=p_document_id;
  return jsonb_build_object(
    'updated_at',v_live_document.updated_at, 'metadata',v_live_document.metadata,
    'document_id', p_document_id,
    'producer', p_producer,
    'artifact_generation_id', p_artifact_generation_id,
    'index_generation_id', v_committed_index_generation,
    'section_count', p_section_count,
    'memory_card_count', p_memory_card_count,
    'index_unit_count', v_expected_index_unit_count
  );
end;
$$;
alter function public.commit_document_maintenance_deep_memory(uuid,uuid,timestamptz,uuid,jsonb,jsonb,text,uuid,text,text,integer,integer,jsonb,integer) owner to postgres;
revoke all on function public.commit_document_maintenance_deep_memory(uuid,uuid,timestamptz,uuid,jsonb,jsonb,text,uuid,text,text,integer,integer,jsonb,integer) from public,anon,authenticated,service_role;
grant execute on function public.commit_document_maintenance_deep_memory(uuid,uuid,timestamptz,uuid,jsonb,jsonb,text,uuid,text,text,integer,integer,jsonb,integer) to service_role;

-- No active application/script caller needs either destructive legacy entry point. The worker
-- uses the separate IngestionFence overload; maintenance now uses the snapshot-fenced commit.
-- Keep definitions/history intact while closing these obsolete execution paths to app roles.
revoke all on function public.reset_document_index(uuid) from public,anon,authenticated,service_role;
revoke all on function public.commit_document_deep_memory_generation(uuid,text,uuid,text,text,integer,integer,jsonb,integer)
  from public,anon,authenticated,service_role;
