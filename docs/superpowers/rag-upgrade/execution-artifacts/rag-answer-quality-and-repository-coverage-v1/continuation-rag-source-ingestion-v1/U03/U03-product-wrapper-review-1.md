# U03 product cancellation-wrapper review 1

Specification: **PASS** for the scoped production implementation. Quality: **FAIL** because one Important regression-proof gap remains. No Critical finding and no demonstrated production forwarding defect. This is the additional bounded RAG specialist review of the two admitted wrappers, not the three full-range specialist reviews, programme acceptance, or acceptance inherited from the amendment review.

## Important finding U03-WR-01 — structural matching does not prove signal identity

**Severity: Important (P2), tests only.** `tests/model-index-extraction.test.ts:137` and `tests/openai-cache.test.ts:815` use `toMatchObject({ signal: controller.signal })` in tests named as same-signal proof. The admitted amendment requires the original signal to reach the lower generation options and SDK request options.

The installed Vitest implementation makes these assertions weaker than that requirement:

- `node_modules/@vitest/expect/dist/index.js:1264-1270` implements `toMatchObject` with `equals` plus `subsetEquality`.
- The custom testers run before `Object.is` (`index.js:271-282`). `subsetEquality` accepts non-array objects and iterates `Object.keys(subset)` (`index.js:588-617`); its empty-key comparison succeeds without proving reference identity.
- `node_modules/@vitest/utils/dist/helpers.js:136-137` treats AbortSignal as an object. The captured RED log also shows the Node signal state as symbol properties, which this subset matcher does not enumerate as string keys.

**Trigger / realistic missed regression:** replace only the model-index wrapper's lower `signal: args.signal` with an unrelated `new AbortController().signal`, retaining its pre/post checks of `args.signal`. The lower-generation identity assertion can accept the different signal. The pre-abort tests still stop at the wrapper guard, and the deferred-result test rejects at the wrapper's post-await guard independently of what signal the lower mock received (`tests/model-index-extraction.test.ts:139-169`). Thus the suite does not protect cancellation of lower work/retries in this case. This is a source-derived bypass of the regression assertion, not a newly executed mutation test or a defect observed in current production code. Current production forwards `args.signal` correctly.

The caption retry case provides useful additional protection against an unlinked replacement signal, but its separate assertion at line 815 still does not prove the explicitly claimed object identity. Correct both assertions together.

**Smallest correction and proof:** capture the actual lower/SDK request options and assert `expect(actualOptions?.signal).toBe(controller.signal)` in the two existing real-wrapper tests. Preserve all existing pre-abort, deferred-result, retry and uncancelled controls. If a mutation control is used to validate this assertion, substitute a distinct signal only in a bounded test fixture and require the identity assertion to fail. No production behavior change or broad test expansion is indicated. The original exact two-file selector is sufficient for the resulting test-only correction; this reviewer did not run it.

**Closure:** ING-U03-3's production wrapper seam is addressed at the reviewed HEAD, but its complete amendment proof is not yet closed. Do not mark the correction accepted until the identity assertions are corrected, proportionately checked, and reviewed. The prior amendment Specification/Quality PASS admitted the work; it did not verify this implementation.

## Bound target and scope

- Repository: `C:/Users/joshs/.codex/worktrees/rag-local-build-20260822/Database`.
- Branch: `codex/rag-local-build-20260822`.
- Immutable original U03 base: `8c11f138e6c683a13db3b465332e7f3cbb515c62`.
- Preceding failed product candidate: `b651ee23d8541fbebea77ca1c621fcdec42540ad`.
- Reviewed product HEAD: `57ba6d6fc2505f03a1ee0df82b186bccd0a455c2`, rechecked unchanged immediately before report creation.
- Tracked status was clean at initial and final inspection (`git status --short --untracked-files=no`). Protected `1/` and unrelated untracked content were not enumerated.
- Outside output directory: `C:/Users/joshs/Codex-Handoffs/Ingestion/Execution/20260907-continuation` (O).

I compared the full original base-to-HEAD diff only for `src/lib/openai.ts`, `src/lib/model-index-extraction.ts`, `tests/openai-cache.test.ts`, and `tests/model-index-extraction.test.ts`; inspected the exact signal callsites in `worker/main.ts` and `src/lib/deep-memory.ts`; and followed the existing lower option/SDK retry chain. The two production wrapper diffs add nine lines, limited to optional signals, forwarding and guards. Other caller changes were not adjudicated. The full 41-file product range remains the responsibility of the full-range reviewers.

Supplied SHA-256 pins were independently recomputed and matched:

| Artifact in O | SHA-256 |
| --- | --- |
| U03-cancellation-closure-amendment-1.md | 0dddcc98e7e98df36ccc39a941155f5d98d3f85ff747d8fe28550aca5e1a08e4 |
| U03-cancellation-closure-amendment-review-1.md | 75c780ba056a7b012aaf3d3a600590bd2369275e617da31523339856c63e69f5 |
| U03-candidate-binding-2.json | edf2f8feb6ec557a6cecfaab565e00407e5cf5abd7a0ec22772d56d0cd3bf539 |
| U03-controller-verification-inventory-2.json | 1f7e03137c13660fa0907f494c4d3ec44fb027f86ecdfdb12c39afc691f03abf |
| U03-product-review-2.diff | 5f0807fecba0aa3863e94bf3cb4df4377234e5f9d20b88dec8c39e974db17236 |
| U03-review-wrapper-green-2-inputs.json | 5da4e274ac4a80ea487661b4e75d61b0244aa26eaf456cd16fa795f86b50d676 |

`U03-cancellation-closure-amendment-admission-1.json` and the implementer correction report were read with those inputs. Current raw SHA-256 hashes match both raw and committed-blob entries in candidate binding 2 for all six inspected owners:

| Owner | SHA-256 |
| --- | --- |
| src/lib/openai.ts | 91a4c355799f8b40e54a0a667704b65a9b7a2adcd1a3084912566b94c30a3600 |
| src/lib/model-index-extraction.ts | a56e05d4ec761307711285070f43585717d221937680f7e4ec575fd73cce2eda |
| tests/openai-cache.test.ts | 7a81176ac9714585122cc855160b3e7dd2b15767c6984f1d07a5f21ee270ea26 |
| tests/model-index-extraction.test.ts | 448686b87165b8f55cd93b837961322fb22fb084905be635444d0f7823005757 |
| worker/main.ts | bc7554899c99953cc21da91f1ee3ce745e46fdac90cb8e092282b96f69bc871c |
| src/lib/deep-memory.ts | 5c49a98df7cc3c4137a8cecf3faea84ecfe681f499328f24e4c67ca82ada76b4 |

## Production specification assessment

1. **Caption cancellation placement is correct.** `src/lib/openai.ts:1114` refuses pre-aborted work before input preparation/provider invocation. Line 1147 forwards `args.signal`; line 1166 refuses a late successful result before the JSON-normalization `try` at line 1168. The broad fallback catch cannot turn that post-await cancellation into a successful fallback caption.
2. **Model-index placement is correct.** `src/lib/model-index-extraction.ts:370` refuses aborted work before even the empty-input shortcut. Non-cancelled empty input still returns the existing empty profile at line 371 without generation. Line 374 forwards the same signal; line 385 refuses a late result before truncation logging and parsing/source anchoring at lines 389-395.
3. **The real callsites supply the existing attempt signal.** `worker/main.ts:904-917` checks the attempt, supplies `attemptForJob(job.id).signal` at line 906, and checks again before cache publication. `src/lib/deep-memory.ts:628-646` supplies `args.signal` at line 629; its fallback catch rechecks cancellation before logging or generating fallback cards. No new attempt, Fence or controller was added in these diffs.
4. **The actual lower boundary preserves identity.** `TextGenerationOptions.signal` is optional (`src/lib/openai.ts:35`). Option resolution spreads existing options, and `requestOptions` places the same object in SDK options (`src/lib/openai.ts:140-154`). `generateStructuredTextResult` reaches the existing buffered `responses.create` path at lines 787-798 and 472-478. The error path preserves abort reasons at lines 530-534. This is static current-code evidence, separate from the weak identity assertions.
5. **Defaults and behavior outside cancellation are preserved.** The base-to-HEAD wrapper diff changes no models, prompts, source-evidence handling, chunk/image selection, normalization, schema, cache key, retry count, safety identifier or SDK setup. Captioning retains its configured vision model/effort and 260 requested output budget. Model-index retains its indexing model, 3200 requested output budget, medium effort/verbosity and existing effective reasoning floor. Optional parameters preserve existing callers that omit signals. No Answer, retrieval ranking, semantic adjudication or repair behavior change is included in this verdict.

## Regression evidence and its limits

I read the raw logs and result/input records. These are reused recorded outcomes, not fresh runs by this reviewer:

| Recorded command | Outcome and qualification |
| --- | --- |
| `node scripts/run-vitest.mjs run tests/openai-cache.test.ts tests/model-index-extraction.test.ts` — wrapper RED1 | Exit 1; 8 assertion failures, 21 passed, 2 files. Missing forwarding, pre-abort acceptance, late-success acceptance and a second controlled request are actual assertion failures. No missing-module/export or environment failure is presented as RED. |
| Same command — wrapper GREEN2 | Exit 0; 29 passed, 2 files, no skips. Final wrapper/test bytes exactly match current scope. Result record has receipts off, arbiter off, and prior arbiter RUN. Passing these tests does not remove U03-WR-01. |
| `node scripts/run-vitest.mjs run tests/worker-behavior.test.ts tests/worker-run-loop.test.ts tests/document-enrichment.test.ts tests/deep-memory.test.ts tests/indexing-v3-agent.test.ts tests/ingestion-lease-fencing.test.ts` — correction GREEN3 | Recorded exit 0; 176 passed, 6 files. Read only as qualification for the current deep-memory caller; this is not an independent full-range review. The input record pins its final SHA-256 above. |
| Reviewed scoped compiler | Controller inventory reports exit 0; result records 0 diagnostics and 0 I/O violations. This was not rerun or independently recertified here. |

Wrapper GREEN2 contains an older contextual whole-file deep-memory pin (`33489691ba9129f1b9c855825d922dae213fdcca5f92f4e215df183119594a51`). Its later cleanup-only change does not change the wrapper/test bytes or signal callsite. The final deep-memory bytes are separately pinned and covered in GREEN3. Treat these as qualified separate focused runs, not one fresh aggregate or full-suite pass.

Raw wrapper evidence hashes recomputed during this review:

- RED1 log: `a3f9be321a65f38520f111add205d1b60c92b8a014d732d38face5991c094a7e`; result: `9bee114ecdb9d4dc22e0bd0e35649cebf5e79ca4521f6222ae33b5cc7978898d`.
- GREEN2 log: `793b7b05449a55212fa2e086d1a31d9caac7fb3ce48549996176524b436d50c1`; result: `81c863c3caad27d92ba26a9575225d4d7c4c4c73ab12956785c9171a92d1e5b6`.

The caption retry test (`tests/openai-cache.test.ts:860-902`) imports the actual wrapper and exercises a controlled SDK mock with two branches: an uncancelled control issues two simulated requests and fulfills; cancellation during a manually released backoff leaves one simulated request and rejects. This is not an inert mock. The late-success tests independently exercise wrapper guards when the lower seam returns success after abort. Existing non-cancelled tests remain intact, including model-index prompt/source selection and caption classification behavior.

Installed and locked OpenAI are both 7.4.0. The installed source checks the same `options.signal` before fetch and after transport failure (`node_modules/openai/src/client.ts:794-807`), bridges it to the internal fetch controller (`1010-1021`), and carries the same options through `retryRequest` (`1063-1099`). Backoff sleeps at line 1097 without an abortable wait, then calls `makeRequest` at line 1099. The bounded claim is therefore no subsequent fetch after cancellation once backoff releases, not immediate settlement during sleep. The controlled mock mirrors that relevant schedule; it does not execute the real SDK. The actual fetch receives the SDK's internal controller signal, so the original-signal identity requirement is at SDK request options, not raw fetch options.

SDK source SHA-256: `8199a2b1afae48aeca78ec1a46d9826a2d7ca1ba623e484af7467407ee130431`; SDK package SHA-256: `14d12ccd3b1ec0c1c88f6ed85e4985a76cf7ed35e68ed1efb34bccb49557db41`. Installed matcher SHA-256: `b177ca97952f1d65d3d2691edbc31ab1af56ac36b3cf08d7f56ad0ca69f07a45`; helper SHA-256: `1a5e6ae2acfeb0477419d8e5bee9f89b873b7ef8b20d13490ea95e20615cf1ec`.

## Review route, discipline and residual boundaries

Own session identity and route were selected only from this reviewer's own session file, first 12 JSONL records, reading selected `session_meta`/`turn_context` identity and route fields:

- Session/thread ID: `01a0840c-168e-7fd0-bdac-98b09b074c88`, selected using only `Env:CODEX_THREAD_ID`.
- File: `C:/Users/joshs/.codex/sessions/2026/09/09/rollout-2026-09-09T10-42-59-01a0840c-168e-7fd0-bdac-98b09b074c88.jsonl`.
- Role: `rag-retrieval-reviewer`; path `/root/u03_product_wrapper_review_1`; nickname Singer; depth 1; parent `01a07b47-4623-7e90-825a-ec25116b8531`.
- Observed turn model: `gpt-6-astra`; effort: `xhigh`. Collaboration mode default independently records the same model and reasoning effort.

This is actual local session-record evidence, not an inference from planned routing or a backend model attestation. I authored neither amendment nor product correction and spawned no child agents.

Current repository `AGENTS.md`, review protocol, review skill and relevant RAG instructions were inspected. No nested owner-path AGENTS file was found. The controller's existing `U03-controller-ledger-lookup-2.json` reports 456 tracked sources, zero matching reviews at this HEAD and `NOT REVIEWED at this HEAD`; the default CLI untracked discovery was intentionally not run. The controller owns canonical ledger append. Two referenced split instruction documents do not exist at this older worktree; the applicable review/effort instructions are inline in its AGENTS.md. Read-only lookup/output-truncation issues were not treated as test failures.

No tests, arbiter, gates, provider calls, SDK execution, SQL, worker/server, native extraction, real documents, operator action, activation, staging, commit or publication occurred. The only write is this new outside report. No source/index change was made. All broader ingestion/clinical/schema acceptance remains with its named specialists. Historical U02 remains exit 1, four failed suites, 45 failed and 586 passed overall; never green or inherited. Physical cancellation, already-sent bytes, Storage behavior, live egress, clinical validity and C07 remain unproved and separately gated.

