"use client";

import { WorkCard } from "@/components/mode-kit/work";
import { cn } from "@/components/ui-primitives";
import { useTermTrackerStore } from "@/lib/teaching/term-tracker-store";
import { currentTerm, epaLabels, epaNumbers, epaSummary } from "@/lib/teaching/term-tracker";

/**
 * A signed-in doctor's count for each of the four EPAs this year, from the counts they log in Teaching. Reads only
 * this device's term tracker (backed up to their account), so nothing new is stored and no case detail is shown.
 * Hidden until an EPA is logged this year: the term card above already gives the year's total and how to start.
 */
export function AssessmentsEpaCounts({ today }: { today: string }) {
  const { state } = useTermTrackerStore(null);
  if (!state || state.epas.length === 0) return null;
  const term = currentTerm(state);
  const { byEpa, year } = epaSummary(state, term?.id ?? null, today);
  if (year === 0) return null;
  return (
    <WorkCard as="ul" aria-label="EPAs this year, by EPA" testId="assessments-epa-counts">
      {epaNumbers.map((epa) => (
        <li key={epa} className="flex min-h-12 min-w-0 items-center gap-3 px-3 py-2">
          <span
            aria-hidden="true"
            className="grid size-6 shrink-0 place-items-center rounded-full border border-[color:var(--border)] text-xs font-semibold text-[color:var(--text-muted)]"
          >
            {epa}
          </span>
          <span className="min-w-0 flex-1 text-sm text-[color:var(--text)]">
            <span className="sr-only">EPA {epa}: </span>
            {epaLabels[epa].long}
          </span>
          <span
            className={cn(
              "shrink-0 text-sm",
              byEpa[epa]
                ? "font-bold tabular-nums text-[color:var(--text-heading)]"
                : "font-normal tabular-nums text-[color:var(--text-muted)]",
            )}
          >
            {byEpa[epa]}
            <span className="sr-only"> this year</span>
          </span>
        </li>
      ))}
    </WorkCard>
  );
}
