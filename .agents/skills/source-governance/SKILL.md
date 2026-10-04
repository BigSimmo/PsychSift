---
name: source-governance
description: Audit PsychSift source metadata, citations, approvals, labels, provenance, rendering, and release-governance coverage. Use for citation defects, source-governance changes, document labels, public promotion, or clinical evidence traceability.
---

# Source governance

1. Trace source identity from ingestion metadata through retrieval, answer citations, and UI rendering.
2. Check provenance, approval state, labels, dates, ownership, public visibility, and missing-metadata behavior.
3. Use focused local tests and fixture checks before broader governance scripts.
4. Treat scripts that query live Supabase or production-like data as approval-required.
5. Verify conservative behavior when a source is absent, stale, private, rejected, or ambiguous.
6. Report coverage, debt, release impact, rollback, and any live audit that still needs approval.
