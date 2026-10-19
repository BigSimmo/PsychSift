-- Disposable database only. Finding F-02: a problem report replaces an earlier 'verified'
-- answer verdict for the same interaction; a problem report is never downgraded or replaced,
-- and the note purge and account deletion still work under the update guard.
\set ON_ERROR_STOP on
begin;
set local statement_timeout = '60s';
create function pg_temp.assert_true(ok boolean, message text) returns void
language plpgsql as $$ begin
  if ok is distinct from true then raise exception '%', message; end if;
end $$;
select pg_temp.assert_true(not exists (select 1 from public.rag_answer_feedback), 'requires an empty disposable database');

insert into auth.users(id) values ('51111111-1111-4111-8111-111111111111');

-- Synthetic rows only: no question, answer or patient text.
insert into public.rag_answer_feedback(id, interaction_id, owner_id, feedback_category, answer_hash, note, created_at)
values
  ('5a000000-0000-4000-8000-000000000001', '5b000000-0000-4000-8000-000000000001',
   '51111111-1111-4111-8111-111111111111', 'verified', repeat('a', 64), null, now() - interval '40 days'),
  ('5a000000-0000-4000-8000-000000000002', '5b000000-0000-4000-8000-000000000002',
   null, 'numeric_error', repeat('b', 64), null, now() - interval '1 day'),
  ('5a000000-0000-4000-8000-000000000003', '5b000000-0000-4000-8000-000000000003',
   null, 'wrong_source', repeat('d', 64), 'Synthetic expired note.', now() - interval '40 days');

-- service_role is the only role the API writes with.
set local role service_role;

-- 1. A problem report supersedes the supported verdict, in one conditional update.
update public.rag_answer_feedback
  set feedback_category = 'unsupported_answer', note = 'Synthetic note: no cited source says this.',
      source_ids = array['5c000000-0000-4000-8000-000000000001']::uuid[]
  where interaction_id = '5b000000-0000-4000-8000-000000000001'
    and answer_hash = repeat('a', 64) and record_type = 'answer' and feedback_category = 'verified'
    and owner_id = '51111111-1111-4111-8111-111111111111';

-- 2. The same conditional update finds nothing once a problem is recorded.
update public.rag_answer_feedback set feedback_category = 'presentation_problem'
  where interaction_id = '5b000000-0000-4000-8000-000000000001' and feedback_category = 'verified';

-- 3. The trigger refuses any direct downgrade, swap or in-place rewrite of a problem report,
--    and identity columns stay insert-only for service_role.
do $$
begin
  begin
    update public.rag_answer_feedback set feedback_category = 'verified'
      where id = '5a000000-0000-4000-8000-000000000002';
    raise exception 'downgrading a problem report to verified must be refused';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.rag_answer_feedback set feedback_category = 'wrong_source'
      where id = '5a000000-0000-4000-8000-000000000002';
    raise exception 'replacing a problem report with another problem must be refused';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.rag_answer_feedback set note = 'Synthetic rewritten note.'
      where id = '5a000000-0000-4000-8000-000000000002';
    raise exception 'rewriting a problem report note in place must be refused';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.rag_answer_feedback set answer_hash = repeat('c', 64)
      where id = '5a000000-0000-4000-8000-000000000002';
    raise exception 'service_role must not be able to change answer_hash';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;

select pg_temp.assert_true(
  (select count(*) = 1 from public.rag_answer_feedback where interaction_id = '5b000000-0000-4000-8000-000000000001'),
  'superseding keeps one row per interaction');
select pg_temp.assert_true(
  (select feedback_category = 'unsupported_answer'
          and note = 'Synthetic note: no cited source says this.'
          and id <> '5a000000-0000-4000-8000-000000000001'
          and created_at > now() - interval '1 minute'
          and owner_id = '51111111-1111-4111-8111-111111111111'
   from public.rag_answer_feedback where interaction_id = '5b000000-0000-4000-8000-000000000001'),
  'the superseding report is a new signal with a fresh id and created_at, a second report did not replace it');
select pg_temp.assert_true(
  (select feedback_category = 'numeric_error' and note is null and answer_hash = repeat('b', 64)
   from public.rag_answer_feedback where id = '5a000000-0000-4000-8000-000000000002'),
  'a problem report is unchanged after refused updates');

-- 4. Even the table owner cannot move a report's created_at in place.
do $$
begin
  update public.rag_answer_feedback set created_at = now() - interval '40 days'
    where id = '5a000000-0000-4000-8000-000000000002';
  raise exception 'moving created_at in place must be refused';
exception when insufficient_privilege then null;
end $$;

-- 5. Housekeeping still works: the note purge and account deletion only clear values.
select pg_temp.assert_true(public.purge_expired_rag_answer_feedback_notes(30) = 1,
  'the purge clears exactly the one expired note');
select pg_temp.assert_true(
  (select note is null and feedback_category = 'wrong_source' from public.rag_answer_feedback
   where id = '5a000000-0000-4000-8000-000000000003'),
  'the purge clears the note and keeps the report');
select pg_temp.assert_true(
  (select note is not null from public.rag_answer_feedback
   where interaction_id = '5b000000-0000-4000-8000-000000000001'),
  'a superseding note gets its own 30-day clock, so the purge leaves it');
delete from auth.users where id = '51111111-1111-4111-8111-111111111111';
select pg_temp.assert_true(
  (select owner_id is null and feedback_category = 'unsupported_answer' from public.rag_answer_feedback
   where interaction_id = '5b000000-0000-4000-8000-000000000001'),
  'account deletion clears the owner and keeps the report');
rollback;
