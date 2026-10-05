import { formatRecordedDate, formatRelativeDate, renewalStartOn, utcDay } from "@/lib/admin/renewal-dates";
import { complianceBucket, type ComplianceBucket } from "@/lib/admin/compliance-overview";
import type { RequirementChecklistRow } from "@/lib/admin/requirements";

/**
 * Renewals' "Renew next" card (5 Oct mock-up v2, screens 1 and 24): the one
 * item to act on now, and what comes after it. Read from the same checklist
 * rows and the same status buckets as the list and Compliance, so the card can
 * never name an item the list calls something else.
 *
 * Order: a passed date first (the longest-passed leads, because it has been
 * waiting longest), then an open renewal window, soonest date first. When
 * nothing is passed or open, the card says so and names the next recorded date.
 */

export interface RenewNextItem {
  readonly row: RequirementChecklistRow & { readonly expiresOn: string };
  readonly bucket: Extract<ComplianceBucket, "date-passed" | "start-renewing" | "recorded">;
  /** The day the renewal window opened (or opens): the date minus the item's lead time. */
  readonly startOn: string | null;
}

export type RenewNext =
  | { readonly kind: "act"; readonly item: RenewNextItem; readonly then: RenewNextItem | null }
  | { readonly kind: "nothing-due"; readonly next: RenewNextItem | null };

function dated(row: RequirementChecklistRow): row is RequirementChecklistRow & { readonly expiresOn: string } {
  return row.state === "needs-action" && typeof row.expiresOn === "string";
}

export function renewNext(rows: readonly RequirementChecklistRow[], today: string): RenewNext {
  const items: RenewNextItem[] = rows.filter(dated).map((row) => ({
    row,
    bucket: complianceBucket(row, today) as RenewNextItem["bucket"],
    startOn: row.entry ? (renewalStartOn(row.entry) ?? null) : null,
  }));
  const byDate = (a: RenewNextItem, b: RenewNextItem) =>
    a.row.expiresOn === b.row.expiresOn
      ? a.row.item.title.localeCompare(b.row.item.title)
      : a.row.expiresOn < b.row.expiresOn
        ? -1
        : 1;
  const act = [
    ...items.filter((item) => item.bucket === "date-passed").sort(byDate),
    ...items.filter((item) => item.bucket === "start-renewing").sort(byDate),
  ];
  const later = items.filter((item) => item.bucket === "recorded").sort(byDate);
  const [first, second] = act;
  if (first) return { kind: "act", item: first, then: second ?? later[0] ?? null };
  return { kind: "nothing-due", next: later[0] ?? null };
}

/** "Date passed 28 Sep 2026 · 7 days ago" or "Renew by 20 Oct 2026 · in 2 weeks". */
export function renewNextDateLine(item: RenewNextItem, today: string): string {
  const relative = formatRelativeDate(item.row.expiresOn, today);
  const label = item.bucket === "date-passed" ? "Date passed" : "Renew by";
  return `${label} ${formatRecordedDate(item.row.expiresOn)}${relative ? ` · ${relative}` : ""}`;
}

/** The "Then:" line: "Respirator fit test, renew by 20 Oct 2026, in 2 weeks". */
export function renewNextThenLine(item: RenewNextItem, today: string): string {
  const relative = formatRelativeDate(item.row.expiresOn, today);
  const verb = item.bucket === "date-passed" ? "date passed" : "renew by";
  return `${item.row.item.title}, ${verb} ${formatRecordedDate(item.row.expiresOn)}${relative ? `, ${relative}` : ""}`;
}

/** The nothing-due line: "Next: Ahpra registration, start renewing from 1 Aug 2027". */
export function renewNextNothingDueLine(item: RenewNextItem): string {
  return item.startOn
    ? `Next: ${item.row.item.title}, start renewing from ${formatRecordedDate(item.startOn)}`
    : `Next: ${item.row.item.title}, renew by ${formatRecordedDate(item.row.expiresOn)}`;
}

/**
 * Where today sits on the renewal window (start of window to the recorded
 * date), from 0 to 1, clamped. A passed date sits at the end. Null when the
 * window has no start or no length, so the card draws no bar rather than a
 * made-up one.
 */
export function renewWindowProgress(item: RenewNextItem, today: string): number | null {
  if (!item.startOn) return null;
  const start = utcDay(item.startOn);
  const end = utcDay(item.row.expiresOn);
  const now = utcDay(today);
  if (start === null || end === null || now === null || end <= start) return null;
  return Math.min(Math.max((now - start) / (end - start), 0), 1);
}
