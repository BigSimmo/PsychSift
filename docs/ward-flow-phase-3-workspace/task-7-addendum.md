# Task 7 — controller addendum (read this WITH the brief; where they differ, this wins)

Four corrections found in a pre-flight scan of `task-7-brief.md` against the branch as it stands
at Task 6A. The brief was written before Tasks 6 and 6A landed and its test code no longer holds.

---

## R24 — do not select the queue row with `.first()`. Pin it by id.

The brief's test does:

```ts
await queue.locator('[data-testid^="ward-queue-row-"]').first().click();
```

That is the exact fragility Task 6A had to remove from **two** separate tests. Until Task 6A, row 1
was always WF-017 — not because it legitimately ranked first, but because a fabricated Form 3B
deadline inflated its operational score. With that deleted the real ordering is **WF-303 (rank 1,
score 61), WF-009 (rank 2, score 53)**, and WF-017 is rank 9. Writing `.first()` again
reintroduces a dependency on whatever happens to rank first today.

**Select the movement explicitly by `data-testid="ward-queue-row-<ID>"`.** Choose it deliberately
and justify it in your report: this test asserts the referral control is reachable and in the
viewport, so pick a movement for which a referral control is genuinely meaningful — a
**referable** one. `REFERRABLE_MOVEMENT_STAGES` in the reducer is the authority on which stages
qualify; `WF-002` (`destination_review`) is used by a sibling test in this same file for exactly
that reason and is a safe default. Verify the property against the current fixture rather than
assuming it, and say in your report what you verified and how.

If you find the pinned bar must also be proven for a _non_-referable movement (where the control
is present but `aria-disabled`), add that as a second explicit case rather than relying on rank.

---

## R25 — the scroll assertion is written in a matcher style Playwright may not support.

The brief has:

```ts
await expect(page.evaluate(() => window.scrollY)).resolves.toBe(scrollBefore);
```

`.resolves` is Jest/Vitest vocabulary. Playwright's `expect` may not carry it, and if it silently
does nothing this becomes a test that cannot fail — the defect class that has already cost this
phase several rounds. **Write it unambiguously instead:**

```ts
expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
```

Same guarantee, no dependence on matcher support. If you find `.resolves` genuinely works here,
still prefer the plain form and say so; do not spend a round proving it either way.

---

## R26 — the phone chrome contract, and the tap-target trap.

Before writing any fixed-position phone element, read `docs/search-chrome-behaviour.md`. Its rules
bind here.

What I have already established for you, so you do not have to rediscover it: `/ward-management`
is **not** inside the `(search-app)` route group, and `src/app/ward-management/layout.tsx` is only
the `WardFlowProvider` — no global search shell, no phone composer dock. So a bottom-pinned bar on
this route does **not** collide with the "one search composer per page" rule and there is no
existing dock reserve to fight. Confirm that yourself before relying on it.

Two constraints that still apply:

- **The pinned bar paints its own safe-area/home-indicator region while visible**, and is flush to
  the viewport bottom — no non-zero `bottom` gap. Do not add a second fixed bottom element.
- **Production tap targets in this repo are `min-h-12` (48px), NOT `min-h-11` (44px).** Generic
  accessibility guidance will tell you 44px satisfies WCAG. In this repo 44px reintroduces a known
  sub-pixel rounding flake in `ui-smoke`. Do not "fix" a control down to `min-h-11`.

Design tokens only — no hardcoded hex; `eslint-rules/no-hardcoded-hex.mjs` fails the build.
Every `<button>` must be wired: a real handler, a submit inside a form, or navigation. A control
unavailable for a stated reason uses `aria-disabled` plus an inert handler and a reason, never
native `disabled` — and never both.

---

## R27 — the screenshot step, and how to actually get one.

The brief says to capture `artifacts/ward-management/phase3-phone-pinned.png` and look at it.
**The Browser pane cannot composite frames in this environment** — two separate agents and I have
all hit it, and it is not worth further diagnosis. Drive headless Chromium directly instead. This
works; I used it to capture the Task 6A screenshot:

```js
// place the script inside the repo (artifacts/ is gitignored) so it can resolve `playwright`
import { chromium } from "playwright";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 390, height: 844 } });
await p.goto("http://localhost:3718/ward-management", { waitUntil: "domcontentloaded" });
await p.waitForSelector('[data-testid="ward-coordinator"]', { timeout: 20000 });
await p.waitForLoadState("networkidle");
await p.screenshot({ path: "artifacts/ward-management/phase3-phone-pinned.png" });
await b.close();
```

Run `npm run ensure` first and use the URL it prints — never assume the port. Delete the script
afterwards and leave `git status` clean apart from your commit. **Capture the screenshot after
selecting a patient**, so the pinned bar is actually showing the referral control, and name the
exact path in your report. The user is sent these and is asked to judge them.

**Also look at it yourself.** Specifically: is the pinned bar covering queue rows rather than the
queue having reclaimed that space? Is the referral control's state (available vs unavailable with
a reason) legible at that width? Is anything clipped by the home-indicator region?

---

## What the brief gets right and you should not change

The diagnosis is sound: `coordinator-screen.tsx:85-88` really does hold a nested
double-`requestAnimationFrame` `scrollIntoView` on the confirm control, with a comment explaining
that a single frame measured a transiently oversized scroll container. Deleting it in favour of a
pinned bar is the right fix — the scroll dance exists only because the control could be off-screen,
and a pinned control cannot be. Read that comment before deleting it; if it names a constraint the
pinned bar does not satisfy, say so rather than deleting silently.

`coordinator.module.css` exists and is where the bar's styles belong.

---

## Gates for this task

Read gate output, never exit codes. Quote the decisive counts.

1. `npx tsc --noEmit -p tsconfig.json` — if errors appear under `.next/dev/types/`, delete
   `.next/dev/types/validator.ts` and re-run; corrupted Next artefact, not source.
2. `npm run lint` — **required for this task**, because it is the gate carrying the button-wiring,
   design-token, and icon rules. It exits 0 _without running_ when the repo lock is held, printing
   `DATABASE_HEAVY_RUN_ADMISSION_BUSY`. Read the output; if you see that, retry rather than
   recording a pass.
3. Node-env suites, one invocation — baseline **118 passed** across 10 files:
   `npx vitest run tests/ward-flow-reducer.test.ts tests/ward-flow-contracts.test.ts tests/ward-model-phase3.test.ts tests/ward-model.test.ts tests/ward-flow-single-source.test.ts tests/ward-clock.test.ts tests/ward-priority.test.ts tests/ward-pressure.test.ts tests/ward-derivations.test.ts tests/ward-management.test.ts`
4. jsdom suites **one file per invocation** — this machine's worker pool is unreliable under load
   and has five recorded occurrences of reporting `Test Files no tests` or a truncated count at
   exit 0, on suites that pass on an immediate re-run. The count is the evidence, never the word
   "passed". Baselines: clock-consistency 1, provider 4, queue-selection 1.
5. Browser gate — **required**: `npm run ensure` first, use the printed URL, always pass
   `PLAYWRIGHT_BASE_URL` (a bare `npx playwright test` is rejected by a config guard while still
   looking like it ran). Baseline **24 passed**; your new test makes it 25.

Mutation-test every test you add: make the single edit that should kill it, **print the edited line
back from the file**, run, watch it fail, revert, confirm green. A mutation you did not read back
did not happen.

`git commit` can exceed two minutes on the pre-commit docs hook — retry with a longer timeout
rather than assuming a lock. **Never `git checkout --` a file with uncommitted changes without
backing it up first.** Format with `npx prettier --write <files>`; `npm run format` can hang.

Do not commit the `artifacts/` screenshot script. Do not run verify:ui, verify:release, or any
provider-backed gate. Do not dispatch subagents.

---

## R34 — the brief's file list is incomplete. The referral control is not in the file it names.

Added by the controller in session 3, after checking the branch as it stands at `a75c508f6`.

The brief says to modify `coordinator-screen.tsx` and `coordinator.module.css`. But the controls the
pinned bar has to carry — `ward-shortlist-refer` and `ward-shortlist-override-toggle` — are rendered
in **`src/components/ward-management/coordinator/shortlist-panel.tsx`** (around lines 549-600), not
in `coordinator-screen.tsx`. `coordinator-screen.tsx` only holds the `.shortlistColumn` wrapper
(line 194) and the ref the doomed `scrollIntoView` effect uses.

So: **you may modify `shortlist-panel.tsx` as well** if the design needs it. Two shapes are both
legitimate and you choose:

- **CSS-only** — make the phone-width bar out of `.shortlistColumn`'s action row via
  `coordinator.module.css`, leaving `shortlist-panel.tsx` untouched. Cleanest if the markup already
  groups the two controls in one element.
- **Markup change** — give the action row its own element/class in `shortlist-panel.tsx` so the CSS
  has something honest to pin.

State in your report which you chose and why. Do **not** contort the CSS into a fragile
descendant-selector chain purely to keep the brief's two-file list literally true — the file list is
the defect here, not your change.

Do not restructure `shortlist-panel.tsx` beyond what the bar needs. Its `canRefer` /
`aria-disabled` / `referUnavailableReason` logic is the fix for this phase's most consequential
defect (the screen claiming a referral the reducer refused) and **must keep working exactly as it
does now** — the pinned bar changes where the control sits, never whether it is available.

## The constraint the deleted comment names — read it before you delete it

`coordinator-screen.tsx:70-95`'s double-`requestAnimationFrame` comment says the scroll was
mis-landing because `.main`'s grid rows and `.screen`'s `100dvh` height had not finished resolving
after a viewport resize, once measured 256px short. That is a **measurement** constraint: it only
binds something that has to compute where to scroll to. A bar pinned by CSS to the viewport bottom
never measures the scroll container, so the constraint dissolves rather than being ignored.

Satisfy yourself that is true before deleting the effect, and say so in your report. If you find the
pinned bar somehow still depends on that settled layout, stop and say so rather than deleting
silently.
