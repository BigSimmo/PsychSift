# Decision: A document whose licence stops permitting indexing leaves answers at once

- **Status:** decided 2026-10-25
- **Source:** `supabase/migrations/20261025171000_label_cache_revision_licence_withdrawal.sql`, find "it is now marked outdated in the same update"

The owner approved every remaining recommendation of the 24 Oct 2026 search and ingestion
re-audit, including audit E2E-10. When a document's licence changes to one that forbids indexing
its text, the database marks the document outdated in the same update, so the existing answer
filter stops using it. Nothing is deleted, and changing the licence back does not restore the old
status by itself. The migration merges only after the owner's own yes to that database change.

If this summary and the source ever differ, the source wins.
