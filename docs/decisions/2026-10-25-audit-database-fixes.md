# Decision: Audit database fixes, including account erasure and EPA link retention

- **Status:** decided 2026-10-25
- **Source:** the owner, in chat

On 25 Oct 2026 the owner replied "Go ahead with all recommendations" (14:04Z) to the whole-codebase
audit's database recommendations, including a preview database capped at US$5 and closed within 14
days. That approves the fixes in `supabase/migrations/20261025150000_audit_database_fixes.sql`, and
the insert guard in `20261025160000_document_admission_insert_guard.sql` that keeps #2 from
admitting a new record without its administrator:

- deleting an account keeps its audit-log rows and clears only the owner (#0);
- a late retry of an open-shift post never reposts a gap that was claimed or approved (#1);
- deleting an administrator keeps the document admission record and clears the account's ids from
  it (#2);
- an index rollback no longer leaves the abandoned generation's deep-memory details (#5);
- the unused roster_open_post_alerts table is dropped (#6), and the roster alert outbox foreign keys
  are indexed (#7);
- the site-content administrator functions refuse a banned or soft-deleted account (#8);
- EPA feedback links that expired or were cancelled are deleted 30 days later, and completed links
  with the supervisor's feedback are kept (#9).

The migration merges only after the owner's own yes, by the owner pressing Merge.

If this summary and the source ever differ, the source wins.
