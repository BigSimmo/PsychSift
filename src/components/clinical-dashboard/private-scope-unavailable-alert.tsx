"use client";

import { cn, floatingControl } from "@/components/ui-primitives";

/**
 * Recovery alert shown when a routed private document scope cannot be restored.
 *
 * Lives inside <main> (not as a header sibling): in the answer view the header is absolute, so a
 * sibling alert would reflow to the column top and hide behind the glass bar. Sticky so the
 * recovery actions stay reachable while the user scrolls — pinned below the overlaid glass bar in
 * answer mode, just under the in-flow header otherwise. Sticky resolves against the document in a
 * phone browser and against <main> on the bounded app/tablet surfaces.
 */
export function PrivateScopeUnavailableAlert({
  answerMode,
  onReselect,
  onRunWithout,
}: {
  answerMode: boolean;
  onReselect: () => void;
  onRunWithout: () => void;
}) {
  return (
    <div
      role="alert"
      data-testid="private-scope-unavailable"
      className={cn(
        "sticky z-20 mx-3 mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[color:var(--warning-border)] bg-[color:var(--warning-soft)] px-3 py-2 text-sm text-[color:var(--text)] sm:mx-4 lg:mx-8",
        answerMode
          ? "top-[calc(4.5rem+max(0.5rem,env(safe-area-inset-top)))]"
          : "top-2 max-sm:top-[calc(var(--phone-overlay-chrome-h)+0.5rem)]",
      )}
    >
      <p>The original private document scope is unavailable. Choose the documents again or confirm a broader search.</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={floatingControl} onClick={onReselect}>
          Reselect documents
        </button>
        <button type="button" className={floatingControl} onClick={onRunWithout}>
          Run without private scope
        </button>
      </div>
    </div>
  );
}
