### Task 11a: Migration 0003 — the workspace schema

Derived from `task-11-brief.md` by controller Ruling 24, which splits Task 11 in two. This half is the
SCHEMA only. The Postgres store implementation is Task 11b and is NOT in scope here; `npm run typecheck`
stays red for `src/lib/caring-contacts/db/postgres-repository.ts` throughout this task and that is correct.

Read `task-11-brief.md` for the original schema table. Everything below either restates it or OVERRIDES it,
and where they differ, this file wins.

**Files:**

- Create: `caring-contacts/supabase/migrations/0003_caring_contacts_workspace.sql`
- Modify: `tests/helpers/caring-contacts-postgres.ts` (the `seedPlan` fixture — Ruling 22)
- Test: `tests/caring-contacts-migrations.test.ts` (extend)

**Hard rules:** this file goes in `caring-contacts/supabase/migrations/`, NEVER `supabase/migrations/`.
It targets role `postgres`. It creates nothing in the Clinical KB Supabase project `sjrfecxgysukkwxsowpy`
and touches no hosted service. The migration must be REPLAY-SAFE: `tests/caring-contacts-migrations.test.ts`
re-applies the whole set and asserts it does not error, so every statement must be idempotent — `if not
exists`, `drop ... if exists`, or guarded inside a `do` block. No `create index concurrently`; an existing
test fails on it because it cannot run inside a migration transaction.

---

#### The service stop is a SINGLETON — this is the safety-critical part of the task

Two controller rulings govern it and they override the original brief's text.

**Ruling 9 / Ruling 19.** `caring_contacts.service_state` exists today as `team_id text primary key
references teams (id)` (see `0001_caring_contacts_foundation.sql:205`) — a PER-TEAM table. Convert it to a
schema-enforced singleton:

- one fixed-key row, enforced by the schema itself and not by convention (the usual shape is a boolean or
  text primary key with a CHECK pinning it to one value, so a second row is impossible);
- the old team column becomes nullable `reported_by_team_id` — ATTRIBUTION ONLY, never a scoping key;
- add `stop_id uuid`, generated at stop time (Ruling 4);
- add `stopped_reason text` with a CHECK against exactly these five values: `wrong-recipient`,
  `duplicate-send`, `unauthorised-content`, `privacy-or-security-incident`, `audit-integrity-loss`.
  They are `ServiceStopReason` in `src/lib/caring-contacts/service-state.ts:31` — copy them exactly.
- add `stop_note text`;
- DROP `restart_approved_by` in favour of the child table below;
- keep the existing `service_state_stop_is_attributed` CHECK working.

**Ruling 4.** New child table `service_restart_approvals`, keyed on the STOP, never the team:

- `stop_id` (references the stop), `role text` CHECK in exactly `incidentLead`, `privacySecurityOwner`,
  `clinicalProgrammeLead` — they are `ServiceRestartApprovalRole` in `service-state.ts:38`;
  `actor_id text`, `approved_at timestamptz`, plus an optional `approved_by_team_id` for attribution;
- `UNIQUE (stop_id, role)` and `UNIQUE (stop_id, actor_id)`.

**Do NOT key these uniques on the team.** The original brief said `UNIQUE (team_id, role)` and
`UNIQUE (team_id, actor_id)`; keyed that way, the approvals recorded for a first stop permanently bar their
approvers from approving any LATER stop, so a team's second incident could become unrestartable. Keying by
the stop instance keeps "three different people per restart" exactly, per incident.

**Ruling 20 — row-level security for these two tables ONLY.** They do NOT get the blanket
team-scope policy. They get `using (caring_contacts.current_team_id() is not null)` with the same
expression in `with check`.

A team-scoped policy on a service-wide singleton IS the leak: every other team would read zero rows and
conclude the service is running while an incident is live. Scoping on "this session named some team" keeps
`0002`'s deny-by-default property intact — an unscoped session still matches no row — while making the one
stop row visible to everyone who must obey it. No policy becomes unconditionally true. Update the prose
comment in `0002_caring_contacts_rls.sql` (or add one in 0003) that currently claims "There is no policy
anywhere that is unconditionally true" so it states this deliberate exception and why, rather than being
quietly falsified.

---

#### The rest of the schema

| Table                                 | Change                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pathway_versions`                    | add `published_at timestamptz`, `retired_at timestamptz`, `retirement_urgency text` CHECK in (`routine`, `urgentSafety`), `snapshot jsonb not null`; keep the existing `pathway_versions_no_self_approval` CHECK. **Do not touch the `state` CHECK** — it already matches `PathwayVersionState` exactly (`draft`, `inReview`, `approved`, `retired`); publishing is `published_at`, not a fifth state. |
| `pathway_version_approvals` **(new)** | `pathway_version_id` referencing `pathway_versions(id)`, `team_id` (denormalised, Ruling 21), `role text`, `actor_id text`, `approved_at timestamptz`; `UNIQUE (pathway_version_id, role)` and `UNIQUE (pathway_version_id, actor_id)`; plus a constraint carrying the same no-self-approval rule the parent has.                                                                                      |
| `plans`                               | add `pathway_version_id` FOREIGN KEY to `pathway_versions(id)` and `referral_id` FOREIGN KEY to `referrals(id)` — both columns already exist as bare `text not null`. This closes Phase 1 open item 2.                                                                                                                                                                                                 |
| `plan_assignments` **(new)**          | `plan_id` primary key referencing `plans` with CASCADE, `team_id` referencing `teams`, `owner_id text`, `claimed_at timestamptz`, `covered_by text`, `coverage_from text`, `coverage_until text`. Coverage columns are AWST calendar days in `YYYY-MM-DD` form, NOT ISO instants (Ruling 2) — keep them `text`.                                                                                        |
| `plan_reassignments` **(new)**        | `id bigint generated always as identity primary key`, `plan_id` referencing `plans` with CASCADE, `team_id`, `from_actor_id`, `to_actor_id`, `reason text not null`, `at timestamptz`.                                                                                                                                                                                                                 |
| `contact_dispatches`                  | add `reported_status text`, `discrepancy_resolved_at timestamptz`, `discrepancy_resolution text` CHECK in (`confirmedDelivered`, `confirmedNotDelivered`, `unresolvedNoResend`), `discrepancy_note text`.                                                                                                                                                                                              |
| `notification_preferences` **(new)**  | `actor_id` primary key, `team_id` referencing `teams`, `opted_in text[] not null default '{}'`.                                                                                                                                                                                                                                                                                                        |
| `training_records` **(new)**          | `actor_id` primary key, `team_id` referencing `teams`, `completed text[] not null default '{}'`.                                                                                                                                                                                                                                                                                                       |
| `retention_state`                     | no columns added.                                                                                                                                                                                                                                                                                                                                                                                      |

**Every new table** gets `enable row level security` and `force row level security`, plus one policy named
`<table>_team_scope` FOR ALL TO `caring_contacts_app` USING `team_id = caring_contacts.current_team_id()`
WITH CHECK on the same expression — EXCEPT `service_state` and `service_restart_approvals`, which use the
Ruling 20 policy above. Add the `require_audit` constraint trigger to every new table that carries a
mutation, by extending the existing driven list in `0001` rather than hand-writing each trigger.

---

#### Ruling 22 — the fixture must become legitimate

`tests/helpers/caring-contacts-postgres.ts:195 seedPlan` inserts a `referral_id` and a `pathway_version_id`
built from the plan id, with NO parent rows in `referrals` or `pathway_versions`. The moment the two foreign
keys above are real, every existing test that calls `seedPlan` fails. EXTEND the helper to insert the parent
referral and pathway-version rows first, in the same audited transaction.

This is making an invalid fixture valid. It is NOT permission to delete or loosen any assertion. If any
OTHER existing test goes red, that is a defect in your migration, not in the test — fix the migration.

---

- [ ] **Step 1: Write the failing tests**

Extend `tests/caring-contacts-migrations.test.ts`. First the directory separation:

```ts
it("keeps every caring-contact migration out of the Clinical KB migration directory", () => {
  const caringContactMigrations = readdirSync("caring-contacts/supabase/migrations");
  expect(caringContactMigrations).toContain("0003_caring_contacts_workspace.sql");
  const repositoryMigrations = readdirSync("supabase/migrations");
  for (const file of caringContactMigrations) {
    expect(repositoryMigrations).not.toContain(file);
  }
});
```

Then the behavioural proofs. These must run as `caring_contacts_app`, never as the migration superuser,
because a superuser bypasses row-level security and would pass against a schema with no policies at all.
Do NOT assert these by regex over the SQL text — assert them against the running database, on the
constraint name where a constraint is the mechanism:

1. **A single person cannot restart the service.** Record a stop, record one approval as ACTOR-X in role
   `incidentLead`, then attempt a second approval as the SAME ACTOR-X in role `privacySecurityOwner`, and
   assert the database refuses it. Assert on the constraint name, not a generic error.
2. **A later stop is approvable by the same people.** Record a stop, approve it three times by three
   actors, restart, then record a SECOND stop and assert the SAME three actors can approve it again. This
   is the proof Ruling 4 exists for, and it would fail under the original brief's team-keyed uniques.
3. **The stop is service-wide.** A stop written while scoped to TEAM-NORTH is READABLE by a session scoped
   to TEAM-SOUTH. Contrast this with the existing plans test, which asserts a cross-team read returns zero
   rows — that contrast is the point, so state it in a comment.
4. **The stop table is a singleton.** Attempting to insert a second `service_state` row fails.
5. **A session naming NO team still sees no `service_state` row** — deny-by-default is not weakened.
6. **A plan whose `pathway_version_id` has no parent row is refused**, and likewise `referral_id`. Assert
   on the foreign-key constraint name.
7. **A cross-team session reads zero rows from `plan_assignments`**, matching the existing plans proof.
8. **A mutation on one new table with no audit event in the same transaction is refused** with
   `caring-contacts-audit-required`.

- [ ] **Step 2: Run and verify they fail**

`npm run test:focused -- --files tests/caring-contacts-migrations.test.ts` — expect failure; the migration
does not exist yet. Then, with `CARING_CONTACTS_DATABASE_URL` set, `npm run caring-contacts:db:test` —
expect failure. Say which assertion failed and why, so the later green means something.

- [ ] **Step 3: Write the migration and extend the seedPlan helper.**

- [ ] **Step 4: Run and verify they pass.** Paste the decisive `N passed` line, never the exit code, and
      never piped through `tail` in a way that hides it.

- [ ] **Step 5: Prove the tests can fail — five mutations.** For EACH one, first confirm the mutation
      actually changes a value some assertion reads. A mutation that leaves the suite green means that
      assertion is decorative, and you must say so in your report rather than quietly substituting another.

1. Drop `UNIQUE (stop_id, actor_id)` on `service_restart_approvals` → the single-person restart test reddens.
2. Change that unique back to the team-keyed form → the SECOND-STOP test reddens. This is the mutation that
   proves Ruling 4 was load-bearing rather than cosmetic.
3. Replace the Ruling-20 policy on `service_state` with the standard team-scope policy → the service-wide
   readability test reddens.
4. Drop the `plans.pathway_version_id` foreign key → the missing-pathway test reddens.
5. Remove the `require_audit` trigger from one new mutating table → the transactional-audit test reddens.

Revert each and confirm green again before moving on.

- [ ] **Step 6: Commit.** Record in the commit body what you mutated and which test caught it.

```bash
git add caring-contacts/supabase/migrations/0003_caring_contacts_workspace.sql tests/helpers/caring-contacts-postgres.ts tests/caring-contacts-migrations.test.ts
git commit -m "feat(caring-contacts): workspace schema with a singleton service stop, per-incident restart approvals and real pathway/referral keys"
```

---

#### Two traps in the existing harness — read before you start

Both are in `tests/helpers/caring-contacts-postgres.ts` and both will cost you an hour if you meet them
the hard way.

1. **Migrations apply in sorted filename order** (`caringContactsMigrations()` does `readdirSync(...).sort()`
   and `applyCaringContactsMigrations` runs them in that order). So `0003` runs AFTER `0002`, and `0002`
   has already created the standard team-scoped policy `service_state_team_scope` from its driven list.
   Your migration must DROP that policy and create the Ruling 20 one in its place — adding a second policy
   is not enough, because Postgres ORs multiple permissive policies together and the team-scoped one would
   simply be redundant rather than replaced. Consider also removing `service_state` from the driven list in
   `0002` so the two files do not disagree about which policy that table has; if you do, say so and keep
   `0002` replay-safe.

2. **`CARING_CONTACTS_DATA_TABLES` is a hand-maintained list** (line ~90) used by
   `truncateCaringContactsData`, which runs between tests. It is ordered child-first so truncation is
   foreign-key safe. Every new table you add that holds test rows MUST be added to it, in a child-before-
   parent position. Miss one and rows leak between tests: you will see failures that depend on test order
   and look like schema bugs. `service_state` is a singleton row rather than per-team data — decide
   deliberately whether it is truncated between tests, and state your reasoning; a stop left standing
   between tests would refuse every subsequent write and produce a very confusing cascade.

---

#### The two new foreign keys must be SAME-TEAM keys, not bare keys (Ruling 25)

A plain `plans.referral_id references referrals (id)` does not constrain the team. Foreign-key checks are
performed by the system and are NOT subject to row-level security, so a bare key would happily let a plan
owned by TEAM-NORTH point at a referral owned by TEAM-SOUTH. In a workspace whose entire schema exists to
stop one hospital team seeing another's patients — to the point that `0001` answers cross-team existence
questions through SECURITY DEFINER functions that return a bare boolean and nothing else — a link that
silently crosses teams is the wrong default.

Make both keys composite so the team travels with them:

- add a `UNIQUE (id, team_id)` to `referrals` and to `pathway_versions` (each is redundant given the
  primary key on `id`, and that is fine — its only job is to be a referencable target);
- then `plans (referral_id, team_id) references referrals (id, team_id)` and
  `plans (pathway_version_id, team_id) references pathway_versions (id, team_id)`.

**Test required:** a plan created by TEAM-NORTH that names a referral belonging to TEAM-SOUTH is refused,
and the refusal names the foreign-key constraint. Prove it against the database, not by reading the SQL.

If this turns out to conflict with something real — for example if a pathway version is genuinely meant to
be shared across teams rather than owned by one — do NOT force it. Stop, say so in your report with the
evidence, and implement the bare key instead. A shared pathway library would be a legitimate design and
this ruling would be wrong; I am ruling on what the current schema says, which is that `pathway_versions`
carries `team_id text not null` and is team-scoped by policy like everything else.
