-- DRAFT: full inspected-PDF candidate activation, including explicit legacy
-- stewardship. No provider, historical-origin, clinical or publication approval.
set local lock_timeout='5s';
set local statement_timeout='120s';
create table ingestion_generation_evidence.full_pdf_stages(
 document_id uuid not null references public.documents(id) on delete cascade,generation_id uuid not null,job_id uuid not null,
 packet_digest text not null,packet jsonb not null,created_at timestamptz not null default clock_timestamp(),
 primary key(document_id,generation_id),check(packet_digest~'^sha256:[0-9a-f]{64}$'));
alter table ingestion_generation_evidence.full_pdf_stages owner to postgres;
alter table ingestion_generation_evidence.full_pdf_stages enable row level security;
revoke all on ingestion_generation_evidence.full_pdf_stages from public,anon,authenticated,service_role;
create function ingestion_generation_evidence.guard_full_pdf_stage() returns trigger language plpgsql set search_path='' as $$
begin
 -- The only deletion is the FK cascade after its parent document has actually
 -- been removed through an already-authorized document deletion. No GUC bypass.
 if tg_op='DELETE' and pg_trigger_depth()>1 and not exists(select 1 from public.documents where id=old.document_id) then return old;end if;
 raise exception 'immutable_managed_full_pdf_stage' using errcode='23514';
end $$;
create trigger full_pdf_stages_immutable before update or delete on ingestion_generation_evidence.full_pdf_stages
 for each row execute function ingestion_generation_evidence.guard_full_pdf_stage();

create function ingestion_generation_evidence.full_pdf_ref(b bytea) returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('bytesHex',encode(b,'hex'),'sha256','sha256:'||encode(extensions.digest(b,'sha256'),'hex'),'byteLength',octet_length(b))
$$;

create function ingestion_generation_evidence.assert_full_pdf_packet(f jsonb,g uuid,p jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare a jsonb;facts jsonb;c ingestion_generation_evidence.candidates;identity jsonb;inspection jsonb;rows jsonb;
 pg jsonb;image jsonb;source jsonb;table_item jsonb;r jsonb;row_family text;ordinal integer:=0;image_count integer:=0;chunk_count integer;
 retained ingestion_generation_evidence.retained_artifacts;provenance jsonb;raw_bytes bytea;covered integer;page_text text;pages jsonb:='[]';
 inspected timestamptz;expires timestamptz;total_bytes bigint:=0;expected_features jsonb;source_units integer:=0;feature_family text;box jsonb;box_index integer;feature_id text;chunk_ordinal integer:=0;
begin
 a:=public.assert_current_ingestion_attempt(f,g);if a is null then raise exception 'managed_full_pdf_current_attempt_required';end if;
 facts:=public.read_administrator_reindex_authority(f,g)->'providerAuthority';
 select * into strict c from ingestion_generation_evidence.candidates where document_id=(f->>'document_id')::uuid and generation_id=g for update;
 if octet_length(convert_to(p::text,'UTF8'))>67108864 or not ingestion_generation_evidence.keys(p,array['version','profileId','identity','inspection','rows','quality','deferredOptionalFamilies','clinicalApproval','publicationApproval'])
  or p->>'version' is distinct from 'managed-full-pdf-packet-v1' or p->>'profileId' is distinct from 'administrator-inspected-full-pdf-v1'
  or p->>'clinicalApproval' is distinct from 'not_granted' or p->>'publicationApproval' is distinct from 'not_granted'
  then raise exception 'managed_full_pdf_invalid_packet';end if;
 identity:=p->'identity';inspection:=p->'inspection';rows:=p->'rows';
 if identity->>'documentId' is distinct from c.document_id::text or identity->>'generationId' is distinct from g::text
  or identity->>'jobId' is distinct from c.job_id::text or identity->>'firstLeaseToken' is distinct from c.first_lease_token::text
  or identity->>'workerId' is distinct from f->>'worker_id' or identity->>'authorityDigest' is distinct from c.authority_digest
  or identity->'documentOwnerId' is distinct from facts->'documentOwnerId' or identity->'stewardId' is distinct from facts->'stewardId'
  or identity->>'sourceSha256' is distinct from c.source_sha256 or identity->'sourceByteLength' is distinct from to_jsonb(c.source_byte_length)
  or identity->>'sourceExpectationDigest' is distinct from c.source_expectation_digest
  or identity->'predecessorGenerationId' is distinct from coalesce(to_jsonb(c.predecessor_generation_id),'null'::jsonb)
  or identity->'attemptNumber' is distinct from a->'job'->'attempt_count' or identity->'batchId' is distinct from a->'job'->'batch_id'
  then raise exception 'managed_full_pdf_identity_mismatch';end if;
 if not ingestion_generation_evidence.keys(rows,array['chunks','images','table_facts','embedding_fields','index_units','sections','memory_cards'])
  then raise exception 'managed_full_pdf_row_families';end if;
 if inspection->>'version' is distinct from 'administrator-rich-pdf-inspection-v2'
  or inspection->>'sourceSha256' is distinct from c.source_sha256 or inspection->'sourceByteLength' is distinct from to_jsonb(c.source_byte_length)
  or inspection->>'pageInventory' is distinct from 'complete' or inspection->>'activeContent' is distinct from 'absent'
  or inspection->>'encryption' is distinct from 'not_encrypted' or inspection->>'hiddenText' is distinct from 'consistent'
  or inspection->>'verificationScope' is distinct from 'structural_and_extracted_bytes_not_clinical_semantic_approval'
  or inspection->'binding' is distinct from jsonb_build_object('admissionEventId',facts->'admissionEventId','documentId',c.document_id,'generationId',g,
   'jobId',c.job_id,'attemptId',c.job_id::text||':'||(a->'job'->>'attempt_count')||':'||c.first_lease_token::text,'leaseId',c.first_lease_token,'contentSha256',c.source_sha256,'authorityDigest',c.authority_digest)
  or jsonb_typeof(inspection->'inspectedAt') is distinct from 'string' or jsonb_typeof(inspection->'expiresAt') is distinct from 'string'
  or coalesce(inspection->>'inspectedAt','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,9})?Z$'
  or coalesce(inspection->>'expiresAt','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,9})?Z$'
  then raise exception 'managed_full_pdf_inspection_binding';end if;
 begin inspected:=(inspection->>'inspectedAt')::timestamptz;expires:=(inspection->>'expiresAt')::timestamptz;
 exception when invalid_datetime_format or datetime_field_overflow then raise exception 'managed_full_pdf_inspection_binding';end;
 if inspected>clock_timestamp() or expires<=clock_timestamp() or expires<=inspected or expires>inspected+interval '1 day' then raise exception 'managed_full_pdf_inspection_expired';end if;
 if jsonb_typeof(inspection->'pages') is distinct from 'array' or jsonb_array_length(inspection->'pages') not between 1 and 5000
  or inspection->'pageCount' is distinct from to_jsonb(jsonb_array_length(inspection->'pages'))
  or jsonb_array_length(inspection->'sourceInventory')<>jsonb_array_length(inspection->'pages')
  or jsonb_array_length(rows->'images')<>jsonb_array_length(inspection->'images') then raise exception 'managed_full_pdf_inspection_population';end if;
 foreach row_family in array array['chunks','images','table_facts','embedding_fields','index_units','sections','memory_cards'] loop
  if jsonb_typeof(rows->row_family) is distinct from 'array' or jsonb_array_length(rows->row_family)>20000
   or (select count(distinct x->>'id') from jsonb_array_elements(rows->row_family) x)<>jsonb_array_length(rows->row_family)
   then raise exception 'managed_full_pdf_row_population';end if;
  for r in select value from jsonb_array_elements(rows->row_family) loop
   if coalesce(r->>'id','')!~'^[0-9a-f-]{36}$' or r->>'document_id' is distinct from c.document_id::text or r->>'index_generation_id' is distinct from g::text
    or r->'metadata'->>'index_generation_id' is distinct from g::text
    or (row_family not in ('images','chunks') and r->'owner_id' is distinct from facts->'documentOwnerId')
    then raise exception 'managed_full_pdf_row_identity';end if;
   if row_family in ('chunks','embedding_fields','index_units','memory_cards') then
    if jsonb_typeof(r->'embedding') is distinct from 'array' or jsonb_array_length(r->'embedding')<>1536
     or exists(select 1 from jsonb_array_elements(r->'embedding') v where jsonb_typeof(v) is distinct from 'number')
     or not exists(select 1 from jsonb_array_elements_text(r->'embedding') v where v::double precision<>0)
     then raise exception 'managed_full_pdf_embedding_invalid';end if;
   end if;
   if r->>'source_chunk_id' is not null and not exists(select 1 from jsonb_array_elements(rows->'chunks') parent where parent->'id'=r->'source_chunk_id')
    then raise exception 'managed_full_pdf_chunk_parent';end if;
   if r->>'source_image_id' is not null and not exists(select 1 from jsonb_array_elements(rows->'images') parent where parent->'id'=r->'source_image_id')
    then raise exception 'managed_full_pdf_image_parent';end if;
   if row_family='sections' and exists(select 1 from jsonb_array_elements(r->'chunk_ids') link where not exists(select 1 from jsonb_array_elements(rows->'chunks') parent where parent->'id'=link))
    then raise exception 'managed_full_pdf_section_parent';end if;
   if row_family='memory_cards' and (exists(select 1 from jsonb_array_elements(r->'source_chunk_ids') link where not exists(select 1 from jsonb_array_elements(rows->'chunks') parent where parent->'id'=link))
    or exists(select 1 from jsonb_array_elements(r->'source_image_ids') link where not exists(select 1 from jsonb_array_elements(rows->'images') parent where parent->'id'=link))
    or(r->>'section_id' is not null and not exists(select 1 from jsonb_array_elements(rows->'sections') parent where parent->'id'=r->'section_id')))
    then raise exception 'managed_full_pdf_memory_parent';end if;
  end loop;
 end loop;
 chunk_count:=jsonb_array_length(rows->'chunks');
 for pg in select value from jsonb_array_elements(inspection->'pages') loop
  ordinal:=ordinal+1;covered:=0;source:=inspection->'sourceInventory'->(ordinal-1);page_text:=pg->>'text';raw_bytes:=convert_to(page_text,'UTF8');total_bytes:=total_bytes+octet_length(raw_bytes);
  if pg->'pageNumber' is distinct from to_jsonb(ordinal) or source->'pageNumber' is distinct from to_jsonb(ordinal)
   or pg->>'textSha256' is distinct from 'sha256:'||encode(extensions.digest(raw_bytes,'sha256'),'hex')
   or pg->>'nativeTextSha256' is distinct from source->>'nativeTextSha256'
   or pg->'originalFeatures' is distinct from source-array['pageNumber','nativeTextSha256','rasterBboxes','vectorBboxes','tableBboxes']
   or jsonb_typeof(pg->'ocrUsed') is distinct from 'boolean' then raise exception 'managed_full_pdf_page_binding';end if;
  source_units:=source_units+1;
  if not exists(select 1 from jsonb_array_elements(c.source_expectation->'units') u where u->>'id'='source-page-'||ordinal and u->'required'='true'::jsonb
   and u->>'locator'='pdf-page:'||ordinal||':original-native:'||(source->>'nativeTextSha256') and u->'dependencies'='[]'::jsonb)
   then raise exception 'managed_full_pdf_original_source_unit';end if;
  foreach feature_family in array array['raster','figure','table'] loop
   box_index:=0;
   for box in select value from jsonb_array_elements(source->(case feature_family when 'raster' then 'rasterBboxes' when 'figure' then 'vectorBboxes' else 'tableBboxes' end)) loop
    feature_id:='source-page-'||ordinal||'-'||feature_family||'-'||box_index;source_units:=source_units+1;
    if not exists(select 1 from jsonb_array_elements(c.source_expectation->'units') u where u->>'id'=feature_id and u->'required'='true'::jsonb
     and u->'dependencies'=jsonb_build_array('source-page-'||ordinal)
     and u->>'locator'='pdf-page:'||ordinal||':'||feature_family||':'||box_index||':sha256:'||encode(extensions.digest(convert_to(public.site_content_canonical_json(box),'UTF8'),'sha256'),'hex'))
     then raise exception 'managed_full_pdf_original_feature_unit';end if;
    box_index:=box_index+1;
   end loop;
  end loop;
  select * into strict retained from ingestion_generation_evidence.retained_artifacts ra where ra.document_id=c.document_id and ra.generation_id=g and ra.family='private_objects' and ra.unit_key='page:'||ordinal||':extracted';
  if retained.artifact_bytes is distinct from raw_bytes or retained.sha256 is distinct from pg->>'textSha256'
   or not exists(select 1 from ingestion_generation_evidence.retained_artifacts ra where ra.document_id=c.document_id and ra.generation_id=g and ra.family='private_objects' and ra.unit_key='page:'||ordinal||':persisted' and ra.artifact_bytes=raw_bytes)
   or not exists(select 1 from ingestion_generation_evidence.retained_artifacts ra where ra.document_id=c.document_id and ra.generation_id=g and ra.family='private_objects' and ra.unit_key='page:'||ordinal||':original-provenance'
    and 'sha256:'||encode(extensions.digest(convert_to(public.site_content_canonical_json((convert_from(ra.artifact_bytes,'UTF8')::jsonb)->'source_provenance'),'UTF8'),'sha256'),'hex')=pg->>'sourceProvenanceSha256')
   then raise exception 'managed_full_pdf_page_retention';end if;
  select convert_from(ra.artifact_bytes,'UTF8')::jsonb into strict r from ingestion_generation_evidence.retained_artifacts ra where ra.document_id=c.document_id and ra.generation_id=g and ra.family='pages' and ra.unit_key=ordinal::text;
  if r->>'text' is distinct from page_text or r->'ocr_used' is distinct from pg->'ocrUsed' then raise exception 'managed_full_pdf_page_projection';end if;
  pages:=pages||jsonb_build_array(r);
  for r in select value from jsonb_array_elements(rows->'chunks') where (value->>'page_number')::integer=ordinal order by (value->>'chunk_index')::integer loop
   if r->'chunk_index' is distinct from to_jsonb(chunk_ordinal) then raise exception 'managed_full_pdf_chunk_population';end if;chunk_ordinal:=chunk_ordinal+1;
   raw_bytes:=convert_to(r->>'content','UTF8');if octet_length(raw_bytes)>8191 or btrim(r->>'content')='' or raw_bytes is distinct from substring(convert_to(page_text,'UTF8') from covered+1 for octet_length(raw_bytes))
    then raise exception 'managed_full_pdf_chunk_source_partition';end if;covered:=covered+octet_length(raw_bytes);
  end loop;
  if covered<>octet_length(convert_to(page_text,'UTF8')) then raise exception 'managed_full_pdf_uncovered_page_text';end if;
  if (source->>'rasterImages')::integer<>jsonb_array_length(source->'rasterBboxes') or (source->>'vectorDrawings')::integer<>jsonb_array_length(source->'vectorBboxes')
   or (source->>'nativeTables')::integer<>jsonb_array_length(source->'tableBboxes') then raise exception 'managed_full_pdf_original_inventory';end if;
  if (source->>'nativeTables')::integer>0 and not exists(select 1 from jsonb_array_elements(inspection->'tables') t where t->'pageNumber'=pg->'pageNumber')
   then raise exception 'managed_full_pdf_missing_source_tables';end if;
  if ((source->>'rasterImages')::integer>0 or (source->>'vectorDrawings')::integer>0) and not exists(select 1 from jsonb_array_elements(inspection->'images') im where im->'pageNumber'=pg->'pageNumber')
   then raise exception 'managed_full_pdf_missing_source_visuals';end if;
 end loop;
 if source_units<>jsonb_array_length(c.source_expectation->'units') or chunk_ordinal<>chunk_count then raise exception 'managed_full_pdf_required_population';end if;
 if total_bytes>67108864 or (select count(*) from ingestion_generation_evidence.retained_artifacts ra where ra.document_id=c.document_id and ra.generation_id=g and ra.family='pages')<>ordinal
  then raise exception 'managed_full_pdf_page_population';end if;
 for image in select value from jsonb_array_elements(inspection->'images') loop
  image_count:=image_count+1;if image->'ordinal' is distinct from to_jsonb(image_count) then raise exception 'managed_full_pdf_image_ordinal';end if;
  select * into strict retained from ingestion_generation_evidence.retained_artifacts ra where ra.document_id=c.document_id and ra.generation_id=g and ra.family='private_objects' and ra.unit_key='image:'||image_count||':binary';
  if retained.sha256 is distinct from image->>'sha256' or to_jsonb(retained.byte_length) is distinct from image->'byteLength'
   or retained.sha256<>'sha256:'||encode(extensions.digest(retained.artifact_bytes,'sha256'),'hex') then raise exception 'managed_full_pdf_image_bytes';end if;
  select convert_from(ra.artifact_bytes,'UTF8')::jsonb into strict provenance from ingestion_generation_evidence.retained_artifacts ra where ra.document_id=c.document_id and ra.generation_id=g and ra.family='private_objects' and ra.unit_key='image:'||image_count||':provenance';
  if image->>'descriptorSha256' is distinct from 'sha256:'||encode(extensions.digest(convert_to(public.site_content_canonical_json(provenance->'descriptor'),'UTF8'),'sha256'),'hex')
   or image->>'metadataSha256' is distinct from 'sha256:'||encode(extensions.digest(convert_to(public.site_content_canonical_json(coalesce(provenance->'descriptor'->'metadata','{}'::jsonb)),'UTF8'),'sha256'),'hex')
   then raise exception 'managed_full_pdf_image_provenance';end if;
  r:=rows->'images'->(image_count-1);
  if r->'page_number' is distinct from image->'pageNumber' or r->>'image_hash' is distinct from substring(image->>'sha256' from 8)
   or r->'metadata'->'managed_artifact_reference' is distinct from jsonb_build_object('version','managed-pdf-image-v1','documentId',c.document_id,'generationId',g,'imageOrdinal',image_count,'sha256',image->'sha256')
   or r->>'storage_path' is distinct from 'managed-pdf/'||c.document_id::text||'/'||g::text||'/'||image_count
   then raise exception 'managed_full_pdf_image_projection';end if;
 end loop;
 if (select count(*) from ingestion_generation_evidence.retained_artifacts ra where ra.document_id=c.document_id and ra.generation_id=g and ra.representation='image_binary')<>image_count
  then raise exception 'managed_full_pdf_image_population';end if;
 for table_item in select value from jsonb_array_elements(inspection->'tables') loop
  r:=rows->'images'->((table_item->>'imageOrdinal')::integer-1);
  if r is null or table_item->'rows' is distinct from r->'metadata'->'table_rows'
   or table_item->>'rowsSha256' is distinct from 'sha256:'||encode(extensions.digest(convert_to(public.site_content_canonical_json(table_item->'rows'),'UTF8'),'sha256'),'hex')
   or r->'metadata'->'rows_truncated'='true'::jsonb then raise exception 'managed_full_pdf_table_source';end if;
  if jsonb_array_length(table_item->'rows')>1 and not exists(select 1 from jsonb_array_elements(rows->'table_facts') fact_row where fact_row->'source_image_id'=r->'id')
   then raise exception 'managed_full_pdf_required_table_facts_missing';end if;
 end loop;
 expected_features:=jsonb_build_object('nativeText',case when exists(select 1 from jsonb_array_elements(inspection->'sourceInventory') s where s->'nativeText'='true'::jsonb)then 'complete'else 'not_present'end,
  'nativeTables',case when exists(select 1 from jsonb_array_elements(inspection->'sourceInventory') s where (s->>'nativeTables')::integer>0)then 'complete'else 'not_present'end,
  'raster',case when exists(select 1 from jsonb_array_elements(inspection->'sourceInventory') s where (s->>'rasterImages')::integer>0)then 'complete'else 'not_present'end,
  'figures',case when exists(select 1 from jsonb_array_elements(inspection->'sourceInventory') s where (s->>'rasterImages')::integer>0 or(s->>'vectorDrawings')::integer>0)then 'complete'else 'not_present'end,
  'ocr',case when exists(select 1 from jsonb_array_elements(inspection->'pages') s where s->'ocrUsed'='true'::jsonb)then 'complete'else 'not_present'end);
 if inspection->'featureCoverage' is distinct from expected_features then raise exception 'managed_full_pdf_feature_coverage';end if;
 if jsonb_typeof(p->'quality'->'quality_score') is distinct from 'number' or (p->'quality'->>'quality_score')::numeric not between 0 and 1
  or coalesce(p->'quality'->>'extraction_quality','') not in('good','partial')
  or p->'quality'->'metrics'->>'quality_assessment_version' is distinct from 'existing-core-index-quality-v1'
  or p->'quality'->'metrics'->'page_count' is distinct from to_jsonb(ordinal)
  or p->'quality'->'metrics'->'extracted_image_count' is distinct from to_jsonb(image_count)
  or p->'quality'->'metrics'->'ocr_page_count' is distinct from to_jsonb((select count(*)::integer from jsonb_array_elements(inspection->'pages') s where s->'ocrUsed'='true'::jsonb))
  or p->'quality'->'metrics'->'needs_ocr_page_count' is distinct from '0'::jsonb
  then raise exception 'managed_full_pdf_observed_quality_required';end if;
 if a->'document'->>'index_generation_id' is not null and exists(select 1 from public.document_index_quality q where q.document_id=c.document_id
  and ((q.extraction_quality='good' and p->'quality'->>'extraction_quality'<>'good') or q.quality_score>(p->'quality'->>'quality_score')::real))
  then raise exception 'managed_full_pdf_quality_regression';end if;
 for r in select value from jsonb_array_elements(rows->'table_facts') loop
  select value into strict image from jsonb_array_elements(rows->'images') where value->'id'=r->'source_image_id';
  if r->'metadata'->'cells' is distinct from (select jsonb_agg(to_jsonb(btrim(left(regexp_replace(cell,'\s+',' ','g'),240))))
    from jsonb_array_elements_text(image->'metadata'->'table_rows'->((r->'metadata'->>'row_index')::integer)) cell)
   or not exists(select 1 from jsonb_array_elements(rows->'chunks') ch where ch->'id'=r->'source_chunk_id' and ch->'page_number'=r->'page_number')
   then raise exception 'managed_full_pdf_fact_source';end if;
  if (r->>'threshold_value' is not null and not exists(select 1 from jsonb_array_elements_text(r->'metadata'->'cells') cell where regexp_replace(btrim(cell),'\s+',' ','g')=r->>'threshold_value'))
   or(r->>'action' is not null and not exists(select 1 from jsonb_array_elements_text(r->'metadata'->'cells') cell where regexp_replace(btrim(cell),'\s+',' ','g')=r->>'action'))
   then raise exception 'managed_full_pdf_fact_relationship';end if;
 end loop;
 if exists(select 1 from ingestion_generation_evidence.retained_artifacts artifact_row where artifact_row.document_id=c.document_id and artifact_row.generation_id=g and
  (artifact_row.source_sha256<>c.source_sha256 or artifact_row.byte_length<>octet_length(artifact_row.artifact_bytes) or artifact_row.sha256<>'sha256:'||encode(extensions.digest(artifact_row.artifact_bytes,'sha256'),'hex')))
  then raise exception 'managed_full_pdf_retained_integrity';end if;
 if exists(select 1 from ingestion_generation_evidence.unit_declarations d left join ingestion_generation_evidence.outcomes o using(document_id,generation_id,family,unit_key)
  where d.document_id=c.document_id and d.generation_id=g and d.declaration->'required'='true'::jsonb
  and not(d.family='attempt_control' and d.unit_key='preseal_checkpoint')
  and(o.outcome->>'disposition' is distinct from 'retained' or not exists(select 1 from ingestion_generation_evidence.retained_artifacts proof_artifact
   where proof_artifact.document_id=d.document_id and proof_artifact.generation_id=g and proof_artifact.family=d.family and proof_artifact.unit_key=d.unit_key and proof_artifact.sha256=o.outcome->>'artifactSha256')))
  then raise exception 'managed_full_pdf_required_retention_incomplete';end if;
 if not exists(select 1 from ingestion_generation_evidence.unit_declarations d where d.document_id=c.document_id and d.generation_id=g and d.family='attempt_control' and d.unit_key='preseal_checkpoint'
  and d.declaration->'dependencies'='[{"family":"attempt_control","key":"claim_checkpoint"},{"family":"private_objects","key":"original-source"}]'::jsonb)
  then raise exception 'managed_full_pdf_preseal_declaration_required';end if;
 return jsonb_build_object('pages',pages,'pageCount',ordinal,'chunkCount',chunk_count,'imageCount',(select count(*) from jsonb_array_elements(rows->'images') im where im->'searchable'='true'::jsonb));
end $$;

create function public.stage_managed_full_pdf(p_fence jsonb,p_generation uuid,p_packet jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare digest text;previous ingestion_generation_evidence.full_pdf_stages;bytes bytea;
begin
 perform ingestion_generation_evidence.assert_full_pdf_packet(p_fence,p_generation,p_packet);
 bytes:=convert_to(public.site_content_canonical_json(p_packet),'UTF8');digest:='sha256:'||encode(extensions.digest(bytes,'sha256'),'hex');
 select * into previous from ingestion_generation_evidence.full_pdf_stages where document_id=(p_fence->>'document_id')::uuid and generation_id=p_generation;
 if found then if previous.packet is distinct from p_packet or previous.packet_digest<>digest then raise exception 'managed_full_pdf_immutable_stage';end if;
 else insert into ingestion_generation_evidence.full_pdf_stages(document_id,generation_id,job_id,packet_digest,packet) values((p_fence->>'document_id')::uuid,p_generation,(p_fence->>'job_id')::uuid,digest,p_packet);end if;
 return jsonb_build_object('ok',true,'packetDigest',digest,'packet',ingestion_generation_evidence.full_pdf_ref(bytes));
end $$;

create function ingestion_generation_evidence.full_pdf_rows_match(doc uuid,g uuid,p jsonb)
returns boolean language plpgsql set search_path='' as $$
declare row_family text;target text;row jsonb;actual jsonb;total integer;ignored text[]:=array['created_at','updated_at','search_tsv'];
begin
 foreach row_family in array array['images','chunks','table_facts','embedding_fields','index_units','sections','memory_cards'] loop
  target:='public.document_'||row_family;
  execute format('select count(*) from %s where document_id=$1 and index_generation_id=$2',target) into total using doc,g;
  if total<>jsonb_array_length(p->'rows'->row_family) then return false;end if;
  for row in select value from jsonb_array_elements(p->'rows'->row_family) loop
   execute format('select to_jsonb(t)-$2 from %s t where id=$1',target) into actual using (row->>'id')::uuid,ignored;
   execute format('select to_jsonb(jsonb_populate_record(null::%s,$1))-$2',target) into row using row,ignored;
   if actual is distinct from row then return false;end if;
  end loop;
 end loop;return true;
end $$;

create function ingestion_generation_evidence.full_pdf_commit_allowed(f jsonb,g uuid)
returns boolean language sql stable set search_path='' as $$
 select coalesce(current_setting('psychsift.full_pdf_terminal_owner',true)=(f->>'document_id')||':'||(f->>'job_id'),false)
 and exists(select 1 from ingestion_generation_evidence.full_pdf_stages s where s.document_id=(f->>'document_id')::uuid and s.generation_id=g and s.job_id=(f->>'job_id')::uuid
  and s.packet->'identity'->>'authorityDigest'=f->>'authority_digest' and s.packet->'identity'->>'firstLeaseToken'=f->>'lease_token'
  and ingestion_generation_evidence.full_pdf_rows_match(s.document_id,g,s.packet))
$$;

create function public.complete_managed_full_pdf(p_fence jsonb,p_generation uuid,p_packet_digest text,p_read_only boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s ingestion_generation_evidence.full_pdf_stages;j public.ingestion_jobs;a jsonb;stats jsonb;seal jsonb;seal_bytes bytea;seal_hash text;
 row_family text;target text;columns text;ignored text[]:=array['created_at','updated_at','search_tsv'];result jsonb;quality jsonb;replay text;claim jsonb;checkpoint bytea;checkpoint_hash text;
begin
 if p_read_only is null or not ingestion_generation_evidence.visual_unit_fence(p_fence) then raise exception 'managed_full_pdf_invalid_fence';end if;
 a:=public.lock_ingestion_document_authority((p_fence->>'document_id')::uuid,false);
 select * into strict j from public.ingestion_jobs where id=(p_fence->>'job_id')::uuid for update;
 select * into strict s from ingestion_generation_evidence.full_pdf_stages where document_id=(p_fence->>'document_id')::uuid and generation_id=p_generation for update;
 if a is null or s.packet_digest is distinct from p_packet_digest or s.job_id<>j.id or s.packet->'identity'->>'authorityDigest' is distinct from a->>'authority_digest'
  or s.packet->'identity'->>'firstLeaseToken' is distinct from p_fence->>'lease_token' or s.packet->'identity'->>'workerId' is distinct from p_fence->>'worker_id'
  then raise exception 'managed_full_pdf_terminal_identity';end if;
 seal:=jsonb_build_object('version','managed-full-pdf-seal-v1','packetDigest',s.packet_digest,'identity',s.packet->'identity','clinicalApproval','not_granted','publicationApproval','not_granted','inspectionScope','structural_and_extracted_bytes_not_clinical_semantic_approval');
 seal_bytes:=convert_to(seal::text,'UTF8');seal_hash:='sha256:'||encode(extensions.digest(seal_bytes,'sha256'),'hex');
 if j.status='completed' then
  perform 1 from auth.users u where u.id=(s.packet->'identity'->>'stewardId')::uuid and u.raw_app_meta_data->>'site_role'='administrator'
   and to_jsonb(u)->>'deleted_at' is null and(to_jsonb(u)->>'banned_until' is null or(to_jsonb(u)->>'banned_until')::timestamptz<=clock_timestamp()) for share;
  if not found then raise exception 'managed_full_pdf_steward_revoked';end if;
  if j.stage<>'full_pdf_completed' or (a->'document'->>'index_generation_id')::uuid is distinct from p_generation or not ingestion_generation_evidence.full_pdf_rows_match(s.document_id,p_generation,s.packet)
   or not exists(select 1 from ingestion_generation_evidence.prerequisite_accounting where document_id=s.document_id and generation_id=p_generation and snapshot=seal and snapshot_digest=seal_hash)
   then raise exception 'managed_full_pdf_completed_read_mismatch';end if;replay:='already_completed';
 else
  if p_read_only then raise exception 'managed_full_pdf_not_completed';end if;
  stats:=ingestion_generation_evidence.assert_full_pdf_packet(p_fence,p_generation,s.packet);
  select convert_from(ra.artifact_bytes,'UTF8')::jsonb into strict claim from ingestion_generation_evidence.retained_artifacts ra where ra.document_id=s.document_id and ra.generation_id=p_generation and ra.family='attempt_control' and ra.unit_key='claim_checkpoint';
  checkpoint:=convert_to((claim||jsonb_build_object('phase','preseal','terminalVersion','managed-full-pdf-packet-v1','packetDigest',s.packet_digest))::text,'UTF8');
  checkpoint_hash:='sha256:'||encode(extensions.digest(checkpoint,'sha256'),'hex');
  insert into ingestion_generation_evidence.retained_artifacts(document_id,generation_id,family,unit_key,group_key,representation,source_sha256,artifact_bytes,sha256,byte_length,locator)
   values(s.document_id,p_generation,'attempt_control','preseal_checkpoint','control','provenance_json',s.packet->'identity'->>'sourceSha256',checkpoint,checkpoint_hash,octet_length(checkpoint),'ingestion_attempt:full_pdf_preseal');
  insert into ingestion_generation_evidence.outcomes(document_id,generation_id,family,unit_key,group_key,outcome)
   values(s.document_id,p_generation,'attempt_control','preseal_checkpoint','control',jsonb_build_object('unitId',jsonb_build_object('family','attempt_control','key','preseal_checkpoint'),'groupKey','control','disposition','retained','artifactSha256',checkpoint_hash,'limitation',null));
  foreach row_family in array array['images','chunks','table_facts','embedding_fields','index_units','sections','memory_cards'] loop
   target:='public.document_'||row_family;
   select string_agg(quote_ident(attname),',' order by attnum) into columns from pg_attribute where attrelid=target::regclass and attnum>0 and not attisdropped and attgenerated='' and attname<>all(ignored);
   execute format('insert into %s(%s) select %s from jsonb_populate_recordset(null::%s,$1)',target,columns,columns,target) using s.packet->'rows'->row_family;
  end loop;
  insert into ingestion_generation_evidence.prerequisite_accounting(document_id,generation_id,snapshot_digest,snapshot) values(s.document_id,p_generation,seal_hash,seal);
  quality:=s.packet->'quality'||jsonb_build_object('metrics',s.packet->'quality'->'metrics'||jsonb_build_object('full_pdf_seal_digest',seal_hash));
  perform set_config('psychsift.full_pdf_terminal_owner',s.document_id::text||':'||s.job_id::text,true);
  result:=public.commit_document_index_generation(p_fence,p_generation,(stats->>'pageCount')::integer,(stats->>'chunkCount')::integer,(stats->>'imageCount')::integer,'{}'::jsonb,stats->'pages',quality);
  if result->'ok' is distinct from 'true'::jsonb then raise exception 'managed_full_pdf_commit_failed';end if;
  result:=public.complete_ingestion_job(result->'fence',j.batch_id,'full_pdf_completed');if result->'ok' is distinct from 'true'::jsonb then raise exception 'managed_full_pdf_job_completion_failed';end if;
  update public.ingestion_jobs set next_run_at=null,lease_expires_at=null,lease_duration_seconds=null where id=s.job_id;
  perform set_config('psychsift.full_pdf_terminal_owner','',true);replay:='completed';
 end if;
 return jsonb_build_object('ok',true,'managedFullPdfTerminal',jsonb_build_object('activated',true,'replay',replay,'seal',ingestion_generation_evidence.full_pdf_ref(seal_bytes)));
end $$;

create function public.read_managed_pdf_image(p_image_id uuid,p_document_id uuid,p_generation uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare im public.document_images;ref jsonb;a ingestion_generation_evidence.retained_artifacts;d public.documents;
begin
 select * into strict d from public.documents where id=p_document_id for share;
 if d.index_generation_id is distinct from p_generation then raise exception 'managed_pdf_image_generation_mismatch';end if;
 select * into strict im from public.document_images where id=p_image_id and document_id=d.id and index_generation_id=p_generation for share;
 ref:=im.metadata->'managed_artifact_reference';
 if ref->>'version' is distinct from 'managed-pdf-image-v1' or ref->>'documentId' is distinct from d.id::text or ref->>'generationId' is distinct from p_generation::text
  or coalesce(ref->>'imageOrdinal','')!~'^[1-9][0-9]*$' then raise exception 'managed_pdf_image_reference_invalid';end if;
 select * into strict a from ingestion_generation_evidence.retained_artifacts ra where ra.document_id=d.id and ra.generation_id=p_generation and ra.family='private_objects' and ra.unit_key='image:'||(ref->>'imageOrdinal')||':binary';
 if a.byte_length>16777216 or a.sha256 is distinct from ref->>'sha256' or a.sha256<>'sha256:'||encode(extensions.digest(a.artifact_bytes,'sha256'),'hex')
  then raise exception 'managed_pdf_image_integrity';end if;
 return jsonb_build_object('bytesHex',encode(a.artifact_bytes,'hex'),'sha256',a.sha256,'byteLength',a.byte_length,'mimeType',im.mime_type);
end $$;

do $$
declare signature text;definition text;old_guard text;
begin
 foreach signature in array array['public.commit_document_index_generation(jsonb,uuid,integer,integer,integer,jsonb,jsonb,jsonb)','public.complete_ingestion_job(jsonb,uuid,text)'] loop
  definition:=pg_get_functiondef(signature::regprocedure);old_guard:=case when signature like 'public.commit_document%' then 'ingestion_generation_evidence.general_pdf_commit_allowed(p_fence,p_generation)' else 'ingestion_generation_evidence.general_pdf_commit_allowed(p_fence,(p_fence->>''expected_generation_id'')::uuid)' end;
  if length(definition)-length(replace(definition,old_guard,''))<>length(old_guard) then raise exception 'managed_full_pdf_guard_preimage';end if;
  execute replace(definition,old_guard,old_guard||case when signature like 'public.commit_document%' then ' or ingestion_generation_evidence.full_pdf_commit_allowed(p_fence,p_generation)' else ' or ingestion_generation_evidence.full_pdf_commit_allowed(p_fence,(p_fence->>''expected_generation_id'')::uuid)' end);
 end loop;
end $$;
alter function ingestion_generation_evidence.full_pdf_ref(bytea) owner to postgres;
alter function ingestion_generation_evidence.guard_full_pdf_stage() owner to postgres;
alter function ingestion_generation_evidence.assert_full_pdf_packet(jsonb,uuid,jsonb) owner to postgres;
alter function ingestion_generation_evidence.full_pdf_rows_match(uuid,uuid,jsonb) owner to postgres;
alter function ingestion_generation_evidence.full_pdf_commit_allowed(jsonb,uuid) owner to postgres;
revoke all on function ingestion_generation_evidence.full_pdf_ref(bytea),ingestion_generation_evidence.assert_full_pdf_packet(jsonb,uuid,jsonb),ingestion_generation_evidence.full_pdf_rows_match(uuid,uuid,jsonb),ingestion_generation_evidence.full_pdf_commit_allowed(jsonb,uuid) from public,anon,authenticated,service_role;
revoke all on function ingestion_generation_evidence.guard_full_pdf_stage() from public,anon,authenticated,service_role;
alter function public.stage_managed_full_pdf(jsonb,uuid,jsonb) owner to postgres;
alter function public.complete_managed_full_pdf(jsonb,uuid,text,boolean) owner to postgres;
alter function public.read_managed_pdf_image(uuid,uuid,uuid) owner to postgres;
revoke execute on function public.stage_managed_full_pdf(jsonb,uuid,jsonb) from public,anon,authenticated;
revoke execute on function public.complete_managed_full_pdf(jsonb,uuid,text,boolean) from public,anon,authenticated;
revoke execute on function public.read_managed_pdf_image(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.stage_managed_full_pdf(jsonb,uuid,jsonb),public.complete_managed_full_pdf(jsonb,uuid,text,boolean),public.read_managed_pdf_image(uuid,uuid,uuid) to service_role;
