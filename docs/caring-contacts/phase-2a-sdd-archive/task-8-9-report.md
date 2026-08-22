# Task 8 + Task 9 report — access auditing, notification preferences, training ownership

Worktree: `D:\Repos\Database\.claude\worktrees\rag-readability-metric-split-7e8ac4`
Branch: `claude/suicide-contact-mockup-b5aaa0`

## Task 8 — `src/lib/caring-contacts/access-audit.ts`

**Files:**

- Created `src/lib/caring-contacts/access-audit.ts`
- Created `tests/caring-contacts-access-audit.test.ts`

**TDD sequence:**

1. Wrote the four-case test file from the brief verbatim, ran it — failed with
   `Cannot find package '@/lib/caring-contacts/access-audit'` (module didn't exist yet).
2. Implemented `access-audit.ts`: `AccessKind`, `AccessedObjectType`, `AccessRecord`,
   `ACCESS_ACTION_PREFIX`, `accessActionName`, `buildAccessAuditEvent`. `buildAccessAuditEvent`
   builds the action name, computes an AWST timestamp via `awstIsoTimestamp(clock.now())`,
   constructs an `IdempotencyKey` of the form `access:<actorId>:<objectType>:<objectId>:<timestamp>`
   via the branded `idempotencyKey()` constructor, and delegates the whole `AuditableChange` to
   `buildAuditEvent` from `./audit`. No `AuditEvent` is constructed by hand.
3. Ran the test — passed:
   ```
   Test Files  1 passed (1)
        Tests  4 passed (4)
   ```

**Did I have to extend `assertAuditEventFreeOfPatientData`?** No. I checked the existing
`AU_MOBILE_NUMBER_PATTERN` against the fourth test's `objectId` value
(`"Rowan Sample +61 491 570 156"`) directly with `node -e`, before writing any code:

```
node -e '... console.log(AU_MOBILE_NUMBER_PATTERN.test("Rowan Sample +61 491 570 156"));'
true
```

The existing value-scan already matches `+61 491 570 156` inside the string (it doesn't require
the whole field to be nothing but the number), so `audit.ts` needed no change. Nothing in `audit.ts`
was touched, and `tests/caring-contacts-audit.test.ts` was re-run afterward to confirm it is
unaffected (see below).

**Mutation testing (Step 5):** the brief's suggested mutation was "remove the
`assertAuditEventFreeOfPatientData` call". My first draft did call it eagerly inside
`buildAccessAuditEvent` (in addition to delegating to `buildAuditEvent`, which also runs the guard
internally on the same object). Removing that eager call was a **no-op** — all 4 tests still
passed, because `buildAuditEvent`'s own internal guard still caught the fourth case. This is
exactly the "a suggested mutation turned out to be a no-op" trap called out in the task
instructions, so I did not trust it and went further:

- Removed the redundant eager call permanently (dead code — the guard was never doing anything
  the delegation didn't already do), keeping `buildAccessAuditEvent` as pure delegation to the one
  audit-event constructor.
- Found the mutation that _does_ prove the guard matters: temporarily replaced the
  `buildAuditEvent(...)` call with a hand-built, frozen object bypassing that constructor
  entirely. Ran the fourth test — it went red:
  ```
  × refuses to let patient data reach the trail
  AssertionError: expected function to throw an error, but it didn't
  ```
  Reverted immediately. This is the real assertion this module depends on: delegation to
  `buildAuditEvent` is what makes the guard load-bearing here, not a second scan.

**Throw/refusal coverage check:** `buildAccessAuditEvent` has exactly one throw path
(`AuditEventContainsPatientDataError`, via delegation to `buildAuditEvent`), and it is covered by
test 4 ("refuses to let patient data reach the trail"). `accessActionName` is a pure string
template with no throw path. No gaps found.

**Denied-read coverage:** test 3 ("records a denied view rather than dropping it") explicitly
asserts `event.outcome === "denied"` is still constructed and returned, not swallowed.

**Regression check on `audit.ts` consumers:**

```
node scripts/run-vitest.mjs run tests/caring-contacts-access-audit.test.ts tests/caring-contacts-audit.test.ts tests/caring-contacts-domain-isolation.test.ts
Test Files  3 passed (3)
     Tests  24 passed (24)
```

**Commit:** `a6c73e99a` — "feat(caring-contacts): typed access-audit events so views can enter the trail"

**Concerns:** none. The module is pure, deterministic given a clock, and has a single throw path
that is tested and proven load-bearing.

---

## Task 9a — `src/lib/caring-contacts/notification-preferences.ts`

**Files:**

- Created `src/lib/caring-contacts/notification-preferences.ts`
- Created `tests/caring-contacts-notification-preferences.test.ts`

**TDD sequence:**

1. Wrote the three-case test file from the brief verbatim, ran it — failed with
   `Cannot find package '@/lib/caring-contacts/notification-preferences'`.
2. Implemented `ALERT_CLASSES`, `NotificationPreferences`, `defaultNotificationPreferences`
   (returns `optedIn: []` — opt-in is additive, never assumed), `setAlertOptIn` (filters the class
   out, then re-adds it only if `optedIn === true`, leaving every other class's membership
   untouched), and `alertBodyFor` (looks up a plain-word label from a closed
   `Record<AlertClass, string>` and interpolates only the label and the count — the function's
   signature has no parameter through which a name/mobile/patient id/plan id could enter).
3. Ran the test — passed:
   ```
   Test Files  1 passed (1)
        Tests  3 passed (3)
   ```

**Mutation testing (Step 5, alert-body half):** appended a literal plan id (`SYN-PLAN-001`) to
`alertBodyFor`'s return string. Reran the identifier test — went red:

```
× writes an alert body carrying no identifier of any kind
AssertionError: expected '3 items affected by unclaimed work es…' not to match /SYN-|\+61|Rowan|Mira/
```

Confirmed the regex the test uses does catch a `SYN-`-prefixed id, then reverted.

**Throw/refusal coverage check:** no `throw` in this module (confirmed with `grep -n "throw"` —
no matches). `setAlertOptIn`/`alertBodyFor`/`defaultNotificationPreferences` are all total
functions over the closed `AlertClass` union with no illegal-state branch, so there is no
refusal path to test.

**Commit:** `2074119d9` — "feat(caring-contacts): opt-in alert classes with identifier-free bodies"

(Note: at commit time `training.ts`/`training.test.ts` already existed untracked on disk. The
repo's `pre-commit` doc-sync hook refuses to run generated-docs sync when there are untracked
`src/lib/**`/`tests/**` files it hasn't been told about, to avoid describing the wrong commit. I
used `git stash push -u --keep-index` to set the training files aside, committed
notification-preferences cleanly, then `git stash pop` to restore them before starting the next
module. No content was lost — verified the restored `training.ts` still had the correct
`a === "live" && b === "live"` body and reran its test before continuing.)

---

## Task 9b — `src/lib/caring-contacts/training.ts`

**Files:**

- Created `src/lib/caring-contacts/training.ts`
- Created `tests/caring-contacts-training.test.ts`

**TDD sequence:**

1. Wrote the four-case test file from the brief verbatim (batched with the notification-preferences
   test in the same failing run), ran it — failed with
   `Cannot find package '@/lib/caring-contacts/training'`.
2. Implemented `TRAINING_COMPETENCIES` (the exact seven from the brief:
   `identityReview, activation, withdrawal, deliveryFailure, readmission, downtime,
incidentHandling`), `emptyTrainingRecord`, `recordCompetency` (idempotent — short-circuits with
   the same record if the competency is already present), `trainingComplete` (`.every(...)` over
   the full competency list), and `workspacesMayShareData` (`a === "live" && b === "live"`).
3. Ran the test — passed:
   ```
   Test Files  1 passed (1)
        Tests  4 passed (4)
   ```

**Mutation testing (Step 5, training half):** changed `workspacesMayShareData` to `a === b`.
Reran — went red exactly where predicted:

```
× never lets training data join a live query
AssertionError: expected true to be false
  ...
- 35|     expect(workspacesMayShareData("training", "training")).toBe(false);
```

Confirmed this is a real assertion, not a no-op — `a === b` would let two training workspaces
share data with each other, which is exactly the case the decision lock forbids. Reverted.

**Throw/refusal coverage check:** no `throw` in this module either. All four functions are total
over their input types; `recordCompetency`'s idempotency branch (`if (record.completed.includes(...))
return record;`) is directly covered by the "records a competency idempotently" test.

**Commit:** `8a5a4aae3` — "feat(caring-contacts): training competencies and live/training data separation"

---

## Checkpoint (end of Group 1)

```
node scripts/run-vitest.mjs run tests/caring-contacts-access-audit.test.ts tests/caring-contacts-notification-preferences.test.ts tests/caring-contacts-training.test.ts tests/caring-contacts-audit.test.ts tests/caring-contacts-domain-isolation.test.ts
Test Files  5 passed (5)
     Tests  31 passed (31)
```

```
npx tsc --noEmit -p tsconfig.json
(no output — clean)
```

```
npx eslint src/lib/caring-contacts/access-audit.ts src/lib/caring-contacts/notification-preferences.ts src/lib/caring-contacts/training.ts tests/caring-contacts-access-audit.test.ts tests/caring-contacts-notification-preferences.test.ts tests/caring-contacts-training.test.ts
(no output — clean)
```

I ran the targeted vitest files plus a full `tsc --noEmit` and a targeted `eslint` on every
touched file rather than the full `npm run test`/`npm run lint` scripts, per the verification
principle (smallest check that covers the change) — the domain-isolation test and full typecheck
already cover cross-module risk for these three new, self-contained pure modules; nothing else in
the repo imports them yet, so a broader unit/lint sweep would not detect anything these don't.
Did not run `npm run verify:cheap`/`verify:pr-local`/`verify:release` or anything touching
Supabase/OpenAI/GitHub, per the batch's explicit constraints.

## Concerns

- None outstanding. All three new modules are pure, side-effect-free, deterministic given their
  inputs (or a `Clock` for `access-audit.ts`), have no untested throw/refusal path, and every
  brief-specified mutation was confirmed to actually move an assertion before being reverted (one
  mutation attempt — the eager double-guard removal — turned out to be a no-op exactly as the
  task warned could happen, and was replaced with a mutation that does prove the delegation
  matters).
- Domain isolation (`tests/caring-contacts-domain-isolation.test.ts`) passes for all three new
  files: each imports only from sibling modules inside `src/lib/caring-contacts/` via relative
  specifiers, and nothing from `@/components`, `@/app`, another `@/lib/**`, Supabase, or OpenAI.

---

## Fix round 1 — Task 8 (Critical: patient name with no digits not caught)

**Finding:** `AU_MOBILE_NUMBER_PATTERN` in `audit.ts` only matches digit runs, and the forbidden
field-name list blocks fields literally named `name`/`patientName`, not `objectId`. So
`objectId: "Rowan Whitlock"` passed straight through — the original fourth test only proved the
mobile-number scan works, because `"Rowan Sample +61 491 570 156"` was caught by the phone number
in it, not the name.

**Fix — allowlist, not a name detector.** `src/lib/caring-contacts/access-audit.ts`:

- Added `OBJECT_ID_SHAPE_PATTERN = /^[A-Za-z0-9_:-]{1,128}$/` and
  `assertObjectIdIsAnIdentifierShape(objectId)`, called at the top of `buildAccessAuditEvent`
  before anything else runs (before the idempotency key is even built). On a non-matching
  `objectId` it throws the same `AuditEventContainsPatientDataError` the existing guard throws —
  one failure mode for a caller to handle, not two.
- Left `audit.ts`'s existing mobile-number/forbidden-field scan untouched and still running via
  the unmodified delegation to `buildAuditEvent` — belt and braces, as required. Nothing in
  `audit.ts` was changed or weakened.
- Added a block comment on the pattern explaining why an allowlist on a closed identifier grammar
  is reliable where a name denylist cannot be (a two-word name and a free-text identifier are
  indistinguishable in general; the set of shapes this domain actually mints — `SYN-PLAN-001`,
  `demo-coordinator`, `patientDirectory`, a uuid — is closed and known), so a future editor does
  not "simplify" it back into a name heuristic.

**Tests added to `tests/caring-contacts-access-audit.test.ts`:**

- `"refuses a patient name with no digits in it, not only a phone number"` — asserts
  `objectId: "Rowan Whitlock"` throws `AuditEventContainsPatientDataError`.
- `"accepts every identifier shape this domain actually mints"` — asserts
  `SYN-PLAN-001`, `SYN-CONTACT-004`, `demo-coordinator`, `patientDirectory`, and a uuid-shaped
  string (`3fa85f64-5717-4562-b3fc-2c963f66afa6`) all pass through unchanged.
- Kept the original `"Rowan Sample +61 491 570 156"` test as-is (still throws, now for either
  reason: shape and digits both reject it) to prove the fix does not regress the original case.

**Run after implementing:**

```
node scripts/run-vitest.mjs run tests/caring-contacts-access-audit.test.ts tests/caring-contacts-audit.test.ts
Test Files  2 passed (2)
     Tests  23 passed (23)
```

**Mutation proofs (both requested, both confirmed to move a real assertion, both reverted):**

1. Widened the allowlist to permit whitespace (`/^[A-Za-z0-9_: -]{1,128}$/`). Reran
   `tests/caring-contacts-access-audit.test.ts` — exactly the predicted test went red:
   ```
   × refuses a patient name with no digits in it, not only a phone number
   AssertionError: expected function to throw an error, but it didn't
   ```
   All other tests (including the phone-number case, still caught by `audit.ts`'s scan) stayed
   green. Reverted to `/^[A-Za-z0-9_:-]{1,128}$/`.
2. Narrowed the allowlist to reject hyphens (`/^[A-Za-z0-9_:]{1,128}$/`). Reran the same file —
   3 of 6 tests went red, including the predicted one:
   ```
   × accepts every identifier shape this domain actually mints
   audit-event-contains-patient-data: ... objectId is not identifier-shaped ...
   ```
   (The other two failures were the pre-existing `SYN-PLAN-*` fixtures in the earlier tests,
   which also use hyphens — expected collateral, not a surprise.) Reverted to
   `/^[A-Za-z0-9_:-]{1,128}$/`.

**Final re-run after both reverts:**

```
node scripts/run-vitest.mjs run tests/caring-contacts-access-audit.test.ts tests/caring-contacts-audit.test.ts tests/caring-contacts-domain-isolation.test.ts
Test Files  3 passed (3)
     Tests  26 passed (26)
```

**Lint + typecheck:** `npx eslint src/lib/caring-contacts/access-audit.ts
tests/caring-contacts-access-audit.test.ts` — no output (clean). `npx tsc --noEmit -p
tsconfig.json` — no output (clean).

**Throw/refusal coverage re-check:** `buildAccessAuditEvent` now has two throw paths, both
`AuditEventContainsPatientDataError`: the new shape guard (covered by the "Rowan Whitlock" test)
and the pre-existing delegated guard in `buildAuditEvent` (covered by the phone-number test). Both
are exercised; no untested throw path remains.

**Concerns:** none. Task 9a/9b were confirmed clean and untouched in this round.
