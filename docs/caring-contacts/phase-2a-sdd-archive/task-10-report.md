# Task 10 report — extend the storage contract and the in-memory store

## Files changed

- `src/lib/caring-contacts/repository.ts` — new imports from every Group-1 module; six new
  `REPOSITORY_REFUSALS` entries; seven new supporting types (`CreateReferralInput`,
  `ReferralTransitionInput`, `SavePathwayVersionInput`, `PathwayVersionTransitionInput`,
  `DispatchRecord`, `DispatchDiscrepancyResolution`, `ResolveDiscrepancyInput`,
  `AccessTrailQuery`); 20 new `CaringContactRepository` interface methods (the 19 the brief lists
  plus `rescheduleContact` from Ruling 1). Existing 16-method surface untouched.
- `src/lib/caring-contacts/in-memory-repository.ts` — implements all 20 new methods; generalises
  `runWrite`'s commit mechanism from a hardcoded `nextPlan: StoredPlan | null` to a generic
  `commit?: () => void` callback so referrals/pathway versions/service state/assignment/dispatch
  records/preferences/training/retention can each commit to their own map through the same audited
  path a plan write already used; adds the service-safety-stop gate as a single check inside
  `runWrite` (bypassed only by `stopService`, `approveServiceRestart`, `recordHospitalStatusEvent`);
  adds seven new storage maps plus one singleton (`serviceState`) and their helper functions.
- `tests/caring-contacts-repository.test.ts` — extended from 11 lines to ~1014. The existing
  16-method contract call (`describeCaringContactRepositoryContract`) is untouched. Added one new
  top-level `describe` with the brief's Step-1 suite (Ruling 2 applied) plus ten further `describe`
  blocks covering every new method's refusal paths.

## The three rulings

1. **`rescheduleContact` added.** Delegates to `moveContactWithinDay`/`changeContactDate`
   (`contact-rescheduling.ts`), using the STORED `planned` value as the source of truth rather than
   the caller's copy (a caller-supplied `PlannedContact` could otherwise smuggle a different
   `calendarDay`/`sendAt` past the two window/day checks). Bumps `contact.version` on success so a
   second concurrent reschedule of the same contact is refused as stale — reschedule does not touch
   `contact.state`, so without an explicit version bump optimistic concurrency would silently not
   apply to this write. Domain refusals pass through unchanged: `contact-move-leaves-scheduled-day`,
   `contact-move-outside-approved-window`, `contact-date-change-reason-required`,
   `contact-date-change-approval-required`, `contact-date-change-in-the-past`.
2. **Ruling 2 test replaced.** `tests/caring-contacts-repository.test.ts` line ~185 now asserts,
   after `resolveDispatchDiscrepancy` with `unresolvedNoResend`: the contact's `state` and
   `version` are byte-identical to what they were right after `startContactDispatch` (proving
   nothing touched the contact), and `listDispatches` still shows exactly one attempt row for that
   contact (proving no second dispatch attempt was ever opened). The tautological
   `Object.keys(store)).not.toContain("resendContact")` line is gone.
3. **Service state is a store-wide singleton.** One `let serviceState: ServiceState` in the
   closure, never a per-team map. `getServiceState` returns it unconditionally to every actor of
   every team (see "Design decisions" below for why it carries no permission gate). New test
   `service safety stop is a store-wide singleton (Ruling 3) > makes a stop raised by team A block
dispatch for a plan owned by team B` proves a stop from `coordinator` (TEAM-NORTH) refuses a
   write on a plan owned by `coordinatorB` (TEAM-SOUTH), and a second test proves both teams'
   actors receive `toEqual` (not just equivalent) `ServiceState` objects.

## Test commands and decisive output

```
node scripts/run-vitest.mjs run tests/caring-contacts-repository.test.ts tests/caring-contacts-domain-isolation.test.ts
```

```
 Test Files  2 passed (2)
      Tests  84 passed (84)
```

```
npx tsc --noEmit -p tsconfig.json
```

Exit 2, exactly one error — see "Known consequence" below; `repository.ts` and
`in-memory-repository.ts` produce zero diagnostics.

```
npx eslint src/lib/caring-contacts/repository.ts src/lib/caring-contacts/in-memory-repository.ts tests/caring-contacts-repository.test.ts
```

No output (0 errors, 0 warnings).

## Mutations (Step 5)

**Mutation A — delete the service-stop gate.** Changed
`const blockedByServiceStop = !spec.bypassServiceStopGate && !previous && serviceStopBlocksDispatch(serviceState);`
to `const blockedByServiceStop = false;` and reran the same command:

```
Test Files  1 failed (1)
      Tests  4 failed | 77 passed (81)
```

Failed: the brief's own test 1 (`refuses every ordinary mutation while the service is stopped...`),
plus three of my own tests that gate other new methods (`applyAssignment`,
`saveNotificationPreferences`, `markRetentionCleared`) and the Ruling-3 cross-team test — proving
the single gate placement, not a per-method copy, is what every one of those tests actually
exercises. Reverted; reran to confirm 81/81 green again before moving to mutation B.

**Mutation B — delete the audit-append line.** Commented out `auditEvents.push(event);` inside
`runWrite` (the one line every write, old and new, shares) and reran:

```
Test Files  1 failed (1)
      Tests  6 failed | 75 passed (81)
```

Failed: six of the pre-existing "rule 2 — exactly one audit event" contract tests (`appends exactly
one allowed event...`, `appends exactly one denied event...`, `returns empty rather than a
refusal...`, `keeps patient-identifying detail out of...`, `records a death as a hospital status
event...`, `appends one audit event per contact-status write...`). There is no separate "audit
call" living inside any individual new method to delete — every new write commits through the same
single `runWrite` path a plan write already used, so this IS the proof that a future method cannot
forget the audit step by omission. Reverted; reran, 81/81 green (84/84 with domain isolation).

Both reverts confirmed via a full rerun before proceeding.

## A bug I introduced and caught myself

My first full test run (before any of the above) showed 16 failures. Root cause: my own test
helper `createActivePlan` returned `{ plan: activated }` where `activated` was already the full
`PlanRecord` (itself shaped `{ plan: Plan, patientId, ... }`) — so the helper doubly nested the
result and every `plan.plan.id` in the tests (matching the brief's own literal usage) actually
needed to be `plan.plan.plan.id`. Fixed by returning `activated` directly (`Promise<PlanRecord>`),
which makes `plan.plan.id` correct everywhere, matching the brief's test code unchanged. A second,
unrelated bug in the same run: the "three distinct roles" restart test reused `teamLead` for both
the first and third approval (only `teamLead`/`clinicalProgrammeLead` hold `approveServiceRestart`,
so a genuine three-actor proof needs a second `teamLead`-role actor) — added `teamLead2` and fixed
the third approval's `writeContext`. Both were caught by rerunning before trusting green, per
`superpowers:verification-before-completion`; confirmed via a standalone `tsx` reproduction outside
vitest before touching test code, so the diagnosis was to the actual bug rather than a guess.

## Refusal-path enumeration

Every reason string a new method can return, and the test that asserts it:

| Method                        | Reason                                                                                                                                | Test                                                                                                                                                                                                                                                  |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rescheduleContact`           | `permissionDenied`, `staleVersion`, `contact-move-leaves-scheduled-day`*                                                              | covered by window/day test, permission test, stale-version test                                                                                                                                                                                       |
| `rescheduleContact`           | `contact-move-outside-approved-window`                                                                                                | "refuses a move that leaves the scheduled day or the approved window"                                                                                                                                                                                 |
| `rescheduleContact`           | `contact-date-change-reason-required`                                                                                                 | "changes a contact's date only with..."                                                                                                                                                                                                               |
| `rescheduleContact`           | `contact-date-change-approval-required`                                                                                               | same test                                                                                                                                                                                                                                             |
| `createReferral`              | `permissionDenied`, `referralAlreadyExists`                                                                                           | "creates a referral, refuses a duplicate id..."                                                                                                                                                                                                       |
| `transitionReferral`          | `notFound`, `referral-not-awaiting-handover`, `referral-reason-required`                                                              | two referral tests                                                                                                                                                                                                                                    |
| `savePathwayVersion`          | `permissionDenied`, `pathwayVersionAlreadyExists`                                                                                     | "saves a version, refuses a duplicate id..."                                                                                                                                                                                                          |
| `transitionPathwayVersion`    | `notFound`, `permissionDenied`, `self-approval-denied`, `pathway-not-in-review`                                                       | three pathway tests (full lifecycle test also exercises success through submit/approve×2/publish/retire)                                                                                                                                              |
| `stopService`                 | `permissionDenied`, `service-already-stopped`, `service-stop-note-required`                                                           | "stopService and approveServiceRestart" describe                                                                                                                                                                                                      |
| `approveServiceRestart`       | `permissionDenied`, `service-not-stopped`, `restart-approval-role-already-recorded`, `restart-approval-actor-already-recorded`        | same describe; full 3-approval success also proven                                                                                                                                                                                                    |
| `applyAssignment`             | `notFound`, `permissionDenied`, `plan-already-claimed`, `plan-not-claimed`, `reassignment-reason-required`, `coverage-window-invalid` | "assignment" describe (three tests)                                                                                                                                                                                                                   |
| `resolveDispatchDiscrepancy`  | `notFound`, `permissionDenied`, `dispatchDiscrepancyAlreadyResolved`, `dispatchDiscrepancyNoteRequired`                               | "dispatch reconciliation" describe                                                                                                                                                                                                                    |
| `recordAccess`                | throws `AuditEventContainsPatientDataError`                                                                                           | "throws rather than record a non-identifier-shaped objectId"                                                                                                                                                                                          |
| `saveNotificationPreferences` | `permissionDenied` (impersonation and system-actor cases)                                                                             | "notification preferences" describe                                                                                                                                                                                                                   |
| `recordTrainingCompetency`    | `permissionDenied`                                                                                                                    | "training" describe                                                                                                                                                                                                                                   |
| `markRetentionCleared`        | `notFound`, `permissionDenied`                                                                                                        | "markRetentionCleared" describe                                                                                                                                                                                                                       |
| every gated write             | `serviceStopped`                                                                                                                      | brief's test 1 + Ruling-3 "also gates a new write method..." + `markRetentionCleared`'s own stopped test — a representative sample, not all ~16 write methods individually, since they share one code path (proven fragile to deletion in Mutation A) |

**`trainingWorkspaceIsolated` — declared, not reachable, no test.** None of the interface method
signatures the brief specifies (verbatim, per the task instructions) carry a workspace parameter —
`WriteContext`/`ReadContext` name only an actor, and `RepositoryOptions` is `{ auditSink? }`. There
is therefore no legitimate call site in this task's scope that can produce this refusal without
inventing an interface surface the brief didn't ask for. I added the constant as instructed and
left it unwired, rather than bolt on a speculative `workspaceKind` parameter not in the brief.
Flagging this explicitly as a decision the next task (or the plan owner) should confirm or correct.

## Design decisions worth flagging

- **`getServiceState` and `getNotificationPreferences`/`getTrainingRecord` carry no permission
  gate.** Their return types are non-nullable (`Promise<ServiceState>`,
  `Promise<NotificationPreferences>`, `Promise<TrainingRecord>`), so there is no way to express a
  "denied" read within the given signatures other than throwing (not this codebase's convention for
  an expected condition). For the notification/training reads this is safe by construction — they
  are always scoped to the calling actor's own record, so there is no cross-actor read to deny. For
  `getServiceState`, the domain's own doc comments say the banner "must render on every screen,
  including ones showing no patient at all," so I read a universal, ungated read as the intended
  design rather than an oversight.
- **`recordAccess` is exempt from the service-stop gate by construction**, not by an added
  bypass flag — it returns `void`, not `TransitionResult`, and never goes through `runWrite`.
  Documented in both the interface and the implementation: blocking the access trail mid-incident
  would silence exactly the evidence an `audit-integrity-loss` stop exists to preserve. Test added
  proving `recordAccess` still records while stopped.
- **`markRetentionCleared` and `getAssignment`/`applyAssignment`'s permission gates use the
  closest-fit existing `CaringContactAction`** (`generateClinicalRecordSummary` for retention;
  `claimPlan`/`reassignPlan`/`coverCoordinator` for assignment) since `permissions.ts` is not in
  this task's file list and no new action name exists for these operations. Flagging in case a
  dedicated action is intended for a later task.
- **`postgres-repository.ts` now fails `tsc`** (missing the 20 new interface methods) —
  confirmed as the single remaining project-wide typecheck error. Per `progress.md`'s own resume
  point, this file predates Phase 2A (Phase 1's Postgres store) and Task 11 is explicitly "extend
  the storage contract... Postgres implementation and its migration are the next task," so this is
  the expected, not accidental, consequence of extending the interface. Not touched — outside this
  task's file list (`repository.ts`, `in-memory-repository.ts`, the one test file).

## Not run

`verify:cheap`, `verify:pr-local`, `check:production-readiness`, any provider-backed or
`caring-contacts:db:test` command — none requested, and several are explicitly forbidden for this
task. No commit or push beyond what Step 6 asked for (see below).

## Fix round 1

Review findings on the Task 10 commit, fixed test-first in one commit (`944ce3201`). Scope was
limited to `src/lib/caring-contacts/repository.ts`, `src/lib/caring-contacts/in-memory-repository.ts`
and `tests/caring-contacts-repository.test.ts`; nothing else was touched.

Line numbers below are post-fix (post-`prettier`), so they will not match the reviewer's citations
against the pre-fix file.

### CRITICAL 1 — `savePathwayVersion` let one actor publish governed content with zero approvals

**Changed:** `src/lib/caring-contacts/in-memory-repository.ts:852-879`. The one-line
`const version: PathwayVersion = { ...input.version, teamId: context.actor.teamId }` is replaced by
an explicitly constructed record. Per **Ruling 14** the save persists AUTHORED CONTENT ONLY — `id`
and `snapshot` come from the caller; `teamId` from `context.actor.teamId`, `state` `"draft"`,
`authorId` `context.actor.id`, `approvals` `Object.freeze([])`, and `publishedAt` / `retiredAt` /
`retirementUrgency` all `null` are constructed server-side regardless of what the caller supplied.
Every governance transition stays in `transitionPathwayVersion`.

`./pathway-versions.ts` has **no factory or constructor** to reuse — it exports only
`applyPathwayVersionTransition`, `retirementPausesFutureContacts`,
`REQUIRED_PATHWAY_APPROVAL_ROLES` and its types. The literal therefore uses that module's own
vocabulary and null/empty representations (`approvals` frozen-empty exactly as
`applyPathwayVersionTransition` builds it, the three nullable governance timestamps as `null`)
rather than inventing shapes. Adding a factory would have meant editing `pathway-versions.ts`,
which is outside this task's file list.

**Note on the dispatched exploit string.** The controller's mid-task correction is confirmed:
`PathwayVersionState` (`src/lib/caring-contacts/model.ts:20`) is exactly
`"draft" | "inReview" | "approved" | "retired"`, so `state: "published"` would not typecheck. The
tests use `state: "approved"` with forged approvals, a foreign `authorId` and a non-null
`publishedAt` — the variant that actually lands, because publication is a `publishedAt` recorded on
an approved version rather than a state of its own.

**Covering tests** (`tests/caring-contacts-repository.test.ts:632-706`, in the `pathway versions`
describe):

- `persists authored content only -- state, approvals, authorId and publication are constructed
server-side (Ruling 14)` — saves a version carrying `state: "approved"`, two forged approvals, a
  foreign `authorId`, a non-null `publishedAt`, a non-null `retiredAt` and
  `retirementUrgency: "urgentSafety"`; asserts the returned record AND the stored record are a draft
  authored by the caller with no approvals and null publication timestamps, and that the `snapshot`
  is kept verbatim.
- `refuses to publish a version a caller tried to seed as already approved -- dual approval is not
bypassable by a save` — proves the control is genuinely restored: after such a save, a publish by
  the `clinicalProgrammeLead` (the only holder of `publishPathwayVersion`) is refused
  `pathway-not-approved`.

**No existing test encoded the vulnerability.** The pre-existing
`saves a version, refuses a duplicate id…` case asserted `expect(saved.state).toBe("draft")` against
a genuinely-draft input, so it was already consistent with Ruling 14 and needed no change.

**Command and decisive line:**

```
node scripts/run-vitest.mjs run tests/caring-contacts-repository.test.ts tests/caring-contacts-domain-isolation.test.ts
```

```
 Test Files  2 passed (2)
      Tests  101 passed (101)
```

**Mutation:** restored `const version: PathwayVersion = { ...input.version, teamId: context.actor.teamId };`.

```
       × persists authored content only -- state, approvals, authorId and publication are constructed server-side (Ruling 14) 28ms
       × refuses to publish a version a caller tried to seed as already approved -- dual approval is not bypassable by a save 11ms
      Tests  2 failed | 99 passed (101)
```

Reverted.

### IMPORTANT 2 — nothing proved any of the 21 new writes is audited

**Changed:** tests only — `tests/caring-contacts-repository.test.ts:1054-1191`, a new
table-driven describe `every new write group appends its own audit event`. Nine cases, one
representative write per new group: referrals (`createReferral`), pathway versions
(`savePathwayVersion`), service state (`stopService`), assignment (`applyAssignment`), dispatch
reconciliation (`resolveDispatchDiscrepancy`), notification preferences
(`saveNotificationPreferences`), training (`recordTrainingCompetency`), retention
(`markRetentionCleared`) and contact rescheduling (`rescheduleContact`).

Each case `arrange`s its own store, snapshots `listAuditEvents` (read as the `auditor`, who holds
`viewAccessTrail`), performs exactly one write, and asserts
`after.slice(before.length).map((e) => e.action)` equals `[expectedAction]` — i.e. that the write
appended exactly one event and that it carries the right action. A method that committed straight
to its own map appends nothing and fails; a method that appended two would fail as well.

All nine passed on the first run, so no store change was needed — every new write already routes
through `runWrite`. The value is the regression guard the brief's Step 5 asked for and the original
report did not obtain.

**Command and decisive line:** as above, `Tests  101 passed (101)`.

**Mutation:** the first attempt was a bad one and I discarded it. Replacing `createReferral`
wholesale with a direct `referrals.set(...)` reddened three tests, but two of those were catching
the _permission checks I had also dropped_, not the audit bypass — the mutation conflated two
defects and would have over-credited the new test. The second, targeted mutation kept every
permission and duplicate-id check intact and only committed outside `runWrite`:

```
       × appends exactly one "createReferral" event for a referrals write 17ms
      Tests  1 failed | 100 passed (101)
```

Exactly one test caught it, and it was the new one. That is the precise claim the original report
made without evidence: a new method that keeps its guards but commits directly passes every other
test in the file. Reverted.

### IMPORTANT 3 — a `service-stopped` refusal was cached against the idempotency key forever

**Changed:** `src/lib/caring-contacts/in-memory-repository.ts:337-345`, the final line of
`runWrite`:

```ts
if (!previous && !blockedByServiceStop) idempotency.set(scope, { fingerprint, result });
```

Per **Ruling 15**, only the `service-stopped` refusal is exempt. Every other refusal is still
recorded, so the deliberate general replay semantics are untouched.

**Covering tests** (in the `stopService and approveServiceRestart` describe):

- `does not poison the idempotency key with a service-stopped refusal -- the same retry succeeds
after the restart` (`:365-399`) — a `pausePlan` refused `service-stopped` under key
  `pause-retry`, then the three distinct-role restart approvals, then the identical `pausePlan`
  under the SAME key, which must now succeed.
- `still replays every OTHER refusal against the same key, even once its cause is gone`
  (`:401-434`) — a guard against over-fixing: `markRetentionCleared` on an absent plan is refused
  `not-found` under key `late-key`; the plan is then created; replaying `late-key` must still
  return the ORIGINAL `not-found` rather than recomputing a success. This test would fail if I had
  cleared the cache for refusals generally.

The pre-existing test at `:342` (a NEW plan with a NEW key after restart) was left in place
untouched.

**Command and decisive line:** as above, `Tests  101 passed (101)`.

**Mutation:** restored `if (!previous) idempotency.set(scope, { fingerprint, result });`.

```
       × does not poison the idempotency key with a service-stopped refusal -- the same retry succeeds after the restart 18ms
      Tests  1 failed | 100 passed (101)
```

Reverted.

### IMPORTANT 4 — `getAssignment` and `getServiceState` returned live internal references

**Changed, assignment half:** new `cloneAssignment` helper at
`src/lib/caring-contacts/in-memory-repository.ts:178-192`, used by `getAssignment` (`:1018-1023`)
and by the value `applyAssignment` returns (`:1058-1064`). It copies `ownerId`, `claimedAt`, the
`coveredBy` object and each `reassignmentHistory` entry — `applyAssignmentAction`'s `claim` branch
shares its input's history array, so the returned value leaked a live reference too, not just the
read.

**Changed, service-state half:** `getServiceState` (`:943-953`) now freezes the state, its
`restartApprovals` array and each approval on the way out.

**Covering tests** — new describe `reads hand back something a caller cannot rewrite in place`
(`:800-861`):

- `returns a copy from getAssignment, so plan ownership cannot be rewritten without a write` —
  claims a plan, starts coverage, then rewrites `ownerId`, `claimedAt` and `coveredBy.actorId` on
  the returned object and asserts a subsequent read is unchanged.
- `returns a service state a caller cannot rewrite in place` — asserts `Object.isFrozen` on both
  the state and its `restartApprovals`, and that a second read still carries the original reason,
  note and reporter.

**Command and decisive line:** as above, `Tests  101 passed (101)`.

**Mutations:**

- `getAssignment` restored to `return assignments.get(planId) ?? unassigned();`
  ```
         × returns a copy from getAssignment, so plan ownership cannot be rewritten without a write 19ms
        Tests  1 failed | 100 passed (101)
  ```
- `getServiceState` restored to `return serviceState;` — **NO-OP, the suite stayed green**
  (`Tests  101 passed (101)`).

  **The `getServiceState` half of this finding was not a live defect.** `service-state.ts`
  `Object.freeze`s every value it constructs — `runningService`, `applyServiceStop`, and both
  branches of `applyServiceRestartApproval` — and the freeze reaches the `restartApprovals` array
  and each approval inside it, so the stored singleton was already deeply immutable and the
  reviewer's "a caller can rewrite an incident note in place" was not reachable. The freeze I added
  to `getServiceState` is belt and braces: it makes the read contract this store's own rather than
  a property of whichever module happens to build the value.

  Because a mutation that leaves the suite green proves nothing, I ran a second one: removing the
  `Object.freeze` from `applyServiceStop` in `service-state.ts` _as well_.

  ```
         × returns a service state a caller cannot rewrite in place 30ms
        Tests  1 failed | 100 passed (101)
  ```

  So the assertion is not decorative — it pins the property — but it is currently held up by the
  upstream freeze, not by my line. Both mutations reverted; `service-state.ts` is byte-identical to
  `HEAD` (`git status` shows only the three in-scope files).

### IMPORTANT 5 — `applyAssignment` did not bind a claim to the writing actor

**Changed:** `src/lib/caring-contacts/in-memory-repository.ts:1046-1054`. After the team-scope and
permission checks, a `claim` whose `actorId` is not `context.actor.id` is refused
`REPOSITORY_REFUSALS.permissionDenied` — refused rather than silently rebound, so the attempt is
observable, and reusing the existing refusal keeps the vocabulary the file already has (it is the
same rule `saveNotificationPreferences` applies to its own `actorId`). Scoped to `claim` only;
`startCoverage`'s `actorId` and `reassign`'s `toActorId` are untouched.

**Covering tests** (in the `assignment` describe, `:753-798`):

- `refuses a claim that names an actor other than the caller, so the ledger and the audit trail
cannot disagree` — the coordinator claiming on the team lead's behalf is refused, the assignment
  stays unowned, and the coordinator's own claim then succeeds.
- `still lets coverage and reassignment name a third party, which is the whole point of both` —
  `startCoverage` naming a third actor and `reassign` naming a fourth both still succeed.

**Command and decisive line:** as above, `Tests  101 passed (101)`.

**Mutation:** deleted the binding check.

```
       × refuses a claim that names an actor other than the caller, so the ledger and the audit trail cannot disagree 43ms
      Tests  1 failed | 100 passed (101)
```

Reverted.

### MINOR — `trainingWorkspaceIsolated` removed

**Changed:** `src/lib/caring-contacts/repository.ts` — the `trainingWorkspaceIsolated` entry and its
doc comment are deleted from `REPOSITORY_REFUSALS`, per **Ruling 16**. No wiring attempted.
`grep` confirmed the constant had exactly one code reference (its own declaration); the remaining
hits are planning and build-record documents, which are outside this task's file list and are
left alone.

### MINOR — invented mobile number replaced

**Changed:** `tests/caring-contacts-repository.test.ts:30` imports
`FICTIONAL_CONTACTS_BY_ROLE` from `@/lib/caring-contacts/synthetic-contacts`, and the shared
`PATIENT_DETAIL` (`:69`) now uses `FICTIONAL_CONTACTS_BY_ROLE.rowanPatientMobile`
(`+61 491 570 156`) in place of the invented `+61 491 570 999`. The module has a suitable constant
and the fixture's patient is already named "Rowan Sample", so the mapping is the obvious one.

### MINOR — two overclaiming test titles

- `refuses a second stop while one is already recorded, and a blank note` → title trimmed to
  `refuses a second stop while one is already recorded`. Strengthening was the wrong call here:
  the very next test (`refuses a blank note on the first stop`) already covers the blank note, and
  a blank note offered to an ALREADY-stopped service returns `service-already-stopped`, not
  `service-stop-note-required` (`applyServiceStop` checks the stop first), so folding it in would
  have asserted something different from what the title promised.
- The `listAccessTrail` positive control was
  `expect((await store.listAccessTrail(…, { actor: auditor })).length).toBeGreaterThan(0)`, which
  the plan-creation writes satisfy on their own. Strengthened to name the event:
  `expect(auditorTrail.map((event) => event.action)).toContain("access:view:plan")`. No assertion
  was removed — the replacement is strictly stronger.

### Gates run

```
node scripts/run-vitest.mjs run tests/caring-contacts-repository.test.ts tests/caring-contacts-domain-isolation.test.ts
```

```
 Test Files  2 passed (2)
      Tests  101 passed (101)
```

Neighbouring domain suites, to catch a regression outside the two files under test:

```
node scripts/run-vitest.mjs run tests/caring-contacts-message-policy.test.ts tests/caring-contacts-audit.test.ts tests/caring-contacts-pathway-versions.test.ts tests/caring-contacts-assignment.test.ts tests/caring-contacts-service-state.test.ts
```

```
 Test Files  5 passed (5)
      Tests  74 passed (74)
```

```
npx eslint src/lib/caring-contacts/repository.ts src/lib/caring-contacts/in-memory-repository.ts tests/caring-contacts-repository.test.ts
```

No output, exit 0.

```
npx prettier --check src/lib/caring-contacts/repository.ts src/lib/caring-contacts/in-memory-repository.ts tests/caring-contacts-repository.test.ts
```

```
All matched files use Prettier code style!
```

```
npx tsc --noEmit -p tsconfig.json
```

Exactly one error, and it is the known deliberate one:

```
src/lib/caring-contacts/db/postgres-repository.ts(597,3): error TS2740: Type '{ createPlan(...): ...; ... 14 more ...; getEpisode(...): Promise<...>; }' is missing the following properties from type 'CaringContactRepository': rescheduleContact, createReferral, transitionReferral, listReferrals, and 18 more.
```

`repository.ts` and `in-memory-repository.ts` produce zero diagnostics. `postgres-repository.ts` was
not touched, stubbed, or worked around; Task 11 owns it.

**Formatting churn.** `npx prettier --check` on the `HEAD` blobs of both touched files reported both
as unformatted, so `npm run format` reflowed a number of pre-existing long lines that this change
does not otherwise touch. That churn is inherited debt, not introduced by these fixes — and it would
have blocked the push guard regardless.

### Deliberately not done

- The deferred list was left alone in full: untested `rescheduleContact` refusals,
  `retentionCleared` written-never-read, `listAccessTrail` never exercising a non-zero `offset`,
  the repeated permission/lookup guard and its action-selecting ternaries, NaN date handling in
  `listDispatches`/`listAccessTrail`, file size, and `DispatchRecord.expectedStatus` being unwritten.
  No opportunistic refactoring was performed anywhere in the two source files.
- `src/lib/caring-contacts/db/postgres-repository.ts` untouched, and the interface was not narrowed
  to make it compile.
- `pathway-versions.ts` untouched, so no `draftPathwayVersion` factory was added there even though
  `savePathwayVersion` and the test helper now build the same draft shape independently. Worth
  considering when Task 11 needs the same construction for the Postgres store.
- Nothing pushed, no PR opened, no branch state changed beyond the single commit.

### Concern to carry

`getServiceState`'s immutability currently rests on `service-state.ts`'s freezes plus the shallow
freeze I added, not on a defensive copy. If a later change makes `ServiceState` hold a mutable
nested structure that `service-state.ts` does not freeze, my `getServiceState` freeze will not reach
it and the covering test will not notice. A structural clone would be the durable fix; it was not
made here because the finding explicitly allowed freezing and because a clone would break the
reference identity that `returns the exact same record to every actor of every team` reads as its
singleton proof.
