"use client";

import { type RefObject, useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";

/**
 * Side swipe along a work area's tab row as it is drawn: the tabs that fit
 * this screen, then the More page that is open (work-mode redesign; Work mode
 * navigation thread, 7 Oct 2026, so a swipe never lands on a hidden tab).
 *
 * Same gesture as before, tuned (Mode picker polish thread, 7 Oct 2026):
 *   - The axis is decided in the first few pixels. A gesture that starts
 *     vertical is a scroll and is left alone for its whole life, and the
 *     listeners are passive, so scrolling is never held up or hijacked.
 *   - A short quick flick counts, not only a long slow drag, and a slow
 *     deliberate drag past a fifth of the screen counts however long it took.
 *     Reversing before letting go cancels.
 *   - Both screen edges belong to the phone (iPhone back and forward swipe).
 *   - Feedback: the active tab's underline leans toward where the swipe is
 *     going, the destination tab lights once the swipe will land, and a light
 *     haptic tick marks that moment where the phone supports it. On the first
 *     or last tab the underline barely moves and nothing navigates.
 *   - The slide-in plays on the page that arrives, not the one leaving, and
 *     no longer expires on a slow load before the new page shows.
 *
 * Swipes that start on a field, a slider, a drawing surface, the top bar or
 * anything that scrolls sideways itself are ignored, as is every touch while a
 * sheet is open. `data-no-tab-swipe` opts any other region out.
 */

/** Touches this close to either screen edge belong to the phone's own back and forward swipe. */
export const SWIPE_EDGE_GUARD = 28;
/** Movement before the gesture commits to an axis. */
export const SWIPE_AXIS_SLOP = 10;
/** A deliberate drag lands at this share of the screen width, with a floor in pixels. */
export const SWIPE_DISTANCE_SHARE = 0.2;
export const SWIPE_DISTANCE_MIN = 64;
/** A quick flick lands from this far, at this speed (pixels per millisecond) or faster. */
export const SWIPE_FLICK_DISTANCE = 36;
export const SWIPE_FLICK_SPEED = 0.45;
/** How far the underline may lean, in pixels, and how much less at the first or last tab. */
const LEAN_MAX = 12;
const EDGE_RESISTANCE = 0.25;
/** A swipe's slide-in plays on the page that arrives within this long of letting go. */
const CUE_WINDOW_MS = 1500;
/** How long the slide-in cue stays on the arriving page (its animation is 240ms). */
const CUE_HOLD_MS = 320;

function scrollsSideways(element: Element | null): boolean {
  for (let node = element; node && node !== document.body; node = node.parentElement) {
    if (!(node instanceof HTMLElement)) continue;
    if (node.closest("[data-no-tab-swipe]")) return true;
    const style = getComputedStyle(node);
    // A surface that takes the finger itself (a signature pad, a drawing canvas).
    if (style.touchAction === "none") return true;
    const overflowX = style.overflowX;
    if ((overflowX === "auto" || overflowX === "scroll") && node.scrollWidth > node.clientWidth + 1) return true;
  }
  return false;
}

export function swipeBlocked(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return true;
  // Any open modal (a sheet, its dimmed backdrop included) owns every touch.
  if (target.ownerDocument.querySelector('[aria-modal="true"]')) return true;
  if (
    target.closest(
      `input, textarea, select, canvas, [contenteditable="true"], [role="slider"], [role="dialog"], header, [data-no-tab-swipe]`,
    )
  )
    return true;
  return scrollsSideways(target);
}

export type SwipeSample = { x: number; t: number };

/**
 * Whether a released horizontal swipe should change tab, and which way.
 * Pure, so the thresholds are tested without a touch screen.
 */
export function swipeOutcome({
  dx,
  dy = 0,
  width,
  recent,
}: {
  /** Total horizontal travel, negative to the left. */
  dx: number;
  /** Total vertical travel. A gesture that ended up mostly vertical is not a swipe. */
  dy?: number;
  width: number;
  /** The last samples of the gesture, oldest first, for its release speed. */
  recent: readonly SwipeSample[];
}): "next" | "previous" | null {
  const distance = Math.abs(dx);
  if (distance <= Math.abs(dy) * 1.5) return null;
  const direction = dx < 0 ? "next" : "previous";
  const first = recent[0];
  const last = recent[recent.length - 1];
  const span = first && last ? last.t - first.t : 0;
  const velocity = span > 0 && first && last ? (last.x - first.x) / span : 0;
  // Let go while moving back the other way: the reader changed their mind.
  if (velocity !== 0 && Math.sign(velocity) !== Math.sign(dx) && Math.abs(velocity) > 0.1) return null;
  if (distance >= Math.max(SWIPE_DISTANCE_MIN, width * SWIPE_DISTANCE_SHARE)) return direction;
  if (distance >= SWIPE_FLICK_DISTANCE && Math.abs(velocity) >= SWIPE_FLICK_SPEED) return direction;
  return null;
}

function tick() {
  try {
    navigator.vibrate?.(8);
  } catch {
    // No haptics on this device; the visual cue carries it.
  }
}

/**
 * The pages a swipe walks through, as the tab row draws them now: the tabs
 * that fit this screen in order, then the More page that is open, if the last
 * slot names one. `current` is -1 when the open page is in none of them.
 */
function swipePages(nav: HTMLElement, currentHref: string): { hrefs: string[]; current: number } {
  const links = Array.from(nav.querySelectorAll<HTMLAnchorElement>('a.work-band__tab:not([data-fit="out"])'));
  const hrefs = links.map((link) => link.getAttribute("href") ?? "");
  let current = links.findIndex((link) => link.getAttribute("aria-current") === "page");
  if (current < 0 && nav.querySelector(".work-band__more[data-current]")) {
    hrefs.push(currentHref);
    current = hrefs.length - 1;
  }
  return { hrefs, current };
}

export function useTabSwipe(navRef: RefObject<HTMLElement | null>, currentHref: string | null) {
  const router = useRouter();
  const pathname = usePathname();
  const pendingCue = useRef<{ direction: "next" | "previous"; at: number } | null>(null);

  // The new page has arrived: play its slide-in now, never on the page leaving.
  useEffect(() => {
    const cue = pendingCue.current;
    pendingCue.current = null;
    if (!cue || performance.now() - cue.at > CUE_WINDOW_MS) return;
    const root = document.documentElement;
    root.dataset.workSwipe = cue.direction;
    const timer = window.setTimeout(() => {
      if (root.dataset.workSwipe === cue.direction) delete root.dataset.workSwipe;
    }, CUE_HOLD_MS);
    return () => {
      window.clearTimeout(timer);
      delete root.dataset.workSwipe;
    };
  }, [pathname]);

  useEffect(() => {
    if (!currentHref) return;
    type Gesture = {
      x: number;
      y: number;
      scrollY: number;
      axis: "x" | "y" | null;
      armed: boolean;
      leaning: boolean;
      samples: SwipeSample[];
      hrefs: string[];
      current: number;
    };
    let gesture: Gesture | null = null;

    const tabsNav = () => navRef.current;
    const markTarget = (nav: HTMLElement | null, href: string | null) => {
      nav?.querySelectorAll<HTMLElement>(".work-band__tab").forEach((link) => {
        if (href !== null && link.getAttribute("href") === href && link.dataset.fit !== "out")
          link.dataset.swipeTarget = "true";
        else delete link.dataset.swipeTarget;
      });
    };
    // Lean state lives on the tabs bar, not <html>, so a drag restyles one small subtree.
    const clearLean = () => {
      const nav = tabsNav();
      if (!nav) return;
      nav.style.removeProperty("--work-swipe-lean");
      delete nav.dataset.swiping;
      markTarget(nav, null);
    };
    const reset = () => {
      const wasLeaning = gesture?.leaning;
      gesture = null;
      if (wasLeaning) clearLean();
    };

    const onStart = (event: TouchEvent) => {
      reset();
      const touch = event.touches[0];
      if (event.touches.length !== 1 || !touch) return;
      if (
        touch.clientX < SWIPE_EDGE_GUARD ||
        touch.clientX > window.innerWidth - SWIPE_EDGE_GUARD ||
        swipeBlocked(event.target)
      )
        return;
      const nav = tabsNav();
      if (!nav) return;
      const { hrefs, current } = swipePages(nav, currentHref);
      if (current < 0) return;
      gesture = {
        x: touch.clientX,
        y: touch.clientY,
        scrollY: window.scrollY,
        axis: null,
        armed: false,
        leaning: false,
        samples: [{ x: touch.clientX, t: event.timeStamp }],
        hrefs,
        current,
      };
    };

    const onMove = (event: TouchEvent) => {
      const g = gesture;
      if (!g || g.axis === "y") return;
      const touch = event.touches[0];
      if (event.touches.length !== 1 || !touch) return reset();
      const dx = touch.clientX - g.x;
      const dy = touch.clientY - g.y;
      if (g.axis === null) {
        if (Math.abs(dx) < SWIPE_AXIS_SLOP && Math.abs(dy) < SWIPE_AXIS_SLOP) return;
        // Ties go to scrolling: only a clearly sideways start is a swipe.
        g.axis = Math.abs(dx) > Math.abs(dy) * 1.5 ? "x" : "y";
        if (g.axis === "y") return;
      }
      if (Math.abs(window.scrollY - g.scrollY) > 4) {
        // The page moved under the finger: a scroll, never a tab change.
        g.axis = "y";
        if (g.leaning) clearLean();
        g.leaning = false;
        return;
      }
      g.samples.push({ x: touch.clientX, t: event.timeStamp });
      while (g.samples.length > 2 && event.timeStamp - g.samples[0]!.t > 90) g.samples.shift();

      const nav = tabsNav();
      if (!nav) return;
      const target = g.hrefs[g.current + (dx < 0 ? 1 : -1)];
      const reach = Math.max(SWIPE_DISTANCE_MIN, window.innerWidth * SWIPE_DISTANCE_SHARE);
      const progress = Math.min(1, Math.abs(dx) / reach);
      const lean = Math.sign(dx) * -1 * progress * LEAN_MAX * (target ? 1 : EDGE_RESISTANCE);
      g.leaning = true;
      nav.dataset.swiping = "true";
      nav.style.setProperty("--work-swipe-lean", `${lean.toFixed(1)}px`);
      const armed = Boolean(target) && progress >= 1;
      if (armed && !g.armed) tick();
      if (armed !== g.armed) markTarget(nav, armed ? (target ?? null) : null);
      g.armed = armed;
    };

    const onEnd = (event: TouchEvent) => {
      const g = gesture;
      reset();
      const touch = event.changedTouches[0];
      if (!g || !touch || g.axis !== "x") return;
      const outcome = swipeOutcome({
        dx: touch.clientX - g.x,
        dy: touch.clientY - g.y,
        width: window.innerWidth,
        recent: [...g.samples, { x: touch.clientX, t: event.timeStamp }],
      });
      if (!outcome) return;
      const next = g.hrefs[g.current + (outcome === "next" ? 1 : -1)];
      if (!next) return;
      if (!g.armed) tick();
      pendingCue.current = { direction: outcome, at: performance.now() };
      router.push(next);
    };

    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", onEnd, { passive: true });
    window.addEventListener("touchcancel", reset, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", reset);
      clearLean();
    };
  }, [navRef, currentHref, router]);
}
