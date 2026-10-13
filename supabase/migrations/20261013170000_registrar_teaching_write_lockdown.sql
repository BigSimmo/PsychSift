-- Migration: 20261013170000_registrar_teaching_write_lockdown.sql
-- Tightens 20261013160000_teaching_assessments_and_milestones (a new migration, so the sealed
-- file is never edited). A registrar may only draft and submit their own work:
-- - an assessment cannot be created or moved to signed_off/archived by the registrar, and the
--   registrar cannot name the assessor or write the assessor's ratings and feedback;
-- - a milestone cannot be created or edited by the registrar with achieved_at or evidence_summary.
-- Sign-off and milestone achievement stay with service_role (the assessor/admin path).

set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Column-level privileges: table-wide INSERT/UPDATE is replaced by the registrar-owned columns.
revoke insert, update on table public.registrar_assessments from authenticated;
grant insert (registrar_id, category, title, status) on table public.registrar_assessments to authenticated;
grant update (category, title, status) on table public.registrar_assessments to authenticated;

revoke insert, update on table public.registrar_training_milestones from authenticated;
grant insert (registrar_id, milestone_code, milestone_title, stage)
  on table public.registrar_training_milestones to authenticated;
grant update (milestone_code, milestone_title, stage)
  on table public.registrar_training_milestones to authenticated;

-- Row policies: only draft/submitted, unassessed rows are registrar-writable.
drop policy if exists "registrar_assessments_registrar_insert" on public.registrar_assessments;
create policy "registrar_assessments_registrar_insert"
  on public.registrar_assessments
  for insert to authenticated
  with check (
    registrar_id = auth.uid()
    and status in ('draft', 'submitted')
    and assessor_id is null
  );

drop policy if exists "registrar_assessments_registrar_update" on public.registrar_assessments;
create policy "registrar_assessments_registrar_update"
  on public.registrar_assessments
  for update to authenticated
  using (registrar_id = auth.uid() and status in ('draft', 'submitted'))
  with check (registrar_id = auth.uid() and status in ('draft', 'submitted'));

drop policy if exists "registrar_training_milestones_registrar_insert" on public.registrar_training_milestones;
create policy "registrar_training_milestones_registrar_insert"
  on public.registrar_training_milestones
  for insert to authenticated
  with check (
    registrar_id = auth.uid()
    and achieved_at is null
    and evidence_summary is null
  );

drop policy if exists "registrar_training_milestones_registrar_update" on public.registrar_training_milestones;
create policy "registrar_training_milestones_registrar_update"
  on public.registrar_training_milestones
  for update to authenticated
  using (registrar_id = auth.uid() and achieved_at is null)
  with check (registrar_id = auth.uid() and achieved_at is null);
