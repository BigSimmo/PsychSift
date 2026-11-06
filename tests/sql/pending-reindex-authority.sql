-- Synthetic contract for 20261106184724_defer_readmission_ranking_authority.sql.
-- Runs against a replayed local chain only and rolls back. No real data.
begin;
set local session_replication_role=replica;
insert into auth.users(id,raw_app_meta_data) values('7a000000-0000-4000-8000-000000000009','{"site_role":"administrator"}'::jsonb);
insert into public.documents(id,owner_id,title,file_name,file_type,file_size,storage_path,content_hash,status,metadata) values
 ('7a000000-0000-4000-8000-000000000001','7a000000-0000-4000-8000-000000000009','Synthetic legacy','legacy.pdf','application/pdf',10,
  '7a000000-0000-4000-8000-000000000009/legacy.pdf',repeat('a',64),'indexed',
  '{"corpus_scope":"uploaded_local","content_mode":"indexed_content","licence_policy":"review_required","source_role":"clinical_reference","publisher":"Synthetic legacy publisher"}'::jsonb),
 ('7a000000-0000-4000-8000-000000000002','7a000000-0000-4000-8000-000000000009','Synthetic admitted','admitted.pdf','application/pdf',10,
  '7a000000-0000-4000-8000-000000000009/admitted.pdf',repeat('b',64),'indexed',
  '{"corpus_scope":"uploaded_local","admission_event_id":"7a000000-0000-4000-8000-000000000020","admission_policy_version":"trusted-document-admission-v1","provider_processing":"permitted","authority":{"providerProcessing":"permitted","licencePolicy":"review_required","sourceRole":"clinical_guideline","rightsEvidenceRef":"synthetic"},"licence_policy":"review_required","source_role":"clinical_guideline","rights_evidence_ref":"synthetic"}'::jsonb),
 ('7a000000-0000-4000-8000-000000000003','7a000000-0000-4000-8000-000000000009','Synthetic readmission','readmit.pdf','application/pdf',10,
  '7a000000-0000-4000-8000-000000000009/readmit.pdf',repeat('c',64),'indexed',
  '{"corpus_scope":"uploaded_local","content_mode":"indexed_content","licence_policy":"review_required","source_role":"clinical_reference","publisher":"Superseded synthetic publisher","document_status":"outdated"}'::jsonb);
set local session_replication_role=origin;

-- 1. Without a pending block the digest input is byte-identical to the previous formula.
do $$
declare d public.documents;m jsonb;expected text;
begin
 for d in select * from public.documents where id in ('7a000000-0000-4000-8000-000000000001','7a000000-0000-4000-8000-000000000002') loop
  m:=d.metadata;
  expected:='sha256:' || encode(extensions.digest(convert_to(jsonb_build_object(
   'owner', d.owner_id, 'source', d.source_path, 'storage', d.storage_path,
   'file', d.file_name, 'file_type', d.file_type, 'file_size', d.file_size,
   'content_hash', d.content_hash, 'corpus_scope', m->'corpus_scope',
   'content_mode', m->'content_mode', 'licence_policy', m->'licence_policy',
   'source_policy_checked', m->'source_policy_checked', 'content_identity_verdict', m->'content_identity_verdict',
   'content_identity_hash', m->'content_identity_hash', 'content_identity_verdict_version', m->'content_identity_verdict_version',
   'canonical_storage_path', m->'canonical_storage_path', 'public_corpus', m->'public_corpus',
   'admission_event_id', m->'admission_event_id', 'admission_policy_version', m->'admission_policy_version',
   'authority', m->'authority', 'source_role', m->'source_role', 'authority_basis', m->'authority_basis',
   'rights_evidence_ref', m->'rights_evidence_ref', 'provider_processing', m->'provider_processing',
   'purpose', m->'purpose', 'supported_features', m->'supported_features'
  )::text, 'UTF8'), 'sha256'), 'hex');
  if (public.lock_ingestion_document_authority(d.id,false))->>'authority_digest' is distinct from expected then
   raise exception 'TEST_EXISTING_DIGEST_CHANGED %',d.id;end if;
 end loop;
end $$;

-- 2. Readmission keeps the live flat ranking fields; the declared values wait.
do $$
declare actor uuid:='7a000000-0000-4000-8000-000000000009';doc uuid:='7a000000-0000-4000-8000-000000000003';
 before jsonb;after jsonb;pending jsonb;authority jsonb;result jsonb;
begin
 select metadata into before from public.documents where id=doc;
 authority:=jsonb_build_object('version',1,'sourceRole','clinical_guideline','authorityBasis','administrator_template','licencePolicy','review_required',
  'rightsEvidenceRef','synthetic:current-steward-reindex-action','publisher','Synthetic publisher','jurisdiction','Australia/WA',
  'publicationDate',null,'effectiveDate',null,'reviewDate',null,'expiryDate',null,'currentness','current','supersedesDocumentId',null,
  'purpose','clinical_retrieval','supportedFeatures','["text"]'::jsonb,'providerProcessing','permitted');
 perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated','aal','aal2','app_metadata',jsonb_build_object('site_role','administrator'),
  'amr',jsonb_build_array(jsonb_build_object('method','password','timestamp',floor(extract(epoch from clock_timestamp()))::bigint)))::text,true);
 perform set_config('request.jwt.claim.sub',actor::text,true);
 perform set_config('request.jwt.claim.role','authenticated',true);
 result:=public.readmit_administrator_document_for_reindex(doc,'7a000000-0000-4000-8000-000000000030',actor,false,'sha256:'||repeat('c',64),10,
  'sha256:'||encode(extensions.digest(convert_to('readmit.pdf','UTF8'),'sha256'),'hex'),
  'sha256:'||encode(extensions.digest(convert_to(actor::text||'/readmit.pdf','UTF8'),'sha256'),'hex'),authority,1);
 if result->>'outcome' is distinct from 'created' then raise exception 'TEST_READMISSION_NOT_CREATED %',result;end if;
 select metadata into after from public.documents where id=doc;
 pending:=after->'pending_reindex_authority';
 if after->'publisher' is distinct from before->'publisher' or after->'source_role' is distinct from before->'source_role'
  or after->'licence_policy' is distinct from before->'licence_policy' or after->'document_status' is distinct from before->'document_status'
  or after ? 'jurisdiction' or after ? 'rights_evidence_ref' then raise exception 'TEST_READMISSION_WROTE_LIVE_RANKING_FIELDS';end if;
 if after->'authority' is distinct from authority or after->>'provider_processing' is distinct from 'permitted'
  or pending->'admissionEventId' is distinct from after->'admission_event_id'
  or pending#>>'{values,publisher}' is distinct from 'Synthetic publisher' or pending#>>'{values,document_status}' is distinct from 'current'
  or pending#>>'{prior,publisher}' is distinct from 'Superseded synthetic publisher' or pending#>'{prior,jurisdiction}' is distinct from 'null'::jsonb
  or not ingestion_generation_evidence.pending_reindex_authority_valid(after) then raise exception 'TEST_PENDING_BLOCK_WRONG %',pending;end if;
end $$;

-- 3. Applying is digest-neutral, writes the declared values, clears the block and is idempotent.
do $$
declare doc uuid:='7a000000-0000-4000-8000-000000000003';before text;after text;m jsonb;
begin
 before:=(public.lock_ingestion_document_authority(doc,false))->>'authority_digest';
 if before is null then raise exception 'TEST_PENDING_DOCUMENT_NOT_LOCKABLE';end if;
 perform ingestion_generation_evidence.apply_pending_reindex_authority(doc);
 select metadata into m from public.documents where id=doc;
 if m ? 'pending_reindex_authority' or m->>'publisher' is distinct from 'Synthetic publisher' or m->>'jurisdiction' is distinct from 'Australia/WA'
  or m->>'document_status' is distinct from 'current' or m->>'source_role' is distinct from 'clinical_guideline'
  or m->'review_date' is distinct from 'null'::jsonb then raise exception 'TEST_PENDING_NOT_APPLIED %',m;end if;
 after:=(public.lock_ingestion_document_authority(doc,false))->>'authority_digest';
 if after is distinct from before then raise exception 'TEST_APPLY_MOVED_DIGEST';end if;
 perform ingestion_generation_evidence.apply_pending_reindex_authority(doc);
 if (select metadata from public.documents where id=doc) is distinct from m then raise exception 'TEST_APPLY_NOT_IDEMPOTENT';end if;
end $$;

-- 4. A live change mid-attempt (licence withdrawal) refuses; a foreign block fails closed.
do $$
declare doc uuid:='7a000000-0000-4000-8000-000000000003';m jsonb;
begin
 select metadata into m from public.documents where id=doc;
 update public.documents set metadata=m||jsonb_build_object('pending_reindex_authority',jsonb_build_object('version','pending-reindex-authority-v1',
  'admissionEventId',m->'admission_event_id',
  'values',(select jsonb_object_agg(k,m->k) from unnest(array['source_role','licence_policy','rights_evidence_ref','publisher','jurisdiction','publication_date','effective_date','review_date','expiry_date','document_status','supersedes_document_id']) k),
  'prior',(select jsonb_object_agg(k,coalesce(m->k,'null'::jsonb)) from unnest(array['source_role','licence_policy','rights_evidence_ref','publisher','jurisdiction','publication_date','effective_date','review_date','expiry_date','document_status','supersedes_document_id']) k)))
  where id=doc;
 update public.documents set metadata=metadata||'{"licence_policy":"index_forbidden"}'::jsonb where id=doc;
 begin perform ingestion_generation_evidence.apply_pending_reindex_authority(doc);raise exception 'TEST_WITHDRAWAL_OVERWRITTEN';
 exception when raise_exception then if sqlerrm<>'pending_reindex_authority_live_changed' then raise;end if;end;
 if (select metadata->>'licence_policy' from public.documents where id=doc) is distinct from 'index_forbidden' then raise exception 'TEST_WITHDRAWAL_LOST';end if;
 update public.documents set metadata=jsonb_set(metadata,'{pending_reindex_authority,admissionEventId}','"7a000000-0000-4000-8000-000000000099"') where id=doc;
 if public.lock_ingestion_document_authority(doc,false) is not null then raise exception 'TEST_FOREIGN_BLOCK_LOCKABLE';end if;
 begin perform ingestion_generation_evidence.apply_pending_reindex_authority(doc);raise exception 'TEST_FOREIGN_BLOCK_APPLIED';
 exception when raise_exception then if sqlerrm<>'pending_reindex_authority_invalid' then raise;end if;end;
end $$;

-- 5. Each PDF terminal applies only after its commit and job completion, in the first-completion branch.
do $$
declare signature text;definition text;apply_at integer;
begin
 foreach signature in array array['public.complete_managed_full_pdf(jsonb,uuid,text,boolean)',
  'public.complete_managed_general_pdf(jsonb,uuid,jsonb,boolean)','ingestion_generation_evidence.complete_admin_pdf(jsonb,uuid,jsonb,boolean)'] loop
  definition:=pg_get_functiondef(signature::regprocedure);
  apply_at:=strpos(definition,'perform ingestion_generation_evidence.apply_pending_reindex_authority(');
  if apply_at=0 or length(definition)-length(replace(definition,'apply_pending_reindex_authority',''))<>length('apply_pending_reindex_authority')
   or apply_at<=strpos(definition,'result:=public.commit_document_index_generation')
   or apply_at<=strpos(definition,'result:=public.complete_ingestion_job')
   or apply_at>=strpos(definition,'update public.ingestion_jobs set next_run_at=null,lease_expires_at=null,lease_duration_seconds=null')
   then raise exception 'TEST_APPLY_ORDER %',signature;end if;
 end loop;
 if has_function_privilege('service_role','ingestion_generation_evidence.apply_pending_reindex_authority(uuid)','execute')
  or has_function_privilege('authenticated','ingestion_generation_evidence.apply_pending_reindex_authority(uuid)','execute')
  then raise exception 'TEST_APPLY_EXPOSED';end if;
end $$;
rollback;
