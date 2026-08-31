# U01 task brief: retire the duplicate processor and enforce committed-generation reads

## Position and ownership

Unit: `U01`

Plan task: Task 1 / Ingestion Task 4 / C01

Task base: `d38dce7ba7fada4ab1fb4588799f400916118c81`

Worktree: `C:\Users\joshs\.codex\worktrees\rag-local-build-20260822\Database`

Branch: `codex/rag-local-build-20260822`

This is the first product behavior unit. One implementer owns all writes. Other agents may inspect or review only. Preserve every unrelated staged, unstaged, and untracked path.

## Read first

- This brief in full.
- `docs/superpowers/plans/2026-08-31-ingestion-first-continuation.md`, only Global constraints and Task 1.
- `.superpowers/sdd/progress.md`.
- Relevant existing source/tests named below; do not read or resume the superseded P08A implementation draft.

## Owned product files

Create:

- `supabase/functions/_shared/ingestion-generation-visibility.ts`
- `supabase/migrations/20260831100000_retire_ingestion_worker.sql`

Delete:

- `supabase/functions/ingestion-worker/index.ts`
- `supabase/functions/ingestion-worker/auth.ts`

Delete or replace only as required by the retired function contract:

- `tests/ingestion-edge-function-auth.test.ts`

Modify:

- `supabase/config.toml`
- `supabase/functions/indexing-v3-agent/index.ts`
- `supabase/functions/indexing-v3-agent/behavior.ts`
- `supabase/functions/indexing-v3-agent/utils.ts`
- `supabase/schema.sql`
- `src/lib/supabase/database.types.ts`
- `tests/indexing-v3-agent.test.ts`
- `tests/worker-run-loop.test.ts`
- `tests/worker-row-contract.test.ts`
- `tests/supabase-schema.test.ts`
- `docs/worker-deploy-runbook.md`

Checkpoint this brief unchanged with the product candidate. Write the post-commit implementation report to:

`docs/superpowers/rag-upgrade/execution-artifacts/rag-answer-quality-and-repository-coverage-v1/continuation-rag-source-ingestion-v1/U01/U01-report.md`

Do not touch any other file unless correctness makes it unavoidable; stop and report the exact need before expanding scope.

## Global constraints

- P00-P07 receipts and accepted artifacts are immutable. C00 is complete and must not be rewritten.
- The superseded P08A draft and migration allocations are not implementation authority.
- Do not process documents/corpora; access providers, hosted Supabase, Storage, scanners, or model assets; apply migrations; deploy; reindex; push; or open a PR.
- Preserve the accepted P04 ingestion classifier, P05 protected-source preflight and recovery vocabulary, P06 site-release authority, and P07 query/cache/ranking behavior.
- The ordinary buffered Answer path must remain unchanged and unable to reach the later continuation retrieval kernel.
- Every SQL function uses a fixed empty or explicit `search_path`, bounded inputs, serialized conflicting writes, and no new `PUBLIC`, `anon`, or `authenticated` authority.
- Unknown admission, policy, generation, lease, lineage, or recovery authority fails closed.
- Use strict RED-GREEN-REFACTOR. No production code before a focused test fails for the expected missing behavior.

## Implementation-time resolved interfaces

- The visibility alias is `index_generation_id`, never `artifact_generation_id`.
- `document_chunks`, `document_sections`, `document_memory_cards`, and `document_index_units` use their typed `index_generation_id` columns. Summaries and generated labels use validated `metadata->>'index_generation_id'`.
- Before Task 4 introduces the generation ledger, build authority per claimed document from a complete read of `documents.index_generation_id` plus its raw metadata. The transitional `committedGenerationIds` set is exactly the validated non-null active generation values from that complete authority input. A document is positively legacy only when the typed value is null and the raw metadata contains no generation value. A malformed raw non-empty value, typed/raw mismatch, incomplete read, or overlap fails closed.
- A TypeScript post-filter is defense in depth, not the ordering guarantee. Every SQL/Supabase reader must constrain the generation in its `WHERE`/query predicates before `ORDER BY`, `LIMIT`, counts, or completion decisions.
- Generation-aware reads include summary/chunk selection, label inputs, section repair, card inputs, section-index-unit inputs, quality/index-unit counts, visual-artifact decisions, and the protected-source chunk scan.
- Generation-aware writes include generated sections, cards, section/visual index units, summaries, and generated labels. Persist the exact active generation in the typed column or validated metadata as appropriate; legacy writes remain null only for positively classified legacy documents.
- Reconcile `public.document_strict_gate_status` in the same forward migration and current schema snapshot so its section/card/label/index-unit counts cannot treat stale rows as current. Otherwise the completion gate could suppress repair before filtered readers run.
- Preserve the protected-source policy sequence before provider or artifact work. Loading/validating document generation authority is local database state preparation and must not move any provider or artifact action ahead of the existing policy verdict.
- Extract the smallest pure Edge batch helper in `indexing-v3-agent/behavior.ts` needed to prove that a processing error followed by a failure-recorder error still allows the next claimed job to run. Do not mistake the already-safe container-worker loop for proof of the Deno Edge loop.

## Step 1: RED ownership and visibility behavior

Add this exact matrix to `tests/indexing-v3-agent.test.ts`:

```ts
it("admits only legacy rows or the exact active committed generation", () => {
  const visibility = {
    activeGenerationByDocument: new Map([["doc-a", "gen-active"]]),
    committedGenerationIds: new Set(["gen-active", "gen-other"]),
    knownLegacyDocumentIds: new Set(["doc-legacy"]),
  };

  expect(isVisibleCommittedGenerationRow({ document_id: "doc-a", generation_id: null }, visibility)).toBe(false);
  expect(isVisibleCommittedGenerationRow({ document_id: "doc-legacy", generation_id: null }, visibility)).toBe(true);
  expect(isVisibleCommittedGenerationRow({ document_id: "doc-unknown", generation_id: null }, visibility)).toBe(false);
  expect(isVisibleCommittedGenerationRow({ document_id: "doc-a", generation_id: "gen-active" }, visibility)).toBe(true);
  expect(isVisibleCommittedGenerationRow({ document_id: "doc-a", generation_id: "gen-other" }, visibility)).toBe(false);
  expect(isVisibleCommittedGenerationRow({ document_id: "doc-missing", generation_id: "gen-active" }, visibility)).toBe(
    false,
  );
});
```

Also add RED assertions proving:

1. stale chunk, section, card, index-unit, summary, and label rows are excluded before `ORDER BY` and `LIMIT`;
2. null-generation compatibility is allowed only for a positively known legacy document with no active mapping;
3. absent, incomplete, malformed, or overlapping legacy/active authority fails before `GenerationVisibility` construction;
4. an active document excludes every null or non-matching generation row;
5. the retired function/config/invoker remain observable before implementation; and
6. if both processing one job and recording that failure throw, the next claimed sibling job still runs.

The query contracts must explicitly cover the hidden `document_strict_gate_status` counts and the protected-source chunk scan. Tests must also prove newly generated sections/cards/index units/summaries/labels carry the current generation so strict reads can converge.

Run and capture the expected RED:

```text
node scripts/run-vitest.mjs run tests/ingestion-edge-function-auth.test.ts tests/indexing-v3-agent.test.ts tests/worker-run-loop.test.ts tests/worker-row-contract.test.ts tests/supabase-schema.test.ts
```

The report must quote the failing assertions and explain why each failure is the expected missing behavior rather than a setup error.

## Step 2: Shared fail-closed visibility contract

Create exactly:

```ts
export type GenerationVisibleRow = Readonly<{
  document_id: string;
  generation_id: string | null;
}>;

export type GenerationVisibility = Readonly<{
  activeGenerationByDocument: ReadonlyMap<string, string>;
  committedGenerationIds: ReadonlySet<string>;
  knownLegacyDocumentIds: ReadonlySet<string>;
}>;

export function isVisibleCommittedGenerationRow(row: GenerationVisibleRow, visibility: GenerationVisibility): boolean {
  if (row.generation_id === null)
    return (
      visibility.knownLegacyDocumentIds.has(row.document_id) &&
      !visibility.activeGenerationByDocument.has(row.document_id)
    );
  return (
    visibility.activeGenerationByDocument.get(row.document_id) === row.generation_id &&
    visibility.committedGenerationIds.has(row.generation_id)
  );
}
```

Project the validated generation alias for chunks, sections, cards, index units, summaries, and labels. Apply the predicate before sorting or truncating. Keep P05 protected-source preflight before provider or artifact work.

Build `GenerationVisibility` only from a complete validated authority scan. Treat absence as unknown, not legacy. Reject overlapping legacy/active authority, malformed generation IDs, incomplete scans, and a committed-generation set that cannot prove the exact active generation.

## Step 3: Retire only the recovered processor

The new forward-only migration must:

- revoke grants on `public.invoke_ingestion_worker(integer)` before dropping it;
- drop only that current function signature;
- use fixed `search_path` conventions where applicable;
- leave historical migrations unchanged; and
- preserve rollback truth in the runbook without pretending the deleted duplicate processor remains deployable.

In the same migration, replace the current strict-gate view/function definition with generation-visible counts using the exact active document generation or positive legacy compatibility. Do not add another migration filename.

Remove the `supabase/functions/ingestion-worker` function directory and its exact `supabase/config.toml` stanza. Remove the current schema/type entry for the invoker. Retain historical documentation only where it accurately describes past state.

Replace or remove `tests/ingestion-edge-function-auth.test.ts` so current-state assertions prove the retirement rather than importing deleted files. Preserve separate historical-migration assertions in `tests/supabase-schema.test.ts`; do not edit historical migrations. Reconcile `supabase/schema.sql` and `src/lib/supabase/database.types.ts` now, but defer generated `supabase/drift-manifest.json` reconciliation to the stable C01/C02 tranche boundary exactly as the global plan requires. Do not hand-edit or copy the drift manifest.

Nest failure recording in its own `try/catch` so failure-reporting cannot abort sibling jobs. Do not weaken the existing per-job outer isolation.

Before finalizing a deletion of exported symbols, run the repository dead-code candidate check against the task range. If it refuses because the approved continuation plan intentionally pins the retirement, report the exact output; do not tune or bypass the gate.

## Step 4: GREEN and focused static gates

Run:

```text
node scripts/run-vitest.mjs run tests/ingestion-edge-function-auth.test.ts tests/indexing-v3-agent.test.ts tests/worker-run-loop.test.ts tests/worker-row-contract.test.ts tests/supabase-schema.test.ts
npm run check:edge:functions
npm run check:migration-role
npm run check:function-grants
```

Expected: focused tests pass; the sole core processor is `worker/main.ts`, bounded enrichment remains in `indexing-v3-agent`, stale generation rows cannot reach ordering/truncation, the current schema/types/config contain no retired invoker, and no provider or connected action occurs.

Record the live-only possibility of an untracked `pg_cron` command invoking the retired function as an unclosed C07 migration-application check. Do not inspect or mutate hosted schedules. Defer the broader disaster-recovery runbook sweep to planned Task 6; this task updates only `docs/worker-deploy-runbook.md` and must not expand into historical-document cleanup.

Run targeted format/diff checks only after GREEN. Do not broaden verification unless a concrete changed failure path requires it. Consult `npm run arbiter -- <gate>` before any expensive additional gate.

## Candidate commit and report

Self-review all owned files for scope, access/grant safety, data preservation, rollback truth, query ordering, test meaning, and stray output. Stage explicit paths only, including this brief. Create one local candidate commit:

```text
fix(ingestion): retire duplicate processor
```

Never push. The report must include:

- task base/head and commit;
- RED command, exact expected failures, and why they were valid;
- GREEN/static commands and exact outcomes;
- every changed/deleted file;
- migration/grant/rollback/compatibility assessment;
- dead-code candidate check outcome;
- self-review and concerns; and
- an attestation that no prohibited action occurred.

Return under 15 lines: status, commit, one-line RED/GREEN summary, concerns, and report path.
