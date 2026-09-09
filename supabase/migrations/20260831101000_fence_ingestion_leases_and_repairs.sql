-- U03 source-only migration. Drain both processors before separately authorised application.
do $$ begin
  if exists (select 1 from public.ingestion_jobs where status = 'processing')
    or exists (select 1 from public.indexing_v3_agent_jobs where status = 'processing') then
    raise exception 'ingestion_lease_migration_drain_required';
  end if;
end $$;

alter table public.ingestion_jobs
  add column lease_token uuid,
  add column lease_expected_generation_id uuid,
  add column lease_write_generation_id uuid,
  add column lease_authority_digest text,
  add column lease_expires_at timestamptz,
  add column lease_duration_seconds integer,
  add constraint ingestion_jobs_lease_tuple check (
    (lease_authority_digest is null or lease_authority_digest ~ '^sha256:[0-9a-f]{64}$')
    and (lease_duration_seconds is null or lease_duration_seconds between 60 and 86400)
    and (status <> 'processing' or (lease_token is not null and locked_by is not null
      and btrim(locked_by) <> '' and lease_write_generation_id is not null
      and lease_authority_digest is not null and lease_expires_at is not null and lease_duration_seconds is not null))
  );
alter table public.indexing_v3_agent_jobs
  add column lease_token uuid,
  add column lease_expected_generation_id uuid,
  add column lease_write_generation_id uuid,
  add column lease_authority_digest text,
  add column lease_expires_at timestamptz,
  add column lease_duration_seconds integer,
  add constraint indexing_v3_agent_jobs_lease_tuple check (
    (lease_authority_digest is null or lease_authority_digest ~ '^sha256:[0-9a-f]{64}$')
    and (lease_duration_seconds is null or lease_duration_seconds between 60 and 86400)
    and (status <> 'processing' or (lease_token is not null and locked_by is not null
      and btrim(locked_by) <> '' and lease_expected_generation_id is not null and lease_write_generation_id is not null
      and lease_authority_digest is not null and lease_expires_at is not null and lease_duration_seconds is not null))
  );

-- Pre-lock lookups only choose the source lock. Recheck the route after locking the document.
create or replace function public.lock_ingestion_document_authority(p_document_id uuid, p_try boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_key text; v_version_id uuid; v_document public.documents%rowtype;
  v_version public.public_source_versions%rowtype; v_event public.public_source_activation_events%rowtype;
  v_digest text; v_metadata jsonb;
begin
  select v.id, v.source_catalogue_key into v_version_id, v_key
  from public.public_source_versions v where v.staging_document_id = p_document_id;
  if v_key is null then
    select d.metadata->>'source_catalogue_key' into v_key from public.documents d where d.id = p_document_id;
  end if;
  if v_key is not null then
    if p_try then
      if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('public_source:' || v_key, 0)) then return null; end if;
    else
      perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('public_source:' || v_key, 0));
    end if;
    select * into v_event from public.public_source_activation_events
      where source_catalogue_key = v_key order by source_sequence desc limit 1 for update;
    select * into v_version from public.public_source_versions where id = v_version_id for update;
  end if;
  if p_try then
    select * into v_document from public.documents where id = p_document_id for update skip locked;
  else
    select * into v_document from public.documents where id = p_document_id for update;
  end if;
  if not found then return null; end if;
  v_metadata := v_document.metadata;
  if jsonb_typeof(v_metadata) is distinct from 'object' then return null; end if;
  if v_metadata->>'source_catalogue_key' is distinct from v_key
    or exists (select 1 from public.public_source_versions v where v.staging_document_id = p_document_id and v.id is distinct from v_version_id)
    then return null; end if;
  if v_key is not null then
    if v_version.id is null or v_event.id is null or v_version.staging_document_id <> p_document_id
      or v_event.decision <> 'activate' or v_version.activation_event_id is distinct from v_event.id
      or v_version.lifecycle not in ('shadow', 'approved')
      or v_version.source_policy_version is distinct from v_event.source_policy_version
      or v_version.source_policy_digest is distinct from v_event.source_policy_digest
      or v_metadata->>'source_policy_version' is distinct from v_version.source_policy_version
      or v_metadata->>'source_policy_digest' is distinct from v_version.source_policy_digest
      or v_metadata->>'source_activation_event_id' is distinct from v_event.id::text
      or v_metadata->>'source_canonical_url' is distinct from v_version.exact_canonical_url
      or v_metadata->>'source_exact_url' is distinct from v_version.exact_version_url
      or v_metadata->>'source_exact_version' is distinct from v_version.exact_version
      or v_metadata->>'source_content_hash' is distinct from v_version.content_hash
      or v_metadata->>'content_hash' is distinct from v_version.staged_content_hash
      or v_metadata->>'licence_evidence_digest' is distinct from v_version.licence_evidence_digest
      or v_metadata->>'content_identity_verdict' is distinct from 'clear'
      or v_metadata->>'content_identity_hash' is distinct from v_version.staged_content_hash
      or v_metadata->>'content_identity_verdict_version' is distinct from 'public-source-content-identity-v1'
      or public.public_source_acquisition_identity_digest(v_version.id) is distinct from v_version.acquisition_identity_digest
      then return null; end if;
    v_digest := 'sha256:' || encode(extensions.digest(convert_to(jsonb_build_object(
      'acquisition', public.public_source_acquisition_identity_digest(v_version.id),
      'version', v_version.id, 'lifecycle', v_version.lifecycle, 'event', v_event.id,
      'sequence', v_event.source_sequence, 'decision', v_event.decision,
      'policy', v_event.source_policy_version, 'policy_digest', v_event.source_policy_digest
    )::text, 'UTF8'), 'sha256'), 'hex');
  else
    -- Any public-source marker forbids silently entering the non-catalogue branch.
    if v_metadata ?| array['source_catalogue_key','source_policy_version','source_policy_digest','source_activation_event_id',
      'source_canonical_url','source_exact_url','source_exact_version','source_content_hash',
      'licence_evidence_digest','public_source_lifecycle']
      or v_metadata->>'corpus_scope' = 'australian_public' then return null; end if;
    v_digest := 'sha256:' || encode(extensions.digest(convert_to(jsonb_build_object(
      'owner', v_document.owner_id, 'source', v_document.source_path, 'storage', v_document.storage_path,
      'file', v_document.file_name, 'file_type', v_document.file_type, 'file_size', v_document.file_size,
      'content_hash', v_document.content_hash, 'corpus_scope', v_metadata->'corpus_scope',
      'content_mode', v_metadata->'content_mode', 'licence_policy', v_metadata->'licence_policy',
      'source_policy_checked', v_metadata->'source_policy_checked', 'content_identity_verdict', v_metadata->'content_identity_verdict',
      'content_identity_hash', v_metadata->'content_identity_hash', 'content_identity_verdict_version', v_metadata->'content_identity_verdict_version',
      'canonical_storage_path', v_metadata->'canonical_storage_path', 'public_corpus', v_metadata->'public_corpus'
    )::text, 'UTF8'), 'sha256'), 'hex');
  end if;
  return jsonb_build_object('document', to_jsonb(v_document), 'authority_digest', v_digest);
end $$;

create or replace function public.assert_current_ingestion_attempt(p_fence jsonb, p_target_generation uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_locked jsonb; v_job jsonb; v_generation uuid; v_id uuid; v_document_id uuid;
begin
  if jsonb_typeof(p_fence) is distinct from 'object' or not (p_fence ?& array[
    'job_kind','job_id','document_id','worker_id','lease_token','expected_generation_id','authority_digest'])
    or coalesce(p_fence->>'job_kind','') not in ('node','indexing_v3')
    or jsonb_typeof(p_fence->'job_id') is distinct from 'string' or jsonb_typeof(p_fence->'document_id') is distinct from 'string'
    or jsonb_typeof(p_fence->'lease_token') is distinct from 'string'
    or (p_fence->'expected_generation_id' <> 'null'::jsonb and jsonb_typeof(p_fence->'expected_generation_id') is distinct from 'string')
    or (p_fence->>'job_kind'='indexing_v3' and p_fence->>'expected_generation_id' is null)
    or coalesce(btrim(p_fence->>'worker_id'),'') = ''
    or coalesce(p_fence->>'authority_digest','') !~ '^sha256:[0-9a-f]{64}$'
    or coalesce(p_fence->>'lease_token','') !~ '^[0-9a-f-]{36}$' then
    raise exception 'ingestion_attempt_required';
  end if;
  v_id := (p_fence->>'job_id')::uuid; v_document_id := (p_fence->>'document_id')::uuid;
  v_generation := (p_fence->>'expected_generation_id')::uuid;
  v_locked := public.lock_ingestion_document_authority(v_document_id, false);
  if v_locked is null then return null; end if;
  perform 1 from public.ingestion_jobs where document_id = v_document_id order by id for update;
  perform 1 from public.indexing_v3_agent_jobs where document_id = v_document_id order by id for update;
  if p_fence->>'job_kind' = 'node' then
    select to_jsonb(j) into v_job from public.ingestion_jobs j where j.id = v_id;
  elsif p_fence->>'job_kind' = 'indexing_v3' then
    select to_jsonb(j) into v_job from public.indexing_v3_agent_jobs j where j.id = v_id;
  end if;
  if v_job is null or v_job->>'document_id' is distinct from v_document_id::text
    or v_job->>'locked_by' is distinct from p_fence->>'worker_id'
    or v_job->>'lease_token' is distinct from p_fence->>'lease_token'
    or v_job->>'status' is distinct from 'processing'
    or (v_job->>'lease_expires_at')::timestamptz <= pg_catalog.clock_timestamp()
    or v_job->>'lease_expires_at' is null
    or (v_job->>'lease_expected_generation_id')::uuid is distinct from v_generation
    or (v_locked->'document'->>'index_generation_id')::uuid is distinct from v_generation
    or (v_generation is null and (v_locked->'document'->'metadata' ? 'index_generation_id'))
    or v_locked->>'authority_digest' is distinct from p_fence->>'authority_digest'
    or v_job->>'lease_authority_digest' is distinct from p_fence->>'authority_digest'
    or (p_target_generation is not null and (v_job->>'lease_write_generation_id')::uuid is distinct from p_target_generation)
    then return null; end if;
  return v_locked || jsonb_build_object('job', v_job);
end $$;

drop function public.claim_ingestion_jobs(text, integer, integer);
create function public.claim_ingestion_jobs(p_worker_id text, p_claim_limit integer default 1, p_stale_after_minutes integer default 45)
returns setof jsonb language plpgsql security definer set search_path = '' as $$
declare v_candidate record; v_locked jsonb; v_job public.ingestion_jobs%rowtype; v_count integer := 0; v_now timestamptz; v_generation uuid;
begin
  if p_worker_id is null or btrim(p_worker_id) = '' or p_claim_limit is null or p_claim_limit not between 1 and 100
    or p_stale_after_minutes not between 1 and 1440 or p_stale_after_minutes is null then raise exception 'invalid_ingestion_claim_configuration'; end if;
  for v_candidate in select j.id, j.document_id from public.ingestion_jobs j
    where j.attempt_count < j.max_attempts
      and (j.status in ('pending','failed','deferred') and coalesce(j.next_run_at, pg_catalog.clock_timestamp()) <= pg_catalog.clock_timestamp()
        or j.status = 'processing' and j.lease_expires_at <= pg_catalog.clock_timestamp())
    order by j.created_at, j.id
  loop
    exit when v_count >= p_claim_limit;
    v_locked := public.lock_ingestion_document_authority(v_candidate.document_id, true);
    if v_locked is null then continue; end if;
    perform 1 from public.ingestion_jobs where document_id = v_candidate.document_id order by id for update skip locked;
    perform 1 from public.indexing_v3_agent_jobs where document_id = v_candidate.document_id order by id for update skip locked;
    v_now := pg_catalog.clock_timestamp();
    if exists (select 1 from public.ingestion_jobs where document_id = v_candidate.document_id and status = 'processing' and lease_expires_at > v_now)
      or exists (select 1 from public.indexing_v3_agent_jobs where document_id = v_candidate.document_id and status = 'processing' and lease_expires_at > v_now) then continue; end if;
    select * into v_job from public.ingestion_jobs where id = v_candidate.id for update skip locked;
    if not found or v_job.attempt_count >= v_job.max_attempts or not (
      v_job.status in ('pending','failed','deferred') and coalesce(v_job.next_run_at, v_now) <= v_now
      or v_job.status = 'processing' and v_job.lease_expires_at <= v_now) then continue; end if;
    v_generation := (v_locked->'document'->>'index_generation_id')::uuid;
    if v_generation is null and (v_locked->'document'->'metadata' ? 'index_generation_id') then continue; end if;

    update public.ingestion_jobs set status = 'processing', locked_by = p_worker_id, locked_at = v_now,
      lease_token = gen_random_uuid(), lease_expected_generation_id = v_generation,
      lease_write_generation_id = gen_random_uuid(),
      lease_authority_digest = v_locked->>'authority_digest', lease_expires_at = v_now + make_interval(secs => p_stale_after_minutes * 60),
      lease_duration_seconds = p_stale_after_minutes * 60, attempt_count = attempt_count + 1, next_run_at = null
    where id = v_job.id returning * into v_job;
    return next to_jsonb(v_job) || jsonb_build_object('job_kind','node', 'documents',v_locked->'document');
    v_count := v_count + 1;
  end loop;
end $$;
revoke all on function public.claim_ingestion_jobs(text, integer, integer) from public, anon, authenticated;
grant execute on function public.claim_ingestion_jobs(text, integer, integer) to service_role;

drop function public.claim_indexing_v3_agent_jobs(text, integer, integer);
create function public.claim_indexing_v3_agent_jobs(p_worker_id text, p_claim_limit integer default 1, p_stale_after_minutes integer default 45)
returns setof jsonb language plpgsql security definer set search_path = '' as $$
declare v_candidate record; v_locked jsonb; v_job public.indexing_v3_agent_jobs%rowtype; v_count integer := 0; v_now timestamptz; v_generation uuid;
begin
  if p_worker_id is null or btrim(p_worker_id) = '' or p_claim_limit is null or p_claim_limit not between 1 and 100
    or p_stale_after_minutes not between 1 and 1440 or p_stale_after_minutes is null then raise exception 'invalid_ingestion_claim_configuration'; end if;
  -- Discovery remains bounded by successful claims and revalidates every source/document route under locks.
  for v_candidate in select j.id, d.id as document_id from public.documents d
    left join public.indexing_v3_agent_jobs j on j.document_id=d.id
    where d.status='indexed' and d.index_generation_id is not null
      and not exists(select 1 from public.ingestion_jobs i where i.document_id=d.id and i.status='pending')
      and ((j.id is null and d.metadata ? 'indexing_v3_agent_status'
        and coalesce(d.metadata->>'indexing_v3_agent_status','pending') not in ('completed','needs_enrichment_artifacts'))
        or (j.attempt_count < j.max_attempts and (
          j.status in ('pending','failed') and coalesce(j.next_run_at,pg_catalog.clock_timestamp()) <= pg_catalog.clock_timestamp()
          or j.status='processing' and j.lease_expires_at <= pg_catalog.clock_timestamp())))
    order by d.created_at,d.id
  loop
    exit when v_count >= p_claim_limit;
    v_locked := public.lock_ingestion_document_authority(v_candidate.document_id, true);
    if v_locked is null then continue; end if;
    perform 1 from public.ingestion_jobs where document_id = v_candidate.document_id order by id for update skip locked;
    perform 1 from public.indexing_v3_agent_jobs where document_id = v_candidate.document_id order by id for update skip locked;
    v_now := pg_catalog.clock_timestamp();
    if exists (select 1 from public.ingestion_jobs where document_id = v_candidate.document_id and status = 'processing' and lease_expires_at > v_now)
      or exists (select 1 from public.indexing_v3_agent_jobs where document_id = v_candidate.document_id and status = 'processing' and lease_expires_at > v_now) then continue; end if;
    v_generation := (v_locked->'document'->>'index_generation_id')::uuid;
    if v_generation is null or v_locked->'document'->>'status' is distinct from 'indexed'
      or exists(select 1 from public.ingestion_jobs where document_id=v_candidate.document_id and status='pending') then continue; end if;
    select * into v_job from public.indexing_v3_agent_jobs where document_id=v_candidate.document_id for update skip locked;
    if not found then
      if v_candidate.id is not null or not (v_locked->'document'->'metadata' ? 'indexing_v3_agent_status')
        or coalesce(v_locked->'document'->'metadata'->>'indexing_v3_agent_status','pending') in ('completed','needs_enrichment_artifacts') then continue; end if;
      insert into public.indexing_v3_agent_jobs(document_id,status,enrichment_status)
        values(v_candidate.document_id,'pending','pending') returning * into v_job;
    end if;
    if v_job.attempt_count >= v_job.max_attempts or not (
      v_job.status in ('pending','failed') and coalesce(v_job.next_run_at,v_now)<=v_now
      or v_job.status='processing' and v_job.lease_expires_at<=v_now) then continue; end if;
    update public.indexing_v3_agent_jobs set status = 'processing', enrichment_status='processing', last_error=null, updated_at=v_now, locked_by = p_worker_id, locked_at = v_now,
      lease_token = gen_random_uuid(), lease_expected_generation_id = v_generation,
      lease_write_generation_id = v_generation,
      lease_authority_digest = v_locked->>'authority_digest', lease_expires_at = v_now + make_interval(secs => p_stale_after_minutes * 60),
      lease_duration_seconds = p_stale_after_minutes * 60, attempt_count = attempt_count + 1, next_run_at = null
    where id = v_job.id returning * into v_job;
    update public.documents set metadata=public.jsonb_merge_deep(metadata,jsonb_build_object(
      'indexing_v3_agent_status','processing','indexing_v3_agent_version',v_job.version,'indexing_v3_agent_attempt_count',v_job.attempt_count,
      'indexing_v3_agent_max_attempts',v_job.max_attempts,'indexing_v3_agent_locked_by',p_worker_id,'indexing_v3_agent_locked_at',v_now,
      'enrichment_status','processing')),updated_at=v_now where id=v_candidate.document_id;
    return next to_jsonb(v_job) || jsonb_build_object('job_kind','indexing_v3','batch_id',v_locked->'document'->'import_batch_id','documents',v_locked->'document');
    v_count := v_count + 1;
  end loop;
end $$;
revoke all on function public.claim_indexing_v3_agent_jobs(text, integer, integer) from public, anon, authenticated;
grant execute on function public.claim_indexing_v3_agent_jobs(text, integer, integer) to service_role;

revoke all on function public.lock_ingestion_document_authority(uuid, boolean) from public, anon, authenticated, service_role;
revoke all on function public.assert_current_ingestion_attempt(jsonb, uuid) from public, anon, authenticated, service_role;

-- Fixed source-membership validation, internal only; never accepts a table or SQL fragment.
create function public.assert_ingestion_artifact_sources(p_row jsonb, p_document_id uuid, p_generation uuid, p_section_generation uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_id text; v_key text; v_ids jsonb;
begin
  if jsonb_typeof(p_row) is distinct from 'object' then raise exception 'invalid_ingestion_artifact'; end if;
  foreach v_key in array array['source_chunk_ids','chunk_ids','source_image_ids','image_ids'] loop
    v_ids:=coalesce(nullif(p_row->v_key,'null'::jsonb),'[]'::jsonb);
    if jsonb_typeof(v_ids) is distinct from 'array' or jsonb_array_length(v_ids)>100000 then raise exception 'invalid_ingestion_source_membership'; end if;
    for v_id in select jsonb_array_elements_text(v_ids) loop
      if v_id is null then raise exception 'invalid_ingestion_source_membership'; end if;
      if v_key in ('source_chunk_ids','chunk_ids') then
        if not exists(select 1 from public.document_chunks where id=v_id::uuid and document_id=p_document_id and index_generation_id=p_generation) then raise exception 'ingestion_chunk_membership_mismatch'; end if;
      else
        if not exists(select 1 from public.document_images where id=v_id::uuid and document_id=p_document_id and index_generation_id=p_generation) then raise exception 'ingestion_image_membership_mismatch'; end if;
      end if;
    end loop;
  end loop;
  if p_row->>'source_chunk_id' is not null and not exists(select 1 from public.document_chunks where id=(p_row->>'source_chunk_id')::uuid and document_id=p_document_id and index_generation_id=p_generation) then raise exception 'ingestion_chunk_membership_mismatch'; end if;
  if p_row->>'source_image_id' is not null and not exists(select 1 from public.document_images where id=(p_row->>'source_image_id')::uuid and document_id=p_document_id and index_generation_id=p_generation) then raise exception 'ingestion_image_membership_mismatch'; end if;
  if p_row->'metadata'->>'source_chunk_id' is not null and not exists(select 1 from public.document_chunks where id=(p_row->'metadata'->>'source_chunk_id')::uuid and document_id=p_document_id and index_generation_id=p_generation) then raise exception 'ingestion_chunk_membership_mismatch'; end if;
  if p_row->'metadata'->>'source_image_id' is not null and not exists(select 1 from public.document_images where id=(p_row->'metadata'->>'source_image_id')::uuid and document_id=p_document_id and index_generation_id=p_generation) then raise exception 'ingestion_image_membership_mismatch'; end if;
  if p_row->>'section_id' is not null and not exists(select 1 from public.document_sections where id=(p_row->>'section_id')::uuid and document_id=p_document_id and index_generation_id=coalesce(p_section_generation,p_generation)) then raise exception 'ingestion_section_membership_mismatch'; end if;
end $$;
alter function public.assert_ingestion_artifact_sources(jsonb,uuid,uuid,uuid) owner to postgres;
revoke all on function public.assert_ingestion_artifact_sources(jsonb,uuid,uuid,uuid) from public,anon,authenticated,service_role;

create or replace function public.persist_ingestion_summary_projection(p_fence jsonb, p_summary jsonb, p_labels jsonb, p_metadata jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_locked jsonb; v_document_id uuid; v_owner uuid; v_summary public.document_summaries%rowtype; v_payload jsonb; v_label jsonb;
begin
  if p_fence->>'expected_generation_id' is null then raise exception 'ingestion_attempt_required'; end if;
  v_locked := public.assert_current_ingestion_attempt(p_fence, (p_fence->>'expected_generation_id')::uuid);
  if v_locked is null then return jsonb_build_object('ok',false,'reason','lease_lost'); end if;
  v_document_id := (p_fence->>'document_id')::uuid;
  v_owner := (v_locked->'document'->>'owner_id')::uuid;
  v_payload := p_summary->'metadata'->'source_anchored_summary_v1';
  if jsonb_typeof(p_summary) is distinct from 'object' or jsonb_typeof(p_labels) is distinct from 'array'
    or jsonb_typeof(p_metadata) is distinct from 'object' or jsonb_typeof(p_summary->'metadata') is distinct from 'object'
    or jsonb_typeof(v_payload) is distinct from 'object'
    or jsonb_typeof(p_summary->'source_chunk_ids') is distinct from 'array' or jsonb_typeof(p_summary->'source_image_ids') is distinct from 'array'
    or jsonb_array_length(p_labels) > 100 or v_payload->>'document_id' is distinct from v_document_id::text
    or v_payload->>'index_generation_id' is distinct from p_fence->>'expected_generation_id'
    or coalesce(v_payload->>'summary_kind','') not in ('structured','heuristic_fallback')
    or p_summary->>'summary' is distinct from v_payload->>'summary'
    or p_summary->'clinical_specifics' is distinct from v_payload->'clinical_specifics'
    or p_summary->'source_chunk_ids' is distinct from v_payload->'source_chunk_ids'
    or p_summary->'source_image_ids' is distinct from v_payload->'source_image_ids'
    or (v_payload->>'summary_kind' <> 'structured' and jsonb_array_length(p_labels) <> 0)
    or p_summary->>'model' is distinct from v_payload->>'model'
    or p_summary->>'generated_at' is distinct from v_payload->>'generated_at'
    or jsonb_typeof(v_payload->'labels') is distinct from 'array' or jsonb_array_length(v_payload->'labels') <> jsonb_array_length(p_labels)
    or exists(select 1 from jsonb_object_keys(p_summary->'metadata') k where k <> all(array[
      'generated_by','index_generation_id','rag_enrichment_version','rag_indexing_version','rag_memory_version','clinical_profile_version',
      'coverage_profile','enrichment_prompt_strategy','enrichment_prompt_chunk_ids','label_count','source_anchored_summary_v1','source_anchored_summary_projection_complete_v1']))
    or exists (select 1 from jsonb_object_keys(p_metadata) k where k <> all(array[
      'rag_enrichment_version','rag_indexing_version','rag_memory_version','rag_enrichment_updated_at','generated_label_count']))
    then raise exception 'invalid_ingestion_summary_projection'; end if;
  perform public.assert_ingestion_artifact_sources(p_summary,v_document_id,(p_fence->>'expected_generation_id')::uuid,null);
  select * into v_summary from public.document_summaries where document_id = v_document_id for update;
  if v_payload->>'summary_kind' <> 'structured'
    and v_summary.metadata->'source_anchored_summary_v1'->>'summary_kind' = 'structured'
    and v_summary.metadata->'source_anchored_summary_v1'->>'index_generation_id' = p_fence->>'expected_generation_id'
    then return jsonb_build_object('ok',true,'summary',to_jsonb(v_summary),'preserved_structured',true); end if;
  perform 1 from public.document_labels where document_id = v_document_id order by id for update;
  insert into public.document_summaries(document_id,owner_id,summary,clinical_specifics,source_chunk_ids,source_image_ids,model,metadata,generated_at,updated_at)
  values(v_document_id,v_owner,p_summary->>'summary',p_summary->'clinical_specifics',
    array(select jsonb_array_elements_text(p_summary->'source_chunk_ids'))::uuid[],
    array(select jsonb_array_elements_text(p_summary->'source_image_ids'))::uuid[], p_summary->>'model',
    coalesce(v_summary.metadata,'{}'::jsonb) || p_summary->'metadata' || jsonb_build_object('source_anchored_summary_projection_complete_v1', v_payload->>'summary_kind' = 'structured','index_generation_id',p_fence->>'expected_generation_id','ingestion_lease_token',p_fence->>'lease_token','ingestion_job_kind',p_fence->>'job_kind','ingestion_job_id',p_fence->>'job_id'),
    (p_summary->>'generated_at')::timestamptz, pg_catalog.clock_timestamp())
  on conflict(document_id) do update set summary=excluded.summary, clinical_specifics=excluded.clinical_specifics,
    source_chunk_ids=excluded.source_chunk_ids, source_image_ids=excluded.source_image_ids, model=excluded.model,
    metadata=excluded.metadata, generated_at=excluded.generated_at, updated_at=excluded.updated_at
  returning * into v_summary;
  delete from public.document_labels where document_id = v_document_id and source = 'generated';
  for v_label in select value from jsonb_array_elements(p_labels) loop
    if v_label->>'document_id' is distinct from v_document_id::text or v_label->>'source' is distinct from 'generated'
      or v_label->'metadata'->>'index_generation_id' is distinct from p_fence->>'expected_generation_id'
      or not exists(select 1 from jsonb_array_elements(v_payload->'labels') label
        where label->>'label'=v_label->>'label' and label->>'label_type'=v_label->>'label_type'
          and label->'confidence'=v_label->'confidence')
      then raise exception 'invalid_ingestion_summary_label'; end if;
    perform public.assert_ingestion_artifact_sources(v_label->'metadata',v_document_id,(p_fence->>'expected_generation_id')::uuid,null);
    insert into public.document_labels(document_id,owner_id,label,label_type,confidence,source,metadata)
    values(v_document_id,v_owner,v_label->>'label',v_label->>'label_type',(v_label->>'confidence')::real,'generated',v_label->'metadata');
  end loop;
  update public.documents set metadata = public.jsonb_merge_deep(metadata,p_metadata), updated_at=pg_catalog.clock_timestamp() where id=v_document_id;
  return jsonb_build_object('ok',true,'summary',to_jsonb(v_summary));
end $$;
revoke all on function public.persist_ingestion_summary_projection(jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.persist_ingestion_summary_projection(jsonb,jsonb,jsonb,jsonb) to service_role;

create or replace function public.heartbeat_ingestion_job(p_fence jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_locked jsonb; v_document_id uuid;
begin
  v_locked := public.assert_current_ingestion_attempt(p_fence, null);
  if v_locked is null then return jsonb_build_object('ok', false, 'reason', 'lease_lost'); end if;
  v_document_id := (p_fence->>'document_id')::uuid;
  update public.ingestion_jobs set locked_at = pg_catalog.clock_timestamp(),
    lease_expires_at = pg_catalog.clock_timestamp() + make_interval(secs => lease_duration_seconds)
  where id = (p_fence->>'job_id')::uuid and document_id = v_document_id
    and p_fence->>'job_kind' = 'node' and locked_by = p_fence->>'worker_id'
    and lease_token = (p_fence->>'lease_token')::uuid and status = 'processing'
    and lease_expected_generation_id is not distinct from (p_fence->>'expected_generation_id')::uuid
    and lease_authority_digest = p_fence->>'authority_digest' and lease_expires_at > pg_catalog.clock_timestamp();
  if not found then raise exception 'ingestion_mutation_row_count'; end if;
  return jsonb_build_object('ok',true);
end $$;
alter function public.heartbeat_ingestion_job(jsonb) owner to postgres;
revoke all on function public.heartbeat_ingestion_job(jsonb) from public, anon, authenticated;
grant execute on function public.heartbeat_ingestion_job(jsonb) to service_role;

create or replace function public.heartbeat_indexing_v3_agent_job(p_fence jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_locked jsonb; v_document_id uuid;
begin
  v_locked := public.assert_current_ingestion_attempt(p_fence, null);
  if v_locked is null then return jsonb_build_object('ok', false, 'reason', 'lease_lost'); end if;
  v_document_id := (p_fence->>'document_id')::uuid;
  update public.indexing_v3_agent_jobs set locked_at = pg_catalog.clock_timestamp(),
    lease_expires_at = pg_catalog.clock_timestamp() + make_interval(secs => lease_duration_seconds)
  where id = (p_fence->>'job_id')::uuid and document_id = v_document_id
    and p_fence->>'job_kind' = 'indexing_v3' and locked_by = p_fence->>'worker_id'
    and lease_token = (p_fence->>'lease_token')::uuid and status = 'processing'
    and lease_expected_generation_id is not distinct from (p_fence->>'expected_generation_id')::uuid
    and lease_authority_digest = p_fence->>'authority_digest' and lease_expires_at > pg_catalog.clock_timestamp();
  if not found then raise exception 'ingestion_mutation_row_count'; end if;
  return jsonb_build_object('ok',true);
end $$;
alter function public.heartbeat_indexing_v3_agent_job(jsonb) owner to postgres;
revoke all on function public.heartbeat_indexing_v3_agent_job(jsonb) from public, anon, authenticated;
grant execute on function public.heartbeat_indexing_v3_agent_job(jsonb) to service_role;

create or replace function public.update_ingestion_job_progress(p_fence jsonb, p_stage text, p_progress integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_locked jsonb; v_document_id uuid;
begin
  v_locked := public.assert_current_ingestion_attempt(p_fence, null);
  if v_locked is null then return jsonb_build_object('ok', false, 'reason', 'lease_lost'); end if;
  v_document_id := (p_fence->>'document_id')::uuid;
  if p_progress is null or p_progress not between 0 and 100 or p_stage is null or length(p_stage) > 500 then raise exception 'invalid_ingestion_progress'; end if;
  update public.ingestion_jobs set stage=p_stage, progress=p_progress, locked_at=pg_catalog.clock_timestamp(),
    lease_expires_at=pg_catalog.clock_timestamp()+make_interval(secs=>lease_duration_seconds)
  where id = (p_fence->>'job_id')::uuid and document_id = v_document_id
    and p_fence->>'job_kind' = 'node' and locked_by = p_fence->>'worker_id'
    and lease_token = (p_fence->>'lease_token')::uuid and status = 'processing'
    and lease_expected_generation_id is not distinct from (p_fence->>'expected_generation_id')::uuid
    and lease_authority_digest = p_fence->>'authority_digest' and lease_expires_at > pg_catalog.clock_timestamp();
  if not found then raise exception 'ingestion_mutation_row_count'; end if;
  return jsonb_build_object('ok',true);
end $$;
alter function public.update_ingestion_job_progress(jsonb, text, integer) owner to postgres;
revoke all on function public.update_ingestion_job_progress(jsonb, text, integer) from public, anon, authenticated;
grant execute on function public.update_ingestion_job_progress(jsonb, text, integer) to service_role;

create or replace function public.patch_ingestion_document_state(p_fence jsonb, p_state jsonb, p_metadata jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_locked jsonb; v_document_id uuid;
begin
  v_locked := public.assert_current_ingestion_attempt(p_fence, null);
  if v_locked is null then return jsonb_build_object('ok', false, 'reason', 'lease_lost'); end if;
  v_document_id := (p_fence->>'document_id')::uuid;
  if jsonb_typeof(p_state) is distinct from 'object' or jsonb_typeof(p_metadata) is distinct from 'object'
    or exists(select 1 from jsonb_object_keys(p_state) k where k <> all(array['status','error_message']))
    or exists(select 1 from jsonb_object_keys(p_metadata) k where k <> all(array['indexed_at','cover_image_id','rag_enrichment_version','rag_indexing_version','rag_memory_version','rag_memory_updated_at','rag_enrichment_updated_at','enrichment_status','enrichment_error','section_count','memory_card_count','extraction_quality','index_quality_score','index_quality_issues','index_quality_metrics','optional_index_write_issues','indexing_v3_agent_status','indexing_v3_agent_last_error','indexing_v3_agent_repair_reason','indexing_v3_agent_updated_at','completion_gate_missing','embedding_model','page_count','ocr_page_count','needs_ocr_page_count','text_character_count','extracted_image_count','searchable_image_count','skipped_image_count','skipped_image_reasons','image_type_counts','extraction_warnings','document_embedding_field_types','shadow_extraction','index_generation_id']))
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

alter table public.ingestion_job_stages add column job_kind text check(job_kind in ('node','indexing_v3')),
  add column lease_token uuid, add column index_generation_id uuid;

create or replace function public.start_ingestion_job_stage(p_fence jsonb, p_stage text, p_metadata jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_locked jsonb; v_document_id uuid; v_stage uuid;
begin
  v_locked := public.assert_current_ingestion_attempt(p_fence, null);
  if v_locked is null then return jsonb_build_object('ok', false, 'reason', 'lease_lost'); end if;
  v_document_id := (p_fence->>'document_id')::uuid;
  if p_stage is null or length(p_stage) not between 1 and 240 or jsonb_typeof(p_metadata) is distinct from 'object' or octet_length(p_metadata::text)>65536 then raise exception 'invalid_ingestion_stage'; end if;
  insert into public.ingestion_job_stages(job_id,document_id,job_kind,lease_token,index_generation_id,stage_name,metadata)
  values((p_fence->>'job_id')::uuid,v_document_id,p_fence->>'job_kind',(p_fence->>'lease_token')::uuid,
    (p_fence->>'expected_generation_id')::uuid,p_stage,p_metadata) returning id into v_stage;
  return jsonb_build_object('ok',true,'stage_id',v_stage);
end $$;
alter function public.start_ingestion_job_stage(jsonb, text, jsonb) owner to postgres;
revoke all on function public.start_ingestion_job_stage(jsonb, text, jsonb) from public, anon, authenticated;
grant execute on function public.start_ingestion_job_stage(jsonb, text, jsonb) to service_role;

create or replace function public.finish_ingestion_job_stage(p_fence jsonb, p_stage_id uuid, p_ok boolean, p_counts jsonb, p_error text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_locked jsonb; v_document_id uuid;
begin
  v_locked := public.assert_current_ingestion_attempt(p_fence, null);
  if v_locked is null then return jsonb_build_object('ok', false, 'reason', 'lease_lost'); end if;
  v_document_id := (p_fence->>'document_id')::uuid;
  if p_stage_id is null or p_ok is null or jsonb_typeof(p_counts) is distinct from 'object' or octet_length(p_counts::text)>65536 then raise exception 'invalid_ingestion_stage'; end if;
  update public.ingestion_job_stages set stage_status=case when p_ok then 'completed' else 'failed' end,
    finished_at=pg_catalog.clock_timestamp(),artifact_counts=p_counts,error_message=p_error
  where id=p_stage_id and job_id=(p_fence->>'job_id')::uuid and document_id=v_document_id
    and job_kind=p_fence->>'job_kind' and lease_token=(p_fence->>'lease_token')::uuid
    and index_generation_id is not distinct from (p_fence->>'expected_generation_id')::uuid and stage_status='started';
  if not found then raise exception 'ingestion_stage_identity_mismatch'; end if;
  return jsonb_build_object('ok',true);
end $$;
alter function public.finish_ingestion_job_stage(jsonb, uuid, boolean, jsonb, text) owner to postgres;
revoke all on function public.finish_ingestion_job_stage(jsonb, uuid, boolean, jsonb, text) from public, anon, authenticated;
grant execute on function public.finish_ingestion_job_stage(jsonb, uuid, boolean, jsonb, text) to service_role;

create or replace function public.prepare_ingestion_image_upload(p_fence jsonb, p_generation uuid, p_extension text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_locked jsonb; v_document_id uuid;
begin
  if p_generation is null or p_fence->>'job_kind' is distinct from 'node' then raise exception 'ingestion_attempt_required'; end if;
  v_locked := public.assert_current_ingestion_attempt(p_fence, p_generation);
  if v_locked is null then return jsonb_build_object('ok', false, 'reason', 'lease_lost'); end if;
  v_document_id := (p_fence->>'document_id')::uuid;
  if coalesce(p_extension,'') not in ('png','jpg','jpeg','webp') then raise exception 'invalid_ingestion_image_extension'; end if;
  return jsonb_build_object('ok',true,'storage_path',v_document_id::text || '/' || (p_fence->>'lease_token') || '/' || p_generation::text || '/' || gen_random_uuid()::text || '.' || p_extension);
end $$;
alter function public.prepare_ingestion_image_upload(jsonb, uuid, text) owner to postgres;
revoke all on function public.prepare_ingestion_image_upload(jsonb, uuid, text) from public, anon, authenticated;
grant execute on function public.prepare_ingestion_image_upload(jsonb, uuid, text) to service_role;

create or replace function public.write_ingestion_base_artifacts(p_fence jsonb, p_generation uuid, p_chunks jsonb, p_images jsonb, p_table_facts jsonb, p_embedding_fields jsonb, p_index_units jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_locked jsonb; v_document_id uuid; v_row jsonb;
begin
  if p_generation is null or p_fence->>'job_kind' is distinct from 'node' then raise exception 'ingestion_attempt_required'; end if;
  v_locked := public.assert_current_ingestion_attempt(p_fence, p_generation);
  if v_locked is null then return jsonb_build_object('ok', false, 'reason', 'lease_lost'); end if;
  v_document_id := (p_fence->>'document_id')::uuid;
  if jsonb_typeof(p_chunks) is distinct from 'array' or jsonb_array_length(p_chunks) > 500 then raise exception 'invalid_ingestion_artifact_batch'; end if;
  for v_row in select value from jsonb_array_elements(p_chunks) loop
    if v_row->>'document_id' is distinct from v_document_id::text then raise exception 'ingestion_artifact_document_mismatch'; end if;
    perform public.assert_ingestion_artifact_sources(v_row,v_document_id,p_generation,null);

    v_row := jsonb_build_object('id',gen_random_uuid(),'metadata','{}'::jsonb,'section_path','[]'::jsonb,'heading_path','[]'::jsonb,'image_ids','[]'::jsonb,'source_chunk_ids','[]'::jsonb,'source_image_ids','[]'::jsonb,'chunk_ids','[]'::jsonb,'tags','[]'::jsonb,'normalized_terms','[]'::jsonb,'token_estimate',0,'caption','','mime_type','image/png','image_type','unclear','searchable',true,'clinical_relevance_score',0,'source_kind','embedded','summary','','extraction_quality','unknown','confidence',0.5,'quality_score',0.7,'extraction_mode','deterministic') || v_row || jsonb_build_object('index_generation_id',p_generation,
      'metadata', coalesce(v_row->'metadata','{}'::jsonb) || jsonb_build_object('index_generation_id',p_generation,'ingestion_lease_token',p_fence->>'lease_token','ingestion_job_kind',p_fence->>'job_kind','ingestion_job_id',p_fence->>'job_id'));
    v_row := v_row || jsonb_build_object('embedding',(v_row->'embedding')::text);
    insert into public.document_chunks(id,document_id,page_number,chunk_index,section_heading,section_path,heading_level,parent_heading,anchor_id,content,retrieval_synopsis,content_hash,index_generation_id,token_estimate,image_ids,metadata,embedding) select r.id,r.document_id,r.page_number,r.chunk_index,r.section_heading,r.section_path,r.heading_level,r.parent_heading,r.anchor_id,r.content,r.retrieval_synopsis,r.content_hash,r.index_generation_id,r.token_estimate,r.image_ids,r.metadata,r.embedding
      from jsonb_populate_record(null::public.document_chunks,v_row) r;
  end loop;
  if jsonb_typeof(p_images) is distinct from 'array' or jsonb_array_length(p_images) > 500 then raise exception 'invalid_ingestion_artifact_batch'; end if;
  for v_row in select value from jsonb_array_elements(p_images) loop
    if v_row->>'document_id' is distinct from v_document_id::text then raise exception 'ingestion_artifact_document_mismatch'; end if;
    perform public.assert_ingestion_artifact_sources(v_row,v_document_id,p_generation,null);
    if coalesce(v_row->>'storage_path','') !~ ('^' || v_document_id::text || '/' || (p_fence->>'lease_token') || '/' || p_generation::text || '/[0-9a-f-]{36}\.(png|jpg|jpeg|webp)$') then raise exception 'ingestion_image_path_mismatch'; end if;
    v_row := jsonb_build_object('id',gen_random_uuid(),'metadata','{}'::jsonb,'section_path','[]'::jsonb,'heading_path','[]'::jsonb,'image_ids','[]'::jsonb,'source_chunk_ids','[]'::jsonb,'source_image_ids','[]'::jsonb,'chunk_ids','[]'::jsonb,'tags','[]'::jsonb,'normalized_terms','[]'::jsonb,'token_estimate',0,'caption','','mime_type','image/png','image_type','unclear','searchable',true,'clinical_relevance_score',0,'source_kind','embedded','summary','','extraction_quality','unknown','confidence',0.5,'quality_score',0.7,'extraction_mode','deterministic') || v_row || jsonb_build_object('index_generation_id',p_generation,
      'metadata', coalesce(v_row->'metadata','{}'::jsonb) || jsonb_build_object('index_generation_id',p_generation,'ingestion_lease_token',p_fence->>'lease_token','ingestion_job_kind',p_fence->>'job_kind','ingestion_job_id',p_fence->>'job_id'));

    insert into public.document_images(id,document_id,page_number,storage_path,mime_type,caption,bbox,image_type,searchable,clinical_relevance_score,skip_reason,source_kind,width,height,image_hash,perceptual_hash,labels,index_generation_id,caption_confidence,clinical_priority_score,crop_completeness,image_quality_score,ocr_text_density,structured_extraction_confidence,visual_duplicate_group,metadata) select r.id,r.document_id,r.page_number,r.storage_path,r.mime_type,r.caption,r.bbox,r.image_type,r.searchable,r.clinical_relevance_score,r.skip_reason,r.source_kind,r.width,r.height,r.image_hash,r.perceptual_hash,r.labels,r.index_generation_id,r.caption_confidence,r.clinical_priority_score,r.crop_completeness,r.image_quality_score,r.ocr_text_density,r.structured_extraction_confidence,r.visual_duplicate_group,r.metadata
      from jsonb_populate_record(null::public.document_images,v_row) r;
  end loop;
  if jsonb_typeof(p_table_facts) is distinct from 'array' or jsonb_array_length(p_table_facts) > 500 then raise exception 'invalid_ingestion_artifact_batch'; end if;
  for v_row in select value from jsonb_array_elements(p_table_facts) loop
    if v_row->>'document_id' is distinct from v_document_id::text then raise exception 'ingestion_artifact_document_mismatch'; end if;
    perform public.assert_ingestion_artifact_sources(v_row,v_document_id,p_generation,null);

    v_row := jsonb_build_object('id',gen_random_uuid(),'metadata','{}'::jsonb,'section_path','[]'::jsonb,'heading_path','[]'::jsonb,'image_ids','[]'::jsonb,'source_chunk_ids','[]'::jsonb,'source_image_ids','[]'::jsonb,'chunk_ids','[]'::jsonb,'tags','[]'::jsonb,'normalized_terms','[]'::jsonb,'token_estimate',0,'caption','','mime_type','image/png','image_type','unclear','searchable',true,'clinical_relevance_score',0,'source_kind','embedded','summary','','extraction_quality','unknown','confidence',0.5,'quality_score',0.7,'extraction_mode','deterministic') || v_row || jsonb_build_object('owner_id',v_locked->'document'->'owner_id','index_generation_id',p_generation,
      'metadata', coalesce(v_row->'metadata','{}'::jsonb) || jsonb_build_object('index_generation_id',p_generation,'ingestion_lease_token',p_fence->>'lease_token','ingestion_job_kind',p_fence->>'job_kind','ingestion_job_id',p_fence->>'job_id'));

    insert into public.document_table_facts(id,owner_id,document_id,source_chunk_id,source_image_id,page_number,table_title,row_label,clinical_parameter,threshold_value,action,normalized_terms,index_generation_id,metadata) select r.id,r.owner_id,r.document_id,r.source_chunk_id,r.source_image_id,r.page_number,r.table_title,r.row_label,r.clinical_parameter,r.threshold_value,r.action,r.normalized_terms,r.index_generation_id,r.metadata
      from jsonb_populate_record(null::public.document_table_facts,v_row) r;
  end loop;
  if jsonb_typeof(p_embedding_fields) is distinct from 'array' or jsonb_array_length(p_embedding_fields) > 500 then raise exception 'invalid_ingestion_artifact_batch'; end if;
  for v_row in select value from jsonb_array_elements(p_embedding_fields) loop
    if v_row->>'document_id' is distinct from v_document_id::text then raise exception 'ingestion_artifact_document_mismatch'; end if;
    perform public.assert_ingestion_artifact_sources(v_row,v_document_id,p_generation,null);

    v_row := jsonb_build_object('id',gen_random_uuid(),'metadata','{}'::jsonb,'section_path','[]'::jsonb,'heading_path','[]'::jsonb,'image_ids','[]'::jsonb,'source_chunk_ids','[]'::jsonb,'source_image_ids','[]'::jsonb,'chunk_ids','[]'::jsonb,'tags','[]'::jsonb,'normalized_terms','[]'::jsonb,'token_estimate',0,'caption','','mime_type','image/png','image_type','unclear','searchable',true,'clinical_relevance_score',0,'source_kind','embedded','summary','','extraction_quality','unknown','confidence',0.5,'quality_score',0.7,'extraction_mode','deterministic') || v_row || jsonb_build_object('owner_id',v_locked->'document'->'owner_id','index_generation_id',p_generation,
      'metadata', coalesce(v_row->'metadata','{}'::jsonb) || jsonb_build_object('index_generation_id',p_generation,'ingestion_lease_token',p_fence->>'lease_token','ingestion_job_kind',p_fence->>'job_kind','ingestion_job_id',p_fence->>'job_id'));
    v_row := v_row || jsonb_build_object('embedding',(v_row->'embedding')::text);
    insert into public.document_embedding_fields(id,owner_id,document_id,source_chunk_id,field_type,content,content_hash,embedding,index_generation_id,metadata) select r.id,r.owner_id,r.document_id,r.source_chunk_id,r.field_type,r.content,r.content_hash,r.embedding,r.index_generation_id,r.metadata
      from jsonb_populate_record(null::public.document_embedding_fields,v_row) r;
  end loop;
  if jsonb_typeof(p_index_units) is distinct from 'array' or jsonb_array_length(p_index_units) > 500 then raise exception 'invalid_ingestion_artifact_batch'; end if;
  for v_row in select value from jsonb_array_elements(p_index_units) loop
    if v_row->>'document_id' is distinct from v_document_id::text then raise exception 'ingestion_artifact_document_mismatch'; end if;
    perform public.assert_ingestion_artifact_sources(v_row,v_document_id,p_generation,null);

    v_row := jsonb_build_object('id',gen_random_uuid(),'metadata','{}'::jsonb,'section_path','[]'::jsonb,'heading_path','[]'::jsonb,'image_ids','[]'::jsonb,'source_chunk_ids','[]'::jsonb,'source_image_ids','[]'::jsonb,'chunk_ids','[]'::jsonb,'tags','[]'::jsonb,'normalized_terms','[]'::jsonb,'token_estimate',0,'caption','','mime_type','image/png','image_type','unclear','searchable',true,'clinical_relevance_score',0,'source_kind','embedded','summary','','extraction_quality','unknown','confidence',0.5,'quality_score',0.7,'extraction_mode','deterministic') || v_row || jsonb_build_object('owner_id',v_locked->'document'->'owner_id','index_generation_id',p_generation,'producer','local-worker','artifact_generation_id',p_generation,
      'metadata', coalesce(v_row->'metadata','{}'::jsonb) || jsonb_build_object('index_generation_id',p_generation,'ingestion_lease_token',p_fence->>'lease_token','ingestion_job_kind',p_fence->>'job_kind','ingestion_job_id',p_fence->>'job_id'));
    v_row := v_row || jsonb_build_object('embedding',(v_row->'embedding')::text);
    insert into public.document_index_units(id,owner_id,document_id,unit_type,source_chunk_id,source_image_id,page_start,page_end,heading_path,title,content,normalized_terms,source_span,quality_score,extraction_mode,index_generation_id,producer,artifact_generation_id,embedding,metadata) select r.id,r.owner_id,r.document_id,r.unit_type,r.source_chunk_id,r.source_image_id,r.page_start,r.page_end,r.heading_path,r.title,r.content,r.normalized_terms,r.source_span,r.quality_score,r.extraction_mode,r.index_generation_id,r.producer,r.artifact_generation_id,r.embedding,r.metadata
      from jsonb_populate_record(null::public.document_index_units,v_row) r;
  end loop;
  return jsonb_build_object('ok',true);
end $$;
alter function public.write_ingestion_base_artifacts(jsonb, uuid, jsonb, jsonb, jsonb, jsonb, jsonb) owner to postgres;
revoke all on function public.write_ingestion_base_artifacts(jsonb, uuid, jsonb, jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.write_ingestion_base_artifacts(jsonb, uuid, jsonb, jsonb, jsonb, jsonb, jsonb) to service_role;

create or replace function public.reset_ingestion_attempt_artifacts(p_fence jsonb, p_generation uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_locked jsonb; v_document_id uuid;
begin
  if p_generation is null or p_fence->>'job_kind' is distinct from 'node' then raise exception 'ingestion_attempt_required'; end if;
  v_locked := public.assert_current_ingestion_attempt(p_fence, p_generation);
  if v_locked is null then return jsonb_build_object('ok', false, 'reason', 'lease_lost'); end if;
  v_document_id := (p_fence->>'document_id')::uuid;
  if p_generation is not distinct from (v_locked->'document'->>'index_generation_id')::uuid then raise exception 'cannot_reset_committed_ingestion_generation'; end if;
  delete from public.document_index_units where document_id=v_document_id and index_generation_id=p_generation and metadata->>'ingestion_lease_token'=p_fence->>'lease_token';
  delete from public.document_embedding_fields where document_id=v_document_id and index_generation_id=p_generation and metadata->>'ingestion_lease_token'=p_fence->>'lease_token';
  delete from public.document_table_facts where document_id=v_document_id and index_generation_id=p_generation and metadata->>'ingestion_lease_token'=p_fence->>'lease_token';
  delete from public.document_chunks where document_id=v_document_id and index_generation_id=p_generation and metadata->>'ingestion_lease_token'=p_fence->>'lease_token';
  delete from public.document_images where document_id=v_document_id and index_generation_id=p_generation and metadata->>'ingestion_lease_token'=p_fence->>'lease_token';
  return jsonb_build_object('ok',true);
end $$;
alter function public.reset_ingestion_attempt_artifacts(jsonb, uuid) owner to postgres;
revoke all on function public.reset_ingestion_attempt_artifacts(jsonb, uuid) from public, anon, authenticated;
grant execute on function public.reset_ingestion_attempt_artifacts(jsonb, uuid) to service_role;

create or replace function public.persist_ingestion_index_quality(p_fence jsonb, p_quality jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_locked jsonb; v_document_id uuid;
begin
  v_locked := public.assert_current_ingestion_attempt(p_fence, null);
  if v_locked is null then return jsonb_build_object('ok',false,'reason','lease_lost'); end if;
  v_document_id := (p_fence->>'document_id')::uuid;
  insert into public.document_index_quality(document_id,owner_id,quality_score,extraction_quality,metrics,issues,updated_at)
  values(v_document_id,(v_locked->'document'->>'owner_id')::uuid,(p_quality->>'quality_score')::real,p_quality->>'extraction_quality',
    p_quality->'metrics',array(select jsonb_array_elements_text(p_quality->'issues')),pg_catalog.clock_timestamp())
  on conflict(document_id) do update set
    quality_score=case when p_fence->>'job_kind'='indexing_v3' then public.document_index_quality.quality_score else excluded.quality_score end,
    extraction_quality=case when p_fence->>'job_kind'='indexing_v3' then public.document_index_quality.extraction_quality else excluded.extraction_quality end,
    metrics=case when p_fence->>'job_kind'='indexing_v3' then public.document_index_quality.metrics || excluded.metrics else excluded.metrics end,
    issues=case when p_fence->>'job_kind'='indexing_v3' then array(select distinct x from unnest(public.document_index_quality.issues || excluded.issues) x) else excluded.issues end,
    updated_at=excluded.updated_at;
  return jsonb_build_object('ok',true);
end $$;
alter function public.persist_ingestion_index_quality(jsonb, jsonb) owner to postgres;
revoke all on function public.persist_ingestion_index_quality(jsonb, jsonb) from public,anon,authenticated;
grant execute on function public.persist_ingestion_index_quality(jsonb, jsonb) to service_role;

create or replace function public.commit_document_index_generation(p_fence jsonb, p_generation uuid, p_page_count integer, p_chunk_count integer, p_image_count integer, p_metadata jsonb, p_pages jsonb, p_quality jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_locked jsonb; v_document_id uuid; v_next jsonb; v_result jsonb;
begin
  v_locked := public.assert_current_ingestion_attempt(p_fence, p_generation);
  if v_locked is null then return jsonb_build_object('ok',false,'reason','lease_lost'); end if;
  v_document_id := (p_fence->>'document_id')::uuid;
  if p_fence->>'job_kind' <> 'node' or p_generation is null or p_chunk_count is null or p_image_count is null or p_page_count is null
    or jsonb_typeof(p_pages) is distinct from 'array' or jsonb_typeof(p_quality) is distinct from 'object'
    or p_page_count < 0 or p_page_count > 100000 or p_chunk_count < 0 or p_image_count < 0 or p_chunk_count+p_image_count = 0
    or p_chunk_count <> (select count(*) from public.document_chunks where document_id=v_document_id and index_generation_id=p_generation)
    or p_image_count <> (select count(*) from public.document_images where document_id=v_document_id and index_generation_id=p_generation and searchable)
    or p_page_count <> jsonb_array_length(p_pages) then raise exception 'invalid_ingestion_core_counts'; end if;
  -- Only the reserved generation becomes visible. Earlier committed evidence is retained for later lifecycle work.
  delete from public.document_pages where document_id=v_document_id;
  insert into public.document_pages(document_id,page_number,text,ocr_used,metadata)
  select v_document_id,r.page_number,r.text,r.ocr_used,coalesce(r.metadata,'{}'::jsonb)
    from jsonb_to_recordset(p_pages) r(page_number integer,text text,ocr_used boolean,metadata jsonb);
  insert into public.document_index_quality(document_id,owner_id,quality_score,extraction_quality,metrics,issues,updated_at)
  values(v_document_id,(v_locked->'document'->>'owner_id')::uuid,(p_quality->>'quality_score')::real,p_quality->>'extraction_quality',
    p_quality->'metrics',array(select jsonb_array_elements_text(p_quality->'issues')),pg_catalog.clock_timestamp())
  on conflict(document_id) do update set
    quality_score=case when p_fence->>'job_kind'='indexing_v3' then public.document_index_quality.quality_score else excluded.quality_score end,
    extraction_quality=case when p_fence->>'job_kind'='indexing_v3' then public.document_index_quality.extraction_quality else excluded.extraction_quality end,
    metrics=case when p_fence->>'job_kind'='indexing_v3' then public.document_index_quality.metrics || excluded.metrics else excluded.metrics end,
    issues=case when p_fence->>'job_kind'='indexing_v3' then array(select distinct x from unnest(public.document_index_quality.issues || excluded.issues) x) else excluded.issues end,
    updated_at=excluded.updated_at;

  update public.ingestion_jobs set lease_expected_generation_id=p_generation where id=(p_fence->>'job_id')::uuid and document_id=v_document_id and p_fence->>'job_kind'='node'
    and locked_by=p_fence->>'worker_id' and lease_token=(p_fence->>'lease_token')::uuid and status='processing'
    and lease_expected_generation_id is not distinct from (p_fence->>'expected_generation_id')::uuid
    and lease_authority_digest=p_fence->>'authority_digest' and lease_expires_at > pg_catalog.clock_timestamp();
  if not found then raise exception 'ingestion_mutation_row_count'; end if;
  update public.documents set status='indexed',page_count=p_page_count,chunk_count=p_chunk_count,image_count=p_image_count,error_message=null,
    metadata=metadata || jsonb_build_object('index_generation_id',p_generation), updated_at=pg_catalog.clock_timestamp() where id=v_document_id;
  v_next := p_fence || jsonb_build_object('expected_generation_id',p_generation);
  v_result := public.patch_ingestion_document_state(v_next,'{}'::jsonb,p_metadata);
  if v_result->'ok' is distinct from 'true'::jsonb then raise exception 'ingestion_mutation_row_count'; end if;
  return jsonb_build_object('ok',true,'fence',v_next,'index_generation_id',p_generation);
end $$;
alter function public.commit_document_index_generation(jsonb, uuid, integer, integer, integer, jsonb, jsonb, jsonb) owner to postgres;
revoke all on function public.commit_document_index_generation(jsonb, uuid, integer, integer, integer, jsonb, jsonb, jsonb) from public,anon,authenticated;
grant execute on function public.commit_document_index_generation(jsonb, uuid, integer, integer, integer, jsonb, jsonb, jsonb) to service_role;

create or replace function public.persist_ingestion_image_caption_cache(p_fence jsonb, p_cache jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_locked jsonb; v_document_id uuid;
begin
  v_locked := public.assert_current_ingestion_attempt(p_fence, null);
  if v_locked is null then return jsonb_build_object('ok',false,'reason','lease_lost'); end if;
  v_document_id := (p_fence->>'document_id')::uuid;
  if v_locked->'document'->>'owner_id' is null then return jsonb_build_object('ok',true,'skipped',true); end if;
  if coalesce(p_cache->>'caption','')='' or coalesce(p_cache->>'image_hash','')='' or coalesce(p_cache->>'model','')='' then raise exception 'invalid_ingestion_caption_cache'; end if;
  insert into public.image_caption_cache(owner_id,image_hash,model,mime_type,caption,metadata)
  values((v_locked->'document'->>'owner_id')::uuid,p_cache->>'image_hash',p_cache->>'model',p_cache->>'mime_type',p_cache->>'caption',p_cache->'metadata')
  on conflict(owner_id,image_hash,model) do update set caption=excluded.caption,mime_type=excluded.mime_type,metadata=excluded.metadata,updated_at=pg_catalog.clock_timestamp();
  return jsonb_build_object('ok',true);
end $$;
alter function public.persist_ingestion_image_caption_cache(jsonb, jsonb) owner to postgres;
revoke all on function public.persist_ingestion_image_caption_cache(jsonb, jsonb) from public,anon,authenticated;
grant execute on function public.persist_ingestion_image_caption_cache(jsonb, jsonb) to service_role;

create or replace function public.complete_ingestion_job(p_fence jsonb, p_batch_id uuid, p_stage text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_locked jsonb; v_document_id uuid; v_batch uuid; v_pending integer; v_processing integer; v_failed integer;
begin
  if p_fence->>'expected_generation_id' is null then raise exception 'ingestion_attempt_required'; end if;
  v_locked := public.assert_current_ingestion_attempt(p_fence, (p_fence->>'expected_generation_id')::uuid);
  if v_locked is null then return jsonb_build_object('ok',false,'reason','lease_lost'); end if;
  v_document_id := (p_fence->>'document_id')::uuid;
  v_batch := (v_locked->'job'->>'batch_id')::uuid;
  if p_batch_id is not null and p_batch_id is distinct from v_batch then raise exception 'ingestion_batch_identity_mismatch'; end if;
  if v_batch is not null then perform 1 from public.import_batches where id=v_batch for update; end if;
  update public.ingestion_jobs set status='completed',stage=p_stage,progress=100,locked_by=null,locked_at=null,completed_at=pg_catalog.clock_timestamp()
  where id=(p_fence->>'job_id')::uuid and document_id=v_document_id and p_fence->>'job_kind'='node'
    and locked_by=p_fence->>'worker_id' and lease_token=(p_fence->>'lease_token')::uuid and status='processing'
    and lease_expected_generation_id is not distinct from (p_fence->>'expected_generation_id')::uuid
    and lease_authority_digest=p_fence->>'authority_digest' and lease_expires_at > pg_catalog.clock_timestamp();
  if not found then raise exception 'ingestion_mutation_row_count'; end if;
  if v_batch is not null then
    select count(*) filter(where status='pending'),count(*) filter(where status='processing'),count(*) filter(where status='failed')
      into v_pending,v_processing,v_failed from public.ingestion_jobs where batch_id=v_batch;
    update public.import_batches set status=case when v_pending+v_processing>0 then 'processing' when v_failed>0 then 'completed_with_errors' else 'completed' end,
      failed_files=v_failed, completed_at=case when v_pending+v_processing>0 then null else pg_catalog.clock_timestamp() end where id=v_batch;
  end if;
  return jsonb_build_object('ok',true);
end $$;
alter function public.complete_ingestion_job(jsonb, uuid, text) owner to postgres;
revoke all on function public.complete_ingestion_job(jsonb, uuid, text) from public,anon,authenticated;
grant execute on function public.complete_ingestion_job(jsonb, uuid, text) to service_role;

create or replace function public.fail_or_retry_ingestion_job(p_fence jsonb, p_batch_id uuid, p_retry boolean, p_stage text, p_error_message text, p_next_run_at timestamptz)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_locked jsonb; v_document_id uuid; v_retry boolean; v_batch uuid; v_pending integer; v_processing integer; v_failed integer;
begin
  v_locked := public.assert_current_ingestion_attempt(p_fence, null);
  if v_locked is null then return jsonb_build_object('ok',false,'reason','lease_lost'); end if;
  v_document_id := (p_fence->>'document_id')::uuid;
  v_batch := (v_locked->'job'->>'batch_id')::uuid;
  if p_batch_id is not null and p_batch_id is distinct from v_batch then raise exception 'ingestion_batch_identity_mismatch'; end if;
  if v_batch is not null then perform 1 from public.import_batches where id=v_batch for update; end if;
  if p_retry is null then raise exception 'invalid_ingestion_retry'; end if;
  v_retry := p_retry and (v_locked->'job'->>'attempt_count')::integer < (v_locked->'job'->>'max_attempts')::integer;
  update public.documents set status=case when index_generation_id is not null then 'indexed' when v_retry then 'queued' else 'failed' end,
    error_message=p_error_message, updated_at=pg_catalog.clock_timestamp() where id=v_document_id;
  update public.ingestion_jobs set status=case when v_retry then 'pending' else 'failed' end,stage=p_stage,error_message=p_error_message,
    next_run_at=case when v_retry then p_next_run_at else null end,locked_by=null,locked_at=null,
    completed_at=case when v_retry then null else pg_catalog.clock_timestamp() end where id=(p_fence->>'job_id')::uuid and document_id=v_document_id and p_fence->>'job_kind'='node'
    and locked_by=p_fence->>'worker_id' and lease_token=(p_fence->>'lease_token')::uuid and status='processing'
    and lease_expected_generation_id is not distinct from (p_fence->>'expected_generation_id')::uuid
    and lease_authority_digest=p_fence->>'authority_digest' and lease_expires_at > pg_catalog.clock_timestamp();
  if not found then raise exception 'ingestion_mutation_row_count'; end if;
  if v_batch is not null then
    select count(*) filter(where status='pending'),count(*) filter(where status='processing'),count(*) filter(where status='failed')
      into v_pending,v_processing,v_failed from public.ingestion_jobs where batch_id=v_batch;
    update public.import_batches set status=case when v_pending+v_processing>0 then 'processing' when v_failed>0 then 'completed_with_errors' else 'completed' end,
      failed_files=v_failed, completed_at=case when v_pending+v_processing>0 then null else pg_catalog.clock_timestamp() end where id=v_batch;
  end if;
  return jsonb_build_object('ok',true,'retry',v_retry);
end $$;
alter function public.fail_or_retry_ingestion_job(jsonb, uuid, boolean, text, text, timestamptz) owner to postgres;
revoke all on function public.fail_or_retry_ingestion_job(jsonb, uuid, boolean, text, text, timestamptz) from public,anon,authenticated;
grant execute on function public.fail_or_retry_ingestion_job(jsonb, uuid, boolean, text, text, timestamptz) to service_role;

create or replace function public.complete_strict_enrichment_job(p_fence jsonb, p_stage text, p_agent_version text, p_visual_indexing_version text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_locked jsonb; v_document_id uuid; v_gate record; v_result jsonb;
begin
  if p_fence->>'expected_generation_id' is null then raise exception 'ingestion_attempt_required'; end if;
  v_locked := public.assert_current_ingestion_attempt(p_fence, (p_fence->>'expected_generation_id')::uuid);
  if v_locked is null then return jsonb_build_object('ok',false,'reason','lease_lost'); end if;
  v_document_id := (p_fence->>'document_id')::uuid;
  select * into v_gate from public.document_strict_gate_status where document_id=v_document_id;
  if not found or not v_gate.gate_passed then return jsonb_build_object('ok',false,'reason','completion_gate_blocked','missing',coalesce(to_jsonb(v_gate.missing),'[]'::jsonb)); end if;
  update public.documents set metadata=public.jsonb_merge_deep(metadata,jsonb_build_object(
    'enrichment_status','completed','indexing_v3_agent_status','completed','indexing_v3_agent_version',p_agent_version,
    'visual_indexing_version',p_visual_indexing_version,'completion_gate',jsonb_build_object('result','complete','missing',v_gate.missing,'counts',v_gate.counts,'presence',v_gate.presence))),updated_at=pg_catalog.clock_timestamp()
    where id=v_document_id;
  update public.document_index_quality set metrics=public.jsonb_merge_deep(metrics,jsonb_build_object('strict_enrichment_gate',jsonb_build_object('result','complete','counts',v_gate.counts,'presence',v_gate.presence)))
    where document_id=v_document_id;
  if p_fence->>'job_kind'='node' then
    v_result := public.complete_ingestion_job(p_fence,(v_locked->'job'->>'batch_id')::uuid,p_stage);
  else
    v_result := public.update_indexing_v3_agent_job_status(p_fence,'completed',null,null,'{}'::jsonb);
  end if;
  if v_result->'ok' is distinct from 'true'::jsonb then raise exception 'ingestion_mutation_row_count'; end if;
  return v_result;
end $$;
alter function public.complete_strict_enrichment_job(jsonb, text, text, text) owner to postgres;
revoke all on function public.complete_strict_enrichment_job(jsonb, text, text, text) from public,anon,authenticated;
grant execute on function public.complete_strict_enrichment_job(jsonb, text, text, text) to service_role;

create or replace function public.update_indexing_v3_agent_job_status(p_fence jsonb, p_status text, p_error text, p_next_run_at timestamptz, p_metadata jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_locked jsonb; v_document_id uuid; v_status text; v_batch uuid; v_pending integer; v_processing integer; v_failed integer;
begin
  v_locked := public.assert_current_ingestion_attempt(p_fence, null);
  if v_locked is null then return jsonb_build_object('ok',false,'reason','lease_lost'); end if;
  v_document_id := (p_fence->>'document_id')::uuid;
  if p_fence->>'job_kind'<>'indexing_v3' or coalesce(p_status,'') not in ('completed','failed','deferred','needs_enrichment_artifacts')
    or jsonb_typeof(p_metadata) is distinct from 'object'
    or exists(select 1 from jsonb_object_keys(p_metadata) k where k <> all(array['completion_gate','completion_gate_missing','indexing_v3_agent_deferral_count','indexing_v3_agent_repair_reason'])) then raise exception 'invalid_indexing_agent_status'; end if;
  if p_status='completed' and not exists(select 1 from public.document_strict_gate_status where document_id=v_document_id and gate_passed) then return jsonb_build_object('ok',false,'reason','completion_gate_blocked'); end if;
  v_status := case when p_status in ('deferred','failed') and (v_locked->'job'->>'attempt_count')::integer >= (v_locked->'job'->>'max_attempts')::integer then 'needs_enrichment_artifacts' when p_status='deferred' then 'pending' else p_status end;
  v_batch := (v_locked->'document'->>'import_batch_id')::uuid;
  if v_batch is not null then perform 1 from public.import_batches where id=v_batch for update; end if;
  update public.documents set metadata=public.jsonb_merge_deep(metadata,p_metadata || jsonb_build_object('indexing_v3_agent_status',v_status,
    'indexing_v3_agent_last_error',p_error,'enrichment_status',case when v_status='completed' then 'completed' when v_status='needs_enrichment_artifacts' then v_status else 'pending' end)),updated_at=pg_catalog.clock_timestamp() where id=v_document_id;
  update public.indexing_v3_agent_jobs set status=v_status,last_error=p_error,locked_by=null,locked_at=null,
    next_run_at=case when v_status in ('completed','needs_enrichment_artifacts') then null else p_next_run_at end,
    enrichment_status=case when v_status='completed' then 'completed' when v_status='needs_enrichment_artifacts' then v_status else 'pending' end,updated_at=pg_catalog.clock_timestamp()
  where id=(p_fence->>'job_id')::uuid and document_id=v_document_id and p_fence->>'job_kind'='indexing_v3'
    and locked_by=p_fence->>'worker_id' and lease_token=(p_fence->>'lease_token')::uuid and status='processing'
    and lease_expected_generation_id is not distinct from (p_fence->>'expected_generation_id')::uuid
    and lease_authority_digest=p_fence->>'authority_digest' and lease_expires_at > pg_catalog.clock_timestamp();
  if not found then raise exception 'ingestion_mutation_row_count'; end if;
  if v_batch is not null then
    select count(*) filter(where status='pending'),count(*) filter(where status='processing'),count(*) filter(where status='failed')
      into v_pending,v_processing,v_failed from public.ingestion_jobs where batch_id=v_batch;
    update public.import_batches set status=case when v_pending+v_processing>0 then 'processing' when v_failed>0 then 'completed_with_errors' else 'completed' end,
      failed_files=v_failed,completed_at=case when v_pending+v_processing>0 then null else pg_catalog.clock_timestamp() end where id=v_batch;
  end if;
  return jsonb_build_object('ok',true,'status',v_status);
end $$;
alter function public.update_indexing_v3_agent_job_status(jsonb, text, text, timestamptz, jsonb) owner to postgres;
revoke all on function public.update_indexing_v3_agent_job_status(jsonb, text, text, timestamptz, jsonb) from public,anon,authenticated;
grant execute on function public.update_indexing_v3_agent_job_status(jsonb, text, text, timestamptz, jsonb) to service_role;

revoke all on function public.commit_document_index_generation(uuid,text,uuid,uuid,text,integer,integer,integer,jsonb,jsonb,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.complete_ingestion_job(uuid,uuid,uuid,text,text) from public,anon,authenticated,service_role;
revoke all on function public.complete_strict_enrichment_job(uuid,uuid,text,text,text) from public,anon,authenticated,service_role;
revoke all on function public.repair_strict_enrichment_gate_batch(integer) from public,anon,authenticated,service_role;

create or replace function public.stage_ingestion_deep_memory(p_fence jsonb, p_artifact_generation uuid, p_sections jsonb, p_cards jsonb, p_units jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_locked jsonb; v_document_id uuid; v_row jsonb;
begin
  v_locked := public.assert_current_ingestion_attempt(p_fence, (p_fence->>'expected_generation_id')::uuid);
  if v_locked is null then return jsonb_build_object('ok',false,'reason','lease_lost'); end if;
  if p_fence->>'expected_generation_id' is null then raise exception 'ingestion_attempt_required'; end if;
  v_document_id := (p_fence->>'document_id')::uuid;
  if p_artifact_generation is null or p_artifact_generation=(p_fence->>'expected_generation_id')::uuid then raise exception 'invalid_deep_memory_generation'; end if;
  if exists(select 1 from public.document_sections where document_id=v_document_id and artifact_generation_id=p_artifact_generation
    and (producer is distinct from 'local-worker' or metadata->>'ingestion_lease_token' is distinct from p_fence->>'lease_token')) then raise exception 'deep_memory_attempt_collision'; end if;
  if exists(select 1 from public.document_memory_cards where document_id=v_document_id and artifact_generation_id=p_artifact_generation
    and (producer is distinct from 'local-worker' or metadata->>'ingestion_lease_token' is distinct from p_fence->>'lease_token')) then raise exception 'deep_memory_attempt_collision'; end if;
  if exists(select 1 from public.document_index_units where document_id=v_document_id and artifact_generation_id=p_artifact_generation
    and (producer is distinct from 'local-worker' or metadata->>'ingestion_lease_token' is distinct from p_fence->>'lease_token')) then raise exception 'deep_memory_attempt_collision'; end if;
  if jsonb_typeof(p_sections) is distinct from 'array' or jsonb_array_length(p_sections) > 500 then raise exception 'invalid_deep_memory_batch'; end if;
  for v_row in select value from jsonb_array_elements(p_sections) loop
    if v_row->>'document_id' is distinct from v_document_id::text then raise exception 'deep_memory_document_mismatch'; end if;
    perform public.assert_ingestion_artifact_sources(v_row,v_document_id,(p_fence->>'expected_generation_id')::uuid,p_artifact_generation);
    v_row := jsonb_build_object('id',gen_random_uuid(),'heading_path','[]'::jsonb,'tags','[]'::jsonb,'chunk_ids','[]'::jsonb,'normalized_terms','[]'::jsonb,'source_chunk_ids','[]'::jsonb,'source_image_ids','[]'::jsonb,'summary','','extraction_quality','unknown','extraction_mode','deterministic','quality_score',0.7,'confidence',0.5)
      || v_row || jsonb_build_object('owner_id',v_locked->'document'->'owner_id','producer','local-worker','artifact_generation_id',p_artifact_generation,'index_generation_id',p_artifact_generation,
      'metadata',coalesce(v_row->'metadata','{}'::jsonb) || jsonb_build_object('generated_by','local-worker','artifact_generation_id',p_artifact_generation,'index_generation_id',p_artifact_generation,
        'ingestion_lease_token',p_fence->>'lease_token','ingestion_job_kind',p_fence->>'job_kind','ingestion_job_id',p_fence->>'job_id'));

    insert into public.document_sections(id,document_id,owner_id,section_index,heading,heading_path,page_start,page_end,chunk_ids,summary,tags,extraction_quality,index_generation_id,producer,artifact_generation_id,metadata) select r.id,r.document_id,r.owner_id,r.section_index,r.heading,r.heading_path,r.page_start,r.page_end,r.chunk_ids,r.summary,r.tags,r.extraction_quality,r.index_generation_id,r.producer,r.artifact_generation_id,r.metadata from jsonb_populate_record(null::public.document_sections,v_row) r;
  end loop;
  if jsonb_typeof(p_cards) is distinct from 'array' or jsonb_array_length(p_cards) > 500 then raise exception 'invalid_deep_memory_batch'; end if;
  for v_row in select value from jsonb_array_elements(p_cards) loop
    if v_row->>'document_id' is distinct from v_document_id::text then raise exception 'deep_memory_document_mismatch'; end if;
    perform public.assert_ingestion_artifact_sources(v_row,v_document_id,(p_fence->>'expected_generation_id')::uuid,p_artifact_generation);
    v_row := jsonb_build_object('id',gen_random_uuid(),'heading_path','[]'::jsonb,'tags','[]'::jsonb,'chunk_ids','[]'::jsonb,'normalized_terms','[]'::jsonb,'source_chunk_ids','[]'::jsonb,'source_image_ids','[]'::jsonb,'summary','','extraction_quality','unknown','extraction_mode','deterministic','quality_score',0.7,'confidence',0.5)
      || v_row || jsonb_build_object('owner_id',v_locked->'document'->'owner_id','producer','local-worker','artifact_generation_id',p_artifact_generation,'index_generation_id',p_artifact_generation,
      'metadata',coalesce(v_row->'metadata','{}'::jsonb) || jsonb_build_object('generated_by','local-worker','artifact_generation_id',p_artifact_generation,'index_generation_id',p_artifact_generation,
        'ingestion_lease_token',p_fence->>'lease_token','ingestion_job_kind',p_fence->>'job_kind','ingestion_job_id',p_fence->>'job_id'));
    v_row := v_row || jsonb_build_object('embedding',(v_row->'embedding')::text);
    insert into public.document_memory_cards(id,document_id,owner_id,section_id,card_type,title,content,normalized_terms,page_number,source_chunk_ids,source_image_ids,confidence,index_generation_id,producer,artifact_generation_id,metadata,embedding) select r.id,r.document_id,r.owner_id,r.section_id,r.card_type,r.title,r.content,r.normalized_terms,r.page_number,r.source_chunk_ids,r.source_image_ids,r.confidence,r.index_generation_id,r.producer,r.artifact_generation_id,r.metadata,r.embedding from jsonb_populate_record(null::public.document_memory_cards,v_row) r;
  end loop;
  if jsonb_typeof(p_units) is distinct from 'array' or jsonb_array_length(p_units) > 500 then raise exception 'invalid_deep_memory_batch'; end if;
  for v_row in select value from jsonb_array_elements(p_units) loop
    if v_row->>'document_id' is distinct from v_document_id::text then raise exception 'deep_memory_document_mismatch'; end if;
    perform public.assert_ingestion_artifact_sources(v_row,v_document_id,(p_fence->>'expected_generation_id')::uuid,p_artifact_generation);
    v_row := jsonb_build_object('id',gen_random_uuid(),'heading_path','[]'::jsonb,'tags','[]'::jsonb,'chunk_ids','[]'::jsonb,'normalized_terms','[]'::jsonb,'source_chunk_ids','[]'::jsonb,'source_image_ids','[]'::jsonb,'summary','','extraction_quality','unknown','extraction_mode','deterministic','quality_score',0.7,'confidence',0.5)
      || v_row || jsonb_build_object('owner_id',v_locked->'document'->'owner_id','producer','local-worker','artifact_generation_id',p_artifact_generation,'index_generation_id',p_artifact_generation,
      'metadata',coalesce(v_row->'metadata','{}'::jsonb) || jsonb_build_object('generated_by','local-worker','artifact_generation_id',p_artifact_generation,'index_generation_id',p_artifact_generation,
        'ingestion_lease_token',p_fence->>'lease_token','ingestion_job_kind',p_fence->>'job_kind','ingestion_job_id',p_fence->>'job_id'));
    v_row := v_row || jsonb_build_object('embedding',(v_row->'embedding')::text);
    insert into public.document_index_units(id,owner_id,document_id,unit_type,source_chunk_id,source_image_id,page_start,page_end,heading_path,title,content,normalized_terms,source_span,quality_score,extraction_mode,index_generation_id,producer,artifact_generation_id,embedding,metadata) select r.id,r.owner_id,r.document_id,r.unit_type,r.source_chunk_id,r.source_image_id,r.page_start,r.page_end,r.heading_path,r.title,r.content,r.normalized_terms,r.source_span,r.quality_score,r.extraction_mode,r.index_generation_id,r.producer,r.artifact_generation_id,r.embedding,r.metadata from jsonb_populate_record(null::public.document_index_units,v_row) r;
  end loop;
  return jsonb_build_object('ok',true,'sections',coalesce((select jsonb_agg(jsonb_build_object('id',id,'section_index',section_index)) from public.document_sections where document_id=v_document_id and artifact_generation_id=p_artifact_generation),'[]'::jsonb));
end $$;
alter function public.stage_ingestion_deep_memory(jsonb, uuid, jsonb, jsonb, jsonb) owner to postgres;
revoke all on function public.stage_ingestion_deep_memory(jsonb, uuid, jsonb, jsonb, jsonb) from public,anon,authenticated;
grant execute on function public.stage_ingestion_deep_memory(jsonb, uuid, jsonb, jsonb, jsonb) to service_role;

create or replace function public.cleanup_ingestion_deep_memory_staging(p_fence jsonb, p_artifact_generation uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_locked jsonb; v_document_id uuid;
begin
  v_locked := public.assert_current_ingestion_attempt(p_fence, (p_fence->>'expected_generation_id')::uuid);
  if v_locked is null then return jsonb_build_object('ok',false,'reason','lease_lost'); end if;
  if p_fence->>'expected_generation_id' is null then raise exception 'ingestion_attempt_required'; end if;
  v_document_id := (p_fence->>'document_id')::uuid;
  if v_locked->'document'->'metadata'->'deep_memory_generations'->>'local-worker'=p_artifact_generation::text then raise exception 'cannot_cleanup_committed_deep_memory'; end if;
  if exists(select 1 from public.document_sections where document_id=v_document_id and artifact_generation_id=p_artifact_generation
    and (producer is distinct from 'local-worker' or metadata->>'ingestion_lease_token' is distinct from p_fence->>'lease_token')) then raise exception 'deep_memory_attempt_collision'; end if;
  if exists(select 1 from public.document_memory_cards where document_id=v_document_id and artifact_generation_id=p_artifact_generation
    and (producer is distinct from 'local-worker' or metadata->>'ingestion_lease_token' is distinct from p_fence->>'lease_token')) then raise exception 'deep_memory_attempt_collision'; end if;
  if exists(select 1 from public.document_index_units where document_id=v_document_id and artifact_generation_id=p_artifact_generation
    and (producer is distinct from 'local-worker' or metadata->>'ingestion_lease_token' is distinct from p_fence->>'lease_token')) then raise exception 'deep_memory_attempt_collision'; end if;
  delete from public.document_memory_cards where document_id=v_document_id and producer='local-worker' and artifact_generation_id=p_artifact_generation and index_generation_id=p_artifact_generation and metadata->>'ingestion_lease_token'=p_fence->>'lease_token';
  delete from public.document_index_units where document_id=v_document_id and producer='local-worker' and artifact_generation_id=p_artifact_generation and index_generation_id=p_artifact_generation and metadata->>'ingestion_lease_token'=p_fence->>'lease_token';
  delete from public.document_sections where document_id=v_document_id and producer='local-worker' and artifact_generation_id=p_artifact_generation and index_generation_id=p_artifact_generation and metadata->>'ingestion_lease_token'=p_fence->>'lease_token';
  return jsonb_build_object('ok',true);
end $$;
alter function public.cleanup_ingestion_deep_memory_staging(jsonb, uuid) owner to postgres;
revoke all on function public.cleanup_ingestion_deep_memory_staging(jsonb, uuid) from public,anon,authenticated;
grant execute on function public.cleanup_ingestion_deep_memory_staging(jsonb, uuid) to service_role;

create or replace function public.commit_document_deep_memory_generation(p_fence jsonb, p_artifact_generation uuid, p_rag_memory_version text, p_document_intelligence_version text, p_section_count integer, p_memory_card_count integer, p_index_unit_counts_by_type jsonb, p_anchors jsonb, p_aliases jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_locked jsonb; v_document_id uuid; v_anchor jsonb; v_alias jsonb; v_repaired integer:=0; v_result jsonb; v_request jsonb; v_receipt jsonb;
begin
  v_locked := public.assert_current_ingestion_attempt(p_fence, (p_fence->>'expected_generation_id')::uuid);
  if v_locked is null then return jsonb_build_object('ok',false,'reason','lease_lost'); end if;
  if p_fence->>'expected_generation_id' is null then raise exception 'ingestion_attempt_required'; end if;
  v_document_id := (p_fence->>'document_id')::uuid;
  if exists(select 1 from public.document_sections where document_id=v_document_id and artifact_generation_id=p_artifact_generation
    and (producer is distinct from 'local-worker' or metadata->>'ingestion_lease_token' is distinct from p_fence->>'lease_token')) then raise exception 'deep_memory_attempt_collision'; end if;
  if exists(select 1 from public.document_memory_cards where document_id=v_document_id and artifact_generation_id=p_artifact_generation
    and (producer is distinct from 'local-worker' or metadata->>'ingestion_lease_token' is distinct from p_fence->>'lease_token')) then raise exception 'deep_memory_attempt_collision'; end if;
  if exists(select 1 from public.document_index_units where document_id=v_document_id and artifact_generation_id=p_artifact_generation
    and (producer is distinct from 'local-worker' or metadata->>'ingestion_lease_token' is distinct from p_fence->>'lease_token')) then raise exception 'deep_memory_attempt_collision'; end if;
  v_request := jsonb_build_object('fence',p_fence,'artifact_generation',p_artifact_generation,
    'rag_memory_version',p_rag_memory_version,'document_intelligence_version',p_document_intelligence_version,
    'section_count',p_section_count,'memory_card_count',p_memory_card_count,'index_unit_counts_by_type',p_index_unit_counts_by_type,
    'anchors',p_anchors,'aliases',p_aliases);
  v_receipt := v_locked->'document'->'metadata'->'deep_memory_commit_receipts'->'local-worker';
  if v_receipt->'request'->>'artifact_generation'=p_artifact_generation::text then
    if v_receipt->'request' is distinct from v_request then raise exception 'deep_memory_commit_identity_mismatch'; end if;
    return (v_receipt->'result') || jsonb_build_object('ok',true);
  end if;
  if jsonb_typeof(p_aliases) is distinct from 'array' or jsonb_array_length(p_aliases)>500 or jsonb_typeof(p_anchors) is distinct from 'array' or jsonb_array_length(p_anchors)>100000 then raise exception 'invalid_deep_memory_commit_payload'; end if;
  for v_anchor in select value from jsonb_array_elements(p_anchors) loop
    if coalesce(v_anchor->>'anchor_id','')='' or not exists(select 1 from public.document_chunks where id=(v_anchor->>'id')::uuid and document_id=v_document_id and index_generation_id=(p_fence->>'expected_generation_id')::uuid) then raise exception 'deep_memory_anchor_membership_mismatch'; end if;
    update public.document_chunks set anchor_id=v_anchor->>'anchor_id',metadata=metadata || jsonb_build_object('anchor_id',v_anchor->>'anchor_id','anchor_repaired_by',p_document_intelligence_version)
    where id=(v_anchor->>'id')::uuid and document_id=v_document_id and index_generation_id=(p_fence->>'expected_generation_id')::uuid and anchor_id is null;
    if found then v_repaired:=v_repaired+1; end if;
  end loop;
  update public.document_chunks set metadata=metadata || jsonb_build_object('rag_indexing_version',p_rag_memory_version,'rag_memory_version',p_rag_memory_version,'rag_memory_updated_at',pg_catalog.clock_timestamp(),'document_intelligence_version',p_document_intelligence_version)
    where document_id=v_document_id and index_generation_id=(p_fence->>'expected_generation_id')::uuid;
  v_result := public.commit_document_deep_memory_generation(v_document_id,'local-worker',p_artifact_generation,p_rag_memory_version,p_document_intelligence_version,p_section_count,p_memory_card_count,p_index_unit_counts_by_type,v_repaired);
  if jsonb_typeof(v_result) is distinct from 'object' or v_result->'ok'='false'::jsonb
    or v_result->>'document_id' is distinct from v_document_id::text
    or v_result->>'producer' is distinct from 'local-worker'
    or v_result->>'artifact_generation_id' is distinct from p_artifact_generation::text
    or v_result->>'index_generation_id' is distinct from p_fence->>'expected_generation_id'
    then raise exception 'invalid_deep_memory_commit_result'; end if;
  -- Alias writes and generation commit share this rollback boundary. Foreign/manual aliases remain untouched.
  perform 1 from public.rag_aliases where metadata->>'document_id'=v_document_id::text order by id for update;
  delete from public.rag_aliases where metadata->>'document_id'=v_document_id::text and metadata->>'generated_by'='local-worker';
  for v_alias in select value from jsonb_array_elements(p_aliases) loop
    perform public.assert_ingestion_artifact_sources(v_alias->'metadata',v_document_id,(p_fence->>'expected_generation_id')::uuid,null);
    if exists(select 1 from public.rag_aliases where owner_id is not distinct from (v_locked->'document'->>'owner_id')::uuid and alias=v_alias->>'alias' and alias_type=v_alias->>'alias_type') then raise exception 'deep_memory_alias_owner_collision'; end if;
    insert into public.rag_aliases(owner_id,alias,canonical,alias_type,weight,enabled,metadata)
      values((v_locked->'document'->>'owner_id')::uuid,v_alias->>'alias',v_alias->>'canonical',v_alias->>'alias_type',(v_alias->>'weight')::real,true,
        v_alias->'metadata' || jsonb_build_object('document_id',v_document_id,'generated_by','local-worker','artifact_generation_id',p_artifact_generation,'ingestion_lease_token',p_fence->>'lease_token'));
  end loop;
  update public.documents set metadata=public.jsonb_merge_deep(metadata,jsonb_build_object('deep_memory_commit_receipts',jsonb_build_object('local-worker',jsonb_build_object('request',v_request,'result',v_result)))) where id=v_document_id;
  return v_result || jsonb_build_object('ok',true);

end $$;
alter function public.commit_document_deep_memory_generation(jsonb, uuid, text, text, integer, integer, jsonb, jsonb, jsonb) owner to postgres;
revoke all on function public.commit_document_deep_memory_generation(jsonb, uuid, text, text, integer, integer, jsonb, jsonb, jsonb) from public,anon,authenticated;
grant execute on function public.commit_document_deep_memory_generation(jsonb, uuid, text, text, integer, integer, jsonb, jsonb, jsonb) to service_role;

revoke all on function public.commit_document_deep_memory_generation(uuid,text,uuid,text,text,integer,integer,jsonb,integer) from public,anon,authenticated,service_role;

create or replace function public.replace_indexing_v3_sections(p_fence jsonb, p_sections jsonb, p_units jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_locked jsonb; v_document_id uuid; v_generation uuid; v_row jsonb;
begin
  v_locked:=public.assert_current_ingestion_attempt(p_fence,(p_fence->>'expected_generation_id')::uuid);
  if v_locked is null then return jsonb_build_object('ok',false,'reason','lease_lost'); end if;
  if p_fence->>'job_kind'<>'indexing_v3' then raise exception 'indexing_v3_attempt_required'; end if;
  v_document_id:=(p_fence->>'document_id')::uuid; v_generation:=(p_fence->>'expected_generation_id')::uuid;
  if p_sections is not null and p_sections<>'null'::jsonb then
    if jsonb_typeof(p_sections)<>'array' or jsonb_array_length(p_sections)>500 then raise exception 'invalid_indexing_v3_family'; end if;
    perform 1 from public.document_sections where document_id=v_document_id and index_generation_id=v_generation order by id for update;
    if exists(select 1 from public.document_memory_cards c join public.document_sections x on x.id=c.section_id
      where x.document_id=v_document_id and x.index_generation_id=v_generation and x.metadata->>'generated_by'='indexing-v3-agent') then raise exception 'indexing_v3_section_still_referenced'; end if;
    delete from public.document_sections where document_id=v_document_id and index_generation_id=v_generation and metadata->>'generated_by'='indexing-v3-agent' and (true);
    for v_row in select value from jsonb_array_elements(p_sections) loop
      if v_row->>'document_id' is distinct from v_document_id::text then raise exception 'indexing_v3_document_mismatch'; end if;
      perform public.assert_ingestion_artifact_sources(v_row,v_document_id,v_generation,null);
      v_row:=jsonb_build_object('id',gen_random_uuid(),'heading_path','[]'::jsonb,'tags','[]'::jsonb,'chunk_ids','[]'::jsonb,'normalized_terms','[]'::jsonb,'source_chunk_ids','[]'::jsonb,'source_image_ids','[]'::jsonb,'summary','','extraction_quality','unknown','extraction_mode','deterministic','quality_score',0.7,'confidence',0.5)
        || v_row || jsonb_build_object('owner_id',v_locked->'document'->'owner_id','index_generation_id',v_generation,'producer','indexing-v3-agent',
          'metadata',coalesce(v_row->'metadata','{}'::jsonb) || jsonb_build_object('generated_by','indexing-v3-agent','index_generation_id',v_generation,'ingestion_lease_token',p_fence->>'lease_token','ingestion_job_id',p_fence->>'job_id','ingestion_job_kind','indexing_v3'));

      insert into public.document_sections(id,document_id,owner_id,section_index,heading,heading_path,page_start,page_end,chunk_ids,summary,tags,extraction_quality,index_generation_id,producer,artifact_generation_id,metadata) select r.id,r.document_id,r.owner_id,r.section_index,r.heading,r.heading_path,r.page_start,r.page_end,r.chunk_ids,r.summary,r.tags,r.extraction_quality,r.index_generation_id,r.producer,r.artifact_generation_id,r.metadata from jsonb_populate_record(null::public.document_sections,v_row) r;
    end loop;
  end if;
  if p_units is not null and p_units<>'null'::jsonb then
    if jsonb_typeof(p_units)<>'array' or jsonb_array_length(p_units)>500 then raise exception 'invalid_indexing_v3_family'; end if;
    perform 1 from public.document_index_units where document_id=v_document_id and index_generation_id=v_generation order by id for update;
    delete from public.document_index_units where document_id=v_document_id and index_generation_id=v_generation and metadata->>'generated_by'='indexing-v3-agent' and (unit_type='section_summary');
    for v_row in select value from jsonb_array_elements(p_units) loop
      if v_row->>'document_id' is distinct from v_document_id::text then raise exception 'indexing_v3_document_mismatch'; end if;
      perform public.assert_ingestion_artifact_sources(v_row,v_document_id,v_generation,null);
      v_row:=jsonb_build_object('id',gen_random_uuid(),'heading_path','[]'::jsonb,'tags','[]'::jsonb,'chunk_ids','[]'::jsonb,'normalized_terms','[]'::jsonb,'source_chunk_ids','[]'::jsonb,'source_image_ids','[]'::jsonb,'summary','','extraction_quality','unknown','extraction_mode','deterministic','quality_score',0.7,'confidence',0.5)
        || v_row || jsonb_build_object('owner_id',v_locked->'document'->'owner_id','index_generation_id',v_generation,'producer','indexing-v3-agent',
          'metadata',coalesce(v_row->'metadata','{}'::jsonb) || jsonb_build_object('generated_by','indexing-v3-agent','index_generation_id',v_generation,'ingestion_lease_token',p_fence->>'lease_token','ingestion_job_id',p_fence->>'job_id','ingestion_job_kind','indexing_v3'));
      v_row:=v_row || jsonb_build_object('embedding',(v_row->'embedding')::text);
      insert into public.document_index_units(id,owner_id,document_id,unit_type,source_chunk_id,source_image_id,page_start,page_end,heading_path,title,content,normalized_terms,source_span,quality_score,extraction_mode,index_generation_id,producer,artifact_generation_id,embedding,metadata) select r.id,r.owner_id,r.document_id,r.unit_type,r.source_chunk_id,r.source_image_id,r.page_start,r.page_end,r.heading_path,r.title,r.content,r.normalized_terms,r.source_span,r.quality_score,r.extraction_mode,r.index_generation_id,r.producer,r.artifact_generation_id,r.embedding,r.metadata from jsonb_populate_record(null::public.document_index_units,v_row) r;
    end loop;
  end if;

  return jsonb_build_object('ok',true);
end $$;
alter function public.replace_indexing_v3_sections(jsonb, jsonb, jsonb) owner to postgres;
revoke all on function public.replace_indexing_v3_sections(jsonb, jsonb, jsonb) from public,anon,authenticated;
grant execute on function public.replace_indexing_v3_sections(jsonb, jsonb, jsonb) to service_role;

create or replace function public.replace_indexing_v3_memory_cards(p_fence jsonb, p_cards jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_locked jsonb; v_document_id uuid; v_generation uuid; v_row jsonb;
begin
  v_locked:=public.assert_current_ingestion_attempt(p_fence,(p_fence->>'expected_generation_id')::uuid);
  if v_locked is null then return jsonb_build_object('ok',false,'reason','lease_lost'); end if;
  if p_fence->>'job_kind'<>'indexing_v3' then raise exception 'indexing_v3_attempt_required'; end if;
  v_document_id:=(p_fence->>'document_id')::uuid; v_generation:=(p_fence->>'expected_generation_id')::uuid;
  if p_cards is not null and p_cards<>'null'::jsonb then
    if jsonb_typeof(p_cards)<>'array' or jsonb_array_length(p_cards)>500 then raise exception 'invalid_indexing_v3_family'; end if;
    perform 1 from public.document_memory_cards where document_id=v_document_id and index_generation_id=v_generation order by id for update;
    delete from public.document_memory_cards where document_id=v_document_id and index_generation_id=v_generation and metadata->>'generated_by'='indexing-v3-agent' and (metadata->>'source'='document_sections');
    for v_row in select value from jsonb_array_elements(p_cards) loop
      if v_row->>'document_id' is distinct from v_document_id::text then raise exception 'indexing_v3_document_mismatch'; end if;
      perform public.assert_ingestion_artifact_sources(v_row,v_document_id,v_generation,null);
      v_row:=jsonb_build_object('id',gen_random_uuid(),'heading_path','[]'::jsonb,'tags','[]'::jsonb,'chunk_ids','[]'::jsonb,'normalized_terms','[]'::jsonb,'source_chunk_ids','[]'::jsonb,'source_image_ids','[]'::jsonb,'summary','','extraction_quality','unknown','extraction_mode','deterministic','quality_score',0.7,'confidence',0.5)
        || v_row || jsonb_build_object('owner_id',v_locked->'document'->'owner_id','index_generation_id',v_generation,'producer','indexing-v3-agent',
          'metadata',coalesce(v_row->'metadata','{}'::jsonb) || jsonb_build_object('generated_by','indexing-v3-agent','index_generation_id',v_generation,'ingestion_lease_token',p_fence->>'lease_token','ingestion_job_id',p_fence->>'job_id','ingestion_job_kind','indexing_v3'));
      v_row:=v_row || jsonb_build_object('embedding',(v_row->'embedding')::text);
      insert into public.document_memory_cards(id,document_id,owner_id,section_id,card_type,title,content,normalized_terms,page_number,source_chunk_ids,source_image_ids,confidence,index_generation_id,producer,artifact_generation_id,metadata,embedding) select r.id,r.document_id,r.owner_id,r.section_id,r.card_type,r.title,r.content,r.normalized_terms,r.page_number,r.source_chunk_ids,r.source_image_ids,r.confidence,r.index_generation_id,r.producer,r.artifact_generation_id,r.metadata,r.embedding from jsonb_populate_record(null::public.document_memory_cards,v_row) r;
    end loop;
  end if;

  return jsonb_build_object('ok',true);
end $$;
alter function public.replace_indexing_v3_memory_cards(jsonb, jsonb) owner to postgres;
revoke all on function public.replace_indexing_v3_memory_cards(jsonb, jsonb) from public,anon,authenticated;
grant execute on function public.replace_indexing_v3_memory_cards(jsonb, jsonb) to service_role;

create or replace function public.replace_indexing_v3_core_embeddings(p_fence jsonb, p_fields jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_locked jsonb; v_document_id uuid; v_generation uuid; v_row jsonb;
begin
  v_locked:=public.assert_current_ingestion_attempt(p_fence,(p_fence->>'expected_generation_id')::uuid);
  if v_locked is null then return jsonb_build_object('ok',false,'reason','lease_lost'); end if;
  if p_fence->>'job_kind'<>'indexing_v3' then raise exception 'indexing_v3_attempt_required'; end if;
  v_document_id:=(p_fence->>'document_id')::uuid; v_generation:=(p_fence->>'expected_generation_id')::uuid;
  if p_fields is not null and p_fields<>'null'::jsonb then
    if jsonb_typeof(p_fields)<>'array' or jsonb_array_length(p_fields)>500 then raise exception 'invalid_indexing_v3_family'; end if;
    perform 1 from public.document_embedding_fields where document_id=v_document_id and index_generation_id=v_generation order by id for update;
    delete from public.document_embedding_fields where document_id=v_document_id and index_generation_id=v_generation and metadata->>'generated_by'='indexing-v3-agent' and (field_type in ('document_title','document_summary'));
    for v_row in select value from jsonb_array_elements(p_fields) loop
      if v_row->>'document_id' is distinct from v_document_id::text then raise exception 'indexing_v3_document_mismatch'; end if;
      perform public.assert_ingestion_artifact_sources(v_row,v_document_id,v_generation,null);
      v_row:=jsonb_build_object('id',gen_random_uuid(),'heading_path','[]'::jsonb,'tags','[]'::jsonb,'chunk_ids','[]'::jsonb,'normalized_terms','[]'::jsonb,'source_chunk_ids','[]'::jsonb,'source_image_ids','[]'::jsonb,'summary','','extraction_quality','unknown','extraction_mode','deterministic','quality_score',0.7,'confidence',0.5)
        || v_row || jsonb_build_object('owner_id',v_locked->'document'->'owner_id','index_generation_id',v_generation,'producer','indexing-v3-agent',
          'metadata',coalesce(v_row->'metadata','{}'::jsonb) || jsonb_build_object('generated_by','indexing-v3-agent','index_generation_id',v_generation,'ingestion_lease_token',p_fence->>'lease_token','ingestion_job_id',p_fence->>'job_id','ingestion_job_kind','indexing_v3'));
      v_row:=v_row || jsonb_build_object('embedding',(v_row->'embedding')::text);
      insert into public.document_embedding_fields(id,owner_id,document_id,source_chunk_id,field_type,content,content_hash,embedding,index_generation_id,metadata) select r.id,r.owner_id,r.document_id,r.source_chunk_id,r.field_type,r.content,r.content_hash,r.embedding,r.index_generation_id,r.metadata from jsonb_populate_record(null::public.document_embedding_fields,v_row) r;
    end loop;
  end if;

  return jsonb_build_object('ok',true);
end $$;
alter function public.replace_indexing_v3_core_embeddings(jsonb, jsonb) owner to postgres;
revoke all on function public.replace_indexing_v3_core_embeddings(jsonb, jsonb) from public,anon,authenticated;
grant execute on function public.replace_indexing_v3_core_embeddings(jsonb, jsonb) to service_role;

create or replace function public.replace_indexing_v3_visual_artifacts(p_fence jsonb, p_images jsonb, p_units jsonb, p_fields jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_locked jsonb; v_document_id uuid; v_generation uuid; v_row jsonb;
begin
  v_locked:=public.assert_current_ingestion_attempt(p_fence,(p_fence->>'expected_generation_id')::uuid);
  if v_locked is null then return jsonb_build_object('ok',false,'reason','lease_lost'); end if;
  if p_fence->>'job_kind'<>'indexing_v3' then raise exception 'indexing_v3_attempt_required'; end if;
  v_document_id:=(p_fence->>'document_id')::uuid; v_generation:=(p_fence->>'expected_generation_id')::uuid;
  if jsonb_typeof(p_images) is distinct from 'array' or jsonb_array_length(p_images)>500 then raise exception 'invalid_indexing_v3_images'; end if;
  for v_row in select value from jsonb_array_elements(p_images) loop
    if jsonb_typeof(v_row) is distinct from 'object' or jsonb_typeof(v_row->'metadata') is distinct from 'object' or exists(select 1 from jsonb_object_keys(v_row->'metadata') k where k not in ('v3_structured_visual','v3_visual_metrics')) then raise exception 'invalid_indexing_v3_image_metadata'; end if;
    update public.document_images set metadata=metadata || v_row->'metadata' where id=(v_row->>'id')::uuid and document_id=v_document_id and index_generation_id=v_generation;
    if not found then raise exception 'indexing_v3_image_identity_mismatch'; end if;
  end loop;
  if p_units is not null and p_units<>'null'::jsonb then
    if jsonb_typeof(p_units)<>'array' or jsonb_array_length(p_units)>500 then raise exception 'invalid_indexing_v3_family'; end if;
    perform 1 from public.document_index_units where document_id=v_document_id and index_generation_id=v_generation order by id for update;
    delete from public.document_index_units where document_id=v_document_id and index_generation_id=v_generation and metadata->>'generated_by'='indexing-v3-agent' and (unit_type<>'section_summary');
    for v_row in select value from jsonb_array_elements(p_units) loop
      if v_row->>'document_id' is distinct from v_document_id::text then raise exception 'indexing_v3_document_mismatch'; end if;
      perform public.assert_ingestion_artifact_sources(v_row,v_document_id,v_generation,null);
      v_row:=jsonb_build_object('id',gen_random_uuid(),'heading_path','[]'::jsonb,'tags','[]'::jsonb,'chunk_ids','[]'::jsonb,'normalized_terms','[]'::jsonb,'source_chunk_ids','[]'::jsonb,'source_image_ids','[]'::jsonb,'summary','','extraction_quality','unknown','extraction_mode','deterministic','quality_score',0.7,'confidence',0.5)
        || v_row || jsonb_build_object('owner_id',v_locked->'document'->'owner_id','index_generation_id',v_generation,'producer','indexing-v3-agent',
          'metadata',coalesce(v_row->'metadata','{}'::jsonb) || jsonb_build_object('generated_by','indexing-v3-agent','index_generation_id',v_generation,'ingestion_lease_token',p_fence->>'lease_token','ingestion_job_id',p_fence->>'job_id','ingestion_job_kind','indexing_v3'));
      v_row:=v_row || jsonb_build_object('embedding',(v_row->'embedding')::text);
      insert into public.document_index_units(id,owner_id,document_id,unit_type,source_chunk_id,source_image_id,page_start,page_end,heading_path,title,content,normalized_terms,source_span,quality_score,extraction_mode,index_generation_id,producer,artifact_generation_id,embedding,metadata) select r.id,r.owner_id,r.document_id,r.unit_type,r.source_chunk_id,r.source_image_id,r.page_start,r.page_end,r.heading_path,r.title,r.content,r.normalized_terms,r.source_span,r.quality_score,r.extraction_mode,r.index_generation_id,r.producer,r.artifact_generation_id,r.embedding,r.metadata from jsonb_populate_record(null::public.document_index_units,v_row) r;
    end loop;
  end if;
  if p_fields is not null and p_fields<>'null'::jsonb then
    if jsonb_typeof(p_fields)<>'array' or jsonb_array_length(p_fields)>500 then raise exception 'invalid_indexing_v3_family'; end if;
    perform 1 from public.document_embedding_fields where document_id=v_document_id and index_generation_id=v_generation order by id for update;
    delete from public.document_embedding_fields where document_id=v_document_id and index_generation_id=v_generation and metadata->>'generated_by'='indexing-v3-agent' and (field_type not in ('document_title','document_summary'));
    for v_row in select value from jsonb_array_elements(p_fields) loop
      if v_row->>'document_id' is distinct from v_document_id::text then raise exception 'indexing_v3_document_mismatch'; end if;
      perform public.assert_ingestion_artifact_sources(v_row,v_document_id,v_generation,null);
      v_row:=jsonb_build_object('id',gen_random_uuid(),'heading_path','[]'::jsonb,'tags','[]'::jsonb,'chunk_ids','[]'::jsonb,'normalized_terms','[]'::jsonb,'source_chunk_ids','[]'::jsonb,'source_image_ids','[]'::jsonb,'summary','','extraction_quality','unknown','extraction_mode','deterministic','quality_score',0.7,'confidence',0.5)
        || v_row || jsonb_build_object('owner_id',v_locked->'document'->'owner_id','index_generation_id',v_generation,'producer','indexing-v3-agent',
          'metadata',coalesce(v_row->'metadata','{}'::jsonb) || jsonb_build_object('generated_by','indexing-v3-agent','index_generation_id',v_generation,'ingestion_lease_token',p_fence->>'lease_token','ingestion_job_id',p_fence->>'job_id','ingestion_job_kind','indexing_v3'));
      v_row:=v_row || jsonb_build_object('embedding',(v_row->'embedding')::text);
      insert into public.document_embedding_fields(id,owner_id,document_id,source_chunk_id,field_type,content,content_hash,embedding,index_generation_id,metadata) select r.id,r.owner_id,r.document_id,r.source_chunk_id,r.field_type,r.content,r.content_hash,r.embedding,r.index_generation_id,r.metadata from jsonb_populate_record(null::public.document_embedding_fields,v_row) r;
    end loop;
  end if;

  return jsonb_build_object('ok',true);
end $$;
alter function public.replace_indexing_v3_visual_artifacts(jsonb, jsonb, jsonb, jsonb) owner to postgres;
revoke all on function public.replace_indexing_v3_visual_artifacts(jsonb, jsonb, jsonb, jsonb) from public,anon,authenticated;
grant execute on function public.replace_indexing_v3_visual_artifacts(jsonb, jsonb, jsonb, jsonb) to service_role;


-- Planning records are evidence of a requested dry run, never authority to apply it.
create table public.ingestion_repair_plan_audit (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  plan jsonb not null,
  plan_digest text not null check (plan_digest ~ '^sha256:[0-9a-f]{64}$'),
  outcome text not null default 'planned' check (outcome = 'planned')
);
alter table public.ingestion_repair_plan_audit enable row level security;
revoke all on table public.ingestion_repair_plan_audit from public,anon,authenticated,service_role;
grant select on table public.ingestion_repair_plan_audit to service_role;

create function public.reject_ingestion_repair_audit_mutation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin raise exception 'ingestion_repair_plan_audit_append_only'; end $$;
alter function public.reject_ingestion_repair_audit_mutation() owner to postgres;
revoke all on function public.reject_ingestion_repair_audit_mutation() from public,anon,authenticated,service_role;
create trigger ingestion_repair_plan_audit_no_row_change before update or delete on public.ingestion_repair_plan_audit
for each row execute function public.reject_ingestion_repair_audit_mutation();
create trigger ingestion_repair_plan_audit_no_truncate before truncate on public.ingestion_repair_plan_audit
for each statement execute function public.reject_ingestion_repair_audit_mutation();

create function public.record_ingestion_repair_plan(p_plan jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_document jsonb; v_documents jsonb := '[]'::jsonb; v_reasons jsonb; v_seen text[] := '{}'::text[];
  v_bytes text := E'ingestion-repair-plan-v1\n'; v_digest text; v_plan jsonb; v_id uuid;
begin
  if jsonb_typeof(p_plan) is distinct from 'object' or (select count(*) from jsonb_object_keys(p_plan)) <> 4
    or not (p_plan ?& array['version','dryRun','documents','planDigest'])
    or p_plan->>'version' is distinct from 'ingestion-repair-plan-v1' or p_plan->'dryRun' is distinct from 'true'::jsonb
    or jsonb_typeof(p_plan->'documents') is distinct from 'array' then raise exception 'invalid_ingestion_repair_plan'; end if;
  if jsonb_array_length(p_plan->'documents') not between 1 and 100 then raise exception 'invalid_ingestion_repair_plan'; end if;
  for v_document in select value from jsonb_array_elements(p_plan->'documents') order by value->>'documentId' collate "C" loop
    if jsonb_typeof(v_document) is distinct from 'object' then raise exception 'invalid_ingestion_repair_plan'; end if;
    if (select count(*) from jsonb_object_keys(v_document)) <> 3 or not (v_document ?& array['documentId','reasonCodes','expectedStateDigest'])
      or jsonb_typeof(v_document->'documentId') is distinct from 'string'
      or coalesce(v_document->>'documentId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or v_document->>'documentId'=any(v_seen)
      or jsonb_typeof(v_document->'expectedStateDigest') is distinct from 'string'
      or coalesce(v_document->>'expectedStateDigest','') !~ '^sha256:[0-9a-f]{64}$'
      or jsonb_typeof(v_document->'reasonCodes') is distinct from 'array' then raise exception 'invalid_ingestion_repair_plan'; end if;
    if jsonb_array_length(v_document->'reasonCodes') not between 1 and 6
      or exists(select 1 from jsonb_array_elements(v_document->'reasonCodes') r(value) where jsonb_typeof(r.value) is distinct from 'string'
        or r.value #>> '{}' not in ('missing_committed_generation','generation_mismatch','summary_missing','summary_invalid','summary_fallback_growth','lease_abandoned'))
      or (select count(distinct value) from jsonb_array_elements(v_document->'reasonCodes')) <> jsonb_array_length(v_document->'reasonCodes') then raise exception 'invalid_ingestion_repair_plan'; end if;
    select jsonb_agg(value order by value collate "C") into v_reasons from jsonb_array_elements_text(v_document->'reasonCodes');
    v_seen := array_append(v_seen,v_document->>'documentId');
    v_documents := v_documents || jsonb_build_array(v_document || jsonb_build_object('reasonCodes',v_reasons));
    v_bytes := v_bytes || (v_document->>'documentId') || E'\t' || (select string_agg(value,',' order by value collate "C") from jsonb_array_elements_text(v_reasons)) || E'\t' || (v_document->>'expectedStateDigest') || E'\n';
  end loop;
  v_digest := 'sha256:' || encode(extensions.digest(convert_to(v_bytes,'UTF8'),'sha256'),'hex');
  if p_plan->>'planDigest' is distinct from v_digest then raise exception 'invalid_ingestion_repair_plan'; end if;
  v_plan := jsonb_build_object('version','ingestion-repair-plan-v1','dryRun',true,'documents',v_documents,'planDigest',v_digest);
  insert into public.ingestion_repair_plan_audit(plan,plan_digest,outcome) values(v_plan,v_digest,'planned') returning id into v_id;
  return jsonb_build_object('ok',true,'id',v_id,'outcome','planned','plan',v_plan);
end $$;
alter function public.record_ingestion_repair_plan(jsonb) owner to postgres;
revoke all on function public.record_ingestion_repair_plan(jsonb) from public,anon,authenticated;
grant execute on function public.record_ingestion_repair_plan(jsonb) to service_role;

revoke all on function public.commit_document_index_generation(uuid,uuid,text,integer,integer,integer,jsonb,jsonb,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.fail_or_retry_ingestion_job(uuid,uuid,uuid,boolean,text,text,text,timestamptz,text) from public,anon,authenticated,service_role;
revoke all on function public.update_indexing_v3_agent_job_status(uuid,text,text,timestamptz) from public,anon,authenticated,service_role;
alter function public.lock_ingestion_document_authority(uuid,boolean) owner to postgres;
alter function public.assert_current_ingestion_attempt(jsonb,uuid) owner to postgres;
alter function public.claim_ingestion_jobs(text,integer,integer) owner to postgres;
alter function public.claim_indexing_v3_agent_jobs(text,integer,integer) owner to postgres;
alter function public.persist_ingestion_summary_projection(jsonb,jsonb,jsonb,jsonb) owner to postgres;
alter table public.ingestion_repair_plan_audit owner to postgres;

-- Reviewed P05 privilege correction: exact three tables and eleven internal helpers.
-- Default declarations prove inherited INSERT/UPDATE/DELETE, not every possible table privilege.
-- Explicitly reset only the three selected P05 tables to the contract's intended SELECT grant.
revoke all on table public.public_source_activation_events from service_role;
revoke all on table public.public_source_versions from service_role;
revoke all on table public.public_source_serving_authority from service_role;
grant select on table public.public_source_activation_events to service_role;
grant select on table public.public_source_versions to service_role;
grant select on table public.public_source_serving_authority to service_role;

-- Retain direct calls through governed service-role entrypoints; these are their selected internal dependencies.
revoke all on function public.reject_public_source_activation_event_mutation() from service_role;
revoke all on function public.guard_public_source_version_identity() from service_role;
revoke all on function public.bump_public_source_serving_authority() from service_role;
revoke all on function public.public_source_acquisition_identity_digest(uuid) from service_role;
revoke all on function public.make_public_source_version_ineligible(uuid,text) from service_role;
revoke all on function public.make_public_source_version_ineligible(uuid) from service_role;
revoke all on function public.public_source_document_is_serving_eligible(uuid) from service_role;
revoke all on function public.require_active_public_source_version_for_publication() from service_role;
revoke all on function public.require_active_public_source_artifact_for_publication() from service_role;
revoke all on function public.require_document_publication_approval_state_digest() from service_role;
revoke all on function public.guard_document_publication_transition() from service_role;
