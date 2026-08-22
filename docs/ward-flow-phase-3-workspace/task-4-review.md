# Task 4 review: the provider, the clock and the layout

## Verdicts

- **Spec compliance: APPROVED.** Interfaces, values (48 movements / 22 units / 0 rejections /
  `NOW_ANCHOR`), the `useReducer(wardFlowReducer, undefined, seedWardFlowState)` lazy-seed form,
  the clock's pin/tick contract, `useWardFlow`'s conservative-failure throw, and the server-layout
  wrapping a client provider all match the brief. Both disclosed deviations (test filename suffix,
  `useState` instead of `useRef`) are forced by real repo constraints (Vitest project globs, the
  `react-hooks/refs` lint rule) and preserve the brief's guarantees exactly — not a compliance gap.
- **Task quality: APPROVED**, with one residual risk worth tracking (below) and one comment
  inaccuracy worth a follow-up fix, neither of which should block this task.

## Findings, most consequential first

1. **`src/components/ward-management/ward-clock.ts:12-15` (pre-existing, not touched by this
   diff) — `wallClockNow()` returns minutes-since-midnight and wraps to 0 at 24:00.** The
   provider's `elapsed = Math.max(0, wallClockNow() - mountedAt)` (`ward-flow-provider.tsx:69`)
   assumes `wallClockNow()` only increases. If the tab is left open across midnight, the next tick
   computes a smaller wall-clock value than `mountedAt`, `elapsed` clamps to `0`, and the on-screen
   clock silently freezes or jumps backward-then-forward instead of ticking — a real, live-only
   defect no test in this diff or the wider suite can see, since every test pins `initialNow`.
   Matters because Tasks 5–12 build screens against this same `now`, and any overnight demo session
   will hit it. Not a Task 4 regression (the module predates it), but Task 4 is the first place that
   consumes it across a real elapsed interval, so it's the right point to flag it — recommend an
   `/issues capture` rather than a blocking change here.

2. **`ward-flow-provider.tsx:49-52` — the comment says `wallClockNow()` is "read at most once per
   mount, and only from here."** That's true for the pinned/test path, but false for the live app:
   the `elapsed` line (`ward-flow-provider.tsx:69`) calls `wallClockNow()` again on every unpinned
   render, not just at mount. Harmless in practice (the `useMemo` on `now`'s numeric value already
   dedupes context recreation within the same wall-clock minute), but the comment overstates the
   guarantee and could mislead whoever next touches this file into assuming the call is mount-only.
   Worth a one-line comment fix, not worth a re-review.

3. **Test count (4 total: 2 from the brief + 2 added) is thin but each is honest.** The two added
   tests (interval-spy on the pinned path; two-click dispatch accumulation) are the two gaps that
   actually matter and are each independently reproduced with a mutation in the report. The two
   brief-supplied tests have self-evident one-line kills (drop `+ elapsed`; change the throw to a
   default). I re-ran the file standalone (`npx vitest run tests/ward-flow-provider.dom.test.tsx
--project jsdom`) and confirmed 4/4 passing, matching the report.

4. **Clock mechanics otherwise sound.** Confirmed by grep: `wallClockNow`/`Date.now`/`new
Date`/`performance.now`/`setInterval` appear nowhere else under `src/components/ward-management/**`
   or `src/app/ward-management/**` except inside `ward-clock.ts` and this provider — no other
   screen or module reads the wall clock. The pinned path returns from the effect before
   `setInterval` is ever called (not "start-then-ignore"), proven by the `setInterval` spy test.
   The interval is cleaned up (`return () => clearInterval(id)`). The reducer is seeded exactly
   once via the lazy `useReducer` initializer form — no re-seed on re-render. `useWardFlow()`
   throws `"useWardFlow must be used within WardFlowProvider."`, matching the existing
   `useAccountData` convention in `src/components/account-data-provider.tsx` exactly.

5. **`src/app/ward-management/layout.tsx` server/client boundary is correct per Next 16 docs.**
   Matches `node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md`
   § "Context providers" verbatim: an ordinary (non-`"use client"`) layout importing and rendering
   a `"use client"` provider around `children`, no hooks in the layout itself. No existing page
   under `src/app/ward-management/**` calls `useWardFlow` yet, confirming "nothing should render
   differently yet."

6. **Fixture commit (`ward-movements.ts`) is sound.** The new pin test iterates a non-empty,
   dynamically filtered set (`inpatientOrdered.length` guarded `toBeGreaterThan(0)`), not a
   hardcoded ID list — it will catch a future 3B fixture entry that skips the derivation. Diff
   confirms only `legalForm.dueAt` and `examination.at` changed on WF-003/WF-009/WF-017;
   `formedAt`, `arrivalMode`, `bedHeldUntil`, `referredUnitIds`, `withdrawnReferrals`, and the
   `escalation` strings are untouched on all three records.
