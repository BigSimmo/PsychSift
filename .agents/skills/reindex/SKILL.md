---
name: reindex
description: Plan and verify PsychSift index generations, backfills, promotions, cleanup, health checks, and rollback without touching live data automatically. Use for reindex jobs, generation changes, index migrations, or backfill operations.
---

# Reindex

1. Identify the index generation, affected owners/documents, state transitions, and rollback boundary.
2. Inspect reindex code, migrations, fixtures, health checks, and cleanup behavior offline.
3. Check idempotency, resumability, concurrency, partial promotion, stale generations, and owner isolation.
4. Add or run the smallest deterministic generation-state proof.
5. Enforce ranking-protection and generation-reaping safeguards: reindex/chunking changes touching ranking-protected surfaces (`src/lib/chunking.ts`, `src/lib/reindex-pipeline.ts` generation promotion) must preserve canary pairs, keep the most-recent generation and legacy unstamped documents safe from reaping, enqueue storage-bucket cleanup for abandoned image objects, and obtain explicit owner approval before any live promotion or ranking-surface change.
6. Treat reindex, backfill, cleanup, promotion, health, and Supabase commands as approval-required unless proven purely local.
7. Produce an ordered runbook with preconditions, checkpoints, rollback, reconciliation, and evidence.
