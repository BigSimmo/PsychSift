"use client";

import { useEffect, useRef } from "react";

import { adminStyles } from "@/components/admin/admin-kit";
import { cn } from "@/components/ui-primitives";
import { useHoldWhileEngaged } from "@/components/use-hold-while-engaged";

const AUTO_DISMISS_MS = 6_000;

/**
 * The one "Saved · Undo" bar every real toggle on New job shares (standard
 * §7, ui-lane-rules "Undo"): 48px, sits above where a floating Add would be,
 * and clears itself after about six seconds if nobody taps Undo. It waits while
 * the pointer or keyboard focus is on it.
 */
export function AdminSavedUndoBar({
  label = "Saved",
  onUndo,
  onDismiss,
  testId = "admin-saved-undo-bar",
}: {
  label?: string;
  onUndo: () => void;
  onDismiss: () => void;
  testId?: string;
}) {
  const dismissRef = useRef(onDismiss);
  useEffect(() => {
    dismissRef.current = onDismiss;
  }, [onDismiss]);

  // Held open while the pointer or keyboard focus is on the bar (WCAG 2.2.1).
  const { held, holdProps } = useHoldWhileEngaged(true);
  useEffect(() => {
    if (held) return;
    const timer = window.setTimeout(() => dismissRef.current(), AUTO_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [held]);

  return (
    <div role="status" data-testid={testId} {...holdProps} className={cn(adminStyles.undoBar, "print:hidden")}>
      <span className={adminStyles.undoText}>{label}</span>
      <button type="button" onClick={onUndo} data-testid={`${testId}-undo`} className={adminStyles.undoAction}>
        Undo
      </button>
    </div>
  );
}
