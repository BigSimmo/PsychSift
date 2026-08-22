# Task 5 review: the coordinator rewire

## Verdicts

- **Spec compliance: CHANGES REQUESTED.** Every literal brief item (testid rename, `REFER_TO_UNITS`
  dispatch, cap-at-3 multi-select, `restrictionNotice` with the verbatim strings, refusals section
  present-when-empty) is implemented as specified. But the brief's own framing of this task —
  "the coordinator screen stops rendering a frozen fixture and starts rendering the provider's
  live state" — is violated at the one place it matters most: the on-screen referral record does
  not reflect the provider's actual live state, it reflects an optimistic local guess. See Finding 1.
- **Task quality: CHANGES REQUESTED.** Same defect (Finding 1) is a correctness bug reachable
  through ordinary use, not an edge case, plus a real test-coverage gap on the exact regression the
  implementer found and fixed mid-task (Finding 2), plus a vacuous test (Finding 4).

## Recommendation on the open question (flow-diagram wording)

**Close here as documented, do not treat as a Task 5 defect.** Every `Voluntary` movement in the
current fixture has `security: "Open"` (verified: 6/6), so `isMoreRestrictiveThanRequired`
(`movement.security === "Open" && unit.security === "Secure"`) fires in every case where
`restrictionNotice` would return `voluntary_on_locked` — the diagram is never _wrong_ today, only
less specific (same badge, generic wording, no voluntary-specific callout). `progress.md` already
records `Task 5 defines it, Task 8 renders it` as the planned split, so this isn't a gap that opened
mid-task, it's a scheduled dependency. Residual risk worth naming: `Movement.security` and
`legalStatus` are independent fields, so a future fixture entry with `legalStatus: "Voluntary"` and
`security: "Secure"` would make the diagram _silently wrong_ (no badge at all, where the shortlist
would show the sharpest possible warning) — that's a latent type-level gap, not a live one, and
Task 8 owns closing it by wiring `restrictionNotice` into `flow-diagram.tsx`.

## Findings, most consequential first

1. **`shortlist-panel.tsx` `handleRefer`/`handleOverrideSubmit` (lines ~228–253): the screen
   claims a referral succeeded even when the reducer refused it.** Neither handler checks the
   reducer's outcome before calling `setConfirmation(...)` — it fires unconditionally right after
   `dispatch`. `REFER_TO_UNITS` in `ward-flow-reducer.ts` (line 194) rejects any movement not in
   `placement_requested`/`destination_review`, appending to `rejections` instead of updating
   `movement.referredUnitIds`. Verified live against the reducer: dispatching `REFER_TO_UNITS` for
   WF-004 (stage `bed_held`, open in the queue, 3/3 shortlist candidates eligible) leaves
   `referredUnitIds` unchanged and adds `{reason: "cannot refer a movement while it is bed_held"}`
   to `rejections` — yet a coordinator who selects any of those 3 candidates and clicks the now-
   enabled Refer button sees "Referred by a human coordinator to RPH Adult Secure at ... no bed has
   been allocated automatically." 9 of the fixture's 18 movements sit in a non-referable stage
   (`accepted_awaiting_bed`, `bed_held`, `handover_ready`, `moving`) while still open in the queue,
   so this is half the board, not an edge case — and the false "Referred" text can appear on the
   same page as this task's own new "Refused actions" list showing the true rejection reason for
   the identical click. This is new in Task 5: the pre-Task-5 `handleConfirm` never dispatched
   anything at all (pure local note), so there was no reducer outcome to ignore before this task.
   No test in the diff selects a candidate on a non-referable-stage movement and refers, which is
   exactly why it wasn't caught (the WF-004 coverage in `ui-ward-coordinator.spec.ts` only exercises
   the _no selection made_ path).
2. **`ward-derivations.ts` `eligibleCandidates` (two-pass fix): correct, but the regression it
   fixed has no direct test.** The truncate-then-reorder logic genuinely preserves the candidate
   SET (verified by reading both passes) — this part is sound. But the only thing that caught the
   original membership-changing bug was an incidental Playwright assertion in
   `ui-ward-management.spec.ts` checking one specific unit name (`RPH Adult Secure`) for one
   specific movement (WF-001). `tests/ward-flow-contracts.test.ts`'s calls to `eligibleCandidates`
   all pass `Number.POSITIVE_INFINITY` as the limit, so truncation never engages there. There is no
   unit test asserting "reordering within the top-N never changes which units are in the top-N" as
   a general property — a future edit to the restrictiveness comparator that doesn't happen to
   disturb WF-001/RPH specifically would ship silently.
3. **The new "shows a refused transition" Playwright test (`ui-ward-coordinator.spec.ts`) passes
   vacuously.** It asserts the Exceptions region `.toContainText(/refus/i)` after opening the
   drawer, with zero rejections ever raised in the test. The empty-state copy in
   `exception-drawer.tsx` ("No refused actions recorded yet.") itself contains "refus", so this
   assertion is true before and after any real wiring exists and can never fail on a broken
   refusals list — only on the section's total absence. No test anywhere (unit or Playwright)
   drives a real rejection and checks that a row actually renders with the right `attempted`/
   `reason`/`at` content in newest-first order.
4. **Ambiguity resolutions are reasonable and disclosed, not defects.** The "Refer" vs "Refer to
   selected wards" label choice and the `MORE_RESTRICTIVE_NOTE` text divergence are both
   well-reasoned, correctly prioritize the brief's explicit correction/verbatim blocks, and are
   fully documented in the report — no action needed.

## Constraints checked, no issues found

Button wiring (`aria-disabled` + `ignoreUnavailableActivation` + `title` + `sr-only`, never native
`disabled` alongside it) is followed correctly on both Refer and Override. CSS additions use only
existing design tokens (`var(--danger-*)`, `var(--co-space-*)`); `check:design-system-contract`
passing is consistent with what's in the diff. No `?? array[0]` / `.find()!` non-null assertions
introduced. `PARALLEL_REFERRAL_CAP` is interpolated, not hardcoded, in both the footer note and the
referral record. Candidate membership vs. ordering distinction in `eligibleCandidates` (Finding 2)
is itself correctly implemented, only under-tested.
