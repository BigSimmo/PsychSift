"use client";

import { useLayoutEffect, type RefObject } from "react";

/**
 * Keeps a work area's tab row on screen (owner request 8 Oct 2026): once the
 * page scrolls far enough that the band's title has passed under the top bar,
 * the band stops moving and its tab row stays pinned just below the bar, as
 * one sticky unit with it. When the top bar slides away on a scroll down, the
 * pinned row slides away with it, and both come back together; a band not yet
 * past its own place on the page simply stays there (work-mode.css).
 *
 * The band stays in page flow the whole time (CSS `position: sticky` with a
 * negative offset), so pinning moves nothing on the page and needs no reserve.
 * This hook only measures what the CSS needs:
 *
 * - `--work-band-tabs-top` on the band: how far down the band its tab row
 *   starts, so the band can stop with only that row showing.
 * - `--work-bar-h` and `--work-tabs-h` on the root: the top bar's own height
 *   (wide layouts add the safe area in CSS; phones use the measured overlay
 *   reserve) and the pinned row's height, which together are the page's
 *   `scroll-padding-top`, so a jump to a section never lands under the row.
 * - `data-stuck` on the band while it is pinned, which trims the band to its
 *   tab row and lines the row's dots up with the top bar's, so the bar and
 *   the row read as one strip, as a clinical page's tabs do.
 *
 * Pinned is read from the band's position on every scroll frame. An
 * IntersectionObserver did this first and never fired on an installed iPhone,
 * where the page box rather than the document scrolls, so the whole title
 * block stayed on screen and never slid away with the bar (owner report,
 * 9 Oct 2026).
 *
 * Nothing pins until the first measurement (`data-pinned`), so the server
 * render and the first paint are exactly the band as it was.
 */
export function useStickyWorkTabs(band: HTMLElement | null, navRef: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!band || !nav) return;
    const root = document.documentElement;
    const header = document.querySelector<HTMLElement>(".universal-header");
    const collapse = header?.closest<HTMLElement>('[data-testid="universal-header-collapse"]');
    const stack = header?.closest<HTMLElement>(".phone-sticky-header-stack");
    // The box the band sticks in: the page box on an installed phone,
    // otherwise the window.
    let scroller: HTMLElement | null = null;
    let frame = 0;
    let slide: Animation | null = null;
    let needsMeasure = false;
    let needsBarSync = false;
    const setAttribute = (name: string, value: boolean) => {
      if (band.hasAttribute(name) !== value) band.toggleAttribute(name, value);
    };
    const setProperty = (element: HTMLElement, name: string, value: string) => {
      if (element.style.getPropertyValue(name) !== value) element.style.setProperty(name, value);
    };

    const checkStuck = () => {
      if (!band.hasAttribute("data-pinned")) return;
      // Read where the CSS holds the band now, not where it was at the last
      // measure: the phone reserve behind `--work-chrome-h` is published after
      // this hook first measures and can change (safe area, text size) with no
      // resize here, and a stale value left the whole title block pinned on an
      // iPhone with the bar gone and a blank strip above it (owner report,
      // 10 Oct 2026).
      const style = getComputedStyle(band);
      const stickTop = Number.parseFloat(style.top);
      if (!Number.isFinite(stickTop)) return;
      const edge = scroller ? scroller.getBoundingClientRect().top + scroller.clientTop : 0;
      // Mid-slide, read where the band is held, not where it has slid to.
      const slid = Number.parseFloat(style.translate.split(" ")[1] ?? "0") || 0;
      setAttribute("data-stuck", band.getBoundingClientRect().top - slid - edge <= stickTop + 1);
      // Translate does not change the sticky position. Recheck on real scroll,
      // geometry changes and animation completion instead of polling layout on
      // every compositor-animation frame while the reader is stationary.
    };
    const onScroll = () => {
      if (!frame)
        frame = window.requestAnimationFrame(() => {
          frame = 0;
          const measureNow = needsMeasure;
          const syncNow = needsBarSync;
          needsMeasure = false;
          needsBarSync = false;
          if (measureNow) measure();
          if (syncNow) syncBar();
          // Geometry writes settle before the next position check.
          if (measureNow || syncNow) onScroll();
          else checkStuck();
        });
    };

    // The bar hid or came back. `data-bar-hidden` drops the band's sticky
    // offset (work-mode.css), and the band slides from where it was to where
    // that leaves it: out with the bar when pinned, a few pixels back to its
    // own place when it had only just pinned. The slide is a compositor
    // animation of `translate` from the measured gap to zero, so it stays
    // smooth on a busy phone, and the sticky engine owns where the band ends.
    const syncBar = () => {
      const hidden = collapse?.dataset.scrollHidden === "true" || stack?.dataset.scrollHidden === "true";
      if (band.hasAttribute("data-bar-hidden") === hidden) return;
      const from = band.getBoundingClientRect().top;
      slide?.cancel();
      slide = null;
      setAttribute("data-bar-hidden", hidden);
      const gap = from - band.getBoundingClientRect().top;
      if (Math.abs(gap) >= 1 && motionAllowed() && typeof band.animate === "function") {
        const tokens = getComputedStyle(root);
        const token = (name: string) => tokens.getPropertyValue(name).trim();
        slide = band.animate([{ translate: `0 ${gap}px` }, { translate: "0 0" }], {
          duration: Number.parseFloat(token(hidden ? "--duration-slow" : "--duration-moderate")) || 240,
          easing: token(hidden ? "--ease-chrome-hide" : "--ease-chrome-reveal") || "ease-out",
        });
        slide.onfinish = onScroll;
      }
    };

    const measure = () => {
      const tabsTop = nav.offsetTop;
      const barHeight = header?.offsetHeight ?? 0;
      const tabsHeight = band.offsetHeight - tabsTop;
      const nextScroller = stickyScroller(band);
      // Read dimensions before publishing CSS; unchanged resize notifications
      // must not create root-style mutations and redundant position checks.
      setProperty(band, "--work-band-tabs-top", `${tabsTop}px`);
      // Pinned, the band's top sits `tabsTop` above the bar's bottom edge, so
      // shifting its dots by the difference keeps them on the bar's grid.
      setProperty(band, "--work-band-stuck-offset", `${tabsTop - barHeight}px`);
      setProperty(root, "--work-tabs-h", `${tabsHeight}px`);
      if (header) setProperty(root, "--work-bar-h", `${barHeight}px`);
      setAttribute("data-pinned", true);
      scroller = nextScroller;
    };

    measure();
    syncBar();
    onScroll();
    const onResize = () => {
      needsMeasure = true;
      onScroll();
    };
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(onResize);
    resize?.observe(band);
    resize?.observe(nav);
    // The bar (and the phone's overlay stack, whose height is the phone reserve)
    // can change height with text size or rotation; the pinned offset follows.
    for (const chrome of document.querySelectorAll<HTMLElement>(".universal-header, .phone-sticky-header-stack")) {
      resize?.observe(chrome);
    }
    window.addEventListener("resize", onResize);
    // Capture hears the page box's scroll as well as the window's.
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    const bar =
      typeof MutationObserver === "undefined"
        ? null
        : new MutationObserver(() => {
            needsBarSync = true;
            onScroll();
          });
    for (const owner of new Set([collapse, stack])) {
      if (owner) bar?.observe(owner, { attributes: true, attributeFilter: ["data-scroll-hidden"] });
    }
    // The phone reserve lands on the root's style after a quiet window, later
    // than any resize here, and moves where the band sticks with no scroll.
    const reserve = typeof MutationObserver === "undefined" ? null : new MutationObserver(onScroll);
    reserve?.observe(root, { attributes: true, attributeFilter: ["style"] });
    // Focus changes the CSS sticky offset without necessarily scrolling. The
    // completion event also covers reduced-motion's near-zero top transition.
    band.addEventListener("focusin", onScroll);
    band.addEventListener("focusout", onScroll);
    band.addEventListener("transitionend", onScroll);
    return () => {
      bar?.disconnect();
      reserve?.disconnect();
      slide?.cancel();
      window.removeEventListener("resize", onResize);
      document.removeEventListener("scroll", onScroll, { capture: true });
      band.removeEventListener("focusin", onScroll);
      band.removeEventListener("focusout", onScroll);
      band.removeEventListener("transitionend", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
      resize?.disconnect();
      band.removeAttribute("data-pinned");
      band.removeAttribute("data-stuck");
      band.removeAttribute("data-bar-hidden");
      root.style.removeProperty("--work-tabs-h");
      root.style.removeProperty("--work-bar-h");
    };
  }, [band, navRef]);
}

/** The app's motion setting: an explicit choice wins, otherwise the system's. */
function motionAllowed(): boolean {
  const choice = document.documentElement.dataset.motion;
  if (choice === "reduced") return false;
  if (choice === "full") return true;
  return !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/** The nearest ancestor a sticky element sticks within, or null for the window. */
function stickyScroller(element: HTMLElement): HTMLElement | null {
  for (let node = element.parentElement; node && node !== document.body; node = node.parentElement) {
    const { overflowX, overflowY } = getComputedStyle(node);
    if (![overflowX, overflowY].every((value) => value === "visible" || value === "clip")) return node;
  }
  return null;
}
