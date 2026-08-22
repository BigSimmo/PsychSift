# Task 4 report: the provider, the clock and the layout

## Files changed

### `src/components/ward-management/ward-flow-provider.tsx` (new)

- `"use client"` component. Holds `useReducer(wardFlowReducer, undefined, seedWardFlowState)` —
  the lazy third-arg form, so the fixture is deep-cloned exactly once at mount, never re-seeded on
  a later render.
- The clock: `wallClockNow()` is called from exactly one place, `mountedAt`'s lazy initializer,
  and only when `initialNow` is not supplied. A pinned `initialNow` (every test, and any
  deterministic render) never touches the wall clock.
- **Deviation from the brief's literal snippet**: the brief's sketch stores `mountedAt` in a
  `useRef` and reads `mountedAt.current` inline in the `elapsed` computation during render. This
  repo's `react-hooks/refs` ESLint rule (loaded from `eslint.config.mjs`, part of
  `eslint-plugin-react-hooks`) hard-fails on exactly that: "Cannot access refs during render...
  Refs should only be accessed outside of render." I ran `npm run lint` after the first working
  version and got a real error at that line, not a false positive — the lazy
  check-then-set-if-undefined idiom (`if (mountedAt.current === undefined) mountedAt.current = …`)
  is allowlisted by the rule as a known-safe idiom, but a plain read like
  `wallClockNow() - mountedAt.current` later in the same render is not. I replaced the ref with
  `const [mountedAt] = useState<Instant>(() => initialNow ?? wallClockNow())` — a lazy `useState`
  initializer gives the identical "computed exactly once, on mount" guarantee, and reading a
  `useState` value during render is completely ordinary (no lint rule objects to it). Everything
  else in the brief's snippet — the `ticks`/`setTicks` re-render pump, the `initialNow !==
undefined` guard in the effect, the `elapsed` and `now` formulas — is unchanged.
- `useWardFlow()` throws `"useWardFlow must be used within WardFlowProvider."` when the context is
  `null`, following the exact pattern already used by `useAccountData` in
  `src/components/account-data-provider.tsx` (`if (!context) throw new Error(...)`).

### `src/app/ward-management/layout.tsx` (new)

- A server component (no `"use client"`, no hooks) that renders `<WardFlowProvider>{children}</WardFlowProvider>`.
  This is exactly the "Context providers" pattern documented in
  `node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md`
  (§ Context providers): create the provider as its own `"use client"` component, then wrap
  `children` with it from an ordinary server layout. No new root layout is created — `ward-management`
  had no `layout.tsx` before this change, so this is additive, not a replacement of an existing one.

### `tests/ward-flow-provider.dom.test.tsx` (new)

- **DOM-test filename.** This repo's `vitest.config.mts` splits Vitest into two projects: `node`
  (`tests/**/*.test.ts`, no DOM) and `jsdom` (`tests/**/*.dom.test.tsx` only, with
  `@testing-library/react` cleanup and jsdom polyfills wired via `tests/setup/jsdom.setup.ts`).
  This test uses the DOM-project filename so it is collected by `npm run test`; every one of the
  115 existing React component tests in this repo uses the
  `*.dom.test.tsx` suffix (confirmed: `find tests -iname "*.test.tsx" -not -iname "*.dom.test.tsx"`
  returns nothing). I named the file `ward-flow-provider.dom.test.tsx` instead, kept every other
  brief detail (imports, `Probe` component, both required test bodies) unchanged, and added two
  more tests (below). This is the only way this test actually runs under the repo's own `npm run
test` gate.

## Test output

Step 2 (before the provider existed), confirming the test fails for the right reason:

```
FAIL  |jsdom| tests/ward-flow-provider.dom.test.tsx [ tests/ward-flow-provider.dom.test.tsx ]
Error: Failed to resolve import "@/components/ward-management/ward-flow-provider" from "tests/ward-flow-provider.dom.test.tsx". Does the file exist?
```

Step 4, after the provider/layout existed but before the lint fix (both required tests passing):

```
 Test Files  1 passed (1)
      Tests  2 passed (2)
```

Final state, all four tests (two from the brief plus two I added):

```
$ npx vitest run tests/ward-flow-provider.dom.test.tsx --project jsdom
 RUN  v4.1.10 C:/Users/joshs/.codex/worktrees/ward-management-design/Database
 Test Files  1 passed (1)
      Tests  4 passed (4)
```

Typecheck (only `src/`, `tests/`, `scripts/` matter per the brief's stated `.next/dev/types/`
trap — no such corrupted-artefact errors appeared, and no filtering was needed):

```
$ npx tsc --noEmit -p tsconfig.json
EXIT:0
```

Lint, on the three new/changed files only (`npm run lint` runs the whole tree; these are the
lines that were mine):

```
$ npm run lint
... (before the ref→useState fix) ...
C:\...\ward-flow-provider.tsx
  68:79  error  Error: Cannot access refs during render
✖ 3 problems (1 error, 2 warnings)

... (after the fix) ...
C:\...\ward-flow-reducer.ts
  1:15  warning  'Instant' is defined but never used  @typescript-eslint/no-unused-vars
C:\...\ward-flow-reducer.test.ts
  5:45  warning  'PARALLEL_REFERRAL_CAP' is defined but never used  @typescript-eslint/no-unused-vars
✖ 2 problems (0 errors, 2 warnings)
```

The two remaining warnings are in Task 3 files (`ward-flow-reducer.ts`, `ward-flow-reducer.test.ts`)
that this task never touches — confirmed with `git diff --stat HEAD -- <those two files>`, which
returns nothing. They are pre-existing, cause `lint:internal`'s `--max-warnings 0` to exit
non-zero overall, and are out of this task's scope (flagged separately, see "Out-of-scope items"
below). My three files contribute zero errors and zero warnings.

Playwright, run twice — once with the new provider/layout files temporarily moved out of the tree
(to isolate whether a failure was mine), and once with them restored — against
`PLAYWRIGHT_BASE_URL=http://localhost:3718` (the URL `npm run ensure` printed; the server was
already running):

```
$ PLAYWRIGHT_BASE_URL=http://localhost:3718 npx playwright test tests/ui-ward-coordinator.spec.ts tests/ui-ward-management.spec.ts --project=chromium --reporter=line
  1 failed
    [chromium] › tests\ui-ward-coordinator.spec.ts:213:7 › Ward Flow coordinator screen › orders by clinical tier first and labels the score as operational, not clinical
  20 passed (57.3s)
```

Identical result (same single failure, same "N passed" line) with `ward-flow-provider.tsx` and
`layout.tsx` moved out of the tree entirely — confirming this is a pre-existing failure, not a
regression from this task. Full detail in "Out-of-scope items" below. The brief's own step said to
"treat any change in that number as a defect to investigate, not a number to update" — I
investigated by removing my diff and reproducing the identical failure, rather than assuming it
was unrelated.

## Next 16 docs read

- `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/layout.md` — confirmed
  a nested (non-root) `layout.tsx` only needs to accept and render `children`; it does not need
  `<html>`/`<body>` (that's root-layout-only), and multiple layouts can exist without special
  wiring. Also noted the Next 16 `LayoutProps<'/route'>` typed-props helper exists but the
  sibling `(search-app)/layout.tsx` in this repo uses a plain `{ children: ReactNode }` signature,
  so I matched that existing convention rather than introducing a new pattern for one file.
- `node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md`,
  § "Context providers" — this is the section that directly justifies the brief's split (server
  `layout.tsx` renders a `"use client"` provider around `children`), including the "render
  providers as deep as possible in the tree" guidance, which is exactly what a route-scoped
  (non-root) layout does here versus adding this to the app's root layout.

Neither doc changed the shape of what the brief asked for; they confirmed the brief's design
matches Next 16's documented pattern rather than a stale training-data assumption.

## Ambiguities and how I resolved them

1. **Test filename vs. repo's Vitest project split.** Resolved by using `.dom.test.tsx` (see
   above) — the brief's literal filename would silently not run under `npm run test`.
2. **The brief's ref-based clock sketch vs. this repo's `react-hooks/refs` lint rule.** Resolved
   by switching `mountedAt` from `useRef` to a lazily-initialized `useState`, preserving the exact
   "wall clock read at most once, at mount" contract while satisfying the lint gate (see above).
3. **Thin test coverage (brief's own concern).** The brief flags that its 2 supplied tests are
   thin and asks what a plausible bug would do and whether any test would catch it. I added two:
   - **The clock ticks in tests.** Even though `elapsed` is separately gated to `0` when
     `initialNow` is set, that's a second, independent guard from the effect's own
     `if (initialNow !== undefined) return`. A one-line mutant that deletes just the effect's
     guard (so the interval always gets registered) would be silent under the brief's two tests —
     `now`'s _value_ wouldn't change because the `elapsed` ternary still forces `0`, so no
     assertion on rendered text would ever see it. I added a test that spies on `window.setInterval`
     and asserts it is never called when `initialNow` is pinned — this directly observes the
     interval registration itself, not just one of its two independent guards, so it kills that
     mutant. Verified: reintroducing the deleted guard line reproduced
     `expected "setInterval" to not be called at all, but actually been called 1 times`.
   - **Dispatch is a no-op, or a provider that silently re-seeds instead of reducing.** Neither of
     the brief's two tests ever calls `dispatch`. I added a test that renders a probe with a button
     wired to `dispatch({ type: "ADVANCE_CLOCK", role: "demo", now, minutes: 15 })` (a real,
     role-gated event from `ward-flow-events.ts`), clicks it twice, and asserts `now` reads
     `NOW_ANCHOR + 30` — proving the offset accumulates onto the _current_ state rather than being
     computed against a freshly reseeded one each time. Verified: I rewired the exposed `dispatch`
     to always apply `RESET_SCENARIO` first (simulating "dispatch resets instead of reducing"), and
     the test failed with `Expected: 657, Received: 642` (i.e. only the second click's 15 minutes
     showed, the first was silently discarded) — then restored the clean file and reconfirmed 4/4
     passing.

   One-line mutation that would kill each test, for a mutation-testing pass:

   | Test                                                                         | Mutation that kills it                                                                                                                                                                                                                      |
   | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | "seeds the fixture and holds the clock at the injected instant"              | Change `now = NOW_ANCHOR + elapsed + state.clockOffsetMinutes` to drop `+ elapsed` — or seed with a truncated fixture — and the exact `movements`/`units`/`now` assertions fail.                                                            |
   | "refuses to be used outside the provider"                                    | Change `if (!context) throw …` to `if (!context) return DEFAULT_CONTEXT_VALUE` (or any fallback) — `expect(...).toThrow()` fails immediately.                                                                                               |
   | "never starts the ticking interval when a test pins the clock"               | Delete the `if (initialNow !== undefined) return;` line inside the `useEffect` — `setInterval` spy fires once. Reproduced above.                                                                                                            |
   | "dispatches through the live reducer and keeps the result across re-renders" | Make the exposed `dispatch` always apply `RESET_SCENARIO` before the real event (or otherwise discard state between calls) — the second click's expected `NOW_ANCHOR + 30` fails, landing on `NOW_ANCHOR + 15` (or less). Reproduced above. |

## Out-of-scope items

- **Pre-existing Playwright failure**, `tests/ui-ward-coordinator.spec.ts:213` — "orders by
  clinical tier first and labels the score as operational, not clinical" expects the first queue
  row to contain "passed its deadline" but it reads "6h 40m waiting" instead. Reproduced
  identically with `ward-flow-provider.tsx` and `layout.tsx` removed from the tree entirely, so
  this predates and is unrelated to Task 4. Not investigated further (out of this task's scope) —
  flagging separately.
- **Two pre-existing lint warnings** in `ward-flow-reducer.ts` (`'Instant' is defined but never
used`) and `tests/ward-flow-reducer.test.ts` (`'PARALLEL_REFERRAL_CAP' is defined but never
used`) — confirmed untouched by this diff (`git diff --stat HEAD` on both returns nothing).
  These make plain `npm run lint` exit non-zero overall even though my three files are clean; not
  fixed here since they belong to Task 3's files, not this task's scope.

## Commit

```
git add src/components/ward-management/ward-flow-provider.tsx src/app/ward-management/layout.tsx tests/ward-flow-provider.dom.test.tsx
git commit -m "feat(ward-flow): add the state provider and the ticking clock"
```
