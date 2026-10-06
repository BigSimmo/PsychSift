"use client";

import { useMemo, type ReactNode } from "react";

import { MyDayDashboard, type MyDaySampleExtras } from "@/components/my-day/my-day-dashboard";
import type { MyDayDashboardSources } from "@/components/my-day/use-my-day-dashboard-sources";
import type { MyShift } from "@/components/roster/use-roster-shifts";
import type { AdminHelpItem } from "@/lib/admin/help-items";
import type { MyDayPageId } from "@/lib/my-day/dashboard";
import type { RenewalRow } from "@/lib/my-day/figures";
import { mergeMyDayItems, myDaySeverityForDue } from "@/lib/my-day/merge";
import type { MyDayItem } from "@/lib/my-day/model";
import { withMyDayReturn } from "@/lib/my-day/return-link";
import type { ShiftKind } from "@/lib/roster/shift-kind";
import { addDaysToDate, formatPerthDay } from "@/lib/roster/shifts/perth-time";
import type { SessionSummary } from "@/lib/teaching/model";

/**
 * The signed-out sample of My Day: a whole invented day, built in the browser
 * around today's date, so a visitor sees every card filled before signing in.
 *
 * Loaded on demand (the page imports this module dynamically, and only for a
 * signed-out visitor), so it adds nothing to a signed-in reader's first load.
 *
 * Nothing here is read from or sent to a server, and nothing is stored: the
 * quick note is hidden and "Later" lasts only while the page is open. Every
 * name, place and number is plainly invented ("Demo ..."); there are no
 * patients, no patient labels, and calls are counts only.
 */

export interface MyDaySampleData {
  readonly items: readonly MyDayItem[];
  readonly renewals: readonly RenewalRow[];
  readonly sources: MyDayDashboardSources;
  readonly extras: MyDaySampleExtras;
  readonly checked: readonly string[];
}

const WORKPLACE = "Demo metro psychiatry";
const NO_HELP: readonly AdminHelpItem[] = [];

/** An ISO instant for a Perth wall-clock time on a Perth date. */
function perthAt(date: string, time: string): string {
  return `${date}T${time}:00+08:00`;
}

function shift(id: string, date: string, kind: ShiftKind, start: string, endDate: string, end: string): MyShift {
  return {
    id: `sample-shift-${id}`,
    startsAt: perthAt(date, start),
    endsAt: perthAt(endDate, end),
    title: kind === "on_call" ? "On call" : kind === "night" ? "Night" : "Day",
    location: null,
    sourceUid: null,
    kind,
    source: "manual",
    seriesId: null,
    workplace: WORKPLACE,
  };
}

function sampleShifts(today: string): MyShift[] {
  const day = (offset: number) => addDaysToDate(today, offset);
  const dayShift = (offset: number) => shift(`d${offset}`, day(offset), "day", "08:00", day(offset), "17:00");
  return [
    ...[-13, -12, -11, -9, -8, -6, -5, -3].map(dayShift),
    shift("n-2", day(-2), "night", "21:00", day(-1), "08:00"),
    // Tonight: on call from 17:00 to 08:30 tomorrow, the hero's shift.
    shift("oc0", today, "on_call", "17:00", day(1), "08:30"),
    ...[2, 3, 4, 6, 7, 9, 10, 11].map(dayShift),
    shift("oc8", day(8), "on_call", "17:00", day(9), "08:30"),
  ];
}

function session(
  id: string,
  date: string,
  start: string,
  end: string,
  title: string,
  venue: string,
  isPresenter: boolean,
): SessionSummary {
  return {
    // A well-formed id that no programme holds, so Teaching's session page answers
    // a signed-out visitor with its own sign-in prompt rather than "no longer in the programme".
    occurrenceId: `00000000-0000-4000-8000-${id}`,
    serviceId: "sample-teaching",
    title,
    startsAt: perthAt(date, start),
    endsAt: perthAt(date, end),
    venue,
    hasJoinLink: false,
    status: "scheduled",
    isPresenter,
    source: "teaching",
  };
}

function sampleItems(today: string, now: Date): MyDayItem[] {
  const due = (offset: number) => addDaysToDate(today, offset);
  const dated = (item: Omit<MyDayItem, "severity">): MyDayItem => ({
    ...item,
    severity: myDaySeverityForDue(item.due, now),
  });
  const cutoff = due(5);
  return mergeMyDayItems([
    [
      {
        id: "sample:on-call:contacts",
        mode: "on-call",
        title: "Check the demo ward contacts",
        detail: "Not checked for 90 days",
        due: null,
        severity: "info",
        href: "/on-call",
      },
    ],
    [
      dated({
        id: "sample:roster:cutoff",
        mode: "roster",
        title: `Next roster closes ${formatPerthDay(cutoff)}. Add dates you can't work.`,
        due: cutoff,
        href: "/roster",
      }),
    ],
    [
      dated({
        id: "sample:cme:routine",
        mode: "cme",
        title: "Demo journal club",
        detail: "Routine due",
        due: due(-18),
        href: "/cme",
      }),
      {
        id: "sample:cme:drafts",
        mode: "cme",
        title: "Finish 2 CPD drafts",
        due: null,
        severity: "info",
        href: "/cme",
      },
    ],
    [
      {
        id: "sample:teaching:review",
        mode: "teaching",
        title: "Review & log 2 sessions",
        detail: "Attended, not yet in your CPD log",
        due: null,
        severity: "info",
        href: "/teaching",
      },
    ],
    [
      dated({
        id: "sample:my-work:life-support",
        mode: "my-work",
        title: "Demo life support course",
        detail: "Date has passed",
        due: due(-12),
        href: "/admin/renewals",
      }),
      dated({
        id: "sample:my-work:registration",
        mode: "my-work",
        title: "Demo registration renewal",
        detail: "Recorded date",
        due: due(52),
        href: "/admin/renewals",
      }),
    ],
  ]).map((item) => ({ ...item, href: withMyDayReturn(item.href) }));
}

/** CPD hours by month, January first, up to and including this month. */
const MONTHLY_CPD: readonly number[] = [4, 3, 5, 2, 4, 3, 5, 3, 3, 4, 3, 2];

function sampleCpd(today: string): MyDayDashboardSources["cpd"] {
  const month = Number(today.slice(5, 7)) - 1;
  const byMonth = MONTHLY_CPD.map((hours, index) => (index <= month ? hours : 0));
  const loggedHours = byMonth.reduce((sum, hours) => sum + hours, 0);
  const reviewing = Math.floor(loggedHours * 0.28);
  const measuring = Math.floor(loggedHours * 0.28);
  return {
    status: "ready",
    year: Number(today.slice(0, 4)),
    loggedHours,
    targetHours: 50,
    byCategory: { educational: loggedHours - reviewing - measuring, reviewing, measuring },
    // No per-type targets: the sample states no requirement of its own.
    categoryTargets: { educational: null, reviewing: null, measuring: null },
    byMonth,
    sample: true,
  };
}

/** The whole sample, built around the page clock so it always reads as today. */
export function buildMyDaySample(today: string, now: Date): MyDaySampleData {
  const day = (offset: number) => addDaysToDate(today, offset);
  const ahead = [
    session("000000000001", today, "14:00", "15:00", "Registrar teaching: agitation", "Demo seminar room 3", false),
    session("000000000002", day(5), "12:30", "13:30", "Demo journal club", "Demo library", false),
    session("000000000003", day(12), "14:00", "15:00", "Lithium toxicity", "Demo seminar room 3", true),
    session("000000000004", day(19), "12:30", "13:30", "Demo grand round", "Demo lecture theatre", false),
  ];
  const hoursFromNow = (hours: number) => new Date(now.getTime() + hours * 3_600_000).toISOString();
  return {
    items: sampleItems(today, now),
    renewals: [
      { entryId: "sample-life-support", title: "Demo life support course", date: day(-12), href: "/admin/renewals" },
      { entryId: "sample-registration", title: "Demo registration renewal", date: day(52), href: "/admin/renewals" },
      { entryId: "sample-cpd-return", title: "Demo CPD annual return", date: day(95), href: "/admin/renewals" },
      { entryId: "sample-indemnity", title: "Demo indemnity cover", date: day(126), href: "/admin/renewals" },
    ],
    sources: {
      roster: { status: "ready", shifts: sampleShifts(today), sample: true },
      teaching: {
        status: "ready",
        sessions: ahead.filter((item) => item.startsAt.startsWith(today)),
        ahead,
        nextTalk: ahead.find((item) => item.isPresenter) ?? null,
        sample: true,
      },
      cpd: sampleCpd(today),
      whosOn: {
        status: "ready",
        teamName: WORKPLACE,
        colleagues: [
          { id: "sample-a", name: "Dr Demo A", grade: "Consultant", endsAt: hoursFromNow(9) },
          { id: "sample-b", name: "Dr Demo B", grade: "Registrar", endsAt: hoursFromNow(3) },
          { id: "sample-c", name: "Dr Demo C", grade: "Resident", endsAt: hoursFromNow(5) },
        ],
      },
    },
    extras: {
      calls: { total: 2, open: 1 },
      // No phone links: tapping a sample number opens Admin's Help, never the dialler.
      pinnedNumbers: [
        { key: "sample-switch", title: "Switch", display: "Demo 9000", tel: null, href: "/admin/help" },
        { key: "sample-ed", title: "ED", display: "Demo 9123", tel: null, href: "/admin/help" },
        { key: "sample-pharmacy", title: "Pharmacy", display: "Demo 9456", tel: null, href: "/admin/help" },
        { key: "sample-security", title: "Security", display: "Demo 9777", tel: null, href: "/admin/help" },
      ],
    },
    checked: ["On Call", "Roster", "CPD", "Teaching", "Admin"],
  };
}

const noop = () => undefined;

/**
 * The sample dashboard, or the sample's full list when the page is at
 * `?view=all` (drawn by the page's own `renderFullList`, so both views match
 * the signed-in ones exactly).
 */
export function MyDaySampleDashboard({
  now,
  today,
  page,
  view,
  onShowAll,
  renderFullList,
}: {
  readonly now: Date;
  readonly today: string;
  readonly page: MyDayPageId;
  readonly view: "dashboard" | "all";
  readonly onShowAll: () => void;
  readonly renderFullList: (items: readonly MyDayItem[], checked: readonly string[]) => ReactNode;
}) {
  const sample = useMemo(() => buildMyDaySample(today, now), [today, now]);
  if (view === "all") return <>{renderFullList(sample.items, sample.checked)}</>;
  return (
    <MyDayDashboard
      now={now}
      today={today}
      items={sample.items}
      renewals={sample.renewals}
      helpItems={NO_HELP}
      sources={sample.sources}
      checked={sample.checked}
      editing={false}
      page={page}
      onShowAll={onShowAll}
      onRetry={noop}
      sample={sample.extras}
    />
  );
}
