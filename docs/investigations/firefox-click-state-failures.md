# Firefox (Gecko) Click State Failures in Playwright

**Document Type**: Technical Investigation & Architecture Analysis  
**Issue Reference**: #33346A (ULID: `01M2ZTPSXQ33346AYMPF41R5AR`)  
**Components**: `src/components/ui/sheet.tsx`, `src/components/document-viewer/source-panels.tsx`  
**Test Suites**: `tests/ui-smoke.spec.ts`, `tests/ui-tools.spec.ts`  
**Engine**: Mozilla Gecko (`Desktop Firefox` in Playwright)

---

## 1. Context & Problem Statement

During CI execution on Firefox runners, two specific tests exhibited intermittent but reproducible click state delivery failures:

1. `tests/ui-tools.spec.ts:667` ("tool links point to the expected in-app modes"): On pass 4 of 6 (Forms), the detail sheet (`[data-testid="tools-search-detail-sheet"]:visible`) resolved to 0 elements after clicking `About Forms`.
2. `tests/ui-smoke.spec.ts:5478` ("search regressions avoid fetch errors and open viewer hits @critical"): Clicking `Next document search hit` left the UI on "Hit 1 of 2", failing the assertion for "Hit 2 of 2".

Both issues were previously triaged under issue #33346A. Earlier investigations ruled out CSS display anomalies, text splitting, or URL routing errors. This investigation establishes the exact engine-level root cause in Mozilla Gecko's event processing pipeline.

---

## 2. Gecko Event Processing Architecture

### 2.1 Pointer Sequence vs Focus Transitions

Under the W3C UI Events specification, mouse click synthesis requires:
$$\text{pointerdown} \rightarrow \text{mousedown} \rightarrow \text{pointerup} \rightarrow \text{mouseup} \rightarrow \text{click}$$

In Gecko (`dom/events/EventStateManager.cpp`), mouse gesture tracking is intimately coupled with `nsFocusManager`. When a synthetic pointer sequence is initiated:

1. Gecko receives `pointerdown` and `mousedown` targeted at Element $B$.
2. If an asynchronous macro-task or animation frame callback invokes `elementA.focus()` during this interval:
   - `nsFocusManager::SetFocus` executes synchronously.
   - `EventStateManager` evaluates whether the active mouse target context has been disrupted.
   - If focus moves away from the event target hierarchy, Gecko invalidates the pending click context.
3. Upon receiving `pointerup` and `mouseup`, Gecko suppresses `GenerateClickEvents()`.
4. The synthetic DOM `click` event is aborted, and React's `onClick` handler never fires.

### 2.2 Exclusive Accordion `<details name="...">` and Microtask Boundaries

In HTML5, `<details name="...">` enforces mutual exclusivity natively. When details toggle:

- Sibling details are collapsed automatically by the engine.
- Microtasks and event loops process disclosure mutations.
  When component code uses `queueMicrotask` to debounce click handlers (e.g. `moveHit`), the lock expires at the end of the immediate JavaScript execution turn, prior to subsequent event dispatches in the browser event loop. In Gecko, secondary activations or toggle side-effects fire after the microtask has cleared, causing single gestures to execute twice. In a 2-item list, advancing twice wraps $0 \rightarrow 1 \rightarrow 0$.

---

## 3. Detailed Root Cause Analysis

### 3.1 Sheet Focus Restoration Race (`src/components/ui/sheet.tsx`)

In `src/components/ui/sheet.tsx:384-412`:

- When a Sheet closes, its `useEffect` cleanup schedules:
  1. A `requestAnimationFrame` callback to focus the opening element (`restoreTarget.focus()`).
  2. A nested `50ms` `setTimeout` to retry focusing if focus was lost.
- In `tests/ui-tools.spec.ts`:
  - Pass 3 closes the "Services" sheet.
  - The test loop immediately advances to Pass 4 ("Forms") and calls `await clickWhenSettled(About Forms)`.
  - Playwright begins the pointer event sequence on `About Forms`.
  - Concurrently, the 50ms timer from Pass 3 fires and focuses `About Services`.
  - Gecko detects focus shifting to `About Services` while `About Forms` is mid-pointerdown, and aborts the `click` event.
  - "About Forms" never opens, causing the test timeout.

### 3.2 Document Viewer Hit Navigation Race (`src/components/document-viewer/source-panels.tsx`)

In `src/components/document-viewer/source-panels.tsx:1090-1100`:

- `moveHit` uses `queueMicrotask` to reset `hitMoveLockRef.current`.
- Exclusive accordion updates and synthetic event propagation in Gecko deliver duplicate activations that exceed the microtask boundary.
- For a two-hit result set, `setActiveHitIndex((c) => (c + 1 + 2) % 2)` is called twice in rapid succession, returning the index to 0.
- Furthermore, `scrollIntoView` triggered on hit disclosure expansion causes a ~70px layout translation between Playwright's `pointerdown` and `pointerup`, causing `click` to be delivered to the common container rather than the button.

---

## 4. Remediation Plan

### 4.1 Component Hardening

1. **`src/components/ui/sheet.tsx`**:
   - Cancel any pending `restoreTimers` when a new Sheet mounts or opens.
   - Do not invoke `restoreTarget.focus()` if `document.activeElement` has already moved to an active interactive element.
   - Remove or tighten the secondary 50ms `setTimeout` retry to avoid out-of-band focus stealing.
2. **`src/components/document-viewer/source-panels.tsx`**:
   - Replace `queueMicrotask` in `moveHit` with a 50ms-60ms `setTimeout` lock to span event loop turns.
   - Maintain geometric stability of the hit navigation controls to prevent pointer displacement during disclosure scroll.

### 4.2 Test Suite Hardening

1. **`tests/ui-tools.spec.ts`**:
   - After dismissing each sheet in the loop, wait for focus restoration:
     ```typescript
     await expect(results.getByRole("button", { name: `About ${title}` })).toBeFocused();
     ```
   - This ensures focus has completely settled before the next pointer action begins.
2. **`tests/ui-smoke.spec.ts`**:
   - Retain the click counter retry helper.
   - Assert directly on the DOM attribute `data-source-active-hit="true"` on the target chunk disclosure.

---

## 5. Verification & Gate Impact

- **Deterministic Re-runs**:
  - Run `npx playwright test tests/ui-tools.spec.ts --project=firefox`
  - Run `npx playwright test tests/ui-smoke.spec.ts --project=firefox`
- Both tests verify that Firefox execution matches Chromium and WebKit stability floors.
