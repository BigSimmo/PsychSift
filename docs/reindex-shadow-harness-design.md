# Shadow Re-Index + Eval-Gate Harness — Implementation Runbook

Status: **design ready, not yet applied** — the SQL here touches retrieval and MUST be
validated against the live `PsychSift Production` before use (see "Mandatory validation").
The offline decision core (`src/lib/reindex-eval-gate.ts` — `decideReindexGate`) is built and
unit-tested; this doc specifies the remaining live pieces so they are turnkey when the billed
OpenAI key + Supabase service secrets are available.

**Until this harness is applied, the eval gate is advisory and by hand** (audit 2026-10-20 ING-A-04).
Nothing calls `decideReindexGate`: the worker refuses only a zero-chunk, zero-image generation, so a
worse re-extraction can replace a good live one unchecked. Before approving any library reload, run a
baseline eval canary first, then after the reload run `npm run reindex:health` and a second canary,
and compare the two. Revert on any recall drop or per-case regression.

## Goal

Build the new (better-chunked, re-enriched) index for a document into a **staged** generation
alongside the live committed one, run the golden retrieval + RAG quality evals **against the
staged generation**, and atomically cut over per batch **only if** `decideReindexGate` returns
`GO` (staged ≥ baseline on every metric and all absolute release bars met). Live answers are
never exposed to an unproven generation.

The atomic-generation machinery already exists: `index_generation_id` on every artifact,
`commit_document_index_generation` (migration `20260628000000`), the two filter functions
`is_committed_document_generation` / `is_committed_artifact_generation`, and
`cleanup_abandoned_document_index_generations` (`20260629000000`). The only missing capability
is **letting retrieval read a staged (uncommitted) generation for an eval session**.

## Rejected approaches

- **Supabase preview branch.** Branches are created from migrations and do **not** carry
  production table data or Storage objects, so a re-index of the existing ~2,065-doc corpus
  has nothing to run against on a branch. Not viable for evaluating a re-index of live content.
- **Add a `p_index_generation_id` param to the four hybrid RPCs**
  (`match_document_chunks_hybrid`, `match_document_memory_cards_hybrid`,
  `match_document_index_units_hybrid`, `match_document_embedding_fields_hybrid`). Rejected:
  these are the delicate hot-path query bodies whose last edit caused the 130s
  seqscan regression (see `hybrid-rpc-drift-bug` memory). Editing all four multiplies the risk.

## Recommended design: GUC override on the two filter functions

Retrieval's generation filter funnels through exactly two small `language sql stable`
functions. Override those — gated by a session-local custom GUC that is **unset in
production** — so the hot-path query bodies are never touched.

```sql
-- Both functions currently (20260628000000): language sql stable, reading only jsonb.
-- Adding current_setting(..., true) keeps them STABLE (no volatility change) and, when the
-- GUC is unset (production), returns byte-identical results to today.
create or replace function public.is_committed_document_generation(row_generation uuid, document_metadata jsonb)
returns boolean language sql stable set search_path = public, extensions, pg_temp as $$
  select case
    when nullif(current_setting('rag.eval_generation_id', true), '') is not null then
      -- eval session: read ONLY the staged generation under evaluation
      row_generation::text = nullif(current_setting('rag.eval_generation_id', true), '')
    else
      row_generation is null
        or row_generation::text = nullif(coalesce(document_metadata, '{}'::jsonb)->>'index_generation_id', '')
  end;
$$;

create or replace function public.is_committed_artifact_generation(artifact_metadata jsonb, document_metadata jsonb)
returns boolean language sql stable set search_path = public, extensions, pg_temp as $$
  select case
    when nullif(current_setting('rag.eval_generation_id', true), '') is not null then
      nullif(coalesce(artifact_metadata, '{}'::jsonb)->>'index_generation_id', '') = current_setting('rag.eval_generation_id', true)
    else
      nullif(coalesce(artifact_metadata, '{}'::jsonb)->>'index_generation_id', '') is null
        or nullif(coalesce(artifact_metadata, '{}'::jsonb)->>'index_generation_id', '') =
          nullif(coalesce(document_metadata, '{}'::jsonb)->>'index_generation_id', '');
  end;
$$;
```

- Namespaced custom GUCs (`rag.*`) can be set per-session/transaction via `set_config` with no
  prior declaration — the same mechanism as the existing session-local `hnsw.ef_search='100'`.
- Production code never sets `rag.eval_generation_id`, so the `else` branch runs and behavior
  is unchanged. This is the "defaults unchanged until eval-gated" contract at the SQL layer.
- The SQL is embedded here (not shipped as an applyable migration) deliberately, so it cannot
  reach the live DB without the review + validation below.

## Eval-script extension

Add an optional `--generation-id <uuid>` to `scripts/eval-retrieval.ts` and
`scripts/eval-quality.ts`. When present, the eval opens a DB session and issues
`select set_config('rag.eval_generation_id', $1, false)` before the retrieval RPC calls (and
clears it after), so every retrieval in that eval run reads the staged generation. The eval
summaries returned are the exact shapes `decideReindexGate` already consumes.

## Driver: `scripts/reindex-shadow.ts`

1. Preflight: `check:supabase-project`, `supabase:recovery-status`, `reindex:health` (abort if
   `supabase_unavailable` or queue in recovery — per `docs/reindex-runbook.md`).
2. Capture the **baseline** eval summaries against the live committed index (no GUC).
3. For each batch of documents:
   a. Re-index into a new staged `index_generation_id` **without** committing (new chunker via
   `CHUNK_STRATEGY=document`, re-enrichment, one stamped `rag_indexing_version`).
   b. Run `eval:retrieval:quality` and `eval:quality` with `--generation-id <staged>`.
   c. `decideReindexGate({ baseline*, candidate* })`.
   d. **GO** → `commit_document_index_generation` per document in the batch (atomic swap).
   **NO_GO** → leave live intact, record the failing metrics, and
   `reindex:cleanup-staged` the abandoned staged rows.
4. Emit a per-generation reindex report (baseline vs candidate table + per-doc outcomes).

Wave 3 (targeted) runs the same driver over only OCR-poor / `extraction_quality=poor` docs;
Wave 4 pilot runs it over ~25–50 docs incl. the golden set as the GO/NO-GO gate for going
corpus-wide.

## Mandatory validation before the filter-function change is used (drift-bug guard)

The two filter functions are on the retrieval hot path. Before relying on the override:

- Apply to the live DB, then run `npm run profile:retrieval` (or `explain_retrieval_rpc`) and
  confirm the four hybrid RPCs still use the HNSW index scan — **no seqscan**, latency
  unchanged. The `case`/`current_setting` addition must not defeat function inlining.
- `npm run eval:retrieval:quality` before vs after (GUC unset) must be identical — proves zero
  production-path change.
- Keep the functions `language sql` (not plpgsql) and `stable`.
- Run `npx supabase db advisors --linked` and update `docs/supabase-migration-reconciliation.md`.
- Only after this passes, use `--generation-id` for staged evals.

## W8 (#11) — extend `search_schema_health()` execution smoke (additive, lower-risk)

`search_schema_health()` is a read-only diagnostic (not hot path), so this is safer to add:

- Assert the four embedding columns are `vector(N)` with `N == EMBEDDING_DIMENSIONS`.
- Assert the `search_tsv` config in use matches the intended text-search config.
- Assert zero `rag_indexing_version` / `rag_enrichment_version` skew across `documents`.
- Assert all four HNSW indexes are present (already partly checked) and no legacy IVFFlat.
- Surface each as a `missing[]` entry so it flows into `check:indexing` + setup-status.

## Rollback

Every step is reversible: a NO_GO batch never commits (cleanup removes staged rows); the
filter-function change reverts by restoring the `20260628000000` definitions; `--generation-id`
is opt-in. The live committed generation is untouched until a batch passes the gate.
