# Task 8 — controller addendum (read this WITH the brief; where they differ, this wins)

Written in session 3 after scanning `task-8-brief.md` against the branch as it stands at
`a75c508f6`. The brief predates Tasks 6 and 6A.

---

## What the brief gets right and you should rely on

Verified by me against the current code and fixture, so you do not have to re-derive it:

- `unitById` (`ward-sites.ts:506`), `unitCapacity` (`ward-derivations.ts:159`), `eligibility`
  (`ward-eligibility.ts:26`), `DECLINE_REASONS` (`ward-model.ts:19`) and `restrictionNotice`
  (`ward-derivations.ts:201`) all exist with the names the brief uses.
- The brief's unconditional `ward-incoming-` assertion is safe: `bty-adult-secure` carries a live
  seed referral from the movement at `ward-movements.ts:456`, which sits at stage
  `destination_review`. Confirm it yourself before relying on it, but it is there.
- `DECLINE_REASONS` includes `out_of_catchment`, so the brief's reason assertion holds.

---

## R36 — the flow diagram is silent on the sharpest warning in the system. Fix it here.

**This is the most important part of your task and the brief does not mention it at all.**

The product owner settled (spec section 2 decision 9, and spec section 3 "Two different restriction
warnings, not one") that a ward tighter than a patient needs raises **two different** notices:

- **More restrictive than required** — movement `security: Open`, unit `Secure`. Operational.
- **Voluntary patient on a locked ward** — movement `legalStatus: Voluntary`, unit `Secure`. This is
  the sharper case, gets its own **more prominent** flag, and prompts a review of legal status,
  because a voluntary person who cannot leave a locked ward is detained in fact without an order.

`shortlist-panel.tsx` uses the correct function, `restrictionNotice(movement, unit)`, which returns
a `{ level, text }` object where level is either `voluntary_on_locked` or `more_restrictive`.

**`flow-diagram.tsx` still uses the older pair** — `isMoreRestrictiveThanRequired` and
`MORE_RESTRICTIVE_NOTE` (`flow-diagram.tsx:461`, `:474`, `:515`). And
`isMoreRestrictiveThanRequired` returns true only when the movement security is Open AND the unit
security is Secure.

For a **Voluntary + Secure** movement that is false, so the diagram renders **nothing**, while the
shortlist next to it renders "Voluntary patient on a locked ward — review legal status before
admission".

**This is live in the fixture right now.** I measured it rather than reasoned about it: there are 26
Voluntary movements and **four carry security Secure — WF-301, WF-308, WF-322, WF-329**. Each
shortlists three Secure units (`rph-adult-secure`, `fsh-adult-secure`, `rgh-adult-secure`), and all
twelve pairs diverge. An earlier ruling in this phase (F9) claimed all Voluntary movements were
security Open and therefore that the diagram was merely less specific. **That claim was wrong and
was never measured.** Re-measure it yourself and put the numbers in your report.

**What to do:**

1. Move `flow-diagram.tsx` onto `restrictionNotice(movement, unit)`.
2. Render the two levels **distinguishably**, with `voluntary_on_locked` the more prominent of the
   two. Use the notice's own text — do not re-author the wording, so the diagram, the shortlist and
   the ward screen read identically.
3. **Pin it with a test that names one of those four movements by id**, so the case cannot silently
   stop being covered when the fixture changes. Do not select by rank or `.first()`.
4. `MORE_RESTRICTIVE_NOTE` and `isMoreRestrictiveThanRequired` may then have no remaining consumers.
   **Do not delete them on that basis alone** — read `AGENTS.md` section "Deleting code you believe
   is dead" first. If nothing else needs them, say so in your report and leave the decision to the
   review rather than removing them yourself.

**`ward-eligibility.ts` is a protected surface. No gate's pass or fail may change.** These are
display flags only. If your change moves any eligibility verdict, you have gone wrong.

---

## R38 — the ward screen shows restriction notices too, and the brief's own test will not exercise them

Spec section 3 is explicit that both notices appear **on the ward screen**, "because the ward is the
party who would be holding the person". The brief says this, and you must build it.

But be aware the brief's chosen test subject cannot prove it: the movement referred to
`bty-adult-secure` is Involuntary inpatient with security Secure, so `restrictionNotice` returns
undefined for that pair. A test that only walks the brief's path will render zero notices and prove
nothing about them — the "test body that cannot execute" shape that has cost this phase several
rounds.

**Add explicit coverage for the ward screen's restriction notice against a pair that genuinely
produces one**, chosen by id from real data and verified. Say in your report which pair you used and
how you confirmed it produces a notice.

---

## R39 — registering the new spec file: both matchers, and prove it

The brief's Step 1 is right and is the single easiest step to get silently wrong. `ward-roles` must
go in **both** the top-level `testMatch` regex **and** `productionSpecPattern` in
`playwright.config.ts`. Missing either yields "No tests found", which reads like a pass.

Run `npx vitest run tests/playwright-project-isolation.test.ts` as the proof it landed, and quote its
output. Then, separately, confirm your new spec actually **ran** by reading the test count, not the
word "passed" — this machine reports collected-nothing runs at exit 0.

---

## R40 — an unresolved unit id renders an explicit absence

The brief says it; it is a Global Constraint, and it is the rule this whole project exists to hold.
`unitById(unitId)` returns a Unit or undefined. An unresolved id renders an empty state **naming the
id**, never a substituted unit. No fallback to the first unit, no non-null assertion, no defaulted
parameter.

**Add a test for the unresolved case** with an id that genuinely does not exist. A conservative
failure path with no test is not a conservative failure path.

---

## Environment — the things that will otherwise cost you an hour

- The dev server is **already running and warm** at `http://localhost:3718`. Do not restart it. Its
  identity is confirmed as this project. Never assume a port.
- **Your new route will need a cold Turbopack compile** and this project pins `cpus: 1`; a first hit
  on `/ward-management/ward/<id>` can take tens of seconds. Warm it with `curl` before running
  Playwright against it, or you will get a timeout that looks exactly like a regression. I hit this
  on the existing gate this session: one route-walking test failed cold and passed warm, and the
  full gate then ran 24/24.
- Always pass `PLAYWRIGHT_BASE_URL=http://localhost:3718`. A bare `npx playwright test` is rejected
  by a config guard **while still looking like it ran**.
- `npm run lint` exits 0 **without running** when the repo lock is held, printing
  `DATABASE_HEAVY_RUN_ADMISSION_BUSY`. Read the output; retry rather than recording a pass. Lint is
  required for this task — it carries the button-wiring and design-token rules.
- Run jsdom `.dom.test.tsx` files **one per invocation**; this machine's vitest worker pool reports
  `Test Files no tests` at exit 0 under load.
- `npx tsc --noEmit` can go red inside `.next/dev/types/`. Delete `.next/dev/types/validator.ts` and
  re-run; corrupted Next artefact, not your code.
- `git commit` can exceed two minutes on the pre-commit docs hook. Retry with a longer timeout.
- `npm run format` can hang. Use `npx prettier --write` on the specific files instead.
- **Never revert a file with uncommitted changes without backing it up first.**
- If a broad unexplained failure appears — `tsc` cannot find `process`, most test files failing at
  once — count the entries in `node_modules` **before reading any code**. This machine intermittently
  empties it for reasons external to this branch.

## Baselines to match or improve

- `npx tsc --noEmit -p tsconfig.json` → clean.
- Node-env suites, one invocation → **118 passed across 10 files** (baseline; yours may add).
- jsdom, one file per invocation → clock-consistency 1, provider 4, queue-selection 1.
- Ward browser gate → **24 passed** at `a75c508f6`, **plus** whatever Task 7 adds, **plus** yours.
  Check the ledger for Task 7's final number before you claim a delta.

Mutation-test every test you add: make the single edit that should kill it, **print the edited line
back from the file**, run, watch it fail, revert, confirm green. A mutation you did not read back did
not happen.

Do not run `verify:ui`, `verify:release`, the guard-push test suite, or anything touching OpenAI,
Supabase, GitHub Actions or a live database. Do not dispatch subagents.

---

## R39a — the exact Playwright edit, so it cannot be got wrong

I read `playwright.config.ts` at `a75c508f6`. Both patterns already carry a ward alternation group,
and you extend that group rather than adding a new alternative:

- `productionSpecPattern` (declared around line 25) contains `ward-(?:management|coordinator)`.
- The top-level `testMatch` (around line 33) contains the same `ward-(?:management|coordinator)`.

In **both** places, change it to `ward-(?:management|coordinator|roles)`. That is the whole edit.
Do not restructure either regex, do not append a separate `|ui-ward-roles` alternative outside the
group, and do not touch `mockupSpecPattern`.

`tests/playwright-project-isolation.test.ts` asserts that every spec file on disk is matched by
these patterns, so if you add `tests/ui-ward-roles.spec.ts` and forget either edit, that test goes
red — which is the guard working. Run it and quote its output.

## R39b — the adoption contract entry

`docs/design-system/adoption-contract.json` has a `ward-management` surface starting around line 490
listing route files under `"src/app/ward-management/..."` and component files under
`"src/components/ward-management/..."`. Add your new route
(`src/app/ward-management/ward/[unitId]/page.tsx`) and your new component
(`src/components/ward-management/ward/ward-screen.tsx`) to the matching arrays, keeping the existing
ordering convention, then run `npm run design-system:adoption:update` and commit whatever it
regenerates.

## R39c — the rail link, and why a literal href matters

`ward-management-navigation.tsx` renders its mode links as literal `href="/ward-management/<mode>"`
strings (lines 131-194 at `a75c508f6`), one per line, not built from an array. That is deliberate:
`tests/route-reachability.test.ts` reads the source text, so an href assembled from a variable or a
loop is invisible to it and the new route fails as an orphan.

Add your link the same literal way: `href="/ward-management/ward/rph-adult-secure"`. Match the
surrounding `RailLink` usage exactly, and keep the 3rem tap-target floor the existing links hold —
`tests/ui-ward-management.spec.ts:85` asserts it on a short, narrow viewport.

---

## R36a — an existing test PINS the divergence as intended. You must update it, and it will not fail the way you expect.

Measured at `ee82faac2`. `restrictionNotice` has exactly three production consumers, all in
`shortlist-panel.tsx` (lines 193, 234, 386). `isMoreRestrictiveThanRequired` and
`MORE_RESTRICTIVE_NOTE` have exactly one consumer between them: `flow-diagram.tsx` (lines 10-11,
462, 515). So the migration is genuinely confined to one file.

But `tests/ui-ward-coordinator.spec.ts` around lines 583-595 already asserts BOTH wordings on the
same screen, with a comment that names the divergence as deliberate:

> the diagram node is untouched this task and still reads the older `MORE_RESTRICTIVE_NOTE` text,
> so the two assertions differ.

It walks **WF-001** — an `Open` / non-Voluntary movement — and for each locked candidate asserts:

- the shortlist row contains `"More restrictive than this movement requires"` (the
  `restrictionNotice` `more_restrictive` wording), and
- the diagram node contains `"More restrictive than required"` (the `MORE_RESTRICTIVE_NOTE`
  wording).

**Here is the trap.** WF-001 is Open+Secure, so both functions fire for it and the test looks like it
should survive your change untouched. It will not. `MORE_RESTRICTIVE_NOTE` begins "More restrictive
than **required** — …" while `restrictionNotice`'s `more_restrictive` text is "More restrictive than
**this movement** requires". `toContainText("More restrictive than required")` is a substring match,
and the new string does not contain that substring. The assertion fails on wording, not on logic.

So: update that diagram assertion to the `restrictionNotice` wording, and **update the comment above
it too** — it currently states as fact that the diagram is deliberately left on the old text, which
your change makes untrue. An untrue comment beside a passing assertion is, by this phase's repeated
ruling, the same defect class as an untrue surface.

Do **not** conclude from that failure that the migration was wrong and revert it. And do not weaken
the assertion to a looser regex that matches both wordings — that would let the diagram silently
drift back.

Keep the `open`-candidate negative assertion (lines 596-600) intact: it is what stops the notice
being blanket text on every row.

**Then add what that test cannot cover**: WF-001 is not Voluntary, so it exercises only the milder
level. Your new test must pin one of WF-301, WF-308, WF-322 or WF-329 by id and assert the diagram
now carries the `voluntary_on_locked` wording for a Secure candidate — the case that renders nothing
today.
