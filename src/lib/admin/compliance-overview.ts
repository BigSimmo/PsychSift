import { addDays } from "@/lib/calendar/calendar-event";
import { formatRecordedDate, formatRelativeDate, renewalStartOn } from "@/lib/admin/renewal-dates";
import {
  ADMIN_REQUIREMENT_GROUPS,
  requirementChecklistRowsForJob,
  requirementsNotForThisJob,
  type AdminRequirementCatalogueItem,
  type AdminRequirementGroup,
  type RequirementChecklistRow,
} from "@/lib/admin/requirements";
import { perthCalendarDate } from "@/lib/cme/cpd-year";
import type { OnCallEntry } from "@/lib/on-call/entry-model";

/**
 * Admin · Compliance, the doctor's side: every requirement on the statewide
 * catalogue, grouped the way a health service asks for them, with how many are
 * recorded, what falls due next, and what still has to be done before the next
 * job starts.
 *
 * It is a second VIEW of exactly the rows Renewals reads
 * (`requirementChecklistRowsForJob`), never a second store, so the two pages
 * cannot disagree. The same honesty rule holds (`src/lib/on-call/compliance.ts`,
 * "What this page may never say"): every date was typed by the doctor, so
 * nothing here may say "compliant", "valid" or "expired". The words are the
 * Renewals words: Recorded, Start renewing, Date passed, Not recorded yet.
 */

export type ComplianceBucket = "recorded" | "start-renewing" | "date-passed" | "not-recorded";

export const COMPLIANCE_BUCKETS: readonly ComplianceBucket[] = [
  "recorded",
  "start-renewing",
  "date-passed",
  "not-recorded",
];

export const COMPLIANCE_BUCKET_LABELS: Record<ComplianceBucket, string> = {
  recorded: "Recorded",
  "start-renewing": "Start renewing",
  "date-passed": "Date passed",
  "not-recorded": "Not recorded yet",
};

export const COMPLIANCE_GROUP_LABELS: Record<AdminRequirementGroup, string> = {
  registration: "Registration",
  checks: "Checks",
  health: "Health",
  training: "Training",
  job: "Job",
};

export interface ComplianceItem {
  readonly row: RequirementChecklistRow;
  readonly bucket: ComplianceBucket;
  /** The catalogue could not confirm this item's rule from its source: shown as "Rule to confirm". */
  readonly ruleToConfirm: boolean;
}

export interface ComplianceGroup {
  readonly group: AdminRequirementGroup;
  readonly label: string;
  readonly items: readonly ComplianceItem[];
  /** How many items in the group have a date or record of any kind. */
  readonly recorded: number;
}

export type NextJobReason = "not-recorded" | "date-passed" | "ends-before-start";

export interface NextJobToDo {
  readonly item: ComplianceItem;
  readonly reason: NextJobReason;
}

export interface NextJobPass {
  readonly startsOn: string;
  readonly carriesOver: readonly ComplianceItem[];
  readonly toDo: readonly NextJobToDo[];
}

export interface ComplianceDeadline {
  readonly item: ComplianceItem;
  readonly date: string;
}

export interface ComplianceOverview {
  readonly groups: readonly ComplianceGroup[];
  readonly counts: Readonly<Record<ComplianceBucket, number>>;
  /** Items that apply to this job: every catalogue item except those marked "not for this job". */
  readonly total: number;
  readonly notForThisJob: readonly AdminRequirementCatalogueItem[];
  /** The three soonest recorded dates still ahead, soonest first. */
  readonly nextDeadlines: readonly ComplianceDeadline[];
  /** What carries over and what is still to do, when a future start date is recorded in New job. */
  readonly nextJob: NextJobPass | null;
}

/**
 * The same reading as Renewals' row status (`requirementRowUrgency`): no
 * record; recorded with no end date; the recorded date has passed; the
 * renewal window (date minus lead time) has opened; otherwise recorded.
 */
export function complianceBucket(row: RequirementChecklistRow, today: string): ComplianceBucket {
  if (row.state === "not-recorded") return "not-recorded";
  if (row.state === "no-end-date" || !row.expiresOn) return "recorded";
  if (row.expiresOn < today) return "date-passed";
  const startOn = row.entry ? renewalStartOn(row.entry) : undefined;
  return startOn && startOn <= today ? "start-renewing" : "recorded";
}

function nextJobReason(item: ComplianceItem, startsOn: string): NextJobReason | null {
  if (item.bucket === "not-recorded") return "not-recorded";
  if (item.bucket === "date-passed") return "date-passed";
  const expiresOn = item.row.expiresOn;
  return expiresOn && expiresOn < startsOn ? "ends-before-start" : null;
}

/** One plain line for why an item is still to do before the next job. */
export function nextJobReasonText(todo: NextJobToDo): string {
  if (todo.reason === "not-recorded") return "Not recorded yet";
  if (todo.reason === "date-passed") return "Date passed";
  return `Your date ends ${formatRecordedDate(todo.item.row.expiresOn as string)}, before you start`;
}

/** How many items sit in each status. Compliance and Renewals both count with this, so they cannot drift apart. */
export function complianceBucketCounts(buckets: readonly ComplianceBucket[]): Record<ComplianceBucket, number> {
  return Object.fromEntries(
    COMPLIANCE_BUCKETS.map((bucket) => [bucket, buckets.filter((candidate) => candidate === bucket).length]),
  ) as Record<ComplianceBucket, number>;
}

export function buildComplianceOverview(
  catalogue: readonly AdminRequirementCatalogueItem[],
  entries: readonly OnCallEntry[],
  now: Date,
  nextJobStartsOn: string | null,
): ComplianceOverview {
  const today = perthCalendarDate(now);
  const items: ComplianceItem[] = requirementChecklistRowsForJob(catalogue, entries).map((row) => ({
    row,
    bucket: complianceBucket(row, today),
    ruleToConfirm: row.item.status === "needs-checking",
  }));

  const groups = ADMIN_REQUIREMENT_GROUPS.map((group) => {
    const inGroup = items.filter((item) => item.row.item.group === group);
    return {
      group,
      label: COMPLIANCE_GROUP_LABELS[group],
      items: inGroup,
      recorded: inGroup.filter((item) => item.bucket !== "not-recorded").length,
    };
  }).filter((group) => group.items.length > 0);

  const counts = complianceBucketCounts(items.map((item) => item.bucket));

  const nextDeadlines = items
    .filter((item) => item.row.expiresOn !== undefined && item.row.expiresOn >= today)
    .map((item) => ({ item, date: item.row.expiresOn as string }))
    .sort((a, b) =>
      a.date === b.date ? a.item.row.item.title.localeCompare(b.item.row.item.title) : a.date < b.date ? -1 : 1,
    )
    .slice(0, 3);

  let nextJob: NextJobPass | null = null;
  if (nextJobStartsOn && nextJobStartsOn >= today) {
    const carriesOver: ComplianceItem[] = [];
    const toDo: NextJobToDo[] = [];
    for (const item of items) {
      const reason = nextJobReason(item, nextJobStartsOn);
      if (reason) toDo.push({ item, reason });
      else carriesOver.push(item);
    }
    nextJob = { startsOn: nextJobStartsOn, carriesOver, toDo };
  }

  return {
    groups,
    counts,
    total: items.length,
    notForThisJob: requirementsNotForThisJob(catalogue, entries).map(({ item }) => item),
    nextDeadlines,
    nextJob,
  };
}

/**
 * The Rule column's word for a rule the source states. Never "Confirmed": next
 * to the Status column that could read as "this item is confirmed".
 */
const RULE_STATED = "Stated by source";

/** The latest "updated" day across the requirements list, for the About sheet. */
function catalogueUpdatedOn(overview: ComplianceOverview): string | undefined {
  const dates = [
    ...overview.groups.flatMap((group) => group.items.map((item) => item.row.item.updated)),
    ...overview.notForThisJob.map((item) => item.updated),
  ].filter((date): date is string => typeof date === "string" && date.length > 0);
  return dates.length > 0 ? dates.reduce((latest, date) => (date > latest ? date : latest)) : undefined;
}

/** The eight columns of the doctor's Excel export, in order. */
export const COMPLIANCE_EXPORT_HEADER = [
  "Item",
  "Group",
  "Status",
  "Date you recorded",
  "Before your next job",
  "Rule",
  "Source",
  "Rule updated",
] as const;

function exportDate(date: string | undefined): string {
  return date ? formatRecordedDate(date) : "";
}

/**
 * The rows of the export's first sheet: the header, every item that applies,
 * then the items marked not for this job. The words match the page exactly,
 * so the file never claims more than the record does.
 */
export function complianceExportRows(overview: ComplianceOverview): string[][] {
  const pass = overview.nextJob;
  const passWord = (item: ComplianceItem): string => {
    if (!pass) return "";
    const todo = pass.toDo.find((candidate) => candidate.item === item);
    return todo ? `To do: ${nextJobReasonText(todo)}` : "Carries over";
  };
  const rows: string[][] = [[...COMPLIANCE_EXPORT_HEADER]];
  for (const group of overview.groups) {
    for (const item of group.items) {
      const catalogueItem = item.row.item;
      rows.push([
        catalogueItem.title,
        group.label,
        COMPLIANCE_BUCKET_LABELS[item.bucket],
        item.row.state === "no-end-date" ? "No end date" : exportDate(item.row.expiresOn),
        passWord(item),
        item.ruleToConfirm ? "Rule to confirm" : RULE_STATED,
        catalogueItem.sourceName,
        exportDate(catalogueItem.updated),
      ]);
    }
  }
  for (const item of overview.notForThisJob) {
    rows.push([
      item.title,
      COMPLIANCE_GROUP_LABELS[item.group],
      "Not for this job",
      "",
      "",
      item.status === "needs-checking" ? "Rule to confirm" : RULE_STATED,
      item.sourceName,
      exportDate(item.updated),
    ]);
  }
  return rows;
}

/** The export's second sheet: what the file is, and what it is not. */
export function complianceExportAboutRows(
  overview: ComplianceOverview,
  now: Date,
  selection?: {
    readonly range: ComplianceExportRange;
    readonly omittedColumns: readonly string[];
    readonly rows: number;
    readonly demo?: boolean;
  },
): string[][] {
  const today = perthCalendarDate(now);
  const updatedOn = catalogueUpdatedOn(overview);
  const selectionRows: string[][] = selection
    ? [
        selection.range === "next-60-days"
          ? [
              `Range: next ${COMPLIANCE_EXPORT_SOON_DAYS} days only, dates already passed included. ${selection.rows} of ${overview.total + overview.notForThisJob.length} items are in this file; items with no recorded date, no end date, a date further ahead, or marked not for this job are left out.`,
            ]
          : ["Range: every item."],
        selection.omittedColumns.length > 0
          ? [`Columns left out: ${selection.omittedColumns.join(", ")}.`]
          : ["Columns: all."],
        ...(selection.demo ? [["Example records: these dates are made up, and nothing here is your own."]] : []),
      ]
    : [];
  return [
    ["About this file"],
    [`Exported ${formatRecordedDate(today)} from PsychSift, Admin · Compliance.`],
    ["Every date was entered by the doctor. Nothing here has been checked with the issuing body."],
    [
      `${overview.total - overview.counts["not-recorded"]} of ${overview.total} items recorded` +
        (overview.notForThisJob.length > 0 ? `, ${overview.notForThisJob.length} not for this job.` : "."),
    ],
    overview.nextJob
      ? [
          `Next job starts ${formatRecordedDate(overview.nextJob.startsOn)}: ${overview.nextJob.carriesOver.length} carry over, ${overview.nextJob.toDo.length} still to do.`,
        ]
      : ["No start date for a next job is recorded in Admin · New job."],
    [
      `Rules come from the statewide requirements list${updatedOn ? `, last updated ${formatRecordedDate(updatedOn)}` : ""}. Rule to confirm means the source did not state it clearly.`,
    ],
    [`${RULE_STATED} means the source states the rule. It does not mean anyone has checked your records against it.`],
    ...selectionRows,
  ];
}

/**
 * "Compliance 2026-10-05.xlsx", dated by the Perth day. Example records say so
 * in the name too, so a forwarded file is never taken for a real record.
 */
export function complianceExportFileName(now: Date, demo = false): string {
  return `${demo ? "Example compliance" : "Compliance"} ${perthCalendarDate(now)}.xlsx`;
}

/**
 * The page's filter chips (5 Oct mock-up v2): everything, the items that need
 * the doctor ("Needs action": date passed, start renewing and not recorded
 * yet), or one status.
 */
export type ComplianceFilter = "all" | "needs-action" | ComplianceBucket;

const NEEDS_ACTION: readonly ComplianceBucket[] = ["date-passed", "start-renewing", "not-recorded"];

export function complianceNeedsActionCount(overview: ComplianceOverview): number {
  return NEEDS_ACTION.reduce((total, bucket) => total + overview.counts[bucket], 0);
}

export function complianceFilterMatches(filter: ComplianceFilter, item: ComplianceItem): boolean {
  if (filter === "all") return true;
  if (filter === "needs-action") return NEEDS_ACTION.includes(item.bucket);
  return item.bucket === filter;
}

/** Status chips run most urgent first, ending with Recorded. */
const CHIP_ORDER: readonly ComplianceBucket[] = [...NEEDS_ACTION, "recorded"];

/** The chips to draw, in order: All, Needs action, then each status that has any items. */
export function complianceFilterChips(
  overview: ComplianceOverview,
): readonly { readonly filter: ComplianceFilter; readonly label: string; readonly count: number }[] {
  const chips: { filter: ComplianceFilter; label: string; count: number }[] = [
    { filter: "all", label: "All", count: overview.total },
  ];
  const needsAction = complianceNeedsActionCount(overview);
  if (needsAction > 0) chips.push({ filter: "needs-action", label: "Needs action", count: needsAction });
  for (const bucket of CHIP_ORDER) {
    if (overview.counts[bucket] > 0) {
      chips.push({ filter: bucket, label: COMPLIANCE_BUCKET_LABELS[bucket], count: overview.counts[bucket] });
    }
  }
  return chips;
}

/**
 * The date line under a row: "Renew by 30 Sep 2027 · in 11 months", "Date
 * passed 28 Sep 2026 · 7 days ago", "No end date", or nothing when no date is
 * recorded. Always the date the doctor typed, never a guessed one.
 */
export function complianceDateLine(item: ComplianceItem, today: string): string | null {
  if (item.row.state === "not-recorded") return null;
  if (item.row.state === "no-end-date" || !item.row.expiresOn) return "No end date";
  const date = item.row.expiresOn;
  const lead = item.bucket === "date-passed" ? "Date passed" : "Renew by";
  const relative = formatRelativeDate(date, today);
  return relative ? `${lead} ${formatRecordedDate(date)} · ${relative}` : `${lead} ${formatRecordedDate(date)}`;
}

/** Nothing recorded at all: the first-use state, a to-do list rather than a wall of "Not recorded yet". */
export function complianceIsFirstUse(overview: ComplianceOverview): boolean {
  return overview.total > 0 && overview.counts["not-recorded"] === overview.total;
}

/** "Ahpra, Medicare, prescriber, indemnity": the group's item titles as one short line, at most three named. */
export function complianceGroupNames(group: ComplianceGroup): string {
  const titles = group.items.map((item) => item.row.item.title);
  if (titles.length <= 3) return titles.join(", ");
  return `${titles.slice(0, 2).join(", ")} and ${titles.length - 2} more`;
}

/** The export page's date switch. "Next 60 days" keeps rows whose recorded date is on or before 60 days from today, passed dates included. */
export type ComplianceExportRange = "everything" | "next-60-days";

const COMPLIANCE_EXPORT_SOON_DAYS = 60;

/**
 * The first sheet, cut to the columns and range the doctor chose. Item is
 * always kept so no row is anonymous; "Next 60 days" drops rows with no date
 * or a date further out, and the not-for-this-job rows.
 */
export function complianceExportSelection(
  rows: readonly (readonly string[])[],
  overview: ComplianceOverview,
  columns: readonly string[],
  range: ComplianceExportRange,
  today: string,
): string[][] {
  const header = rows[0] ?? [];
  const keep = header.map((name, index) => (index === 0 || columns.includes(name) ? index : -1)).filter((i) => i >= 0);
  let body = rows.slice(1);
  if (range === "next-60-days") {
    const limit = addDays(today, COMPLIANCE_EXPORT_SOON_DAYS);
    // complianceExportRows writes one row per applying item, in group order, then the
    // "Not for this job" rows; so the first N body rows line up with these items.
    const applying = overview.groups.flatMap((group) => group.items);
    body = body.filter((_, index) => {
      const item = applying[index];
      return item !== undefined && item.row.expiresOn !== undefined && item.row.expiresOn <= limit;
    });
  }
  return [header, ...body].map((row) => keep.map((index) => row[index] ?? ""));
}
