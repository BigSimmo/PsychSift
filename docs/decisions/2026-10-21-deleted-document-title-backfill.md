# Decision: Clear stored titles of deleted documents from the cleanup ledger (irreversible)

- **Status:** decided 2026-10-21
- **Source:** `supabase/migrations/20261021043000_clear_deleted_document_titles_from_cleanup_ledger.sql`, find "This one-off backfill clears it on"

On 21 Oct 2026 the owner approved the #3706 backfill. It sets `document_title` to null on
`storage_cleanup_jobs` rows whose document has been deleted (audit ING-A-05). Rows for live
documents and public-source reservation rows are left alone. Nulling the titles was intended.
It is irreversible: there is no down migration, and the cleared titles cannot be recovered.

The owner typed their own-words yes at 14:06 AWST ("Go ahead with all recommendations. I give you
full permission to complete and carry them out for me", in reply to the #3706 backfill ask, relayed
by Grok Bot). The approval is quoted on #3706, and this entry was recorded at 14:42 AWST at the
owner's request.

If this summary and the source ever differ, the source wins.
