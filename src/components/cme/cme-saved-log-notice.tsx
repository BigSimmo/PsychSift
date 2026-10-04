"use client";

import { Check } from "lucide-react";

/** How long "Saved to your log" stays on screen after a quick or one-tap log. */
export const CME_SAVED_NOTICE_MS = 6000;

/**
 * Fixed toast after an activity lands in the log. When `entryId` is set, Undo
 * deletes that entry (same DELETE path as `CmeQuickLog`).
 */
export function CmeSavedLogNotice({
  entryId,
  undoing = false,
  undoError = null,
  onUndo,
}: {
  /** Empty string = saved without an id (no Undo). Null = hidden. */
  readonly entryId: string | null;
  readonly undoing?: boolean;
  readonly undoError?: string | null;
  readonly onUndo?: () => void;
}) {
  if (entryId === null) return null;
  return (
    <div
      role="status"
      data-testid="cme-quick-log-saved"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[var(--z-toast)] flex justify-center px-4 pb-[calc(max(1rem,env(safe-area-inset-bottom))+4rem)]"
    >
      <div className="pointer-events-auto inline-flex min-h-tap items-center gap-2 rounded-lg border border-[color:var(--clinical-accent-border)] bg-[color:var(--surface-raised)] px-4 text-sm font-semibold text-[color:var(--clinical-accent)] shadow-[var(--e4)]">
        <Check aria-hidden="true" className="size-icon-sm" />
        <span>Saved to your log.</span>
        {entryId && onUndo ? (
          <button
            type="button"
            disabled={undoing}
            onClick={() => onUndo()}
            className="min-h-tap underline underline-offset-2"
          >
            Undo
          </button>
        ) : null}
        {undoError ? <span>{undoError}</span> : null}
      </div>
    </div>
  );
}
