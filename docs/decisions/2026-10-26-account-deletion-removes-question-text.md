# Decision: Deleting an account deletes that person's questions, answers, search logs and feedback notes

- **Status:** decided 2026-10-26
- **Source:** `supabase/migrations/20261026081500_delete_question_logs_with_account.sql`, find "so that text now goes with the account"

On 26 Oct 2026 the owner chose "Delete them with the account" on a decision card in the privacy
database thread (privacy audit DB-05). When an account is deleted, its typed questions, the answers,
its search logs and the free-text notes on its answer feedback are deleted at once, because a typed
question can hold patient details. An answer-feedback report itself (its category, the answer hash
and the cited sources, with no question text) stays without a name, so a problem report already in
the clinical quality queue is not lost. Audit-log rows stay with the owner cleared, as before. The
database change still merges only when the owner presses Merge.

If this summary and the source ever differ, the source wins.
