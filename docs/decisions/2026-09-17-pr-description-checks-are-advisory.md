# Decision: Pull request description checks warn instead of blocking

- **Status:** decided 2026-09-17
- **Source:** `docs/process-hardening.md`, find "All of that is advisory as of 2026-09-17 (owner decision)."

Checks on what a pull request description says, including the Clinical Governance Preflight checklist and the "RAG impact:" line, now warn instead of blocking a merge. The real safeguards remain the code-level checks, the tests and the live eval canary.

If this summary and the source ever differ, the source wins.
