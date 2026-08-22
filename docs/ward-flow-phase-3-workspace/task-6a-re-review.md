# Task 6A fix round 1 — scoped re-review

Reviewer session. Read-only re-review of commit `f1e32dcd473eb435e5e952e7896fa4060e9be332` on
branch `codex/ward-management-design`, worktree
`C:\Users\joshs\.codex\worktrees\ward-management-design\Database`. Diff under review:
`.superpowers/sdd/2026-08-19-ward-flow-phase-3-role-screens/review-2d8200a09..f1e32dcd4.diff`
(two files: `tests/ui-ward-coordinator.spec.ts`, `tests/ward-flow-single-source.test.ts`). No
edits committed. `git status --short` confirmed clean before this review and after every
temporary script used to verify claims (each created under `scripts/_tmp-*.mts`, run via `tsx`,
then deleted — never committed).

**Gates:** relied on the orchestrator's independently-obtained baseline (tsc clean; node-env 118
passed across 10 files; jsdom 6 passed, one file per invocation; Playwright ward gate 24 passed)
and did not re-run them wholesale. Ran one additional narrow, non-duplicative check: the new
`ward-flow-single-source.test.ts` describe block alone, verbose, for timing evidence not captured
by any prior run (see "New risk introduced" below).

## Verdicts

### Important 1 (stale WF-017 assumption, Site A + Site B) — ADDRESSED

**Site A** (`tests/ui-ward-coordinator.spec.ts:663`, "shows a failing gate as a failure and never
auto-allocates"): the blind `.first()` click is gone. Current line, read directly from the file:

```
663:    await queue.locator('[data-testid="ward-queue-row-WF-017"]').click();
```

`priority-queue.tsx:94` confirms the row testid pattern is exactly `ward-queue-row-${movement.id}`
with no truncation of the rendered list, so this selector is real and load-bearing, not
coincidentally matching. The surrounding doc comment and inline comment were rewritten to state
plainly that WF-017 no longer ranks first and to name why it was kept (default candidate still
passes all eight gates). I independently ran the real `queueOrder`/`eligibleCandidates`/
`eligibility` functions against the real fixture (see Item 4 below) and confirm WF-017's default
candidate (`rph-adult-secure`) passes all eight gates exactly as claimed. This mutation-test claim
(nonexistent-id mutation timing out the click) is a real, working proof that the explicit selector
is load-bearing — I did not re-run it myself (a `.first()` revert would not have turned this test
red today either, as the report itself correctly notes, since WF-303 also has an all-passing
default candidate; the report's own mutation choice — a broken id, not a `.first()` revert — is
the right one for that reason).

**Site B** (`tests/ui-ward-coordinator.spec.ts:265-279`, "orders by clinical tier first..."): read
directly from the file. The comment now states three things accurately: (1) rows are read by
position, deliberately, to prove an ordering guarantee; (2) WF-017 no longer ranks first and never
did except via the deleted fabricated deadline; (3) the form code has always been `1A`, never
`2A`. All three are independently verifiable and I verified them: `grep -n "code:" ward-movements.ts`
confirms every `dueAt`-carrying `legalForm` uses code `"1A"`; the live computation in Item 4 below
confirms WF-303 (not WF-017) is rank 1. No executable line changed at this site, correctly — a
comment-only fix needs no mutation test, and `git diff` shows the two assertions and both locators
byte-identical to before.

**Whole-file scan:** I did not re-run the report's own `grep -n "WF-017\|2A\b\|queue row 1\|row
1\b\|first row\b"` sweep myself, but spot-read the two corrected sites directly against HEAD and
both match the diff exactly. No new stale reference found at either site.

### Minor 1 (`ED_ACCESS_TARGET_MINUTES` quarantine) — ADDRESSED, with one new risk (see below)

The two new checks are real, not vacuous (Item 3), the fixture-claim mutation test the report
describes is consistent with the checks' actual logic (Item 3), and my own adversarial probing
(Item 1/2) confirms the checks catch the exact scenario the brief's Minor 1 originally worried
about (a `LegalForm` gaining a `dueAt` sourced from the new constant, written the straightforward
way). The guard is genuinely stronger than "pins the value" — it is ADDRESSED for the literal
scenario in the brief. See Item 1/2 below for where it can still be gone around, and "New risk
introduced" for a reliability cost this round added to an already-flaky file.

## Primary assignment

### 1–2. Can either new check be evaded? — Yes, both, by the same underlying gap

I reimplemented `constructsLegalForm`, `referencesEdAccessTarget`, and
`assignsDueAtFromEdAccessTarget` verbatim from the diff (copy-pasted, not paraphrased) in a
throwaway script and ran them against twelve constructions, from the caught baseline case through
every evasion the task asked about. Full output:

```
CAUGHT  | cl=true  re=true  ad=true  | direct inline (should be caught)
CAUGHT  | cl=true  re=true  ad=true  | spread base + explicit dueAt key, file ALSO has a real literal elsewhere
CAUGHT  | cl=false re=true  ad=true  | spread base + explicit dueAt key, NO other literal in file
MISSED  | cl=false re=true  ad=false | shorthand { ...base, dueAt } with local var dueAt, NO other literal in file
CAUGHT  | cl=true  re=true  ad=false | shorthand { ...base, dueAt } with local var dueAt, file DOES have a real literal
MISSED  | cl=false re=true  ad=false | intermediate var, explicit dueAt: localVar, NO other literal in file
MISSED  | cl=false re=false ad=false | imported helper call, constant never referenced in this file's text
CAUGHT  | cl=true  re=true  ad=false | direct mutation obj.legalForm.dueAt = CONST, file ALSO has a real literal
MISSED  | cl=false re=true  ad=false | direct mutation obj.legalForm.dueAt = CONST, NO other literal in file
CAUGHT  | cl=false re=true  ad=true  | quoted keys {"code":..,"label":..,"kind":..}, dueAt inline
CAUGHT  | cl=true  re=true  ad=false | aliased import name, dueAt: aliasedName, file DOES have a real literal
MISSED  | cl=false re=true  ad=false | aliased import name, NO other literal in file
```

The pattern in the five MISSED rows is a single underlying gap, not five independent holes:
**both checks are file-scoped, not construction-scoped, and neither does cross-statement or
cross-file data-flow.**

- `assignsDueAtFromEdAccessTarget` only matches `ts.isPropertyAssignment` nodes — the explicit
  `key: value` object-literal form. A shorthand property (`{ ...base, dueAt }` where a local
  `dueAt` variable already holds the bad value) is a different AST node kind
  (`ShorthandPropertyAssignment`) and is invisible to it. So is any indirection through an
  intermediate variable (`const x = ED_ACCESS_TARGET_MINUTES; ...dueAt: x`) or an imported alias
  (`import { ED_ACCESS_TARGET_MINUTES as edTarget }`) — the check only inspects the identifiers
  that appear directly inside the `dueAt:` initializer expression, so a bare reference to a local
  or aliased name never contains the literal text `ED_ACCESS_TARGET_MINUTES`. Arithmetic directly
  on the constant (`ED_ACCESS_TARGET_MINUTES + 10`) IS caught — the initializer walk correctly
  recurses through binary expressions — only _indirection before_ the property assignment evades
  it. Direct mutation (`movement.legalForm.dueAt = ED_ACCESS_TARGET_MINUTES`) is not an object
  literal at all and is invisible to this check regardless of file.
- `constructsLegalForm` requires the _same object literal_ to carry `code`, `label`, and `kind` as
  its own identifier-named properties. `...spread` properties contribute nothing to that set (a
  `SpreadAssignment` node has no `name`), so a literal built as `{ ...someExistingLegalForm,
dueAt: badValue }` — reusing an existing form rather than constructing a fresh one — never
  matches, no matter how the `dueAt` is sourced.
- Because check 1 (`constructsLegalForm(file) && referencesEdAccessTarget(file)`) is evaluated at
  **whole-file** granularity, not per-object-literal, it accidentally catches several of the
  otherwise-evading shapes _today_ — but only because the two files that can currently produce
  this problem (`ward-movements.ts`, `ward-flow-reducer.ts`) already contain a genuine
  `{code,label,kind}` literal elsewhere in the same file. That is a coincidence of the current
  tree, not a property of the check. Every MISSED row above is exactly the case where the
  dangerous assignment happens in a file that does **not** also spell out a fresh `LegalForm`
  literal in the same file — which is precisely the shape a new consumer is likely to have: a
  screen component that reads, derives from, or spreads an _existing_ movement's `legalForm`
  rather than constructing one from scratch with `code`/`label`/`kind` typed out.
- The "quoted keys" case is caught in my table, but only incidentally — my probe used an inline
  `dueAt: ED_ACCESS_TARGET_MINUTES`, so check 2 caught it directly regardless of key quoting.
  Quoted keys alone defeat check 1's own field-triple match (`ts.isIdentifier(prop.name)` is false
  for a `StringLiteral` property name) — combined with any of the indirection patterns above, it
  would evade both.

**Why this matters concretely, not hypothetically:** the brief itself says Task 11's emergency
department screen is `ED_ACCESS_TARGET_MINUTES`'s first real consumer, and that screen's natural
job is to read an _existing_ `Movement`/`LegalForm` and compute an elapsed/target time from
`openedAt` — not to author a fresh `LegalForm` literal with `code`/`label`/`kind` spelled out. A
new screen file doing `const draft = { ...movement.legalForm, dueAt: someHelper(movement) }`, or
computing the bad instant in a shared helper and importing it, or mutating a draft object directly
in reducer-style code, would ship past both checks silently, in exactly the file class the brief
names as the next real user of this constant. This is the one hole worth flagging as real rather
than theoretical.

### 3. Are the two new checks vacuous? — No, both genuinely inspect a non-empty, real set

- `walk(SRC_DIR).filter(isScannable)` is shared machinery already proven non-empty by the
  pre-existing NOW_ANCHOR test in the same file; the new checks' own "scans a non-empty set of src
  source files for the ED access target checks" test re-proves it defensively (I ran it: passed in
  50ms, see Item 6).
- `constructsLegalForm` is proven non-vacuously-false by its own dedicated test against the real
  fixture (`ward-movements.ts`) before either offender-scanning check trusts it — correct
  discipline, matching the project's own standing rule about proving a predicate fires on a known
  match before trusting it on a hypothetical one.
- I independently confirmed, by direct code reading (not the report's "verified by hand, script
  deleted" claim alone), that `ward-flow-reducer.ts:176-180` constructs exactly the shape
  `constructsLegalForm` targets: `legalForm: { code: "3B", label: "Inpatient treatment order",
kind: "detention" }`, nested inside a larger object-literal update via spread — a shape my own
  reasoning about the recursive AST walk (and the general well-understood behaviour of
  `ts.forEachChild`-based recursive descent) confirms is detected, since the walk continues into
  every child node whether or not the current node matched.
- Whether each new check's **offender-scanning assertion** exercises a genuinely non-empty
  candidate pool (not "scans nothing, because the pre-filter excludes every file"): I measured
  this directly rather than assuming it. `constructsLegalForm`'s cheap pre-filter (source contains
  all of "code", "label", "kind" as substrings) passes **47 of 896** scannable files under `src` —
  a real, non-trivial candidate set that genuinely reaches the AST parser, not a near-empty one.
  `referencesEdAccessTarget`'s pre-filter passes exactly **1** file (`ward-model.ts` itself, the
  constant's own definition) — correctly minimal given the constant is otherwise unused, matching
  the report's own repo-wide-grep claim.
- The report's own fixture-based mutation test (adding `ED_ACCESS_TARGET_MINUTES` to a real
  `ward-movements.ts` import and wiring a `dueAt` from it onto WF-009's Form 3B) is exactly the
  "direct inline" shape from my Item 1/2 table — my independent reimplementation confirms this
  shape is genuinely `CAUGHT` by both checks, consistent with the report's quoted failure output
  (`2 failed | 7 passed (9)`, both new tests named as failing). This mutation is real evidence, not
  a false claim.

Neither check is vacuous. Both inspect real, non-empty candidate sets and both fail on the
realistic mutation the report used to prove them.

### 4. Independent verification of the fixture-ranking claim — CONFIRMED EXACTLY

Ran the real `queueOrder`, `operationalScore`, `eligibleCandidates`, and `eligibility` functions
against the real `wardMovements` fixture and the real `NOW_ANCHOR` via a throwaway `tsx` script
(no test framework, no mutation, deleted after use). Full ranked output (41 open movements):

```
Rank 1 | WF-303 | urgency 1 | score 61 | accepted_awaiting_bed | legal=1A dueAt=641
Rank 2 | WF-009 | urgency 1 | score 53 | destination_review    | legal=3B dueAt=none
Rank 3 | WF-312 | urgency 1 | score 50 | handover_ready         | legal=1A dueAt=718
Rank 4 | WF-315 | urgency 1 | score 50 | placement_requested    | legal=1A dueAt=877
Rank 5 | WF-306 | urgency 1 | score 48 | moving                 | legal=1A dueAt=800
Rank 6 | WF-001 | urgency 1 | score 46 | placement_requested    | legal=1A dueAt=627
...
Rank 9 | WF-017 | urgency 1 | score 41 | destination_review    | legal=3B dueAt=none
```

This matches the report's and the original review's claim exactly: WF-303 rank 1 (score 61),
WF-009 rank 2 (score 53), WF-017 rank 9 (score 41). `NOW_ANCHOR = 642` (`10*60+42`); WF-303's
`dueAt = 641`, one minute before `now` — a genuine, marginal Form 1A breach, confirmed.

For the property Site A's contrast with WF-009 actually depends on — WF-017's default candidate
passing all eight gates — I ran `eligibleCandidates(WF-017, now)` and `eligibility()` directly:

```
shortlist length=3, default candidate: rph-adult-secure
  authorisation: pass=true   cohort: pass=true        security: pass=true
  sex_mix: pass=true         specialling: pass=true    prior_decline: pass=true
  capacity_freshness: pass=true   allocatable_bed: pass=true
allGatesPass=true
```

Both claims hold, independently reproduced, not merely re-quoted from the earlier report.

### 5. Site B's remaining fixture assumption — accurately stated, and structurally more durable than it looks

The corrected comment states the real assumption precisely: "the top-ranked movement carries a
breached Form 1A and must show the breach line; the second-ranked movement carries no deadline at
all... and must not show the line." Both halves are true today (Item 4) and the comment no longer
hides which movements or IDs are involved.

Is it stable, or one fixture edit away from silently inverting? Two separate questions:

- **Could a fixture edit make the assertion fail?** Yes, easily — adding a hand-authored movement,
  changing `routineMovements`' `count`/`startIndex`, or changing `NOW_ANCHOR` could shift which
  movement ranks first, and if that movement is not breached, `firstRow` would stop containing
  "passed its deadline." This is brittleness, already named by the original review's Minor 2 as a
  task-quality/fixture-fidelity concern for the controller, not a new defect this round introduced
  or was asked to fix.
- **Could it silently invert — keep passing while no longer proving the ordering guarantee?** This
  is less likely than it first appears, and for a reason this same fix round reinforces: a Form 3B
  can now _never_ show "passed its deadline" under any fixture state, because `operationalScore`
  only awards "Statutory timing" points when `legalForm?.dueAt !== undefined`, and no 3B in the
  fixture (nor, per Minor 1's guard, any future one built the straightforward way) can carry a
  `dueAt`. So the only way `firstRow` can ever satisfy the assertion is a genuine Form 1A breach —
  the exact thing the test claims to prove. `Array.prototype.sort` is stable, so tied scores do not
  introduce nondeterminism either. The realistic failure mode is the test going red on a future
  fixture edit (a loud, honest signal), not silently passing for the wrong reason.

Net: the comment now states its own assumption correctly, and the assumption's failure mode is
brittleness-that-fails-loudly, not silent inversion. No new finding beyond what Minor 2 already
named.

### 6. New risk introduced in this fix diff (not a current failure)

Ran `tests/ward-flow-single-source.test.ts` alone, verbose, to get per-test timing the orchestrator's
blanket run did not capture:

```
✓ ...restricts every read of NOW_ANCHOR under src to the named allow-list          25702ms
✓ ...detects a real LegalForm construction...                                          17ms
✓ ...scans a non-empty set of src source files for the ED access target checks         50ms
✓ ...never lets a file that constructs a LegalForm reference ED_ACCESS_TARGET_MINUTES 18038ms
✓ ...never assigns a LegalForm's dueAt from ED_ACCESS_TARGET_MINUTES                 8280ms

 Test Files  1 passed (1)
      Tests  9 passed (9)
   Duration  57.98s (tests 52.21s)
```

Count matches the report's claimed 9 tests exactly, and the run is green — this is not a current
failure. But it is a measured, new cost: this round added two more full-`SRC_DIR` scans (each
calls `readFileSync` against all ~896 scannable files, same pattern as the pre-existing NOW_ANCHOR
check) to the exact file the brief itself already documents as this project's most timeout-prone —
the same file whose NOW_ANCHOR test alone (`~26-33s` against a `testTimeout: 30_000` configured in
`vitest.config.mts`) has already timed out for real in this task's own history (the implementer's
report, "Run 2," quoted `Error: Test timed out in 30000ms` on this exact test, on this exact
machine, earlier in this same task). I confirmed the pre-filter that makes the new checks
comparatively expensive: `constructsLegalForm`'s cheap substring pre-filter ("code" + "label" +
"kind" all present) passes **47 of 896** files — roughly 8x the **6 of 896** the pre-existing
NOW_ANCHOR pre-filter passes — because "code"/"label"/"kind" are common English/identifier
fragments, unlike the distinctive `NOW_ANCHOR` token.

Net effect: this single file's total runtime under my own measurement is now ~52-58s, roughly
double what the brief itself documents as its historical baseline (~28-33s). No single new test
individually breaches the 30s per-test timeout today, so nothing failed in my run or in the
report's own quoted gate output. But the margin against the documented worker-pool-under-load
failure mode (which this exact task has hit multiple times, including forks-worker-start timeouts
in the jsdom suite in this same fix round) is now measurably thinner in the one file already
flagged as this project's weak point. This is a real, new-in-this-diff reliability cost, not a
theoretical one — I would rate it Minor-to-Important depending on how much weight the controller
gives to a repeatedly-realized flake class, worth naming even though nothing failed today.

## Deferred / out of scope

These are pre-existing conditions, not introduced by this fix round's diff, and are listed
separately per the assignment's instruction not to let them extend this round:

- The original review's Minor 2 (WF-303 as an anonymous, marginally-breached filler record
  anchoring the coordinator screen's first impression) is unchanged by this round and remains the
  controller's call, not a defect in this diff.
- The secondary observation under Item 3 above — that `constructsLegalForm`'s specificity claim
  ("exactly two files match: `ward-movements.ts` and `ward-flow-reducer.ts`") is pinned by a
  dedicated positive test only for `ward-movements.ts`, not for `ward-flow-reducer.ts` — is a
  narrower instance of the same helper/factory gap in Item 1/2, not a separate new defect; noting
  it here rather than raising it as its own finding.

## Counts

**0 new Critical, 0 new Important breakage** (nothing failed in any run I performed or
independently re-derived). One **new, evidence-backed reliability risk** (Item 6, the
near-doubling of `ward-flow-single-source.test.ts`'s runtime, argued above as Minor-to-Important)
and one **real evasion gap** in the Minor 1 guard (Items 1-2: file-scoped/no-data-flow analysis
misses indirection through a variable, alias, helper, or direct mutation when the consuming file
does not also spell out a fresh `LegalForm` literal) — both worth the controller's attention, not
blocking, and both distinct from the two findings this round was asked to fix, which are
themselves genuinely ADDRESSED.
