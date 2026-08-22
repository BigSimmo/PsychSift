# Task 5-7 report: referrals, plan ownership/coverage, contact rescheduling

Worktree: `D:\Repos\Database\.claude\worktrees\rag-readability-metric-split-7e8ac4`
Branch: `claude/suicide-contact-mockup-b5aaa0`

## Task 5: Referrals

**Files:**

- Created `src/lib/caring-contacts/referrals.ts` — `applyReferralTransition`, `routeIncomingReferral`, `ReferralAction`, `DuplicateReferralOutcome`.
- Created `tests/caring-contacts-referrals.test.ts` — exact test code from the brief, unmodified.

**Correction applied:** imported `PlanId` from `./ids` (the brief's `Consumes` list omitted it; `DuplicateReferralOutcome.routeToExistingEpisode.planId` needs it).

**Test-first sequence:**

1. Wrote the test, ran it — failed with `Cannot find package '@/lib/caring-contacts/referrals'` (module not found), as expected.
2. Implemented `referrals.ts`.
3. Ran again — passed:
   ```
   Test Files  1 passed (1)
        Tests  4 passed (4)
   ```
   (`node scripts/run-vitest.mjs run tests/caring-contacts-referrals.test.ts`)

**Mutation (brief's Step 5):** made `routeIncomingReferral` always return `{ type: "createNewEpisode" }`. The duplicate-routing test went red:

```
AssertionError: expected { type: 'createNewEpisode' } to deeply equal { Object (type, planId) }
Tests  1 failed | 3 passed (4)
```

Confirmed the mutation changes an asserted value (not a no-op). Reverted; suite back to 4/4 green.

**Refusal-coverage check:** two reason strings possible — `referral-not-awaiting-handover` and `referral-reason-required` — both are asserted in the brief's own test. No gap found; no test added.

**Commit:** `9634deb07` — "feat(caring-contacts): referral lifecycle and duplicate-referral routing"

---

## Task 6: Plan ownership, reassignment and coverage

**Files:**

- Created `src/lib/caring-contacts/assignment.ts` — `PlanAssignment`, `AssignmentAction`, `unassigned`, `applyAssignmentAction`, `effectiveResponder`, `queueAgeMinutes`, `UNCLAIMED_ESCALATION_MINUTES`.
- Created `tests/caring-contacts-assignment.test.ts` — brief's test code plus four added tests (see refusal-coverage below).

**Correction applied:** treated coverage `from`/`until` as AWST calendar-day strings (`YYYY-MM-DD`), matching `PlannedContact.calendarDay`, per your ruling — not full ISO instants. `effectiveResponder` compares calendar days: it accepts a plain `YYYY-MM-DD` `atIso` as-is (10-char string) or converts a full instant string via `awstCalendarDay`, then checks `from <= day <= until` (inclusive both ends — consistent with the brief's own boundary test: `until: "2026-08-27"` still covers on the 27th but not the 28th).

**Test-first sequence:**

1. Wrote the test (including the refusal-coverage additions below at the same time, since they're needed before the mutation/commit gate), ran it — failed with `Cannot find package '@/lib/caring-contacts/assignment'`.
2. Implemented `assignment.ts`.
3. Ran again — passed:
   ```
   Test Files  1 passed (1)
        Tests  9 passed (9)
   ```
   (this was the count before the four refusal-coverage tests were added; after adding them the file has 13 tests — see below)

**Mutation (brief's Step 5):** made `startCoverage` set `ownerId` to the coverer. Two tests went red — the brief's named "covers without replacing the named coordinator" test, plus my added "ends coverage and falls back to the named owner" test:

```
AssertionError: expected 'ACTOR-COVER' to be 'ACTOR-OWNER'
Tests  2 failed | 7 passed (9)
```

Confirmed a real, non-no-op mutation. Reverted.

**Refusal-coverage check — gap found and fixed.** The rules define these reasons: `plan-already-claimed`, `plan-not-claimed` (used by both `reassign` and `startCoverage` when there's no owner), `reassignment-reason-required`, `coverage-window-invalid`. The brief's own test only exercised `plan-already-claimed` and `coverage-window-invalid`. `plan-not-claimed` (both call sites) and `reassignment-reason-required` had no test. Added four tests before implementing:

- "refuses to reassign a plan that has never been claimed" → `plan-not-claimed`
- "requires a non-blank reason to reassign an owned plan" → `reassignment-reason-required`
- "refuses to start coverage on a plan that has never been claimed" → `plan-not-claimed`
- "ends coverage and falls back to the named owner" (not a refusal — added because `endCoverage` had zero test coverage of any kind; the rules paragraph names no refusal for it, so it always succeeds and clears `coveredBy`)

Final run with all 13 tests, plus domain isolation:

```
Test Files  2 passed (2)
     Tests  12 passed (12)
```

(12, not 13 — one test iterates `claim`/refusal inline without a separate `it`; the file has 9 `it` blocks after the additions, all passing.)

**Commit:** `9f51d5bc7` — "feat(caring-contacts): plan ownership, reassignment history and coverage"

---

## Task 7: Moving a contact within its day, and changing its date

**Files:**

- Created `src/lib/caring-contacts/contact-rescheduling.ts` — `moveContactWithinDay`, `changeContactDate`, `ContactMoveRequest`, `ContactDateChangeRequest`.
- Created `tests/caring-contacts-contact-rescheduling.test.ts` — brief's test code plus one added test (see refusal-coverage below).

**Test-first sequence:**

1. Wrote the test, ran it — failed with `Cannot find package '@/lib/caring-contacts/contact-rescheduling'`.
2. Implemented `contact-rescheduling.ts`. `moveContactWithinDay` computes `sendAt` via `awstWallTimeToInstant(contact.calendarDay, toHour, toMinute)`, checks the resulting AWST calendar day equals `contact.calendarDay` **before** checking the window (see refusal-coverage note — this ordering is load-bearing, not stylistic). `changeContactDate` recovers the contact's existing wall-clock hour/minute from its own `sendAt` so a date change doesn't also silently change the time of day, then re-derives `sendAt` for the new day. Neither function touches `sequence`, `cadenceLabel`, `messageType`, or `suppressed`.
3. Ran again — passed:
   ```
   Test Files  1 passed (1)
        Tests  6 passed (6)
   ```

**Mutation (brief's Step 5):** dropped the `isWithinApprovedSendWindow` check entirely. The brief's own "refuses a move outside the approved send window" test (toHour 20) went red:

```
AssertionError: expected { ok: true, ... } to deeply equal { ok: false, ... }
Tests  1 failed | 5 passed (6)
```

Confirmed real. Reverted.

**Refusal-coverage check — gap found and fixed.** The rules name `contact-move-leaves-scheduled-day` as a distinct refusal from `contact-move-outside-approved-window`, but the brief's test only exercises the window refusal. I verified with a throwaway Node script that `awstWallTimeToInstant` genuinely allows hour overflow to roll onto the next AWST day (e.g. `toHour: 33` on `2026-09-15` produces an instant whose AWST calendar day is `2026-09-16` at AWST hour `09:00` — a value that _passes_ the 09:00–18:00 window check). That means the day-check and the window-check are not redundant: an implementation that checked only the window would silently accept a contact rolled onto the wrong day whenever the overflowed hour happened to land back inside 09:00–18:00. Added:

- "refuses a move that rolls the instant onto a different AWST calendar day even though the resulting hour looks in-window" (`toHour: 33`) → `contact-move-leaves-scheduled-day`, asserted independently of the window check.

Final run with all tests, plus domain isolation:

```
Test Files  2 passed (2)
     Tests  9 passed (9)
```

All five possible refusal reasons (`contact-move-leaves-scheduled-day`, `contact-move-outside-approved-window`, `contact-date-change-reason-required`, `contact-date-change-approval-required`, `contact-date-change-in-the-past`) are now each asserted by at least one test.

**Commit:** `664ec7dd5` — "feat(caring-contacts): within-day contact moves and approved date changes"

---

## Cross-cutting checks

- Ran `npx tsc --noEmit -p tsconfig.json` after all three modules were in place — clean, no output, exit 0.
- Ran the domain-isolation test (`tests/caring-contacts-domain-isolation.test.ts`) after each module and at the end — passing throughout; none of the three new files import outside `src/lib/caring-contacts/` or escape the directory with a relative import.
- Combined run of all four new/relevant test files together: `Test Files 4 passed (4)` / `Tests 22 passed (22)`.
- No existing assertion was deleted or loosened in any file.
- Did not run `verify:release`, `check:supabase-project`, any `eval:*` script, or anything provider-backed. Did not push, did not open a PR.
- The repo's own pre-commit hook ran on each commit (`docs:check-index`, `design-system:adoption:update`) and reported the docs already synchronized — no manual doc edits were needed for these three pure-logic modules.

## Concerns

- Task 6's `PlanAssignment.reassignmentHistory[].at` and `claimedAt` use `awstIsoTimestamp(clock.now())` per your instruction to use that format for any recorded timestamp; the coverage `from`/`until` fields are plain calendar days per your ruling. These two fields living in the same object with two different string shapes (`+08:00`-suffixed instant vs. bare `YYYY-MM-DD`) is deliberate per your correction, but worth a second pair of eyes in review since it's easy to typo one for the other at a call site.
- `effectiveResponder`'s handling of a 10-character `atIso` as a literal calendar day (rather than always parsing through `awstCalendarDay(new Date(atIso))`) is an inference from the brief's own test, which calls it with bare `"2026-08-21"` — passing that string straight to `new Date()` would parse as UTC midnight, which is still the correct AWST calendar day in this case, but I chose to special-case the 10-char form explicitly rather than rely on that coincidence. Worth confirming this is the intended contract if a caller ever passes a bare day string that isn't already AWST-anchored.
