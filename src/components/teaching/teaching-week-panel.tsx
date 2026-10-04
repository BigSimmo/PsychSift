"use client";

import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useSyncExternalStore } from "react";

import { ModeActionButton } from "@/components/mode-kit/action-button";
import { modeModuleSurface } from "@/components/mode-kit/recipes";
import { TeachingSessionScreen } from "@/components/teaching/teaching-session";
import { TeachingWeekScreen } from "@/components/teaching/teaching-week";
import { cn, eyebrowText } from "@/components/ui-primitives";
import { useTeachingDemoMode } from "@/components/teaching/use-teaching-sample";

/*
 * Week on a wide screen (U4 Step 9): tapping a row opens the session in a
 * panel beside the list, with its place in the week and previous and next.
 * A phone keeps navigating to the session page. The panel's arrows are the
 * kit's icon-only control, each with its whole name as its label.
 */
const WIDE = "(min-width: 64rem)";

function useWide(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia(WIDE);
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    },
    () => window.matchMedia(WIDE).matches,
    () => false,
  );
}

export function TeachingWeekPanel({
  occurrenceId,
  ids,
  select,
  close,
  demoMode,
}: {
  occurrenceId: string;
  ids: readonly string[];
  select: (id: string) => void;
  close: () => void;
  demoMode: boolean;
}) {
  const index = ids.indexOf(occurrenceId);
  const previous = index > 0 ? ids[index - 1] : null;
  const next = index >= 0 && index < ids.length - 1 ? ids[index + 1] : null;
  return (
    <div className={cn(modeModuleSurface, "sticky top-4 grid gap-3 p-3")} data-testid="teaching-week-panel">
      <div className="flex items-center justify-between gap-2">
        <p className={cn(eyebrowText, "nums font-normal")}>
          {index >= 0 ? `Session · ${index + 1} of ${ids.length} this week` : "Session"}
        </p>
        <div className="flex">
          {previous ? (
            <ModeActionButton icon={ChevronLeft} label="Previous session" onClick={() => select(previous)} />
          ) : (
            <ModeActionButton icon={ChevronLeft} label="Previous session" disabled />
          )}
          {next ? (
            <ModeActionButton icon={ChevronRight} label="Next session" onClick={() => select(next)} />
          ) : (
            <ModeActionButton icon={ChevronRight} label="Next session" disabled />
          )}
          <ModeActionButton icon={X} label="Close" onClick={close} />
        </div>
      </div>
      <TeachingSessionScreen key={occurrenceId} occurrenceId={occurrenceId} demoMode={demoMode} embedded />
    </div>
  );
}

/** Week with the side panel on wide screens only; a phone keeps navigating to the session page. */
export function TeachingWeekWithPanel({ demoMode: serverDemoMode }: { demoMode: boolean }) {
  const demoMode = useTeachingDemoMode(serverDemoMode);
  const wide = useWide();
  return (
    <TeachingWeekScreen
      demoMode={demoMode}
      sidePanel={wide ? (panel) => <TeachingWeekPanel {...panel} demoMode={demoMode} /> : undefined}
    />
  );
}
