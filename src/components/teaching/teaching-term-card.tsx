"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";

import { focusRing } from "@/components/card-recipes";
import { modeFeaturedSurface, modePressable, modeRaisedCard } from "@/components/mode-kit/recipes";
import { modeNameText, modeNumberText, modeSecondaryText } from "@/components/mode-kit/type";
import { useTermTrackerStore } from "@/lib/teaching/term-tracker-store";
import { cn } from "@/components/ui-primitives";
import {
  currentTerm,
  dayMonth,
  epaSummary,
  milestoneIds,
  milestoneLabels,
  milestoneState,
  nextMilestone,
  sampleTermTracker,
  termWeekCount,
  termWeekOf,
} from "@/lib/teaching/term-tracker";

/**
 * The Term entry on Logbook: which week of the term, the three assessments as a three-step bar, and
 * EPAs this year. With no term set up it is a quiet link to set one up. Reads only this device.
 */
export function TeachingTermCard({ demoMode, today }: { demoMode: boolean; today: string }) {
  const sample = useMemo(() => (demoMode ? sampleTermTracker(today) : null), [demoMode, today]);
  const { state } = useTermTrackerStore(sample);
  if (!state) return null;
  const term = currentTerm(state);

  const shell = cn(
    modeRaisedCard,
    modeFeaturedSurface,
    modePressable,
    focusRing,
    "flex min-h-13 items-center gap-3 px-3 py-3 no-underline",
  );

  if (!term) {
    return (
      <Link href="/teaching/term" data-mode-identity="teaching" data-testid="teaching-term-card" className={shell}>
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className={cn(modeNameText, "text-base-minus text-[color:var(--text-heading)]")}>Track your term</span>
          <span className={modeSecondaryText}>Term assessments, EPAs and supervisor meeting</span>
        </span>
        <ChevronRight aria-hidden="true" className="size-icon-md shrink-0 text-[color:var(--text-muted)]" />
      </Link>
    );
  }

  const total = termWeekCount(term);
  const week = termWeekOf(term, today);
  const next = nextMilestone(term);
  const epas = epaSummary(state, term.id, today);
  const title = [
    term.number ? `Term ${term.number}` : null,
    week >= 1 && week <= total ? `week ${week} of ${total}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <Link
      href="/teaching/term"
      data-mode-identity="teaching"
      data-testid="teaching-term-card"
      className={cn(shell, "items-start")}
    >
      <span className="grid min-w-0 flex-1 gap-2">
        <span className="flex items-baseline justify-between gap-3">
          <span className={cn(modeNameText, "text-base-minus text-[color:var(--text-heading)]")}>
            {title || term.unit}
          </span>
          {next ? (
            <span className="shrink-0 text-sm font-medium text-[color:var(--mode-identity)]">
              {milestoneLabels[next].short} {dayMonth(term.milestones[next].dueOn)}
            </span>
          ) : (
            <span className={modeSecondaryText}>All three done</span>
          )}
        </span>
        <span aria-hidden="true" className="grid grid-cols-3 gap-1">
          {milestoneIds.map((id) => {
            const state = milestoneState(term, id, today);
            return (
              <span key={id} className="grid gap-1">
                <span
                  className={cn(
                    "h-1.5 rounded-full",
                    state === "done" ? "bg-[color:var(--mode-identity)]" : "bg-[color:var(--surface-inset)]",
                    state === "due" && "ring-1 ring-[color:var(--mode-identity)]",
                  )}
                />
                <span className="text-xs text-[color:var(--text-muted)]">{milestoneLabels[id].short}</span>
              </span>
            );
          })}
        </span>
        <span className={modeSecondaryText}>
          EPAs this year{" "}
          <span className={cn(modeNumberText, "text-[color:var(--text-heading)]")}>
            {state.targets ? `${epas.year} of ${state.targets.perYear}` : epas.year}
          </span>
        </span>
      </span>
      <ChevronRight aria-hidden="true" className="mt-0.5 size-icon-md shrink-0 text-[color:var(--text-muted)]" />
    </Link>
  );
}
