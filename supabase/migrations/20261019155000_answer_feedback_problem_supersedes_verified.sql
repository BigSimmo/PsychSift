-- DRAFT. Merge only inside the owner's approved database-change window.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Finding F-02: answer feedback is one row per interaction (interaction_id is unique), so one
-- tap on "supported" (recorded as 'verified') used to block a later "Report a problem" on the
-- same answer with a 409. A problem report is a safety signal and must be able to replace that
-- earlier 'verified' row; the reverse must never happen.
--
-- 1. service_role gains UPDATE on only the columns a problem report carries. The identity
--    columns (interaction_id, owner_id, answer_hash, record_type, record_id) stay
--    insert-only. The API does one conditional UPDATE ... WHERE feedback_category =
--    'verified', so a concurrent second report finds no row and gets the usual 409.
-- 2. A before-update trigger makes the database itself refuse every other kind of change:
--    - a problem report can never change category (it is never downgraded to 'verified'
--      or swapped for a different problem);
--    - an in-place update may only clear the note (the 30-day note purge) or clear the
--      owner (the auth.users "on delete set null" when an account is removed);
--    - superseding a 'verified' row gets a fresh id and created_at, so it reaches the
--      admin review queue (which reads by created_at) as a new, untriaged signal, any
--      triage on the old 'verified' row does not carry over, and the new note's 30-day
--      retention clock starts when the note was written.
-- RLS, the service-role-only policy and the anon/authenticated revokes are unchanged.
set search_path = public, pg_catalog, pg_temp;

grant update (feedback_category, note, cited_source_ids, source_ids, route, model, provider_request_ids)
  on table public.rag_answer_feedback to service_role;

create or replace function public.guard_rag_answer_feedback_update()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_report_columns constant text[] := array[
    'id', 'created_at', 'feedback_category', 'note', 'cited_source_ids', 'source_ids',
    'route', 'model', 'provider_request_ids'
  ];
begin
  -- Housekeeping in place: the note purge and account deletion only ever clear a value.
  if new.feedback_category = old.feedback_category
     and (to_jsonb(new) - 'note' - 'owner_id') = (to_jsonb(old) - 'note' - 'owner_id')
     and (new.note is null or new.note is not distinct from old.note)
     and (new.owner_id is null or new.owner_id is not distinct from old.owner_id) then
    return new;
  end if;

  -- A problem report replaces an earlier 'verified' answer verdict for the same interaction.
  if old.feedback_category = 'verified'
     and new.feedback_category <> 'verified'
     and old.record_type = 'answer'
     and (to_jsonb(new) - v_report_columns) = (to_jsonb(old) - v_report_columns) then
    new.id := gen_random_uuid();
    new.created_at := now();
    return new;
  end if;

  raise exception 'rag_answer_feedback_update_not_allowed' using errcode = '42501';
end;
$$;

revoke all on function public.guard_rag_answer_feedback_update() from public, anon, authenticated;
grant execute on function public.guard_rag_answer_feedback_update() to service_role;

drop trigger if exists rag_answer_feedback_update_guard on public.rag_answer_feedback;
create trigger rag_answer_feedback_update_guard
  before update on public.rag_answer_feedback
  for each row execute function public.guard_rag_answer_feedback_update();

comment on function public.guard_rag_answer_feedback_update() is
  'Answer feedback rows are immutable except: a problem report may replace a verified row for the
   same interaction (new id and created_at), the note purge may clear a note, and account
   deletion may clear owner_id. A problem report is never downgraded or replaced.';
