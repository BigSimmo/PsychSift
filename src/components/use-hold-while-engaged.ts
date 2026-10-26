"use client";

import { useMemo, useState, type FocusEvent } from "react";

/**
 * Holds a self-clearing Undo window open while someone is on it (WCAG 2.2.1).
 *
 * The shared toast already pauses while the pointer or keyboard focus is on it; the
 * page-level Undo bars run their own timers, so a screen-reader or switch user who
 * tabbed onto Undo could watch it disappear under them. Spread `holdProps` on the
 * bar and skip the timer while `held` is true: the window restarts in full once the
 * pointer and focus have both left.
 *
 * `active` is whether the bar is showing. When it goes away the hold is released,
 * because React fires no blur or pointer-leave for an element that unmounts.
 */
export function useHoldWhileEngaged(active: boolean) {
  const [pointerOn, setPointerOn] = useState(false);
  const [focusIn, setFocusIn] = useState(false);
  const [wasActive, setWasActive] = useState(active);
  if (active !== wasActive) {
    setWasActive(active);
    if (!active) {
      setPointerOn(false);
      setFocusIn(false);
    }
  }

  const holdProps = useMemo(
    () => ({
      onPointerEnter: () => setPointerOn(true),
      onPointerLeave: () => setPointerOn(false),
      onFocus: () => setFocusIn(true),
      onBlur: (event: FocusEvent<HTMLElement>) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocusIn(false);
      },
    }),
    [],
  );

  return { held: active && (pointerOn || focusIn), holdProps };
}
