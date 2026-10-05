import { formatRecordedDate, renewalStartOn } from "@/lib/admin/renewal-dates";
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

  const counts = Object.fromEntries(
    COMPLIANCE_BUCKETS.map((bucket) => [bucket, items.filter((item) => item.bucket === bucket).length]),
  ) as Record<ComplianceBucket, number>;

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

/** The eight columns of the doctor's Excel export, in order. */
export const COMPLIANCE_EXPORT_HEADER = [
  "Item",
  "Group",
  "Status",
  "Date you recorded",
  "Before your next job",
  "Rule",
  "Source",
  "Source checked",
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
        item.ruleToConfirm ? "Rule to confirm" : "Confirmed",
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
      item.status === "needs-checking" ? "Rule to confirm" : "Confirmed",
      item.sourceName,
      exportDate(item.updated),
    ]);
  }
  return rows;
}

/** The export's second sheet: what the file is, and what it is not. */
export function complianceExportAboutRows(overview: ComplianceOverview, now: Date): string[][] {
  const today = perthCalendarDate(now);
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
    ["Rules come from the statewide requirements list. Rule to confirm means the source did not state it clearly."],
  ];
}

/** "Compliance 2026-10-05.xlsx", dated by the Perth day. */
export function complianceExportFileName(now: Date): string {
  return `Compliance ${perthCalendarDate(now)}.xlsx`;
}
