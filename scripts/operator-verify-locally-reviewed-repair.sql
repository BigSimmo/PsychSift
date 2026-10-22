-- ============================================================================
-- Operator check: did the 1,935-document "Locally reviewed" repair land on live?
-- Ledger #46VNY9 and #JYH1FH · migration 20260926170000 (PR #3111, merged 2026-09-27)
-- ============================================================================
--
-- The migration either repaired exactly 1,935 documents or raised and changed nothing, so
-- this tells the two outcomes apart. It reads only: the transaction is set read only and
-- ends in rollback, and nothing here selects document text or owner identity.
--
-- EXECUTION: only with the owner's explicit OK, in the Supabase SQL editor or psql against
-- PsychSift Production (sjrfecxgysukkwxsowpy). Paste the whole file and run it once.
--
-- EXPECTED IF THE REPAIR LANDED:
--   migration_recorded            true
--   repaired_documents            1935
--   repaired_still_honest         1935 (fewer means a later review legitimately changed some)
--   import_stamped_left           0
--   locally_reviewed_total        786 (the registry records the repair left alone by design,
--                                 plus any genuine reviews since 2026-09-27)
--
-- IF repaired_documents IS 0 AND import_stamped_left IS ABOUT 1935, the migration aborted on
-- a count mismatch and the labels are still wrong. Do not hand-apply anything: the fix is a
-- new migration with a fresh owner-approved count.
-- ============================================================================

begin;
set transaction read only;

select
  exists (
    select 1
    from supabase_migrations.schema_migrations
    where version = '20260926170000'
  ) as migration_recorded,

  count(*) filter (
    where d.metadata ? 'validation_status_repair_2026_09'
  ) as repaired_documents,

  count(*) filter (
    where d.metadata ? 'validation_status_repair_2026_09'
      and d.metadata->>'clinical_validation_status' = 'unverified'
      and d.metadata#>>'{clinical_validation_evidence,basis}' = 'wa_document_control_endorsement'
  ) as repaired_still_honest,

  -- The repair's own selector, minus its reviewer and scope exclusions: anything here is a
  -- document still carrying the import's "Locally reviewed" stamp.
  count(*) filter (
    where d.metadata->>'clinical_validation_status' = 'locally_reviewed'
      and coalesce(d.metadata#>>'{clinical_validation_evidence,basis}', '')
          like 'local WA source with document-control % evidence'
      and coalesce(d.metadata->>'source_kind', '') <> 'registry_record'
  ) as import_stamped_left,

  count(*) filter (
    where d.metadata->>'clinical_validation_status' = 'locally_reviewed'
  ) as locally_reviewed_total,

  min((d.metadata#>>'{validation_status_repair_2026_09,repaired_at}')::timestamptz) as first_repaired_at,
  max((d.metadata#>>'{validation_status_repair_2026_09,repaired_at}')::timestamptz) as last_repaired_at
from public.documents d;

rollback;
