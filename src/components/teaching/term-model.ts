import { withUnit } from "@/components/teaching/teaching-number";
import {
  dayMonth,
  daysBetween,
  milestoneIds,
  milestoneState,
  termWeekCount,
  termWeekOf,
  weekdayDayMonth,
  type MilestoneId,
  type MilestoneState,
  type TermRecord,
} from "@/lib/teaching/term-tracker";

/* Pure shaping for Term (mock-up v5 screens 04, 11 and 15). Dates are Perth calendar keys. */

/** The short names the v5 rows use; the long names stay in the form and in screen-reader labels. */
export const MILESTONE_TITLES: Record<MilestoneId, string> = {
  start: "Beginning of term",
  mid: "Mid-term",
  end: "End of term",
};

const inDays = (days: number) => (days === 0 ? "today" : days === 1 ? "in 1 day" : `in ${days} days`);

export type TermPanel = {
  /** "Term 4 · Psychiatry · Example Hospital". */
  kicker: string;
  /** "Week 6 of 10", "Starts Mon 31 Aug", "Term finished". */
  heading: string;
  /** "31 Aug to 6 Nov · mid-term due in 9 days". */
  meta: string;
  weeks: ("done" | "now" | "later")[];
  week: number;
  total: number;
  finished: boolean;
};

export function termPanel(term: TermRecord, today: string): TermPanel {
  const total = termWeekCount(term);
  const week = termWeekOf(term, today);
  const finished = week > total;
  const heading =
    week === 0
      ? `Starts ${weekdayDayMonth(term.startsOn)}`
      : finished
        ? "Term finished"
        : `Week ${withUnit(week, "of")} ${total}`;
  // The next one still ahead; an overdue one has its own warning, so this line looks forward.
  const ahead = milestoneIds.find((id) => !term.milestones[id].doneOn && term.milestones[id].dueOn >= today) ?? null;
  const next = ahead
    ? `${MILESTONE_TITLES[ahead].toLowerCase()}${ahead === "end" ? "" : " due"} ${inDays(daysBetween(today, term.milestones[ahead].dueOn))}`
    : null;
  return {
    kicker: [term.number ? `Term ${term.number}` : null, term.unit, term.site].filter(Boolean).join(" · "),
    heading,
    meta: [`${dayMonth(term.startsOn)} to ${dayMonth(term.endsOn)}`, finished ? null : next]
      .filter(Boolean)
      .join(" · "),
    weeks: Array.from({ length: total }, (_, index) =>
      index + 1 < week ? "done" : index + 1 === week ? "now" : "later",
    ),
    week,
    total,
    finished,
  };
}

export type MilestoneRow = {
  id: MilestoneId;
  title: string;
  meta: string;
  state: MilestoneState;
  action: "mark" | "undo" | null;
};

/** The three assessments, any overdue one first (screen 15), each with at most one action. */
export function milestoneRows(term: TermRecord, today: string): MilestoneRow[] {
  const rows = milestoneIds.map((id): MilestoneRow => {
    const milestone = term.milestones[id];
    const state = milestoneState(term, id, today);
    const due = weekdayDayMonth(milestone.dueOn);
    const meta =
      state === "done" && milestone.doneOn
        ? `Done ${weekdayDayMonth(milestone.doneOn)}`
        : state === "overdue"
          ? `Overdue · was due ${due}`
          : state === "due"
            ? `Due ${due} · ${inDays(daysBetween(today, milestone.dueOn))}`
            : `Due ${due}`;
    return {
      id,
      title: MILESTONE_TITLES[id],
      meta,
      state,
      action: state === "done" ? "undo" : state === "later" ? null : "mark",
    };
  });
  return [...rows.filter((row) => row.state === "overdue"), ...rows.filter((row) => row.state !== "overdue")];
}

/** "Mid-term was due Thu 15 Oct and is not marked done." for the earliest overdue one; null when none. */
export function overdueNote(term: TermRecord, today: string): string | null {
  const id = milestoneIds.find((m) => milestoneState(term, m, today) === "overdue");
  return id
    ? `${MILESTONE_TITLES[id]} was due ${weekdayDayMonth(term.milestones[id].dueOn)} and is not marked done.`
    : null;
}
