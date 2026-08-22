# Caring Contacts Phase 2A — session handoff

**Read this first.** It is the single entry point for continuing the Caring Contacts production build in a
new session, a new machine, or a new account. Everything below is either in this repository or named with
an exact path on the workstation.

Written at head `6322017ce` on branch `claude/suicide-contact-mockup-b5aaa0`. Nothing has been pushed; there
is no pull request; the branch exists only locally.

---

## 1. What this is

A suicide-prevention **caring contacts** workspace: patients discharged from hospital receive a fixed
schedule of brief, non-demanding messages. It lives inside the larger Clinical KB deployment but is a
**standalone application owning its own sidebar** — its destinations never go in the host app's navigation.

It is a **synthetic, non-clinical prototype**. No real patient data, no SMS provider, no message is ever
sent to any number real or test, and no migration ever runs against the Clinical KB Supabase project
`sjrfecxgysukkwxsowpy`.

Patient-visible copy is **PROVISIONAL and not clinically approved**. Lived-experience and clinical sign-off
are still required before any real use.

---

## 2. The three chat sessions this work came from

Claude Code stores full transcripts as JSONL on the workstation. They are **outside the repository** and are
not backed up by git — copy them if the machine or account is changing.

**Both bundles are already saved off-repository**, which on 2026-08-21 stopped being a precaution and
became the thing that saved the record:

| Bundle                                         | Covers                                                                                              |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `D:\Repos\caring-contacts-handoff-2026-08-20\` | Sessions 1 and 2 (Phase 1, early Phase 2A, the 2A controller)                                       |
| `D:\Repos\caring-contacts-handoff-2026-08-21\` | Session 3 — verification, the fix-round-2 review, Rulings 32-34, and the worktree loss and recovery |

Each has its own `README.md` index. **Caution:** the 2026-08-20 README names the worktree
`rag-readability-metric-split-7e8ac4` as the place to work. That worktree was destroyed on 2026-08-21
and no longer exists — the live worktree is `D:\Worktrees\Database\caring-contacts-phase-2a` (§4).

| Session                                                                                | Transcript                                                                                                                                                                                                                               |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 1 + early Phase 2A ("Suicide 1")                                                 | `C:\Users\joshs\.claude\projects\D--Repos-Database--claude-worktrees-rag-readability-metric-split-7e8ac4\cb52ea30-1a66-447e-a1e5-7ece8b217a2f.jsonl` (Aug 19 01:04) and `c762b098-99b3-4606-b457-64355e8be144.jsonl` (Aug 19 12:57)      |
| Phase 2A controller ("Suicide 2")                                                      | `C:\Users\joshs\.claude\projects\D--Repos-Database--claude-worktrees-caring-contacts-phase-2a-6c1ea2\8c22c6b7-984f-4804-842f-a4bc62b4adad.jsonl` (Aug 20 22:37)                                                                          |
| Subagent transcripts for that session — the implementer and reviewer reasoning in full | the `subagents/` directory beside it: `agent-a394147b89c86ab7c.jsonl` (Task 10 fix), `agent-a3a402e10992769c3.jsonl` (Task 11a + both fix rounds), `agent-ae2b3252297f75796.jsonl` (Task 11a review)                                     |
| Phase 2A recovery ("Suicide 3")                                                        | `C:\Users\joshs\.claude\projects\D--Repos-Database--claude-worktrees-caring-contacts-phase-2a-a4f69a\60a85c97-e1e3-45c8-ac9f-88251ff5bfe0.jsonl` (Aug 21), plus the fix-round-2 review subagent. Both copied into the 2026-08-21 bundle. |

**You should not need them.** Everything decision-bearing is in tracked files — see §3. They are listed so
the record is complete, and because the subagent transcripts hold the only verbatim copy of the three code
reviews.

---

## 3. Where the history lives now

**The problem this solves:** the build ran under the `superpowers` subagent-driven-development skill, whose
workspace is `.superpowers/sdd/2026-08-19-caring-contact-phase-2a-foundations/`. That directory carries its
own `.gitignore` containing `*`, so **every ledger, brief and report in it is invisible to git** and would be
destroyed by `git clean -fdx` or by deleting the worktree.

All of it has been copied into tracked files:

| Tracked file                                                                                                                                                                                                               | What it holds                                                                                                                                                                                                                                                                                       |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/caring-contacts/phase-2a-build-record.md`                                                                                                                                                                            | THE ledger (no longer a copy — the scratch original was destroyed on 2026-08-21), verbatim: the pre-flight conflict scan, all **34 rulings** with what each costs if wrong, every deferred finding, every review outcome, and the resume point. **This is the most important file in the handoff.** |
| `docs/caring-contacts/phase-2a-sdd-archive/`                                                                                                                                                                               | Every task brief and every implementer report, verbatim (22 files). `00-live-ledger-verbatim.md` is a STALE frozen snapshot of the ledger at 2026-08-20 and carries a warning header — never read it as current.                                                                                    |
| `docs/caring-contacts/PROGRESS-LEDGER.md`                                                                                                                                                                                  | **The master progress ledger** — every session, every task status, every decision and carried risk across Phase 1 and 2A, as an index pointing at the detail. Start here for the whole picture at a glance.                                                                                         |
| `scripts/rebuild-caring-contacts-sdd-workspace.mjs`                                                                                                                                                                        | Regenerates the git-ignored `.superpowers/sdd/` workspace from these tracked records, so it is disposable rather than precious. `--check` proves it is current.                                                                                                                                     |
| `docs/caring-contacts/phase-1-handoff.md`                                                                                                                                                                                  | The Phase 1 handoff, from the earlier session.                                                                                                                                                                                                                                                      |
| `docs/superpowers/plans/2026-08-19-caring-contact-phase-2a-foundations.md`                                                                                                                                                 | **The plan.** 19 tasks in 5 groups, plus the Global Constraints every task inherits.                                                                                                                                                                                                                |
| `docs/superpowers/specs/2026-08-19-caring-contact-production-build-design.md`                                                                                                                                              | **The spec.** The binding authority the plan argues from; conflicts resolve against it.                                                                                                                                                                                                             |
| `docs/caring-contacts/interaction-matrix.md`                                                                                                                                                                               | The frozen 24-row overlay modality and dismissal table (Tasks 17–18).                                                                                                                                                                                                                               |
| `docs/caring-contacts/clinical-language-trace.md`, `accessibility-acceptance.md`, `verification-report.md`, `linked-prototype-handoff.md`, `visual-reference-manifest.md`, `screenshot-atlas-manifest.json`, `atlas/*.png` | Phase 1 design artefacts: the frozen screen atlas and the language, accessibility and verification records.                                                                                                                                                                                         |

The `review-*.diff` files in the scratch directory were **not** archived — they are plain `git diff` output
over commits already in history and are regenerable with
`bash <superpowers-skill>/scripts/review-package <plan> <base> <head>`.

**The scratch ledger is gone, and the tracked build record IS the ledger now.** The original
`.superpowers/sdd/` workspace lived in the worktree destroyed on 2026-08-21 and was lost with it —
precisely the risk this section was written to warn about. Only the tracked copy survived.

So the rule has changed, and it is now simpler: **append rulings, findings, review outcomes and resume
points directly to `docs/caring-contacts/phase-2a-build-record.md`.** Do not start a second ledger in
scratch; keeping two in step is the drift risk that a data loss has already removed.

The `.superpowers/sdd/2026-08-19-caring-contact-phase-2a-foundations/` workspace has been **recreated**
in the live worktree so the subagent-driven-development skill finds what it expects. It holds the 21
task briefs and reports restored from the tracked archive, plus a `progress.md` that is only a pointer
back to the build record. Nothing in it is unique, and it is still git-ignored (`.superpowers/.gitignore`
contains `*`), so it remains disposable by design.

---

## 4. Exactly where the work stopped

**Branch:** `claude/suicide-contact-mockup-b5aaa0` — **PUSHED to origin.** GitHub holds it; that is the
source of truth, not any directory on this workstation.

**Working copy:** make your own. Do not assume one exists:

```
cd D:\Repos\Database
git fetch origin
git worktree add D:\Worktrees\Database\<a-fresh-name> claude/suicide-contact-mockup-b5aaa0
```

**Working directories on this machine do not survive.** On 2026-08-21 four were destroyed by another
process — under `.claude\worktrees\` **and** under `D:\Worktrees\`, one of them holding this exact work,
and one through an explicit `git worktree lock`. **Relocating is not protection.** The `.git` pointer file
goes first, so git silently resolves to the main checkout on the wrong branch; the tracked files follow.
No warning, and the cause is not identified. Commit often, **push after every task**, and keep anything
needed to resume in a **tracked** file — git-ignored scratch dies with the directory. This branch survived
a destruction today only because it had been pushed.

**Head at last push:** `32bfbdae5`. Nothing merged, no pull request.

### Done and reviewed clean

- **Tasks 1–9** — the sealed domain rules layer. Checkpoint 1 passed: 7604 tests, typecheck and lint green.
- **Task 10** — the storage contract and in-memory store (~21 new methods). Reviewed, one fix round, all
  seven findings verdicted addressed. 101 tests.
- **Task 11a** — migration `0003_caring_contacts_workspace.sql`. Reviewed and **approved**, then **three**
  fix rounds: round 1 (Rulings 27–29), round 2 (Rulings 30–31), round 3 (Rulings 32–34). **96 database
  tests**, and the three newest are proven falsifiable by deliberate mutation, not merely green.

### Nothing is in flight — Task 11a is closed

The previously-unverified commit `6afce3893` has been **fully verified** (`Tests 93 passed (93)`, both
Ruling 30/31 mutations reddening only their intended tests), then re-reviewed. That review returned
**CHANGES REQUIRED** with three Important findings, all real and all now fixed as Rulings 32–34:

- **Ruling 32** — `restarted_at` was the one column the immutability trigger did not name, so a closed
  incident could be silently reopened by clearing it, or made to report a shorter outage by backdating it.
  It is now **write-once**: null → a value stays allowed, and every later change raises.
- **Ruling 33** — the guard was a blocklist of six named columns, which defaulted any column added later
  to mutable. It is now an **allowlist** (`to_jsonb(new) - 'restarted_at'`), paired with a data-driven test
  that reads the real column list at runtime so a future column is covered the moment it exists.
- **Ruling 34** — DELETE is deliberately **not** blocked. Closing it would have shut the last removal path
  for `service_stops.note`, which the schema marks as patient data. See §6 for the owner's decision.

Before starting Task 11b, confirm the branch is healthy:

```
docker run -d --name caring-contacts-pg -e POSTGRES_PASSWORD=caring-contacts-local -p 54329:5432 --restart unless-stopped postgres:17
CARING_CONTACTS_DATABASE_URL=postgres://postgres:caring-contacts-local@127.0.0.1:54329/postgres npm run caring-contacts:db:test
```

Expect `Tests 96 passed (96)`. **Never report a run from its exit code.** If the output carries no
`Test Files` summary line the run did not happen — the cross-worktree lock coordinator throws `EPERM` on
`owner.json` / `gate.lock` under concurrency, which is an _acquisition_ failure, not a result. Retry it.

### Known-red, and deliberately so

- **`npm run typecheck` is RED** on `src/lib/caring-contacts/db/postgres-repository.ts`, which does not
  implement the ~21 methods Task 10 added to the interface. **Task 11b is what fixes it.** Do not narrow the
  interface and do not stub the methods — a stub that satisfies the compiler while failing at runtime turns a
  visible failure into a hidden one.
- **`npm run test` has exactly one failure**, in `tests/caring-contacts-retention.test.ts`. Verified by
  counting matches per commit: it entered with Task 10's commit `6bf9f6362`. It is not a real leak — the
  hard-coded-period half of the check still passes; only the word-mention half trips, on the plan-mandated
  `markRetentionCleared`. **Ruling 26** specifies the fix and it is written into the Task 11b brief.

### Remaining work

**Task 11b** (brief: `phase-2a-sdd-archive/task-11b-brief.md`) — move the new methods' behavioural tests into
the shared contract so both stores are held to them, then implement the ~21 Postgres methods. This restores
typecheck. Then Checkpoint 2.

Then **Tasks 12–19**: database configuration that cannot point at the Clinical KB project (12); the demo role
switcher (13); route handlers that audit every view (14); the route group, four width states and inbound link
(15); the service-state banner (16); the frozen 24-row overlay table (17); one renderer for all 24 overlays
(18); browser proof at six widths (19). Then the final whole-branch review.

Phase 2A is **foundations**. The working clinician-facing screens are Phase 2B, a separate plan.

---

## 5. Rules that will fail the build if you miss them

These are the ones most easily violated by accident. The full set is the plan's **Global Constraints**
section — read it before writing anything.

- **Migrations live only in `caring-contacts/supabase/migrations/`**, never `supabase/migrations/`. Nothing
  targets the hosted Supabase project.
- **No existing assertion may be deleted or loosened to accommodate a change.** If a test goes red, that is a
  defect in the change, not the test. Exactly one test is knowingly rescoped in this plan, at Task 15, and it
  is replaced with a strictly stronger assertion.
- **Test-first, then prove the test can fail.** After each task, deliberately break the implementation and
  confirm the covering test reddens — **and check first that the mutation actually changes a value some
  assertion reads.** Three proposed proofs on this branch turned out to prove something other than what they
  claimed, and two tests were found that could not fail at all. This discipline is the reason they were caught.
- **Never report a gate as passing from an exit code alone.** Paste the decisive `N passed` line. Piping
  through `tail` has already masked a real result once here.
- **Run the full `npm run test`**, not just focused files, before declaring complete any task that adds or
  renames an exported symbol inside `src/lib/caring-contacts/` — that directory is policed by static scans
  living in files no such diff will contain. This is how the retention failure survived two tasks.
- **Domain isolation:** nothing under `src/lib/caring-contacts/` may import from `@/components`, `@/app`, any
  `@/lib` module outside itself, Supabase, or OpenAI.
- **Prohibited vocabulary** in any string: `high risk`, `safe`, `engagement score`, `campaign`, `lead`,
  `conversion`, `best match`, `inbox`, `conversation`, `clinical risk`, `risk score`, `wellbeing score`, and
  any claim that replies are monitored. Transport words (`Delivered`, `Not delivered`, …) are never patient-state labels.
- **Do not push, do not open a pull request**, and do not run `verify:release` or any provider-backed gate
  (`eval:*`, `check:supabase-project`, `test:live`) without asking the owner first.
- Tap targets are `min-h-12` (48px). Do **not** "fix" them to `min-h-11` for a generic accessibility rule —
  that reintroduces a known `ui-smoke` flake.

---

## 6. The decisions taken on the owner's behalf

There are **34 numbered rulings**, each recorded with its reasoning and **what it costs if wrong**, in
`docs/caring-contacts/phase-2a-build-record.md`. Do not re-litigate them; do read them, because several bind
tasks that have not been written yet.

The ones that shape the remaining work:

- **Ruling 9 / 19 / 20** — the service safety stop is a schema-enforced **singleton**, read by every dispatch
  path regardless of team, with a row-level-security policy scoped to "this session named some team" rather
  than to a specific team. A team-scoped policy on a service-wide stop _is_ the leak: every other team would
  read zero rows and conclude the service is running during a live incident.
- **Ruling 4 / 28** — restart approvals are keyed to the **incident**, never the team, and incidents are
  immutable rows in a `service_stops` history table. This is what stops one incident's three approvals being
  counted toward the next one — a zero-approval restart.
- **Ruling 25 / 27** — plan → referral, plan → pathway version, and both assignment tables use **composite
  same-team foreign keys**. Foreign-key checks bypass row-level security, so a bare key silently permits
  cross-team links. This caught a real defect already sitting in a test fixture.
- **Ruling 23 / 24** — Task 11 is split, and the new methods' behavioural tests move into the **shared
  contract** both stores run, so the database implementation cannot be built against no proof.
- **Ruling 13** — the workspace's client code sits behind a lazy route boundary from its first commit, so the
  Clinical KB dashboard never downloads it (Task 15).
- **Ruling 26** — the retention scan fix described in §4.

**Owner clarification, binding on Task 15 and all of Plan 2B:** Caring Contacts is a standalone application
owning its own sidebar. Every one of its headings and destinations goes in **its** rail, never the host app's
navigation. The tools-catalogue entry is only the front door.

---

## 7. Deferred findings the final review must triage

Recorded in full in the build record. The one worth naming here, because it is clinical content:

- **`savePathwayVersion` stores the authored message `snapshot` by reference.** A caller retaining the input
  object could still mutate stored clinical message content in place, with no version bump and no audit
  event. Pre-existing, not reachable from any screen that exists, and the Postgres store will not inherit it
  (jsonb serialisation copies) — so after Task 11b the two stores will differ here. Flagged as the
  highest-value deferred item.

---

## 8. Starting a new session

```
cd D:\Worktrees\Database\caring-contacts-phase-2a
git log --oneline -5
git status
```

Then, in order:

1. Read `docs/caring-contacts/phase-2a-build-record.md` — the ledger, and specifically its final **RESUME
   POINT** section, which supersedes everything above it.
2. Read the plan and the spec (§3).
3. Read `node_modules/next/dist/docs/` before any route or layout code. This repo runs **Next.js 16**, which
   has breaking changes against most training data. Reading beats reasoning; more thinking does not repair a
   wrong prior.
4. Deal with the unverified `6afce3893` first (§4).
5. Continue with Task 11b.

The build ran with the `superpowers` **subagent-driven-development** skill: a fresh implementer subagent per
task, a task review after each, and a whole-branch review at the end. To continue that way, invoke
`superpowers:subagent-driven-development`; the ledger, briefs and reports are already in the shape it
expects.

**Model guidance the owner set:** Sonnet 5 at medium-high for ordinary tasks; **Opus 5 at high** for
migrations and row-level security, Tasks 17–18 (the 24-overlay modality contract), anything displaying
delivery or clinical state, and the final whole-branch review.
