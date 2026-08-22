### Task 0: Remove the v19 display-only clipping first

**Files:**

- Modify: `src/components/clinical-dashboard/answer-content.tsx`
- Modify: `tests/answer-content.test.ts`
- Modify: `src/components/clinical-dashboard/answer-copy-payload.ts`
- Modify: `tests/answer-copy-payload.test.ts`

**Interfaces:** Consumes the already-finalized v19 lead string. Produces `primaryAnswerDisplayText(value: string, options?: AnswerDisplayTextOptions): string` and `answerTextForClipboard(answer: RagAnswer): string` as one losslessly sanitized display/copy projection with exact screen/clipboard parity; it creates no v20 answer contract.

**Boundary:** This is deliberately independent of adaptive v20. `primaryAnswerDisplayText` becomes lossless sanitation only for the already-governed final lead: no clinical-usefulness filtering, fragment deduplication, three-fragment cap, 85-word budget, or generated ellipsis. It preserves the current sanitizer, synthetic-demo stripping, bold handling, preformatted path, and exact copy/screen parity. It does not render `answerSections`, change a prompt/schema/cache key, introduce a feature lane, or expose a preview.

- [ ] **Step 1: Pin the current regression**

Add a v19-shaped five-sentence finalized answer and prove the current helper drops or truncates it. Add negative cases for source-noise removal, synthetic-demo stripping, preformatted output, and unsafe markup so “lossless” cannot become “raw.”

- [ ] **Step 2: Implement sanitation without selection**

Delete only the fragment selection, usefulness, deduplication, count, word-budget, and ellipsis logic. Return the complete sanitized lead. Keep the canonical copy payload derived from the same finalized answer rather than scraping rendered DOM.

- [ ] **Step 3: Run the focused compatibility gate**

Run:

```text
node scripts/run-vitest.mjs run tests/answer-content.test.ts tests/answer-copy-payload.test.ts
```

Expected: PASS with full v19 lead text on screen and clipboard, unchanged sanitation, and no prompt/retrieval/provider change. Review this as a bounded display fix; do not wait for Tasks 1–6.

---

