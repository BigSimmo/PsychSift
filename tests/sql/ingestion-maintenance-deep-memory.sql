-- Disposable PostgreSQL only; synthetic local-producer artifacts, all changes roll back.
\set ON_ERROR_STOP on
begin;
set local statement_timeout='60s';
set local request.jwt.claim.role='service_role';
set local request.jwt.claims='{"role":"service_role"}';
create function pg_temp.assert_true(ok boolean,message text) returns void language plpgsql as $$ begin
 if ok is distinct from true then raise exception '%',message; end if;
end $$;
select pg_temp.assert_true(not exists(select 1 from public.documents),'requires empty disposable database');
insert into auth.users(id) values('10000000-0000-4000-8000-000000000001');
insert into public.documents(id,owner_id,title,file_name,file_type,storage_path,status,metadata)
values('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','Synthetic memory','synthetic.txt','text/plain','synthetic/memory.txt','indexed',
'{"index_generation_id":"40000000-0000-4000-8000-000000000001","worker_key":"retained"}');
-- Old current A, rollback B and uniquely staged C have independent producer generations.
insert into public.document_sections(id,document_id,owner_id,section_index,heading,producer,artifact_generation_id,index_generation_id,metadata)
select ('50000000-0000-4000-8000-00000000000'||n)::uuid,'30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',0,'Synthetic section','local-worker',
('60000000-0000-4000-8000-00000000000'||n)::uuid,
case when n=3 then '60000000-0000-4000-8000-000000000003'::uuid else ('40000000-0000-4000-8000-00000000000'||n)::uuid end,
jsonb_build_object('generated_by','local-worker','artifact_generation_id','60000000-0000-4000-8000-00000000000'||n,
'index_generation_id',case when n=3 then '60000000-0000-4000-8000-000000000003' else '40000000-0000-4000-8000-00000000000'||n end)
from generate_series(1,3) n;
insert into public.document_memory_cards(document_id,owner_id,section_id,card_type,title,content,producer,artifact_generation_id,index_generation_id,metadata,embedding)
select document_id,owner_id,id,'section_summary','Synthetic card','Synthetic memory evidence',producer,artifact_generation_id,index_generation_id,metadata,
array_fill(0::real,array[1536])::extensions.vector from public.document_sections;

do $$ declare stamp timestamptz; result jsonb; begin
 select updated_at into stamp from public.documents;
 begin
   perform public.commit_document_maintenance_deep_memory('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',stamp-interval '1 second',
   '40000000-0000-4000-8000-000000000001','[]','[]','local-worker','60000000-0000-4000-8000-000000000003','rag-deep-memory-v2','synthetic-version',1,1,'{}',0);
   raise exception 'expected stale memory snapshot conflict';
 exception when serialization_failure then null; end;
 perform pg_temp.assert_true((select count(*)=3 from public.document_sections),'rejected stale memory preserves all artifacts');
 insert into public.document_sections(id,document_id,owner_id,section_index,heading,metadata)
 values('50000000-0000-4000-8000-000000000004','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',99,'Unassigned synthetic legacy section','{"generated_by":"local-worker"}');
 begin
   perform public.commit_document_maintenance_deep_memory('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',stamp,
   '40000000-0000-4000-8000-000000000001','[]','[]','local-worker','60000000-0000-4000-8000-000000000003','rag-deep-memory-v2','synthetic-version',1,1,'{}',0);
   raise exception 'expected unassigned lineage refusal';
 exception when check_violation then
   if sqlerrm<>'legacy_generation_lineage_requires_fenced_reindex' then raise; end if;
 end;
 perform pg_temp.assert_true(exists(select 1 from public.document_sections where id='50000000-0000-4000-8000-000000000004'),'unassigned lineage refusal preserves legacy evidence');
 delete from public.document_sections where id='50000000-0000-4000-8000-000000000004';
 result:=public.commit_document_maintenance_deep_memory('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',stamp,
   '40000000-0000-4000-8000-000000000001','[]','[]','local-worker','60000000-0000-4000-8000-000000000003','rag-deep-memory-v2','synthetic-version',1,1,'{}',0);
 perform pg_temp.assert_true(result->>'updated_at' is not null and result->'metadata'->>'worker_key'='retained','commit returns own new snapshot and preserves worker metadata');
end $$;
select pg_temp.assert_true(not exists(select 1 from public.document_sections where id='50000000-0000-4000-8000-000000000001'),'superseded current memory replaced');
select pg_temp.assert_true(exists(select 1 from public.document_sections where id='50000000-0000-4000-8000-000000000002') and
exists(select 1 from public.document_memory_cards where section_id='50000000-0000-4000-8000-000000000002'),'rollback sections and cards preserved');
select pg_temp.assert_true(exists(select 1 from public.document_sections where id='50000000-0000-4000-8000-000000000003' and index_generation_id='40000000-0000-4000-8000-000000000001'),'prepared generation promoted only into expected current index generation');
select pg_temp.assert_true((select metadata->>'index_generation_id'='40000000-0000-4000-8000-000000000001' from public.documents),'committed source generation pointer unchanged');
rollback;
