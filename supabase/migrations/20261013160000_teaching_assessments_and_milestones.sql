-- Migration: 20261013160000_teaching_assessments_and_milestones.sql
-- Tasks: #4KQGXZ, #T983N9
-- Teaching Assessments & CPD Registrar Milestones Schema:
-- - public.registrar_assessments
-- - public.registrar_training_milestones
-- Includes RLS policies and FORCE ROW LEVEL SECURITY.

set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- 1. Create table public.registrar_assessments
create table public.registrar_assessments (
  id uuid primary key default gen_random_uuid(),
  registrar_id uuid not null references auth.users(id) on delete cascade,
  assessor_id uuid references auth.users(id) on delete set null,
  category text not null check (category in ('epa', 'wba', 'ita', 'supervisor_review', 'general')),
  title text not null,
  ratings jsonb not null default '{}'::jsonb,
  feedback text,
  status text not null default 'draft' check (status in ('draft', 'submitted', 'signed_off', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2. Create table public.registrar_training_milestones
create table public.registrar_training_milestones (
  id uuid primary key default gen_random_uuid(),
  registrar_id uuid not null references auth.users(id) on delete cascade,
  milestone_code text not null,
  milestone_title text not null,
  stage text not null check (stage in ('stage_1', 'stage_2', 'stage_3', 'fellowship')),
  achieved_at timestamptz,
  evidence_summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Indexes for performance
create index if not exists registrar_assessments_registrar_idx
  on public.registrar_assessments (registrar_id, created_at desc);

create index if not exists registrar_assessments_assessor_idx
  on public.registrar_assessments (assessor_id)
  where assessor_id is not null;

create index if not exists registrar_training_milestones_registrar_idx
  on public.registrar_training_milestones (registrar_id, stage);

-- Updated_at triggers
drop trigger if exists registrar_assessments_updated_at on public.registrar_assessments;
create trigger registrar_assessments_updated_at
  before update on public.registrar_assessments
  for each row execute function public.set_updated_at();

drop trigger if exists registrar_training_milestones_updated_at on public.registrar_training_milestones;
create trigger registrar_training_milestones_updated_at
  before update on public.registrar_training_milestones
  for each row execute function public.set_updated_at();

-- 3. Enable and FORCE ROW LEVEL SECURITY
alter table public.registrar_assessments enable row level security;
alter table public.registrar_assessments force row level security;

alter table public.registrar_training_milestones enable row level security;
alter table public.registrar_training_milestones force row level security;

-- Table permissions
revoke all on table public.registrar_assessments from anon;
grant select, insert, update, delete on table public.registrar_assessments to service_role;
grant select, insert, update on table public.registrar_assessments to authenticated;

revoke all on table public.registrar_training_milestones from anon;
grant select, insert, update, delete on table public.registrar_training_milestones to service_role;
grant select, insert, update on table public.registrar_training_milestones to authenticated;

-- 4. RLS policies for public.registrar_assessments
create policy "registrar_assessments_service_role_all"
  on public.registrar_assessments
  for all to service_role
  using (true)
  with check (true);

create policy "registrar_assessments_registrar_select"
  on public.registrar_assessments
  for select to authenticated
  using (registrar_id = auth.uid());

create policy "registrar_assessments_registrar_insert"
  on public.registrar_assessments
  for insert to authenticated
  with check (registrar_id = auth.uid());

create policy "registrar_assessments_registrar_update"
  on public.registrar_assessments
  for update to authenticated
  using (registrar_id = auth.uid())
  with check (registrar_id = auth.uid());

-- 5. RLS policies for public.registrar_training_milestones
create policy "registrar_training_milestones_service_role_all"
  on public.registrar_training_milestones
  for all to service_role
  using (true)
  with check (true);

create policy "registrar_training_milestones_registrar_select"
  on public.registrar_training_milestones
  for select to authenticated
  using (registrar_id = auth.uid());

create policy "registrar_training_milestones_registrar_insert"
  on public.registrar_training_milestones
  for insert to authenticated
  with check (registrar_id = auth.uid());

create policy "registrar_training_milestones_registrar_update"
  on public.registrar_training_milestones
  for update to authenticated
  using (registrar_id = auth.uid())
  with check (registrar_id = auth.uid());
