import {
  buildComplianceOverview,
  COMPLIANCE_BUCKET_LABELS,
  type ComplianceItem,
} from "@/lib/admin/compliance-overview";
import {
  selectContractEnd,
  type AdminFeatureNeedsYouItem,
  type AdminFeatureSearchRecord,
} from "@/lib/admin/contract-end";
import { selectNewJobRows } from "@/lib/admin/help-items";
import { selectNewJobStart } from "@/lib/admin/new-job-progress";
import { formatDateEcho, formatRecordedDate, utcDay } from "@/lib/admin/renewal-dates";
import { ADMIN_REQUIREMENTS_CATALOGUE, type AdminRequirementCatalogueItem } from "@/lib/admin/requirements";
import { perthCalendarDate } from "@/lib/cme/cpd-year";
import { complianceExpiresOn } from "@/lib/on-call/compliance";
import type { OnCallEntry } from "@/lib/on-call/entry-model";

/**
 * Ready for day one (junior feature #21, doctor's side, owner request 6 Oct
 * 2026): one card that reads the doctor's own Admin records and says, item by
 * item in a fixed order, what is recorded and what is still to do before the
 * new job starts. "Copy status for Medical Workforce" puts status words only
 * on the clipboard, never a number, a file or a vaccine detail.
 *
 * It is a third VIEW of the rows Renewals and Compliance read
 * (`buildComplianceOverview`), never a second store. The Medical Workforce
 * side (a shared list of starters, a sharing switch, reminders and "received"
 * marks) needs server tables and a Workforce role, so it is not built.
 */

export type ReadyItemId =
  | "medical-registration-renewal"
  | "working-with-children-check"
  | "criminal-record-screening"
  | "immunisation-requirements"
  | "respirator-fit-testing"
  | "resuscitation-competence"
  | "contract"
  | "bank-and-tax"
  | "logins";

/** The fixed order, the same on every card, so a list of starters lines up. */
export const READY_ITEM_ORDER: readonly ReadyItemId[] = [
  "medical-registration-renewal",
  "working-with-children-check",
  "criminal-record-screening",
  "immunisation-requirements",
  "respirator-fit-testing",
  "resuscitation-competence",
  "contract",
  "bank-and-tax",
  "logins",
];

const READY_TITLES: Record<ReadyItemId, string> = {
  "medical-registration-renewal": "Medical registration",
  "working-with-children-check": "Working with Children Check",
  "criminal-record-screening": "Criminal record check",
  "immunisation-requirements": "Immunisation",
  "respirator-fit-testing": "Respirator fit test",
  "resuscitation-competence": "Life support",
  contract: "Contract dates",
  "bank-and-tax": "Bank and tax",
  logins: "Logins and access",
};

/** Recorded, to do, in progress, or left out of the count. */
export type ReadyState = "recorded" | "to-do" | "in-progress" | "left-out";

export interface ReadyItem {
  readonly id: ReadyItemId;
  readonly title: string;
  readonly state: ReadyState;
  /** The status word, the only thing that is ever copied for Medical Workforce. */
  readonly status: string;
  /** A line for the doctor only (a date or a count). Never copied. */
  readonly detail: string | null;
  readonly href: string;
  readonly action: string;
}

export interface ReadyForDayOne {
  /** The recorded start date, or null when none is set. */
  readonly startsOn: string | null;
  readonly items: readonly ReadyItem[];
  /** Items that count (everything not left out). */
  readonly counted: number;
  readonly recorded: number;
  readonly toDo: number;
  readonly inProgress: number;
  readonly leftOut: number;
}

function catalogueStatus(item: ComplianceItem, startsOn: string | null): { state: ReadyState; status: string } {
  if (item.bucket === "not-recorded") return { state: "to-do", status: COMPLIANCE_BUCKET_LABELS["not-recorded"] };
  if (item.bucket === "date-passed") return { state: "to-do", status: COMPLIANCE_BUCKET_LABELS["date-passed"] };
  if (startsOn && item.row.expiresOn && item.row.expiresOn < startsOn)
    return { state: "to-do", status: "Ends before you start" };
  return { state: "recorded", status: "Recorded" };
}

export function buildReadyForDayOne(own: readonly OnCallEntry[], now: Date): ReadyForDayOne {
  const today = perthCalendarDate(now);
  const start = selectNewJobStart({ own, shared: [] });
  const startsOn = start && start.startsOn >= today ? start.startsOn : null;
  const overview = buildComplianceOverview(ADMIN_REQUIREMENTS_CATALOGUE, own, now, startsOn);
  const byId = new Map<string, ComplianceItem>();
  for (const group of overview.groups) for (const item of group.items) byId.set(item.row.item.id, item);
  const notForJob = new Set(overview.notForThisJob.map((item: AdminRequirementCatalogueItem) => item.id));

  const items: ReadyItem[] = READY_ITEM_ORDER.map((id) => {
    const title = READY_TITLES[id];
    if (id === "contract") {
      const entry = selectContractEnd(own);
      const end = entry ? complianceExpiresOn(entry) : undefined;
      if (!end) {
        return {
          id,
          title,
          state: "to-do",
          status: "Not recorded yet",
          detail: null,
          href: "/admin/contract",
          action: "Add",
        };
      }
      if (startsOn && end < startsOn) {
        return {
          id,
          title,
          state: "to-do",
          status: "Ends before you start",
          detail: `Ends ${formatRecordedDate(end)}`,
          href: "/admin/contract",
          action: "Open",
        };
      }
      return {
        id,
        title,
        state: "recorded",
        status: "Recorded",
        detail: `Ends ${formatRecordedDate(end)}`,
        href: "/admin/contract",
        action: "Open",
      };
    }
    if (id === "bank-and-tax") {
      // Kept in the fixed order so every starter's bar lines up, but PsychSift holds no bank or tax record.
      return {
        id,
        title,
        state: "left-out",
        status: "Not tracked here",
        detail: "You give these to payroll yourself",
        href: "/admin/new-job",
        action: "Open",
      };
    }
    if (id === "logins") {
      const logins = selectNewJobRows({ own, shared: [] }).logins.filter((row) => row.source === "you");
      const done = logins.filter((row) => {
        const details = row.entry.details;
        return typeof details === "object" && details !== null && (details as { done?: unknown }).done === true;
      }).length;
      if (logins.length === 0) {
        return {
          id,
          title,
          state: "left-out",
          status: "Nothing listed yet",
          detail: "Add logins in New job",
          href: "/admin/new-job",
          action: "Open",
        };
      }
      if (done === logins.length) {
        return {
          id,
          title,
          state: "recorded",
          status: "All done",
          detail: `${logins.length} of ${logins.length} done`,
          href: "/admin/new-job",
          action: "Open",
        };
      }
      return {
        id,
        title,
        state: "in-progress",
        status: "In progress",
        detail: `${done} of ${logins.length} done. The hospital sets these up`,
        href: "/admin/new-job",
        action: "Open",
      };
    }
    const href = `/admin/renewals?item=${id}`;
    if (notForJob.has(id)) {
      return { id, title, state: "left-out", status: "Not for this job", detail: null, href, action: "Open" };
    }
    const item = byId.get(id);
    if (!item) return { id, title, state: "to-do", status: "Not recorded yet", detail: null, href, action: "Record" };
    const { state, status } = catalogueStatus(item, startsOn);
    const detail = item.row.expiresOn ? `Your date ${formatRecordedDate(item.row.expiresOn)}` : null;
    return {
      id,
      title,
      state,
      status,
      detail,
      href,
      action: state === "recorded" ? "Open" : item.bucket === "not-recorded" ? "Record" : "Update",
    };
  });

  const count = (state: ReadyState) => items.filter((item) => item.state === state).length;
  return {
    startsOn,
    items,
    counted: items.length - count("left-out"),
    recorded: count("recorded"),
    toDo: count("to-do"),
    inProgress: count("in-progress"),
    leftOut: count("left-out"),
  };
}

/** What the readiness bar says to a screen reader. */
export function readyAccessibleLabel(ready: ReadyForDayOne): string {
  const parts = [`${ready.recorded} of ${ready.counted} recorded`, `${ready.toDo} to do`];
  if (ready.inProgress) parts.push(`${ready.inProgress} in progress`);
  return `${parts.join(", ")}.`;
}

/** "In 4 weeks" from the start date, or null. */
export function readyStartsLine(ready: ReadyForDayOne, now: Date): string | null {
  if (!ready.startsOn) return null;
  const a = utcDay(perthCalendarDate(now));
  const b = utcDay(ready.startsOn);
  if (a === null || b === null) return null;
  const days = Math.round(b - a);
  const when =
    days === 0 ? "today" : days === 1 ? "tomorrow" : days < 14 ? `in ${days} days` : `in ${Math.floor(days / 7)} weeks`;
  return `Starts ${formatDateEcho(ready.startsOn)}, ${when}`;
}

/**
 * The text "Copy status for Medical Workforce" puts on the clipboard: the
 * start date and one status word per item, every item in the fixed order (so
 * a Workforce list lines up), including the ones not counted. No dates of any
 * credential, no numbers, no detail lines.
 */
export function readyStatusText(ready: ReadyForDayOne, now: Date): string {
  const head = ready.startsOn ? `Ready for day one, starting ${formatDateEcho(ready.startsOn)}` : "Ready for day one";
  const lines = ready.items.map((item) => `${item.title}: ${item.status}`);
  return [
    head,
    `Status from my own records, ${formatDateEcho(perthCalendarDate(now))}. Not checked with issuers. Documents on request.`,
    ...lines,
  ].join("\n");
}

/* ---------------------------------------------------- hooks for main */

export function selectReadyNeedsYou(own: readonly OnCallEntry[], now: Date): AdminFeatureNeedsYouItem[] {
  const ready = buildReadyForDayOne(own, now);
  if (!ready.startsOn || ready.toDo === 0) return [];
  const a = utcDay(perthCalendarDate(now));
  const b = utcDay(ready.startsOn);
  if (a === null || b === null || b - a > 28) return [];
  return [
    {
      id: `ready-day-one-${ready.startsOn}`,
      title: `${ready.toDo} to do before you start ${formatDateEcho(ready.startsOn)}`,
      dueOn: ready.startsOn,
      area: "admin",
      href: "/admin/new-job/ready",
      kind: "action",
    },
  ];
}

export function readySearchRecords(): AdminFeatureSearchRecord[] {
  return [
    {
      id: "admin-ready",
      title: "Ready for day one",
      area: "admin",
      keywords: ["ready", "day one", "first day", "new job", "medical workforce", "onboarding", "starter"],
      href: "/admin/new-job/ready",
    },
  ];
}
