-- Merge only after the owner's explicit yes to this database change, by the owner pressing Merge.
-- Never edit this file once it is on main: merging it applies it to the live database.
--
-- Privacy audit DB-05, 26 Oct 2026 (stream S8). When an account was deleted, the database kept the
-- person's typed questions, the answers, the search logs and the free-text note on their answer
-- feedback, and only cleared the link to the account. A typed question can hold patient details,
-- so that text now goes with the account. The normal retention clean-up is unchanged for everyone
-- else.
--
-- What changes:
--   1. The owner_id foreign key on rag_queries, rag_query_misses and rag_retrieval_logs moves from
--      ON DELETE SET NULL to ON DELETE CASCADE: the questions, answers and search logs are deleted.
--   2. rag_answer_feedback keeps ON DELETE SET NULL, and a new trigger empties the free-text note
--      in the same step that clears the owner. The report itself (its category, the answer hash
--      and the cited sources, no question text) stays as an unnamed safety signal, so a problem
--      report already in the clinical quality queue is not lost when its author leaves.
-- Rows already unlinked by an earlier account deletion (owner_id null) are not touched here; the
-- retention clean-up and the 30-day note purge remove those on their usual schedule.
--
-- What stays: audit_logs keep the earlier rule (the row stays, the owner is cleared), because
-- they are the security record. Clinical-quality triage rows hold no question text and stay. An
-- open triage row whose search miss is deleted shows in the quality queue as a high-priority
-- "source signal unavailable" item for a reviewer to dismiss, which is the queue's existing
-- fail-safe for a signal that no longer exists.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.rag_queries drop constraint rag_queries_owner_id_fkey,
  add constraint rag_queries_owner_id_fkey foreign key (owner_id)
    references auth.users(id) on delete cascade not valid;
alter table public.rag_query_misses drop constraint rag_query_misses_owner_id_fkey,
  add constraint rag_query_misses_owner_id_fkey foreign key (owner_id)
    references auth.users(id) on delete cascade not valid;
alter table public.rag_retrieval_logs drop constraint rag_retrieval_logs_owner_id_fkey,
  add constraint rag_retrieval_logs_owner_id_fkey foreign key (owner_id)
    references auth.users(id) on delete cascade not valid;

-- NOT VALID on purpose. Every existing row already satisfied the old key on the same column, so a
-- validation scan could find nothing to reject, and these log tables can be large enough for a scan
-- to hit this migration's 30 second limit. A NOT VALID key still applies ON DELETE CASCADE and still
-- checks every new or changed row; it only skips re-reading the rows that are already there.

-- The account's feedback note goes when the account does. Fires only on the owner being cleared
-- (the foreign key's own SET NULL), and only ever clears a value, which the existing
-- rag_answer_feedback_update_guard allows.
create function public.rag_answer_feedback_drop_note_with_owner() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  new.note := null;
  return new;
end $$;
alter function public.rag_answer_feedback_drop_note_with_owner() owner to postgres;
revoke all on function public.rag_answer_feedback_drop_note_with_owner() from public, anon, authenticated, service_role;

create trigger rag_answer_feedback_drop_note_with_owner before update of owner_id on public.rag_answer_feedback
  for each row when (old.owner_id is not null and new.owner_id is null)
  execute function public.rag_answer_feedback_drop_note_with_owner();
