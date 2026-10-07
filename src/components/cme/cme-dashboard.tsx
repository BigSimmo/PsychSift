"use client";

import {
  BookOpen,
  CalendarDays,
  ChevronRight,
  ClipboardCopy,
  Feather,
  Layers,
  Plus,
  Presentation,
  Settings2,
  SlidersHorizontal,
  Users,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState, type MouseEvent, type ReactNode } from "react";

import { CmeCategoryLegend, CmeYearSummary } from "@/components/cme/cme-dashboard-catch-up";
import { CmeTodayDetailSheet, type CmeTodayDetail } from "@/components/cme/cme-dashboard-detail-sheet";
import { CmeNextStepRow, computeCmeNextStep, formatCmeHours } from "@/components/cme/cme-dashboard-next-step";
import { ApplicationsTodayCard } from "@/components/cme/applications/applications-today-card";
import { buildCmeYearChips, CmeTodayShortcuts } from "@/components/cme/cme-dashboard-shortcuts";
import { CmeWhatsLeft } from "@/components/cme/cme-dashboard-whats-left";
import { CmeFlatList, CmeFlatRow, CmeGroup } from "@/components/cme/cme-flat-list";
import { hoursByCategory } from "@/components/cme/cme-progress-visuals";
import { CME_LOG_TRIGGER_ATTRIBUTE, openCmeQuickLog } from "@/components/cme/cme-quick-log";
import { useCmeTeachingUnloggedCount } from "@/components/cme/cme-teaching-prompt";
import { CmeBandAction, CmeKvCard, cmeFreshnessEyebrow } from "@/components/cme/cme-work-kit";
import { CmeYearInWeeks } from "@/components/cme/cme-year-in-weeks";
import { WorkBody } from "@/components/mode-kit/work";
import { Button } from "@/components/ui/button";
import { addDays, expandEvents } from "@/lib/calendar/calendar-event";
import { cmeCalendarEvents } from "@/lib/cme/calendar-events";
import { buildCmeCatchUpPlan } from "@/lib/cme/catch-up-plan";
import { cpdYearOf, daysRemainingInCpdYear, formatCalendarDateShort, perthCalendarDate } from "@/lib/cme/cpd-year";
import { evaluateYear } from "@/lib/cme/evaluate";
import { useCmeModuleOrder, type CmeDashboardModuleId } from "@/lib/cme/module-order";
import { cmeRoutineGapScenarios, cmeWeeklyPace } from "@/lib/cme/pace";
import type { CmePlanGoal } from "@/lib/cme/plan-goals";
import { readCpdHome } from "@/lib/cme/home-choice";
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
import {
  ModeBandStatus,
  useModeBandCount,
  useModeBandHeading,
  useModeBandShown,
} from "@/components/mode-band/mode-band";

/**
 * THE YEAR PAGE (`/cme`, the band's Summary tab): the screen the whole mode is
 * judged by. Work-mode redesign (owner request 6 Oct 2026, mockup cpd_sum,
 * cpd_empty, cpd_gap): urgent first, on white cards under the copper band.
 *
 *   1. the copper hero: hours against the target, the category bar, the
 *      legend and the pace panel (which opens "Close the gap");
 *   2. "To log": teaching sessions not yet logged and routines due today, each
 *      with its own Log, and "Snooze a week";
 *   3. "What's left": the next step first, then the year check's open items;
 *   4. "Records to tidy": chips (not marked copied, no reflection, drafts);
 *   5. "Also for you", then "About this year";
 *   6. the floating dock: "Log an activity" (it opens the quick-log sheet).
 *
 * What follows is the earlier (5 Oct) description, which still holds for the
 * data and the honest variants:
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

/** The label's quiet link ("Snooze a week") keeps a 48px tap without a tall label row. */
const LABEL_ACTION = "work-label__link min-h-tap";

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
  readonly draftsToFinish?: number | null;
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
  const today = perthCalendarDate(now);
  // The year's sums and plans walk every entry, so they are worked out once per change of input, not per render.
  const derived = useMemo(() => {
    const evaluation = evaluateYear({ set, entries });
    const catchUpPlan = buildCmeCatchUpPlan({ set, entries, routines, today });
    return {
      evaluation,
      yearCheck: buildCmeYearCheck(set, entries),
      categoryHours: hoursByCategory(entries),
      nextDate: expandEvents(cmeCalendarEvents({ set, entries, routines }).exported, {
        start: today,
        end: addDays(today, 400),
      })[0],
      catchUp: catchUpPlan,
      // The same rule as the pace line: no weekly figure in the first four weeks or the last week.
      weeklyPace: cmeWeeklyPace({
        targetHours: set.totalHours,
        loggedHours: evaluation.totalHours,
        today,
        year: set.year,
      }),
      gapScenarios: cmeRoutineGapScenarios(routines, catchUpPlan.hoursToGo, undefined, { today, year: set.year }),
    };
  }, [set, entries, routines, today]);
  const { totalHours, statuses, unmet } = derived.evaluation;
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

  const underBand = useModeBandShown();
  // The drafts waiting to be finished live under Log, so its tab carries them.
  useModeBandCount("log", draftsToFinish);
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
        className={LABEL_ACTION}
        aria-label={`Snooze for a week: ${REMINDER_TYPE_LABELS[type]}`}
        onClick={() => onSnoozeReminder(type)}
      >
        Snooze a week
      </button>
    );
  }

  // A due routine is listed, with its own Log link, under "Routines due", never
  // in the next-step slot, which would hide the requirement gap and the
  // year-end reminder whenever anything recurring was due.
  const nextStep = computeCmeNextStep({ set, unmet, now, totalHours });
  // The year-end checklist (copying, self-evaluation, goal carry, next year, summary) opens from the Year page.
  const offerYearEnd = canOfferCmeYearEnd(set, now);
  const { yearCheck } = derived;
  // The step rides inside "What's left" while that list is shown; hidden in
  // Customise (or before anything is logged), the standalone row carries it instead.
  const showWhatsLeft = hasTarget && !nothingLogged && shows("requirements");
  const nextStepRowId = !offerYearEnd && showWhatsLeft ? nextStep.rowId : null;
  // Before anything is logged only the drafts chip can say something true, so it alone still shows.
  const yearChips = hasTarget ? buildCmeYearChips({ year: set.year, yearCheck, draftsToFinish }) : [];
  const chips = nothingLogged ? yearChips.filter((chip) => chip.id === "drafts") : yearChips;

  const { nextDate, catchUp, weeklyPace, gapScenarios } = derived;
  const totalGap = catchUp.hoursToGo;

  function handleLogRoutine(routine: CmeRoutine) {
    onLogRoutine(routineLogPrefill(routine, now));
  }

  function handleLogActivity(event: MouseEvent<HTMLAnchorElement>) {
    // Opens the quick-log panel where the route provides one; otherwise the link opens the full page.
    if (openCmeQuickLog(event.currentTarget)) event.preventDefault();
  }

  // The band names the page: when its records loaded, then "CPD 2026".
  useModeBandHeading({
    eyebrow: cmeFreshnessEyebrow({
      demoMode,
      loadedAt: now,
      failed: draftsToFinish === null ? "Drafts did not load" : null,
    }),
    title: `CPD ${set.year}`,
  });

  const status = (
    <>
      {/* The band above the page names the mode and the page; the h1 still names it for screen readers. */}
      <h1 className="sr-only">Year</h1>
      <ModeBandStatus
        testId="cme-data-freshness"
        value={
          demoMode
            ? { kind: "sample" }
            : draftsToFinish === null
              ? { kind: "failed", text: "Drafts didn't load · no count shown" }
              : { kind: "loaded", at: now }
        }
      />
      {underBand ? (
        <CmeBandAction icon={SlidersHorizontal} label="Customise" href="/cme/customise" testId="cme-customise-action" />
      ) : (
        <div className="flex justify-end">
          <Button variant="toolbar" size="sm" icon={Settings2} onClick={onOpenCustomise}>
            Customise
          </Button>
        </div>
      )}
    </>
  );

  const logLink = (label: string, className: string) => (
    <Link
      href={`/cme/new?year=${set.year}`}
      onClick={handleLogActivity}
      data-testid="cme-log-activity"
      {...{ [CME_LOG_TRIGGER_ATTRIBUTE]: "" }}
      className={className}
      data-variant="primary"
    >
      <Plus aria-hidden="true" className="size-4" strokeWidth={2} />
      {label}
    </Link>
  );

  const summary = (
    <CmeYearSummary
      year={set.year}
      today={today}
      loggedHours={totalHours}
      targetHours={set.totalHours}
      categoryHours={derived.categoryHours}
      plan={catchUp}
      weeklyHours={weeklyPace !== null && weeklyPace.weeksLeft >= 1 ? weeklyPace.weeklyHours : null}
      entries={entries}
      closed={Boolean(set.closedAt)}
      onOpenGap={() => setDetail("gap")}
      firstLogAction={nothingLogged ? logLink("Log your first activity", "work-button min-h-tap mt-2") : undefined}
    />
  );

  const trainingLink =
    currentTrainingPosition?.stage || currentTrainingPosition?.rotation || currentTrainingPosition?.breakPeriod ? (
      <CmeFlatList label="Training">
        <li className="flex min-w-0 items-center">
          <Link
            href="/cme/training"
            data-testid="cme-training-position-link"
            className="work-row min-h-tap min-w-0 flex-1"
          >
            <span className="cpd-lead">
              <Layers aria-hidden="true" strokeWidth={2} />
            </span>
            <span className="work-row__text">
              <span className="work-row__title">
                {currentTrainingPosition.stage?.label ?? "Training"}
                {currentTrainingPosition.onBreak
                  ? ` · on break${currentTrainingPosition.breakPeriod ? `: ${currentTrainingPosition.breakPeriod.label}` : ""}`
                  : currentTrainingPosition.rotationIndex !== null && currentTrainingPosition.rotationCount !== null
                    ? ` · rotation ${currentTrainingPosition.rotationIndex} of ${currentTrainingPosition.rotationCount}`
                    : currentTrainingPosition.rotation
                      ? ` · ${currentTrainingPosition.rotation.label}`
                      : ""}
              </span>
              <span className="work-row__sub">Your training clock</span>
            </span>
            <ChevronRight aria-hidden="true" className="work-row__chev" />
          </Link>
        </li>
      </CmeFlatList>
    ) : null;

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

  // Teaching's own count of sessions given and not yet logged: Teaching's review list logs them.
  const teachingRow = (
    <CmeFlatRow
      testId="cme-teaching-link"
      href={teachingCount !== null ? "/teaching/review" : "/teaching"}
      lead={<Presentation aria-hidden="true" strokeWidth={2} />}
      leadTone="mode"
      title="Teaching you gave"
      subtitle={
        teachingCount !== null
          ? `${teachingCount} ${teachingCount === 1 ? "session is" : "sessions are"} not logged yet`
          : "Sessions you gave, kept in Teaching"
      }
    />
  );
  const teachingToLog = teachingCount !== null && teachingCount > 0;

  const routinesShown = shows("routines-due");
  const toLog =
    routinesShown && (dueRoutines.length > 0 || teachingToLog) ? (
      <CmeGroup
        label="To log"
        end={dueRoutines.length > 0 ? snoozeButton("cpd-routines") : null}
        testId={dueRoutines.length > 0 ? "cme-routines-due" : "cme-to-log"}
      >
        <CmeFlatList>
          {teachingToLog ? teachingRow : null}
          {dueRoutines.map((routine) => {
            const Icon = routineIcon(routine.title);
            return (
              <CmeFlatRow
                key={routine.id}
                title={routine.title}
                subtitle={`${cmeRoutineCadenceLabels[routine.cadence]} · usually ${formatCmeHours(routine.usualHours)} h`}
                lead={<Icon aria-hidden="true" strokeWidth={2} />}
                leadTone="mode"
                end={
                  <button
                    type="button"
                    className="work-button min-h-tap"
                    data-variant="tinted"
                    disabled={loggingDue}
                    aria-busy={loggingDue || undefined}
                    onClick={() => handleLogRoutine(routine)}
                  >
                    <span className="nums">
                      {loggingDue ? "Saving…" : `Log ${formatCmeHours(routine.usualHours)} h`}
                    </span>
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
            subtitle="For things you do regularly, like a peer review group"
            lead={<CalendarDays aria-hidden="true" strokeWidth={2} />}
            leadTone="mode"
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
        lead={<ClipboardCopy aria-hidden="true" strokeWidth={2} />}
        title={`${reportingReminder.notCopied} ${reportingReminder.notCopied === 1 ? "activity" : "activities"} from ${reportingReminder.year} not marked copied to MyCPD`}
        subtitle={`Your ${reportingReminder.year} claim closes on ${formatDayFullMonth(reportingReminder.closesOn)}`}
        end={snoozeButton("cpd-year-end")}
      />
    ) : null;

  // Hiding "Also for you" in Customise hides teaching, optional learning and
  // CPD dates. The year-end claim reminder still shows: it has a deadline.
  const alsoForYou =
    hasTarget && !nothingLogged && shows("also-for-you") ? (
      <CmeGroup label="Also for you" testId="cme-also-for-you">
        <CmeFlatList>
          {reportingRow}
          {teachingToLog ? null : teachingRow}
          {culturallySafePracticeToLog ? (
            <CmeFlatRow
              testId="cme-first-nations-learning-link"
              href="/first-nations/talking"
              lead={<Feather aria-hidden="true" strokeWidth={2} />}
              title="Optional learning: First Nations Talking"
              subtitle="Opening it does not log CPD"
            />
          ) : null}
          {/* A plain next/link row (the kit row's look), so the route checker sees the one link to the calendar. */}
          <li className="flex min-w-0 items-center">
            <Link
              href={`/cme/calendar?year=${set.year}`}
              data-testid="cme-calendar-link"
              className="work-row min-h-tap min-w-0 flex-1"
            >
              <span aria-hidden="true" className="work-ic" data-mode-identity="my-day">
                <CalendarDays aria-hidden="true" strokeWidth={2} />
              </span>
              <span className="work-row__text">
                <span className="work-row__title">CPD dates</span>
                <span className="work-row__sub line-clamp-2">
                  {nextDate ? `${formatCalendarDateShort(nextDate.date)}: ${nextDate.title}` : "Nothing coming up"}
                </span>
              </span>
              <ChevronRight aria-hidden="true" className="work-row__chev" />
            </Link>
          </li>
        </CmeFlatList>
      </CmeGroup>
    ) : (
      // Before anything is logged the year-end claim reminder still shows; nothing else here applies yet.
      reportingRow && (
        <CmeGroup label="Also for you" testId="cme-also-for-you">
          <CmeFlatList>{reportingRow}</CmeFlatList>
        </CmeGroup>
      )
    );

  const home = readCpdHome(set.confirmedSource);
  const targetsLine = set.confirmedOn
    ? `You confirmed ${home.kind === "ranzcp" ? "the RANZCP starting set" : describeConfirmedSource(set.confirmedSource)} on ${formatCalendarDateShort(set.confirmedOn)}.${nothingLogged ? "" : " A personal record, not independent certification."}`
    : "No targets confirmed yet. Set them up whenever you like.";

  const aboutFacts: { label: string; value: string; testId: string }[] = [];
  if (shows("year-dates")) {
    aboutFacts.push({
      label: "Year",
      value: `1 Jan to 31 Dec${inRequestedYear && !nothingLogged ? ` · ${daysRemainingInCpdYear(now, set.year)} days left` : ""}`,
      testId: "cme-year-dates",
    });
  }
  if (set.confirmedOn && (home.kind === "ranzcp" || home.name)) {
    aboutFacts.push({
      label: "CPD home",
      value: home.kind === "ranzcp" ? "RANZCP" : home.name,
      testId: "cme-cpd-home",
    });
  }
  if (!nothingLogged && shows("audited-today")) {
    aboutFacts.push({
      label: "Today",
      value:
        loggedToday.length > 0
          ? `${loggedToday.length} ${loggedToday.length === 1 ? "activity" : "activities"}, ${formatCmeHours(loggedTodayHours)} h`
          : "Nothing logged yet",
      testId: "cme-audited-today",
    });
  }
  const aboutRows: ReactNode[] = [];
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
  // "What's left" carries the only other link to the Report; when it is hidden this row keeps the
  // Report (exports, closing the year, Customise) one tap away.
  if (!showWhatsLeft) {
    aboutRows.push(
      <CmeFlatRow
        key="check"
        testId="cme-about-year-check"
        title="Report"
        subtitle="The year check, exports and closing the year"
        href={`/cme/check?year=${set.year}`}
      />,
    );
  }
  const about =
    aboutFacts.length > 0 || aboutRows.length > 0 || trainingLink ? (
      <CmeGroup label="About this year" testId="cme-about-year">
        {aboutFacts.length > 0 ? (
          <CmeKvCard
            label="This year"
            rows={aboutFacts.map((fact) => ({ label: fact.label, value: fact.value, testId: fact.testId }))}
          />
        ) : null}
        {aboutRows.length > 0 ? <CmeFlatList>{aboutRows}</CmeFlatList> : null}
        {trainingLink}
      </CmeGroup>
    ) : null;

  const byCategory = !hasTarget ? (
    <CmeGroup label="Logged by category" testId="cme-logged-by-category">
      <div className="work-card px-3">
        <CmeCategoryLegend categoryHours={derived.categoryHours} label="Logged by category" />
      </div>
    </CmeGroup>
  ) : null;

  const chipsNode =
    chips.length > 0 ? (
      <CmeGroup label="Records to tidy" testId="cme-records-to-tidy">
        <CmeTodayShortcuts chips={chips} />
      </CmeGroup>
    ) : null;

  // The dock: the one filled button. Before anything is logged it lives in the empty card instead.
  const dock = nothingLogged ? null : (
    <div className="work-dock" role="group" aria-label="Actions">
      <div className="work-dock__capsule">{logLink("Log an activity", "work-button min-h-tap")}</div>
    </div>
  );

  return (
    <main className="w-full" data-testid="cme-year-page">
      <div className="contents">{status}</div>
      <div data-mode-identity="cme" data-testid="cme-year-body" className="min-w-0">
        <WorkBody>
          {summary}
          {nextStepNode}
          {toLog}
          {whatsLeft}
          {chipsNode}
          <ApplicationsTodayCard today={today} />
          {byCategory}
          {alsoForYou}
          {about}
          {dock}
        </WorkBody>
      </div>

      <CmeTodayDetailSheet
        detail={detail}
        onClose={() => setDetail(null)}
        set={set}
        statuses={statuses}
        yearEntries={yearEntries}
        totalHours={totalHours}
        totalGap={totalGap}
        gapScenarios={gapScenarios}
        routineEstimateHours={catchUp.status === "plan" ? catchUp.routineEstimateHours : 0}
        remainingAfterRoutines={catchUp.status === "plan" ? catchUp.remainingAfterRoutines : null}
        stillToFindWeekly={
          catchUp.status === "plan" && weeklyPace !== null && weeklyPace.weeksLeft >= 1 ? catchUp.hoursPerWeek : null
        }
        weeks={hasTarget && !nothingLogged ? <CmeYearInWeeks entries={entries} year={set.year} today={today} /> : null}
      />
    </main>
  );
}
