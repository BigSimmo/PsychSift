# U03 test-proof round 2 verification route

Decision: **the already completed two-file wrapper selector plus focused formatting is the smallest sufficient gate for this exact correction. No further test, compiler, Edge, SQL/static, inventory or P04 run is selected.** The correction strengthens two existing identity assertions and introduces no production or type-contract change. Corrected-head specialist rebinds and RAG review closure remain required; this routing is not U03 acceptance.

## Exact inspected change

Observed HEAD `57ba6d6fc2505f03a1ee0df82b186bccd0a455c2`; original TASK_BASE remains `8c11f138e6c683a13db3b465332e7f3cbb515c62`. Worktree is `C:/Users/joshs/.codex/worktrees/rag-local-build-20260822/Database`. Tracked status shows exactly two unstaged tests. Protected `1/` and unrelated untracked content were not enumerated or read.

Read the real diff against that HEAD, the correction report, freeze6/freeze7, raw test/format/arbiter outputs, their result/input records and the bounded wrapper review. The entire new diff is:

- `tests/model-index-extraction.test.ts`: `expect(mocks.generateStructuredTextResponse.mock.calls[0]?.[2]?.signal).toBe(controller.signal)` replaces structural matching of the options object.
- `tests/openai-cache.test.ts`: `expect(create.mock.calls[0]?.[1]?.signal).toBe(controller.signal)` makes the equivalent change at actual SDK request options.

Both assertions now compare the original signal object by identity. Production, imports, mock implementations, arguments, defaults, pre-abort/deferred/retry tests and other assertions are unchanged. No interface/export/configuration or new compiler option was introduced; the optional property access uses the existing recorded mock options. There is no demonstrated production regression and no new product RED or mutation run is claimed.

Recomputed freeze7 SHA-256 matches `df84e179232a4c0408b742bbac2822c206679f9d70e364d32a82780894d930c2`. All **41 current file hashes match** freeze7. Comparing its entries with freeze6 finds exactly these two changed hashes; the other **39 are identical**:

| Test | Current SHA-256 |
| --- | --- |
| `tests/model-index-extraction.test.ts` | `93fff787e4e025f8576d13263a3fe2aba1b7fea4e32e47c738c5d6536a196a2a` |
| `tests/openai-cache.test.ts` | `24d77864efa8ddfab58d9a7f73400058559313a26371a0142bb340cf1af1cb5b` |

## Actual sufficient proof

The literal command was run once by the writer:

```text
node scripts/run-vitest.mjs run tests/openai-cache.test.ts tests/model-index-extraction.test.ts
```

Raw output records **Test Files 2 passed (2); Tests 29 passed (29)**. Result/report records exit 0, zero failures and zero skipped. The actual arbiter log is **RUN "test" — GATE_ARBITER is off**; receipts and arbiter were process-local off, and the result records the scoped fail-closed preflight. The input record names the real `vitest.config.mts`, not a guessed `.ts` file. All **12 recorded selected input hashes were independently recomputed here and still match**, including both tests, both wrappers, env, package/lock, tsconfig, actual Vitest config and recorded runner helpers. The writer reports unchanged post-run hashes and preserved coordinator controls.

Focused formatting was already checked with:

```text
node node_modules/prettier/bin/prettier.cjs --check tests/openai-cache.test.ts tests/model-index-extraction.test.ts
```

Its raw decisive line is **All matched files use Prettier code style!**, result exit 0. Do not run it again on these unchanged bytes.

Recomputed evidence hashes:

| Artifact in O | SHA-256 |
| --- | --- |
| `U03-test-proof-round-2-report.md` | `ee9fe0607201f9a1f70a44be86dc345daa41438f000b82536edf96622bbe3a6f` |
| `U03-test-proof-round-2-inputs.json` | `94b0118f656f0238b6a1a36f53d44b57b893be73ea8d4770f55c3dedb78159f0` |
| `U03-test-proof-round-2-result.json` | `58ab6b98cd7ab5c34d741ed8e78fc2ad780160ed433516ba7728cf14d6ad054f` |
| `U03-test-proof-round-2.log` | `58bdffee9725256c20562076d7b5416e9986ed497b530193af102afcc50e8982` |
| `U03-test-proof-round-2-format-check.log` | `f20510a9da4717c51c4cffee6d0dd88d6c9a723d0a83711d01216f5b48961283` |

## Reuse and remaining acceptance

Use this new 29-test result as current identity-assertion proof; preserve the older wrapper result and Important finding U03-WR-01 as historical evidence. The wrapper review's production Specification PASS does not turn its previous Quality FAIL into a pass automatically. The RAG reviewer must close that exact proof finding against the corrected candidate.

Retain previously verified production behavioral, Storage/shadow, tracked compiler, native Edge, staged migration-role, inventory and P04 evidence with their original input identities and scope labels. Neither changed test introduces a new type contract or changes those production/config/SQL/fixture inputs, so repeating those commands adds no distinct failure detection for this diff. In particular, the prior compiler result remains historical checked-input evidence with an explicit two-assertion-only delta; do not relabel it as a fresh compilation of the changed test bytes. No automatic full 15/17-file repeat, broad lint/test/build, or combined gate is selected.

Preserve module-index's existing **failed, unchanged-baseline gaps** disposition; it does not become green. Preserve SQL/runtime/provider/native/clinical residuals and the C07 `check:production-readiness` boundary. No provider, SQL replay/application, worker/server, operator/repair/reindex, deployment/publication or hosted action is authorised by this route.

The controller still binds the exact corrected candidate HEAD and full original-range package, obtains the requested corrected-head specialist rebinds and explicit RAG Quality closure, and records acceptance only afterward. Existing three full-range PASS reports at the preceding HEAD remain preserved with their identities; this two-test correction is not yet accepted merely because its focused check passes.

This reviewer performed only read-only diff/evidence/hash inspection and created this one outside report. No gate, arbiter, formatter, compiler, staging, repository write, provider action or agent dispatch occurred. Requested role is `verification-router`; no independent current model/effort session observation was obtained, and the writer's route is not attributed to this reviewer.
