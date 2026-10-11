"use client";

import dynamic from "next/dynamic";
import { CalendarClock, CalendarDays, CalendarPlus, ChevronLeft, ChevronRight, Network } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { focusRing } from "@/components/card-recipes";
import { InformationPageShell } from "@/components/information-page-shell";
import { ModeBandAction } from "@/components/mode-band/mode-band";
import { WorkGlassButton, WorkTag } from "@/components/mode-kit/work";
import { ModeModuleSkeleton } from "@/components/mode-kit/module-skeleton";
import { focusOnCallEntryFromHash, onCallEntryAnchorId } from "@/components/on-call/on-call-page-anchors";
import { useRosterShifts } from "@/components/roster/use-roster-shifts";
import { clashSummary, rosterClashes, type RosterClash } from "@/components/teaching/roster-clash";
import {
  T5Empty,
  T5Icon,
  T5Link,
  T5List,
  T5LiveDot,
  T5Note,
  T5Page,
  T5Row,
  T5Section,
  T5Segments,
  T5Time,
} from "@/components/teaching/t5-kit";
import { TeachingCalendarSheet } from "@/components/teaching/teaching-calendar-sheet";
import { addDays, mondayOf, openingMondayOf, perthDateKey, perthTime } from "@/components/teaching/teaching-dates";
import { TeachingContextBar } from "@/components/teaching/teaching-modules";
import { withUnit } from "@/components/teaching/teaching-number";
import type { SessionSummaryRead } from "@/components/teaching/teaching-reads";
import { TeachingSignInNotice } from "@/components/teaching/teaching-sign-in";
import { TeachingStateNotice } from "@/components/teaching/teaching-states";
import {
  dayHeading,
  defaultWeekFilter,
  mineSessions,
  openFromOtherServices,
  otherServiceMeta,
  otherServiceSessions,
  sessionsOn,
  stripDays,
  weekCountLabel,
  weekDayKeys,
  weekRow,
  weekTitle,
} from "@/components/teaching/this-week-model";
import {
  ALL_TEAMS,
  relocatedEntryId,
  sessionHref,
  sessionsForTeam,
  teamInCalendar,
  type WeekFilter,
} from "@/components/teaching/teaching-view-model";
import { useHandbookTeaching } from "@/components/teaching/use-handbook-teaching";
import { useLastLoaded, useOnline, type LoadedWeek } from "@/components/teaching/use-teaching-online";
import { useRelocatedTeaching } from "@/components/teaching/use-relocated-teaching";
import { useTeachingNow } from "@/components/teaching/use-teaching-now";
import { useTeachingResource } from "@/components/teaching/use-teaching-resource";
import {
  useSignedOutSampleRead,
  useTeachingDemoMode,
  useTeachingSignedOut,
} from "@/components/teaching/use-teaching-sample";
import { useTeachingWeek, type TeachingWeekState } from "@/components/teaching/use-teaching-week";
import { useWeekAdd, WeekAddNotice, WeekToggle } from "@/components/teaching/week-add-toggle";
import { cn } from "@/components/ui-primitives";
import { onCallEntryIsEditable, type OnCallEntry } from "@/lib/on-call/entry-model";
import { useAuthSession } from "@/lib/supabase/client";
import type { WhatsOnRow } from "@/lib/teaching/model";

/** The On Call entry editor loads on first open and then stays mounted, so its Sheet still returns focus on close. */
const OnCallEntryEditor = dynamic(
  () => import("@/components/on-call/on-call-entry-editor").then((module) => module.OnCallEntryEditor),
  { ssr: false },
);

/*
 * Week (work-mode redesign, owner request 6 Oct 2026): the week's calendar card (the dates with
 * previous and next, a day rail, and Mine, Whole service or Other services), then every session day
 * by day with a tag for what matters (checked in, you present, moved, a roster clash), then sessions
 * other services opened to you, your On Call teaching list and your service handbook's teaching. The
 * session on now and the next one for you live on Today.
 *
 * Other services (owner-approved mock-up, Oct 2026) took over the separate What's on page: the same
 * read of sessions other services opened to the reader, listed under Week's own dates and day strip,
 * each with the plus that adds it to the reader's week. `/teaching/week?view=other` opens on it, and
 * `/teaching/whats-on` forwards there.
 *
 * Roster clashes (ideas 12) read the reader's own shifts through Roster's hook, read only, when
 * signed in; the demo and the signed-out sample never call it.
 *
 * Nothing of the week is kept on the phone. If the connection drops after the week has loaded, the
 * page keeps showing that read and says the time it loaded, rather than pretending to be current.
 * Nothing is kept on the phone at all: the Mine, Whole service or Other services choice lasts for
 * this visit only.
 */

// "Mine" comes first. Sessions carry no training-level field (only What's on rows do), so Mine is the
// sessions the reader presents; see `mineSessions`. Below 390px the longer two shorten, so all three
// fit a 320px phone; their full words stay the buttons' names.
type ThisWeekFilter = WeekFilter | "other";
const FILTERS: readonly { value: ThisWeekFilter; label: string; short?: string }[] = [
  { value: "presenting", label: "Mine" },
  { value: "all", label: "Whole service", short: "Service" },
  { value: "other", label: "Other services", short: "Other" },
];

/** `?view=other` on /teaching/week opens on Other services; What's on's old address forwards to it. */
const OTHER_SERVICES_VIEW = "other";

/**
 * The last Mine, Whole service or Other services choice, kept in memory for this visit only, so it
 * survives moving between Teaching pages. It is never written to the device: Teaching allows one
 * device key only (What's on's level, see teaching-search-privacy.test.ts), and a convenience is not
 * worth a second.
 */
let rememberedFilter: ThisWeekFilter | null = null;

function storedFilter(): ThisWeekFilter | null {
  return rememberedFilter;
}

/** The address says Other services only while it is the chosen filter, so a reload opens what was showing. */
function syncViewParam(value: ThisWeekFilter) {
  const url = new URL(window.location.href);
  if (value === "other") url.searchParams.set("view", OTHER_SERVICES_VIEW);
  else url.searchParams.delete("view");
  if (url.href !== window.location.href) window.history.replaceState(null, "", url);
}

function storeFilter(value: ThisWeekFilter) {
  rememberedFilter = value;
}

type WhatsOnRead = { sessions: WhatsOnRow[] };
const NO_CLASHES: ReadonlyMap<string, RosterClash> = new Map();

/**
 * Remounts on sign-in, sign-out, account switch and demo change, like TeachingAccountPage, so the last
 * week kept for offline reading never shows one account's sessions to another.
 */
export function TeachingThisWeek({
  demoMode: serverDemoMode,
  week = null,
  view = null,
}: {
  demoMode: boolean;
  /** A Perth date (YYYY-MM-DD) whose week opens first, so a link to a later session lands on it. */
  week?: string | null;
  /** `?view=` from the address: "other" opens on Other services. Anything else is ignored. */
  view?: string | null;
}) {
  const auth = useAuthSession();
  const demoMode = useTeachingDemoMode(serverDemoMode);
  return (
    <ThisWeekScreen
      key={`${auth.authEpoch}:${demoMode}`}
      demoMode={demoMode}
      week={week}
      openOther={view === OTHER_SERVICES_VIEW}
    />
  );
}

function ThisWeekScreen({ demoMode, week, openOther }: { demoMode: boolean; week: string | null; openOther: boolean }) {
  const signedOut = useTeachingSignedOut();
  const now = useTeachingNow();
  const today = now ? perthDateKey(now) : null;
  const [chosenMonday, setChosenMonday] = useState<string | null>(() => (week ? mondayOf(week) : null));
  // On a Sunday the page opens on the coming week (`openingMondayOf`).
  const monday = chosenMonday ?? (today ? openingMondayOf(today) : null);
  const range = useMemo(() => (monday ? { from: monday, to: addDays(monday, 6) } : null), [monday]);
  const view = useTeachingWeek(range, { demoMode }, now);
  const online = useOnline();
  const loaded = useLastLoaded(view, monday, now);

  // Sessions other services have opened to this reader. Signed out, the made-up week is built here.
  const built = useSignedOutSampleRead<WhatsOnRead>(signedOut, monday, async () => {
    const { demoWhatsOnSessions } = await import("@/lib/teaching/demo-programme");
    return { sessions: demoWhatsOnSessions({ from: monday!, to: addDays(monday!, 6) }, new Date()) };
  });
  const whatsOn = useTeachingResource<WhatsOnRead>(
    monday && !signedOut ? `/api/teaching/whats-on?weekStart=${monday}` : null,
    signedOut ? built : undefined,
  );

  return (
    <InformationPageShell width="narrow" gap={false} testId="teaching-this-week">
      <T5Page>
        <h1 className="sr-only">Week</h1>
        {now && today && monday ? (
          <ThisWeekBody
            view={view}
            loaded={loaded}
            online={online}
            now={now}
            today={today}
            monday={monday}
            onMonday={setChosenMonday}
            whatsOn={whatsOn.status === "ready" ? whatsOn.data : null}
            whatsOnFailed={whatsOn.status === "error" || whatsOn.status === "offline" || whatsOn.status === "setup"}
            retryWhatsOn={whatsOn.retry}
            whatsOnSample={signedOut}
            openOther={openOther}
          />
        ) : (
          <ModeModuleSkeleton rows={4} twoLine eyebrow />
        )}
      </T5Page>
    </InformationPageShell>
  );
}

/** Reads the reader's own shifts only while mounted, so the demo and the sample never ask Roster. */
function RosterClashRead({
  sessions,
  children,
}: {
  sessions: readonly SessionSummaryRead[];
  children: (clashes: ReadonlyMap<string, RosterClash>) => ReactNode;
}) {
  const roster = useRosterShifts();
  const shifts = roster.status === "ready" && !roster.sample && !roster.demoMode ? roster.shifts : null;
  const clashes = useMemo(() => (shifts ? rosterClashes(sessions, shifts) : NO_CLASHES), [sessions, shifts]);
  return <>{children(clashes)}</>;
}

function ThisWeekBody({
  view,
  loaded,
  online,
  now,
  today,
  monday,
  onMonday,
  whatsOn,
  whatsOnFailed,
  retryWhatsOn,
  whatsOnSample,
  openOther,
}: {
  view: TeachingWeekState;
  loaded: LoadedWeek | null;
  online: boolean;
  now: Date;
  today: string;
  monday: string;
  onMonday: (monday: string | null) => void;
  whatsOn: WhatsOnRead | null;
  whatsOnFailed: boolean;
  retryWhatsOn: () => void;
  /** The signed-out sample: its plus says the sample saves nothing instead of writing. */
  whatsOnSample: boolean;
  /** The address asked for Other services (`?view=other`). */
  openOther: boolean;
}) {
  const [team, setTeam] = useState(ALL_TEAMS);
  const [chosenFilter, setChosenFilter] = useState<ThisWeekFilter | null>(() => {
    if (openOther) storeFilter("other");
    return storedFilter();
  });
  // A later link to ?view=other while Week is already open (Today's "Open from other services") switches
  // to it too: the address changed, so the page follows it, during render rather than in an effect.
  const [seenOpenOther, setSeenOpenOther] = useState(openOther);
  if (openOther !== seenOpenOther) {
    setSeenOpenOther(openOther);
    if (openOther) {
      setChosenFilter("other");
      storeFilter("other");
    }
  }
  const weekAdd = useWeekAdd(whatsOnSample, view.retry);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [editor, setEditor] = useState<{ entry: OnCallEntry | null } | null>(null);
  const [editorMounted, setEditorMounted] = useState(false);
  if (editor !== null && !editorMounted) setEditorMounted(true);
  const live = view.demo === "off";
  const ready = live && view.status === "ready";
  const relocated = useRelocatedTeaching(ready);
  const handbook = useHandbookTeaching(ready);
  const thisMonday = openingMondayOf(today);
  const current = monday === thisMonday;
  // Links from My Day, On Call and work search end in #on-call-entry-…; the rows exist only once the
  // week has loaded, so the browser's own jump has already missed them.
  const relocatedCount = view.status === "ready" ? (view.week?.relocated.length ?? 0) : 0;
  useEffect(() => {
    if (relocatedCount > 0) focusOnCallEntryFromHash();
  }, [relocatedCount]);

  if (view.status === "signed-out") return <TeachingSignInNotice />;
  // A read that failed with nothing loaded before: say so plainly. With an earlier read, keep it.
  const stale = !online || view.status === "offline" || view.status === "error";
  const week = view.status === "ready" ? view.week : stale ? (loaded?.week ?? null) : null;
  if (!week) {
    if (view.status === "offline" || view.status === "error" || view.status === "setup")
      return <TeachingStateNotice state={view.status} onRetry={view.retry} />;
    return <ModeModuleSkeleton rows={4} twoLine eyebrow />;
  }
  function chooseFilter(value: ThisWeekFilter) {
    setChosenFilter(value);
    storeFilter(value);
    syncViewParam(value);
  }

  // The card under the week switches the filter in place, and brings the week's own card into view.
  function showOtherServices() {
    chooseFilter("other");
    document.getElementById("teaching-week-card")?.scrollIntoView?.({ block: "start" });
  }

  // A reader in no teaching service has nothing under Mine or Whole service, but other services may
  // still have opened sessions to them, so Other services stays one tap away.
  if (
    chosenFilter !== "other" &&
    week.teams.length === 0 &&
    week.relocated.length === 0 &&
    week.sessions.length === 0 &&
    !week.relocatedUnavailable
  )
    return (
      <>
        <TeachingStateNotice state="no-team" />
        <T5List>
          <T5Row
            lead={<T5Icon icon={Network} />}
            title="Sessions open to you from other services"
            onClick={showOtherServices}
            testId="teaching-week-whats-on"
          />
        </T5List>
      </>
    );

  const teamValue = team === ALL_TEAMS || week.teams.some((t) => t.id === team) ? team : ALL_TEAMS;
  const showTeam = teamValue === ALL_TEAMS && week.teams.length > 1;
  const everything = sessionsForTeam([...week.sessions, ...week.relocated], teamValue);
  // A remembered "Mine" never opens a week where the reader presents nothing: that would be empty.
  const remembered = chosenFilter === "presenting" && mineSessions(everything).length === 0 ? null : chosenFilter;
  const filter = remembered ?? defaultWeekFilter(everything);
  const sessions = filter === "presenting" ? mineSessions(everything) : everything;
  const context = { teams: week.teams, attendance: week.attendance, showTeam, now };
  const otherRows = whatsOn ? otherServiceSessions(whatsOn.sessions) : [];
  // The dates and the day strip follow what the list shows, so Other services' weekend shows when it has one.
  const shown = filter === "other" ? otherRows : sessions;
  const days = weekDayKeys(monday, shown);
  const partial = week.relocatedUnavailable;
  // The count under the week follows adds and removes made here before the next read.
  const others = whatsOn
    ? openFromOtherServices(whatsOn.sessions.map((row) => ({ ...row, inMyWeek: weekAdd.added(row) })))
    : null;
  const otherNames = whatsOn
    ? [...new Set(whatsOn.sessions.filter((row) => !row.own).map((row) => row.teamName))].join(", ")
    : "";
  const offlineAt = stale && loaded ? perthTime(loaded.at.toISOString()) : null;
  const calendarLabel = week.teams.some(teamInCalendar) ? "In your calendar" : "Add to calendar";

  function retry() {
    relocated.reload();
    view.retry();
  }

  const otherList = (
    <>
      <WeekAddNotice notice={weekAdd.notice} />
      <T5Section
        label={
          whatsOn
            ? weekCountLabel(otherRows, false, current ? "This week" : "That week")
            : current
              ? "This week"
              : "That week"
        }
        right={otherRows.length > 0 ? "Tap plus to add to your week" : undefined}
        testId="teaching-week-other"
      >
        {whatsOn === null ? (
          whatsOnFailed ? (
            <T5List>
              <T5Row
                lead={<T5Icon icon={Network} />}
                title="Sessions open to you from other services"
                meta="Could not check just now"
                end={<T5Link onClick={retryWhatsOn}>Try again</T5Link>}
              />
            </T5List>
          ) : (
            <ModeModuleSkeleton rows={3} twoLine />
          )
        ) : otherRows.length === 0 ? (
          <T5Empty>{`No other service has opened a session to you for ${weekTitle(days[0], days[days.length - 1])}.`}</T5Empty>
        ) : (
          days.map((key) => {
            const onDay = sessionsOn(otherRows, key);
            if (onDay.length === 0) return null;
            return (
              <div key={key} id={`day-${key}`} tabIndex={-1} className="grid scroll-mt-32 gap-y-2.25">
                <h3
                  className={cn("work-label m-0 min-h-5 px-0.5", key === today && "text-[color:var(--mode-identity)]!")}
                >
                  {dayHeading(key, today)}
                </h3>
                <T5List testId="teaching-week-other-list">
                  {onDay.map((row) => {
                    const cancelled = row.status === "cancelled";
                    const live =
                      !cancelled && Date.parse(row.startsAt) <= now.getTime() && now.getTime() < Date.parse(row.endsAt);
                    const past = Date.parse(row.endsAt) <= now.getTime();
                    return (
                      <T5Row
                        key={row.occurrenceId}
                        lead={<T5Time time={row.allDay ? "All day" : perthTime(row.startsAt)} past={past} />}
                        title={cancelled ? <s>{row.title}</s> : row.title}
                        meta={
                          <>
                            {live ? <T5LiveDot /> : null}
                            {otherServiceMeta(row, now)}
                          </>
                        }
                        href={sessionHref(row)}
                        past={past}
                        testId={`teaching-week-other-row-${row.occurrenceId}`}
                        end={
                          <WeekToggle
                            title={row.title}
                            added={weekAdd.added(row)}
                            onToggle={() => void weekAdd.toggle(row)}
                          />
                        }
                      />
                    );
                  })}
                </T5List>
              </div>
            );
          })
        )}
      </T5Section>
      <T5Note>Organisers of each session see who checked in</T5Note>
    </>
  );

  const list = (clashes: ReadonlyMap<string, RosterClash>) => {
    const clashCount = sessions.filter(
      (s) => clashes.has(s.occurrenceId) && Date.parse(s.endsAt) > now.getTime(),
    ).length;
    return (
      <>
        {clashCount > 0 ? (
          <T5List testId="teaching-week-clashes">
            <T5Row
              lead={<T5Icon icon={CalendarClock} tone="amber" />}
              title={clashSummary(clashCount)}
              meta="From your roster · check before you go"
              href="/roster"
            />
          </T5List>
        ) : null}
        <T5Section
          label={weekCountLabel(sessions, partial, current ? "This week" : "That week")}
          right={
            live && !offlineAt ? (
              <T5Link onClick={() => setCalendarOpen(true)} testId="teaching-calendar">
                {calendarLabel}
              </T5Link>
            ) : null
          }
          testId="teaching-week-list"
        >
          {sessions.length === 0 ? (
            <T5Empty>
              {partial
                ? "None loaded. Sessions shared from On Call are missing. Try again."
                : filter === "presenting"
                  ? `You are not presenting from ${weekTitle(days[0], days[days.length - 1])}.`
                  : `No sessions are booked for ${weekTitle(days[0], days[days.length - 1])} yet. They appear here as soon as an organiser adds them.`}
            </T5Empty>
          ) : (
            days.map((key) => {
              const onDay = sessionsOn(sessions, key);
              if (onDay.length === 0) return null;
              return (
                <div key={key} id={`day-${key}`} tabIndex={-1} className="grid scroll-mt-32 gap-y-2.25">
                  <h3
                    className={cn(
                      "work-label m-0 min-h-5 px-0.5",
                      key === today && "text-[color:var(--mode-identity)]!",
                    )}
                  >
                    {dayHeading(key, today)}
                  </h3>
                  <T5List>
                    {onDay.map((session) => (
                      <WeekRow
                        key={session.occurrenceId}
                        session={session}
                        context={context}
                        clash={clashes.get(session.occurrenceId) ?? null}
                      />
                    ))}
                  </T5List>
                </div>
              );
            })
          )}
        </T5Section>
      </>
    );
  };

  return (
    <>
      {week.teams.length > 1 || !live ? (
        <TeachingContextBar
          teams={week.teams}
          value={teamValue}
          onChange={setTeam}
          demoTag={!live || week.teams.some((t) => t.isDemo)}
        />
      ) : null}
      {offlineAt ? (
        <T5Note icon="offline" tone="notice" testId="teaching-week-offline">
          {`No connection. Showing your week as loaded at ${offlineAt}. Changes made since then will not show.`}
        </T5Note>
      ) : null}
      {partial ? (
        <div className="grid gap-1">
          <T5Note icon="alert" tone="warning" testId="teaching-week-partial">
            Sessions shared from On Call did not load, so they are missing below.
          </T5Note>
          <span className="px-0.5">
            <T5Link onClick={retry}>Try again</T5Link>
          </span>
        </div>
      ) : null}
      <div id="teaching-week-card" className="work-card grid scroll-mt-32 gap-1 px-1.5 pt-1 pb-1.5">
        <WeekHeader
          first={days[0]}
          last={days[days.length - 1]}
          current={current}
          onPrevious={() => onMonday(addDays(monday, -7))}
          onNext={() => onMonday(addDays(monday, 7))}
          onThisWeek={() => onMonday(null)}
        />
        <DayStrip days={stripDays(days, shown, today)} today={today} />
        <T5Segments value={filter} options={FILTERS} onChange={chooseFilter} label="Show" />
      </div>
      {filter === "other" ? (
        otherList
      ) : live && !stale ? (
        <RosterClashRead sessions={sessions}>{list}</RosterClashRead>
      ) : (
        list(NO_CLASHES)
      )}
      {shown.length === 0 && !current && (filter !== "other" || whatsOn !== null) ? (
        <T5List>
          <T5Row lead={<T5Icon icon={CalendarDays} />} title="Back to this week" onClick={() => onMonday(null)} />
        </T5List>
      ) : null}
      {filter === "other" ? null : others !== null && others > 0 ? (
        <T5List>
          <T5Row
            lead={<T5Icon icon={Network} />}
            title={
              others === 1
                ? `${withUnit(1, "session")} from another service is open to you`
                : `${withUnit(others, "sessions")} from other services are open to you`
            }
            meta={otherNames}
            onClick={showOtherServices}
            testId="teaching-week-whats-on"
          />
        </T5List>
      ) : whatsOnFailed ? (
        <T5List>
          <T5Row
            lead={<T5Icon icon={Network} />}
            title="Sessions open to you from other services"
            meta="Could not check just now"
            end={<T5Link onClick={retryWhatsOn}>Try again</T5Link>}
          />
        </T5List>
      ) : null}
      {live && !offlineAt ? (
        <>
          <ModeBandAction>
            {() => (
              <WorkGlassButton
                icon={CalendarPlus}
                label={calendarLabel}
                className="work-band__action"
                onClick={() => setCalendarOpen(true)}
                testId="teaching-week-calendar-action"
              />
            )}
          </ModeBandAction>
          <T5Section
            label="Your On Call teaching list"
            right={<T5Link onClick={() => setEditor({ entry: null })}>Add to the list</T5Link>}
            id="teaching-relocated"
            testId="teaching-relocated"
          >
            {week.relocated.length > 0 ? (
              <T5List>
                {sessionsForTeam(week.relocated, ALL_TEAMS).map((s, index, all) => {
                  const entryId = relocatedEntryId(s.occurrenceId);
                  const entry = relocated.entries.get(entryId);
                  // A repeating entry has one row per occurrence; only the first carries the anchor id.
                  const first = all.findIndex((other) => relocatedEntryId(other.occurrenceId) === entryId) === index;
                  return (
                    <T5Row
                      key={s.occurrenceId}
                      id={first ? onCallEntryAnchorId(entryId) : undefined}
                      lead={<T5Time time={s.allDay ? "All day" : perthTime(s.startsAt)} />}
                      title={s.title}
                      meta={
                        <>
                          <T5LiveDot tone="on-call" />
                          {[dayHeading(perthDateKey(s.startsAt), today), s.venue].filter(Boolean).join(" · ")}
                        </>
                      }
                      onClick={entry && onCallEntryIsEditable(entry) ? () => setEditor({ entry }) : undefined}
                    />
                  );
                })}
              </T5List>
            ) : (
              <T5Empty>Teaching you add in On Call shows here and in the week above.</T5Empty>
            )}
          </T5Section>
          {handbook.failed ? <T5Note>Your service handbook&apos;s teaching entries couldn&apos;t load.</T5Note> : null}
          {handbook.items.length > 0 ? (
            <T5Section label="From your service's handbook" id="teaching-handbook" testId="teaching-handbook">
              <T5List>
                {handbook.items.map((item) => (
                  <T5Row
                    key={item.id}
                    title={item.title}
                    meta={item.source ? `${item.serviceName} · ${item.source.label}` : item.serviceName}
                    href={item.source?.url}
                    external
                  />
                ))}
              </T5List>
            </T5Section>
          ) : null}
          <TeachingCalendarSheet
            open={calendarOpen}
            onClose={() => setCalendarOpen(false)}
            teams={week.teams}
            onChanged={view.retry}
          />
          {editorMounted ? (
            <OnCallEntryEditor
              open={editor !== null}
              onClose={() => setEditor(null)}
              section="education"
              entry={editor?.entry ?? null}
              onSaved={() => {
                setEditor(null);
                retry();
              }}
              onDeleted={() => {
                setEditor(null);
                retry();
              }}
            />
          ) : null}
        </>
      ) : null}
    </>
  );
}

function WeekRow({
  session,
  context,
  clash,
}: {
  session: SessionSummaryRead;
  context: Parameters<typeof weekRow>[1];
  clash: RosterClash | null;
}) {
  const row = weekRow(session, context);
  // Attended and cancelled rows recede; a missed one stays readable beside its Watch link, as in the mock-up.
  const muted = row.state === "done" || row.state === "cancelled";
  const ahead = row.state === "upcoming" || row.state === "moved" || row.state === "now";
  return (
    <T5Row
      lead={<T5Time time={row.time} past={muted} />}
      title={row.state === "cancelled" ? <s>{row.title}</s> : row.title}
      meta={
        <>
          {row.state === "now" ? <T5LiveDot /> : row.fromOnCall ? <T5LiveDot tone="on-call" /> : null}
          {row.meta}
        </>
      }
      past={muted}
      href={row.href}
      testId={`teaching-week-row-${session.occurrenceId}`}
      end={
        row.state === "done" ? (
          <WorkTag tone="green">Checked in</WorkTag>
        ) : clash && ahead ? (
          <WorkTag tone="amber">{clash}</WorkTag>
        ) : row.watch ? (
          <T5Link href={row.watch} label={`Watch ${row.title}`}>
            Watch
          </T5Link>
        ) : session.isPresenter && ahead ? (
          <WorkTag>You present</WorkTag>
        ) : row.state === "moved" ? (
          <WorkTag tone="neutral">Moved</WorkTag>
        ) : undefined
      }
    />
  );
}

function WeekHeader({
  first,
  last,
  current,
  onPrevious,
  onNext,
  onThisWeek,
}: {
  first: string;
  last: string;
  current: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onThisWeek: () => void;
}) {
  const arrow = cn(
    "grid size-12 place-items-center rounded-full text-[color:var(--text-muted)] active:bg-[color:var(--surface-wash)]",
    focusRing,
  );
  return (
    <div className="flex items-center justify-between gap-1" data-testid="teaching-week-nav">
      <button type="button" className={arrow} onClick={onPrevious} aria-label="Previous week">
        <ChevronLeft aria-hidden="true" className="size-icon-md" />
      </button>
      <div className="flex min-w-0 flex-wrap items-baseline justify-center gap-x-3">
        <h2 className="text-base-minus font-bold text-[color:var(--text-heading)]">{weekTitle(first, last)}</h2>
        {current ? null : <T5Link onClick={onThisWeek}>This week</T5Link>}
      </div>
      <button type="button" className={arrow} onClick={onNext} aria-label="Next week">
        <ChevronRight aria-hidden="true" className="size-icon-md" />
      </button>
    </div>
  );
}

function DayStrip({ days, today }: { days: ReturnType<typeof stripDays>; today: string }) {
  function jump(key: string) {
    // Move focus with the view, so a keyboard or screen-reader user lands on the day they chose.
    const target = document.getElementById(`day-${key}`);
    target?.scrollIntoView?.({ block: "start" });
    target?.focus({ preventScroll: true });
  }
  return (
    <div className="grid auto-cols-fr grid-flow-col" role="list" aria-label="Days this week" data-no-tab-swipe="">
      {days.map((day) => {
        const past = day.key < today;
        return (
          <span role="listitem" key={day.key} className="grid">
            <button
              type="button"
              onClick={() => jump(day.key)}
              disabled={day.count === 0}
              aria-label={`${day.weekday} ${day.day}${day.today ? ", today" : ""}: ${
                day.count === 0 ? "no sessions" : withUnit(day.count, day.count === 1 ? "session" : "sessions")
              }`}
              className={cn("grid min-h-12 justify-items-center gap-1 rounded-xl py-1.5", focusRing)}
            >
              <small
                className={cn(
                  "text-3xs font-bold tracking-label uppercase",
                  day.today ? "text-[color:var(--mode-identity)]" : "text-[color:var(--text-muted)]",
                )}
              >
                {day.weekday}
              </small>
              <b
                className={cn(
                  "nums grid size-8 place-items-center rounded-full border-[1.5px] border-transparent text-sm-minus font-bold",
                  // Past days read muted by colour, never by opacity, so they keep 4.5:1.
                  past && !day.today ? "text-[color:var(--text-muted)]" : "text-[color:var(--text-heading)]",
                  day.today && "border-[color:var(--mode-identity)] forced-colors:border-[Highlight]",
                )}
              >
                {day.day}
              </b>
              <span aria-hidden="true" className="flex h-1 gap-0.75">
                {Array.from({ length: Math.min(day.count, 5) }, (_, index) => (
                  <i key={index} className="size-1 rounded-full bg-[color:var(--mode-identity)] opacity-70" />
                ))}
              </span>
            </button>
          </span>
        );
      })}
    </div>
  );
}
