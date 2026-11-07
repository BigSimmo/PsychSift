-- DRAFT: reviewed render evidence is a distinct profile. Native extraction is
-- excluded; a render review grants no ingestion/provider/publication/clinical
-- authority. Approval of the exact review digest is trusted runtime policy.
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';

create function ingestion_generation_evidence.rendered_pdf_hash(v jsonb)
returns text language sql immutable set search_path='' as $$
 select 'sha256:'||encode(extensions.digest(convert_to(public.site_content_canonical_json(v),'UTF8'),'sha256'),'hex')
$$;

create function ingestion_generation_evidence.rendered_pdf_rect(outer_box jsonb,inner_box jsonb)
returns boolean language plpgsql immutable set search_path='' as $$
begin
 if jsonb_typeof(outer_box) is distinct from 'array' or jsonb_typeof(inner_box) is distinct from 'array'
  or jsonb_array_length(outer_box)<>4 or jsonb_array_length(inner_box)<>4
  or exists(select 1 from jsonb_array_elements(outer_box||inner_box) x where jsonb_typeof(x) is distinct from 'number') then return false;end if;
 return (inner_box->>0)::numeric>=(outer_box->>0)::numeric and (inner_box->>1)::numeric>=(outer_box->>1)::numeric
  and (inner_box->>2)::numeric<=(outer_box->>2)::numeric and (inner_box->>3)::numeric<=(outer_box->>3)::numeric
  and (inner_box->>0)::numeric<(inner_box->>2)::numeric and (inner_box->>1)::numeric<(inner_box->>3)::numeric;
end $$;

-- Review offsets are JavaScript UTF-16 offsets, including supplementary
-- characters. Refuse an offset in the middle of a surrogate pair.
create function ingestion_generation_evidence.rendered_pdf_utf16_slice(v text,start_ integer,end_ integer)
returns text language plpgsql immutable set search_path='' as $$
declare n integer:=0;i integer;width_ integer;result text:='';start_found boolean:=false;end_found boolean:=false;ch text;
begin
 if start_<0 or end_<=start_ then raise exception 'managed_rendered_pdf_ocr_mapping';end if;
 for i in 1..length(v) loop
  if n=start_ then start_found:=true;end if;if n=end_ then end_found:=true;exit;end if;
  ch:=substr(v,i,1);width_:=case when ascii(ch)>65535 then 2 else 1 end;
  if n>=start_ and n<end_ then result:=result||ch;end if;n:=n+width_;
 end loop;
 if n=end_ then end_found:=true;end if;
 if not start_found or not end_found then raise exception 'managed_rendered_pdf_ocr_mapping';end if;return result;
end $$;

create function ingestion_generation_evidence.assert_rendered_pdf_text(v jsonb,ocr text,bounds jsonb,allow_empty boolean default false)
returns void language plpgsql immutable set search_path='' as $$
begin
 if jsonb_typeof(v->'text') is distinct from 'string' or not ingestion_generation_evidence.rendered_pdf_rect(bounds,v->'region')
  or (btrim(v->>'text')='' and not(allow_empty and v->>'origin'='manual_render_transcription')) then raise exception 'managed_rendered_pdf_text_record';end if;
 if v->>'origin'='render_ocr' then
  if not ingestion_generation_evidence.keys(v,array['origin','region','start','end','text']) or coalesce(v->>'start','')!~'^(0|[1-9][0-9]*)$'
   or coalesce(v->>'end','')!~'^[1-9][0-9]*$'
   or ingestion_generation_evidence.rendered_pdf_utf16_slice(ocr,(v->>'start')::integer,(v->>'end')::integer) is distinct from v->>'text'
   then raise exception 'managed_rendered_pdf_ocr_mapping';end if;
 elsif v->>'origin'='manual_render_transcription' then
  if not ingestion_generation_evidence.keys(v,array['origin','region','text']) then raise exception 'managed_rendered_pdf_text_record';end if;
 else raise exception 'managed_rendered_pdf_text_record';end if;
end $$;

-- All source anchors are independently retained bytes, not hashes supplied only
-- by the proposed packet. The exact human review is retained and digest-bound.
create function ingestion_generation_evidence.assert_rendered_pdf_review(doc uuid,g uuid,i jsonb)
returns void language plpgsql set search_path='' as $$
declare review jsonb:=i->'reviewRecord';pg jsonb;item jsonb;row_ jsonb;cell jsonb;node jsonb;edge jsonb;geometry jsonb;
 bounds jsonb;ocr text;parts text[];expected_text text;rows_ jsonb;observed jsonb;seen text[];nodes text[];edges text[];
 page_no integer:=0;row_no integer;column_no integer;width_ integer;table_count integer:=0;diagram_count integer:=0;raster jsonb;raw_raster bytea;
 inspected timestamptz;expires timestamptz;reviewed timestamptz;
begin
 if not ingestion_generation_evidence.keys(i,array['version','verificationScope','binding','reviewSha256','reviewRecord','inspectedAt','expiresAt','sourceSha256','sourceByteLength','pageCount','pages','images','tables','diagrams','featureCoverage','nativeLayerDisposition','originalNativeConflict'])
  or i->>'version' is distinct from 'managed-rendered-pdf-inspection-view-v1'
  or i->>'verificationScope' is distinct from 'source_anchored_render_review_not_clinical_signoff'
  or i->>'nativeLayerDisposition' is distinct from 'excluded_from_admitted_evidence' or i->>'originalNativeConflict' is distinct from 'unresolved'
  or not ingestion_generation_evidence.keys(review,array['version','verificationScope','authority','sourceSha256','sourceByteLength','pageCount','nativeLayerDisposition','originalNativeConflict','runtime','rasterContainer','reviewer','pageCoverage','pages'])
  or review->>'version' is distinct from 'administrator-rendered-pdf-inspection-v1'
  or review->>'verificationScope' is distinct from i->>'verificationScope'
  or review->>'authority' is distinct from 'render_review_only_no_ingestion_provider_publication_or_clinical_approval'
  or review->>'nativeLayerDisposition' is distinct from i->>'nativeLayerDisposition' or review->>'originalNativeConflict' is distinct from i->>'originalNativeConflict'
  or review->>'pageCoverage' is distinct from 'reviewed_complete' or review->'sourceSha256' is distinct from i->'sourceSha256'
  or not ingestion_generation_evidence.keys(review->'rasterContainer',array['sha256','byteLength'])
  or review->'sourceByteLength' is distinct from i->'sourceByteLength' or review->'pageCount' is distinct from i->'pageCount'
  or i->>'reviewSha256' is distinct from ingestion_generation_evidence.rendered_pdf_hash(review)
  then raise exception 'managed_rendered_pdf_review_binding';end if;
 if not ingestion_generation_evidence.keys(review->'reviewer',array['reviewerId','reviewedAt','referenceSha256'])
  or coalesce(review->'reviewer'->>'reviewerId','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  or coalesce(review->'reviewer'->>'referenceSha256','')!~'^sha256:[a-f0-9]{64}$'
  or not ingestion_generation_evidence.keys(review->'runtime',array['pythonVersion','pymupdfVersion','mupdfVersion','tesseractVersion','pillowVersion','pytesseractVersion','rendererScriptSha256','extractorScriptSha256'])
  or exists(select 1 from jsonb_each_text(review->'runtime') x where case when x.key like '%Sha256' then x.value!~'^sha256:[a-f0-9]{64}$' else x.value!~'^[A-Za-z0-9.+_-]{1,128}$' end)
  then raise exception 'managed_rendered_pdf_reviewer_runtime';end if;
 if coalesce(i->>'inspectedAt','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,9})?Z$'
  or coalesce(i->>'expiresAt','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,9})?Z$'
  or coalesce(review->'reviewer'->>'reviewedAt','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,9})?Z$' then raise exception 'managed_rendered_pdf_review_time';end if;
 begin inspected:=(i->>'inspectedAt')::timestamptz;expires:=(i->>'expiresAt')::timestamptz;reviewed:=(review->'reviewer'->>'reviewedAt')::timestamptz;
 exception when invalid_datetime_format or datetime_field_overflow then raise exception 'managed_rendered_pdf_review_time';end;
 if inspected>clock_timestamp() or expires<=clock_timestamp() or expires<=inspected or expires>inspected+interval '1 day' or reviewed>inspected then raise exception 'managed_rendered_pdf_review_time';end if;
 if jsonb_typeof(review->'pages') is distinct from 'array' or jsonb_array_length(review->'pages') not between 1 and 5000
  or review->'pageCount' is distinct from to_jsonb(jsonb_array_length(review->'pages')) or jsonb_array_length(i->'pages')<>jsonb_array_length(review->'pages')
  or jsonb_typeof(i->'tables') is distinct from 'array' or jsonb_typeof(i->'diagrams') is distinct from 'array'
  then raise exception 'managed_rendered_pdf_review_population';end if;
 if not exists(select 1 from ingestion_generation_evidence.retained_artifacts a where a.document_id=doc and a.generation_id=g and a.family='private_objects'
   and a.unit_key='rendered-review-record' and a.sha256=i->>'reviewSha256' and convert_from(a.artifact_bytes,'UTF8')::jsonb=review)
  then raise exception 'managed_rendered_pdf_review_retention';end if;
 select convert_from(a.artifact_bytes,'UTF8')::jsonb into strict raster from ingestion_generation_evidence.retained_artifacts a where a.document_id=doc and a.generation_id=g and a.family='private_objects' and a.unit_key='rendered-raster-container';
 if not ingestion_generation_evidence.keys(raster,array['version','mimeType','sha256','byteLength','bytesHex']) or raster->>'version' is distinct from 'rendered-raster-container-retention-v1'
  or raster->>'mimeType' is distinct from 'application/pdf' or coalesce(raster->>'bytesHex','')!~'^([a-f0-9]{2})+$'
  or raster->'sha256' is distinct from review->'rasterContainer'->'sha256' or raster->'byteLength' is distinct from review->'rasterContainer'->'byteLength'
  then raise exception 'managed_rendered_pdf_raster_retention';end if;
 raw_raster:=decode(raster->>'bytesHex','hex');
 if raster->>'sha256' is distinct from 'sha256:'||encode(extensions.digest(raw_raster,'sha256'),'hex') or raster->'byteLength' is distinct from to_jsonb(octet_length(raw_raster))
  or substring(raw_raster from 1 for 5)<>convert_to('%PDF-','UTF8') then raise exception 'managed_rendered_pdf_raster_retention';end if;
 for pg in select value from jsonb_array_elements(review->'pages') loop
  page_no:=page_no+1;parts:=array[]::text[];seen:=array[]::text[];
  if not ingestion_generation_evidence.keys(pg,array['pageNumber','fullPageReviewed','coordinateSpace','originalGeometrySha256','render','ocrTextSha256','ocrTextByteLength','textCoverage','text','tables','diagrams','unresolvedHolds'])
   or pg->'pageNumber' is distinct from to_jsonb(page_no) or pg->'fullPageReviewed' is distinct from 'true'::jsonb
   or pg->>'coordinateSpace' is distinct from 'render_pixels' or pg->>'textCoverage' is distinct from 'reviewed_complete'
   or pg->'unresolvedHolds' is distinct from '[]'::jsonb or jsonb_typeof(pg->'text') is distinct from 'array'
   or not ingestion_generation_evidence.keys(pg->'render',array['sha256','byteLength','width','height'])
   or coalesce(pg->'render'->>'width','')!~'^[1-9][0-9]*$' or coalesce(pg->'render'->>'height','')!~'^[1-9][0-9]*$'
   or (pg->'render'->>'width')::numeric*(pg->'render'->>'height')::numeric>4000000 then raise exception 'managed_rendered_pdf_page_review';end if;
  bounds:=jsonb_build_array(0,0,pg->'render'->'width',pg->'render'->'height');
  select convert_from(a.artifact_bytes,'UTF8') into strict ocr from ingestion_generation_evidence.retained_artifacts a where a.document_id=doc and a.generation_id=g and a.family='private_objects' and a.unit_key='page:'||page_no||':rendered-ocr'
   and a.sha256=pg->>'ocrTextSha256' and to_jsonb(a.byte_length)=pg->'ocrTextByteLength';
  select convert_from(a.artifact_bytes,'UTF8')::jsonb into strict geometry from ingestion_generation_evidence.retained_artifacts a where a.document_id=doc and a.generation_id=g and a.family='private_objects' and a.unit_key='page:'||page_no||':rendered-original-geometry';
  if ingestion_generation_evidence.rendered_pdf_hash(geometry) is distinct from pg->>'originalGeometrySha256' then raise exception 'managed_rendered_pdf_geometry';end if;
  if not exists(select 1 from jsonb_array_elements(i->'images') im where im->'pageNumber'=pg->'pageNumber' and im->>'sourceKind'='page_region'
    and im->'sha256'=pg->'render'->'sha256' and im->'byteLength'=pg->'render'->'byteLength' and im->'width'=pg->'render'->'width' and im->'height'=pg->'render'->'height') then raise exception 'managed_rendered_pdf_render_missing';end if;
  for item in select value from jsonb_array_elements(pg->'text') loop perform ingestion_generation_evidence.assert_rendered_pdf_text(item,ocr,bounds);parts:=array_append(parts,item->>'text');end loop;
  if pg->'tables'->>'status'='absent' then
   if not ingestion_generation_evidence.keys(pg->'tables',array['status']) then raise exception 'managed_rendered_pdf_table_coverage';end if;
  elsif pg->'tables'->>'status'='reviewed_complete' then
   if not ingestion_generation_evidence.keys(pg->'tables',array['status','records']) or jsonb_typeof(pg->'tables'->'records') is distinct from 'array' or jsonb_array_length(pg->'tables'->'records')=0 then raise exception 'managed_rendered_pdf_table_coverage';end if;
   for item in select value from jsonb_array_elements(pg->'tables'->'records') loop
    table_count:=table_count+1;row_no:=0;rows_:='[]';
    if not ingestion_generation_evidence.keys(item,array['id','region','relationships','rows']) or coalesce(item->>'id','')!~'^[A-Za-z0-9_-]{1,80}$' or item->>'id'=any(seen)
     or item->>'relationships' is distinct from 'reviewed_complete' or not ingestion_generation_evidence.rendered_pdf_rect(bounds,item->'region')
     or jsonb_typeof(item->'rows') is distinct from 'array' or jsonb_array_length(item->'rows')=0 then raise exception 'managed_rendered_pdf_table_record';end if;
    seen:=array_append(seen,item->>'id');width_:=jsonb_array_length(item->'rows'->0->'cells');
    if width_<1 then raise exception 'managed_rendered_pdf_table_relationships';end if;
    for row_ in select value from jsonb_array_elements(item->'rows') loop
     if not ingestion_generation_evidence.keys(row_,array['rowIndex','cells']) or row_->'rowIndex' is distinct from to_jsonb(row_no) or jsonb_array_length(row_->'cells')<>width_ then raise exception 'managed_rendered_pdf_table_relationships';end if;
     column_no:=0;observed:='[]';
     for cell in select value from jsonb_array_elements(row_->'cells') loop
      if not ingestion_generation_evidence.keys(cell,array['columnIndex','content']) or cell->'columnIndex' is distinct from to_jsonb(column_no) then raise exception 'managed_rendered_pdf_table_relationships';end if;
      perform ingestion_generation_evidence.assert_rendered_pdf_text(cell->'content',ocr,item->'region',true);observed:=observed||jsonb_build_array(cell->'content'->'text');column_no:=column_no+1;
     end loop;
     rows_:=rows_||jsonb_build_array(observed);parts:=array_append(parts,(select string_agg(value,E'\t' order by n) from jsonb_array_elements_text(observed) with ordinality q(value,n)));row_no:=row_no+1;
    end loop;
    select value into observed from jsonb_array_elements(i->'tables') t where t->'pageNumber'=pg->'pageNumber' and t->'reviewedTableId'=item->'id';
    if not ingestion_generation_evidence.keys(observed,array['imageOrdinal','pageNumber','reviewedTableId','region','rows','renderSha256']) or observed->'region' is distinct from item->'region' or observed->'rows' is distinct from rows_ or observed->'renderSha256' is distinct from pg->'render'->'sha256' then raise exception 'managed_rendered_pdf_table_projection';end if;
   end loop;
  else raise exception 'managed_rendered_pdf_table_coverage';end if;
  if pg->'diagrams'->>'status'='absent' then
   if not ingestion_generation_evidence.keys(pg->'diagrams',array['status']) then raise exception 'managed_rendered_pdf_diagram_coverage';end if;
  elsif pg->'diagrams'->>'status'='reviewed_complete' then
   if not ingestion_generation_evidence.keys(pg->'diagrams',array['status','records']) or jsonb_typeof(pg->'diagrams'->'records') is distinct from 'array' or jsonb_array_length(pg->'diagrams'->'records')=0 then raise exception 'managed_rendered_pdf_diagram_coverage';end if;
   for item in select value from jsonb_array_elements(pg->'diagrams'->'records') loop
    diagram_count:=diagram_count+1;nodes:=array[]::text[];edges:=array[]::text[];
    if not ingestion_generation_evidence.keys(item,array['id','region','relationships','nodes','edges']) or coalesce(item->>'id','')!~'^[A-Za-z0-9_-]{1,80}$' or item->>'id'=any(seen)
     or item->>'relationships' is distinct from 'reviewed_complete' or not ingestion_generation_evidence.rendered_pdf_rect(bounds,item->'region')
     or jsonb_typeof(item->'nodes') is distinct from 'array' or jsonb_array_length(item->'nodes')=0 or jsonb_typeof(item->'edges') is distinct from 'array' then raise exception 'managed_rendered_pdf_diagram_record';end if;
    seen:=array_append(seen,item->>'id');
    for node in select value from jsonb_array_elements(item->'nodes') loop
     if not ingestion_generation_evidence.keys(node,array['id','content']) or coalesce(node->>'id','')!~'^[A-Za-z0-9_-]{1,80}$' or node->>'id'=any(nodes) then raise exception 'managed_rendered_pdf_diagram_relationships';end if;
     perform ingestion_generation_evidence.assert_rendered_pdf_text(node->'content',ocr,item->'region');nodes:=array_append(nodes,node->>'id');parts:=array_append(parts,node->'content'->>'text');
    end loop;
    for edge in select value from jsonb_array_elements(item->'edges') loop
     if not ingestion_generation_evidence.keys(edge,array['id','fromNodeId','toNodeId','direction','label','region']) or coalesce(edge->>'id','')!~'^[A-Za-z0-9_-]{1,80}$' or edge->>'id'=any(edges)
      or not(edge->>'fromNodeId'=any(nodes)) or not(edge->>'toNodeId'=any(nodes)) or coalesce(edge->>'direction','') not in('directed','undirected') or not ingestion_generation_evidence.rendered_pdf_rect(item->'region',edge->'region') then raise exception 'managed_rendered_pdf_diagram_relationships';end if;
     edges:=array_append(edges,edge->>'id');if edge->'label'<>'null'::jsonb then perform ingestion_generation_evidence.assert_rendered_pdf_text(edge->'label',ocr,edge->'region');end if;
     select value->'content'->>'text' into expected_text from jsonb_array_elements(item->'nodes') where value->'id'=edge->'fromNodeId';
     select expected_text||case when edge->>'direction'='directed' then ' -> ' else ' -- ' end||(value->'content'->>'text')||case when edge->'label'='null'::jsonb then '' else ': '||(edge->'label'->>'text') end into expected_text from jsonb_array_elements(item->'nodes') where value->'id'=edge->'toNodeId';parts:=array_append(parts,expected_text);
    end loop;
    select value into observed from jsonb_array_elements(i->'diagrams') t where t->'pageNumber'=pg->'pageNumber' and t->'reviewedDiagramId'=item->'id';
    if observed is distinct from jsonb_build_object('pageNumber',pg->'pageNumber','reviewedDiagramId',item->'id','region',item->'region','nodes',item->'nodes','edges',item->'edges','renderSha256',pg->'render'->'sha256') then raise exception 'managed_rendered_pdf_diagram_projection';end if;
   end loop;
  else raise exception 'managed_rendered_pdf_diagram_coverage';end if;
  observed:=i->'pages'->(page_no-1);
  if not ingestion_generation_evidence.keys(observed,array['pageNumber','text','ocrUsed','sourceProvenanceSha256','renderSha256','ocrTextSha256'])
   or observed->'pageNumber' is distinct from pg->'pageNumber' or observed->'ocrUsed' is distinct from 'true'::jsonb
   or observed->>'text' is distinct from array_to_string(parts,E'\n') or observed->'renderSha256' is distinct from pg->'render'->'sha256' or observed->'ocrTextSha256' is distinct from pg->'ocrTextSha256' then raise exception 'managed_rendered_pdf_text_projection';end if;
 end loop;
 if table_count<>jsonb_array_length(i->'tables') or diagram_count<>jsonb_array_length(i->'diagrams')
  or i->'featureCoverage' is distinct from jsonb_build_object('renderedPages','complete','reviewedText','complete','reviewedTables',case when table_count>0 then 'complete' else 'not_present' end,'reviewedDiagrams',case when diagram_count>0 then 'complete' else 'not_present' end,'nativeLayer','excluded_from_admitted_evidence','ocr','complete') then raise exception 'managed_rendered_pdf_feature_coverage';end if;
end $$;


create function ingestion_generation_evidence.assert_rendered_pdf_packet(f jsonb,g uuid,p jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare a jsonb;facts jsonb;c ingestion_generation_evidence.candidates;identity jsonb;inspection jsonb;rows jsonb;
 pg jsonb;image jsonb;source jsonb;table_item jsonb;r jsonb;row_family text;ordinal integer:=0;image_count integer:=0;chunk_count integer;
 retained ingestion_generation_evidence.retained_artifacts;provenance jsonb;raw_bytes bytea;covered integer;page_text text;pages jsonb:='[]';
 inspected timestamptz;expires timestamptz;total_bytes bigint:=0;expected_features jsonb;source_units integer:=0;feature_family text;box jsonb;box_index integer;feature_id text;chunk_ordinal integer:=0;review_page jsonb;review_item jsonb;source_id text;
begin
 a:=public.assert_current_ingestion_attempt(f,g);if a is null then raise exception 'managed_rendered_pdf_current_attempt_required';end if;
 facts:=public.read_administrator_reindex_authority(f,g)->'providerAuthority';
 select * into strict c from ingestion_generation_evidence.candidates where document_id=(f->>'document_id')::uuid and generation_id=g for update;
 if octet_length(convert_to(p::text,'UTF8'))>67108864 or not ingestion_generation_evidence.keys(p,array['version','profileId','identity','inspection','rows','quality','deferredOptionalFamilies','clinicalApproval','publicationApproval','summaryProjection'])
  or p->>'version' is distinct from 'managed-rendered-pdf-packet-v1' or p->>'profileId' is distinct from 'administrator-reviewed-rendered-full-pdf-v1'
  or jsonb_typeof(p->'deferredOptionalFamilies') is distinct from 'array' or p->'deferredOptionalFamilies' ? 'model_summary'
  or p->>'clinicalApproval' is distinct from 'not_granted' or p->>'publicationApproval' is distinct from 'not_granted'
  then raise exception 'managed_rendered_pdf_invalid_packet';end if;
 identity:=p->'identity';inspection:=p->'inspection';rows:=p->'rows';
 if identity->>'documentId' is distinct from c.document_id::text or identity->>'generationId' is distinct from g::text
  or identity->>'jobId' is distinct from c.job_id::text or identity->>'firstLeaseToken' is distinct from c.first_lease_token::text
  or identity->>'workerId' is distinct from f->>'worker_id' or identity->>'authorityDigest' is distinct from c.authority_digest
  or identity->'documentOwnerId' is distinct from facts->'documentOwnerId' or identity->'stewardId' is distinct from facts->'stewardId'
  or identity->>'sourceSha256' is distinct from c.source_sha256 or identity->'sourceByteLength' is distinct from to_jsonb(c.source_byte_length)
  or identity->>'sourceExpectationDigest' is distinct from c.source_expectation_digest
  or identity->'predecessorGenerationId' is distinct from coalesce(to_jsonb(c.predecessor_generation_id),'null'::jsonb)
  or identity->'attemptNumber' is distinct from a->'job'->'attempt_count' or identity->'batchId' is distinct from a->'job'->'batch_id'
  then raise exception 'managed_rendered_pdf_identity_mismatch';end if;
 if not ingestion_generation_evidence.keys(rows,array['chunks','images','table_facts','embedding_fields','index_units','sections','memory_cards'])
  then raise exception 'managed_rendered_pdf_row_families';end if;

 -- A current admitted source authority is still mandatory. A review record is
 -- never an authority to ingest or send data to a provider.
 if inspection->'binding' is distinct from jsonb_build_object('admissionEventId',facts->'admissionEventId','documentId',c.document_id,'generationId',g,
   'jobId',c.job_id,'attemptId',c.job_id::text||':'||(a->'job'->>'attempt_count')||':'||c.first_lease_token::text,'leaseId',c.first_lease_token,'contentSha256',c.source_sha256,'authorityDigest',c.authority_digest)
  or inspection->>'sourceSha256' is distinct from c.source_sha256 or inspection->'sourceByteLength' is distinct from to_jsonb(c.source_byte_length)
  or jsonb_array_length(rows->'images')<>jsonb_array_length(inspection->'images') then raise exception 'managed_rendered_pdf_inspection_binding';end if;
 perform ingestion_generation_evidence.assert_rendered_pdf_review(c.document_id,g,inspection);
 if c.source_expectation->'witness'->>'reference' is distinct from 'independent-original-rendered-pdf-reviewed-inventory-v1' then raise exception 'managed_rendered_pdf_expectation_witness';end if;
 if not exists(select 1 from ingestion_generation_evidence.retained_artifacts ra where ra.document_id=c.document_id and ra.generation_id=g and ra.family='private_objects' and ra.unit_key='original-source' and ra.sha256=c.source_sha256 and ra.byte_length=c.source_byte_length and substring(ra.artifact_bytes from 1 for 5)=convert_to('%PDF-','UTF8')) then raise exception 'managed_rendered_pdf_original_source';end if;
 foreach row_family in array array['chunks','images','table_facts','embedding_fields','index_units','sections','memory_cards'] loop
  if jsonb_typeof(rows->row_family) is distinct from 'array' or jsonb_array_length(rows->row_family)>20000
   or (select count(distinct x->>'id') from jsonb_array_elements(rows->row_family) x)<>jsonb_array_length(rows->row_family)
   then raise exception 'managed_rendered_pdf_row_population';end if;
  for r in select value from jsonb_array_elements(rows->row_family) loop
   if coalesce(r->>'id','')!~'^[0-9a-f-]{36}$' or r->>'document_id' is distinct from c.document_id::text or r->>'index_generation_id' is distinct from g::text
    or r->'metadata'->>'index_generation_id' is distinct from g::text
    or r->'metadata'->>'artifact_generation_id' is distinct from g::text or r->'metadata'->>'source_sha256' is distinct from c.source_sha256
    or r->'metadata'->>'full_pdf_profile' is distinct from 'administrator-reviewed-rendered-full-pdf-v1'
    or r->'metadata'->>'inspection_scope' is distinct from 'source_anchored_render_review_not_clinical_signoff'
    or r->'metadata'->'review_sha256' is distinct from inspection->'reviewSha256'
    or r->'metadata'->>'native_layer_disposition' is distinct from 'excluded_from_admitted_evidence'
    or r->'metadata'->>'original_native_conflict' is distinct from 'unresolved'
    or (row_family not in ('images','chunks') and r->'owner_id' is distinct from facts->'documentOwnerId')
    then raise exception 'managed_rendered_pdf_row_identity';end if;
   if row_family in ('chunks','embedding_fields','index_units','memory_cards') then
    if jsonb_typeof(r->'embedding') is distinct from 'array' or jsonb_array_length(r->'embedding')<>1536
     or exists(select 1 from jsonb_array_elements(r->'embedding') v where jsonb_typeof(v) is distinct from 'number')
     or not exists(select 1 from jsonb_array_elements_text(r->'embedding') v where v::double precision<>0)
     then raise exception 'managed_rendered_pdf_embedding_invalid';end if;
   end if;
   if r->>'source_chunk_id' is not null and not exists(select 1 from jsonb_array_elements(rows->'chunks') parent where parent->'id'=r->'source_chunk_id')
    then raise exception 'managed_rendered_pdf_chunk_parent';end if;
   if r->>'source_image_id' is not null and not exists(select 1 from jsonb_array_elements(rows->'images') parent where parent->'id'=r->'source_image_id')
    then raise exception 'managed_rendered_pdf_image_parent';end if;
   if row_family='sections' and exists(select 1 from jsonb_array_elements(r->'chunk_ids') link where not exists(select 1 from jsonb_array_elements(rows->'chunks') parent where parent->'id'=link))
    then raise exception 'managed_rendered_pdf_section_parent';end if;
   if row_family='memory_cards' and (exists(select 1 from jsonb_array_elements(r->'source_chunk_ids') link where not exists(select 1 from jsonb_array_elements(rows->'chunks') parent where parent->'id'=link))
    or exists(select 1 from jsonb_array_elements(r->'source_image_ids') link where not exists(select 1 from jsonb_array_elements(rows->'images') parent where parent->'id'=link))
    or(r->>'section_id' is not null and not exists(select 1 from jsonb_array_elements(rows->'sections') parent where parent->'id'=r->'section_id')))
    then raise exception 'managed_rendered_pdf_memory_parent';end if;
  end loop;
 end loop;

 chunk_count:=jsonb_array_length(rows->'chunks');
 for pg in select value from jsonb_array_elements(inspection->'pages') loop
  ordinal:=ordinal+1;covered:=0;page_text:=pg->>'text';raw_bytes:=convert_to(page_text,'UTF8');total_bytes:=total_bytes+octet_length(raw_bytes);
  review_page:=inspection->'reviewRecord'->'pages'->(ordinal-1);source_id:='source-page-'||ordinal;source_units:=source_units+1;
  if not exists(select 1 from jsonb_array_elements(c.source_expectation->'units') u where u->>'id'=source_id and u->'required'='true'::jsonb and u->'dependencies'='[]'::jsonb and u->>'nativeMapping'='unavailable'
   and u->>'locator'='pdf-page:'||ordinal||':source:'||c.source_sha256||':render:'||(pg->>'renderSha256')||':ocr:'||(pg->>'ocrTextSha256')||':review:'||(inspection->>'reviewSha256')) then raise exception 'managed_rendered_pdf_original_source_unit';end if;
  foreach feature_family in array array['table','diagram'] loop
   for review_item in select value from jsonb_array_elements(coalesce(review_page->(feature_family||'s')->'records','[]')) loop
    source_units:=source_units+1;
    if not exists(select 1 from jsonb_array_elements(c.source_expectation->'units') u where u->>'id'=source_id||'-'||feature_family||'-'||(review_item->>'id') and u->'required'='true'::jsonb and u->>'nativeMapping'='unavailable' and u->'dependencies'=jsonb_build_array(source_id)
     and u->>'locator'='pdf-page:'||ordinal||':render:'||(pg->>'renderSha256')||':review:'||(inspection->>'reviewSha256')||':'||feature_family||':'||(review_item->>'id')||':'||ingestion_generation_evidence.rendered_pdf_hash(review_item)) then raise exception 'managed_rendered_pdf_relationship_source_unit';end if;
   end loop;
  end loop;
  select * into strict retained from ingestion_generation_evidence.retained_artifacts ra where ra.document_id=c.document_id and ra.generation_id=g and ra.family='private_objects' and ra.unit_key='page:'||ordinal||':extracted';
  if retained.artifact_bytes is distinct from raw_bytes or retained.sha256 is distinct from 'sha256:'||encode(extensions.digest(raw_bytes,'sha256'),'hex')
   or not exists(select 1 from ingestion_generation_evidence.retained_artifacts ra where ra.document_id=c.document_id and ra.generation_id=g and ra.family='private_objects' and ra.unit_key='page:'||ordinal||':persisted' and ra.artifact_bytes=raw_bytes)
   or not exists(select 1 from ingestion_generation_evidence.retained_artifacts ra where ra.document_id=c.document_id and ra.generation_id=g and ra.family='private_objects' and ra.unit_key='page:'||ordinal||':original-provenance'
    and 'sha256:'||encode(extensions.digest(convert_to(public.site_content_canonical_json(convert_from(ra.artifact_bytes,'UTF8')::jsonb),'UTF8'),'sha256'),'hex')=pg->>'sourceProvenanceSha256')
   then raise exception 'managed_rendered_pdf_page_retention';end if;
  select convert_from(ra.artifact_bytes,'UTF8')::jsonb into strict provenance from ingestion_generation_evidence.retained_artifacts ra where ra.document_id=c.document_id and ra.generation_id=g and ra.family='private_objects' and ra.unit_key='page:'||ordinal||':original-provenance';
  if provenance->'rendered_pdf_review' is distinct from jsonb_build_object('version',inspection->'reviewRecord'->'version','reviewSha256',inspection->'reviewSha256','sourceSha256',c.source_sha256,'renderSha256',pg->'renderSha256','ocrTextSha256',pg->'ocrTextSha256','nativeLayerDisposition','excluded_from_admitted_evidence','originalNativeConflict','unresolved','verificationScope',inspection->'verificationScope') then raise exception 'managed_rendered_pdf_page_metadata';end if;
  select convert_from(ra.artifact_bytes,'UTF8')::jsonb into strict r from ingestion_generation_evidence.retained_artifacts ra where ra.document_id=c.document_id and ra.generation_id=g and ra.family='pages' and ra.unit_key=ordinal::text;
  if r->>'text' is distinct from page_text or r->'ocr_used' is distinct from pg->'ocrUsed' then raise exception 'managed_rendered_pdf_page_projection';end if;
  pages:=pages||jsonb_build_array(r);
  for r in select value from jsonb_array_elements(rows->'chunks') where (value->>'page_number')::integer=ordinal order by (value->>'chunk_index')::integer loop
   if r->'metadata'->'rendered_pdf_review' is distinct from provenance->'rendered_pdf_review' then raise exception 'managed_rendered_pdf_chunk_review_binding';end if;
   if r->'chunk_index' is distinct from to_jsonb(chunk_ordinal) then raise exception 'managed_rendered_pdf_chunk_population';end if;chunk_ordinal:=chunk_ordinal+1;
   raw_bytes:=convert_to(r->>'content','UTF8');if octet_length(raw_bytes)>8191 or btrim(r->>'content')='' or raw_bytes is distinct from substring(convert_to(page_text,'UTF8') from covered+1 for octet_length(raw_bytes))
    then raise exception 'managed_rendered_pdf_chunk_source_partition';end if;covered:=covered+octet_length(raw_bytes);
  end loop;
  if covered<>octet_length(convert_to(page_text,'UTF8')) then raise exception 'managed_rendered_pdf_uncovered_page_text';end if;

 end loop;
 if source_units<>jsonb_array_length(c.source_expectation->'units') or chunk_ordinal<>chunk_count then raise exception 'managed_rendered_pdf_required_population';end if;
 if total_bytes>67108864 or (select count(*) from ingestion_generation_evidence.retained_artifacts ra where ra.document_id=c.document_id and ra.generation_id=g and ra.family='pages')<>ordinal then raise exception 'managed_rendered_pdf_page_population';end if;
 for image in select value from jsonb_array_elements(inspection->'images') loop
  image_count:=image_count+1;if image->'ordinal' is distinct from to_jsonb(image_count) then raise exception 'managed_rendered_pdf_image_ordinal';end if;
  if not ingestion_generation_evidence.keys(image,array['ordinal','pageNumber','sourceKind','sha256','byteLength','width','height','descriptorSha256','metadataSha256'])
   or coalesce(image->>'pageNumber','')!~'^[1-9][0-9]*$' then raise exception 'managed_rendered_pdf_image_binding';end if;
  review_page:=inspection->'reviewRecord'->'pages'->((image->>'pageNumber')::integer-1);
  if review_page is null or image->'sha256' is distinct from review_page->'render'->'sha256' or image->'byteLength' is distinct from review_page->'render'->'byteLength'
   or image->'width' is distinct from review_page->'render'->'width' or image->'height' is distinct from review_page->'render'->'height'
   or (image_count<=ordinal and (image->>'sourceKind' is distinct from 'page_region' or image->'pageNumber' is distinct from to_jsonb(image_count)))
   or (image_count>ordinal and image->>'sourceKind' is distinct from 'table_crop') then raise exception 'managed_rendered_pdf_image_binding';end if;
  select * into strict retained from ingestion_generation_evidence.retained_artifacts ra where ra.document_id=c.document_id and ra.generation_id=g and ra.family='private_objects' and ra.unit_key='image:'||image_count||':binary';
  if image->>'sourceKind' not in ('page_region','table_crop') or retained.sha256 is distinct from image->>'sha256' or to_jsonb(retained.byte_length) is distinct from image->'byteLength'
   or retained.sha256<>'sha256:'||encode(extensions.digest(retained.artifact_bytes,'sha256'),'hex') then raise exception 'managed_rendered_pdf_image_bytes';end if;
  select convert_from(ra.artifact_bytes,'UTF8')::jsonb into strict provenance from ingestion_generation_evidence.retained_artifacts ra where ra.document_id=c.document_id and ra.generation_id=g and ra.family='private_objects' and ra.unit_key='image:'||image_count||':provenance';
  if image->>'descriptorSha256' is distinct from 'sha256:'||encode(extensions.digest(convert_to(public.site_content_canonical_json(provenance->'descriptor'),'UTF8'),'sha256'),'hex')
   or image->>'metadataSha256' is distinct from 'sha256:'||encode(extensions.digest(convert_to(public.site_content_canonical_json(coalesce(provenance->'descriptor'->'metadata','{}'::jsonb)),'UTF8'),'sha256'),'hex')
   or provenance->'descriptor'->'pageNumber' is distinct from image->'pageNumber' or provenance->'descriptor'->'sourceKind' is distinct from image->'sourceKind'
   or provenance->'descriptor'->'width' is distinct from image->'width' or provenance->'descriptor'->'height' is distinct from image->'height'
   then raise exception 'managed_rendered_pdf_image_provenance';end if;
  r:=rows->'images'->(image_count-1);
  if r->'source_kind' is distinct from image->'sourceKind' or r->'width' is distinct from image->'width' or r->'height' is distinct from image->'height'
   or (r->'metadata')-array['index_generation_id','artifact_generation_id','source_sha256','full_pdf_profile','inspection_scope','review_sha256','native_layer_disposition','original_native_conflict','managed_artifact_reference'] is distinct from coalesce(provenance->'descriptor'->'metadata','{}'::jsonb)
   or r->'page_number' is distinct from image->'pageNumber' or r->>'image_hash' is distinct from substring(image->>'sha256' from 8)
   or r->'metadata'->'managed_artifact_reference' is distinct from jsonb_build_object('version','managed-pdf-image-v1','documentId',c.document_id,'generationId',g,'imageOrdinal',image_count,'sha256',image->'sha256')
   or r->>'storage_path' is distinct from 'managed-pdf/'||c.document_id::text||'/'||g::text||'/'||image_count
   then raise exception 'managed_rendered_pdf_image_projection';end if;
 end loop;
 if (select count(*) from ingestion_generation_evidence.retained_artifacts ra where ra.document_id=c.document_id and ra.generation_id=g and ra.representation='image_binary')<>image_count
  or image_count<>ordinal+jsonb_array_length(inspection->'tables')
  then raise exception 'managed_rendered_pdf_image_population';end if;
 box_index:=0;
 for table_item in select value from jsonb_array_elements(inspection->'tables') loop
  box_index:=box_index+1;
  r:=rows->'images'->((table_item->>'imageOrdinal')::integer-1);
  if table_item->'imageOrdinal' is distinct from to_jsonb(ordinal+box_index) or r is null or r->>'source_kind' is distinct from 'table_crop' or r->'page_number' is distinct from table_item->'pageNumber'
   or table_item->'rows' is distinct from r->'metadata'->'table_rows'
   or r->'metadata'->'reviewed_table_id' is distinct from table_item->'reviewedTableId'
   or r->'metadata'->'full_page_render' is distinct from 'true'::jsonb
   or r->'metadata'->'reviewed_render_region' is distinct from jsonb_build_object('coordinateSpace','render_pixels','region',table_item->'region','renderSha256',table_item->'renderSha256','fullPageImageOrdinal',table_item->'pageNumber','pixelScope','full_page_reuse_not_cropped')
   or r->'metadata'->'rows_truncated'='true'::jsonb then raise exception 'managed_rendered_pdf_table_source';end if;
  if jsonb_array_length(table_item->'rows')>1 and not exists(select 1 from jsonb_array_elements(rows->'table_facts') fact_row where fact_row->'source_image_id'=r->'id')
   then raise exception 'managed_rendered_pdf_required_table_facts_missing';end if;
 end loop;
 if jsonb_typeof(p->'quality'->'quality_score') is distinct from 'number' or (p->'quality'->>'quality_score')::numeric not between 0 and 1
  or coalesce(p->'quality'->>'extraction_quality','') not in('good','partial')
  or p->'quality'->'metrics'->>'quality_assessment_version' is distinct from 'existing-core-index-quality-v1'
  or p->'quality'->'metrics'->'page_count' is distinct from to_jsonb(ordinal)
  or p->'quality'->'metrics'->'extracted_image_count' is distinct from to_jsonb(image_count)
  or p->'quality'->'metrics'->'ocr_page_count' is distinct from to_jsonb((select count(*)::integer from jsonb_array_elements(inspection->'pages') s where s->'ocrUsed'='true'::jsonb))
  or p->'quality'->'metrics'->'needs_ocr_page_count' is distinct from '0'::jsonb
  then raise exception 'managed_rendered_pdf_observed_quality_required';end if;
 if a->'document'->>'index_generation_id' is not null and exists(select 1 from public.document_index_quality q where q.document_id=c.document_id
  and ((q.extraction_quality='good' and p->'quality'->>'extraction_quality'<>'good') or q.quality_score>(p->'quality'->>'quality_score')::real))
  then raise exception 'managed_rendered_pdf_quality_regression';end if;
 for r in select value from jsonb_array_elements(rows->'table_facts') loop
  select value into strict image from jsonb_array_elements(rows->'images') where value->'id'=r->'source_image_id';
  if r->'metadata'->'cells' is distinct from (select jsonb_agg(to_jsonb(btrim(left(regexp_replace(cell,'\s+',' ','g'),240))))
    from jsonb_array_elements_text(image->'metadata'->'table_rows'->((r->'metadata'->>'row_index')::integer)) cell)
   or not exists(select 1 from jsonb_array_elements(rows->'chunks') ch where ch->'id'=r->'source_chunk_id' and ch->'page_number'=r->'page_number')
   then raise exception 'managed_rendered_pdf_fact_source';end if;
  if (r->>'threshold_value' is not null and not exists(select 1 from jsonb_array_elements_text(r->'metadata'->'cells') cell where regexp_replace(btrim(cell),'\s+',' ','g')=r->>'threshold_value'))
   or(r->>'action' is not null and not exists(select 1 from jsonb_array_elements_text(r->'metadata'->'cells') cell where regexp_replace(btrim(cell),'\s+',' ','g')=r->>'action'))
   then raise exception 'managed_rendered_pdf_fact_relationship';end if;
 end loop;
 if exists(select 1 from ingestion_generation_evidence.retained_artifacts artifact_row where artifact_row.document_id=c.document_id and artifact_row.generation_id=g and
  (artifact_row.source_sha256<>c.source_sha256 or artifact_row.byte_length<>octet_length(artifact_row.artifact_bytes) or artifact_row.sha256<>'sha256:'||encode(extensions.digest(artifact_row.artifact_bytes,'sha256'),'hex')))
  then raise exception 'managed_rendered_pdf_retained_integrity';end if;
 if exists(select 1 from ingestion_generation_evidence.unit_declarations d left join ingestion_generation_evidence.outcomes o using(document_id,generation_id,family,unit_key)
  where d.document_id=c.document_id and d.generation_id=g and d.declaration->'required'='true'::jsonb
  and not(d.family='attempt_control' and d.unit_key='preseal_checkpoint')
  and(o.outcome->>'disposition' is distinct from 'retained' or not exists(select 1 from ingestion_generation_evidence.retained_artifacts proof_artifact
   where proof_artifact.document_id=d.document_id and proof_artifact.generation_id=g and proof_artifact.family=d.family and proof_artifact.unit_key=d.unit_key and proof_artifact.sha256=o.outcome->>'artifactSha256')))
  then raise exception 'managed_rendered_pdf_required_retention_incomplete';end if;
 if not exists(select 1 from ingestion_generation_evidence.unit_declarations d where d.document_id=c.document_id and d.generation_id=g and d.family='attempt_control' and d.unit_key='preseal_checkpoint'
  and d.declaration->'dependencies'='[{"family":"attempt_control","key":"claim_checkpoint"},{"family":"private_objects","key":"original-source"}]'::jsonb)
  then raise exception 'managed_rendered_pdf_preseal_declaration_required';end if;
 perform ingestion_generation_evidence.assert_full_pdf_summary(c.document_id,g,p);
 return jsonb_build_object('pages',pages,'pageCount',ordinal,'chunkCount',chunk_count,'imageCount',(select count(*) from jsonb_array_elements(rows->'images') im where im->'searchable'='true'::jsonb));
end $$;

-- Extend only the rendered witness's immutable private plan. All native plans
-- keep the existing allowlist and four-representation page population checks.
create function ingestion_generation_evidence.rendered_pdf_extra_unit(u jsonb)
returns boolean language sql immutable set search_path='' as $$
 select coalesce(ingestion_generation_evidence.keys(u,array['id','groupKey','required','dependencies','sourceEvidenceIds','qualification','representation'])
  and ingestion_generation_evidence.keys(u->'id',array['family','key'])
  and u->'id'->>'family'='private_objects' and u->>'groupKey'='private_objects' and u->'required'='true'::jsonb
  and u->'sourceEvidenceIds'='[]'::jsonb and u->>'qualification'='whole_logical_unit_unverified' and (
   (u->'id'->>'key' in ('rendered-review-record','rendered-raster-container') and u->>'representation'='provenance_json'
    and u->'dependencies'='[{"family":"private_objects","key":"original-source"}]'::jsonb)
   or (u->'id'->>'key' ~ '^page:[1-9][0-9]*:rendered-(original-geometry|ocr)$'
    and u->>'representation'=case split_part(u->'id'->>'key',':',3) when 'rendered-ocr' then 'extracted_utf8' else 'provenance_json' end
    and u->'dependencies'='[{"family":"private_objects","key":"rendered-review-record"},{"family":"private_objects","key":"rendered-raster-container"}]'::jsonb)),false)
$$;

create function ingestion_generation_evidence.assert_rendered_pdf_private_plan(reg jsonb)
returns void language plpgsql immutable set search_path='' as $$
declare units jsonb:=reg->'declarations'->'units';u jsonb;key_ text;
begin
 if reg->'sourceExpectation'->'witness'->>'reference' is distinct from 'independent-original-rendered-pdf-reviewed-inventory-v1' then return;end if;
 foreach key_ in array array['rendered-review-record','rendered-raster-container'] loop
  if not exists(select 1 from jsonb_array_elements(units) d where d->'id'->>'key'=key_ and ingestion_generation_evidence.rendered_pdf_extra_unit(d)) then raise exception 'managed_rendered_pdf_private_plan';end if;
 end loop;
 for u in select value from jsonb_array_elements(units) where value->'id'->>'key' ~ '^page:[1-9][0-9]*:extracted$' loop
  foreach key_ in array array['rendered-original-geometry','rendered-ocr'] loop
   if not exists(select 1 from jsonb_array_elements(units) d where d->'id'->>'key'='page:'||split_part(u->'id'->>'key',':',2)||':'||key_ and ingestion_generation_evidence.rendered_pdf_extra_unit(d)) then raise exception 'managed_rendered_pdf_private_plan';end if;
  end loop;
 end loop;
 if exists(select 1 from jsonb_array_elements(units) d where ingestion_generation_evidence.rendered_pdf_extra_unit(d) and d->'id'->>'key' like 'page:%'
  and not exists(select 1 from jsonb_array_elements(units) p where p->'id'->>'key'='page:'||split_part(d->'id'->>'key',':',2)||':extracted')) then raise exception 'managed_rendered_pdf_private_plan';end if;
end $$;

do $$
declare definition text;needle text;replacement text;witness text:='se->''witness''->>''reference''=''independent-original-rendered-pdf-reviewed-inventory-v1''';
begin
 definition:=pg_get_functiondef('public.begin_ingestion_generation_evidence(jsonb,uuid,jsonb,text)'::regprocedure);
 needle:='when ''binary'' then ''image_binary'' else ''image_provenance'' end)),false))';
 replacement:='when ''binary'' then ''image_binary'' else ''image_provenance'' end) or ('||witness||' and ingestion_generation_evidence.rendered_pdf_extra_unit(u.value))),false))';
 if length(definition)-length(replace(definition,needle,''))<>length(needle) then raise exception 'managed_rendered_pdf_private_allowlist_preimage';end if;
 definition:=replace(definition,needle,replacement);
 needle:='u.value->''id''->>''key'' like ''page:%'' group by';
 replacement:='u.value->''id''->>''key'' like ''page:%'' and not ('||witness||' and ingestion_generation_evidence.rendered_pdf_extra_unit(u.value)) group by';
 if length(definition)-length(replace(definition,needle,''))<>length(needle) then raise exception 'managed_rendered_pdf_private_page_count_preimage';end if;
 definition:=replace(definition,needle,replacement);
 needle:='  perform ingestion_generation_evidence.declare_groups(c,p_registration->''declarations'');';
 if length(definition)-length(replace(definition,needle,''))<>length(needle) then raise exception 'managed_rendered_pdf_private_plan_preimage';end if;
 execute replace(definition,needle,'  perform ingestion_generation_evidence.assert_rendered_pdf_private_plan(p_registration);'||chr(10)||needle);
end $$;

-- Extraction quality counts admitted page text once. Raw render OCR is a
-- separate retained source anchor, never an additional admitted text page.
do $$
declare definition text;needle text;replacement text;
begin
 definition:=pg_get_functiondef('ingestion_generation_evidence.retain(ingestion_generation_evidence.candidates,jsonb)'::regprocedure);
 needle:='coalesce(sum(byte_length) filter(where representation=''extracted_utf8''),0)';
 replacement:='coalesce(sum(byte_length) filter(where representation=''extracted_utf8'' and not (c.source_expectation->''witness''->>''reference''=''independent-original-rendered-pdf-reviewed-inventory-v1'' and unit_key ~ ''^page:[1-9][0-9]*:rendered-ocr$'')),0)';
 if length(definition)-length(replace(definition,needle,''))<>length(needle) then raise exception 'managed_rendered_pdf_quality_text_preimage';end if;
 execute replace(definition,needle,replacement);
end $$;

-- Preserve native v1/v2 dispatch byte-for-byte. The rendered profile calls its
-- own validator and never fabricates a native-v2 compatibility view.
do $$
declare definition text;
begin
 definition:=pg_get_functiondef('ingestion_generation_evidence.assert_full_pdf_packet(jsonb,uuid,jsonb)'::regprocedure);
 if strpos(definition,'CREATE OR REPLACE FUNCTION ingestion_generation_evidence.assert_full_pdf_packet(')<>1 then raise exception 'managed_rendered_pdf_native_dispatch_preimage';end if;
 execute replace(definition,'FUNCTION ingestion_generation_evidence.assert_full_pdf_packet(', 'FUNCTION ingestion_generation_evidence.assert_full_pdf_native_packet(');
end $$;
create or replace function ingestion_generation_evidence.assert_full_pdf_packet(f jsonb,g uuid,p jsonb)
returns jsonb language plpgsql set search_path='' as $$
begin
 if p->>'version'='managed-rendered-pdf-packet-v1' then
  return ingestion_generation_evidence.assert_rendered_pdf_packet(f,g,p);
 end if;
 return ingestion_generation_evidence.assert_full_pdf_native_packet(f,g,p);
end $$;

-- Reuse the generic summary validator and exact public-row comparator. All
-- seven row families use the same comparator regardless of evidence profile.
do $$
declare definition text;old_branch text;
begin
 definition:=pg_get_functiondef('ingestion_generation_evidence.publish_full_pdf_summary(uuid,uuid,jsonb)'::regprocedure);
 old_branch:='if p->>''version''<>''managed-full-pdf-packet-v2'' then return;end if;';
 if strpos(definition,old_branch)=0 then raise exception 'managed_rendered_pdf_summary_publish_preimage';end if;
 execute replace(definition,old_branch,'if p->>''version'' not in (''managed-full-pdf-packet-v2'',''managed-rendered-pdf-packet-v1'') then return;end if;');
 definition:=pg_get_functiondef('ingestion_generation_evidence.full_pdf_rows_match(uuid,uuid,jsonb)'::regprocedure);
 old_branch:='if p->>''version'' is distinct from ''managed-full-pdf-packet-v2'' then return false;end if;';
 if strpos(definition,old_branch)=0 then raise exception 'managed_rendered_pdf_summary_match_preimage';end if;
 execute replace(definition,old_branch,'if p->>''version'' not in (''managed-full-pdf-packet-v2'',''managed-rendered-pdf-packet-v1'') then return false;end if;');
end $$;

-- Seal the profile actually admitted, including the exact review and source
-- identities. Native callers retain their pre-existing seal unchanged.
do $$
declare definition text;needle text;
begin
 definition:=pg_get_functiondef('public.complete_managed_full_pdf(jsonb,uuid,text,boolean)'::regprocedure);
 needle:=' seal_bytes:=convert_to(seal::text,''UTF8'');';
 if length(definition)-length(replace(definition,needle,''))<>length(needle) then raise exception 'managed_rendered_pdf_seal_preimage';end if;
 execute replace(definition,needle,$patch$
  if s.packet->>'version'='managed-rendered-pdf-packet-v1' then
   seal:=jsonb_build_object('version','managed-rendered-pdf-seal-v1','packetDigest',s.packet_digest,'profileId',s.packet->'profileId','identity',s.packet->'identity','clinicalApproval','not_granted','publicationApproval','not_granted',
    'inspectionScope',s.packet->'inspection'->'verificationScope','nativeLayerDisposition','excluded_from_admitted_evidence','originalNativeConflict','unresolved',
    'reviewSha256',s.packet->'inspection'->'reviewSha256','reviewer',s.packet->'inspection'->'reviewRecord'->'reviewer','sourceSha256',s.packet->'identity'->'sourceSha256','sourceByteLength',s.packet->'identity'->'sourceByteLength');
  end if;
$patch$||needle);
end $$;

alter function ingestion_generation_evidence.rendered_pdf_hash(jsonb) owner to postgres;
alter function ingestion_generation_evidence.rendered_pdf_rect(jsonb,jsonb) owner to postgres;
alter function ingestion_generation_evidence.rendered_pdf_utf16_slice(text,integer,integer) owner to postgres;
alter function ingestion_generation_evidence.assert_rendered_pdf_text(jsonb,text,jsonb,boolean) owner to postgres;
alter function ingestion_generation_evidence.assert_rendered_pdf_review(uuid,uuid,jsonb) owner to postgres;
alter function ingestion_generation_evidence.assert_rendered_pdf_packet(jsonb,uuid,jsonb) owner to postgres;
alter function ingestion_generation_evidence.assert_full_pdf_native_packet(jsonb,uuid,jsonb) owner to postgres;
alter function ingestion_generation_evidence.rendered_pdf_extra_unit(jsonb) owner to postgres;
alter function ingestion_generation_evidence.assert_rendered_pdf_private_plan(jsonb) owner to postgres;
revoke all on function ingestion_generation_evidence.rendered_pdf_extra_unit(jsonb),ingestion_generation_evidence.assert_rendered_pdf_private_plan(jsonb) from public,anon,authenticated,service_role;
revoke all on function ingestion_generation_evidence.rendered_pdf_hash(jsonb),ingestion_generation_evidence.rendered_pdf_rect(jsonb,jsonb),ingestion_generation_evidence.rendered_pdf_utf16_slice(text,integer,integer),ingestion_generation_evidence.assert_rendered_pdf_text(jsonb,text,jsonb,boolean),ingestion_generation_evidence.assert_rendered_pdf_review(uuid,uuid,jsonb),ingestion_generation_evidence.assert_rendered_pdf_packet(jsonb,uuid,jsonb),ingestion_generation_evidence.assert_full_pdf_native_packet(jsonb,uuid,jsonb) from public,anon,authenticated,service_role;
-- Replacement functions retain postgres ownership and their existing ACLs;
-- stage/complete service RPCs are unchanged. No grants or historical resealing.
commit;
