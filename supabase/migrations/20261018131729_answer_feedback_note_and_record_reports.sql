-- Item 16: "report a wrong answer" becomes a real loop.
--
-- 1. An optional short note (at most 500 characters) on each feedback row. The API runs the
--    shared patient-detail check before saving and refuses text that looks identifying; this
--    column is still treated as possibly sensitive, so the note alone is cleared after 90 days
--    (the longest query-telemetry window in docs/privacy-impact-assessment.md section 6) while
--    the content-free category row is kept.
-- 2. Reports on medication and therapy records, not only on answers: record_type says which
--    page the report came from, and record_id holds that record's public slug.
--
-- Access stays exactly as before: RLS on, anon and authenticated revoked, service role only
-- (select, insert, delete; no update grant). The purge function is security definer.
set search_path = public, pg_catalog, pg_temp;

alter table public.rag_answer_feedback
  add column if not exists note text,
  add column if not exists record_type text not null default 'answer',
  add column if not exists record_id text;

alter table public.rag_answer_feedback
  drop constraint if exists rag_answer_feedback_note_length_check;
alter table public.rag_answer_feedback
  add constraint rag_answer_feedback_note_length_check
  check (note is null or char_length(note) between 1 and 500);

alter table public.rag_answer_feedback
  drop constraint if exists rag_answer_feedback_record_type_check;
alter table public.rag_answer_feedback
  add constraint rag_answer_feedback_record_type_check
  check (record_type in ('answer', 'medication', 'therapy'));

alter table public.rag_answer_feedback
  drop constraint if exists rag_answer_feedback_record_id_check;
alter table public.rag_answer_feedback
  add constraint rag_answer_feedback_record_id_check
  check (
    (record_type = 'answer' and record_id is null)
    or (record_type <> 'answer' and record_id ~ '^[a-z0-9][a-z0-9-]{0,119}$')
  );

-- Re-assert the existing fail-closed access model for the widened table.
alter table public.rag_answer_feedback enable row level security;
revoke all on table public.rag_answer_feedback from anon, authenticated;
grant select, insert, delete on table public.rag_answer_feedback to service_role;
drop policy if exists "rag answer feedback service role" on public.rag_answer_feedback;
create policy "rag answer feedback service role"
  on public.rag_answer_feedback for all to service_role using (true) with check (true);

comment on column public.rag_answer_feedback.note is
  'Optional reviewer note, at most 500 characters, checked for patient details before saving.
   Never logged. Cleared (set to null) 90 days after created_at by the pg_cron job
   "purge-rag-answer-feedback-notes" (see purge_expired_rag_answer_feedback_notes).';

create or replace function public.purge_expired_rag_answer_feedback_notes(p_retention_days integer default 90)
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_cleared integer;
begin
  if p_retention_days is null or p_retention_days < 1 then
    raise exception 'retention days must be positive' using errcode = '22023';
  end if;
  update public.rag_answer_feedback
    set note = null
    where note is not null
      and created_at < now() - make_interval(days => p_retention_days);
  get diagnostics v_cleared = row_count;
  return v_cleared;
end;
$$;

revoke all on function public.purge_expired_rag_answer_feedback_notes(integer) from public, anon, authenticated;
grant execute on function public.purge_expired_rag_answer_feedback_notes(integer) to service_role;

-- Register the nightly purge when pg_cron is available. Preview/branch databases may not ship
-- pg_cron; install the function there but skip scheduling.
do $cron$
begin
  if to_regnamespace('cron') is null then
    return;
  end if;

  perform cron.unschedule(j.jobid)
  from cron.job j
  where j.jobname = 'purge-rag-answer-feedback-notes';

  perform cron.schedule(
    'purge-rag-answer-feedback-notes',
    '50 3 * * *',
    $job$select public.purge_expired_rag_answer_feedback_notes(90);$job$
  );
end
$cron$;
