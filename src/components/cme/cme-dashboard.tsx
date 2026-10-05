"use client";

import {
  BookOpen,
  CalendarDays,
  ChevronRight,
  ClipboardCopy,
  Feather,
  GraduationCap,
  Plus,
  Settings2,
  Users,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useState, type MouseEvent, type ReactNode } from "react";

import { cardSurface, focusRing } from "@/components/card-recipes";
import { CmeCategoryLegend, CmeYearSummary } from "@/components/cme/cme-dashboard-catch-up";
import { CmeTodayDetailSheet, type CmeTodayDetail } from "@/components/cme/cme-dashboard-detail-sheet";
import { CmeNextStepRow, computeCmeNextStep, formatCmeHours } from "@/components/cme/cme-dashboard-next-step";
import { buildCmeYearChips, CmeTodayShortcuts } from "@/components/cme/cme-dashboard-shortcuts";
import { CmeWhatsLeft } from "@/components/cme/cme-dashboard-whats-left";
import { CmeFlatList, CmeFlatRow, CmeGroup } from "@/components/cme/cme-flat-list";
import { hoursByCategory } from "@/components/cme/cme-progress-visuals";
import { CME_LOG_TRIGGER_ATTRIBUTE, openCmeQuickLog } from "@/components/cme/cme-quick-log";
import { CME_TEACHING_ROW_ATTRIBUTE, useCmeTeachingUnloggedCount } from "@/components/cme/cme-teaching-prompt";
import { modeInsetHairline, modePressable, modeRowHeight } from "@/components/mode-kit/recipes";
import { TodayShell } from "@/components/mode-kit/today/today-shell";
import { Button } from "@/components/ui/button";
import { cn, textMuted } from "@/components/ui-primitives";
import { addDays, expandEvents } from "@/lib/calendar/calendar-event";
import { cmeCalendarEvents } from "@/lib/cme/calendar-events";
import { buildCmeCatchUpPlan } from "@/lib/cme/catch-up-plan";
import { cpdYearOf, daysRemainingInCpdYear, formatCalendarDateShort, perthCalendarDate } from "@/lib/cme/cpd-year";
import { evaluateYear } from "@/lib/cme/evaluate";
import { useCmeModuleOrder, type CmeDashboardModuleId } from "@/lib/cme/module-order";
import { cmeRoutineGapScenarios, cmeWeeklyPace } from "@/lib/cme/pace";
import type { CmePlanGoal } from "@/lib/cme/plan-goals";
import { describeConfirmedSource } from "@/lib/cme/presets";
import {
  cmeRoutineCadenceLabels,
  routineLogPrefill,
  routinesDueOn,
  type CmeRoutine,
  type CmeRoutineLogPrefill,
} from "@/lib/cme/routines";
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
 * THE YEAR PAGE (`/cme`): the screen the whole mode is judged by, built to the
 * 5 Oct mock-up (screens 01, 08, 10 and 11).
 *
 * Read top to bottom on a phone, one idea per block:
 *   1. the summary card (`CmeYearSummary`): the year and weeks left, hours
 *      against the target, one bar in the three CPD indigo shades plus what
 *      routines will likely add (hatched), the legend in words, the pace
 *      sentence, and a thin bar per week;
 *   2. the one filled button, "Log an activity" (it opens the quick-log panel);
 *   3. chips for small things to finish (not marked copied, no reflection,
 *      drafts);
 *   4. "What's left": the live year check's open items, one per row, with the
 *      done ones folded;
 *   5. routines due, each with its own "Log 1 h";
 *   6. "Also for you": teaching to log, optional learning, CPD dates;
 *   7. "About this year": today, the year's dates, where the targets came from.
 * On a computer the same blocks sit in two columns: the summary, button, chips
 * and routines on the left; "What's left" and the rest on the right. The DOM
 * keeps the phone order, so reading and tab order never jump.
 *
 * Two honest variants: nothing logged yet (screen 08) and no confirmed target
 * (screen 10). Records that did not load never reach this screen: the route
 * shows `CmeStateNotice` instead, so nothing here can read as a zero.
 *
 * The seasons are driven entirely by `now` against the CPD year in `set` —
 * see `computeCmeNextStep`. Nothing here is a status colour. Shortfall reads
 * through position (an unmet requirement sorts first) and wording — never
 * through red, amber or green.
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

/** A routine's grey leading icon: people for a group that meets, a book for anything else. */
function routineIcon(title: string): LucideIcon {
  return /peer|group|supervis|balint|meeting/i.test(title) ? Users : BookOpen;
}

/** A quiet in-row text action (Log 1 h, Snooze for a week) with a 48px tap area. */
const TEXT_ACTION = cn(
  focusRing,
  "inline-flex min-h-12 shrink-0 items-center whitespace-nowrap text-sm-minus font-medium text-[color:var(--clinical-accent)] hover:underline disabled:cursor-not-allowed disabled:text-[color:var(--text-muted)] disabled:no-underline",
);

/**
 * The page's columns on a computer. The phone order is the DOM order; from
 * `lg` the left blocks float left and the right blocks float right, each
 * clearing its own side, so the two columns stack independently without
 * moving anything in the reading order.
 */
const LEFT = "min-w-0 lg:float-left lg:clear-left lg:mb-5.5 lg:w-[55%]";
const RIGHT = "min-w-0 lg:float-right lg:clear-right lg:mb-5.5 lg:w-[calc(45%-2.5rem)]";

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
   * Called when the owner taps "Log N h" on a due routine. The route may save
   * immediately (with Undo) when the routine already has a usual category
   * split, or open the entry form when it does not. The labelled tap is the
   * explicit log — this screen never logs from attendance, timers, or search.
   */
  readonly onLogRoutine?: (prefill: CmeRoutineLogPrefill) => void;
  /** True while a one-tap due log is in flight — disables the due Log buttons. */
  readonly loggingDue?: boolean;
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
  loggingDue = false,
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
  const shows = (moduleId: CmeDashboardModuleId) => moduleIds.includes(moduleId);
  const { totalHours, statuses, unmet } = evaluateYear({ set, entries });
  const inRequestedYear = cpdYearOf(now) === set.year;
  const yearEntries = entries.filter((entry) => !entry.archivedAt && entry.date.startsWith(`${set.year}-`));
  const culturallySafePracticeToLog = set.requirements.some(
    (requirement) =>
      requirement.spec.shape === "activity-count" &&
      requirement.spec.buckets.includes("Culturally safe practice") &&
      !yearEntries.some((entry) => entry.buckets.includes("Culturally safe practice")),
  );
  // Screen 10: with no confirmed yearly total nothing is measured, so only hours are shown.
  const hasTarget = set.totalHours > 0;
  // Screen 08: a confirmed year with nothing logged in it yet.
  const nothingLogged = hasTarget && yearEntries.length === 0 && !(totalHours > 0);

  const today = perthCalendarDate(now);
  const loadedTime = new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Perth",
    hour: "numeric",
    minute: "2-digit",
  }).format(now);
  const loggedToday = entries.filter((entry) => !entry.archivedAt && entry.date === today);
  const loggedTodayHours = loggedToday.reduce(
    (sum, entry) => sum + entry.allocations.reduce((inner, allocation) => inner + allocation.hours, 0),
    0,
  );
  const dueRoutines = showsReminderInApp(reminders, "cpd-routines", today) ? routinesDueOn(routines, now) : [];
  const hasActiveRoutine = routines.some((routine) => routine.archivedAt === null);
  const showReportingReminder =
    reportingReminder !== null &&
    reportingReminder.notCopied > 0 &&
    showsReminderInApp(reminders, "cpd-year-end", today);
  const teachingCount = useCmeTeachingUnloggedCount(!demoMode);

  function snoozeButton(type: ReminderType) {
    if (!onSnoozeReminder) return null;
    return (
      <button
        type="button"
        className={TEXT_ACTION}
        aria-label={`Snooze for a week: ${REMINDER_TYPE_LABELS[type]}`}
        onClick={() => onSnoozeReminder(type)}
      >
        Snooze for a week
      </button>
    );
  }

  // A due routine is listed, with its own Log link, under "Routines due", never
  // in the next-step slot, which would hide the requirement gap and the
  // year-end reminder whenever anything recurring was due.
  const nextStep = computeCmeNextStep({ set, unmet, now, totalHours });
  // The year-end checklist (copying, self-evaluation, goal carry, next year, summary) opens from the Year page.
  const offerYearEnd = canOfferCmeYearEnd(set, now);
  const yearCheck = buildCmeYearCheck(set, entries);
  // The step rides inside "What's left" while that list is shown; hidden in
  // Customise (or before anything is logged), the standalone row carries it instead.
  const showWhatsLeft = hasTarget && !nothingLogged && shows("requirements");
  const nextStepRowId = !offerYearEnd && showWhatsLeft ? nextStep.rowId : null;
  const chips = nothingLogged || !hasTarget ? [] : buildCmeYearChips({ year: set.year, yearCheck, draftsToFinish });

  const nextDate = expandEvents(cmeCalendarEvents({ set, entries, routines }).exported, {
    start: today,
    end: addDays(today, 400),
  })[0];

  const catchUp = buildCmeCatchUpPlan({ set, entries, routines, today });
  // The same rule as the pace line: no weekly figure in the first four weeks or the last week.
  const weeklyPace = cmeWeeklyPace({ targetHours: set.totalHours, loggedHours: totalHours, today, year: set.year });
  const totalGap = catchUp.hoursToGo;
  const gapScenarios = cmeRoutineGapScenarios(routines, totalGap, undefined, { today, year: set.year });

  function handleLogRoutine(routine: CmeRoutine) {
    onLogRoutine(routineLogPrefill(routine, now));
  }

  function handleLogActivity(event: MouseEvent<HTMLAnchorElement>) {
    // Opens the quick-log panel where the route provides one; otherwise the link opens the full page.
    if (openCmeQuickLog(event.currentTarget)) event.preventDefault();
  }

  const status = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className={cmePageTitle}>Year</h1>
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

  const summary = (
    <CmeYearSummary
      year={set.year}
      today={today}
      loggedHours={totalHours}
      targetHours={set.totalHours}
      categoryHours={hoursByCategory(entries)}
      plan={catchUp}
      weeklyHours={weeklyPace !== null && weeklyPace.weeksLeft >= 1 ? weeklyPace.weeklyHours : null}
      entries={entries}
      closed={Boolean(set.closedAt)}
      onOpenGap={() => setDetail("gap")}
    />
  );

  const logButton = (
    <Link
      href={`/cme/new?year=${set.year}`}
      onClick={handleLogActivity}
      data-testid="cme-log-activity"
      {...{ [CME_LOG_TRIGGER_ATTRIBUTE]: "" }}
      className={cn(
        focusRing,
        "relative inline-flex min-h-12 w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-md bg-[color:var(--clinical-accent)] px-4 text-sm-minus font-semibold text-[color:var(--clinical-accent-contrast)] no-underline lg:w-auto lg:justify-self-start",
        // The mock-up's quiet dark fill, the same as the Log page's button (`cmeFilledButton`).
        "dark:bg-[color:color-mix(in_oklab,var(--clinical-accent)_38%,var(--surface-raised))] dark:text-[color:var(--text-heading)]",
        "forced-colors:border forced-colors:border-[ButtonText] forced-colors:bg-[ButtonFace] forced-colors:text-[ButtonText]",
      )}
    >
      <Plus aria-hidden="true" className="size-4" strokeWidth={1.6} />
      {nothingLogged ? "Log your first activity" : "Log an activity"}
    </Link>
  );

  const nextStepNode =
    hasTarget && !nothingLogged && nextStepRowId === null ? (
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
    ) : null;

  const whatsLeft = showWhatsLeft ? (
    <CmeWhatsLeft
      set={set}
      statuses={statuses}
      yearCheck={yearCheck}
      totalHours={totalHours}
      nextStepRowId={nextStepRowId}
      onOpenDetail={setDetail}
    />
  ) : null;

  const routinesNode = !shows("routines-due") ? null : dueRoutines.length > 0 ? (
    <CmeGroup
      label={`Routines due · ${dueRoutines.length}`}
      end={snoozeButton("cpd-routines")}
      testId="cme-routines-due"
    >
      <CmeFlatList>
        {dueRoutines.map((routine) => {
          const Icon = routineIcon(routine.title);
          return (
            <CmeFlatRow
              key={routine.id}
              title={routine.title}
              subtitle={`${cmeRoutineCadenceLabels[routine.cadence]} · usually ${formatCmeHours(routine.usualHours)} h`}
              lead={<Icon aria-hidden="true" strokeWidth={1.6} />}
              end={
                <button
                  type="button"
                  className={cn(TEXT_ACTION, "pl-3")}
                  disabled={loggingDue}
                  aria-busy={loggingDue || undefined}
                  onClick={() => handleLogRoutine(routine)}
                >
                  {loggingDue ? "Saving…" : `Log ${formatCmeHours(routine.usualHours)} h`}
                </button>
              }
            />
          );
        })}
      </CmeFlatList>
    </CmeGroup>
  ) : nothingLogged && !hasActiveRoutine ? (
    <CmeGroup label="Routines" testId="cme-routines-setup">
      <CmeFlatList>
        <CmeFlatRow
          title="Set up a routine"
          subtitle="For things you do regularly, such as a peer review group"
          lead={<Users aria-hidden="true" strokeWidth={1.6} />}
          href={`/cme/routines?year=${set.year}`}
        />
      </CmeFlatList>
    </CmeGroup>
  ) : null;

  const reportingRow =
    showReportingReminder && reportingReminder ? (
      <CmeFlatRow
        testId="cme-reporting-reminder"
        href={`/cme/log?year=${reportingReminder.year}&copy=todo`}
        lead={<ClipboardCopy aria-hidden="true" strokeWidth={1.6} />}
        title={`${reportingReminder.notCopied} ${reportingReminder.notCopied === 1 ? "activity" : "activities"} from ${reportingReminder.year} not yet copied to MyCPD`}
        subtitle={`Your ${reportingReminder.year} claim closes on ${formatDayFullMonth(reportingReminder.closesOn)}`}
        end={snoozeButton("cpd-year-end")}
      />
    ) : null;

  const alsoForYou =
    hasTarget && !nothingLogged ? (
      <div {...{ [CME_TEACHING_ROW_ATTRIBUTE]: "" }}>
        <CmeGroup label="Also for you" testId="cme-also-for-you">
          <CmeFlatList>
            {reportingRow}
            <CmeFlatRow
              testId="cme-teaching-link"
              href={teachingCount !== null ? "/teaching/review" : "/teaching"}
              lead={<GraduationCap aria-hidden="true" strokeWidth={1.6} />}
              title="Teaching you gave"
              subtitle={
                teachingCount !== null
                  ? `${teachingCount} ${teachingCount === 1 ? "session is" : "sessions are"} not logged yet`
                  : "Sessions you gave, kept in Teaching"
              }
            />
            {culturallySafePracticeToLog ? (
              <CmeFlatRow
                testId="cme-first-nations-learning-link"
                href="/first-nations/talking"
                lead={<Feather aria-hidden="true" strokeWidth={1.6} />}
                title="Optional learning: First Nations Talking"
                subtitle="Opening it does not log CPD"
              />
            ) : null}
            {/* A plain next/link row (the kit row's look), so the route checker sees the one link to the calendar. */}
            <li className={cn(modeInsetHairline, "flex min-w-0 items-center before:left-0")}>
              <Link
                href={`/cme/calendar?year=${set.year}`}
                data-testid="cme-calendar-link"
                className={cn(
                  modeRowHeight.double,
                  modePressable,
                  focusRing,
                  "flex min-w-0 flex-1 items-center gap-3 no-underline",
                )}
              >
                <CalendarDays
                  aria-hidden="true"
                  strokeWidth={1.6}
                  className="size-icon-md shrink-0 text-[color:var(--text-muted)]"
                />
                <span className="grid min-w-0 flex-1 gap-px py-2">
                  <span className="break-words text-sm font-medium leading-5 text-[color:var(--text-heading)]">
                    CPD dates
                  </span>
                  <span className="line-clamp-2 break-words text-sm-minus leading-4.5 text-[color:var(--text-muted)]">
                    {nextDate ? `${formatCalendarDateShort(nextDate.date)}: ${nextDate.title}` : "Nothing coming up"}
                  </span>
                </span>
                <ChevronRight aria-hidden="true" className="size-icon-sm shrink-0 text-[color:var(--text-muted)]" />
              </Link>
            </li>
          </CmeFlatList>
        </CmeGroup>
      </div>
    ) : (
      // Before anything is logged the year-end claim reminder still shows; nothing else here applies yet.
      reportingRow && (
        <CmeGroup label="Also for you" testId="cme-also-for-you">
          <CmeFlatList>{reportingRow}</CmeFlatList>
        </CmeGroup>
      )
    );

  const targetsLine = set.confirmedOn
    ? `You confirmed ${describeConfirmedSource(set.confirmedSource)} on ${formatCalendarDateShort(set.confirmedOn)}.${nothingLogged ? "" : " A personal record, not independent certification."}`
    : "No targets confirmed yet. Set them up whenever you like.";

  const aboutRows: ReactNode[] = [];
  if (!nothingLogged && shows("audited-today")) {
    aboutRows.push(
      <CmeFlatRow
        key="today"
        testId="cme-audited-today"
        title="Today"
        subtitle={
          loggedToday.length > 0
            ? `${loggedToday.length} ${loggedToday.length === 1 ? "activity" : "activities"} logged, ${formatCmeHours(loggedTodayHours)} h`
            : "Nothing logged yet"
        }
      />,
    );
  }
  if (!nothingLogged && shows("year-dates")) {
    aboutRows.push(
      <CmeFlatRow
        key="year"
        testId="cme-year-dates"
        title="Year"
        subtitle={`1 January to 31 December${inRequestedYear ? ` · ${daysRemainingInCpdYear(now, set.year)} days left` : ""}`}
      />,
    );
  }
  if (shows("provenance")) {
    aboutRows.push(
      <CmeFlatRow
        key="targets"
        testId="cme-provenance"
        title="Targets"
        subtitle={targetsLine}
        href={`/cme/setup?year=${set.year}`}
      />,
    );
  }
  const about =
    aboutRows.length > 0 ? (
      <CmeGroup label="About this year" testId="cme-about-year">
        <CmeFlatList>{aboutRows}</CmeFlatList>
      </CmeGroup>
    ) : null;

  const byCategory = !hasTarget ? (
    <CmeGroup label="Logged by category" testId="cme-logged-by-category">
      <CmeCategoryLegend categoryHours={hoursByCategory(entries)} label="Logged by category" />
    </CmeGroup>
  ) : null;

  // Phone order is the DOM order; `LEFT` and `RIGHT` place each block on a computer.
  const body = (
    <div data-mode-identity="cme" data-testid="cme-year-body" className="grid min-w-0 gap-5.5 lg:block lg:flow-root">
      <div className={cn(LEFT, "grid gap-5.5")}>
        {summary}
        {logButton}
        {chips.length > 0 ? <CmeTodayShortcuts chips={chips} /> : null}
        {byCategory}
      </div>
      {nextStepNode || whatsLeft ? (
        <div className={cn(RIGHT, "grid gap-3")}>
          {nextStepNode}
          {whatsLeft}
        </div>
      ) : null}
      {routinesNode ? <div className={LEFT}>{routinesNode}</div> : null}
      {alsoForYou || about ? (
        <div className={cn(RIGHT, "grid gap-5.5")}>
          {alsoForYou}
          {about}
        </div>
      ) : null}
    </div>
  );

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-[calc(max(1rem,var(--safe-area-bottom))+2.5rem)] pt-6 sm:px-6 lg:max-w-5xl">
      <TodayShell mode="cme" modeName="CPD" status={status} now={body} nowSurface="own" />

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
