-- Merge only after the owner's explicit yes to this database change.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Audit 2026-10-20 ING-A-05. delete_document_if_idle copies a deleted document's title into
-- storage_cleanup_jobs.document_title, and nothing cleared it, though the delete route treats
-- titles as possibly identifying. The app now clears the title once the document row is gone
-- (buildStorageCleanupJobUpdate and scripts/cleanup-storage.ts). This one-off backfill clears it on
-- rows written before that change.
--
-- Only rows whose document no longer exists are touched (document_id is nulled by the
-- ON DELETE SET NULL foreign key). A row for a delete that aborted still points at its live
-- document and keeps its title. Data only: no schema, function, grant or policy change.
update public.storage_cleanup_jobs
   set document_title = null
 where document_title is not null
   and document_id is null;
