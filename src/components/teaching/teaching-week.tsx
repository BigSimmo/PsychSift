"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";

import { InformationPageShell } from "@/components/information-page-shell";
import { ModeActionButton } from "@/components/mode-kit/action-button";
import { ModeGroupedList } from "@/components/mode-kit/grouped-list";
import { ModeModuleSkeleton } from "@/components/mode-kit/module-skeleton";
import { ModeNotice } from "@/components/mode-kit/notice";
import { ModeStateLabel } from "@/components/mode-kit/state-label";
import { OnCallEntryEditor } from "@/components/on-call/on-call-entry-editor";
import { TeachingCalendarSheet } from "@/components/teaching/teaching-calendar-sheet";
import { addDays, mondayOf, perthDateKey, perthTime, shortDayLabel } from "@/components/teaching/teaching-dates";
import {
  DayRail,
  LiveLabel,
  SessionTimeline,
  TeachingContextBar,
  TeachingSwitch,
} from "@/components/teaching/teaching-modules";
import { TeachingRow } from "@/components/teaching/teaching-row";
import { TeachingSignInNotice } from "@/components/teaching/teaching-sign-in";
import { TeachingStateNotice } from "@/components/teaching/teaching-states";
import {
  ALL_TEAMS,
  dayGroups,
  relocatedEntryId,
  sessionsForTeam,
  teamInCalendar,
  weekDays,
  type WeekFilter,
} from "@/components/teaching/teaching-view-model";
import { useHandbookTeaching } from "@/components/teaching/use-handbook-teaching";
import { useRelocatedTeaching } from "@/components/teaching/use-relocated-teaching";
import { useTeachingNow } from "@/components/teaching/use-teaching-now";
import { useTeachingWeek, type TeachingWeekState } from "@/components/teaching/use-teaching-week";
import { Button } from "@/components/ui/button";
import { onCallEntryIsEditable, type OnCallEntry } from "@/lib/on-call/entry-model";
import { useTeachingDemoMode } from "@/components/teaching/use-teaching-sample";

/*
 * Week: the day rail, Whole service / Presenting, every remaining day grouped
 * (a past day comes back when tapped on the rail), Add to my calendar, the
 * reader's "Teaching list (from On Call)" (edited in On Call's own editor) and
 * the service handbook's published teaching entries.
 */
const FILTERS = [
  { value: "all", label: "Whole service" },
  { value: "presenting", label: "Presenting" },
] as const;

/** Wide screens only (U4 Step 9): a row opens the session beside the list instead of navigating. */
export type WeekSidePanel = (panel: {
  occurrenceId: string;
  ids: readonly string[];
  select: (id: string) => void;
  close: () => void;
}) => ReactNode;

export function TeachingWeekScreen({
  demoMode: serverDemoMode,
  sidePanel,
}: {
  demoMode: boolean;
  sidePanel?: WeekSidePanel;
}) {
  const demoMode = useTeachingDemoMode(serverDemoMode);
  const now = useTeachingNow();
  const today = now ? perthDateKey(now) : null;
  const [chosenMonday, setChosenMonday] = useState<string | null>(null);
  const monday = chosenMonday ?? (today ? mondayOf(today) : null);
  const range = useMemo(() => (monday ? { from: monday, to: addDays(monday, 6) } : null), [monday]);
  const view = useTeachingWeek(range, { demoMode }, now);
  return (
    <InformationPageShell width="narrow" gap={false} testId="teaching-week">
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
        <h1 className="sr-only">Week</h1>
        {today && monday ? (
          <WeekBody view={view} today={today} monday={monday} onMonday={setChosenMonday} sidePanel={sidePanel} />
        ) : (
          <ModeModuleSkeleton rows={4} eyebrow />
        )}
      </div>
    </InformationPageShell>
  );
}

function WeekBody({
  view,
  today,
  monday,
  onMonday,
  sidePanel,
}: {
  view: TeachingWeekState;
  today: string;
  monday: string;
  onMonday: (monday: string) => void;
  sidePanel?: WeekSidePanel;
}) {
  const [team, setTeam] = useState(ALL_TEAMS);
  const [filter, setFilter] = useState<WeekFilter>("all");
  const [day, setDay] = useState<string | null>(null);
  const [pastShown, setPastShown] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ entry: OnCallEntry | null } | null>(null);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const live = view.demo === "off";
  const ready = live && view.status === "ready";
  const relocated = useRelocatedTeaching(ready);
  const handbook = useHandbookTeaching(ready);
  const sunday = addDays(monday, 6);

  function goToWeek(next: string) {
    setDay(null);
    setPastShown(null);
    setSelected(null);
    onMonday(next);
  }

  function moveWeek(days: number) {
    goToWeek(addDays(monday, days));
  }

  const thisMonday = mondayOf(today);
  const current = monday === thisMonday;
  // One compact row: icon-only arrows (48px tap areas) either side of the dates, and a way back to this week.
  const nav = (
    <div className="flex items-center justify-between gap-1" data-testid="teaching-week-nav">
      <ModeActionButton icon={ChevronLeft} label="Previous week" onClick={() => moveWeek(-7)} />
      <div className="flex min-w-0 flex-wrap items-center justify-center gap-x-1">
        <span className="nums text-center text-sm font-normal text-[color:var(--text-heading)]">
          {`${shortDayLabel(monday)} – ${shortDayLabel(sunday)}`}
        </span>
        {current ? null : (
          <Button variant="ghost" size="sm" onClick={() => goToWeek(thisMonday)}>
            This week
          </Button>
        )}
      </div>
      <ModeActionButton icon={ChevronRight} label="Next week" onClick={() => moveWeek(7)} />
    </div>
  );

  if (view.status === "signed-out") return <TeachingSignInNotice />;
  if (view.status === "offline" || view.status === "error" || view.status === "setup")
    return (
      <>
        {nav}
        <TeachingStateNotice state={view.status} onRetry={view.retry} />
      </>
    );
  const week = view.week;
  if (
    view.status === "ready" &&
    week &&
    week.teams.length === 0 &&
    week.relocated.length === 0 &&
    week.sessions.length === 0
  )
    return (
      <div className="grid gap-3">
        <TeachingStateNotice state="no-team" />
        <ModeNotice>
          <Link
            href="/teaching/whats-on"
            className="inline-flex min-h-12 items-center font-semibold text-[color:var(--clinical-accent)] underline-offset-2 hover:underline"
            data-testid="teaching-week-whats-on"
          >
            See what&apos;s on across services
          </Link>
        </ModeNotice>
      </div>
    );
  if (view.status !== "ready" || !week)
    return (
      <>
        {nav}
        <ModeModuleSkeleton rows={4} eyebrow />
      </>
    );

  const teamValue = team === ALL_TEAMS || week.teams.some((t) => t.id === team) ? team : ALL_TEAMS;
  const context = {
    teams: week.teams,
    attendance: week.attendance,
    showTeam: teamValue === ALL_TEAMS && week.teams.length > 1,
  };
  const all = sessionsForTeam(week.sessions, teamValue);
  const sessions = filter === "presenting" ? all.filter((s) => s.isPresenter) : all;
  // Every remaining day; a past day only once it has been tapped on the rail. A past week shows whole.
  const shown = sessions.filter((s) => {
    const key = perthDateKey(s.startsAt);
    return key >= today || key === pastShown || sunday < today;
  });
  const groups = dayGroups(shown, today, context).map((group) => ({
    ...group,
    rows: sidePanel
      ? group.rows.map((row) => (row.href ? { ...row, href: null, onSelect: () => setSelected(row.id) } : row))
      : group.rows,
  }));
  const panelIds = groups.flatMap((group) =>
    group.rows.filter((row) => row.onSelect && !row.cancelled).map((row) => row.id),
  );
  const inCalendar = week.teams.some(teamInCalendar);

  function pickDay(key: string) {
    setDay(key);
    if (key < today) setPastShown(key);
    window.requestAnimationFrame(() => document.getElementById(`day-${key}`)?.scrollIntoView?.({ block: "start" }));
  }

  function refresh() {
    relocated.reload();
    view.retry();
  }

  const list = (
    <>
      <DayRail
        days={weekDays(monday, sessions, today)}
        value={day ?? (today >= monday && today <= sunday ? today : monday)}
        onChange={pickDay}
        label="Days this week"
      />
      <TeachingSwitch value={filter} onChange={setFilter} options={FILTERS} label="Show" />
      {groups.length > 0 ? (
        <SessionTimeline groups={groups} testId="teaching-week-list" />
      ) : (
        <ModeNotice>
          <span className="grid gap-2">
            <span>
              {filter === "presenting"
                ? "You're not presenting this week."
                : current
                  ? "No more sessions this week."
                  : "No sessions this week."}
            </span>
            {filter !== "presenting" ? (
              <Link
                href="/teaching/whats-on"
                className="inline-flex min-h-12 items-center font-semibold text-[color:var(--clinical-accent)] underline-offset-2 hover:underline"
                data-testid="teaching-week-whats-on"
              >
                See what&apos;s on across services
              </Link>
            ) : null}
          </span>
        </ModeNotice>
      )}
    </>
  );

  return (
    <>
      <TeachingContextBar
        teams={week.teams}
        value={teamValue}
        onChange={setTeam}
        demoTag={!live || week.teams.some((t) => t.isDemo)}
      />
      {nav}
      {sidePanel && selected ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
          <div className="grid content-start gap-3">{list}</div>
          <aside aria-label="Session">
            {sidePanel({ occurrenceId: selected, ids: panelIds, select: setSelected, close: () => setSelected(null) })}
          </aside>
        </div>
      ) : (
        list
      )}
      {live ? (
        <>
          <ModeGroupedList testId="teaching-calendar">
            <TeachingRow
              onClick={() => setCalendarOpen(true)}
              title="Add to my calendar"
              meta={
                inCalendar ? (
                  <LiveLabel freshKey="in-sync" className="text-xs text-[color:var(--text-muted)]">
                    In sync
                  </LiveLabel>
                ) : (
                  <ModeStateLabel tone="muted">Not added</ModeStateLabel>
                )
              }
            />
          </ModeGroupedList>
          <ModeGroupedList eyebrow="Teaching list (from On Call)" id="teaching-relocated" testId="teaching-relocated">
            {sessionsForTeam(week.relocated, ALL_TEAMS).map((s) => {
              const entry = relocated.entries.get(relocatedEntryId(s.occurrenceId));
              const date = shortDayLabel(perthDateKey(s.startsAt));
              const when = s.allDay ? date : `${date} · ${perthTime(s.startsAt)}`;
              return (
                <TeachingRow
                  key={s.occurrenceId}
                  title={s.title}
                  subtitle={[when, s.venue].filter(Boolean).join(" · ")}
                  onClick={entry && onCallEntryIsEditable(entry) ? () => setEditor({ entry }) : undefined}
                />
              );
            })}
            <TeachingRow title="Add to the list" onClick={() => setEditor({ entry: null })} />
          </ModeGroupedList>
          {week.relocatedUnavailable ? (
            <ModeNotice tone="warning">On Call teaching list couldn&apos;t load.</ModeNotice>
          ) : null}
          {handbook.failed ? (
            <ModeNotice>Your service handbook&apos;s teaching entries couldn&apos;t load.</ModeNotice>
          ) : null}
          {handbook.items.length > 0 ? (
            <ModeGroupedList eyebrow="From your service's handbook" id="teaching-handbook" testId="teaching-handbook">
              {handbook.items.map((item) => (
                <TeachingRow
                  key={item.id}
                  title={item.title}
                  subtitle={item.source ? `${item.serviceName} · ${item.source.label}` : item.serviceName}
                  externalHref={item.source?.url}
                />
              ))}
            </ModeGroupedList>
          ) : null}
          <TeachingCalendarSheet
            open={calendarOpen}
            onClose={() => setCalendarOpen(false)}
            teams={week.teams}
            onChanged={view.retry}
          />
          <OnCallEntryEditor
            open={editor !== null}
            onClose={() => setEditor(null)}
            section="education"
            entry={editor?.entry ?? null}
            onSaved={() => {
              setEditor(null);
              refresh();
            }}
            onDeleted={() => {
              setEditor(null);
              refresh();
            }}
          />
        </>
      ) : null}
    </>
  );
}
