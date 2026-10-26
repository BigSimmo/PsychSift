-- Merge only after the owner's explicit yes to this database change.
-- Audit 2026-10-24 follow-ups: answer-cache freshness after label edits, a licence that no longer
-- permits indexing, and a redundant index.
--
-- E2E-11: rag_cache_scope_revision_v1 hashes each document row plus its evidence counter
--   (document_evidence_revisions, 20261018095804), which table-fact and image edits bump. Label
--   edits change only document_labels, so they cleared the cache on the app copy that handled
--   the edit and nowhere else. Label inserts, real updates and deletes now bump the same counter
--   through the existing statement-level trigger function. Touching documents.updated_at instead
--   was rejected because it feeds the 90-day recency boost in retrieval.
--
-- E2E-10: in the default search mode a passage is fetched when its document is indexed and on its
--   current version; licence is checked only when a file is admitted. When a document's
--   licence_policy changes to one that forbids indexing its text (index_forbidden or
--   metadata_link_only), it is now marked outdated in the same update, so the existing answer
--   filter (excludeSupersededEvidence) removes it at once. licence_withdrawn_at records why.
--   Nothing is deleted, and changing the licence back does not restore the old status by itself.
--
-- DB-N4: image_caption_cache_owner_hash_idx (owner_id, image_hash, model) is the leading prefix
--   of the unique key added on 21 Oct (owner_id, image_hash, model, cache_identity), which serves
--   the same lookups. It is dropped.

set local lock_timeout = '5s';
set local statement_timeout = '30s';

create trigger document_labels_evidence_insert after insert on public.document_labels
  referencing new table as new_rows for each statement execute function public.document_evidence_rows_changed();
create trigger document_labels_evidence_update after update on public.document_labels
  referencing old table as old_rows new table as new_rows for each statement execute function public.document_evidence_rows_changed();
create trigger document_labels_evidence_delete after delete on public.document_labels
  referencing old table as old_rows for each statement execute function public.document_evidence_rows_changed();

create function public.mark_licence_withdrawn_document_outdated()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.metadata->>'licence_policy' in ('index_forbidden', 'metadata_link_only')
     and (old.metadata->>'licence_policy') is distinct from (new.metadata->>'licence_policy')
     and new.metadata->>'document_status' is distinct from 'outdated' then
    new.metadata := new.metadata || jsonb_build_object(
      'document_status', 'outdated',
      'licence_withdrawn_at', pg_catalog.clock_timestamp());
  end if;
  return new;
end;
$$;

alter function public.mark_licence_withdrawn_document_outdated() owner to postgres;
revoke all on function public.mark_licence_withdrawn_document_outdated() from public, anon, authenticated;

create trigger documents_licence_withdrawn_outdated
before update of metadata on public.documents
for each row execute function public.mark_licence_withdrawn_document_outdated();

drop index if exists public.image_caption_cache_owner_hash_idx;
