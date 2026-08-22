# Care Plan — session handoff, 21 August 2026

Written at the end of the controlling Claude session that designed Care Plan and
built Tasks 1 and 2. Read this, then `sdd-ledger.md`, then start.

---

## Where things stand in one paragraph

Care Plan is a synthetic, memory-only, reset-on-refresh clinical prototype under
`/mockups/care-plan`, built inside the psychiatry.tools repository and reachable on
the live site for a signed-in administrator. It lets a clinician look up the
approved management plan for someone who presents repeatedly to an emergency
department in psychiatric crisis. The design is complete and user-approved. Of
eleven build tasks, **Tasks 1 and 2 are complete, independently reviewed, and
committed**; Task 3 has not started. The branch is pushed to
`origin/claude/ed-care-plans-impl-7f44cd`, which is the authoritative copy.

---

## What exists and is verified

| Layer              | Files                                                                                     | State              |
| ------------------ | ----------------------------------------------------------------------------------------- | ------------------ |
| Domain types       | `src/components/care-plan/mockups/types.ts` (589 lines)                                   | Complete, reviewed |
| Synthetic fixtures | `src/components/care-plan/mockups/fixtures.ts` (1,420 lines)                              | Complete, reviewed |
| Pure selectors     | `src/components/care-plan/mockups/domain.ts` (397 lines)                                  | Complete, reviewed |
| Lifecycle reducer  | `src/components/care-plan/mockups/prototype-state.ts` (1,458 lines)                       | Complete, reviewed |
| React provider     | `src/components/care-plan/mockups/prototype-provider.tsx` (40 lines)                      | Complete, reviewed |
| Tests              | `tests/care-plan-domain.test.ts` (913), `tests/care-plan-prototype-state.test.ts` (1,240) | 121 passing        |

**Evidence at last run:** 121/121 tests passing across both files, `npm run typecheck`
exit 0 with zero diagnostics, `npm run lint` exit 0, Prettier clean. Thirty-two
deliberate mutations each produced a red suite, proving no refusal guard passes
vacuously. Two independent reviewers (fresh agents, spec + quality) signed off each
task after a fix loop.

**Not yet run for this feature, and must not be claimed:** any browser or Playwright
journey, any accessibility or responsive check, any print check, any build, any
provider-backed gate. There is no UI yet.

**Integrity confirmed after the third worktree destruction:** `git ls-files --eol`
reports `i/lf w/lf` on every Care Plan file, matching untouched repository files, and
the committed blobs contain zero CR bytes. Nothing is corrupted. Re-running the suites
in the relocated worktree gave `Test Files 2 passed (2) / Tests 121 passed (121)`.

**Environment state in the relocated worktree — resolved, with one caveat.** The
`npm ci --include=dev` there has since completed (exit 0) and Prettier now runs. While it
was still in flight, `npm run typecheck` failed on three unrelated pre-existing files —
`tests/universal-search.test.ts` (TS7006) and two `use-in-page-section-nav*` DOM tests
(TS7016, unable to resolve `lucide-react` types) — with **zero errors in any
`src/components/care-plan/**` or `tests/care-plan-*` file`. Typecheck exited 0 in the
previous worktree at the same commit, so that was an install artefact rather than a
regression. **Re-confirm typecheck yourself before reporting any gate as green**; it has
not been re-run since the install finished.

One standing caveat: this machine runs several AI sessions concurrently and the
repository has a cross-worktree run coordinator. A gate can be refused with
`DATABASE_HEAVY_RUN_ADMISSION_BUSY` because another worktree holds the lease — that is an
_acquisition_ failure, not a test result. Any run whose output lacks a `Test Files`
summary line must be retried, never reported.

---

## The environment problem — read this before you do anything

The original worktree at `D:\Repos\Database\.claude\worktrees\ed-care-plans-impl-7f44cd`
was **destroyed three times on 21 August 2026**. The third destruction happened
through an explicit `git worktree lock`, while a task was running: the `.git` pointer
file went first, making git resolve to the main checkout on the wrong branch, then
3,836 tracked files were deleted over three minutes.

- **Relocation did NOT protect it.** The work was moved to `D:\Worktrees\Database\care-plan`
  on the reasoning that that parent had been untouched all day — and it was destroyed
  there too, within the hour, the same way: `.git` pointer first, then 1,301 files. **No
  directory on this machine is safe.** The only thing that has ever protected this work is
  committing and pushing.
- **The branch is pushed** to `origin/claude/ed-care-plans-impl-7f44cd`. If a worktree dies
  again, recover with `git worktree add <path> claude/ed-care-plans-impl-7f44cd` — or clone
  fresh from GitHub, which is now the authoritative copy.
- **Nothing committed was ever lost.** Every recovery was one `git worktree add`.
- **What died each time was uncommitted work and git-ignored scratch** — including,
  the third time, the entire SDD workspace with its ledger, briefs, reports and
  review packages. That is why the ledger is now a tracked file.
- **Commit at the end of every task.** That single habit is why three destructions
  cost nothing but time.

**Cause — identified, and already fixed on `main`.** The worktree was running an
old `scripts/guard-push.mjs`. That version linked a _borrowed_ worktree's real
`node_modules` into a scratch checkout as a Windows junction, then force-deleted the
scratch checkout recursively — which a `git worktree lock` cannot stop, because it is a
filesystem delete rather than a git worktree operation. Any concurrent session pushing
from a stale base ran it against whichever worktree it had borrowed from.

This is **already fixed upstream** by two commits this branch does not yet contain:

- `a04330ea0` — harden(guard-push): never force-delete a scratch checkout that still
  holds a borrowed `node_modules` link (#2244)
- `cdfcbaccd` — fix(worktrees): stop silent worktree wipes and misdirected commands (#2240)

**This branch is 122 commits behind `origin/main` and has neither.** That is the whole
explanation: the tooling in this worktree, and in the other stale worktrees running
alongside it, predated its own fix. `scripts/clean-worktree.mjs` was investigated and
cleared — it contains no filesystem deletion at all.

**The remedy is to merge `origin/main` into this branch before doing anything else.**
Until then this worktree runs the vulnerable guard, and so does every other session on a
stale base.

Worth investigating separately: there were 82 registered worktrees on this
repository. That is itself worth a clean-up, carefully, once this build is done.

---

## The product, and the decisions behind it

Thirteen decisions were taken with the user across a brainstorming pass and a
grilling round. They are binding and must not be reopened.

**Purpose and shape**

1. Build the synthetic prototype now, but keep the domain shaped so real persistence
   could be added later without a redesign — pure reducer, plain serialisable state,
   caller-allocated IDs, one dispatch path. **No storage layer is built now.**
2. The full multi-service workflow, including named senior-clinician approval.
3. Deliver Tasks 1–5 (Stage A), **stop for user review**, then Tasks 6–11.
4. Local commits authorised, and the branch has since been pushed with the user's
   explicit agreement after being told the repository is public. Still **not**
   authorised: PR, merge, rebase, deployment, or provider access.

**Clinical content**

5. The Management Plan is **eleven fields in two tiers**, not the nineteen originally
   drafted. Four pairs were saying the same thing twice, and the two safety-critical
   sections were below the fold. The first-minute summary is exactly five: how to
   approach this person, what helps, what makes it worse, what we have agreed to do,
   and what would make this presentation different.
6. **Reading is the primary use.** The user's words: "the plan is for clinicians to
   look up and see the management plan; it is rarely for changing or updating." Where
   reading and authoring compete for space, navigation depth, attention or effort,
   reading wins — including in build order, which is why Stage A ends with the whole
   reading experience and no authoring surface at all.
7. An ED Presentation requires only about thirty seconds: site, disposition, whether
   the plan was available, used and helpful, and one required line — "in one line: why
   they came and what happened". Everything richer sits behind a disclosure.
8. The review clock is 12 months, editable per version, amber at 28 days.
9. Identification Reviews close with a recorded decision — proceed to a plan, not
   needed at this stage, or revisit later — plus a reason. Previously they could be
   opened but never closed.
10. `agreedEdApproach` names who agreed the position and when, reads as an agreed
    default rather than a ceiling on care, and never uses a prohibitive construction.
    `BANNED_ADMISSION_CONSTRUCTIONS` enforces this.
11. `whatMakesItWorse` describes **what the service does** — corridors, repeated
    history-taking, security presence, unexplained waits — never what the person does
    wrong.
12. Sort-by-presentation-count exists **only** inside the Identification Review
    workflow, where finding frequent attenders is the stated purpose. Nowhere else.
13. There is a **Patient Plan** (Task 9): a patient-facing edition produced by a
    deterministic, offline, rule-based transformation of an approved Management Plan
    Version. It maps eleven known fields to eight patient-voice headings through a
    curated dictionary, **emits a visible gap wherever it cannot convert confidently
    rather than guessing**, and **never auto-converts the agreed-ED-approach section**
    under any circumstances. A clinician — any clinical role, not only a senior one —
    must fill the gaps and approve before the patient receives it, and cannot approve
    with a gap open. No language model, network call, or provider is involved.

---

## What to do next

Task 3: the gated route family, literal navigation, and the responsive Clinical
Snapshot shell. Twenty-one routes, all rendering a semantic `RoutePurposeSurface`
placeholder that Tasks 4–10 replace one route at a time. It is structural, not
product screens.

Two inputs Task 3's brief does not carry:

- **Mount a React error boundary inside the gate.** `assertSingleCurrentVersion`
  throws from inside the reducer, deliberately, because a plan with two Current
  versions is an invariant violation that must not render. From Task 3 onward that
  would crash the tree with no boundary.
- **Do not re-add the online/offline listener** (Ruling 20). It was removed with the
  reasoning recorded in `prototype-provider.tsx`.

---

## The prompt to start the next session

```text
Resume the Care Plan build in D:\Worktrees\Database\care-plan on branch
claude/ed-care-plans-impl-7f44cd. Do not create or use any worktree under
D:\Repos\Database\.claude\worktrees\ — that location destroyed this work three
times on 21 August 2026, once through an explicit git worktree lock.

Read in this order:
1. docs/care-plan/session-handoff-2026-08-21.md — where things stand, the thirteen
   binding product decisions, and the environment hazard.
2. docs/care-plan/sdd-ledger.md — progress, all 25 controller rulings with what each
   costs if wrong, the deferred minors, and four systemic lessons.
3. docs/superpowers/specs/2026-08-20-care-plan-design.md — binding product authority.
4. docs/care-plan-context.md — binding glossary; its preferred terms are required and
   its _Avoid_ terms are banned.
5. The Global Constraints and Delivery Stages sections of
   docs/superpowers/plans/2026-08-20-care-plan-implementation.md. Do not read the
   whole plan.

Tasks 1 and 2 are complete, reviewed and committed: 121 tests passing, typecheck and
lint clean. Task 3 has not started and no partial work exists.

Execute with superpowers:subagent-driven-development, resuming at Task 3. One
implementer at a time, a fresh reviewer after each task, a fix loop, and a commit at
the end of every task without exception — that habit is the only reason three worktree
destructions cost nothing. Keep the ledger updated at docs/care-plan/sdd-ledger.md
(tracked deliberately; the git-ignored SDD workspace was destroyed).

Stop at the Stage A checkpoint after Task 5 and report to me. Do not start Task 6 on
your own judgment.

Before Task 3, confirm: git status clean, branch and HEAD as above, dependencies
installed, and npm run test -- tests/care-plan-domain.test.ts
tests/care-plan-prototype-state.test.ts still green. Paste the decisive output — an
exit code alone is not evidence in this repo.

Carry these into every dispatch: write source with editor tools rather than Python or
shell heredocs and scan touched files for CR and control bytes (three files were
corrupted that way); any test that rejects something needs a positive control proving
it rejects a known-bad input, proved by making the code wrongly permit it and watching
the test go red; and count test totals from the run output rather than from memory.

The application stays synthetic, memory-only and provider-free. Local commits are
authorised. Nothing else is — no push, PR, merge, rebase, deployment, migration, or
provider access. Ask before any of those.
```

---

## Authorisation boundary

Authorised: local implementation and offline verification in
`D:\Worktrees\Database\care-plan`; local commits on
`claude/ed-care-plans-impl-7f44cd`; `npm run ensure` for a local dev server.

**Not authorised:** push, pull, merge, rebase, PR, branch deletion, deployment,
migration, hosted CI, live Supabase or OpenAI, `verify:release`, `check:supabase-project`,
any `eval:*`, or any other provider-backed command. Ask first.

---

## Honest limits

This is a clinical reference prototype, not validated clinical decision support and
not a clinical tool. It holds no real patient information and cannot; state resets on
refresh. Passing every local test and rendering every screen would still not make it
suitable for use with real patients — that would require, at minimum, WA Health
clinical governance approval, an approved identification policy, patient and consumer
co-design, a privacy impact assessment, cultural-safety review, legal review, clinical
content validation, identity matching, access control, immutable audit, and controlled
deployment. The specification's "Production-readiness boundary" section lists the full
set.
