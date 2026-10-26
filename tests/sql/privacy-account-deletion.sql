-- Disposable database only (`npm run test:sql`). Proves the 26 Oct 2026 privacy database changes
-- (20261026081000_privacy_cpd_files_and_calendar_links.sql,
-- 20261026081500_delete_question_logs_with_account.sql and
-- 20261026092000_drop_calendar_link_plain_url.sql):
--   SB-05  deleting an account queues its CPD evidence files for the storage cleaner, once each,
--          without the owner on the job, and leaves another doctor's evidence alone;
--   DB-04  a calendar address is kept only encrypted in Vault (no plain-text column), the list
--          column holds only the host, only the owner gets the address back, the app cannot
--          repoint or share a link's secret, the add function keeps the https, workplace and
--          3-link rules, and removing a link or the account removes its encrypted copy;
--   DB-05  deleting an account deletes its questions, answers and search logs, keeps its answer
--          feedback as an unnamed report with the free-text note emptied, keeps its audit-log rows
--          with the owner cleared, and leaves another doctor's rows alone.
-- Synthetic rows only; everything rolls back.
\set ON_ERROR_STOP on
begin;
set local statement_timeout = '60s';

create function pg_temp.assert_true(ok boolean, message text) returns void
language plpgsql as $$ begin
  if ok is distinct from true then raise exception '%', message; end if;
end $$;
-- The Supabase image revokes execute from public by default, so grant the helper explicitly.
grant execute on function pg_temp.assert_true(boolean, text) to service_role;

insert into auth.users(id, email) values
  ('d0000000-0000-4000-8000-000000000001', 'leaver@example.org'),
  ('d0000000-0000-4000-8000-000000000002', 'stayer@example.org');

-- SB-05 --------------------------------------------------------------------------------------
insert into public.cme_years(id, owner_id, year, total_hours, confirmed_on, confirmed_source)
select ('d1000000-0000-4000-8000-00000000000' || n)::uuid, ('d0000000-0000-4000-8000-00000000000' || n)::uuid,
  2026, 50, '2026-01-01', 'synthetic'
from generate_series(1, 2) n;
insert into public.cme_entries(id, owner_id, year_id, activity_date, title)
select ('d2000000-0000-4000-8000-00000000000' || n)::uuid, ('d0000000-0000-4000-8000-00000000000' || n)::uuid,
  ('d1000000-0000-4000-8000-00000000000' || n)::uuid, '2026-03-01', 'Synthetic activity'
from generate_series(1, 2) n;
insert into public.cme_evidence(id, owner_id, entry_id, file_name, content_type, byte_size, sha256,
  storage_path, kind, redaction_confirmed, preview_confirmed)
select e.id, e.owner_id, e.entry_id, 'certificate.pdf', 'application/pdf', 10, repeat(e.k, 64),
  e.owner_id::text || '/' || e.entry_id::text || '/' || e.id::text, 'certificate', true, true
from (values
  ('d3000000-0000-4000-8000-000000000011'::uuid, 'd0000000-0000-4000-8000-000000000001'::uuid,
   'd2000000-0000-4000-8000-000000000001'::uuid, 'a'),
  ('d3000000-0000-4000-8000-000000000012'::uuid, 'd0000000-0000-4000-8000-000000000001'::uuid,
   'd2000000-0000-4000-8000-000000000001'::uuid, 'b'),
  ('d3000000-0000-4000-8000-000000000021'::uuid, 'd0000000-0000-4000-8000-000000000002'::uuid,
   'd2000000-0000-4000-8000-000000000002'::uuid, 'c')
) e(id, owner_id, entry_id, k);
-- One file was already removed by the doctor and queued; it must not be queued twice.
select public.cme_remove_evidence('d0000000-0000-4000-8000-000000000001',
  'd3000000-0000-4000-8000-000000000012', 'Wrong certificate');

-- DB-04 --------------------------------------------------------------------------------------
-- Links are added only through roster_calendar_link_add; the table has no plain-text column.
create temp table links on commit drop as
select v.k, a.id from (values
  ('one', 'd0000000-0000-4000-8000-000000000001'::uuid,
   'https://roster.example.org/feed/secret-token-one.ics', 'Example Hospital'),
  ('two', 'd0000000-0000-4000-8000-000000000001'::uuid,
   'https://Calendar.Example.net:443/x?token=two', 'Example Clinic'),
  ('stayer', 'd0000000-0000-4000-8000-000000000002'::uuid,
   'https://roster.example.org/feed/stayer.ics', null),
  ('ipv6', 'd0000000-0000-4000-8000-000000000002'::uuid,
   'https://[2001:DB8::1]/feed.ics?token=three', 'Example IPv6')
) v(k, owner_id, url, workplace)
cross join lateral public.roster_calendar_link_add(v.owner_id, v.url, v.workplace) a;
create function pg_temp.link(p_k text) returns uuid language sql stable as $$
  select id from links where k = p_k
$$;
grant select on links to service_role;
grant execute on function pg_temp.link(text) to service_role;

select pg_temp.assert_true(not exists (select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'roster_calendar_links' and column_name = 'url'),
  'the plain-text address column must be gone');
select pg_temp.assert_true((select url_host from public.roster_calendar_links
    where id = pg_temp.link('one')) = 'roster.example.org',
  'the list column must hold the host only');
select pg_temp.assert_true((select url_host from public.roster_calendar_links
    where id = pg_temp.link('two')) = 'calendar.example.net',
  'the host must drop the port and be lower case');
select pg_temp.assert_true((select url_host from public.roster_calendar_links
    where id = pg_temp.link('ipv6')) = '[2001:db8::1]',
  'an IPv6 host must keep its brackets and drop the path and token');
select pg_temp.assert_true((select s.secret <> s.decrypted_secret
    and s.decrypted_secret = 'https://roster.example.org/feed/secret-token-one.ics'
    from public.roster_calendar_links l join vault.decrypted_secrets s on s.id = l.url_secret_id
    where l.id = pg_temp.link('one')),
  'the stored secret must be encrypted and decrypt to the address');

set local role service_role;
select pg_temp.assert_true((select count(*) = 2 and bool_and(url like 'https://%')
    from public.roster_calendar_link_urls('d0000000-0000-4000-8000-000000000001',
      array[pg_temp.link('one'), pg_temp.link('two'), pg_temp.link('stayer')])),
  'the owner must get back only their own two addresses');
select pg_temp.assert_true((select count(*) = 0 from public.roster_calendar_link_urls(
    'd0000000-0000-4000-8000-000000000002', array[pg_temp.link('one')])),
  'another doctor must get nothing back for a link that is not theirs');
select pg_temp.assert_true((select count(*) = 0 from public.roster_calendar_link_urls(
    null, array[pg_temp.link('one')])), 'a missing owner must get nothing');
-- The app cannot repoint a link at someone else's secret or forge the host.
update public.roster_calendar_links
set url_secret_id = (select url_secret_id from public.roster_calendar_links where id = pg_temp.link('stayer')),
    url_host = 'forged.example.com', last_fetched_at = now()
where id = pg_temp.link('one');
reset role;
select pg_temp.assert_true((select u.url = 'https://roster.example.org/feed/secret-token-one.ics'
    and l.url_host = 'roster.example.org' and l.last_fetched_at is not null
    from public.roster_calendar_links l cross join lateral public.roster_calendar_link_urls(
      'd0000000-0000-4000-8000-000000000001', array[l.id]) u
    where l.id = pg_temp.link('one')),
  'a write must not repoint a link at another secret or change its host');
do $$ begin
  insert into public.roster_calendar_links(owner_id, workplace, url_secret_id, url_host)
  select 'd0000000-0000-4000-8000-000000000002', 'Example Copy', url_secret_id, 'copy.example.org'
  from public.roster_calendar_links where id = pg_temp.link('one');
  raise exception 'a second link must not share another link''s secret';
exception when unique_violation then null;
end $$;

-- The add function keeps the old rules: https only, one link per workplace, three per doctor.
do $$ begin
  perform public.roster_calendar_link_add('d0000000-0000-4000-8000-000000000002',
    'http://plain.example.org/x.ics', 'Example Plain');
  raise exception 'a non-https address must be refused';
exception when check_violation then null;
end $$;
do $$ begin
  perform public.roster_calendar_link_add('d0000000-0000-4000-8000-000000000002',
    'https://another.example.org/x.ics', 'Example IPv6');
  raise exception 'a second link for the same workplace must be refused';
exception when unique_violation then null;
end $$;
set local role service_role;
create temp table added_link on commit drop as
select * from public.roster_calendar_link_add('d0000000-0000-4000-8000-000000000002',
  'https://added.example.org/feed.ics?token=four', 'Example Added');
reset role;
select pg_temp.assert_true((select a.url_host = 'added.example.org'
    and u.url = 'https://added.example.org/feed.ics?token=four'
    from added_link a
    cross join lateral public.roster_calendar_link_urls('d0000000-0000-4000-8000-000000000002', array[a.id]) u),
  'an added link must be stored sealed');
do $$ begin
  perform public.roster_calendar_link_add('d0000000-0000-4000-8000-000000000002',
    'https://fourth.example.org/x.ics', 'Example Fourth');
  raise exception 'a fourth link must be refused';
exception when raise_exception then
  if sqlerrm <> 'roster_limit' then raise; end if;
end $$;
delete from public.roster_calendar_links where id = (select id from added_link);

select pg_temp.assert_true((select count(*) = 4 from vault.secrets s
    join public.roster_calendar_links l on l.url_secret_id = s.id)
    and (select count(*) = 4 from vault.secrets where name is null and description = 'roster calendar link'),
  'one secret per link, and refused or removed links leave no secret behind');

create temp table leaver_secrets on commit drop as
select url_secret_id as id from public.roster_calendar_links
where owner_id = 'd0000000-0000-4000-8000-000000000001';
delete from public.roster_calendar_links where id = pg_temp.link('one');
select pg_temp.assert_true((select count(*) = 1 from vault.secrets where id in (select id from leaver_secrets)),
  'removing a link must remove its encrypted copy');

-- None of these functions is callable by a browser role.
select pg_temp.assert_true(not has_function_privilege(r.role, f.fn::regprocedure, 'EXECUTE'),
  r.role || ' can call ' || f.fn)
from (values ('anon'), ('authenticated')) r(role)
cross join (values ('public.roster_calendar_link_urls(uuid,uuid[])'),
  ('public.roster_calendar_links_pin_secret()'), ('public.roster_calendar_links_drop_secret()'),
  ('public.roster_calendar_link_add(uuid,text,text)'),
  ('public.cme_evidence_queue_file_cleanup()')) f(fn);

-- DB-05 --------------------------------------------------------------------------------------
insert into public.rag_queries(owner_id, query) values
  ('d0000000-0000-4000-8000-000000000001', 'synthetic question one'),
  ('d0000000-0000-4000-8000-000000000002', 'synthetic question two');
insert into public.rag_query_misses(owner_id, query, normalized_query) values
  ('d0000000-0000-4000-8000-000000000001', 'synthetic miss', 'synthetic miss'),
  ('d0000000-0000-4000-8000-000000000002', 'synthetic miss', 'synthetic miss');
insert into public.rag_retrieval_logs(owner_id, query) values
  ('d0000000-0000-4000-8000-000000000001', 'synthetic search'),
  ('d0000000-0000-4000-8000-000000000002', 'synthetic search');
insert into public.rag_answer_feedback(owner_id, interaction_id, feedback_category, answer_hash, note) values
  ('d0000000-0000-4000-8000-000000000001', gen_random_uuid(), 'needs_correction', 'h1', 'Synthetic note'),
  ('d0000000-0000-4000-8000-000000000002', gen_random_uuid(), 'verified', 'h2', null);
insert into public.audit_logs(owner_id, action, resource_type, metadata) values
  ('d0000000-0000-4000-8000-000000000001', 'synthetic.action', 'synthetic', '{}');

-- Delete the leaving doctor's account ---------------------------------------------------------
delete from auth.users where id = 'd0000000-0000-4000-8000-000000000001';

select pg_temp.assert_true((select count(*) = 1 from public.storage_cleanup_jobs
    where cme_evidence_id is null and owner_id is null
      and document_bucket = 'cme-private-evidence'
      and metadata ->> 'operation' = 'cme_evidence_deleted'
      and document_paths = array['d0000000-0000-4000-8000-000000000001/d2000000-0000-4000-8000-000000000001/d3000000-0000-4000-8000-000000000011']),
  'the deleted account''s certificate file must be queued for the cleaner without its owner');
select pg_temp.assert_true((select count(*) = 1 from public.storage_cleanup_jobs
    where document_paths = array['d0000000-0000-4000-8000-000000000001/d2000000-0000-4000-8000-000000000001/d3000000-0000-4000-8000-000000000012']),
  'a file already queued when the doctor removed it must stay queued once');
select pg_temp.assert_true(not exists (select 1 from public.storage_cleanup_jobs
    where 'd0000000-0000-4000-8000-000000000002/d2000000-0000-4000-8000-000000000002/d3000000-0000-4000-8000-000000000021' = any(document_paths)),
  'another doctor''s file must not be queued');
select pg_temp.assert_true((select count(*) = 1 from public.cme_evidence), 'only the other doctor''s evidence remains');

select pg_temp.assert_true(not exists (select 1 from vault.secrets where id in (select id from leaver_secrets)),
  'deleting the account must remove the encrypted copies of its calendar links');
select pg_temp.assert_true((select count(*) = 2 from public.roster_calendar_links
    where owner_id = 'd0000000-0000-4000-8000-000000000002')
    and (select count(*) = 2 from public.roster_calendar_links), 'only the other doctor''s links remain');

select pg_temp.assert_true(not exists (select 1 from public.rag_queries where query = 'synthetic question one'),
  'the deleted account''s questions must go');
select pg_temp.assert_true((select count(*) from public.rag_queries where query = 'synthetic question two') = 1,
  'another doctor''s questions must stay');
select pg_temp.assert_true((select count(*) from public.rag_query_misses where query = 'synthetic miss') = 1,
  'only the deleted account''s search misses must go');
select pg_temp.assert_true((select count(*) from public.rag_retrieval_logs where query = 'synthetic search') = 1,
  'only the deleted account''s search logs must go');
select pg_temp.assert_true((select owner_id is null and note is null and feedback_category = 'needs_correction'
    from public.rag_answer_feedback where answer_hash = 'h1'),
  'the deleted account''s problem report must stay as an unnamed signal, with its note gone');
select pg_temp.assert_true((select owner_id = 'd0000000-0000-4000-8000-000000000002'
    from public.rag_answer_feedback where answer_hash = 'h2'),
  'another doctor''s feedback must stay as it was');
select pg_temp.assert_true((select count(*) = 1 from public.audit_logs
    where action = 'synthetic.action' and owner_id is null),
  'the audit-log row must stay with the owner cleared');

\echo PRIVACY_ACCOUNT_DELETION_SQL_PASS: CPD files queued, calendar links sealed and owner-only, question logs deleted and feedback notes emptied with the account, audit rows kept
rollback;
