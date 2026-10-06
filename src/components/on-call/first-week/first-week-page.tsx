"use client";

import { CalendarPlus, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useCallback } from "react";

import { focusRing } from "@/components/card-recipes";
import { OnCallCrisisLines } from "@/components/on-call/call/external-line-rows";
import { FirstWeekPackCard } from "@/components/on-call/first-week/first-week-pack-card";
import { FirstWeekSectionView } from "@/components/on-call/first-week/first-week-section-view";
import { useFirstWeekPack } from "@/components/on-call/first-week/use-first-week-pack";
import { flatQuietAction } from "@/components/on-call/flat-recipes";
import { OnCallHandbookState } from "@/components/on-call/kit/handbook-state";
import { OnCallHospitalLine } from "@/components/on-call/kit/hospital-line";
import { useHospitalClock } from "@/components/on-call/use-hospital-clock";
import { InformationPageShell } from "@/components/information-page-shell";
import { useOptionalToast } from "@/components/ui/toast";
import { cn } from "@/components/ui-primitives";
import { downloadTextFile } from "@/lib/admin/download-file";
import {
  firstWeekCalendarIcs,
  formatFirstWeekDate,
  isFirstWeekHighlighted,
  isFirstWeekSectionId,
  FIRST_WEEK_SECTION_TITLES,
  type FirstWeekSectionId,
} from "@/lib/on-call/first-week-pack";

/** Undo stays on screen for 10 seconds, the app's standard for a reversible change. */
const UNDO_MS = 10_000;

/**
 * "Your first week" (round 2 feature 20): the hospital's published orientation,
 * roles and escalation, with the doctor's own New job logins, as one pack that
 * moves to the top of On Call from a week before the job starts.
 *
 * `section` picks one section to read on its own (`?section=who`); anything
 * else shows the pack. Read marks are this device's only.
 */
export function OnCallFirstWeekPage({ section, now: pinned }: { section?: string; now?: Date } = {}) {
  const now = useHospitalClock(pinned);
  const pack = useFirstWeekPack(now);
  const toast = useOptionalToast();
  const { handbook, phase, sections, marks, progress } = pack;
  const ready = handbook.status === "ready";
  const hospitalName = handbook.siteName ?? handbook.serviceName;
  const chosen: FirstWeekSectionId | null = isFirstWeekSectionId(section) ? section : null;
  const marksLoaded = marks !== null;

  const say = useCallback(
    (title: string, undo?: () => void) => {
      toast?.push({
        tone: "success",
        title,
        duration: undo ? UNDO_MS : undefined,
        action: undo ? { label: "Undo", onAction: undo } : undefined,
      });
    },
    [toast],
  );

  const markOne = useCallback(
    (id: FirstWeekSectionId, read: boolean) => {
      const previous = pack.markSection(id, read);
      say(
        read ? `${FIRST_WEEK_SECTION_TITLES[id]} marked as read` : `${FIRST_WEEK_SECTION_TITLES[id]} marked as unread`,
        () => pack.restoreSection(id, previous),
      );
    },
    [pack, say],
  );

  const markAll = () => {
    const previous = pack.markAll();
    say("Every section marked as read", () => pack.restore(previous));
  };
  const startAgain = () => {
    const previous = pack.clearAll();
    say("Read marks cleared", () => pack.restore(previous));
  };
  const addToCalendar = () => {
    if (phase.kind === "no-date") return;
    const ics = firstWeekCalendarIcs({ startsOn: phase.startsOn, hospitalName, now: new Date() });
    if (!ics) return;
    downloadTextFile(ics, "first-day.ics", "text/calendar");
    say("Calendar file saved. Open it to add your first day.");
  };

  const handbookState = (
    <>
      <OnCallHandbookState handbook={handbook} page="find" />
      {ready || handbook.status === "loading" ? null : <OnCallCrisisLines now={now} />}
    </>
  );

  if (chosen) {
    const current = sections.find((item) => item.id === chosen)!;
    return (
      <InformationPageShell testId="on-call-first-week-main">
        <OnCallHospitalLine handbook={handbook} testId="on-call-first-week-hospital" />
        <FirstWeekSectionView
          section={current}
          items={handbook.items}
          siteId={handbook.siteId}
          hospitalName={hospitalName}
          handbookReady={ready}
          handbookState={handbookState}
          logins={pack.logins}
          loginsState={pack.startState}
          readAt={marks?.[chosen]}
          now={now}
          onMark={(read) => markOne(chosen, read)}
          onRetryLogins={pack.retryEntries}
        />
      </InformationPageShell>
    );
  }

  const startLine =
    pack.startState === "loading" ? (
      <p className="text-sm text-[color:var(--text-muted)]">Loading your start date</p>
    ) : pack.startState === "failed" ? (
      <p className="flex flex-wrap items-center gap-x-2 text-sm text-[color:var(--text)]" role="alert">
        Your start date could not be loaded.
        <button
          type="button"
          onClick={pack.retryEntries}
          className={cn(flatQuietAction, focusRing, "min-h-12")}
          data-testid="on-call-first-week-start-retry"
        >
          Try again
        </button>
      </p>
    ) : pack.startState === "signed-out" ? (
      <p className="text-sm text-[color:var(--text-muted)]">Sign in to add your start date.</p>
    ) : phase.kind === "no-date" ? (
      <Link
        href="/admin/new-job"
        className={cn(flatQuietAction, focusRing, "w-fit px-0")}
        data-testid="on-call-first-week-add-start"
      >
        Add your start date in New job
      </Link>
    ) : (
      <p className="nums text-sm text-[color:var(--text-muted)]" data-testid="on-call-first-week-start">
        {`Starts ${formatFirstWeekDate(phase.startsOn)}`}
      </p>
    );

  const canMarkAll = ready && marksLoaded && progress.total > 0 && progress.read < progress.total;
  const canStartAgain = ready && marksLoaded && progress.total > 0 && !canMarkAll;
  const footer =
    phase.kind !== "no-date" || canMarkAll || canStartAgain ? (
      <div className="flex flex-wrap items-center justify-between gap-x-3">
        {phase.kind !== "no-date" ? (
          <button
            type="button"
            onClick={addToCalendar}
            className={cn(flatQuietAction, focusRing)}
            data-testid="on-call-first-week-calendar"
          >
            <CalendarPlus aria-hidden="true" className="size-icon-sm" />
            Add first day to calendar
          </button>
        ) : (
          <span />
        )}
        {canMarkAll ? (
          <button
            type="button"
            onClick={markAll}
            className={cn(flatQuietAction, focusRing)}
            data-testid="on-call-first-week-mark-all"
          >
            Mark all as read
          </button>
        ) : null}
        {canStartAgain ? (
          <button
            type="button"
            onClick={startAgain}
            className={cn(flatQuietAction, focusRing)}
            data-testid="on-call-first-week-start-again"
          >
            <RotateCcw aria-hidden="true" className="size-icon-sm" />
            Start again
          </button>
        ) : null}
      </div>
    ) : null;

  return (
    <InformationPageShell testId="on-call-first-week-main">
      <h1 className="sr-only">Your first week</h1>
      <OnCallHospitalLine handbook={handbook} testId="on-call-first-week-hospital" />
      <FirstWeekPackCard
        phase={phase}
        hospitalName={hospitalName}
        sections={sections}
        marks={marks ?? {}}
        progress={progress}
        logins={pack.logins}
        loginsState={pack.startState}
        startLine={startLine}
        footer={footer}
        pendingText={
          handbook.status === "loading" || (ready && !marksLoaded)
            ? "Loading"
            : handbook.status === "no-service"
              ? "Needs your hospital's handbook"
              : handbook.status === "unavailable"
                ? "Could not load"
                : ready
                  ? null
                  : "Sign in to see"
        }
      />
      {phase.kind === "ahead" ? (
        <p className="px-1 text-sm text-[color:var(--text-muted)]" data-testid="on-call-first-week-ahead">
          {`It moves to the top of On Call from ${formatFirstWeekDate(phase.highlightFrom)}, a week before you start. You can read it now.`}
        </p>
      ) : null}
      {isFirstWeekHighlighted(phase) && progress.changed > 0 ? (
        <p
          className="px-1 text-sm text-[color:var(--text)]"
          role="status"
          data-testid="on-call-first-week-changed-note"
        >
          {progress.changed === 1
            ? "1 section changed since you read it."
            : `${progress.changed} sections changed since you read it.`}
        </p>
      ) : null}
      {phase.kind === "past" ? (
        <p className="px-1 text-sm text-[color:var(--text-muted)]" data-testid="on-call-first-week-past">
          The pack stays here to look back on.
        </p>
      ) : null}
      {ready ? null : handbookState}
      <p className="px-1 text-sm text-[color:var(--text-muted)]">
        The pack comes from your hospital&apos;s handbook and your New job list. Read marks stay on this phone only.
      </p>
    </InformationPageShell>
  );
}
