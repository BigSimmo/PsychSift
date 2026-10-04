import { cmeCategoryLabels, type CmeEntry } from "@/lib/cme/types";
import { complianceExpiresOn, isComplianceEntry } from "@/lib/on-call/compliance";
import type { OnCallEntry } from "@/lib/on-call/entry-model";
import { onCallSearchSummary } from "@/lib/on-call/entry-search";
import { formatPerthDay, perthDateOf, perthTimeOf } from "@/lib/perth-time";
import type { RosterLeave } from "@/lib/roster/leave";
import { SHIFT_KIND_LABEL, type ShiftKind } from "@/lib/roster/shift-kind";
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
const ROSTER_LEAVE_HREF = "/roster/requests";

function joinDetail(parts: readonly (string | null | undefined)[]): string | null {
  const kept = parts.filter((part): part is string => Boolean(part && part.trim()));
  return kept.length > 0 ? kept.join(" · ") : null;
}

export function shiftWorkItems(shifts: readonly ShiftLike[]): WorkItem[] {
  return shifts.map((shift) => {
    const date = perthDateOf(shift.startsAt);
    const kindLabel = shift.kind ? SHIFT_KIND_LABEL[shift.kind] : null;
    return {
      id: `roster:shift:${shift.id}`,
      area: "roster",
      kind: "shift",
      title: shift.title.trim() || (kindLabel ? `${kindLabel} shift` : "Shift"),
      detail: joinDetail([
        formatPerthDay(date),
        `${perthTimeOf(shift.startsAt)} to ${perthTimeOf(shift.endsAt)}`,
        shift.location,
      ]),
      date,
      href: ROSTER_SHIFTS_HREF,
      // "nights" and "on call" are what people type; the kind label carries both.
      tags: [kindLabel ?? "", kindLabel ? `${kindLabel}s` : "", "shift", "shifts"].filter(Boolean),
      text: [shift.location ?? "", shift.workplace ?? ""],
    } satisfies WorkItem;
  });
}

const LEAVE_KIND_LABEL: Readonly<Record<RosterLeave["kind"], string>> = {
  annual: "Annual leave",
  pd_leave: "Professional development leave",
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
    title: LEAVE_KIND_LABEL[row.kind],
    detail: joinDetail([
      row.startsOn === row.endsOn
        ? formatPerthDay(row.startsOn)
        : `${formatPerthDay(row.startsOn)} to ${formatPerthDay(row.endsOn)}`,
      LEAVE_STATUS_LABEL[row.status],
    ]),
    date: row.startsOn,
    href: ROSTER_LEAVE_HREF,
    tags: ["leave", "holiday", row.kind === "pd_leave" ? "study leave" : "annual"],
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
        href: session.source === "teaching" ? `/teaching/session/${session.occurrenceId}` : "/teaching/week",
        tags: ["teaching", "session", ...(session.isPresenter ? ["presenting", "presenter", "my talk"] : [])],
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
        tags: ["cpd", "activity", ...categories, ...entry.buckets],
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
  return {
    id: `entry:${compliance ? "renewal" : "entry"}:${entry.id}`,
    area: compliance ? "my-work" : areaForEntryHref(href),
    kind: compliance ? "renewal" : "entry",
    title: entry.title,
    detail: onCallSearchSummary(entry),
    date: compliance ? (complianceExpiresOn(entry) ?? null) : null,
    href,
    tags: [...entry.tags, ...(compliance ? ["renewal", "renew", "expiry", "due"] : [])],
    text: [entry.subtitle ?? ""],
  };
}
