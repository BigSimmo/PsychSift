import type { z } from "zod";

import { formatRecordedDate, renewalStartOn } from "@/lib/admin/renewal-dates";
import { addDays, type CalendarEvent } from "@/lib/calendar/calendar-event";
import { toIcs } from "@/lib/calendar/ics";
import { perthCalendarDate } from "@/lib/cme/cpd-year";
import {
  ADMIN_REQUIREMENTS_CATALOGUE,
  catalogueItemForEntry,
  requirementChecklistRowsForJob,
  type AdminRequirementCatalogueItem,
} from "@/lib/admin/requirements";
import type { createOnCallEntrySchema, updateOnCallEntrySchema } from "@/lib/on-call/api-schemas";
import { onCallExpiryEvents } from "@/lib/on-call/calendar-events";
import {
  complianceExpiresOn,
  complianceIssuerCheckedOn,
  entryNotForThisJob,
  partitionLogisticsEntries,
  sortComplianceEntries,
} from "@/lib/on-call/compliance";
import type { OnCallEntry } from "@/lib/on-call/entry-model";

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const HISTORY_LIMIT = 10;
type UpdateBody = z.input<typeof updateOnCallEntrySchema>;

function detailsOf(entry: OnCallEntry): Record<string, unknown> {
  return typeof entry.details === "object" && entry.details !== null ? (entry.details as Record<string, unknown>) : {};
}

export function complianceExpiryHistory(entry: OnCallEntry): string[] {
  const value = detailsOf(entry).expiryHistory;
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && DATE_KEY.test(item))
    : [];
}

/** PATCH is a full replace (updateOnCallEntrySchema): every field round-trips unchanged. Exported
 *  so another Admin module patching one `details` key (`src/lib/admin/new-job-progress.ts`) can
 *  build the same complete body rather than re-deriving this list of fields. */
export function fullBody(entry: OnCallEntry, details: unknown): UpdateBody {
  return {
    section: entry.section,
    slug: entry.slug,
    title: entry.title,
    subtitle: entry.subtitle,
    body: entry.body,
    details,
    linkedDocumentIds: entry.linkedDocumentIds,
    tags: entry.tags,
    isPersonal: entry.isPersonal,
    includeOnCard: entry.includeOnCard,
    sortOrder: entry.sortOrder,
    lastVerifiedAt: entry.lastVerifiedAt,
  };
}

export type RenewedInput = { newExpiresOn: string; proofNote: string };

export function buildRenewedEntryBody(
  entry: OnCallEntry,
  input: RenewedInput,
):
  | { ok: true; body: UpdateBody; earlier: boolean }
  | { ok: false; reason: "missing" | "malformed" | "unchanged" | "too-long" } {
  const next = input.newExpiresOn.trim();
  if (!next) return { ok: false, reason: "missing" };
  if (!DATE_KEY.test(next) || Number.isNaN(Date.parse(`${next}T00:00:00Z`))) return { ok: false, reason: "malformed" };
  const previous = complianceExpiresOn(entry);
  if (previous === next) return { ok: false, reason: "unchanged" };
  const note = input.proofNote.trim();
  if (note.length > 120) return { ok: false, reason: "too-long" };
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- destructured only to drop it from `rest`
  const { proofNote: _dropped, ...rest } = detailsOf(entry);
  const history = previous
    ? [previous, ...complianceExpiryHistory(entry)].slice(0, HISTORY_LIMIT)
    : complianceExpiryHistory(entry);
  return {
    ok: true,
    earlier: previous !== undefined && next < previous,
    body: fullBody(entry, {
      ...rest,
      expiresOn: next,
      expiryHistory: history,
      provenance: "typed",
      ...(note ? { proofNote: note } : {}),
    }),
  };
}

/**
 * A never-recorded catalogue item, shaped as the entry `buildRenewedEntryBody`
 * expects, so a first date ("Add date", "Record missing dates") reuses the
 * exact same validation and body-building as "Renewed" instead of a second
 * copy of it. `id`/`isOwn` are dropped by the create route's own schema, so
 * leaving them blank here is harmless. A fresh slug suffix per call.
 */
export function catalogueItemDraftEntry(item: AdminRequirementCatalogueItem): OnCallEntry {
  return {
    id: "",
    section: "logistics",
    slug: `${item.id}-${Math.random().toString(36).slice(2, 8)}`,
    title: item.title,
    subtitle: null,
    body: null,
    details: { kind: "compliance", category: item.group, requirementId: item.id },
    linkedDocumentIds: [],
    tags: [],
    isPersonal: true,
    includeOnCard: false,
    sortOrder: 0,
    lastVerifiedAt: null,
    isOwn: true,
  };
}

/** Undo ("Marked renewed. Undo"): the row exactly as it was before the save. Also the undo
 *  path for the "Not for this job" toggle below (same pattern: restore the original row). */
export function buildRestoreEntryBody(original: OnCallEntry): UpdateBody {
  return fullBody(original, original.details);
}

/** 09:00 Perth on a calendar day, as a UTC instant. Perth has no daylight saving: always 01:00Z. */
function perthNineAm(date: string): string {
  return `${date}T01:00:00.000Z`;
}

/**
 * Spec review 9: the calendar export's own expiry event (same stable id, so
 * re-downloading replaces it rather than adding a second), with alerts at 09:00
 * Perth at the start of the lead time and one week before the date. An alert
 * whose moment has passed is dropped.
 */
export function renewalCalendarEvent(entry: OnCallEntry, now: Date): CalendarEvent | null {
  const [base] = onCallExpiryEvents([entry]);
  const expiresOn = complianceExpiresOn(entry);
  const startOn = renewalStartOn(entry);
  if (!base || !expiresOn || !startOn) return null;
  const alarms = [...new Set([startOn, addDays(expiresOn, -7)])]
    .sort()
    .map(perthNineAm)
    .filter((instant) => Date.parse(instant) > now.getTime());
  // `reminderType` is dropped: this file carries its own alerts, not the Settings-driven one.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- destructured only to drop it from `event`
  const { reminderType: _feedOnly, ...event } = base;
  return { ...event, alarmsAt: alarms };
}

/** The compliance rows that belong in an export: never one marked "not for this job". */
function exportableComplianceEntries(entries: readonly OnCallEntry[]): OnCallEntry[] {
  return partitionLogisticsEntries(entries).compliance.filter((entry) => !entryNotForThisJob(entry));
}

/** One file with every dated renewal (spec review 9, "Add all to my calendar"). No calendar name.
 *  A row marked "not for this job" is left out: it does not apply to this doctor. */
export function renewalsCalendarFile(entries: readonly OnCallEntry[], now: Date): string | null {
  const events = exportableComplianceEntries(entries).flatMap((entry) => {
    const event = renewalCalendarEvent(entry, now);
    return event ? [event] : [];
  });
  return events.length ? toIcs(events, { now }) : null;
}

/** Holder-facing stamp line — never "verified" / "compliant". */
export function issuerCheckStampLabel(checkedOn: string | undefined): string {
  return checkedOn
    ? `Last checked with issuer · ${formatRecordedDate(checkedOn)} · by you`
    : "No issuer check recorded";
}

function complianceHasProof(entry: OnCallEntry): boolean {
  const details = detailsOf(entry);
  const note = details.proofNote;
  const url = details.evidenceUrl;
  return (typeof note === "string" && note.trim().length > 0) || (typeof url === "string" && url.trim().length > 0);
}

function workforceEntryName(title: string, entry: OnCallEntry | null): string {
  const issuer = entry ? detailsOf(entry).issuingBody : undefined;
  return typeof issuer === "string" && issuer.trim() ? `${title} (${issuer.trim()})` : title;
}

/**
 * One cover-sheet line: ready vs Not recorded yet / missing proof, plus the
 * issuer-check stamp when the holder recorded one. Never a verdict.
 */
export function workforceRequirementLine(title: string, entry: OnCallEntry | null): string {
  const name = workforceEntryName(title, entry);
  if (!entry) return `${name}: Not recorded yet · missing proof`;
  const expiresOn = complianceExpiresOn(entry);
  const parts: string[] = [];
  if (expiresOn) {
    parts.push(complianceHasProof(entry) ? "ready" : "missing proof");
    parts.push(`recorded as expiring ${formatRecordedDate(expiresOn)}`);
  } else {
    parts.push("Not recorded yet");
    if (!complianceHasProof(entry)) parts.push("missing proof");
  }
  const stamp = complianceIssuerCheckedOn(entry);
  if (stamp) parts.push(issuerCheckStampLabel(stamp));
  return `${name}: ${parts.join(" · ")}`;
}

/**
 * Cover-sheet text for workforce: every applicable catalogue requirement
 * (naming gaps as Not recorded yet / missing proof) plus personal renewals
 * that are not on the catalogue. Stamp lines only when the holder set one.
 */
export function workforceCopyText(entries: readonly OnCallEntry[], now: Date): string {
  const exportable = exportableComplianceEntries(entries);
  const catalogueRows = requirementChecklistRowsForJob(ADMIN_REQUIREMENTS_CATALOGUE, exportable);
  const catalogueMatched = new Set(catalogueRows.flatMap((row) => (row.entry ? [row.entry.id] : [])));
  const personal = sortComplianceEntries(exportable.filter((entry) => !catalogueMatched.has(entry.id))).filter(
    (entry) => !catalogueItemForEntry(entry),
  );
  const lines = [
    ...catalogueRows.map((row) => workforceRequirementLine(row.item.title, row.entry)),
    ...personal.map((entry) => workforceRequirementLine(entry.title, entry)),
  ];
  return [
    `Dates as I recorded them, copied ${formatRecordedDate(perthCalendarDate(now))}. Not checked with issuers`,
    ...lines,
  ].join("\n");
}

/**
 * Explicit holder action: set or clear `details.issuerCheckedOn`. Never called
 * from Renewed — that path must leave the stamp untouched.
 */
export function buildIssuerCheckStampBody(
  entry: OnCallEntry,
  checkedOn: string | null,
): { ok: true; body: UpdateBody } | { ok: false; reason: "malformed" } {
  if (checkedOn !== null && (!DATE_KEY.test(checkedOn) || Number.isNaN(Date.parse(`${checkedOn}T00:00:00Z`)))) {
    return { ok: false, reason: "malformed" };
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- destructured only to drop it from `rest`
  const { issuerCheckedOn: _dropped, ...rest } = detailsOf(entry);
  return {
    ok: true,
    body: fullBody(entry, checkedOn ? { ...rest, issuerCheckedOn: checkedOn } : rest),
  };
}

/**
 * Spec review 27/28: "Not for this job" splits the compliance rows into the
 * ones that count towards the "X of Y recorded" ring, and the ones marked as
 * not applying to this doctor's job, which move to a final section and leave
 * the count — they are not counted as either recorded or unrecorded.
 *
 * `counted` keeps every other compliance row, recorded and not-recorded alike,
 * in the same order `partitionLogisticsEntries` returns them; a caller that
 * wants the page's own order runs it through `sortComplianceEntries`.
 */
export interface ComplianceCounts {
  readonly recorded: number;
  readonly total: number;
  readonly notForThisJob: number;
}

export interface ComplianceGroups {
  readonly counted: OnCallEntry[];
  readonly notForThisJob: OnCallEntry[];
  readonly counts: ComplianceCounts;
}

export function groupComplianceEntries(entries: readonly OnCallEntry[]): ComplianceGroups {
  const counted: OnCallEntry[] = [];
  const notForThisJob: OnCallEntry[] = [];
  for (const entry of partitionLogisticsEntries(entries).compliance) {
    if (entryNotForThisJob(entry)) notForThisJob.push(entry);
    else counted.push(entry);
  }
  const recorded = counted.filter((entry) => complianceExpiresOn(entry) !== undefined).length;
  return { counted, notForThisJob, counts: { recorded, total: counted.length, notForThisJob: notForThisJob.length } };
}

/**
 * Toggle "Not for this job" (owner-only, spec review 28). Setting it to `false`
 * drops the key rather than storing an explicit `false`, so a row nobody has
 * ever flagged and a row flagged and then un-flagged are indistinguishable —
 * the ordinary, unflagged case either way. Undo is `buildRestoreEntryBody`
 * applied to the row's state from before the toggle: the same "save the row
 * you started from" pattern the Renewed sheet uses.
 */
export function buildNotForThisJobToggleBody(entry: OnCallEntry, notForThisJob: boolean): UpdateBody {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- destructured only to drop it from `rest`
  const { notForThisJob: _dropped, ...rest } = detailsOf(entry);
  return fullBody(entry, notForThisJob ? { ...rest, notForThisJob: true } : rest);
}

/**
 * "Not for this job" on a catalogue item never recorded (the design's own
 * example: "Visa and work rights — Not recorded yet — Not for this job"). No
 * row exists to flag, so this creates the smallest one that can carry the
 * flag: private, off the card, with the item's id and group and NO expiry date
 * — nothing is guessed. Undo deletes the row it created.
 */
export function buildNotForThisJobCreateBody(
  item: AdminRequirementCatalogueItem,
  slugSuffix: string,
): z.input<typeof createOnCallEntrySchema> {
  return {
    section: "logistics",
    slug: `${item.id}-${slugSuffix}`,
    title: item.title,
    subtitle: null,
    body: null,
    details: { kind: "compliance", category: item.group, requirementId: item.id, notForThisJob: true },
    linkedDocumentIds: [],
    tags: [],
    // Compliance rows are private by the server whatever the body says (PIA-9); say so here too.
    isPersonal: true,
    includeOnCard: false,
    sortOrder: 0,
    lastVerifiedAt: null,
  };
}
