# Care Plan — complete work ledger

Everything done on Care Plan, across every session, in order. Written 21 August 2026
(Australia/Perth) at the end of the second session. This is the record of _what
happened_; `sdd-ledger.md` is the record of _decisions taken_, and
`session-handoff-2026-08-21.md` is the record of _where to pick up_.

---

## Session 1 — Codex, 20–21 August 2026

Task title "Management plan", task id `01a01fb2-575f-7c11-a245-332db7a85a25`, worked in
`D:\Repos\Database` and then the worktree `D:\Worktrees\Database\ed-care-plans` on branch
`codex/ed-care-plans`.

**Produced, all as untracked planning documents:**

| Artefact                      | Now at                                                          |
| ----------------------------- | --------------------------------------------------------------- |
| Domain glossary               | `docs/care-plan-context.md`                                     |
| Design specification          | `docs/superpowers/specs/2026-08-20-care-plan-design.md`         |
| Nine-task implementation plan | `docs/superpowers/plans/2026-08-20-care-plan-implementation.md` |
| Build handover                | `docs/care-plan/claude-build-handover-2026-08-21.md`            |
| Conversation transcript       | `docs/care-plan/conversation-transcript-2026-08-21.md`          |
| Verification log              | `docs/care-plan/verification-log-2026-08-21.md`                 |
| Start-here entry point        | `docs/care-plan/CLAUDE-START-HERE.md`                           |

Paths in this table are the current post-rename locations. Earlier session artefacts used the `ed-care-plans` names as historical aliases.

**Decided:** the product concept; the domain language, with an explicit `_Avoid_` list
per term; one longitudinal Management Plan per patient with named senior-clinician
approval; a separate patient-owned Personal Safety Plan; append-only ED Presentations
with visible amendments; intent-only contact actions; the visual direction (A, Clinical
Snapshot); and — deliberately — **no numeric identification threshold**, left pending
local governance.

**Verified:** plan self-review passed, 17 routes matched, no unfinished markers. No
application code was written and no product gate was run.

**Left open:** local commits were never authorised, so nothing was committed. The
branch sat four commits behind `origin/main`.

---

## Session 2 — Claude, 21 August 2026

Asked to review the handover, use the relevant skills, and ask whatever was needed to
perfect it. Ran `superpowers:brainstorming`, `writing-plans`,
`subagent-driven-development`, `dispatching-parallel-agents`, the `grilling` skill, and
`prompt`.

### 01:29 — first four decisions, and the plan lands in a tracked worktree

Read everything, verified the plan's claims against the repository (all twelve named UI
primitives exist; two are in a different directory than the plan said), and surfaced the
central contradiction: the user described "a clinical tool for clinicians", the
specification described a synthetic prototype that forgets everything on refresh.

Four decisions taken with the user: build the prototype now but shape the domain so real
storage could be added later without a redesign; keep the full multi-service workflow
including senior approval; deliver Tasks 1–5 then stop for review; local commits
authorised.

`92097e53e` — planning documents copied into the tracked worktree, decisions applied.

### 01:53 — design review

Interrogated the parts of the specification written from published guidance rather than
practice. Five changes: Management Plan content cut from nineteen fields to eleven in two
tiers, removing four duplicate pairs and promoting the two safety-critical sections into
the first-minute summary; the ED Presentation record cut to a roughly thirty-second set;
the review clock defined (it had three states and no durations); Identification Reviews
given a way to close (they could be opened but never closed); and the first-minute summary
fixed at exactly five sections.

`3997ea37b`.

### 02:57 — grilling round, rename, and the Patient Plan

Nine more questions, each with a recommendation. Outcomes: an admission-wording ban;
the safety boundary pinned above all plan content; `whatMakesItWorse` written about what
the service does rather than what the person does; a permanent marker and review trigger
when a plan is approved without the person's involvement; senior-only withdrawal rendering
distinctly from "no plan"; safety-plan authorship open to every clinical role; sort-by-count
confined to the identification workflow; amendment extended to the one-line account and the
plan-use answers; production reachability behind the administrator gate; and the required
note reframed as "in one line: why they came and what happened".

The user also stated the ordering principle that reshaped the build — _"the plan is for
clinicians to look up and see the management plan; it is rarely for changing or updating"_
— which became **read primacy**, and moved the whole reading experience into Stage A with
no authoring surface at all.

A new **Patient Plan** task was added: a deterministic, offline, rule-based transformation
of an approved version into a patient-facing edition that flags what it cannot convert
rather than guessing, never auto-converts the agreed-approach section, and requires
clinician approval before the patient receives it.

The product was renamed **ED Care Plans → Care Plan**. The plan grew from nine tasks and
seventeen routes to eleven tasks and twenty-one routes.

`8a2e6a6d1`.

### 07:47–11:17 — Task 1: domain, fixtures, selectors

One opus implementer, three pre-review fix rounds, one opus reviewer, two review fix
rounds. Final: 58/58 passing, typecheck clean.

`bfbee15b1`, `e5b3f4c12`, `3423449d2`, `2f5a6f32b`, `59d101fe9`, `9d72974ac`, `7b2864572`,
`8652e73ff`.

Notable: the implementer caught four defects in the controller's own plan and was right
every time — including refusing to print a fictional telephone number under a real crisis
service's name. The reviewer caught fixture prose asserting histories the records did not
support, a glossary-banned word inside the most-copied paragraph in the fixture set, and
two safety guards that could not fail.

### 13:11–15:34 — Task 2: reducer, provider, lifecycle

One opus implementer, one pre-review fix round, one opus reviewer, one review fix round.
Final: 121/121 passing across both files, typecheck exit 0, lint exit 0.

`e796775c9`, `9600e1250`, `0e1fb4a4f`, `bdcf2f0db`, `def541e6a`.

Notable: **32 deliberate mutations, 32 red suites** — every refusal guard proved by
breaking the code and watching the test go red, including two-directional proof that the
participation trigger is not simply always-on. The reviewer found that people whose plan
had been withdrawn were falling out of the review queue entirely, and that printing a
safety plan was blocked in the offline specimen — the one thing you most want when systems
are down.

### 16:50–17:36 — Task 3 blocked, and recovery

Task 3 was dispatched and the worktree was destroyed underneath it, for the third time
that day, through an explicit `git worktree lock`. The implementer repaired the `.git`
pointer, found a mass deletion already under way, confirmed the branch was intact, and
reported `BLOCKED` without committing — which was the right call, since committing would
have recorded a mass deletion.

Recovery: relocated to `D:\Worktrees\Database\care-plan`; confirmed all commits intact;
confirmed no file corruption via `git ls-files --eol` and a zero-CR check on the committed
blobs; reinstalled dependencies; re-ran the suites — 121/121 passing.

`9227ec457`, `0447f35a8` — the SDD ledger and session handoff, committed as **tracked**
files because the git-ignored workspace had just been destroyed with everything in it.

---

## Current state

|                  |                                                                |
| ---------------- | -------------------------------------------------------------- |
| Branch           | `claude/ed-care-plans-impl-7f44cd`, 18 commits ahead of `main` |
| Worktree         | `D:\Worktrees\Database\care-plan`                              |
| Tasks complete   | 2 of 11 (domain and fixtures; reducer and provider)            |
| Tests            | 121 passing across two files                                   |
| Application code | ~3,900 lines across five modules; ~2,150 lines of tests        |
| Pushed           | **No** — local to one machine, no upstream                     |

## What has _not_ been done, and must not be claimed

No UI exists. No route, page, component or stylesheet has been written. Consequently:
no browser or Playwright journey, no accessibility check, no responsive or phone-chrome
check, no print check, no build, no bundle-budget check, and no provider-backed gate has
ever run for this feature. `npm run typecheck` currently fails in the relocated worktree
on three unrelated pre-existing files because the dependency install did not finish — zero
errors in any Care Plan file.

## The three worktree destructions

`D:\Repos\Database\.claude\worktrees\ed-care-plans-impl-7f44cd` was destroyed three times
on 21 August 2026 — twice during Task 1, once during Task 3. The third went through an
explicit `git worktree lock` while a subagent was running, taking the `.git` pointer first
and then 3,836 tracked files over three minutes.

Nothing committed was ever lost. Every recovery was one `git worktree add`. What died each
time was uncommitted work and git-ignored scratch, including the entire SDD workspace on
the third occasion — which is why the ledger is now tracked.

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

## Honest limits

Care Plan is a clinical reference prototype, not validated clinical decision support and
not a clinical tool. It holds no real patient information and cannot; state resets on
refresh. Completing all eleven tasks would still not make it fit for use with real
patients — see the specification's "Production-readiness boundary".
