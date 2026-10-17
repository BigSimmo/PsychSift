import { expect, type Locator, type Page } from "playwright/test";

/**
 * Wait for a hydrating/portalling surface to converge to exactly one visible
 * DOM owner. Hidden or outgoing duplicates are still duplicates: accepting
 * `locator.first()` here would let a stale RSC tree hide a production defect.
 */
export async function expectSingleSettledOwner(
  locator: Locator,
  { message = "expected one settled DOM owner", timeout = 15_000 }: { message?: string; timeout?: number } = {},
) {
  await expect
    .poll(
      async () => {
        const count = await locator.count();
        const visibility = await Promise.all(
          Array.from({ length: count }, (_, index) =>
            locator
              .nth(index)
              .isVisible()
              .catch(() => false),
          ),
        );
        return { count, visibleCount: visibility.filter(Boolean).length };
      },
      { message, timeout },
    )
    .toEqual({ count: 1, visibleCount: 1 });

  return locator.first();
}

/**
 * Scope a testid to the visible DOM owner (#093).
 *
 * Next streaming can leave a hidden duplicate page root in the tree under
 * full-suite load. Bare `page.getByTestId(...)` then trips Playwright strict
 * mode; bare `.first()` can pin the hidden clone. Prefer this helper (or
 * pad-scoping under `mobile-composer-reserve-pad`) for page-root / shell
 * surfaces. Use `expectSingleSettledOwner` when the duplicate must fully
 * disappear rather than merely be ignored while hidden.
 */
export function visibleByTestId(page: Page, testId: string): Locator {
  return page.getByTestId(testId).filter({ visible: true });
}

/**
 * Scope a rendered-copy query to the visible DOM owner (#093).
 *
 * The text counterpart of `visibleByTestId`, for pages that assert on copy
 * rather than on a testid. Production UI shard 3 on PR #2651:
 * `/formulation/compare` resolved its comparison lede to 2 elements — the live
 * one under `mobile-composer-reserve-pad` and a hidden streaming twin beside
 * it — and a bare `getByText` failed strict mode.
 *
 * Only for `toBeVisible` assertions. A `toHaveCount(0)` assertion must stay
 * bare: filtering to visible there would let a hidden duplicate of copy that
 * should not exist at all pass unnoticed.
 */
export function visibleByText(page: Page, text: string | RegExp, options?: { exact?: boolean }): Locator {
  return page.getByText(text, options).filter({ visible: true });
}

/**
 * Click a control only once scroll-driven chrome has stopped moving it.
 *
 * Above the phone breakpoint the universal header scroll-hides by collapsing its own in-flow
 * row (`grid-template-rows` 1fr -> 0fr in `master-search-header.tsx`), so a scroll moves
 * everything below it by the header's height one render later. Playwright's `click()` scrolls
 * its target into view and dispatches about 10 ms afterwards; on a loaded CI runner the
 * collapse lands between the two, the press goes to whatever slid under the pointer, and the
 * click reports success while nothing happened. Release traces showed exactly that for the
 * tools details panel and the document source-text accordion: alternating click points one
 * header-height apart, "intercepts pointer events" retries, then a final click that missed.
 *
 * Scroll first, wait until the target holds still across frames, then click. The target is
 * already in view, so `click()` scrolls nothing and triggers no second collapse.
 */
export async function clickWhenSettled(locator: Locator, { timeout = 10_000 }: { timeout?: number } = {}) {
  await expectHydrated(locator);
  await locator.scrollIntoViewIfNeeded({ timeout });
  let previous = "";
  await expect
    .poll(
      async () => {
        await locator
          .page()
          .evaluate(
            () =>
              new Promise<void>((resolve) =>
                requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 50))),
              ),
          );
        const box = await locator.boundingBox();
        const current = box ? `${Math.round(box.x)},${Math.round(box.y)}` : "";
        const settled = current !== "" && current === previous;
        previous = current;
        return settled;
      },
      { message: "the control must stop moving before it is clicked", timeout },
    )
    .toBe(true);
  await locator.click({ timeout });
}

/**
 * Wait until React has hydrated this element. Server-rendered markup is visible and
 * actionable before hydration, but a click or fill landing in that gap is dropped (or,
 * for a controlled input, overwritten when React adopts the node). React attaches its
 * `__reactProps$<id>` key to every host node as it hydrates, whether or not the node has
 * a handler, so the key is a per-element readiness signal that also covers native
 * controls (summary, links) that `waitForReactEventHandler` cannot. Slower release-matrix
 * runners (WebKit / PWA standalone) widen this window enough to fail a different
 * spec on most runs.
 */
export async function expectHydrated(locator: Locator, { timeout = 15_000 }: { timeout?: number } = {}) {
  const deadline = timeout === 0 ? Number.POSITIVE_INFINITY : performance.now() + timeout;
  // Unexpected evaluation failures are captured and end the poll, then re-thrown
  // below, so they fail fast instead of depending on whether `expect.poll`
  // propagates or retries a throwing callback until the timeout.
  let unexpectedError: { error: unknown } | undefined;
  await expect
    .poll(
      async () => {
        const remaining = deadline - performance.now();
        if (remaining <= 0) return false;
        try {
          return await locator.evaluate(
            (element) => Object.keys(element).some((key) => key.startsWith("__reactProps$")),
            undefined,
            { timeout: Number.isFinite(remaining) ? remaining : 0 },
          );
        } catch (error) {
          // A streamed canonical redirect can replace the document after
          // DOMContentLoaded. Poll the locator again in its new context, while
          // preserving closed-page, strict-mode and other evaluation failures.
          if (
            error instanceof Error &&
            error.message.includes("Execution context was destroyed, most likely because of a navigation.")
          ) {
            return false;
          }
          unexpectedError = { error };
          return true;
        }
      },
      {
        message: "the control must be hydrated before it is used",
        timeout,
      },
    )
    .toBe(true);
  if (unexpectedError) throw unexpectedError.error;
}

/** `expectHydrated`, then click: for controls that are interacted with straight after navigation. */
export async function clickWhenHydrated(locator: Locator, options?: Parameters<Locator["click"]>[0]) {
  await expectHydrated(locator);
  await locator.click(options);
}
