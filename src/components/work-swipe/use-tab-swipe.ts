"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";

import type { WorkArea } from "@/lib/work-frame/areas";

/**
 * Side swipe between a work area's three pinned tabs (work-mode redesign).
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
 *   - The slide-in cue now waits for the new page instead of a fixed 400ms,
 *     which on a slow load expired before the page arrived.
 *
 * Swipes that start on a field, a slider, a sheet, the top bar or anything that
 * scrolls sideways itself are ignored; `data-no-tab-swipe` opts any region out.
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
/** The slide-in cue is cleared when the new page arrives, or after this as a fallback. */
const CUE_FALLBACK_MS = 1200;

function scrollsSideways(element: Element | null): boolean {
  for (let node = element; node && node !== document.body; node = node.parentElement) {
    if (!(node instanceof HTMLElement)) continue;
    if (node.closest("[data-no-tab-swipe]")) return true;
    const overflowX = getComputedStyle(node).overflowX;
    if ((overflowX === "auto" || overflowX === "scroll") && node.scrollWidth > node.clientWidth + 1) return true;
  }
  return false;
}

export function swipeBlocked(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return true;
  if (
    target.closest(
      'input, textarea, select, [contenteditable="true"], [role="slider"], [role="dialog"], header, [data-no-tab-swipe]',
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
  width,
  recent,
}: {
  /** Total horizontal travel, negative to the left. */
  dx: number;
  width: number;
  /** The last samples of the gesture, oldest first, for its release speed. */
  recent: readonly SwipeSample[];
}): "next" | "previous" | null {
  const distance = Math.abs(dx);
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

export function useTabSwipe(area: WorkArea, tabIndex: number) {
  const router = useRouter();
  const pathname = usePathname();
  const cueTimer = useRef<number | null>(null);

  // The new page has arrived: let its slide-in run, then clear the cue.
  useEffect(() => {
    const root = document.documentElement;
    if (!root.dataset.workSwipe) return;
    if (cueTimer.current !== null) window.clearTimeout(cueTimer.current);
    cueTimer.current = window.setTimeout(() => {
      delete root.dataset.workSwipe;
      cueTimer.current = null;
    }, 320);
  }, [pathname]);

  useEffect(() => {
    if (tabIndex < 0) return;
    const root = document.documentElement;
    type Gesture = {
      x: number;
      y: number;
      scrollY: number;
      axis: "x" | "y" | null;
      armed: boolean;
      samples: SwipeSample[];
    };
    let gesture: Gesture | null = null;

    const tabLinks = () => document.querySelectorAll<HTMLElement>('[data-testid="mode-band-tabs"] .work-band__tab');
    const markTarget = (index: number | null) => {
      tabLinks().forEach((link, i) => {
        if (i === index) link.dataset.swipeTarget = "true";
        else delete link.dataset.swipeTarget;
      });
    };
    const clearLean = () => {
      root.style.removeProperty("--work-swipe-lean");
      delete root.dataset.workSwiping;
      markTarget(null);
    };
    const reset = () => {
      gesture = null;
      clearLean();
    };

    const onStart = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (event.touches.length !== 1 || !touch) return reset();
      if (
        touch.clientX < SWIPE_EDGE_GUARD ||
        touch.clientX > window.innerWidth - SWIPE_EDGE_GUARD ||
        swipeBlocked(event.target)
      )
        return reset();
      gesture = {
        x: touch.clientX,
        y: touch.clientY,
        scrollY: window.scrollY,
        axis: null,
        armed: false,
        samples: [{ x: touch.clientX, t: event.timeStamp }],
      };
    };

    const onMove = (event: TouchEvent) => {
      const g = gesture;
      if (!g) return;
      const touch = event.touches[0];
      if (event.touches.length !== 1 || !touch) return reset();
      const dx = touch.clientX - g.x;
      const dy = touch.clientY - g.y;
      if (g.axis === null) {
        if (Math.abs(dx) < SWIPE_AXIS_SLOP && Math.abs(dy) < SWIPE_AXIS_SLOP) return;
        // Ties go to scrolling: only a clearly sideways start is a swipe.
        g.axis = Math.abs(dx) > Math.abs(dy) * 1.5 ? "x" : "y";
      }
      if (g.axis === "y" || Math.abs(window.scrollY - g.scrollY) > 4) {
        // A scroll, or the page moved under the finger: never a tab change.
        g.axis = "y";
        clearLean();
        return;
      }
      g.samples.push({ x: touch.clientX, t: event.timeStamp });
      while (g.samples.length > 2 && event.timeStamp - g.samples[0]!.t > 90) g.samples.shift();

      const targetIndex = tabIndex + (dx < 0 ? 1 : -1);
      const target = area.tabs[targetIndex];
      const reach = Math.max(SWIPE_DISTANCE_MIN, window.innerWidth * SWIPE_DISTANCE_SHARE);
      const progress = Math.min(1, Math.abs(dx) / reach);
      const lean = Math.sign(dx) * -1 * progress * LEAN_MAX * (target ? 1 : EDGE_RESISTANCE);
      root.dataset.workSwiping = "true";
      root.style.setProperty("--work-swipe-lean", `${lean.toFixed(1)}px`);
      const armed = Boolean(target?.href) && progress >= 1;
      if (armed && !g.armed) tick();
      g.armed = armed;
      markTarget(armed ? targetIndex : null);
    };

    const onEnd = (event: TouchEvent) => {
      const g = gesture;
      reset();
      const touch = event.changedTouches[0];
      if (!g || !touch || g.axis !== "x") return;
      const dx = touch.clientX - g.x;
      const outcome = swipeOutcome({
        dx,
        width: window.innerWidth,
        recent: [...g.samples, { x: touch.clientX, t: event.timeStamp }],
      });
      if (!outcome) return;
      const tab = area.tabs[tabIndex + (outcome === "next" ? 1 : -1)];
      if (!tab?.href) return;
      if (!g.armed) tick();
      root.dataset.workSwipe = outcome;
      if (cueTimer.current !== null) window.clearTimeout(cueTimer.current);
      cueTimer.current = window.setTimeout(() => {
        delete root.dataset.workSwipe;
        cueTimer.current = null;
      }, CUE_FALLBACK_MS);
      router.push(tab.href);
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
  }, [area, tabIndex, router]);
}
