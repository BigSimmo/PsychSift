# Edge Ingestion Overhaul — 3-PR Execution Plan

**Status:** Planning only. Revalidated against `main`
`570740c84bc77b1c5d36493fd1011625c354f6d2` on 2026-08-16.

**Current baseline:** `supabase/functions/ingestion-worker/` and
`supabase/functions/indexing-v3-agent/` both remain present. App-layer document
enrichment already uses a source-anchored structured schema through
`generateStructuredTextResult` in `src/lib/document-enrichment.ts`.

**Goal:** Retire the recovered ingestion worker, make the surviving indexing
agent generation-aware and failure-isolated, move automated summaries onto the
current structured-enrichment contract, then add lease fencing and quality
gates.

## Mandatory execution rules

1. Start every implementation PR from a fresh, current `origin/main`. Re-run the
   relevant searches before editing because paths, SQL signatures, and helper
   contracts may have moved after this plan was written.
2. Keep one owner for each hot file, especially
   `supabase/functions/indexing-v3-agent/index.ts`. Parallel work may cover only
   disjoint documentation, tests, or scripts.
3. Run `npm run format` (whole-tree Prettier) and commit the result before
   pushing, and inspect the complete status and diff before committing. Never
   commit test results, traces, screenshots, Lighthouse output, logs, caches,
   scratch files, or unrelated corpus assets.
4. Treat changes to selected chunks, summaries, labels, sections, or embeddings
   as retrieval-behaviour changes even when ranking code is untouched. State the
   RAG impact explicitly and run the smallest offline regression gate that can
   detect the changed failure path.
5. Do not run live Supabase reads or writes, migrations, edge deployments,
   provider-backed evaluations, backfills, or paid OpenAI calls without
   separate explicit approval.
6. Use current source symbols rather than historical line numbers. Current
   schema and migration signatures are authoritative. Mirror SQL changes into
   `supabase/schema.sql` and generated database types or manifests only when the
   repository contract requires them.
7. After a PR opens, observe exact-head required CI and actionable review
   threads only while the active authorised run continues. Do not claim
   background monitoring and do not post periodic PR comments.
8. Complete the current PR template, including concrete verification,
   risk/rollback, the Clinical Governance Preflight when applicable, and the
   exact RAG-impact statement.
9. End each implementation PR with a clean diff and one immutable review-ledger
   record created through `npm run ledger:append`. Never edit the historical
   ledger table directly.

---

## PR 1 — Retire `ingestion-worker` and correct generation handling

**Branch:** `codex/edge-ingestion-retire-p1`

**Class:** Runtime removal plus enrichment-correctness change.

### Scope

1. Delete `supabase/functions/ingestion-worker/`.
2. Remove the corresponding function block from `supabase/config.toml`.
3. Add an idempotent migration that drops
   `public.invoke_ingestion_worker(integer)`. Document that any dashboard
   `pg_cron` schedule calling it must be removed before or with the migration.
4. Mirror removal of the function, grants, and
   `app.ingestion_worker_base_url` configuration from `supabase/schema.sql`.
   Update generated schema artefacts only through their repository generators.
5. In the surviving indexing agent, restrict summary, label, and section
   source-chunk reads to:
   - legacy visible rows where `index_generation_id is null`, or
   - rows matching the document's committed generation.
     Keep the predicate consistent across every enrichment read and add a focused
     regression test for stale-generation exclusion plus legacy visibility.
6. Isolate per-job failure recording. A failure inside the status/RPC update
   must not abort processing of the remaining claimed jobs.
7. Sweep documentation and tests for `ingestion-worker`,
   `invoke_ingestion_worker`, and the retired base-URL setting. Update only
   current operational references. Preserve historical audit records unless
   repository policy explicitly requires a superseding note.
8. Add a schema-contract assertion that the retired function cannot be
   reintroduced accidentally.

### Verification

- `npm run check:edge:functions`
- `npm run check:indexing`
- focused schema and indexing-agent contract tests
- `npm run check:migration-role`
- `npm run verify:pr-local`
- `npm run check:production-readiness`

**RAG impact:** behaviour change — generation-aware chunk selection can change
derived summaries, labels, and sections while leaving ranking code unchanged.
Require focused offline enrichment/retrieval regression evidence. Any live
canary remains provider-backed and separately approval-gated.

### Operator approvals

- Confirm and remove any live `pg_cron` schedule for
  `invoke_ingestion_worker`.
- Apply the retirement migration.
- Deploy the updated `indexing-v3-agent`.

**Rollback:** Restore the retired edge-function files and configuration, revert
the agent change, and redeploy the previous version. Recreating the SQL wrapper
must occur only after its cron and secret dependencies are deliberately
restored.

---

## PR 2 — Structured, source-anchored summaries in `indexing-v3-agent`

**Branch:** `codex/edge-ingestion-ai-summary`

**Class:** Retrieval-input behaviour change.

### Scope

1. Make the edge summary contract match the current app-layer structured
   enrichment contract in `src/lib/document-enrichment.ts`, including:
   - a non-empty summary
   - source-anchored clinical profile items
   - labels with validated type and confidence
   - bounded arrays and text lengths
2. Prefer a transport-neutral shared schema and normaliser. Where the Node and
   Deno runtime boundary prevents safe sharing, keep an explicit parity test
   that fails when either contract changes.
3. Port the current coverage-aware prompt selection strategy. Do not use
   first-N-only chunk selection.
4. Use the repository's current OpenAI structured-generation semantics rather
   than hard-coding a legacy endpoint. Resolve the indexing model through the
   current configuration contract, preserve timeout/retry handling, and verify
   model availability before any approved live use.
5. Generate and validate the complete payload before writing. Upsert only after
   validation. Never delete a valid summary before replacement generation has
   succeeded.
6. Regenerate when the stored summary is missing, heuristic, from an older
   summary version, or tied to a superseded committed generation. Skip only a
   current, valid, source-anchored summary.
7. Mark successful and fallback rows unambiguously. At minimum record:
   `generated_by`, `summary_kind`, `summary_version`,
   `index_generation_id`, model, and generation time. A heuristic fallback must
   never claim LLM success.
8. Keep embedding dimensions and model selection aligned with the current
   schema and `EMBEDDING_DIMENSIONS` contract.
9. Add contract tests for schema parity, parsing, source-anchor validation,
   generation/version skip rules, fallback markers, and stage-then-swap
   behaviour.
10. Extend the existing backfill path with a dry-run filter for legacy
    heuristic rows. Do not run it without explicit approval and a reviewed cost
    estimate.

### Verification

- `npm run check:edge:functions`
- `npm run check:indexing`
- focused edge-summary and document-enrichment tests
- `npm run eval:rag:offline` or the current offline selector invoked by
  `verify:pr-local`
- `npm run verify:pr-local`
- `npm run check:production-readiness`

**RAG impact:** behaviour change — summary text, labels, and summary embeddings
feed retrieval. Record a pinned offline baseline and post-change result. A live
retrieval-quality or answer canary requires separate approval and must compare
the exact deployed commit.

### Operator approvals

- Deploy the updated edge function.
- Run any provider-backed canary.
- Run the legacy-summary backfill.

**Rollback:** Redeploy the previous agent. Because replacement writes are
validated upserts, previously valid rows remain recoverable. A canary regression
requires reverting the responsible commit before broader rollout.

---

## PR 3 — Lease fencing, repair paths, and quality gates

**Branch:** `codex/edge-ingestion-hardening`

**Class:** Cross-cutting reliability and governance hardening.

### Scope

1. Add worker-identity fencing to indexing job status updates and lease
   heartbeats. A stale worker must not refresh or complete a job owned by a
   newer worker.
2. Add a bounded, explicit repair path for documents requiring enrichment
   artefacts. It must be dry-run capable, auditable, and unable to reopen
   arbitrary completed work without a repair marker.
3. Reconcile `supabase/schema.sql`, migrations, generated types, and the
   repository's observed-live drift contract. Do not infer live state from this
   plan. Confirm it only through a separately approved read.
4. Extend offline indexing checks to report:
   - missing summaries
   - heuristic or outdated summary markers
   - invalid source anchors
   - generation mismatches
   - unexpected truncation/fallback growth
5. Fail closed on newly introduced invalid rows after the structured-summary
   rollout, while reporting a separately tracked legacy remainder.
6. Update the ingestion state-machine and deployment/runbook documentation with
   the final ownership, retry, lease, repair, and rollback semantics.

### Verification

- `npm run check:migration-role`
- `npm run check:edge:functions`
- `npm run check:indexing`
- focused status-RPC, lease-fencing, repair-path, and schema tests
- `npm run verify:cheap`
- `npm run check:production-readiness`

**RAG impact:** no ranking-code change, but repair and quality enforcement can
change which enrichment artefacts are accepted. Treat any regenerated summary
or embedding as retrieval-affecting and apply the PR 2 evidence requirements.

### Operator approvals

- Apply migrations.
- Deploy an agent whose status-RPC signature changed.
- Perform any live repair or reconciliation run.

**Rollback:** Revert the deployment first. Migrations must be designed to remain
safe if the new worker is rolled back, or include an explicit, reviewed
down-migration/compatibility path.

---

## Programme definition of done

1. `ingestion-worker` is absent from active code, configuration, schema,
   current runbooks, live functions, and live schedules.
2. The surviving agent reads only visible/committed-generation content and
   continues processing other jobs when one failure-recording path breaks.
3. New summaries are structured, source-anchored, versioned,
   generation-aware, and explicitly identify fallback generation.
4. Offline retrieval/enrichment evidence is green, and any approved live
   canary is pinned to the deployed commit.
5. Lease fencing prevents stale workers from completing newer claims.
6. Repair actions are explicit, dry-run capable, auditable, and bounded.
7. Schema, migrations, generated artefacts, current documentation, and approved
   live state agree.

## Residual risks to resolve during implementation

- Whether a live `invoke_ingestion_worker` cron still exists.
- Whether live summary and embedding rows match the repository's current
  dimension and generation contracts.
- Whether the Deno edge runtime can share the structured schema directly with
  the Node app without introducing an unsupported dependency boundary.
- Provider model availability, latency, token cost, and structured-output
  behaviour.
- The volume of legacy heuristic rows and the cost and duration of backfill.

These are discovery or approval items, not assumptions. Record the evidence in
the implementation PR that resolves each item.
