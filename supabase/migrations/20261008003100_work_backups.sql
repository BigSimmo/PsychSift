-- Never edit an applied migration. Merging this applies it to the live database.
-- Work records backed up to the account (owner decision 8 Oct 2026, "Backend decisions for Josh",
-- question 4, chosen on the decision card): Teaching's term tracker and exam prep, and CPD's job
-- applications season (dates, referees, personal statement and the CV lines the doctor hid), until
-- now kept on one device only. One row per doctor and record, holding it exactly as the page keeps
-- it (src/lib/teaching/term-tracker.ts, src/lib/cme/applications.ts). Written only by
-- /api/work/sync with the service role after the record is validated; the newest save wins. A null
-- record means the doctor cleared it, kept so their other devices clear it too.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create table public.work_backups (
  owner_id uuid not null references auth.users (id) on delete cascade,
  section text not null,
  record jsonb,
  updated_at timestamptz not null default now(),
  primary key (owner_id, section),
  constraint work_backups_section_check check (section in ('term_tracker', 'exam_prep', 'job_applications')),
  constraint work_backups_record_object check (record is null or jsonb_typeof(record) = 'object'),
  constraint work_backups_record_size check (record is null or octet_length(record::text) <= 131072)
);

alter table public.work_backups enable row level security;
revoke all on table public.work_backups from public, anon, authenticated;
grant select, insert, update, delete on table public.work_backups to service_role;
