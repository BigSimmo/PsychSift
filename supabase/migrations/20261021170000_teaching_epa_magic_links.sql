-- Migration: 20261021170000_teaching_epa_magic_links.sql
-- Task: #MAAXAX (owner approved drafting 21 Oct 2026; merge only after the owner's own yes)
-- Teaching Assessments: single-use, expiring EPA feedback links for visiting supervisors who
-- have no account. Replaces the process-memory store that kept the feature switched off in
-- production.
--
-- - Only the SHA-256 of a link's token is stored; the raw token is shown once to the doctor.
-- - A link expires at most 30 days after it is made (the app uses 14), works once, and the doctor
--   may cancel it while it waits.
-- - What a supervisor sends is feedback for the doctor to copy into CLA, not an assessment record,
--   so it stays on this row and never touches registrar_assessments.
-- - Service-role only, with RLS enabled and FORCED, like the rest of the teaching schema.

set local lock_timeout = '5s';
set local statement_timeout = '30s';

create table public.teaching_epa_magic_links (
  id uuid primary key default gen_random_uuid(),
  registrar_id uuid not null references auth.users(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  epa_number smallint not null check (epa_number between 1 and 4),
  trainee_name text not null check (char_length(trainee_name) between 1 and 200),
  supervisor_name text not null check (char_length(supervisor_name) between 1 and 200),
  supervisor_role text not null check (char_length(supervisor_role) between 1 and 100),
  clinical_setting text check (clinical_setting is null or char_length(clinical_setting) between 1 and 200),
  status text not null default 'pending' check (status in ('pending', 'completed', 'revoked')),
  response jsonb check (response is null or (jsonb_typeof(response) = 'object' and pg_column_size(response) <= 8192)),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  completed_at timestamptz,
  revoked_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint teaching_epa_magic_links_expiry_window
    check (expires_at > created_at and expires_at <= created_at + interval '30 days'),
  constraint teaching_epa_magic_links_completed_shape
    check ((status = 'completed') = (completed_at is not null and response is not null)),
  constraint teaching_epa_magic_links_revoked_shape
    check ((status = 'revoked') = (revoked_at is not null))
);

create index if not exists teaching_epa_magic_links_registrar_idx
  on public.teaching_epa_magic_links (registrar_id, created_at desc);

drop trigger if exists teaching_epa_magic_links_updated_at on public.teaching_epa_magic_links;
create trigger teaching_epa_magic_links_updated_at
  before update on public.teaching_epa_magic_links
  for each row execute function public.set_updated_at();

alter table public.teaching_epa_magic_links enable row level security;
alter table public.teaching_epa_magic_links force row level security;

-- Service role only: the browser Data API stays closed (tests/supabase-schema.test.ts).
revoke all on table public.teaching_epa_magic_links from public, anon, authenticated;
grant select, insert, update, delete on table public.teaching_epa_magic_links to service_role;

create policy "teaching_epa_magic_links_service_role_all"
  on public.teaching_epa_magic_links
  for all to service_role
  using (true)
  with check (true);
