"use client";

import { useLayoutEffect } from "react";

import { phoneMediaQuery } from "./use-hide-on-scroll";

const headerStackSelector = ".phone-sticky-header-stack";
const collapseSelector = '[data-testid="universal-header-collapse"]';
const reserveProperty = "--phone-overlay-chrome-h";

/**
 * #147 recorded the provisional 200px stack correcting to 72px 15–60ms later.
 * Require 80ms of unchanged frame-sampled geometry: strictly beyond that
 * observed window, with one nominal 60Hz frame of margin. This is elapsed
 * rendering time, not a timer sleep; every geometry signal restarts the window.
 */
export const phoneOverlayReserveGeometryQuietWindowMs = 80;

/**
 * Reads the phone overlay header stack height that `--phone-overlay-chrome-h`
 * should publish. Returns 0 when the stack is temporarily unmeasurable
 * (`display: contents`, mid-unmount) so callers can keep the previous value
 * instead of publishing `0px` over the CSS seed.
 */
export function readPhoneOverlayChromeReservePx(root: ParentNode = document): number {
  const collapse = root.querySelector<HTMLElement>(collapseSelector);
  const stack = collapse?.closest<HTMLElement>(headerStackSelector) ?? null;
  // Heights are fractional border-box CSS pixels throughout measurement,
  // claiming and release. Integer offsetHeight rounded a 79.875px addon to
  // 80px, moving page content when the portal replaced its in-flow box.
  // The overlay only translates, so its rect height is unchanged while hidden.
  // Prefer `||` over `??`: a present stack with height 0 (display:contents
  // / empty mid-unmount) must fall through to the collapse row, and a 0 from
  // both must stay 0 so the publisher can refuse to clobber the CSS seed.
  return stack?.getBoundingClientRect().height || collapse?.getBoundingClientRect().height || 0;
}

/**
 * Publishes the measured reserve immediately, without waiting out the geometry
 * quiet window below.
 *
 * The quiet window exists to filter a *transient mis-measurement* — responsive
 * layout briefly reporting the wide 200px stack during hydration (#147). A
 * portal that moves a `header-collapse-addon` row out of page flow is not that:
 * it is a discrete DOM change whose resulting geometry is correct in the very
 * commit that causes it. Making that case wait cost 110ms of wrong layout.
 *
 * What that cost, measured on `/differentials/compare` at 390x844 (#CHPC5C):
 * the page paints with the 49px mode-nav row in flow over a 72px seed, the row
 * portals into the fixed header at ~315ms and every element rises 49px, and the
 * reserve only republishes 121px at ~423ms. A tap landing in that window pressed
 * "Open comparison" and released on "Edit selection" where it had just been; the
 * browser retargeted the click to their common ancestor and the link never
 * activated. No error, no navigation — for a clinician, a button that does
 * nothing.
 *
 * Keeps both guards that matter: phone widths only, and never publish a
 * non-positive measurement over the CSS seed.
 *
 * Scope: the settle precondition below means this only ever fires on an
 * in-session navigation. React runs layout effects children-first and the
 * reserve hook belongs to the shell, so on a cold first load a portal's effect
 * runs before the hook has settled anything and this returns early. Portals
 * therefore go through `claimPhoneOverlayAddonReserve`, which covers the cold
 * load by writing the seed plus the row's own height inline, and calls this for
 * the settled case.
 */
export function publishPhoneOverlayChromeReserveNow(): void {
  if (typeof window === "undefined") return;
  // Only ever ADJUSTS a reserve the quiet window has already settled; it never
  // establishes the first one. Without this the immediate path would run during
  // initial portal mounting on a cold load, when responsive layout can still
  // report the wide 200px stack for 15-60ms (#147). Publishing that over the CSS
  // seed, then having the observer correct it, moves content a second time — the
  // same tap-target swap this whole change exists to remove, just relocated to
  // first paint. Raised by review on PR #2929 and reproduced in
  // tests/phone-overlay-chrome-reserve.dom.test.ts.
  //
  // Suppressing it before settle costs nothing: the hook's own path still owns
  // that window exactly as it did before this change.
  if (!hasSettledPhoneOverlayReserve) return;
  if (!window.matchMedia(phoneMediaQuery).matches) return;
  const measured = readPhoneOverlayChromeReservePx();
  if (measured <= 0) return;
  document.documentElement.style.setProperty(reserveProperty, `${measured}px`);
}

/**
 * Records the height of the `header-collapse-addon` row a portal has just moved
 * out of page flow, so the reserve is right in the same commit on EVERY path,
 * including the cold first load that `publishPhoneOverlayChromeReserveNow`
 * cannot serve (#CHPC5C). Call it from the portal's layout effect after the
 * commit that filled `host`; the returned function undoes it.
 *
 * It publishes the row's own height as a delta rather than re-measuring the
 * stack, which is what makes it safe before the quiet window has settled:
 *
 * - Before settle, it writes the reserve in force (the CSS seed, or an earlier
 *   claim's value) plus the row's height as an inline `calc()`. No stack
 *   measurement is taken, so the transient wide-stack reading (#147) the settle
 *   precondition guards against cannot leak in; the quiet window later settles
 *   the same total in pixels. It writes `--phone-overlay-chrome-h` itself rather
 *   than a second property the seed depends on: a production Chromium build
 *   painted one frame with the dependent value still stale (a 49px layout shift
 *   and back, ~15ms), while a direct write is picked up in the same frame.
 * - After settle, the inline measured value is in force. Claiming re-measures
 *   through the immediate publisher, which is safe post-settle.
 * - Releasing subtracts the row's height: before settle by restoring the value
 *   it replaced, after settle arithmetically. It cannot re-measure the stack,
 *   because React runs layout-effect destroys before it detaches portal
 *   children, so the row is still in the stack when the cleanup runs. For the
 *   same reason the host still holds the row, so the release reads the host's
 *   height at that moment rather than the one captured at claim time: a row can
 *   grow while claimed (a medication nav gains its section rail once the record
 *   loads), and the settled reserve has since been republished at that height.
 *
 * The addon slot holds one page-owned row (see `ModeNavHeaderPortal`), so the
 * host's own height is that row's height.
 */
export function claimPhoneOverlayAddonReserve(host: HTMLElement): () => void {
  if (typeof window === "undefined") return () => {};
  if (!window.matchMedia(phoneMediaQuery).matches) return () => {};
  const rowPx = host.getBoundingClientRect().height;
  if (rowPx <= 0) return () => {};
  const root = document.documentElement;
  // The row's height when it is released, falling back to the claimed height
  // if the host no longer measures (see the release note above).
  const releasedRowPx = () => host.getBoundingClientRect().height || rowPx;

  if (!hasSettledPhoneOverlayReserve) {
    const previousInline = root.style.getPropertyValue(reserveProperty);
    const base = previousInline || getComputedStyle(root).getPropertyValue(reserveProperty).trim();
    if (!base) return () => {};
    const claimed = `calc(${base} + ${rowPx}px)`;
    root.style.setProperty(reserveProperty, claimed);
    return () => {
      if (hasSettledPhoneOverlayReserve) {
        releaseSettledRow(releasedRowPx());
        return;
      }
      if (root.style.getPropertyValue(reserveProperty) !== claimed) return;
      if (previousInline) root.style.setProperty(reserveProperty, previousInline);
      else root.style.removeProperty(reserveProperty);
    };
  }

  publishPhoneOverlayChromeReserveNow();
  return () => {
    if (hasSettledPhoneOverlayReserve) releaseSettledRow(releasedRowPx());
  };
}

function releaseSettledRow(rowPx: number): void {
  const root = document.documentElement;
  const current = Number.parseFloat(root.style.getPropertyValue(reserveProperty));
  if (!Number.isFinite(current) || current - rowPx <= 0) return;
  root.style.setProperty(reserveProperty, `${current - rowPx}px`);
}

/**
 * Whether the quiet window has committed a phone reserve that the immediate
 * publisher may adjust. Module scope because one shell owns the hook while the
 * portals that call the publisher are elsewhere in the tree.
 */
let hasSettledPhoneOverlayReserve = false;

/**
 * Exported for tests only: the publisher's precondition is otherwise invisible,
 * and a helper that cannot actually set it would let these cases pass while
 * proving nothing. `tests/phone-overlay-chrome-reserve.dom.test.ts` also drives
 * the real hook once, so the production path that sets this is covered too
 * rather than only the seam.
 */
export function __setPhoneOverlayReserveSettledForTests(settled: boolean): void {
  hasSettledPhoneOverlayReserve = settled;
}

/**
 * Publishes the phone overlay header's stable height as `--phone-overlay-chrome-h`
 * so content can reserve a *constant* top clearance beneath it.
 *
 * Why this exists: `phoneMotion: "overlay"` takes the header out of flow
 * (`.phone-overlay-header` is fixed in browser tabs, absolute in standalone), so
 * without a reserve the first content would sit underneath the chrome at scroll
 * top. The reserve must not change when the header hides — that is the whole
 * point of overlay over collapse. Because it never changes, hiding costs the
 * scroller no layout and content does not shift.
 *
 * The measurement is safe to take in either state: hiding translates the stack
 * (`-translate-y-full`) without changing its border-box rect height, so the value is
 * the revealed height whether or not the chrome is currently away. That is why
 * this hook deliberately does *not* read `data-scroll-hidden` — unlike
 * `use-document-chrome-metrics`, which zeroes its anchor offset while hidden
 * because an anchor target must clear only chrome that is actually painting.
 *
 * Publishes `0px` above the phone breakpoint, where the sticky
 * [top bar | search] stack stays in flow and owns its own offsets.
 *
 * On phone, a synchronous layout read is only provisional. Responsive layout
 * can briefly report the wide stack (observed as 200px) before settling to the
 * 72px phone stack 15–60ms later. Keep the server-stable CSS seed until an
 * observer candidate remains unchanged across the evidence-calibrated geometry
 * quiet window; otherwise hydration can publish the transient value and then
 * correct it, creating avoidable CLS. A transient `0` observer measurement
 * likewise keeps the seed or last positive reserve (Production UI #147; same
 * failure class as PR #1562 / #146).
 */
export function usePhoneOverlayChromeReserve(): void {
  useLayoutEffect(() => {
    const root = document.documentElement;
    const media = window.matchMedia(phoneMediaQuery);
    let pendingHeight: number | null = null;
    let quietSinceFrameMs: number | null = null;
    let confirmationFrame: number | null = null;
    let confirmationGeneration = 0;

    const invalidatePendingConfirmation = () => {
      confirmationGeneration += 1;
      pendingHeight = null;
      quietSinceFrameMs = null;
      if (confirmationFrame === null) return;
      window.cancelAnimationFrame(confirmationFrame);
      confirmationFrame = null;
    };

    const scheduleConfirmation = (expectedGeneration: number) => {
      const frameId = window.requestAnimationFrame((frameTimestamp) => {
        if (expectedGeneration !== confirmationGeneration) return;
        if (confirmationFrame === frameId) confirmationFrame = null;
        confirmPendingReserve(frameTimestamp, expectedGeneration);
      });
      confirmationFrame = frameId;
    };

    const stageCandidate = (height: number) => {
      invalidatePendingConfirmation();
      pendingHeight = height;
      scheduleConfirmation(confirmationGeneration);
    };

    function confirmPendingReserve(frameTimestamp: DOMHighResTimeStamp, expectedGeneration: number) {
      if (expectedGeneration !== confirmationGeneration || !media.matches || pendingHeight === null) {
        return;
      }

      const confirmed = readPhoneOverlayChromeReservePx();
      if (confirmed <= 0) {
        invalidatePendingConfirmation();
        return;
      }
      if (confirmed !== pendingHeight) {
        // A frame read can see new geometry before its observer delivery. Give
        // that value a fresh full quiet window rather than inheriting time.
        stageCandidate(confirmed);
        return;
      }

      if (quietSinceFrameMs === null) {
        quietSinceFrameMs = frameTimestamp;
        scheduleConfirmation(expectedGeneration);
        return;
      }
      if (frameTimestamp - quietSinceFrameMs < phoneOverlayReserveGeometryQuietWindowMs) {
        scheduleConfirmation(expectedGeneration);
        return;
      }

      const stableHeight = confirmed;
      invalidatePendingConfirmation();
      root.style.setProperty(reserveProperty, `${stableHeight}px`);
      // From here a portal may adjust this value immediately. Before it, the
      // quiet window alone owns the reserve — see
      // `publishPhoneOverlayChromeReserveNow`.
      hasSettledPhoneOverlayReserve = true;
    }

    const syncBreakpoint = () => {
      invalidatePendingConfirmation();
      // Either direction abandons the settled phone value: entering phone hands
      // back to the CSS seed, leaving it hands over to the desktop `0px`.
      hasSettledPhoneOverlayReserve = false;
      if (media.matches) {
        // A previous desktop match owns an inline `0px`. Remove it when
        // entering phone layout so the CSS seed remains authoritative until
        // the observer reports the settled phone stack.
        if (root.style.getPropertyValue(reserveProperty) === "0px") {
          root.style.removeProperty(reserveProperty);
        }
        return;
      }
      root.style.setProperty(reserveProperty, "0px");
    };

    const publishObservedReserve = () => {
      if (!media.matches) {
        invalidatePendingConfirmation();
        return;
      }
      const measured = readPhoneOverlayChromeReservePx();
      if (measured <= 0) {
        // Keep the CSS seed (or the last positive inline value) rather than
        // publishing 0px on a one-frame miss during resize / remount.
        invalidatePendingConfirmation();
        return;
      }
      // Observer delivery proves that layout changed, not that it has settled.
      // Every delivery restarts the measured quiet window, while a generation
      // guard makes an already-cancelled callback harmless if it still runs.
      stageCandidate(measured);
    };

    // Do not publish the synchronous layout read. During hydration or a
    // breakpoint transition it can still describe the outgoing wide layout.
    syncBreakpoint();

    // The collapse row grows and shrinks with portaled page navigation
    // (`header-collapse-addon`), so observe size rather than sampling once.
    // The stack may also mount after this effect (late chrome / route-owned
    // collapse). Re-query on DOM mutations so a missing mount-time target does
    // not leave the reserve on the CSS seed for the lifetime of the owner.
    let resizeObserver: ResizeObserver | null = null;
    let observedStack: HTMLElement | null = null;

    const resolveStack = () => {
      const observed = document.querySelector<HTMLElement>(collapseSelector);
      return observed?.closest<HTMLElement>(headerStackSelector) ?? observed ?? null;
    };

    const attachResizeObserver = () => {
      const stack = resolveStack();
      if (stack === observedStack) return;
      resizeObserver?.disconnect();
      resizeObserver = null;
      observedStack = stack;
      if (!stack) return;
      resizeObserver = new ResizeObserver(publishObservedReserve);
      resizeObserver.observe(stack);
      publishObservedReserve();
    };

    attachResizeObserver();
    const mutationObserver = new MutationObserver(attachResizeObserver);
    mutationObserver.observe(document.body, { childList: true, subtree: true });

    // Stack geometry changes caused by viewport resize and orientation are
    // deliberately published only through ResizeObserver. The raw window
    // events fire before responsive layout has necessarily settled.
    media.addEventListener("change", syncBreakpoint);

    return () => {
      invalidatePendingConfirmation();
      mutationObserver.disconnect();
      resizeObserver?.disconnect();
      media.removeEventListener("change", syncBreakpoint);
      hasSettledPhoneOverlayReserve = false;
      root.style.removeProperty(reserveProperty);
    };
  }, []);
}
