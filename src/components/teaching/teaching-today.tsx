"use client";

import { CalendarDays, Check, Network, QrCode } from "lucide-react";
import { useMemo, useState } from "react";

import { InformationPageShell } from "@/components/information-page-shell";
import { ModeBandAction } from "@/components/mode-band/mode-band";
import { WorkGlassButton, WorkMiniRing, WorkRing, useWorkUndoToast } from "@/components/mode-kit/work";
import { ModeModuleSkeleton } from "@/components/mode-kit/module-skeleton";
import { LogToCpdSheet } from "@/components/teaching/log-to-cpd-sheet";
import { recordChart } from "@/components/teaching/my-record-model";
import {
  T5Date,
  T5Heading,
  T5Icon,
  T5Kicker,
  T5List,
  T5Meta,
  T5Meter,
  T5Note,
  T5Page,
  T5Panel,
  T5Row,
  T5Section,
} from "@/components/teaching/t5-kit";
import { ActionStrip, type TeachingAction } from "@/components/teaching/teaching-actions";
import { catchUpCount } from "@/components/teaching/teaching-catch-up";
import { TeachingCalendarSheet } from "@/components/teaching/teaching-calendar-sheet";
import { TeachingCodeSheet, type CodeSheetMark } from "@/components/teaching/teaching-code-sheet";
import { addDays, dayParts, mondayOf, perthDateKey, perthTime } from "@/components/teaching/teaching-dates";
import { TeachingContextBar } from "@/components/teaching/teaching-modules";
import { NeedsYou } from "@/components/teaching/teaching-needs-you";
import { withUnit } from "@/components/teaching/teaching-number";
import type { SessionSummaryRead } from "@/components/teaching/teaching-reads";
import { TeachingSignInNotice } from "@/components/teaching/teaching-sign-in";
import { TeachingStateNotice } from "@/components/teaching/teaching-states";
import { nextForYou, openFromOtherServices } from "@/components/teaching/this-week-model";
import {
  ALL_TEAMS,
  joinLabel,
  restOfWeek,
  sessionHref,
  sessionsForTeam,
} from "@/components/teaching/teaching-view-model";
import {
  countdown,
  heroSession,
  heroText,
  progress,
  todayPhase,
  type TodayPhase,
} from "@/components/teaching/today-model";
import { useLastLoaded, useOnline } from "@/components/teaching/use-teaching-online";
import { useSessionDetail } from "@/components/teaching/use-session-detail";
import { useTeachingNow } from "@/components/teaching/use-teaching-now";
import { useTeachingResource } from "@/components/teaching/use-teaching-resource";
import {
  useSignedOutSampleRead,
  useTeachingDemoMode,
  useTeachingSignedOut,
} from "@/components/teaching/use-teaching-sample";
import { useTeachingWeek, type TeachingWeekState } from "@/components/teaching/use-teaching-week";
import { useAuthSession } from "@/lib/supabase/client";
import { teachingErrorMessage, teachingPost, teachingServiceUrl } from "@/lib/teaching/client";
import { demoTeachingLogbook } from "@/lib/teaching/demo-programme";
import {
  attendanceLabels,
  teachingCpdEntryHref,
  type AttendanceMark,
  type LogbookRow,
  type TeachingWeekResponse,
  type WhatsOnRow,
} from "@/lib/teaching/model";
import { currentTerm, sampleTermTracker } from "@/lib/teaching/term-tracker";
import { useTermTrackerStore } from "@/lib/teaching/term-tracker-store";

/*
 * Teaching's Today (work-mode redesign, owner request 6 Oct 2026). One hero for the session that
 * matters now, by phase: the countdown before it, check in while it runs, Log to CPD and Feedback
 * in the 15 minutes after it ends. Then the next session that is yours, what you owe (Needs you),
 * the rest of the week, and your attendance. The header's code button opens the check-in sheet in
 * place while a check-in is open.
 *
 * The hero looks across every service the reader is in, from this Monday to a week ahead (so the
 * catch-up count sees the whole calendar week); when nothing falls in that stretch,
 * `view=next-session` supplies it. If the connection drops after the week has loaded, the page
 * keeps that read, says when it is from, and turns check in off rather than pretending to be
 * current. The demo and the signed-out sample save nothing and say so.
 */

type WhatsOnRead = { sessions: WhatsOnRow[] };

/** Remounts on sign-in, sign-out, account switch and demo change, so a kept read never crosses accounts. */
export function TeachingToday({ demoMode: serverDemoMode }: { demoMode: boolean }) {
  const auth = useAuthSession();
  const demoMode = useTeachingDemoMode(serverDemoMode);
  return <TodayScreen key={`${auth.authEpoch}:${demoMode}`} demoMode={demoMode} />;
}

function TodayScreen({ demoMode }: { demoMode: boolean }) {
  const signedOut = useTeachingSignedOut();
  const now = useTeachingNow();
  const today = now ? perthDateKey(now) : null;
  const monday = today ? mondayOf(today) : null;
  const range = useMemo(() => (today && monday ? { from: monday, to: addDays(today, 6) } : null), [today, monday]);
  const view = useTeachingWeek(range, { demoMode }, now);
  const online = useOnline();
  const loaded = useLastLoaded(view, monday, now);

  // Sessions other services have opened to this reader. Signed out, the made-up week is built here.
  const built = useSignedOutSampleRead<WhatsOnRead>(signedOut, monday, async () => {
    const { demoWhatsOnSessions } = await import("@/lib/teaching/demo-programme");
    return { sessions: demoWhatsOnSessions({ from: monday!, to: addDays(monday!, 6) }, new Date()) };
  });
  const whatsOn = useTeachingResource<WhatsOnRead>(
    monday && !signedOut && !demoMode ? `/api/teaching/whats-on?weekStart=${monday}` : null,
    signedOut ? built : undefined,
  );

  return (
    <InformationPageShell width="narrow" gap={false} testId="teaching-today">
      <T5Page>
        <h1 className="sr-only">Today</h1>
        {now && today ? (
          <TodayBody
            view={view}
            stale={!online || view.status === "offline" || view.status === "error" ? loaded : null}
            now={now}
            today={today}
            signedOut={signedOut}
            whatsOn={whatsOn.status === "ready" ? (whatsOn.data ?? null) : null}
          />
        ) : (
          <ModeModuleSkeleton rows={2} twoLine eyebrow />
        )}
      </T5Page>
    </InformationPageShell>
  );
}

function TodayBody({
  view,
  stale,
  now,
  today,
  signedOut,
  whatsOn,
}: {
  view: TeachingWeekState;
  /** The last good read while the connection is down; null while current. */
  stale: { week: TeachingWeekResponse; at: Date } | null;
  now: Date;
  today: string;
  signedOut: boolean;
  whatsOn: WhatsOnRead | null;
}) {
  const [team, setTeam] = useState(ALL_TEAMS);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const live = view.demo === "off";
  const week = stale?.week ?? (view.status === "ready" ? view.week : null);
  const teamValue = week && (team === ALL_TEAMS || week.teams.some((t) => t.id === team)) ? team : ALL_TEAMS;
  const sessions = week ? sessionsForTeam([...week.sessions, ...week.relocated], teamValue) : [];
  const inRange = week ? heroSession(sessions, now) : null;
  // Every hook sits above the early returns.
  const later = useTeachingResource<{ session: SessionSummaryRead | null }>(
    week && live && !stale && !inRange && week.teams.length > 0 ? "/api/teaching?view=next-session" : null,
  );
  const laterSession = later.data?.session ?? null;
  const hero = inRange ?? (teamValue === ALL_TEAMS || laterSession?.serviceId === teamValue ? laterSession : null);

  if (view.status === "signed-out") return <TeachingSignInNotice />;
  if (!week) {
    if (view.status === "error")
      return <TeachingStateNotice state="error" onRetry={view.retry} testId="today-state-failed" />;
    if (view.status === "offline" || view.status === "setup")
      return <TeachingStateNotice state={view.status} onRetry={view.retry} />;
    return <ModeModuleSkeleton rows={2} twoLine eyebrow />;
  }
  if (!inRange && !stale && later.status === "loading") return <ModeModuleSkeleton rows={2} twoLine eyebrow />;
  if (week.teams.length === 0 && week.relocated.length === 0 && week.sessions.length === 0)
    return <TeachingStateNotice state="no-team" />;

  const bar =
    week.teams.length > 1 || !live ? (
      <TeachingContextBar
        teams={week.teams}
        value={teamValue}
        onChange={setTeam}
        demoTag={!live || week.teams.some((t) => t.isDemo)}
      />
    ) : null;
  const offlineAt = stale ? perthTime(stale.at.toISOString()) : null;
  const catchUp = catchUpCount(week, now);

  // A failed `view=next-session` read is not "No sessions yet": say what went wrong.
  const laterFailed =
    !hero &&
    !stale &&
    (later.status === "error" ||
      later.status === "offline" ||
      later.status === "setup" ||
      later.status === "signed-out");
  if (laterFailed) {
    return (
      <>
        {bar}
        {later.status === "signed-out" ? (
          <TeachingSignInNotice />
        ) : later.status === "error" ? (
          <TeachingStateNotice state="error" onRetry={later.retry} testId="today-state-failed" />
        ) : (
          <TeachingStateNotice state={later.status === "setup" ? "setup" : "offline"} onRetry={later.retry} />
        )}
      </>
    );
  }

  const others = whatsOn ? openFromOtherServices(whatsOn.sessions) : 0;
  const next = hero ? nextForYou(sessions, hero.occurrenceId, now) : null;
  const chosen = week.teams.find((t) => t.id === teamValue) ?? (week.teams.length === 1 ? week.teams[0] : undefined);
  return (
    <>
      {bar}
      {offlineAt ? (
        <T5Note icon="offline" tone="notice" testId="teaching-today-offline">
          {`No connection. Showing your week as loaded at ${offlineAt}. Changes made since then will not show.`}
        </T5Note>
      ) : null}
      {week.relocatedUnavailable ? (
        <T5Note icon="alert" tone="warning" testId="teaching-week-partial">
          Sessions shared from On Call did not load, so they are missing below.
        </T5Note>
      ) : null}
      {hero ? (
        <TodayHero
          key={hero.occurrenceId}
          session={hero}
          week={week}
          teamValue={teamValue}
          sessions={sessions}
          now={now}
          today={today}
          live={live}
          offline={offlineAt !== null}
          signedOut={signedOut}
          onRetry={view.retry}
          onCalendar={() => setCalendarOpen(true)}
        />
      ) : (
        <TeachingStateNotice
          state="empty"
          serviceName={chosen?.name}
          onSwitchService={teamValue !== ALL_TEAMS ? () => setTeam(ALL_TEAMS) : undefined}
        />
      )}
      {next ? <NextForYou session={next} /> : null}
      {/* No session ahead still leaves past ones to log, give feedback on or catch up on. */}
      <NeedsYou live={live} today={today} catchUp={catchUp} />
      {hero ? (
        <T5List testId="teaching-rest-of-week">
          <T5Row
            lead={<T5Icon icon={CalendarDays} />}
            title="Rest of this week"
            meta={restOfWeek(sessions, hero.occurrenceId, now, today)}
            href="/teaching/week"
          />
          {others > 0 && whatsOn ? (
            <T5Row
              lead={<T5Icon icon={Network} />}
              title="Open from other services"
              meta={[
                withUnit(others, others === 1 ? "session" : "sessions"),
                [...new Set(whatsOn.sessions.filter((row) => !row.own).map((row) => row.teamName))].join(", "),
              ]
                .filter(Boolean)
                .join(" · ")}
              href="/teaching/whats-on"
            />
          ) : null}
        </T5List>
      ) : null}
      <AttendanceCard live={live} now={now} today={today} />
      {signedOut ? <T5Note icon="shield">Nothing in the sample is saved</T5Note> : null}
      {live ? (
        <TeachingCalendarSheet
          open={calendarOpen}
          onClose={() => setCalendarOpen(false)}
          teams={week.teams}
          onChanged={view.retry}
        />
      ) : null}
    </>
  );
}

function TodayHero({
  session,
  week,
  teamValue,
  sessions,
  now,
  today,
  live,
  offline,
  signedOut,
  onRetry,
  onCalendar,
}: {
  session: SessionSummaryRead;
  week: TeachingWeekResponse;
  teamValue: string;
  sessions: readonly SessionSummaryRead[];
  now: Date;
  today: string;
  live: boolean;
  offline: boolean;
  signedOut: boolean;
  onRetry: () => void;
  onCalendar: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [checkedIn, setCheckedIn] = useState<string | null>(null);
  const [localMark, setLocalMark] = useState<AttendanceMark | null>(null);
  const [codeOpen, setCodeOpen] = useState(false);
  const [cpdOpen, setCpdOpen] = useState(false);
  const [logged, setLogged] = useState<{ entryId: string; hours: number } | null>(null);
  const toast = useWorkUndoToast();

  const phase: TodayPhase = todayPhase(session, now, today);
  const href = sessionHref(session);
  const canCheckIn = href !== null && week.teams.some((t) => t.id === session.serviceId);
  const mark = week.attendance.find((item) => item.occurrenceId === session.occurrenceId) ?? localMark;
  const isToday = perthDateKey(session.startsAt) === today;
  const wantsJoin = session.hasJoinLink && href !== null && isToday && phase !== "after";
  const detail = useSessionDetail(wantsJoin ? session.occurrenceId : null, !live, now);
  const joinUrl = detail.data?.joinUrl ?? null;
  const text = heroText(session, {
    phase,
    now,
    teams: week.teams,
    showTeam: teamValue === ALL_TEAMS && week.teams.length > 1,
    mark,
    loggedHours: logged?.hours ?? null,
    hadToday: sessions.some((s) => s.status !== "cancelled" && perthDateKey(s.startsAt) === today),
    canCheckIn,
  });
  const checkInWindow = phase === "code" || phase === "on" || phase === "after";
  const offlineCheckIn = offline && canCheckIn && !mark && checkInWindow;

  async function checkInWithoutCode() {
    if (!live) {
      setSaveError("The demo doesn't save check-ins.");
      return;
    }
    setSaving(true);
    setSaveError(null);
    setCheckedIn(null);
    try {
      await teachingPost(teachingServiceUrl(session.serviceId), {
        action: "attendance.self",
        occurrenceId: session.occurrenceId,
      });
      setCheckedIn("Checked in.");
      onRetry();
    } catch (cause) {
      setSaveError(teachingErrorMessage(cause));
    } finally {
      setSaving(false);
    }
  }

  function onCode(saved: CodeSheetMark) {
    setLocalMark({ occurrenceId: session.occurrenceId, ...saved });
    setCheckedIn("Checked in.");
    onRetry();
  }

  const scanHref = `${href}?check-in=scan`;
  const details: TeachingAction | null = href ? { id: "details", label: "Details", href, emphasis: "secondary" } : null;
  const self: TeachingAction = {
    id: "self",
    label: "Check in without code",
    onClick: () => void checkInWithoutCode(),
    busy: saving,
    busyLabel: "Saving",
  };
  const feedback: TeachingAction = {
    id: "feedback",
    label: "Feedback",
    href: "/teaching/feedback",
    emphasis: "secondary",
  };
  let actions: (TeachingAction | null)[];
  if (href === null) actions = [{ id: "week", label: "See it in Week", href: "/teaching/week", emphasis: "primary" }];
  else if (offlineCheckIn)
    actions = [{ id: "retry", label: "Try again", onClick: onRetry, emphasis: "primary" }, details];
  else if (phase === "later")
    actions = [
      { id: "details", label: "Details", href, emphasis: "primary" },
      live && !offline
        ? { id: "calendar", label: "Add to calendar", onClick: onCalendar, emphasis: "secondary" }
        : null,
    ];
  else if (phase === "after" && mark && canCheckIn)
    actions = logged
      ? [
          { id: "reflect", label: "Add reflection", href: teachingCpdEntryHref(logged.entryId), emphasis: "primary" },
          feedback,
        ]
      : [{ id: "cpd", label: "Log to CPD", onClick: () => setCpdOpen(true), emphasis: "primary" }, feedback];
  else if (phase === "after" && canCheckIn)
    actions = [
      { ...self, emphasis: "primary" },
      { id: "scan", label: "Check in with code", href: scanHref, emphasis: "secondary" },
    ];
  else if (phase === "on" && canCheckIn && !mark)
    actions = [
      { id: "scan", label: "Check in with code", href: scanHref, emphasis: "primary" },
      { ...self, emphasis: "secondary" },
    ];
  else if (phase === "code" && canCheckIn && !mark)
    actions = [{ id: "scan", label: "Check in with code", href: scanHref, emphasis: "primary" }, details];
  else if (joinUrl)
    actions = [{ id: "join", label: joinLabel(joinUrl), href: joinUrl, external: true, emphasis: "primary" }, details];
  else actions = [{ id: "details", label: "Details", href, emphasis: "primary" }];

  const count = phase === "before" || phase === "code" ? countdown(session, now) : null;
  const track = phase === "on" ? progress(session, now) : null;
  const { day, month } = dayParts(perthDateKey(session.startsAt));

  return (
    <>
      <T5Panel hero label={phase === "on" ? "On now" : "Next up"} testId="teaching-hero">
        <div className="flex items-start justify-between gap-3">
          <div className="grid min-w-0 gap-1">
            <T5Kicker live={phase === "on"}>{text.kicker}</T5Kicker>
            <T5Heading>{session.title}</T5Heading>
            <T5Meta>{text.meta}</T5Meta>
          </div>
          {count ? (
            <WorkRing
              value={count.figure}
              label={count.label}
              fraction={count.fraction}
              accessibleLabel={count.spoken}
            />
          ) : null}
        </div>
        {track ? (
          <div className="grid gap-1">
            <T5Meter percent={track.percent} label={`${track.percent}% of the session has passed`} />
            <div className="nums flex justify-between text-2xs font-bold text-[color:var(--text-muted)]">
              <span>{perthTime(session.startsAt)}</span>
              <span>{track.left}</span>
              <span>{perthTime(session.endsAt)}</span>
            </div>
          </div>
        ) : null}
        {mark ? (
          <p className="flex items-center gap-1.5 text-xs font-bold">
            <Check aria-hidden="true" className="size-3.5" strokeWidth={3} />
            {attendanceLabels[mark.method]}
          </p>
        ) : null}
        {text.note ? <T5Meta>{text.note}</T5Meta> : null}
        {offlineCheckIn ? <T5Meta>Check in needs signal. Without code works for 7 days.</T5Meta> : null}
        {signedOut && canCheckIn && !mark && checkInWindow ? <T5Meta>Check in after you sign in</T5Meta> : null}
        <ActionStrip
          surface="hero"
          className="mt-1"
          actions={actions.filter((action): action is TeachingAction => action !== null)}
        />
        {checkedIn ? (
          <p role="status" data-testid="teaching-today-checked-in" className="text-xs font-bold">
            {checkedIn}
          </p>
        ) : null}
        {saveError ? (
          <p role="alert" className="text-xs font-bold">
            {saveError}
          </p>
        ) : null}
      </T5Panel>
      {canCheckIn && !mark && !offline && checkInWindow ? (
        <ModeBandAction>
          {() => (
            <WorkGlassButton
              icon={QrCode}
              label="Type a check-in code"
              className="work-band__action"
              onClick={() => setCodeOpen(true)}
              testId="teaching-today-code"
            />
          )}
        </ModeBandAction>
      ) : null}
      {canCheckIn ? (
        <TeachingCodeSheet
          open={codeOpen}
          onClose={() => setCodeOpen(false)}
          session={{
            serviceId: session.serviceId,
            occurrenceId: session.occurrenceId,
            hasJoinLink: session.hasJoinLink,
          }}
          subtitle={`${session.title} · ${perthTime(session.startsAt)} to ${perthTime(session.endsAt)}`}
          live={live}
          onDone={onCode}
        />
      ) : null}
      {mark && phase === "after" ? (
        <LogToCpdSheet
          open={cpdOpen}
          onClose={() => setCpdOpen(false)}
          occurrenceId={session.occurrenceId}
          startsAt={session.startsAt}
          endsAt={session.endsAt}
          subtitle={`${session.title} · ${day} ${month}`}
          checkIn={mark}
          demo={!live}
          onLogged={(entryId, hours) => {
            setLogged({ entryId, hours });
            toast?.(`Logged ${withUnit(hours, "h")} to CPD`);
          }}
        />
      ) : null}
    </>
  );
}

/** The next session after the hero that is yours to present, else simply the next one. */
function NextForYou({ session }: { session: SessionSummaryRead }) {
  const { day, month } = dayParts(perthDateKey(session.startsAt));
  return (
    <T5Section label="Next for you" testId="teaching-next-for-you">
      <T5List>
        <T5Row
          lead={<T5Date day={day} month={month} />}
          title={session.isPresenter ? `You present: ${session.title}` : session.title}
          meta={[
            perthTime(session.startsAt),
            session.venue ?? (session.hasJoinLink ? "Online" : "Room to confirm"),
          ].join(" · ")}
          // A presenter's next talk opens Presenting, where the patient-details check lives.
          href={
            session.isPresenter
              ? `/teaching/teach?talk=${encodeURIComponent(session.occurrenceId)}`
              : sessionHref(session)
          }
        />
      </T5List>
    </T5Section>
  );
}

/**
 * Attendance from the reader's own logbook: sessions checked in this term (the term on this phone),
 * else over the last 12 weeks, with a small ring of the weeks they checked in at all. No "of N":
 * how many sessions ran is not known here. Hidden until the read arrives, and on a failed read.
 */
function AttendanceCard({ live, now, today }: { live: boolean; now: Date; today: string }) {
  const resource = useTeachingResource<{ attendance: LogbookRow[] }>(live ? "/api/teaching?view=logbook" : null);
  const rows = useMemo(
    () => (live ? (resource.data?.attendance ?? null) : demoTeachingLogbook(now)),
    [live, now, resource.data],
  );
  const sample = useMemo(() => (live ? null : sampleTermTracker(today)), [live, today]);
  const { state } = useTermTrackerStore(sample);
  if (!rows) return null;
  const chart = recordChart(rows, today);
  const attended = chart.weeks.filter((week) => week.count > 0).length;
  const term = state ? currentTerm(state) : null;
  const counted = term
    ? rows.filter((row) => {
        const key = perthDateKey(row.startsAt);
        return key >= term.startsOn && key <= today;
      }).length
    : chart.total;
  return (
    <T5Section label="Attendance" testId="teaching-today-attendance">
      <T5List>
        <T5Row
          lead={
            <WorkMiniRing
              value={attended}
              fraction={attended / 12}
              accessibleLabel={`Checked in at teaching in ${withUnit(attended, "of")} the last ${withUnit(12, "weeks")}`}
            />
          }
          title={`${withUnit(counted, counted === 1 ? "session" : "sessions")} ${term ? "this term" : `in the last ${withUnit(12, "weeks")}`}`}
          meta={`Checked in ${withUnit(attended, "of")} the last ${withUnit(12, "weeks")}`}
          href="/teaching/logbook"
        />
      </T5List>
    </T5Section>
  );
}
