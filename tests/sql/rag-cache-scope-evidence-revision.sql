-- Disposable database only. Proves table-fact and image edits change the RAG cache scope revision.
\set ON_ERROR_STOP on
begin;
set local statement_timeout = '60s';
create function pg_temp.assert_true(ok boolean, message text) returns void
language plpgsql as $$ begin
  if ok is distinct from true then raise exception '%', message; end if;
end $$;
create function pg_temp.rev() returns text language sql as $$
  select public.rag_cache_scope_revision_v1('11111111-1111-4111-8111-111111111111'::uuid, false, null)
$$;
create function pg_temp.other_rev() returns text language sql as $$
  select public.rag_cache_scope_revision_v1('11111111-1111-4111-8111-111111111111'::uuid, false,
    array['00000000-0000-4000-8000-0000000000e2']::uuid[])
$$;
select pg_temp.assert_true(not exists (select 1 from public.documents), 'requires an empty disposable database');
insert into auth.users(id) values ('11111111-1111-4111-8111-111111111111');
insert into public.documents(id, owner_id, title, file_name, file_type, storage_path, status, metadata)
values
  ('00000000-0000-4000-8000-0000000000e1', '11111111-1111-4111-8111-111111111111',
   'Synthetic evidence', 'fixture.pdf', 'application/pdf', 'synthetic/evidence-1', 'indexed', '{}'),
  ('00000000-0000-4000-8000-0000000000e2', '11111111-1111-4111-8111-111111111111',
   'Synthetic other', 'other.pdf', 'application/pdf', 'synthetic/evidence-2', 'indexed', '{}');

create temp table seen(step text primary key, rev text not null, other text not null);
insert into seen values ('start', pg_temp.rev(), pg_temp.other_rev());

insert into public.document_table_facts(id, owner_id, document_id, table_title, clinical_parameter, threshold_value, action)
values ('00000000-0000-4000-8000-0000000000f1', '11111111-1111-4111-8111-111111111111',
  '00000000-0000-4000-8000-0000000000e1', 'Synthetic table', 'synthetic level', '> 1', 'review');
insert into seen values ('fact insert', pg_temp.rev(), pg_temp.other_rev());
select pg_temp.assert_true((select rev from seen where step = 'fact insert') <> (select rev from seen where step = 'start'),
  'inserting a table fact must change the revision');

update public.document_table_facts set threshold_value = '> 2' where id = '00000000-0000-4000-8000-0000000000f1';
insert into seen values ('fact threshold', pg_temp.rev(), pg_temp.other_rev());
select pg_temp.assert_true((select rev from seen where step = 'fact threshold') <> (select rev from seen where step = 'fact insert'),
  'editing a fact threshold must change the revision');

update public.document_table_facts set action = action where id = '00000000-0000-4000-8000-0000000000f1';
select pg_temp.assert_true(pg_temp.rev() = (select rev from seen where step = 'fact threshold'),
  'a no-op fact update must not change the revision');

insert into public.document_images(id, document_id, storage_path, caption)
values ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000e1', 'synthetic/image-1.png', 'Synthetic caption');
insert into seen values ('image insert', pg_temp.rev(), pg_temp.other_rev());
select pg_temp.assert_true((select rev from seen where step = 'image insert') <> (select rev from seen where step = 'fact threshold'),
  'inserting an image must change the revision');

update public.document_images set caption = 'Edited synthetic caption' where id = '00000000-0000-4000-8000-0000000000a1';
insert into seen values ('image caption', pg_temp.rev(), pg_temp.other_rev());
select pg_temp.assert_true((select rev from seen where step = 'image caption') <> (select rev from seen where step = 'image insert'),
  'editing an image caption must change the revision');

update public.document_images set clinical_relevance_score = 0.9, searchable = false
where id = '00000000-0000-4000-8000-0000000000a1';
insert into seen values ('image relevance', pg_temp.rev(), pg_temp.other_rev());
select pg_temp.assert_true((select rev from seen where step = 'image relevance') <> (select rev from seen where step = 'image caption'),
  'editing image relevance or searchability must change the revision');

delete from public.document_table_facts where id = '00000000-0000-4000-8000-0000000000f1';
insert into seen values ('fact delete', pg_temp.rev(), pg_temp.other_rev());
select pg_temp.assert_true((select rev from seen where step = 'fact delete') <> (select rev from seen where step = 'image relevance'),
  'deleting a table fact must change the revision');

select pg_temp.assert_true((select count(distinct other) = 1 from seen),
  'evidence edits on one document must not change another document''s scoped revision');

-- Deleting the document cascades its facts and images; the evidence triggers must not block it.
delete from public.documents where id = '00000000-0000-4000-8000-0000000000e1';
select pg_temp.assert_true(not exists (select 1 from public.document_evidence_revisions
  where document_id = '00000000-0000-4000-8000-0000000000e1'), 'the evidence counter is removed with its document');
rollback;
