# U03 cancellation closure amendment review 1

Specification: **PASS**. Quality: **PASS**. No Critical or Important finding in this concrete amendment. This is independent read-only review of the proposed four-owner addition for ING-U03-3, suitable for controller admission. It is not implementation verification, closure of ING-U03-3, final product acceptance, or acceptance of any other U03 finding.

## Exact target and inputs

- Repository: `C:/Users/joshs/.codex/worktrees/rag-local-build-20260822/Database`.
- Branch observed: `codex/rag-local-build-20260822`.
- Original TASK_BASE: `8c11f138e6c683a13db3b465332e7f3cbb515c62`; local object resolves exactly.
- Frozen candidate HEAD: `b651ee23d8541fbebea77ca1c621fcdec42540ad`; unchanged at the final read.
- `git status --short --untracked-files=no` returned no tracked changes at initial and final inspection. No unrelated untracked tree or protected `1/` inventory was requested.
- Handoff directory: `C:/Users/joshs/Codex-Handoffs/Ingestion/Execution/20260907-continuation`.

All supplied pins were independently recomputed with SHA-256 and matched:

| Input | SHA-256 |
| --- | --- |
| `U03-cancellation-closure-amendment-1.md` | `0dddcc98e7e98df36ccc39a941155f5d98d3f85ff747d8fe28550aca5e1a08e4` |
| `U03-cancellation-closure-amendment-inputs-1.json` | `e6de642c2bc56e89be72dc9adf91d949de6d883ad6ff750e2061a20262c02e6e` |
| `U03-product-ingestion-review-1.md` | `b7df41f7778b814e3cddc920f1f2b7f2c672fbf71a4a398d06bfb355d2828b1c` |
| `src/lib/openai.ts` | `1ac459a8a89cfae533613e001990a18bc8d4feb70c646ca775db809afeb18b52` |
| `src/lib/model-index-extraction.ts` | `73f61d3511522512b5c4bb3ba2ab7e17d0a54191854c63de31b13e32dd8cc696` |
| `tests/openai-cache.test.ts` | `855a114b1664823bd8f90a006184a8db14adfa85cdf0b54e2fc0c5295f0576f8` |
| `tests/model-index-extraction.test.ts` | `125e0291540df5647b7c2dc3812856cb4b141c8f67832c5b4f83c22ce8655a5a` |

The four added owners are existing tracked files; `git ls-files --error-unmatch` confirmed them. Their hashes were rechecked immediately before reporting: `FOUR_INPUT_PINS_UNCHANGED=true`.

Current governing material inspected in the named repository:

| Material | SHA-256 |
| --- | --- |
| `AGENTS.md` | `8206463dca576d6d1cba7c6b718c46738f88bc7716f3e09f976ffaa536f8c193` |
| `docs/codex-review-protocol.md` | `83afe7504a07cb83dca8ee30857127d30e45d5d00270e654c48cb3e82eb12d8d` |
| `.agents/skills/review/SKILL.md` | `9415f0ef1e8afce567033e2b4235950148c01a8d51c4fc585b641b8871693cb4` |
| `docs/superpowers/rag-upgrade/continuations/rag-source-ingestion-continuation-v1/U03-execution-contract.md` | `877594a62de02ef3391ae0c9ca7594b827e768d8b0603eef3adfba0530dc2939` |

No nested `AGENTS.md` exists on the inspected `src/lib`, `tests`, or `worker` owner paths. The execution contract's lines 33-43 require a reviewed explicit owner addition; line 135 requires the cancellation closure this amendment supplies. Its lines 207-221 preserve scoped verification and separate acceptance boundaries.

## Actual local review route

- Own thread ID, obtained only from `Env:CODEX_THREAD_ID`: `01a083df-c7cc-7f20-8f0e-1ffb06331889`.
- Own session file: `C:/Users/joshs/.codex/sessions/2026/09/09/rollout-2026-09-09T09-54-36-01a083df-c7cc-7f20-8f0e-1ffb06331889.jsonl`.
- Only the file matching this own UUID was selected, and only the first 12 JSONL records were read for selected identity/route fields. No arbitrary message payload or environment dump was read.
- `session_meta.payload.agent_role`: `rag-retrieval-reviewer`.
- `session_meta.payload.source.subagent.thread_spawn`: parent `01a07b47-4623-7e90-825a-ec25116b8531`, depth `1`, agent path `/root/u03_cancellation_scope_review`, nickname `Epicurus`, role `rag-retrieval-reviewer`.
- Actual `turn_context`: model `gpt-6-astra`, effort `xhigh`.
- Actual collaboration settings: mode `default`, model `gpt-6-astra`, reasoning effort `xhigh`.

This route is observed local evidence, not an inference from the requested reviewer role. This reviewer authored neither the amendment nor the proposed product correction and did not recursively delegate.

## Specification assessment

1. **The missing cancellation edge is present at the pinned source.** `worker/main.ts:896-908` checks the attempt around the real caption call but omits its signal. `src/lib/deep-memory.ts:626-647` likewise omits its existing signal when calling the real model-index wrapper. The referenced finding at `U03-product-ingestion-review-1.md:33-43` accurately describes those two seams.
2. **The lower path already supports the exact signal.** `TextGenerationOptions` carries `signal?: AbortSignal` at `src/lib/openai.ts:35`; `requestOptions` forwards that same object at lines 150-155. The real `generateStructuredTextResult` resolves options at lines 787-798 and reaches SDK `responses.create`/`parse` through lines 472-476. The error path at lines 530-534 preserves caller cancellation. No shared request, SDK-client or retry-policy redesign is needed.
3. **The addition is minimal and compatible.** The two wrappers currently lack a signal (`src/lib/openai.ts:1102-1112`; `src/lib/model-index-extraction.ts:364-368`). Adding one optional property to each existing argument object, checking cancellation before work/after await and forwarding the same signal is sufficient for this seam. The already-owned callers supply their existing attempt signal. No new Fence or attempt is justified. The existing caption call in `scripts/enrich-documents.ts:430-440` and existing model-profile test callers can continue omitting it.
4. **Normal behavior remains explicitly frozen.** Amendment lines 9-12 restrict the change to cancellation and focused regressions. Current vision model, instructions, token cap, cache key and reasoning setting remain in `src/lib/openai.ts:1144-1161`; model-index model, coverage selection, medium reasoning/verbosity, 3200 budget and parse/source anchoring remain in `src/lib/model-index-extraction.ts:364-391`. The non-cancelled empty-chunk return at line 369 is preserved. No model, prompt, retry, configuration, normalizer, ranking, source-family or provider-operation change is admitted.
5. **Before/after checks can remain outside normal fallback handling.** Caption post-await cancellation must be checked before the JSON-normalization `try` beginning at line 1163: a check placed inside the broad `catch` region at line 1214 could become a fallback result. Model-index post-await cancellation belongs before truncation logging/parsing at lines 382-391. These are concrete placements for the amendment's existing late-result refusal requirement, not additional scope.

## Quality and proof assessment

The amendment names the actual wrapper owners, two existing test files, an exact additional selector and the required genuine assertion RED before production edits. Existing tests already provide real-wrapper import seams: the caption wrapper is exercised through an SDK mock in `tests/openai-cache.test.ts:712-783`; model-index exercises the real wrapper with a mocked lower generation result in `tests/model-index-extraction.test.ts:14-25,44-61`. Existing assertions can remain intact.

The future proof must exercise the wrapper rather than replace it. For captioning, capture the exact signal passed to SDK request options, refuse a pre-aborted call before SDK request initiation, and use a controlled first request/backoff followed by cancellation to show no second request or fulfilled wrapper result. A useful retry control must show that its uncancelled schedule actually can proceed to the next request; an inert mock with no retry path is insufficient. A deferred successful lower response released after abort must also be refused, because lower generation's catch path alone does not cover a successful late response. Model-index needs the same argument identity/pre-abort/deferred-result boundary plus preserved uncancelled behavior, including its empty-input semantics. These checks operationalize the amendment's stated proof, not a separate product feature.

Installed SDK inspection supports the proposed retry schedule. Installed and locked `openai` both report **7.4.0**. In `node_modules/openai/src/client.ts`, `makeRequest` checks `options.signal.aborted` before fetch at lines 794-796 and after a transport error at lines 803-807; the fetch layer bridges it to the internal request controller at lines 1010-1021. `retryRequest` carries the same options through the sleep and next `makeRequest` at lines 1063-1099. The sleep itself is not abortable. Therefore the relevant bound is **no subsequent fetch after cancellation**, not immediate settlement during backoff. The wrapper's post-await check separately protects late successful results. No installed SDK execution or network request occurred.

SDK source pins for that read-only observation:

- `node_modules/openai/src/client.ts`: SHA-256 `8199a2b1afae48aeca78ec1a46d9826a2d7ca1ba623e484af7467407ee130431`.
- `node_modules/openai/package.json`: SHA-256 `14d12ccd3b1ec0c1c88f6ed85e4985a76cf7ed35e68ed1efb34bccb49557db41`.

The proposed command remains:

```text
node scripts/run-vitest.mjs run tests/openai-cache.test.ts tests/model-index-extraction.test.ts
```

**Not run by this reviewer.** Later execution must retain the coordinator, record fresh RED/GREEN test bytes/output/immediate exit status and restore process-local bookkeeping switches. The amendment correctly retains changed-type compilation through the previously reviewed tracked lane, and retains conditional reassessment of the existing Edge closure when other corrections touch shared attempt files. All four proposed roots are tracked under the existing application/test categories; this review does not execute, replace or independently recertify the compiler recipe.

## Inspection and limits

Read-only inspection used local Git status/ref/tracked-name queries, targeted source reads/searches, SHA-256 hashing, the named governing documents, own selected session route fields, and installed SDK source/version comparison. The repository review skill's findings/scope protocol was applied. This is an outside brief-amendment review, not a completed branch or PR review; no repository ledger lookup/append or repository write was performed.

No tests, arbiter, typecheck, gate, SQL, provider, server, worker, native extraction, real-document operation, operator call, staging, commit or publication ran. The only output write is this new outside report. Two read-only tooling issues were resolved without changing inputs: the execution contract was located at its tracked repository path after an initial outside-path miss, and PowerShell lockfile parsing used `ConvertFrom-Json -AsHashtable` because the lock contains an empty-string package key. Neither was treated as regression evidence or a test result.

Residual risk is the future implementation and proof, especially accidentally swallowing an abort in caption normalization or using an inert retry mock. Admission does not close ING-U03-3 until actual-wrapper RED/GREEN and corrected-source specialist review succeed. ING-U03-1/2 and the independent clinical review remain outside this bounded verdict. Preserve the failed product review and complete original U03 range. Historical U02 evaluation remains exit 1, four failed suites, 45 failed and 586 passed overall. SQL/runtime/Storage/native/provider/clinical/C07 acceptance remains separately gated.
