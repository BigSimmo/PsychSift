-- DRAFT. Merge only inside the owner's approved database-change window.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Follow-up to 20261019155000 (F-02). When a problem report supersedes a 'verified' answer
-- verdict, the guard gives the row a fresh id, so the report reaches the review queue as a new,
-- untriaged signal. Any open triage workflow keyed by the old id was left pointing at a row that
-- no longer exists, and the quality queue showed it as an extra high-priority
-- 'source_signal_unavailable' item that a reviewer had to dismiss by hand.
--
-- This AFTER UPDATE trigger fires only when the id changed, which the guard allows only on that
-- supersede path, and removes the old id's open (non-terminal) current-state triage rows in the
-- same transaction. The append-only clinical_quality_feedback_triage_events history is kept, and
-- terminal (resolved or dismissed) rows are left as they are, since the queue never shows them.
-- The new report's triage is not carried over: it starts untriaged by design.
--
-- service_role can only read the triage table (its writes go through the security definer
-- record_clinical_quality_feedback_triage), so this function is security definer with an empty
-- search_path and fully qualified names.
set search_path = public, pg_catalog, pg_temp;

create or replace function public.retire_superseded_feedback_triage()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.clinical_quality_feedback_triage t
  where t.signal_id = old.id
    and t.signal_type in ('answer_feedback', 'unsupported_claim', 'source_conflict')
    and t.status not in ('resolved', 'dismissed');
  return null;
end;
$$;

revoke all on function public.retire_superseded_feedback_triage() from public, anon, authenticated;
grant execute on function public.retire_superseded_feedback_triage() to service_role;

drop trigger if exists rag_answer_feedback_retire_superseded_triage on public.rag_answer_feedback;
create trigger rag_answer_feedback_retire_superseded_triage
  after update on public.rag_answer_feedback
  for each row
  when (old.id is distinct from new.id)
  execute function public.retire_superseded_feedback_triage();

comment on function public.retire_superseded_feedback_triage() is
  'When a problem report supersedes a verified answer verdict (new id), removes the old id''s open
   current-state triage rows. Triage event history and terminal rows are kept.';
