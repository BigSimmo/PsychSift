# Condensed service-stop bar — report

Closes the defect Task 19's browser proof measured: with a service-wide stop active, the full
service-state banner sits in normal flow beneath a `sticky` header, so at 320, 390, 430 and 768 px
it scrolls **completely out of view** (measured y from −285 to −602), and survives at 1024 and 1440
only because the one built page is nearly empty. Spec §4.2 requires the stop to be visible on every
screen while it is active, and a statement that has scrolled away states nothing.

The owner's decision, implemented here: a **condensed one-line bar**, pinned once the full banner
has gone. Not the full banner pinned — that costs about a quarter of a phone screen at all times,
on every screen.

---

## 1. What was built, and the shape chosen

Three source changes and one new pair of modules.

**The bar is an absolutely positioned child of the workspace's sticky `<header>`, at `top-full`.**
That single decision is the whole shape, and it buys three properties without a magic number:

1. **It rides the header.** No second `sticky` element, and no pin offset to get wrong.
2. **It is out of flow.** Revealing it moves no content. A bar that pushed the page down as it
   appeared would push the banner it is watching back towards view — the oscillation this avoids
   by construction rather than by hysteresis.
3. **It inherits the header's stacking context**, so it needs no `z-index` of its own. It covers
   page content; the phone dock (`--z-chrome`) and the overlay layer (`--z-modal`) still cover it.
   No new `z-` value was introduced at all.

The measured reason a fixed offset was never an option: the header is **87.5 px** tall at 320 and
390 (its contents wrap there) and **65 px** from 430 up, against a `--header-h` token of **64 px**.
Any offset written down would have buried the bar behind the header at every single review width.

**Wording** (`condensedServiceStopStatement`):

> `Sending stopped for the whole service. 0 of 3 restart approvals recorded.`

- The state label `Sending stopped` is the _same constant_ the full banner uses, not a second copy.
- `for the whole service` is retained deliberately. Abbreviating to "Sending stopped" alone would
  read as one patient's plan having halted — a **weaker and vaguer** claim than the banner's, which
  the brief forbids. Everything the bar says is a strict subset of what the banner says.
- The approval count is read from the facts and from `REQUIRED_RESTART_APPROVAL_ROLES.length` on
  every render, never frozen — a pinned bar still saying "0 of 3" after two approvals would be
  staler than the banner directly above it.
- The reason category and the outstanding roles are left to the full banner: one line cannot carry
  them at 320 px, and the banner is one scroll away.

**Status through text, icon and structure, never colour alone.** The words carry the state; the
`OctagonX` icon is `aria-hidden` decoration on top of them. Asserted in JSDOM, and asserted again
in the browser under `forced-colors: active`, where the author tint is dropped entirely.

**Only ever one statement.** The bar is displayed exactly when the banner's bottom edge has passed
the header's bottom edge — which is where the bar begins. The two therefore cannot be on screen at
the same moment; it is a mutual exclusion in geometry, not a coincidence of timing.

**Accessibility.** The bar is `aria-hidden="true"`. The full banner is still in the document and
still announces as the single `role="status"`. A screen-reader user does not scroll past anything,
so a second live region would say the same thing twice — the same failure mode in the aural channel
that the owner named in the visual one.

**Print.** `print:hidden`. The print rule in `globals.css` makes the header `position: static` so
the synthetic marker survives a printout; an absolutely positioned child would then drop onto the
printed content.

---

## 2. How the incident note is kept structurally unreachable

`ServiceState.note` is free text a responder types mid-incident, classified as patient data.

- The bar renders from **`ServiceStopBannerFacts`**, the type that omits `note` by construction —
  exactly as `describeServiceStop` and `StoppedServiceBanner` already do. `CondensedServiceStopBar`
  takes the whole `ServiceState` (because that is what a caller holds), reads two fields, and hands
  them to `CondensedStoppedBar`, where the note is not in scope.
- **Nothing derived from the record crosses a client boundary.** The one new Client Component,
  `service-stop-scroll-watcher.tsx`, **takes no props at all** and renders `null`. It decides _when_
  the bar is shown and never _what it says_. This is the same technique — and the same stated
  reason — as `overlays/workspace-overlays.tsx`.
- Proof that the type actually holds, rather than the comment holding it: interpolating
  `${facts.note}` into the statement is a **compile error**, not a judgement call.

  ```
  src/components/caring-contacts/workspace/service-state-banner.tsx(120,70): error TS2339:
  Property 'note' does not exist on type '{ stopped: true; reason: ServiceStopReason;
  restartApprovals: readonly ServiceRestartApproval[]; }'.
  ```

---

## 3. Client allowlist

One entry added to `ALLOWED_CLIENT_COMPONENTS` in
`tests/caring-contacts-explained-automation.dom.test.tsx`: **`service-stop-scroll-watcher.tsx`**,
with a comment giving its reason and its three conditions.

Why a client boundary was unavoidable: a scroll position and two element rectangles are browser
facts. There is no CSS-only expression of "reveal B once A has left the region below a sticky
header whose height is not a token" — the two candidate CSS techniques were considered and rejected
(a grid-stacked sticky bar covered by the banner hides by _occlusion_ rather than absence, and
breaks wherever a background is not opaque; scroll-driven `animation-timeline: view()` degrades to
its base state on any engine that does not support it, which for a safety surface is a bet rather
than a guarantee).

Why it is safe under the standing condition:

- It receives **no `serviceState`-derived prop under any name** — it receives no props at all.
- Its source names neither `service-state` nor `ServiceState` (checked by the companion test that
  covers every allowlist entry). It imports only three id strings and one attribute name from
  `service-stop-bar-anchors.ts`, a module holding nothing but strings.
- The bar it toggles is **server-rendered from the note-free facts type**, so the wording never
  enters the client module graph.
- Server render is `data-full-banner-out-of-view="false"`, so a browser that never runs the script
  shows no bar. That is the conservative direction: the workspace degrades to exactly the behaviour
  it had before this change, and can never show two statements of one stop.

**Next.js 16 docs read** (from `node_modules/next/dist/docs/`):
`01-app/01-getting-started/05-server-and-client-components.md` — specifically the RSC Payload
section ("Any props passed from a Server Component to a Client Component" are in the payload), which
is the exact mechanism the no-props design defends against, and the note at line 178 that Server
Components passed as children are rendered on the server rather than entering the Client
Component's module graph. Directory listing of `01-app/03-api-reference/01-directives/use-client.md`
was located but the boundary semantics needed came from the getting-started guide.

---

## 4. TDD evidence

Test first, watched fail for the stated reason, then built.

**Red** — six new DOM tests written against a bar that did not exist:

```
 Test Files  1 failed (1)
      Tests  5 failed | 17 passed (22)
```

(Five of the six failed; the sixth — "renders nothing at all while the service is running" — passes
vacuously before the bar exists, which is expected and is why it is not counted as proof on its own.
Its mutation is M4 below.)

**Green** — after building, DOM tests plus the untouched shell suite:

```
 Test Files  2 passed (2)
      Tests  32 passed (32)
```

**Browser, first run** — and it found a real defect nothing else could (§6):

```
  4 failed
  27 passed (3.0m)
```

**Browser, after the fix**:

```
  31 passed (1.5m)
```

Exit code **0** — a real completed run, not the `75` /
`DATABASE_HEAVY_RUN_ADMISSION_BUSY` lock-contention refusal.

---

## 5. Mutation evidence

Every mutation below was checked twice: that it changes a value some assertion reads, **and** that
it reddens the assertion it was meant to prove rather than tripping an earlier one.

| #   | Mutation                                                                   | Reddened                                                                                                                   | Reached the intended assertion?                                                                                                                                                                                                                                                                |
| --- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1  | Drop `for the whole service` from the statement                            | `states that sending is stopped for the whole service, in words`, line 441                                                 | Yes. The preceding `Sending stopped` assertion (line 438) passed — visible in the received text `"Sending stopped. 0 of 3 restart approvals recorded."`                                                                                                                                        |
| M2  | Freeze the count: `const recorded = 0`                                     | `carries the same restart-approval count the full banner carries`, line 458                                                | Yes. Failed on the `recorded === 1` loop iteration, so the `recorded === 0` iteration passed through the same assertion first                                                                                                                                                                  |
| M3  | Remove `aria-hidden="true"` from the bar                                   | `adds no second announced statement of the same stop`, line 490                                                            | Yes. The preceding `getAllByRole("status")).toHaveLength(1)` (line 489) passed, because the bar carries no role                                                                                                                                                                                |
| M4  | Render the bar even when the service is running                            | `renders nothing at all while the service is running`, line 427                                                            | Yes — the only assertion in that test, and the rendered bar is shown in the failure output                                                                                                                                                                                                     |
| M5  | Interpolate `${facts.note}`                                                | `tsc --noEmit`, TS2339                                                                                                     | Structural: it never reaches a test at all, which is the point                                                                                                                                                                                                                                 |
| M6  | Add a control inside the bar                                               | `adds no second control competing with the banner's service-stop control`, line 499                                        | Yes — the added `<button>` appears in the failure output                                                                                                                                                                                                                                       |
| B1  | Display the bar unconditionally (`hidden` → `flex`, drop the data variant) | `keeps the stop stated exactly once at every scroll position` at **all six widths**, at the "statements at rest" assertion | Yes. Both preceding `toHaveCount(1)` assertions passed. The failure prints exactly the owner's failure mode: two objects on screen, `#caring-contacts-service-stop-banner` (top 88, bottom 339) **and** `#caring-contacts-condensed-service-stop` (top 87, bottom 141). `8 failed / 23 passed` |
| B2  | Watcher never reveals the bar (`outOfView ? "false" : "false"`)            | see below                                                                                                                  | see below                                                                                                                                                                                                                                                                                      |

B2 result — `9 failed / 22 passed (4.9m)`, and it reddened in both of the two places the bar's
whole purpose lives:

```
Error: statements at scroll 320 at 320px
  Expected length: 1
  Received length: 0
  Received array:  []
  > 763 |  expect(statements, `statements at scroll ${offset} at ${width}px`).toHaveLength(1);

Error: the condensed bar did not appear at 320px
  Expected: true   Received: false
  > 824 |  expect(geometry.barDisplayed, `the condensed bar did not appear at ${width}px`).toBe(true);
```

Reachability: the invariant test failed at scroll **320** (200 at 768 px), meaning the earlier
offsets 40, 80, 120 and 200 passed through the _same_ assertion first — so it is the intended
assertion that reddened, mid-loop, not an earlier one. The pin test failed at line 824, having
already passed the `bannerGone` branch check above it. Received length `0` is exactly the defect
this whole change exists to close: the stop stated nowhere on screen.

Two assertion groups did **not** need a synthetic mutation, because they failed for real on the
first implementation and were fixed — which is stronger evidence than a mutation (§6).

---

## 5b. The full offline suite — reported honestly, not as green

`npm run test` is **not fully green on this machine**, and it is not green because of this change.
Both full runs were made with the change in place:

```
run A:  Test Files  4 failed | 699 passed | 2 skipped (705)
        Tests       6 failed | 7834 passed | 29 skipped (7869)

run B:  Test Files  7 failed | 696 passed | 2 skipped (705)
        Tests      10 failed | 7830 passed | 29 skipped (7869)
```

Two runs of the same tree gave **different failure sets**, which is itself the finding. The files
involved across both: `adopt-visual-baselines`, `bundle-budget`, `codex-cloud-setup`,
`design-sync-contract`, `design-system-adoption`, `test-runner-safety`, `worker-bundle`,
`http-readiness`. None is in caring-contacts, the workspace shell, the client-boundary guard, or
route reachability.

Checked rather than assumed, by reverting the change in the working tree and running the same files:

```
without the change:  Tests  4 failed | 90 passed (94)
                       codex-cloud-setup x2, design-sync-contract, design-system-adoption
with the change:     Tests  2 failed | 92 passed (94)
                       codex-cloud-setup x1, http-readiness
```

So the failures reproduce **with the change reverted**, and the set moves between runs in both
directions. They are load- and environment-dependent on this Windows workstation, which was running
Playwright and lint from two other worktrees throughout (`Database focused-test capacity is full`
refusals were hit repeatedly and retried, never counted as results).

What _is_ green, deterministically and repeatedly: every caring-contacts and workspace-shell suite.

```
node scripts/run-vitest.mjs run tests/caring-contacts-explained-automation.dom.test.tsx   tests/caring-contacts-workspace-shell.dom.test.tsx --reporter=dot

 Test Files  2 passed (2)
      Tests  32 passed (32)
```

`tsc --noEmit` is clean, `eslint` on all changed files is clean, and `prettier --check .` reports
`All matched files use Prettier code style!` across the whole tree.

---

## 6. The defect the browser found, that nothing else could

The first implementation gave the bar `-inset-x-4 sm:-inset-x-6 lg:-inset-x-8` to "undo" the
header's own padding, on the reasoning that an absolutely positioned child is laid out against the
padding box.

That reasoning is half right and the wrong half. The containing block **is** the padding box — and
a padding box is measured **outside** the padding, not inside it. So `inset-x-0` already spans the
header's full width, and the negative insets pushed the bar past the header on each side:

```
Error: condensed bar left edge at 320px      Expected: 0    Received: -16
Error: condensed bar left edge at 768px      Expected: 80   Received: 56
```

Typecheck, lint and all twenty-two DOM tests were green with that bug in place. Only the browser's
left/right edge assertions could see it. Fixed by using plain `inset-x-0`; the bar keeps its own
`px-4 sm:px-6 lg:px-8` so its content still lines up with the header's.

---

## 7. Browser evidence

Command (against the isolated production build `run-playwright.mjs` makes for itself):

```
node scripts/run-playwright.mjs tests/ui-caring-contacts-workspace.spec.ts --project=chromium
```

Decisive line, final run:

```
  31 passed (1.5m)
```

Exit code **0**. Not exit `75`, and no `DATABASE_HEAVY_RUN_ADMISSION_BUSY` marker — the run
genuinely executed. (Focused Vitest runs during mutation testing were refused several times with
`Database focused-test capacity is full` from another worktree; those were retried, never counted.)

Thirteen of the thirty-one tests are new. Nothing above them in that file was rewritten, weakened,
or deleted; the file only grew, and the eighteen pre-existing tests still pass unchanged.

What the new tests assert:

- **At all six review widths (320, 390, 430, 768, 1024, 1440), at every sampled scroll offset**
  (0, 40, 80, 120, 200, 320, 480 and the bottom of the document), **exactly one** statement of the
  stopped state is on screen, and it always carries the service-wide scope. "On screen" is
  deliberately _not_ Playwright's `toBeVisible()`, which counts an element with a box as visible
  even when it has scrolled far above the viewport — that is precisely the defect being fixed, so
  the naive assertion would have reported the broken page as fine. On screen here means displayed
  **and** overlapping the region below the sticky header. Sampling across the range rather than only
  at the ends is what covers the handover: a gap in it would be a moment with no statement, an
  overlap a moment with two.
- **At all six widths**, once the banner has gone: the bar is displayed, sits at or below the
  header's bottom edge, is within the viewport, is **topmost at its own centre** (via
  `elementFromPoint`, so nothing is painted over it), spans the header's full width exactly, does
  not reach the phone dock, and adds no horizontal overflow. Where the page is too short for the
  banner to leave (this can happen at 1024/1440 with only the Task 15 page built), the same test
  asserts the bar stays **away** instead.
- **Dark** and **forced colours**: the bar resolves real ink and a real surface in dark, and under
  `forced-colors: active` the stop is still stated exactly once, in words, with the scope intact.

---

## 8. Arranging a stopped service, and a finding worth recording

The browser test raises the stop through the **real HTTP boundary** —
`POST /api/caring-contacts/service-state` — so no test-only hook was added to production code. It
accepts `service-already-stopped` as the same arranged condition, because the first record of an
incident is permanent by design.

The stop is **irreversible in the demo**: restarting needs three approvals from three _different_
people, and only two demo roles (`teamLead`, `clinicalProgrammeLead`) hold `approveServiceRestart`.
The new block is therefore declared **last** in the spec file. `run-playwright.mjs` starts a fresh
server for every run, and the config is `fullyParallel: false` with `workers: 1`, so every test
above it still runs against a running service exactly as before.

**Finding (not fixed here, and worth the owner's attention):** in the **dev server**, the workspace
page cannot see a stop raised through the API at all. Verified directly — after a clean restart,
`POST` then `GET` on `/api/caring-contacts/service-state` both report `stopped: true`, and the
access-trail route (a _different_ route handler) sees the `stopService` event, so route handlers
share one store; but `GET /caring-contacts` renders no banner. Turbopack gives app **pages** and
app **route handlers** separate module registries, so `store.ts`'s module-scope `cachedStore` — the
in-memory reference store's only copy of its data — is a different object on each side. The
production build (webpack, shared server chunks through Node's require cache) does share it, which
is why the browser proof works. The practical consequence: **the service-state banner cannot be
demonstrated in `npm run dev` at all**, and any future workspace screen that writes through the API
and reads back on a page will behave the same way. This is a dev-mode-only architectural gap in the
demo store, not something this change introduced or should fix.

---

## 9. Files changed

| File                                                                        | Change                                                                                                                                           |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/components/caring-contacts/workspace/service-stop-bar-anchors.ts`      | **New.** Three DOM ids and one attribute name. Strings only, so the watcher can share them without importing anything that could carry the note. |
| `src/components/caring-contacts/workspace/service-stop-scroll-watcher.tsx`  | **New.** The one new Client Component. No props, renders `null`, toggles one attribute from a one-read-per-frame `scroll`/`resize` handler.      |
| `src/components/caring-contacts/workspace/service-state-banner.tsx`         | Added `id` to the full banner; added `condensedServiceStopStatement`, `CondensedStoppedBar` and `CondensedServiceStopBar`.                       |
| `src/components/caring-contacts/workspace/shell.tsx`                        | Added `id` to the header; rendered `<CondensedServiceStopBar>` inside it.                                                                        |
| `tests/caring-contacts-explained-automation.dom.test.tsx`                   | Six new DOM tests; one deliberate allowlist entry with its reason. Nothing existing changed.                                                     |
| `tests/ui-caring-contacts-workspace.spec.ts`                                | Thirteen new browser tests appended. Nothing existing changed.                                                                                   |
| `docs/caring-contacts/phase-2a-sdd-archive/condensed-service-bar-report.md` | This report.                                                                                                                                     |

---

## 10. Self-review

- **No existing assertion deleted or loosened.** Both test files only gained lines. The one edit
  inside an existing structure is the additive `ALLOWED_CLIENT_COMPONENTS` entry, which the brief
  sanctions explicitly and which _tightens_ rather than loosens: the companion test immediately
  holds the new entry to the same three proofs as the others.
- **Repository contracts.** `min-h-tap`, never `min-h-11`. Tokens only — every colour is
  `var(--danger-*)` / `var(--text)`, no hex, no raw pixel lengths, no `dark:` colour override. **No
  `z-` value was added at all**, which is the strongest form of compliance with the ladder for a
  pinned element. `widthStateFor` is untouched and no second breakpoint or `matchMedia` was written
  — the bar has no width-dependent behaviour. Lucide icon carries `aria-hidden`. No new `<button>`.
- **Prohibited vocabulary.** The statement contains none of the forbidden terms, makes no claim
  that replies are monitored, and uses no transport word as a state label. Australian English,
  sentence case, no bare dash.
- **Verification actually run:** focused Vitest (green, 32/32), `tsc --noEmit` (clean), `eslint` on
  every changed file (clean), `prettier --check .` (clean), the Chromium browser proof (31/31,
  exit 0), and two full offline suite runs — which are **not** green on this machine, for reasons
  shown in §5b to be pre-existing and unrelated.

## 11. Concerns

1. **No-JavaScript degradation is silent.** With scripting off the bar never appears and the page
   behaves as it did before this change. That is the conservative direction and it was chosen
   deliberately, but it does mean the §4.2 guarantee rests on a client script in that one case.
2. **Dev mode cannot show the banner at all** (§8). Not introduced here, but it means a reviewer
   who checks this by hand in `npm run dev` will see nothing and may conclude the bar is broken. It
   must be reviewed against a production build.
3. **1024 and 1440 are proved conditionally.** With only the Task 15 page built, the document at
   those widths may be too short for the banner to leave view, so the pin assertion takes its
   "stays away" branch there. The exactly-one-statement invariant still covers them unconditionally.
   Once Phase 2B fills those pages the pin branch will start exercising, which is the intent.
4. **`npm run test` is not green on this machine.** Ten distinct pre-existing/environmental
   failures across two runs, none in caring-contacts and four of them reproduced with the change
   reverted (§5b). I could not deliver a fully green full-suite run and am not claiming one.
5. **The bar's height is not literally one line at 320 px.** The statement wraps to two lines on the
   narrowest phone. It is `min-h-tap` and grows; it is still roughly a quarter of the full banner's
   height, which is what the owner's decision was buying.

---

# Fix round 1

Review returned APPROVED WITH FINDINGS. All four are addressed below. Two of the proofs are
**blocked** by a defect in a commit this task did not author — see §R0, which has to come first
because it changes what the rest of this section can claim.

## R0. The browser proof cannot run at all right now, and it is not this change

The branch is shared. `c3ef20c3f` ("gate caring contacts demo access in production") landed
mid-task from another session and this work was rebased on top of it. It introduces two
independent blockers, both outside this change's files.

**Blocker 1 — the Playwright production build fails to type-check, so no browser spec in this
repository can run.** `run-playwright.mjs` builds its own isolated production app, and `next build`
type-checks the whole tree:

```
✓ Compiled successfully in 3.2min
  Running TypeScript ...
tests/caring-contacts-api-handler.test.ts(49,45): error TS2704: The operand of a 'delete' operator cannot be a read-only property.
tests/caring-contacts-session.test.ts(27,20): error TS2540: Cannot assign to 'NODE_ENV' because it is a read-only property.
… 7 errors in those two files …
Failed to type check.

Playwright production build failed (status 1).
```

The cause is `process.env.NODE_ENV = "production"` and `delete process.env.NODE_ENV` in those two
test files; TypeScript 6 types that property readonly (`vi.stubEnv` is the usual spelling). Both
files were last touched by `c3ef20c3f` and neither is touched here — `npm run typecheck` reports
those seven errors and **nothing else**, so every file in this change type-checks clean. This is
not specific to the caring-contacts spec: `run-playwright.mjs` always builds first, so `ui-smoke`,
`ui-accessibility` and every other browser gate are equally down until it is fixed.

**Blocker 2 — even with the build fixed, this spec would be entirely red.** Reasoned from three
lines, not observed, because blocker 1 stops the run before a server exists:

- `scripts/run-playwright.mjs:302` — `NODE_ENV: "production"` in the build/serve environment.
- `src/lib/caring-contacts-server/session.ts:28` — `isCaringContactsDemoEnabled` returns
  `environment !== "production"`, pinned by that commit's own unit test
  (`expect(isCaringContactsDemoEnabled("production")).toBe(false)`).
- `src/app/caring-contacts/page.tsx:64` — `if (!isCaringContactsDemoEnabled()) notFound();`, and
  `handler.ts:166`/`:277` refuse every caring-contacts API read and write the same way.

So under the Playwright runner the workspace route 404s and `arrangeServiceStop`'s POST is refused.
That takes down all thirty-three tests in `ui-caring-contacts-workspace.spec.ts` — the eighteen
that predate this change included — not merely the new ones.

**Not fixed here, deliberately.** Blocker 1 is another session's test code, and that session has a
file staged in this worktree right now, so it is live. Blocker 2 is that session's deliberate
security decision (the demo must fail closed in production) colliding with a browser gate that only
runs in production; reconciling them is a design call for the owner — most likely an explicit
build-time opt-in for the Playwright app, in the shape `NEXT_PUBLIC_MOCKUPS_ENABLED` already uses in
that same runner. Both are reported rather than worked around.

**Consequence for this round:** findings 2, 3 (icon half) and 4 are proved offline below. Finding 1
is implemented and its premise is measured, but its browser mutation is **unrun**. Finding 3's
dark-mode mutation is **unrun**. Neither is claimed as proved.

## R1. Finding 1 — the pin was unproven at 1024 and 1440, and the invariant was empty there

Confirmed, and worse than the round-1 concern admitted. Measured on the running app at the frozen
900px review height:

```
w=1024 h=900  {"scrollHeight":900,"inner":900,"maxScroll":0}
w=1440 h=900  {"scrollHeight":900,"inner":900,"maxScroll":0}
```

`maxScroll` is **zero**. Every sampled offset was filtered out by `.filter(offset => offset <= maxOffset)`,
leaving only the at-rest sample, so both widths asserted the pre-existing banner behaviour and
nothing about the handover — while reading as though they covered it. The round-1 claim that the
invariant "still covers them unconditionally" was true of the code and false of the coverage.

Fixed by sizing the viewport rather than branching on the page:

- `openWorkspace` gains an optional `height` (default unchanged at 900, so no existing call site
  moves). The service-stop tests pass `STOP_HANDOVER_VIEWPORT_HEIGHT = 500`. Measured room at that
  height, before the banner adds its own to the document: `maxScroll` 838 / 790 / 744 / 571 / 286 /
  286 at 320 / 390 / 430 / 768 / 1024 / 1440.
- The pin test's `if (!bannerGone) { … return; }` escape hatch is **deleted**. It now asserts the
  banner's bottom has passed the header's bottom, so the test can no longer opt itself out.
- The invariant test asserts up front that `maxOffset` exceeds the distance the banner has to
  travel — the degeneracy is caught directly, at the width where it happens.
- The invariant test also asserts that at the bottom of the range the single statement is the
  **condensed bar**, not the banner. Without that, a banner that never left would satisfy the loop
  end to end, which is exactly the degenerate pass round 1 shipped.

A 1440x500 window is an ordinary half-height desktop window, and it is precisely where a stop
scrolling away hurts.

**Mutation: unrun (blocked, §R0).** Designed: set the watcher's write to
`outOfView ? "false" : "false"` and expect `pins the condensed bar … at 1440px` to redden at
`expect(geometry.barDisplayed …).toBe(true)`. Reachability is designed in — the two assertions
before it (`toHaveCount(1)` on both elements) are unaffected by the mutation, and the new
banner-has-gone assertion above it passes because the mutation changes only the bar. The same
mutation reddened the 320/390/430/768 arm of this test in the pre-round-1 run
(`Expected: true, Received: false` at that line), so the assertion's power is established; what is
unproven is only that 1024 and 1440 now reach it.

## R2. Finding 2 — the anchors module was in the client graph and nothing guarded it

Confirmed, and it is the same shape as the top-level-only directory read and the `.ts`/`.tsx`-only
extension list this file has already had to widen twice: a guard whose claim is broader than the
path it walks. Exposure was nil; the hole was the guard's.

The boundary scan now walks the allowlisted component's imports **transitively**. It follows
relative specifiers, and `@/…` specifiers that land inside a caring-contacts directory; it does not
follow `react` or the shared design-system graph, because that graph reaches most of `src/` and a
guard nobody can reason about is not a guard. That residual boundary is written into the test.

**Mutation M7 — a `ServiceState` reference in the anchors module.** Ran, reddened:

```
FAIL  the service-state path stays on the server > keeps the service state out of every client
      component and everything it imports
AssertionError: src/components/caring-contacts/workspace/service-stop-bar-anchors.ts
      (reached from service-stop-scroll-watcher.tsx) names ServiceState
  436 |  expect(moduleSource, `${label} (reached from ${name}) names ServiceState`)
 Test Files  1 failed (1)
      Tests  1 failed | 22 passed (23)
```

Reachability: the entry's own `"use client"` assertion runs first and passed, and the watcher's own
source passed both regexes before the imported module was reached — the failure is on the new
assertion, for the imported module, and names the path by which it was reached. Under the round-1
check this mutation was invisible: that check opened only `path.join(WORKSPACE_DIR, name)` for each
allowlisted name, and the anchors module is not an allowlisted name, so it was never opened at all.

**Mutation M8 — break the walk** (`if (false && specifier.startsWith("."))`), to prove the
extension cannot silently evaporate. Ran, reddened the new anti-vacuity test:

```
FAIL  actually follows a client component's imports rather than stopping at its own file
AssertionError: the module-graph walk does not reach the watcher's own anchors module:
      expected [ 'service-stop-scroll-watcher.tsx' ] to include 'service-stop-bar-anchors.ts'
 Test Files  1 failed (1)
      Tests  1 failed | 22 passed (23)
```

Reachability: it is the only assertion in that test. Note what else that run shows — the main scan
test **passed** under this mutation, silently back to certifying one file. That is the whole reason
the anti-vacuity test exists, and the received value is literally the round-1 coverage.

## R3. Finding 3 — two assertions that could not fail

**The icon loop.** A `for` over an empty NodeList passes, so the round-1 form could only fail on a
_wrongly marked_ icon and never on a _missing_ one — the more likely edit. The count is now
asserted before the loop.

**Mutation M9 — delete the icon.** Ran, reddened:

```
FAIL  the condensed service-stop bar > states that sending is stopped for the whole service, in words
AssertionError: the condensed bar has no icon: expected to have a length of 1 but got +0
  536 |  expect(icons, "the condensed bar has no icon").toHaveLength(1);
 Test Files  1 failed (1)
      Tests  1 failed | 22 passed (23)
```

Reachability: the two text assertions above it (`Sending stopped`, `the whole service`) are
unaffected by removing an icon and passed, so the failure is at the intended assertion.

**The dark-mode checks.** `not.toBe("rgba(0, 0, 0, 0)")` is near-tautological — almost nothing
resolves to transparent, so it passed for any colour at all, including a hardcoded one that never
changes theme, which is the exact defect a dark-mode check exists to catch. The test now reads the
bar's resolved ink and surface in light **and** dark and asserts they differ from each other, which
is what the shell's own long-standing dark test does.

**Mutation: unrun (blocked, §R0).** Designed: replace `text-[color:var(--danger-text)]` with
`text-[color:var(--danger-solid-contrast)]`. That token is `#ffffff` in both themes —
`src/app/globals.css:436` (light) and `:707` (dark) — so it is opaque, which satisfies the round-1
assertion, and identical across schemes, which reddens the new one. Reachability is designed in:
`expect(dark.display …).not.toBe("none")` precedes the colour comparison and is unaffected by an
ink change. Argued from the token values, not executed; not claimed as proved.

## R4. Finding 4 — stale DOM references after a soft navigation

Fixed rather than documented as a limit, because the fix is three lines and the failure mode is
nasty. The watcher now resolves its three nodes **inside** `update()`, on every read, instead of
capturing them once when the effect ran. A client-side navigation back into this route re-renders
the server tree; the captured banner would then be a detached node whose rectangle is all zeros,
which reads as "the banner has gone" and would pin the bar permanently. Re-reading three ids costs
nothing measurable beside the two `getBoundingClientRect` calls next to them, and a missing node is
simply a frame with nothing to decide.

No test covers it, and that is stated plainly rather than papered over: no route navigates softly
into this page today, so there is nothing to drive such a test through. It was a latent trap, not
an observable bug, and it is now closed by construction rather than by coverage.

## R5. Ruled not to fix

`CondensedServiceStopBar({ state: ServiceState })` still holds the whole record, so `state.note`
would compile in that wrapper even though it cannot compile in the renderer. Left as is by the
owner's ruling: it is exactly the shape `ServiceStateBanner` beside it already has, the wrapper
renders no JSX, and the note-sentinel test scans the whole rendered markup at runtime. A comment at
the wrapper now says so, so the next reader does not re-litigate it.

## R6. Round-1 verification

```
node scripts/run-vitest.mjs run tests/caring-contacts-explained-automation.dom.test.tsx \\
  tests/caring-contacts-workspace-shell.dom.test.tsx --reporter=dot

 Test Files  2 passed (2)
      Tests  33 passed (33)
```

`eslint` on all four changed files: clean. `tsc --noEmit`: seven errors, all in the two foreign test
files of §R0, none in any file of this change.

The heavy-run lock refused several attempts (`Database focused-test capacity is full`, from two
other worktrees), and one attempt died on a Windows `EPERM` renaming the lock sentinel while
**exiting 0** — the trap exactly as briefed. Every run above was retried until it printed a real
`Test Files` line; nothing was read off an exit code.

**Still owed, and owed to §R0 rather than to this change:** the clean browser run, the finding-1
mutation at 1440, and the finding-3 dark-mode mutation. They need the Playwright build to type-check
and the workspace route to be reachable under `NODE_ENV=production`.
