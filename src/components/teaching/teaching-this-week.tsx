"use client";

import { CalendarDays, ChevronLeft, ChevronRight, Network } from "lucide-react";
import { useMemo, useState, useSyncExternalStore } from "react";

import { focusRing } from "@/components/card-recipes";
import { InformationPageShell } from "@/components/information-page-shell";
import { ModeModuleSkeleton } from "@/components/mode-kit/module-skeleton";
import { OnCallEntryEditor } from "@/components/on-call/on-call-entry-editor";
import { onCallEntryAnchorId } from "@/components/on-call/on-call-page-anchors";
import {
  T5Actions,
  T5Done,
  T5Empty,
  T5Heading,
  T5Icon,
  T5Kicker,
  T5Link,
  T5List,
  T5LiveDot,
  T5Meta,
  T5Meter,
  T5Note,
  T5Page,
  T5Panel,
  T5Row,
  T5Section,
  T5Segments,
  T5Time,
} from "@/components/teaching/t5-kit";
import { TeachingCalendarSheet } from "@/components/teaching/teaching-calendar-sheet";
import { addDays, mondayOf, perthDateKey, perthTime } from "@/components/teaching/teaching-dates";
import { TeachingContextBar } from "@/components/teaching/teaching-modules";
import type { SessionSummaryRead } from "@/components/teaching/teaching-reads";
import { TeachingSignInNotice } from "@/components/teaching/teaching-sign-in";
import { TeachingStateNotice } from "@/components/teaching/teaching-states";
import {
  dayHeading,
  nextForYou,
  nextForYouMeta,
  nowPanel,
  openFromOtherServices,
  sessionsOn,
  stripDays,
  weekCountLabel,
  weekDayKeys,
  weekRow,
  weekTitle,
  type NowPanel,
} from "@/components/teaching/this-week-model";
import {
  ALL_TEAMS,
  joinLabel,
  relocatedEntryId,
  sessionHref,
  sessionsForTeam,
  teamInCalendar,
  type WeekFilter,
} from "@/components/teaching/teaching-view-model";
import { useHandbookTeaching } from "@/components/teaching/use-handbook-teaching";
import { useRelocatedTeaching } from "@/components/teaching/use-relocated-teaching";
import { useSessionDetail } from "@/components/teaching/use-session-detail";
import { useTeachingNow } from "@/components/teaching/use-teaching-now";
import { useTeachingResource } from "@/components/teaching/use-teaching-resource";
import {
  useSignedOutSampleRead,
  useTeachingDemoMode,
  useTeachingSignedOut,
} from "@/components/teaching/use-teaching-sample";
import { useTeachingWeek, type TeachingWeekState } from "@/components/teaching/use-teaching-week";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui-primitives";
import { onCallEntryIsEditable, type OnCallEntry } from "@/lib/on-call/entry-model";
import { teachingErrorMessage, teachingPost, teachingServiceUrl } from "@/lib/teaching/client";
import type { TeachingWeekResponse, WhatsOnRow } from "@/lib/teaching/model";

/*
 * This week (mock-up v5 screen 01): the session on now with one-tap check in, then every session this
 * week, day by day. It replaces Today, Week and the What's on landing; What's on stays one tap away for
 * sessions other services have opened. The reader's On Call teaching list and their service handbook's
 * teaching entries stay at the foot, as they were on Week.
 *
 * Nothing is kept on the phone (Teaching stores no timetable on the device). If the connection drops
 * after the week has loaded, the page keeps showing that read, says the time it loaded, and turns
 * check in off, rather than pretending to be current.
 */

const FILTERS = [
  { value: "all", label: "Whole service" },
  { value: "presenting", label: "Presenting" },
] as const;

function subscribeOnline(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/** The browser's own connection flag; true on the server. */
function useOnline(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
}

type Loaded = { monday: string; week: TeachingWeekResponse; at: Date };

/** The last good read of this week, in memory only, with the time it arrived. */
function useLastLoaded(view: TeachingWeekState, monday: string | null, now: Date | null): Loaded | null {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const week = view.status === "ready" ? view.week : null;
  // Remember each new read as it arrives (state adjusted during render, not in an effect).
  if (week && monday && now && loaded?.week !== week) setLoaded({ monday, week, at: now });
  if (week && monday && now) return { monday, week, at: loaded?.week === week ? loaded.at : now };
  return loaded && loaded.monday === monday ? loaded : null;
}

type WhatsOnRead = { sessions: WhatsOnRow[] };

export function TeachingThisWeek({ demoMode: serverDemoMode }: { demoMode: boolean }) {
  const demoMode = useTeachingDemoMode(serverDemoMode);
  const signedOut = useTeachingSignedOut();
  const now = useTeachingNow();
  const today = now ? perthDateKey(now) : null;
  const [chosenMonday, setChosenMonday] = useState<string | null>(null);
  const monday = chosenMonday ?? (today ? mondayOf(today) : null);
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
        <h1 className="sr-only">This week</h1>
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
            signedOut={signedOut}
          />
        ) : (
          <ModeModuleSkeleton rows={4} twoLine eyebrow />
        )}
      </T5Page>
    </InformationPageShell>
  );
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
  signedOut,
}: {
  view: TeachingWeekState;
  loaded: Loaded | null;
  online: boolean;
  now: Date;
  today: string;
  monday: string;
  onMonday: (monday: string | null) => void;
  whatsOn: WhatsOnRead | null;
  whatsOnFailed: boolean;
  retryWhatsOn: () => void;
  signedOut: boolean;
}) {
  const [team, setTeam] = useState(ALL_TEAMS);
  const [filter, setFilter] = useState<WeekFilter>("all");
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [editor, setEditor] = useState<{ entry: OnCallEntry | null } | null>(null);
  const live = view.demo === "off";
  const ready = live && view.status === "ready";
  const relocated = useRelocatedTeaching(ready);
  const handbook = useHandbookTeaching(ready);
  const thisMonday = mondayOf(today);
  const current = monday === thisMonday;

  if (view.status === "signed-out") return <TeachingSignInNotice />;
  // A read that failed with nothing loaded before: say so plainly. With an earlier read, keep it.
  const stale = !online || view.status === "offline" || view.status === "error";
  const week = view.status === "ready" ? view.week : stale ? (loaded?.week ?? null) : null;
  if (!week) {
    if (view.status === "offline" || view.status === "error" || view.status === "setup")
      return <TeachingStateNotice state={view.status} onRetry={view.retry} />;
    return <ModeModuleSkeleton rows={4} twoLine eyebrow />;
  }
  if (week.teams.length === 0 && week.relocated.length === 0 && week.sessions.length === 0)
    return (
      <div className="grid gap-3">
        <TeachingStateNotice state="no-team" />
        <T5List>
          <T5Row
            lead={<T5Icon icon={Network} />}
            title="Sessions open to you from other services"
            href="/teaching/whats-on"
            testId="teaching-week-whats-on"
          />
        </T5List>
      </div>
    );

  const teamValue = team === ALL_TEAMS || week.teams.some((t) => t.id === team) ? team : ALL_TEAMS;
  const showTeam = teamValue === ALL_TEAMS && week.teams.length > 1;
  const everything = sessionsForTeam([...week.sessions, ...week.relocated], teamValue);
  const sessions = filter === "presenting" ? everything.filter((s) => s.isPresenter) : everything;
  const context = { teams: week.teams, attendance: week.attendance, showTeam, now, today };
  const panel = current ? nowPanel(everything, context) : null;
  const next = current ? nextForYou(everything, panel?.session.occurrenceId ?? null, now) : null;
  const days = weekDayKeys(monday, sessions);
  const partial = week.relocatedUnavailable;
  const others = whatsOn ? openFromOtherServices(whatsOn.sessions) : null;
  const otherNames = whatsOn
    ? [...new Set(whatsOn.sessions.filter((row) => !row.own).map((row) => row.teamName))].join(", ")
    : "";
  const offlineAt = stale && loaded ? perthTime(loaded.at.toISOString()) : null;

  function retry() {
    relocated.reload();
    view.retry();
  }

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
        <T5Note icon="offline" tone="notice" className="mt-3.5" testId="teaching-week-offline">
          {`No connection. Showing your week as loaded at ${offlineAt}. Changes made since then will not show.`}
        </T5Note>
      ) : null}
      {partial ? (
        <div className="mt-3.5">
          <T5Note icon="alert" tone="warning" className="mb-0" testId="teaching-week-partial">
            Sessions shared from On Call did not load, so they are missing below.
          </T5Note>
          <T5Actions className="mb-0">
            <T5Link onClick={retry}>Try again</T5Link>
          </T5Actions>
        </div>
      ) : null}
      {panel ? (
        <OnNowPanel
          panel={panel}
          live={live}
          signedOut={signedOut}
          offlineAt={offlineAt}
          today={today}
          now={now}
          onCheckedIn={view.retry}
        />
      ) : null}
      {next ? (
        <T5List ruled={false} className={panel ? "mt-1" : "mt-3.5"} testId="teaching-next-for-you">
          <T5Row
            lead={<T5Time time={perthTime(next.startsAt)} />}
            title={`Next for you: ${next.title}`}
            meta={nextForYouMeta(next, today)}
            href={sessionHref(next)}
          />
        </T5List>
      ) : null}
      <WeekHeader
        first={days[0]}
        last={days[days.length - 1]}
        first-of-page={!panel && !next}
        current={current}
        onPrevious={() => onMonday(addDays(monday, -7))}
        onNext={() => onMonday(addDays(monday, 7))}
        onThisWeek={() => onMonday(null)}
      />
      <DayStrip days={stripDays(days, sessions, today)} />
      <T5Segments value={filter} options={FILTERS} onChange={setFilter} label="Show" />
      <T5Section
        label={weekCountLabel(sessions, partial, current ? "This week" : "That week")}
        right={
          live && !offlineAt ? (
            <T5Link onClick={() => setCalendarOpen(true)} testId="teaching-calendar">
              {week.teams.some(teamInCalendar) ? "In your calendar" : "Add to calendar"}
            </T5Link>
          ) : null
        }
        testId="teaching-week-list"
      >
        {sessions.length === 0 ? (
          <T5Empty>
            {filter === "presenting"
              ? `You are not presenting from ${weekTitle(days[0], days[days.length - 1])}.`
              : `No sessions are booked for ${weekTitle(days[0], days[days.length - 1])} yet. They appear here as soon as an organiser adds them.`}
          </T5Empty>
        ) : (
          days.map((key) => {
            const list = sessionsOn(sessions, key);
            if (list.length === 0) return null;
            return (
              <div key={key} id={`day-${key}`} className="scroll-mt-32">
                <h3
                  className={cn(
                    "mt-4.5 mb-0.5 text-xs font-semibold",
                    key === today ? "text-[color:var(--text-heading)]" : "text-[color:var(--text-muted)]",
                  )}
                >
                  {dayHeading(key, today)}
                </h3>
                <T5List>
                  {list.map((session) => (
                    <WeekRow key={session.occurrenceId} session={session} context={context} />
                  ))}
                </T5List>
              </div>
            );
          })
        )}
      </T5Section>
      {sessions.length === 0 && !current ? (
        <T5List className="mt-4.5">
          <T5Row lead={<T5Icon icon={CalendarDays} />} title="Back to this week" onClick={() => onMonday(null)} />
        </T5List>
      ) : null}
      {others !== null && others > 0 ? (
        <T5List
          className={sessions.length === 0 && !current ? "" : "mt-4.5"}
          ruled={!(sessions.length === 0 && !current)}
        >
          <T5Row
            lead={<T5Icon icon={Network} />}
            title={
              others === 1
                ? "1 session from another service is open to you"
                : `${others} sessions from other services are open to you`
            }
            meta={otherNames}
            href="/teaching/whats-on"
            testId="teaching-week-whats-on"
          />
        </T5List>
      ) : whatsOnFailed ? (
        <T5List className="mt-4.5">
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
          <T5Section
            label="Your On Call teaching list"
            right={<T5Link onClick={() => setEditor({ entry: null })}>Add to the list</T5Link>}
            id="teaching-relocated"
            testId="teaching-relocated"
          >
            {week.relocated.length > 0 ? (
              <T5List>
                {sessionsForTeam(week.relocated, ALL_TEAMS).map((s) => {
                  const entryId = relocatedEntryId(s.occurrenceId);
                  const entry = relocated.entries.get(entryId);
                  return (
                    <T5Row
                      key={s.occurrenceId}
                      id={onCallEntryAnchorId(entryId)}
                      lead={<T5Time time={s.allDay ? "All day" : perthTime(s.startsAt)} />}
                      title={s.title}
                      meta={[dayHeading(perthDateKey(s.startsAt), today), s.venue].filter(Boolean).join(" · ")}
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
        </>
      ) : null}
    </>
  );
}

function WeekRow({ session, context }: { session: SessionSummaryRead; context: Parameters<typeof weekRow>[1] }) {
  const row = weekRow(session, context);
  const muted = row.state === "past" || row.state === "done" || row.state === "cancelled";
  return (
    <T5Row
      id={row.fromOnCall ? onCallEntryAnchorId(relocatedEntryId(row.id)) : undefined}
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
      end={row.state === "done" ? <T5Done label="Checked in" /> : undefined}
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
  ...rest
}: {
  first: string;
  last: string;
  current: boolean;
  "first-of-page": boolean;
  onPrevious: () => void;
  onNext: () => void;
  onThisWeek: () => void;
}) {
  const arrow = cn(
    "grid size-12 place-items-center rounded-lg text-[color:var(--text-muted)] hover:bg-[color:var(--surface-subtle)]",
    focusRing,
  );
  return (
    <div
      className={cn("flex items-center justify-between gap-2", rest["first-of-page"] ? "mt-1" : "mt-5")}
      data-testid="teaching-week-nav"
    >
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-3">
        <h2 className="nums text-base font-semibold text-[color:var(--text-heading)]">{weekTitle(first, last)}</h2>
        {current ? null : <T5Link onClick={onThisWeek}>This week</T5Link>}
      </div>
      <span className="flex gap-1">
        <button type="button" className={arrow} onClick={onPrevious} aria-label="Previous week">
          <ChevronLeft aria-hidden="true" className="size-icon-md" />
        </button>
        <button type="button" className={arrow} onClick={onNext} aria-label="Next week">
          <ChevronRight aria-hidden="true" className="size-icon-md" />
        </button>
      </span>
    </div>
  );
}

function DayStrip({ days }: { days: ReturnType<typeof stripDays> }) {
  function jump(key: string) {
    document.getElementById(`day-${key}`)?.scrollIntoView?.({ block: "start" });
  }
  return (
    <div
      className="mt-1 grid"
      style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}
      role="list"
      aria-label="Days this week"
    >
      {days.map((day) => (
        <span role="listitem" key={day.key} className="grid">
          <button
            type="button"
            onClick={() => jump(day.key)}
            disabled={day.count === 0}
            aria-label={`${day.weekday} ${day.day}${day.today ? ", today" : ""}: ${
              day.count === 0 ? "no sessions" : day.count === 1 ? "1 session" : `${day.count} sessions`
            }`}
            className={cn("grid min-h-12 justify-items-center gap-1 rounded-lg py-1.5", focusRing)}
          >
            <small
              className={cn(
                "text-2xs",
                day.today
                  ? "font-semibold text-[color:var(--text-heading)]"
                  : "font-medium text-[color:var(--text-soft)]",
              )}
            >
              {day.weekday}
            </small>
            <b
              className={cn(
                "nums grid size-8 place-items-center rounded-full text-sm font-semibold text-[color:var(--text-heading)]",
                day.today &&
                  "shadow-[inset_0_0_0_1.5px_var(--mode-identity)] forced-colors:border forced-colors:border-[Highlight]",
              )}
            >
              {day.day}
            </b>
            <span aria-hidden="true" className="flex h-1 gap-[3px]">
              {Array.from({ length: Math.min(day.count, 5) }, (_, index) => (
                <i key={index} className="size-1 rounded-full bg-[color:var(--text-soft)] opacity-70" />
              ))}
            </span>
          </button>
        </span>
      ))}
    </div>
  );
}

function OnNowPanel({
  panel,
  live,
  signedOut,
  offlineAt,
  today,
  now,
  onCheckedIn,
}: {
  panel: NowPanel;
  live: boolean;
  signedOut: boolean;
  offlineAt: string | null;
  today: string;
  now: Date;
  onCheckedIn: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const { session } = panel;
  const href = sessionHref(session);
  const isToday = perthDateKey(session.startsAt) === today;
  const wantsJoin = session.hasJoinLink && href !== null && isToday && panel.checkIn !== "open";
  const detail = useSessionDetail(wantsJoin ? session.occurrenceId : null, !live, now);
  const joinUrl = detail.data?.joinUrl ?? null;

  async function checkIn() {
    if (!live) {
      setMessage({ tone: "error", text: "The demo doesn't save check-ins." });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      await teachingPost(teachingServiceUrl(session.serviceId), {
        action: "attendance.self",
        occurrenceId: session.occurrenceId,
      });
      setMessage({ tone: "ok", text: "Checked in." });
      onCheckedIn();
    } catch (cause) {
      setMessage({ tone: "error", text: teachingErrorMessage(cause) });
    } finally {
      setSaving(false);
    }
  }

  const unavailable = signedOut || offlineAt !== null;
  return (
    <T5Panel label={panel.live ? "On now" : "Next up"} className="mt-3.5" testId="teaching-hero">
      <T5Kicker live={panel.live}>{panel.kicker}</T5Kicker>
      <T5Heading>{session.title}</T5Heading>
      <T5Meta>{panel.meta}</T5Meta>
      {panel.elapsed !== null ? (
        <T5Meter percent={panel.elapsed} label={`${panel.elapsed}% of the session has passed`} />
      ) : null}
      {panel.checkIn === "open" ? (
        <>
          <T5Actions>
            <Button
              variant="primary"
              onClick={() => void checkIn()}
              disabled={saving || unavailable}
              busy={saving}
              busyLabel="Saving"
            >
              Check in
            </Button>
            {offlineAt ? (
              <T5Link onClick={() => window.location.reload()}>Try again</T5Link>
            ) : signedOut ? (
              <T5Meta>Check in after you sign in</T5Meta>
            ) : href ? (
              <T5Link href={`${href}?check-in=scan`}>Type the code instead</T5Link>
            ) : null}
          </T5Actions>
          <T5Meta>
            {offlineAt
              ? `As of ${offlineAt}. Check in needs a connection. You can still check in without the code for 7 days after the session.`
              : "Organisers of this session see that you checked in."}
          </T5Meta>
        </>
      ) : panel.checkIn === "done" ? (
        <T5Meta>
          <span className="font-medium text-[color:var(--text-heading)]">You checked in.</span> Organisers of this
          session see that you checked in.
        </T5Meta>
      ) : (
        <T5Actions>
          {wantsJoin && joinUrl ? (
            <T5Link href={joinUrl} external>
              {joinLabel(joinUrl)}
            </T5Link>
          ) : null}
          {href ? <T5Link href={href}>Details</T5Link> : null}
          {panel.opensAt ? <T5Meta>{`Check in opens ${panel.opensAt}`}</T5Meta> : null}
        </T5Actions>
      )}
      {message ? (
        <p
          role={message.tone === "error" ? "alert" : "status"}
          className={cn(
            "text-sm-minus",
            message.tone === "error" ? "text-[color:var(--warning-text)]" : "text-[color:var(--text-heading)]",
          )}
        >
          {message.text}
        </p>
      ) : null}
    </T5Panel>
  );
}
