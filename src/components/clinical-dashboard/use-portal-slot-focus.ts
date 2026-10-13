"use client";

import { useEffect, type RefObject } from "react";

/**
 * Pages portal their Back control into the top bar's leading slot. React routes
 * focus events from a portal through the page's tree, so the header's own focus
 * capture never sees them. Listening on the real DOM slot lets a focused Back
 * keep the bar on screen like any other header control.
 */
export function usePortalSlotFocus(
  slotRef: RefObject<HTMLElement | null>,
  enabled: boolean,
  setFocused: (focused: boolean) => void,
) {
  useEffect(() => {
    const slot = slotRef.current;
    if (!slot || !enabled) return undefined;
    const slotHoldsFocus = () => document.activeElement instanceof Node && slot.contains(document.activeElement);
    const handleFocusIn = () => setFocused(true);
    // Back may already hold focus when this starts (focus restored before the
    // header enabled hiding); no focusin would follow, so read it now.
    if (slotHoldsFocus()) queueMicrotask(() => setFocused(true));
    const handleFocusOut = (event: FocusEvent) => {
      const nextTarget = event.relatedTarget;
      if (!(nextTarget instanceof Node) || !slot.contains(nextTarget)) setFocused(false);
    };
    // A focused Back that navigates away unmounts without a focusout.
    const observer = new MutationObserver(() => {
      if (!slotHoldsFocus()) setFocused(false);
    });
    observer.observe(slot, { childList: true, subtree: true });
    slot.addEventListener("focusin", handleFocusIn);
    slot.addEventListener("focusout", handleFocusOut);
    return () => {
      slot.removeEventListener("focusin", handleFocusIn);
      slot.removeEventListener("focusout", handleFocusOut);
      observer.disconnect();
    };
  }, [slotRef, enabled, setFocused]);
}
