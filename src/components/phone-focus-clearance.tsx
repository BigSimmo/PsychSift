"use client";

import { useEffect } from "react";

import { phoneMediaQuery } from "@/components/clinical-dashboard/use-hide-on-scroll";

function visibleDockTop() {
  const viewportBottom = window.visualViewport?.height ?? window.innerHeight;
  for (const layer of document.querySelectorAll<HTMLElement>(".phone-footer-layer, .work-dock")) {
    const style = getComputedStyle(layer);
    if (style.visibility === "hidden" || style.display === "none" || Number(style.opacity) === 0) continue;
    const top = layer.getBoundingClientRect().top;
    if (top < viewportBottom - 1) return top;
  }
  return null;
}

/**
 * Re-reveal `target` when it sits under a visible dock or past either viewport edge. The dock
 * line is the visible dock's top, or the viewport bottom while the dock is scroll-hidden.
 * Measuring the margin band instead nudged WebKit, which had already revealed the control and
 * let the dock scroll-hide; the nudge scrolled back up and brought the dock over it again.
 */
function revealIfCovered(target: HTMLElement) {
  const rect = target.getBoundingClientRect();
  const floor = visibleDockTop() ?? window.visualViewport?.height ?? window.innerHeight;
  if (rect.bottom > floor + 1 || rect.top < 0) {
    target.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
}

/**
 * Phone focus targets inside `.phone-scroll-surface` carry a `scroll-margin-block-end` equal to
 * the fixed bottom dock (globals.css), so a Tab stop is revealed above the dock rather than under
 * it. Chromium and WebKit honour that margin when focus scrolls. Firefox only scrolls a focused
 * control that it judges not visible, and it judges visibility on the control inflated by its
 * scroll margins — so a control partly under the dock, or even wholly below the viewport while
 * the dock is scroll-hidden (the top margin pulls the inflated box back on screen), is left where
 * it is. `scrollIntoView` honours scroll-margin in every engine, so re-reveal a control that the
 * visible dock covers or that sits off screen.
 *
 * The reveal runs synchronously inside `focusin`, so no frame ever paints the control covered and
 * nothing that reads layout straight after the key press sees the uncorrected position. A second
 * check one frame later catches an engine focus scroll that lands after `focusin`. Engines that
 * already cleared the dock never reach `scrollIntoView`. Pointer focus (not `:focus-visible`) is
 * left alone so a tap or click is never scrolled away between press and release.
 *
 * Layout can still move after that frame: the reveal scroll hides the dock, and the shell's
 * bottom reserve then animates to zero, or a late section above the results finishes loading.
 * Either can carry an already-revealed control back under the dock or off screen. So for a short
 * settle window the content box is watched, and the control is re-revealed whenever it resizes.
 */
const settleWindowMs = 1200;

export function PhoneFocusClearance() {
  useEffect(() => {
    const phone = window.matchMedia(phoneMediaQuery);
    let settle: { observer: ResizeObserver; timer: number } | null = null;
    // A reader who scrolls, taps or presses a key during the settle window has moved on (Enter on
    // an in-page jump link scrolls away from the still-focused link), so stop pulling the page
    // back to the focused control.
    const userScrollEvents = ["wheel", "touchstart", "pointerdown", "keydown"] as const;
    const stopSettling = () => {
      if (!settle) return;
      for (const type of userScrollEvents) window.removeEventListener(type, stopSettling, true);
      settle.observer.disconnect();
      window.clearTimeout(settle.timer);
      settle = null;
    };
    const onFocusIn = (event: FocusEvent) => {
      stopSettling();
      if (!phone.matches) return;
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const surface = target.closest<HTMLElement>(".phone-scroll-surface");
      if (!surface) return;
      // Keyboard focus only. A press focuses its control on pointerdown, before the release that
      // makes the click; scrolling there moves the control out from under the pointer, so the
      // release lands elsewhere and the click (a form submit, say) never happens.
      if (!target.matches(":focus-visible")) return;
      revealIfCovered(target);
      window.requestAnimationFrame(() => {
        if (document.activeElement !== target) return;
        revealIfCovered(target);
      });
      if (typeof ResizeObserver === "undefined") return;
      const content = surface.querySelector<HTMLElement>('[data-testid="mobile-composer-reserve-pad"]') ?? surface;
      const observer = new ResizeObserver(() => {
        if (document.activeElement !== target) {
          stopSettling();
          return;
        }
        revealIfCovered(target);
      });
      // Border box, so the reserve padding collapsing counts as a resize.
      observer.observe(content, { box: "border-box" });
      settle = { observer, timer: window.setTimeout(stopSettling, settleWindowMs) };
      for (const type of userScrollEvents) {
        window.addEventListener(type, stopSettling, { capture: true, passive: true });
      }
    };
    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      stopSettling();
    };
  }, []);

  return null;
}
