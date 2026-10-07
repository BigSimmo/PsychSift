"use client";

import { CalendarDays } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { CalendarSubscribe } from "@/components/calendar/calendar-subscribe";
import { CalendarView } from "@/components/calendar/calendar-view";
import { InformationPageShell } from "@/components/information-page-shell";
import { ModeGroupedList, ModeRow } from "@/components/mode-kit/grouped-list";
import { OnCallLoadFailed } from "@/components/on-call/on-call-load-failed";
import { OnCallToolNavHeader } from "@/components/on-call/on-call-nav-header";
import { OnCallOfflineBanner } from "@/components/on-call/on-call-offline-banner";
import { OnCallEmptyState } from "@/components/on-call/kit/empty-state";
import { cn, textMuted } from "@/components/ui-primitives";
import { onCallCalendarEvents } from "@/lib/on-call/calendar-events";
import { useOnCallEntries } from "@/lib/on-call/entry-store";
import { msUntilNextOnCallLocalDay, onCallLocalDateKey } from "@/lib/on-call/local-date";

/**
 * CALENDAR — teaching sessions and recorded expiry dates on one month view,
 * each of which can go into the reader's own calendar. It lives at
 * `/roster/calendar` but holds no shifts, so its title says what it holds and
 * one row points to where the shifts are.
 */
const CALENDAR_TITLE = "Teaching and expiry dates";
export function OnCallCalendarPage({ now: nowProp }: { now?: Date } = {}) {
  const { entries, loading, isOffline, loadError, retry, cachedAt } = useOnCallEntries();
  // Moves at midnight, so a calendar left open overnight does not keep calling
  // yesterday "today". A pinned `now` is the caller's to move.
  const [tick, setTick] = useState(() => new Date());
  const now = nowProp ?? tick;
  useEffect(() => {
    if (nowProp) return;
    const timer = setTimeout(() => setTick(new Date()), msUntilNextOnCallLocalDay(now));
    return () => clearTimeout(timer);
  }, [nowProp, now]);
  const today = onCallLocalDateKey(now);
  const events = useMemo(() => onCallCalendarEvents(entries, today), [entries, today]);

  return (
    <>
      <OnCallToolNavHeader title={CALENDAR_TITLE} testIdPrefix="on-call-calendar" />
      <InformationPageShell testId="on-call-calendar-main" width="narrow">
        <h1 className="sr-only">{CALENDAR_TITLE}</h1>
        <p className={cn(textMuted, "mb-4 text-sm")}>
          Teaching sessions, and the expiry dates you recorded on Compliance.
        </p>
        {isOffline && cachedAt ? <OnCallOfflineBanner savedAt={cachedAt} reason={loadError} /> : null}
        {loading && entries.length === 0 ? (
          <OnCallEmptyState
            icon={CalendarDays}
            title="Loading your calendar"
            body="Fetching sessions and dates."
            testId="on-call-calendar-loading"
          />
        ) : isOffline && entries.length === 0 ? (
          <OnCallLoadFailed reason={loadError} onRetry={retry} />
        ) : (
          <CalendarView events={events} today={today} exportName="On Call" testId="on-call-calendar-view" />
        )}
        <CalendarSubscribe testId="on-call-calendar-subscribe" />
        <ModeGroupedList testId="on-call-calendar-shifts">
          <ModeRow title="Your shifts are in Shifts" href="/roster/shifts" testId="on-call-calendar-shifts-link" />
        </ModeGroupedList>
      </InformationPageShell>
    </>
  );
}
