# Task 4 report — Pathway versions and dual approval

## Commit

`33d38ca0c` — `feat(caring-contacts): pathway version lifecycle with dual approval and urgent retirement`
Branch: `claude/suicide-contact-mockup-b5aaa0`

## Files changed

- **Created** `src/lib/caring-contacts/pathway-versions.ts` (176 lines) — the full interface from the
  brief: `PathwayApprovalRole`, `PathwayApproval`, `PathwayRetirementUrgency`, `PathwayVersion`,
  `PathwayVersionSnapshot`, `PathwayVersionAction`, `REQUIRED_PATHWAY_APPROVAL_ROLES`,
  `applyPathwayVersionTransition`, `retirementPausesFutureContacts`.
- **Created** `tests/caring-contacts-pathway-versions.test.ts` — exact test code from the brief, unmodified.

## Interface notes

- Imported `MessageType` from `./model` alongside `PathwayVersionState` and `TransitionResult`, as flagged
  (the brief's own `Consumes` list omitted it, but `PathwayVersionSnapshot.messageTextByType` needs it).
- Imported `ActorId`, `PathwayVersionId`, `TeamId` from `./ids`; `Clock`/`awstIsoTimestamp` from `./clock`;
  `canApproveOwnAuthoredVersion` from `./permissions`.
- No other imports — confirmed against `tests/caring-contacts-domain-isolation.test.ts`.

## Rule implementation mapping

1. `submitForReview` legal only from `draft` → `pathway-not-draft` otherwise.
2. `approve` legal only from `inReview` → `pathway-not-in-review` otherwise.
3. Self-approval delegated to `canApproveOwnAuthoredVersion(version.authorId, action.actorId)`; its
   `{ allowed: false, reason: "self-approval-denied" }` is surfaced unchanged, no second check written.
4. Same-role-twice → `pathway-approval-role-already-recorded`; same-actor-different-role →
   `pathway-approval-actor-already-recorded`. Both checked against `version.approvals` before the new
   approval is appended.
5. State becomes `approved` only when `REQUIRED_PATHWAY_APPROVAL_ROLES.every(...)` is satisfied by the
   updated approvals array; otherwise stays `inReview`.
6. `publish` legal only from `approved`, sets `publishedAt` via `awstIsoTimestamp(clock.now())`; otherwise
   `pathway-not-approved`.
7. `retire` legal only from `approved`, sets `retiredAt` (AWST timestamp) and `retirementUrgency`; otherwise
   `pathway-not-retirable`.
8. `retirementPausesFutureContacts` returns `version.state === "retired" && version.retirementUrgency ===
"urgentSafety"` — true only for that exact combination.
9. Every transition branch returns `{ ...version, ... }` and never touches `snapshot`; the snapshot object
   passed in by the caller stays the same frozen reference all the way through to `publish`.

## Test commands and decisive output

**Step 2 — failing test, before implementation:**

```
node scripts/run-vitest.mjs run tests/caring-contacts-pathway-versions.test.ts
```

```
Error: Cannot find package '@/lib/caring-contacts/pathway-versions' imported from
D:/Repos/Database/.claude/worktrees/rag-readability-metric-split-7e8ac4/tests/caring-contacts-pathway-versions.test.ts
 Test Files  1 failed (1)
      Tests  no tests
```

Failed for the stated reason (module not found), not a syntax or import-path typo.

**Step 4 — after implementation:**

```
node scripts/run-vitest.mjs run tests/caring-contacts-pathway-versions.test.ts
```

```
 Test Files  1 passed (1)
      Tests  6 passed (6)
```

**Domain isolation (this module lives under `src/lib/caring-contacts/`):**

```
node scripts/run-vitest.mjs run tests/caring-contacts-domain-isolation.test.ts
```

```
 Test Files  1 passed (1)
      Tests  3 passed (3)
```

**Typecheck** — ran `npx tsc --noEmit -p tsconfig.json` and grepped for the new files; no errors reported
against `pathway-versions.ts` or the new test file.

## Mutation proof (Step 5)

Both mutations applied one at a time to the working tree, run, confirmed to actually change an asserted
value (not just exit non-zero), then reverted before the next.

**Mutation 1 — approve on the first approval instead of the second.**

Changed:

```ts
value: { ...version, approvals, state: everyRequiredRoleApproved ? "approved" : "inReview" },
```

to:

```ts
value: { ...version, approvals, state: approvals.length >= 1 ? "approved" : "inReview" },
```

Result: 4 of 6 tests went red.

```
 Test Files  1 failed (1)
      Tests  4 failed | 2 passed (6)
```

- "needs both approval roles before it is approved" — first `advance` already reports `state === "approved"`
  where the test expects `"inReview"`.
- "refuses one person supplying both approvals" — the second call now fails with `pathway-not-in-review`
  instead of returning the expected refusal (because the first approval already moved it to `approved`,
  which the `"approve"` action no longer accepts).
- "pauses future contacts only for an urgent safety retirement" — `refused: pathway-not-in-review` thrown
  by the test's `advance` helper on the second approve call.
- "never mutates the snapshot an active plan depends on" — same `pathway-not-in-review` failure on the
  second approve call in the chain.

This confirms the two-role gate is load-bearing, not decorative — a no-op mutation would have left the
suite green. Reverted immediately after.

**Mutation 2 — remove the `canApproveOwnAuthoredVersion` call.**

Removed:

```ts
const selfApproval = canApproveOwnAuthoredVersion(version.authorId, action.actorId);
if (!selfApproval.allowed) return { ok: false, reason: selfApproval.reason };
```

Result: exactly 1 of 6 tests went red — "refuses the author approving their own version, with the shared
reason" — which now returned `{ ok: true, value: {...version now inReview with the author's approval
recorded...} }` instead of the expected `{ ok: false, reason: "self-approval-denied" }`.

```
 Test Files  1 failed (1)
      Tests  1 failed | 5 passed (6)
```

Confirms the delegation to `permissions.ts` is load-bearing and the only place enforcing rule 3. Reverted
immediately after; re-ran the full pathway-versions + domain-isolation pair to confirm both are green
again (9 passed, quoted above under Step 4 combined run).

## Concerns

None. No existing assertion was touched or loosened. No provider-backed command was run. Nothing was
pushed and no PR was opened.

---

## Fix round 1 (review finding: `pathway-not-retirable` had zero test coverage)

Review confirmed the implementation was correct (self-approval delegates and fires first, snapshot
untouched by every branch, all timestamps use `awstIsoTimestamp`) and flagged a gap in the brief's test
list, not in the code: no test drove `retire` from a non-`approved` state, and neither `publish`'s nor
`retire`'s success timestamp was ever asserted.

### Test changes

In `tests/caring-contacts-pathway-versions.test.ts`:

- Added a new test **"refuses retirement from every state except approved"**, calling `retire` against
  `draft`, `inReview`, and `retired` states in turn and asserting the exact `{ ok: false, reason:
"pathway-not-retirable" }` object each time.
- Extended **"pauses future contacts only for an urgent safety retirement"** with
  `expect(routine.retiredAt).not.toBeNull()` / `.toMatch(/\+08:00$/)` and the same pair for `urgent.retiredAt`.
- Extended **"never mutates the snapshot an active plan depends on"** with
  `expect(published.publishedAt).not.toBeNull()` / `.toMatch(/\+08:00$/)`.

No existing assertion was removed or loosened; only additions.

### Mutation proof

**Mutation A — made `retire` legal from any state** (deleted the `if (version.state !== "approved")` guard
in the `"retire"` branch of `applyPathwayVersionTransition`).

Result: exactly 1 of 7 tests went red — "refuses retirement from every state except approved" — with the
draft-state call returning `ok: true` (retiring straight out of `draft`) instead of the expected refusal.
Confirmed the assertion actually changed value (not a no-op): the received object was a full `ok: true`
`PathwayVersion` in `state: "retired"`, not merely a different failure reason.

```
Tests  1 failed | 6 passed (7)
```

Reverted; `git diff` against the last commit on `pathway-versions.ts` came back empty, confirming an exact
restore.

**Mutation B — left `publishedAt` as `null` on a successful publish** (changed the `"publish"` branch to
`return { ok: true, value: { ...version, publishedAt: null } }`).

Result: exactly 1 of 7 tests went red — "never mutates the snapshot an active plan depends on" — with
`AssertionError: expected null not to be null` on `expect(published.publishedAt).not.toBeNull()`. Confirmed
non-trivial: the assertion caught a real state difference (timestamp vs. null), not a formatting quirk.

```
Tests  1 failed | 6 passed (7)
```

Reverted; `git diff` against the last commit on `pathway-versions.ts` again came back empty.

### Final decisive line

```
node scripts/run-vitest.mjs run tests/caring-contacts-pathway-versions.test.ts
```

```
 Test Files  1 passed (1)
      Tests  7 passed (7)
```

### Concerns

None. `pathway-versions.ts` was not touched by this fix round (mutations were applied and reverted only
to prove the new tests; the final committed source is byte-identical to the round-1 commit). Only the test
file changed.
