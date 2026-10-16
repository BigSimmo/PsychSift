# Decision: Original-section delivery degrades to a normal answer and only it bypasses the caches

- **Status:** decided 2026-10-16
- **Source:** `src/lib/rag/rag-source-block.ts`, find "A mixed selection (a row that never claimed V2"

A broad question whose evidence mixes sources gets a normal cited answer instead of an error, and only an unscoped broad summary skips the saved-answer and search caches. Integrity failures inside a single published document still fail closed.

If this summary and the source ever differ, the source wins.
