# U03 product cancellation-wrapper review 2

Specification: **PASS**. Quality: **PASS**. **U03-WR-01 is closed** at corrected candidate `bbd978a5708ed70c51e293aab079ead9c5bcb1ce`. No Critical or Important finding remains in this bounded wrapper review.

This resumes the independent RAG review in `U03-product-wrapper-review-1.md`; it does not replace the three full-range specialists or grant programme, provider, clinical or C07 acceptance. The prior review's Quality FAIL is preserved as historical evidence. Its production Specification PASS remains applicable because production bytes did not change.

## Exact correction and closure

The immutable Git delta from preceding candidate `57ba6d6fc2505f03a1ee0df82b186bccd0a455c2` changes exactly two lines in two tests:

- `tests/model-index-extraction.test.ts:137` now asserts `expect(mocks.generateStructuredTextResponse.mock.calls[0]?.[2]?.signal).toBe(controller.signal)`.
- `tests/openai-cache.test.ts:815` now asserts `expect(create.mock.calls[0]?.[1]?.signal).toBe(controller.signal)`.

The first observes the actual model-index wrapper's lower-generation options through the existing transparent mock. The second observes the actual caption wrapper's SDK request options. Both compare the original signal object directly. The installed matcher implements `toBe` with `Object.is(actual, expected)` at `node_modules/@vitest/expect/dist/index.js:1241-1243`, so an unrelated AbortSignal, an omitted signal or an undefined signal cannot satisfy either corrected assertion. This closes the structural-matching gap without changing a production wrapper or mock implementation.

The complete candidate-to-candidate diff is two insertions and two deletions, exclusively those assertions. Imports, arguments, defaults, pre-abort guards, late-success refusal tests, the cancellation-during-backoff case and its uncancelled two-request control remain unchanged. No new production regression, RED run or mutation experiment is claimed.

The earlier finding correctly distinguished a regression-proof defect from current production behavior. Its requested minimal correction has now been made and verified; ING-U03-3's admitted wrapper seam and its required identity proof are closed within this bounded review.

## Bound source and evidence

Observed repository: `C:/Users/joshs/.codex/worktrees/rag-local-build-20260822/Database`; branch: `codex/rag-local-build-20260822`.

Original U03 base remains `8c11f138e6c683a13db3b465332e7f3cbb515c62`. Current HEAD resolves exactly to `bbd978a5708ed70c51e293aab079ead9c5bcb1ce`. Initial and final `git status --short --untracked-files=no` returned no tracked changes.

All 41 current product-file hashes match freeze7 and both the raw-file and committed-blob entries in candidate binding 3. Comparing freeze6 and freeze7 finds exactly the two named test hashes changed; the other 39 are identical. All 12 entries in the test input manifest's `.files` array were recomputed and match current files, including both wrappers, both tests, actual `vitest.config.mts`, package/lock, configuration and recorded runner helpers.

| Corrected test | Current SHA-256 |
| --- | --- |
| tests/model-index-extraction.test.ts | 93fff787e4e025f8576d13263a3fe2aba1b7fea4e32e47c738c5d6536a196a2a |
| tests/openai-cache.test.ts | 24d77864efa8ddfab58d9a7f73400058559313a26371a0142bb340cf1af1cb5b |

The following outside artifacts were read and their SHA-256 hashes recomputed:

| Artifact | SHA-256 |
| --- | --- |
| U03-candidate-binding-3.json | 4759824eb7d37b93eefd232df7d659116fc631fa01b66a4e17db46514306e4bb |
| U03-implementation-freeze-7.json | df84e179232a4c0408b742bbac2822c206679f9d70e364d32a82780894d930c2 |
| U03-product-review-3.diff | a7713f3c523a1c55c9c8cabca3c93e58209d798f01ce95a239227ad23f19d244 |
| U03-product-wrapper-review-1.md | 76186838d749237cd69c5db79632e30d1c7f59e376bb41310955087e0d276f41 |
| U03-test-proof-round-2-report.md | ee9fe0607201f9a1f70a44be86dc345daa41438f000b82536edf96622bbe3a6f |
| U03-test-proof-round-2-inputs.json | 94b0118f656f0238b6a1a36f53d44b57b893be73ea8d4770f55c3dedb78159f0 |
| U03-test-proof-round-2-result.json | 58ab6b98cd7ab5c34d741ed8e78fc2ad780160ed433516ba7728cf14d6ad054f |
| U03-test-proof-round-2-verification-route.md | b6225bec0404ae97b74739c46f15a59a18bc912b225564c4b4f38a33121c099e |
| U03-test-proof-round-2.log | 58bdffee9725256c20562076d7b5416e9986ed497b530193af102afcc50e8982 |

Freeze7 and the writer's report/input records name the preceding HEAD because they captured the two uncommitted corrected assertions before controller commit. Binding 3, the actual Git delta and current matching hashes bind those same tested bytes to the corrected immutable HEAD; their historical HEAD fields were not rewritten.

## Verification assessment

The writer ran exactly one fresh focused selector on these corrected bytes:

```text
node scripts/run-vitest.mjs run tests/openai-cache.test.ts tests/model-index-extraction.test.ts
```

Raw output: **2 test files passed; 29 tests passed**. The result record reports **exit 0**; the report records **0 failed and 0 skipped**. Receipts and arbiter were process-local off, with the recorded arbiter result `RUN/off`; the existing coordinator was retained. This reviewer reuses that fresh recorded run with independently matched inputs, not a gate receipt and not a new reviewer execution.

Focused formatting was also recorded:

```text
node node_modules/prettier/bin/prettier.cjs --check tests/openai-cache.test.ts tests/model-index-extraction.test.ts
```

Result: exit 0; raw output says all matched files use Prettier style.

The verification route correctly selects no additional gate for this two-assertion correction. No production type contract, provider configuration, SQL or Edge root changed. Earlier compiler/production evidence retains its original scope and input qualification; it is not relabelled fresh compilation of the changed test bytes. Older wrapper RED/GREEN evidence and all prior failures remain preserved.

## Unchanged production findings and limits

The original wrapper review remains the source of the full bounded production assessment: optional original-signal propagation, pre-call refusal, caption post-await guard outside fallback catch, model-index guard before logging/parsing, caller cancellation checks, and preservation of models/prompts/budgets/cache/retry settings. None of those production bytes changed.

The installed OpenAI 7.4.0 backoff sleep is not abortable. The retained controlled mock proves no next simulated request after cancellation once that backoff is released, together with late-success refusal and an uncancelled two-request control. It does not prove immediate settlement during SDK sleep, real SDK fetch execution, live-provider cancellation, retraction of already-sent bytes or zero provider egress. Signal identity is established at SDK request options; the SDK may bridge it to its own internal fetch controller.

Offline/mock and source-only evidence remain qualified as such. Neither this review nor a deterministic Source-only fallback proves grounded live-provider success, corpus completeness or clinical validity. Historical U02 remains exit 1, four failed suites, 45 failed and 586 passed overall; no inherited green result. SQL/runtime/Storage/native/provider/clinical/C07 boundaries remain unchanged.

## Actual reviewer route and actions

This is the same independent reviewer session `01a0840c-168e-7fd0-bdac-98b09b074c88`, role `rag-retrieval-reviewer`, agent path `/root/u03_product_wrapper_review_1`. Only its own selected `session_meta` identity fields and latest `turn_context` route fields were inspected in:

`C:/Users/joshs/.codex/sessions/2026/09/09/rollout-2026-09-09T10-42-59-01a0840c-168e-7fd0-bdac-98b09b074c88.jsonl`.

The observed current turn context at `2026-09-09T03:05:19.936Z` records model **gpt-6-astra**, effort **xhigh**; collaboration settings independently record the same values. This is actual local session-record evidence, not backend attestation or inference from the requested route.

This continuation performed read-only Git/diff, selected source, artifact and hash inspection. No tests, gates, arbiter, formatter, provider, SQL, worker/server, untracked enumeration, repository/index write, commit, publication or delegation occurred. Only this new outside report was written. The existing review protocol/skill and controller-owned ledger routing from review 1 continue to apply; the controller owns canonical record and acceptance updates.

