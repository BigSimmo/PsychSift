-- Merge only after the owner's explicit yes to this database change, by the owner pressing Merge.
-- Never edit this file once it is on main: merging it applies it to the live database.
--
-- Privacy audit DB-05, 26 Oct 2026 (stream S8). When an account was deleted, the database kept the
-- person's typed questions, the answers, the search logs and their answer feedback (which has a
-- free-text note), and only cleared the link to the account. A typed question can hold patient
-- details, so these rows now go with the account instead. The normal retention clean-up is
-- unchanged for everyone else.
--
-- What changes: the owner_id foreign key on four tables moves from ON DELETE SET NULL to
-- ON DELETE CASCADE. Rows already unlinked by an earlier account deletion (owner_id null) are not
-- touched here; the retention clean-up removes those on its usual schedule.
--
-- What stays: audit_logs keep the earlier rule (the row stays, the owner is cleared), because
-- they are the security record. Clinical-quality triage rows hold no question text and stay.
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
alter table public.rag_answer_feedback drop constraint rag_answer_feedback_owner_id_fkey,
  add constraint rag_answer_feedback_owner_id_fkey foreign key (owner_id)
    references auth.users(id) on delete cascade not valid;

-- NOT VALID on purpose. Every existing row already satisfied the old key on the same column, so a
-- validation scan could find nothing to reject, and these log tables can be large enough for a scan
-- to hit this migration's 30 second limit. A NOT VALID key still applies ON DELETE CASCADE and still
-- checks every new or changed row; it only skips re-reading the rows that are already there.
