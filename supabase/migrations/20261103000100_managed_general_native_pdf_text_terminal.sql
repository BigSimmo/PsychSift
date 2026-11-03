-- DRAFT: additive native-text-only PDF terminal; no production application is authorized.
-- Existing fixed-pilot/TXT terminals and their proof contracts are preserved.
set local lock_timeout = '5s';
set local statement_timeout = '120s';

create function ingestion_generation_evidence.general_pdf_commit_allowed(f jsonb,g uuid)
returns boolean language sql stable set search_path='' as $$
 select coalesce(current_setting('psychsift.general_pdf_terminal_owner',true)=(f->>'document_id')||':'||(f->>'job_id'),false)
 and exists(select 1 from ingestion_generation_evidence.prerequisite_accounting s
  join ingestion_generation_evidence.candidates c using(document_id,generation_id)
  where c.document_id=(f->>'document_id')::uuid and c.generation_id=g and c.job_id=(f->>'job_id')::uuid
  and c.first_lease_token=(f->>'lease_token')::uuid and c.authority_digest=f->>'authority_digest'
  and s.snapshot->>'version'='managed-general-pdf-seal-v1'
  and s.snapshot->>'scope'='administrator-general-native-pdf-text-v1'
  and s.snapshot->'packet'->'identity'->>'generationId'=g::text
  and s.snapshot->'packet'->'identity'->>'sourceSha256'=c.source_sha256
  and s.snapshot_digest='sha256:'||encode(extensions.digest(convert_to(s.snapshot::text,'UTF8'),'sha256'),'hex')
  and (select count(*) from public.document_chunks r where r.document_id=c.document_id and r.index_generation_id=g)=jsonb_array_length(s.snapshot->'packet'->'chunks')
  and not exists(select 1 from ingestion_generation_evidence.candidate_chunk_rows cr left join public.document_chunks pr on pr.id=cr.id
   where cr.document_id=c.document_id and cr.index_generation_id=g and (pr.id is null or
    (to_jsonb(pr)-array['created_at','search_tsv']) is distinct from
    (to_jsonb(jsonb_populate_record(null::public.document_chunks,to_jsonb(cr)))-array['created_at','search_tsv']))))
$$;

create function public.complete_managed_general_pdf(p_fence jsonb,p_generation uuid,p_packet jsonb,p_read_only boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c ingestion_generation_evidence.candidates; j public.ingestion_jobs; ad public.document_admission_events;
 original ingestion_generation_evidence.retained_artifacts; witness ingestion_generation_evidence.retained_artifacts;
 prepared ingestion_generation_evidence.retained_artifacts; final_row ingestion_generation_evidence.retained_artifacts;
 cr ingestion_generation_evidence.candidate_chunk_rows; prior ingestion_generation_evidence.prerequisite_accounting;
 a jsonb; identity jsonb; claim jsonb; inspection jsonb; w jsonb; item jsonb; grp jsonb; pg jsonb; unit jsonb;
 page_row jsonb; page_text text; page_bytes bytea; pages jsonb:='[]'::jsonb; page_total integer; chunk_total integer;
 page_index integer:=0; chunk_ordinal integer:=0; cursor_byte integer; consumed integer:=0; actual jsonb;
 seal jsonb; seal_bytes bytea; seal_hash text; result jsonb; next_fence jsonb; checkpoint jsonb; checkpoint_bytes bytea; checkpoint_hash text;
 quality jsonb; replay text; active_worker text; total_text bigint:=0; inspected_at timestamptz; inspection_expires timestamptz;
begin
 if p_read_only is null or p_generation is null or not ingestion_generation_evidence.visual_unit_fence(p_fence)
  or p_fence->>'job_kind' is distinct from 'node' or octet_length(convert_to(p_packet::text,'UTF8'))>33554432
  or not ingestion_generation_evidence.keys(p_packet,array['version','profileId','identity','inspection','retainedImageCount','pages','chunks','quality'])
  or p_packet->>'version' is distinct from 'managed-general-pdf-complete-v1'
  or p_packet->>'profileId' is distinct from 'administrator-general-native-pdf-text-v1'
  then raise exception 'managed_general_pdf_invalid_packet';end if;
 a:=public.lock_ingestion_document_authority((p_fence->>'document_id')::uuid,false);
 if a is null or a->'document'->>'owner_id' is null
  or a->'document'->'metadata'->>'corpus_scope' is distinct from 'uploaded_local'
  or a->'document'->'metadata'->>'content_mode' is distinct from 'indexed_content'
  or a->'document'->'metadata'->'public_corpus'='true'::jsonb
  then raise exception 'managed_general_pdf_owner_scope_required';end if;
 perform 1 from public.ingestion_jobs where document_id=(p_fence->>'document_id')::uuid order by id for update;
 perform 1 from public.indexing_v3_agent_jobs where document_id=(p_fence->>'document_id')::uuid order by id for update;
 select * into strict j from public.ingestion_jobs where id=(p_fence->>'job_id')::uuid;
 select * into strict c from ingestion_generation_evidence.candidates where document_id=(p_fence->>'document_id')::uuid and generation_id=p_generation for update;
 select convert_from(artifact_bytes,'UTF8')::jsonb into strict claim from ingestion_generation_evidence.retained_artifacts
  where document_id=c.document_id and generation_id=c.generation_id and family='attempt_control' and unit_key='claim_checkpoint';
 active_worker:=claim->>'workerId';
 identity:=jsonb_build_object('documentId',c.document_id,'generationId',c.generation_id,'jobId',c.job_id,'workerId',active_worker,
  'firstLeaseToken',c.first_lease_token,'attemptNumber',j.attempt_count,'batchId',j.batch_id,'authorityDigest',c.authority_digest,
  'predecessorGenerationId',c.predecessor_generation_id,'ownerId',c.source_snapshot->'owner_id','sourceSha256',c.source_sha256,
  'sourceByteLength',c.source_byte_length,'sourceExpectationDigest',c.source_expectation_digest);
 if a is null or p_packet->'identity' is distinct from identity or c.job_id is distinct from j.id or j.document_id is distinct from c.document_id
  or j.lease_token is distinct from c.first_lease_token or c.first_lease_token::text is distinct from p_fence->>'lease_token'
  or j.lease_write_generation_id is distinct from p_generation or active_worker is distinct from p_fence->>'worker_id'
  or c.predecessor_generation_id is distinct from (p_fence->>'expected_generation_id')::uuid
  or c.authority_digest is distinct from p_fence->>'authority_digest' or a->>'authority_digest' is distinct from c.authority_digest
  or j.lease_authority_digest is distinct from c.authority_digest or c.source_snapshot->'owner_id' is distinct from a->'document'->'owner_id'
  or c.source_sha256 is distinct from 'sha256:'||(a->'document'->>'content_hash')
  or c.source_byte_length is distinct from (a->'document'->>'file_size')::bigint or c.source_byte_length>157286400
  or a->'document'->>'file_type' is distinct from 'application/pdf'
  or exists(select 1 from public.ingestion_jobs o where o.document_id=c.document_id and o.id<>j.id and (o.created_at>j.created_at or o.status in ('pending','processing')))
  then raise exception 'managed_general_pdf_identity_mismatch';end if;
 if j.status='completed' then
  if j.stage<>'general_pdf_text_completed' or j.locked_by is not null or j.lease_expires_at is not null or j.next_run_at is not null
   or j.lease_expected_generation_id is distinct from p_generation or (a->'document'->>'index_generation_id')::uuid is distinct from p_generation
   then raise exception 'managed_general_pdf_replay_state';end if;
 else
  if p_read_only or j.status<>'processing' or j.locked_by is distinct from active_worker or j.lease_expires_at is null or j.lease_expires_at<=clock_timestamp()
   or j.lease_expected_generation_id is distinct from c.predecessor_generation_id
   or (a->'document'->>'index_generation_id')::uuid is distinct from c.predecessor_generation_id
   or public.assert_current_ingestion_attempt(p_fence,p_generation) is null then raise exception 'managed_general_pdf_current_attempt_required';end if;
 end if;
 select * into strict ad from public.document_admission_events where id=(a->'document'->'metadata'->>'admission_event_id')::uuid;
 if ad.actor_kind is distinct from 'administrator' or ad.source_channel is distinct from 'admin_api'
  or ad.document_id is distinct from c.document_id or ad.staging_owner_id is distinct from (identity->>'ownerId')::uuid
  or ad.administrator_id is distinct from ad.staging_owner_id or ad.backend_principal is not null
  or ad.content_sha256 is distinct from c.source_sha256 or ad.byte_count is distinct from c.source_byte_length
  or ad.mime_type is distinct from 'application/pdf' or ad.admission_policy_version is distinct from 'trusted-document-admission-v1'
  or ad.authority is distinct from a->'document'->'metadata'->'authority'
  or c.source_snapshot->'metadata'->'admission_event_id' is distinct from a->'document'->'metadata'->'admission_event_id'
  or ad.authority->>'authorityBasis' is distinct from 'administrator_template'
  or ad.authority->>'providerProcessing' is distinct from 'permitted'
  or ad.authority->>'purpose' is distinct from 'clinical_retrieval' or ad.authority->>'currentness' is distinct from 'current'
  or ad.authority->'supportedFeatures' is distinct from '["text"]'::jsonb
  or coalesce(ad.authority->>'jurisdiction','') not in ('Australia','Australia/WA')
  or (ad.authority->>'effectiveDate')::date>current_date or (ad.authority->>'expiryDate')::date<=current_date
  or (ad.authority->>'reviewDate')::date<=current_date then raise exception 'managed_general_pdf_admission_mismatch';end if;
 perform 1 from auth.users u where u.id=ad.administrator_id
  and u.raw_app_meta_data->>'site_role' is not distinct from 'administrator'
  and (to_jsonb(u)->>'deleted_at') is null
  and ((to_jsonb(u)->>'banned_until') is null or (to_jsonb(u)->>'banned_until')::timestamptz<=clock_timestamp()) for share;
 if not found then raise exception 'managed_general_pdf_current_administrator_required';end if;
 select * into strict original from ingestion_generation_evidence.retained_artifacts
  where document_id=c.document_id and generation_id=c.generation_id and family='private_objects' and unit_key='original-source';
 if original.representation<>'original_binary' or original.sha256 is distinct from c.source_sha256
  or original.byte_length<>c.source_byte_length or substring(original.artifact_bytes from 1 for 5)<>convert_to('%PDF-','UTF8')
  then raise exception 'managed_general_pdf_original_mismatch';end if;
 -- Validate every retained byte, not hashes supplied by a caller without retained readback.
 if exists(select 1 from ingestion_generation_evidence.retained_artifacts r where r.document_id=c.document_id and r.generation_id=c.generation_id
  and (r.sha256<>'sha256:'||encode(extensions.digest(r.artifact_bytes,'sha256'),'hex') or r.byte_length<>octet_length(r.artifact_bytes) or r.source_sha256<>c.source_sha256))
  then raise exception 'managed_general_pdf_retained_mismatch';end if;
 inspection:=p_packet->'inspection';
 if jsonb_typeof(inspection->'inspectedAt') is distinct from 'string'
  or jsonb_typeof(inspection->'expiresAt') is distinct from 'string'
  or coalesce(inspection->>'inspectedAt','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,9})?Z$'
  or coalesce(inspection->>'expiresAt','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,9})?Z$'
  then raise exception 'managed_general_pdf_inspection_binding';end if;
 begin
  inspected_at:=(inspection->>'inspectedAt')::timestamptz;
  inspection_expires:=(inspection->>'expiresAt')::timestamptz;
 exception when invalid_datetime_format or datetime_field_overflow then raise exception 'managed_general_pdf_inspection_binding';
 end;
 if not ingestion_generation_evidence.keys(inspection,array['version','binding','sourceSha256','sourceByteLength','pageCount','pages','pageInventory','activeContent','encryption','hiddenText','inspectedAt','expiresAt'])
  or inspection->>'version' is distinct from 'administrator-general-native-pdf-inspection-v1'
  or inspection->>'sourceSha256' is distinct from c.source_sha256 or inspection->'sourceByteLength' is distinct from to_jsonb(c.source_byte_length)
  or inspection->>'pageInventory' is distinct from 'complete' or inspection->>'activeContent' is distinct from 'absent'
  or inspection->>'encryption' is distinct from 'not_encrypted' or inspection->>'hiddenText' is distinct from 'consistent'
  or inspection->'binding' is distinct from jsonb_build_object('admissionEventId',ad.id,'documentId',c.document_id,'generationId',c.generation_id,
   'jobId',j.id,'attemptId',j.id::text||':'||j.attempt_count::text||':'||j.lease_token::text,'leaseId',c.first_lease_token,'contentSha256',c.source_sha256,'authorityDigest',c.authority_digest)
  or inspection_expires<=inspected_at
  or inspection_expires>inspected_at+interval '1 day'
  or inspected_at>coalesce(j.completed_at,clock_timestamp())
  or inspection_expires<=coalesce(j.completed_at,clock_timestamp())
  then raise exception 'managed_general_pdf_inspection_binding';end if;
 page_total:=jsonb_array_length(p_packet->'pages');chunk_total:=jsonb_array_length(p_packet->'chunks');
 if page_total<1 or page_total>1000 or chunk_total<1 or chunk_total>10000
  or jsonb_array_length(inspection->'pages')<>page_total or inspection->'pageCount' is distinct from to_jsonb(page_total)
  then raise exception 'managed_general_pdf_population';end if;
 select * into strict witness from ingestion_generation_evidence.retained_artifacts
  where document_id=c.document_id and generation_id=c.generation_id and family='private_objects' and unit_key='original-source-expectation-witness';
 w:=convert_from(witness.artifact_bytes,'UTF8')::jsonb;
 if witness.representation<>'source_expectation_witness' or witness.sha256 is distinct from c.source_expectation->'witness'->>'sha256'
  or c.source_expectation->>'tag' is distinct from 'known' or convert_from(c.source_expectation_bytes,'UTF8')::jsonb is distinct from c.source_expectation
  or c.source_expectation_digest<>'sha256:'||encode(extensions.digest(c.source_expectation_bytes,'sha256'),'hex')
  or not ingestion_generation_evidence.keys(w,array['version','qualification','sourceSha256','sourceByteLength','sourceUnits','groups'])
  or w->>'version' is distinct from 'ingestion-original-applicability-v1' or w->>'qualification' is distinct from 'independently_declared_unverified'
  or w->>'sourceSha256' is distinct from c.source_sha256 or w->'sourceByteLength' is distinct from to_jsonb(c.source_byte_length)
  or w->'sourceUnits' is distinct from c.source_expectation->'units' or jsonb_array_length(w->'sourceUnits')<>page_total
  or jsonb_array_length(w->'groups')<>5 or (select count(distinct value->>'family') from jsonb_array_elements(w->'groups'))<>5
  then raise exception 'managed_general_pdf_independent_witness';end if;
 for grp in select value from jsonb_array_elements(w->'groups') loop
  if not ingestion_generation_evidence.keys(grp,array['family','population'])
   or not ingestion_generation_evidence.keys(grp->'population',array['tag','requirements','basis','reason'])
   or grp->>'family' not in ('chunks','images','table_facts','embedding_fields','index_units')
   or grp->'population'->>'tag' is distinct from 'known'
   or grp->'population'->'basis' is distinct from '{"scope":"whole_original","kind":"independent_original_declaration"}'::jsonb
   or (grp->>'family'<>'chunks' and (grp->'population'->'requirements'<>'[]'::jsonb or grp->'population'->>'reason' is distinct from 'no_original_requirements_in_scope'))
   or (grp->>'family'='chunks' and (jsonb_array_length(grp->'population'->'requirements')<1 or grp->'population'->'reason' is distinct from 'null'::jsonb))
   then raise exception 'managed_general_pdf_unsupported_original_requirements';end if;
  for item in select value from jsonb_array_elements(grp->'population'->'requirements') loop
   if not ingestion_generation_evidence.keys(item,array['id','required','sourceEvidenceIds']) or item->'required' is distinct from 'true'::jsonb
    or jsonb_array_length(item->'sourceEvidenceIds')<1
    or exists(select 1 from jsonb_array_elements_text(item->'sourceEvidenceIds') ref where not exists(select 1 from jsonb_array_elements(w->'sourceUnits') su where su.value->>'id'=ref))
    then raise exception 'managed_general_pdf_source_obligation_mismatch';end if;
  end loop;
 end loop;
 if (select count(distinct value->>'id') from jsonb_array_elements(w->'sourceUnits'))<>page_total
  or exists(select 1 from jsonb_array_elements(w->'sourceUnits') su where not ingestion_generation_evidence.keys(su.value,array['id','required','dependencies','locator','nativeMapping'])
   or su.value->'dependencies' is distinct from '[]'::jsonb or su.value->>'nativeMapping' is distinct from 'unavailable')
  then raise exception 'managed_general_pdf_source_units';end if;
 if (select count(*) from ingestion_generation_evidence.retained_artifacts where document_id=c.document_id and generation_id=c.generation_id and family='pages')<>page_total
  or (select count(*) from ingestion_generation_evidence.candidate_chunk_rows where document_id=c.document_id and index_generation_id=c.generation_id)<>chunk_total
  or (select count(*) from ingestion_generation_evidence.retained_artifacts where document_id=c.document_id and generation_id=c.generation_id and family='chunks')<>2*chunk_total
  or exists(select 1 from ingestion_generation_evidence.scoped_projection_rows where document_id=c.document_id and generation_id=c.generation_id)
  or exists(select 1 from ingestion_generation_evidence.visual_unit_rows where document_id=c.document_id and generation_id=c.generation_id)
  or exists(select 1 from ingestion_generation_evidence.managed_vector_packets where document_id=c.document_id and generation_id=c.generation_id)
  or exists(select 1 from ingestion_generation_evidence.unit_declarations where document_id=c.document_id and generation_id=c.generation_id
   and family not in ('private_objects','pages','chunks','document_metadata','quality','attempt_control'))
  or p_packet->'retainedImageCount' is distinct from to_jsonb((select count(*)::integer from ingestion_generation_evidence.retained_artifacts where document_id=c.document_id and generation_id=c.generation_id and representation='image_binary'))
  then raise exception 'managed_general_pdf_actual_population';end if;
 for pg in select value from jsonb_array_elements(p_packet->'pages') loop
  page_index:=page_index+1;cursor_byte:=0;
  page_text:=inspection->'pages'->(page_index-1)->>'text';page_bytes:=convert_to(page_text,'UTF8');total_text:=total_text+octet_length(page_bytes);
  if not ingestion_generation_evidence.keys(pg,array['pageNumber','textSha256','byteLength']) or pg->'pageNumber' is distinct from to_jsonb(page_index)
   or pg->'byteLength' is distinct from to_jsonb(octet_length(page_bytes)) or octet_length(page_bytes)>2097152
   or pg->>'textSha256' is distinct from 'sha256:'||encode(extensions.digest(page_bytes,'sha256'),'hex')
   or inspection->'pages'->(page_index-1)->'pageNumber' is distinct from to_jsonb(page_index)
   or inspection->'pages'->(page_index-1)->>'textSha256' is distinct from pg->>'textSha256'
   then raise exception 'managed_general_pdf_page_binding';end if;
  select value into strict unit from jsonb_array_elements(w->'sourceUnits') where value->>'locator'='pdf-page:'||page_index::text||':native-text:'||(pg->>'textSha256');
  if unit->'required' is distinct from 'true'::jsonb or not exists(select 1 from jsonb_array_elements(w->'groups') gr
   cross join lateral jsonb_array_elements(gr.value->'population'->'requirements') req where gr.value->>'family'='chunks' and req.value->'required'='true'::jsonb and req.value->'sourceEvidenceIds' ? (unit->>'id'))
   then raise exception 'managed_general_pdf_unrepresented_page';end if;
  select convert_from(artifact_bytes,'UTF8')::jsonb into strict page_row from ingestion_generation_evidence.retained_artifacts
   where document_id=c.document_id and generation_id=c.generation_id and family='pages' and unit_key=page_index::text and representation='page_projection';
  if page_row->>'text' is distinct from page_text or page_row->'page_number' is distinct from to_jsonb(page_index) or page_row->'ocr_used' is distinct from 'false'::jsonb
   or not exists(select 1 from ingestion_generation_evidence.retained_artifacts where document_id=c.document_id and generation_id=c.generation_id
    and family='private_objects' and unit_key='page:'||page_index::text||':extracted' and representation='extracted_utf8' and artifact_bytes=page_bytes)
   or not exists(select 1 from ingestion_generation_evidence.retained_artifacts where document_id=c.document_id and generation_id=c.generation_id
    and family='private_objects' and unit_key='page:'||page_index::text||':persisted' and representation='persisted_utf8' and artifact_bytes=page_bytes)
   then raise exception 'managed_general_pdf_page_readback';end if;
  pages:=pages||jsonb_build_array(page_row);
  for item in select value from jsonb_array_elements(p_packet->'chunks') where (value->>'pageNumber')::integer=page_index order by (value->>'chunkIndex')::integer loop
   if not ingestion_generation_evidence.keys(item,array['id','chunkIndex','pageNumber','start','end','sha256'])
    or item->'chunkIndex' is distinct from to_jsonb(chunk_ordinal) or item->'start' is distinct from to_jsonb(cursor_byte)
    or (item->>'end')::integer<=cursor_byte or (item->>'end')::integer>octet_length(page_bytes) then raise exception 'managed_general_pdf_chunk_coverage';end if;
   select * into strict cr from ingestion_generation_evidence.candidate_chunk_rows where id=(item->>'id')::uuid and document_id=c.document_id and index_generation_id=c.generation_id;
   select * into strict prepared from ingestion_generation_evidence.retained_artifacts where document_id=c.document_id and generation_id=c.generation_id and family='chunks' and unit_key=cr.id::text||':prepared';
   select * into strict final_row from ingestion_generation_evidence.retained_artifacts where document_id=c.document_id and generation_id=c.generation_id and family='chunks' and unit_key=cr.id::text||':final';
   actual:=(to_jsonb(jsonb_populate_record(null::public.document_chunks,to_jsonb(cr)))-array['created_at','search_tsv','embedding'])||jsonb_build_object('embedding',(cr.embedding::text)::jsonb);
   if cr.chunk_index<>chunk_ordinal or cr.page_number<>page_index or cr.candidate_owner_id is distinct from (identity->>'ownerId')::uuid
    or cr.candidate_job_id<>c.job_id or cr.candidate_lease_token<>c.first_lease_token or cr.candidate_authority_digest<>c.authority_digest
    or cr.candidate_source_sha256<>c.source_sha256 or cr.candidate_source_expectation_digest<>c.source_expectation_digest
    or cr.candidate_prepared_sha256<>prepared.sha256 or cr.embedding is null or jsonb_array_length((cr.embedding::text)::jsonb)<>1536
    or not exists(select 1 from jsonb_array_elements_text((cr.embedding::text)::jsonb) coordinate where coordinate::double precision<>0)
    or cr.image_ids<>'{}'::uuid[] or cr.retrieval_synopsis is not null or cr.section_heading is not null
    or convert_to(cr.content,'UTF8')<>substring(page_bytes from cursor_byte+1 for (item->>'end')::integer-cursor_byte)
    or item->>'sha256'<>'sha256:'||encode(extensions.digest(convert_to(cr.content,'UTF8'),'sha256'),'hex')
    or (convert_from(final_row.artifact_bytes,'UTF8')::jsonb)->'row' is distinct from actual
    or (convert_from(final_row.artifact_bytes,'UTF8')::jsonb)->>'preparedSha256' is distinct from prepared.sha256
    or (convert_from(prepared.artifact_bytes,'UTF8')::jsonb)->'row' is distinct from (actual-'embedding')||jsonb_build_object('metadata',(actual->'metadata')-array['ingestion_job_id','ingestion_job_kind','ingestion_lease_token'])
    then raise exception 'managed_general_pdf_chunk_readback';end if;
   cursor_byte:=(item->>'end')::integer;chunk_ordinal:=chunk_ordinal+1;consumed:=consumed+1;
  end loop;
  if cursor_byte<>octet_length(page_bytes) then raise exception 'managed_general_pdf_page_coverage_gap';end if;
 end loop;
 if consumed<>chunk_total or total_text<1 or total_text>8388608 then raise exception 'managed_general_pdf_text_population';end if;
 if exists(select 1 from ingestion_generation_evidence.unit_declarations d left join ingestion_generation_evidence.outcomes o using(document_id,generation_id,family,unit_key)
  where d.document_id=c.document_id and d.generation_id=c.generation_id and d.declaration->'required'='true'::jsonb
  and not(d.family='attempt_control' and d.unit_key='preseal_checkpoint') and (o.outcome->>'disposition' is distinct from 'retained'
   or not exists(select 1 from ingestion_generation_evidence.retained_artifacts r where r.document_id=d.document_id and r.generation_id=d.generation_id and r.family=d.family and r.unit_key=d.unit_key and r.sha256=o.outcome->>'artifactSha256')))
  or exists(select 1 from ingestion_generation_evidence.unit_declarations d cross join lateral jsonb_array_elements(d.declaration->'dependencies') dep
   where d.document_id=c.document_id and d.generation_id=c.generation_id and not exists(select 1 from ingestion_generation_evidence.outcomes o
    where o.document_id=c.document_id and o.generation_id=c.generation_id and o.family=dep.value->>'family' and o.unit_key=dep.value->>'key' and o.outcome->>'disposition'='retained'))
  then raise exception 'managed_general_pdf_required_artifacts_missing';end if;
 quality:=jsonb_build_object('quality_score',1,'extraction_quality','good','issues',jsonb_build_array('native_text_profile_only','optional_enrichment_deferred','clinical_approval_not_assessed'),
  'metrics',jsonb_build_object('page_count',page_total,'chunk_count',chunk_total,'ocr_page_count',0,'public_image_count',0,'private_retained_image_count',p_packet->'retainedImageCount','scope','administrator-general-native-pdf-text-v1','native_text_exact',true,'visual_fidelity','not_assessed'));
 if p_packet->'quality' is distinct from quality then raise exception 'managed_general_pdf_quality_mismatch';end if;
 seal:=jsonb_build_object('version','managed-general-pdf-seal-v1','packet',p_packet,'scope','administrator-general-native-pdf-text-v1',
  'activated',true,'clinicalApproval','not_assessed','publicationApproval','not_granted','visualFidelity','not_assessed');
 seal_bytes:=convert_to(seal::text,'UTF8');seal_hash:='sha256:'||encode(extensions.digest(seal_bytes,'sha256'),'hex');
 checkpoint:=claim||jsonb_build_object('phase','preseal','terminalVersion','managed-general-pdf-complete-v1','terminalPacket',p_packet);
 checkpoint_bytes:=convert_to(checkpoint::text,'UTF8');checkpoint_hash:='sha256:'||encode(extensions.digest(checkpoint_bytes,'sha256'),'hex');
 if j.status='completed' then
  select * into strict prior from ingestion_generation_evidence.prerequisite_accounting where document_id=c.document_id and generation_id=c.generation_id and snapshot->>'version'='managed-general-pdf-seal-v1';
  if prior.snapshot is distinct from seal or prior.snapshot_digest is distinct from seal_hash
   or (select count(*) from public.document_pages where document_id=c.document_id and index_generation_id=c.generation_id)<>page_total
   or (select count(*) from public.document_chunks where document_id=c.document_id and index_generation_id=c.generation_id)<>chunk_total
   or exists(select 1 from ingestion_generation_evidence.candidate_chunk_rows r left join public.document_chunks p on p.id=r.id where r.document_id=c.document_id and r.index_generation_id=c.generation_id
    and (p.id is null or (to_jsonb(p)-array['created_at','search_tsv']) is distinct from (to_jsonb(jsonb_populate_record(null::public.document_chunks,to_jsonb(r)))-array['created_at','search_tsv'])))
   then raise exception 'managed_general_pdf_replay_mismatch';end if;
  if exists(select 1 from public.document_pages p where p.document_id=c.document_id and p.index_generation_id=c.generation_id
   and (p.ocr_used or p.text is distinct from inspection->'pages'->(p.page_number-1)->>'text'))
   or not exists(select 1 from ingestion_generation_evidence.retained_artifacts where document_id=c.document_id and generation_id=c.generation_id and family='attempt_control' and unit_key='preseal_checkpoint' and sha256=checkpoint_hash and artifact_bytes=checkpoint_bytes)
   or not exists(select 1 from public.document_index_quality where document_id=c.document_id and owner_id=(identity->>'ownerId')::uuid and metrics->>'general_pdf_seal_digest'=seal_hash)
   then raise exception 'managed_general_pdf_replay_mismatch';end if;
  replay:='already_completed';
 else
  if public.assert_current_ingestion_attempt(p_fence,p_generation) is null then raise exception 'managed_general_pdf_current_attempt_required';end if;
  if not exists(select 1 from ingestion_generation_evidence.unit_declarations where document_id=c.document_id and generation_id=c.generation_id and family='attempt_control' and unit_key='preseal_checkpoint'
   and declaration->'dependencies'='[{"family":"attempt_control","key":"claim_checkpoint"},{"family":"private_objects","key":"original-source"}]'::jsonb)
   then raise exception 'managed_general_pdf_preseal_declaration_required';end if;
  insert into ingestion_generation_evidence.retained_artifacts(document_id,generation_id,family,unit_key,group_key,representation,source_sha256,artifact_bytes,sha256,byte_length,locator)
   values(c.document_id,c.generation_id,'attempt_control','preseal_checkpoint','control','provenance_json',c.source_sha256,checkpoint_bytes,checkpoint_hash,octet_length(checkpoint_bytes),'ingestion_attempt:general_pdf_preseal');
  insert into ingestion_generation_evidence.outcomes(document_id,generation_id,family,unit_key,group_key,outcome)
   values(c.document_id,c.generation_id,'attempt_control','preseal_checkpoint','control',jsonb_build_object('unitId',jsonb_build_object('family','attempt_control','key','preseal_checkpoint'),'groupKey','control','disposition','retained','artifactSha256',checkpoint_hash,'limitation',null));
  insert into ingestion_generation_evidence.prerequisite_accounting(document_id,generation_id,snapshot_digest,snapshot) values(c.document_id,c.generation_id,seal_hash,seal);
  insert into public.document_chunks(id,document_id,page_number,chunk_index,section_heading,section_path,heading_level,parent_heading,anchor_id,content,retrieval_synopsis,content_hash,index_generation_id,token_estimate,image_ids,metadata,embedding)
   select staged.id,staged.document_id,staged.page_number,staged.chunk_index,staged.section_heading,staged.section_path,staged.heading_level,staged.parent_heading,staged.anchor_id,staged.content,staged.retrieval_synopsis,staged.content_hash,staged.index_generation_id,staged.token_estimate,staged.image_ids,staged.metadata,staged.embedding
    from ingestion_generation_evidence.candidate_chunk_rows staged where staged.document_id=c.document_id and staged.index_generation_id=c.generation_id;
  quality:=quality||jsonb_build_object('metrics',quality->'metrics'||jsonb_build_object('general_pdf_seal_digest',seal_hash));
  perform set_config('psychsift.general_pdf_terminal_owner',c.document_id::text||':'||c.job_id::text,true);
  result:=public.commit_document_index_generation(p_fence,p_generation,page_total,chunk_total,0,'{}'::jsonb,pages,quality);
  if result->'ok' is distinct from 'true'::jsonb then raise exception 'managed_general_pdf_commit_failed';end if;
  next_fence:=result->'fence';result:=public.complete_ingestion_job(next_fence,j.batch_id,'general_pdf_text_completed');
  if result->'ok' is distinct from 'true'::jsonb then raise exception 'managed_general_pdf_completion_failed';end if;
  update public.ingestion_jobs set next_run_at=null,lease_expires_at=null,lease_duration_seconds=null where id=c.job_id;
  perform set_config('psychsift.general_pdf_terminal_owner','',true);replay:='completed';
 end if;
 return jsonb_build_object('ok',true,'managedGeneralPdfTerminal',jsonb_build_object('status','general_pdf_text_completed','replay',replay,'activated',true,
  'seal',jsonb_build_object('bytesHex',encode(seal_bytes,'hex'),'sha256',seal_hash,'byteLength',octet_length(seal_bytes))));
end $$;

alter function ingestion_generation_evidence.general_pdf_commit_allowed(jsonb,uuid) owner to postgres;
revoke all on function ingestion_generation_evidence.general_pdf_commit_allowed(jsonb,uuid) from public,anon,authenticated,service_role;
alter function public.complete_managed_general_pdf(jsonb,uuid,jsonb,boolean) owner to postgres;
revoke all on function public.complete_managed_general_pdf(jsonb,uuid,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.complete_managed_general_pdf(jsonb,uuid,jsonb,boolean) to service_role;

-- Extend only the two exact managed allowlists. Preserve all later guard/rollback code.
do $$
declare signature text; definition text; old_guard text; new_guard text;
begin
 foreach signature in array array['public.commit_document_index_generation(jsonb,uuid,integer,integer,integer,jsonb,jsonb,jsonb)',
  'public.complete_ingestion_job(jsonb,uuid,text)'] loop
  definition:=pg_get_functiondef(signature::regprocedure);
  old_guard:=case when signature like 'public.commit_document%' then
   'ingestion_generation_evidence.admin_text_commit_allowed(p_fence,p_generation) or ingestion_generation_evidence.admin_pdf_commit_allowed(p_fence,p_generation)' else
   'ingestion_generation_evidence.admin_text_commit_allowed(p_fence,(p_fence->>''expected_generation_id'')::uuid) or ingestion_generation_evidence.admin_pdf_commit_allowed(p_fence,(p_fence->>''expected_generation_id'')::uuid)' end;
  if length(definition)-length(replace(definition,old_guard,''))<>length(old_guard)
   or not exists(select 1 from pg_proc where oid=signature::regprocedure and prosecdef and proowner='postgres'::regrole)
   then raise exception 'managed_general_pdf_guard_preimage_mismatch';end if;
  new_guard:=old_guard||case when signature like 'public.commit_document%' then ' or ingestion_generation_evidence.general_pdf_commit_allowed(p_fence,p_generation)'
   else ' or ingestion_generation_evidence.general_pdf_commit_allowed(p_fence,(p_fence->>''expected_generation_id'')::uuid)' end;
  execute replace(definition,old_guard,new_guard);
 end loop;
end $$;
