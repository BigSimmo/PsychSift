-- Disposable PostgreSQL only. Registers synthetic originals through the real fenced API.
-- Extra synthetic derived rows exercise every private evidence table; all changes roll back.
\set ON_ERROR_STOP on
begin;
set local statement_timeout = '60s';

create function pg_temp.assert_true(ok boolean, message text) returns void
language plpgsql as $$ begin
  if ok is distinct from true then raise exception '%', message; end if;
end $$;
select pg_temp.assert_true(not has_function_privilege('service_role',
  'ingestion_generation_evidence.purge_deleted_document()', 'EXECUTE'), 'purge helper is not a service RPC');
select pg_temp.assert_true(not has_schema_privilege('authenticated', 'ingestion_generation_evidence', 'USAGE')
  and not has_schema_privilege('service_role', 'ingestion_generation_evidence', 'USAGE'),
  'private evidence schema grants remain closed');

insert into auth.users(id, email) values
  ('da000000-0000-4000-8000-000000000001', 'synthetic-removal@example.org'),
  ('da000000-0000-4000-8000-000000000002', 'synthetic-retained@example.org');
insert into public.documents(id, owner_id, title, file_name, file_type, file_size, content_hash, storage_path, status)
select ('db000000-0000-4000-8000-00000000000' || n)::uuid,
  ('da000000-0000-4000-8000-00000000000' || n)::uuid,
  'Synthetic retention fixture', 'synthetic.txt', 'text/plain', 9,
  encode(extensions.digest(convert_to('SYNTHETIC', 'UTF8'), 'sha256'), 'hex'),
  'synthetic/removal/' || n || '.txt', 'queued'
from generate_series(1, 2) n;
insert into public.ingestion_jobs(document_id, status)
select id, 'pending' from public.documents where id::text like 'db000000-%';
insert into public.audit_logs(id, owner_id, action, resource_type, resource_id, metadata)
values ('dc000000-0000-4000-8000-000000000001', 'da000000-0000-4000-8000-000000000001',
  'synthetic.document.access', 'document', 'db000000-0000-4000-8000-000000000001', '{}');

create temp table retention_claims as
select job from public.claim_ingestion_jobs('synthetic-retention-worker', 2, 45,
  array['db000000-0000-4000-8000-000000000001', 'db000000-0000-4000-8000-000000000002']::uuid[],
  array['text/plain']) job;
select pg_temp.assert_true((select count(*) = 2 from retention_claims), 'both synthetic claims are fenced');

do $register$
declare r record; fence jsonb; expectation jsonb; expectation_bytes bytea; units jsonb; declarations jsonb; result jsonb;
begin
  for r in select job from retention_claims loop
    fence := jsonb_build_object('job_kind', 'node', 'job_id', r.job->'id',
      'document_id', r.job->'document_id', 'worker_id', r.job->'locked_by',
      'lease_token', r.job->'lease_token', 'expected_generation_id', r.job->'lease_expected_generation_id',
      'authority_digest', r.job->'lease_authority_digest');
    expectation := jsonb_build_object('version', 1, 'sourceSha256', 'sha256:' || (r.job->'documents'->>'content_hash'),
      'tag', 'unavailable', 'units', null, 'witness', null, 'limitation', 'synthetic source inventory unavailable');
    expectation_bytes := convert_to(expectation::text, 'UTF8');
    select jsonb_agg(jsonb_build_object('id', jsonb_build_object('family', 'private_objects', 'key', u.key),
      'groupKey', 'private_objects', 'required', true, 'dependencies', '[]'::jsonb,
      'sourceEvidenceIds', '[]'::jsonb, 'qualification', 'source_bytes_exact', 'representation', u.representation)
      order by u.key) into units from (values
      ('original-source', 'original_binary'), ('page:1:extracted', 'extracted_utf8'),
      ('page:1:persisted', 'persisted_utf8'), ('page:1:original-provenance', 'provenance_json'),
      ('page:1:persisted-provenance', 'provenance_json')) u(key, representation);
    declarations := jsonb_build_object('version', 1, 'units', units, 'groups', jsonb_build_array(
      jsonb_build_object('family', 'private_objects', 'groupKey', 'private_objects', 'declaration',
        jsonb_build_object('producer', jsonb_build_object('name', 'synthetic', 'version', '1',
          'outputManifestDigest', 'sha256:' || repeat('a', 64)), 'artifactGenerationId', null,
          'population', jsonb_build_object('tag', 'known', 'reason', null,
            'expectedUnits', (select jsonb_agg(u.value->'id') from jsonb_array_elements(units) u),
            'basis', jsonb_build_array(jsonb_build_object('reference', 'synthetic-original',
              'sha256', 'sha256:' || (r.job->'documents'->>'content_hash'))))))));
    result := public.begin_ingestion_generation_evidence(fence, (r.job->>'lease_write_generation_id')::uuid,
      jsonb_build_object('version', 1, 'profileVersion', 'u10-u12-prerequisite-profile-v1',
        'sourceSha256', 'sha256:' || (r.job->'documents'->>'content_hash'), 'sourceByteLength', 9,
        'sourceExpectation', expectation, 'sourceExpectationHex', encode(expectation_bytes, 'hex'),
        'sourceExpectationSha256', 'sha256:' || encode(extensions.digest(expectation_bytes, 'sha256'), 'hex'),
        'declarations', declarations), encode(convert_to('SYNTHETIC', 'UTF8'), 'hex'));
    perform pg_temp.assert_true(result->'ok' = 'true'::jsonb, 'normal managed registration retains synthetic original');
  end loop;
end;
$register$;

-- An older synthetic generation of the same document must also be immutable until
-- permanent deletion and must be removed with every other retained generation.
insert into ingestion_generation_evidence.candidates
select (jsonb_populate_record(null::ingestion_generation_evidence.candidates,
  to_jsonb(c) || jsonb_build_object('generation_id', 'de000000-0000-4000-8000-000000000001'))).*
from ingestion_generation_evidence.candidates c where c.document_id = 'db000000-0000-4000-8000-000000000001';
insert into ingestion_generation_evidence.producer_declarations
select (jsonb_populate_record(null::ingestion_generation_evidence.producer_declarations,
  to_jsonb(p) || jsonb_build_object('generation_id', 'de000000-0000-4000-8000-000000000001'))).*
from ingestion_generation_evidence.producer_declarations p
where p.document_id = 'db000000-0000-4000-8000-000000000001' and p.generation_id <> 'de000000-0000-4000-8000-000000000001';
insert into ingestion_generation_evidence.unit_declarations
select (jsonb_populate_record(null::ingestion_generation_evidence.unit_declarations,
  to_jsonb(u) || jsonb_build_object('generation_id', 'de000000-0000-4000-8000-000000000001'))).*
from ingestion_generation_evidence.unit_declarations u
where u.document_id = 'db000000-0000-4000-8000-000000000001' and u.generation_id <> 'de000000-0000-4000-8000-000000000001';
insert into ingestion_generation_evidence.retained_artifacts
select (jsonb_populate_record(null::ingestion_generation_evidence.retained_artifacts,
  to_jsonb(a) || jsonb_build_object('generation_id', 'de000000-0000-4000-8000-000000000001'))).*
from ingestion_generation_evidence.retained_artifacts a
where a.document_id = 'db000000-0000-4000-8000-000000000001' and a.generation_id <> 'de000000-0000-4000-8000-000000000001';

-- Populate every remaining private representation using synthetic owner-only fixture rows.
do $derived$
declare c ingestion_generation_evidence.candidates; projection uuid; visual uuid;
  b bytea := convert_to('{}', 'UTF8'); h text; vector_value extensions.vector := array_fill(0::real, array[1536])::extensions.vector;
begin
  h := 'sha256:' || encode(extensions.digest(b, 'sha256'), 'hex');
  for c in select * from ingestion_generation_evidence.candidates where document_id::text like 'db000000-%' loop
    projection := gen_random_uuid(); visual := gen_random_uuid();
    insert into ingestion_generation_evidence.outcomes values
      (c.document_id, c.generation_id, 'private_objects', 'original-source', 'private_objects', '{}');
    insert into ingestion_generation_evidence.prerequisite_accounting values
      (c.document_id, c.generation_id, h, '{}', now());
    insert into ingestion_generation_evidence.scoped_projection_expectations values
      (c.document_id, c.generation_id, projection, '{}', b, h, octet_length(b));
    insert into ingestion_generation_evidence.scoped_projection_rows values
      (c.document_id, c.generation_id, projection, 'chunks', gen_random_uuid(), '{"content":"SYNTHETIC"}');
    insert into ingestion_generation_evidence.scoped_projection_artifacts values
      (c.document_id, c.generation_id, projection, 'chunks', gen_random_uuid(), 'prepared', b, h, octet_length(b));
    insert into ingestion_generation_evidence.visual_unit_expectations values
      (c.document_id, c.generation_id, visual, projection, b, b, b, '{}', h, h, h, '[{},{},{},{}]');
    insert into ingestion_generation_evidence.visual_unit_rows values
      (c.document_id, c.generation_id, visual, 1, gen_random_uuid(), '{"content":"SYNTHETIC"}');
    insert into ingestion_generation_evidence.managed_vector_packets values
      (c.document_id, c.generation_id, '{}', h, '{}', b, h);
    insert into ingestion_generation_evidence.managed_vector_final_receipts values
      (c.document_id, c.generation_id, 'chunks', gen_random_uuid(), b, h, octet_length(b));
    insert into ingestion_generation_evidence.candidate_chunk_rows(document_id, index_generation_id, chunk_index,
      content, embedding, candidate_owner_id, candidate_job_id, candidate_lease_token,
      candidate_authority_digest, candidate_source_sha256, candidate_source_expectation_digest, candidate_prepared_sha256)
    values (c.document_id, c.generation_id, 0, 'SYNTHETIC', vector_value, null, c.job_id, c.first_lease_token, h, h, h, h);
    insert into ingestion_generation_evidence.managed_vector_chunk_rows(document_id, index_generation_id, chunk_index,
      content, embedding, packet_identity, prepared_sha256)
    values (c.document_id, c.generation_id, 0, 'SYNTHETIC', vector_value, '{}', h);
    insert into ingestion_generation_evidence.managed_vector_field_rows(document_id, index_generation_id,
      field_type, content, content_hash, embedding, packet_identity, prepared_sha256)
    values (c.document_id, c.generation_id, 'document_summary', 'SYNTHETIC', h, vector_value, '{}', h);
    insert into ingestion_generation_evidence.managed_vector_index_rows(document_id, index_generation_id,
      unit_type, title, content, embedding, packet_identity, prepared_sha256)
    values (c.document_id, c.generation_id, 'document_profile', 'Synthetic', 'SYNTHETIC', vector_value, '{}', h);
  end loop;
end;
$derived$;

-- No deletion/overwrite/truncate of evidence while the document is still present.
do $immutable$
begin
  begin
    delete from ingestion_generation_evidence.retained_artifacts where document_id = 'db000000-0000-4000-8000-000000000001';
    raise exception 'direct evidence delete unexpectedly succeeded';
  exception when check_violation then null;
  end;
  begin
    update ingestion_generation_evidence.retained_artifacts set locator = 'changed'
      where document_id = 'db000000-0000-4000-8000-000000000001';
    raise exception 'evidence overwrite unexpectedly succeeded';
  exception when check_violation then null;
  end;
  begin
    truncate ingestion_generation_evidence.retained_artifacts;
    raise exception 'evidence truncate unexpectedly succeeded';
  exception when check_violation then null;
  end;
end;
$immutable$;

select pg_temp.assert_true(public.delete_document_if_idle('db000000-0000-4000-8000-000000000001',
  'da000000-0000-4000-8000-000000000002', 'clinical-documents', 'clinical-images')->>'outcome' = 'not_found',
  'another owner cannot cause permanent deletion or purge');
select pg_temp.assert_true(public.delete_document_if_idle('db000000-0000-4000-8000-000000000001',
  'da000000-0000-4000-8000-000000000001', 'clinical-documents', 'clinical-images')->>'outcome' = 'active_job',
  'active job prevents deletion and leaves retained evidence intact');

update public.ingestion_jobs set status = 'failed' where document_id = 'db000000-0000-4000-8000-000000000001';
insert into public.indexing_v3_agent_jobs(document_id, status)
values ('db000000-0000-4000-8000-000000000001', 'pending');
select pg_temp.assert_true(public.delete_document_if_idle('db000000-0000-4000-8000-000000000001',
  'da000000-0000-4000-8000-000000000001', 'clinical-documents', 'clinical-images')->>'outcome' = 'active_job',
  'agent-only pending work also prevents deletion and private purge');
update public.indexing_v3_agent_jobs set status = 'failed'
where document_id = 'db000000-0000-4000-8000-000000000001';

-- A cleanup failure must preserve the parent and all private content atomically.
create function pg_temp.reject_private_purge() returns trigger language plpgsql as $$ begin
  raise exception 'synthetic purge failure' using errcode = 'P0998';
end $$;
create trigger zz_synthetic_purge_failure before delete on ingestion_generation_evidence.candidates
  for each row execute function pg_temp.reject_private_purge();
do $failure$
begin
  begin
    perform public.delete_document_if_idle('db000000-0000-4000-8000-000000000001',
      'da000000-0000-4000-8000-000000000001', 'clinical-documents', 'clinical-images');
    raise exception 'synthetic purge failure was swallowed';
  exception when sqlstate 'P0998' then null;
  end;
  perform pg_temp.assert_true(exists (select 1 from public.documents
    where id = 'db000000-0000-4000-8000-000000000001'), 'purge failure rolls back public deletion');
  perform pg_temp.assert_true(exists (select 1 from ingestion_generation_evidence.retained_artifacts
    where document_id = 'db000000-0000-4000-8000-000000000001'), 'purge failure rolls back prior private deletions');
  perform pg_temp.assert_true(not exists (select 1 from public.storage_cleanup_jobs
    where document_id = 'db000000-0000-4000-8000-000000000001'
      or document_paths = array['synthetic/removal/1.txt']), 'purge failure rolls back cleanup enqueue');
end;
$failure$;
drop trigger zz_synthetic_purge_failure on ingestion_generation_evidence.candidates;

create temp table retention_delete_result as
select public.delete_document_if_idle('db000000-0000-4000-8000-000000000001',
  'da000000-0000-4000-8000-000000000001', 'clinical-documents', 'clinical-images') as result;
select pg_temp.assert_true((select result->>'outcome' = 'deleted' from retention_delete_result),
  'idle permanent deletion succeeds atomically');
select pg_temp.assert_true(not exists (select 1 from public.documents where id = 'db000000-0000-4000-8000-000000000001'),
  'public document is removed');
select pg_temp.assert_true(exists (
  select 1 from public.storage_cleanup_jobs j
  join retention_delete_result r on j.id = (r.result->>'cleanup_job_id')::uuid
  where j.document_id is null
    and j.owner_id = 'da000000-0000-4000-8000-000000000001'
    and j.document_bucket = 'clinical-documents'
    and j.document_paths = array['synthetic/removal/1.txt'] and j.status = 'pending'
), 'returned Storage cleanup obligation survives with its deleted document reference cleared');
select pg_temp.assert_true(exists (select 1 from public.audit_logs
  where id = 'dc000000-0000-4000-8000-000000000001' and metadata = '{}'), 'content-free access-trail audit survives');

do $residual$
declare t record; removed bigint; retained bigint;
begin
  for t in select tablename from pg_catalog.pg_tables where schemaname = 'ingestion_generation_evidence' loop
    execute format('select count(*) from ingestion_generation_evidence.%I where document_id = $1', t.tablename)
      into removed using 'db000000-0000-4000-8000-000000000001'::uuid;
    execute format('select count(*) from ingestion_generation_evidence.%I where document_id = $1', t.tablename)
      into retained using 'db000000-0000-4000-8000-000000000002'::uuid;
    perform pg_temp.assert_true(removed = 0, 'deleted document leaves no private representation in ' || t.tablename);
    perform pg_temp.assert_true(retained > 0, 'another document retains private representation in ' || t.tablename);
  end loop;
end;
$residual$;
select pg_temp.assert_true(public.delete_document_if_idle('db000000-0000-4000-8000-000000000001',
  'da000000-0000-4000-8000-000000000001', 'clinical-documents', 'clinical-images')->>'outcome' = 'not_found',
  'repeated permanent deletion is idempotent');
rollback;
