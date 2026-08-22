# Task 3 report — Service safety stop

**Status:** DONE
**Worktree:** `D:\Repos\Database\.claude\worktrees\rag-readability-metric-split-7e8ac4`
**Branch:** `claude/suicide-contact-mockup-b5aaa0`
**Commit:** `c976ff9c23b2aceadbc9c9f05b8a41aff3930b52`

---

## Changes, file by file

### `src/lib/caring-contacts/service-state.ts` (new, 212 lines)

The module built to the brief's interface exactly — same export names, same signatures, same
refusal strings. Pure transitions: injected `Clock`, no storage, no permission check, no ambient
time, no import outside the sealed domain (`./clock`, `./ids`, `./model` only).

Decisions worth recording:

- **`applyServiceStop` checks `state.stopped` before it checks the note.** Both orderings pass the
  brief's tests (the already-stopped case supplies a non-blank note), so the ordering was chosen on
  merit rather than pinned by a test: "the first record is never overwritten" is the dominant rule,
  and an already-stopped service should refuse a second stop regardless of what the second caller
  typed. A later reader who flips this order will not be caught by a test — that is stated here so
  the choice is deliberate and visible rather than accidental.
- **Both approval-uniqueness guards are independent `some()` checks over the recorded approvals**,
  role first, then actor. Their relative order is not observable from the brief's tests (each test
  case trips exactly one of them), so neither ordering can silently regress the other.
- **The restart condition is `REQUIRED_RESTART_APPROVAL_ROLES.every(role => approvals.some(...))`,
  not a length comparison.** A length check (`approvals.length === 3`) would be equivalent only
  because the role guard already forbids duplicates — it would restart on any three approvals if
  that guard were ever weakened. Deriving the condition from the required-roles list means the
  completeness rule cannot drift away from the list that defines it.
- **Restarting returns `runningService(teamId)`, discarding the approval record from state.** That
  is what the brief's `ServiceState` union requires (the running variant carries only `teamId`).
  The durable account of who approved the restart belongs in the audit trail, which is the caller's
  responsibility — noted in the module header so this is not mistaken for data loss.
- **`describeServiceStop` deliberately omits the free-text `note`.** Rule 7 says the banner must
  never contain patient information, and the note is written by a responder mid-incident — the
  brief's own fixture note is `"Message SYN-CONTACT-004 reached the wrong number."`. Including it
  would still have passed the test's `not.toMatch(/Rowan|Mira|\+61/)` assertion, which is exactly
  why the exclusion is stated in the doc comment rather than left to the test to enforce. The
  banner names the reason in plain words, the recorded count as `"N of 3"`, and which roles are
  still outstanding.
- Every returned state object is `Object.freeze`d, matching the frozen-record convention `audit.ts`
  already sets in this domain.

### `src/lib/caring-contacts/clock.ts` (modified, +12 lines)

Added `awstIsoTimestamp(instant: Date): string` — the AWST `+08:00` ISO form, moved here verbatim
from the private helper in `audit.ts`. The brief instructed reuse of `audit.ts`'s approach rather
than a second timestamp format; the helper was not exported, so the choice was between exporting it
from `audit.ts` or moving it to the module that already owns time for this domain. `clock.ts` is the
right home, and it means `service-state.ts` does not have to import from `audit.ts` (which it has no
other business with).

### `src/lib/caring-contacts/audit.ts` (modified, −12/+1 lines)

`toAwstIsoTimestamp` deleted; `buildAuditEvent` now calls `awstIsoTimestamp` from `./clock`. Pure
refactor — the function body is unchanged, so output is byte-identical, and
`tests/caring-contacts-audit.test.ts` (unmodified) stays green as the proof.

### `tests/caring-contacts-service-state.test.ts` (new, 8 tests)

The brief's test code verbatim. No assertion was deleted, loosened, or added.

---

## Test commands and decisive output

`npm run test:focused` fails closed when the diff includes a test file, so the underlying runner was
used directly, as instructed.

**Step 2 — the test failing before implementation:**

```
$ node scripts/run-vitest.mjs run tests/caring-contacts-service-state.test.ts
 FAIL  |node| tests/caring-contacts-service-state.test.ts
Error: Cannot find package '@/lib/caring-contacts/service-state' imported from .../tests/caring-contacts-service-state.test.ts
 Test Files  1 failed (1)
```

Failed for exactly the stated reason.

**Step 4 — the test passing after implementation:**

```
$ node scripts/run-vitest.mjs run tests/caring-contacts-service-state.test.ts
 Test Files  1 passed (1)
      Tests  8 passed (8)
```

**Shared-module regression check** (`clock.ts` and `audit.ts` are used by the rest of the domain) —
the whole caring-contacts unit suite:

```
$ node scripts/run-vitest.mjs run tests/caring-contact-prototype-state.test.ts \
    tests/caring-contact-route-files.test.ts tests/caring-contacts-audit.test.ts \
    tests/caring-contacts-clock.test.ts tests/caring-contacts-domain-isolation.test.ts \
    tests/caring-contacts-hospital-events.test.ts tests/caring-contacts-message-copy.test.ts \
    tests/caring-contacts-message-policy.test.ts tests/caring-contacts-migrations.test.ts \
    tests/caring-contacts-model.test.ts tests/caring-contacts-permissions.test.ts \
    tests/caring-contacts-repository.test.ts tests/caring-contacts-retention.test.ts \
    tests/caring-contacts-schedule.test.ts tests/caring-contacts-service-state.test.ts \
    tests/caring-contacts-simulation.test.ts
 Test Files  15 passed (15)
      Tests  316 passed (316)
```

This includes `caring-contacts-domain-isolation.test.ts`, the gate that parses every import
specifier under `src/lib/caring-contacts/` — so the new module's isolation is proven, not assumed.

**Typecheck:**

```
$ npm run typecheck
> node ./node_modules/typescript/bin/tsc -p tsconfig.typecheck.json --noEmit ...
```

Completed with no diagnostics emitted.

**Lint** (`npx eslint` on the four changed files): no output, clean.

**Format:** `npm run format` ran repo-wide; `npx prettier --check` on the four changed files reports
`All matched files use Prettier code style!`. Note: `npm run format` also reformatted the
gitignored plan artifact `.superpowers/sdd/.../task-3-brief.md` (`.superpowers/sdd/.gitignore` is
`*`), so it is not in the commit and does not affect the tree.

---

## Mutations — all three run, one at a time, reverted between

The pristine file was copied aside before the first mutation and restored after each; the final
restore was confirmed byte-identical with `diff` before committing.

### Mutation 1 — restart after two approvals instead of three

Replaced the required-roles completeness check with `const everyRequiredRoleApproved = approvals.length >= 2;`.

_Confirmed non-trivial before trusting it:_ this changes an asserted value — the second approval now
returns a running state where the test asserts `state.stopped === true` at index 1.

```
     × requires all three approval roles before it restarts 11ms
AssertionError: expected false to be true // Object.is equality
      Tests  1 failed | 7 passed (8)
```

**Caught by:** `requires all three approval roles before it restarts` — the named test, and only
that test.

Note on why the mutation was written this way: mutating the `REQUIRED_RESTART_APPROVAL_ROLES`
constant to two entries would have been a near no-op, because the test iterates that same constant
and would simply have looped twice. The mutation had to break the completeness _logic_ while leaving
the list intact. This is the "confirm the mutation actually changes an asserted value" check the
task called for, and it mattered here.

### Mutation 2 — drop the same-actor check

Deleted the `restart-approval-actor-already-recorded` guard block from
`applyServiceRestartApproval`.

```
     × refuses a single person supplying more than one approval 11ms
AssertionError: expected { ok: true, …(1) } to deeply equal { ok: false, …(1) }
      Tests  1 failed | 7 passed (8)
```

**Caught by:** `refuses a single person supplying more than one approval`. This is the mutation that
matters most — it is precisely the single-person-restart failure mode — and the test detects it.

### Mutation 3 — `serviceStopBlocksDispatch` always returns `false`

```
     × stops the whole service and blocks dispatch 11ms
AssertionError: expected false to be true // Object.is equality
      Tests  1 failed | 7 passed (8)
```

**Caught by:** `stops the whole service and blocks dispatch`.

**Restore verified:**

```
$ diff /tmp/ss-pristine.ts src/lib/caring-contacts/service-state.ts && echo restored
restored byte-identical
 Test Files  1 passed (1)
      Tests  8 passed (8)
```

No mutation left the suite green. No test needed rewriting.

---

## Concerns

1. **`describeServiceStop`'s privacy property is not enforced by a test — only by construction.**
   The brief's assertion is `not.toMatch(/Rowan|Mira|\+61/)`, which would still pass if a future
   edit interpolated the incident `note` into the banner, since the fixture note contains neither a
   synthetic patient name nor a `+61` number. The exclusion is currently held by a doc comment. If
   this banner is later assembled anywhere else, or the note is ever added "for context", nothing
   fails. Worth a follow-up assertion — e.g. a stop whose note contains a synthetic patient name and
   a mobile number, asserting neither appears in the description — but adding one now would mean
   adding an assertion the brief did not specify, so it is flagged rather than done.

2. **The stop is service-wide in intent but the state object carries a `teamId`.** That is the
   brief's interface, so it was built as specified, but it means "the whole service" is only
   actually halted if callers hold one `ServiceState` for the service rather than one per team.
   Nothing in this pure module can enforce that — it is a property of whatever storage and
   dispatch-path wiring comes next. Whoever builds the caller should treat "there is exactly one
   service state" as a requirement to prove, not an assumption.

3. **Restart discards the approval record from in-memory state** (forced by the `ServiceState`
   union's running variant). Who approved the restart survives only in the audit trail. That is the
   right split, but it means the audit write is not optional — a caller that restarts without
   recording the three approvals loses the governance evidence entirely.

4. **`SERVICE_STOP_REASONS` is exported but unused by this module's own logic** — it exists for UI
   enumeration, and nothing checks that it stays in sync with the `ServiceStopReason` union. A
   missing entry would be silently invisible in a picker. `STOP_REASON_WORDING` is typed as a total
   `Record<ServiceStopReason, string>`, so _that_ map is compiler-enforced; the array is not.

5. **`npm run verify:cheap` was not run.** The change is a new leaf module plus a behaviour-neutral
   refactor of a helper used only by `audit.ts`; the full caring-contacts suite (316 tests,
   including the domain-isolation gate), typecheck, lint and prettier all passed, which covers the
   plausible failure classes here. No provider-backed command was run, nothing was pushed, and no PR
   was opened.

---

# Fix round 1

**Status:** DONE
**Commit:** `6434817b2f271e8ac96b7624cee540cd828b42ca`
**Base commit:** `c976ff9c23b2aceadbc9c9f05b8a41aff3930b52`

All four items actioned. One deliberate deviation, flagged and argued in item 1.

## 4. Line-count correction (evidence integrity)

The round-0 report said `service-state.ts` was 194 lines. It was **212**, verified against the
committed blob rather than re-counted from memory:

```
$ git show HEAD:src/lib/caring-contacts/service-state.ts | wc -l
212
```

The report body above has been corrected in place from 194 to 212. The 194 figure was wrong at the
time it was written — an estimate that should have been a measurement. After this round the file is
**243** lines (`wc -l src/lib/caring-contacts/service-state.ts`).

## 1. `describeServiceStop` can no longer see the note

**(a) Parameter narrowed.** Added an exported type and changed the signature:

```ts
export type ServiceStopBannerFacts =
  | { stopped: false }
  | { stopped: true; reason: ServiceStopReason; restartApprovals: readonly ServiceRestartApproval[] };

export function describeServiceStop(state: ServiceStopBannerFacts): string | null;
```

`note`, `stoppedBy`, `stoppedAt` and `reportedByTeamId` are all now out of scope inside the
function. The property is held by the compiler, not by a comment.

**Deviation, stated plainly.** The instruction said to take `{ reason, restartApprovals }` and
"update the call site and the existing test". I kept the discriminated
`{ stopped: false } | { stopped: true; … }` shape instead of a bare
`{ reason, restartApprovals } | null`, and as a result **the existing test needed no change at
all**. The reason is the standing constraint that no existing assertion may be loosened:
`expect(describeServiceStop(runningService(team))).toBeNull()` is a real assertion that a running
service produces no banner. Had the parameter become `{ reason, restartApprovals } | null`, that
line would have had to become `describeServiceStop(null)`, which asserts only that `null` maps to
`null` — the running-service contract would have stopped being tested. The discriminated form
achieves the identical goal (the note is not reachable) while keeping that assertion meaningful,
and `ServiceState` remains structurally assignable so there is no call-site friction. There are no
production call sites yet; the test is the only caller.

**(b) New test** — `never leaks the incident note into the banner, even when the note names a patient`.
It records a stop whose note is
`"Rowan Whitlock's first message went to +61 491 570 156 instead of the number on file."` and
asserts the description contains none of `Rowan`, `Whitlock`, `+61 491 570 156`, `491 570 156` —
and that it still contains `wrong recipient` and `0 of 3`, so the test cannot be satisfied by
returning nothing useful. The suite is now 9 tests.

### Round-1 mutation — run in two halves, because the type change altered what a leak even is

**Mutation A — interpolate `${state.note}` into the banner, leaving the parameter narrow.**
This does not compile, which is the whole point of item 1(a):

```
src/lib/caring-contacts/service-state.ts(236,86): error TS2339: Property 'note' does not exist on
type '{ stopped: true; reason: ServiceStopReason; restartApprovals: readonly ServiceRestartApproval[]; }'.
```

**Mutation B — widen the parameter back to `ServiceState`, then interpolate `${state.note}`.**
This compiles, and the new test catches it:

```
     × never leaks the incident note into the banner, even when the note names a patient 10ms
AssertionError: expected 'All caring-contact sending is stopped…' not to contain 'Rowan'
Received: "All caring-contact sending is stopped for the whole service because a message reached the
wrong recipient. 0 of 3 restart approvals recorded. Still needed: the incident lead, the privacy and
security owner and the clinical programme lead, each from a different person. Rowan Whitlock's first
message went to +61 491 570 156 instead of the number on file."
      Tests  1 failed | 8 passed (9)
```

So the leak is stopped twice over: the type forbids it, and if the type is ever widened back the
test fires. Both mutations were reverted; `diff` against the pre-mutation copy reported
`RESTORED byte-identical` before anything was committed.

## 2. `teamId` renamed to `reportedByTeamId`

Renamed on both union variants and on `runningService`'s parameter; the two internal uses
(`applyServiceStop` constructing the stopped record, `applyServiceRestartApproval` restarting)
follow. `grep -n "teamId" service-state.ts` now matches only the doc prose explaining the name and
the `TeamId` type import.

The type carries the ruling as a doc comment: the field is provenance and does not scope the stop;
a stop halts every patient and every team including teams with no part in the incident; and
**storage must persist this as a single service-wide record, never one row per team**, because a
per-team table would look correct in the reporting team's screens while every other team kept
sending through the incident.

## 3. Unreachable branch removed

The `outstanding.length === 0 ? "All approvals are in." : …` ternary is gone; the banner now always
names the outstanding roles. A stopped state cannot hold three approvals, because the third
restarts the service — that reasoning is now a one-line comment on the function rather than a dead
branch pretending to be a case.

## Verification (all quoted from the run, not summarised)

```
===== prettier --check changed files =====
All matched files use Prettier code style!

===== eslint changed files =====
(no output)

===== typecheck =====
> node ./node_modules/typescript/bin/tsc -p tsconfig.typecheck.json --noEmit …
(no diagnostics)

===== focused + audit + clock + isolation =====
 Test Files  4 passed (4)
      Tests  32 passed (32)

===== full caring-contacts suite =====
 Test Files  15 passed (15)
      Tests  317 passed (317)
```

317 is 316 + the one new test. The audit and clock suites are unmodified and green, which is what
keeps the `awstIsoTimestamp` move provably behaviour-identical.

**Note on the runs:** the repository run coordinator was held for roughly twenty minutes by a
`lint:internal` lease from an unrelated worktree (`…/worktrees/Database/list_manual_ledger_tasks`).
Every command above was run through a retry loop that waits for the lease rather than breaking it;
the attempt number is recorded in the raw output. No lock was forced. An earlier lease (PID 133504)
was found dead, but a live one had already replaced it, so no stale-lock break was needed or
attempted.

## Concerns after round 1

1. **Concern 1 from round 0 is closed.** It is now a type error plus a test, not a comment.

2. **The single-record storage rule is stated but not yet enforceable here.** The rename and the
   doc comment are the strongest signals a pure module can send; nothing stops the storage task
   from creating a per-team table anyway. This is the one remaining way the stop could fail to be
   service-wide, and it lives entirely in the next task. Worth an explicit assertion there — a
   unique constraint or a single-row table — rather than trusting the field name to carry it.

3. **`SERVICE_STOP_REASONS` is still exported, unused internally, and unchecked against the union**
   (unchanged from round 0). `STOP_REASON_WORDING` is a total `Record<ServiceStopReason, string>`
   so the wording map is compiler-enforced; the array is not, and a missing entry would show up
   only as an absent option in a picker.

4. **`describeServiceStop`'s parameter is structural, so a caller can still pass an object carrying
   a note** — it simply cannot be read. That is the correct boundary for a pure function, but it
   means the guarantee is "the banner never renders the note", not "the note never reaches this
   layer".

5. Nothing was pushed, no PR was opened, and no provider-backed command was run.
