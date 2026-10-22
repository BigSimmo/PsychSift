# Document viewer — Phase 3 handover

**Status:** historical pre-implementation brief, superseded for execution by the
[programme record](document-viewer-redesign-plan.md). It records Phase 3 landed in PR #1772:
windowed rendering, keyboard reading, rail virtualization and decode priority. Current
[canvas source](../../src/components/document-viewer/pdf-canvas-viewer.tsx) and the
[canvas journey](../../tests/ui-document-canvas.spec.ts) are the implementation/check entry points.

_Updated 2026-10-21 — corrected lifecycle and residual-scope routing; Documentation owns._

> Historically recorded follow-on scope included crop → page overlay (requires `bbox` contract
> plumbing), signed-URL batching (`#283`), and optional Phase 4 polish/hosted visual acceptance.
> Current visible-source images use `useBatchSignedImageUrls` and `/api/images/signed-urls`;
> batching is implemented in source, while its live acceptance remains separately unverified.
> OffscreenCanvas was intentionally conditional, not an accepted outstanding implementation
> requirement. Use [task lifecycle and receipt handoff](../task-receipts.md) to establish
> current ownership and scope; the original tasks and verification claims below describe
> their historical baseline, not fresh execution authority or runtime proof.

## Original execution brief

This brief was prepared after Phases 0–2 (PR #1741, squash `42f87ca`), before Phase 3.
Its starting baseline rastered one page at a time; that baseline is superseded by the
landed windowed viewer. Preserve the original task detail below for rationale.

**Scope:** every Phase 3 capability **except crop → page overlay**. Crop overlay is deliberately out —
`bbox` is SELECTed at `src/lib/document-detail.ts:441` but absent from `DocumentDetailImage` in
`src/lib/document-detail-contract.ts`, so it needs contract plumbing through `src/lib/**document**`,
which is a wider contract change than this phase should carry.

Most of the work lands in `src/components/document-viewer/**`. **One deliberate exception:** Task 3 may
wire `src/app/api/images/signed-urls/route.ts`, which matches `clinicalRiskPatterns` in
`scripts/pr-policy.mjs` (`/^src\/app\/api\//`). If you touch that route, `pr-policy` will hard-block the
merge without a complete `## Clinical Governance Preflight` — but complete it either way. See
"Governance" below: the preflight is required by behaviour, not by which paths the classifier happens to
match.

**Already done:** toolbar density shipped in Phase 2 (`document-frame.tsx:404`, `hidden sm:inline` plus
an `sm:hidden` overflow menu). Strike it from the plan's table.

All line references below were verified against `main` at `50ef12e`.

---

## Task 0 — establish the canvas gate first (prerequisite)

Ledger `#279` says the viewer canvas cannot be gated in a browser, and proposes either bumping the
pinned Playwright build or pinning `pdfjs-dist` down. **That diagnosis is wrong and both remedies would
be wasted dependency surgery.** Confirm and correct it before writing any feature code:

```bash
node -e "const b=require('$PWD/node_modules/playwright-core/browsers.json'); \
  b.browsers.filter(x=>x.name==='chromium').forEach(x=>console.log(x.revision, x.browserVersion))"
/opt/pw-browsers/chromium-*/chrome-linux/chrome --version
```

Measured 2026-08-09:

|                                                                        | value                        |
| ---------------------------------------------------------------------- | ---------------------------- |
| Container Chromium (`/opt/pw-browsers/chromium-1194`)                  | 141.0.7390.37                |
| Chromium pinned `playwright@1.62.1` expects (`browsers.json` rev 1234) | **151.0.7922.34**            |
| Chromium CI actually runs (`lighthouse-budget.json:27`)                | **HeadlessChrome/151.0.0.0** |
| `pdfjs-dist@6.2.108` calls `Map.prototype.getOrInsertComputed`         | `pdf.mjs:2454, 6889, 6896`   |

`getOrInsertComputed` ships in Chromium 151 and not in 141, so the raster failure is
**container-only** — CI's browser already runs pdf.js 6 fine. The container's pre-installed browser is
simply older than its own pinned Playwright wants, and `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers` pins
it there. Do not bump Playwright, do not pin `pdfjs-dist` down, and do not run `playwright install`
(this environment forbids it).

Write a Playwright viewer-canvas journey asserting a page actually paints: non-blank canvas pixels,
correct page count, page-flip changes the raster. Expect it to fail locally with
`getOrInsertComputed is not a function` and pass in CI. Guard it so the local failure is an explicit
skip-with-reason, never a silent green — `docs/testing.md` flake policy applies.

`#279` lives in `docs/outstanding-issues.md`, so queue its closure with `npm run issues:done -- '#279'` (or
`issues:update` if the gate is only partly built), then reconcile it from the dedicated ledger branch — **not** a `Review record` PR comment, which records
the separate review history and would leave the durable row untouched. Its refuted remedy has
already been struck from the row; record the gate you built as the resolution.

Everything below is proven by that gate in CI plus focused unit tests locally.

## Task 1 — multi-page virtualization (the core item)

`src/components/document-viewer/pdf-canvas-viewer.tsx` (524 lines) renders one page into one `<canvas>`.
Move to a windowed list: render near pages, dispose far canvases, keep page ↔ URL sync intact.

Four constraints that will bite, all load-bearing:

1. **The raster budget becomes document-wide.** `resolveCanvasRasterPlan` (`canvas-raster-budget.ts`)
   bounds _one_ canvas to 2^24 device pixels because WebKit paints nothing above it. With N live
   canvases, N individually-legal pages can still exhaust device memory. Add a document-wide live-pixel
   budget capping how many rendered canvases are retained. Do not raise `MAX_CANVAS_PIXELS`.
2. **Render-ahead fights `disableAutoFetch`.** `getDocument({ disableAutoFetch: true, disableStream:
true })` at `:189` was chosen precisely because a reader looks at one page — it stops pdf.js pulling
   a whole guideline over cellular. Pre-rendering neighbours re-introduces exactly that fetch
   amplification. Resolve it deliberately: ±1 page, on idle, and state the trade in the PR body. Do not
   silently drop `disableAutoFetch`.
3. **Page-sync feedback loop.** The effect at `:216-229` already does rAF → clamp → reconcile the parent
   route via `onPageChangeRef`. If "current page" becomes a scroll derivation, that effect can fight the
   scroll position. Derive the active page from scroll, but let only user intent write the URL.
4. **Keep the `memo` boundary.** `PdfCanvasViewer` is memoised (`:53`, rationale at `:45-52`) so a
   keystroke in the composer never re-rasters. Per-page state must not lift into the parent and defeat
   that.

Preserve: the per-run `pageToCleanup` isolation (Sentry 15801413), the canvas zeroing on unmount
(`:337-345`), the `renderZoom` debounce with its interim CSS transform, and the `isLikelyExpiredUrl` →
`reportUrlExpired` recovery path — which must still work when a range request for a _neighbour_ page is
the thing that 403s.

## Task 2 — rail virtualization

`document-rail-panels.tsx:223` (`id="source-images"`) maps `clinicalImages` and `auditImages` into
`DocumentImage` rows. `auditImages` sit inside a collapsed `<details>` but are still in the DOM and
still mint signed URLs. Virtualize the long list and stop off-screen rows resolving URLs.

## Task 3 — signed-URL and decode priority

Above-fold evidence should resolve and decode before the below-fold rail. Build on the in-flight dedupe
already in `use-signed-image-url.ts` — **read the warning below before touching that file.**
`src/app/api/images/signed-urls/route.ts` batches up to 100 ids and has no caller (ledger `#283`).
Wiring it is permitted if the rail mounts several distinct images at once, but treat it as a deliberate
scope exception, not a free extension: it is a privileged owner-scoped endpoint, it matches
`clinicalRiskPatterns`, and touching it makes the `## Clinical Governance Preflight` a hard merge gate
rather than a discipline requirement. Prefer deferring it to its own PR unless the batching win is
measured. If you do wire it, keep the per-image endpoint for the lightbox retry path.

## Task 4 — keyboard reading mode

`handleHolderKeyDown` (`:410-441`) already handles ArrowLeft/Right, `+`/`=`, `-`, and `0`. Phase 3 adds
PageUp/PageDown, `f` (fit), and `r` (rotate). `rotation` is an inbound prop with **no**
`onRotationChange` callback — `r` needs a new prop threaded from `DocumentFrame`. Document the bindings
and test them.

## Task 5 — OffscreenCanvas: measure, then decide

The plan conditions this on "measured main-thread paint cost." Measure first and report the number. If
virtualization already lands the win, say so and skip it — do not implement it on principle.

---

## Verification

```bash
npm run test:focused -- --files \
  tests/use-viewer-gestures.dom.test.tsx,tests/document-viewer-shell.dom.test.tsx,\
tests/document-viewer-pdf-reader-lazy.test.ts,tests/document-frame-contract.test.ts,\
tests/document-detail-performance.test.ts,tests/client-performance-boundaries.test.ts

npm run ensure                      # before any browser work; never assume a port
npm run verify:phone-chrome -- --dry-run
npm run format                      # AND COMMIT IT — not in verify:cheap, blocks CI
npm run verify:pr-local
```

Two gates will move and must not be silenced:

- **`check:bundle-budget`** weighs production chunks against 1,309,772 gzip bytes at 10% tolerance,
  and `/mockups/**`-only chunks against a separate 273,873-byte scratch baseline at 25%
  (`bundle-budget.json`; split from the old single 1,440,201-byte total on 2026-08-09). A
  virtualization dependency would land straight on the production budget — prefer none.
- **The `document-viewer` visual golden will shift.** Per ledger `#278` that target composites
  viewport-pinned chrome over content, and its position tracks total content height, so any
  content-height change inflates the diff. Expect it; fix it by narrowing the clip or masking the
  pinned chrome. `#278` records that capturing `fullPage` is banned (ledger `#093`).

## Do not

- Do not weaken a viewer assertion to make it pass in this container.
- Do not re-gate pinch on `!fitWidth` (ledger `#280` — that restores the original defect).
- Do not touch `src/lib/rag/**` or any ranking surface; nothing here should.
- Do not run provider-backed gates (`verify:release`, `eval:*`, `check:supabase-project`) without asking.

## Read this before editing `use-signed-image-url.ts`

**Both bugs described here are already fixed on `main`. Do not reintroduce them.**

The Phase 0–2 pass shipped two identity bugs in that file, both caught in review before merge.
`authorizationHeadersForAccessToken` emits **lowercase** `authorization`
(`src/lib/supabase/client.tsx:82`), but the dedupe key read `headers.Authorization` — so the token was
never in the key, every identity collapsed onto the endpoint alone (the key was the literal endpoint
followed by a trailing space), and an account switch with a request in flight could hand user B user A's
signed URL. The second: the module LRU was written from inside the shared promise, so a superseded
response could refill a cleared cache after an identity change.

The shipped state on `main` is the correct one: `authorizationIdentity(headers)` reads
`headers.authorization ?? headers.Authorization`, the key joins endpoint and identity with a NUL
separator so neither field can bleed into the other, the cache write happens in the active consumer
after its identity check, and `tests/auth-signed-url-cache.dom.test.tsx` carries the regression
coverage.

**Required before any Task 3 change to this file:** run that test file first and confirm it is green, and
keep it green afterwards. If you restructure the dedupe or cache path, the identity must remain in the
key and the cache write must stay outside the shared promise. `authorizationHeader` is a
`Record<string, string>`, so reading the wrong casing fails silently — never key identity off a property
access without going through the helper. Ledger `#289` tracks exporting that helper repo-wide so the
mistake stops being available.

## Handoff

Stage as separate commits per task so any one stays independently revertible while the PR is open.

### Governance

**Complete the `## Clinical Governance Preflight` from `.github/pull_request_template.md`.** Phase 3
changes source rendering (virtualization changes how a clinical source page is displayed, and a bug
shows the reader the wrong page or no page) and document access (the signed-URL and decode-priority
work). `AGENTS.md:257` requires the preflight for any PR touching those behaviours — that requirement is
behavioural, not path-based.

Do not infer an exemption from `scripts/pr-policy.mjs`. Its `clinicalRiskPatterns` deliberately does not
match `src/components/**` unless the path also mentions auth/permission/privacy/security/upload/download/
patient, so a diff confined to `src/components/document-viewer/**` classifies `clinicalRisk: false` and
the merge gate stays quiet. That is the classifier under-approximating, not policy granting a pass — the
comment at `pr-policy.mjs:62` records PR #1489 shipping 205 therapy records (including one labelling ECT
as "ACT") past exactly this gap. If Task 3 wires `src/app/api/images/signed-urls/route.ts`, the gate does
fire and will hard-block without the preflight.

No `RAG impact:` line is required: no protected ranking surface is in scope (`src/lib/rag/**`,
clinical-search, retrieval-selection, ranking-config, answer-ranking, the eval harness, the golden
fixture, the retrieval RPCs). Confirm the classification for your actual diff with
`npm run verify:pr-local -- --dry-run --files <paths>`.

Capture anything deferred with `/issues capture` before the session ends.
