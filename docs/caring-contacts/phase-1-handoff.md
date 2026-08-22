# Caring Contacts Phase 1 — handoff

**Status:** Phase 1 complete and verified, 19 August 2026. Not pushed. Branch
`claude/suicide-contact-mockup-b5aaa0`, 18 commits ahead of `main`.

**Why this file exists.** The build ran through a session ledger under `.superpowers/`, which is
git-ignored scratch. Every decision taken on the owner's behalf lived only there and in one long
conversation. Both are losable. This is the tracked record.

**Read next:** the binding specification,
[2026-08-19-caring-contact-production-build-design.md](../superpowers/specs/2026-08-19-caring-contact-production-build-design.md),
and the Phase 1 plan,
[2026-08-19-caring-contact-domain-and-datastore.md](../superpowers/plans/2026-08-19-caring-contact-domain-and-datastore.md).

## Three phases

| Phase | Deliverable                                                                                   | State                           |
| ----- | --------------------------------------------------------------------------------------------- | ------------------------------- |
| 1     | The rules and the database                                                                    | **Complete**                    |
| 2     | The working screens                                                                           | Not started; needs its own plan |
| 3     | Make it demonstrable — demo clock, synthetic caseload, training mode, clinical-record summary | Not started                     |

Out of scope throughout: any message actually sent to any number real or test, any SMS provider,
hosting changes, hospital system connections, enterprise sign-on, real patients, and any migration
against the Clinical KB Supabase project.

## What Phase 1 built

`src/lib/caring-contacts/` — sealed: it imports nothing from outside itself, enforced by
`tests/caring-contacts-domain-isolation.test.ts`, so the directory can be lifted into its own
deployment unchanged.

`clock.ts` `ids.ts` `model.ts` `schedule.ts` `hospital-events.ts` `permissions.ts` `message-policy.ts`
`message-rules.ts` `audit.ts` `retention.ts` `episode.ts` `service-rules.ts` `repository.ts`
`in-memory-repository.ts` `simulation.ts` `db/postgres-repository.ts`, plus migrations under
`caring-contacts/supabase/migrations/`.

**Verification at the phase gate, each with a real exit code:** full offline suite 7,531 tests across
682 files; `tsc` silent; lint zero warnings; Prettier clean; `caring-contacts:db:test` 55 passed against
Postgres 17 in a disposable container.

## Decisions taken on the owner's behalf

Each is reversible. The cost column is what it costs if the decision was wrong.

| #   | Decision                                                                                                                  | Why                                                                                                                                                          | Cost if wrong                                                 |
| --- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| 1   | Week 1 is **suppressed** when the coordinator sets the first contact to discharge + 7, giving nine contacts               | Two caring contacts to one person on one day is worse than nine contacts                                                                                     | Reversible in `schedule.ts` and its tests alone               |
| 2   | `cancel` is permitted from any non-terminal plan state                                                                    | Cancellation is the safe direction; refusing it would leave a plan sending during an incident                                                                | Wider than strictly needed; no patient-facing effect          |
| 3   | `triggerServiceSafetyStop` is granted to **every** role, auditor included                                                 | Stopping the service must never be blocked by a permission check                                                                                             | A non-clinician can halt the service                          |
| 4   | `deathCorrection` is the one event accepted on a cancelled plan, returning the plan **deeply unchanged** plus an incident | Death cancels irreversibly, so a correction would otherwise vanish silently. The unchanged plan is asserted by test, so it cannot become a resurrection path | A service wanting a separate entry point would need one added |
| 5   | Death and death-correction accept **either** `recordHospitalStatusEvent` **or** `triggerServiceSafetyStop`                | Requiring only the new action means a permission misconfiguration could refuse a death recording and leave the plan sending                                  | Slightly wider grant on the most consequential event          |
| 6   | `duplicate-active-plan` is enforced **across teams**, not within a team                                                   | Two teams enrolling one patient means two sets of messages. Moot in a single-team pilot                                                                      | A second team can infer a plan exists elsewhere               |
| 7   | `deidentifyAuditEvent` returns a distinct `DeidentifiedAuditEvent` type                                                   | Makes it a compile error to hand a stripped record to something expecting a full one                                                                         | Type name differs from the spec's shorthand                   |
| 8   | Episode shape types live in `episode.ts`, re-exported by `retention.ts`                                                   | Task 8's own guard forbade importing `Episode` from `retention`; moving the shape beat weakening a committed test                                            | None identified                                               |
| 9   | `markMissed` accepts `processing` as well as `scheduled`                                                                  | A provider timeout leaves a contact processing, and it must be able to become missed rather than stranded                                                    | None identified                                               |
| 10  | Retry policy (2 retries, 3 attempts, 45 minutes apart) has a governed home in `service-rules.ts`                          | The decision lock states it as a service rule, not a caller's choice                                                                                         | Values are defaults and remain overridable                    |
| 11  | Task review runs at the **phase boundary**, not after every task                                                          | The owner asked for efficiency and two checkpoints, not eleven; every task is test-first and mutation-checked                                                | A defect survives further into a phase before review          |
| 12  | Tasks 7 and 8 batched into one dispatch, separate commits                                                                 | Small coupled pure modules; splitting made one agent rebuild the other's context                                                                             | One review surface covers two modules                         |
| 13  | Postgres runs in a local Docker container; `pg` added as a **devDependency only**                                         | Row-level security cannot be proven without a real database                                                                                                  | One devDependency in the lockfile; reversible                 |

## Deliberate sabotage, and what it caught

Passing tests were not taken as proof. At each step the implementation was deliberately broken and the
suite confirmed to go red:

- Death cut-off removed → a contact dispatched **after the recorded death**.
- Suppression filter removed → **ten dispatches across nine days**: two caring contacts to one person in
  one day.
- Retry cap removed → a fourth attempt occurred.
- Duplicate guard removed → a `notDelivered` contact was re-sent.
- RLS team predicate removed → a cross-team select returned another team's plan.
- Unique partial index relaxed → a duplicate active plan was accepted.
- Audit trigger disarmed → a direct update bypassed the audit path.

**Two tests were found unable to fail and were rewritten**: the in-memory concurrency test (its two
"simultaneous" calls never interleaved) and the first suppression test (it passed with the filter
removed). A third, `tests/test-runner-safety.test.ts`, was rewritten from a source-text match to a
behavioural assertion and independently re-verified by mutating `vitest.config.mts`.

## Open items for Phase 2

1. **Reads are not audited.** The decision lock requires every patient view in the trail; only writes are
   recorded. Views happen at the API and screen layer, so this closes in Phase 2. It is an unmet
   requirement, not a defect.
2. **`referrals` and `pathway_versions` are declared but never written** — the storage contract has no
   referral creation — so `plans.referral_id` is a plain column rather than a foreign key.
3. **`service_state` and `retention_state` are schema only**, with no behaviour yet.
4. **Idempotency has no lock** against a genuinely concurrent replay of the same key.
5. **The in-memory concurrency test is load-bearing only while its audit-sink `await` stays.** Removing
   that `await` silently disarms it rather than breaking it. A structural guard would be better than a
   comment.
6. **A suppressed contact still carries a real `sendAt`.** `sendableContacts()` is the safe accessor.
   Anything deciding what to send must key off `suppressed`. Making `sendAt` structurally absent when
   suppressed would remove the trap, but requires editing three committed tests.

## Open decisions for the owner

- **Patient-visible reply wording.** A provisional correction is in code: the notice reads "No one reads
  replies to this number", and `AUTOMATED_REPLY_RESPONSE` carries the message a person receives when they
  text back. Both are pinned by test at 252 and 218 GSM-7 septets, two segments each. The words need
  confirming or replacing.
- **Retention period.** Seven years is the working assumption the schema is built around. It is a
  configured value, not a constant.
- **Decision 6 above** — cross-team duplicate prevention versus the inference it permits.

## Recovering the removed governance material

Six documents — hazard log, evidence brief, referral feasibility, outreach drafts, message review pack
and demonstration script — were removed from the working tree because they are governance and sponsor
material, not building material. They are intact in history:

```bash
git checkout 32d408c2f -- docs/caring-contacts/
```
