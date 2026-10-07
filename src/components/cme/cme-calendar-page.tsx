import { ChevronDown } from "lucide-react";

import { CalendarSubscribe } from "@/components/calendar/calendar-subscribe";
import { CalendarView } from "@/components/calendar/calendar-view";
import { cmePageTitle, cmePageWidth } from "@/components/cme/cme-page-frame";
import { cn, textMuted } from "@/components/ui-primitives";
import { perthCalendarDate } from "@/lib/cme/cpd-year";
import { cmeCalendarEvents } from "@/lib/cme/calendar-events";
import type { CmeRoutine } from "@/lib/cme/routines";
import type { CmeEntry, CmeRequirementSet } from "@/lib/cme/types";

/**
 * CALENDAR — CME's dates on one month view: what was logged, when each
 * routine is next due (and every repeat after), and the year's own dates.
 * The routines and year dates can be sent to the owner's own calendar.
 *
 * No hooks or handlers live here, so on the Calendar route it renders on the server and only the
 * worked-out events (not every entry and routine) cross to the browser for the month view.
 */
export function CmeCalendarPage({
  set,
  entries,
  routines,
  nowIso,
}: {
  set: CmeRequirementSet;
  entries: readonly CmeEntry[];
  routines: readonly CmeRoutine[];
  nowIso: string;
}) {
  const { shown, exported } = cmeCalendarEvents({ set, entries, routines });
  return (
    <main data-testid="cme-calendar" className={cn(cmePageWidth, "px-4 pb-24 pt-6 sm:px-6")}>
      <h1 className={cmePageTitle}>Calendar</h1>
      <p className={cn(textMuted, "mb-4 mt-1 text-sm")}>
        What you logged, when your routines come round, and the dates that close the year.
      </p>
      <CalendarView
        events={shown}
        exportEvents={exported}
        today={perthCalendarDate(new Date(nowIso))}
        exportName={`CPD ${set.year}`}
        testId="cme-calendar-view"
        markStyle="shape"
        laterHeadingPrefix="Coming up in"
      />
      {/* The subscription card is mostly explanation, read once. CPD folds the
          whole card, wording untouched, behind one disclosure; the shared
          component itself is unchanged for the modes that use it. It renders
          nothing where subscriptions are unavailable, and `has-[section]`
          keeps the disclosure from showing an empty fold then. */}
      <details data-testid="cme-calendar-subscribe-fold" className="group mt-5 hidden has-[section]:block">
        <summary className="inline-flex min-h-tap cursor-pointer list-none items-center gap-1.5 text-sm font-medium text-[color:var(--clinical-accent)] [&::-webkit-details-marker]:hidden">
          Subscribe from your calendar app · How this works
          <ChevronDown
            aria-hidden="true"
            className="size-icon-sm transition-transform motion-reduce:transition-none group-open:rotate-180"
          />
        </summary>
        <CalendarSubscribe testId="cme-calendar-subscribe" />
      </details>
    </main>
  );
}
