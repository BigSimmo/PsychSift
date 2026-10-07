import { totalAllocatedHours } from "@/lib/cme/evaluate";
import { activeCmeYearEntries, formatCmeYearCsv } from "@/lib/cme/export";
import { canCloseCmeYear, cmeYearClosableFromLabel } from "@/lib/cme/year-close";
import { withoutExampleRecords } from "@/lib/example-data/guards";
import { cmeCategories, type CmeCategory, type CmeEntry, type CmeRequirementSet } from "@/lib/cme/types";

/*
 * CPD Export (`/cme/export`, mock-up cpd_export): the year as files the doctor keeps. It composes what
 * CPD already has. The CSV is the same file `/api/cme/export` makes (`formatCmeYearCsv`), built here
 * from the records already on the page so it also works offline. The printable summary is the existing
 * `/cme/summary` page. Neither claims a college's import format: they are a plain personal summary.
 */

export interface CpdExportSummary {
  readonly activities: number;
  readonly hours: number;
  readonly byCategory: Record<CmeCategory, number>;
  /** Activities not yet marked copied to the CPD home. PsychSift cannot see the CPD home itself. */
  readonly notCopied: number;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function cpdExportSummary(entries: readonly CmeEntry[], year: number): CpdExportSummary {
  const active = activeCmeYearEntries(entries, year);
  const byCategory: Record<CmeCategory, number> = { educational: 0, reviewing: 0, measuring: 0 };
  for (const entry of active) for (const a of entry.allocations) byCategory[a.category] += a.hours;
  for (const c of cmeCategories) byCategory[c] = round2(byCategory[c]);
  return {
    activities: active.length,
    hours: totalAllocatedHours(active),
    byCategory,
    notCopied: active.filter((entry) => !entry.transcribed).length,
  };
}

/** The CSV file name the server route uses too, so a file saved from either place reads the same. */
export function cpdCsvFileName(year: number, demoMode: boolean): string {
  return `cme-${year}${demoMode ? "-demo" : ""}.csv`;
}

export function cpdYearCsv(entries: readonly CmeEntry[], set: CmeRequirementSet): string {
  return formatCmeYearCsv(withoutExampleRecords(entries), set);
}

export type CpdYearEndState =
  | { readonly kind: "closed" }
  | { readonly kind: "open-to-close" }
  | { readonly kind: "not-yet"; readonly from: string; readonly month: string; readonly day: number };

/** Whether the year can be closed in PsychSift yet, and from when. */
export function cpdYearEndState(set: CmeRequirementSet, now: Date): CpdYearEndState {
  if (set.closedAt) return { kind: "closed" };
  if (canCloseCmeYear(now, set.year)) return { kind: "open-to-close" };
  const from = cmeYearClosableFromLabel(set.year);
  const day = Number.parseInt(from, 10);
  return { kind: "not-yet", from, month: "Dec", day: Number.isFinite(day) ? day : 17 };
}

/** "41 activities · 32.5 h" with a no-break space before the unit. */
export function cpdSummaryLine(summary: CpdExportSummary): string {
  const count = summary.activities === 1 ? "1 activity" : `${summary.activities} activities`;
  return `${count} · ${summary.hours} h`;
}
