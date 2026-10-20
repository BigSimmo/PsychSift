# M2 Atomic Reindex Migration Note

> **Status (2026-10-20): implemented; kept as history.** Atomic generation commit shipped in
> `20260628000000_atomic_reindex_generation_commit.sql` (`commit_document_index_generation`). Read the
> [current ingestion model](../ingestion-state-machine.md#current-model-october-2026) and the
> [reindex runbook](../reindex-runbook.md); the library re-index itself is stopped by owner decision.

## Goal

Make reindex completion atomic so search, evaluation, telemetry, and document views never observe a partially replaced index generation.

This branch is intentionally docs-only before implementation. Code changes should start only after this note is reviewed.

## Current Risk

The existing reindex path can delete or replace index artifacts before the replacement generation is fully available. A failure between removal and completion can leave a document with missing chunks, stale retrieval metadata, or inconsistent `index_generation_id` references.

## API And Config Touchpoints

- `src/app/api/documents/[id]/reindex/route.ts`: single-document reindex entrypoint and response contract.
- `src/app/api/documents/bulk/reindex/route.ts`: bulk reindex request shape and partial-failure reporting.
- `src/lib/reindex-pipeline.ts`: orchestration boundary for extraction, chunking, embeddings, artifact writes, and final status.
- `src/lib/ingestion.ts` and `worker/main.ts`: shared indexing behavior that must preserve compatibility with upload and background ingestion.
- `supabase/functions/indexing-v3-agent/index.ts` and `supabase/functions/indexing-v3-agent/behavior.ts`: remote worker behavior and retry/claim semantics.
- Supabase tables: `documents`, `document_chunks`, `document_index_units`, `document_memory_cards`, `document_table_facts`, `document_embedding_fields`, and related visual/image tables.
- Supabase RPCs/functions: `match_document_chunks`, `match_document_chunks_hybrid`, `match_document_chunks_text`, `match_documents_for_query`, `claim_indexing_v3_agent_jobs`, and indexing completion/failure RPCs.
- Config/env: Supabase project ref `sjrfecxgysukkwxsowpy`, storage buckets, `OPENAI_API_KEY`, worker retry settings, and local no-auth owner defaults used by eval scripts.

## Compatibility Assumptions

- Existing public API payloads remain backwards compatible: reindex routes may add fields, but must not remove current fields or change success/failure status semantics.
- Existing search and eval flows continue to accept documents without a new generation until the atomic cutover completes.
- Retrieval RPCs must ignore staged, incomplete generations by default.
- Existing telemetry keys remain valid. New generation metadata can be additive.
- Rollback must preserve the last completed generation until the new generation is fully committed.

## Proposed Migration Shape

1. Add a durable generation record or equivalent metadata state for `pending`, `committing`, `completed`, and `failed`.
2. Write all replacement artifacts with a new generation id while leaving the previous completed generation readable.
3. Switch the document's active generation in one database transaction or RPC after all required artifacts validate.
4. Delete or mark stale artifacts only after the active-generation switch succeeds.
5. Update retrieval RPC filters so default reads use only the active completed generation.
6. Add repair/recovery logic for stuck `pending` or `committing` generations.

## Required Tests

- Unit tests for generation-state transitions and rollback behavior.
- Route tests for single and bulk reindex response compatibility.
- Worker tests for retry after extraction, embedding, and DB-write failures.
- Retrieval tests proving staged generations are invisible until commit.
- Eval/search smoke tests proving existing telemetry and source links remain compatible.

## Acceptance Criteria

- A failed reindex leaves the previous searchable generation intact.
- A successful reindex switches all retrieval surfaces to one completed generation.
- No search result mixes chunks from old and new generations for the same document.
- Recovery tooling can identify and clean abandoned staged generations.
- `npm run verify:cheap` passes, plus the smallest relevant retrieval/indexing checks.
