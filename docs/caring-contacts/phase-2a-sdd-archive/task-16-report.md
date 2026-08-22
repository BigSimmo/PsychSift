# Task 16 report — the service-state banner and the explained-automation contract

Branch `claude/suicide-contact-mockup-b5aaa0`, worktree `D:\Worktrees\Database\cc-2a-live`.

---

## 1. What I implemented

**`src/components/caring-contacts/workspace/automated-state.tsx` (new).**
`AutomatedState({ state, because, changedBy })` — a Server Component rendering the state, the
reason and the remedy inside one `role="group"` named by the state. Spec §4.4 requires the reason
and remedy to be reachable _in place_; putting all three in one named region means a screen reader
that reaches the state has already entered the group and therefore reaches both.

The group is named with `aria-label` rather than `aria-labelledby`. That is a deliberate trade:
`aria-labelledby` needs an id, an id needs `useId`, and `useId` is a hook — which would make every
screen that shows an automated state ship a client component and break Ruling 13's client-payload
budget. `aria-label` carries exactly the same visible string, so nothing is lost in the
accessibility tree.

**`src/components/caring-contacts/workspace/service-state-banner.tsx` (new).**
`ServiceStateBanner({ state })` — the pinned signature, unchanged. Returns `null` while running.
While stopped it renders `role="status"` containing:

- the state in words, `Sending stopped`, beside an `aria-hidden` `OctagonX` icon;
- the sentence from the sealed `describeServiceStop`, which supplies the categorised reason in
  plain words ("a message reached the wrong recipient"), the approval count ("0 of 3 restart
  approvals recorded"), and the roles still outstanding — so what stopped sending and what would
  start it again are stated together, in the banner, not behind a hover;
- a control for the service-stop screen.

**`src/components/caring-contacts/workspace/shell.tsx` (modified).** New optional
`serviceState?: ServiceState` prop; the banner renders directly under the sticky header, above the
screen's own content, so a stop is the first thing read on every screen. `SyntheticMarker` and its
pinned wording were not touched.

**`tests/caring-contacts-explained-automation.dom.test.tsx` (new).** Ten tests — the brief's four,
plus six added below.

### Deviations from the brief, and why

1. **The brief's running-state fixture uses a field that does not exist.** The brief writes
   `state={{ stopped: false, teamId: teamId("TEAM-A") }}`. The sealed type's field is
   `reportedByTeamId`, named that way on purpose (it is provenance, and must never be read as
   scoping the stop). I used the domain's own constructor, `runningService(teamId("TEAM-A"))`,
   rather than hand-building a literal. No assertion changed.
2. **The service-stop control is not a `<Link>`.** The instruction said to build the href from
   `caring-contacts-routes.ts`, and also that the destination is unbuilt and must use the
   stated-reason convention. Those two cannot both be satisfied: `CARING_CONTACTS_ROUTES.serviceStop`
   has no page, so a `<Link>` to it is a link into a 404, which Ruling 52 forbids and which the
   shell's existing test would catch. I used `UnavailableDestination`, and named the route constant
   in a comment so the Plan 2B change is a one-line substitution. **Flagging this explicitly** in
   case the intent was the opposite.
3. **`AutomatedState` has no `className` prop.** I kept the exported type byte-for-byte as briefed
   rather than adding even an optional field to a pinned interface. Callers wrap it for placement.
4. **`AutomatedState` is not yet rendered by any screen.** It is a module contract for Tasks 17–18,
   exactly as the brief scopes it. Noted here so a future dead-code sweep does not read "no
   importers" as "debris" — the standing warning in `AGENTS.md`.

---

## 2. TDD evidence

### RED

```
$ node scripts/run-vitest.mjs run tests/caring-contacts-explained-automation.dom.test.tsx --reporter=dot

 FAIL  |jsdom| tests/caring-contacts-explained-automation.dom.test.tsx
Error: Failed to resolve import "@/components/caring-contacts/workspace/automated-state" from
"tests/caring-contacts-explained-automation.dom.test.tsx". Does the file exist?

 Test Files  1 failed (1)
      Tests  no tests
```

Expected failure, for the stated reason: the test file was written before either component existed,
so the suite could not even resolve its imports. The `Test Files` summary line is present, so this
was a real run and not a lock-acquisition failure.

### GREEN

```
$ node scripts/run-vitest.mjs run tests/caring-contacts-explained-automation.dom.test.tsx --reporter=dot

 Test Files  1 passed (1)
      Tests  10 passed (10)
```

### Full suite

```
$ npm run test

 Test Files  699 passed | 2 skipped (701)
      Tests  7750 passed | 29 skipped (7779)
   Duration  210.85s
```

No existing assertion was deleted, loosened, or edited. The shell's existing
`caring-contacts-workspace-shell.dom.test.tsx` — including its exact count of sixteen unavailable
controls — passes unchanged, because it renders the shell without a `serviceState` and the banner
therefore contributes nothing.

### Other gates

```
$ node ./node_modules/typescript/bin/tsc -p tsconfig.json --noEmit      → exit 0, no diagnostics
$ npx eslint <the four changed files>                                    → exit 0, no findings
$ npm run format                                                         → applied; tree clean
$ node scripts/run-vitest.mjs run tests/codebase-index-coverage.test.ts tests/repo-hygiene.test.ts \
    tests/caring-contacts-explained-automation.dom.test.tsx tests/caring-contacts-workspace-shell.dom.test.tsx \
    tests/caring-contact-route-files.test.ts tests/caring-contacts-domain-isolation.test.ts --reporter=dot

 Test Files  6 passed (6)
      Tests  92 passed (92)
```

That last run is the re-check after the `docs/codebase-index.md` rows were added, which happened
after the full `npm run test`. Four attempts were refused first with
`Database focused-test capacity is full (current owner PID 21184, worktree ...\care-plan-impl)` —
an acquisition failure, not a result, so it was retried until a real run happened.

---

## 3. Mutation evidence

### Mutation A — Step 5: `AutomatedState` renders no remedy

**Confirmed first that an assertion reads the value:** the test asserts the region has text content
`"Move the first contact date on the plan."`, which is precisely the `changedBy` prop. Removing the
remedy paragraph therefore removes a string an assertion reads.

Mutation: deleted the remedy `<p>` from `automated-state.tsx`, leaving `{void changedBy}` so the
prop stayed referenced and the failure was about the missing output, not an unused variable.

```
FAIL  ... > never shows a bare automated state without a reason and a remedy
Error: expect(element).toHaveTextContent()
Expected element to have text content:
  Move the first contact date on the plan.
Received:
  SuppressedWhy: Week 1 falls on the first contact day.
 ❯ tests/caring-contacts-explained-automation.dom.test.tsx:54:20

 Tests  2 failed | 8 passed (10)
```

Two tests went red: the brief's first test (line 54) and my tooltip test (line 74).
**Reverted** — the file was restored from a byte copy taken before the mutation, and
`grep -c "What changes it"` returns `1`.

### Mutation B — the sentinel: leak the responder's note

**Confirmed first that an assertion reads the value:** the sentinel test asserts
`container.innerHTML` does not contain `NOTE-LEAK-SENTINEL-9F3C`, and that string is present only
in the fixture's `note`. Rendering the note therefore changes exactly what the assertion reads.

Mutation: in `ServiceStateBanner` — the outer function, where the _whole_ `ServiceState` is in scope
— added `<p>{state.note}</p>` beside the narrowed renderer.

```
FAIL  ... > cannot put the responder's incident note on screen, whatever the note says
AssertionError: expected '<p>NOTE-LEAK-SENTINEL-9F3C Week 3 mes…' not to contain 'NOTE-LEAK-SENTINEL-9F3C'
 ❯ tests/caring-contacts-explained-automation.dom.test.tsx:95:37

FAIL  ... > keeps the note out of the banner on every screen the shell renders
 ❯ tests/caring-contacts-explained-automation.dom.test.tsx:104:37

 Tests  2 failed | 8 passed (10)
```

**Reverted** — restored from a byte copy; `grep -n "state.note"` in the file returns nothing.

**The finding this mutation produced, which is the reason the extra test was worth writing.**
Under this leak the brief's own assertion — `expect(banner.textContent).not.toMatch(/Rowan|Mira|\+61/)`
— **stayed green**. The leaked paragraph sat immediately outside the `role="status"` element, so a
check scoped to the banner's own text content never saw it, even though the patient's name, a second
name and an Australian mobile number were all sitting in the rendered page. The sentinel test, which
scans the whole `container.innerHTML`, caught it in both the component and the shell. The brief's
assertion is not decorative — it does catch an in-banner leak — but on its own it is narrower than
the guarantee Ruling 43 asks for.

I could not construct a mutation that leaks the note _inside_ the `role="status"` region without
also changing a type, which is section 4's point.

---

## 4. How the note is structurally out of the banner's reach

The file has two functions, and the split is the guarantee:

- `ServiceStateBanner({ state }: { state: ServiceState })` — the pinned signature. It contains no
  JSX of its own beyond one element. It reads exactly three fields (`stopped`, `reason`,
  `restartApprovals`) and hands them on.
- `StoppedServiceBanner({ facts }: { facts: ServiceStopBannerFacts })` — every piece of markup lives
  here. `ServiceStopBannerFacts` omits `note` by construction (the sealed domain built it for
  exactly this), so inside this function the note **is not in scope**. A future edit that tries to
  render it is a compile error, not a judgement call.

That is why the parameter type matters more than the markup: a comment asking an editor not to
interpolate a field that is sitting in scope is not a guarantee, and the branch has already ruled
that omission-by-markup is insufficient here (Rulings 43 and 8). The narrowing also matches what the
production data path will actually hand the banner —
`src/lib/caring-contacts-server/service-state-view.ts` builds its banner string from the same
`ServiceStopBannerFacts` shape — so this component asks for nothing that path cannot supply.

**What the sentinel test proves.** `NOTE_SENTINEL` is a string that exists nowhere in the repository
except the fixture's note, so any path from `note` to the DOM — a paragraph, a `title`, an
`aria-label`, a `data-*` attribute — makes it appear. The test scans `container.innerHTML`, not
`textContent`, so an attribute leak is caught as surely as a visible one, and it is asserted twice:
once on the banner alone, once on the whole shell. The brief's `/Rowan|Mira|\+61/` check only catches
the leak it happened to imagine; the next responder's note could name a ward, a message id or a
street, and none of those literals would fire. Both checks are kept.

---

## 5. Status without colour

Three carriers, none of which is colour:

1. **Text.** The banner's first line is the word `Sending stopped`. The second is the full
   `describeServiceStop` sentence: _"All caring-contact sending is stopped for the whole service
   because a message reached the wrong recipient. 0 of 3 restart approvals recorded. Still needed:
   the incident lead, the privacy and security owner and the clinical programme lead, each from a
   different person."_ Read aloud, printed in greyscale, or rendered in forced colours, every fact
   survives.
2. **Icon.** `OctagonX` beside the state word — `aria-hidden="true"`, because it reinforces the text
   rather than replacing it. `AutomatedState` uses `CircleAlert` the same way.
3. **Structure and semantics.** `role="status"` on the banner; `role="group"` named by the state on
   `AutomatedState`; the reason and remedy as their own labelled paragraphs (`Why:` /
   `What changes it:`) rather than as a hover.

Colour is applied on top of that (`--danger-bg` / `--danger-border` / `--danger-text`) with explicit
`forced-colors:` fallbacks, and never carries a fact on its own.

**How I tested it.** One test asserts the banner's `textContent` alone contains both
`"Sending stopped"` and `"stopped for the whole service"` — the strings that survive when styling is
gone — and then walks every `<svg>` in the banner asserting `aria-hidden="true"`, which proves the
icon is decoration on top of the words rather than the carrier of them. A second test walks every
`[title]` in an `AutomatedState` render and asserts the reason and the remedy are _not_ in a
tooltip, then asserts both are in the region's text.

I did **not** run a browser, a greyscale render, or a forced-colors pass. The colour-independence
claim is proved at the DOM level only.

---

## 6. Next.js 16 guides read

- `node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md` — to
  confirm the Server/Client boundary rules before deciding that `AutomatedState` and
  `ServiceStateBanner` stay Server Components and that the banner may compose the existing
  `UnavailableDestination` client component with plain-string props. That decision is what ruled out
  `useId`, and therefore what fixed the `aria-label` naming choice in §1.

Nothing else here is framework-shaped: no route, no `params`/`searchParams`, no caching, no
`error.tsx`/`loading.tsx` change.

---

## 7. Files changed

| File                                                                | Change                                                          |
| ------------------------------------------------------------------- | --------------------------------------------------------------- |
| `src/components/caring-contacts/workspace/service-state-banner.tsx` | new                                                             |
| `src/components/caring-contacts/workspace/automated-state.tsx`      | new                                                             |
| `src/components/caring-contacts/workspace/shell.tsx`                | optional `serviceState` prop; banner mounted under the header   |
| `tests/caring-contacts-explained-automation.dom.test.tsx`           | new — 10 tests                                                  |
| `docs/codebase-index.md`                                            | two rows for the new components (2 insertions, no table reflow) |
| `docs/caring-contacts/phase-2a-sdd-archive/task-16-report.md`       | this report                                                     |

No migration. No mockup file touched. `synthetic-marker.tsx` untouched.

---

## 8. Self-review

- **Repository contracts.** No hex; every colour is a token (`--danger-*`, `--border`,
  `--surface*`, `--text*`). No raw pixel padding, radius, gap or line-height — Tailwind scale steps
  and `var(--radius-*)` only. No `dark:` override. No `z-` class added at all. No `min-h-11`
  anywhere; the banner's control is `min-h-tap`. Every `<button>` is wired through
  `UnavailableDestination` (`aria-disabled` + inert handler + `title` + `sr-only` reason, never
  native `disabled`, never both). Both lucide icons carry `aria-hidden`. No internal `<a href="/…">`.
  `npx eslint` on all four changed files: exit 0.
- **Prohibited vocabulary.** Checked every string I added against the banned list. `Sending stopped`
  and `Service stop` describe the service, not a patient; no transport word is used as a patient
  state; nothing claims replies are monitored. Australian English, sentence case, verb-first reasons.
- **`describeServiceStop` is the only source of the banner's wording.** I did not restate the
  reason-category or approval wording in the component, so the sealed domain stays the one place it
  can change.
- **`role="status"` implies `aria-live="polite"`.** On client-side navigation between workspace
  screens the banner may be re-announced. The brief specifies `role="status"`, and re-announcing a
  service-wide stop is the conservative failure direction, so I left it — flagging it as a known
  behaviour rather than an oversight.
- **`docs/codebase-index.md` was not in the brief's file list.** I added two rows because the index
  already carries the shell, width-state and unavailable-destination rows and would otherwise be
  stale. It is a docs-only addition; say the word and it comes out.
- **Pre-existing failure, not mine.** `node scripts/check-docs-links.mjs` fails on this branch. On
  the stashed clean tree it reports `10 missing path(s) across 2252`; with my change it reports
  `7 missing path(s) across 2254` — my three new files satisfy three references the task briefs
  already made. The remaining seven (e.g. `docs/caring-contacts/phase-2a-visual-differences.md`,
  referenced by the Task 19 brief) are files later tasks have yet to create.
- **`AutomatedState` has no consumer yet.** By design; noted in §1 so it is not mistaken for dead
  code later.

---

## 9. Concerns

1. **The service-stop control is not a link** (§1, deviation 2). If the intent was a real `<Link>`,
   that needs the service-stop page built first, which is out of this task's scope. Please confirm.
2. **Colour independence is proved at the DOM level only.** No browser, greyscale or forced-colors
   render was performed. Task 19's visual pass is where that gets real evidence.
3. **The `serviceState` prop is optional, so a screen can silently omit it.** Spec §4.2 says the
   banner is on _every_ screen; today nothing forces a screen to pass the state, because Phase 2A
   screens are static and do not read the store. Once a screen reads it, this wants a gate — a test
   that every workspace page passes `serviceState` — otherwise §4.2 rests on each page author
   remembering. I did not add that gate, because there is exactly one page and it has no data path
   yet. Worth an `/issues` capture when Task 17 or 18 introduces the first real read.
4. **Two "Service stop" controls appear while stopped** — one in the banner, one in the More panel.
   Both state their own reason and both are legitimate, but a reviewer may prefer one.

---

# Follow-up — Rulings 55 and 56

Second pass, after the coordinator's review of the first. Ruling 55 confirmed the sentinel
arrangement already shipped (nothing to change); Ruling 52 confirmed the service-stop control stays
an unavailable control (nothing to change); concerns 4 and 5 were accepted as-is. Ruling 56 is the
one that changed code. **Concern 3 in §9 above is closed by Ruling 56 — see §10 and §12.**

## 10. Ruling 56 — `serviceState` is now required, and the page reads it for real

### What `page.tsx` now reads, and how

`src/app/caring-contacts/page.tsx` became an `async` Server Component and performs the same
three-line server-side read every other consumer of this seam performs:

```ts
const actor = await resolveDemoActor(); // caring-contacts-server/session.ts
const store = await caringContactsStore(); // caring-contacts-server/store.ts
const serviceState = await store.getServiceState({ actor });
```

- `resolveDemoActor()` reads the demo role cookie and resolves the acting actor, falling back to
  the coordinator on anything unreadable. This is the identical call
  `caring-contacts-server/handler.ts` makes at lines 157 and 279.
- `caringContactsStore()` is memoised at module scope and returns the in-memory reference
  repository when `CARING_CONTACTS_DATABASE_URL` is absent — which is the case locally and in the
  offline suite, so this reads a genuinely running service rather than a fabricated one.
- `getServiceState` is deliberately not capability-checked in either store, by design: a stop
  raised by one team halts sending for every team, so every actor of every team must see it.

No literal was typed. There is no `{ stopped: false }` anywhere in `page.tsx`; the running state it
renders today is the state the store actually holds.

**A failed read is deliberately not caught.** There is no honest fallback — rendering "running"
because the store was unreachable is precisely the claim spec §4.2 forbids — so the read is allowed
to reach `error.tsx`, whose copy already says nothing was sent and nothing was changed.

**Reading the cookie makes the route dynamic.** That is the correct direction: a cached copy of a
page asserting nothing is stopped would outlive the stop.

### Why the read does not route through `narrowServiceStateForActor`

**Flagging this as a judgement call**, since the ruling named that module.

`narrowServiceStateForActor` returns `ServiceStateView`, a JSON-releasable shape built for the HTTP
boundary — it is what `src/app/api/caring-contacts/service-state/route.ts` releases over the wire,
and it decides whether the incident note may cross to a client. It cannot feed the shell, because
the pinned banner signature is `{ state: ServiceState }` and a `ServiceStateView` cannot be widened
back into one (it drops `reportedByTeamId`, `stoppedBy` and `note`). Routing through it and then
discarding the result would be theatre.

Page to shell to banner is not the HTTP boundary; it is entirely server-side, and its narrowing is
the banner's own parameter type, `ServiceStopBannerFacts`, which omits `note` by construction and
is _stricter_ than the view (the view may release the note to a capable actor; the banner may never
render it to anyone). So both narrowings exist, at their own boundaries, and neither is bypassed.

I confirmed the server-side claim against the framework rather than from memory:
`node_modules/next/dist/docs/01-app/02-guides/lazy-loading.md` states that dynamically importing a
Server Component lazy-loads only the Client Components beneath it, not the Server Component itself.
The shell therefore stays a Server Component under `next/dynamic`, and its props are never
serialised into the RSC payload.

### Call sites

Two, both fixed by _adding_ an argument — no existing expectation was altered:

1. `src/app/caring-contacts/page.tsx` — the real read above.
2. `tests/caring-contacts-workspace-shell.dom.test.tsx`'s `renderShell()` helper now passes
   `runningService(teamId("shell-test-team"))`. A running service renders no banner, so every
   assertion in that file is unchanged — including the exact count of sixteen unavailable controls,
   which would have moved to seventeen had a stopped state been used.

### The new tests

- **`cannot be rendered by a screen that never read the service state`** — a **type** assertion,
  enforced by `tsc --noEmit`, not by the runtime body. `@ts-expect-error` on a shell element that
  omits `serviceState` fails compilation the moment that error stops occurring, so making the prop
  optional again turns the typecheck red.
- **`keeps the banner on every screen the shell renders`** (from the first pass) covers the second
  half of the ruling: a stopped state reaching the shell puts `role="status"` on the page.

### Mutation C — proving the required-prop test can fail

**Confirmed first that it reads something that changes:** the directive's own validity is the value,
and it is valid only while the omission is an error.

Mutation: changed `serviceState: ServiceState;` back to `serviceState?: ServiceState;`.

```
src/components/caring-contacts/workspace/shell.tsx(240,29): error TS2322: Type 'ServiceState | undefined' is not assignable to type 'ServiceState'.
tests/caring-contacts-explained-automation.dom.test.tsx(146,7): error TS2578: Unused '@ts-expect-error' directive.
```

Both the intended line (the test, TS2578) and a second site went red. **Reverted**; `grep` confirms
`serviceState: ServiceState;` and a clean `tsc`.

## 11. Follow-up gate evidence

```
$ node ./node_modules/typescript/bin/tsc -p tsconfig.json --noEmit          -> exit 0, no diagnostics

$ npx eslint src/app/caring-contacts/page.tsx src/components/caring-contacts/workspace/shell.tsx \
    src/components/caring-contacts/workspace/service-state-banner.tsx \
    src/components/caring-contacts/workspace/automated-state.tsx \
    tests/caring-contacts-explained-automation.dom.test.tsx \
    tests/caring-contacts-workspace-shell.dom.test.tsx                      -> exit 0, no findings

$ node scripts/run-vitest.mjs run tests/caring-contacts-explained-automation.dom.test.tsx \
    tests/caring-contacts-workspace-shell.dom.test.tsx tests/caring-contact-route-files.test.ts \
    tests/route-reachability.test.ts tests/caring-contact-linked-routes.dom.test.tsx --reporter=dot

 Test Files  5 passed (5)
      Tests  55 passed (55)

$ npm run test

 Test Files  699 passed | 2 skipped (701)
      Tests  7751 passed | 29 skipped (7780)
   Duration  224.25s
```

That is every suite that renders the shell (`caring-contacts-workspace-shell`,
`caring-contacts-explained-automation`), every suite that reads the route files
(`caring-contact-route-files`, `route-reachability`, `caring-contact-linked-routes`), and then the
whole offline suite. One test more than the first pass (7751 vs 7750) — the new type assertion.

`npm run format` was run and its result committed. A Python-written edit had left CRLF endings in
two files, which Prettier normalised to LF before the commit (`.gitattributes` sets `eol=lf`).
Verified at byte level: zero CRLF pairs in all four changed source and test files.

## 12. Follow-up self-review and residual concerns

- **`page.tsx` is now dynamic and async.** No unit test renders it (none imports the module), and
  `route-reachability` and `caring-contact-route-files` both pass. The Playwright spec
  `tests/ui-caring-contacts-workspace.spec.ts` does drive the real page in a browser and was **not**
  run — `verify:ui` is outside this task's permitted commands. Stated plainly: the browser behaviour
  of the now-async page is **unverified by me**. The change is a data read above an unchanged tree,
  and the in-memory store returns a running service, so the rendered output should be identical to
  before; that is reasoning, not evidence.
- **`store.ts` is `server-only` and statically imports the Postgres repository**, so `page.tsx` now
  pulls `pg` into its _server_ bundle. The API routes already did, and nothing client-side changed,
  so Ruling 13's client-payload guarantee is untouched.
- **The banner is unreachable in normal local use**, because the in-memory store starts running and
  nothing in Phase 2A stops it. That is honest rather than convenient — the screen shows what the
  store holds. The stopped path is exercised by the DOM tests, not by clicking about.
- **Concern 3 from the first pass is closed by Ruling 56** and needs no `/issues` capture.
- Concerns 1, 2, 4 and 5 from the first pass were ruled on by the coordinator and need no further
  action; the code is unchanged for all four.

---

# Follow-up 2 — browser proof of the now-async page

Third pass. Concern 1 was cleared by the coordinator, who verified the client-boundary claim
directly rather than accepting the explanation; no change. Concern 2 — that no browser had ever
rendered the page after it became `async` — is the whole of this round.

## 13. The focused browser gate

`npm run ensure` reported the project server at `http://localhost:3651` (never assumed; the URL
came from the helper). `scripts/run-playwright.mjs` then built and served its own production copy
on port 3652, which is how that wrapper works — it does not attach to the dev server.

```
$ npm run ensure
Clinical KB is running at http://localhost:3651

$ node scripts/run-playwright.mjs tests/ui-caring-contacts-workspace.spec.ts --project=chromium

  ✓ Compiled successfully in 48s
  ✓ Generating static pages using 1 worker (1854/1854) in 18.3s

Running 9 tests using 1 worker

  ok 1 [chromium] › ... › holds the frozen layout at 320px (2.0s)
  ok 2 [chromium] › ... › holds the frozen layout at 390px (845ms)
  ok 3 [chromium] › ... › holds the frozen layout at 430px (814ms)
  ok 4 [chromium] › ... › holds the frozen layout at 768px (746ms)
  ok 5 [chromium] › ... › holds the frozen layout at 1024px (765ms)
  ok 6 [chromium] › ... › holds the frozen layout at 1440px (757ms)
  ok 7 [chromium] › ... › re-resolves its surfaces and ink in dark rather than leaking a light value (949ms)
  ok 8 [chromium] › ... › keeps the synthetic marker delimited once forced colours drop its tint (810ms)
  ok 9 [chromium] › ... › prints with the synthetic marker still on the page (770ms)

  9 passed (10.6s)
EXIT=0
```

**The spec passed unchanged.** Not one line of it, or of any other file, was touched to make it
pass. Nine of nine, first run, no retries, no quarantine, no flake. The wrapper exited `0` — not the
`75` / `DATABASE_HEAVY_RUN_ADMISSION_BUSY` code it uses when heavy-lock admission times out, so this
is a real run rather than a blocked one, and the `9 passed` line is the proof rather than the exit
code.

### The two things the coordinator asked me to watch

**The duplicate-shell assertion held.** It lives in the spec's `openWorkspace` helper —
`await expect(page.getByTestId("caring-contacts-rail")).toHaveCount(1)` — and therefore ran before
every one of the nine tests, at all six review widths plus the dark, forced-colours and print
cases. This was the assertion most at risk from the change: Task 15 found the shell rendering twice
while React streamed the segment into a hidden holder under `loading.tsx`'s Suspense boundary, and
adding a real `await` to the page changes exactly when that streaming happens. It did not reappear.
Nine independent samples of a one-shell page.

**The synthetic marker survived in every medium.** Test 9 emulates print media and asserts the
marker is still visible with no horizontal overflow; test 8 asserts it keeps a non-transparent
border once forced colours strip its tint; test 7 asserts its ink actually re-resolves in dark
rather than leaking a light value. The marker renders in the shell header, which now sits behind an
awaited store read, and all three passed.

**No layout jump forced a `loading.tsx` change.** The escape hatch the coordinator reserved was not
needed — `loading.tsx` is untouched.

## 14. What was and was not run this round

**Nothing changed except this report.** No source file, no test file, no configuration. Because of
that I did **not** re-run `npm run test`, `tsc --noEmit` or `eslint` — they were run and pasted in
§11 against the exact content the browser run just exercised, and re-running them would buy the same
verdict twice on unchanged content, which `AGENTS.md` explicitly rules out. `npm run format` was run
so the Markdown appended here is formatted, and the pre-commit hook's documentation synchronisation
ran clean.

Stated plainly rather than implied: the only new evidence in this round is the nine-test browser
run above.

## 15. Housekeeping

The `npm run ensure` dev server is **still running** at `http://localhost:3651` (log:
`dev-server.log`). It was started at the coordinator's explicit instruction and is this project's
own server, so it was left up rather than stopped. The Playwright wrapper's production server on
port 3652 was started and torn down by the wrapper itself.

## 16. Residual concerns after this round

**None from Task 16's own scope.** Both earlier concerns are now closed: concern 1 by the
coordinator's own client-boundary check, concern 2 by the browser run above.

One standing limitation is worth restating because it is a property of the whole branch rather than
of this change: **Chromium evidence is not physical Safari or installed-PWA acceptance.** Nothing
here closes that, and nothing here made it worse.

---

# Follow-up 3 — review findings, fix round 1

Fourth pass, addressing the Approved review's two Important findings and four minors. Everything
here is additive; no existing assertion was deleted or loosened.

## 17. Important 1 — the banner now has to say what would restart the service

Spec §4.4 has two halves and the banner owed both. The reason half was asserted; the remedy half —
`describeServiceStop`'s third sentence, `Still needed: …, each from a different person.` — was
produced by the code and pinned by nothing.

Added to `tests/caring-contacts-explained-automation.dom.test.tsx`:
`names what would restart the service, not only why it stopped`. It asserts the banner's text
contains `still needed`, each of the three outstanding role wordings, and `each from a different
person` — the last because the restart is a three-PERSON decision, not three tick-boxes one person
can supply, and a banner that omits that misdescribes the remedy. It also asserts
`REQUIRED_RESTART_APPROVAL_ROLES` has length 3, so the "0 of 3" the clinician reads is tied to the
sealed list rather than to a second copy of the number.

### Mutation D — deleting the remedy sentence

**Confirmed first that an assertion reads it:** the `Still needed: …` clause is produced by that
sentence and by nothing else.

Mutation: replaced `describeServiceStop`'s third sentence in the sealed domain with nothing.

```
FAIL  ... > names what would restart the service, not only why it stopped
Error: expect(element).toHaveTextContent()
Expected element to have text content:
  /still needed/i
Received:
  Sending stoppedAll caring-contact sending is stopped for the whole service because a message
  reached the wrong recipient. 0 of 3 restart approvals recorded.Service stop record…
 ❯ tests/caring-contacts-explained-automation.dom.test.tsx:107:20

 Test Files  1 failed | 1 passed (2)
      Tests  1 failed | 23 passed (24)
```

**The finding was exactly right, and the mutation shows how narrowly.** Precisely one test went
red — the new one. `tests/caring-contacts-service-state.test.ts`, the sealed domain's own suite, ran
in the same invocation and stayed **green**, because it asserts "0 of 3" and "wrong recipient" and
nothing about the remedy. The remedy half of §4.4 was unpinned across the whole branch.

**Reverted**; the sealed-domain file shows an empty `git diff` and still contains `Still needed`.

## 18. Important 2 — the client-boundary property is now guarded, not just verified

The finding corrects the record and it is right: `ServiceStopBannerFacts` omitting `note` is held by
the type system forever, but "nothing on the `serviceState` path is a Client Component" was held by
nothing at all. `CaringContactsShellProps.serviceState` is a whole `ServiceState`, so `note` is in
scope for every future shell edit, and a `"use client"` added anywhere on that path would serialise
a responder's free text into the RSC payload — readable in the page source, by every team, without
ever appearing on screen — while all eleven DOM tests stayed green, because JSDOM has no RSC payload
to inspect.

Added a `describe("the service-state path stays on the server")` block with two tests:

1. **The allowlist.** Every `.ts`/`.tsx` file under `src/components/caring-contacts/workspace/` is
   read and scanned for a `"use client"` directive; the resulting list must equal exactly
   `["unavailable-destination.tsx"]`. The failure message names the offending file and says what is
   at stake, so a future author who genuinely needs a client component has to come and make the
   case rather than quietly widening the list.
2. **The complement, in its modest form.** The allowed client component must not name the
   service-state module or the `ServiceState` type at all, so `serviceState` cannot be handed to
   the one client component that already exists without this going red too.

**On the stronger check the review asked me to consider — I did not ship it, deliberately.** Proving
from source text that no client component receives a `serviceState`-derived prop needs JSX prop
dataflow analysis: a prop can be spread, renamed, destructured, passed through an intermediate, or
built from a field. A regex approximation would look stronger than it is, which is worse than the
honest pair above — an allowlist that catches every new client boundary, plus a name check on the
one that exists. The gap that remains is: an existing-and-allowlisted client component being handed
a state-derived value under a different name. Today that is impossible (there is one such component
and it names nothing from the module), and the allowlist forces a review before a second one exists.

### Mutation E — adding `"use client"` to the banner

**Confirmed first that an assertion reads it:** the guard's array is built from the directive scan.

```
FAIL  ... > keeps every workspace component but the one allowed client control a Server Component
AssertionError: A new Client Component appeared under src/components/caring-contacts/workspace/. …
expected [ 'service-state-banner.tsx', …(1) ] to deeply equal [ 'unavailable-destination.tsx' ]

+   "service-state-banner.tsx",
    "unavailable-destination.tsx",
 ❯ tests/caring-contacts-explained-automation.dom.test.tsx:271:7
```

The offending file is named in the diff, and the message explains the stake. **Reverted**;
`grep -c "use client"` on the banner returns `0`.

## 19. The four minors

1. **Unused test hooks — dropped, not wired.** `data-automated-state` and
   `data-testid="caring-contacts-service-state-banner"` are gone. Wiring them would have been the
   wrong fix for the stated reason: every test here already finds these surfaces by role
   (`getByRole("status")`, `getByRole("group")`), which is what a user and a screen reader actually
   traverse. Adding an assertion against a hook would have been the very substitution the finding
   warns about. Task 19 can add a hook when it has a consumer for one.
2. **Ruling 52 assertion completed.** The banner's control now also asserts `type="button"` and
   `title` containing "coming soon", matching the sibling shell test's `expectStatesItsReason`.
3. **The privacy scan now inspects the rendered object.** `stoppedServiceState()` is bound to a
   `rendered` const, asserted `toMatchObject({ stopped: true })`, and that same object is passed to
   `render`. Equivalent today under the fixed clock; correct on the day it stops being.
4. **The banner's control has a name of its own.** It is now `Service stop record`, distinct from
   the More panel's `Service stop`, with the reason reworded to match. A new test asserts exactly
   one control is named `Service stop` when the shell renders a stopped state, and that the
   banner's is not that one. The More panel's label is untouched, so the shell test's frozen
   destination list is unchanged.

## 20. Fix-round gate evidence

```
$ node scripts/run-vitest.mjs run tests/caring-contacts-explained-automation.dom.test.tsx \
    tests/caring-contacts-workspace-shell.dom.test.tsx tests/caring-contacts-service-state.test.ts --reporter=dot

 Test Files  3 passed (3)
      Tests  34 passed (34)

$ node ./node_modules/typescript/bin/tsc -p tsconfig.json --noEmit        -> exit 0, no diagnostics

$ npx eslint <the six touched source and test files>                      -> exit 0, no findings

$ node scripts/run-playwright.mjs tests/ui-caring-contacts-workspace.spec.ts --project=chromium

  9 passed (10.7s)
EXIT=0

$ npm run test

 Test Files  699 passed | 2 skipped (701)
      Tests  7755 passed | 29 skipped (7784)
   Duration  202.30s
```

Four more tests than the previous round (7755 vs 7751): the remedy assertion, the distinct-name
assertion, and the two client-boundary guards.

**The browser spec was re-run because rendering changed** — two attributes removed and a label
reworded. Nine of nine again, spec untouched, including the duplicate-shell assertion at all six
widths and the synthetic marker in dark, forced colours and print. Strictly it could not have
regressed (neither the banner nor `AutomatedState` renders on `/caring-contacts`, since the
in-memory store's service is running), but evidence beats that reasoning and the run is cheap.

`npm run format` was run and committed.

## 21. Recorded as deferred, per the review

- **The banner is not sticky and scrolls out of view.** Spec §4.2 says every screen, not always in
  view, so this is not a violation. Decided at **Task 19**, where a browser proof can judge it at
  six widths.
- **`loading.tsx` and `error.tsx` render outside the shell and so carry no banner.** Neither claims
  the service is running, so there is no false confidence. Accepted as scoped.

## 22. Residual concerns

**None.** Both Important findings are now guarded rather than merely verified, all four minors are
fixed, and each guard was proven able to fail. The one limitation worth restating is unchanged and
belongs to the branch rather than to this task: Chromium evidence is not physical Safari or
installed-PWA acceptance.
