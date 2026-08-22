# Task 8 report — the ward screen

## What was built

- `src/components/ward-management/ward/ward-screen.tsx` — `WardScreen({ unitId })`. One inpatient
  unit's own view, resolved via `unitById(unitId)`.
- `src/components/ward-management/ward/ward.module.css` — a new, self-contained CSS module (own
  local token set on `.screen`, following the same convention as `coordinator.module.css` and
  `ward-management.module.css` — CSS Modules scope per file, so their local tokens are not
  reachable from this one).
- `src/app/ward-management/ward/[unitId]/page.tsx` — the route. Next 16 async `params`
  (`Promise<{ unitId: string }>`), matching `patients/[patientId]/page.tsx`'s exact pattern.
- `tests/ui-ward-roles.spec.ts` — Playwright, two tests (brief's test + R40's).
- `tests/ward-screen.dom.test.tsx` — jsdom, three tests (R38's restriction-notice coverage plus a
  second, independent proof of R40).
- Modified: `playwright.config.ts` (R39a), `docs/design-system/adoption-contract.json` +
  regenerated `ADOPTION.md`/`adoption-manifest.json` (R39b),
  `src/components/ward-management/ward-management-navigation.tsx` (R39c), `docs/site-map.md`
  (regenerated via `npm run docs:update` — the new route was undocumented and failed
  `tests/site-map.test.ts` until I ran it), `docs/codebase-index.md` (small additive entries for
  the new route/component/tests, following the "New-route checklist" in `AGENTS.md`).

### Screen contents

Five regions, all derived fresh from `useWardFlow()`'s live `movements` on every render — no local
"it worked" flag anywhere in the file, the same discipline `ward-flow-queue-selection.dom.test.tsx`
proves for the coordinator screen:

1. **Unit identity** (`ward-unit-card-<unitId>`) — name, site, cohort, security, authorisation.
2. **Bed capacity** (`ward-unit-beds`) — the five-state grid (Ready/Held/Blocked/Occupied/
   Potential) from `unitCapacity(unit)`, plus a `CONFIRM_CAPACITY` form that writes to `unit.id`
   only (captured once as a plain string — `wardUnitId` — so the closures below don't need to
   re-narrow `unit` after the not-found early return; TypeScript doesn't carry narrowing of a
   `const` into a nested function declaration, and this was the one real `tsc` error I hit).
3. **Incoming referrals awaiting an answer** (`ward-incoming-<movementId>`) — movements at
   `destination_review` with this unit in `referredUnitIds`. Each carries `restrictionNotice`
   where it applies, a "Parallel referral" badge when `referredUnitIds.length > 1`, and Accept/
   Decline. Decline opens a `<fieldset>` (accessible name via its `<legend>`, matched by
   `getByRole("group", { name: /Decline reason/ })`) with all seven `DECLINE_REASONS` as radios —
   no free text for the reason itself.
4. **Accepted, held or en route here** (`ward-accepted-<movementId>`) — movements with
   `acceptedUnitId === unit.id`, any open stage from `accepted_awaiting_bed` through `moving`.
   "Hold a bed" renders only at `accepted_awaiting_bed` (never advertised at `bed_held`/
   `handover_ready`/`moving`, where `HOLD_BED` would refuse).
5. **Withdrawn from this unit** (`ward-withdrawn-<movementId>`) — movements whose
   `withdrawnReferrals` names this unit's id, reason and time.

An unresolved `unitId` renders `data-testid="ward-unit-screen"` with an explicit paragraph naming
the id (`&ldquo;{unitId}&rdquo;`) — never a unit card, never a bed grid, never a fallback unit.

### Reducer-precondition wiring (the defect class this phase keeps finding)

Two small local functions mirror the reducer's own guards exactly, so a button can never
advertise an action the reducer would refuse:

- `referralAnswerBlocked(movement, unit)` — the shared precondition for both `ACCEPT_IN_PRINCIPLE`
  and `DECLINE` (`wardFlowReducer.ts`: stage must be `destination_review`, no existing
  `acceptedUnitId`, unit must be in `referredUnitIds`).
- `holdBlockedReason(movement, unit)` — `HOLD_BED`'s remaining guards once already rendered at
  `accepted_awaiting_bed` (accepted at _this_ unit, and `unit.allocatable.value > 0`).

Both follow `shortlist-panel.tsx`'s `aria-disabled` + inert `onClick` + `title` + `sr-only`
pattern, never native `disabled` for this case (reserved for the decline-reason submit button,
which is genuinely transient form-validity gating — `disabled={!declineReason}` — matching the
"form action awaiting validity" exception in the brief).

## Which pair I used for the restriction-notice coverage, and how I confirmed it

**WF-301 referred to `rph-adult-secure`** — the same pair `tests/ui-ward-coordinator.spec.ts`'s
"gives a voluntary patient on a locked ward its own, more prominent notice on the diagram" test
already pins for the diagram (that test's own comment documents the fixture measurement: 26
Voluntary movements exist, 4 of them are also `security: "Secure"` — WF-301, WF-308, WF-322,
WF-329 — and WF-301's cohort is Adult, so all three of its shortlisted candidates are the Secure
adult wards).

I independently re-verified this rather than trusting that comment:

- `bty-adult-secure` (the brief's own chosen unit) genuinely cannot exercise either notice level:
  its one live seed referral, WF-017, is `legalStatus: "Involuntary inpatient"` / `security:
"Secure"` — `restrictionNotice` requires either `movement.security === "Open"` or
  `movement.legalStatus === "Voluntary"` against a Secure unit, and WF-017 satisfies neither. I
  confirmed this by grepping every `referredUnitIds`/`acceptedUnitId` reference to
  `bty-adult-secure` in `ward-movements.ts` — WF-017 (`referredUnitIds`) and WF-004
  (`acceptedUnitId`, `legalStatus: "Involuntary inpatient"`) are the only two, neither Voluntary.
- WF-301 is a **generated** movement (`routineMovements`, index 301). Both its `security` and its
  `stage` derive from `index % 7`: `security: "Secure"` requires `index % 7 === 0`, and
  `MOVEMENT_STAGES[index % 7]` is `"placement_requested"` at that same remainder — so a generated
  Secure movement is _always_ seeded at `placement_requested`, never already referred anywhere.
  That means no fixture data has a Voluntary+Secure pair already _referred_ to a unit at seed —
  the notice has to be produced by a real dispatch, not read off the static fixture.
- In `tests/ward-screen.dom.test.tsx` I dispatch a real `REFER_TO_UNITS` (role `coordinator`,
  `movementId: "WF-301"`, `unitIds: ["rph-adult-secure"]`) from a sibling component — the same
  "dispatch a real event, then re-read the target component" technique
  `ward-flow-queue-selection.dom.test.tsx` uses — and assert `ward-restriction-notice-WF-301`
  appears in `WardScreen`'s incoming-referral list for `rph-adult-secure`, with
  `data-level="voluntary_on_locked"` and the exact `restrictionNotice` wording ("Voluntary patient
  on a locked ward — review legal status before admission").
- A leading guard test in the same file re-asserts the three underlying facts directly against
  `movementById("WF-301")` and `unitById("rph-adult-secure")` (`legalStatus === "Voluntary"`,
  `security === "Secure"` on both sides) — mutation-tested below, so the pair can't silently stop
  being the case the fixture describes without the suite going red.

## How I handled the unresolved-id case

Two independent tests, both mutation-killed by the same single implementation defect (see below):
`tests/ui-ward-roles.spec.ts`'s "names an unresolved unit id..." (real browser, real route,
`nonexistent-unit-does-not-exist`, confirmed via `unitById()` in the test itself to genuinely
resolve to nothing) and `tests/ward-screen.dom.test.tsx`'s "names bty-adult-secure's unresolved id
when the route carries one..." (component-level, jsdom). Both assert the id appears in real
visible text inside `ward-unit-screen`, and that no `ward-unit-card-*` or `ward-unit-beds` element
is ever rendered for that route.

## Gates run, with decisive output

- `npx tsc --noEmit -p tsconfig.json` → clean, exit 0, no output, confirmed twice (once before and
  once after the mutation-testing edits below).
- `npm run lint` → `LINT_EXIT=0`, real ESLint output (the target-file list line printed, no
  `DATABASE_HEAVY_RUN_ADMISSION_BUSY` marker, no error lines), run three times across the session
  (before mutation testing, after, and after the final doc edits) — every run genuinely executed.
- `npx prettier --check` on every changed/added file (and `--write` beforehand) → "All matched
  files use Prettier code style!" after formatting.
- `npx vitest run tests/playwright-project-isolation.test.ts` → **`Test Files 1 passed (1)` /
  `Tests 4 passed (4)`** — proves the `ward-(?:management|coordinator|roles)` edit landed in
  both `testMatch` and `productionSpecPattern`.
- Node-env suite, one invocation, full repo (`npx vitest run --project node`) → **`Test Files 4
failed | 498 passed | 2 skipped (504)` / `Tests 4 failed | 5665 passed | 27 skipped (5696)`**,
  re-run identically after all further edits with the same 4-file/4-test failure count. All four
  failures are pre-existing and unrelated to this task — see "Pre-existing failures" below. A
  ward-scoped subset (`npx vitest run --project node tests/ward`) is **`Test Files 14 passed (14)`
  / `Tests 186 passed (186)`** — every ward-prefixed `.test.ts` file green, including my
  regenerated `docs/site-map.md` fix.
- jsdom `.dom.test.tsx`, one file per invocation:
  - `ward-flow-clock-consistency.dom.test.tsx` → `1 passed (1)` (baseline: 1)
  - `ward-flow-provider.dom.test.tsx` → `4 passed (4)` (baseline: 4)
  - `ward-flow-queue-selection.dom.test.tsx` → `1 passed (1)` (baseline: 1)
  - `ward-screen.dom.test.tsx` (new) → `3 passed (3)`
- Browser gate, chromium only, `PLAYWRIGHT_BASE_URL=http://localhost:3718`, warmed with `curl`
  first (`bty-adult-secure` cold-compiled at 3.4s, confirmed 200):
  `npx playwright test --project=chromium tests/ui-ward-coordinator.spec.ts
tests/ui-ward-management.spec.ts tests/ui-ward-roles.spec.ts` → **`28 passed (1.5m)`** —
  baseline 26 (measured at `d819ad9fd`) + my 2 new tests, run twice (once mid-session, once as the
  final post-mutation-testing confirmation), identical result both times.
- Did **not** run `verify:ui`, `verify:release`, the guard-push suite, or `check:bundle-budget` —
  prohibited/out of scope per the task instructions.

## Mutation testing — every added test, edit printed back, killed, reverted

**1. `ui-ward-roles.spec.ts` "shows one unit's own capacity and answers an incoming referral" —
mutation A (kills the `not.toHaveCount(0)` incoming-referral assertion).**
Edited `ward-screen.tsx` line 106, read back:

```
      false && isOpen(movement) && movement.stage === "destination_review" && movement.referredUnitIds.includes(unit.id),
```

Ran → failed: `Expected: not 0` / `Received: 0` (the incoming locator resolved to zero elements).
Reverted, read back: `isOpen(movement) && movement.stage === "destination_review" && ...`. Re-ran →
`1 passed (1)`.

**1b. Same test — mutation B (kills the decline-reason assertion specifically).**
Edited line 293, read back:

```
                          {DECLINE_REASONS.filter((reason) => reason !== "out_of_catchment").map((reason) => (
```

Ran → failed: `Expected pattern: /out of catchment/i` / `Received string: "Decline reason for
WF-017no bedsex mixspecialling unavailable..."` (the reason is genuinely absent from the group's
text). Reverted, read back: `{DECLINE_REASONS.map((reason) => (`. Re-ran → `1 passed (1)`.

**2. `ui-ward-roles.spec.ts` "names an unresolved unit id..." AND
`ward-screen.dom.test.tsx` "names bty-adult-secure's unresolved id..." — one mutation kills both.**
Edited the not-found paragraph in `ward-screen.tsx`, read back:

```
            No synthetic unit matches the requested id. It may have been renamed or removed, or the id in the address
            is incorrect — this never falls back to a different ward.
```

(removed the `{unitId}` interpolation). Ran the Playwright test → failed: `Expected substring:
"nonexistent-unit-does-not-exist"` / `Received string: "...matches the requested id..."`. Ran the
dom test → failed the same way: `Expected element to have text content: does-not-exist-in-the-
fixture` / `Received: ...matches the requested id...`. Reverted, read back:
`No synthetic unit matches &ldquo;{unitId}&rdquo;. ...`. Re-ran both → Playwright `2 passed (2)`
(full file), dom `3 passed (3)` (full file).

**3. `ward-screen.dom.test.tsx` "renders the sharper voluntary-on-locked notice..." — mutation
kills the notice-presence assertion.**
Edited line 216 (the incoming-section `notice` derivation), read back:

```
                const notice = undefined;
```

Ran → failed: `getByTestId('ward-restriction-notice-WF-301')` unable to find the element (full
DOM dump attached by the failure, confirming the element is genuinely absent). Reverted, read
back: `const notice = restrictionNotice(movement, unit);`. Re-ran → `3 passed (3)`.

**4. `ward-screen.dom.test.tsx` "fixture assumption: WF-301 is Voluntary and RPH Adult Secure is
Secure..." — mutation kills the guard itself.**
This test asserts fixture facts directly, not `WardScreen` output, so its mutation is the fixture
field it checks. Edited `ward-sites.ts` line 26 (`rph-adult-secure`'s own `security` field), read
back: `security: "Open",`. Ran → failed: `AssertionError: expected 'Open' to be 'Secure'`.
Reverted immediately, read back: `security: "Secure",`. Confirmed `git diff --stat
ward-sites.ts` empty (no residual change) and the full dom suite green again (`3 passed (3)`).

Every mutation was killed by the test it targeted. None survived; none needed reformulating.

## Pre-existing failures found in the full node suite — none caused by this task

All four verified against the file each names, not assumed:

1. **`tests/contextual-back-navigation-contract.test.ts`** — flags
   `components/ward-management/ward-management-console.tsx`, a file I never opened or edited.
2. **`tests/design-system-adoption.test.ts`** — `expect(manifest.routeCoverage.discovered).
toHaveLength(51)` fails against a live count of 61. This task's own route addition accounts for
   at most 1 of that 10-route gap; the other 9 predate me (the hardcoded `51` and its explanatory
   comment about "Presentations catalogue page plus a real Compare page" describe a much earlier
   state of the app than what's on disk now). The two adjacent self-consistency checks in the same
   test (`declared === discovered`, both `undeclared` and `missing` empty) all passed — only the
   stale magic number is red.
3. **`tests/playwright-pr-shards.test.ts`** — `scripts/playwright-pr-shards.mjs`'s own
   `productionSpecFilePattern` has never contained a `ward-*` alternative at all (verified by
   reading the regex directly), while `playwright.config.ts`'s `productionSpecPattern` already had
   `ward-(?:management|coordinator)` before I touched anything (per the addendum, confirmed by
   `git show` on the pre-Task-8 head). So `ui-ward-coordinator.spec.ts` and
   `ui-ward-management.spec.ts` were already causing this exact mismatch before my `|roles`
   addition — my change adds a third already-mismatched file to an already-red assertion, it
   doesn't create the redness. Out of scope for this task (not in the addendum's file list); I did
   not touch this script.
4. **`tests/session-start-hook.test.ts`** — matches the user's own recorded memory note: a known
   Windows-environmental failure on this machine (Linux-path assertions against a Windows
   filesystem), unrelated to any application code.

I did not fix #1, #3, or #4 (out of scope for this task; #3 is a good candidate for a small,
separately-scoped follow-up since it's the exact same "keep the ward regex copies in sync" pattern
R39a already had me fix in two places). #2 is unrelated to Task 8's route count contribution
beyond the 1 route I legitimately added.

## The screenshot

`artifacts/ward-management/phase3-ward.png` (1440×1600, `bty-adult-secure`, taken with a scratch
Playwright script written into the repo and deleted immediately after). What it shows, checked
against the raw fixture (`ward-sites.ts`) rather than eyeballed:

- **Every number belongs to this ward and no other.** Header reads "BTY Adult Secure /
  Bentley Health Service (BTY) · Adult · Secure" — nothing from any other unit is on screen.
- **The bed grid is internally consistent.** Ready 2, Held 0, Blocked 1, Occupied 14 — sums to 17,
  and the unit's own `beds: 17` in `ward-sites.ts` confirms it, plus the on-screen note states the
  same sum in words. Potential 1 matches the one `bedReleases` entry (`WR-005`) whose `unitId` is
  `bty-adult-secure`. The capacity-confirm line reads "Currently confirmed 2 at 10:28" — the
  fixture's `allocatable = { value: 2, confirmedAt: NOW_ANCHOR - 14 }` and `NOW_ANCHOR - 14 = 628 =
10:28`, so that line is also independently correct.
- **An incoming referral's available action is obvious.** WF-017 (Adult · Secure · Male ·
  Involuntary inpatient, 6h 40m waiting) shows "Accept in principle" and "Decline" both fully
  enabled (not greyed) — correct, since it genuinely sits at `destination_review` with
  `bty-adult-secure` in its `referredUnitIds`. No restriction notice renders for it, correctly —
  Involuntary + Secure produces neither notice level.
- **An unavailable action's reason would be legible had one been unavailable on this screen** —
  none was, because WF-004 (the unit's only "accepted, held or en route" entry) sits at
  `bed_held`, so the "Hold a bed" control correctly does not render at all for it rather than
  rendering disabled; instead the card states "Bed hold 10m overdue", matching the fixture's
  `bedHeldUntil: NOW_ANCHOR - 10` exactly. The unresolved-id and the reducer-refusal
  (`aria-disabled` + reason) paths are proven by the tests above, not by this particular
  screenshot, since bty-adult-secure's seed data doesn't happen to exercise a blocked control.
- Withdrawn section correctly reads "No referral to BTY Adult Secure has been withdrawn" —
  verified against the fixture: only `fsh-adult-secure` (WF-006) and `scgh-older-adult` (WF-018)
  carry non-empty `withdrawnReferrals` at seed, and neither names `bty-adult-secure`.

## Not run / not done

- Did not touch `scripts/playwright-pr-shards.mjs` (pre-existing, out of scope — see above).
- Did not rewrite `docs/ward-management-mode-map.md`. It is already substantially stale relative
  to Phase 3 (still describes the pre-reducer, read-only prototype and points at the superseded
  2026-08-18 design spec, not 2026-08-19's role-screens design) — this predates Task 8 and spans
  Tasks 1-7's own additions (coordinator screen, mutable state) as well, so a proper rewrite is a
  separate, larger documentation task rather than something to fold into this one.
- Did not run `check:bundle-budget`, `verify:ui`, `verify:release`, or anything provider-backed —
  prohibited by the task instructions.
- Committed (brief's Step 6): `171adb69a` on `codex/ward-management-design`, on top of `88de39285`.
  Staged by exact path (never `git add -A`), 12 files changed. The pre-commit hook re-ran
  `sitemap:update`, `docs:check-index` and `design-system:adoption:update` and reported
  "Documentation is synchronized" with no further diff — confirming the manual `npm run
docs:update` and `design-system:adoption:update` runs earlier in the session were already
  complete and current. Did not push and did not open a PR, per "Work here. Do not create a
  branch, do not push, do not open a PR."
