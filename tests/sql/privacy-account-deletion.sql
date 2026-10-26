-- Disposable database only (`npm run test:sql`). Proves the 26 Oct 2026 privacy database changes
-- (20261026081000_privacy_cpd_files_and_calendar_links.sql and
-- 20261026081500_delete_question_logs_with_account.sql):
--   SB-05  deleting an account queues its CPD evidence files for the storage cleaner, once each,
--          without the owner on the job, and leaves another doctor's evidence alone;
--   DB-04  a calendar address is kept encrypted in Vault, the list column holds only the host,
--          only the owner gets the address back, a changed address re-seals the same secret, the
--          app cannot repoint a link at another secret, and removing a link or the account
--          removes its encrypted copy;
--   DB-05  deleting an account deletes its questions, answers, search logs and answer feedback,
--          keeps its audit-log rows with the owner cleared, and leaves another doctor's rows alone.
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
insert into public.roster_calendar_links(id, owner_id, url, workplace) values
  ('d4000000-0000-4000-8000-000000000011', 'd0000000-0000-4000-8000-000000000001',
   'https://roster.example.org/feed/secret-token-one.ics', 'Example Hospital'),
  ('d4000000-0000-4000-8000-000000000012', 'd0000000-0000-4000-8000-000000000001',
   'https://Calendar.Example.net:443/x?token=two', 'Example Clinic'),
  ('d4000000-0000-4000-8000-000000000021', 'd0000000-0000-4000-8000-000000000002',
   'https://roster.example.org/feed/stayer.ics', null);

select pg_temp.assert_true((select url_host from public.roster_calendar_links
    where id = 'd4000000-0000-4000-8000-000000000011') = 'roster.example.org',
  'the list column must hold the host only');
select pg_temp.assert_true((select url_host from public.roster_calendar_links
    where id = 'd4000000-0000-4000-8000-000000000012') = 'calendar.example.net',
  'the host must drop the port and be lower case');
select pg_temp.assert_true((select s.secret <> l.url and s.decrypted_secret = l.url
    from public.roster_calendar_links l join vault.decrypted_secrets s on s.id = l.url_secret_id
    where l.id = 'd4000000-0000-4000-8000-000000000011'),
  'the stored secret must be encrypted and decrypt to the address');

set local role service_role;
select pg_temp.assert_true((select count(*) = 2 and bool_and(url like 'https://%')
    from public.roster_calendar_link_urls('d0000000-0000-4000-8000-000000000001',
      array['d4000000-0000-4000-8000-000000000011', 'd4000000-0000-4000-8000-000000000012',
            'd4000000-0000-4000-8000-000000000021']::uuid[])),
  'the owner must get back only their own two addresses');
select pg_temp.assert_true((select count(*) = 0 from public.roster_calendar_link_urls(
    'd0000000-0000-4000-8000-000000000002', array['d4000000-0000-4000-8000-000000000011']::uuid[])),
  'another doctor must get nothing back for a link that is not theirs');
select pg_temp.assert_true((select count(*) = 0 from public.roster_calendar_link_urls(
    null, array['d4000000-0000-4000-8000-000000000011']::uuid[])), 'a missing owner must get nothing');
-- The app cannot repoint a link at someone else's secret or forge the host.
update public.roster_calendar_links
set url_secret_id = (select url_secret_id from public.roster_calendar_links
                     where id = 'd4000000-0000-4000-8000-000000000021'),
    url_host = 'forged.example.com', last_fetched_at = now()
where id = 'd4000000-0000-4000-8000-000000000011';
-- A changed address re-seals the same secret.
update public.roster_calendar_links set url = 'https://new.example.org/feed.ics'
where id = 'd4000000-0000-4000-8000-000000000012';
reset role;

select pg_temp.assert_true((select u.url = 'https://roster.example.org/feed/secret-token-one.ics'
    and l.url_host = 'roster.example.org'
    from public.roster_calendar_links l cross join lateral public.roster_calendar_link_urls(
      'd0000000-0000-4000-8000-000000000001', array[l.id]) u
    where l.id = 'd4000000-0000-4000-8000-000000000011'),
  'a write must not repoint a link at another secret or change its host');
select pg_temp.assert_true((select u.url = 'https://new.example.org/feed.ics' and l.url_host = 'new.example.org'
    from public.roster_calendar_links l cross join lateral public.roster_calendar_link_urls(
      'd0000000-0000-4000-8000-000000000001', array[l.id]) u
    where l.id = 'd4000000-0000-4000-8000-000000000012'),
  'a changed address must be re-sealed');
select pg_temp.assert_true((select count(*) = 3 from vault.secrets s
    join public.roster_calendar_links l on l.url_secret_id = s.id), 'one secret per link');

create temp table leaver_secrets on commit drop as
select url_secret_id as id from public.roster_calendar_links
where owner_id = 'd0000000-0000-4000-8000-000000000001';
delete from public.roster_calendar_links where id = 'd4000000-0000-4000-8000-000000000011';
select pg_temp.assert_true((select count(*) = 1 from vault.secrets where id in (select id from leaver_secrets)),
  'removing a link must remove its encrypted copy');

-- None of these functions is callable by a browser role.
select pg_temp.assert_true(not has_function_privilege(r.role, f.fn::regprocedure, 'EXECUTE'),
  r.role || ' can call ' || f.fn)
from (values ('anon'), ('authenticated')) r(role)
cross join (values ('public.roster_calendar_link_urls(uuid,uuid[])'),
  ('public.roster_calendar_links_seal_url()'), ('public.roster_calendar_links_drop_secret()'),
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
select pg_temp.assert_true((select count(*) = 1 from public.roster_calendar_links), 'only the other doctor''s link remains');

select pg_temp.assert_true(not exists (select 1 from public.rag_queries where query = 'synthetic question one'),
  'the deleted account''s questions must go');
select pg_temp.assert_true((select count(*) from public.rag_queries where query = 'synthetic question two') = 1,
  'another doctor''s questions must stay');
select pg_temp.assert_true((select count(*) from public.rag_query_misses where query = 'synthetic miss') = 1,
  'only the deleted account''s search misses must go');
select pg_temp.assert_true((select count(*) from public.rag_retrieval_logs where query = 'synthetic search') = 1,
  'only the deleted account''s search logs must go');
select pg_temp.assert_true(not exists (select 1 from public.rag_answer_feedback where answer_hash = 'h1')
    and exists (select 1 from public.rag_answer_feedback where answer_hash = 'h2'),
  'only the deleted account''s feedback must go');
select pg_temp.assert_true((select count(*) = 1 from public.audit_logs
    where action = 'synthetic.action' and owner_id is null),
  'the audit-log row must stay with the owner cleared');

\echo PRIVACY_ACCOUNT_DELETION_SQL_PASS: CPD files queued, calendar links sealed and owner-only, question logs and feedback deleted with the account, audit rows kept
rollback;
