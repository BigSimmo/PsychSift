# U01 correction brief 1: close independent-review gaps

## Position and ownership

Unit: `U01` correction loop 1

Original task base: `d38dce7ba7fada4ab1fb4588799f400916118c81`

Reviewed product candidate: `9a3b3dc4deee971bb287c979e786c6890922aa05`

Current checkpoint base: `d187915b73c98aefd146749f41b354c4d8e4ee8e`

Worktree: `C:\Users\joshs\.codex\worktrees\rag-local-build-20260822\Database`

Branch: `codex/rag-local-build-20260822`

The original U01 implementer owns this serial correction pass. Preserve every unrelated staged, unstaged, and untracked path. Do not begin U02.

## Read first

- `U01-brief.md`
- `U01-report.md`
- `U01-review.diff` only as needed for original context
- This correction brief in full

## Binding constraints

- All original U01 global constraints remain binding.
- No document/corpus processing, provider or hosted access, migration apply, deploy, reindex, push, or PR.
- Use strict RED-GREEN-REFACTOR: add focused tests for all three findings, run them and observe the expected failures before changing production code.
- Do not broaden into U02, C07 hosted cron inspection, drift-manifest reconciliation, or historical documentation cleanup.
- Modify only `tests/indexing-v3-agent.test.ts`, `tests/worker-run-loop.test.ts`, `supabase/functions/indexing-v3-agent/index.ts`, and `supabase/functions/indexing-v3-agent/behavior.ts` unless a concrete correctness need requires stopping and reporting scope expansion.

## Verified findings to correct

### 1. Positive-legacy generated-label conflicts retain stale generation authority

At `index.ts` around the generated-label `ON CONFLICT`, existing object metadata is merged with `excluded.metadata`. For a positively classified legacy document, `excluded.metadata` correctly omits `index_generation_id`, but omission does not delete an existing stale or malformed key. The strict gate then rejects the label and repair may not converge.

RED must prove the conflict SQL replaces generation authority rather than preserving it: stale active or malformed existing `index_generation_id` is removed for a positive-legacy conflict, while an active conflict receives the exact active generation. Implement the smallest SQL correction; do not add another migration or change label identity.

### 2. Generation read/write contract tests are too broad to detect predicate removal

The current tests merely find the first `generationPredicate` or any `indexGenerationId` within broad function segments. They can pass after deleting an individual SQL `WHERE` generation predicate or insert/update generation value.

Replace these assertions with statement-specific proof for every U01 reader and writer named in the original brief. Each read assertion must bind the actual SQL statement's generation predicate inside its `WHERE` before that statement's own `ORDER BY`, `LIMIT`, count, or completion decision. Each write assertion must bind the exact typed `index_generation_id` or metadata generation assignment in the relevant insert/upsert, including active and positive-legacy label-conflict behavior. Prefer tight source-contract helpers in the test over production refactoring; do not extract a broad query-builder architecture.

The RED must fail when evaluated against the current candidate for the missing label-conflict sanitisation and for materially stronger per-statement expectations that the current broad tests do not establish. Record the exact failing assertions.

### 3. Error serialisation can escape sibling isolation

`behavior.ts:errorMessage()` calls `JSON.stringify(error)` without guarding serialization. A cyclic object or `bigint` rejection can therefore throw while handling the processing error, escaping the per-job catch and aborting later siblings.

RED must use an unserialisable processing rejection and a failure recorder that also throws, then prove the next sibling still runs and outcomes remain representable. Implement a deterministic, non-throwing error conversion with a safe fallback. Preserve the existing per-job and nested failure-recorder isolation.

## Focused verification

During RED/GREEN, run:

```text
node scripts/run-vitest.mjs run tests/indexing-v3-agent.test.ts tests/worker-run-loop.test.ts
```

After GREEN, run the original U01 focused gate once:

```text
node scripts/run-vitest.mjs run tests/ingestion-edge-function-auth.test.ts tests/indexing-v3-agent.test.ts tests/worker-run-loop.test.ts tests/worker-row-contract.test.ts tests/supabase-schema.test.ts
npm run check:edge:functions
npm run check:migration-role
npm run check:function-grants
```

Run targeted formatting and `git diff --check`. Do not add broad verification without a named changed failure path; consult the arbiter before any expensive additional gate.

## Commit and report

Stage explicit correction paths plus this brief only. Create one local commit:

```text
fix(ingestion): close U01 review gaps
```

Write the detailed report after the commit to:

`docs/superpowers/rag-upgrade/execution-artifacts/rag-answer-quality-and-repository-coverage-v1/continuation-rag-source-ingestion-v1/U01/U01-fix-1-report.md`

Include exact RED/GREEN outputs, changed files, self-review, scope attestation, and any concerns. Never push.
