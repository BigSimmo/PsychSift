# U02 implementation report

## Identity and revision

- Task: U02, produce one validated source-anchored summary payload.
- Implementer: Codex implementer `/root/u02_implementer`.
- Implementation dispatch base: `f485df3358f43dff2b85698fcfc25d018854930a`.
- Immutable underlying task base: `08df4cddce457ba016b0d31fcf7202a4b564776a`.
- Candidate head: `4621b3000a05cd88494f4b87d807c8761d7f862f`.
- Candidate subject: `feat(ingestion): anchor summaries to committed sources`.

## Strict TDD evidence

Production code was not edited before the observed RED.

Exact RED command:

```text
node scripts/run-vitest.mjs run tests/indexing-v3-agent.test.ts tests/document-enrichment.test.ts tests/worker-shadow-extraction.test.ts tests/check-indexing-contract.test.ts
```

Expected RED outcome: exit 1; 4 test files failed, 22 tests failed, and 62 existing tests passed. The intended failures showed that the shared source-anchored normalizer/coverage owner did not exist, Edge still used the legacy first-N summary source path, active scripts and worker lacked exact typed/raw generation binding and preflight ordering, label replacement remained destructive, and the required Node/Edge persistence contracts were absent. The 62 passes confirmed that the runner loaded the existing focused tests rather than failing during test discovery.

Exact final GREEN command:

```text
node scripts/run-vitest.mjs run tests/indexing-v3-agent.test.ts tests/document-enrichment.test.ts tests/worker-shadow-extraction.test.ts tests/check-indexing-contract.test.ts
```

Outcome: exit 0; 4 test files passed and 85 tests passed. This includes strict contract vectors, late-section coverage, exact generation/preflight source bindings, Edge ordering, summary-upsert preservation, and failure-after-N-label-writes retry repair with manual-label preservation and no second provider call.

## Required static and offline gates

```text
npm run check:edge:functions
```

Outcome: exit 0. The checker validated `supabase/functions/indexing-v3-agent/index.ts` and `supabase/functions/site-content-sync/index.ts`.

```text
npm run eval:rag:offline
```

Outcome: exit 1. Offline fixture and manifest validation passed for 36 golden cases, 26 suites, and 29 programme cases with SHA-256 `4bf13e036a49ee077a9227c6b61d6f597efff15e8a5f2e3ea36f0cd4e4ea5107`. The subsequent broad offline test phase finished with 22 files passed, 4 files failed, 586 tests passed, and 45 tests failed. Failures were confined to answer/search suites outside the U02 owned diff: `tests/rag-answer-fallback.test.ts`, `tests/rag-round-trip-budget.test.ts`, `tests/search-round-trip-budget.test.ts`, and `tests/search-route-round-trip-budget.test.ts`. Examples include expected-versus-observed answer routing/fallback results and round-trip totals of 16 versus 13, 14 versus 11, and 19 versus 16. The required `npm run eval:rag:offline` therefore remains accurately recorded as failed.

### Controller-supplied baseline diagnosis

After implementation handoff, the controller reproduced the failing subset in a clean detached worktree at the exact implementation base `f485df3358f43dff2b85698fcfc25d018854930a`, using byte-identical `package.json` and `package-lock.json` files and the same installed dependencies.

Exact controller baseline command:

```text
node scripts/run-vitest.mjs run tests/rag-answer-fallback.test.ts tests/rag-round-trip-budget.test.ts tests/search-round-trip-budget.test.ts tests/search-route-round-trip-budget.test.ts
```

Controller baseline outcome: exit 1; the same 4 files failed with exactly 45 tests failed and 56 passed. It reproduced the same answer/fallback assertions and exact budget totals of 16 versus 13, 14 versus 11, and 19 versus 16.

A separate controller read-only call-graph trace found the four failing tests and their direct runtime owners unchanged. It also found that the `src/lib/types.ts` dependency is type-only and erased, `fetchRelatedDocuments` is byte-identical, U02 runtime changes are indexing-only for these paths, and the affected tests mock their retrieval and Supabase inputs. The controller removed the temporary baseline worktree and dependency junction after the run.

This evidence classifies the offline failures as baseline-confirmed repository verification debt not attributable to U02. It does not change or overstate the required `npm run eval:rag:offline` result: that command still exited 1.

No production-readiness, live-provider, connected-script, or other additional expensive gate ran.

## Changed files

- `scripts/backfill-smart-index.ts`
- `scripts/enrich-documents.ts`
- `src/lib/document-enrichment.ts`
- `src/lib/indexing-coverage.ts`
- `src/lib/types.ts`
- `supabase/functions/_shared/indexing-coverage.ts`
- `supabase/functions/_shared/source-anchored-summary.ts`
- `supabase/functions/indexing-v3-agent/behavior.ts`
- `supabase/functions/indexing-v3-agent/index.ts`
- `supabase/functions/indexing-v3-agent/utils.ts`
- `tests/check-indexing-contract.test.ts`
- `tests/document-enrichment.test.ts`
- `tests/indexing-v3-agent.test.ts`
- `tests/worker-shadow-extraction.test.ts`
- `worker/main.ts`

The U02 brief was staged explicitly as requested but was unchanged and therefore is not part of the commit. This report is intentionally uncommitted and the implementation commit was not amended.

## Generation, source, and clinical-safety assessment

- The transport-neutral shared owner validates exact version/model markers, canonical UUIDs and ISO time, canonical bounded text, complete profile shape, ordered whole-source anchors, claim allowlists, derived pages, support/evidence enums, deterministic clinical projections, label boundaries, and deep freezing.
- Whole-summary chunk anchors come only from the shared coverage-aware 36-chunk selector. Whole-summary image anchors use at most the first 64 images from the complete bounded, deterministically ordered exact-generation source load.
- Worker, both connected scripts, Node enrichment, and Edge require a non-null canonical generation and validate exact typed/raw authority. Chunk/image queries constrain the generation before ordering and 1,000-row paging, then fail closed above 5,000 chunks or 1,000 images.
- Local P05 metadata/content policy preflight occurs immediately after complete bounded source loading and before provider or persistence work. Edge retains its protected-source scan as the first `processJob` operation, then requires active generation and complete sources before summary work or its first completion-gate decision.
- Node is the only structured-summary provider path and provider/parse/normalization uncertainty throws `source_anchored_summary_generation_failed`; no Node fallback is persisted. Edge adds no summary provider and persists only the exact deterministic source-only fallback.
- Generated labels are deterministic projections of validated claim-bearing profile items and carry exact generation, summary version, chunk/image anchors, and derived pages. The smart-index backfill's independent fallback-label path was removed.
- The ordinary Answer/search implementation was not edited or imported by U02.

## Replacement, retry, and rollback behavior

- A complete candidate is generated and normalized before summary persistence. Generation, parsing, normalization, or summary-upsert failure leaves the prior summary and labels untouched.
- Summary persistence records the complete payload with projection completion false before label mutation. Desired generated labels are established before stale generated labels are deleted; deletion is restricted to `source = 'generated'`, preserving manual labels. Completion becomes true only after exact label repair succeeds.
- Node retry revalidates the stored payload, repairs partial/mismatched labels without another provider call, removes stale generated labels only after desired rows exist, and then marks the projection complete. The focused test exercises failure on the second desired label write followed by exact repair.
- Edge performs summary, label, stale-label removal, and completion update inside its SQL transaction, so a write failure rolls back the Edge replacement.
- No operational rollback was executed. The local candidate can be reverted as one commit if review rejects it.

## Self-review

- Reviewed the complete owned diff for source-policy ordering, provider-before-preflight paths, generation filtering before order/range, complete source bounds, shared selector parity, strict normalization, deterministic projections, non-destructive replacement, manual-label preservation, Node/Deno type ownership, Answer-path isolation, test meaning, and accidental output.
- Confirmed the final commit contains only the 15 owned implementation/test paths listed above; unrelated untracked work was not staged or modified.
- `git diff --cached --check` passed before commit.
- The required Edge checker transiently expanded `deno.lock`; it was restored exactly to committed HEAD, never staged, and no out-of-scope tracked diff remained before this report was written.

## Concerns

- No U02-attributable concern remains. The required offline gate failure is baseline-confirmed repository verification debt, and it remains reported as a failed gate rather than a pass.
- No broad TypeScript/lint/full-suite gate was added; this follows the brief's exact-gate restriction and is not additional U02 verification debt.

## Prohibited-action attestation

No document or corpus was processed. No connected backfill/enrichment script was executed. No provider, hosted Supabase, Storage, PITR, scanner, or model asset was accessed. No production-readiness check ran. No migration was applied. Nothing was deployed, reindexed, pushed, or published, and no pull request was opened. No prohibited operational action occurred; the only post-check cleanup was restoring the required Edge checker's transient `deno.lock` rewrite to the committed bytes.
