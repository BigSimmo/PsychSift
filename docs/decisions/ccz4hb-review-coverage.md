# Decision: restoring automated review coverage (`#CCZ4HB`)

- **Status:** decided 2026-08-22 (accept intermittent CodeRabbit review; no cap change) and
  the row closed — but see the 2026-09-02 correction below, which removes the premise that
  decision rested on. The header below was never updated when the decision was taken.
- **Issue:** `#CCZ4HB` (recommendation, now closed), recorded 2026-08-18
- **Written:** 2026-08-22
- **Scope:** analysis only. No product code, workflow, or configuration was changed by this document.

---

## CORRECTION, 2026-09-02: the operative blocker is an eligibility gate, not the budget

**Read this before acting on anything below.** The analysis that follows diagnoses a
budget/rate problem and recommends conserving review credits. That diagnosis does not describe
what is stopping CodeRabbit today, and every recommendation derived from it is aimed at the
wrong constraint.

**What was observed.** On 2026-09-02, across PRs #2522 and #2542, CodeRabbit posted the same
message three times, verbatim:

> This repository does not receive automatic reviews because it has fewer than 10 stars.

The same run configuration reported `Plan: Team` and `Review profile: CHILL`, reading
`.coderabbit.yaml`. The GitHub API confirms the premise: `BigSimmo/Database` has
`stargazers_count: 0`.

**Why that matters.** This is a categorical eligibility gate, not a consumption limit. While it
holds, freeing credits cannot produce a review — so lever 1 (exclude docs-only PRs), lever 2
(stop bookkeeping-only PRs), and lever 3 (raise the spend cap) cannot reach the stated goal of
restoring CodeRabbit coverage, however sound they are on their own merits.

**A second, separate gate.** While a PR is a draft, CodeRabbit reports instead: _"Draft PRs are
not automatically reviewed by default."_ So a draft PR is skipped for that reason, and an
undrafted one for the star count. Undrafting does not buy a review.

**The doc's "two robot reviewers" framing is also out of date.**

| Reviewer        | State on 2026-09-02                                                                                                                                                   |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CodeRabbit      | Blocked by the star-count eligibility gate. Not reviewing.                                                                                                            |
| Codex connector | **Working.** Reviewed both PRs and raised a correct P2 finding on #2522 — a handover document that contradicted its own status banner — which was fixed in `87ee0c7`. |
| Cursor Bugbot   | _"Bugbot couldn't run — usage limit reached."_ This is the tool actually hitting a spend limit, and it is not one of the two this document analyses.                  |

So automated review coverage is **not** absent, as the summary below states. It is Codex-only,
for a reason this document does not name.

**What is NOT verified, and must be before acting.** I did not check CodeRabbit's published
policy, changelog, or support channels. Whether the star gate is new, whether it applies to the
Team plan as configured, whether a private or paid repository is exempt, and whether it can be
waived are all unknown. **The next step is to ask the vendor, not to act on this inference.** If
the gate turns out to be waivable or misapplied, the budget analysis below may become the
operative constraint again — which is why it is preserved in full rather than rewritten.

**What still stands.** The measurement work below is unaffected and remains useful: about a
quarter of merged PRs are prose-only, the caveat that merge share is not credit share, and the
argument against a same-file branch gate (87% of PRs would trip it).

---

## Plain-language summary

**What happened.** Two robot reviewers check every pull request in this repo — CodeRabbit
and the Codex connector. Both ran out of budget on 18 August, so PR #2113 was merged with no
automated review at all, and every PR after it is in the same position until the budget
refills or you buy more.

**Why it happened.** It is not really a billing problem. CodeRabbit's own message says its
included reviews refill at **one per hour**, which is 24 reviews a day. Over the last month
this repo merged **25.4 pull requests a day on average**, with single days as high as 67.
The repo has been asking for more review than the plan can produce, every day, for weeks.
Adding credits without changing that would be buying capacity to keep doing the same thing.

**The most useful thing I found.** A quarter of the pull requests are not code at all. Using
the repo's own tested classifier, **285 of the last 1,190 merged PRs (24%) changed only
documentation**, and **190 (16%) changed nothing except the repo's own record-keeping files**
— the review ledger and the outstanding-issues list. Those are files a code-review robot has
nothing useful to say about.

Be careful what that share is, though. It is a share of **merged pull requests**, not a share
of review credits spent, and the two are not interchangeable. CodeRabbit bills per review and
re-reviews incremental pushes, so one PR can consume several credits — or, if it merged after
the budget was already exhausted, none at all. Push counts are unrecoverable from a
squash-merged history (§2.1), so this share cannot be converted into credits without vendor
consumption data the repo does not have. If documentation PRs are pushed to less often than
code PRs the credit share is lower than the merge share; if more often, higher. Read "about a
quarter of merged PRs are prose" as the measured fact, and any credit number derived from it
as an unverified estimate.

**What I recommend, in order.**

1. **Tell CodeRabbit to skip documentation-only pull requests.** This is a small
   configuration change, it removes review from about a quarter of merged pull requests
   immediately, and it removes no safety at all — no required check is touched. How much
   credit that returns depends on push counts the repo cannot measure, so size it by
   observing the refill after the change rather than by assuming it tracks the PR share.
2. **Stop the robots opening a pull request whose only content is a bookkeeping record.**
   The rule that says to fold those records into the pull request they belong to already
   exists in writing and is plainly not being followed; this repo has learned before that a
   written rule does not hold but a blocked command does.
3. **Only then decide whether to raise the spending cap.** After steps 1 and 2 the gap
   between what the repo needs and what the plan provides is small, and you will be paying to
   close a real gap rather than to fund waste.

**What I recommend against.** The idea of blocking a new branch when an open pull request
already covers the same ground sounds right but cannot be built here: **87% of pull requests
touch a file that another pull request touched within a day**, so such a gate would block
roughly seven out of every ten legitimate branches. And simply accepting unreviewed merges is
not acceptable on its own — this is a clinical reference tool, there is one maintainer, and
the robot review is currently the only review that happens at all.

**What I need from you.** Three things, listed in full at the end: whether documentation
pull requests may go unreviewed, what you are willing to spend with each of the two vendors,
and permission to check GitHub for the numbers I could not obtain offline.

---

## 1. The problem

Recorded on `#CCZ4HB`, 2026-08-18:

> CodeRabbit on PR #2113: "101 included PR reviews in the past 7 days; at that activity
> level, included reviews refill at 1 review per hour. Your organization has reached its
> usage spending cap." The Codex connector reported its own usage limit on the same PR.

Net effect: PR #2113 received zero automated review, and subsequent PRs will too until the
cap resets or credits are added. The pull requests most likely to need review are exactly
the ones landing during a churn spike, so the failure mode selects for the worst case.

This is the second bill for one underlying behaviour — one-task-one-PR churn. `AGENTS.md`
already measured the CI half on 2026-07-30 (437 PR-triggered runs over ~3 days, ~40%
cancelled mid-run, ~12 Production-UI-hours burned on runs that never completed). CI waste
is money. Missing review is undetected defects.

### The failure is silent by design

`.coderabbit.yaml` was added on 2026-07-13 by PR #601 specifically so that a CodeRabbit
outage cannot post a red commit status:

```yaml
reviews:
  commit_status: false
  fail_commit_status: false
```

That was the right call for its own purpose — a credit-exhaustion message should not act as
a merge barrier. But it means budget exhaustion produces **no signal on the pull request at
all**. Nothing in the repo distinguishes "reviewed and clean" from "never reviewed". That is
option (c) already in force, arrived at by accident rather than by decision.

---

## 2. Measured evidence

### 2.1 Method, and what it cannot see

All figures below come from **local git history only**. No GitHub API, GitHub CLI, OpenAI,
Supabase, Railway, or hosted CI call was made; provider access requires the user's explicit
confirmation under `AGENTS.md` "API and provider confirmation boundary", and it was not
given for this task.

The repo squash-merges, so each merged pull request appears as exactly one first-parent
commit on `origin/main` whose subject ends `(#N)`. Counts were taken over
`git log origin/main --first-parent`, with per-file `--numstat` for size and path
classification. Window: 2026-07-11 to 2026-08-22, giving **1,190 merged pull requests**.

Four limits, and they all bias the same way — **every number here is a floor, not a ceiling**:

| Limit                                                                                                                                    | Effect on the numbers                                                           |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Only **merged** PRs are visible. Closed-without-merge PRs left no commit.                                                                | True PR count, and therefore true review demand, is **higher** than measured.   |
| Review demand is per **push**, not per PR. CodeRabbit re-reviews incremental pushes; a PR with three pushes can consume several reviews. | Review demand is **higher** than the PR count, by an unknown multiplier.        |
| Squash merge collapses each branch to one commit, so per-branch commit counts, push counts, and CI cancellation rates are unrecoverable. | The 2026-07-30 "~40% cancelled" CI figure could not be refreshed.               |
| Risk classification below re-implements `scripts/pr-policy.mjs` patterns in awk rather than importing them.                              | Approximate; the docs-only figure (§2.3) does not have this problem, see there. |

### 2.2 Volume: demand structurally exceeds supply

Merged pull requests per ISO week on `origin/main`:

| Week     | Merged PRs | Week                          | Merged PRs |
| -------- | ---------- | ----------------------------- | ---------- |
| 2026-W27 | 75         | 2026-W31                      | 246        |
| 2026-W28 | 92         | 2026-W32                      | 160        |
| 2026-W29 | 216        | 2026-W33                      | 108        |
| 2026-W30 | 237        | 2026-W34 (partial, to 22 Aug) | 184        |

Daily, over the 31 days 2026-07-23 to 2026-08-22: **787 merged PRs, mean 25.4/day**, range
4 to 92. The seven days ending 2026-08-18 — the window CodeRabbit was reporting on — merged
**184 PRs**.

Against that, CodeRabbit's stated refill rate is **1 review per hour = 24 reviews/day = 168
per week**.

> **This is the decisive number.** Mean demand is **106% of refill capacity** counting only
> merged PRs and only one review each. Counting closed PRs and re-reviews on incremental
> pushes, real demand is plainly a multiple of supply. The message "101 included PR reviews
> in the past 7 days" against 184 merged PRs in that same window is consistent with
> CodeRabbit already having been throttled partway through the week.
>
> A repo cannot be a little over an hourly refill rate. Either the PR rate comes down, or
> the plan changes, or reviews are permanently rationed by whichever PR happens to arrive
> when a credit is free — which is exactly the current behaviour.

### 2.3 Composition: a quarter of merged pull requests are the repo's own paperwork

Classified against `docPatterns` in `scripts/ci-change-scope.mjs` — the repo's **own,
unit-tested** `docs_only` definition (`docs/`, `mockups/`, `*.md`, `*.mdx`, `README*`),
so this is not a new judgement call:

| Category                                                                                                                                                                     | PRs     | Share of 1,190 |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | -------------- |
| **Documentation-only** (repo's own `docs_only` classifier)                                                                                                                   | **285** | **23.9%**      |
| **Bookkeeping-only** — touched nothing but `docs/outstanding-issues*`, `docs/branch-review-ledger*`, `docs/archive/branch-review-records/`, `docs/outstanding-issues-inbox/` | **190** | **16.0%**      |
| Prose-only, widened to include `.claude/`, `.agents/`, `.cursor/`, `.codex/`                                                                                                 | 290     | 24.3%          |
| Touch a high-risk path (approximating `pr-policy.mjs` clinical/operational/RAG patterns)                                                                                     | 448     | 37.6%          |
| Low-risk **and** small (≤10 files, ≤300 changed lines)                                                                                                                       | 550     | 46.2%          |
| Low-risk **and** tiny (≤3 files, ≤80 changed lines)                                                                                                                          | 296     | 24.9%          |
| Bundling candidates (prose-only **or** low-risk-and-tiny)                                                                                                                    | 387     | 32.5%          |

Sample of the bookkeeping-only class, all merged in W34 alone:

```
docs(issues): reconcile 38 queued ledger requests into the canonical ledger (#2229)
docs(ledger): record the prlanded verification for PR #2210 (#2231)
docs(ledger): record prlanded verification for PR #2223 (#2230)
docs(issues): queue the #DREDWA residual test-coverage gap (#2224)
docs(issues): reconcile 29 queued ledger requests into the canonical ledger (#2217)
```

**190 pull requests — 16% of all merged PRs, about 4 per day — contained nothing but the
repo's own record-keeping.** Each opened a review request and one full `pr-required` CI
aggregate against Markdown records that a code-review bot has no purchase on. The CI cost is
firm — `pr-required` runs per PR and is visible in the workflow history. The review cost is
**not** one credit each: billing follows pushes rather than PRs, and any of these that merged
after exhaustion consumed nothing, so treat this row as review _demand_ offered, an upper
bound on credits spent rather than a count of them. `AGENTS.md` "PR bundling" already says
these "should travel with their owning product PR instead of receiving a dedicated
ledger-only branch". They are not doing so.

Title-based filtering would **not** be a reliable way to catch this class: among those 190,
the title prefixes are `docs(issues)` (54), bare `docs` (46), `docs(ledger)` (31), `issues`
(30), `chore(ledger)` (6), `chore(issues)` (5) — plus stragglers titled `fix(services)`,
`fix(deps)` and `feat(factsheets)` that were nonetheless bookkeeping-only diffs. **Path-based
classification is the only mechanical route**, and the repo already has one.

### 2.4 Scope overlap: why a "same scope" gate cannot be built

For each merged PR, I checked whether any PR merged within roughly one day (±26 positions at
~26 merges/day) touched at least one of the same files:

| Window                                             | PRs sharing ≥1 file with a near neighbour |
| -------------------------------------------------- | ----------------------------------------- |
| ±1 day                                             | **1,041 / 1,191 (87.4%)**                 |
| ±3 days                                            | 1,100 / 1,191 (92.4%)                     |
| ±1 day, **excluding** the 8 hottest shared files\* | 843 / 1,191 (70.8%)                       |
| ±3 days, excluding those same 8                    | 928 / 1,191 (77.9%)                       |

\* excluded: `docs/branch-review-ledger.md`, `docs/outstanding-issues.md`, `docs/site-map.md`,
`docs/codebase-index.md`, `docs/scripts-index.md`, `AGENTS.md`,
`docs/design-system/adoption-manifest.json`, `docs/design-system/COMPONENTS.md`, plus the two
record directories.

The hottest shared files, by number of PRs touching them in the window:

```
 423  docs/branch-review-ledger.md          91  src/app/globals.css
 201  docs/outstanding-issues.md            80  src/components/ClinicalDashboard.tsx
 123  tests/ui-smoke.spec.ts                77  .../master-search-header.tsx
 108  package.json                          73  AGENTS.md
  93  tests/ui-tools.spec.ts                66  .../global-search-shell.tsx
```

This kills option (a) as posed, and §3.1 explains why.

### 2.5 What existed before this, and still holds

- `.coderabbit.yaml` (2026-07-13, PR #601) — review is advisory, never a blocking status.
  **Still current.** Exhaustion degrades silently.
- `.claude/hooks/pr-handoff-stop.sh` — the precedent for a mechanical gate. Its own header:
  _"prose rules in AGENTS.md have not held, a denied tool call does."_
- `AGENTS.md` "PR bundling (reduce one-task-one-PR churn)" and the `newtask` skill's
  "Before you start" — both ask the bundling question **in prose**.
- Bundling is not a total failure: PRs #2180, #2183, #2186 landed in W34 as explicit
  multi-item `feat(hardening): … bundle` PRs. The prose works when a session chooses to
  apply it. Nothing makes it choose.
- **No gate addressing this has been added since the issue was filed.** I checked commits on
  `origin/main` since 2026-08-18. The premise of the issue is not stale in that respect.
  Whether the _cap itself_ has since reset is unknown offline — see §6.

### 2.6 Cross-check, and a worsening trend

The §2.3 figures were produced twice, by **two independently written implementations** — one
looping `git show --numstat` per commit in bash, one parsing a single bulk `git log --numstat`
dump in awk. On the same window (the newest 1,001 merged PRs) they agree on documentation-only
PRs to within nine out of 1,001: **269 vs 260, a 0.9-point gap**, attributable to differing
rename handling between `--name-only` and `--numstat`. The parsing behind §2.3 is corroborated
rather than single-sourced.

The cross-check also surfaced something the headline figures understate. Both wasted-review
categories are **larger in recent windows than across the full period**:

| Window (newest N merged PRs)                              | Documentation-only | Bookkeeping-only |
| --------------------------------------------------------- | ------------------ | ---------------- |
| All 1,191 (since 2026-07-11) — the figures quoted in §2.3 | 23.9%              | 16.0%            |
| Newest 1,001 (since 2026-07-18)                           | 26.9%              | 18.7%            |
| Newest 500                                                | —                  | 16.6%            |
| Newest 250                                                | —                  | **22.0%**        |

Over the most recent 250 merged pull requests, **more than one in five contained nothing but
the repo's own record-keeping**. This document quotes the full-window numbers throughout, which
is the conservative choice: the behaviour being addressed has been getting worse, not better,
so the expected win from step 1 is more likely understated than overstated.

---

## 3. The three recorded options

### 3.1 Option (a) — a gate refusing a new branch when an open PR of the same scope exists

**Recommended against, as posed.** Two independent reasons.

**It cannot be made mechanical without an unacceptable false-positive rate.** "Same scope"
has to reduce to something a script can compute, and the only available signal is the changed
file set. §2.4 measures what that costs: a gate keyed on file overlap with a recently-active
PR would refuse **87% of new branches** — 71% even after excluding the eight hottest shared
files, which is itself a concession that already erodes the gate's usefulness (five of those
eight are the exact bookkeeping/index files a duplicate-work gate would most want to catch).
This repo genuinely has many sessions working concurrently on a shared surface:
`ClinicalDashboard.tsx` was touched by 80 separate PRs and `tests/ui-smoke.spec.ts` by 123.
Legitimate parallel work on one file is the norm here, not the exception. A gate that blocks
seven in ten legitimate branches will be unlocked reflexively within a day and will then be
worse than nothing, because it will also be trusted.

**Even if it worked, it addresses a different problem.** Refusing a _branch_ prevents
duplicate concurrent work — that is issue `#292` (PR #1766 / #1767 shipping the same
conversion four hours apart), and it is a real problem worth solving. It does not reduce
review demand: the work still gets done, and still becomes a pull request, just later. What
reduces review demand is **fewer pull requests for the same work** — bundling at the point
the PR is opened, not gating at the point the branch is created.

The narrow, high-value slice of (a) that _is_ achievable is folded into the recommendation
as step 2: not "same scope", but the far cruder and completely unambiguous test **"this
branch's entire diff is bookkeeping records"**.

### 3.2 Option (b) — raise the bot spending cap / add credits

**Recommended, but third, and only after steps 1 and 2.**

First, a clarification the issue flags and that matters for the decision: **these are two
separate vendors with two separate limits.**

|                                    | CodeRabbit                                                                           | Codex connector                                                                                                                  |
| ---------------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| Limit reported                     | "organization has reached its usage spending cap"; included reviews refill at 1/hour | its own usage limit, unspecified in the record                                                                                   |
| Configured in-repo                 | `.coderabbit.yaml` (advisory only)                                                   | `.github/workflows/codex-autofix-review-comments.yml` routes _repair_; the _review_ itself comes from the connector app          |
| Controlled by                      | CodeRabbit org billing settings                                                      | OpenAI/Codex plan settings                                                                                                       |
| Repo-side throttle already present | none                                                                                 | yes — the autofix workflow routes only high-risk or ≥10-file/≥300-line PRs, and allows one automatic repair pass per PR lifetime |

Raising either is a settings change outside this repository, and it treats the symptom. The
arithmetic in §2.2 is the argument for ordering: at 25.4 merged PRs/day against a 24/day
refill, **and with a quarter of that volume being documentation**, buying capacity first
means paying to review the repo's own paperwork. Do steps 1 and 2, re-measure, then size the
purchase against the residual.

It should not be dropped, though. Steps 1 and 2 together remove roughly a quarter of demand;
they do not remove a burst day of 67 PRs. Some paid headroom is the right answer for the
remainder, and it is the only one of the three options that increases actual review _supply_.

### 3.3 Option (c) — accept unreviewed merges deliberately rather than by accident

**Recommended against as a standalone answer. One component of it is worth keeping.**

To be safe, "deliberately accepting unreviewed merges" would need at minimum:

1. **A visible signal per PR** that review did not happen. Today there is none, by design
   (§1). "Deliberate" is not a state of mind; it has to be legible on the pull request.
2. **A defined class where it is acceptable** — and by construction that class is
   documentation and bookkeeping, which is precisely step 1 of the recommendation. Extending
   it to code is a different proposition.
3. **A compensating human review** for anything else. This is where it fails. `docs/agents-guide.md`
   describes a single maintainer; the bot review is not a supplement to human review here, it
   _is_ the review. Accepting unreviewed code merges means accepting genuinely unreviewed code
   into a clinical reference tool.
4. **It must not be paid for by weakening any required check.** That is the binding stop rule
   on `#CCZ4HB`, and it is respected throughout this document: nothing recommended here
   touches `pr-required`, `static-pr`, `scripts/pr-policy.mjs`, the clinical-governance
   preflight, or the `RAG impact:` gate.

Worth stating plainly for the record: the deterministic safety net **does** survive a bot
outage intact. Per-PR, independent of any review budget, the repo still runs lint, typecheck,
the full offline unit suite, coverage, `pr-policy` (clinical governance + RAG impact), the
`ingestion-sast` job inside `pr-required`, secret scanning (`secret-scan.yml`, on
`pull_request`), Chromium UI journeys, migration replay, and the `pr-required` aggregate
itself. Semgrep (`sast.yml`) also runs per-PR but is advisory by its own header, so count it
as signal rather than as a gate. What is lost when the
bots go dark is specifically the **judgement** layer — the reviewer that notices a plausible
but wrong design, a missing edge case, or a governance claim that reads fine and is untrue.
That is not a layer the deterministic gates replace, which is why (c) is not sufficient alone.

The component to keep: **make the absence of review visible.** See step 4 of the recommendation.

---

## 4. Recommendation

**Do all three of the following, in this order. Step 1 is the one that matters most per unit
of effort; step 3 should not be sized until steps 1 and 2 have been running for a week.**

### Step 1 — Stop spending review credits on documentation. _(do first; hours, not days)_

Add path exclusions to `.coderabbit.yaml` so CodeRabbit does not review a PR whose entire
diff is documentation or bookkeeping.

_Why this first:_ it is the largest single win (23.9% of PR volume), it is a configuration
change with no code risk, it weakens no required check, and it removes review only from files
where a code-review bot produces no value. Documentation-only PRs still get the repo's own
docs contracts in `static-pr` (`docs:check-index`, `docs:check-inventory`, `docs:check-scripts`,
`docs:check-links`), which are the checks that actually catch defects in documentation.

### Step 2 — Make the bookkeeping-bundling rule mechanical. _(do second; a day)_

Deny `gh pr create` when the branch's entire diff versus `origin/main` is bookkeeping
records, with a deny message pointing at the `AGENTS.md` rule that already says to bundle
them into the owning product PR.

_Why this, and not the general gate:_ "is every changed path a bookkeeping record" is a
mechanical test with essentially no ambiguity, unlike "same scope". It targets 16% of PR
volume — the class that most obviously should never have been its own PR. And it follows the
precedent this repo has already validated: `pr-handoff-stop.sh` exists because a written rule
did not hold and a denied tool call did.

### Step 3 — Then size the vendor spend against what is left. _(after a week of 1 and 2)_

Re-measure the merge rate, compare it to the refill rate, and buy headroom for the residual —
principally for burst days, which steps 1 and 2 do not address. Handle CodeRabbit and the
Codex connector separately; they are separate bills with separate controls.

### Step 4 (optional, cheap) — Make "not reviewed" visible.

Keep the one useful piece of option (c). A **non-blocking** annotation on any PR that merged
without a bot review turns silent degradation into a fact you can see and, later, count. It
must stay non-blocking: `.coderabbit.yaml`'s existing intent is deliberate and correct, and a
new required check is not what this problem needs.

**Not recommended:** option (a) as posed (§3.1), and option (c) as a standalone (§3.3).

**Expected effect, stated honestly.** Steps 1 and 2 together remove review from about a
quarter of merged pull requests. What that is worth in credits is genuinely unknown — the
conversion needs per-push consumption data the repo cannot recover (§2.1, §2.3) — so the
honest statement is a direction, not a number: it reduces demand materially, and it does not
by itself bring a 25.4/day merge rate under a 24/day refill. They make step 3 a proportionate purchase instead of a
blank cheque, and they stop the most indefensible category of waste. Anyone claiming this
combination alone restores full review coverage is over-reading the numbers.

---

## 5. Implementation sketch

Not implemented. This is the shape the work would take, for sizing only.

### 5.1 Step 1 — `.coderabbit.yaml` path filters

```yaml
reviews:
  commit_status: false
  fail_commit_status: false
  # Documentation and the repo's own bookkeeping records carry no code for a
  # code-review bot to review, and were ~24% of merged PR volume (measured
  # 2026-08-22, docs/decisions/ccz4hb-review-coverage.md §2.3). Excluding them
  # returns review capacity to code; the credit saving tracks pushes, not PR
  # share, so confirm it against the observed refill rather than assuming 24%.
  path_filters:
    - "!docs/**"
    - "!mockups/**"
    - "!**/*.md"
    - "!**/*.mdx"
```

Key names verified against CodeRabbit's published YAML reference: `reviews.path_filters`
(default `[]`, glob patterns, `!` excludes). `reviews.auto_review.labels` (negative matches
with `!`) is available as a per-PR manual override if one is wanted.

Two things to settle before writing it:

- **Does a fully path-filtered PR still consume a review credit?** Unverified — see §6.
  If it does, the filter buys nothing and the lever becomes `auto_review.labels` with a
  negative match plus a label applied at PR-creation time, which is more machinery.
- **Keep the pattern list honest.** Add a Vitest contract test that reads `docPatterns` from
  `scripts/ci-change-scope.mjs` and asserts the `.coderabbit.yaml` filter list stays
  consistent with it, so the two definitions of "documentation" cannot drift. The repo
  already pins config this way (`tests/ci-cache-safety.test.ts`, `tests/session-start-hook.test.ts`).

### 5.2 Step 2 — a bookkeeping-only PR-creation gate

Model it directly on `.claude/hooks/pr-handoff-stop.sh`, which is already registered in
`.claude/settings.json` and already intercepts PR-creating calls:

- **Hook point:** `PreToolUse`, matching the same call shapes the existing hook matches in
  `post` mode — the `gh pr create` CLI and GitHub MCP `create_pull_request`.
- **Test:** compute `git diff --name-only origin/main...HEAD`; deny only if the result is
  non-empty **and** every path is under `docs/outstanding-issues.md`,
  `docs/outstanding-issues-inbox/`, `docs/branch-review-ledger.md`,
  `docs/archive/branch-review-records/`, or `docs/archive/branch-review-ledger-*`.
- **Deny message:** name the `AGENTS.md` "PR bundling" rule, say the record should travel
  with its owning product PR, and name the escape hatch.
- **Escape hatch:** `CLAUDE_ALLOW_LEDGER_PR=1`. This is **required**, not optional — the
  `npm run issues:reconcile` transaction is deliberately serialized onto its own fresh-base
  branch by `AGENTS.md` and `check:ledger-write-discipline`, and legitimately must be its own
  PR. The gate must not fight a rule the repo already enforces.
- **Contract, inherited from the existing hook:** exit 0 on any parse problem, make no
  decision, never fail a tool call by accident. Register as
  `bash "$CLAUDE_PROJECT_DIR/.claude/hooks/<name>.sh"`, set an explicit `timeout`, commit
  mode `100755` via `git update-index --chmod=+x` (`core.fileMode=false` on this Dev Drive
  makes a local `chmod` a silent no-op), LF endings. `tests/session-start-hook.test.ts`
  already fails any hook that is not `100755` or that carries CR bytes.
- **Known gap to state up front:** `core.hooksPath` and `.claude/settings.json` are local, so
  this binds Claude Code sessions in this checkout and nothing else — not Codex, not Cursor,
  not a Cloud agent pushing from its own environment. It is a strong nudge, not an
  enforcement boundary. Given that ~16% of PR volume comes from exactly the sessions this
  hook governs, that is still most of the target.

### 5.3 Step 4 — review-coverage visibility

Lowest-machinery version: a scheduled, non-blocking job that lists merged PRs carrying no bot
review and appends the count to the existing `ops-digest.yml` output. Deliberately _not_ a
per-PR required check.

### 5.4 What must not change

Binding stop rule from `#CCZ4HB`, restated because it constrains any future variant of this
work: **do not weaken any required check to compensate for missing bot review.** Not
`pr-required`, not `static-pr`, not `scripts/pr-policy.mjs`, not the clinical-governance
preflight, not the `RAG impact:` gate. Nothing in this document does; anything built from it
must not either.

---

## 6. Open questions

**For the user to decide:**

1. **May documentation-only pull requests go entirely unreviewed by the bots?** This is the
   premise of step 1 and it is a judgement call, not a measurement. `AGENTS.md` and
   `CLAUDE.md` are themselves agent-behaviour-changing files — a bad edit to them has real
   consequences, even though a code-review bot is poorly placed to catch it. My
   recommendation is yes, because the repo's docs contracts in `static-pr` are the checks
   that actually catch defects there. If you would rather keep review on `AGENTS.md`,
   `CLAUDE.md` and `docs/` prose while excluding only the bookkeeping records, the exclusion
   list narrows to the four record paths in §5.2 and the win drops from 23.9% to 16.0%.

2. **What are you willing to spend, with each vendor?** Two separate bills: CodeRabbit's org
   spending cap, and the Codex connector's plan limit. Step 3 cannot be sized without a
   ceiling from you.

3. **May I query GitHub to close the gaps below?** Everything in §2 came from local git
   history because provider access needs your explicit confirmation and I did not have it.

**Unanswerable offline — each needs GitHub, or the vendor dashboards:**

- **Has the cap actually reset since 2026-08-18?** Unknown. Four days have passed. If it has,
  the urgency drops but not the analysis: §2.2 shows the repo re-exhausts it structurally.
- **How many pull requests are open right now**, and how many were closed without merging?
  Every count in §2 is merged-PRs-only and therefore a floor.
- **How many reviews does one PR actually consume?** Reviews are per push; squash history
  destroys push counts. This multiplier is the single biggest uncertainty in §2.2, and it can
  only make the picture worse.
- **Is the 2026-07-30 CI figure still current** (437 runs / ~40% cancelled / ~12 Production-UI
  hours)? Not recoverable from squashed history.
- **Does a path-filtered CodeRabbit PR consume a review credit?** Blocks the sizing of step 1
  (§5.1). Answerable either from CodeRabbit's usage dashboard or by observing one filtered PR
  after the change lands.
- **What exactly is the Codex connector's limit** — per-day, per-month, or plan-wide — and
  when does it reset? The `#CCZ4HB` record does not say, and the repo cannot see it.

---

## Sources

Read for this analysis: `AGENTS.md` ("PR bundling", "Anti-conflict and CI-speed operating
procedure", "Codex GitHub review behavior", "Codex review throttling and routing", "Babysit
the pull request, then stop"); `CLAUDE.md`; `.coderabbit.yaml`; `.github/workflows/ci.yml`
(`changes` and `pr-required` jobs); `.github/workflows/codex-autofix-review-comments.yml`;
`.github/workflows/sast.yml`; `.github/workflows/secret-scan.yml`; `.github/workflows/claude.yml`;
`scripts/pr-policy.mjs`; `scripts/ci-change-scope.mjs`; `.claude/hooks/pr-handoff-stop.sh`;
`.claude/skills/newtask/SKILL.md`; `.claude/skills/handoff/SKILL.md`;
`docs/outstanding-issues.md` (row `#CCZ4HB`); `docs/agents-guide.md`. CodeRabbit YAML key
names and defaults confirmed against CodeRabbit's public configuration reference.
Quantitative figures derived from `git log origin/main --first-parent` over 2026-07-11 to
2026-08-22; method and limits in §2.1.
