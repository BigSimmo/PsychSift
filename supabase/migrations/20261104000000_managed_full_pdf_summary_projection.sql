-- DRAFT: packet-v2 publishes its source-anchored summary atomically with the
-- candidate pointer. Packet-v1 retains its original contract. No live execution.
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';

-- Preserve the immutable v1 implementations without changing their callers or
-- ACLs. Copies live in the private evidence schema and receive no service grant.
do $$
declare signature text;definition text;old_name text;new_name text;
begin
 foreach signature in array array['ingestion_generation_evidence.assert_full_pdf_packet(jsonb,uuid,jsonb)',
  'ingestion_generation_evidence.full_pdf_rows_match(uuid,uuid,jsonb)'] loop
  old_name:=split_part(signature,'(',1);new_name:=old_name||'_v1';
  definition:=pg_get_functiondef(signature::regprocedure);
  if position('CREATE OR REPLACE FUNCTION '||old_name||'(' in definition)<>1 then raise exception 'managed_full_pdf_summary_preimage';end if;
  execute replace(definition,'CREATE OR REPLACE FUNCTION '||old_name||'(','CREATE OR REPLACE FUNCTION '||new_name||'(');
 end loop;
end $$;

-- Every source ID must be unique, ordered as in its admitted parent list, and
-- resolve to a packet row. Nested claims use the payload's selected parent IDs.
create function ingestion_generation_evidence.full_pdf_summary_ids(ids jsonb,parents jsonb)
returns boolean language plpgsql immutable set search_path='' as $$
declare x jsonb;ordinal bigint;previous bigint:=0;
begin
 if jsonb_typeof(ids) is distinct from 'array' or jsonb_typeof(parents) is distinct from 'array' then return false;end if;
 for x in select value from jsonb_array_elements(ids) loop
  if jsonb_typeof(x) is distinct from 'string' then return false;end if;
  select n into ordinal from jsonb_array_elements(parents) with ordinality as p(value,n) where value=x;
  if ordinal is null or ordinal<=previous then return false;end if;previous:=ordinal;
 end loop;return true;
end $$;

create function ingestion_generation_evidence.full_pdf_summary_label_match(content text,label text)
returns boolean language plpgsql immutable set search_path='' as $$
declare haystack text:=lower(content);offset_ integer:=1;found_ integer;before_ text;after_ text;
begin
 if label is null or label='' then return false;end if;
 loop
  found_:=strpos(substr(haystack,offset_),label);if found_=0 then return false;end if;found_:=found_+offset_-1;
  before_:=case when found_=1 then '' else substr(haystack,found_-1,1) end;after_:=substr(haystack,found_+length(label),1);
  if before_!~'[[:alnum:]]' and after_!~'[[:alnum:]]' then return true;end if;offset_:=found_+1;
 end loop;
end $$;

create function ingestion_generation_evidence.assert_full_pdf_summary(doc uuid,g uuid,p jsonb)
returns void language plpgsql set search_path='' as $$
declare projection jsonb:=p->'summaryProjection';s jsonb;payload jsonb;profile jsonb;owner jsonb;item jsonb;label jsonb;expected_label jsonb;
 chunks jsonb;images jsonb;chunk_ids jsonb;image_ids jsonb;pages jsonb;key text;field text;expected jsonb;items jsonb:='[]';claims jsonb:='[]';
 projected text;label_index integer:=0;meta jsonb;provider jsonb;
 profile_keys text[]:=array['applies_to','key_clinical_actions','medication_dose_monitoring','thresholds_timing','escalation_risk_warnings','required_forms_documentation','not_covered','important_tables_images','best_questions','source_quality_notes'];
begin
 if not ingestion_generation_evidence.keys(projection,array['version','summary','labels'])
  or projection->>'version' is distinct from 'managed-pdf-summary-projection-v1' then raise exception 'managed_full_pdf_summary_projection';end if;
 s:=projection->'summary';owner:=p->'identity'->'documentOwnerId';meta:=s->'metadata';payload:=meta->'source_anchored_summary_v1';
 if not ingestion_generation_evidence.keys(s,array['document_id','owner_id','summary','clinical_specifics','source_chunk_ids','source_image_ids','model','generated_at','metadata'])
  or s->>'document_id' is distinct from doc::text or s->'owner_id' is distinct from owner
  or not ingestion_generation_evidence.keys(meta,array['index_generation_id','source_anchored_summary_v1','source_anchored_summary_projection_complete_v1','managed_summary_request_sha256','managed_summary_provider_evidence'])
  or meta->>'index_generation_id' is distinct from g::text or meta->'source_anchored_summary_projection_complete_v1' is distinct from 'true'::jsonb
  or coalesce(meta->>'managed_summary_request_sha256','')!~'^sha256:[a-f0-9]{64}$'
  then raise exception 'managed_full_pdf_summary_identity';end if;
 provider:=meta->'managed_summary_provider_evidence';
 if jsonb_typeof(provider) is distinct from 'object' or provider-array['requestedModel','providerModel','requestId','usage']<>'{}'::jsonb
  or provider->>'requestedModel' is distinct from s->>'model' or jsonb_typeof(provider->'requestedModel') is distinct from 'string'
  or jsonb_typeof(provider->'providerModel') is distinct from 'string' or nullif(btrim(provider->>'providerModel'),'') is null
  or jsonb_typeof(provider->'requestId') is distinct from 'string' or nullif(btrim(provider->>'requestId'),'') is null
  then raise exception 'managed_full_pdf_summary_provider';end if;
 if not ingestion_generation_evidence.keys(payload,array['summary_kind','summary_version','document_id','index_generation_id','model','model_version','generated_at','source_chunk_ids','source_image_ids','summary','clinical_specifics','labels','heuristic_fallback'])
  or payload->>'summary_kind' is distinct from 'structured' or payload->'heuristic_fallback' is distinct from 'false'::jsonb
  or payload->>'summary_version' is distinct from 'source-anchored-summary-v1'
  or payload->>'document_id' is distinct from doc::text or payload->>'index_generation_id' is distinct from g::text
  or coalesce(payload->>'model_version','') not in ('rag-deep-memory-v1','rag-deep-memory-v2')
  or jsonb_typeof(payload->'model') is distinct from 'string' or length(payload->>'model') not between 1 and 200
  or nullif(btrim(payload->>'model'),'') is null or payload->>'model' is distinct from s->>'model'
  or coalesce(payload->>'generated_at','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
  then raise exception 'managed_full_pdf_summary_payload';end if;
 perform (payload->>'generated_at')::timestamptz;
 foreach key in array array['summary','clinical_specifics','source_chunk_ids','source_image_ids','model','generated_at'] loop
  if s->key is distinct from payload->key then raise exception 'managed_full_pdf_summary_projection_mismatch';end if;
 end loop;
 chunks:=p->'rows'->'chunks';images:=p->'rows'->'images';
 select coalesce(jsonb_agg(value->'id'),'[]') into chunk_ids from jsonb_array_elements(chunks);
 select coalesce(jsonb_agg(value->'id'),'[]') into image_ids from jsonb_array_elements(images);
 if not ingestion_generation_evidence.full_pdf_summary_ids(payload->'source_chunk_ids',chunk_ids)
  or not ingestion_generation_evidence.full_pdf_summary_ids(payload->'source_image_ids',image_ids)
  or jsonb_array_length(payload->'source_chunk_ids')>36 or jsonb_array_length(payload->'source_image_ids')>64
  or jsonb_array_length(payload->'source_chunk_ids')+jsonb_array_length(payload->'source_image_ids')=0
  then raise exception 'managed_full_pdf_summary_anchor';end if;
 if not ingestion_generation_evidence.keys(payload->'clinical_specifics',array['profile','actions','thresholds_timing','medication_monitoring','risk_escalation','documentation_forms','exceptions_gaps'])
  then raise exception 'managed_full_pdf_summary_profile';end if;
 profile:=payload->'clinical_specifics'->'profile';
 if not ingestion_generation_evidence.keys(profile,array['overview']||profile_keys) then raise exception 'managed_full_pdf_summary_profile';end if;
 foreach key in array profile_keys loop
  if jsonb_typeof(profile->key) is distinct from 'array' or jsonb_array_length(profile->key)>(case when key='best_questions' then 8 else 6 end)
   then raise exception 'managed_full_pdf_summary_profile';end if;
  for item in select value from jsonb_array_elements(profile->key) loop
   if not ingestion_generation_evidence.keys(item,array['text','source_chunk_ids','source_image_ids','pages','evidence_type','support'])
    or jsonb_typeof(item->'text') is distinct from 'string' or length(item->>'text') not between 1 and 600
    or btrim(regexp_replace(item->>'text','\s+',' ','g')) is distinct from item->>'text'
    or coalesce(item->>'evidence_type','') not in ('text','table','image','mixed','metadata')
    or coalesce(item->>'support','') not in ('direct','partial','not_found')
    or not ingestion_generation_evidence.full_pdf_summary_ids(item->'source_chunk_ids',payload->'source_chunk_ids')
    or not ingestion_generation_evidence.full_pdf_summary_ids(item->'source_image_ids',payload->'source_image_ids')
    then raise exception 'managed_full_pdf_summary_claim_anchor';end if;
   if item->>'support'='not_found' then
    if key not in ('not_covered','source_quality_notes') or item->>'text' not like 'Not established by selected source evidence:%' then raise exception 'managed_full_pdf_summary_not_found';end if;
   elsif jsonb_array_length(item->'source_chunk_ids')+jsonb_array_length(item->'source_image_ids')=0 then raise exception 'managed_full_pdf_summary_claim_anchor';end if;
   select coalesce(jsonb_agg(n order by n),'[]') into pages from (
    select distinct (r->>'page_number')::integer n from jsonb_array_elements(chunks||images) r
     where (item->'source_chunk_ids') @> jsonb_build_array(r->'id') or (item->'source_image_ids') @> jsonb_build_array(r->'id')) q;
   if item->'pages' is distinct from pages then raise exception 'managed_full_pdf_summary_claim_pages';end if;
   if item->>'support'<>'not_found' and jsonb_array_length(item->'source_chunk_ids')+jsonb_array_length(item->'source_image_ids')>0 then
    items:=items||jsonb_build_array(item);
    if key in ('applies_to','key_clinical_actions','medication_dose_monitoring','thresholds_timing','escalation_risk_warnings','required_forms_documentation','important_tables_images') then claims:=claims||jsonb_build_array(item);end if;
   end if;
  end loop;
 end loop;
 select string_agg('- '||(value->>'text'),' ' order by n) into projected from jsonb_array_elements(claims) with ordinality c(value,n) where n<=8;
 if projected is null or length(projected)>5000 or payload->>'summary' is distinct from projected or profile->>'overview' is distinct from projected then raise exception 'managed_full_pdf_summary_claim_projection';end if;
 foreach field in array array['actions','thresholds_timing','medication_monitoring','risk_escalation','documentation_forms','exceptions_gaps'] loop
  key:=case field when 'actions' then 'key_clinical_actions' when 'medication_monitoring' then 'medication_dose_monitoring' when 'risk_escalation' then 'escalation_risk_warnings' when 'documentation_forms' then 'required_forms_documentation' when 'exceptions_gaps' then 'not_covered' else field end;
  select coalesce(jsonb_agg(value->'text'),'[]') into expected from jsonb_array_elements(profile->key);
  if payload->'clinical_specifics'->field is distinct from expected then raise exception 'managed_full_pdf_summary_specifics_projection';end if;
 end loop;
 if jsonb_typeof(payload->'labels') is distinct from 'array' or jsonb_array_length(payload->'labels')>32
  or jsonb_typeof(projection->'labels') is distinct from 'array' or jsonb_array_length(projection->'labels')<>jsonb_array_length(payload->'labels')
  then raise exception 'managed_full_pdf_summary_labels';end if;
 if (select count(distinct jsonb_build_array(value->'label_type',value->'label')) from jsonb_array_elements(payload->'labels'))<>jsonb_array_length(payload->'labels') then raise exception 'managed_full_pdf_summary_labels';end if;
 for label in select value from jsonb_array_elements(payload->'labels') loop
  if not ingestion_generation_evidence.keys(label,array['label','label_type','confidence']) or jsonb_typeof(label->'label') is distinct from 'string'
   or length(label->>'label') not between 1 and 120 or lower(btrim(regexp_replace(label->>'label','\s+',' ','g'))) is distinct from label->>'label'
   or coalesce(label->>'label_type','') not in ('site','topic','document_type','medication','risk','setting','workflow','population','service','clinical_action','care_phase','document_intent','content_feature','custom')
   or jsonb_typeof(label->'confidence') is distinct from 'number' then raise exception 'managed_full_pdf_summary_labels';end if;
  if (label->>'confidence')::numeric not between 0 and 1 then raise exception 'managed_full_pdf_summary_labels';end if;
  select value into item from jsonb_array_elements(items) with ordinality i(value,n)
   where ingestion_generation_evidence.full_pdf_summary_label_match(value->>'text',label->>'label') order by n limit 1;
  if item is null then raise exception 'managed_full_pdf_summary_label_anchor';end if;
  expected_label:=label||jsonb_build_object('document_id',doc,'owner_id',owner,'source','generated','metadata',jsonb_build_object('index_generation_id',g,'summary_version',payload->'summary_version','source_chunk_ids',item->'source_chunk_ids','source_image_ids',item->'source_image_ids','pages',item->'pages'));
  if projection->'labels'->label_index is distinct from expected_label then raise exception 'managed_full_pdf_summary_label_projection';end if;label_index:=label_index+1;
 end loop;
end $$;

create or replace function ingestion_generation_evidence.assert_full_pdf_packet(f jsonb,g uuid,p jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare legacy jsonb;result jsonb;
begin
 if p->>'version'='managed-full-pdf-packet-v1' then return ingestion_generation_evidence.assert_full_pdf_packet_v1(f,g,p);end if;
 if not ingestion_generation_evidence.keys(p,array['version','profileId','identity','inspection','rows','quality','deferredOptionalFamilies','clinicalApproval','publicationApproval','summaryProjection'])
  or p->>'version' is distinct from 'managed-full-pdf-packet-v2' or octet_length(convert_to(p::text,'UTF8'))>67108864
  or jsonb_typeof(p->'deferredOptionalFamilies') is distinct from 'array' or p->'deferredOptionalFamilies' ? 'model_summary'
  then raise exception 'managed_full_pdf_invalid_packet';end if;
 -- Only the private validation view drops the projection; staging hashes and
 -- retains the complete v2 packet, including request and provider evidence.
 legacy:=(p-'summaryProjection')||jsonb_build_object('version','managed-full-pdf-packet-v1');
 result:=ingestion_generation_evidence.assert_full_pdf_packet_v1(f,g,legacy);
 perform ingestion_generation_evidence.assert_full_pdf_summary((f->>'document_id')::uuid,g,p);
 return result;
end $$;

create function ingestion_generation_evidence.publish_full_pdf_summary(doc uuid,g uuid,p jsonb)
returns void language plpgsql set search_path='' as $$
declare s jsonb:=p->'summaryProjection'->'summary';v_label jsonb;
begin
 if p->>'version'<>'managed-full-pdf-packet-v2' then return;end if;
 perform ingestion_generation_evidence.assert_full_pdf_summary(doc,g,p);
 if not exists(select 1 from public.documents d where d.id=doc and d.index_generation_id=g and coalesce(to_jsonb(d.owner_id),'null'::jsonb)=s->'owner_id') then raise exception 'managed_full_pdf_summary_pointer_required';end if;
 insert into public.document_summaries(document_id,owner_id,summary,clinical_specifics,source_chunk_ids,source_image_ids,model,generated_at,metadata)
 values(doc,(s->>'owner_id')::uuid,s->>'summary',s->'clinical_specifics',array(select jsonb_array_elements_text(s->'source_chunk_ids'))::uuid[],array(select jsonb_array_elements_text(s->'source_image_ids'))::uuid[],s->>'model',(s->>'generated_at')::timestamptz,s->'metadata')
 on conflict(document_id) do update set owner_id=excluded.owner_id,summary=excluded.summary,clinical_specifics=excluded.clinical_specifics,source_chunk_ids=excluded.source_chunk_ids,source_image_ids=excluded.source_image_ids,model=excluded.model,generated_at=excluded.generated_at,metadata=excluded.metadata,updated_at=clock_timestamp();
 delete from public.document_labels l where l.document_id=doc and l.source='generated';
 for v_label in select value from jsonb_array_elements(p->'summaryProjection'->'labels') loop
  insert into public.document_labels(document_id,owner_id,label,label_type,confidence,source,metadata)
   values(doc,(v_label->>'owner_id')::uuid,v_label->>'label',v_label->>'label_type',(v_label->>'confidence')::real,'generated',v_label->'metadata');
 end loop;
end $$;

create or replace function ingestion_generation_evidence.full_pdf_rows_match(doc uuid,g uuid,p jsonb)
returns boolean language plpgsql set search_path='' as $$
declare expected jsonb;actual jsonb;s jsonb;v_label jsonb;ignored text[]:=array['id','created_at','updated_at'];
begin
 if not ingestion_generation_evidence.full_pdf_rows_match_v1(doc,g,p) then return false;end if;
 if p->>'version'='managed-full-pdf-packet-v1' then return true;end if;
 if p->>'version' is distinct from 'managed-full-pdf-packet-v2' then return false;end if;
 perform ingestion_generation_evidence.assert_full_pdf_summary(doc,g,p);
 -- The pointer's BEFORE UPDATE trigger still needs the predecessor's aliases.
 -- Validate candidate proof now; require the new aliases only after activation.
 if not exists(select 1 from public.documents d where d.id=doc and d.index_generation_id=g) then return true;end if;
 s:=p->'summaryProjection'->'summary';
 select to_jsonb(t)-ignored into actual from public.document_summaries t where t.document_id=doc;
 select to_jsonb(jsonb_populate_record(null::public.document_summaries,s))-ignored into expected;
 if actual is distinct from expected then return false;end if;
 if (select count(*) from public.document_labels t where t.document_id=doc and t.source='generated')<>jsonb_array_length(p->'summaryProjection'->'labels') then return false;end if;
 for v_label in select value from jsonb_array_elements(p->'summaryProjection'->'labels') loop
  select to_jsonb(t)-ignored into actual from public.document_labels t where t.document_id=doc and t.source='generated' and t.label_type=v_label->>'label_type' and t.label=v_label->>'label';
  select to_jsonb(jsonb_populate_record(null::public.document_labels,v_label))-ignored into expected;
  if actual is distinct from expected then return false;end if;
 end loop;return true;
end $$;

-- Patch exactly the successful pointer boundary, preserving its lock/fence/seal
-- checks. Any summary or job-completion failure rolls the entire call back.
do $$
declare definition text;needle text:='  result:=public.complete_ingestion_job(result->''fence'',j.batch_id,''full_pdf_completed'');';
 checkpoint text:='''terminalVersion'',''managed-full-pdf-packet-v1''';
begin
 definition:=pg_get_functiondef('public.complete_managed_full_pdf(jsonb,uuid,text,boolean)'::regprocedure);
 if length(definition)-length(replace(definition,needle,''))<>length(needle)
  or length(definition)-length(replace(definition,checkpoint,''))<>length(checkpoint) then raise exception 'managed_full_pdf_summary_terminal_preimage';end if;
 definition:=replace(definition,checkpoint,'''terminalVersion'',s.packet->>''version''');
 execute replace(definition,needle,'  perform ingestion_generation_evidence.publish_full_pdf_summary(s.document_id,p_generation,s.packet);'||chr(10)||needle);
end $$;

alter function ingestion_generation_evidence.assert_full_pdf_packet_v1(jsonb,uuid,jsonb) owner to postgres;
alter function ingestion_generation_evidence.full_pdf_rows_match_v1(uuid,uuid,jsonb) owner to postgres;
alter function ingestion_generation_evidence.full_pdf_summary_ids(jsonb,jsonb) owner to postgres;
alter function ingestion_generation_evidence.full_pdf_summary_label_match(text,text) owner to postgres;
alter function ingestion_generation_evidence.assert_full_pdf_summary(uuid,uuid,jsonb) owner to postgres;
alter function ingestion_generation_evidence.publish_full_pdf_summary(uuid,uuid,jsonb) owner to postgres;
revoke all on function ingestion_generation_evidence.assert_full_pdf_packet_v1(jsonb,uuid,jsonb),ingestion_generation_evidence.full_pdf_rows_match_v1(uuid,uuid,jsonb),ingestion_generation_evidence.full_pdf_summary_ids(jsonb,jsonb),ingestion_generation_evidence.full_pdf_summary_label_match(text,text),ingestion_generation_evidence.assert_full_pdf_summary(uuid,uuid,jsonb),ingestion_generation_evidence.publish_full_pdf_summary(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
-- Replacements retain their pre-existing postgres ownership and private ACLs.
commit;
