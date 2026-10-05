import type { LearningDirectoryItem } from "@/lib/cme/learning-directory";
import { cmeLearningFromSourceHref } from "@/lib/cme/learning-source";

/** A list older than this is flagged as possibly out of date. */
export const LEARNING_DIRECTORY_STALE_AFTER_DAYS = 45;
const MS_PER_DAY = 86_400_000;

function byStartThenTitle(a: LearningDirectoryItem, b: LearningDirectoryItem): number {
  if (a.startsOn !== b.startsOn) {
    if (a.startsOn === null) return 1;
    if (b.startsOn === null) return -1;
    return a.startsOn < b.startsOn ? -1 : 1;
  }
  return a.title.localeCompare(b.title, "en-AU");
}

/**
 * The dated list: items whose dates were confirmed and which have not finished
 * before `todayPerth`. An item finishes on its `endsOn`, or on its `startsOn`
 * when it has no end date; an item running today still shows. A recorded item
 * with no date always shows. Sorted by start date, undated last.
 *
 * Items whose dates are unconfirmed are excluded here — see
 * `unconfirmedLearningItems` — because a date nobody confirmed must not be the
 * reason something disappears.
 */
export function upcomingLearningItems(
  items: readonly LearningDirectoryItem[],
  todayPerth: string,
): LearningDirectoryItem[] {
  return items
    .filter((item) => item.datesConfirmed)
    .filter((item) => {
      const finishesOn = item.endsOn ?? item.startsOn;
      return finishesOn === null || finishesOn >= todayPerth;
    })
    .sort(byStartThenTitle);
}

/** Items whose dates could not be confirmed. They never drop off automatically. */
export function unconfirmedLearningItems(items: readonly LearningDirectoryItem[]): LearningDirectoryItem[] {
  return items.filter((item) => !item.datesConfirmed).sort(byStartThenTitle);
}

export type LearningFormat = "any" | "online" | "in-person";
export type LearningSpecialty = "all" | string;

/** Only the confirmed RANZCP preset selects psychiatry; other homes start at All. */
export function defaultLearningSpecialty(confirmedSource: string | null | undefined): LearningSpecialty {
  return /^au-ranzcp-\d{4}-v\d+\b/.test(confirmedSource?.trim() ?? "") ? "psychiatry" : "all";
}

/** Missing specialties means all; mixed-mode events pass either format. */
export function filterLearningItems(
  items: readonly LearningDirectoryItem[],
  filters: { specialty: LearningSpecialty; format: LearningFormat },
): LearningDirectoryItem[] {
  return items.filter(
    (item) =>
      (filters.specialty === "all" || !item.specialties?.length || item.specialties.includes(filters.specialty)) &&
      (filters.format === "any" || item.mode === "both" || item.mode === filters.format),
  );
}

/** Confirmed events that have finished before today, newest first. */
export function pastLearningItems(
  items: readonly LearningDirectoryItem[],
  todayPerth: string,
): LearningDirectoryItem[] {
  return items
    .filter((item) => item.datesConfirmed && (item.endsOn ?? item.startsOn) !== null)
    .filter((item) => (item.endsOn ?? item.startsOn)! < todayPerth)
    .sort((a, b) => byStartThenTitle(b, a));
}

export type LearningMonthGroup = {
  readonly key: string;
  readonly label: string;
  readonly items: readonly LearningDirectoryItem[];
};

/** Calendar-month groups for the selected list; undated recorded items stay in Any time. */
export function groupLearningByMonth(items: readonly LearningDirectoryItem[]): LearningMonthGroup[] {
  const grouped = new Map<string, LearningDirectoryItem[]>();
  for (const item of items) {
    const key = item.startsOn?.slice(0, 7) ?? "any-time";
    const month = grouped.get(key) ?? [];
    month.push(item);
    grouped.set(key, month);
  }
  return [...grouped].map(([key, monthItems]) => ({
    key,
    label:
      key === "any-time"
        ? "Any time"
        : new Intl.DateTimeFormat("en-AU", { month: "long", year: "numeric", timeZone: "UTC" }).format(
            new Date(`${key}-01T00:00:00Z`),
          ),
    items: monthItems,
  }));
}

/** Whole calendar days from `todayPerth` to `startsOn`; a start already passed counts as 0. */
export function daysUntilLearningStart(startsOn: string, todayPerth: string): number {
  const days = (Date.parse(`${startsOn}T00:00:00Z`) - Date.parse(`${todayPerth}T00:00:00Z`)) / MS_PER_DAY;
  return Math.max(0, Math.round(days));
}

/** "Today", "Tomorrow" or "In 20 days" for the countdown chip. */
export function learningCountdownLabel(startsOn: string, todayPerth: string): string {
  const days = daysUntilLearningStart(startsOn, todayPerth);
  if (days === 0) return "Today";
  return days === 1 ? "Tomorrow" : `In ${days} days`;
}

export type LearningUpcomingSections = {
  /** The next two with a confirmed date; these carry the countdown chip. */
  readonly next: readonly LearningDirectoryItem[];
  /** After the next two, starting in the same calendar year as today. */
  readonly laterThisYear: readonly LearningDirectoryItem[];
  /** Later calendar years, plus undated recorded items ("any time"). */
  readonly nextYearAndAnyTime: readonly LearningDirectoryItem[];
};

/** Splits a date-sorted upcoming list so a later year never reads as this year. */
export function splitUpcomingLearning(
  upcoming: readonly LearningDirectoryItem[],
  todayPerth: string,
): LearningUpcomingSections {
  const next = upcoming.filter((item) => item.startsOn !== null).slice(0, 2);
  const rest = upcoming.filter((item) => !next.includes(item));
  const thisYear = todayPerth.slice(0, 4);
  return {
    next,
    laterThisYear: rest.filter((item) => item.startsOn?.slice(0, 4) === thisYear),
    nextYearAndAnyTime: rest.filter((item) => item.startsOn?.slice(0, 4) !== thisYear),
  };
}

/** True when the list was last checked more than 45 days before today's Perth date. */
export function isDirectoryStale(lastCheckedOn: string, todayPerth: string): boolean {
  const days = (Date.parse(`${todayPerth}T00:00:00Z`) - Date.parse(`${lastCheckedOn}T00:00:00Z`)) / MS_PER_DAY;
  return days > LEARNING_DIRECTORY_STALE_AFTER_DAYS;
}

/** The new-entry form's prefill link. Carries only a title and a link; it never records attendance. */
export function learningItemLogHref(item: Pick<LearningDirectoryItem, "title" | "url">): string {
  const href = cmeLearningFromSourceHref({ title: item.title, href: item.url });
  if (!href) throw new Error("A learning item needs a valid title and source link before it can prefill a CPD entry.");
  return href;
}
