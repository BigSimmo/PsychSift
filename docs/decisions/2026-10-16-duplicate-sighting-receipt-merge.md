# Decision: A repeat sighting of the same passage with less detail does not block a summary answer

- **Status:** decided 2026-10-16
- **Source:** `src/lib/rag/rag-source-block.ts`, find "Absence of a supplementary read is not contradictory evidence"

When two search methods find the same passage and only one of them carries its section path, the answer keeps the fuller record instead of failing with an error. A genuine conflict between the two sightings still stops the answer. The owner approved this fix inside PR 3546 rather than in a follow-up.

If this summary and the source ever differ, the source wins.
