# Task 6A review — the post-examination clock counts up, and no deadline is claimed

Reviewer session. Read-only review of commit `2d8200a09b124ef61ee5692c812306bf5dd6c6fa` on branch
`codex/ward-management-design`, worktree `C:\Users\joshs\.codex\worktrees\ward-management-design\Database`.
No edits committed. `git status --short` confirmed clean before and after this review (a brief
in-place mutation used to prove a type-level guarantee was made, verified, and reverted —
byte-identical diff against its own backup — before any further check ran).

## Verdicts

**Spec compliance: PASS.** Every binding constraint in the brief is met. The fabricated Form 3B
statutory deadline is completely deleted, not merely hidden: `LegalForm.dueAt` is optional,
`EXAMINATION_TO_BED_WINDOW_MINUTES` is gone, the reducer no longer derives a 3B `dueAt`, the three
fixture records no longer carry one, and all nine source files that ever read `.dueAt` are
guarded so `undefined` cannot reach `clockState`/`minutesUntil` arithmetic — a guarantee I proved
is enforced by the type checker itself, not merely by convention (see Finding "Type-level proof"
below). `ED_ACCESS_TARGET_MINUTES` is introduced correctly named, correctly valued, correctly
documented, and completely quarantined — a repo-wide grep found it referenced in exactly three
places: its own definition and its own one-line value-pinning test. The Form 1A examination
countdown is untouched. The "passed its deadline" Playwright assertion was not relaxed, skipped,
or reworded. The clinician's rule (priority for an examined-and-detained patient rides on elapsed
wait alone, no compensating "was detained" bonus) is correctly and verifiably implemented.

**Task quality: PASS WITH IMPORTANT FINDINGS.** The implementation itself is clean and the
mutation-testing discipline in the report is real (I independently reproduced one mutation via a
different mechanism — see below — and it held). But the report is not fully trustworthy on one
specific claim, and a stale-comment defect the project explicitly treats as first-class (an untrue
comment beside a passing assertion) survived in two places, not the one already flagged.

**Counts:** 0 Critical, 2 Important, 2 Minor.

## Your two findings

**Finding 1 (stale WF-017/"2A" comment) — confirmed, and it is worse than reported.** I agree
with everything stated. Independently found a second, un-fixed instance of the identical defect in
the same file: see Important 1 below.

**Finding 2 (WF-303 is a generated breach now sitting at queue rank 1) — confirmed as a real,
worth-ruling-on observation, with one factual correction.** The breach is not driven by
`index % 7` — that modulus governs `security` (`Secure` vs `Open`) elsewhere in the same
generator function and has nothing to do with this. The actual mechanism is `index % 3 === 0`
(gates whether a routine movement gets a Form 1A at all — `ward-movements.ts:592` area) combined
with `dueAt: NOW_ANCHOR + (((index * 53) % 400) - 60)`, a deterministic pseudo-random offset that
happens to land 1 minute in the past for index 303. Substantively your point stands and I'd rank
it Minor/task-quality rather than a code defect — see Minor 2 below for the full analysis,
including live-computed proof of the actual queue order.

## Findings

### Important 1 — the stale "WF-017 is first" comment exists in two tests, not one

`tests/ui-ward-coordinator.spec.ts:266-268`, inside `"orders by clinical tier first and labels the
score as operational, not clinical"`:

```
// silently for neither direction (Task 5 review Important 3): WF-017 (first row) has a
// passed Form 2A deadline and must show the breach line; WF-009 (second row) has an
// unbreached deadline and must not.
```

This is the comment you already flagged. I confirm: the first row is WF-303 (not WF-017), and
"2A" is not a form code that exists anywhere in this codebase (the only codes are 1A, 3B, 4A, 4C —
so "2A" was wrong before this task too, exactly as you said).

I found a second copy of the same defect the implementer's own diff should have caught while
touching this exact file for this exact reason. `tests/ui-ward-coordinator.spec.ts:611-644`,
inside `"shows a failing gate as a failure and never auto-allocates"`:

```
611:   * The brief's own draft of this test clicks queue row 1 (WF-017) and only conditionally checks
...
627:    // WF-017 (queue row 1): every gate row states its own verdict in text, not only by icon, and
...
644:    // WF-017 above — this is the unconditional proof the brief's own guarded assertion could skip.
```

and the variable itself is named `wf017Gates` at line 630 for what is now, after this diff, a
different movement's gate list. This test's assertions are structurally generic (gate count,
per-gate text-matches-icon, "No automatic allocation" text) so it does not fail — which is
presumably why it was missed — but the comments assert an identity that this same task's own
change made false. This is the identical defect class you flagged: "an untrue comment beside a
passing assertion," now confirmed in two places in one file, one of which was left untouched even
though the implementer wrote a careful, correct note about exactly this row-identity change 300
lines below it in the referral test (line 928). All other `WF-017` references in this file
(lines 450, 671–719, 853–857) select it by explicit `data-testid` and describe properties of
WF-017 itself (its declines, its candidate list) that are unaffected by this task — those are
fine.

**Why it matters here:** this project's own standing rule (quoted in your brief) is that an untrue
comment next to a passing assertion is the same defect class as an untrue surface. It doesn't
change runtime behaviour, but it actively misleads the next person who reads this test file about
which record the coordinator screen currently puts first — for a screen whose entire purpose is
"never claim something the data doesn't support."

### Important 2 — the report makes a specific, checkable claim about queue order, and the claim is wrong

In "Gate output — quoted, not summarized," the report states:

> "...the two genuinely-breached Form 1A records (WF-001, `dueAt: NOW_ANCHOR - 15`; WF-005,
> `dueAt: NOW_ANCHOR - 40`) reach the top of their tier honestly once the fabricated 3B breach
> stops competing for rank."

I ran the real `queueOrder`/`operationalScore` functions against the real fixture (`tsx`, no
mutation, no test framework — just calling the shipped functions directly) to check this:

```
Top 6 queue rows:
WF-303  urgency(tier)=1  score=61  stage=accepted_awaiting_bed  legal=1A dueAt=641  factors=["Time waiting:31","Statutory timing:30"]
WF-009  urgency(tier)=1  score=53  stage=destination_review  legal=3B dueAt=none  factors=["Time waiting:28","Destinations declined:15","Active blocker:10"]
WF-312  urgency(tier)=1  score=50  stage=handover_ready  legal=1A dueAt=718  factors=["Time waiting:40","Statutory timing:10"]
WF-315  urgency(tier)=1  score=50  stage=placement_requested  legal=1A dueAt=877  factors=["Time waiting:40","Active blocker:10"]
WF-306  urgency(tier)=1  score=48  stage=moving  legal=1A dueAt=800  factors=["Time waiting:38","Statutory timing:10"]
WF-001  urgency(tier)=1  score=46  stage=placement_requested  legal=1A dueAt=627  factors=["Time waiting:6","Statutory timing:30","Active blocker:10"]

Total open movements in queue: 41
```

WF-001 is rank 6, not rank 1. WF-005 does not appear in tier 1 at all — its `urgency` field is
`2` (`ward-movements.ts`), a different tier entirely, so it never competes for the top rank
regardless of score. The claim as written is false.

What makes this worse than a simple slip: the same report correctly identifies WF-303 as "the
genuine top-tier-1 movement" one section earlier, in "Judgment call: the referral test" — so the
report contains two mutually contradictory statements about which record tops the queue, and the
false one is the one stated as the explanation for why a required gate passed. The gate genuinely
did pass (I have no reason to doubt "24 passed") — this is not a code defect. But it is exactly
the "verify, never assert" failure this project's evidence rules exist to catch: a specific,
falsifiable factual claim, offered with quoted `dueAt` values as if checked, that a two-minute
independent computation shows is wrong.

### Minor 1 — `ED_ACCESS_TARGET_MINUTES`'s test pins the value, not the quarantine

Repo-wide grep for `ED_ACCESS_TARGET_MINUTES` returns exactly three lines: its definition
(`ward-model.ts:65`), the test import, and the test assertion (`tests/ward-model.test.ts`). It is
genuinely unused anywhere else — confirmed clean.

But "pinned by a test" here means only "the numeric value 240 is pinned." There is no structural
test asserting the invariant the doc comment states ("must never be attached to a `LegalForm`,
never gain a `dueAt`") — that invariant is currently protected only by the pre-existing
anti-3B-`dueAt` guard tests (`ward-model-phase3.test.ts`, `ward-flow-reducer.test.ts`) plus doc
discipline, and those only cover the reducer and the fixture, not a hypothetical new Task 11 code
path. This satisfies the brief's literal wording, and I don't think it's fair to call it
incomplete against what was asked — but it's worth naming so the controller can decide, before
Task 11 starts, whether a stronger structural guard (e.g., extending the
`ward-flow-single-source.test.ts` allow-list pattern to scan for `ED_ACCESS_TARGET_MINUTES` never
co-occurring with `dueAt` in the same object literal) is wanted.

### Minor 2 — WF-303 topping the queue: real, defensible, but thin as a first impression

Confirmed via the live computation above: WF-303's rank-1 position is legitimate. It is tier 1
(`urgency = (303 % 3) + 1 = 1`), and its Form 1A genuinely passed its own, unrelated, unmodified-
by-this-task statutory examination deadline by one minute (`dueAt = NOW_ANCHOR - 1`). Nothing
about this task's diff touches the routine-movement generator or the Form 1A due-date logic — this
rank was always latent in the fixture and was simply masked previously by WF-017's now-deleted
fabricated 3B bonus. The ordering rule itself (`operationalScore`, `queueOrder`) is unchanged
except for the guarded Statutory-timing branch, and WF-009 (rank 2, a 3B with no deadline) rides
entirely on "Time waiting" + "Destinations declined" + "Active blocker" — no Statutory-timing
points, no compensating detention bonus. That is exactly the clinician's rule, correctly rendered.

Where I agree with your framing: this is a task-quality/demo-fidelity concern, not a correctness
defect. WF-303 is anonymous filler — `blocker: "No blocker"`, no escalation detail, generated
purely to fill out "a busy metro night" — with a marginal, barely-over-the-line one-minute breach,
now sitting where every viewer (and Task 12's guided journey) meets the coordinator screen first.
The fixture's two deliberately-authored, clearly-illustrative Form 1A breaches (WF-001 at -15 min
with a real named blocker, WF-005 at -40 min) are two tiers/several ranks away from that
spotlight. Recommend Task 12, or a fixture decision at the controller's discretion, explicitly
choose which record anchors the guided walkthrough rather than implicitly trusting whatever
`queueOrder` happens to produce first — the brief pre-authorized reporting this rather than tuning
the fixture, and reporting it is what I'm doing.

## Verification performed

- **All nine source files that read `.dueAt`** (`priority-queue.tsx`, `shortlist-panel.tsx`,
  `ward-derivations.ts`, `ward-flow-reducer.ts`, `ward-management-console.tsx`, `ward-model.ts`,
  `ward-movements.ts`, `ward-pressure.ts`, `ward-priority.ts`) read line-by-line against the diff.
  Every read is behind an explicit `!== undefined` guard (or an equivalent narrowing check) before
  it reaches `clockState`/`minutesUntil`/arithmetic/string interpolation. No fallback numbers, no
  silent coercion, no sort comparator touches `dueAt` directly.
- **Completeness of the seven/nine-surface list:** `grep -rln "dueAt" --include="*.ts" --include="*.tsx" .`
  (excluding `node_modules`/`.next`) returns exactly the 9 source files and 6 test files already
  in the diff, plus nothing else in the whole tree (no other module, API route, or non-ward
  surface reads `dueAt`). The brief's "seven surfaces" table underclaimed by call-site count (some
  files have two guarded sites) but the file-level coverage is complete.
- **Type-level proof that `undefined` cannot reach arithmetic:** mutated
  `priority-queue.tsx:87` from
  `const legalBreached = legalDueAt !== undefined && clockState(legalDueAt, now) === "breached";`
  to `const legalBreached = clockState(legalDueAt, now) === "breached";`, printed the edited line
  back, ran `npx tsc --noEmit -p tsconfig.json`:
  `error TS2345: Argument of type 'number | undefined' is not assignable to parameter of type 'number'.`
  Reverted from a byte-identical backup (`diff` produced no output), re-ran `tsc --noEmit`:
  empty output, exit 0. This means the guard is not just today's discipline — `clockState`'s
  signature (`due: Instant`, non-optional) makes any future regression here a compile error, not
  just a hoped-for review catch.
- **`ED_ACCESS_TARGET_MINUTES` quarantine:** repo-wide grep, three hits total, all accounted for
  (see Minor 1).
- **Live functional check of queue order and the clinician's rule:** ran the real
  `queueOrder`/`operationalScore` functions against the real `wardMovements` fixture via `tsx`
  (temporary script under `scripts/`, deleted after use, `git status` confirmed clean). Output
  quoted under Important 2. This both disproves the report's WF-001/WF-005 claim and independently
  confirms WF-009 (a `dueAt`-less 3B) scores with no "Statutory timing" factor and no compensating
  bonus — direct proof of the clinician's rule end to end, not just a code-reading inference.
- **WF-002 (the new referral-test selection):** read its fixture record directly
  (`ward-movements.ts:32-50`): `stage: "destination_review"`, `legalStatus: "Voluntary"`, no
  `legalForm` key at all. Confirmed `destination_review` is in `REFERRABLE_MOVEMENT_STAGES`
  (`ward-flow-reducer.ts:17`). The test's downstream assertions (parallel-referral text, absence
  of "Confirm placement") are identity-agnostic, so nothing was weakened by the swap — it is a
  strictly more stable choice than the blind `.first()` it replaced, exactly as the report argues.
- **Non-vacuous test shape:** read every new/changed test. The phase-3 fixture guard
  (`"never gives a Form 3B a dueAt, and never omits one from a Form 1A"`) accumulates both id
  lists and asserts both non-empty before the per-record loop — correct by construction, matches
  the brief's explicit anti-vacuity requirement. The other new tests (`ward-derivations.test.ts`,
  `ward-pressure.test.ts`, `ward-priority.test.ts`) are single-record/single-scenario assertions,
  not loops, so the vacuous-empty-loop failure mode does not apply to them.
- **Attempted to reproduce the "look at the screen" step myself** against the same running dev
  server (`http://localhost:3718`, confirmed via `/api/local-project-id` to be this project) using
  the same class of browser tooling. Reproduced the identical symptom the implementer reported:
  `computer{action:"screenshot"}` fails with "the Browser pane is not displayed, so the page is
  not compositing frames" even on a fresh navigation, and `get_page_text`/a direct
  `document.body.innerText` read via injected JS both show the app permanently stuck on its
  loading skeleton for `/ward-management` specifically (confirmed via `location.href` that the
  route really did load, `document.readyState === "complete"`) while `location.href` and
  `readyState` prove the navigation itself succeeded. I could not independently complete the
  "look at the screen" requirement either, for what appears to be the same environmental reason
  the implementer already diagnosed (a delegated/background browser session that cannot composite
  frames). This is an unmet requirement in the brief, not resolved by this review, and someone
  with a normal interactive browser session should still do it.
- **Fixture untouched-fields check:** confirmed via the diff hunks themselves that WF-003/009/017
  changed only their `legalForm.dueAt` line; `examination.at` offsets (-60, -100, -260) are
  unchanged in the same hunks.
- **Gate results:** not re-run in full (avoiding duplicate load per the review method); I relied on
  the orchestrator's own independently-obtained counts (tsc clean; 114 node-env; 6 jsdom, one file
  per invocation; 24 Playwright) as the baseline, and used the type-level mutation plus the live
  functional computation above as my own independent, non-duplicative evidence on top of that
  baseline.

## Files referenced

- `src/components/ward-management/ward-model.ts`
- `src/components/ward-management/ward-flow-reducer.ts`
- `src/components/ward-management/ward-movements.ts`
- `src/components/ward-management/coordinator/priority-queue.tsx`
- `src/components/ward-management/coordinator/shortlist-panel.tsx`
- `src/components/ward-management/ward-derivations.ts`
- `src/components/ward-management/ward-pressure.ts`
- `src/components/ward-management/ward-priority.ts`
- `src/components/ward-management/ward-management-console.tsx`
- `src/components/ward-management/ward-clock.ts`
- `tests/ui-ward-coordinator.spec.ts` (lines 213-278, 605-654, 914-951)
- `tests/ward-model.test.ts`, `tests/ward-model-phase3.test.ts`, `tests/ward-flow-reducer.test.ts`,
  `tests/ward-derivations.test.ts`, `tests/ward-pressure.test.ts`, `tests/ward-priority.test.ts`
