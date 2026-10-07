"use client";

import { BookOpen, CalendarPlus, ChevronLeft, CloudOff, Copy, ListChecks, RotateCcw, Smartphone } from "lucide-react";
import Link from "next/link";
import { useCallback, useId, useState } from "react";

import { focusRing } from "@/components/card-recipes";
import { ContextualBackLink } from "@/components/contextual-back-link";
import { OnCallCrisisLines } from "@/components/on-call/call/external-line-rows";
import { FirstWeekPackCard } from "@/components/on-call/first-week/first-week-pack-card";
import { FirstWeekSectionView } from "@/components/on-call/first-week/first-week-section-view";
import { useFirstWeekPack } from "@/components/on-call/first-week/use-first-week-pack";
import { flatQuietAction } from "@/components/on-call/flat-recipes";
import { OnCallHandbookState } from "@/components/on-call/kit/handbook-state";
import { OnCallHospitalLine } from "@/components/on-call/kit/hospital-line";
import { useHospitalClock } from "@/components/on-call/use-hospital-clock";
import { WorkBody, WorkButton, WorkCard, WorkEmpty, WorkIconCircle, WorkIconRow } from "@/components/mode-kit/work";
import { Sheet } from "@/components/ui/sheet";
import { useOptionalToast } from "@/components/ui/toast";
import { cn } from "@/components/ui-primitives";
import { downloadTextFile } from "@/lib/admin/download-file";
import { copyTextToClipboard } from "@/lib/copy-to-clipboard";
import {
  firstWeekAskForPackText,
  firstWeekCalendarIcs,
  formatFirstWeekDate,
  isFirstWeekHighlighted,
  isFirstWeekSectionId,
  FIRST_WEEK_SECTION_TITLES,
  type FirstWeekCalendarReminders,
  type FirstWeekSectionId,
} from "@/lib/on-call/first-week-pack";
import { useOnlineStatus } from "@/lib/use-online-status";

/** Undo stays on screen for 10 seconds, the app's standard for a reversible change. */
const UNDO_MS = 10_000;

/** A flat on/off switch in the area colour, 48px tap target. */
function Toggle({
  on,
  label,
  onToggle,
  testId,
}: {
  readonly on: boolean;
  readonly label: string;
  readonly onToggle: () => void;
  readonly testId: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onToggle}
      data-testid={testId}
      className={cn(focusRing, "inline-flex min-h-12 min-w-12 shrink-0 items-center justify-center rounded-full")}
    >
      <span
        aria-hidden="true"
        className={cn(
          "relative inline-flex h-6 w-10 items-center rounded-full border transition-colors duration-[var(--duration-instant)] motion-reduce:transition-none",
          on
            ? "border-[color:var(--mode-identity)] bg-[color:var(--mode-identity)]"
            : "border-[color:var(--border-strong)] bg-[color:var(--surface-subtle)]",
        )}
      >
        <span
          className={cn(
            // Slid with a transform rather than `left` so the move stays on the compositor;
            // 0.125rem + 0.9375rem lands on the same 1.0625rem as before.
            "absolute left-0.5 size-5 rounded-full bg-[color:var(--surface-raised)] transition-transform duration-[var(--duration-instant)] motion-reduce:transition-none",
            on ? "translate-x-[0.9375rem]" : "translate-x-0",
          )}
        />
      </span>
    </button>
  );
}

/** One choice in the calendar sheet: a check row with a 48px target. */
function CalendarChoice({
  checked,
  title,
  sub,
  onChange,
  disabled = false,
  testId,
}: {
  readonly checked: boolean;
  readonly title: string;
  readonly sub: string;
  readonly onChange?: () => void;
  readonly disabled?: boolean;
  readonly testId: string;
}) {
  const id = useId();
  return (
    <div className="flex min-h-12 items-center gap-3 px-3 py-2" data-testid={testId}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        aria-describedby={`${id}-sub`}
        className="size-5 shrink-0 accent-[color:var(--mode-identity)]"
      />
      <span className="grid min-w-0 gap-0.5">
        <label htmlFor={id} className="cursor-pointer text-base-minus font-medium text-[color:var(--text-heading)]">
          {title}
        </label>
        <span id={`${id}-sub`} className="text-sm text-[color:var(--text-muted)]">
          {sub}
        </span>
      </span>
    </div>
  );
}

/**
 * "Your first week" (round 2 feature 20): the hospital's published orientation,
 * roles and escalation, with the doctor's own New job logins, as one pack that
 * shows as a card on On Call Now from a week before the job starts (unless the
 * doctor turns that off). The Notification centre reads the same choice through
 * `selectFirstWeekNeedsYou` (`useFeatureNotificationSources`).
 *
 * `section` picks one section to read on its own (`?section=who`); anything
 * else shows the pack. Read marks are this device's only.
 */
export function OnCallFirstWeekPage({ section, now: pinned }: { section?: string; now?: Date } = {}) {
  const now = useHospitalClock(pinned);
  const pack = useFirstWeekPack(now);
  const toast = useOptionalToast();
  const online = useOnlineStatus();
  const { handbook, phase, sections, marks, progress } = pack;
  const ready = handbook.status === "ready";
  const hospitalName = handbook.siteName ?? handbook.serviceName;
  const chosen: FirstWeekSectionId | null = isFirstWeekSectionId(section) ? section : null;
  const marksLoaded = marks !== null;
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [reminders, setReminders] = useState<FirstWeekCalendarReminders>({ weekBefore: true, dayBefore: true });

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
  const saveCalendar = () => {
    if (phase.kind === "no-date") return;
    const ics = firstWeekCalendarIcs({ startsOn: phase.startsOn, hospitalName, now: new Date(), reminders });
    if (!ics) return;
    downloadTextFile(ics, "first-day.ics", "text/calendar");
    setCalendarOpen(false);
    say("Calendar file saved. Open it to add your first day.");
  };
  const askForPack = async () => {
    const text = firstWeekAskForPackText({ hospitalName, startsOn: phase.kind === "no-date" ? null : phase.startsOn });
    try {
      await copyTextToClipboard(text);
      say("Note copied. Paste it into a message to your department. Nothing was sent.");
    } catch {
      toast?.push({ tone: "danger", title: "Could not copy. Your browser blocked the clipboard." });
    }
  };
  const toggleLandAlert = () => {
    if (pack.landAlert === null) return;
    const next = !pack.landAlert;
    pack.setLandAlert(next);
    const from = phase.kind === "ahead" ? formatFirstWeekDate(phase.highlightFrom) : null;
    // Honest about what happens today: the card on On Call Now. Nothing is sent, and no alert goes out yet.
    say(
      next
        ? from
          ? `It will show on On Call Now from ${from}`
          : "It will show on On Call Now"
        : "It will not show on On Call Now",
      () => pack.setLandAlert(!next),
    );
  };

  const handbookState = (
    <>
      <OnCallHandbookState handbook={handbook} page="find" />
      {ready || handbook.status === "loading" ? null : <OnCallCrisisLines now={now} />}
    </>
  );

  const offline =
    !online && ready ? (
      <WorkCard padded testId="on-call-first-week-offline">
        <div className="flex items-start gap-3" role="status">
          <WorkIconCircle icon={CloudOff} tone="amber" />
          <span className="grid min-w-0 gap-0.5">
            <span className="text-base-minus font-medium text-[color:var(--text-heading)]">Offline</span>
            <span className="text-sm text-[color:var(--text-muted)]">
              Showing what loaded before you went offline. A later change by your hospital would not show until you
              reconnect.
            </span>
          </span>
        </div>
      </WorkCard>
    ) : null;

  if (chosen) {
    const current = sections.find((item) => item.id === chosen)!;
    return (
      <main data-testid="on-call-first-week-main" className="min-w-0">
        <WorkBody>
          <OnCallHospitalLine handbook={handbook} testId="on-call-first-week-hospital" />
          {offline}
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
        </WorkBody>
      </main>
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
  const footer = (
    <div className="flex flex-wrap items-center justify-between gap-x-3">
      <span className="inline-flex min-h-12 items-center gap-1.5 text-sm text-[color:var(--text-muted)]">
        <Smartphone aria-hidden="true" className="size-icon-sm" />
        {phase.kind === "ahead" && pack.landAlert !== false ? (
          <span data-testid="on-call-first-week-ahead">
            {`Shows on On Call Now from ${formatFirstWeekDate(phase.highlightFrom)}`}
          </span>
        ) : (
          "Read marks stay on this phone"
        )}
      </span>
      {phase.kind !== "no-date" ? (
        <button
          type="button"
          onClick={() => setCalendarOpen(true)}
          aria-haspopup="dialog"
          className={cn(flatQuietAction, focusRing)}
          data-testid="on-call-first-week-calendar"
        >
          <CalendarPlus aria-hidden="true" className="size-icon-sm" />
          Add to calendar
        </button>
      ) : null}
    </div>
  );

  const handbookSections = sections.filter((item) => item.id !== "logins");
  const noPack = ready && handbookSections.every((item) => item.count === 0);

  return (
    <main data-testid="on-call-first-week-main" className="min-w-0">
      <WorkBody>
        {/* The pack card's visible title is the page's h1, so no hidden copy is read twice. */}
        <ContextualBackLink
          fallbackHref="/on-call"
          data-testid="on-call-first-week-page-back"
          className={cn(
            focusRing,
            "-ml-1 inline-flex min-h-12 w-fit items-center gap-1 text-sm font-medium text-[color:var(--mode-identity)] no-underline",
          )}
        >
          <ChevronLeft aria-hidden="true" className="size-icon-sm" />
          On Call
        </ContextualBackLink>
        <OnCallHospitalLine handbook={handbook} testId="on-call-first-week-hospital" />
        {offline}
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
        {canMarkAll || canStartAgain ? (
          <div className="flex justify-end">
            {canMarkAll ? (
              <WorkButton variant="quiet" onClick={markAll} testId="on-call-first-week-mark-all">
                Mark all as read
              </WorkButton>
            ) : (
              <WorkButton variant="quiet" icon={RotateCcw} onClick={startAgain} testId="on-call-first-week-start-again">
                Start again
              </WorkButton>
            )}
          </div>
        ) : null}
        {phase.kind === "ahead" && pack.landAlert !== null && !pack.sample ? (
          <WorkCard testId="on-call-first-week-land-alert">
            <div className="flex min-h-12 items-center gap-3 py-1 pl-3 pr-1">
              <span className="grid min-w-0 flex-1 gap-0.5">
                <span className="text-base-minus font-medium text-[color:var(--text-heading)]">
                  Show it on Now when it lands
                </span>
                <span
                  className="text-sm text-[color:var(--text-muted)]"
                  data-testid="on-call-first-week-land-alert-sub"
                >
                  {`A card on On Call Now from ${formatFirstWeekDate(phase.highlightFrom).replace(/ \d{4}$/, "")}. No message or alert is sent.`}
                </span>
              </span>
              <Toggle
                on={pack.landAlert}
                label="Show it on Now when it lands"
                onToggle={toggleLandAlert}
                testId="on-call-first-week-land-alert-switch"
              />
            </div>
          </WorkCard>
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
        {noPack ? (
          <WorkCard>
            <WorkEmpty
              icon={BookOpen}
              title={hospitalName ? `No pack from ${hospitalName} yet` : "No pack from your hospital yet"}
              body="Some departments have not written one. Your logins and checklist still work. Copy a short note to ask for one: nothing is sent from here."
              action={
                <WorkButton
                  variant="tinted"
                  icon={Copy}
                  onClick={() => void askForPack()}
                  testId="on-call-first-week-ask"
                >
                  Copy a note to ask
                </WorkButton>
              }
              testId="on-call-first-week-no-pack"
            />
          </WorkCard>
        ) : null}
        {ready ? null : handbookState}
        <WorkCard as="ul">
          <li className="min-w-0">
            <WorkIconRow
              icon={ListChecks}
              tone="neutral"
              title="Orientation checklist"
              sub="Your hospital's checklist"
              href="/on-call/orientation"
              testId="on-call-first-week-orientation-link"
            />
          </li>
        </WorkCard>
        <p className="px-1 text-sm text-[color:var(--text-muted)]">
          The pack is written by your hospital in its handbook, not by PsychSift. Logins come from your New job list.
        </p>
        <Sheet
          open={calendarOpen}
          onClose={() => setCalendarOpen(false)}
          title="Add to your calendar"
          description={phase.kind === "no-date" ? undefined : `Your first day, ${formatFirstWeekDate(phase.startsOn)}`}
          testId="on-call-first-week-calendar-sheet"
        >
          <div className="grid gap-3">
            <WorkCard>
              <CalendarChoice
                checked
                disabled
                title="Your first day"
                sub="Always in the file, so it cannot be turned off. All day, with your hospital's name"
                testId="on-call-first-week-calendar-day"
              />
              <div className="border-t border-[color:var(--border)]">
                <CalendarChoice
                  checked={reminders.weekBefore}
                  onChange={() => setReminders((current) => ({ ...current, weekBefore: !current.weekBefore }))}
                  title="A week before"
                  sub="Read your first week pack"
                  testId="on-call-first-week-calendar-week"
                />
              </div>
              <div className="border-t border-[color:var(--border)]">
                <CalendarChoice
                  checked={reminders.dayBefore}
                  onChange={() => setReminders((current) => ({ ...current, dayBefore: !current.dayBefore }))}
                  title="The day before"
                  sub="A reminder that you start tomorrow"
                  testId="on-call-first-week-calendar-eve"
                />
              </div>
            </WorkCard>
            <p className="text-sm text-[color:var(--text-muted)]">
              Your calendar keeps its own copy. If your hospital changes the pack later, the calendar does not follow,
              and the pack shows what changed.
            </p>
            <WorkButton
              size="wide"
              icon={CalendarPlus}
              onClick={saveCalendar}
              testId="on-call-first-week-calendar-save"
            >
              Save calendar file
            </WorkButton>
          </div>
        </Sheet>
      </WorkBody>
    </main>
  );
}
