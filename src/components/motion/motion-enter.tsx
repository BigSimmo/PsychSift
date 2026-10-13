"use client";

import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useRef } from "react";

import { workAreaIdForPath } from "@/lib/work-frame/areas";

const ATTRIBUTE = "data-motion-enter";

/**
 * Marks elements so `motion.css` fades them in once. The attribute is removed
 * and re-added (with a style read between) so a second change replays it, and
 * cleared when the fade ends so it never lingers on the element.
 */
export function markMotionEnter(elements: Iterable<Element>) {
  for (const element of elements) {
    if (!(element instanceof HTMLElement)) continue;
    element.removeAttribute(ATTRIBUTE);
    // Reading layout restarts the animation when the attribute comes straight back.
    void element.offsetWidth;
    element.setAttribute(ATTRIBUTE, "");
    // Reduced motion (or no animation at all): nothing to wait for, so nothing is left behind.
    if (getComputedStyle(element).animationName === "none") {
      element.removeAttribute(ATTRIBUTE);
      continue;
    }
    element.addEventListener("animationend", () => element.removeAttribute(ATTRIBUTE), { once: true });
  }
}

/** Elements that can carry an animation: `display: contents` wrappers pass it to their children. */
function animatable(elements: Iterable<Element>): Element[] {
  const out: Element[] = [];
  for (const element of elements) {
    if (getComputedStyle(element).display === "contents") out.push(...animatable(element.children));
    else out.push(element);
  }
  return out;
}

/** A Work page's content: everything after its band (title and tabs), which stays put. */
function workPageContent(): Element[] {
  const band = document.querySelector("#main-content .work-band");
  if (!band?.parentElement) return [];
  const after: Element[] = [];
  let next = band.nextElementSibling;
  while (next) {
    after.push(next);
    next = next.nextElementSibling;
  }
  return animatable(after);
}

/** The panel a tab shows: by `aria-controls`, else the tab list's neighbouring panel. */
function panelFor(tab: Element): Element | null {
  const controls = tab.getAttribute("aria-controls");
  const byId = controls ? document.getElementById(controls) : null;
  if (byId) return byId;
  const list = tab.closest('[role="tablist"]');
  let scope = list?.parentElement ?? null;
  while (scope && scope !== document.body) {
    const panel = scope.querySelector('[role="tabpanel"]');
    if (panel) return panel;
    scope = scope.parentElement;
  }
  return null;
}

/**
 * Tab content cross-fades in (site recommendations, 12 Oct 2026, item 9).
 *
 * Two kinds of tab: `role="tab"` controls (the content swaps in place), and
 * Work's tab row, whose tabs are pages. The search composer is never touched,
 * and only opacity moves; `motion.css` switches it all off under reduced motion.
 */
export function MotionEnter() {
  const pathname = usePathname();
  const previous = useRef(pathname);

  // A move between two Work pages: fade the new page's content in before it paints.
  useLayoutEffect(() => {
    const from = previous.current;
    previous.current = pathname;
    if (from === pathname) return;
    if (workAreaIdForPath(from) === null || workAreaIdForPath(pathname) === null) return;
    markMotionEnter(workPageContent());
  }, [pathname]);

  // A role="tab" switch: fade the shown panel in on the frame after React has swapped it.
  useEffect(() => {
    let frame = 0;
    const onTab = (event: Event) => {
      if (event instanceof KeyboardEvent && !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      const target = event.target instanceof Element ? event.target.closest('[role="tab"]') : null;
      if (!target) return;
      const list = target.closest('[role="tablist"]');
      const before = list?.querySelector('[role="tab"][aria-selected="true"]') ?? null;
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const selected = list?.querySelector('[role="tab"][aria-selected="true"]') ?? target;
        if (selected === before) return;
        const panel = panelFor(selected);
        // Never fade anything holding the search composer.
        if (panel && !panel.querySelector("#global-search-input")) markMotionEnter([panel]);
      });
    };
    // Capture: read the selected tab before React swaps it.
    document.addEventListener("click", onTab, true);
    document.addEventListener("keydown", onTab, true);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("click", onTab, true);
      document.removeEventListener("keydown", onTab, true);
    };
  }, []);

  return null;
}
