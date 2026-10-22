# Phase 2 — Unified viewing chrome (PDF + photo)

**Status:** historical Phase 2 plan; the [programme record](document-viewer-redesign-plan.md) records it landed in PR #1741.
_Updated 2026-10-21 — added lifecycle and residual-scope routing; Documentation owns._

> Do not execute this pre-implementation baseline as a fresh work queue. The original plan
> below is retained for rationale. The programme records Phases 0–3 landed; follow-on scope
> historically included crop → page overlay, signed-URL batching (`#283`), and optional Phase 4
> polish including demo PNG/WebP (`#215`) and hosted visual baselines. Signed-URL batching is now
> wired from visible source images through `useBatchSignedImageUrls` to `/api/images/signed-urls`;
> the old deferred label is superseded. Live acceptance remains separately unverified. Check current
> [viewer source](../../src/components/document-viewer/), the
> [canvas journey](../../tests/ui-document-canvas.spec.ts) and
> [task lifecycle](../task-receipts.md) before scoping that work. Recorded landing is not
> fresh browser, device or deployment acceptance.

**Programme:** [`document-viewer-redesign-plan.md`](./document-viewer-redesign-plan.md)  
**Prerequisites (merged):** Phase 0 [#1660](https://github.com/BigSimmo/Database/pull/1660), Phase 1 [#1665](https://github.com/BigSimmo/Database/pull/1665), programme plan [#1659](https://github.com/BigSimmo/Database/pull/1659)  
**Flightplan evidence:** `.local/workflow-evidence/2026-08-07T10-39-21-530Z-flightplan.json` (implementation path set → `ui`; this docs PR is `docsOnly`)  
**Branch seed:** `cursor/viewer-phase2-plan-1db8`

This is the **safe rollout plan** for Phase 2: unify DocumentFrame chrome and photo immersive UX without regressing phone composer ownership, pixel fidelity, auth-clear signed URLs, or pdf.js chunk boundaries.

---

## 1. Overview

### Goal

One source-faithful reading system:

1. **Shared chrome** — PDF (and later images) use DocumentFrame `controls` for zoom/fit/viewing-aid + page metadata (COMPONENTS §6).
2. **One immersive photo path** — whole-document images and rail crops use the same lightbox/gesture stack.
3. **Page ↔ figure sync** — filmstrip/page badges call existing `navigateToPage` (no remount).
4. **Canvas-primary** — native iframe becomes an advanced “sharper zoom” preference after chrome settles.
5. **Intentional motion** — 2–3 reduced-motion-safe transitions after owners are stable.

### Why slice, not one PR

| Failure class                          | If bundled together                                       |
| -------------------------------------- | --------------------------------------------------------- |
| Dual toolbars / mismatched zoom ranges | Frame controls + PDF toolbar both live                    |
| Signed-URL / auth-clear leak           | Photo lightbox URL vs endpoint unify                      |
| Phone scroll-hide / sheet interaction  | Lightbox fullscreen vs composer                           |
| Page remount                           | Filmstrip using `router.push` instead of `navigateToPage` |

Independent slices keep each failure class attributable and revertible.

### Original baseline (post Phase 0/1)

| Area            | Today                                                                           | Gap                                                      |
| --------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `DocumentFrame` | Shell-only in product (loading/error/ready); `controls` exist but **not wired** | Contract forbids `controls={` until deliberately flipped |
| PDF chrome      | `data-testid="pdf-toolbar"` inside frame children                               | Overlaps frame zoom/fit; owns page/rotate/fullscreen     |
| Native PDF      | Iframe, no in-app zoom chrome                                                   | Uneven parity                                            |
| Whole-doc image | `NonPdfSourcePreview` → contained `<img>` + open in new tab                     | No shared lightbox                                       |
| Rail figures    | Vertical `DocumentImage` → `SignedImage` → `ImageLightbox`                      | Page number is text only; no filmstrip sync              |
| Gestures        | Shared `useViewerGestures` (PDF + lightbox)                                     | Keep; do not regress INP/auth paths                      |

---

## 2. Technical approach

### Architecture (target)

```
DocumentViewer
  └─ DocumentFrame (state + the viewer's one toolbar + fullscreen)
       ├─ PdfCanvasViewer                    // PDF pixels only; no chrome
       └─ NonPdfSourcePreview                // image/text/download
            └─ ImageLightbox (URL or endpoint)

DocumentViewerRail
  └─ filmstrip / DocumentImage → SignedImage → ImageLightbox
       └─ onPageSelect → navigateToPage (existing route hook)
```

### Design rules (must hold)

- Pixel-faithful: no `filter` / `invert` / `color-scheme` on source pixels.
- Viewing aid = surround grading only; off by default; forced off when zoomed / print.
- No second phone composer; hidden reserve stays `0rem`.
- Production tap targets `min-h-tap` / `min-h-12`.
- Prefer v2 tokens; no purple/glow/card clutter in the reader stage.

### Behaviour calibration vs flightplan

Automated flightplan on Phase 2 paths: **`ui` only**, `approvalRequired: none`.

**Treat implementation as:**

| Risk                      | Why                                       |
| ------------------------- | ----------------------------------------- |
| UI / phone-chrome         | Frame chrome, lightbox Sheet, rail        |
| Clinical document surface | Source rendering, failure announce        |
| Privacy                   | Signed-URL lifecycle, auth identity clear |
| Not RAG ranking           | Unless summarize routing changes          |

Every implementation PR that touches source rendering needs a complete
`## Clinical Governance Preflight` in the PR body.

---

## 3. Phases (sub-PRs)

Each sub-PR is independently mergeable, verified, and revertible. **Do not land 2a+2b+2c in one PR.**

### PR 2a — DocumentFrame owns zoom/fit (PDF)

**Goal:** Wire `controls` for canvas PDF; demote duplicate PDF toolbar zoom/fit; keep page/rotate/fullscreen on `PdfCanvasViewer`.

| Task                | Detail                                                                                                      |
| ------------------- | ----------------------------------------------------------------------------------------------------------- |
| Lift zoom/fit state | Either lift to DocumentViewer or pass controlled props from PdfCanvasViewer up into Frame                   |
| Align ranges        | Reconcile Frame defaults (0.5–4 / 0.25) with PDF (0.55–4 / 0.15) — pick one contract, document it           |
| Demote PDF toolbar  | Remove zoom ± / fit from `pdf-toolbar` when Frame controls are present; keep page, rotate, fullscreen       |
| Viewing aid         | Wire off by default; disabled when not fit-width; print still forces off                                    |
| Page metadata       | Show “Page n of m” in Frame when `src.kind === "pdf-page"` + controls                                       |
| Contract flip       | Update `document-frame-contract.test.ts` to **require** `controls={` for PDF ready state (today forbids it) |

**Out of scope:** native embed chrome, photo lightbox, filmstrip, motion.

**Verify:**

```bash
npm run test:focused -- --files \
  tests/document-frame-contract.test.ts,\
  tests/document-frame.dom.test.tsx,\
  tests/document-viewer-shell.dom.test.tsx,\
  tests/document-viewer-pdf-reader-lazy.test.ts,\
  tests/client-performance-boundaries.test.ts,\
  tests/document-detail-performance.test.ts
npm run format && npm run verify:pr-local -- --files <2a paths>
```

Widen: `npm run ensure` + smoke PDF path if toolbar placement shifts phone layout; `verify:phone-chrome` only if composer/reserves touched (prefer not).

**Stop:** dual toolbars shipping together; pdf.js entering initial chunk; page remount.

---

### PR 2b — Unified immersive photo path

**Goal:** Whole-document images use the same immersive viewer as crops.

| Task                   | Detail                                                                                 |
| ---------------------- | -------------------------------------------------------------------------------------- |
| Extend `ImageLightbox` | Accept either `endpoint` **or** direct `url` (parent-owned document signed URL)        |
| NonPdf entry           | Primary action opens lightbox (not only new-tab); keep Open/Download as secondary      |
| Failure UX             | Align on `role=alert` + LiveAnnouncer (already partial)                                |
| Auth-clear             | Direct-URL mode must blank with parent; must not revive prior identity from module LRU |
| Visual                 | Drop card-like reader stage where it fights “no cards in the reader”                   |

**Out of scope:** filmstrip, Frame PDF controls, native preference rewrite.

**Verify:**

```bash
npm run test:focused -- --files \
  tests/document-viewer-non-pdf-preview.dom.test.tsx,\
  tests/signed-image.dom.test.tsx,\
  tests/auth-signed-url-cache.dom.test.tsx,\
  tests/use-viewer-gestures.dom.test.tsx
# plus new lightbox URL-mode DOM coverage
npm run ensure   # before any manual photo QA
npm run format && npm run verify:pr-local -- --files <2b paths>
```

If lightbox Sheet interacts with document composer scroll-hide: `verify:phone-chrome -- --dry-run` then focused.

**Stop:** auth identity change can re-show prior user’s image URL; second composer; pixel filters.

---

### PR 2c — Rail filmstrip ↔ PDF page sync

**Goal:** Compact page-linked figure strip; click syncs PDF page via existing route helper.

| Task                  | Detail                                                                     |
| --------------------- | -------------------------------------------------------------------------- |
| Filmstrip UI          | Compact horizontal (or denser vertical) strip with page badges             |
| Wire `navigateToPage` | From `useDocumentViewerRoute` — **never** full document navigation remount |
| Active page           | Optional highlight of figures for `activePage`                             |
| Keep deferred IO      | IntersectionObserver / SignedImage deferral unchanged                      |
| Accessibility         | Buttons with clear names; keyboard operable                                |

**Out of scope:** crop→page geometry overlays (Phase 3); rail virtualization (Phase 3).

**Verify:**

```bash
npm run test:focused -- --files \
  tests/document-viewer-shell.dom.test.tsx,\
  tests/document-section-nav.dom.test.tsx,\
  tests/document-detail-performance.test.ts
npm run format && npm run verify:pr-local -- --files <2c paths>
```

**Stop:** any change that remounts PdfCanvasViewer on page flip; empty `source-images` reappearing in phone section list when empty.

---

### PR 2d — Canvas primary / native advanced (after 2a)

**Goal:** Product copy and preference: canvas is primary; native is “sharper browser zoom” advanced option.

| Task             | Detail                                                         |
| ---------------- | -------------------------------------------------------------- |
| Default          | Keep canvas default (`getDefaultPdfViewerMode() → false`)      |
| Copy             | Rename toggle affordance to advanced/sharper language          |
| Parity checklist | Document what native still lacks vs canvas; do not fake parity |

**Verify:** shell DOM + pdf mode preference unit/DOM; `verify:pr-local`.

---

### PR 2e — Motion polish (after 2a–2c owners stable)

**Goal:** 2–3 intentional motions: zoom settle, lightbox open/close, page crossfade — all `prefers-reduced-motion` safe.

**Verify:** focused DOM + `verify:phone-chrome` if transitions touch hide/reveal; otherwise `verify:pr-local`. Do not start until chrome owners green.

---

## 4. Hard constraints (non-negotiable)

Copied from programme plan; Phase 2 must not weaken any:

1. One composer owner (DocumentViewer floating in-doc search).
2. Hidden phone reserve = `0rem`.
3. Pixel-faithful sources (no invert/filter on pixels).
4. Auth identity clear blanks signed URLs/detail; no cache reissue of prior identity.
5. pdf.js stays on-demand via `pdf-readers-lazy.tsx`.
6. Page flips must not remount the viewer / reload the PDF document.
7. Private images: signed URLs, deferred IO, `unoptimized` where required.
8. Production tap targets `min-h-12` / `min-h-tap`.
9. Clinical failures announce (`role=alert` / LiveAnnouncer).
10. Not a RAG-ranking change unless a slice deliberately touches ranking.

Also: sheets (actions, section, lightbox) must keep chrome from hiding under overlays per `search-chrome-behaviour.md`. Prefer **not** editing that doc unless ownership semantics change.

---

## 5. Verification ladder (programme)

| Tier                    | When                          | Commands                                                                                  |
| ----------------------- | ----------------------------- | ----------------------------------------------------------------------------------------- |
| 2 — Focused behavioural | Every sub-PR                  | `test:focused` file list for that slice                                                   |
| 3 — Domain              | Phone chrome / lightbox sheet | `ensure` → `verify:phone-chrome` (dry-run then run)                                       |
| 3 — Clinical/privacy    | Source rendering PRs          | Clinical Governance Preflight + consider `check:production-readiness`                     |
| 4 — Handoff             | Each sub-PR ready             | `format` (commit) → `verify:pr-local`                                                     |
| Widen                   | Shared foundations            | `verify:cheap` once if cross-module; `verify:ui` only if shared chrome foundations change |

### Approval-required (do not run without explicit confirmation)

- Live Lighthouse / production-like INP measurement
- `verify:release`, `test:live`, `check:supabase-project`
- Any OpenAI-backed summarize regression that is not fully mocked
- Hosted CI mutations beyond ordinary push

Flightplan `approvalRequired` for the proposed path set: **none** (UI-local) — remains true while offline/mocked.

---

## 6. Dependencies

| Dependency                       | Status                                                       |
| -------------------------------- | ------------------------------------------------------------ |
| Phase 0 gesture/a11y             | Merged (#1660)                                               |
| Phase 1 shell extraction         | Merged (#1665)                                               |
| Programme plan                   | Merged (#1659)                                               |
| DocumentFrame control API        | Already implemented; product wiring is the work              |
| `navigateToPage` / route hook    | Already extracted in Phase 1                                 |
| Design-sync DocumentFrame export | **Defer to Phase 4** — do not register half-adopted controls |
| Crop geometry for overlays       | Phase 3 — do not block 2c                                    |

---

## 7. Risks and mitigations

| Risk                                     | Mitigation                                                       |
| ---------------------------------------- | ---------------------------------------------------------------- |
| Dual zoom toolbars                       | 2a demotes PDF zoom/fit in the same PR that wires Frame controls |
| Zoom range mismatch                      | Single shared clamp constants; contract test                     |
| Auth-clear + lightbox URL mode           | Explicit blanking tests; no LRU reissue on identity change       |
| Sheet vs composer scroll-hide            | Prefer not changing chrome hooks; if needed, phone-chrome gate   |
| Bundle budget                            | Watch `check:bundle-budget` early on visual PRs                  |
| Contract test still forbids `controls={` | Flip deliberately in 2a with new positive assertions             |
| Native path still chrome-poor            | Accept until 2d; do not fake Frame controls over iframe          |
| `#215` residual (PWA/demo WebP)          | Optional; not required for 2a–2c                                 |

---

## 8. Success criteria (Phase 2 complete)

- PDF ready state shows **one** zoom/fit chrome owner: DocumentFrame.
- Page/rotate/fullscreen remain reachable on canvas PDF.
- Whole-doc images open the same immersive gesture viewer as crops.
- Rail figures can jump the PDF to their page without remounting.
- All hard constraints still green under focused + PR-local gates.
- Clinical Governance Preflight present on every source-rendering PR.
- No RAG ranking surface touched (or explicitly declared if somehow required).

---

## 9. Recommended execution order

1. Land this plan doc.
2. **PR 2a** on `cursor/viewer-phase2a-frame-controls-…` from latest `origin/main`.
3. **PR 2b** photo unify (can start after 2a merges, or in parallel only if no shared conflict files — prefer after 2a).
4. **PR 2c** filmstrip.
5. **PR 2d** then **2e**.
6. Only then Phase 3 (virtualization / overlays / keyboard reading mode).

---

## 10. Residual risk

- Flightplan under-classifies clinical/privacy — human PR policy must still apply governance text.
- Manual INP/device QA remains recommended after 2a (not automated in this plan).
- Notion MCP was unavailable (`needsAuth`) — this plan lives in-repo; mirror to Notion only after auth if desired.
- Programme Phase 3/4 still pending; do not expand 2a–2e into those scopes.
