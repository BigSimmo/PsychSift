# Decision: An unverified document summary is replaced, not shown

- **Status:** decided 2026-10-25
- **Source:** `src/lib/rag/rag-document-summary-context.ts`, find "Wording approved by the owner on 25 Oct 2026"

When a Summarise result is ungrounded or unsupported, its text is replaced with "This summary could
not be matched to the document's passages, so it is not shown. Read the document directly." The
owner approved this wording, and the panel shows the answer view's caution beside it.

If this summary and the source ever differ, the source wins.
