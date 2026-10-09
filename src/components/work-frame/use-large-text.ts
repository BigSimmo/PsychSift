"use client";

import { useLayoutEffect } from "react";

/** Text at or above 125% of the browser's 16px default counts as large. */
export const LARGE_TEXT_MIN_ROOT_PX = 20;

/**
 * A screen narrower than 19rem counts as large text too: that is what a
 * page-zoomed phone (Safari's text size) or a 390px phone at about 130% text
 * leaves, and the same point at which the top bar takes two rows.
 */
export const LARGE_TEXT_MAX_WIDTH_REM = 19;

/** Whether the reader's text is large for this screen, from the root font size and width. */
export function isLargeText(rootFontPx: number, viewportWidthPx: number): boolean {
  if (!(rootFontPx > 0)) return false;
  return rootFontPx >= LARGE_TEXT_MIN_ROOT_PX || viewportWidthPx / rootFontPx < LARGE_TEXT_MAX_WIDTH_REM;
}

/**
 * Marks `<html data-large-text>` while the reader's text is large (200% text
 * follow-up, owner request 9 Oct 2026). Work pages then let labels that
 * normally shorten with "..." wrap onto a second line instead (work-mode.css),
 * so nothing is cut off at 200%. At normal text sizes nothing changes.
 *
 * Re-checked on resize and whenever the root font size changes, which a 1rem
 * probe reports through a ResizeObserver.
 */
export function useLargeTextFlag(): void {
  useLayoutEffect(() => {
    const root = document.documentElement;
    const probe = document.createElement("span");
    probe.setAttribute("aria-hidden", "true");
    probe.style.cssText = "position:absolute;top:0;left:0;width:1rem;height:0;visibility:hidden;pointer-events:none";
    document.body.appendChild(probe);
    const check = () => {
      const px = Number.parseFloat(getComputedStyle(root).fontSize);
      root.toggleAttribute("data-large-text", isLargeText(px, window.innerWidth));
    };
    check();
    window.addEventListener("resize", check);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(check);
    observer?.observe(probe);
    return () => {
      window.removeEventListener("resize", check);
      observer?.disconnect();
      probe.remove();
      root.removeAttribute("data-large-text");
    };
  }, []);
}

/** Mounts {@link useLargeTextFlag}; drawn by the top bar in every work mode. */
export function LargeTextFlag(): null {
  useLargeTextFlag();
  return null;
}
