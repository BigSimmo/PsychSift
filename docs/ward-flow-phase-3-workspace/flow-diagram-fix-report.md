# Flow-diagram restriction-notice fix — report

Worked at `C:\Users\joshs\.codex\worktrees\ward-management-design\Database`, branch
`codex/ward-management-design`, starting HEAD `3b4bf4152`. Followed
`flow-diagram-fix-brief.md` and spec section 2 decision 9 / section 3.

## Re-measured fixture numbers (do not trust the brief's numbers on sight — re-measured)

Wrote a throwaway probe under `artifacts/probe/` (gitignored, run with `npx tsx`, deleted
afterwards — `git status --porcelain` shows no trace) that imports `wardMovements` and counts
directly, rather than trusting the brief's or my own arithmetic:

```
Total movements: 48
Voluntary movements: 26
Voluntary + Secure movements: 4
Voluntary+Secure ids: WF-301, WF-308, WF-322, WF-329
```

This matches the brief's claim exactly (26 Voluntary, 4 of those Secure, same four ids). I did
not stop at matching the brief, though — the brief's own trap (F9's false claim) was about
_reachability_, not the raw count, so I went further and computed, for each of the four ids,
whether it is actually reachable on the coordinator screen:

- `queueOrder(wardMovements, NOW_ANCHOR)` (the same function the priority queue renders) includes
  all four: WF-301 at position 23, WF-308 at 30, WF-322 at 25, WF-329 at 32 (0-based, 41 open
  movements total, no truncation/virtualisation in `priority-queue.tsx` — every row renders).
- `eligibleCandidates(movement, NOW_ANCHOR, PARALLEL_REFERRAL_CAP)` (what drives the diagram's
  "routed" set) for WF-301, WF-322, WF-329 (all cohort `Adult`) returns all three Secure adult
  wards (`rph-adult-secure`, `fsh-adult-secure`, `rgh-adult-secure`), every one `eligible: true`,
  every one flagged `restrictionNotice` level `voluntary_on_locked`.
- WF-308 (cohort `Older adult`) is a bad pick: its three shortlisted candidates are all `Open`
  security, `eligible: false` — the fixture has no Secure older-adult unit in its top-3 shortlist,
  so WF-308's own Secure-ness never actually surfaces a locked candidate on screen. I did not use
  it.

## Movement pinned: WF-301

Selected **WF-301** by id (never `.first()`, never queue rank). Verified directly from the
fixture object (dumped via the probe, not inferred from field names):

```
{"id":"WF-301","originEdId":"rgh-ed","openedAt":245,"urgency":2,"cohort":"Adult",
"security":"Secure","sex":"Male","specialling":false,"legalStatus":"Voluntary",
"stage":"placement_requested","referredUnitIds":[], ...}
```

- `legalStatus === "Voluntary"` — confirmed.
- Cohort `Adult` — matches the Secure adult wards, so `restrictionNotice` fires for all three
  shortlisted candidates, not just one (belt-and-braces against a stale ineligible candidate).
- Reachable: present in `queueOrder` (position 23 of 41), and its Secure candidates are `routed`
  (`eligibleCandidates` returns them, satisfying the diagram's `routed || isAccepted ||
isReferred` gate at line 462 — none of the three needed `isAccepted`/`isReferred`, `routed`
  alone was enough). Confirmed live in the browser gate below, not just by the probe.

## What changed

**`src/components/ward-management/coordinator/flow-diagram.tsx`**

- Import swapped from `isMoreRestrictiveThanRequired, MORE_RESTRICTIVE_NOTE` to
  `restrictionNotice`.
- The per-unit `moreRestrictive: boolean` computation replaced with `notice: RestrictionNotice |
undefined`, computed the same way shortlist-panel.tsx does: `restrictionNotice(movement, unit)`,
  gated by the **same, unchanged** condition — `routed || isAccepted || isReferred` — so a unit
  the movement is not actually going to still never gets the badge (brief point 4, review finding
  preserved).
- `data-more-restrictive` on the unit button is now `notice ? "true" : undefined` (same boolean
  semantics as before, still present for any other consumer).
- The badge render swapped from the fixed `MORE_RESTRICTIVE_NOTE` string in a single
  `.diagramRestrictiveBadge` span, to `notice.text` (the notice's own wording — never
  re-authored) in a span whose class is `.diagramRestrictiveBadgeProminent` when `notice.level
=== "voluntary_on_locked"`, else `.diagramRestrictiveBadge`. The span also carries
  `data-level={notice.level}` — the same attribute shape shortlist-panel.tsx already uses on its
  own notice spans, so both panels are queryable identically.

**`src/components/ward-management/coordinator/coordinator.module.css`**

- Added `.diagramRestrictiveBadgeProminent` immediately after the existing
  `.diagramRestrictiveBadge` (the "comment anticipating exactly this" the brief pointed at). Same
  shape (border, radius, padding, font-size, weight, `text-wrap: balance`) as the base badge, but
  danger-toned (`--danger-border`, `--danger-bg`, `--danger-text`) instead of warning-toned —
  identical token set to `.shortlistRestrictiveBadgeProminent`, so the diagram and the shortlist
  read as one system. No raw hex, no undeclared literals — every value is an existing design
  token already used elsewhere in the same file.

**How the two levels are visually distinguished:** colour family (amber/warning border+background
+text for `more_restrictive`, red/danger border+background+text for `voluntary_on_locked`) _and_
wording ("More restrictive than this movement requires" vs "Voluntary patient on a locked ward —
review legal status before admission"). Never colour alone — the text differs too, same "never
colour alone" discipline the file's own comments state for forced-colors survival.

## WF-001 assertion update

`tests/ui-ward-coordinator.spec.ts`, test `"states plainly when a candidate ward is more
restrictive than the movement requires"` (WF-001, `Open`/non-Voluntary — exercises only the milder
level):

- Changed the diagram-node assertion from `"More restrictive than required"` (the old
  `MORE_RESTRICTIVE_NOTE` substring) to `"More restrictive than this movement requires"` (the
  `restrictionNotice` `more_restrictive` wording — now identical to the shortlist assertion right
  above it).
- Updated the comment above it: it previously said the diagram is "untouched this task and still
  reads the older `MORE_RESTRICTIVE_NOTE` text, so the two assertions differ" — now false. Replaced
  with a comment stating both panels now read the same `restrictionNotice` wording and the
  assertions are deliberately identical strings.
- Left the negative assertion for the `open` candidates (`.not.toContainText(...)`) and the
  WF-004 Secure-on-Secure "no noise" assertion untouched — brief said keep them, they still pass
  unmodified.

## New test added

Added `"gives a voluntary patient on a locked ward its own, more prominent notice on the
diagram"` immediately after the WF-001 test, in the same file. It:

1. Loads WF-301 via `requireMovement`, asserts `legalStatus === "Voluntary"` as a fixture
   assumption (fails loudly if the fixture ever changes under it, per the file's existing
   convention).
2. Computes `eligibleCandidates(wf301, NOW_ANCHOR, PARALLEL_REFERRAL_CAP)`, filters to
   `unit.security === "Secure"`, asserts at least one exists.
3. Clicks the queue row by id (`ward-queue-row-WF-301`) — never `.first()`, never rank.
4. For every Secure candidate: asserts the shortlist row and the diagram node both contain
   `"Voluntary patient on a locked ward — review legal status before admission"` (the exact
   `restrictionNotice` text, copied verbatim from `ward-derivations.ts` — not re-authored), and
   asserts the diagram node contains a descendant `[data-level="voluntary_on_locked"]` element
   (proving the _prominent_ variant specifically, not merely that some notice rendered).

## Mutation testing — every mutation printed back, run, watched fail, reverted, confirmed green

**Mutation 1 — kills the new WF-301 test.** Reverted `flow-diagram.tsx`'s `notice` computation to
literally the pre-fix logic (`movement.security === "Open" && unit.security === "Secure"` only).
Printed back from the file after editing:

```
  const notice =
    movement !== undefined && (routed || isAccepted || isReferred) && movement.security === "Open" && unit.security === "Secure"
      ? { level: "more_restrictive" as const, text: "More restrictive than this movement requires" }
      : undefined;
```

Ran `-g "gives a voluntary patient on a locked ward its own"` → **failed**, exactly as expected:
`Expected substring: "Voluntary patient on a locked ward — review legal status before admission"`,
received the node's plain content with no notice at all (the defect itself, reproduced). Reverted
from a pre-mutation backup, diffed identical, re-ran the same test → **1 passed**.

**Mutation 2 — kills the updated WF-001 diagram assertion.** Replaced the diagram badge's
rendered text with an unrelated literal, isolated from the shared `restrictionNotice` source (so
the shortlist assertion in the same test stays a control — unaffected). Printed back:

```
          {"Mutated placeholder text"}
```

Ran `-g "states plainly when a candidate ward"` → **failed** at exactly the migrated diagram
assertion (line 593, `Expected substring: "More restrictive than this movement requires"`,
received `"...Eligible nowMutated placeholder text"`) — the shortlist assertion just above it in
the same failure trace was never reached as a separate failure, confirming the mutation was
isolated to the diagram. Reverted from backup, diffed identical, re-ran → passes (folded into the
full-suite run below).

**Mutation 3 — kills the `data-level="voluntary_on_locked"` assertion specifically**, proving that
assertion has independent bite beyond the text check. Hardcoded the badge's `data-level` to always
`"more_restrictive"`. Printed back:

```
          data-level="more_restrictive"
```

Ran `-g "gives a voluntary patient on a locked ward its own"` → **failed**:
`Locator: ...[data-level="voluntary_on_locked"]`, `Expected: 1`, `Received: 0`. Reverted from
backup, diffed identical, re-ran → **1 passed**.

All three mutations bit on the first attempt — no survivals to disclose, no reformulation needed.

## Gates — output quoted, not just exit codes

- `npx tsc --noEmit -p tsconfig.json` — no output, exit clean. Ran twice (once before formatting,
  once as a final check after all reverts); both clean.
- `npm run lint` — ran once, took >180s so it moved to background; read back from the log file
  after completion: the eslint invocation line printed and then `[exited with code 0]`, with
  **zero** occurrences of `DATABASE_HEAVY_RUN_ADMISSION_BUSY` in the full log (checked with a
  grep count, not assumed) — a real run, not a skip.
- Node-env vitest, exact command from the brief, run twice (once mid-work, once as a final
  post-revert check):
  `Test Files  10 passed (10)` / `Tests  126 passed (126)` — matches the stated baseline exactly,
  both times.
- Browser gate, chromium only, both spec files, base URL passed explicitly:
  `PLAYWRIGHT_BASE_URL=http://localhost:3718 npx playwright test tests/ui-ward-coordinator.spec.ts
tests/ui-ward-management.spec.ts --project=chromium --reporter=line`
  → **`26 passed (2.0m)`** — the stated baseline (25) plus the one new test (26), exactly as the
  brief predicted. Quoting the decisive line, not just "passed": `26 passed (2.0m)`.
- Did not run the three-browser set, `verify:ui`, `verify:release`, `guard-push.test.ts`, or
  anything touching OpenAI/Supabase/GitHub Actions/a live database — all explicitly prohibited or
  out of scope for this task.
- Prettier: ran `npx prettier --write` on the three files I touched (`flow-diagram.tsx`,
  `coordinator.module.css`, `ui-ward-coordinator.spec.ts`). `flow-diagram.tsx` and
  `ui-ward-coordinator.spec.ts` were reformatted (whitespace/line-wrap only — confirmed by reading
  the diff, no logic changed); `coordinator.module.css` was already correctly formatted
  (`unchanged`).

## Old helpers

`isMoreRestrictiveThanRequired` and `MORE_RESTRICTIVE_NOTE` (`ward-derivations.ts:213,219`) now
have **zero** remaining consumers — grepped `src/` and `tests/` for both identifiers; the only
hits left are their own definitions and comments (in `flow-diagram.tsx` and the updated test file)
that explicitly say they are superseded and left in place. **Left them in place**, per the brief
and per `AGENTS.md`'s "Deleting code you believe is dead" — not deleted, review can decide.

## Protected surface

`ward-eligibility.ts` does not appear anywhere in `git diff --stat` for this change — confirmed
by running `git diff --stat -- src/components/ward-management/ward-eligibility.ts` (empty output)
alongside the full `git diff --stat` (four files: the addendum doc I did not touch, plus my three).
No eligibility gate's pass/fail could have moved; nothing in this change reads or writes an
eligibility verdict.

## Screenshot — looked at it myself

Captured with a standalone headless-Chromium script placed under `artifacts/probe/` (gitignored,
imported `playwright` directly since it resolves from inside the repo, base URL
`http://localhost:3718`, deleted afterwards along with the rest of the probe directory —
`git status --porcelain` confirmed empty of it).

Two node-level screenshots, side by side in effect:

- **WF-301 → `rph-adult-secure`** (the fix): badge reads "Voluntary patient on a locked ward —
  review legal status before admission" in a **red/danger-toned** box — red border, pale
  red/pink background, red bold text.
- **WF-001 → `rph-adult-secure`** (the pre-existing milder case, for contrast): badge reads "More
  restrictive than this movement requires" in an **amber/warning-toned** box — amber border, pale
  amber background, dark amber bold text.

**My own description, looking at both images:** the two levels are genuinely distinguishable at a
glance, not merely by wording. The colour families are different enough (red/danger vs
amber/warning) that even a quick scan of the diagram would separate them, and the wording itself
is also different (the voluntary case is longer, names "legal status", and reads as an
instruction to review rather than an observation about ward tier). This is not a case of "same
box, different words" — it reads as two different severities immediately, which was the whole
point of the product owner's ruling.

## Commit

One commit, staged by exact path (never `git add -A`):

- `src/components/ward-management/coordinator/flow-diagram.tsx`
- `src/components/ward-management/coordinator/coordinator.module.css`
- `tests/ui-ward-coordinator.spec.ts`

`docs/ward-flow-phase-3-workspace/task-8-addendum.md` was left untouched throughout (not staged,
not reverted, not read past confirming it wasn't mine to touch).

## Concerns / anything not run

- I did not run `npm run docs:update` or check whether any generated doc needed refreshing —
  this change adds no routes and no new page, only a component-level derivation swap and a CSS
  class, so I judged it out of scope; flagging in case the pre-commit hook disagrees.
- The pre-commit hook's docs-sync check and its runtime were not exercised before this report was
  written (report written before the commit step). If it blocks on something unrelated to these
  three files, that would need its own investigation rather than a blind override.
- I did not add a corresponding assertion in `tests/ui-ward-management.spec.ts` (the ward-screen
  view) — the brief's task 5/spec section 3 says the notice "appears on the ward screen" too, but
  that is explicitly listed as "(later)" in the brief's point 3 ("the diagram, the shortlist and
  (later) the ward screen must read identically") and was out of scope for this standalone fix.
  Noting it so it isn't lost.
