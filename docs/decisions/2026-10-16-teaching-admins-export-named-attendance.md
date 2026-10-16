# Decision: Teaching admins may export named attendance

- **Status:** decided 2026-10-16
- **Source:** `tests/teaching-migration-contract.test.ts`, find "lets an organiser or an admin export attendance, and still refuses every other role"

The owner chose to let teaching team admins, as well as organisers, export attendance, including member names, methods and times. The named per-session register stays limited to presenters and organisers. The owner accepted that difference after a review flagged it on PR 3583.

If this summary and the source ever differ, the source wins.
