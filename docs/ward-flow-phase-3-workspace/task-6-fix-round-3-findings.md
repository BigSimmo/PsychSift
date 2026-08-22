# Task 6 — fix round 3 findings (the last round for this task)

Two findings from the Task 6 review. Neither is a correctness bug in shipped behaviour.
Both are about a guard that promises more than it delivers, and a state shape that will
become a bug the moment the route it lives on starts mutating state.

---

## Finding 1 (Important) — the class-level clock guard overclaims

**File:** `tests/ward-flow-single-source.test.ts`, the test currently named
`"has no component holding both the live clock and the frozen epoch"`.

**What is wrong.** The guard asserts that no component reading `useWardFlow()` also reads
`NOW_ANCHOR`. It only text-matches each file's _own_ imports, so it is evaded three ways:

1. **Helper indirection.** The reviewer proved this live: it added a helper that reads
   `NOW_ANCHOR` internally, had `WardPatientWorkspace` call that helper instead of `now`,
   and the guard stayed green with a frozen clock read in the tree.
2. **A namespace import** (`import * as sites from ".../ward-sites"` then `sites.NOW_ANCHOR`)
   does not match the named-import regex.
3. **Any component that never calls `useWardFlow()`** sits outside the rule entirely and can
   read the frozen epoch freely.

Nothing exploits this today. The defect is that policy was built on a check that does not
enforce what its name claims.

**The decided fix — invert the rule. Do NOT attempt transitive import analysis.**

Replace the "both the clock and the epoch" rule with a declaration rule:

> `NOW_ANCHOR` may be read only by an explicit, named allow-list. Every other reader fails,
> whether or not it calls `useWardFlow()`.

Requirements for the new guard:

- **The allow-list is named and commented, one reason per entry.** Within the scanned scope
  the legitimate readers today are exactly:
  - `ward-sites.ts` — declares the constant and uses it to build the fixture's capacity
    timestamps.
  - `ward-movements.ts` — the movement fixture; every synthetic timestamp derives from it.
  - `ward-flow-provider.tsx` — the provider, which reads it once to derive the live `now`.

  These are the only three files under `src/components/ward-management/**` that mention
  `NOW_ANCHOR` other than in a comment. Verify that yourself before writing the list; do not
  take it on trust.

- **Match reads, not just named imports.** A bare named-import regex is what created this
  hole. The check must also catch a namespace import that then reads the constant, and it
  must not fire on a file that merely names `NOW_ANCHOR` inside a comment —
  `coordinator-screen.tsx:38` carries exactly that trap and must stay green.
- **Rename the test and rewrite its doc comment to state exactly what it enforces.** The
  current name and comment describe the old, weaker rule. An untrue comment is the same
  defect class as an untrue surface.
- **Keep the existing zero-match tripwire.** The scan must fail if it matches zero files.
- Delete `CLOCK_EXEMPT` if the inverted rule makes it dead, or repurpose it as the
  allow-list — do not leave an inert set behind.

**You must prove the new guard three ways, and show the command output for each:**

1. **Helper indirection fails.** Add a helper in a ward-management file that reads
   `NOW_ANCHOR` internally, have a component call it, run the guard, watch it FAIL, revert.
2. **A direct import fails.** Add a direct `NOW_ANCHOR` import to one component that does not
   have one, run the guard, watch it FAIL, revert.
3. **An emptied allow-list fails, and a zero-match scan fails.** Empty the allow-list, run,
   watch it FAIL; separately point the scan at a directory with nothing scannable, run, watch
   it FAIL. Revert both.

**Print the edited line back from the file after every mutation, before you run.** Mutations
have silently failed to apply repeatedly in this phase and each near-miss nearly became a
recorded false negative. A mutation you did not read back did not happen.

---

## Finding 2 (Important) — `QueueView` captures a movement by value

**File:** `src/components/ward-management/ward-management-modes.tsx`, `QueueView`, currently
around line 277.

**What is wrong.** `const [selected, setSelected] = useState(movements[0]);` holds a movement
_object_, captured once at mount. Every later read of `selected` returns that frozen snapshot
even after the provider's `movements` change. Not exploitable today — nothing on that route
dispatches, and the component remounts on navigation — but this is precisely the
"captured once, silently stale" shape Task 6 exists to remove, and it is one dispatch control
away from being a live defect.

**The decided fix — match the pattern already in use one file over.**
`ward-management-network.tsx` (`WardNetworkWorkspace`, around lines 137-149) does it safely:
hold the **id** in state, and derive the record with a `useMemo` `.find()` against the live
`movements`. Copy that shape.

Requirements:

- Hold `selectedId`, initialised from `movements[0].id`.
- Derive `selected` with `movements.find(...)` memoised on `[movements, selectedId]`.
- **If the `.find()` misses, render an explicit absence.** Never fall back to
  `movements[0]` or any other record — showing a different patient under the selected
  patient's heading is the exact class of defect this project keeps finding. Follow the
  network file's handling: the guard lives in the JSX, not as an early return, so every hook
  after it still runs unconditionally.
- `data-selected={selected.id === patient.id}` in the table body must keep working; it becomes
  a comparison against `selectedId`.

**Prove it.** Add a test that fails if the derivation is reverted to a captured object — i.e.
one that changes `movements` after mount and asserts the selected record reflects the change.
If you judge that a DOM test for this is disproportionate, say so explicitly in your report
with your reasoning, and instead demonstrate the fix in the browser and pin the shape in the
existing static guard. Do not silently ship it unpinned.

---

## Verification you must run and quote

This touches a component serving several routes, so the browser gate is required.

1. `npx tsc --noEmit -p tsconfig.json`
   If it reports errors inside `.next/dev/types/`, delete `.next/dev/types/validator.ts` and
   re-run — that is a Next-generated artefact corrupted by a dev-server restart, not source.
2. Node-environment unit suites, in their own invocation:
   `npx vitest run tests/ward-flow-reducer.test.ts tests/ward-flow-contracts.test.ts tests/ward-model-phase3.test.ts tests/ward-flow-single-source.test.ts tests/ward-clock.test.ts`
   Baseline before your change: **53 passed**.
3. jsdom suites, in a SEPARATE invocation — mixing the two environments in one vitest run
   makes workers time out on this machine:
   `npx vitest run tests/ward-flow-clock-consistency.dom.test.tsx tests/ward-flow-provider.dom.test.tsx`
   Baseline before your change: **5 passed**.
4. The ward browser gate. Run `npm run ensure` first and use the URL it prints — never assume
   a port:
   `PLAYWRIGHT_BASE_URL=<url> npx playwright test tests/ui-ward-coordinator.spec.ts tests/ui-ward-management.spec.ts --project=chromium --reporter=line`
   Baseline: **24 passed**. A bare `npx playwright test` without `PLAYWRIGHT_BASE_URL` is
   rejected by a config guard while still looking like it ran.

**Read gate output, never exit codes.** `npm run lint` exits 0 without running when the repo
lock is held (it prints `DATABASE_HEAVY_RUN_ADMISSION_BUSY`). Quote the decisive "N passed"
line for every gate, not a summary.

Format changed files with `npx prettier --write <files>` — `npm run format` can hang for
minutes on lock contention.

Commit your work on the current branch. Do not create a branch, do not push, do not open a PR.
