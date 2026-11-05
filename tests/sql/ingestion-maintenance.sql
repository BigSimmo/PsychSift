-- Disposable PostgreSQL only. All examples are synthetic, and every change rolls back.
\set ON_ERROR_STOP on
begin;
set local statement_timeout = '60s';
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{"role":"service_role"}';
create function pg_temp.assert_true(ok boolean, message text) returns void language plpgsql as $$ begin
  if ok is distinct from true then raise exception '%',message; end if;
end $$;
select pg_temp.assert_true(not exists(select 1 from public.documents), 'requires empty disposable database');
insert into auth.users(id) values ('10000000-0000-4000-8000-000000000001');
insert into public.import_batches(id,owner_id,name,source_root,include_glob,status)
values('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','Synthetic maintenance','synthetic','*.txt','processing');
insert into public.documents(id,owner_id,title,file_name,file_type,file_size,storage_path,content_hash,status,page_count,chunk_count,image_count,metadata)
values('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','Synthetic maintenance','synthetic.txt','text/plain',9,
'synthetic/maintenance.txt','synthetic-hash','indexed',3,4,2,'{"index_generation_id":"40000000-0000-4000-8000-000000000001","worker_key":"preserve"}');
create temp table original_snapshot as select updated_at,metadata from public.documents;

-- Definite queue insertion failure must roll back every queue-state write and retain A.
create function pg_temp.fail_job_insert() returns trigger language plpgsql as $$ begin
  if current_setting('ingestion_maintenance.fail_job',true)='yes' then raise exception 'synthetic_job_failure'; end if;
  return new;
end $$;
create trigger synthetic_fail_job before insert on public.ingestion_jobs for each row execute function pg_temp.fail_job_insert();
set local ingestion_maintenance.fail_job='yes';
do $$ begin
  begin
    perform public.enqueue_import_document('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','synthetic-hash','20000000-0000-4000-8000-000000000001',true,3);
    raise exception 'expected synthetic job failure';
  exception when raise_exception then if sqlerrm<>'synthetic_job_failure' then raise; end if; end;
end $$;
select pg_temp.assert_true((select status='indexed' and page_count=3 and chunk_count=4 and image_count=2 and metadata=(select metadata from original_snapshot) from public.documents), 'failed force preserves generation A and counts');
set local ingestion_maintenance.fail_job='no';
select pg_temp.assert_true(public.enqueue_import_document('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','synthetic-hash','20000000-0000-4000-8000-000000000001',true,3)->>'outcome'='enqueued', 'force queues replacement');
select pg_temp.assert_true(public.enqueue_import_document('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','synthetic-hash','20000000-0000-4000-8000-000000000001',true,3)->>'outcome'='already_active', 'duplicate force converges on existing job');
select pg_temp.assert_true((select count(*)=1 from public.ingestion_jobs), 'only one open job');
select pg_temp.assert_true((select status='indexed' and page_count=3 and metadata->>'worker_key'='preserve' from public.documents), 'successful enqueue also preserves A');
delete from public.ingestion_jobs;

-- Failed replacement restores generated labels and preserves manual labels.
insert into public.document_labels(document_id,owner_id,label,label_type,source) values
('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','old generated','topic','generated'),
('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','manual retained','topic','manual');
do $$ declare stamp timestamptz; begin
  select updated_at into stamp from public.documents;
  begin
    perform public.replace_document_maintenance_artifacts('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',stamp,'40000000-0000-4000-8000-000000000001','labels',
      '{"labels":[{"label":"invalid replacement","label_type":"invalid","confidence":0.8,"metadata":{}}]}');
    raise exception 'expected label constraint failure';
  exception when check_violation then null; end;
end $$;
select pg_temp.assert_true((select count(*)=2 from public.document_labels) and exists(select 1 from public.document_labels where label='old generated'), 'failed label insert restores both previous sets');

-- Owner, generation and even same-generation version conflicts reject without replacement.
do $$ declare stamp timestamptz; generation uuid; owner_id uuid; begin
  select updated_at into stamp from public.documents;
  for generation,owner_id in select * from (values
    ('40000000-0000-4000-8000-000000000002'::uuid,'10000000-0000-4000-8000-000000000001'::uuid),
    ('40000000-0000-4000-8000-000000000001'::uuid,'10000000-0000-4000-8000-000000000002'::uuid)) cases loop
    begin
      perform public.replace_document_maintenance_artifacts('30000000-0000-4000-8000-000000000001',owner_id,stamp,generation,'labels','{"labels":[]}');
      raise exception 'expected identity conflict';
    exception when serialization_failure then null; end;
  end loop;
  begin
    perform public.replace_document_maintenance_artifacts('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',stamp-interval '1 second','40000000-0000-4000-8000-000000000001','labels','{"labels":[]}');
    raise exception 'expected version conflict';
  exception when serialization_failure then null; end;
end $$;
select pg_temp.assert_true((select count(*)=2 from public.document_labels), 'all rejected identities preserve labels');

-- A visual insert failure restores current units and leaves rollback-generation units intact.
insert into public.document_images(id,document_id,storage_path,index_generation_id)
values('50000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','synthetic/image.png','40000000-0000-4000-8000-000000000001');
insert into public.document_index_units(document_id,owner_id,unit_type,source_image_id,title,content,index_generation_id,embedding)
select '30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','visual_summary','50000000-0000-4000-8000-000000000001','Synthetic visual','Synthetic visual evidence',generation,array_fill(0::real,array[1536])::extensions.vector
from unnest(array['40000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000002']::uuid[]) generation;
do $$ declare stamp timestamptz; begin
  select updated_at into stamp from public.documents;
  begin
    perform public.replace_document_maintenance_artifacts('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',stamp,'40000000-0000-4000-8000-000000000001','visual',
      '{"image_ids":["50000000-0000-4000-8000-000000000001"],"units":[{"document_id":"30000000-0000-4000-8000-000000000001","owner_id":"10000000-0000-4000-8000-000000000001","index_generation_id":"40000000-0000-4000-8000-000000000001","unit_type":"visual_summary","source_image_id":"50000000-0000-4000-8000-000000000001","title":"Replacement","content":"Synthetic replacement"}],"image_patches":[]}');
    raise exception 'expected embedding constraint failure';
  exception when not_null_violation then null; end;
end $$;
select pg_temp.assert_true((select count(*)=2 from public.document_index_units), 'failed visual replacement preserves current and rollback generations');
select pg_temp.assert_true(to_regprocedure('public.reset_document_index(uuid)') is null, 'generation-blind reset is absent');
-- Test the actual app role, not only JWT claims or a revoked grant. A retained
-- destructive function would raise insufficient_privilege instead and fail.
set local role service_role;
do $$ begin
  begin
    execute 'select public.reset_document_index($1::uuid)' using '30000000-0000-4000-8000-000000000001'::uuid;
    raise exception 'retired destructive reset unexpectedly executed';
  exception when undefined_function then null; end;
end $$;
reset role;
select pg_temp.assert_true((select count(*)=2 from public.document_index_units), 'retired reset call preserves current and rollback generations');
select pg_temp.assert_true(has_function_privilege('service_role','public.reset_ingestion_attempt_artifacts(jsonb,uuid)','execute'), 'fenced worker reset remains executable');
select pg_temp.assert_true(not has_function_privilege('authenticated','public.reset_ingestion_attempt_artifacts(jsonb,uuid)','execute')
  and not has_function_privilege('anon','public.reset_ingestion_attempt_artifacts(jsonb,uuid)','execute'), 'fenced worker reset remains service-only');
select pg_temp.assert_true(has_function_privilege('service_role','public.commit_document_deep_memory_generation(jsonb,uuid,text,text,integer,integer,jsonb,jsonb,jsonb)','execute'), 'fenced worker deep-memory commit remains executable');
select pg_temp.assert_true(to_regprocedure('public.commit_document_deep_memory_generation(uuid,text,uuid,text,text,integer,integer,jsonb,integer)') is not null, 'separate legacy deep-memory definition is retained');
select pg_temp.assert_true(not has_function_privilege('authenticated','public.replace_document_maintenance_artifacts(uuid,uuid,timestamptz,uuid,text,jsonb)','execute'), 'maintenance is service-only');

-- Registry reconciliation keeps targeted label deletion/upsert and metadata in this same snapshot.
insert into public.documents(id,owner_id,title,file_name,file_type,storage_path,source_path,status,metadata)
values('30000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','Synthetic registry','service-synthetic.registry.json',
'application/vnd.clinical-kb.registry+json','registry://service/synthetic-service','registry://service/synthetic-service','indexed','{"manual_metadata":"retained"}');
insert into public.document_labels(id,document_id,owner_id,label,label_type,source)
values('70000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','old site','site','generated');
create function pg_temp.fail_registry_label_insert() returns trigger language plpgsql as $$ begin
 if new.document_id='30000000-0000-4000-8000-000000000002' then raise exception 'synthetic_registry_label_failure'; end if;
 return new;
end $$;
create trigger synthetic_fail_registry_label before insert on public.document_labels for each row execute function pg_temp.fail_registry_label_insert();
do $$ declare stamp timestamptz; begin
 select updated_at into stamp from public.documents where id='30000000-0000-4000-8000-000000000002';
 begin
   perform public.replace_document_maintenance_artifacts('30000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001',stamp,null,'registry',
   '{"metadata_patch":{"source_kind":"registry_record","registry_record_kind":"service","registry_record_id":"synthetic-service","registry_record_slug":"synthetic-service"},"label_ids_to_delete":["70000000-0000-4000-8000-000000000001"],"labels_to_upsert":[{"label":"operational-process","label_type":"document_intent","confidence":1,"metadata":{}}]}');
   raise exception 'expected registry insertion failure';
 exception when raise_exception then if sqlerrm<>'synthetic_registry_label_failure' then raise; end if; end;
end $$;
select pg_temp.assert_true(exists(select 1 from public.document_labels where id='70000000-0000-4000-8000-000000000001'),'failed registry upsert restores deleted generated label');
select pg_temp.assert_true((select metadata='{"manual_metadata":"retained"}'::jsonb from public.documents where id='30000000-0000-4000-8000-000000000002'),'failed registry operation preserves metadata');
rollback;
