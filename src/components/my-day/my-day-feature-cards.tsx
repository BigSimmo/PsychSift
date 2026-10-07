"use client";

import { ApplicationsTodayCard } from "@/components/cme/applications/applications-today-card";
import { shiftName } from "@/components/my-day/my-day-today-cards";
import { FirstWeekTodayCardLive } from "@/components/on-call/first-week/first-week-today-card";
import { SickTomorrowTodayCard } from "@/components/roster/sick/roster-sick-entry";
import { TermFolderTodayCard } from "@/components/teaching/term-folder/term-folder-today-card";
import { useWorkModeRouteVisible } from "@/components/work-mode-launch/work-mode-launch-provider";
import type { ShiftKind } from "@/lib/roster/shift-kind";
import { sickDayWord } from "@/lib/roster/sick/sick-report";
import { useAuthSession } from "@/lib/supabase/client";
import { TERM_FOLDER_PATH } from "@/lib/teaching/term-folder";
import { useTermTrackerStore } from "@/lib/teaching/term-tracker-store";

/**
 * The junior features' Today cards on My Day Today, after Needs you. Each card
 * draws nothing until it has something to say, so an ordinary day shows none:
 * - Sick for tomorrow, when the roster that loaded has a shift tomorrow;
 * - Your first week pack, from a week before a new job until the end of its
 *   first week (the handbook is read only then);
 * - Job applications, when a date the doctor added is coming up or a referee
 *   has gone quiet (this device only);
 * - the term evidence folder, when a current term is set up on this device.
 *
 * A card that opens a screen the launch switch holds back for this reader is
 * not drawn. The signed-out sample never draws these (the caller checks).
 */
export function MyDayFeatureCards({
  now,
  today,
  tomorrowShift,
}: {
  readonly now: Date;
  readonly today: string;
  /** Tomorrow's first rostered shift, from the roster My Day already read; null when none or not read. */
  readonly tomorrowShift: { readonly startsAt: string; readonly kind: ShiftKind } | null;
}) {
  const visible = useWorkModeRouteVisible();
  const { status } = useAuthSession();
  // The local demo build has no device term to show and no depth routes to read.
  const demo = status === "unconfigured" || process.env.NEXT_PUBLIC_DEMO_MODE === "true";
  const terms = useTermTrackerStore(null).state;
  const hasTerm = Boolean(terms?.terms.some((term) => term.id === terms.currentTermId));
  return (
    <>
      {tomorrowShift && visible("/roster/sick") ? (
        <SickTomorrowTodayCard
          tomorrowShift={`${sickDayWord(tomorrowShift.startsAt, now)} · ${shiftName(tomorrowShift.kind)}`}
        />
      ) : null}
      {visible("/on-call/first-week") ? <FirstWeekTodayCardLive now={now} feed /> : null}
      {visible("/cme/applications") ? <ApplicationsTodayCard today={today} /> : null}
      {!demo && hasTerm && visible(TERM_FOLDER_PATH) ? <TermFolderTodayCard demoMode={false} /> : null}
    </>
  );
}
