# P00 adaptive Task 0 review attempt 1

- Reviewer agent: `/root/p00_adaptive_task0_review1`
- Model: `gpt-5.6-sol`
- Reasoning: `high`
- Review base: `7252eb6312edf634e887578a322c53f23be7ab28`
- Review head: `a2449c536be04d56b4f7e5070e8f2f3011ade201`
- Specification verdict: `FAIL`
- Quality verdict: `FAIL`

## Important finding

Clipboard content does not use the sanitized screen projection. `primaryAnswerDisplayText` sanitizes and removes synthetic-demo text at `src/components/clinical-dashboard/answer-content.tsx:89-97,121-123`, but `buildAnswerRenderModel` builds `copyText` from raw `answer.answer.trim()` at `src/lib/answer-render-policy.ts:766-792`. Product callers then pass that raw-derived payload into `buildAnswerClipboardText` (`src/components/ClinicalDashboard.tsx:3201-3212`, `src/components/clinical-dashboard/answer-thread-turn.tsx:108-115`). For an answer beginning `Source mentions:` and ending `Synthetic demo only:`, the screen contains neither string while the clipboard payload contains both. This violates the required single losslessly sanitized display/copy projection and can paste hidden source noise or synthetic-demo material into clinical records.

The added test cannot catch this: `tests/answer-copy-payload.test.ts:104-113` manually computes `primaryAnswerDisplayText` and injects it as `renderCopyText`, bypassing the actual render-model call path. Direct read-only proof returned:

`{"screen":"Start the prescribed treatment after confirming the indication.","copyHasSourceNoise":true,"copyHasSynthetic":true,"copyHasScreen":true}`

Smallest correction: derive the answer portion of the clipboard payload through the same canonical projection, including preformatted handling and bold-marker removal, and test the real product projection with source-noise and synthetic-demo input.

No Critical or separate Minor findings.

## Pass 1: specification compliance

The screen-side change correctly removes fragment selection, clinical-usefulness filtering, deduplication, three-fragment selection, the 85-word budget, and generated ellipsis. Existing sanitation, synthetic stripping, preformatted normalization, inert markup rendering, and bold handling remain present. The immutable range touches only the display helper and its focused tests; it introduces no v20 sections, prompt/schema/cache, retrieval, or provider behavior.

However, exact screen/clipboard parity and the specified canonical clipboard projection were not implemented. `answer-copy-payload.ts` was not changed, and no `answerTextForClipboard(answer)`-equivalent owner derives copy text from the screen projection.

## Pass 2: quality

Correctness and clinical safety fail because copied clinical text can include content deliberately removed from the visible answer. Test quality also fails to exercise the production path and therefore reports parity without proving it. No new executable-markup or provider/security surface was introduced, and the simplified screen helper is otherwise maintainable.

## Evidence

- Canonical package reviewed: `7252eb6312edf634e887578a322c53f23be7ab28..a2449c536be04d56b4f7e5070e8f2f3011ade201`, one commit, three changed files.
- `git diff --check 7252eb6312edf634e887578a322c53f23be7ab28 a2449c536be04d56b4f7e5070e8f2f3011ade201` — PASS, no output.
- Literal focused wrapper command — BLOCKED, not failed: `Database focused-test capacity is full`; no lease bypass or unchanged retry.
- Implementer-reported GREEN remains 2 files / 24 tests, but was not independently reproduced during this review.
