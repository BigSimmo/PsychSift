"use client";

import { X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, type ReactNode } from "react";

import { ChecklistSummary } from "@/components/admin/renewals/checklist-summary";
import { TodayRenewNextCard } from "@/components/admin/today/today-renew-next-card";
import { focusRing } from "@/components/card-recipes";
import { CmeHeroSummary } from "@/components/cme/cme-hero-summary";
import { TeachingHero } from "@/components/teaching/teaching-hero";
import { heroModel } from "@/components/teaching/teaching-view-model";
import { cn } from "@/components/ui-primitives";
import {
  ADMIN_REQUIREMENTS_CATALOGUE,
  requirementChecklistRowsForJob,
  requirementsNotForThisJob,
  requirementsRecordedCount,
} from "@/lib/admin/requirements";
import { selectRenewNext } from "@/lib/admin/today-selectors";
import type { CmeEntry } from "@/lib/cme/types";
import { withMyDayReturn } from "@/lib/my-day/return-link";
import type { OnCallEntry } from "@/lib/on-call/entry-model";
import { perthDateOf } from "@/lib/roster/shifts/perth-time";
import type { SessionSummary } from "@/lib/teaching/model";

/**
 * The four cards that moved into My Day from the per-mode Today pages
 * (modes review, phase 2a), drawn by the very components those pages use so
 * they look the same in both places:
 *
 *   - Teaching's "Next up" (`TeachingHero`), on Today;
 *   - CPD's hours card (`CmeHeroSummary`), on Me;
 *   - Admin's "Renew next" (`TodayRenewNextCard`), on Me;
 *   - Admin's renewals timeline (`ChecklistSummary`), on Me.
 *
 * Kept out of the dashboard's first load (`my-day-dashboard.tsx` imports this
 * file lazily). Each card only links out; nothing here changes a record. The
 * Roster shift card made this move earlier: it is My Day's headline card.
 */

/** A moved card keeps its own look; in edit mode it gains the dashboard's outline and Hide button. */
function MovedCard({
  title,
  testId,
  onHide,
  children,
}: {
  readonly title: string;
  readonly testId: string;
  readonly onHide?: () => void;
  readonly children: ReactNode;
}) {
  const editing = onHide !== undefined;
  return (
    <div
      data-testid={testId}
      className={cn(
        "relative min-w-0 rounded-xl",
        editing && "outline-2 -outline-offset-2 outline-dashed outline-[color:var(--dash-line-strong)]",
      )}
    >
      {children}
      {editing ? (
        <button
          type="button"
          onClick={onHide}
          aria-label={`Hide ${title}`}
          data-testid={`${testId}-hide`}
          className={cn(focusRing, "absolute -top-2 -right-2 grid size-12 place-items-center rounded-full")}
        >
          <span
            aria-hidden="true"
            className="grid size-6 place-items-center rounded-full bg-[color:var(--dash-ink)] text-[color:var(--dash-page)] forced-colors:border"
          >
            <X aria-hidden="true" className="size-icon-xs" />
          </span>
        </button>
      ) : null}
    </div>
  );
}

export function MyDayNextUpCard({
  session,
  sessions,
  now,
  today,
  onHide,
}: {
  readonly session: SessionSummary;
  /** Every session read, to tell "Nothing more today" from "No teaching today". */
  readonly sessions: readonly SessionSummary[];
  readonly now: Date;
  readonly today: string;
  readonly onHide?: () => void;
}) {
  const hero = heroModel(session, {
    now,
    today,
    teams: [],
    showTeam: false,
    attendance: [],
    joinUrl: null,
    calendar: false,
    hadToday: sessions.some((s) => s.status !== "cancelled" && perthDateOf(s.startsAt) === today),
  });
  // Only the actions that are plain links travel: check-in without a code and
  // "Add to calendar" need Teaching's own page, which the links open.
  const actions = hero.actions
    .filter((action) => action.href)
    .map((action) => (action.external || !action.href ? action : { ...action, href: withMyDayReturn(action.href) }));
  return (
    <MovedCard title="Next teaching" testId="my-day-next-up" onHide={onHide}>
      <TeachingHero {...hero} actions={actions} />
    </MovedCard>
  );
}

export function MyDayCpdHoursCard({
  year,
  today,
  loggedHours,
  targetHours,
  entries,
  closed,
  onHide,
}: {
  readonly year: number;
  readonly today: string;
  readonly loggedHours: number;
  readonly targetHours: number;
  readonly entries: readonly CmeEntry[];
  readonly closed: boolean;
  readonly onHide?: () => void;
}) {
  const router = useRouter();
  return (
    <MovedCard title="CPD hours" testId="my-day-cpd-hours" onHide={onHide}>
      <CmeHeroSummary
        year={year}
        today={today}
        loggedHours={loggedHours}
        targetHours={targetHours}
        entries={entries}
        closed={closed}
        onOpenDetail={() => router.push(withMyDayReturn("/cme"))}
      />
    </MovedCard>
  );
}

export function MyDayRenewNextCard({
  entries,
  now,
  today,
  onHide,
}: {
  readonly entries: readonly OnCallEntry[];
  readonly now: Date;
  readonly today: string;
  readonly onHide?: () => void;
}) {
  // A new job's start is Admin's own business; My Day shows the next renewal only.
  const item = useMemo(() => selectRenewNext(entries, undefined, now), [entries, now]);
  if (!item) return null;
  return (
    <MovedCard title="Renew next" testId="my-day-renew-next" onHide={onHide}>
      <TodayRenewNextCard item={item} ownEntries={entries} today={today} />
    </MovedCard>
  );
}

export function MyDayRenewalsTimelineCard({
  entries,
  now,
  onHide,
}: {
  readonly entries: readonly OnCallEntry[];
  readonly now: Date;
  readonly onHide?: () => void;
}) {
  const rows = useMemo(() => requirementChecklistRowsForJob(ADMIN_REQUIREMENTS_CATALOGUE, entries), [entries]);
  const counts = useMemo(() => requirementsRecordedCount(ADMIN_REQUIREMENTS_CATALOGUE, entries), [entries]);
  const notForThisJob = useMemo(
    () => requirementsNotForThisJob(ADMIN_REQUIREMENTS_CATALOGUE, entries).length,
    [entries],
  );
  return (
    <MovedCard title="Renewals timeline" testId="my-day-renewals-timeline" onHide={onHide}>
      <Link
        href={withMyDayReturn("/admin/renewals")}
        className={cn(focusRing, "block rounded-xl text-inherit no-underline")}
      >
        <ChecklistSummary
          rows={rows}
          recorded={counts.recorded}
          total={counts.total}
          notForThisJob={notForThisJob}
          now={now}
        />
      </Link>
    </MovedCard>
  );
}
