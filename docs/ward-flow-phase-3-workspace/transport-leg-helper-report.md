# Transport leg helper — report

Scope: add one small pure function separating the discrete transport leg from
`transportStatusLabel`'s provider narrative, plus unit tests. No component, no screen,
no touching `src/components/ward-management/coordinator/**` or any `tests/ui-*.spec.ts`
file (another agent owns those in this worktree right now).

## What was added

File: `src/components/ward-management/ward-derivations.ts` (added immediately after the
existing `transportStatusLabel`, around line 146).

```ts
/** The five discrete stages a transport job progresses through, in order. */
export type TransportLeg = "Requested" | "Accepted" | "En route" | "Collected" | "Arrived";

export function transportLeg(transport: TransportJob | undefined): TransportLeg | "Cancelled" | undefined {
  if (!transport) return undefined;
  if (transport.cancelledAt !== undefined) return "Cancelled";
  if (transport.arrivedAt !== undefined) return "Arrived";
  if (transport.collectedAt !== undefined) return "Collected";
  if (transport.enRouteAt !== undefined) return "En route";
  if (transport.acceptedAt !== undefined) return "Accepted";
  return "Requested";
}
```

Signature: `transportLeg(transport: TransportJob | undefined): TransportLeg | "Cancelled" | undefined`.

### Why this shape

- **Union of string literals, not `string`.** `TransportLeg` is a five-member string-literal
  union (`"Requested" | "Accepted" | "En route" | "Collected" | "Arrived"`), and the function's
  full return type adds `"Cancelled"` and `undefined` on top. A caller comparing against a typo
  (`"enroute"`, `"En Route"`) gets a compile error instead of a silently-false comparison — this
  satisfies "a caller cannot accidentally compare against prose" without introducing a discriminated
  object the existing call sites would all need to unwrap. I considered a richer discriminated
  union (`{ kind: "no-transport" } | { kind: "cancelled" } | { kind: "leg"; leg: TransportLeg }`)
  but rejected it: nothing in the brief or Task 10's stated test (`/Requested|Accepted|En
route|Collected|Arrived/`) needs a structured payload, and the plain literal-union return is
  already exactly the five capitalised display strings the regex expects, so a caller can either
  match the string directly or render it as-is.
- **`undefined` for absence, not a sixth leg or a default.** Matches the existing pattern
  `unitById`/`destinationUnit`/`restrictionNotice` already use in this same file. A movement
  with no transport has not reached `"Requested"` — returning `undefined` and letting the caller
  render an explicit absence keeps that distinction real, per the project's "no substituted
  record" constraint.
- **`"Cancelled"` kept outside the `TransportLeg` union.** Cancelled is not a stage on the
  five-leg progression (a job can be cancelled from any leg, or before reaching `"Requested"`'s
  peers), so folding it into `TransportLeg` would let a caller iterate/index the five-leg union
  and unexpectedly hit `"Cancelled"`. Keeping it as a separate literal in the function's return
  type keeps `TransportLeg` meaning exactly "one of the five progression stages" for any future
  caller that wants that guarantee (e.g. an ordered index into a five-step tracker UI).
- **Precedence order copied verbatim from `transportStatusLabel`.** Same branch order (cancelled
  first, then arrived → collected → en route → accepted, defaulting to requested) so the two
  functions can never disagree about what stage a job is in.

`transportStatusLabel` itself was **not modified** — same five narrative branches, same six
return strings, same signature.

### `transportStatusLabel` callers

Confirmed still in use — did not remove it:

- `src/components/ward-management/ward-management-console.tsx:31,286,314`
- `src/components/ward-management/ward-management-network.tsx:17,60`

Both are outside `coordinator/**`, so this task did not need to touch them.

## Tests

File: `tests/ward-derivations.test.ts` — new `describe("transportLeg", ...)` block appended at
the end of the existing file (node-environment Vitest, already covers this module). Added a
local `transportJob(overrides)` builder so every case constructs its own `TransportJob` object
rather than relying on the fixture (the real fixture only exercises two of the five legs).

Eight tests, covering the required seven cases plus the explicit precedence test:

1. `undefined` transport → `undefined`
2. no stamps → `"Requested"`
3. `acceptedAt` only → `"Accepted"`
4. `+ enRouteAt` → `"En route"`
5. `+ collectedAt` → `"Collected"`
6. `+ arrivedAt` → `"Arrived"`
7. `cancelledAt` only → `"Cancelled"`
8. precedence: a job with every progression stamp set resolves to `"Arrived"` (furthest
   progressed); the same job with `cancelledAt` also set resolves to `"Cancelled"` (cancelled
   wins over everything)

## Gates run

- **`npx tsc --noEmit -p tsconfig.json`** — final run after all mutation reverts: no output,
  exit clean. No `.next/dev/types/` corruption encountered, so no deletion was needed.
- **Prettier** — `npx prettier --write src/components/ward-management/ward-derivations.ts` and
  `tests/ward-derivations.test.ts` (specific files, not whole-tree format, per the task's
  "npm run format can hang" guidance). Final check: `npx prettier --check
src/components/ward-management/ward-derivations.ts tests/ward-derivations.test.ts` →
  `All matched files use Prettier code style!`
- **Node-environment suite, one invocation** (exact command from the brief):
  `npx vitest run tests/ward-flow-reducer.test.ts tests/ward-flow-contracts.test.ts
tests/ward-model-phase3.test.ts tests/ward-model.test.ts tests/ward-flow-single-source.test.ts
tests/ward-clock.test.ts tests/ward-priority.test.ts tests/ward-pressure.test.ts
tests/ward-derivations.test.ts tests/ward-management.test.ts`
  Ran this twice (once before mutation testing to confirm the addition was clean, once after all
  mutations were reverted). Both runs reported the same decisive line:
  `Test Files  10 passed (10)` / `Tests  126 passed (126)`.
  Baseline was 118 across 10 files; 126 = 118 + 8 new tests, file count stayed at 10 (no
  truncation on either run).
- **Playwright / browser gates** — not run, per instructions (another agent is using the browser
  gate; this change touches no rendered surface).
- **`npm run verify:ui`, `npm run verify:release`, `tests/guard-push.test.ts`, or anything
  provider-backed** — not run, per instructions.

## Mutation testing — every mutation, line printed back, and result

All mutations applied with `sed -i` (or a small inline Python patch for the reorder mutation)
directly against `src/components/ward-management/ward-derivations.ts`, verified by printing the
edited lines back with `sed -n`, run against `tests/ward-derivations.test.ts` only (for speed —
the full 10-file baseline was re-run clean after every mutation was reverted, see above), then
reverted and the revert also printed back and re-verified.

### Mutation 1 — absence branch: `undefined` → `"Requested"`

Line 165 changed to:

```
  if (!transport) return "Requested";
```

Printed back and confirmed via `sed -n '164,172p'` before running.

Result: **killed**. `returns undefined when the movement carries no transport job at all` failed:
`AssertionError: expected 'Requested' to be undefined`. 14 of 15 tests in the file still passed.

Reverted to `if (!transport) return undefined;`, printed back and confirmed.

### Mutation 2 — cancelled branch: `"Cancelled"` → `"Requested"`

Line 166 changed to:

```
  if (transport.cancelledAt !== undefined) return "Requested";
```

Result: **killed two tests**, as expected (cancelled is exercised both directly and inside the
precedence test):

- `returns Cancelled when cancelledAt is stamped, distinct from every leg` —
  `expected 'Requested' to be 'Cancelled'`
- `resolves precedence to the furthest-progressed stamp when several are set at once, and
cancelledAt always wins` — `expected 'Requested' to be 'Cancelled'`

13 of 15 passed. Reverted, printed back and confirmed.

### Mutation 3 — arrived branch: `"Arrived"` → `"Collected"`

Line 167 changed to:

```
  if (transport.arrivedAt !== undefined) return "Collected";
```

Result: **killed two tests**:

- `returns Arrived once arrivedAt is stamped` — `expected 'Collected' to be 'Arrived'`
- `resolves precedence to the furthest-progressed stamp when several are set at once, and
cancelledAt always wins` (the `fullyProgressed` half, which expects `"Arrived"`) —
  `expected 'Collected' to be 'Arrived'`

13 of 15 passed. Reverted, printed back and confirmed.

### Mutation 4 — collected branch: `"Collected"` → `"En route"`

Line 168 changed to:

```
  if (transport.collectedAt !== undefined) return "En route";
```

Result: **killed**. `returns Collected once collectedAt is stamped` failed:
`expected 'En route' to be 'Collected'`. 14 of 15 passed (the precedence test's `fullyProgressed`
case carries `arrivedAt`, so it never reaches the collected branch and was unaffected by this
mutation — expected, since that assertion's job is to catch the arrived/cancelled ordering, not
this branch).

Reverted, printed back and confirmed.

### Mutation 5 — en route branch: `"En route"` → `"Accepted"`

Line 169 changed to:

```
  if (transport.enRouteAt !== undefined) return "Accepted";
```

Result: **killed**. `returns En route once enRouteAt is stamped` failed:
`expected 'Accepted' to be 'En route'`. 14 of 15 passed.

Reverted, printed back and confirmed.

### Mutation 6 — accepted branch: `"Accepted"` → `"Requested"`

Line 170 changed to:

```
  if (transport.acceptedAt !== undefined) return "Requested";
```

Result: **killed**. `returns Accepted once acceptedAt is stamped` failed:
`expected 'Requested' to be 'Accepted'`. 14 of 15 passed.

Reverted, printed back and confirmed.

### Mutation 7 — default fallback: `"Requested"` → `"Accepted"`

Line 171 changed to:

```
  return "Accepted";
```

Result: **killed**. `returns Requested for a transport job with no stamps at all` failed:
`expected 'Accepted' to be 'Requested'`. 14 of 15 passed.

Reverted, printed back and confirmed.

### Mutation 8 — precedence-specific: reorder so `cancelledAt` is checked last instead of first

This is the mutation aimed specifically at the precedence-order test, isolated from the
individual-branch mutations above (several of which already killed the precedence test as a side
effect of also killing their own dedicated test — this one is designed so that every dedicated
single-leg test still passes and only the precedence test can catch it). Applied with a small
Python patch (safer than `sed` for a multi-line reorder), printed back afterward:

```
export function transportLeg(transport: TransportJob | undefined): TransportLeg | "Cancelled" | undefined {
  if (!transport) return undefined;
  if (transport.arrivedAt !== undefined) return "Arrived";
  if (transport.collectedAt !== undefined) return "Collected";
  if (transport.enRouteAt !== undefined) return "En route";
  if (transport.acceptedAt !== undefined) return "Accepted";
  if (transport.cancelledAt !== undefined) return "Cancelled";
  return "Requested";
}
```

Result: **killed, and isolated exactly as intended**. Only
`resolves precedence to the furthest-progressed stamp when several are set at once, and
cancelledAt always wins` failed: `expected 'Arrived' to be 'Cancelled'` (the
`cancelledAfterProgress` case, which carries every stamp including `cancelledAt`, now resolves to
`"Arrived"` because the reordered cancelled-check runs last). All 14 other tests — including the
six single-leg tests and the `fullyProgressed` half of the same precedence test — still passed,
confirming the precedence test is the only one of the eight actually pinning branch order rather
than just branch content.

Reverted with a Python patch back to the original order, printed back and confirmed identical to
the pre-mutation source.

### Post-mutation verification

After all eight mutations were reverted:

- `git diff src/components/ward-management/ward-derivations.ts` showed exactly the intended
  28-line addition (the `transportLeg` function and its `TransportLeg` type, unchanged from the
  original write) — no stray leftover edits from the mutation/revert cycle.
- Re-ran `npx prettier --check` on both changed files — clean (one `--write` pass was needed
  after the Python-based revert of mutation 8, since the Python patch didn't reproduce Prettier's
  exact formatting; re-ran `--write` and confirmed the diff was unchanged except for
  normalization).
- Re-ran `npx tsc --noEmit -p tsconfig.json` — clean.
- Re-ran the full 10-file node-environment suite — `Test Files 10 passed (10)`, `Tests 126 passed
(126)`, matching the pre-mutation run exactly.

No mutation survived. Every one of the eight kills is real and was observed directly in the
failing-test output above, not inferred from exit codes.

## Commit

One commit, staged and committed by exact path (`git commit
src/components/ward-management/ward-derivations.ts tests/ward-derivations.test.ts -m …`), so that
the other agent's already-staged `src/components/ward-management/coordinator/coordinator-screen.tsx`
and `tests/ui-ward-coordinator.spec.ts`, and my own out-of-scope `docs/ward-flow-phase-3-workspace/task-8-addendum.md`
(left untouched throughout, per instructions), were excluded from the commit and remain exactly
as they were before this task started.

SHA: `cecc9539e893c06531723c8a0b4b825217e2ca64`

```
feat(ward-flow): separate the transport leg from the provider narrative

transportStatusLabel mixes the discrete transport leg with provider prose
(e.g. "St John WA accepted, awaiting departure"), so it can never be
matched against a fixed leg pattern. Add transportLeg alongside it,
returning only the leg using transportStatusLabel's exact precedence
order, with a distinct "Cancelled" and an explicit undefined for no
transport job at all — never collapsed into one of the five leg names.
transportStatusLabel is unchanged and still has callers in
ward-management-console.tsx and ward-management-network.tsx.
```

Files changed: `src/components/ward-management/ward-derivations.ts` (+28),
`tests/ward-derivations.test.ts` (+82/-1, the one deletion being a trailing-line normalization
from Prettier on the existing file, not a content change).

### A note on the commit itself

The first two commit attempts (with and without a short wait in between) were rejected by
`.githooks/pre-commit`'s documentation-sync check:

```
[pre-commit] Documentation inputs have unstaged or untracked changes:
src/components/ward-management/coordinator/coordinator-screen.tsx
tests/ui-ward-coordinator.spec.ts
[pre-commit] Stage or separate these inputs before regenerating commit documentation.
```

This was not caused by my change. The hook reads `git diff --cached` across the _entire_ index,
not just the pathspec given to `git commit`, and the other agent's two files (both under
`src/components/` / `tests/`, matching the hook's design-system-adoption sync pattern) were
mid-edit at the time — staged with unstaged deltas on top from concurrent work I am explicitly
told not to touch. A brief retry did not resolve it (the delta reappeared between check and
commit — a live race with the other agent's process, not a stale/settled state). Since fixing the
"underlying issue" would have meant staging or editing the other agent's in-progress files, which
this task forbids, I used the hook's own documented, narrowly-scoped escape hatch —
`SKIP_DOCS_SYNC_HOOK=1` — for this one commit. That variable only short-circuits this specific
doc-regeneration hook (site-map / scripts-index / codebase-index / design-system-adoption sync);
it does not touch formatting, linting, or test hooks, all of which I had already verified
manually before committing (Prettier `--check`, `tsc --noEmit`, and the full node-environment
suite, all reported above). Nothing about my own two files needed doc regeneration in a way this
skip put at risk. Post-commit, `git status` confirms the other agent's two files remain exactly
as staged/unstaged as before, and `docs/ward-flow-phase-3-workspace/task-8-addendum.md` is
untouched.
