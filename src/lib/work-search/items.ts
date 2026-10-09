import { cmeCategoryLabels, type CmeEntry } from "@/lib/cme/types";
import { complianceExpiresOn, entryNotForThisJob, isComplianceEntry } from "@/lib/on-call/compliance";
import type { OnCallEntry } from "@/lib/on-call/entry-model";
import { onCallSearchSummary } from "@/lib/on-call/entry-search";
import { formatPerthDay, perthDateOf, perthTimeOf } from "@/lib/perth-time";
import type { RosterLeave } from "@/lib/roster/leave";
import { ROSTER_LEAVE_KIND_LABEL } from "@/lib/roster/leave-kinds";
import { inferShiftKind, SHIFT_KIND_LABEL, type ShiftKind } from "@/lib/roster/shift-kind";
import type { SessionSummary } from "@/lib/teaching/model";
import type { WorkItem, WorkSearchArea } from "@/lib/work-search/model";

/**
 * Map each area's own records onto `WorkItem`. Pure: hrefs that need a
 * component-layer helper are passed in, because `src/lib` may not import
 * `@/components` (tests/lib-layering.test.ts).
 */

type ShiftLike = {
  readonly id: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly title: string;
  readonly location: string | null;
  readonly kind?: ShiftKind | null;
  readonly workplace?: string | null;
};

const ROSTER_SHIFTS_HREF = "/roster/shifts";

/** Words people use for a kind of shift that its label does not contain. */
const SHIFT_KIND_SYNONYMS: Readonly<Record<ShiftKind, readonly string[]>> = {
  day: ["day shift", "days"],
  evening: ["late", "lates", "pm shift"],
  night: ["night shift", "nights", "ns"],
  on_call: ["on-call", "oncall", "call"],
  leave: ["leave", "off"],
  other: ["work"],
};
const ROSTER_LEAVE_HREF = "/roster/requests";

function joinDetail(parts: readonly (string | null | undefined)[]): string | null {
  const kept = parts.filter((part): part is string => Boolean(part && part.trim()));
  return kept.length > 0 ? kept.join(" · ") : null;
}

export function shiftWorkItems(shifts: readonly ShiftLike[]): WorkItem[] {
  return shifts.map((shift) => {
    const date = perthDateOf(shift.startsAt);
    // An older import may carry no kind; Roster infers it from the times the same way.
    const kind = shift.kind ?? inferShiftKind(shift);
    const kindLabel = SHIFT_KIND_LABEL[kind];
    // A shift that ends on a later day names that day: "21:00 to 08:30 Thu".
    const endDate = perthDateOf(shift.endsAt);
    const endDay = endDate !== date ? ` ${formatPerthDay(endDate).slice(0, 3)}` : "";
    return {
      id: `roster:shift:${shift.id}`,
      area: "roster",
      kind: "shift",
      title: shift.title.trim() || `${kindLabel} shift`,
      detail: joinDetail([
        formatPerthDay(date),
        `${perthTimeOf(shift.startsAt)} to ${perthTimeOf(shift.endsAt)}${endDay}`,
        shift.location,
      ]),
      date,
      startsAt: shift.startsAt,
      endsAt: shift.endsAt,
      href: ROSTER_SHIFTS_HREF,
      facet: kind,
      // "nights" and "on call" are what people type; the kind label carries both.
      tags: [kindLabel, `${kindLabel}s`, "shift", "shifts", ...SHIFT_KIND_SYNONYMS[kind]],
      text: [shift.location ?? "", shift.workplace ?? ""],
    } satisfies WorkItem;
  });
}

/** Words a doctor might search for each kind of leave, beyond its name. */
const LEAVE_KIND_TAGS: Readonly<Record<RosterLeave["kind"], readonly string[]>> = {
  annual: ["annual", "vacation"],
  pd_leave: ["study leave", "pdl", "pd leave", "conference", "professional development", "course"],
  exam: ["exam", "exam leave", "study leave"],
  personal: ["personal leave", "sick leave", "sick day", "carer's leave"],
};

const LEAVE_STATUS_LABEL: Readonly<Record<RosterLeave["status"], string>> = {
  planned: "Planned",
  applied: "Applied for",
  approved: "Approved",
};

export function leaveWorkItems(leave: readonly RosterLeave[]): WorkItem[] {
  return leave.map((row) => ({
    id: `roster:leave:${row.id}`,
    area: "roster",
    kind: "leave",
    title: ROSTER_LEAVE_KIND_LABEL[row.kind],
    detail: joinDetail([
      row.startsOn === row.endsOn
        ? formatPerthDay(row.startsOn)
        : `${formatPerthDay(row.startsOn)} to ${formatPerthDay(row.endsOn)}`,
      LEAVE_STATUS_LABEL[row.status],
    ]),
    date: row.startsOn,
    until: row.endsOn,
    href: ROSTER_LEAVE_HREF,
    tags: ["leave", "holiday", "holidays", "time off", ...LEAVE_KIND_TAGS[row.kind]],
    text: [LEAVE_STATUS_LABEL[row.status]],
  }));
}

export function sessionWorkItems(sessions: readonly SessionSummary[]): WorkItem[] {
  return sessions
    .filter((session) => session.status !== "cancelled")
    .map((session) => {
      const date = perthDateOf(session.startsAt);
      return {
        id: `teaching:session:${session.occurrenceId}`,
        area: "teaching",
        kind: "session",
        title: session.title,
        detail: joinDetail([
          formatPerthDay(date),
          session.allDay ? null : perthTimeOf(session.startsAt),
          session.venue,
          session.isPresenter ? "You're presenting" : null,
        ]),
        date,
        startsAt: session.startsAt,
        endsAt: session.endsAt,
        href: session.source === "teaching" ? `/teaching/session/${session.occurrenceId}` : "/teaching/week",
        ...(session.isPresenter ? { facet: "presenting" } : {}),
        tags: [
          "teaching",
          "session",
          "sessions",
          ...(session.isPresenter ? ["presenting", "presenter", "my talk", "talk", "presentation"] : []),
        ],
        text: [session.venue ?? ""],
      } satisfies WorkItem;
    });
}

export function cmeActivityWorkItems(entries: readonly CmeEntry[]): WorkItem[] {
  return entries
    .filter((entry) => !entry.archivedAt)
    .map((entry) => {
      const hours = entry.allocations.reduce((sum, allocation) => sum + allocation.hours, 0);
      const categories = entry.allocations.map((allocation) => cmeCategoryLabels[allocation.category]);
      return {
        id: `cme:activity:${entry.id}`,
        area: "cme",
        kind: "cpd-activity",
        title: entry.title,
        detail: joinDetail([formatPerthDay(entry.date), hours > 0 ? `${hours} h` : null, categories[0]]),
        date: entry.date,
        href: `/cme/log/${encodeURIComponent(entry.id)}`,
        tags: ["cpd", "cme", "activity", "activities", ...categories, ...entry.buckets],
        // The reflection is the reader's own note: matched here in the browser, never sent.
        text: [entry.reflection],
      } satisfies WorkItem;
    });
}

/**
 * Which area an On Call entry belongs to, from the page it opens on. Admin
 * received On Call's admin rows and compliance dates, and Teaching received
 * its teaching list, so the page — not the stored section — decides.
 */
export function areaForEntryHref(href: string): WorkSearchArea {
  if (href.startsWith("/admin")) return "my-work";
  if (href.startsWith("/teaching")) return "teaching";
  return "on-call";
}

export function entryWorkItem(entry: OnCallEntry, href: string): WorkItem {
  const compliance = isComplianceEntry(entry);
  // A renewal marked "not for this job" is still findable, but never due or overdue.
  const notForThisJob = compliance && entryNotForThisJob(entry);
  return {
    id: `entry:${compliance ? "renewal" : "entry"}:${entry.id}`,
    area: compliance ? "my-work" : areaForEntryHref(href),
    kind: compliance ? "renewal" : "entry",
    title: entry.title,
    detail: notForThisJob
      ? joinDetail([onCallSearchSummary(entry), "Not needed for this job"])
      : onCallSearchSummary(entry),
    date: compliance && !notForThisJob ? (complianceExpiresOn(entry) ?? null) : null,
    href,
    // The On Call section it is stored in: the row's icon says contact, guide or admin record.
    facet: entry.section,
    tags: [...entry.tags, ...(compliance ? ["renewal", "renewals", "renew", "expiry", "due"] : [])],
    text: [entry.subtitle ?? ""],
  };
}
