"use client";

import { useLayoutEffect, type RefObject } from "react";

/**
 * Keeps a work area's tab row on screen (owner request 8 Oct 2026): once the
 * page scrolls far enough that the band's title has passed under the top bar,
 * the band stops moving and its tab row stays pinned just below the bar, as
 * one sticky unit with it. When the top bar slides away on a scroll down, the
 * pinned row slides away with it, and both come back together.
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
    // Where the CSS holds the band, measured from the top of the box it sticks
    // in: the page box on an installed phone, otherwise the window.
    let stickTop = Number.NaN;
    let scroller: HTMLElement | null = null;
    let frame = 0;

    const checkStuck = () => {
      frame = 0;
      if (!Number.isFinite(stickTop)) return;
      const edge = scroller ? scroller.getBoundingClientRect().top + scroller.clientTop : 0;
      // Leave out the slide that hides the band with the bar (mid-slide too),
      // so a hidden band reads where it is held, not where it has slid to.
      const slide = Number.parseFloat(getComputedStyle(band).translate.split(" ")[1] ?? "0") || 0;
      band.toggleAttribute("data-stuck", band.getBoundingClientRect().top - slide - edge <= stickTop + 1);
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(checkStuck);
    };

    const measure = () => {
      const bar = document.querySelector<HTMLElement>(".universal-header");
      const tabsTop = nav.offsetTop;
      const barHeight = bar?.offsetHeight ?? 0;
      band.style.setProperty("--work-band-tabs-top", `${tabsTop}px`);
      // Pinned, the band's top sits `tabsTop` above the bar's bottom edge, so
      // shifting its dots by the difference keeps them on the bar's grid.
      band.style.setProperty("--work-band-stuck-offset", `${tabsTop - barHeight}px`);
      root.style.setProperty("--work-tabs-h", `${band.offsetHeight - tabsTop}px`);
      if (bar) root.style.setProperty("--work-bar-h", `${barHeight}px`);
      band.toggleAttribute("data-pinned", true);
      // Read back where the CSS holds the band, so phone and wide layouts agree.
      stickTop = Number.parseFloat(getComputedStyle(band).top);
      scroller = stickyScroller(band);
      checkStuck();
    };

    measure();
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    resize?.observe(band);
    resize?.observe(nav);
    // The bar (and the phone's overlay stack, whose height is the phone reserve)
    // can change height with text size or rotation; the pinned offset follows.
    for (const chrome of document.querySelectorAll<HTMLElement>(".universal-header, .phone-sticky-header-stack")) {
      resize?.observe(chrome);
    }
    window.addEventListener("resize", measure);
    // Capture hears the page box's scroll as well as the window's.
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return () => {
      window.removeEventListener("resize", measure);
      document.removeEventListener("scroll", onScroll, { capture: true });
      if (frame) window.cancelAnimationFrame(frame);
      resize?.disconnect();
      band.removeAttribute("data-pinned");
      band.removeAttribute("data-stuck");
      root.style.removeProperty("--work-tabs-h");
      root.style.removeProperty("--work-bar-h");
    };
  }, [band, navRef]);
}

/** The nearest ancestor a sticky element sticks within, or null for the window. */
function stickyScroller(element: HTMLElement): HTMLElement | null {
  for (let node = element.parentElement; node && node !== document.body; node = node.parentElement) {
    const { overflowX, overflowY } = getComputedStyle(node);
    if (![overflowX, overflowY].every((value) => value === "visible" || value === "clip")) return node;
  }
  return null;
}
