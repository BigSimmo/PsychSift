# Decision: deep-memory-preparation.ts is a protected ranking surface

- **Status:** decided 2026-10-16
- **Source:** `scripts/pr-policy.mjs`, find "deep-memory-preparation.ts is the worker-side copy"

The worker copy of the memory card builder joins the protected retrieval list, so changes to it need the same notice and RAG impact line as deep-memory.ts.

If this summary and the source ever differ, the source wins.
