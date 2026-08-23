# P02 Australian source governance — Task 3 review attempt 2

## Review identity

- Reviewer: `/root/p02_aus_task3_review1`
- Immutable base: `c6d5ed52eca90ead9c1a088999d2adeb285959d1`
- Immutable head: `e877cd7770f50d775663a3abf8690d13bc68eb49`
- Specification verdict: **FAIL**
- Quality verdict: **FAIL**

## Finding

1. **P1 — Canonical conflict deduplication remains input-order dependent and drops verified supporting evidence.** `src/lib/source-role-policy.ts:245` retains the first conflict for a duplicate ID. Two reviewed differences with the same canonical identity but disjoint verified-present chunk subsets therefore keep different supporting chunks when input is reversed. A direct probe returned the same conflict ID with `local-1`/`au-1` in forward order and `local-2`/`au-2` in reverse order. Deduplication must merge and deterministically sort the union of verified-present local and Australian chunk IDs; reversal tests must compare the complete conflict objects.

## Prior-finding closure and checks

- The original four attempt-1 findings are otherwise closed: mandatory role enforcement and production mapping; PBS/legal/link-only pre-ranking exclusion; unknown extraction blocking; explicit typed primary decisions; simple ordering/dedup; complete conflict metadata and reviewed-difference requirements.
- Full-range `git diff --check` — PASS.
- Maintainability — PASS; `src/lib/rag/rag.ts` remains `4362/4362`.
- A read-only provenance probe reproduced the finding.
- Fresh focused Vitest attempts were admission-rejected by legitimate external leases; this is contention rather than a product result. Implementer evidence remains 106 Task 3 tests, 27 Task 1/2 regressions, and passing typecheck.
- Connected currentness remains **UNRUN** and out of scope.
- No edits or external/live actions were performed.

SPEC_VERDICT: FAIL  
QUALITY_VERDICT: FAIL
