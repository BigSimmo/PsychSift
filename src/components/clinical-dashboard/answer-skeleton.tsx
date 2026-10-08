import type { CSSProperties } from "react";

import { cn } from "@/components/ui-primitives";
import { answerLoading } from "@/lib/ui-copy";

// The answer skeleton is drawn by the lazy-load fallbacks in clinical-dashboard-lazy.tsx,
// which every search page loads, so it lives apart from answer-status.tsx and its imports.

function skeletonBar(className: string, staggerIndex: number) {
  return (
    <div
      className={cn("animate-skeleton-shimmer stagger-item rounded bg-[color:var(--surface-inset)]", className)}
      style={{ "--stagger-index": staggerIndex } as CSSProperties}
    />
  );
}

/**
 * Three prose bars, and deliberately nothing else.
 *
 * The retired skeleton drew a bordered card, a source card with a tap-sized
 * block, two pill placeholders and a two-column grid — a wireframe of an answer
 * that has not been retrieved yet, promising a shape the payload may not
 * produce. Twenty of thirty answers in the 2026-08-18 blinded read carried no
 * sections at all. Three bars promise only "text is coming", which is the one
 * thing actually known at this point.
 */
export function AnswerProseSkeleton() {
  return (
    <div aria-hidden="true" data-slot="answer-prose-skeleton" className="grid gap-1.5">
      {skeletonBar("h-2 w-11/12", 0)}
      {skeletonBar("h-2 w-9/12", 1)}
      {skeletonBar("h-2 w-10/12", 2)}
    </div>
  );
}

/**
 * The window before the first progress event, and the lazy-load fallback for the
 * dashboard chunk.
 *
 * It carries no status text of its own. Once progress events start arriving,
 * `AnswerProgress` owns the whole wait — line, prose placeholder and sources, in
 * that order — and this component is not rendered beside it. Two indicators
 * disagreeing on one screen ("Writing the answer…" above "Reading your
 * question…") is worse than one, and that is exactly what shipped before this
 * was split.
 *
 * role=status so the window is still announced; without it a screen reader stays
 * silent until AnswerProgress mounts with its own live region.
 */
export function AnswerSkeleton() {
  return (
    <div className="grid gap-2" role="status" aria-label={answerLoading.ariaLabel}>
      <AnswerProseSkeleton />
      <span className="sr-only">{answerLoading.ariaLabel}</span>
    </div>
  );
}
