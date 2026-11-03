-- DRAFT. A fresh authenticated administrator action, not a reconstruction of an
-- old upload. Shared-library stewardship preserves owner_id NULL and visibility.
set local lock_timeout='5s';
set local statement_timeout='120s';
create function public.readmit_administrator_document_for_reindex(
 p_document_id uuid,p_correlation_id uuid,p_expected_owner_id uuid,p_expected_public_corpus boolean,
 p_source_sha256 text,p_byte_count bigint,p_file_name_sha256 text,p_storage_path_sha256 text,
 p_authority jsonb,p_max_attempts integer default 1)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();claims jsonb:=auth.jwt();d public.documents;j public.ingestion_jobs; prior public.document_admission_events;
 event_id uuid:=gen_random_uuid();job_id uuid:=gen_random_uuid();request jsonb;request_digest text;admission jsonb;next_metadata jsonb;
 pair record;value text;scope text;now_at timestamptz:=clock_timestamp();date_value date;
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
  next_metadata:=next_metadata||jsonb_build_object(pair.metadata_key,p_authority->pair.authority_key);
 end loop;
 insert into public.ingestion_jobs(id,document_id,batch_id,status,stage,progress,max_attempts) values(job_id,d.id,d.import_batch_id,'pending','administrator readmission',0,p_max_attempts) returning * into j;
 insert into public.document_admission_events(id,document_id,ingestion_job_id,staging_owner_id,source_channel,actor_kind,administrator_id,backend_principal,correlation_id,admission_policy_version,content_sha256,file_name_sha256,storage_path_sha256,mime_type,byte_count,authority,admission_digest,document_input_digest,request_digest)
 values(event_id,d.id,j.id,actor,'admin_api','administrator',actor,null,p_correlation_id,'trusted-document-admission-v1',p_source_sha256,p_file_name_sha256,p_storage_path_sha256,d.file_type,p_byte_count,p_authority,
  'sha256:'||encode(extensions.digest(convert_to(admission::text,'UTF8'),'sha256'),'hex'),'sha256:'||encode(extensions.digest(convert_to(to_jsonb(d)::text,'UTF8'),'sha256'),'hex'),request_digest);
 update public.documents set metadata=next_metadata,updated_at=now_at where id=d.id;
 -- Visibility, ownership, clinical sign-off and the committed generation were not altered.
 return jsonb_build_object('outcome','created','admissionEventId',event_id,'jobId',j.id,'scope',scope,'documentOwnerId',d.owner_id,'stewardId',actor,'generationActivated',false);
end $$;
alter function public.readmit_administrator_document_for_reindex(uuid,uuid,uuid,boolean,text,bigint,text,text,jsonb,integer) owner to postgres;
revoke all on function public.readmit_administrator_document_for_reindex(uuid,uuid,uuid,boolean,text,bigint,text,text,jsonb,integer) from public,anon,service_role;
grant execute on function public.readmit_administrator_document_for_reindex(uuid,uuid,uuid,boolean,text,bigint,text,text,jsonb,integer) to authenticated;

create function public.read_administrator_reindex_authority(p_fence jsonb,p_generation uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a jsonb;ad public.document_admission_events;d jsonb;marker jsonb;scope text;
begin
 a:=public.assert_current_ingestion_attempt(p_fence,p_generation);
 if a is null then raise exception 'readmission_current_attempt_required';end if;
 d:=a->'document';marker:=d->'metadata'->'reindex_readmission';
 select * into strict ad from public.document_admission_events where id=(d->'metadata'->>'admission_event_id')::uuid;
 scope:=case when d->>'owner_id'=ad.administrator_id::text then 'owner_private'
  when d->>'owner_id' is null and d->'metadata'->'public_corpus'='true'::jsonb then 'existing_shared_library_stewardship' else null end;
 if scope is null or marker->>'version' is distinct from 'administrator-current-reindex-readmission-v1'
  or marker->>'scope' is distinct from scope or marker->>'administratorId' is distinct from ad.administrator_id::text
  or marker->'documentOwnerId' is distinct from d->'owner_id'
  or ad.administrator_id is distinct from ad.staging_owner_id or ad.actor_kind<>'administrator' or ad.source_channel<>'admin_api'
  or ad.ingestion_job_id is distinct from (p_fence->>'job_id')::uuid
  or ad.document_id::text is distinct from d->>'id' or ad.content_sha256 is distinct from 'sha256:'||(d->>'content_hash')
  or to_jsonb(ad.byte_count) is distinct from d->'file_size' or ad.mime_type is distinct from d->>'file_type'
  or ad.file_name_sha256 is distinct from 'sha256:'||encode(extensions.digest(convert_to(d->>'file_name','UTF8'),'sha256'),'hex')
  or ad.storage_path_sha256 is distinct from 'sha256:'||encode(extensions.digest(convert_to(d->>'storage_path','UTF8'),'sha256'),'hex')
  or ad.authority is distinct from d->'metadata'->'authority' or ad.authority->>'providerProcessing' is distinct from 'permitted'
  or d->'metadata'->>'provider_processing' is distinct from 'permitted'
  then raise exception 'readmission_authority_identity_mismatch';end if;
 perform 1 from auth.users u where u.id=ad.administrator_id and u.raw_app_meta_data->>'site_role'='administrator'
  and to_jsonb(u)->>'deleted_at' is null and (to_jsonb(u)->>'banned_until' is null or (to_jsonb(u)->>'banned_until')::timestamptz<=clock_timestamp()) for share;
 if not found then raise exception 'readmission_current_administrator_required';end if;
 return jsonb_build_object('ok',true,'providerAuthority',jsonb_build_object('version','administrator-reindex-authority-facts-v1',
  'scope',scope,'documentId',ad.document_id,'documentOwnerId',d->'owner_id','stewardId',ad.administrator_id,
  'jobId',p_fence->'job_id','generationId',p_generation,'authorityDigest',a->'authority_digest','sourceSha256',ad.content_sha256,
  'sourceByteLength',ad.byte_count,'mimeType',ad.mime_type,'fileNameSha256',ad.file_name_sha256,'storagePathSha256',ad.storage_path_sha256,
  'admissionEventId',ad.id,'admissionDigest',ad.admission_digest,'admissionPolicyVersion',ad.admission_policy_version,
  'declaredAuthority',ad.authority,'currentRightsEvidence','unavailable','historicalUploadOrigin','not_established'));
end $$;
alter function public.read_administrator_reindex_authority(jsonb,uuid) owner to postgres;
revoke all on function public.read_administrator_reindex_authority(jsonb,uuid) from public,anon,authenticated;
grant execute on function public.read_administrator_reindex_authority(jsonb,uuid) to service_role;
