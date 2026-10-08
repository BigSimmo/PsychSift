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
 * - `data-stuck` on the band while it is pinned, which hides the line drawing
 *   and lines the band's dots up with the top bar's, so the bar and the row
 *   read as one surface.
 *
 * Nothing pins until the first measurement (`data-pinned`), so the server
 * render and the first paint are exactly the band as it was.
 */
export function useStickyWorkTabs(band: HTMLElement | null, navRef: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!band || !nav) return;
    const root = document.documentElement;
    let stuckWatch: IntersectionObserver | null = null;
    let watchedTop = Number.NaN;

    const watchStuck = (stickTop: number) => {
      if (stickTop === watchedTop || typeof IntersectionObserver === "undefined") return;
      watchedTop = stickTop;
      stuckWatch?.disconnect();
      // The band is pinned once its top has reached where `top` holds it. The
      // root's top edge sits a pixel below that line, so the band crosses
      // full visibility exactly as it pins and as it lets go.
      stuckWatch = new IntersectionObserver(
        ([entry]) => {
          if (entry) band.toggleAttribute("data-stuck", entry.boundingClientRect.top <= stickTop + 1);
        },
        { rootMargin: `${-(stickTop + 1)}px 0px 0px 0px`, threshold: 1 },
      );
      stuckWatch.observe(band);
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
      const stickTop = Math.round(Number.parseFloat(getComputedStyle(band).top));
      if (Number.isFinite(stickTop)) watchStuck(stickTop);
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
    return () => {
      window.removeEventListener("resize", measure);
      resize?.disconnect();
      stuckWatch?.disconnect();
      band.removeAttribute("data-pinned");
      band.removeAttribute("data-stuck");
      root.style.removeProperty("--work-tabs-h");
      root.style.removeProperty("--work-bar-h");
    };
  }, [band, navRef]);
}
