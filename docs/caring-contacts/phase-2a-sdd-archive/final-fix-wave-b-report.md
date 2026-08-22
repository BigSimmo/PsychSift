# Final fix wave — half B: surface, schema and gate

Seven findings from the final whole-branch review. This half owns the API surface, the schema, and
the static gates. The sealed domain (`src/lib/caring-contacts/**`) and the two stores were fixed
concurrently by another agent and are **not** touched here — including for the two mutation proofs
below, which are run against copies for exactly that reason.

Six findings were fixed. **Finding 6 was deliberately not fixed**, and the reason is set out in full.

---

## 1. The service-state POST response is not narrowed; only GET is

**What was wrong.** `writeHandler` serialises whatever the write returns
(`src/lib/caring-contacts-server/handler.ts:310`). `approveServiceRestart` returns the still-stopped
`ServiceState` for the first and second approvals, and that record carries `note` — the responder's
free-text incident note, which the schema classifies as patient data. The route called it without
passing the result through `narrowServiceStateForActor`.

The two capability questions are genuinely different, which is what made this reachable in
principle. `writeHandler` checks the action against the **actor's own team**, correctly: a stop must
be raisable by anyone, and a restart is approved by three seats that need not sit in the reporting
team. `narrowServiceStateForActor` checks `viewPatientRecord` against **`state.reportedByTeamId`**,
also correctly: that is whose incident the note describes. A second team's `teamLead` therefore
legitimately passes the first and legitimately fails the second.

**TDD — the test was watched failing first.** New case in `tests/caring-contacts-api-handler.test.ts`,
`"narrows the note out of the POST reply too, not only the GET"`. Before the fix:

```
 FAIL  |node| tests/caring-contacts-api-handler.test.ts > service-state read narrowing (Ruling 43)
        > narrows the note out of the POST reply too, not only the GET
AssertionError: expected '{"value":{"stopped":true,"reportedByT…' not to match /Rowan|Mira/
+ "{\"value\":{\"stopped\":true,\"reportedByTeamId\":\"TEAM-NORTH\",…,
   \"note\":\"Rowan Mira Delacroix received the same message twice.\",…}}"
```

The note reached the wire verbatim. Note also that the two assertions _above_ it in the same test
(`status === 200`, and `toMatchObject({ value: { stopped: true, reason: "duplicate-send" } })`)
passed on the unfixed code, so the failing assertion is the one being proved and not an earlier trip.

**What I chose, and why.** The reply is **narrowed**, not emptied.

- Emptying it (`return { ok: true, value: null }`) would leave the approver unable to see what their
  own approval did — the stop still standing, and their approval now among `restartApprovals` — and
  would force the caller to re-read the state through GET, through the same narrowing, for the same
  answer. That is a worse API for no additional safety.
- Narrowing reuses the boundary that already exists and is already tested for this exact property,
  rather than inventing a second disposition of the same record.

Both writes now go through it, not only `approveRestart`: `stopService` returns the same
note-bearing record, and treating the two writes differently would be a rule someone has to
remember.

**Changed:** `src/app/api/caring-contacts/service-state/route.ts` — `POST` is now typed
`writeHandler<…, ServiceStateView>`, and its `write` maps a successful `TransitionResult` through
`narrowServiceStateForActor(result.value, actor)`.

**After:** `Tests 32 passed (32)` — `tests/caring-contacts-api-handler.test.ts`.

---

## 2. A non-dismissible overlay opens with focus outside its own dialog (WCAG 2.4.3)

**What was wrong.** `sheet.tsx:253-257` resolves initial focus as
`initialFocusRef ?? panel.querySelector('[data-sheet-autofocus="true"]') ?? closeRef`. A
`recovery-only` overlay is rendered with `title=""` (`overlay-host.tsx`), so the shared Sheet renders
no header, `closeRef` is null, nothing matches the autofocus selector, and focus lands on
`document.body` — on the one overlay a person cannot dismiss and must act on.

**The filed issue's premise was wrong.** It asserted `THIS IS A SHARED DESIGN-SYSTEM FIX, NOT A
WORKSPACE ONE` and proposed changing `sheet.tsx`'s controller to fall back to focusing the panel.
It does not need that: `sheet.tsx` already exposes `data-sheet-autofocus` for precisely this, and the
overlay only had to say which control is the target. **`sheet.tsx` is unchanged**, so there is no
blast radius across other Sheet consumers.

**TDD.** New case in `tests/caring-contacts-overlay-host.dom.test.tsx`,
`"puts opening focus on the recovery action of an overlay that cannot be dismissed"`. Before the fix
it timed out waiting for focus on `workspace-overlay-action` with the panel rendered and focus on
body:

```
 × puts opening focus on the recovery action of an overlay that cannot be dismissed
 ❯ tests/caring-contacts-overlay-host.dom.test.tsx:288  await waitFor(() => expect(action).toHaveFocus());
 Tests  1 failed | 13 skipped (14)
```

**Changed:** `src/components/caring-contacts/workspace/overlays/overlay-host.tsx` — `OverlayBody`
takes a new `autoFocusAction` prop and stamps `data-sheet-autofocus="true"` on the action control.
The host passes `autoFocusAction={modality !== "status-banner" && !dismissible}`: the status banner
is not a dialog and takes no focus by design (Rule 4), and a dismissible Sheet already has a close
control for the shared component's own fallback to find.

**After:** `Tests 14 passed (14)` — `tests/caring-contacts-overlay-host.dom.test.tsx`.

**The filed issue.** `docs/outstanding-issues-inbox/95eba5d7-…json` is an immutable request that had
not yet been reconciled into the canonical ledger, so there is no open row to close and
`npm run issues:done` correctly refuses it (`… is not in Open items`). The record is immutable and
must not be edited. I therefore queued the tooling's own correction path — an immutable cancellation
naming where the fix landed:

```
docs/outstanding-issues-inbox/0807d756-ecd5-4988-b4e3-9c5ec5e41ee3.json
```

Its reason states that the request's premise was wrong, names the file and attribute that fixed it,
names the pinning test, and records that `sheet.tsx` was not touched. Both records are preserved for
audit when `npm run issues:reconcile` next runs.

---

## 3. A real 500 is the one thing the session route never logs

**What was wrong.** `src/app/api/caring-contacts/session/route.ts` passed `{ log: false }` for the
whole `catch`. Right for the expected `PublicApiError` (an invalid demo role is a 400 and a client
mistake); wrong for any unexpected throw — `cookies()` rejecting, `cookieStore.set` failing — which
returns a genuine 500 with its log suppressed. The only real server fault this route can produce was
the one fault that never reached the logs.

**TDD.** Two new cases in `tests/caring-contacts-session.test.ts`, with `@/lib/logger` mocked. The
400 case (`does not log an error for a role the demo does not offer`) passed before the fix — it is
the control that proves the change does not start logging expected client errors. The 500 case
failed:

```
 × logs an error when the cookie write itself fails, because that one IS a server fault
AssertionError: expected "vi.fn()" to be called at least once
 ❯ tests/caring-contacts-session.test.ts:96  expect(logger.error).toHaveBeenCalled();
```

Note the status assertion on the line above (`expect(response.status).toBe(500)`) passed, so the test
reached the real 500 path rather than tripping earlier.

**Changed:** the `catch` now returns `jsonError(error, 500, { log: !(error instanceof PublicApiError) })`.

**After:** `Tests 7 passed (7)` — `tests/caring-contacts-session.test.ts`.

---

## 4. The audit trail was mutable and deletable by the application role

**What was wrong.** `0002_caring_contacts_rls.sql:36` grants `select, insert, update, delete` on all
tables to `caring_contacts_app`, and the driven policy loop gives `audit_events` a `for all` policy.
There was no immutability trigger on that table, and it is deliberately outside
`attach_audit_guard`, so deleting audit rows required no audit event of its own. `service_stops` got
a carefully argued immutability trigger; the audit table itself did not — even though
`audit-integrity-loss` is one of the five reasons that halts the entire service.

**New migration:** `caring-contacts/supabase/migrations/0004_caring_contacts_audit_immutability.sql`.

Two independent controls, answering two different questions:

1. **The trigger** — `audit_events_immutable`, `before update or delete … for each row`, calling
   `caring_contacts.assert_audit_event_immutable()`, which raises
   `caring-contacts-audit-immutable: …` for both operations. It stops the schema owner and a
   superuser too, neither of whom is stopped by a privilege or by row-level security.
2. **The grant** — `revoke update, delete on caring_contacts.audit_events from caring_contacts_app`.
   The application never holds the privilege to try, so its refusal is `permission denied`, before
   the trigger is reached.

**House style, and the one deliberate divergence.** `assert_service_stop_immutable` compares
`to_jsonb(new) - 'restarted_at'` against the same of `old` — an allowlist, so a column added later
defaults to frozen. An audit event has **no** mutable field at all, so the check here is
unconditional rather than a column comparison. That preserves the property the jsonb form was chosen
for (a column added later is frozen the moment it exists) without a comparison that would let a
no-op `set outcome = outcome` through. The function comment says, in terms, that if a mutable field
is ever genuinely needed it must be expressed as the same `to_jsonb(new) - '<column>'` allowlist and
never as a list of the frozen columns. `set search_path = ''` and the `pg_catalog`-implicit operators
follow `service_stops` exactly.

**Transactional safety.** One `begin;` … `commit;`. `create or replace function`, `drop trigger if
exists` + `create trigger`, and an idempotent `revoke` — nothing that cannot run inside the single
transaction the deployment applies each migration in, and no `CREATE INDEX CONCURRENTLY` (the
existing `uses no CREATE INDEX CONCURRENTLY` scan in the suite covers the new file automatically,
since it reads the whole migration directory). Replay-safe: the file sorts after `0002` and `0003`,
so a full replay re-applies the blanket grant and then re-narrows it, in that order, every time —
which the suite's own `replays without error` case exercises.

**Effect on test truncation — checked, and it is safe.** `truncateCaringContactsData` issues
`truncate table … restart identity cascade` as the migration superuser. TRUNCATE fires
statement-level truncate triggers only; it never fires a per-row DELETE trigger, so the new trigger
cannot strand it. `caring_contacts_app` is granted no TRUNCATE privilege by `0002` either, so the
only role that can empty the table is the migration owner — which is where emptying a disposable
test schema belongs. Nothing was weakened to accommodate this, and the migration blocks TRUNCATE
nowhere. This is asserted rather than reasoned about: see the fifth case below.

**TDD.** Five new cases in `tests/caring-contacts-migrations.test.ts`, under
`"the audit trail itself cannot be rewritten or deleted"`. Before the migration:

```
 × refuses an update even from the schema owner, who bypasses row-level security
 × refuses a delete even from the schema owner
 × leaves the application role no UPDATE or DELETE privilege to reach the trigger with
 × refuses the application role before the trigger is even reached
 Tests  4 failed | 1 passed | 60 skipped (65)
```

The delete case's failure message was `command: "DELETE", rowCount: 1` — the delete succeeded, which
is the defect stated as data. The one passing case is the truncation case, which is the
**constraint** rather than the fix and is expected to pass on both sides; it is the assertion that
would go red if a later change ever made the trail's clearing a per-row delete.

**After:** `Tests 65 passed (65)` — `tests/caring-contacts-migrations.test.ts`, and
`Test Files 2 passed (2) / Tests 174 passed (174)` for the whole `caring-contacts:db:test` project.

---

## 5. The accidental same-team serialisation is documented but unguarded

**What was wrong.** `ensureTeam`'s unconditional insert incidentally serialises two concurrent
same-team writers until the first commits, because it is the first statement of every write
transaction and both contend on the teams primary key. That is why the one race the suite proves is
only reachable cross-team. The source comment states the danger itself — moving or conditionalising
that insert "widens the concurrency surface of EVERY write in this store at once, silently and
without a failing test". A comment is not a guard.

**New file:** `tests/caring-contacts-write-serialisation.test.ts` — a source-text assertion, the same
instrument `tests/caring-contacts-explained-automation.dom.test.tsx` and
`tests/caring-contact-route-files.test.ts` already use. Test-only, so it blocks nothing: it cannot
stop the change being made, only stop it being made silently. Two assertions:

- `ensureTeam`'s body is exactly one statement, and that statement is the unconditional insert. A
  second line is where a `select`-then-`insert`, a process cache, or an early return would go.
- `ensureTeam` is the first non-blank statement inside `runWrite`'s `inTransaction` callback.

Both extractions fail **closed** — a renamed or restructured symbol reports the problem and names the
file, rather than quietly turning the assertion into a no-op.

**Mutation proof — run against copies, not the file.** `postgres-repository.ts` belongs to the other
agent and was under concurrent edit for the whole of this session (`git status` shows it modified by
them, and I never wrote to it). Mutating it in place, even for seconds, risks silently overwriting
their in-flight work. So the mutations were written to scratch copies and the guard was pointed at
each in turn by temporarily editing **my own** test file's `STORE` constant — the assertions
themselves ran unmodified.

Mutation A — make the insert conditional (`select 1 … if (existing.rowCount > 0) return;` first):

```
× keeps ensureTeam an unconditional insert, with no read, cache, or existence check first
AssertionError: expected [ …(3) ] to deeply equal [ Array(1) ]
```

Mutation B — move `ensureTeam` after the idempotency read:

```
× keeps ensureTeam the first statement inside runWrite's transaction
AssertionError: expected 'const existing = await connection.que…' to be 'await ensureTeam(connection, actor.te…'
```

Guard restored and re-run against the real file: `Tests 2 passed (2)`.

---

## 6. Nothing distinguishes "the gate ran and passed" from "the gate was never collected"

**No guard was added. This is the honest option, and it is the option the brief authorised.**

**Correction to the finding, as asked.** The suite is **not** unexecuted on this branch. It ran
repeatedly during this wave, most recently in full:

```
> node caring-contacts/run-db-tests.mjs
 Test Files  2 passed (2)
      Tests  174 passed (174)
```

What is missing is **automation**, not evidence.

**Why no contract test.** The brief allowed a guard only if a reference could honestly be wired in
the same change, and ruled out `it.fails` and skip-with-reason. There is no honest local wiring:

- `caring-contacts:db:test` → `caring-contacts/run-db-tests.mjs` **hard-fails** (exit 1, naming the
  variable) when `CARING_CONTACTS_DATABASE_URL` is unset. It never skips, deliberately.
- Every `verify:*` chain in `package.json` is expected to run offline, with no Postgres container.
  Adding this script to `verify:cheap`, `verify:pr-local`, or any other chain would turn every
  offline run of that chain red on a machine that simply has no container running. That is not a
  gate, it is a break.
- A new `verify:caring-contacts-db` alias would make the contract test pass while proving nothing at
  all — the alias would be reachable only by someone typing it, exactly as the script already is.
  That is a check that cannot fail, which is the failure mode this whole review exists to catch.

`grep -rn "caring" .github/` still returns nothing, and adding a workflow job is explicitly out of
scope for this wave. **Recommendation: file the CI work.** The shape it needs is a job that starts a
Postgres service container, sets `CARING_CONTACTS_DATABASE_URL`, and runs
`npm run caring-contacts:db:test` on changes under `caring-contacts/**`, `src/lib/caring-contacts/**`,
and the two database test files. Once that job exists, the static contract test asked for here
becomes both writable and honest, and should be added with it.

---

## 7. The domain-isolation guard was a denylist that could not see dynamic imports

**What was wrong.** `tests/caring-contacts-domain-isolation.test.ts` forbade six patterns —
`@/components`, `@/app`, `@/lib/`, `@supabase`, `openai`, `next`. So `twilio`, `redis` and `stripe`
all passed, and a messaging provider is exactly what a caring-contact domain reaches for first. Worse,
the specifier regex required whitespace after the keyword, so `await import("@supabase/supabase-js")`
and `require("openai")` were invisible to **both** tests in the file — including the one denylist entry
that would otherwise have caught it.

**Changed.**

- The denylist is gone. The first test now allows only `node:` and relative specifiers and reports
  everything else. Free rather than aspirational: there is currently not one non-relative specifier
  anywhere under `src/lib/caring-contacts/**`, not even a `node:` builtin.
  `tests/caring-contacts-message-policy.test.ts` already held one file to this shape; this holds the
  whole tree to it.
- `importSpecifiers` now recognises static imports plus `require(` and dynamic `import(` calls.
  It feeds both tests, so the
  relative-escape assertion gained the same reach.
- A third case tests the extractor directly against all five specifier forms, so a future narrowing
  of that regex goes red on the extractor rather than silently on the tree.

**Mutation proof — again against a copy**, for the same reason as finding 5: the sealed domain is the
other agent's and was under live edit. `src/lib/caring-contacts` was copied to scratch, three
provider imports were appended to one module, and the guard was pointed at the copy by temporarily
editing my own test file's `DOMAIN_ROOT`:

```
× imports nothing from outside its own directory
× never escapes its directory with a relative import
+   "…/domain-mutant/service-state.ts -> twilio",
+   "…/domain-mutant/service-state.ts -> redis",
+   "…/domain-mutant/service-state.ts -> @supabase/supabase-js",
 Tests  2 failed | 2 passed (4)
```

All three were caught. Under the old guard, `twilio` and `redis` would have passed outright, and
`@supabase/supabase-js` would have passed too because it arrived through a dynamic `import(`.

Guard restored and re-run against the real tree: `Tests 4 passed (4)`.

---

## Files changed

Source:

- `src/app/api/caring-contacts/service-state/route.ts` (finding 1)
- `src/app/api/caring-contacts/session/route.ts` (finding 3)
- `src/components/caring-contacts/workspace/overlays/overlay-host.tsx` (finding 2)

Schema:

- `caring-contacts/supabase/migrations/0004_caring_contacts_audit_immutability.sql` — new (finding 4)

Tests:

- `tests/caring-contacts-api-handler.test.ts` (finding 1)
- `tests/caring-contacts-overlay-host.dom.test.tsx` (finding 2)
- `tests/caring-contacts-session.test.ts` (finding 3)
- `tests/caring-contacts-migrations.test.ts` (finding 4)
- `tests/caring-contacts-write-serialisation.test.ts` — new (finding 5)
- `tests/caring-contacts-domain-isolation.test.ts` (finding 7)

Ledger:

- `docs/outstanding-issues-inbox/0807d756-ecd5-4988-b4e3-9c5ec5e41ee3.json` — new (finding 2)

Docs:

- this report

**No existing assertion was deleted or loosened.** Every change is additive, except the domain-isolation
denylist, which was replaced by a strictly stronger allowlist that admits nothing the denylist admitted.

---

## Stopped and reported

- **Finding 6** — no guard added; the CI work needs filing. Set out in full above.
- **`npm run lint` reports one warning that is not mine.**
  `src/lib/caring-contacts/in-memory-repository.ts:29:59 warning 'PlanState' is defined but never
used`. That file is the other agent's and was modified by them during this wave; the repo runs
  eslint with `--max-warnings 0`, so the lint gate is currently red on their in-flight edit, not on
  anything here. Left alone deliberately.
- **Both mutation proofs were run against copies rather than the real files**, because the two
  files that needed mutating (`postgres-repository.ts`, and the sealed domain tree) were under
  concurrent edit by the other agent. The guards themselves ran unmodified; only my own test file's
  path constant was temporarily repointed, and it was restored and re-run green afterwards. Neither
  owned file was ever written to.

## Gates run

| Gate                                            | Evidence                                                                       |
| ----------------------------------------------- | ------------------------------------------------------------------------------ |
| Affected offline suites (node + jsdom, 8 files) | `Test Files 8 passed (8)` / `Tests 91 passed (91)`                             |
| `npm run caring-contacts:db:test`               | `Test Files 2 passed (2)` / `Tests 174 passed (174)`                           |
| `npm run typecheck`                             | clean, no diagnostics                                                          |
| `npm run lint`                                  | `1 problem (0 errors, 1 warning)` — the other agent's unused import, see above |

Not run, and why: `verify:ui`, `verify:release`, `eval:*`, `check:supabase-project` and `test:live`
are forbidden for this wave. No browser gate was run — finding 2's change is a single data attribute
proven at the DOM level, and `verify:phone-chrome` / `verify:ui` are the caller's call at handoff.
