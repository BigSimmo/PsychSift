"use client";

import { useEffect, useRef } from "react";

import { adminStyles } from "@/components/admin/admin-kit";
import { cn } from "@/components/ui-primitives";

const AUTO_DISMISS_MS = 6_000;

/**
 * The one "Saved · Undo" bar every real toggle on New job shares (standard
 * §7, ui-lane-rules "Undo"): 48px, sits above where a floating Add would be,
 * and clears itself after about six seconds if nobody taps Undo.
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

  useEffect(() => {
    const timer = window.setTimeout(() => dismissRef.current(), AUTO_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div role="status" aria-live="polite" data-testid={testId} className={cn(adminStyles.undoBar, "print:hidden")}>
      <span className={adminStyles.undoText}>{label}</span>
      <button type="button" onClick={onUndo} data-testid={`${testId}-undo`} className={adminStyles.undoAction}>
        Undo
      </button>
    </div>
  );
}
