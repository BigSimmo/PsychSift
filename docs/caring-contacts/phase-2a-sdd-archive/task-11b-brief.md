### Task 11b: The Postgres store — shared-contract move, then the ~21 methods

Derived from `task-11-brief.md` by controller Ruling 24. Task 11a has already landed the schema
(`caring-contacts/supabase/migrations/0003_caring_contacts_workspace.sql`) and extended the `seedPlan`
fixture. This half makes the Postgres store satisfy the extended `CaringContactRepository` interface and
restores `npm run typecheck` to green.

**Files:**

- Modify: `tests/helpers/caring-contacts-repository-contract.ts` (receives the moved tests — do this FIRST)
- Modify: `tests/caring-contacts-repository.test.ts` (loses the moved tests)
- Modify: `src/lib/caring-contacts/db/postgres-repository.ts` (the ~21 methods)

---

#### Step 0 — read this before touching anything

`npm run typecheck` is RED right now, and has been since Task 10. `postgres-repository.ts` does not
implement the ~21 methods Task 10 added to the interface. That is the defect you are fixing. Do NOT narrow
the interface, do NOT delete methods from it, and do NOT stub a method with `throw new Error("not
implemented")` and call the task done — a stub that satisfies the compiler while failing at runtime is
worse than the current honest red, because it converts a visible failure into a hidden one.

---

#### Step 1 — move the behavioural tests into the shared contract (Ruling 23). Do this FIRST.

`tests/helpers/caring-contacts-repository-contract.ts` is a factory-driven suite whose own header states:
"Task 9 runs it against the in-memory store; Task 11 runs this same function against the Postgres store
rather than writing a second suite, which is why it takes a factory instead of calling a constructor."
Both `tests/caring-contacts-repository.test.ts` and `tests/caring-contacts-postgres-repository.test.ts`
call `describeCaringContactRepositoryContract` with their own factory.

Task 10 did not follow that design: it put every behavioural test for its 21 new methods into
`tests/caring-contacts-repository.test.ts`, which builds `createInMemoryRepository` directly. Those tests
therefore hold ONE store to the behaviour. If you implement the Postgres methods against them as they
stand, nothing proves the two stores agree — which is the exact drift the contract file exists to prevent.

**Move the behavioural tests into the shared contract**, so both stores are held to them. In particular
these must end up in the shared contract, because they are the safety-critical ones:

- every ordinary mutation refuses while the service is stopped, and a death is still recordable;
- reads still work while stopped (Decision D);
- the stop is SERVICE-WIDE: a stop raised by a TEAM-NORTH actor refuses a write on a TEAM-SOUTH plan;
- a saved pathway version is always an unapproved draft authored by the caller, whatever was supplied
  (this is the Ruling 14 fix from Task 10's fix round — do not let it exist in only one store);
- a `service-stopped` refusal is NOT cached against the idempotency key, so the same key succeeds after
  the third restart approval (Ruling 15);
- every new write emits exactly one audit event;
- `resolveDispatchDiscrepancy` with `unresolvedNoResend` leaves the contact's state and version untouched
  and opens no second dispatch row;
- the three-person restart rule, including that the same actor cannot supply two approvals.

Leave behind ONLY assertions that genuinely poke in-memory internals and cannot be expressed against a
store interface. For each one you leave behind, say in your report which it is and why.

The moved tests must not be weakened in the move. If a test used an in-memory-only shortcut (reaching into
a Map, constructing a store with a hand-made option), rewrite it to go through the repository interface —
and if that is not possible for a specific assertion, that assertion is one of the ones that stays behind.

**Expected outcome of Step 1, before you write any implementation:** the in-memory suite still passes, and
`npm run caring-contacts:db:test` FAILS loudly with missing-method errors. Run it and paste the failure.
That red is the point of doing this first: it is what makes the later green mean something.

---

#### Step 2 — implement the ~21 methods in `postgres-repository.ts`

The method list is in `task-10-brief.md` under "Interfaces — added to `CaringContactRepository`", plus
`rescheduleContact` from Ruling 3. `src/lib/caring-contacts/in-memory-repository.ts` is your reference for
the intended semantics; read it as the specification of behaviour, but do NOT copy its structure — the
Postgres store has its own transaction, locking and audit machinery you must reuse.

Reuse, do not reinvent:

- the existing transaction preamble unchanged: `begin`, then `set_config('caring_contacts.team_id', ...)`,
  then `set_config('caring_contacts.audit_token', ...)`, then `set local role caring_contacts_app`;
- the existing `runWrite` / `runRead` / `inTransaction` helpers, so every new write is audited in the same
  transaction as its change and the `require_audit` trigger is satisfied;
- the existing idempotency handling — with the Ruling 15 exception that a `service-stopped` refusal is not
  recorded against the key;
- the domain modules for every rule (`referrals.ts`, `pathway-versions.ts`, `assignment.ts`,
  `service-state.ts`, `contact-rescheduling.ts`, `notification-preferences.ts`, `training.ts`). The store
  persists decisions; it does not re-derive them. Re-implementing a rule in SQL that a domain module
  already owns is a defect even when it produces the same answer today.

**Map the database's own refusals onto the same reason strings TypeScript uses**, so both stores answer
identically. At minimum, the two unique violations on `service_restart_approvals` map to
`restart-approval-role-already-recorded` and `restart-approval-actor-already-recorded` respectively.
Map by CONSTRAINT NAME, never by parsing the error message text.

**The service stop is a singleton row and must be read on every dispatch path regardless of the
dispatching team** (Ruling 9). The 11a schema enforces one row and a policy that lets every team-scoped
session read it; your store must actually consult it in the shared write path, not per method.

---

#### Step 3 — run and verify

`npm run caring-contacts:db:test` — paste the decisive `N passed` line, never the exit code, and never
piped through `tail` in a way that hides it.

`npx tsc --noEmit -p tsconfig.json` — this must now be CLEAN. Restoring typecheck is the task's headline
deliverable; report the exact output.

`npm run test` — the full unit suite must be green, because the shared contract move touches a file the
in-memory suite also runs.

`npx eslint <the files you changed>` — clean.

---

#### Step 4 — prove the tests can fail

For EACH mutation below, first confirm it actually changes a value some assertion reads. A mutation that
leaves the suite green means that assertion is decorative, and you must say so in your report rather than
quietly substituting an easier one. This branch has already had a suggested mutation turn out to be a
no-op that proved nothing, and has twice found tests that could not fail.

1. Make the Postgres `savePathwayVersion` trust the caller's `state` and `approvals` → the Ruling 14
   contract test reddens **for the postgres store specifically**. This is the single most valuable
   mutation in the task: it proves the shared-contract move actually bound the second implementation.
2. Remove the service-stop check from the Postgres shared write path → the stopped-mutation and
   cross-team service-wide tests redden for postgres.
3. Record a `service-stopped` refusal against the idempotency key → the Ruling 15 retry-after-restart test
   reddens.
4. Map both `service_restart_approvals` unique violations onto the same reason string → the role-versus-
   actor distinction test reddens.

Revert each and confirm green again.

---

#### Step 5 — commit

Two commits are appropriate here and preferred: one for the shared-contract move (which should be
behaviour-preserving for the in-memory store), one for the Postgres implementation. Record in each commit
body what you mutated and which test caught it.

Do NOT push. Do NOT open a pull request. Do NOT run `verify:release`, `verify:cheap`, `eval:*`,
`check:supabase-project`, or `test:live`.

---

#### Step 0b — repair the one red test in the full suite (Ruling 26)

`npm run test` currently has exactly ONE failure, and you cannot report Step 3 green without fixing it.

`tests/caring-contacts-retention.test.ts`, the case titled _"is the only module in src/lib/caring-contacts
that hard-codes a retention period"_, walks the sealed domain, skips `retention.ts`, and records an offence
for any file matching EITHER `/retention/i` (the word) OR `/\byears\s*:\s*7\b/` (the period). Task 10's
plan-mandated `markRetentionCleared` put the word into `repository.ts` (2 occurrences) and
`in-memory-repository.ts` (6). The `years: 7` half still passes — no period is hard-coded anywhere.

I verified the origin by counting matches per commit: 0 and 0 before Task 10, 2 and 6 at Task 10's commit
`6bf9f6362`, unchanged since. It is a genuine regression that survived because Task 10 and its fix round
ran only two focused test files and never the full suite, and because the offended test lives outside any
diff a task reviewer would read.

**Ruling 26 — the fix, and it is narrow on purpose:**

1. The `/\byears\s*:\s*7\b/` half is UNTOUCHED and keeps applying to every file, including the two storage
   files. This is the half that matches the test's own title.
2. The word-mention half gains a narrow allowlist naming exactly `repository.ts` and
   `in-memory-repository.ts`, with a comment explaining that the storage layer must be able to NAME the
   thing it stores, and that the period check below still binds them.
3. Those two allowlisted files gain a COMPENSATING assertion: no line that mentions retention may also
   contain a digit. That catches a hard-coded period spelled any other way — `RETENTION_YEARS = 7`,
   `retentionYears: 7`, `retention: { years: 7 }` — which the `years: 7` regex alone would miss.

Do NOT simply delete the word check, do NOT widen the allowlist beyond those two files, and do NOT rename
`markRetentionCleared` to dodge the regex. Point 3 is not optional: without it this would be a loosening,
and with it the two exempted files are checked more strictly than before, not less.

**Prove it can fail:** add `const RETENTION_YEARS = 7;` to `repository.ts`, confirm the compensating
assertion reddens, and revert. If it does NOT redden, your compensating assertion is decorative and you
must say so rather than move on.

If you conclude Ruling 26 is wrong — for example if you find evidence the sealed-module intent really was
"no module outside retention.ts may even name retention" — stop and report with that evidence rather than
implementing something you think is wrong. The alternative is renaming the storage methods, which is a
decision for me, not for you.

---

#### Schema facts from Task 11a that change what you must write

Task 11a landed the schema and then a fix round on top of it. Four things there bind you directly.

**1. The store must mint the stop's uuid itself (Ruling 28 / 11a constraint `service_state_stop_is_identified`).**
`src/lib/caring-contacts/service-state.ts` has NO `stopId` concept: neither `ServiceState` nor
`stopService({ reason, note })` mentions one. The schema requires a stop to carry its `stop_id`, and there
is a `service_stops` history table holding one immutable row per incident, with
`service_restart_approvals.stop_id` a real foreign key to it. So your `stopService` must generate the uuid
and insert the history row; if you forget, the constraint turns a safety stop into a REFUSED write, which
is the one write in this system that must never be blocked. Decide deliberately whether `stopId` should
also surface on the domain's `ServiceState` type — if you conclude it should, say so and I will rule
rather than you widening a sealed-domain type on your own initiative.

**2. Restart approvals must be read for the CURRENT stop only.** After a restart the previous incident's
approval rows survive in `service_restart_approvals`, keyed to the old `stop_id`. A `getServiceState` that
fills `restartApprovals` without filtering on the current stop would present a brand-new live incident as
already three-person approved — a zero-approval restart. The 11a fix round adds a test that stops,
approves three times, restarts, stops again and asserts the new stop reads ZERO approvals. Your store must
pass it.

**3. Every refusal is mappable by CONSTRAINT NAME.** 11a named every constraint deliberately for you:
`service_state_pkey`, `service_state_is_singleton`, `service_restart_approvals_unique_stop_role`,
`service_restart_approvals_unique_stop_actor`, `plans_referral_fk`, `plans_pathway_version_fk`, and the
`plan_assignments` / `plan_reassignments` composite keys added by Ruling 27. Map on the name, never by
parsing message text.

**4. The two contract runs currently start from DIFFERENT preconditions, and fixing that is your job.**
To keep the shared contract green under 11a's new foreign keys, the Postgres suite alone got a `beforeEach`
that pre-creates parent referrals and pathway versions and empties the audit table, and one contract
fixture line names `REFERRAL-3` / `PATHWAY-2`. That is temporary scaffolding. It means the contract can no
longer prove the Postgres store validates its own parents. Once your `createReferral` and
`savePathwayVersion` exist, the contract should create its own parents through the repository interface and
that scaffolding should come out — the `beforeEach` and the fixture line must be revisited TOGETHER.

**The temptation at that exact moment will be to relax an assertion rather than make the store satisfy it.
Do not.** If you find yourself about to change what a contract test expects, stop and report instead. The
one thing this plan forbids absolutely is loosening an existing assertion to make a change fit.

**5. Two more schema facts from 11a's second fix round.** `service_stops` rows are ENFORCED immutable by a
`before update` trigger — you may only ever update `restarted_at` on a closed incident, so a correction to
a recorded reason is a new row or a migration, never an update (Ruling 30). And `service_state` does NOT
carry `stopped_reason` or `stop_note`: the current incident's reason and note live once, in `service_stops`,
reached by `stop_id` (Ruling 31). Read them through the join. If you find yourself wanting to denormalise
them back onto the singleton for convenience, do not — two copies of a safety incident's reason can drift,
and the banner renders that reason on every screen.
