# Decision: An admitted upload is kept when the client cancels afterwards

- **Status:** decided 2026-10-16
- **Source:** `tests/private-access-routes.test.ts`, find "Admission is atomic and idempotent"

Once an upload's document and ingestion job are committed, a later cancel from the browser no longer deletes them. A cancel before that point still removes the stored file.

If this summary and the source ever differ, the source wins.
