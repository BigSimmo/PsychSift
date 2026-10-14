"use client";
// Unused since design audit D11 (13 Oct 2026): kept under the 30-day deletion rule; delete from 12 Nov 2026 with its knip.json ignore entry.

import { ChevronRight, Compass, X } from "lucide-react";
import Link from "next/link";
import { useSyncExternalStore } from "react";

import { focusRing } from "@/components/card-recipes";
import { useWorkUndoToast } from "@/components/mode-kit/work";
import { cn } from "@/components/ui-primitives";
import { useWorkSetupProgress } from "@/components/work-setup/use-work-setup-progress";
import { WORK_SETUP_HREF, workSetupStepHref } from "@/components/work-setup/work-setup-copy";
import { dismissWorkSetup, workSetupCount, workSetupPromptVisible } from "@/lib/work-setup/progress";

const subscribeNothing = () => () => undefined;

/**
 * "Finish setting up": one line and a chevron, in a flat hairline card, at the
 * top of each work area's first page while Work setup is incomplete (site
 * review 12 Oct 2026, item 2). It opens the existing setup page, resuming where
 * the reader left off.
 *
 * It reads the same device-only setup progress as My Day's "Set up Work" card,
 * so finishing or putting setup away anywhere hides both. The cross puts it
 * away on this device (with Undo), exactly as the card's "Not now" does.
 * Drawn only after the stored progress is read, so it never flashes in and out.
 */
export function WorkSetupRow({ testId = "work-setup-row" }: { readonly testId?: string }) {
  const hydrated = useSyncExternalStore(
    subscribeNothing,
    () => true,
    () => false,
  );
  const { progress, update } = useWorkSetupProgress();
  const undoToast = useWorkUndoToast();
  if (!hydrated || !workSetupPromptVisible(progress)) return null;

  const started = progress.status === "in-progress";
  const { done, total } = workSetupCount(progress);
  const putAway = () => {
    const before = progress.status;
    update(dismissWorkSetup);
    // Undo restores only the status, so a step finished meanwhile is kept.
    undoToast?.("Setup put away. Find it in More or Help.", () =>
      update((current) => (current.status === "dismissed" ? { ...current, status: before } : current)),
    );
  };

  return (
    <div className="work-card flex min-w-0 items-stretch" data-testid={testId}>
      <Link
        href={started ? workSetupStepHref(progress.step) : WORK_SETUP_HREF}
        data-testid={`${testId}-open`}
        className={cn(
          focusRing,
          "flex min-h-12 min-w-0 flex-1 items-center gap-3 rounded-md pl-3 text-left no-underline",
        )}
      >
        <Compass
          aria-hidden="true"
          strokeWidth={2}
          className="size-icon-md shrink-0 text-[color:var(--mode-identity)]"
        />
        <span className="min-w-0 flex-1 text-sm font-medium break-words text-[color:var(--text-heading)]">
          Finish setting up
          {started && total > 0 ? (
            <span className="font-normal text-[color:var(--text-muted)]">{` · ${done} of ${total} done`}</span>
          ) : null}
        </span>
        <ChevronRight aria-hidden="true" className="size-icon-md shrink-0 text-[color:var(--text-muted)]" />
      </Link>
      <button
        type="button"
        onClick={putAway}
        aria-label="Hide Finish setting up on this device"
        data-testid={`${testId}-dismiss`}
        className={cn(
          focusRing,
          "inline-flex min-h-12 min-w-12 shrink-0 items-center justify-center rounded-md text-[color:var(--text-muted)]",
        )}
      >
        <X aria-hidden="true" strokeWidth={2} className="size-icon-sm" />
      </button>
    </div>
  );
}
