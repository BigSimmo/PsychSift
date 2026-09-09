# U03 correction round 2 — exact cancellation signal proof

This is the same original U03 task, with no production behavior change. Immutable TASK_BASE remains 8c11f138e6c683a13db3b465332e7f3cbb515c62; current unaccepted candidate is 57ba6d6fc2505f03a1ee0df82b186bccd0a455c2. Preserve both product commits, all failed reviews, freeze6 and every prior result. Worktree C:/Users/joshs/.codex/worktrees/rag-local-build-20260822/Database; branch codex/rag-local-build-20260822. Outside evidence directory is this document's directory. Authorisation is the existing serial local continuation and correction authority.

Independent RAG report U03-product-wrapper-review-1.md (SHA256 76186838d749237cd69c5db79632e30d1c7f59e376bb41310955087e0d276f41) gives Specification PASS and Quality FAIL. U03-WR-01 is an Important test-proof gap, not a demonstrated current production forwarding defect. Installed structural subset matching can accept a different AbortSignal. Actual source already forwards the correct original signal.

Sole writer ownership is exactly two existing test files:

- tests/openai-cache.test.ts: replace the same-signal test's structural options assertion with `expect(create.mock.calls[0]?.[1]?.signal).toBe(controller.signal)`.
- tests/model-index-extraction.test.ts: replace its corresponding structural options assertion with `expect(mocks.generateStructuredTextResponse.mock.calls[0]?.[2]?.signal).toBe(controller.signal)`.

Preserve all pre-abort, late-result, retry, uncancelled and default-behavior assertions. Do not edit production or any other file, add a matcher test suite, change mocks/defaults or broaden the task. No code mutation experiment is required: the supplied review's source-derived assertion bypass is the diagnosed defect, and the existing actual-wrapper tests must now enforce reference identity. Do not invent a failing product RED when current production is correct.

After these two replacements, format/check only those two files and run once:

node scripts/run-vitest.mjs run tests/openai-cache.test.ts tests/model-index-extraction.test.ts

Consult `npm run arbiter -- test` with process-local GATE_ARBITER=off and GATE_RECEIPTS=off, restore previous values in finally, retain coordinator/offline scrubbing. Save unique raw output/immediate exit and exact before-run input hashes. Use the actual tracked vitest.config.mts, not a guessed .ts path. Fail the input preflight before execution if any required path/hash cannot be read; use PowerShell ErrorActionPreference Stop for the scoped invocation. Record the actual result and skipped count; 29 tests is previous observed coverage, not a result to assume. No repeated successful compiler, Edge, SQL-role, inventory, P04 or other suite is requested for two assertion-only changes. No providers, SQL, worker/server/native extraction, operational calls, real documents, dependency changes, staging or commits.

Freeze all 41 full-range product paths in new U03-implementation-freeze-7.json; only these two test hashes may differ from freeze6. Save a short correction report with exact diff, hashes, command/result and own selected actual model/effort route. Stop all source writes/checks. Controller owns the new candidate commit, full original-range package, evidence qualification and independent corrected-head review. Do not reset the base or label U03/C01 accepted.

You are not alone in the codebase: preserve all other work and never revert others' edits. Do not enumerate protected 1/ or unrelated untracked files; use git status --untracked-files=no. Begin only after controller confirms the candidate2 review wave has finished; no review of moving files.