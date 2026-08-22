# Task 3 review — the contracts (WF-001 fix round)

Reviewed: `e7faa7b5a..cbdd47f71` (two commits), file under review
`tests/ward-flow-contracts.test.ts`. All mutation checks below were applied one at a time with
`Edit`, run with `npx vitest run tests/ward-flow-contracts.test.ts --reporter=verbose`, the edited
line printed back to confirm it applied, then reverted with
`git checkout -- src/components/ward-management/ward-flow-reducer.ts` and `git status --porcelain`
confirmed clean before the next mutation. Working tree is clean now.

## Verdicts

- **Spec compliance: CHANGES REQUESTED (documentation only).** Functionally the diff delivers
  what the brief needed — a whole-journey walk with seven live invariants — but it is not the
  brief's Step 1 code "verbatim" as instructed: different movement (WF-001 not WF-009), different
  units, an added tenth wrong-role event, and different imports (`eligibleCandidates` in place of
  `unitCapacity`/`eligibility`). That divergence is well-justified and disclosed in-file and in the
  report, but the brief itself (`task-3-brief.md` Step 2) still says "Expected: PASS, 6 tests" against
  code that has seven `it(...)` blocks — a stale brief that nobody has gone back and fixed. Not a
  reason to block the test file, but the brief should be corrected so the next reader isn't misled.
- **Task quality: APPROVED.** All seven invariants are now real, walk-caused checks; I independently
  killed the five I was assigned (below), on top of the two already re-verified by the requester.

## Findings, most consequential first

1. `tests/ward-flow-contracts.test.ts:87` (bed accounting) — genuinely fixed, verified myself.
   Reading `HOLD_BED`'s decrement removed (`value: unit.allocatable.value - 1` →
   `value: unit.allocatable.value`, `src/components/ward-management/ward-flow-reducer.ts:265`) kills
   it (`expected 3 to be 2`). This is the invariant the report flagged as needing an "extreme" bed-
   count corruption in round 0 (routed through the defensive `unitCapacity()` helper); it now reads
   raw `allocatable.value`/`empty.value` before/after each step and dies on a one-word realistic
   omission. Matters because this is the exact invariant the brief calls out by name as having
   shipped a real, un-caught bed-arithmetic bug in Phase 1.
2. `tests/ward-flow-contracts.test.ts:179` (privacy) — genuinely fixed, verified myself. Appending
   `" (diagnosis pending)"` to `ACCEPT_IN_PRINCIPLE`'s withdrawal-reason template
   (`ward-flow-reducer.ts:232`) makes the regex-match assertion itself fail (not just the
   `inspected.length >= 2` tripwire), and `inspected.length` is 39 on the unmutated walk (probed
   independently, not just the ≥2 floor) — the walk's own wrong-role rejection plus its own
   withdrawal are both real, non-forced content this loop inspects, on top of fixture noise.
3. Invariant 1 (parallel cap, `ward-flow-reducer.ts:203`), invariant 3 (ownerless, `:270`), and
   invariant 6 (statutory form vs. examination, `:270`, injecting `legalForm.code = "3B"` with no
   examination) all die on a single realistic line each, confirmed independently. No issues found.
4. Walk shape: confirmed by direct probe (temporary test file, deleted after, `git status
--porcelain` clean) that the unmutated walk reaches `stage: "arrived"` and that
   `state.rejections` has exactly one real entry, not zero — so no assertion in this suite is
   silently guarded by an always-false `if` or looping over an always-empty array. Invariant 6's
   `if (code === "1A")` / `if (code === "3B")` branches are also naturally exercised by other
   fixture movements independent of WF-001 (both codes appear multiple times in
   `ward-movements.ts`), so they are not vacuous even though WF-001 itself never reaches 3B in the
   unmutated walk.
5. Minor: `npx prettier --check tests/ward-flow-contracts.test.ts` and
   `npx tsc --noEmit -p tsconfig.json` (filtered to `src|tests|scripts`) are both clean — no issue,
   just confirming the report's claims rather than taking them on faith.
