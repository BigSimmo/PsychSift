# Task 11a report — Migration 0003, the workspace schema

**Status:** DONE_WITH_CONCERNS
**Commit:** `8b557608e` on `claude/suicide-contact-mockup-b5aaa0` (base `944ce3201`)
**Decisive evidence:** `Test Files  2 passed (2)` / `Tests  71 passed (71)` from
`npm run caring-contacts:db:test` against the local disposable Postgres 17.11 container.
Baseline before the change was `2 passed (2)` / `55 passed (55)`; the 16 new tests take it to 71.

---

## 1. Files changed and why

| File                                                                      | Change   | Why                                                                                                                                                               |
| ------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `caring-contacts/supabase/migrations/0003_caring_contacts_workspace.sql`  | **new**  | The workspace schema.                                                                                                                                             |
| `caring-contacts/supabase/migrations/0001_caring_contacts_foundation.sql` | modified | The `require_audit` attach loop is extracted into `caring_contacts.attach_audit_guard(text[])`, called by 0001 with its own list and by 0003 with the new tables. |
| `caring-contacts/supabase/migrations/0002_caring_contacts_rls.sql`        | modified | `service_state` removed from the team-scope driven list; the "no policy is unconditionally true" prose amended to state the deliberate exception.                 |
| `tests/caring-contacts-migrations.test.ts`                                | modified | 16 new tests, all against the running database as `caring_contacts_app`.                                                                                          |
| `tests/helpers/caring-contacts-postgres.ts`                               | modified | `seedPlan` now creates parent rows (Ruling 22); new `seedPlanParents` and `clearCaringContactsAuditEvents` helpers; `CARING_CONTACTS_DATA_TABLES` extended.       |
| `tests/caring-contacts-postgres-repository.test.ts`                       | modified | `beforeEach` seeds the referral/pathway parents the shared contract names. **Not in the brief's file list — see §6.**                                             |
| `tests/helpers/caring-contacts-repository-contract.ts`                    | modified | One fixture line: the cross-team plan now names its own team's referral and pathway version. **Not in the brief's file list — see §6.**                           |

`src/lib/caring-contacts/db/postgres-repository.ts` was **not touched**. `npm run typecheck`
remains red for it, exactly as briefed.

Nothing was written to `supabase/migrations/`. Nothing touched a hosted service; every database
command ran against `postgres://…@127.0.0.1:54329/postgres`.

---

## 2. How each of the eight rulings was applied

### Ruling 9 / 19 — `service_state` is a schema-enforced singleton

- The old `team_id text primary key references teams (id)` is **renamed** to
  `reported_by_team_id` and made nullable. The rename is guarded on the old column's presence in
  `pg_attribute`, so replay is a no-op. The `teams` foreign key survives the rename, so attribution
  still has to name a real team.
- A new `singleton boolean not null default true` column carries `check (singleton)`
  (`service_state_is_singleton`) and is the new `primary key` (`service_state_pkey`). A second row
  is impossible two independent ways: the primary key rejects a second `true`, and the check
  rejects any attempt to escape to `false`. Both are asserted separately (§5, refusals R1 and R2).
- Added: `stop_id uuid`, `stopped_reason text`, `stop_note text`. Dropped: `restart_approved_by`.
- `stopped_reason` is checked against exactly the five `ServiceStopReason` values, copied verbatim
  from `src/lib/caring-contacts/service-state.ts:31`.
- `service_state_stop_is_attributed` from 0001 is untouched and still in force — it names `stopped`
  and `stopped_by`, neither of which the rename affected.

### Ruling 4 — `service_restart_approvals` is keyed on the stop

`unique (stop_id, role)` and `unique (stop_id, actor_id)`, named
`service_restart_approvals_unique_stop_role` / `…_unique_stop_actor`. `approved_by_team_id` exists
for attribution only and is nullable, deliberately mirroring `reported_by_team_id`. `role` is
checked against exactly the three `ServiceRestartApprovalRole` values.

**Deviation, and it matters: `stop_id` is NOT a SQL foreign key.** The brief said "`stop_id`
(references the stop)". I implemented it as a plain `uuid not null` with the two uniques, because a
real foreign key to `service_state.stop_id` is not merely awkward here, it is unsafe:

- The singleton row's `stop_id` is cleared on restart and replaced by the next incident's. With the
  default `on update restrict`, the second stop's `update` would be refused outright while any
  approval from the first incident still existed — i.e. a team's second incident becomes
  unrestartable, which is the exact failure Ruling 4 exists to prevent, reintroduced by a different
  route.
- With `on update cascade` it is worse: the first incident's three approval rows would have their
  `stop_id` silently rewritten to the _new_ stop, presenting a brand-new incident as already
  approved by three people. The service could then restart with zero approvals for the incident it
  is actually restarting from.

The alternative that keeps a real key is a `service_stops` history table, one row per incident, with
the singleton pointing at the current one. That is a legitimate design and probably the right
long-term shape, but it is a table the brief does not authorise and I did not invent it. **Flagged
for your ruling.** The consequence of what I shipped is that nothing at the database level forces an
approval's `stop_id` to be the _current_ stop; the domain (`service-state.ts`) and Task 11b's store
are what enforce that.

### Ruling 20 — the Ruling-20 policy on the two service-wide tables only

`service_state` and `service_restart_approvals` get
`using (caring_contacts.current_team_id() is not null)` with the identical `with check`, created in
their own driven loop. Both get `enable`/`force row level security` in 0003, because 0002 no longer
covers `service_state` at all.

0002's team-scoped `service_state_team_scope` is **dropped**, not supplemented — Postgres ORs
permissive policies, so leaving it beside the new one would have made the new one redundant rather
than replacing it. I also took the brief's optional step and removed `service_state` from 0002's
driven list. That was not optional in the end: 0002's loop creates a policy on
`team_id = current_team_id()`, and after 0003 renames the column, **replaying 0002 would fail with
"column team_id does not exist"**. Since `applyCaringContactsMigrations` re-applies the whole set
and the replay test asserts it does not error, leaving 0002 alone would have gone red. 0002 stays
replay-safe: it still drops and recreates its policies, it just no longer names that table.

0002's prose claim ("There is no policy anywhere that is unconditionally true") is amended in place
to state the exception and why, and to note that the claim itself still stands —
`current_team_id() is not null` is false for an unscoped session, so deny-by-default is intact. That
is asserted, not asserted-in-prose: the "still shows a session that names NO team nothing at all"
test proves it.

### Ruling 21 — `pathway_version_approvals` carries a denormalised `team_id`

It does, and the standard `pathway_version_approvals_team_scope` policy attaches to it with no join.
I went one step further than the brief: the denormalised `team_id` (and `author_id`, see below) are
**kept honest by a composite foreign key** to `pathway_versions (id, team_id, author_id)`. A
denormalised column that nothing checks is a column a writer can lie about, and lying about
`team_id` here would misplace the row's row-level-security scope — the one thing that column exists
to drive.

### Ruling 2 — coverage windows are AWST calendar days

`coverage_from` / `coverage_until` are `text`, and `plan_assignments_coverage_is_calendar_days`
checks both against `^\d{4}-\d{2}-\d{2}$`. The column type is asserted from
`information_schema.columns` ("keeps coverage windows as AWST calendar days rather than instants").

### Ruling 22 — the `seedPlan` fixture is now legitimate

`seedPlan` inserts the parent `pathway_versions` row (with a synthetic `snapshot`) and the parent
`referrals` row before the plan, in the same audited transaction and the same team — which is what
the composite keys require. No assertion was deleted or weakened anywhere.

### Ruling 25 — the two new keys are composite same-team keys

`referrals` and `pathway_versions` each gained `unique (id, team_id)` purely to be referencable
targets, and `plans` gained:

```
plans_referral_fk         foreign key (referral_id, team_id)        references referrals (id, team_id)
plans_pathway_version_fk  foreign key (pathway_version_id, team_id) references pathway_versions (id, team_id)
```

The schema did not fight back on the composite-ness itself — `plans.team_id`, `referrals.team_id`
and `pathway_versions.team_id` are all `not null`, and `pathway_versions` is plainly team-owned, so
the "shared pathway library" escape hatch does not apply. The ruling stands as written and is proven
against the database by "refuses a plan that reaches across teams for its referral".

It did, however, surface a real conflict with the shared store contract — §6.

---

## 3. Commands run, with the decisive lines

**Baseline, before any change:**

```
$ CARING_CONTACTS_DATABASE_URL=… npm run caring-contacts:db:test
 Test Files  2 passed (2)
      Tests  55 passed (55)
```

**Step 2 — tests written, migration not yet written (the required red):**

```
$ CARING_CONTACTS_DATABASE_URL=… npm run caring-contacts:db:test
 Test Files  1 failed | 1 passed (2)
      Tests  17 failed | 54 passed (71)
```

15 of my 16 new tests failed, plus the two existing tests whose table lists I extended. The failure
reasons were the right ones, not incidental:

- `AssertionError: expected [ …(2) ] to include '0003_caring_contacts_workspace.sql'` — the
  migration file did not exist.
- `error: column "reported_by_team_id" of relation "service_state" does not exist` (×7) — the
  singleton conversion had not happened.
- `error: relation "caring_contacts.plan_assignments" does not exist` (×3).
- `AssertionError: promise resolved "undefined" instead of rejecting` (×3) — the plan foreign keys
  did not exist yet, so a plan naming a non-existent referral was accepted.
- `AssertionError: expected [ 'referrals', …(11) ] to include 'pathway_version_approvals'`.

The one new test that passed at this point, `accepts a plan whose referral and pathway version both
belong to its own team`, passed _trivially_ because there were no keys to violate. It is a control
for the three refusal tests beside it, not an independent proof, and I am calling that out rather
than counting it.

**Step 4 — green:**

```
$ CARING_CONTACTS_DATABASE_URL=… npm run caring-contacts:db:test
 Test Files  2 passed (2)
      Tests  71 passed (71)
```

**Full offline unit suite** (run because I touched the shared store contract helper, which
`test:focused` fails closed on):

```
$ npm run test
 Test Files  1 failed | 690 passed | 2 skipped (693)
      Tests  1 failed | 7665 passed | 29 skipped (7695)
```

The single failure is **pre-existing and not mine**:
`tests/caring-contacts-retention.test.ts > is the only module in src/lib/caring-contacts that
hard-codes a retention period` reports
`src\lib\caring-contacts\in-memory-repository.ts: mentions "retention"` and
`src\lib\caring-contacts\repository.ts: mentions "retention"`. Both files were last touched by
`944ce3201` (Task 10) and I changed nothing under `src/lib/caring-contacts/` — `git status` before
the commit listed only the seven files in §1. Raised as a concern, not fixed: it is Task 10's
regression and fixing it here would be out of scope. I did not run it on a pristine checkout of
`944ce3201` to confirm, so this is inference from the diff scope rather than a direct observation.

**Lint:**

```
$ npx eslint tests/caring-contacts-migrations.test.ts tests/caring-contacts-postgres-repository.test.ts \
    tests/helpers/caring-contacts-postgres.ts tests/helpers/caring-contacts-repository-contract.ts
ESLINT EXIT: 0
```

(no output, exit 0)

**Format:**

```
$ npx prettier --check <the four TypeScript files>
Checking formatting...
All matched files use Prettier code style!
```

Prettier has no parser for `.sql` and reports "No parser could be inferred" for all three migration
files — that matches the two pre-existing migrations, which are likewise unformatted by Prettier, so
the changed-file CI check has nothing to say about them.

I did **not** run `verify:cheap`, `verify:pr-local`, `verify:release`, any `eval:*`,
`check:supabase-project`, `test:live`, or anything provider-backed, and did not push or open a PR.

---

## 4. The five mutations

Each mutation was checked for whether it actually changes a value some assertion reads before the
result was trusted. All five reddened exactly one test, and no mutation left the suite green.

| #   | Mutation                                                                                                                                                                               | Test that reddened                                                          | What the assertion actually saw change                                                                                                                                                                                                                                                                                                                                                                      |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Dropped `unique (stop_id, actor_id)` from `service_restart_approvals`                                                                                                                  | `refuses a second approval from the same person under a different role`     | `AssertionError: promise resolved "undefined" instead of rejecting`. The second approval by ACTOR-X **committed** instead of raising. The assertion reads the rejection, so the changed value is the asserted one.                                                                                                                                                                                          |
| 2   | Re-keyed **both** uniques on `approved_by_team_id` instead of `stop_id`, **keeping the constraint names identical** so the two name-matching tests could not fail for the wrong reason | `lets the SAME three people approve a LATER stop`                           | `AssertionError: promise rejected … instead of resolving`, caused by `duplicate key value violates unique constraint "service_restart_approvals_unique_stop_role"`. Approving the _second_ stop was refused. This is the mutation that proves Ruling 4 is load-bearing rather than cosmetic — the other two approval tests stayed green under it, which is exactly why the names had to be held constant.   |
| 3   | Replaced the service-wide policy on `service_state` with the standard team-scope policy (`reported_by_team_id = current_team_id()`)                                                    | `shows a stop raised by one team to EVERY other team`                       | `AssertionError: expected [] to have a length of 1 but got +0`. TEAM-SOUTH read **zero rows** where it had read one — precisely the silent "the service is running" leak. Run twice: my first attempt also dropped `service_restart_approvals` from the loop, so I redid it as a single isolated swap that leaves that table alone, and got the identical single failure. Only the isolated run is claimed. |
| 4   | Removed `plans_pathway_version_fk`                                                                                                                                                     | `refuses a plan whose pathway version has no parent row`                    | `AssertionError: promise resolved "undefined" instead of rejecting`. The plan naming `PATHWAY-THAT-WAS-NEVER-CREATED` **committed**.                                                                                                                                                                                                                                                                        |
| 5   | Removed `plan_assignments` from the `attach_audit_guard` list                                                                                                                          | `REFUSES an assignment written with no audit event in the same transaction` | `AssertionError: promise resolved "Result{ command: 'INSERT', …}" instead of rejecting`. The unaudited insert committed and returned a result object.                                                                                                                                                                                                                                                       |

After each, the migration was restored from a byte-copy and the next mutation applied to the clean
file. Final restore verified with `diff` (`REVERTED CLEAN`, no output) and the full suite re-run:
`Test Files 2 passed (2)` / `Tests 71 passed (71)`.

---

## 5. Every refusal and constraint reachable in the schema, and the test that asserts it

New or changed refusals, and how each is proven:

| Refusal                                                                      | Mechanism                                                  | Asserted by                                                                                                                                           |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1. A second `service_state` row                                             | `service_state_pkey` on `singleton`                        | `refuses a second service_state row outright` (asserts on the constraint name)                                                                        |
| R2. A row escaping the singleton key via `singleton = false`                 | `service_state_is_singleton` check                         | `refuses a row that tries to escape the singleton key`                                                                                                |
| R3. A second approval by the same person, any role, same stop                | `service_restart_approvals_unique_stop_actor`              | `refuses a second approval from the same person under a different role`                                                                               |
| R4. A second approval in the same role, same stop                            | `service_restart_approvals_unique_stop_role`               | `refuses a second approval in the same role from a different person`                                                                                  |
| R5. A plan naming a pathway version with no parent row                       | `plans_pathway_version_fk`                                 | `refuses a plan whose pathway version has no parent row`                                                                                              |
| R6. A plan naming a referral with no parent row                              | `plans_referral_fk`                                        | `refuses a plan whose referral has no parent row`                                                                                                     |
| R7. A plan naming **another team's** referral                                | `plans_referral_fk` (composite)                            | `refuses a plan that reaches across teams for its referral`                                                                                           |
| R8. Any write to a new mutating table with no audit event in the transaction | `require_audit` constraint trigger                         | `REFUSES an assignment written with no audit event in the same transaction`                                                                           |
| R9. A cross-team read of `plan_assignments` returns zero rows, not an error  | `plan_assignments_team_scope` policy                       | `returns ZERO ROWS from plan_assignments to another team`, paired with `shows a team its own assignment…` so the denial means scoping and not absence |
| R10. An unscoped session sees no `service_state` row                         | Ruling-20 policy is false when `current_team_id()` is null | `still shows a session that names NO team nothing at all`                                                                                             |
| R11. The stop is visible to every scoped team                                | Ruling-20 policy                                           | `shows a stop raised by one team to EVERY other team`                                                                                                 |

Constraints that are **reachable but not covered by a dedicated test**, stated honestly:

- `service_state_stopped_reason_is_known` — the five-value check. Exercised only through valid
  values; there is no test that writes a sixth reason and watches it be refused.
- `service_state_stop_is_identified` — see §7, item 3.
- `pathway_versions_retirement_urgency_is_known`, and every constraint on
  `pathway_version_approvals` (`_role_is_known`, `_no_self_approval`, both uniques, the composite
  `_version_fk`). Nothing writes that table yet; Task 11b is where it acquires a caller, and the
  brief's required-test list did not include it. **These are currently unproven against the
  database.** The no-self-approval rule in particular is a clinical-governance control and I would
  want it covered before it is relied on.
- `contact_dispatches_discrepancy_resolution_is_known`.
- `plan_assignments_coverage_is_calendar_days` — the column _type_ is asserted, the pattern check is
  not. A `2026-3-2` would be refused by the database and no test says so.
- `plan_reassignments.reason not null`.

---

## 6. The one thing that genuinely conflicted, and what I did about it

**Ruling 24's split of Task 11 has an ordering defect, and Ruling 25 is where it bites.**

Making `plans.referral_id` and `plans.pathway_version_id` real keys breaks not only `seedPlan`
(which Ruling 22 anticipated) but also **`tests/caring-contacts-postgres-repository.test.ts`**, which
drives the shared store contract against the Postgres store. That contract creates plans naming
`REFERRAL-1` / `PATHWAY-1` with no parent rows — legitimate while those columns were bare text.
Making the keys real turned **36 previously-passing tests red**, with
`error: insert or update on table "plans" violates foreign key constraint "plans_referral_fk"`.

The proper fix is for the store's `createPlan` path to require real parents and for the contract to
create them through `createReferral` / `savePathwayVersion` — both of which exist on the Task 10
interface and neither of which the Postgres store implements yet. That is Task 11b, and I was told
not to touch `postgres-repository.ts`. So the FK cannot land before the store learns about parents,
unless the _fixture_ is repaired.

I repaired the fixture rather than stopping, because it is the same class of change Ruling 22 already
sanctioned — making an invalid fixture valid — and because a blocked task costs you a full round
trip. Two files outside the brief's list were touched:

1. **`tests/caring-contacts-postgres-repository.test.ts`** — a `beforeEach` that calls a new
   `seedPlanParents` helper to create `REFERRAL-1`, `REFERRAL-2`, `PATHWAY-1` in TEAM-NORTH and
   `REFERRAL-3`, `PATHWAY-2` in TEAM-SOUTH, then clears the audit trail. The clear is necessary
   because seeding a referral is itself an audited change (the `require_audit` trigger demands it),
   and three contract tests assert on the _exact_ contents of the trail. Clearing the fixture's own
   bookkeeping is not the same as relaxing those assertions — they still assert exactly what the
   store wrote, and nothing else.

2. **`tests/helpers/caring-contacts-repository-contract.ts`** — one fixture site. The test
   `scopes keys per team, so one team cannot replay another team's result` had TEAM-SOUTH create a
   plan naming TEAM-NORTH's `REFERRAL-1` and `PATHWAY-1`. Under composite same-team keys that is
   refused, and correctly so: a referral belongs to exactly one team (`referrals.team_id text not
null`), so two teams sharing one referral id was fixture convenience, not anything the domain
   permits. TEAM-SOUTH now names `REFERRAL-3` / `PATHWAY-2`. **The assertions in that test are
   untouched** — it still asserts both writes succeed and each team sees exactly one plan, which is
   what it is actually about. The in-memory suite, which shares this contract, still passes (it is
   in the 7665 above).

**This is the item I would most want you to look at.** If you would rather the contract file were
left alone, the alternative is to hold Ruling 25 (and the bare foreign keys with it) until Task 11b
lands, which would mean the whole "closing Phase 1 open item 2" half of this task slips.

---

## 7. What I chose NOT to do, and why

1. **No `service_stops` history table.** It would let `service_restart_approvals.stop_id` be a real
   foreign key without any of the hazards in §2/Ruling 4. It is not in the brief's table list and I
   did not invent a table to solve a problem I could report instead. Recommended as a follow-up.

2. **No `require_audit` on `service_state` itself.** The brief scopes the trigger to "every **new**
   table that carries a mutation", and `service_state` is not new — it arrived in 0001 without one,
   as did `retention_state` and `idempotency_records`. I followed that literally. I am uneasy about
   it: raising and lifting the service-wide safety stop is arguably the single most
   audit-worthy mutation in the system, and it is currently the only one of the incident-response
   pair that the database does not force an audit event for (`service_restart_approvals` does have
   the trigger). Cheap to add; I did not, because it changes the write contract of an existing table
   that Task 11b is about to be written against, and that is your call not mine.

3. **I did add one constraint the brief did not ask for:** `service_state_stop_is_identified`,
   `check (stopped = false or (stop_id is not null and stopped_reason is not null))`. Without it a
   stop could exist that no approval could be keyed to, which would make the restart path
   unreachable. It cannot block a genuine stop — the responder already has both values in hand at
   the moment they stop — so it does not violate 0001's "stopping must never be blocked" principle.
   It does mean any caller inserting a stop must supply `stop_id` and `stopped_reason`; I updated my
   own two singleton tests accordingly, and Task 11b must do the same. Say the word and I will drop
   it.

4. **I did not tighten `pathway_versions.author_id` to `not null`,** even though the domain type
   `PathwayVersion.authorId` is non-optional. Out of scope, and it would change an existing column.
   The consequence is that a pathway version with a null author cannot have approvals recorded
   against it, because the composite `pathway_version_approvals_version_fk` cannot match a null.
   That is arguably the right behaviour (you cannot approve an unauthored version), but it is a
   consequence rather than a decision, so it is stated here.

5. **I did not make `plan_assignments` / `plan_reassignments` → `plans` composite same-team keys.**
   Ruling 25 names exactly two keys and I implemented exactly two. The same argument applies to
   these — a `plan_assignments` row could claim a `team_id` that differs from its plan's, which
   would misplace its row-level-security scope — so it is a reasonable follow-up.

6. **I did not fix the pre-existing `caring-contacts-retention.test.ts` failure** (§3). Task 10's,
   not mine.

7. **I did not add a test for every reachable constraint** (§5). The brief specified eight
   behaviours; I wrote sixteen tests covering those plus the controls that make the refusals mean
   something. The uncovered constraints are listed rather than quietly left.

8. **I did not run any broad gate.** `verify:cheap` / `verify:pr-local` were explicitly excluded by
   the task, and the full `npm run test` plus the database suite plus targeted lint covers the
   plausible failure classes for a change confined to migrations and tests.

---

## 8. Two harness notes, for whoever picks up 11b

- **`CARING_CONTACTS_DATA_TABLES` now has six new entries**, child-before-parent:
  `plan_reassignments`, `plan_assignments`, `pathway_version_approvals`,
  `notification_preferences`, `training_records`, `service_restart_approvals`.
  `service_state` stays in the list and is truncated between tests **on purpose** — it is the one
  row whose presence changes the answer for every other test in the file, and a stop left standing
  would have the domain refuse every subsequent send, producing a cascade of failures that reads as
  a schema fault rather than as leaked state.

- **0002's `grant … on all tables in schema` is a snapshot**, not a standing rule. Every table 0003
  creates runs after it, so 0003 re-grants — `select, insert, update, delete` to
  `caring_contacts_app` and `select` to `caring_contacts_anon`. The anon grant is deliberate and
  matches 0002's design: the anonymous denial must be row-level security's doing, not a missing
  GRANT. Any later migration that adds a table must do the same or the table will be silently
  unreachable.

---

## Fix round 1

**Status:** DONE_WITH_CONCERNS (one honest gap in the mutation evidence, §F below — nothing blocked).
**Decisive evidence:** `Test Files  2 passed (2)` / `Tests  87 passed (87)` from
`npm run caring-contacts:db:test`. Round 1 finished at 71; this round adds 16 tests.

Files touched this round: `caring-contacts/supabase/migrations/0003_caring_contacts_workspace.sql`,
`tests/caring-contacts-migrations.test.ts`, `tests/helpers/caring-contacts-postgres.ts`
(truncation list only). `0001`, `0002`, `postgres-repository.ts`, the store contract helper and the
Postgres repository suite were **not** touched this round.

### A. Ruling 27 — the assignment tables now carry the team

`plans` gained `plans_id_team_key unique (id, team_id)`. `plan_assignments.plan_id` lost its bare
`references plans (id)` and both tables gained composite keys:

```
plan_assignments_plan_fk    foreign key (plan_id, team_id) references plans (id, team_id) on delete cascade
plan_reassignments_plan_fk  foreign key (plan_id, team_id) references plans (id, team_id) on delete cascade
```

**The exposure was reproduced live before the fix, not merely reasoned about.** In the red run, the
new test `refuses an assignment TEAM-SOUTH writes for TEAM-NORTH's plan` failed with
`AssertionError: promise resolved "undefined" instead of rejecting` — i.e. TEAM-SOUTH's write into
`plan_assignments` for `PLAN-N` **succeeded**, exactly as the reviewer described. Same for
`plan_reassignments`.

Three tests: the two refusals (each asserting on its own constraint name) and
`accepts both records from the team that owns the plan` as the positive control, so the refusals
mean scoping and not a broken fixture.

### B. Ruling 28 — `service_stops`, and the approvals key becomes real

New table `service_stops`: `stop_id uuid primary key`, `reason` (checked against the same five
`ServiceStopReason` values), `note`, `stopped_by`, `stopped_at`, `reported_by_team_id` (attribution
only, nullable, FK to `teams`), `restarted_at`. One row per incident.
`service_restart_approvals.stop_id` is now a real `service_restart_approvals_stop_fk` onto it, and
`service_state.stop_id` gained `service_state_stop_fk` onto it too, so the singleton points at the
current incident and holds null while the service runs. `restarted_at` is the only field of a
recorded incident that ever changes; the test helper carries that in a comment.

`service_stops` joins `service_state` and `service_restart_approvals` in the Ruling-20 service-wide
policy loop, and is added to `CARING_CONTACTS_DATA_TABLES` ahead of `teams` and behind both tables
that reference it.

Four tests:

- `gives a NEW stop zero approvals of its own` — stop, approve ×3, restart, stop again; the join
  `service_restart_approvals a join service_state s on s.stop_id = a.stop_id` returns **0**, and the
  same query against the closed incident's id still returns **3**. Both halves are asserted: the new
  incident must start clean _and_ the old incident's record must survive, because it is what
  happened.
- `refuses an approval that names a stop that was never recorded` — asserts on
  `service_restart_approvals_stop_fk`.
- `keeps the closed incident readable after the restart` — the closed row, with a non-null
  `restarted_at`, is readable from a _different_ team, confirming the service-wide policy reaches
  the new table.
- The round-1 `lets the SAME three people approve a LATER stop` still passes unchanged, as required.

### C. Ruling 29 — stopping is audited

`service_stops` and `service_state` were added to the `attach_audit_guard` list, with an SQL comment
recording why (`restarting was forced to audit and stopping was not, which is the asymmetry
backwards`) and why 0001's "stopping must never be blocked" is not a counter-argument. Test:
`REFUSES a stop written with no audit event in the same transaction` expects
`caring-contacts-audit-required` and then asserts `service_stops` is still empty.

### D. Concern 3 — the comment you asked for

Kept `service_state_stop_is_identified`. Above `service_stops` there is now an imperative note
addressed to whoever writes the store:

> TO WHOEVER WRITES THE POSTGRES STORE: there is no stopId anywhere in the domain. Neither
> `ServiceState` nor `stopService({ reason, note })` in `src/lib/caring-contacts/service-state.ts`
> mentions one, so THE STORE MUST MINT THE UUID ITSELF on every stop and carry it into both this
> table and `service_state.stop_id`. If it does not, `service_state_stop_is_identified` below turns
> a safety stop into a refused write — the one write in this system that must never fail.

### E. The three "also fix" items

- **`pathway_version_approvals` is now proven**, on constraint names, by seven tests: a positive
  control, `_no_self_approval` (the author approving their own content), `_unique_version_role`,
  `_unique_version_actor` (one person supplying both approvals by changing role), `_role_is_known`
  (`chiefExecutive` refused), and **two** covering `_version_fk` — one that misstates the author to
  escape the self-approval check, and one that reaches across teams for the version. The second was
  added after I noticed the `team_id` half of the composite key was otherwise unproven.
- **On the three-column FK: I judge it in scope and I am keeping it, deliberately.** It is what
  makes both denormalised columns honest rather than decorative — Ruling 21's `team_id` drives the
  row's entire RLS scope, and `author_id` is the only thing `_no_self_approval` can compare against.
  Mutation G below shows both are load-bearing. Flagging rather than dropping, as instructed.
- **`notification_preferences` and `training_records`** are now in `PATIENT_BEARING_TABLES` (so their
  enabled/forced RLS state is asserted) and each has a cross-team denial with a positive control in
  the same test, matching the `plan_assignments` shape. I added a comment on the constant noting the
  two are per-actor rather than per-patient but that their RLS is load-bearing in the same way; I did
  **not** rename the constant or the test title, to keep the diff reviewable. The list now asserts a
  strict superset — nothing was removed.

### F. Step 2 — the required red, and what it said

```
$ CARING_CONTACTS_DATABASE_URL=… npm run caring-contacts:db:test -- tests/caring-contacts-migrations.test.ts
 Test Files  1 failed (1)
      Tests  14 failed | 36 passed (50)
```

- `AssertionError: expected [ 'actors', 'referrals', …(16) ] to include 'service_stops'`
- `error: relation "caring_contacts.service_stops" does not exist` ×10
- `AssertionError: promise resolved "undefined" instead of rejecting` ×2 — **the Ruling 27 exposure,
  reproduced.**
- `expected [Function] to throw error matching /caring-contacts-audit-required/ but got 'relation
"caring_contacts.service_sto…'` — the Ruling 29 test, failing on the missing table rather than on
  the missing trigger, so it was not yet proving what it claims. It proves it in the green run and
  under mutation C.

The seven `pathway_version_approvals` tests and the two per-actor tests **passed at this point**, and
I am calling that out rather than counting them as red-then-green: those constraints already existed
from round 1 and were simply unproven. Their value is the mutations below, not the red.

### G. Green

```
$ CARING_CONTACTS_DATABASE_URL=… npm run caring-contacts:db:test
 Test Files  2 passed (2)
      Tests  87 passed (87)
```

```
$ npm run test
 Test Files  1 failed | 690 passed | 2 skipped (693)
      Tests  1 failed | 7665 passed | 29 skipped (7695)
```

Byte-identical pass/fail counts to round 1 — the same single pre-existing
`caring-contacts-retention.test.ts` failure from Task 10's commit, untouched. `npx eslint` on both
changed TypeScript files: clean, exit 0. `npx prettier --check`: `All matched files use Prettier code
style!`. Prettier still has no parser for `.sql`. Nothing provider-backed was run; nothing was pushed.

### H. The seven mutations

Each was checked for whether it changes a value some assertion reads before the result was trusted.

| #   | Mutation                                                                                                                          | Reddened                                                                                                                                   | What the assertion saw change                                                                                                                                                                                                              |
| --- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A   | `plan_assignments_plan_fk` reverted to the bare `(plan_id)` key, **name held constant** so it could not fail for the wrong reason | `refuses an assignment TEAM-SOUTH writes for TEAM-NORTH's plan` (1 of 50)                                                                  | `promise resolved "undefined" instead of rejecting` — TEAM-SOUTH's write into another team's plan **committed**.                                                                                                                           |
| B   | `service_restart_approvals_stop_fk` removed                                                                                       | `refuses an approval that names a stop that was never recorded` (1 of 50)                                                                  | The approval naming an unrecorded incident **committed**.                                                                                                                                                                                  |
| C   | `service_stops` and `service_state` removed from `attach_audit_guard`                                                             | `REFUSES a stop written with no audit event…` (1 of 50)                                                                                    | The unaudited stop **committed**.                                                                                                                                                                                                          |
| D   | `pathway_version_approvals_no_self_approval` removed                                                                              | `refuses the author approving the content they wrote` (1 of 50)                                                                            | SEED-AUTHOR approved their own content and it **committed**.                                                                                                                                                                               |
| E   | `notification_preferences_team_scope` removed, RLS still enabled and forced                                                       | `shows a team its own notification preferences and none of another team's` (1 of 50)                                                       | `new row violates row-level security policy` — but it reddens on the **positive control's write**, not on the cross-team read, so it proves only that the policy is load-bearing at all. I ran E2 rather than let that stand as the proof. |
| E2  | `notification_preferences_team_scope` widened to `using (true) with check (true)`                                                 | same test (1 of 50)                                                                                                                        | `expected [ { actor_id: 'ACTOR-NORTH' } ] to deeply equal []` — **TEAM-SOUTH read TEAM-NORTH's row.** This is the cross-team leak asserted directly, and it is the mutation the denial half rests on.                                      |
| F   | Approvals keyed back onto the **mutable singleton** `service_state (stop_id)` — the pre-Ruling-28 design                          | `lets the SAME three people approve a LATER stop` **and** `gives a NEW stop zero approvals of its own` (2 of 50)                           | `update or delete on table "service_state" violates foreign key constraint "service_restart_approvals_stop_fk"` — the restart itself becomes impossible while any approval exists. See the caveat below.                                   |
| G   | The three-column `pathway_version_approvals_version_fk` reduced to a bare `(pathway_version_id)` key, name held constant          | `refuses an approval that reaches across teams for its pathway version` **and** `refuses an approval that misstates the author…` (2 of 51) | Both wrote and **committed** — a row claiming the wrong team, and a row naming a fabricated author to escape the self-approval check. This is the evidence for keeping the composite key.                                                  |

Every mutation was reverted from a byte-copy before the next was applied; the final restore was
verified with `diff` (`REVERTED CLEAN`, no output) and the suite re-run green at 87.

**The one honest gap, stated rather than papered over.** Mutation F reddens
`gives a NEW stop zero approvals of its own`, but it reddens it by making the _restart_ fail, not by
letting a closed incident's approvals be counted toward the new one. **I could not construct a schema
mutation that produces the latter, and I did not substitute an easier mutation to hide that.** The
reason is structural and worth recording: under this schema the wrong behaviour is not expressible.
A new incident has a fresh `stop_id`, the approvals carry their own incident's id permanently, and
the FK forces both to name real rows — so counting stale approvals could only ever be a _store_ bug,
a missing `where stop_id = <current>` in `getServiceState`. That test is therefore best read as a
**regression guard aimed at Task 11b's read path**, not as proof of a constraint. Mutation F does
prove the design change was load-bearing: the pre-Ruling-28 shape cannot support the stop → approve →
restart → stop sequence at all.

### I. What I did NOT do

- **No immutability trigger on `service_stops`.** "Immutable" is enforced by convention plus the
  primary key: `stop_id` is never reused, which is all the foreign key needs. Nothing stops a writer
  from rewriting `reason` or `stopped_by` on a closed incident. A row-level `before update` trigger
  rejecting any change other than `restarted_at` would close it. Not requested, not built, flagged.
- **`service_state` still carries `stopped_reason` and `stop_note`,** now duplicating `service_stops`
  for the current incident. The original brief required those columns and no ruling removed them, so
  they stay; `service_stops` is the record of truth and `service_state` is the pointer plus a
  denormalised copy. They could drift. Making them honest would need a
  `(stop_id, stopped_reason) references service_stops (stop_id, reason)` composite and another
  unique — cheap, but it is a fifth change to a table three rulings have already moved, so I am
  raising it rather than adding it unasked.
- **The four deferred items were left alone** exactly as instructed: the singleton conversion's
  data-migration safety for a pre-existing multi-row table, the coverage calendar-day CHECK being
  asserted by column type rather than a refused write, `attach_audit_guard` lacking `set
search_path`, and the contract-precondition divergence between the Postgres and in-memory runs.
- **`service_stops.reason` has no dedicated refusal test** (nor does `service_state`'s equivalent
  five-value check). Same category as the round-1 list in §5: reachable, exercised only through valid
  values, unproven.
