# Decision: Clear stored titles of deleted documents from the cleanup ledger (irreversible)

- **Status:** decided 2026-10-21
- **Source:** `supabase/migrations/20261021043000_clear_deleted_document_titles_from_cleanup_ledger.sql`, find "This one-off backfill clears it on"

On 21 Oct 2026 the owner approved the #3706 backfill. It sets `document_title` to null on
`storage_cleanup_jobs` rows whose document has been deleted (audit ING-A-05). Rows for live
documents and public-source reservation rows are left alone. Nulling the titles was intended.
It is irreversible: there is no down migration, and the cleared titles cannot be recovered.

The owner's specific approval of this change, typed by the owner at 15:33 AWST on 21 Oct 2026
and posted verbatim on #3714
(https://github.com/BigSimmo/PsychSift/pull/3714#issuecomment-6310630133): "I approve #3706's
backfill nulling deleted titles; I know it's irreversible." The earlier 14:06 AWST blanket reply
("Go ahead with all recommendations…") is not relied on, because a blanket yes does not count
under `docs/decisions/2026-10-15-database-changes-need-owner-permission.md`. The approval was
given after the migration had already reached main, so it ratifies the change after it ran.

If this summary and the source ever differ, the source wins.
