-- DRAFT: a readmission's flat ranking fields (publisher, jurisdiction, dates,
-- document_status, supersedes_document_id, source_role, licence_policy,
-- rights_evidence_ref) wait in metadata.pending_reindex_authority until a
-- successful reindex terminal commits the generation. The admission marker,
-- metadata.authority and provider_processing stay live so the attempt can claim.
-- The non-catalogue authority digest binds the pending values when present, so
-- existing digests are unchanged and the apply step does not move the fence.
-- Applying fails closed if a live flat value changed mid-attempt (for example a
-- licence withdrawal). No grants widen; no historical migration is resealed.
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';

create function ingestion_generation_evidence.pending_reindex_authority_valid(m jsonb)
returns boolean language sql immutable set search_path='' as $$
 select coalesce(ingestion_generation_evidence.keys(m->'pending_reindex_authority',array['version','admissionEventId','values','prior'])
  and m#>>'{pending_reindex_authority,version}'='pending-reindex-authority-v1'
  and m#>'{pending_reindex_authority,admissionEventId}'=m->'admission_event_id'
  and ingestion_generation_evidence.keys(m#>'{pending_reindex_authority,values}',array['source_role','licence_policy','rights_evidence_ref','publisher','jurisdiction','publication_date','effective_date','review_date','expiry_date','document_status','supersedes_document_id'])
  and ingestion_generation_evidence.keys(m#>'{pending_reindex_authority,prior}',array['source_role','licence_policy','rights_evidence_ref','publisher','jurisdiction','publication_date','effective_date','review_date','expiry_date','document_status','supersedes_document_id']),false)
$$;

-- Idempotent: a document without a pending block is left untouched. Callers run
-- it only after commit_document_index_generation and complete_ingestion_job succeed,
-- inside the same transaction, so a refusal here rolls the whole terminal back.
create function ingestion_generation_evidence.apply_pending_reindex_authority(p_document_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare m jsonb;k text;
begin
 select metadata into strict m from public.documents where id=p_document_id for update;
 if not (m ? 'pending_reindex_authority') then return;end if;
 if not ingestion_generation_evidence.pending_reindex_authority_valid(m) then raise exception 'pending_reindex_authority_invalid';end if;
 foreach k in array array['source_role','licence_policy','rights_evidence_ref','publisher','jurisdiction','publication_date','effective_date','review_date','expiry_date','document_status','supersedes_document_id'] loop
  if coalesce(m->k,'null'::jsonb) is distinct from m#>array['pending_reindex_authority','prior',k] then
   raise exception 'pending_reindex_authority_live_changed';end if;
 end loop;
 update public.documents set metadata=(m-'pending_reindex_authority')||(m#>'{pending_reindex_authority,values}') where id=p_document_id;
end $$;

create or replace function public.lock_ingestion_document_authority(p_document_id uuid, p_try boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_key text; v_version_id uuid; v_document public.documents%rowtype;
  v_version public.public_source_versions%rowtype; v_event public.public_source_activation_events%rowtype;
  v_policy public.public_source_policy_entries%rowtype;
  v_attempt public.public_source_upload_attempts%rowtype;
  v_digest text; v_metadata jsonb; v_effective jsonb;
begin
  select v.id, v.source_catalogue_key into v_version_id, v_key
  from public.public_source_versions v where v.staging_document_id = p_document_id;
  if v_key is null then
    select d.metadata->>'source_catalogue_key' into v_key from public.documents d where d.id = p_document_id;
  end if;
  if v_key is not null then
    if p_try then
      if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(v_key, 0)) then return null; end if;
    else
      perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_key, 0));
    end if;
    -- Match current governance writers: advisory, latest event, document, version.
    -- NOWAIT preserves the latest-event identity; SKIP LOCKED here could select an older event.
    if p_try then
      select * into v_event from public.public_source_activation_events
        where source_catalogue_key = v_key order by activation_sequence desc limit 1 for update nowait;
    else
      select * into v_event from public.public_source_activation_events
        where source_catalogue_key = v_key order by activation_sequence desc limit 1 for update;
    end if;
    if not found then return null; end if;
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
    if p_try then
      select * into v_version from public.public_source_versions where id = v_version_id for update nowait;
    else
      select * into v_version from public.public_source_versions where id = v_version_id for update;
    end if;
    if not found or v_version.staging_document_id is distinct from p_document_id
      or v_version.source_catalogue_key is distinct from v_key
      or v_metadata->>'public_source_version_id' is distinct from v_version.id::text then return null; end if;
    -- Finalization uses this same upload-attempt lock after the version lock.
    if p_try then
      select * into v_attempt from public.public_source_upload_attempts
        where id = v_version.finalized_upload_attempt_id for update nowait;
    else
      select * into v_attempt from public.public_source_upload_attempts
        where id = v_version.finalized_upload_attempt_id for update;
    end if;
    if not found or v_attempt.state is distinct from 'finalized'
      or v_version.current_upload_attempt_id is distinct from v_attempt.id
      or v_attempt.version_id is distinct from v_version.id
      or v_attempt.claim_token is distinct from v_version.upload_lease_token
      or v_attempt.claim_expires_at is distinct from v_version.upload_lease_expires_at
      or v_attempt.storage_bucket is distinct from v_version.storage_bucket
      or v_attempt.storage_path is distinct from v_version.reserved_storage_path then return null; end if;
    -- The existing control plane owns stewardship, latest activation, lifecycle,
    -- policy/content metadata and raw-response identity checks. Its locks are reentrant.
    begin
      perform public.assert_public_source_document_governance(p_document_id);
    exception when raise_exception then
      return null;
    end;
    select * into v_policy from public.public_source_policy_entries
      where source_catalogue_key = v_key;
    if not found or v_policy.policy_version is distinct from v_version.source_policy_version
      or v_policy.policy_digest is distinct from v_version.source_policy_digest
      or v_policy.lifecycle is distinct from 'active'
      or v_policy.content_mode is distinct from 'indexed_content'
      or v_policy.exact_document_licence is distinct from 'public_index_permitted'
      or v_event.policy_version is distinct from v_version.source_policy_version
      or v_version.intended_disposition is distinct from 'shadow'
      or v_version.upload_state is distinct from 'finalized'
      or v_version.reserved_document_id is distinct from p_document_id
      or v_version.reserved_storage_path is distinct from v_document.storage_path
      then return null; end if;
    -- Bind the current immutable control-plane identity and mutable authority.
    -- Document progress/enrichment metadata is deliberately outside this digest.
    v_digest := 'sha256:' || encode(extensions.digest(convert_to(jsonb_build_object(
      'version', to_jsonb(v_version), 'event', to_jsonb(v_event), 'policy', to_jsonb(v_policy),
      'upload_attempt', to_jsonb(v_attempt),
      'document', jsonb_build_object('id',v_document.id,'owner',v_document.owner_id,
        'source',v_document.source_path,'storage',v_document.storage_path,'file',v_document.file_name,
        'file_type',v_document.file_type,'file_size',v_document.file_size,'content_hash',v_document.content_hash),
      'source_metadata', (select jsonb_object_agg(entry.key,entry.value) from jsonb_each(v_metadata) entry
        where entry.key = any(array['corpus_scope','source_kind','source_catalogue_key','source_policy_version',
          'source_policy_digest','public_source_activation_event_id','public_source_activation_sequence',
          'public_source_version_id','public_source_steward_id','content_mode','licence_policy','canonical_url',
          'exact_version_url','version','content_hash','raw_response_hash','raw_response_byte_count',
          'acquisition_disposition','public_source_storage_bucket']))
    )::text, 'UTF8'), 'sha256'), 'hex');
  else
    -- Any public-source marker forbids silently entering the non-catalogue branch.
    if v_metadata ?| array['source_catalogue_key','source_policy_version','source_policy_digest','source_activation_event_id',
      'source_canonical_url','source_exact_url','source_exact_version','source_content_hash',
      'licence_evidence_digest','public_source_lifecycle','public_source_version_id',
      'public_source_activation_event_id','public_source_activation_sequence','public_source_steward_id',
      'public_source_storage_bucket','acquisition_disposition']
      or v_metadata->>'corpus_scope' = 'australian_public' then return null; end if;
    -- Trusted admission emits both permissions. A digest alone does not authorize
    -- provider work: missing, malformed, forbidden or conflicting values fail closed.
    -- Untagged legacy documents retain their existing eligibility semantics.
    if (v_metadata ?| array['admission_event_id','admission_policy_version','provider_processing']
        or (v_metadata->'authority') ? 'providerProcessing')
      and (v_metadata->'provider_processing' is distinct from '"permitted"'::jsonb
        or v_metadata#>'{authority,providerProcessing}' is distinct from '"permitted"'::jsonb)
      then return null; end if;
    -- A readmission's flat ranking fields wait in pending_reindex_authority until
    -- a successful terminal applies them. Bind those pending values, so applying
    -- them leaves this digest unchanged; without the block the digest input is
    -- byte-identical to the previous definition. A malformed block fails closed.
    if v_metadata ? 'pending_reindex_authority' then
      if not ingestion_generation_evidence.pending_reindex_authority_valid(v_metadata) then return null; end if;
      v_effective := v_metadata || (v_metadata#>'{pending_reindex_authority,values}');
    else
      v_effective := v_metadata;
    end if;
    v_digest := 'sha256:' || encode(extensions.digest(convert_to(jsonb_build_object(
      'owner', v_document.owner_id, 'source', v_document.source_path, 'storage', v_document.storage_path,
      'file', v_document.file_name, 'file_type', v_document.file_type, 'file_size', v_document.file_size,
      'content_hash', v_document.content_hash, 'corpus_scope', v_metadata->'corpus_scope',
      'content_mode', v_metadata->'content_mode', 'licence_policy', v_effective->'licence_policy',
      'source_policy_checked', v_metadata->'source_policy_checked', 'content_identity_verdict', v_metadata->'content_identity_verdict',
      'content_identity_hash', v_metadata->'content_identity_hash', 'content_identity_verdict_version', v_metadata->'content_identity_verdict_version',
      'canonical_storage_path', v_metadata->'canonical_storage_path', 'public_corpus', v_metadata->'public_corpus',
      'admission_event_id', v_metadata->'admission_event_id', 'admission_policy_version', v_metadata->'admission_policy_version',
      'authority', v_metadata->'authority', 'source_role', v_effective->'source_role', 'authority_basis', v_metadata->'authority_basis',
      'rights_evidence_ref', v_effective->'rights_evidence_ref', 'provider_processing', v_metadata->'provider_processing',
      'purpose', v_metadata->'purpose', 'supported_features', v_metadata->'supported_features'
    )::text, 'UTF8'), 'sha256'), 'hex');
  end if;
  return jsonb_build_object('document', to_jsonb(v_document), 'authority_digest', v_digest);
exception when lock_not_available then
  -- A claim never waits on a busy authority row; a later bounded poll may retry.
  return null;
end $$;

create or replace function public.readmit_administrator_document_for_reindex(
 p_document_id uuid,p_correlation_id uuid,p_expected_owner_id uuid,p_expected_public_corpus boolean,
 p_source_sha256 text,p_byte_count bigint,p_file_name_sha256 text,p_storage_path_sha256 text,
 p_authority jsonb,p_max_attempts integer default 1)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();claims jsonb:=auth.jwt();d public.documents;j public.ingestion_jobs; prior public.document_admission_events;
 event_id uuid:=gen_random_uuid();job_id uuid:=gen_random_uuid();request jsonb;request_digest text;admission jsonb;next_metadata jsonb;
 pair record;value text;scope text;now_at timestamptz:=clock_timestamp();date_value date;
 pending_values jsonb:='{}'::jsonb;pending_prior jsonb:='{}'::jsonb;
begin
 if actor is null or claims->>'role' is distinct from 'authenticated' or claims->>'sub' is distinct from actor::text
  or claims#>>'{app_metadata,site_role}' is distinct from 'administrator' or claims->>'aal' is distinct from 'aal2'
  or jsonb_typeof(claims->'amr') is distinct from 'array' then raise exception 'administrator_assurance_required' using errcode='42501';end if;
 if not exists(select 1 from jsonb_array_elements(claims->'amr') m where m->>'method' in ('password','otp','totp','webauthn')
  and jsonb_typeof(m->'timestamp')='number' and to_timestamp((m->>'timestamp')::double precision) between now_at-interval '900 seconds' and now_at)
  then raise exception 'administrator_recent_authentication_required' using errcode='42501';end if;
 perform 1 from auth.users u where u.id=actor and u.raw_app_meta_data->>'site_role'='administrator'
  and to_jsonb(u)->>'deleted_at' is null and (to_jsonb(u)->>'banned_until' is null or (to_jsonb(u)->>'banned_until')::timestamptz<=now_at) for share;
 if not found then raise exception 'administrator_assurance_required' using errcode='42501';end if;
 if p_document_id is null or p_correlation_id is null or p_expected_public_corpus is null or p_max_attempts is null or p_max_attempts not between 1 and 100
  or coalesce(p_source_sha256,'') !~ '^sha256:[0-9a-f]{64}$' or coalesce(p_file_name_sha256,'') !~ '^sha256:[0-9a-f]{64}$'
  or coalesce(p_storage_path_sha256,'') !~ '^sha256:[0-9a-f]{64}$' or p_byte_count is null or p_byte_count not between 1 and 157286400
  then raise exception 'readmission_invalid_identity';end if;
 select * into strict d from public.documents where id=p_document_id for update;
 scope:=case when d.owner_id=actor then 'owner_private' when d.owner_id is null and d.metadata->'public_corpus'='true'::jsonb then 'existing_shared_library_stewardship' else null end;
 if scope is null or d.owner_id is distinct from p_expected_owner_id
  or (d.metadata->'public_corpus' is not distinct from 'true'::jsonb) is distinct from p_expected_public_corpus
  then raise exception 'readmission_document_scope_required';end if;
 if d.file_type<>'application/pdf' or 'sha256:'||d.content_hash is distinct from p_source_sha256 or d.file_size<>p_byte_count
  or 'sha256:'||encode(extensions.digest(convert_to(d.file_name,'UTF8'),'sha256'),'hex')<>p_file_name_sha256
  or 'sha256:'||encode(extensions.digest(convert_to(d.storage_path,'UTF8'),'sha256'),'hex')<>p_storage_path_sha256
  then raise exception 'readmission_source_identity_mismatch';end if;
 -- This path does not bypass the separate governed public-source control plane.
 if d.metadata ?| array['public_source_version_id','public_source_activation_event_id','source_catalogue_key']
  then raise exception 'readmission_governed_source_requires_its_existing_control_plane';end if;
 if not ingestion_generation_evidence.keys(p_authority,array['version','sourceRole','authorityBasis','licencePolicy','rightsEvidenceRef','publisher','jurisdiction','publicationDate','effectiveDate','reviewDate','expiryDate','currentness','supersedesDocumentId','purpose','supportedFeatures','providerProcessing'])
  or p_authority->'version' is distinct from '1'::jsonb or p_authority->>'authorityBasis' is distinct from 'administrator_template'
  or coalesce(p_authority->>'licencePolicy','') not in ('review_required','public_index_permitted')
  or coalesce(p_authority->>'jurisdiction','') not in ('Australia','Australia/WA')
  or coalesce(p_authority->>'currentness','') not in ('current','unknown')
  or p_authority->>'purpose' is distinct from 'clinical_retrieval' or p_authority->>'providerProcessing' is distinct from 'permitted'
  or coalesce(p_authority->>'sourceRole','') not in ('local_guideline','clinical_guideline','clinical_reference','service_directory','form_reference','tool_reference','safety_alert','regulatory','quality_standard','legal','subsidy','professional_review','service_policy')
  or jsonb_typeof(p_authority->'rightsEvidenceRef') is distinct from 'string' or length(p_authority->>'rightsEvidenceRef') not between 1 and 500
  or jsonb_typeof(p_authority->'publisher') is distinct from 'string' or length(p_authority->>'publisher') not between 1 and 300
  or jsonb_typeof(p_authority->'supportedFeatures') is distinct from 'array'
  then raise exception 'readmission_invalid_authority';end if;
 if jsonb_array_length(p_authority->'supportedFeatures') not between 1 and 3
  or exists(select 1 from jsonb_array_elements_text(p_authority->'supportedFeatures') f where f not in ('images','tables','text'))
  or (select count(distinct f) from jsonb_array_elements_text(p_authority->'supportedFeatures') f)<>jsonb_array_length(p_authority->'supportedFeatures')
  or p_authority->'supportedFeatures' is distinct from (select jsonb_agg(f order by f collate "C") from jsonb_array_elements_text(p_authority->'supportedFeatures') f)
  then raise exception 'readmission_invalid_features';end if;
 foreach value in array array['publicationDate','effectiveDate','reviewDate','expiryDate'] loop
  if p_authority->value is distinct from 'null'::jsonb then
   if jsonb_typeof(p_authority->value) is distinct from 'string' or coalesce(p_authority->>value,'') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'readmission_invalid_date';end if;
   date_value:=(p_authority->>value)::date;
   if (value='effectiveDate' and date_value>current_date) or (value in ('reviewDate','expiryDate') and date_value<=current_date) then raise exception 'readmission_source_not_current';end if;
  end if;
 end loop;
 if p_authority->'supersedesDocumentId' is distinct from 'null'::jsonb and coalesce(p_authority->>'supersedesDocumentId','') !~ '^[0-9a-f-]{36}$' then raise exception 'readmission_invalid_supersession';end if;
 request:=jsonb_build_object('version','administrator-current-reindex-readmission-v1','administratorId',actor,'documentId',d.id,'documentOwnerId',d.owner_id,
  'publicCorpus',p_expected_public_corpus,'sourceSha256',p_source_sha256,'byteCount',p_byte_count,'fileNameSha256',p_file_name_sha256,'storagePathSha256',p_storage_path_sha256,'authority',p_authority,'maxAttempts',p_max_attempts,'correlationId',p_correlation_id);
 request_digest:='sha256:'||encode(extensions.digest(convert_to(request::text,'UTF8'),'sha256'),'hex');
 select * into prior from public.document_admission_events e where e.document_id=d.id and e.administrator_id=actor and e.correlation_id=p_correlation_id order by e.created_at desc limit 1;
 if found then
  if prior.request_digest<>request_digest then raise exception 'readmission_replay_conflict';end if;
  return jsonb_build_object('outcome','replayed','admissionEventId',prior.id,'jobId',prior.ingestion_job_id,'scope',scope,'documentOwnerId',d.owner_id,'stewardId',actor);
 end if;
 perform 1 from public.ingestion_jobs where document_id=d.id order by id for update;
 perform 1 from public.indexing_v3_agent_jobs where document_id=d.id order by id for update;
 if exists(select 1 from public.ingestion_jobs where document_id=d.id and status in ('pending','processing'))
  or exists(select 1 from public.indexing_v3_agent_jobs where document_id=d.id and status='processing' and lease_expires_at>now_at)
  then raise exception 'readmission_active_attempt';end if;
 admission:=jsonb_build_object('version','administrator-current-reindex-readmission-v1','scope',scope,'administratorId',actor,
  'documentOwnerId',d.owner_id,'sourceSha256',p_source_sha256,'previousAdmissionEventId',d.metadata->'admission_event_id','origin','historical_upload_origin_not_established','clinicalApproval','not_granted','publicationApproval','not_granted');
 next_metadata:=d.metadata||jsonb_build_object('admission_event_id',event_id,'admission_policy_version','trusted-document-admission-v1','authority',p_authority,
  'authority_basis','administrator_template','provider_processing','permitted','purpose','clinical_retrieval','supported_features',p_authority->'supportedFeatures',
  'readmitted_at',now_at,'reindex_readmission',admission);
 for pair in select * from (values ('source_role','sourceRole'),('licence_policy','licencePolicy'),('rights_evidence_ref','rightsEvidenceRef'),('publisher','publisher'),('jurisdiction','jurisdiction'),('publication_date','publicationDate'),('effective_date','effectiveDate'),('review_date','reviewDate'),('expiry_date','expiryDate'),('document_status','currentness'),('supersedes_document_id','supersedesDocumentId')) p(metadata_key,authority_key) loop
  pending_values:=pending_values||jsonb_build_object(pair.metadata_key,p_authority->pair.authority_key);
  pending_prior:=pending_prior||jsonb_build_object(pair.metadata_key,coalesce(d.metadata->pair.metadata_key,'null'::jsonb));
 end loop;
 -- Retrieval ranking reads these flat keys. They stay live-unchanged until a
 -- successful reindex terminal applies them; a failed attempt leaves them as they were.
 next_metadata:=next_metadata||jsonb_build_object('pending_reindex_authority',jsonb_build_object('version','pending-reindex-authority-v1',
  'admissionEventId',event_id,'values',pending_values,'prior',pending_prior));
 insert into public.ingestion_jobs(id,document_id,batch_id,status,stage,progress,max_attempts) values(job_id,d.id,d.import_batch_id,'pending','administrator readmission',0,p_max_attempts) returning * into j;
 insert into public.document_admission_events(id,document_id,ingestion_job_id,staging_owner_id,source_channel,actor_kind,administrator_id,backend_principal,correlation_id,admission_policy_version,content_sha256,file_name_sha256,storage_path_sha256,mime_type,byte_count,authority,admission_digest,document_input_digest,request_digest)
 values(event_id,d.id,j.id,actor,'admin_api','administrator',actor,null,p_correlation_id,'trusted-document-admission-v1',p_source_sha256,p_file_name_sha256,p_storage_path_sha256,d.file_type,p_byte_count,p_authority,
  'sha256:'||encode(extensions.digest(convert_to(admission::text,'UTF8'),'sha256'),'hex'),'sha256:'||encode(extensions.digest(convert_to(to_jsonb(d)::text,'UTF8'),'sha256'),'hex'),request_digest);
 update public.documents set metadata=next_metadata,updated_at=now_at where id=d.id;
 -- Visibility, ownership, clinical sign-off and the committed generation were not altered.
 return jsonb_build_object('outcome','created','admissionEventId',event_id,'jobId',j.id,'scope',scope,'documentOwnerId',d.owner_id,'stewardId',actor,'generationActivated',false);
end $$;

-- Apply only on the first successful completion, after the commit and job
-- completion succeeded. Completed/read-only replay branches are unchanged.
do $$
declare signature text;definition text;needle text;doc text;
begin
 foreach signature in array array['public.complete_managed_full_pdf(jsonb,uuid,text,boolean)',
  'public.complete_managed_general_pdf(jsonb,uuid,jsonb,boolean)','ingestion_generation_evidence.complete_admin_pdf(jsonb,uuid,jsonb,boolean)'] loop
  doc:=case when signature like 'public.complete_managed_full_pdf%' then 's' else 'c' end;
  needle:='  update public.ingestion_jobs set next_run_at=null,lease_expires_at=null,lease_duration_seconds=null where id='||doc||'.job_id;';
  definition:=pg_get_functiondef(signature::regprocedure);
  if length(definition)-length(replace(definition,needle,''))<>length(needle)
   or strpos(definition,'apply_pending_reindex_authority')<>0
   or not exists(select 1 from pg_proc where oid=signature::regprocedure and proowner='postgres'::regrole)
   then raise exception 'pending_reindex_authority_terminal_preimage';end if;
  execute replace(definition,needle,'  perform ingestion_generation_evidence.apply_pending_reindex_authority('||doc||'.document_id);'||chr(10)||needle);
 end loop;
end $$;

alter function ingestion_generation_evidence.pending_reindex_authority_valid(jsonb) owner to postgres;
alter function ingestion_generation_evidence.apply_pending_reindex_authority(uuid) owner to postgres;
revoke all on function ingestion_generation_evidence.pending_reindex_authority_valid(jsonb),ingestion_generation_evidence.apply_pending_reindex_authority(uuid) from public,anon,authenticated,service_role;
alter function public.lock_ingestion_document_authority(uuid,boolean) owner to postgres;
revoke all on function public.lock_ingestion_document_authority(uuid,boolean) from public,anon,authenticated,service_role;
alter function public.readmit_administrator_document_for_reindex(uuid,uuid,uuid,boolean,text,bigint,text,text,jsonb,integer) owner to postgres;
revoke all on function public.readmit_administrator_document_for_reindex(uuid,uuid,uuid,boolean,text,bigint,text,text,jsonb,integer) from public,anon,service_role;
grant execute on function public.readmit_administrator_document_for_reindex(uuid,uuid,uuid,boolean,text,bigint,text,text,jsonb,integer) to authenticated;
-- Patched terminals retain their postgres ownership and existing ACLs.
commit;
