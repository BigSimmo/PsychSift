import { formatCalendarMonthLabel } from "@/lib/cme/cpd-year";
import { totalAllocatedHours } from "@/lib/cme/evaluate";
import { isRanzcpHome } from "@/lib/cme/home-choice";
import {
  cmeCategories,
  cmeCategoryLabels,
  cmeCertificateMissing,
  type CmeCategory,
  type CmeEntry,
  type CmeRequirementSet,
} from "@/lib/cme/types";

/** The three things an audit asks for per activity, as log filters. */
export type CmeLogAttention = "evidence" | "reflection" | "copy";

/**
 * In the mock-up's order. "Not marked copied", never "Not copied": PsychSift
 * cannot see MyCPD, so it only knows what the owner has marked.
 */
export const ATTENTION_FILTERS: readonly {
  value: CmeLogAttention;
  label: string;
  matches: (entry: CmeEntry) => boolean;
}[] = [
  { value: "copy", label: "Not marked copied", matches: (entry) => !entry.transcribed },
  { value: "reflection", label: "No reflection", matches: (entry) => entry.reflection.trim() === "" },
  { value: "evidence", label: "No evidence", matches: cmeCertificateMissing },
];

/** The category names a log row uses: short, so the grey line fits on a phone. */
export const CATEGORY_SHORT_LABELS: Record<CmeCategory, string> = {
  educational: "Educational",
  reviewing: "Reviewing performance",
  measuring: "Measuring outcomes",
};

/** The categories an entry's allocations touch, in canonical order. */
export function entryCategories(entry: CmeEntry): CmeCategory[] {
  const present = new Set(entry.allocations.map((allocation) => allocation.category));
  return cmeCategories.filter((category) => present.has(category));
}

/**
 * What a row's grey line says after the category: every audit gap the log
 * knows about, or "Marked copied" when nothing is left. "No evidence" shows
 * only when certificates were counted and none found (`cmeCertificateMissing`);
 * an activity whose evidence was not counted says nothing rather than guessing.
 */
export function entryStatusWords(entry: CmeEntry): string[] {
  if (entry.archivedAt) return ["Archived"];
  const words: string[] = [];
  if (cmeCertificateMissing(entry)) words.push("No evidence");
  if (entry.reflection.trim() === "") words.push("No reflection");
  words.push(entry.transcribed ? "Marked copied" : "Not marked copied");
  return words;
}

/**
 * The one filled button on a CPD page (mock-up `.btn.pri`): CPD indigo in
 * light, a quiet indigo wash with heading text in dark.
 */
export const cmeFilledButton =
  "inline-flex min-h-12 items-center justify-center gap-1.5 rounded-md bg-[color:var(--clinical-accent)] px-4 text-sm font-semibold text-[color:var(--clinical-accent-contrast)] no-underline transition-opacity duration-[var(--duration-instant)] hover:opacity-90 dark:bg-[color:color-mix(in_oklab,var(--clinical-accent)_38%,var(--surface-raised))] dark:text-[color:var(--text-heading)] forced-colors:border forced-colors:border-[ButtonText] forced-colors:bg-[ButtonFace] forced-colors:text-[ButtonText]";

/**
 * What the copy note and sheet call the owner's CPD home. "MyCPD" and
 * "RANZCP" only when the year's confirmed source is the RANZCP preset (the
 * same test `cmeReportingCloseDate` uses); any other home gets plain words.
 */
export function cmeCpdHomeWords(set: Pick<CmeRequirementSet, "confirmedSource">): {
  name: string;
  college: string;
} {
  return isRanzcpHome(set.confirmedSource)
    ? { name: "MyCPD", college: "RANZCP" }
    : { name: "your CPD home", college: "your college" };
}

/** Hours as the mock-up writes them: "1", "1.5", "32.5" — no padded ".0". */
export function formatHoursShort(hours: number): string {
  return String(round2(hours));
}

export type CategoryFilter = "all" | CmeCategory;

export const CATEGORY_OPTIONS: readonly { value: CategoryFilter; label: string }[] = [
  { value: "all", label: "All categories" },
  ...cmeCategories.map((category) => ({ value: category, label: cmeCategoryLabels[category] })),
];

export type MonthGroup = {
  /** `YYYY-MM`. */
  readonly key: string;
  readonly label: string;
  readonly hours: number;
  readonly entries: readonly CmeEntry[];
};

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Most-recent-month-first groups over an already-filtered, already-sorted
 * list. Grouping — never a chip that hides the other months — is the same
 * choice `onCallEntryGroups` documents for On Call: a reader wants to GET to
 * August, not have July and September removed from the screen while they
 * look at it. The month strip above the list jumps between these groups
 * instead of filtering them.
 */
export function groupByMonth(entries: readonly CmeEntry[]): MonthGroup[] {
  const byMonth = new Map<string, CmeEntry[]>();
  for (const entry of entries) {
    const key = entry.date.slice(0, 7);
    const existing = byMonth.get(key);
    if (existing) existing.push(entry);
    else byMonth.set(key, [entry]);
  }
  return [...byMonth.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([key, monthEntries]) => ({
      key,
      label: formatCalendarMonthLabel(key),
      hours: round2(totalAllocatedHours(monthEntries)),
      entries: monthEntries,
    }));
}

/** The in-page anchor a month section carries, and the month strip jumps to. */
export function monthAnchorId(key: string): string {
  return `cme-log-month-anchor-${key}`;
}
