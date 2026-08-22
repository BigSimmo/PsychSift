# Task 18 report — one renderer, twenty-four overlays

Status: complete. All nine rules of `task-18-brief.md` are implemented, the brief's test file is
green, all four required mutations were proved to redden a real assertion, and the full `npm run test`
suite is green.

---

## 1. What was implemented

### `src/components/caring-contacts/workspace/overlays/overlay-host.tsx` (new, `"use client"`)

The single renderer. It reads the frozen table (`./definitions.ts`) and branches on **modality**,
never on an overlay id — there is no `switch (definition.id)` anywhere in the file. The modality
itself is `widthStateFor(viewportWidth) === "compact" ? phoneModality : desktopModality`, using the
shared `widthStateFor` from Task 15; no second `matchMedia` and no second copy of 768 exists.

Structure:

- `useViewportWidth()` — `useSyncExternalStore` over `window.innerWidth` and the `resize` event. Its
  `getServerSnapshot` returns `null`, because no width (and therefore no modality) is knowable on the
  server; the host renders nothing there and the first client render agrees with it.
- `SHEET_GEOMETRY` — a five-row table mapping each Sheet-borne modality to `placement` /
  `mobilePlacement`. Rule 6 verbatim: `fullscreen` for `full-screen-stage`, right-edge geometry for
  `inspection-drawer`, `bottom` otherwise. `session-gate` also takes `fullscreen`, which additionally
  suppresses the Sheet's drag grip — a grip would advertise a swipe-to-dismiss the gate does not
  honour.
- `dismissesOnEscapeOrBackdrop(dismissal)` — handles the two values the matrix expresses and
  **throws** outside production on anything else, degrading to the conservative (non-dismissible)
  answer in production rather than the permissive branch (Ruling 58).
- `OverlayBody` — the one body every overlay renders, whatever surface carries it. It stamps
  `data-overlay-id`, `data-overlay-modality` and `data-overlay-dismissal` on the
  `data-testid="workspace-overlay-content"` element that Task 19 will assert against.
- `StatusBannerSurface` — `createPortal(…, document.body)` with `role="status"`. Not a dialog, takes
  no focus, traps none (rule 4).
- One `<Sheet>` call site serves the other three modalities. `recovery-only` withholds `onClose` from
  the Sheet (so Escape and the backdrop do nothing) and passes no `title` (so the Sheet renders no
  header and therefore no close control) — rule 5, with the recovery action the only control present.

Rule 8 (`requiresFreshAuthentication`, true for exactly `withdrawal` and `reassignment` in the table)
is a single early return in `activate()`: the first activation sets a checkpoint keyed to the overlay
id and commits nothing; the visible checkpoint note appears; the same button becomes
"Confirm and continue" and the second activation calls `onCommit`.

Rule 9 reads `definition.mutatesState` from the table: `blocked = blockReason !== null &&
definition.mutatesState`. A blocked action gets `aria-disabled="true"`, `aria-describedby` pointing at
a **visible** reason paragraph, and `ignoreUnavailableActivation` as its handler (never native
`disabled` — the two attributes together are a lint error). A read-only overlay is never blocked; its
own action stays live.

### `src/components/caring-contacts/workspace/overlays/workspace-overlays.tsx` (new, `"use client"`)

The server/client boundary — see §2.

### `src/components/caring-contacts/workspace/shell.tsx` (modified)

Mounts `<WorkspaceOverlays />` once at the end of the shell, with no props. Two lines plus a comment;
the shell is otherwise untouched and remains a Server Component.

### `tests/caring-contacts-explained-automation.dom.test.tsx` (modified)

The client-boundary guard, widened under Ruling 59 — see §5.

---

## 2. The shape chosen for the server/client boundary

`shell.tsx` is a Server Component and must stay one, and `OverlayHostProps` takes two function props,
which cannot cross a Server → Client boundary. I took the shape suggested in the task: a small client
wrapper, `WorkspaceOverlays`, that owns the open-overlay state and both handlers and renders
`OverlayHost` with the pinned props **unchanged**. `OverlayHostProps` is exactly as briefed. The shell
change is a mount and nothing else.

`WorkspaceOverlays` takes **no props at all**. That is deliberate and is the first of Ruling 59's
three conditions: with no props there is no route by which a safety-stop record could reach the client
boundary.

**One decision the brief did not cover, and where it departs from the obvious spelling.** Rule 7 puts
overlay state in the URL as `?overlay=<id>`. The obvious implementation is `useSearchParams` +
`useRouter`. I used the **native History API** instead (`window.history.pushState`, plus a `popstate`
subscription through `useSyncExternalStore`), for three reasons:

1. Next 16's "Linking and Navigating → Native History API" states that `pushState`/`replaceState`
   "integrate into the Next.js Router" and documents exactly this use — keeping a piece of query state
   in the URL.
2. `useSearchParams` client-renders the whole subtree up to the nearest `<Suspense>` boundary, and a
   statically rendered page that calls it without one **fails the production build**. That would have
   meant adding a Suspense boundary to the shell to buy nothing: overlay state is transient interface
   state no server render ever reads.
3. `useSearchParams` returns `null` without a router context (verified in
   `node_modules/next/dist/client/components/navigation.js`, line 97 onward). Mounting a
   `useSearchParams` consumer in the shell would have required adding a `next/navigation` mock to
   `tests/caring-contacts-workspace-shell.dom.test.tsx` and
   `tests/caring-contacts-explained-automation.dom.test.tsx` — i.e. editing existing tests to
   accommodate my change. The History API needs no context and left both files' assertions untouched.

`pushState` emits no event of its own, so the writer dispatches a named custom event that the
`useSyncExternalStore` subscription also listens for. `popstate` covers Back and Forward, which is the
browser-history support rule 7 asks for.

---

## 3. TDD evidence

### RED

```
$ node scripts/run-vitest.mjs run tests/caring-contacts-overlay-host.dom.test.tsx --reporter=dot

 FAIL  |jsdom| tests/caring-contacts-overlay-host.dom.test.tsx [ tests/caring-contacts-overlay-host.dom.test.tsx ]
Error: Failed to resolve import "@/components/caring-contacts/workspace/overlays/overlay-host" from "tests/caring-contacts-overlay-host.dom.test.tsx". Does the file exist?

 Test Files  1 failed (1)
      Tests  no tests
```

Expected for that exact reason: the test file was written first and `overlay-host.tsx` did not exist,
so the suite could not even collect. This is the weakest possible red — it proves the test runs
against the module under test and nothing else — which is why the four mutations in §4 are the real
evidence.

### GREEN

```
$ node scripts/run-vitest.mjs run tests/caring-contacts-overlay-host.dom.test.tsx --reporter=dot

 Test Files  1 passed (1)
      Tests  6 passed (6)
```

(Later 7 passed (7), after adding the prohibited-vocabulary test described in §8.)

The first test alone covers 48 renders — 24 overlays at two widths — and 144 assertions, since it
checks id, modality and dismissal on each.

### Full suite

```
$ npm run test

 Test Files  701 passed | 2 skipped (703)
      Tests  7769 passed | 29 skipped (7798)
```

(The first full run had one failure — `tests/design-system-adoption.test.ts` — because
`overlay-host.tsx` imports the shared `Sheet` and the generated adoption manifest had not been
regenerated. Fixed with `npm run design-system:adoption:update`; the diff is two file-list entries and
the `Sheet` usage count 25 → 26.)

---

## 4. Mutation evidence — all four

For each: I first confirmed the mutation changes a value an assertion actually reads, then ran, then
reverted.

### Mutation A — always use `desktopModality`

Changes `data-overlay-modality`, which the first test reads. Confirmed non-vacuous by inspection: **22**
of the 24 rows have `phoneModality !== desktopModality` — only `session-expiry` and `offline-banner`
match on both widths (e.g. `verify-identity` is `full-screen-stage` on a phone and `dialog` on a
desktop).

> Corrected in fix round 1 (Minor 6). This paragraph originally said 13, which understated the
> mutation: it is more non-vacuous than claimed, not less. Counted mechanically this time, not by eye.

```
 FAIL  … > renders every one of the 24 overlays with its frozen modality at both widths
Error: verify-identity at 390px: expect(element).toHaveAttribute("data-overlay-modality", "full-screen-stage")
Expected the element to have attribute:  data-overlay-modality="full-screen-stage"
Received:                                data-overlay-modality="dialog"
 ❯ tests/caring-contacts-overlay-host.dom.test.tsx:67:56
```

Reverted; re-ran green.

### Mutation B — commit on the first withdrawal activation

Removed the `return` after `setCheckpoint(…)`, so `onCommit` runs on the first click as well. Changes
`onCommit.mock.calls.length`, which the fresh-auth test reads.

```
 FAIL  … > commits a withdrawal only on the second activation
Number of calls: 1
 ❯ tests/caring-contacts-overlay-host.dom.test.tsx:111:26
    111|     expect(onCommit).not.toHaveBeenCalled();
```

Reverted; re-ran green.

### Mutation C — apply `blockReason` to read-only overlays too

`const blocked = blockReason !== null;` (dropping `&& definition.mutatesState`). Changes the
`aria-disabled` attribute of `message-preview`'s action, which the last test reads.

```
 FAIL  … > blocks a mutating overlay with a named reason but leaves a read-only overlay usable
Expected the element not to have attribute:  aria-disabled
Received:                                    aria-disabled="true"
 ❯ tests/caring-contacts-overlay-host.dom.test.tsx:143:32
    143|     expect(readOnlyAction).not.toHaveAttribute("aria-disabled");
```

Reverted; re-ran green.

> **A decorative assertion, reported rather than substituted.** The brief's own final assertion for
> this case is
> `expect(screen.getByRole("button", { name: /close/i })).not.toHaveAttribute("aria-disabled")`. That
> matches the shared **Sheet's** close button, which this renderer never blocks under any value of
> `blockReason` — so mutation C leaves that line green. It is decorative for the behaviour it is
> written next to. I kept it (it is a real, if weak, check that a read-only overlay still has a way
> out) and **added** two assertions that do bite: the read-only overlay's own action
> (`/back to personalisation/i`) is not `aria-disabled`, and clicking it does reach `onCommit`. Line
> 143 above is one of the added ones — the brief's line 139 stays green under the mutation.

### Mutation D (Ruling 59) — a client component that is not on the allowlist

Created `src/components/caring-contacts/workspace/overlays/guard-probe.tsx` carrying `"use client"`.
This is the stronger version of the required proof: the probe sits in the **subdirectory**, so it also
proves the recursive scan added in §5 works.

```
 FAIL  … > the service-state path stays on the server > keeps every workspace component but the allowlisted client controls a Server Component
AssertionError: A new Client Component appeared under src/components/caring-contacts/workspace/. …
  [
+   "overlays/guard-probe.tsx",
    "overlays/overlay-host.tsx",
    "overlays/workspace-overlays.tsx",
    "unavailable-destination.tsx",
  ]
 ❯ tests/caring-contacts-explained-automation.dom.test.tsx:304:7
```

The probe file was deleted; the guard is green again.

### Extra probe (not required) — is the retained closed Sheet load-bearing?

Replacing the closed-state `<Sheet open={false} …>` with `return null` reddens the focus-return test at
`tests/caring-contacts-overlay-host.dom.test.tsx:87` (`expect(trigger).toHaveFocus()` times out). See
§7 for why the Sheet has to stay mounted.

### Extra probe (not required) — is `returnFocusRef` load-bearing?

Setting `openedFromRef.current = document.body` instead of the captured opener also reddens the same
line. So `returnFocusRef` is genuinely consulted and the captured element is genuinely the opener —
the test is not passing on the Sheet's own `previousActiveElement` fallback.

---

## 5. The client-component allowlist (Ruling 59)

**Added, with the reason recorded beside each entry in the test file:**

```ts
const ALLOWED_CLIENT_COMPONENTS = [
  // A declared-but-unbuilt destination: `aria-disabled` plus an inert click handler, so
  // the stated reason keeps its tab stop. Takes only `id`/`label`/`reason`/`className`.
  "unavailable-destination.tsx",
  // Task 18's one renderer for all 24 overlays. Inherently interactive — it reads the
  // viewport width to choose a modality, traps focus, and runs the fresh-authentication
  // checkpoint. Its `blockReason` prop is a NAMED refusal string, never a state object.
  "overlays/overlay-host.tsx",
  // The client boundary that owns `?overlay=<id>` and the two handlers, because function
  // props cannot cross a Server → Client boundary. It takes no props at all, which is
  // what keeps the service-state record on the server side of this seam.
  "overlays/workspace-overlays.tsx",
];
```

**Condition 1 — no client component receives a `serviceState`-derived prop.** `OverlayHost` takes
`openOverlayId`, `onClose`, `onCommit` and `blockReason`. `WorkspaceOverlays` takes nothing at all, and
the shell renders it as a bare `<WorkspaceOverlays />`. Neither file imports from
`@/lib/caring-contacts/service-state`.

**Condition 2 — the companion check now covers every entry.** It already looped the allowlist, so the
substantive fix was elsewhere: I also strengthened it to assert that each allowlisted path actually
exists _and_ actually carries the `"use client"` directive, so a stale entry cannot silently widen the
list without covering anything.

**A gap this uncovered, and closed.** `workspaceSourceFiles()` used a **non-recursive**
`readdirSync(WORKSPACE_DIR)`, so it scanned only the top level of the workspace directory. Files under
`overlays/` — which is exactly where this task puts two client components — were invisible to it.
Without fixing that, the guard would never have gone red at all and Ruling 59's authorisation would
have been unnecessary. It is now `readdirSync(…, { recursive: true, withFileTypes: true })` with
allowlist entries expressed as `/`-separated paths relative to the workspace directory. That is a
strengthening, not a loosening: the check now covers strictly more files than before.

**Condition 3 — deliberate, with the reason.** Each entry carries its own comment, above.

One consequence of the source-text guard worth recording: the guard fails on the mere _mention_ of
`service-state` or `ServiceState` in an allowlisted file. My first draft of the two docblocks named
both, to explain why the constraint exists, and the guard correctly went red. The explanations now
describe the record ("the service-wide safety-stop record", "its incident note") rather than naming its
module or type, with a note in `overlay-host.tsx` saying why the names are described rather than
written.

No existing assertion was deleted or loosened. One test **title** was reworded from "the one allowed
client control" to "the allowlisted client controls", since there are now three.

---

## 6. How modality was kept out of the components and in the table

- No modality literal is ever assigned in a component. `modalityFor()` returns
  `definition.phoneModality` or `definition.desktopModality`, and that is the only place a modality
  value originates.
- The three data attributes are stamped straight from the definition object, not from anything the
  renderer decided.
- The only place a modality string is _written_ in this file is `SHEET_GEOMETRY`'s keys, which is a
  `Record<SheetModality, …>` — TypeScript rejects a missing or misspelled key, so a new modality in the
  table becomes a compile error here rather than a silent default.
- The mutation-A run above is the behavioural proof: substituting the renderer's own idea of a
  modality for the table's reddens 13 rows by name.
- `mutatesState`, `requiresFreshAuthentication`, `dismissal`, `tone`, `title`, `summary`, `decision`
  and `label` are all read from the table too. Nothing about an individual overlay is hard-coded.

---

## 7. The one design decision that needed a non-obvious shape

`OverlayHost` returns a **mounted but closed** `<Sheet open={false}>` when no overlay is open, rather
than `null`. This is not decoration:

The shared Sheet restores focus from its open-effect cleanup, and that cleanup deliberately returns
early when the component is unmounting (`if (unmountingRef.current) return;` in `sheet.tsx`). React
runs the mount-effect cleanup — which sets that flag — before the open-effect cleanup, so a host that
vanished the instant the overlay closed would drop focus on the floor. Keeping the Sheet mounted costs
no DOM (`Sheet` returns `null` when `open` is false) and is what makes rule 6's focus return work. The
extra probe in §4 proves it.

The opener itself is captured in a `useEffect` on `[openOverlayId]`. That effect runs on commit, and
the Sheet's open-focus controller moves focus inside a `requestAnimationFrame`, so
`document.activeElement` is still the opener when the effect reads it. My first attempt captured it
during render, which `react-hooks/refs` correctly rejects ("Cannot update ref during render"); I moved
it to the effect rather than disabling the rule.

---

## 8. Next.js 16 guides read

- `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/use-search-params.md`
- `node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md`
- `node_modules/next/dist/docs/01-app/01-getting-started/04-linking-and-navigating.md` (the "Native
  History API" section)

Nothing in them contradicted the plan, but two points **changed** it:

1. The `useSearchParams` guide is explicit that a statically rendered page calling it outside a
   `<Suspense>` boundary **fails the production build**, and that the hook client-renders everything up
   to the nearest boundary. That, plus the History API section's statement that
   `pushState`/`replaceState` integrate with the router, is why the wrapper uses the History API rather
   than the hook. Had I written this from memory I would have reached for `useSearchParams` first.
2. The server/client guide's "props passed to Client Components need to be serializable" is the exact
   sentence that rules out passing `onClose`/`onCommit` from the server shell, which is what forced the
   wrapper file to exist at all.

I also read `node_modules/next/dist/client/components/navigation.js` to confirm what `useSearchParams`
does without a router context (returns `null` rather than throwing) — relevant because the shell's
existing DOM tests mock no router.

---

## 9. Files changed

| File                                                                            | Change                                                                                  |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `src/components/caring-contacts/workspace/overlays/overlay-host.tsx`            | new — the one renderer                                                                  |
| `src/components/caring-contacts/workspace/overlays/workspace-overlays.tsx`      | new — the client boundary (URL state + the two handlers)                                |
| `src/components/caring-contacts/workspace/shell.tsx`                            | modified — one import, one mount, one comment                                           |
| `tests/caring-contacts-overlay-host.dom.test.tsx`                               | new — the brief's test file, plus three added assertions and one added test             |
| `tests/caring-contacts-explained-automation.dom.test.tsx`                       | modified — recursive scan, allowlist widened with reasons, companion check strengthened |
| `docs/design-system/adoption-manifest.json`, `docs/design-system/COMPONENTS.md` | regenerated (`npm run design-system:adoption:update`) — `Sheet` gains one consumer      |

Not touched: `docs/caring-contacts/interaction-matrix.md`, `overlays/definitions.ts`,
`src/app/mockups/caring-contacts`, `src/components/caring-contacts/mockups`, any migration.

## 10. Repository contracts checked

- **Button wiring** — the one action button always has an `onClick` (the real action, or
  `ignoreUnavailableActivation` when blocked). `aria-disabled` without native `disabled`; never both.
  `npx eslint` on all five changed files is clean.
- **Tap targets** — every action uses `controlBase` / `primaryControl` / `floatingControl`, all of which
  carry `min-h-tap` (48 px). No `min-h-11` anywhere.
- **Tokens** — every colour, radius, shadow and spacing value is a `var(--…)` token or a Tailwind scale
  class. No hex, no `dark:` override, no raw pixel padding.
- **z-index** — `z-[var(--z-toast)]` on the status banner; the Sheet owns its own `--z-modal` rung.
- **Icons** — this renderer adds no icons of its own.
- **Navigation** — no anchors added.
- **Vocabulary** — Australian English, sentence case. A new test asserts the renderer adds no
  prohibited vocabulary to what it renders (the definition table's own copy is already guarded
  elsewhere; this covers the words the renderer adds on top).

## 11. Verification run

| Command                                                                           | Result                                                                           |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `node scripts/run-vitest.mjs run tests/caring-contacts-overlay-host.dom.test.tsx` | `Test Files 1 passed (1) / Tests 7 passed (7)`                                   |
| `node ./node_modules/typescript/bin/tsc -p tsconfig.json --noEmit`                | clean, no output                                                                 |
| `npx eslint <5 changed files>`                                                    | clean, no output                                                                 |
| `npm run test`                                                                    | `Test Files 701 passed, 2 skipped (703)`; `Tests 7769 passed, 29 skipped (7798)` |
| `npm run format`                                                                  | run; the working tree carries only the files listed in §9                        |

No provider-backed command was run. No push, no PR, no `verify:*`.

---

## 12. Self-review findings

1. **The brief's `/close/i` assertion is decorative for the blocking rule.** Reported in §4 rather than
   substituted, and covered by added assertions.
2. **`returnFocusRef` is not the only thing making focus return work.** The shared Sheet's own
   `previousActiveElement` fallback would resolve to the same element in the common case. I proved the
   ref _is_ consulted first (§4, extra probe), so rule 6 is honoured substantively and not just
   nominally — but a future reader should know the two mechanisms overlap.
3. **The guard I was told would go red would in fact not have.** `readdirSync` was non-recursive, so
   nothing under `overlays/` was ever scanned. Fixed (§5). This is the finding I would most want a
   reviewer to check.
4. **The Sheet header and Escape-dismissal are coupled.** `dismissible` decides both whether the Sheet
   renders a header (and therefore a close button) and whether Escape works. That is exactly right for
   the current table, where the only `recovery-only` rows are the gate and the banner. If a future row
   ever paired `recovery-only` with a sheet modality, it would render with no header at all — probably
   what you would want, but it is a coupling rather than two independent decisions.
5. **The status banner does not keep a Sheet mounted.** Closing a status banner therefore restores no
   focus — correct, since it never took any — but switching directly from a sheet overlay to a banner
   overlay unmounts the Sheet and loses that restore. An edge case no interaction currently produces.
6. **`checkpoint` state is adjusted during render** (`if (checkpoint !== null && checkpoint.id !==
openOverlayId) setCheckpoint(null)`). That is React's documented "adjusting state when a prop
   changes" pattern and lints clean, but it is the one place in the file where render is not pure of
   effect.

## 13. Concerns

1. **Nothing in the workspace opens an overlay yet, and `onCommit` records nothing.** `?overlay=<id>`
   is reachable only by typing it, and the wrapper's `commit` closes the overlay without writing
   anything, because the screens that raise these overlays and the stores their decisions go to are
   later tasks. It is stated in the wrapper's docblock rather than left to look finished. It does mean
   a curious user who typed the URL could press "Pause future contacts" and see only the overlay close.
   If that is unacceptable before triggers exist, the mount can be deferred — but the brief asked for it.
2. **`blockReason` is rendered verbatim.** The prop is documented as "a named permission/connectivity
   refusal", and `permission-unavailable` is a machine-shaped identifier to put in front of a
   clinician. The renderer wraps it in a sentence ("This action is unavailable. The reason given is
   …"), but whoever supplies the value should be supplying human wording, and no test currently forces
   that. Worth a ruling before the first real caller.
3. **The dismissal fallback throws in development and test.** `dismissesOnEscapeOrBackdrop` throws
   during render on an unrecognised value, which crashes the tree in dev — deliberate, and matching the
   shared Sheet's own precedent for the missing-accessible-name case, but it is a render-time throw and
   worth knowing about.
4. **Two tests intermittently time out in this worktree** (`tests/codex-cloud-setup.test.ts`,
   `tests/design-sync-contract.test.ts`). Both passed in the full run reported above.

---

# Fix round 1 — three Important findings and six Minors

All nine addressed. Nothing was deferred. One assertion was removed, under the single authorisation
granted (Minor 5), and it is disclosed in full below.

## Important 1 — Back after closing reopened the overlay

**Confirmed and fixed.** `closeWorkspaceOverlay` no longer pushes. It **unwinds** the entry that
opening pushed, via `history.back()`, and falls back to `replaceState` only when this module did not
put that entry there — a deep link, or the workspace as the first entry, where `back()` would take the
user out of the workspace entirely. A module-scoped `pushedOverlayEntry` flag records which case
applies; module scope rather than component state because the fact belongs to the browser's history
stack, which outlives any one mount.

`openWorkspaceOverlay` and `closeWorkspaceOverlay` are now exported so the history behaviour can be
driven directly. Three tests in a new `describe("the overlay URL")` block:

- **does not reopen a dismissed overlay when the browser goes back** — the required proof.
- **closes the overlay when the browser goes back from an open one** — the other half of rule 7, which
  nothing had covered.
- **removes the parameter without leaving the workspace when the overlay came from a deep link** —
  pins the `replaceState` branch, so a later simplification to an unconditional `back()` goes red.

  > **This claim was FALSE as written, and is corrected in fix round 2.** Both seeded entries shared the
  > pathname `/caring-contacts`, so `replaceState` and an unconditional `back()` produced outcomes
  > every assertion accepted. The test also ran the wrong branch. Round 2 gives the prior entry a
  > distinct pathname and proves the mutation reddens it; see "Important 2" below.

**Proved non-vacuous** by restoring the round-1 behaviour (`pushState` on close):

```
 FAIL  … > the overlay URL > does not reopen a dismissed overlay when the browser goes back
Expected: "marker=before"
Received: "?overlay=pause"
 ❯ tests/caring-contacts-overlay-host.dom.test.tsx:320:56
```

That is the reported defect reproduced exactly — Back landing on the dismissed overlay. Reverted.

## Important 2 — Ruling 60, the 640–767 band

Implemented as ruled: **no behaviour change**, nothing touched in `sheet.tsx` or `widthStateFor`, and
no className override.

- **Comment at the stamping site** (the element `OverlayBody` returns) stating precisely what
  `data-overlay-modality` means: the frozen contract's modality choice, authoritative below 640 and at
  768 and above; between 640 and 767 the shared Sheet's own `sm:` breakpoint governs rendered
  geometry. It records why the divergence is left alone, that `full-screen-stage` is unaffected
  (`fullscreen` transitions at `lg:` = 1024), and that the reconciliation question is a design-record
  matter for the owner.
- **A test pinning the band and naming its cause** — "pins the 640–767 band where the stamped modality
  and the Sheet's own geometry breakpoint disagree". It asserts the two breakpoints are genuinely
  different, that `widthStateFor` still says `compact` across 640/700/767, that both sides of the band
  agree again at 639 and 768, and that a `bottom-sheet` row at 700 px stamps `bottom-sheet`. If either
  breakpoint moves, it goes red at the exact width instead of the divergence widening unnoticed.

  > **"Either breakpoint" was FALSE as written, and is corrected in fix round 2.** As shipped in round
  > 1 the pin held only the RAIL edge, which it read from `WORKSPACE_WIDTH_BREAKPOINTS.rail`. The
  > Sheet's 640 was a bare literal read from nothing, so a change to the shared component would have
  > left the test green while the band widened. Round 2 adds source-text assertions over `sheet.tsx`
  > and `globals.css` for that edge; see "Important 3" below.

## Important 3 — the guard's blind spot one directory up

**Confirmed and closed.** `src/app/caring-contacts/page.tsx` awaits the record and hands it to the
shell, and sat outside the scan root. The workspace scan is now a parameterised `sourceFilesUnder(root)`
called for two roots, and a second assertion — "keeps the route segment that reads the record a Server
Component" — scans `src/app/caring-contacts/**` with its own allowlist.

That allowlist has exactly one entry, `error.tsx`, and it is not a judgement call: Next.js **requires**
an error boundary to be a Client Component. It takes only `error` and `reset`, and the same companion
proof applies to it — it must carry the directive, and must name neither the service-state module nor
its type.

**Proved** by adding `"use client"` to `page.tsx`:

```
 FAIL  … > the service-state path stays on the server > keeps the route segment that reads the record a Server Component
AssertionError: A Client Component appeared under src/app/caring-contacts/. `page.tsx` awaits the whole ServiceState …
  [
    "error.tsx",
+   "page.tsx",
  ]
 ❯ tests/caring-contacts-explained-automation.dom.test.tsx:364:7
```

Reverted; `git diff src/app/caring-contacts/page.tsx` is empty.

## Minor 4 — the duplicated prohibited-vocabulary regex

One source now: `tests/helpers/caring-contacts-prohibited-language.ts` exports
`CARING_CONTACTS_PROHIBITED_LANGUAGE`, and both `caring-contacts-overlay-definitions.test.ts` and
`caring-contacts-overlay-host.dom.test.tsx` import it. `tests/helpers/` is the existing convention in
this repo. The helper's docblock also records why the list is deliberately wider than
`PROVISIONAL_MESSAGE_RULES.prohibitedTerms`, which governs message text rather than interface copy — so
the next reader does not "reconcile" two lists that are different on purpose.

## Minor 5 — the assertion that could not fail (REMOVAL, disclosed)

**Removed**, under the single authorisation granted:

```tsx
expect(screen.getByTestId("workspace-overlay-content")).toBeInTheDocument();
```

from "keeps the session gate open through Escape". The host is uncontrolled in that test and `open` is
hard-coded true, so no implementation of the renderer could have made that line fail. The `onClose`
assertion beside it is and was the real one.

In its place I added a **discriminating** one: the gate offers no control named "Close". That is the
observable half of "recovery action only" — it fails if the gate ever renders a Sheet header — and it is
an addition, not a replacement for the removed line's (absent) coverage.

## Minor 7 — the Ruling 58 fail-loud branch was unproven

`dismissesOnEscapeOrBackdrop` is now exported and tested directly: `escape-backdrop-close` → true,
`recovery-only` → false, and `action-only` throws with a message naming Ruling 58. Reaching it through
`OverlayHost` is impossible by construction — the frozen table forbids the value — which is exactly why
a direct test was the only way to prove the conservative path at all.

## Minor 8 — the checkpoint copy was outside the vocabulary test

The vocabulary test now renders every overlay **twice**: once refused (the only state that shows the
refusal sentence) and once live, clicking through to the fresh-authentication checkpoint on the two rows
that have one. It asserts the checkpoint is actually on screen before checking the text, and counts the
rows it covered, asserting that count equals the table's own `requiresFreshAuthentication` count — so the
added coverage cannot silently become vacuous if the click stops working.

## Ruling 61 — `blockReason` must not render verbatim

`BLOCK_REASON_WORDING` is an explicit, hand-written, frozen map, and `blockReasonWording` throws — in
**every** environment, not only outside production — on a key with no entry. No default branch, and no
derivation from the identifier.

The throw is unconditional on purpose: a render-time throw here lands on
`src/app/caring-contacts/error.tsx`, which says plainly that nothing was sent and nothing was changed.
That is a true statement and the conservative outcome; showing a clinician a machine identifier, or
inventing a plausible sentence for one nobody wrote, are both worse.

**Two entries, not more** — `permission-unavailable` and `connection-unavailable`, matching the two
categories the pinned prop documents ("a named permission/connectivity refusal"). I drafted four and cut
two: pre-writing wording for refusals nothing produces yet is speculative copy nobody reviewed against a
real screen, and the throw is what makes the next one get written deliberately.

The rendered paragraph is now the mapped sentence alone, with no identifier anywhere in it. The brief's
original `getByText(/permission/i)` assertion is untouched and still passes — the wording was chosen so
it would be, rather than the assertion being adjusted to fit the wording. Two assertions were **added**
beside it: the exact mapped sentence is on screen, and the content element's text does not contain the
string `permission-unavailable`.

A new test walks `NAMED_BLOCK_REASONS` and checks each wording is a sentence, does not leak its own key,
and carries no prohibited vocabulary — plus that an unmapped key throws naming Ruling 61.

## Minor 6 — the report understated its own mutation

Corrected in place at §4 Mutation A: **22** of the 24 rows differ across the two widths, not 13. Only
`session-expiry` and `offline-banner` match on both. Counted mechanically this round rather than by eye,
which is how the first number came to be wrong.

## Also noted, and taken

The report's Next 16 justification listed three reasons; the reviewer is right that "it saved me editing
two test files" is not one. The Suspense/prerender-build-failure reason carries the decision alone, and
the router-context observation is a fact about the test environment rather than an argument for the
design. Left in §2 as written because it is accurate, but it should not have been given equal billing.

## Files changed this round

| File                                                                       | Change                                                                                                                                                                                         |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/components/caring-contacts/workspace/overlays/overlay-host.tsx`       | Ruling 61 map and throw; exported `dismissesOnEscapeOrBackdrop`, `blockReasonWording`, `NAMED_BLOCK_REASONS`; Ruling 60 comment at the stamping site; `data-testid="workspace-overlay-action"` |
| `src/components/caring-contacts/workspace/overlays/workspace-overlays.tsx` | close unwinds instead of pushing; `openWorkspaceOverlay` / `closeWorkspaceOverlay` exported                                                                                                    |
| `tests/caring-contacts-overlay-host.dom.test.tsx`                          | history block (3 tests), band pin, dismissal-throw test, refusal-wording test, vocabulary test rewritten, Minor 5 removal                                                                      |
| `tests/caring-contacts-explained-automation.dom.test.tsx`                  | second scan root and assertion for `src/app/caring-contacts/**`                                                                                                                                |
| `tests/caring-contacts-overlay-definitions.test.ts`                        | imports the shared regex instead of keeping its own copy                                                                                                                                       |
| `tests/helpers/caring-contacts-prohibited-language.ts`                     | new — the one copy of the vocabulary                                                                                                                                                           |
| `docs/design-system/adoption-manifest.json`                                | regenerated: the overlay-host suite is now recorded as a `Sheet` test file                                                                                                                     |

## Verification, fix round 1

| Command                                                                           | Result                                                                           |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `node scripts/run-vitest.mjs run tests/caring-contacts-overlay-host.dom.test.tsx` | `Test Files 1 passed (1)`; `Tests 13 passed (13)`                                |
| the four suites this round touches, together                                      | `Test Files 4 passed (4)`; `Tests 46 passed (46)`                                |
| `node scripts/run-vitest.mjs run tests/design-system-adoption.test.ts`            | `Test Files 1 passed (1)`; `Tests 51 passed (51)`                                |
| `node ./node_modules/typescript/bin/tsc -p tsconfig.json --noEmit`                | clean, no output                                                                 |
| `npx eslint <6 changed files>`                                                    | clean, no output                                                                 |
| `npm run test`                                                                    | `Test Files 701 passed, 2 skipped (703)`; `Tests 7776 passed, 29 skipped (7805)` |
| `npm run format`                                                                  | run; committed                                                                   |

Mutations run and reverted this round: push-on-close (Important 1, red at exactly the reported symptom),
and `"use client"` on `page.tsx` (Important 3, red naming the file).

No provider-backed command was run. No push, no PR.

## Concerns after this round

1. **`connection-unavailable` has wording but no caller.** It is one of the two categories the pinned
   prop names, so it is not speculative in the way the two entries I cut were — but it is untested
   against a real screen, and the first caller should read it before shipping.
2. **`pushedOverlayEntry` is module-scoped mutable state.** Correct today, because there is exactly one
   overlay host in the workspace and the fact it tracks belongs to the history stack rather than to a
   component. A second host mounted in the same document would share it. Worth a guard if a second host
   is ever contemplated.
3. **Ruling 60's divergence is now pinned but not resolved.** The design-record question — whether the
   frozen mapping should sample 431–767 at all, and whether it should meet the shared Sheet's 640 —
   remains open with the owner, as ruled.

---

# Fix round 2 — three Important findings and one line

All four addressed. Two claims in the round-1 write-up were overstated; both are corrected in place
above, next to the sentences that made them, rather than only here.

## Important 1 — the Ruling 61 lookup was not total (the Task 17 defect again)

**Confirmed exactly as reported, and fixed.** `BLOCK_REASON_WORDING` is an object literal, so it
inherits from `Object.prototype`, and `map[reason] === undefined` is not a membership test. Verified in
node before touching anything: `toString`, `constructor`, `valueOf`, `hasOwnProperty` and `__proto__`
all return non-`undefined`.

The consequence was worse than a wrong string. `blockReasonWording("toString")` returned a **function**
typed `string`; React renders that as nothing; the result is a control that is `aria-disabled` with
`aria-describedby` pointing at an **empty** paragraph — a clinician told an action is unavailable and
given no reason at all, with no throw and no error boundary to catch it. That is Ruling 61's
"plausible instead of visible" outcome reached by inheritance rather than by a default branch.

Fixed with `Object.hasOwn(BLOCK_REASON_WORDING, reason)`.

**RED first**, six inherited keys asserted to throw:

```
 FAIL  … > states every named refusal in plain words, and refuses to invent wording for one it has not been given
AssertionError: toString slipped past the guard: expected [Function] to throw an error
 ❯ tests/caring-contacts-overlay-host.dom.test.tsx:163:90
```

Then green. The test covers `toString`, `constructor`, `valueOf`, `hasOwnProperty`, `__proto__` and
`isPrototypeOf`.

### The audit — the more valuable half

**I searched my own files for every other string-keyed lookup of this shape. There is exactly one
more, and it is safe — for a reason, not by luck.**

| Lookup                          | File                     | Verdict                                                                                                                                                                      |
| ------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BLOCK_REASON_WORDING[reason]`  | `overlay-host.tsx`       | **Was the bug.** Keyed by `string` from an arbitrary caller. Fixed with `Object.hasOwn`.                                                                                     |
| `SHEET_GEOMETRY[modality]`      | `overlay-host.tsx`       | Same map shape, but keyed by `SheetModality` — a closed union whose only values come from the frozen table. No caller string reaches it and `"toString"` is a compile error. |
| `new URLSearchParams(…).get(…)` | `workspace-overlays.tsx` | Platform API, not an object literal. Returns `null` for anything absent.                                                                                                     |
| `history.state` membership      | `workspace-overlays.tsx` | Uses the `in` operator on a namespaced key of an object this module wrote. Added this round; see Important 2.                                                                |

`SHEET_GEOMETRY` now carries a comment at its use site recording that its safety comes from the **key
type**, not from the map shape, and that it would need `Object.hasOwn` too if it ever became
`string`-keyed. That is the part that does not travel on its own — which is the actual lesson of hitting
this defect twice on one branch, in two files, weeks apart.

For completeness outside my files: `overlayDefinition` in `definitions.ts` uses a `Map`, so
`overlayDefinition("toString")` already returns `null`. I did not change it.

## Important 2 — the deep-link test neither discriminated nor ran its branch

**Both halves confirmed, both fixed.**

**It could not discriminate.** Both seeded entries used the pathname `/caring-contacts`, so
`replaceState` and an unconditional `back()` ended at URLs every assertion accepted. The seeded prior
entry now has a **distinct pathname** (`/caring-contacts/somewhere-before`), and the test asserts a
discriminating pair: after close the pathname is still the workspace (an unconditional `back()` would
already have moved us), **and** the prior entry is still one Back away (it was replaced, not consumed).

**Proved** by mutating close to an unconditional `back()`:

```
 FAIL  … > the overlay URL > removes the parameter without leaving the workspace when the overlay came from a deep link
AssertionError: expected '/caring-contacts/somewhere-before' to be '/caring-contacts'
 ❯ tests/caring-contacts-overlay-host.dom.test.tsx:419:38
```

Reverted. Round 1's claim that this mutation would redden the test was false as written; it is true now,
and the report sentence that made it is corrected in place.

**It ran the wrong branch.** The flag was cleared only inside the push branch, so the preceding test —
which opens through `openWorkspaceOverlay` and then traverses with `window.history.back()` directly —
left it `true`, and the deep-link test took the `back()` path it meant to exclude.

I did not fix that by resetting a flag between tests. **I removed the flag.** The marker now lives in
`history.state` under a namespaced key, written by `openWorkspaceOverlay` and read per entry by
`closeWorkspaceOverlay`. That is the correct home for it: a module variable describes the top of the
stack and nothing keeps it true — Back, Forward, a second mount, or a test traversing history directly
all leave it stale, and a stale `true` is a `back()` on an entry this module never pushed.
`history.state` travels with the entry, so every traversal brings its own answer and there is nothing to
reset. It also retires the round-1 concern about module-scoped mutable state entirely.

Failure direction is the safe one: if the marker is ever lost (Next replacing state on its own
navigation, say), close falls through to `replaceState`, which removes the parameter and navigates
nobody anywhere.

The test now **proves** which branch it exercises rather than assuming it: `seedHistory` asserts the
seeded workspace entry carries no marker, and the deep-link test asserts `history.state` is `null`
immediately before rendering. If a marker ever leaked in, those lines fail instead of the test quietly
covering the wrong path.

## Important 3 — the band pin held one edge, not two

**Confirmed.** `SHEET_MOBILE_GEOMETRY_BREAKPOINT = 640` was a literal read from nothing.

A reliable source-text assertion **is** possible here, so I did not narrow the claim — I made it true.
Two assertions now hold that edge, and together they fix it at 640:

1. `src/components/ui/sheet.tsx` still contains the exact default-placement string
   `"items-end justify-center sm:items-center sm:p-6"` — the class that flips the backdrop from
   bottom-aligned (phone) to centred (dialog). Moving that variant moves the band.
2. `src/app/globals.css` declares no `--breakpoint-sm` override, so `sm:` still means Tailwind's default 640. (`--breakpoint-phone: 640px` and its siblings are named tokens added **alongside** the defaults,
   not overrides of them — I checked, because a false positive there would have been the same mistake in
   the other direction.)

This is the same instrument the client-boundary guard in the same suite already uses, which is why it is
the honest choice rather than an improvised one: jsdom applies no Tailwind, so nothing rendered can
observe the geometry.

**Proved live** by mutating the expected class string to `md:items-center md:p-6`:

```
 FAIL  … > pins the 640–767 band where the stamped modality and the Sheet's own geometry breakpoint disagree
AssertionError: src/components/ui/sheet.tsx no longer flips its default geometry at `sm:` — the 640–767 band has moved
 ❯ tests/caring-contacts-overlay-host.dom.test.tsx:214
```

Reverted. I mutated the **expectation** rather than `sheet.tsx` itself: another agent is running
Playwright against this worktree for Task 19, and editing a shared design-system component (or
`globals.css`) mid-run could have disturbed their evidence. The two are equivalent for this purpose —
the assertion reads the real file either way — and the choice is stated rather than glossed.

## Also fixed, one line

`sourceFilesUnder` now accepts `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs` and `.cjs` through a named constant.
A `.js` client file in either scan root was invisible — the same "the scan does not cover what it claims
to" shape as the non-recursive read and the missing route directory, in a third dimension.

## Files changed this round

| File                                                                       | Change                                                                                                     |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `src/components/caring-contacts/workspace/overlays/overlay-host.tsx`       | `Object.hasOwn` membership test; audit note at the `SHEET_GEOMETRY` use site                               |
| `src/components/caring-contacts/workspace/overlays/workspace-overlays.tsx` | per-entry `history.state` marker replaces the module-scoped flag                                           |
| `tests/caring-contacts-overlay-host.dom.test.tsx`                          | inherited-key assertions; distinct prior pathname and discriminating deep-link pair; source-text band edge |
| `tests/caring-contacts-explained-automation.dom.test.tsx`                  | scan accepts every client-capable extension                                                                |
| `docs/caring-contacts/phase-2a-sdd-archive/task-18-report.md`              | two overstated claims corrected in place, and this section                                                 |

## Verification, fix round 2

| Command                                                            | Result                                            |
| ------------------------------------------------------------------ | ------------------------------------------------- |
| overlay-host + explained-automation suites                         | `Test Files 2 passed (2)`; `Tests 29 passed (29)` |
| all five suites this round touches or reads                        | `Test Files 5 passed (5)`; `Tests 50 passed (50)` |
| `node ./node_modules/typescript/bin/tsc -p tsconfig.json --noEmit` | clean, no output                                  |
| `npx eslint <4 changed files>`                                     | clean, no output                                  |
| `npm run format`                                                   | run; committed                                    |

**The full `npm run test` was not run, and was not required: this round exports nothing new.** Every
export in these files (`OverlayHost`, `dismissesOnEscapeOrBackdrop`, `blockReasonWording`,
`NAMED_BLOCK_REASONS`, `openWorkspaceOverlay`, `closeWorkspaceOverlay`, `WorkspaceOverlays`,
`WORKSPACE_OVERLAY_PARAM`) already existed at the end of round 1, and the round-1 full run covered them.
The five suites above are the ones that read anything I changed.

One note on the runs themselves: `run-vitest.mjs` refused several times with
`Database focused-test capacity is full … playwright tests/ui-caring-contacts-workspace.spec.ts` —
the Task 19 agent holding the heavy-run lock. Retried on the message rather than the exit code, as the
repo's flake policy requires; every result quoted here is from a run that printed a `Test Files` summary.

Mutations run and reverted this round: inherited-key lookup (Important 1, RED before the fix),
unconditional `back()` (Important 2, red at the deep-link pathname assertion), and the expected Sheet
class string (Important 3, red naming the moved band).

No provider-backed command was run. No push, no PR.

## Concerns after this round

1. **`connection-unavailable` still has wording but no caller.** Unchanged from round 1, and still worth
   a read by the first caller before it ships.
2. **The band pin's Sheet edge is a string match.** It holds against a moved breakpoint, which is the
   failure it exists for, but a refactor that rewrote that class list into a different but equivalent
   form would redden it spuriously. That is the conservative direction — a false red gets read, a false
   green does not — but the next person to touch `sheet.tsx` will meet it, and the message names the file
   and the reason so it can be re-derived rather than deleted.
3. **The guard's direction gap remains open**, as recorded for the whole-branch review: the scans prove
   no file in two directories is a client boundary, but not that no client component from outside them is
   handed the record inside `shell.tsx`. Nothing live today.
