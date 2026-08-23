# P02 Australian source governance — Task 3 review attempt 1

## Review identity

- Reviewer: `/root/p02_aus_task3_review1`
- Immutable base: `c6d5ed52eca90ead9c1a088999d2adeb285959d1`
- Immutable head: `36e0e1a6185f169f7e3820587da4aa94877fe396`
- Specification verdict: **FAIL**
- Quality verdict: **FAIL**

## Findings

1. **P1 — Claim-role enforcement is optional and bypassed by both production model-context paths.** `src/lib/australian-source-priority.ts:89,96` makes `claimRole` optional and skips filtering when omitted; neither caller at `src/lib/rag/rag-context-selection.ts:36,61` supplies it. Direct probes returned PBS subsidy evidence and admit the same bypass for eTG/AMH when no role is supplied. Task 3 requires eligibility before ranking.
2. **P1 — Unknown extraction quality can become uploaded-local primary.** `src/lib/source-role-policy.ts:100,115` excludes only `poor`, so `unknown` is treated as acceptable. A direct probe selected an unknown-extraction local guideline as primary. Local-primary needs a positively acceptable extraction state.
3. **P2 — Australian fallback omits the required explicit reason.** The resolver returns Australian primary evidence without a reason field when local evidence is ineligible.
4. **P2 — Conflict ordering is not deterministic.** Conflicts retain `verifiedDifferences` input order; reversing two reviewed differences reverses conflicts and `reviewDocumentIds`. Canonical sorting and duplicate-ID handling are required.

## Checks

- Full-range `git diff --check` — PASS.
- Focused policy/ranking/governance suite — PASS, 5 files / 74 tests, but did not cover these gaps.
- Task 1/2 catalogue/indexing regressions — PASS, 3 files / 27 tests.
- `npm run typecheck` — PASS.
- Read-only probes reproduced all four findings.
- The declared types, difference matching, no-difference case, complete conflict sides, verified-present chunk filtering, and existing catalogue/indexing boundaries otherwise passed.
- Connected currentness remains **UNRUN** and out of scope.
- No edits or external/live actions were performed.

SPEC_VERDICT: FAIL  
QUALITY_VERDICT: FAIL
