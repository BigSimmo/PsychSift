# Flow-diagram restriction-notice fix — brief

Standalone fix, split out of Task 8 at the user's request. Prepared by the controller at
`adbe3296f`. Everything below was measured against the real fixture and the real derivations, not
inferred from field names.

## The defect

The product owner settled (spec section 2 decision 9; spec section 3 "Two different restriction
warnings, not one") that a ward tighter than a patient needs raises **two different** notices:

- **More restrictive than required** — movement security `Open`, unit security `Secure`.
  An operational observation: the bed will do, it is simply tighter than needed.
- **Voluntary patient on a locked ward** — movement `legalStatus` is `Voluntary`, unit security is
  `Secure`. The sharper case. It gets its own **more prominent** flag and prompts a review of legal
  status, because a voluntary person who cannot leave a locked ward is detained in fact without an
  order. It never blocks the placement.

`shortlist-panel.tsx` uses the correct function, `restrictionNotice(movement, unit)`
(`ward-derivations.ts:201`), which returns a `{ level, text }` object where level is
`voluntary_on_locked` or `more_restrictive`, or returns undefined.

**`flow-diagram.tsx` still uses the superseded pair** — `isMoreRestrictiveThanRequired` and
`MORE_RESTRICTIVE_NOTE`, imported at lines 10-11, computed at line 462, rendered at line 515.
`isMoreRestrictiveThanRequired` returns true **only** when the movement is `Open` and the unit is
`Secure`. For a **Voluntary** movement whose own security is `Secure`, it returns false, so the
diagram renders **nothing at all** — while the shortlist beside it renders the sharpest clinical
warning in the system.

## It is live in the fixture today. Measured, not assumed.

There are **26 Voluntary movements**, and **four carry security Secure** — `WF-301`, `WF-308`,
`WF-322`, `WF-329`. Each shortlists three Secure units (`rph-adult-secure`, `fsh-adult-secure`,
`rgh-adult-secure`). All **twelve** pairs diverge: `restrictionNotice` returns `voluntary_on_locked`,
`isMoreRestrictiveThanRequired` returns false.

An earlier ruling in this phase (F9) claimed all Voluntary movements were also security `Open`, and
concluded the diagram was "never wrong today, only less specific". **That claim was never measured
and is false.** Re-measure it yourself and put your numbers in your report — do not take mine on
trust. Ruling R37 in the ledger explains why: four fixture claims in this phase have turned out
false, every one of them checking a single property and assuming the rest.

## What to change

1. Move `flow-diagram.tsx` onto `restrictionNotice(movement, unit)`.
2. Render the two levels **distinguishably**, with `voluntary_on_locked` the more prominent.
   `coordinator.module.css:1113` already carries a comment anticipating exactly this — read it.
   There is an existing `.diagramRestrictiveBadge` class; a second, more prominent variant for the
   voluntary case belongs beside it.
3. Use the notice's **own text**. Do not re-author the wording — the diagram, the shortlist and
   (later) the ward screen must read identically.
4. Preserve the existing gating at line 462: the badge shows only for a unit this movement could
   actually be sent to (`routed`, `isAccepted` or `isReferred`), never for the other units on the
   board where the comparison is meaningless. That gating was itself a whole-branch review finding.

## The existing test PINS the old behaviour and will break in a way that looks like your fault

`tests/ui-ward-coordinator.spec.ts` around lines 583-595 walks **WF-001** (an `Open`,
non-Voluntary movement) and for each locked candidate asserts:

- the shortlist row contains "More restrictive than this movement requires" — the
  `restrictionNotice` `more_restrictive` wording; and
- the diagram node contains "More restrictive than required" — the `MORE_RESTRICTIVE_NOTE` wording.

Its comment says the divergence is deliberate: "the diagram node is untouched this task and still
reads the older MORE_RESTRICTIVE_NOTE text, so the two assertions differ."

**The trap:** WF-001 is `Open` plus `Secure`, so **both** functions fire for it and the test looks
like it should survive untouched. It will not. `MORE_RESTRICTIVE_NOTE` begins "More restrictive than
**required** — …", while the `more_restrictive` text is "More restrictive than **this movement**
requires". `toContainText` is a substring match and the new string does not contain the old
substring. **The assertion fails on wording, not on logic.**

So: update that diagram assertion to the `restrictionNotice` wording, and **update the comment above
it**, which your change makes untrue. An untrue comment beside a passing assertion is, by this
phase's repeated ruling, the same defect class as an untrue surface.

Do **not** conclude from that failure that the migration was wrong and revert it. Do **not** loosen
the assertion to a regex matching both wordings — that would let the diagram silently drift back.
**Keep** the open-candidate negative assertion just below it; it is what stops the notice becoming
blanket text on every row.

## The new coverage this fix exists for

WF-001 exercises only the milder level. Add a test that **pins one of `WF-301`, `WF-308`, `WF-322`
or `WF-329` by id** and asserts the diagram node for a Secure candidate now carries the
`voluntary_on_locked` wording — the case that renders nothing today.

**Select by id. Never `.first()`, never by queue rank.** Rank-based selection has broken three
separate tests in this phase; it is retired for the whole phase. Verify your chosen movement's
properties against the fixture and say what you verified and how.

Check before you write it whether your chosen movement is reachable on the coordinator screen at all
— it must appear in the priority queue, and its Secure candidate must be `routed`, `isAccepted` or
`isReferred`, or line 462's gate correctly suppresses the badge and your test fails for a reason
unrelated to the fix.

## Do not delete the old helpers

After your change, `isMoreRestrictiveThanRequired` and `MORE_RESTRICTIVE_NOTE` may have no remaining
consumers. **Leave them in place.** Read the "Deleting code you believe is dead" section of
`AGENTS.md` first — "nothing imports it" is necessary and nowhere near sufficient in this
repository, and a cleanup sweep on that reasoning had to be walked back seven times. Say in your
report that they are unreferenced and let the review decide.

## Protected surface

**`ward-eligibility.ts` must not change.** No gate's pass or fail may move. These are display flags
rendered alongside a passing gate, never gates themselves. If any eligibility verdict changes, you
have gone wrong.

## Constraints

- Design tokens only. No raw hex — `eslint-rules/no-hardcoded-hex.mjs` fails the build. No raw
  padding, gap, z-index or line-height literal in a CSS Module without declaring a local token in
  the module's root block first.
- Tap targets 3rem (48px) minimum. **Never 2.75rem** — it reintroduces a known `ui-smoke` flake.
- Every button wired: real handler, submit inside a form, or navigation.
- No horizontal overflow at any width down to 320px.
- Never an `aria-label` that replaces a control's visible content — it hides every figure from
  screen readers.

## Gates — read output, never exit codes

- `npx tsc --noEmit -p tsconfig.json` must be clean. Errors under `.next/dev/types/` are a corrupted
  Next artefact: delete `.next/dev/types/validator.ts` and re-run.
- `npm run lint` is **required**; it carries the design-token and button-wiring rules. It exits 0
  **without running** when the repo lock is held, printing `DATABASE_HEAVY_RUN_ADMISSION_BUSY`. Read
  the output; retry rather than recording a pass.
- Node-env suites, one invocation. Quote the counts.
- Browser gate, chromium only, both ward spec files. Always pass
  `PLAYWRIGHT_BASE_URL=http://localhost:3718` — a bare `npx playwright test` is rejected by a config
  guard **while still looking like it ran**. The dev server is already running and warm; do not
  restart it. Check the ledger for the current baseline count before claiming a delta.

**Mutation-test every test you add or change.** Make the single edit that should kill it, **print
the edited line back from the file** so you can see what actually landed, run, watch it fail,
revert, confirm green. A mutation you did not read back did not happen. If a test survives a
mutation that should kill it, **say so plainly** rather than reformulating until something goes red
— that disclosure is worth more than a clean sheet, and it is exactly how the defect in Task 7's own
new test was caught.

## Screenshot

Capture the diagram showing a voluntary-on-locked badge and look at it yourself. The Browser pane
cannot composite frames in this environment — drive headless Chromium directly. Place the script
inside the repo so it resolves `playwright` (`artifacts/` is gitignored), use
`http://localhost:3718`, and delete the script afterwards. Say in your report whether the two levels
are genuinely distinguishable at a glance, or whether they merely differ in wording.
