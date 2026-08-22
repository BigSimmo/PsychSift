### Task 11: Migration 0003 and the Postgres implementation

**Files:**

- Create: `caring-contacts/supabase/migrations/0003_caring_contacts_workspace.sql`
- Modify: `src/lib/caring-contacts/db/postgres-repository.ts`
- Test: `tests/caring-contacts-postgres-repository.test.ts` (extend)
- Test: `tests/caring-contacts-migrations.test.ts` (extend)

**Schema changes:**

| Table                                | Change                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `service_state`                      | add `stopped_reason text` with a CHECK against the five categorised reasons; add `stop_note text`; **drop** `restart_approved_by text` and add child table `service_restart_approvals (team_id, role, actor_id, approved_at)` with `UNIQUE (team_id, role)` and `UNIQUE (team_id, actor_id)` — the two uniques are what make a single-person restart impossible in the database, not only in TypeScript                  |
| `pathway_versions`                   | add `published_at timestamptz`, `retired_at timestamptz`, `retirement_urgency text` CHECK in (routine, urgentSafety), `snapshot jsonb not null`; add child table `pathway_version_approvals (pathway_version_id, role, actor_id, approved_at)` with `UNIQUE (pathway_version_id, role)` and `UNIQUE (pathway_version_id, actor_id)`; keep the existing `no_self_approval` CHECK and add the same rule to the child table |
| `plans`                              | add `pathway_version_id` **foreign key** to `pathway_versions(id)` and `referral_id` foreign key to `referrals(id)` — closing Phase 1 open item 2                                                                                                                                                                                                                                                                        |
| `plan_assignments` **(new)**         | `plan_id pk → plans CASCADE`, `team_id → teams`, `owner_id text`, `claimed_at timestamptz`, `covered_by text`, `coverage_from text`, `coverage_until text`                                                                                                                                                                                                                                                               |
| `plan_reassignments` **(new)**       | `id bigint identity pk`, `plan_id → plans CASCADE`, `team_id`, `from_actor_id`, `to_actor_id`, `reason text not null`, `at timestamptz`                                                                                                                                                                                                                                                                                  |
| `contact_dispatches`                 | add `reported_status text`, `discrepancy_resolved_at timestamptz`, `discrepancy_resolution text` CHECK in (confirmedDelivered, confirmedNotDelivered, unresolvedNoResend), `discrepancy_note text`                                                                                                                                                                                                                       |
| `notification_preferences` **(new)** | `actor_id pk`, `team_id → teams`, `opted_in text[] not null default '{}'`                                                                                                                                                                                                                                                                                                                                                |
| `training_records` **(new)**         | `actor_id pk`, `team_id → teams`, `completed text[] not null default '{}'`                                                                                                                                                                                                                                                                                                                                               |
| `retention_state`                    | no columns added; it finally gets writes from `markRetentionCleared`                                                                                                                                                                                                                                                                                                                                                     |
| every new table                      | `enable row level security` + `force row level security` + one policy `<table>_team_scope FOR ALL TO caring_contacts_app USING (team_id = caring_contacts.current_team_id()) WITH CHECK (same)`, and the `require_audit` constraint trigger where the table carries a mutation                                                                                                                                           |

**Hard rules:** this file goes in `caring-contacts/supabase/migrations/`, **never** `supabase/migrations/`. It targets role `postgres`. It creates nothing in the Clinical KB project. `tests/caring-contacts-migrations.test.ts` already asserts the directory separation — extend it to assert the new file is present in the caring-contacts directory and absent from the repository one.

- [ ] **Step 1: Write the failing tests**

Extend `tests/caring-contacts-migrations.test.ts`:

```ts
it("keeps every caring-contact migration out of the Clinical KB migration directory", () => {
  const caringContactMigrations = readdirSync("caring-contacts/supabase/migrations");
  expect(caringContactMigrations).toContain("0003_caring_contacts_workspace.sql");
  const repositoryMigrations = readdirSync("supabase/migrations");
  for (const file of caringContactMigrations) {
    expect(repositoryMigrations).not.toContain(file);
  }
});

it("makes a single-person restart impossible in the database, not only in TypeScript", () => {
  const sql = readFileSync("caring-contacts/supabase/migrations/0003_caring_contacts_workspace.sql", "utf8");
  expect(sql).toMatch(/unique\s*\(\s*team_id\s*,\s*role\s*\)/i);
  expect(sql).toMatch(/unique\s*\(\s*team_id\s*,\s*actor_id\s*\)/i);
});
```

Extend `tests/caring-contacts-postgres-repository.test.ts` with the Group 2 behaviours, plus these two that only a real database can prove:

```ts
it("refuses a second restart approval from the same person at the database level", async () => {
  await store.stopService({ reason: "wrong-recipient", note: "n" }, writeContext(coordinator, "stop"));
  await store.approveServiceRestart({ role: "incidentLead" }, writeContext(soloActor, "approve-1"));
  await expect(
    store.approveServiceRestart({ role: "privacySecurityOwner" }, writeContext(soloActor, "approve-2")),
  ).resolves.toEqual({ ok: false, reason: "restart-approval-actor-already-recorded" });
});

it("refuses a plan whose pathway version does not exist, now that the foreign key is real", async () => {
  const result = await store.createPlan(
    { ...validPlanInput, pathwayVersionId: pathwayVersionId("MISSING") },
    writeContext(coordinator, "create"),
  );
  expect(result.ok).toBe(false);
});

it("keeps a cross-team actor from reading another team's assignment", async () => {
  await expect(store.getAssignment(planFromTeamA, { actor: teamBCoordinator })).resolves.toBeNull();
});
```

- [ ] **Step 2: Run and verify they fail**

Run: `npm run test:focused -- --files tests/caring-contacts-migrations.test.ts`
Expected: FAIL — the migration file does not exist.

Run: `npm run caring-contacts:db:test`
Expected: FAIL. This needs Docker and Postgres 17; it is local and offline and needs no provider approval.

- [ ] **Step 3: Write the migration and the Postgres implementation.** Reuse the existing transaction preamble unchanged (`begin` → `set_config('caring_contacts.team_id')` → `set_config('caring_contacts.audit_token')` → `set local role caring_contacts_app`). Map the two new unique-violation SQLSTATEs onto `restart-approval-role-already-recorded` and `restart-approval-actor-already-recorded` so TypeScript and the database give the same refusal string.

- [ ] **Step 4: Run and verify they pass**

Run: `npm run caring-contacts:db:test`
Expected: PASS. Paste the decisive `N passed` line — not the exit code.

- [ ] **Step 5: Prove the tests can fail — four mutations**

1. Drop the `UNIQUE (team_id, actor_id)` on `service_restart_approvals` → the single-person restart test goes red.
2. Drop the `plans.pathway_version_id` foreign key → the missing-pathway test goes red.
3. Remove the team-scope policy from `plan_assignments` → the cross-team assignment test goes red.
4. Remove the `require_audit` trigger from one new mutating table → the transactional-audit test goes red.

Revert each. Any mutation that leaves the suite green means that assertion is decorative.

- [ ] **Step 6: Commit**

```bash
git add caring-contacts/supabase/migrations/0003_caring_contacts_workspace.sql src/lib/caring-contacts/db/postgres-repository.ts tests/caring-contacts-postgres-repository.test.ts tests/caring-contacts-migrations.test.ts
git commit -m "feat(caring-contacts): workspace schema with database-enforced three-person restart and real pathway/referral keys"
```

---

### Checkpoint 2 — end of Group 2

```bash
npm run test
```

```bash
npm run caring-contacts:db:test
```

Paste both `N passed` lines. The rules layer is now complete and every §4.2 screen has a real data source.

---

## Group 3 — The data path

Everything here lives **outside** `src/lib/caring-contacts/` because it reads environment variables, touches cookies and speaks HTTP. The sealed directory stays sealed.

---
