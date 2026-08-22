# Ward Flow — phase handoff

Durable record of decisions taken while executing the Ward Flow phase plans. The
subagent-driven-development ledger lives in `.superpowers/sdd/<plan>/progress.md`, which is
git-ignored scratch and does **not** survive a session. Anything a later session needs is
copied here.

**Read order for a fresh session:** this file, then
[`docs/superpowers/specs/2026-08-18-ward-flow-metro-patient-flow-design.md`](./superpowers/specs/2026-08-18-ward-flow-metro-patient-flow-design.md),
then the plan for the phase being executed.

---

## Where the build is

Branch `codex/ward-management-design` (PR #2289). Phase 3 is the successor of the #2140 squash on main; constellation remains only as a redirect.

| Phase                                      | Plan                                                                                                                                 | State                                                                                 |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| 1 — the model                              | [`plans/2026-08-18-ward-flow-phase-1-model.md`](./superpowers/plans/2026-08-18-ward-flow-phase-1-model.md)                           | **Complete.** Landed on main via PR #2140; Phase 3 continues that lineage on PR #2289 |
| 2 — coordinator screen                     | [`plans/2026-08-18-ward-flow-phase-2-coordinator-screen.md`](./superpowers/plans/2026-08-18-ward-flow-phase-2-coordinator-screen.md) | **Complete.** Live coordinator plus retired constellation (redirect to network)       |
| 3 — ED, ward and transport officer screens | [`plans/2026-08-19-ward-flow-phase-3-role-screens.md`](./superpowers/plans/2026-08-19-ward-flow-phase-3-role-screens.md)             | **Complete on this branch.** Live reducer, Form 1A→3B, role screens                   |
| 4 — specialist boards and escalation       | not written                                                                                                                          | Not started                                                                           |

Phase boundaries are in §18 of the spec.

## What Phase 1 replaced

One 736-line `synthetic-fixtures.ts` became five focused modules plus a derivations module:

| Module                | Holds                                                                                                                                                                             |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ward-clock.ts`       | `Instant` (minutes since midnight), `minutesUntil`, `clockState`, `formatRemaining` (countdown), `formatElapsed` (elapsed). The **only** module permitted to read the wall clock. |
| `ward-model.ts`       | Domain types only. Seven stages, six decline reasons, `PARALLEL_REFERRAL_CAP = 3`.                                                                                                |
| `ward-eligibility.ts` | Eight gates returning structured verdicts: `authorisation`, `cohort`, `security`, `sex_mix`, `specialling`, `prior_decline`, `capacity_freshness`, `allocatable_bed`.             |
| `ward-sites.ts`       | 17 sites, 8 emergency departments, 22 units. `NOW_ANCHOR = 10 * 60 + 42`.                                                                                                         |
| `ward-movements.ts`   | 48 movements (18 hand-authored, 30 generated deterministically), 6 bed releases.                                                                                                  |
| `ward-derivations.ts` | Shared pure UI derivations. No React, no `"use client"`.                                                                                                                          |

The eight ED ids are `arm-ed`, `fsh-ed`, `jhc-ed`, `peel-ed`, `rgh-ed`, `rph-ed`, `scgh-ed`,
`sjgm-ed`. Anything referencing an id outside `ward-sites.ts` is a defect — the lookups return
`undefined` by design and no longer substitute a different record.

## Rulings taken on the owner's behalf

Each names what it costs if it turns out to be wrong.

**1. `speciallingCapacity`, not `spellingCapacity`.** The Phase 1 plan carried a typo and told a
later task to fix it. Overruled: written correctly from Task 2, so the type, the gate, the
fixtures and three test files never carried it. _Cost if wrong: a rename diff._

**2. Movement origins draw only from the eight defined emergency departments,** and the
hand-authored movements together cover all eight. The plan's generator satisfies the
"exactly 8 distinct origins" assertion on its own, but nothing stopped a hand-authored movement
inventing a ninth. _Cost if wrong: an immediately failing assertion._

**3. The plan's "Expected: PASS (9 tests)" for Task 3 is an arithmetic error in the plan.** Its
own test block defines eight. Accepted eight; the reviewer confirmed byte-for-byte that no test
was dropped. _Cost if wrong: none — the plan contradicted itself._

**4. The conservative-failure test keeps its runtime assertion; only the `@ts-expect-error`
mechanism was replaced** with an explicit `undefined as unknown as LegalStatus` cast. The test
proves real fail-safe behaviour the spec demands; only the type suppression was wrong.
_Cost if wrong: the intent is documented slightly less loudly._

**5. The Task 5 report claims a ruling that was never made** — that hand-authored movements need
not individually cover all eight EDs. Ruling 2 says the opposite. Resolved as moot: the reviewer
confirmed the 18 hand-authored movements do cover all eight before the generator runs. Recorded
so the misstatement is not treated as precedent. _Cost if wrong: none._

**6. The shared derivations were extracted to `ward-derivations.ts`.** Fourteen pure functions
had been placed inside a 991-line `"use client"` component that two other view files imported
from and eight production routes reached transitively. Accepted the reviewer's position over the
implementer's placement. _Cost if wrong: one mechanical move, three import blocks._ Note: I
predicted the extraction would be strictly smaller. It was not — the commit grew by +92 net
because six bug fixes rode along. The extraction itself was a 1:1 relocation.

## Deferred findings that later phases must not inherit blindly

**`WF-009` is framed as an exhausted search but is not one.** Its blocker reads "No secure adult
bed available across the network", yet it declines only three of the seven adult-secure units —
`brm-adult-secure`, `fsh-adult-secure`, `rgh-adult-secure` and `sjgs-adult-secure` are untouched
and would pass the cohort and security gates. **Phase 4's escalation screen reads this record as
a network-wide exhausted search.** Either decline the remaining units explicitly or soften the
blocker text before building that screen.

**Test ids are unit-level, not site-level.** `ward-hospital-FSH` became
`ward-unit-fsh-adult-secure`, because a site can hold up to two units and the old id had to pick
one silently. Any later spec referencing the old ids needs updating.

**Smaller items, recorded but not blocking:** `formatInstant` has no guard for a negative
`Instant`; `clockState` boundary values (0, 59/60, 179/180) are untested; the `DECLINE_REASONS`
test uses `toContain`, so an accidental extra member would pass; the `cohort` and `security` gate
detail strings read identically on pass and fail; `inboxAction` is string-coupled to id prefixes
constructed in another module; the "Exception rules" list advertises a stale-capacity rule
`buildActionInbox` never emits.

## Process lessons worth carrying into Phase 2

**Verify the implementer's typecheck claim every task.** Task 3 reported `tsc --noEmit` clean
when it was not, and the repo stayed red across two tasks before Task 4's implementer surfaced
it. An implementer's report is a claim, including the boring parts.

**Passing tests did not catch a bug on every screen.** `elapsedLabel` fed a past timestamp to a
countdown formatter, so all 48 movements rendered "N overdue" at seven call sites — one of them a
column headed _Wait_. Forty-three tests were green and three reviews had passed. Tests do not
catch things that are plausible but false; looking at the screen does. **Build a screenshot pass
into every screen task in Phases 2–4.**

**A regression test nobody has watched fail is not yet a regression test.** The first attempt at
covering the elapsed bug tested the formatter directly and never called the function that had
been wrong, leaving the actual regression site uncovered.

**`npm run lint` can exit 0 without running,** printing `DATABASE_HEAVY_RUN_ADMISSION_BUSY` when
another heavyweight command holds the lock. Read the output, never the exit code.

**The pre-commit hook regenerates documentation and stops for review.** It will block a commit
until `docs/site-map.md` and `docs/codebase-index.md` are current and staged. It is slow — allow
it minutes rather than killing it.

## Suggested process calibration for Phases 2–4

Phase 1 was the cheapest of the four and still ran to roughly a million tokens on its migration
task alone. Phases 2–4 are all screens. Suggested:

- Full subagent-driven development for anything touching the model or the eligibility gates.
- A single review seat for screen-only tasks carrying no logic.
- Batched dispatches for mechanical route files — four thin route components are one dispatch.
- A screenshot pass per screen task, reviewed by the owner, not only by a subagent.

## Phase 1 closing state

All eight tasks complete and reviewed. The final whole-branch review found 1 Critical and 10
Important defects that the eight per-task reviews structurally could not see, because each looked
at one task's diff. One fix wave closed all of them plus four previously-deferred items, and the
scoped re-review verdicted it clean.

**What the final review caught, and why it matters.** The per-task reviews were not lax — they
found real defects and forced two fix rounds on the migration alone. But interaction defects only
appear when the whole thing is read together:

- **Every eligibility gate rendered with a green tick, including failures.** Two clicks on the
  constellation produced "✓ SJGS Adult Open is not authorised under the Mental Health Act". The
  console rendered the same verdict correctly; only the modes surface did not consult `gate.pass`.
  A green check beside the Act's authorisation gate is the most damaging thing this product can
  display, and no single task's review had both surfaces in view.
- **The five-state bed grid did not reconcile on 10 of 22 units** — `held` and `blocked` were
  counted twice, because `occupied` was derived from `empty`. Three different reconciliation
  readings existed across the code and the tests. The test now asserts through `unitCapacity`
  itself, so the UI formula is what is checked.
- **"48 open movements" counted six arrived and one closed record** — the direct descendant of the
  old fixture's hardcoded 84-against-14, now derived but still mislabelled.
- **Nine movements rendered as `-1:-14`** in the audit timeline, because generated `openedAt`
  values go negative and `formatInstant` did not wrap.
- **Six bed-release blockers carried departing-patient detail** — tribunal, NDIS, family pickup,
  aged care — against the spec's "no detail whatsoever about the departing patient". The guard
  test checked for forbidden _properties_ and never read the free text.

## Findings parked at the close, with rulings

No second fix wave follows a final review, so these are adjudicated rather than fixed.

**The Playwright negative assertion for the gate-icon fix is vacuous.**
`tests/ui-ward-management.spec.ts` asserts `svg.lucide-check-circle-2` has count 0, but
lucide-react emits `lucide-circle-check` for `CheckCircle2` — the asserted class is never rendered
by any icon, so that half passes regardless. _Ruling: parked, not fixed._ The companion assertion
in the same test (`svg.lucide-circle-alert`, count 1) uses the correct class and does fail against
the pre-fix code, so Critical 1 remains genuinely covered. Correct the selector when Phase 2 next
touches that spec. _Cost if wrong: a dead assertion sits beside a live one._

**Two eligibility detail-string tests do not discriminate pre- from post-fix behaviour.** They
compare calls with different inputs, which produced different strings under the old formula too.
_Ruling: parked._ The production fix genuinely adds verdict-stating language and was verified
directly; only the regression tests are weak. _Cost if wrong: the strings could regress silently._

**`handover_ready` generated movements carry no `acceptedUnitId` or transport.** That stage was
not among the four the finding named. _Ruling: accepted as correct._ Every surface shows absence
rather than a fabricated value — TransportView simply omits them, the decision dock says "No
destination selected" — which is the governing principle of the wave. _Cost if wrong: a movement
staged "handover ready" with no recorded acceptance looks odd on close reading._

**Still parked from earlier, unchanged:** `clockState` boundary values untested (implementation
verified correct by reading it); the `DECLINE_REASONS` `toContain` assertion; `inboxAction`'s
coupling to id prefixes built in another module; the `.score` and `.aiBadge` CSS class names that
survive from the deleted scoring concept; `wallClockNow` exported but unused (Phase 2 is its
intended consumer); and `Candidate.rank`'s implied ordinality — `eligibleCandidates` sorts only on
the eligibility boolean, so numbered column headers overstate what the ordering means.

## Phase 1 verification, independently confirmed at the closing head

`tsc --noEmit` exit 0 · 50 unit tests passing across 5 files · design-system contract passing with
no ratchet increase · `npm run lint` genuinely executed (no admission-busy skip) with 0 problems ·
Chromium `ui-ward-management` 6/6.

Not run, deliberately: `verify:ui`, `verify:release`, and every provider-backed gate. Nothing has
been pushed and no PR exists.

## Two traps that make a green result untrustworthy in this repo

**`npm run lint` can exit 0 without running,** printing `DATABASE_HEAVY_RUN_ADMISSION_BUSY` when
another heavyweight command holds the lock.

**A bare `npx playwright test` is rejected** by the repo's config guard ("Playwright requires a
runner-owned local server") — and a backgrounded wrapper still reported exit 0 while the run never
happened. `PLAYWRIGHT_BASE_URL=http://localhost:3718 npx playwright test …` is the working
invocation. Read the output, never the exit code.
