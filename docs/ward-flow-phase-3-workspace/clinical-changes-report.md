# Clinical changes report — ED access target to 24h, and "Bed need confirmed" priority factor

Both changes came directly from the product owner (a practising psychiatrist), answering a
direct question on 2026-08-22: "for question 3… the reality is in ED that a patient needs
review before they are referred for a bed as they may not need a bed. Update this behaviour.
Also change the 4 hour limit to 24 for patients in ED." Implemented as two separate commits so
either can be reverted alone.

## Commit 1 — ED access target 240 → 1440 minutes

**SHA:** `f08abf3df1de495348ea0aff4b7bbd316fd8ba85`

### Every site changed, and how I confirmed I found them all

Searched `src/`, `tests/`, `docs/superpowers/` for four independent patterns before touching
anything: `ED_ACCESS_TARGET_MINUTES` (every reference), case-insensitive `four.hour`, the
literal `4h 00m`/`4h00m`/`4h 0m`, and bare `240` near ED/access context. That surfaced:

- `src/components/ward-management/ward-model.ts:65` — the constant. Value changed 240 → 1440;
  doc comment rewritten to state the new figure and record that the product owner superseded
  the four-hour figure on 2026-08-22, while keeping every original safeguard clause (counted up
  from `openedAt`, never a `LegalForm`/`dueAt`, never feeds a legal-breach count or eligibility
  gate) verbatim.
- `tests/ward-model.test.ts:47` — `expect(ED_ACCESS_TARGET_MINUTES).toBe(240)` repinned to
  `1440`; explanatory comment updated to note the supersession.
- `src/components/ward-management/ed/ed-screen.tsx:234` — governance banner reworded from "The
  four-hour figure below…" to "The 24-hour figure below…".
- `docs/superpowers/specs/2026-08-19-ward-flow-phase-3-role-screens-design.md:231` — spec text
  changed from "the four-hour access target" to "the departmental access target", with a dated
  `> **Superseded 2026-08-22.**` blockquote directly under it recording the old and new values
  and naming `ward-model.ts` as the current source of truth.
- `tests/ward-flow-single-source.test.ts:181` — explanatory comment on the two static guards
  updated to state the figure was four hours "when this guard was written" and was superseded to
  24 hours on 2026-08-22, without changing the guards themselves.

No Playwright assertion anywhere referenced the rendered target string (`ward-ed-access-target`
testid appears only in `ed-screen.tsx` itself), and no other bare `240` in the codebase was tied
to this constant (`ward-movements.ts:705` and `ward-priority.test.ts:26` are both unrelated
minute-offsets). `docs/superpowers/plans/2026-08-19-ward-flow-phase-3-role-screens.md` still says
"four-hour access target" — left untouched deliberately, since the task scoped my spec-editing
permission to `docs/superpowers/specs/` only; that plan file is a historical implementation log,
not a live behavioural contract.

### What did not change

Verified by re-reading `ed-screen.tsx`'s `accessTargetLine` function and the single-source guard
tests: the figure is still counted up from `movement.openedAt`, never touches a `LegalForm`,
never gains a `dueAt`, and the rendered wording (`"${over} over/under the ${target} departmental
access target"`) still contains none of "due", "deadline", "breach", "overdue" or "legal". The two
static guards in `tests/ward-flow-single-source.test.ts` that quarantine this constant from
`LegalForm` construction passed unmodified.

### Arithmetic sanity check against real data

`NOW_ANCHOR = 642`. Every movement's `openedAt` offset in `ward-movements.ts` ranges from -40 to
-959 minutes (seeded movements go up to -600; the generated block's `60 + ((index * 37) % 900)`
tops out at 959). So the maximum time-in-department anywhere in the fixture is under 16 hours —
below the new 24-hour target. Confirmed by screenshot (below): every ED row now reads "under" the
target (e.g. "18h 30m under the 24h 00m departmental access target"), none reads "over", and no
duration renders as negative or nonsensical. This is a real property of the fixture, not a defect
— nothing in this fixture waits 24+ hours.

## Commit 2 — "Bed need confirmed" priority factor

**SHA:** `2affc37d957ccbaaf05449feb7c2c7b5835a3afc`

**Note on how this commit was made:** partway through my final verification pass I found this
commit already present in the repository — I did not personally run `git commit` for it. I
compared its full diff byte-for-byte against my own staged, mutation-tested changes
(`src/components/ward-management/ward-priority.ts`, `tests/ward-priority.test.ts`,
`tests/ui-ward-coordinator.spec.ts`) before accepting it, and it is identical: same three files,
same line counts (32/69/45), same content. This worktree has a documented history of concurrent
sessions sharing it (see `.superpowers/sdd/.../concurrent-session-inventory.md` from earlier the
same day), which is consistent with what happened here. I did not re-commit or alter it.

### The factor

Added to `operationalScore` in `src/components/ward-management/ward-priority.ts`: a movement
whose `examination.outcome === "inpatient_order"` gets a new factor, **"Bed need confirmed"**,
worth **25 points**, with detail text `"Examination outcome: inpatient order — bed confirmed as
needed"`.

### Points weight and justification

25, chosen deliberately relative to the existing scale (all multiples of 5): Time waiting caps at
40, Statutory timing tiers are due=10/critical=20/breached=30, Destinations declined caps at 15,
Active blocker=10, Transport delay=5. 25 sits **between the critical (20) and breached (30)
statutory-timing tiers** — stronger evidence than an as-yet-unbreached legal timer, but this is
not a deadline and must not be inflated to read like one. Simulated against the real fixture at
weights 15/20/25: 20 produced a tie between WF-017 and WF-303 (both landing on 61, resolved only
by incidental array order); 25 produces clean separation with no ties anywhere in the top ten
tier-1 rows, which is why I chose it over 20.

### Scope discipline

Does **not** gate `REFER_TO_UNITS` on examination, per the task's explicit instruction. Measured
against the fixture: only 2 of 17 open movements at a referable stage carry an `inpatient_order`
examination, and 23 further open movements past that stage carry no examination at all — gating
would make most of the fixture unreachable. That question is with the product owner.

### The three global constraints

1. **Urgency tier still leads; the factor is inside `operationalScore` only**, which
   `queueOrder` uses solely as the within-tier tiebreak. The function's own doc comment ("blind
   to `movement.urgency`") is unchanged and the "never reads urgency" test still passes.
2. **Never described as severity, acuity or risk.** Named "Bed need confirmed"; detail text
   states only what the model recorded (an examination outcome), not a clinical assessment.
3. **Display less rather than something plausible.** Detail text says exactly what is known —
   the recorded outcome — nothing about time elapsed, confidence, or anything not directly in
   `movement.examination`.

### The documented gap (voluntary patients)

21 of the fixture's 41 open movements are voluntary and carry no `legalForm` at all, so they
never receive a Mental Health Act examination and can never earn this factor — even though a
voluntary patient is, in reality, just as much reviewed before a bed is sought. The model has no
way to evidence that review. This is recorded as a `KNOWN GAP` code comment directly above the
factor in `ward-priority.ts`, stating plainly that no proxy was invented and that the factor
rewards detained-and-examined patients only. Not papered over.

### Before/after top-five queue ordering (tier 1, real fixture, `NOW_ANCHOR`)

| Rank | Before | Score | Examined? |     | After      | Score  | Examined? |
| ---- | ------ | ----- | --------- | --- | ---------- | ------ | --------- |
| 1    | WF-303 | 61    | no        |     | **WF-009** | **78** | **yes**   |
| 2    | WF-009 | 53    | yes       |     | **WF-017** | **66** | **yes**   |
| 3    | WF-312 | 50    | no        |     | WF-303     | 61     | no        |
| 4    | WF-315 | 50    | no        |     | **WF-003** | **52** | **yes**   |
| 5    | WF-306 | 48    | no        |     | WF-312     | 50     | no        |

**An examined patient now leads the entire tier-1 queue.** Before the change, WF-009
(examination outcome `inpatient_order`) sat at rank 2, behind the unexamined WF-303. After, WF-009
leads at rank 1 (78), WF-017 (also examined) jumps to rank 2 (66), and WF-303 — still carrying a
genuinely breached Form 1A deadline but no examination — drops to rank 3. WF-003 (examined) enters
the top five at rank 4, displacing WF-315. This is exactly the clinician's rule reaching the
screen: confirmed need for a bed outranks an unassessed wait, even one with a breached statutory
timer attached.

### Playwright assertions that moved, and why

`tests/ui-ward-coordinator.spec.ts`, test "orders by clinical tier first and labels the score as
operational, not clinical": previously asserted the queue's first row shows "passed its deadline"
(true when WF-303 led) and the second row does not. Since WF-009 and WF-017 (both examined, both
carrying a Form 3B with no `dueAt` and so never breached) now occupy rows 1 and 2, neither can
ever show that text — this is not a bug, it is the intended reordering. Rewrote the assertion to
check firstRow/secondRow do **not** show the breach line, and separately pinned `ward-queue-row-
WF-303` by id to prove the breach line still renders correctly for the one movement that actually
has it — same pattern already used elsewhere in this file for fixture facts tied to a specific
movement rather than to row position. Documented the reasoning in a comment naming the clinician's
factor and dating it.

Test "draws the selected movement's routes…": used `rows.first()` to get "whichever movement
currently ranks first" and then separately clicked WF-009 by id to prove the routing logic holds
for a second, different movement. Since WF-009 now often _is_ rank 1, this could silently
degenerate into clicking the same movement twice and passing by tautology. Added a `:not(...)`
exclusion for WF-009 to the first-row locator plus an explicit assertion that the two ids differ,
with a comment explaining why the exclusion exists.

Updated two stale narrative comments (in the "shows a failing gate" test and its inline
walkthrough) that said "WF-303 and WF-009 rank first and second" / "WF-009 is queue row 2" — no
longer true; corrected without changing that test's behaviour, since it already selected both
movements by id, not by position.

I did not touch any assertion where the ordering claim still held.

## Gate commands run, with decisive output

All commands run directly in the ward-management-design worktree at
`C:\Users\joshs\.codex\worktrees\ward-management-design\Database`, dev server already running
at `http://localhost:3718` (confirmed via `/api/local-project-id` before starting).

**Typecheck**, run after each commit's edits:
`npx tsc --noEmit -p tsconfig.json` → no output (clean) both times. One run mid-Commit-2
transiently failed with `error TS6053: File '…/artifacts/probe7/order.ts' not found` — that path
does not exist in this repo and was gone on immediate retry, consistent with a concurrent
session's transient scratch file; retry was clean.

**Node-env ward suite**, one invocation, both after Commit 1 and after Commit 2:

- After Commit 1: `Test Files 11 passed (11)` / `Tests 143 passed (143)` — matches the stated
  baseline exactly.
- After Commit 2: `Test Files 11 passed (11)` / `Tests 147 passed (147)` — **+4 from the four new
  tests I added to `ward-priority.test.ts`** (see Mutation testing below). No other file's count
  moved.

**jsdom, one file per invocation**, run after Commit 2 (also run after Commit 1 with identical
counts):

- `tests/ward-screen.dom.test.tsx` → `Tests 3 passed (3)`
- `tests/ward-flow-clock-consistency.dom.test.tsx` → `Tests 1 passed (1)`
- `tests/ward-flow-provider.dom.test.tsx` → `Tests 4 passed (4)`
- `tests/ward-flow-queue-selection.dom.test.tsx` → `Tests 1 passed (1)`

All four counts match the stated baseline in every run (no `Test Files no tests` occurrence
observed).

**Ward Chromium gate**, chromium only, all three ward specs, routes warmed with `curl` first:

- After Commit 1: `38 passed (2.4m)`, exit code 0.
- After Commit 2, final run: `38 passed (7.2m)`, exit code 0 — slower than Commit 1's run (system
  under load from concurrent sessions in this same worktree), but the count is the evidence, and
  it matches the stated baseline exactly.

**lint**, tried twice: both times printed
`node --max-old-space-size=8192 ./node_modules/eslint/bin/eslint.js src tests scripts worker
supabase playwright eslint.config.mjs next.config.ts playwright.config.ts
playwright.visual.config.ts vitest.config.mts --max-warnings 0 --no-error-on-unmatched-pattern
--cache --cache-location node_modules/.cache/eslint/` with no `DATABASE_HEAVY_RUN_ADMISSION_BUSY`
marker, no error output, exit 0 both times — a real, observed pass.

**Not run:** the three-browser Playwright set, `verify:ui`, `verify:release`, guard-push, and
anything touching OpenAI/Supabase/GitHub Actions/a live database — all explicitly prohibited by
the task.

## Baselines that moved, and why

Only one: the Node-env ward-suite total went from **143 (baseline) → 147 after Commit 2**, a
**+4** delta entirely accounted for by the four new tests added to `tests/ward-priority.test.ts`
(see below). Every other count — Node-env file count (11), all four jsdom file counts, and the
Chromium gate's 38 — stayed exactly at baseline through both commits.

## Mutation testing

Every mutation below: edit made, edited line printed back from the file, test run, failure
observed, reverted, green confirmed. None survived a mutation that should have killed it — no
mistimed mutations, no untestable assertions to report.

**Commit 1** — `tests/ward-model.test.ts:48`, mutated `toBe(1440)` → `toBe(240)`:

```
AssertionError: expected 1440 to be 240
```

Reverted; confirmed green (`1 passed`).

**Commit 2, vitest, four mutations against `ward-priority.ts:88-95`:**

1. `points: 25` → `points: 20`. Test "awards Bed need confirmed points when…":
   `AssertionError: expected 20 to be 25`. Reverted.
2. Condition `movement.examination?.outcome === "inpatient_order"` → `movement.examination !==
undefined`. Test "does not award Bed need confirmed points for any other examination
   outcome…": `AssertionError: expected { label: 'Bed need confirmed', … } to be undefined`.
   Reverted.
3. `points: 25` → `points: 0`. Two tests killed by the same mutation, run separately:
   - "ranks a movement with a confirmed bed need above an otherwise-identical unassessed one":
     `AssertionError: expected 16 to be greater than 16`.
   - "puts a tier 1 movement with a confirmed bed need ahead of a tier 1 movement nobody has
     assessed": `AssertionError: expected 1 to be less than 0`.
     Reverted; full `ward-priority.test.ts` confirmed green at 18/18 after revert.

**Commit 2, Playwright, three mutations against `tests/ui-ward-coordinator.spec.ts`:**

1. `firstRow).not.toContainText("passed its deadline")` → `.toContainText(...)`. Failed:
   `Received string: "WF-009Tier 1 · most urgent7h 00m waitingAdult · Secure · from
PEELOperational 78"` (no breach text present, as expected). Reverted.
2. `breachedRow).toContainText("passed its deadline")` → `.not.toContainText(...)`. Failed:
   `Received string: "WF-303Tier 1 · most urgent7h 51m waitingAdult · Open · from
PEELOperational 61Form 1A passed its deadline 1 min ago"` (breach text present, as expected).
   Reverted.
3. Removed the `:not([data-testid="ward-queue-row-WF-009"])` exclusion from the first-row
   locator. Failed: `Error: the exclusion above must keep this genuinely different from WF-009 —
Expected: not "WF-009"`, i.e. row 1 really is WF-009 without the exclusion. Reverted; both
   affected tests reran green individually after revert.

## Screenshots

Both captured via a temporary Node script using `playwright`'s `chromium.launch()` directly
against the already-running dev server, viewport 1440×1024, deleted immediately after use (no
scratch files left in the repo — `git status --porcelain` confirmed clean of anything beyond the
gitignored `artifacts/` PNGs).

**`artifacts/ward-management/phase3-ed-24h.png`** — Peel Health Campus ED screen. Banner reads
"The 24-hour figure below is this department's own access target — a performance measure it is
judged on, not a Mental Health Act deadline." Every visible patient row shows "under" the target
(e.g. "18h 30m under the 24h 00m departmental access target", "17h 00m under…", "19h 50m
under…") — **none read "over"**, which is correct given this fixture's longest wait is under 16
hours (see Arithmetic sanity check above), not a defect. Nothing on screen uses "due", "deadline",
"breach", "overdue" or "legal" near the target line; the only breach-adjacent language present
belongs to a genuinely separate legal-clock element (unaffected by this change).

**`artifacts/ward-management/phase3-queue-reviewed.png`** — coordinator screen, priority queue.
Visible tier-1 rows, top to bottom with their operational scores: **WF-009 (78, examined,
inpatient_order)**, **WF-017 (66, examined, inpatient_order)**, WF-303 (61, "Form 1A passed its
deadline 1 min ago", not examined), WF-003 (52, examined), WF-312 (50, not examined), WF-315 (50,
not examined). This matches the before/after table above exactly. **Yes — an examined patient
(WF-009) now outranks every unexamined patient in the queue**, including one (WF-303) with an
active breached statutory deadline.
