-- Migration: 20261013180000_registrar_assessment_update_unassessed_only.sql
-- Follows 20261013170000 (sealed, not edited). Once an assessor is assigned (service_role path),
-- the registrar can no longer edit the assessment or move it back to draft, so an assessor's
-- ratings always sit on the content they reviewed.

set local lock_timeout = '5s';
set local statement_timeout = '30s';

drop policy if exists "registrar_assessments_registrar_update" on public.registrar_assessments;
create policy "registrar_assessments_registrar_update"
  on public.registrar_assessments
  for update to authenticated
  using (registrar_id = auth.uid() and status in ('draft', 'submitted') and assessor_id is null)
  with check (registrar_id = auth.uid() and status in ('draft', 'submitted') and assessor_id is null);
