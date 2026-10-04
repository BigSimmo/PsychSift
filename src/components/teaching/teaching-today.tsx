"use client";

import { useMemo, useState, type ReactNode } from "react";

import { InformationPageShell } from "@/components/information-page-shell";
import { ModeGroupedList, ModeRow } from "@/components/mode-kit/grouped-list";
import { ModeModuleSkeleton } from "@/components/mode-kit/module-skeleton";
import { ModeNotice } from "@/components/mode-kit/notice";
import { TodayShell, type TodaySharedState } from "@/components/mode-kit/today/today-shell";
import { catchUpCount } from "@/components/teaching/teaching-catch-up";
import { TeachingCalendarSheet } from "@/components/teaching/teaching-calendar-sheet";
import { addDays, mondayOf, perthDateKey } from "@/components/teaching/teaching-dates";
import { TeachingHero } from "@/components/teaching/teaching-hero";
import { TeachingContextBar } from "@/components/teaching/teaching-modules";
import { NeedsYou } from "@/components/teaching/teaching-needs-you";
import type { SessionSummaryRead } from "@/components/teaching/teaching-reads";
import { TeachingSignInNotice } from "@/components/teaching/teaching-sign-in";
import { TeachingStateNotice } from "@/components/teaching/teaching-states";
import {
  ALL_TEAMS,
  heroModel,
  nextSession,
  restOfWeek,
  sessionHref,
  sessionsForTeam,
} from "@/components/teaching/teaching-view-model";
import { useSessionDetail } from "@/components/teaching/use-session-detail";
import { useTeachingNow } from "@/components/teaching/use-teaching-now";
import { useTeachingResource } from "@/components/teaching/use-teaching-resource";
import { useTeachingWeek, type TeachingWeekState } from "@/components/teaching/use-teaching-week";
import { teachingErrorMessage, teachingPost, teachingServiceUrl } from "@/lib/teaching/client";
import { useTeachingDemoMode } from "@/components/teaching/use-teaching-sample";

/*
 * Today on the shared Today shell: the hero is Now (the mode's own surface),
 * Needs you is the existing module, and "Rest of this week" is Coming up. The
 * page name is the pill, so the h1 is sr-only; it and the team picker are the
 * status slot. The hero is the next session in the coming seven days across
 * every service the reader is in; when nothing falls in those seven days,
 * `view=next-session` supplies it.
 *
 * Teaching keeps its own sign-in, offline, setup, no-team and empty notices
 * (`blocking`): the sign-in one carries the demo link and the offline one the
 * seven-day check-in note, neither of which the shared states have. A generic
 * load error uses the shared failed state.
 */
function TeachingTodayShell({
  bar,
  ...rest
}: {
  bar?: ReactNode;
  now?: ReactNode;
  needsYouNode?: ReactNode;
  comingUp?: ReactNode;
  state?: TodaySharedState | null;
  blocking?: ReactNode;
}) {
  return (
    <TodayShell
      mode="teaching"
      modeName="Teaching"
      nowSurface="own"
      loadingFallback={<ModeModuleSkeleton rows={2} twoLine eyebrow />}
      status={
        <>
          <h1 className="sr-only">Today</h1>
          {bar}
        </>
      }
      now={null}
      {...rest}
    />
  );
}

export function TeachingToday({ demoMode: serverDemoMode }: { demoMode: boolean }) {
  const demoMode = useTeachingDemoMode(serverDemoMode);
  const now = useTeachingNow();
  const today = now ? perthDateKey(now) : null;
  // From this Monday, so the catch-up count sees the whole calendar week (as Resources does); the hero
  // and Rest of this week only look at sessions that have not ended, so the earlier days change nothing there.
  const range = useMemo(() => (today ? { from: mondayOf(today), to: addDays(today, 6) } : null), [today]);
  const view = useTeachingWeek(range, { demoMode }, now);
  return (
    <InformationPageShell width="narrow" gap={false} testId="teaching-today">
      {now && today ? (
        <TodayBody view={view} now={now} today={today} />
      ) : (
        <TeachingTodayShell state={{ kind: "loading" }} />
      )}
    </InformationPageShell>
  );
}

function TodayBody({ view, now, today }: { view: TeachingWeekState; now: Date; today: string }) {
  const [team, setTeam] = useState(ALL_TEAMS);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [checkedIn, setCheckedIn] = useState(false);
  const live = view.demo === "off";
  const week = view.status === "ready" ? view.week : null;
  const teamValue = week && (team === ALL_TEAMS || week.teams.some((t) => t.id === team)) ? team : ALL_TEAMS;
  const sessions = week ? sessionsForTeam([...week.sessions, ...week.relocated], teamValue) : [];
  const inRange = week ? nextSession(sessions, now) : null;
  // Every hook sits above the early returns.
  const later = useTeachingResource<{ session: SessionSummaryRead | null }>(
    week && live && !inRange && week.teams.length > 0 ? "/api/teaching?view=next-session" : null,
  );
  const laterSession = later.data?.session ?? null;
  const next = inRange ?? (teamValue === ALL_TEAMS || laterSession?.serviceId === teamValue ? laterSession : null);
  const wantsJoin =
    next !== null && next.hasJoinLink && sessionHref(next) !== null && perthDateKey(next.startsAt) === today;
  const detail = useSessionDetail(wantsJoin && next ? next.occurrenceId : null, !live, now);

  if (view.status === "signed-out") return <TeachingTodayShell blocking={<TeachingSignInNotice />} />;
  if (view.status === "error") return <TeachingTodayShell state={{ kind: "failed", onRetry: view.retry }} />;
  if (view.status === "offline" || view.status === "setup")
    return <TeachingTodayShell blocking={<TeachingStateNotice state={view.status} onRetry={view.retry} />} />;
  if (!week || (!inRange && later.status === "loading")) return <TeachingTodayShell state={{ kind: "loading" }} />;
  if (week.teams.length === 0 && week.relocated.length === 0)
    return <TeachingTodayShell blocking={<TeachingStateNotice state="no-team" />} />;
  // A failed `view=next-session` read is not "No sessions yet": say what went wrong.
  const laterStatus = later.status;
  const laterFailure =
    !inRange &&
    (laterStatus === "offline" || laterStatus === "error" || laterStatus === "setup" || laterStatus === "signed-out")
      ? laterStatus
      : null;

  const bar = (
    <TeachingContextBar
      teams={week.teams}
      value={teamValue}
      onChange={setTeam}
      demoTag={!live || week.teams.some((t) => t.isDemo)}
    />
  );
  if (laterFailure) {
    return laterFailure === "error" ? (
      <TeachingTodayShell bar={bar} state={{ kind: "failed", onRetry: later.retry }} />
    ) : (
      <TeachingTodayShell
        bar={bar}
        blocking={
          laterFailure === "signed-out" ? (
            <TeachingSignInNotice />
          ) : (
            <TeachingStateNotice state={laterFailure} onRetry={later.retry} />
          )
        }
      />
    );
  }
  if (!next) {
    const chosen = week.teams.find((t) => t.id === teamValue) ?? (week.teams.length === 1 ? week.teams[0] : undefined);
    return (
      <TeachingTodayShell
        bar={bar}
        blocking={
          <div className="grid gap-3">
            <TeachingStateNotice
              state="empty"
              serviceName={chosen?.name}
              onSwitchService={teamValue !== ALL_TEAMS ? () => setTeam(ALL_TEAMS) : undefined}
            />
            {/* No session ahead still leaves past ones to log, give feedback on or catch up on. */}
            <NeedsYou live={live} today={today} catchUp={catchUpCount(week, now)} />
          </div>
        }
      />
    );
  }

  const hero = heroModel(next, {
    now,
    today,
    teams: week.teams,
    showTeam: teamValue === ALL_TEAMS && week.teams.length > 1,
    attendance: week.attendance,
    joinUrl: detail.data?.joinUrl ?? null,
    calendar: live,
    hadToday: sessions.some((s) => s.status !== "cancelled" && perthDateKey(s.startsAt) === today),
  });

  async function checkInWithoutCode() {
    if (!next) return;
    if (!live) {
      setSaveError("The demo doesn't save check-ins.");
      return;
    }
    setSaving(true);
    setSaveError(null);
    setCheckedIn(false);
    try {
      await teachingPost(teachingServiceUrl(next.serviceId), {
        action: "attendance.self",
        occurrenceId: next.occurrenceId,
      });
      setCheckedIn(true);
      view.retry();
    } catch (cause) {
      setSaveError(teachingErrorMessage(cause));
    } finally {
      setSaving(false);
    }
  }

  const actions = hero.actions.map((action) =>
    action.id === "self"
      ? { ...action, onClick: () => void checkInWithoutCode(), busy: saving, busyLabel: "Saving" }
      : action.id === "calendar"
        ? { ...action, onClick: () => setCalendarOpen(true) }
        : action,
  );

  return (
    <>
      <TeachingTodayShell
        bar={bar}
        now={
          <>
            <TeachingHero {...hero} actions={actions} />
            {checkedIn ? <ModeNotice testId="teaching-today-checked-in">Checked in.</ModeNotice> : null}
            {saveError ? (
              <div role="alert">
                <ModeNotice tone="warning">{saveError}</ModeNotice>
              </div>
            ) : null}
          </>
        }
        needsYouNode={<NeedsYou live={live} today={today} catchUp={catchUpCount(week, now)} />}
        comingUp={
          <ModeGroupedList testId="teaching-rest-of-week">
            <ModeRow
              href="/teaching/week"
              title="Rest of this week"
              subtitle={restOfWeek(sessions, next.occurrenceId, now, today)}
            />
          </ModeGroupedList>
        }
      />
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
