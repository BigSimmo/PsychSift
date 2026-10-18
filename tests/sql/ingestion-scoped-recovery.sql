-- Disposable PostgreSQL only: every synthetic state transition rolls back.
\set ON_ERROR_STOP on
begin;
set local statement_timeout = '30s';
select set_config('request.jwt.claims','{"role":"service_role"}',true);
create function pg_temp.assert_true(ok boolean, message text) returns void language plpgsql as $$ begin
  if ok is distinct from true then raise exception '%',message; end if;
end $$;
insert into auth.users(id) values ('90000000-0000-4000-8000-000000000001'),('90000000-0000-4000-8000-000000000002');
insert into public.documents(id,owner_id,title,file_name,file_type,storage_path,status,content_hash,file_size,metadata)
values ('90000000-0000-4000-8000-000000000003','90000000-0000-4000-8000-000000000001',
  'Synthetic recovery fixture','synthetic.pdf','application/pdf','synthetic/recovery-source','failed',repeat('a',64),12,'{}');
create function pg_temp.reset_job() returns void language plpgsql as $$ begin
  delete from public.indexing_v3_agent_jobs where document_id='90000000-0000-4000-8000-000000000003';
  delete from public.ingestion_jobs where document_id='90000000-0000-4000-8000-000000000003';
  update public.documents set owner_id='90000000-0000-4000-8000-000000000001',file_type='application/pdf',
    status='failed',metadata='{}',content_hash=repeat('a',64) where id='90000000-0000-4000-8000-000000000003';
  insert into public.ingestion_jobs(id,document_id,status,attempt_count) values
    ('90000000-0000-4000-8000-000000000004','90000000-0000-4000-8000-000000000003','failed',3);
end $$;
create function pg_temp.recover(apply boolean default false,snapshot text default null,
  owner uuid default '90000000-0000-4000-8000-000000000001',mime text default 'application/pdf') returns jsonb
language sql as $$ select public.recover_ingestion_job_scoped('90000000-0000-4000-8000-000000000003',owner,mime,
  '90000000-0000-4000-8000-000000000004',apply,snapshot,45) $$;
create temp table preview(result jsonb);
create function pg_temp.preview() returns void language plpgsql as $$ begin
  truncate preview; insert into preview values(pg_temp.recover());
  perform pg_temp.assert_true((select result->>'outcome'='planned' from preview),'fixture must be eligible for a preview');
end $$;

select pg_temp.assert_true(not has_function_privilege('anon','public.recover_ingestion_job_scoped(uuid,uuid,text,uuid,boolean,text,integer)','execute')
  and not has_function_privilege('authenticated','public.recover_ingestion_job_scoped(uuid,uuid,text,uuid,boolean,text,integer)','execute')
  and has_function_privilege('service_role','public.recover_ingestion_job_scoped(uuid,uuid,text,uuid,boolean,text,integer)','execute'),'RPC execution must be service-role only');
select pg_temp.reset_job();
select set_config('request.jwt.claims','{}',true);
do $$ begin
  begin perform pg_temp.recover(); raise exception 'missing service identity was accepted';
  exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
create temp table original_job as select to_jsonb(j) data from public.ingestion_jobs j where id='90000000-0000-4000-8000-000000000004';
select pg_temp.preview();
select pg_temp.assert_true((select data=(select to_jsonb(j) from public.ingestion_jobs j where id='90000000-0000-4000-8000-000000000004') from original_job),'preview must not mutate job or lease');
select pg_temp.assert_true(pg_temp.recover(false,null,'90000000-0000-4000-8000-000000000002')->>'reason'='scope_changed','wrong owner must refuse');
select pg_temp.assert_true(pg_temp.recover(false,null,'90000000-0000-4000-8000-000000000001','text/plain')->>'reason'='scope_changed','wrong MIME must refuse');
update public.documents set file_type='text/plain' where id='90000000-0000-4000-8000-000000000003';
select pg_temp.assert_true(pg_temp.recover(true,(select result->>'snapshot' from preview))->>'reason'='scope_changed','post-preview MIME change must refuse apply');
select pg_temp.reset_job(); select pg_temp.preview();
update public.documents set owner_id='90000000-0000-4000-8000-000000000002' where id='90000000-0000-4000-8000-000000000003';
select pg_temp.assert_true(pg_temp.recover(true,(select result->>'snapshot' from preview))->>'reason'='scope_changed','post-preview owner change must refuse apply');
select pg_temp.reset_job(); select pg_temp.preview();
update public.documents set metadata='{"index_generation_id":"90000000-0000-4000-8000-000000000005"}' where id='90000000-0000-4000-8000-000000000003';
select pg_temp.assert_true(pg_temp.recover(true,(select result->>'snapshot' from preview))->>'reason'='snapshot_changed','current generation must be bound to preview');
select pg_temp.reset_job(); select pg_temp.preview();
update public.documents set content_hash=repeat('b',64) where id='90000000-0000-4000-8000-000000000003';
select pg_temp.assert_true(pg_temp.recover(true,(select result->>'snapshot' from preview))->>'reason'='snapshot_changed','source hash must be bound to preview');
select pg_temp.reset_job(); select pg_temp.preview();
insert into public.indexing_v3_agent_jobs(document_id,status) values('90000000-0000-4000-8000-000000000003','completed');
select pg_temp.assert_true(pg_temp.recover(true,(select result->>'snapshot' from preview))->>'reason'='snapshot_changed','agent state must be bound to preview');
select pg_temp.reset_job();
update public.ingestion_jobs set status='pending',attempt_count=0 where id='90000000-0000-4000-8000-000000000004';
create temp table claimed(job jsonb);
insert into claimed select job from public.claim_ingestion_jobs('synthetic-recovery-worker',1,45,
  array['90000000-0000-4000-8000-000000000003']::uuid[],array['application/pdf']) job;
select pg_temp.assert_true((select count(*)=1 from claimed),'synthetic fixture must be claimed by real claim RPC');
update public.ingestion_jobs set locked_at=now()-interval '2 hours' where id='90000000-0000-4000-8000-000000000004';
select pg_temp.assert_true(pg_temp.recover()->>'reason'='lease_active_or_unknown','old lock cannot override unexpired authoritative lease');
update public.ingestion_jobs set lease_expires_at=now()-interval '1 minute' where id='90000000-0000-4000-8000-000000000004';
select pg_temp.preview();
select pg_temp.assert_true(pg_temp.recover(true,(select result->>'snapshot' from preview))->>'outcome'='requeued','expired lease must atomically requeue');
select pg_temp.assert_true((select status='pending' and attempt_count=0 and locked_by is null and lease_token is null and lease_write_generation_id is null
  from public.ingestion_jobs where id='90000000-0000-4000-8000-000000000004'),'requeue must revoke the old lease and reserved generation');
select pg_temp.assert_true(public.assert_current_ingestion_attempt((select jsonb_build_object('job_kind','node','job_id',job->>'id','document_id',job->>'document_id',
  'worker_id',job->>'locked_by','lease_token',job->>'lease_token','expected_generation_id',job->'lease_expected_generation_id',
  'authority_digest',job->>'lease_authority_digest') from claimed),null) is null,'recovered old attempt fence must no longer authorize writes');
truncate claimed;
insert into claimed select job from public.claim_ingestion_jobs('synthetic-new-worker',1,45,
  array['90000000-0000-4000-8000-000000000003']::uuid[],array['application/pdf']) job;
select pg_temp.assert_true((select count(*)=1 from claimed),'recovered job must receive a fresh normal claim');

-- Public/null owner is explicit and scoped; it must not match a private document.
select pg_temp.reset_job();
select pg_temp.assert_true(pg_temp.recover(false,null,null)->>'reason'='scope_changed','null owner must not match private scope');
-- Use the actual publication gate; this fixture must not bypass it to make a null owner.
update public.documents set status='indexed' where id='90000000-0000-4000-8000-000000000003';
insert into public.document_publication_approvals(document_id,expected_prior_owner_id,approving_operator_id,decision,reason,evidence_references,manifest_digest,reviewed_state_digest)
values('90000000-0000-4000-8000-000000000003','90000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000002',
 'approved','Wholly invented local publication fixture',array['synthetic:recovery-only'],repeat('c',64),
 public.document_publication_state_digest('90000000-0000-4000-8000-000000000003','90000000-0000-4000-8000-000000000001'));
select public.publish_approved_documents(jsonb_build_array(jsonb_build_object('document_id','90000000-0000-4000-8000-000000000003',
 'expected_owner_id','90000000-0000-4000-8000-000000000001','expected_state_digest',
 public.document_publication_state_digest('90000000-0000-4000-8000-000000000003','90000000-0000-4000-8000-000000000001'))),repeat('c',64),1);
truncate preview; insert into preview values(pg_temp.recover(false,null,null));
select pg_temp.assert_true(pg_temp.recover(true,(select result->>'snapshot' from preview),null)->>'outcome'='requeued','explicit public/null scope must be recoverable');

-- Retain source identity and all prior-generation artifacts across retry and supersede.
select pg_temp.reset_job();
update public.documents set metadata='{"index_generation_id":"90000000-0000-4000-8000-000000000005"}',page_count=1,chunk_count=1,image_count=1
 where id='90000000-0000-4000-8000-000000000003';
insert into public.document_pages(document_id,index_generation_id,page_number,text) values('90000000-0000-4000-8000-000000000003','90000000-0000-4000-8000-000000000005',1,'synthetic retained page');
insert into public.document_chunks(document_id,index_generation_id,chunk_index,content,embedding) values
 ('90000000-0000-4000-8000-000000000003','90000000-0000-4000-8000-000000000005',0,'synthetic retained chunk',('['||repeat('0,',1535)||'0]')::extensions.vector);
insert into public.document_images(document_id,index_generation_id,storage_path) values('90000000-0000-4000-8000-000000000003','90000000-0000-4000-8000-000000000005','synthetic/retained-generation/image.png');
select pg_temp.preview();
select pg_temp.assert_true(pg_temp.recover(true,(select result->>'snapshot' from preview))->>'outcome'='requeued','retry with prior committed generation must queue without a reset');
select pg_temp.assert_true((select index_generation_id='90000000-0000-4000-8000-000000000005' and page_count=1 and chunk_count=1 and image_count=1
  and storage_path='synthetic/recovery-source' and content_hash=repeat('a',64) from public.documents where id='90000000-0000-4000-8000-000000000003'),'retry must preserve committed pointer/counts/source');
-- A real failed refresh leaves the previously good generation indexed. That is
-- not evidence that this refresh committed or that a later generation replaced it.
insert into public.import_batches(id,owner_id,name,status,total_files,queued_files,total_bytes)
values('90000000-0000-4000-8000-000000000007','90000000-0000-4000-8000-000000000001','Synthetic recovery batch','processing',1,1,12);
update public.ingestion_jobs set batch_id='90000000-0000-4000-8000-000000000007'
 where id='90000000-0000-4000-8000-000000000004';
update public.documents set status='indexed',import_batch_id='90000000-0000-4000-8000-000000000007'
 where id='90000000-0000-4000-8000-000000000003';
create function pg_temp.claim_fence(j jsonb) returns jsonb language sql as $$
 select jsonb_build_object('job_kind','node','job_id',j->>'id','document_id',j->>'document_id',
 'worker_id',j->>'locked_by','lease_token',j->>'lease_token','expected_generation_id',j->'lease_expected_generation_id',
 'authority_digest',j->>'lease_authority_digest') $$;
create temp table refresh_claim(job jsonb);
insert into refresh_claim select job from public.claim_ingestion_jobs('synthetic-failed-refresh',1,45,
 array['90000000-0000-4000-8000-000000000003']::uuid[],array['application/pdf']) job;
select pg_temp.assert_true((select count(*)=1 from refresh_claim),'failed-refresh fixture must use an actual claim');
select pg_temp.assert_true((select public.fail_or_retry_ingestion_job(pg_temp.claim_fence(job),
 '90000000-0000-4000-8000-000000000007',false,'synthetic failed refresh','synthetic only',null)->>'ok'='true' from refresh_claim),
 'actual fenced failure must succeed');
select pg_temp.assert_true((select d.status='indexed' and j.status='failed'
 and j.lease_expected_generation_id=d.index_generation_id and j.lease_write_generation_id<>d.index_generation_id
 from public.documents d join public.ingestion_jobs j on j.document_id=d.id
 where j.id='90000000-0000-4000-8000-000000000004'),'actual failure must retain indexed predecessor and uncommitted write generation');
select pg_temp.preview();
select pg_temp.assert_true((select result->>'action'='retry' from preview),'failed refresh with unchanged predecessor must retry, not falsely complete');
select pg_temp.assert_true(pg_temp.recover(true,(select result->>'snapshot' from preview))->>'outcome'='requeued','failed refresh must requeue without resetting the prior index');
select pg_temp.assert_true((select status='processing' and failed_files=0 and completed_at is null
 and total_files=1 and queued_files=1 and total_bytes=12 from public.import_batches
 where id='90000000-0000-4000-8000-000000000007'),'batch-backed retry must restore active polling and preserve totals');
select pg_temp.assert_true((select index_generation_id='90000000-0000-4000-8000-000000000005' and page_count=1 and chunk_count=1 and image_count=1
 from public.documents where id='90000000-0000-4000-8000-000000000003'),'failed refresh recovery must retain committed pointer and counts');

-- Clearing recovery's fence does not itself prove an obsolete/committed attempt.
update public.ingestion_jobs set status='failed' where id='90000000-0000-4000-8000-000000000004';
select pg_temp.preview();
select pg_temp.assert_true((select result->>'action'='retry' from preview),'legacy or missing fence must not prove supersession');
select pg_temp.assert_true(pg_temp.recover(true,(select result->>'snapshot' from preview))->>'outcome'='requeued','legacy missing-fence failure must use safe retry');

-- Positive closure requires a real new commit. This attempt commits its reserved
-- generation, then fails before terminal completion; recovery may close it.
truncate refresh_claim;
insert into refresh_claim select job from public.claim_ingestion_jobs('synthetic-committed-refresh',1,45,
 array['90000000-0000-4000-8000-000000000003']::uuid[],array['application/pdf']) job;
insert into public.document_chunks(document_id,index_generation_id,chunk_index,content,embedding)
 select '90000000-0000-4000-8000-000000000003',(job->>'lease_write_generation_id')::uuid,0,'synthetic committed replacement',
 ('['||repeat('0,',1535)||'0]')::extensions.vector from refresh_claim;
insert into public.document_images(document_id,index_generation_id,storage_path)
 select '90000000-0000-4000-8000-000000000003',(job->>'lease_write_generation_id')::uuid,'synthetic/committed-replacement/image.png' from refresh_claim;
create temp table refresh_commit(result jsonb);
insert into refresh_commit select public.commit_document_index_generation(pg_temp.claim_fence(job),
 (job->>'lease_write_generation_id')::uuid,1,1,1,'{}',
 '[{"page_number":1,"text":"synthetic committed replacement page","ocr_used":false,"metadata":{}}]',
 '{"quality_score":0.9,"extraction_quality":"good","metrics":{},"issues":[]}') from refresh_claim;
select pg_temp.assert_true((select result->>'ok'='true' and result->>'index_generation_id'<>'90000000-0000-4000-8000-000000000005' from refresh_commit),
 'positive closure fixture must actually commit a different generation');
select pg_temp.assert_true((select public.fail_or_retry_ingestion_job(result->'fence','90000000-0000-4000-8000-000000000007',
 false,'synthetic post-commit failure','synthetic only',null)->>'ok'='true' from refresh_commit),'post-commit fenced failure must succeed');
select pg_temp.preview();
select pg_temp.assert_true((select result->>'action'='supersede' from preview),'actually committed attempt may be closed after terminal failure');
select pg_temp.assert_true(pg_temp.recover(true,(select result->>'snapshot' from preview))->>'outcome'='superseded','committed replacement must close selected obsolete job');
select pg_temp.assert_true((select status='completed' and failed_files=0 and completed_at is not null
 and total_files=1 and queued_files=1 and total_bytes=12 from public.import_batches
 where id='90000000-0000-4000-8000-000000000007'),'last failed-job supersede must finish the batch and preserve totals');
select pg_temp.assert_true((select count(*)=2 from public.document_chunks where document_id='90000000-0000-4000-8000-000000000003')
 and (select count(*)=2 from public.document_pages where document_id='90000000-0000-4000-8000-000000000003')
 and (select count(*)=2 from public.document_images where document_id='90000000-0000-4000-8000-000000000003'),'retry and supersede must retain both committed generations');
select 'SCOPED_RECOVERY_SQL_PASS' as result;
rollback;
