# Task 6 review: the other ten routes

Reviewed diff `868853b58..18f57736f` (3 commits) against `task-6-brief.md` and `task-6-report.md`.
Everything the coordinator already stated as independently verified (zero `NOW_ANCHOR` in the
three rewired files, ward Vitest suite + `tsc --noEmit` clean, browser gate 24 passed, the
behavioural clock test dying on its own call-site revert, the class guard dying on a _different_
call-site revert) was **not** re-proven here. This file covers only what was not yet verified.

## Verdicts

- **Spec compliance: APPROVED.** Every substitution the brief asked for is present; the two
  deviations (fixing `movementById`, widening the scan to `.ts`) are correctly-scoped extensions
  of the brief's own stated goal, not scope creep, and are accurately called out in the report.
- **Task quality: CHANGES REQUESTED (non-blocking for merge, but the guard's advertised
  guarantee is overstated).** The clock-consistency guard is materially weaker than the report's
  "no file both calls `useWardFlow()` and imports `NOW_ANCHOR`" framing implies, and one route
  (`QueueView`) reintroduces the exact "value captured once" pattern the task exists to remove,
  even though it happens not to be exploitable today.

## Findings, most consequential first

1. **`tests/ward-flow-single-source.test.ts` — the class-level clock guard is a per-file text
   match, not a data-flow check, and I proved the gap rather than inferred it.** I added a
   one-line indirection — a helper function in a new file that reads `NOW_ANCHOR` internally —
   and changed `WardPatientWorkspace` (`ward-management-console.tsx`) to call that helper for its
   `eligibility(...)` verdict instead of the destructured `now`, without importing `NOW_ANCHOR`
   into the component file itself. `callsUseWardFlow()` was still true (the file still calls
   `useWardFlow()` for `movements`) and `importsNowAnchor()` was false (no `NOW_ANCHOR` import in
   that file), so the guard's AND never fired: `npx vitest run tests/ward-flow-single-source.test.ts`
   reported **5 passed (5)** with the frozen read live in the tree. Reverted both files; suite is
   back to 6/6 green and `git status --porcelain` is clean. The `CLOCK_EXEMPT` set is confirmed
   empty and nothing legitimate was smuggled past it — the gap is in the rule's reach, not a
   quiet exclusion. By the same per-file-text-match logic, a component that never calls
   `useWardFlow()` at all is entirely outside the rule regardless of what it reads, and a
   namespace import (`import * as WardSites from ".../ward-sites"`) would also evade the
   brace-scoped `importsNowAnchor` regex. None of this is exploited in the current tree — every
   `NOW_ANCHOR` read left in `src/components/ward-management` is in a non-component module
   (verified by grep) — so nothing is broken today, but the test's name overclaims what it
   checks.

2. **`ward-management-modes.tsx:277`, `QueueView` — `const [selected, setSelected] =
useState(movements[0])` captures a movement object by value, not an id re-derived from live
   `movements`.** Contrast with the pattern the same diff uses correctly one file over in
   `ward-management-network.tsx`: `WardNetworkWorkspace` stores only `selectedPatientId` (a
   string) and re-derives `patient` every render via `movements.find(...)`, so it can never go
   stale. `QueueView`'s `selected` is exactly the "a value captured once" shape the brief warns
   about. It is not exploitable today because nothing reachable from `/ward-management/queue`
   itself dispatches a mutation — `DecisionPanel`'s "Review & confirm" button only sets local
   `confirmed` state — and the route fully remounts on client-side navigation (different
   `page.tsx` per route segment), so a referral made elsewhere and then navigated to always seeds
   `selected` fresh. But it is latent fragility sitting in the exact surface Task 6 was scoped to
   harden, and it is inconsistent with the safer pattern used two components away in the same
   commit.

3. **Route enumeration (verified directly against `docs/site-map.md` and the app tree, not
   assumed):** the actual route count is 9, not 10 — `/ward-management` (coordinator, Task 5),
   `/capacity`, `/exceptions`, `/governance`, `/movements`, `/network`, `/queue`, `/transport`
   (all via `ward-management-modes.tsx`'s `ModeBody`, confirmed `"use client"` at the file top),
   and `/patients/[patientId]` (`ward-management-console.tsx`). Grepped all three rewired files
   for `wardMovements|allUnits|movementStageSummary|NOW_ANCHOR` post-diff: zero matches in any of
   the three. Every `useMemo` that reads `now` or `movements` has them in its dependency array
   (`[patient, now]`, `[movements, role]`, `[patient, now]` for `candidatesFor`/`settingFit`
   call sites). No module-scope helper takes a defaulted time parameter — `candidatesFor` and
   `settingFit` in `ward-management-network.tsx` both take `now` as a required, not defaulted,
   parameter, as the report claims. This is a documentation/count mismatch in the task framing,
   not a code defect — worth flagging so the phase's route count gets corrected, not something
   this diff needs to fix.

4. **Server/client boundary: correct, and the report's citation is accurate.** Verified the
   quoted line against `node_modules/next/dist/docs/01-app/03-api-reference/01-directives/use-client.md`
   directly rather than trusting the report's paraphrase — it matches verbatim. All three files
   already carried `"use client"` before this task; no boundary change was needed or made.

5. **Conservative failure: holds.** No `??`/`.find()!` substitution was introduced by this diff.
   `movements`/`units` structurally cannot be empty post-seed — the reducer has `RAISE_REFERRAL`
   (appends), `REFER_TO_UNITS`/`RECORD_EXAMINATION` (replace-in-place via `.map`), `ADVANCE_CLOCK`
   (metadata only), `RESET_SCENARIO` (reseeds) and no delete path — so the unguarded `movements[0]`
   reads in `GovernanceView` and `WardNetworkWorkspace`'s initial state are safe as claimed. The
   one `??` in `QueueView`/coordinator (`destinationUnit(selected)?.id ?? eligibleCandidates(...)[0]?.unit.id`)
   predates this diff (only its `NOW_ANCHOR`→`now` argument changed) and is explicitly labelled
   "Suggested destination" rather than presented as a recorded one — not a Task 6 regression.

6. **Test honesty: independently reproduced two of the report's claimed mutations that I had not
   already been told were checked** (`has no component reading the frozen fixture directly` and
   `no longer exports a stage summary frozen at import time`), each with the exact edited line
   printed back before running: re-adding a `wardMovements` import to `ward-management-console.tsx`
   failed the offender test with the expected single-file array; re-adding
   `export const movementStageSummary = stageSummaries([]);` to `ward-derivations.ts` failed the
   export test with the expected message. Both reverted, both confirmed green again, tree clean.
