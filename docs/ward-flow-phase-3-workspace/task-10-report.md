# Task 10 report — the coordinator's live tracker

Commit: `b2e0a92aa` on `codex/ward-management-design`. Worktree:
`C:\Users\joshs\.codex\worktrees\ward-management-design\Database`.

## Files

- Created `src/components/ward-management/tracker/live-tracker.tsx` — the screen.
- Created `src/components/ward-management/tracker/live-tracker.module.css` — its CSS module.
- Created `src/components/ward-management/tracker/tracker-derivations.ts` — the screen's own
  pure rendering helpers (`trackerRowState`, `stampAgeText`).
- Created `tests/tracker-derivations.test.ts` — node-environment unit coverage over those
  helpers.
- Modified `src/app/ward-management/transport/page.tsx` — mounts `LiveTracker` instead of
  `WardModeWorkspace mode="transport"`.
- Modified `tests/ui-ward-roles.spec.ts` — appended the brief's Step 1 test verbatim plus one
  strengthening test.
- Modified `docs/codebase-index.md` — added a Task 10 clause to the existing Ward Flow
  "Surfaces" bullet, matching the Task 8/9 precedent already there.
- Regenerated `docs/design-system/adoption-manifest.json` (auto, via
  `npm run design-system:adoption:update`, run by the pre-commit hook). `adoption-contract.json`
  itself produced **zero diff** — the route was already declared with `routeRoots: true`, which
  walks live from `transport/page.tsx`'s own imports, so no manual registration was needed. I
  confirmed this by running the generator myself before committing and diffing the file.

## My own re-measured leg distribution (branch head `1349c213f`, re-confirmed at commit time)

Measured by running the real fixture and derivations through `npx tsx`, not by reading the code —
per the standing rule in this phase (ruling R37) that fixture claims made incidentally are the
recurring failure mode. Script written under `artifacts/probe/` (gitignored) and deleted
afterwards; `git status --porcelain` shows no trace of it.

- **48 movements total. 41 open, 7 closed** (`isOpen()`).
- **8 open movements carry a transport job. 0 closed movements carry one.** So "every open
  movement with a transport job" and "every movement with a transport job" are the same 8 rows
  today.
- **33 of the 41 open movements have no transport job at all.**
- Leg distribution among the 8 (via `transportLeg`): **Accepted = 2** (WF-005, WF-015),
  **Collected = 6** (WF-006, WF-014, WF-306, WF-313, WF-320, WF-327). **Zero** at Requested, En
  route, Arrived, or Cancelled.

This differs from the task-10 preflight document's own numbers (`acceptedAt` on 8, `enRouteAt` on
6, no `collectedAt` anywhere) because that document predates the fixture fix at `1349c213f`
("give every in-transit patient the collection its stage implies") — the six previously
"en route" jobs now also carry `collectedAt` and render as `Collected`. I did not carry the
preflight's numbers forward; the numbers above are my own fresh measurement against the branch
this task actually lands on.

## Do transport-less movements appear on the tracker, and why

**No — the tracker's rows are exactly the movements that carry a transport job.** The other 33
open movements are not rendered as rows at all; they are named as a count in the governance
banner at the top of the screen: "33 of 41 open movements have no transport job at all right now
and are not listed below: there is no vehicle yet to track for them" (the exact numbers are
computed live from `movements`, never hard-coded in the component).

Reasoning:

1. `TransportJob` is the model's only concept of "a vehicle" — the reducer's `HANDOVER_READY`
   case is the only thing that ever creates one. A movement with no transport job has no vehicle,
   so a "live tracker of every vehicle" (spec §7's own phrase) has nothing to report for it beyond
   its absence.
2. Precedent already in the codebase points the same way: the **prior** `/transport` route
   (`TransportView` in `ward-management-modes.tsx`, now unreachable — see "Concerns" below) already
   filtered to `patient.transport !== undefined`, and Task 9's officer screen filters to movements
   with a transport job for the same reason ("no officer identity exists in this model" — the
   analogous move here is "no vehicle exists for this movement").
3. Rendering all 33 as rows would force a choice between fabricating a leg for them (explicitly
   forbidden) or adding a second, non-leg row shape to a screen whose entire job is "leg + age" —
   diluting the one thing the screen is for.

The Global Constraint's own wording — "a movement with no transport shows an explicit absence,
never a fabricated leg" — is honoured by the banner: it is the explicit absence, stated in real,
computed-live text, rather than either a fabricated leg or a silent, undocumented drop.

## How the weak brief assertion was strengthened

Chose **node-environment unit tests over the rendering helper** (the brief's second option), not
driving a job forward through real dispatches inside the Playwright test. Reasoning: the fixture
only ever exercises 2 of 5 legs end to end (see above), and the two-leg gap is specifically about
the _tracker's own rendering decision_ (`trackerRowState`/`stampAgeText`), not about the reducer
(driving dispatches would prove the reducer transitions correctly, which is already covered
elsewhere, not that the tracker renders every leg correctly). `transportLeg` itself already has
full precedence coverage in `tests/ward-derivations.test.ts` — `tracker-derivations.test.ts`
deliberately does not re-test that precedence chain, only the two things this screen adds beyond
it: which stamp field corresponds to which leg, and how "since" is worded when no stamp exists.

`tests/tracker-derivations.test.ts` — 10 tests:

- `trackerRowState`: absence (undefined transport), all five legs, and Cancelled — 7 cases, each
  constructing its own `TransportJob` so the fixture's two-leg limitation never touches this file.
  The En route/Collected/Arrived/Cancelled cases each set multiple stamp fields at once (e.g. En
  route sets both `acceptedAt` and `enRouteAt`) specifically so a field-swap bug (reading the wrong
  stamp for a given leg) would be caught, not just a missing-branch bug.
- `stampAgeText`: the absence sentence (contains "since", not "ago"), the elapsed-duration case
  (contains "ago"), and the clock-skew clamp (`stampAt` after `now` never renders negative).

Also strengthened the browser-level test itself, beyond just appending the brief's Step 1
verbatim: added a second Playwright test that pins the exact row count (`toHaveCount(8)`, not
`> 0`) and asserts the banner's exact "33 of 41" text — so a filter regression that silently widens
or narrows which movements count as "a vehicle" fails at the browser level too, not only in the
node-environment suite.

## Gates run, with decisive output

- **`npx tsc --noEmit -p tsconfig.json`** — run twice (once after the initial build, once after
  all mutations were reverted and Prettier reformatted). Both times: no output, clean exit.
- **`npm run lint`** — run twice (before and after Prettier reformatting). Both real runs, not
  soft-skips: exit 0 both times, and both echoed the inner command with no
  `DATABASE_HEAVY_RUN_ADMISSION_BUSY` marker:
  `node --max-old-space-size=8192 ./node_modules/eslint/bin/eslint.js src tests scripts worker
supabase playwright eslint.config.mjs next.config.ts playwright.config.ts
playwright.visual.config.ts vitest.config.mts --max-warnings 0 --no-error-on-unmatched-pattern
--cache --cache-location node_modules/.cache/eslint/`
- **Node-environment ward suite, one invocation** (baseline 129 passed / 10 files):
  `npx vitest run tests/ward-flow-reducer.test.ts tests/ward-flow-contracts.test.ts
tests/ward-model-phase3.test.ts tests/ward-model.test.ts tests/ward-flow-single-source.test.ts
tests/ward-clock.test.ts tests/ward-priority.test.ts tests/ward-pressure.test.ts
tests/ward-derivations.test.ts tests/ward-management.test.ts tests/tracker-derivations.test.ts`
  Decisive line: **`Test Files  11 passed (11)` / `Tests  139 passed (139)`** — 129 + 10 new,
  file count 10 → 11 (the new file), matching exactly. Run twice (before mutation testing and
  after all reverts); identical result both times.
- **jsdom files, one per invocation** (all match baseline exactly, none touched by this task but
  run to prove nothing broke):
  - `tests/ward-screen.dom.test.tsx` → `Test Files 1 passed (1)` / `Tests 3 passed (3)`
  - `tests/ward-flow-clock-consistency.dom.test.tsx` → `1 passed (1)` / `1 passed (1)`
  - `tests/ward-flow-provider.dom.test.tsx` → `1 passed (1)` / `4 passed (4)`
  - `tests/ward-flow-queue-selection.dom.test.tsx` → `1 passed (1)` / `1 passed (1)`
- **Ward Chromium gate, chromium only** (baseline 30 passed):
  `PLAYWRIGHT_BASE_URL=http://localhost:3718 npx playwright test tests/ui-ward-coordinator.spec.ts
tests/ui-ward-management.spec.ts tests/ui-ward-roles.spec.ts --project=chromium --reporter=line`
  Decisive line: **`32 passed (1.4m)`** on the first run (before Prettier), **`32 passed (3.0m)`**
  on the re-run (after Prettier reformatted the touched files) — 30 baseline + 2 new Live tracker
  tests. Includes `tests/ui-ward-management.spec.ts`'s "opens every Ward Flow mode" test, which
  depends on the tracker's root carrying `data-testid="ward-mode-transport"` (added specifically
  so this pre-existing shared test would not break now that the route no longer mounts
  `WardModeWorkspace`) — it passed both runs.
- **Route warmed with `curl` before Playwright**: all three touched routes (`/ward-management`,
  `/ward-management/transport`, `/ward-management/transport/officer`) already returned `200` in
  under 0.25s — the dev server had them compiled from earlier work in this session, so no
  first-compile risk was present.
- **`node -e '…http.get…'` liveness check** — `status 200` before any Playwright run.
- **`npx vitest run tests/route-reachability.test.ts`** — `5 passed (5)`, confirming the rewritten
  route is still reachable and the pre-existing nav link is untouched.
- **`npx vitest run tests/design-system-adoption.test.ts`** — 49 passed, 2 failed. Both failures
  are the **pre-existing, disclosed** ones (stale hard-coded route count `51` vs. discovered `62`;
  a 30s provenance-check timeout) — neither is new, neither is caused by this change (I made no
  route additions/removals; the count mismatch is unrelated to the tracker rewrite).
- **`npm run sitemap:update`** — `Updated docs/site-map.md`, then confirmed `git diff --stat
docs/site-map.md` was empty (no content change; the route already existed with the same path).
- **`node scripts/generate-design-system-adoption.mjs --write`** — `54 components, 77 roots`, and
  `docs/design-system/adoption-contract.json` produced zero diff (confirmed via
  `git status --porcelain`). Only `adoption-manifest.json` (the generated per-route detail, not the
  hand-maintained contract) changed, correctly reflecting that `transport/page.tsx` no longer
  imports the `WardModeWorkspace` sanctioned pattern.
- **Pre-commit hook** (`sitemap:update`, `docs:check-index`, `design-system:adoption:update`) ran
  automatically on `git commit` and reported "Documentation is synchronized" — no scoped override
  needed, commit completed on the first attempt in well under two minutes.
- **Not run**: `npm run verify:ui`, `npm run verify:release`, the three-browser Playwright set, or
  anything touching OpenAI/Supabase/GitHub Actions/a live database — all explicitly prohibited by
  the task.

## Mutation testing — every mutation, line printed back, result

All applied with `sed -i` directly against `tracker-derivations.ts`, printed back with
`sed -n`/`grep`, run against `tests/tracker-derivations.test.ts` only (for speed — the full
11-file node suite was re-run clean after every mutation was reverted, see above), then reverted
and the revert also printed back.

**Mutation 1 — `"Requested"` branch returns a fabricated stamp.**
Line 51 changed to `return { leg, stampAt: 999 };`. Printed back before running.
Result: **killed** — `returns the Requested leg with no stamp…` failed:
`expected { leg: 'Requested', stampAt: 999 } … stampAt: undefined`. 9/10 passed. Reverted,
printed back.

**Mutation 2 — `"En route"` branch reads `acceptedAt` instead of `enRouteAt`.**
Line 47 changed to `return { leg, stampAt: transport.acceptedAt };`. Printed back before running.
Result: **killed** — `returns the En route leg with enRouteAt as its stamp, not acceptedAt`
failed: `expected … stampAt: 100 … to deeply equal … stampAt: 120`. 9/10 passed. Reverted, printed
back.

**Mutation 3 — `"Cancelled"` branch reads `acceptedAt` instead of `cancelledAt`.**
Line 41 changed to `return { leg, stampAt: transport.acceptedAt };`. Printed back before running.
Result: **killed** — `returns the Cancelled leg with cancelledAt as its stamp, even when earlier
stamps exist` failed: `expected … stampAt: 100 … to deeply equal … stampAt: 125`. 9/10 passed.
Reverted, printed back.

**Mutation 4 — `stampAgeText` drops the `Math.max(…, 0)` clamp.**
Line 65 changed to ``return `${splitDuration(now - stampAt)} ago`;``. Printed back before
running.
Result: **killed** — `never renders a negative duration when the stamp is after now` failed:
`expected '-20m ago' to be '0m ago'`. 9/10 passed. Reverted, printed back.

**Mutation 5 — `stampAgeText` absence branch drops "since".**
Line 64 changed to `return "No timestamp recorded yet";`. Printed back before running.
Result: **killed** — `names the absence explicitly, in prose containing 'since'…` failed:
`expected 'No timestamp recorded yet' to match /since/i`. 9/10 passed. Reverted, printed back.

**Mutation 6 — `trackerRowState`'s absence guard fabricates a `"Requested"` leg for a movement
with no transport at all.**
Line 38 changed to
`if (!transport || leg === undefined) return { leg: "Requested", stampAt: undefined };`.
Printed back before running.
Result: **killed** — `returns an explicit absence for a movement with no transport job at all`
failed: `expected { leg: 'Requested', … } … to deeply equal { leg: undefined, … }`. 9/10 passed.
Reverted, printed back.

**6 of 6 mutations killed.** No survivor, so there is nothing to diagnose as mistimed-vs.-
untestable — every assertion added in this task is load-bearing and every mutation I judged
should kill a test did. Confirmed the file matched its pre-mutation state after all six reverts by
re-running the full 11-file node suite (`139 passed (139)`, identical to the pre-mutation run) and
by diffing `tracker-derivations.ts` line-by-line against what was written originally.

## Screenshot

`artifacts/ward-management/phase3-tracker.png`, 1440×1024, captured with a standalone script
(`artifacts/probe/screenshot-tracker.mjs`, driving `playwright`'s `chromium.launch()` directly
against the running dev server) — deleted afterwards along with the rest of `artifacts/probe/`;
`git status --porcelain` shows no trace.

**My own description, having looked at it:**

- At a glance you _can_ tell which patients are "actually moving" versus "merely waiting", but
  only by reading the leg badge text (`ACCEPTED` vs. `COLLECTED`), not by colour — both badges use
  the same accent-blue styling today, because the seed fixture happens to contain no `Cancelled`
  job (the only leg this screen styles distinctly, in the danger/red tokens). The text itself is
  legible: bold, uppercase, top-right of each card, immediately next to the patient id.
- No row implies a leg it has not reached. Each card shows exactly one leg badge and one "Last
  stamp" line computed from that same leg's own real stamp — e.g. WF-005 shows `ACCEPTED` / "30m
  ago" (the time since `acceptedAt`, nothing about it implies departure), WF-006 shows `COLLECTED`
  / "7m ago" (time since `collectedAt`, correctly implying the patient is now in the vehicle).
  Origin department, destination unit and provider are also all resolved from real fixture data,
  with the same explicit-absence fallback pattern the officer screen uses if a lookup ever fails.

Noted as a genuine (non-blocking) observation, not a defect: since the seed fixture never exercises
`Cancelled` or the zero-stamp `Requested` leg in the live screen today, their visual treatment
(danger-red badge for Cancelled; the "No timestamp recorded since this job began" sentence for
Requested) is only proven by the node-environment unit tests and by directly inspecting the CSS
class logic in `live-tracker.tsx`, not by this screenshot.

## Concerns / follow-up

- **`TransportView` and the `mode === "transport"` branch in `ward-management-modes.tsx` are now
  unreachable via routing** — no page mounts `WardModeWorkspace mode="transport"` any more. I left
  this file untouched: it is not in the brief's "Files" list (Create `live-tracker.tsx`; Modify
  `transport/page.tsx`, `tests/ui-ward-roles.spec.ts`), and per this repo's dead-code policy a
  reachability scan alone is "necessary and nowhere near sufficient" — deleting it would need
  `npm run check:dead-code-candidate -- --diff origin/main` and a deliberate decision outside this
  task's scope. Flagging it here rather than silently leaving it undocumented.
- Exact numbers pinned in the new tests (`8` rows, `"33 of 41"` banner text, `139` total node
  tests) are fixture-dependent, consistent with this phase's existing testing style (Task 9 pins
  `8` officer jobs the same way) — they will need updating if `ward-movements.ts` changes again.
