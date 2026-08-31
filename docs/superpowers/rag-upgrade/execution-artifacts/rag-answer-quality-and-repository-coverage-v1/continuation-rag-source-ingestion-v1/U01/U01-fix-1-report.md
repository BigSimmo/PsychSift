# U01 correction loop 1 report

## Candidate

- Original U01 task base: `d38dce7ba7fada4ab1fb4588799f400916118c81`
- Reviewed U01 candidate: `9a3b3dc4deee971bb287c979e786c6890922aa05`
- Correction checkpoint base: `d187915b73c98aefd146749f41b354c4d8e4ee8e`
- Correction candidate head/commit: `5895e5da45b96d0d90a42c32856cb25f2026bf36`
- Commit subject: `fix(ingestion): close U01 review gaps`
- Worktree: `C:\Users\joshs\.codex\worktrees\rag-local-build-20260822\Database`

## RED evidence

Tests were added in the two owned test files before either production file was changed. The required focused command was:

```text
node scripts/run-vitest.mjs run tests/indexing-v3-agent.test.ts tests/worker-run-loop.test.ts
```

The first attempts were refused by the repository coordinator while another worktree held an exclusive Chromium lease. Those refusals were treated as environment contention, not RED, and no lock was bypassed. The first valid run and a case-insensitive assertion refinement both produced the same behavioral RED. The final recorded RED exited 1 with 2 failed files, 2 failed tests, and 38 passing tests (duration 954 ms):

1. `binds generation authority to each generated-artifact write and conflict`
   - Failing assertion: `legacy label conflict removes stale or malformed generation before replacement` expected the conflict expression to contain `coalesce(document_labels.metadata, '{}'::jsonb) - 'index_generation_id' ... || excluded.metadata`.
   - Actual candidate SQL used `coalesce(document_labels.metadata, '{}'::jsonb) || excluded.metadata`, so a positive-legacy excluded row that omitted the key could not clear a stale or malformed existing key.
2. `continues the Edge batch when processing and failure errors cannot be serialised`
   - Actual error: `TypeError: Converting circular structure to JSON`, at `behavior.ts:76` in `errorMessage()`.
   - The cyclic processing rejection escaped before `recordFailure` or the later sibling could complete, proving the reviewed isolation gap.

This was valid behavioral RED rather than setup failure: the runner loaded both suites, 38 tests passed, and every new statement-specific read/write contract other than the missing label sanitisation passed against the reviewed candidate.

## Implementation

- Generated-label conflict metadata now removes any existing `index_generation_id` key from object metadata, or starts from an empty object for malformed/non-object metadata, before merging `excluded.metadata`.
- A positive-legacy insert produces no generation key, so the conflict leaves the row keyless. An active insert carries the exact `generationPredicate.indexGenerationId`, so the conflict installs that exact value after clearing the old authority.
- `errorMessage()` now guards the entire conversion. Ordinary `Error` messages and JSON-serialisable thrown values retain their existing representation; cyclic, bigint-containing, or otherwise unserialisable values deterministically become `[unserialisable thrown value]`.
- The existing per-job outer isolation and nested failure-recorder isolation remain unchanged.
- Broad source-window tests were replaced with bounded statement-specific contracts for each required reader, generated-artifact write/conflict, and generation-bounded cleanup/update mutation.

## GREEN and focused static evidence

- Focused correction command after the production fix — exit 0; 2 files passed, 40 tests passed, duration 1.01 s.
- Original U01 focused command:

  ```text
  node scripts/run-vitest.mjs run tests/ingestion-edge-function-auth.test.ts tests/indexing-v3-agent.test.ts tests/worker-run-loop.test.ts tests/worker-row-contract.test.ts tests/supabase-schema.test.ts
  ```

  Exit 0; 5 files passed, 151 tests passed, duration 1.55 s.

- Final post-format correction command — exit 0; 2 files passed, 40 tests passed, duration 897 ms. This includes explicit `generationMetadata(null) -> {}` and exact-active-generation assertions.
- `npm run check:edge:functions` — exit 0; checked `indexing-v3-agent/index.ts` and `site-content-sync/index.ts`.
- `npm run check:migration-role` — exit 0: `Hosted migration-role guard passed: active hosted SQL/tooling uses postgres and immutable applied history is unchanged.`
- `npm run check:function-grants` — exit 0: all 62 `SECURITY DEFINER` public functions are revoked from `PUBLIC`, with none reopened by a grant to `PUBLIC`/`anon`.
- Targeted Prettier write/check over the four owned product/test paths and correction brief — exit 0: all matched files use Prettier code style.
- `git diff --check` and `git diff --cached --check` — exit 0.

`check:edge:functions` again expanded `deno.lock` as an incidental Deno workspace-resolution side effect. It was restored exactly to the correction checkpoint and is absent from the candidate.

## Statement-specific coverage

The source contracts bind the actual generation predicate inside each statement's `WHERE` and before its own ordering, limit, offset, or caller decision where applicable:

- summary lookup and summary chunk selection;
- generated-label summary, chunk, lateral chunk, section, and memory-card inputs;
- section-repair existing count and chunk selection;
- memory-card section input;
- section-index-unit lateral chunk and section inputs;
- visual image selection;
- quality index-unit and image counts;
- visual-artifact image and index-unit decision counts; and
- protected-source paged chunk scan.

Separate statement contracts cover summary metadata replacement; generated-label active/legacy conflict behavior; typed and metadata generation on sections, memory cards, section/visual index units, and visual/core embedding fields; section conflict replacement; and generation-bounded memory-card, index-unit, image, and embedding cleanup/update mutations.

## Changed files

The correction candidate contains exactly:

- Added `docs/superpowers/rag-upgrade/execution-artifacts/rag-answer-quality-and-repository-coverage-v1/continuation-rag-source-ingestion-v1/U01/U01-fix-1-brief.md` unchanged as correction authority.
- Modified `supabase/functions/indexing-v3-agent/behavior.ts`.
- Modified `supabase/functions/indexing-v3-agent/index.ts`.
- Modified `tests/indexing-v3-agent.test.ts`.
- Modified `tests/worker-run-loop.test.ts`.

This report was written after the candidate commit and is intentionally not part of that commit.

## Self-review and concerns

- Reviewed the final candidate for exact ownership, label identity preservation, positive-legacy convergence, exact active authority, per-statement predicate placement, error representability, sibling isolation, and accidental generated output.
- The label change is confined to conflict metadata replacement; it does not change label identity, confidence behavior, or insert selection.
- The error fallback is a string and therefore remains JSON-representable even when both the processing rejection and failure-recorder rejection are not.
- Only the four correction product/test paths plus the brief were staged. Pre-existing untracked `.superpowers`, P06/P07/P08A, and other work remains untouched.
- The pre-commit documentation hook ran and reported synchronized output, but left no tracked working-tree change.
- No new migration or grant change was needed. Hosted migration application and C07 cron inspection remain deliberately unperformed and outside this correction.

## Scope attestation

No U02 work began. No document or corpus was processed; no provider, hosted Supabase, Storage, scanner, model asset, or hosted schedule was accessed; no migration was applied; and no deployment, reindex, push, or pull request occurred. No historical migration, drift manifest, or out-of-scope product/documentation file was changed.
