"use client";

import {
  BellOff,
  CalendarClock,
  CalendarDays,
  CalendarRange,
  ChevronRight,
  ClipboardCopy,
  GraduationCap,
  ListChecks,
  NotebookPen,
  Settings2,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";

import { cardSurface } from "@/components/card-recipes";
import { CmeCatchUpCard } from "@/components/cme/cme-dashboard-catch-up";
import { CmeTodayDetailSheet, type CmeTodayDetail } from "@/components/cme/cme-dashboard-detail-sheet";
import { CmeNextStepRow, computeCmeNextStep, formatCmeHours } from "@/components/cme/cme-dashboard-next-step";
import { CmeTodayShortcuts } from "@/components/cme/cme-dashboard-shortcuts";
import { CmeWhatsLeft } from "@/components/cme/cme-dashboard-whats-left";
import { CmeHeroSummary } from "@/components/cme/cme-hero-summary";
import { CmePaceChart } from "@/components/cme/cme-progress-visuals";
import { TodayShell } from "@/components/mode-kit/today/today-shell";
import { Button } from "@/components/ui/button";
import { cn, eyebrowText, textMuted } from "@/components/ui-primitives";
import { addDays, expandEvents } from "@/lib/calendar/calendar-event";
import { cmeCalendarEvents } from "@/lib/cme/calendar-events";
import { buildCmeCatchUpPlan } from "@/lib/cme/catch-up-plan";
import {
  cpdYearBounds,
  cpdYearOf,
  daysElapsedInCpdYear,
  daysRemainingInCpdYear,
  paceProjection,
  perthCalendarDate,
} from "@/lib/cme/cpd-year";
import { evaluateYear } from "@/lib/cme/evaluate";
import { cmeDashboardModuleLabels, useCmeModuleOrder, type CmeDashboardModuleId } from "@/lib/cme/module-order";
import { cmeRoutineGapScenarios, cmeWeeklyPace } from "@/lib/cme/pace";
import type { CmePlanGoal } from "@/lib/cme/plan-goals";
import { describeConfirmedSource } from "@/lib/cme/presets";
import {
  cmeRoutineCadenceLabels,
  formatRoutineDueDate,
  formatRoutineHours,
  routineLogPrefill,
  routinesDueOn,
  type CmeRoutine,
  type CmeRoutineLogPrefill,
} from "@/lib/cme/routines";
import { buildCmeTodo } from "@/lib/cme/todo";
import type { TrainingPosition } from "@/lib/cme/training-timeline";
import type { CmeEntry, CmeRequirementSet } from "@/lib/cme/types";
import { buildCmeYearCheck } from "@/lib/cme/year-check";
import { canOfferCmeYearEnd } from "@/lib/cme/year-close-actions";
import {
  DEFAULT_REMINDER_SETTINGS,
  REMINDER_TYPE_LABELS,
  showsReminderInApp,
  type ReminderSettings,
  type ReminderType,
} from "@/lib/reminders/settings";
import { cmePageTitle } from "@/components/cme/cme-page-frame";

/**
 * TODAY — the screen the whole mode is judged by.
 *
 * Read top to bottom on a phone, one idea per block:
 *   1. the hero summary (`CmeHeroSummary`: the season, hours, logged weeks
 *      and weekly pace), beside the catch-up planner (`CmeCatchUpCard`: what
 *      the owner's routines would likely add by 31 December, and what is
 *      still to find);
 *   2. the one next step, when it is not already the first row of "What's
 *      left" (`CmeNextStepRow`: a closed year, the year-end checklist, the
 *      early-year plan, or the total alone still short);
 *   3. a row of small things to finish (`CmeTodayShortcuts`);
 *   4. the modules the owner can reorder or hide — "What's left" (every
 *      requirement once, biggest gap first, met ones folded), routines due,
 *      logged today, year dates, provenance — see `useCmeModuleOrder` and
 *      `CmeCustomisePage`;
 *   5. the pace chart, then the calendar and Teaching.
 *
 * The seasons are driven entirely by `now` against the CPD year in `set` —
 * see `computeCmeNextStep`. Nothing here is a status colour. Shortfall reads
 * through position (an unmet requirement sorts first) and wording (the
 * summary says how far short) — never through red, amber or green.
 */

const FULL_MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/** "2026-12-31" -> "31 December". No year: the dashboard only ever means the year it is already showing. */
function formatDayFullMonth(dateIso: string): string {
  const [, month, day] = dateIso.split("-");
  const monthIndex = Number.parseInt(month, 10) - 1;
  return `${Number.parseInt(day, 10)} ${FULL_MONTH_NAMES[monthIndex]}`;
}

const MODULE_ICONS: Record<CmeDashboardModuleId, LucideIcon> = {
  requirements: ListChecks,
  "routines-due": CalendarClock,
  "audited-today": NotebookPen,
  "year-dates": CalendarDays,
  provenance: ShieldCheck,
};

export type CmeDashboardProps = {
  readonly set: CmeRequirementSet;
  readonly entries: readonly CmeEntry[];
  /**
   * The instant "now" is evaluated against — required, not defaulted, so a
   * server render and the client it hydrates into always agree on which
   * season the dashboard is in.
   */
  readonly now: Date;
  /** Every routine the owner has, active or archived. Defaults to none. */
  readonly routines?: readonly CmeRoutine[];
  /**
   * Called when the owner taps "Log" on a routine that is due, with
   * everything the entry form needs pre-filled. Defaults to a no-op: nothing
   * on this screen logs an entry by itself, the same guarantee
   * `CmeRoutinesPage` makes.
   */
  readonly onLogRoutine?: (prefill: CmeRoutineLogPrefill) => void;
  /**
   * Called when the owner taps "Customise". Defaults to a no-op so this
   * screen still renders sensibly wherever it is not yet wired to a route.
   */
  readonly onOpenCustomise?: () => void;
  /**
   * Last year's activities not yet copied to the CPD home, shown from
   * 1 January until the college's reporting date. Null outside that window.
   */
  readonly reportingReminder?: CmeReportingReminder | null;
  /**
   * The owner's reminder settings. "Show in the app" off, or a snooze running
   * past today, hides the year-end claim banner ("cpd-year-end") and the
   * routines-due list ("cpd-routines"). Defaults show both, as before.
   */
  readonly reminders?: ReminderSettings;
  /** Snoozes one reminder type for a week. Omitted: no snooze buttons. */
  readonly onSnoozeReminder?: (type: ReminderType) => void;
  /** Saved drafts whose next step is the owner's own. Shown as a chip to finish; never hours. */
  readonly draftsToFinish?: number;
  /** Current owner-scoped training position, when the server has loaded one. */
  readonly currentTrainingPosition?: TrainingPosition | null;
  /** A frozen demonstration never suggests that its records refresh. */
  readonly demoMode?: boolean;
  /** This year's plan goals, for the year-end checklist opened from Today. */
  readonly goals?: readonly CmePlanGoal[];
  /** Null means the next year's targets have not been read; never guess their status. */
  readonly nextYearConfirmed?: boolean | null;
  readonly nextYearGoals?: readonly CmePlanGoal[];
};

export type CmeReportingReminder = {
  readonly year: number;
  readonly notCopied: number;
  /** Perth date the claim closes, `YYYY-MM-DD`. */
  readonly closesOn: string;
};

export function CmeDashboard({
  set,
  entries,
  now,
  routines = [],
  onLogRoutine = () => {},
  onOpenCustomise = () => {},
  reportingReminder = null,
  reminders = DEFAULT_REMINDER_SETTINGS,
  onSnoozeReminder,
  draftsToFinish = 0,
  currentTrainingPosition = null,
  demoMode = false,
  goals = [],
  nextYearConfirmed = null,
  nextYearGoals,
}: CmeDashboardProps) {
  const [detail, setDetail] = useState<CmeTodayDetail>(null);
  const { moduleIds } = useCmeModuleOrder();
  const { totalHours, statuses, unmet } = evaluateYear({ set, entries });
  const inRequestedYear = cpdYearOf(now) === set.year;
  const pace = inRequestedYear
    ? paceProjection({ hoursSoFar: totalHours, targetHours: set.totalHours, instant: now, year: set.year })
    : null;
  const bounds = cpdYearBounds(set.year);
  const yearEntries = entries.filter((entry) => !entry.archivedAt && entry.date.startsWith(`${set.year}-`));
  const culturallySafePracticeToLog = set.requirements.some(
    (requirement) =>
      requirement.spec.shape === "activity-count" &&
      requirement.spec.buckets.includes("Culturally safe practice") &&
      !yearEntries.some((entry) => entry.buckets.includes("Culturally safe practice")),
  );

  const today = perthCalendarDate(now);
  const loadedTime = new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Perth",
    hour: "numeric",
    minute: "2-digit",
  }).format(now);
  const loggedToday = entries.filter((entry) => entry.date === today);
  const loggedTodayHours = loggedToday.reduce(
    (sum, entry) => sum + entry.allocations.reduce((inner, allocation) => inner + allocation.hours, 0),
    0,
  );
  const dueRoutines = showsReminderInApp(reminders, "cpd-routines", today) ? routinesDueOn(routines, now) : [];
  const showReportingReminder =
    reportingReminder !== null &&
    reportingReminder.notCopied > 0 &&
    showsReminderInApp(reminders, "cpd-year-end", today);

  function snoozeButton(type: ReminderType) {
    if (!onSnoozeReminder) return null;
    return (
      <Button
        variant="ghost"
        size="sm"
        icon={BellOff}
        aria-label={`Snooze for a week: ${REMINDER_TYPE_LABELS[type]}`}
        onClick={() => onSnoozeReminder(type)}
      >
        Snooze for a week
      </Button>
    );
  }

  // A due routine is listed, with its own Log button, in the "Routines due"
  // module, never in the next-step slot, which would hide the requirement gap
  // and the year-end reminder whenever anything recurring was due.
  const nextStep = computeCmeNextStep({ set, unmet, now, totalHours });
  // The year-end checklist (copying, self-evaluation, goal carry, next year, summary) opens from Today.
  const offerYearEnd = canOfferCmeYearEnd(set, now);
  // The step only rides inside "What's left" while that module is shown;
  // hidden in Customise, the standalone row carries it instead.
  const nextStepInList = nextStep.inList && !offerYearEnd && moduleIds.includes("requirements");
  const { toFinish } = buildCmeTodo({
    set,
    entries,
    routines,
    statuses,
    now,
    draftsToFinish,
    nextStep: { id: "next", label: nextStep.label, href: nextStep.href },
  });

  const yearCheck = buildCmeYearCheck(set, entries);
  const nextDate = expandEvents(cmeCalendarEvents({ set, entries, routines }).exported, {
    start: today,
    end: addDays(today, 400),
  })[0];

  const catchUp = buildCmeCatchUpPlan({ set, entries, routines, today });
  // The same rule as the hero's pace line: no weekly figure in the first four weeks or the last week.
  const weeklyPace = cmeWeeklyPace({ targetHours: set.totalHours, loggedHours: totalHours, today, year: set.year });
  const totalGap = catchUp.hoursToGo;
  const gapScenarios = cmeRoutineGapScenarios(routines, totalGap, undefined, { today, year: set.year });

  function handleLogRoutine(routine: CmeRoutine) {
    onLogRoutine(routineLogPrefill(routine, now));
  }

  const moduleContent: Record<CmeDashboardModuleId, ReactNode> = {
    requirements: (
      <CmeWhatsLeft set={set} statuses={statuses} nextStepInList={nextStepInList} onOpenRequirement={setDetail} />
    ),
    "routines-due":
      dueRoutines.length > 0 ? (
        <ul className="space-y-2">
          {dueRoutines.map((routine) => (
            <li key={routine.id} className={cn(cardSurface, "flex items-center justify-between gap-3 p-3")}>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-[color:var(--text)]">{routine.title}</p>
                <p className={cn(textMuted, "text-xs")}>
                  {cmeRoutineCadenceLabels[routine.cadence]} · usually {formatRoutineHours(routine.usualHours)} h
                </p>
              </div>
              <Button variant="secondary" size="sm" onClick={() => handleLogRoutine(routine)}>
                {`Log ${formatRoutineHours(routine.usualHours)} h`}
              </Button>
            </li>
          ))}
          {onSnoozeReminder ? <li>{snoozeButton("cpd-routines")}</li> : null}
        </ul>
      ) : null,
    "audited-today":
      loggedToday.length > 0 ? (
        <p className="text-sm text-[color:var(--text)]">
          {loggedToday.length} {loggedToday.length === 1 ? "activity" : "activities"} logged today,{" "}
          {formatCmeHours(loggedTodayHours)} {loggedTodayHours === 1 ? "hour" : "hours"}.
        </p>
      ) : (
        <p className={cn(textMuted, "text-sm")}>Nothing logged yet today.</p>
      ),
    "year-dates": (
      <p className={cn(textMuted, "text-sm")}>
        {formatRoutineDueDate(bounds.start)} to {formatRoutineDueDate(bounds.end)}
        {inRequestedYear ? ` · ${daysRemainingInCpdYear(now, set.year)} days left` : ""}
      </p>
    ),
    provenance: (
      <p className={cn(textMuted, "break-words text-sm")}>
        Source recorded by you on {formatRoutineDueDate(set.confirmedOn)}:{" "}
        {describeConfirmedSource(set.confirmedSource)}. This records what you checked; it is not independent
        certification.
      </p>
    ),
  };

  const renderModules = (ids: readonly CmeDashboardModuleId[]) => {
    const shown = moduleIds.filter((moduleId) => ids.includes(moduleId) && moduleContent[moduleId] !== null);
    if (shown.length === 0) return null;
    return (
      <div className="space-y-6">
        {shown.map((moduleId) => {
          const Icon = MODULE_ICONS[moduleId];
          return (
            <section key={moduleId} aria-labelledby={`cme-module-${moduleId}-heading`} data-testid={`cme-${moduleId}`}>
              <h2 id={`cme-module-${moduleId}-heading`} className={cn(eyebrowText, "flex items-center gap-1.5")}>
                <Icon aria-hidden="true" className="size-icon-sm" />
                {cmeDashboardModuleLabels[moduleId]}
              </h2>
              <div className="mt-2">{moduleContent[moduleId]}</div>
            </section>
          );
        })}
      </div>
    );
  };

  const status = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className={cmePageTitle}>Today</h1>
          <p data-testid="cme-data-freshness" className={cn(textMuted, "mt-1 flex items-center gap-1.5 text-xs")}>
            <span
              aria-hidden="true"
              className={cn(
                "size-1.5 rounded-full bg-[color:var(--clinical-accent)]",
                !demoMode && "motion-safe:animate-pulse motion-reduce:animate-none",
              )}
            />
            {demoMode ? "Demo records" : `Saved records loaded at ${loadedTime}`}
          </p>
        </div>
        <Button variant="toolbar" size="sm" icon={Settings2} onClick={onOpenCustomise}>
          Customise
        </Button>
      </div>

      {currentTrainingPosition?.stage || currentTrainingPosition?.rotation || currentTrainingPosition?.breakPeriod ? (
        <Link
          href="/cme/training"
          data-testid="cme-training-position-link"
          className={cn(
            cardSurface,
            "flex min-h-tap items-center justify-between gap-3 p-3 text-sm text-[color:var(--text)]",
          )}
        >
          <span>
            {currentTrainingPosition.stage?.label ?? "Training"}
            {currentTrainingPosition.onBreak
              ? ` · on break${currentTrainingPosition.breakPeriod ? `: ${currentTrainingPosition.breakPeriod.label}` : ""}`
              : currentTrainingPosition.rotationIndex !== null && currentTrainingPosition.rotationCount !== null
                ? ` · rotation ${currentTrainingPosition.rotationIndex} of ${currentTrainingPosition.rotationCount}`
                : currentTrainingPosition.rotation
                  ? ` · ${currentTrainingPosition.rotation.label}`
                  : ""}
          </span>
          <span className={textMuted}>Plan › Training</span>
        </Link>
      ) : null}
    </>
  );

  const nowHero = (
    <div className={cn("grid gap-3", catchUp.status === "plan" && "md:grid-cols-2")}>
      <CmeHeroSummary
        year={set.year}
        today={today}
        loggedHours={totalHours}
        targetHours={set.totalHours}
        entries={entries}
        closed={Boolean(set.closedAt)}
        onOpenDetail={() => setDetail("hours")}
      />
      <CmeCatchUpCard
        plan={catchUp}
        showWeekly={weeklyPace !== null && weeklyPace.weeksLeft >= 1}
        onOpenDetail={() => setDetail("gap")}
      />
    </div>
  );

  const needsYouModules = renderModules(["requirements"]);
  const needsYouNode =
    !nextStepInList || needsYouModules ? (
      <>
        {!nextStepInList ? (
          <CmeNextStepRow
            step={nextStep}
            offerYearEnd={offerYearEnd}
            set={set}
            entries={entries}
            goals={goals}
            now={now}
            nextYearConfirmed={nextYearConfirmed}
            nextYearGoals={nextYearGoals}
          />
        ) : null}
        {needsYouModules}
      </>
    ) : null;

  const comingUp = (
    <>
      {showReportingReminder && reportingReminder ? (
        <div className="grid gap-1">
          <Link
            href={`/cme/log?year=${reportingReminder.year}&copy=todo`}
            data-testid="cme-reporting-reminder"
            className={cn(cardSurface, "flex min-h-tap items-center gap-3 p-4")}
          >
            <ClipboardCopy aria-hidden="true" className="size-icon-md shrink-0 text-[color:var(--clinical-accent)]" />
            <span className="min-w-0 flex-1 text-sm text-[color:var(--text)]">
              <span className="font-medium">
                {reportingReminder.notCopied} {reportingReminder.notCopied === 1 ? "activity" : "activities"} from{" "}
                {reportingReminder.year} not yet copied to MyCPD.
              </span>{" "}
              Your {reportingReminder.year} claim closes on {formatDayFullMonth(reportingReminder.closesOn)}.
            </span>
            <ChevronRight aria-hidden="true" className={cn("size-icon-sm shrink-0", textMuted)} />
          </Link>
          {onSnoozeReminder ? <div>{snoozeButton("cpd-year-end")}</div> : null}
        </div>
      ) : null}
      {renderModules(["routines-due"])}
      <Link
        href={`/cme/calendar?year=${set.year}`}
        data-testid="cme-calendar-link"
        className={cn(cardSurface, "flex min-h-tap items-center gap-3 px-4 py-3")}
      >
        <CalendarRange aria-hidden="true" className="size-icon-md shrink-0 text-[color:var(--clinical-accent)]" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-[color:var(--text)]">Calendar</span>
          <span className={cn(textMuted, "line-clamp-2 block text-sm")}>
            {nextDate ? `${formatRoutineDueDate(nextDate.date)}: ${nextDate.title}` : "Nothing coming up"}
          </span>
        </span>
        <ChevronRight aria-hidden="true" className={cn("size-icon-sm shrink-0", textMuted)} />
      </Link>
    </>
  );

  const atAGlance = (
    <>
      {renderModules(["audited-today", "year-dates", "provenance"])}
      {pace && entries.length > 0 ? (
        <section className={cn(cardSurface, "p-4")} aria-label={`Hours against an even pace, ${set.year}`}>
          <CmePaceChart
            entries={entries}
            year={set.year}
            targetHours={set.totalHours}
            todayIndex={daysElapsedInCpdYear(now, set.year) - 1}
          />
        </section>
      ) : null}
    </>
  );

  const shortcuts = (
    <>
      <CmeTodayShortcuts
        toFinish={toFinish}
        yearCheck={{
          href: `/cme/check?year=${set.year}`,
          readyCount: yearCheck.readyCount,
          rowCount: yearCheck.rows.length,
        }}
      />
      {culturallySafePracticeToLog ? (
        <Link
          href="/first-nations/talking"
          data-testid="cme-first-nations-learning-link"
          className={cn(cardSurface, "flex min-h-tap items-center justify-between gap-3 p-4")}
        >
          <span className="min-w-0 text-sm text-[color:var(--text)]">
            <span className="block font-medium">Optional learning: First Nations Talking</span>
            <span className={cn(textMuted, "block")}>Opening this resource does not log a CPD activity.</span>
          </span>
          <ChevronRight aria-hidden="true" className={cn("size-icon-sm shrink-0", textMuted)} />
        </Link>
      ) : null}
      <Link
        href="/teaching"
        data-testid="cme-teaching-link"
        className={cn(cardSurface, "flex min-h-tap items-center gap-3 px-4 py-3")}
      >
        <GraduationCap aria-hidden="true" className="size-icon-md shrink-0 text-[color:var(--clinical-accent)]" />
        <span className="min-w-0 flex-1 text-sm font-medium text-[color:var(--text)]">Teaching sessions</span>
        <ChevronRight aria-hidden="true" className={cn("size-icon-sm shrink-0", textMuted)} />
      </Link>
    </>
  );

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-[calc(max(1rem,var(--safe-area-bottom))+6rem)] pt-6 sm:px-6">
      <TodayShell
        mode="cme"
        modeName="CPD"
        status={status}
        now={nowHero}
        nowSurface="own"
        needsYouNode={needsYouNode}
        comingUp={comingUp}
        atAGlance={atAGlance}
        shortcuts={shortcuts}
      />

      <CmeTodayDetailSheet
        detail={detail}
        onClose={() => setDetail(null)}
        set={set}
        statuses={statuses}
        yearEntries={yearEntries}
        totalHours={totalHours}
        totalGap={totalGap}
        gapScenarios={gapScenarios}
      />
    </main>
  );
}
