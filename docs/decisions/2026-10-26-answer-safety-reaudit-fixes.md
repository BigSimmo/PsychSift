# Decision: Wrong quoted answers go to review, and the crisis banner catches two more phrasings

- **Status:** decided 2026-10-26
- **Source:** `src/lib/rag/rag-extractive-risk-gate.ts`, find "Answer safety re-audit A2R-01"
- **Background:** the owner said "yes to both" in chat on 26 Oct 2026, for findings A2R-01 and A2R-02 in the project-files report `reviews/2026-10-26-clinical-answer-safety.md`.

A2R-01. When the AI draft fails and the answer falls back to a quoted passage, that passage is now
shown as "passages to review", not as a sourced answer, if a dose or threshold quote is about a
different medicine from the one asked about, if search had already reported weak or conflicting
evidence, if a dose figure names no medicine, or if a short subject such as ECT or CTO from the
question is missing from the quote. A high-confidence quoted dose that names no medicine is also
shown for review. The checks are in `src/lib/rag/rag-extractive-risk-gate.ts`. Correct quoted
answers about the medicine asked for (for example lithium level timing) still show. Two audit
answers are not caught by these checks: oral thiamine for Wernicke prevention (right medicine,
wrong route) and the valproate "start at 50%" quote.

A2R-02. The Answer crisis banner now also matches "took all her lithium tablets" (no "of") and
covert-overdose wording such as "hardest to detect if someone took a lot of it"
(`src/lib/crisis-wording.ts`). The 21 Oct accepted known gaps are unchanged.

The protected-search change needs a before and after Eval Canary pair, recorded in
`docs/rag-behaviour/canary-ledger.md`.

If this summary and the source ever differ, the source wins.
