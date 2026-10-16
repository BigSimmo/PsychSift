# Decision: An upload stuck on its final attempt is cleared by the existing recovery, not a new database fix

- **Status:** decided 2026-10-16
- **Source:** `docs/ingestion-state-machine.md`, find "The owner decided on 2026-10-16 not to add"

An ingestion job whose last attempt ends with an uncertain outcome stays in processing, because the claim step skips jobs that have used all their attempts. The owner chose not to add a database change for this. The 6-hourly ingestion check flags the job, and the existing queue recovery tool resets it.

If this summary and the source ever differ, the source wins.
