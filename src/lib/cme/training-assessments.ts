import { formatCmeRowDate } from "@/lib/cme/cpd-year";
import type { NextMilestone, TrainingMilestone, TrainingPeriod, TrainingPosition } from "@/lib/cme/training-timeline";

/**
 * EPAs, WBAs, term assessments and clinical experience (A to D) on the
 * Training page, as a pure typed input.
 *
 * PsychSift has NO storage for any of these: no table, no API route, no
 * browser storage. So the page is only ever given one of two things:
 *
 * - `sample`: the invented example records from the approved mock-up
 *   (`training-assessments-sample.ts`), shown in the signed-out sample and in
 *   demo mode, and labelled as examples on the page.
 * - `not-recorded`: what every signed-in doctor gets. The page then shows the
 *   headings with an honest line and NO counts, because a count of 0 would
 *   read as if PsychSift had looked and found nothing.
 *
 * Every helper here is plain arithmetic and wording on that input. Nothing
 * here decides whether a requirement is met; the college, the term
 * supervisor or the medical education unit has the final word.
 */

/** One EPA in a registrar's rotation, as the mock-up shows it. */
export type TrainingEpa = {
  readonly id: string;
  readonly title: string;
  /** WBAs logged against this EPA so far. */
  readonly wbasLogged: number;
  /** An assessor's name. Only ever set in the sample fixture; PsychSift never stores one. */
  readonly assessor: string | null;
  /** The day the doctor marked the EPA attained (Perth `YYYY-MM-DD`), or null. */
  readonly attainedOn: string | null;
};

export type RegistrarAssessments = {
  readonly rotationEndsOn: string;
  /** RANZCP minimum EPAs for a 6-month full-time rotation (not signed off). */
  readonly minimumEpas: number;
  /** WBAs shown against each EPA (RANZCP: 3). */
  readonly wbasPerEpa: number;
  readonly epas: readonly TrainingEpa[];
};

export type InternTerm = {
  readonly number: number;
  readonly startsOn: string;
  readonly endsOn: string;
  /** EPA assessments logged in the term. */
  readonly epaCount: number;
};

type ClinicalExperienceCategory = "A" | "B" | "C" | "D";

export type ClinicalExperienceRow = {
  readonly category: ClinicalExperienceCategory;
  readonly label: string;
  /** Term numbers in which this category was covered. */
  readonly coveredTerms: readonly number[];
};

export type InternAssessments = {
  readonly year: number;
  readonly termName: string;
  readonly currentTerm: number;
  readonly midTermAssessmentOn: string;
  readonly terms: readonly InternTerm[];
  /** AMC framework figures, as written in the mock-up (not signed off). */
  readonly annualMinimum: number;
  readonly perTermMinimum: number;
  /** Terms each clinical-experience category is counted against ("2 of 3"). */
  readonly experienceTermsNeeded: number;
  readonly experience: readonly ClinicalExperienceRow[];
};

export type CmeTrainingAssessments =
  | { readonly status: "sample"; readonly view: "registrar"; readonly registrar: RegistrarAssessments }
  | { readonly status: "sample"; readonly view: "intern"; readonly intern: InternAssessments }
  | { readonly status: "not-recorded" };

export type TrainingExampleView = "registrar" | "intern";

/** The `?example=` search param read as a view. Anything but "intern" is the registrar example. */
export function trainingExampleView(param: string | string[] | null | undefined): TrainingExampleView {
  const value = Array.isArray(param) ? param[0] : param;
  return value === "intern" ? "intern" : "registrar";
}

const MS_PER_DAY = 86_400_000;
const FULL_MONTHS = [
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
const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

function dayNumber(dateOnly: string): number {
  return Math.round(Date.parse(`${dateOnly}T00:00:00Z`) / MS_PER_DAY);
}

/** "today", "tomorrow", "in 12 days", "in 4 weeks", "in about 17 weeks". Both dates are Perth `YYYY-MM-DD`. */
export function timeUntil(today: string, date: string): string {
  const days = dayNumber(date) - dayNumber(today);
  if (days < 0) return days === -1 ? "yesterday" : `${-days} days ago`;
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days < 14) return `in ${days} days`;
  return days % 7 === 0 ? `in ${days / 7} weeks` : `in about ${Math.round(days / 7)} weeks`;
}

/** "x of y". */
export function xOfY(x: number, y: number): string {
  return `${x} of ${y}`;
}

/** "29 January": day and full month, no year. */
export function formatDayFullMonth(dateOnly: string): string {
  const [, month, day] = dateOnly.split("-");
  return `${Number.parseInt(day, 10)} ${FULL_MONTHS[Number.parseInt(month, 10) - 1]}`;
}

/** "Nov": the short month a date falls in. */
export function formatShortMonth(dateOnly: string): string {
  return SHORT_MONTHS[Number.parseInt(dateOnly.split("-")[1], 10) - 1];
}

// ---------------------------------------------------------------------------
// Registrar: EPAs this rotation
// ---------------------------------------------------------------------------

export function attainedEpas(registrar: RegistrarAssessments): readonly TrainingEpa[] {
  return registrar.epas.filter((epa) => epa.attainedOn !== null);
}

export function epasInProgress(registrar: RegistrarAssessments): readonly TrainingEpa[] {
  return registrar.epas.filter((epa) => epa.attainedOn === null);
}

/**
 * "At least 1 more by 29 January. The minimum is 2 for each 6-month full-time
 * rotation, pro rata if part-time." Once the minimum is reached, it says so.
 */
export function epaNextBySentence(attained: number, minimum: number, rotationEndsOn: string): string {
  const rule = `The minimum is ${minimum} for each 6-month full-time rotation, pro rata if part-time.`;
  const left = minimum - attained;
  if (left <= 0) return `You have marked ${attained} attained this rotation. ${rule}`;
  return `At least ${left} more by ${formatDayFullMonth(rotationEndsOn)}. ${rule}`;
}

/** The second line of an EPA row, in the mock-up's words. */
export function epaRowDetail(epa: TrainingEpa, wbasPerEpa: number): string {
  if (epa.attainedOn !== null) {
    const [, month, day] = epa.attainedOn.split("-");
    return `You marked it attained on ${Number.parseInt(day, 10)} ${SHORT_MONTHS[Number.parseInt(month, 10) - 1]} · keep your COE form in InTrain`;
  }
  const logged = `${xOfY(epa.wbasLogged, wbasPerEpa)} WBAs logged`;
  if (epa.wbasLogged === 0) return `${logged} · not started`;
  return epa.assessor ? `${logged} · ${epa.assessor}` : logged;
}

/** The sentence a screen reader hears for the "1 of 2" segments. */
export function epaSegmentsSentence(attained: number, minimum: number): string {
  return `${attained} of the minimum ${minimum} EPAs marked attained this rotation.`;
}

// ---------------------------------------------------------------------------
// Intern: this term, EPA assessments, clinical experience
// ---------------------------------------------------------------------------

/** "week 3 of 10": the week today falls in, of the term's whole weeks (both dates count). */
export function termWeek(today: string, startsOn: string, endsOn: string): { week: number; weeks: number } {
  const weeks = Math.ceil((dayNumber(endsOn) - dayNumber(startsOn) + 1) / 7);
  const elapsed = dayNumber(today) - dayNumber(startsOn);
  const week = Math.min(weeks, Math.max(1, Math.floor(elapsed / 7) + 1));
  return { week, weeks };
}

/** "Mon 14 Sep to Sun 22 Nov · week 3 of 10". */
export function termRowDetail(today: string, term: InternTerm): string {
  const { week, weeks } = termWeek(today, term.startsOn, term.endsOn);
  return `${formatCmeRowDate(term.startsOn, today)} to ${formatCmeRowDate(term.endsOn, today)} · week ${xOfY(week, weeks)}`;
}

export function epaAssessmentsLogged(intern: InternAssessments): number {
  return intern.terms.reduce((sum, term) => sum + term.epaCount, 0);
}

type TermBarState = "done" | "current" | "future";

export type TermBar = {
  readonly number: number;
  readonly state: TermBarState;
  readonly count: number;
  /** The figure under the term: "3", "0 of 2" for the current term, "Nov" for a term not started. */
  readonly caption: string;
};

export function termBars(intern: InternAssessments): readonly TermBar[] {
  return intern.terms.map((term) => {
    const state: TermBarState =
      term.number < intern.currentTerm ? "done" : term.number === intern.currentTerm ? "current" : "future";
    const caption =
      state === "done"
        ? String(term.epaCount)
        : state === "current"
          ? xOfY(term.epaCount, intern.perTermMinimum)
          : formatShortMonth(term.startsOn);
    return { number: term.number, state, count: term.epaCount, caption };
  });
}

/** "Term 1: 3, term 2: 2, term 3: 2, term 4: 0 so far, term 5 not started." */
export function termChartSentence(bars: readonly TermBar[]): string {
  const parts = bars.map((bar, index) => {
    const name = `${index === 0 ? "Term" : "term"} ${bar.number}`;
    if (bar.state === "future") return `${name} not started`;
    return `${name}: ${bar.count}${bar.state === "current" ? " so far" : ""}`;
  });
  return `${parts.join(", ")}.`;
}

/** "logged · at least 10 a year, at least 2 each term". */
export function epaAssessmentsRuleLine(intern: InternAssessments): string {
  return `logged · at least ${intern.annualMinimum} a year, at least ${intern.perTermMinimum} each term`;
}

export type ExperienceCellState = "covered" | "current" | "open";

/** One cell of the A to D grid: covered in a finished term, this term (not finished), or not covered. */
export function experienceCell(row: ClinicalExperienceRow, term: number, currentTerm: number): ExperienceCellState {
  if (row.coveredTerms.includes(term)) return "covered";
  return term === currentTerm ? "current" : "open";
}

/** "2 of 3": terms covered against the terms needed. */
export function experienceCount(row: ClinicalExperienceRow, needed: number): string {
  return xOfY(row.coveredTerms.length, needed);
}

// ---------------------------------------------------------------------------
// The training record summary rows (registrar)
// ---------------------------------------------------------------------------

/** "Stage 3 · rotation 2 of 4 · 1 rotation done", from the doctor's own periods. */
export function trainingRecordSummary(
  periods: readonly TrainingPeriod[],
  position: TrainingPosition,
  today: string,
): string {
  if (periods.length === 0) return "Nothing recorded yet";
  const parts: string[] = [position.stage ? position.stage.label : "No stage covers today"];
  if (position.onBreak) parts.push("on a break");
  else if (position.rotationIndex !== null && position.rotationCount !== null) {
    parts.push(`rotation ${xOfY(position.rotationIndex, position.rotationCount)}`);
  }
  const done = periods.filter(
    (period) => period.kind === "rotation" && period.endsOn !== null && period.endsOn < today,
  );
  if (done.length > 0) parts.push(`${done.length} ${done.length === 1 ? "rotation" : "rotations"} done`);
  return parts.join(" · ");
}

/** "3 open · next Mon 2 Nov". */
export function milestoneSummary(
  milestones: readonly TrainingMilestone[],
  next: NextMilestone | null,
  today: string,
): string {
  if (milestones.length === 0) return "None yet";
  const open = milestones.filter((milestone) => milestone.completedOn === null).length;
  if (open === 0) return "Every milestone is marked done";
  const head = `${open} open`;
  if (!next?.projectedOn) return head;
  const date = formatCmeRowDate(next.projectedOn, today);
  return next.overdue ? `${head} · overdue since ${date}` : `${head} · next ${date}`;
}
