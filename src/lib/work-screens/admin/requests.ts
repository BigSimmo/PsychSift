import type { ComplianceOverview } from "@/lib/admin/compliance-overview";
import { formatRecordedDate } from "@/lib/admin/renewal-dates";
import { addDaysToDate } from "@/lib/roster/shifts/perth-time";
import type {
  AdminRequest,
  MoreTimeReason,
  RequestKind,
  RequestOutcome,
  RequestStatus,
} from "@/lib/work-screens/admin/paperwork-model";

/**
 * Admin · Requests: asks the doctor sends to Medical Workforce, Staff Health
 * or anyone else, and tracks until there is an answer. The doctor sends each
 * message themselves (copy, or an email draft in their own mail app).
 * PsychSift writes the message and keeps the request and its status on this
 * device. Nothing is sent from here, and no one can send a request in.
 */

export const REQUEST_KIND_WORDS: Record<RequestKind, string> = {
  "more-time": "More time",
  document: "Send a document",
  leave: "Leave",
  question: "A question",
  other: "Something else",
};

export { MORE_TIME_REASONS, type MoreTimeReason } from "@/lib/work-screens/admin/paperwork-model";

/** A health reason goes to Staff Health only, the mockup's rule. */
export function recipientForReason(reason: MoreTimeReason | null, current: string): string {
  return reason === "Health reason" ? "Staff Health" : current;
}

export function isStaffHealth(to: string): boolean {
  return to.trim().toLowerCase() === "staff health";
}

/** Days after sending before a request with no reply shows "Chase". */
export const REQUEST_CHASE_AFTER_DAYS = 7;

export function requestStatusWord(request: AdminRequest): string {
  if (request.status === "draft") return "Draft";
  if (request.status === "sent") return "Sent";
  if (request.status === "seen") return "Seen";
  if (request.outcome === "agreed") return "Agreed";
  if (request.outcome === "declined") return "Declined";
  return "Answered";
}

export type RequestStep = { readonly label: string; readonly done: boolean };

/** The mockup's Asked, Seen, Decision steps, with a draft shown as not yet asked. */
export function requestSteps(request: AdminRequest): RequestStep[] {
  const order: RequestStatus[] = ["sent", "seen", "decided"];
  const at = order.indexOf(request.status);
  return [
    { label: "Asked", done: at >= 0 },
    { label: "Seen", done: at >= 1 },
    { label: "Decision", done: at >= 2 },
  ];
}

export function isOpenRequest(request: AdminRequest): boolean {
  return request.status !== "decided";
}

/** A sent request with no reply by its follow-up date. */
export function needsChase(request: AdminRequest, today: string): boolean {
  return (
    (request.status === "sent" || request.status === "seen") &&
    Boolean(request.followUpOn) &&
    request.followUpOn! <= today
  );
}

/** The date that matters most for ordering: what is due, else when to chase, else when it was made. */
function sortKey(request: AdminRequest): string {
  return request.dueOn ?? request.followUpOn ?? request.createdOn;
}

/** Open first, soonest first. Done newest answer first. */
export function sortRequests(requests: readonly AdminRequest[]): { open: AdminRequest[]; done: AdminRequest[] } {
  const open = requests
    .filter(isOpenRequest)
    .sort((a, b) => (sortKey(a) < sortKey(b) ? -1 : sortKey(a) > sortKey(b) ? 1 : 0));
  const done = requests
    .filter((request) => !isOpenRequest(request))
    .sort((a, b) => ((a.decidedOn ?? "") < (b.decidedOn ?? "") ? 1 : -1));
  return { open, done };
}

export interface RequestDraftInput {
  readonly kind: RequestKind;
  readonly title: string;
  readonly to: string;
  readonly dueOn: string;
  readonly askedFor: string;
  readonly reason: MoreTimeReason | null;
  readonly note: string;
}

export interface RequestDraftErrors {
  title?: string;
  to?: string;
  askedFor?: string;
  dueOn?: string;
  email?: string;
}

const REAL_DATE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** True when a typed address reads as an email address. Blank is allowed: the draft opens with no address. */
export function isEmailAddress(text: string): boolean {
  return EMAIL.test(text.trim());
}

export function validateRequestDraft(input: RequestDraftInput & { readonly email?: string }): RequestDraftErrors {
  const errors: RequestDraftErrors = {};
  if (!input.title.trim()) errors.title = "Say what the request is about.";
  if (!input.to.trim()) errors.to = "Say who it goes to.";
  // A health reason is for Staff Health only, never Medical Workforce or a manager.
  else if (input.kind === "more-time" && input.reason === "Health reason" && !isStaffHealth(input.to))
    errors.to = "A health reason goes to Staff Health only.";
  if (input.email?.trim() && !isEmailAddress(input.email)) errors.email = "Check the email address.";
  if (input.dueOn && !REAL_DATE.test(input.dueOn)) errors.dueOn = "Use the date picker.";
  if (input.kind === "more-time") {
    if (!input.askedFor) errors.askedFor = "Pick the new date you are asking for.";
    else if (!REAL_DATE.test(input.askedFor)) errors.askedFor = "Use the date picker.";
    else if (input.dueOn && input.askedFor <= input.dueOn) errors.askedFor = "Pick a date after it is due.";
  }
  return errors;
}

export function hasRequestErrors(errors: RequestDraftErrors): boolean {
  return Object.values(errors).some(Boolean);
}

/** The message the doctor sends: plain, short, and only what they typed. */
export function buildRequestMessage(input: RequestDraftInput): string {
  const title = input.title.trim();
  const note = input.note.trim();
  const lines: string[] = [];
  if (input.kind === "more-time") {
    const dates =
      input.dueOn && input.askedFor
        ? `${formatRecordedDate(input.dueOn)} to ${formatRecordedDate(input.askedFor)}`
        : input.askedFor
          ? `until ${formatRecordedDate(input.askedFor)}`
          : "";
    lines.push(`Could I please have more time for ${title}${dates ? `, ${dates}` : ""}?`);
    // Only the reason's word, never the health detail behind it.
    if (input.reason && input.reason !== "Other") lines.push(`Reason: ${input.reason}.`);
  } else if (input.kind === "document") {
    lines.push(`Please find my ${title}${input.dueOn ? `, due ${formatRecordedDate(input.dueOn)}` : ""}.`);
  } else if (input.kind === "leave") {
    lines.push(`I would like to ask about leave: ${title}.`);
  } else {
    lines.push(title.endsWith("?") ? title : `${title}.`);
    if (input.dueOn) lines.push(`I need to know by ${formatRecordedDate(input.dueOn)}.`);
  }
  if (note) lines.push(note);
  lines.push("Thank you.");
  return lines.join("\n");
}

export function requestSubject(request: Pick<AdminRequest, "kind" | "title">): string {
  return request.kind === "more-time" ? `More time: ${request.title}` : request.title;
}

export function requestMailtoHref(request: Pick<AdminRequest, "kind" | "title" | "message" | "toEmail">): string {
  const email = request.toEmail && isEmailAddress(request.toEmail) ? encodeURIComponent(request.toEmail.trim()) : "";
  return `mailto:${email}?subject=${encodeURIComponent(requestSubject(request))}&body=${encodeURIComponent(request.message)}`;
}

/** A polite follow-up for a request that has had no reply. */
export function chaseMessage(request: AdminRequest): string {
  const sent = request.sentOn ? ` on ${formatRecordedDate(request.sentOn)}` : "";
  return [
    `Following up my request${sent}: ${requestSubject(request)}.`,
    "Could you let me know where it is up to?",
    "Thank you.",
  ].join("\n");
}

export function newRequest(input: RequestDraftInput, id: string, today: string, toEmail?: string): AdminRequest {
  return {
    id,
    kind: input.kind,
    title: input.title.trim(),
    to: input.to.trim(),
    ...(toEmail ? { toEmail } : {}),
    message: buildRequestMessage(input),
    ...(input.kind === "more-time" && input.reason ? { reason: input.reason } : {}),
    ...(input.note.trim() ? { note: input.note.trim() } : {}),
    ...(input.dueOn ? { dueOn: input.dueOn } : {}),
    ...(input.kind === "more-time" && input.askedFor ? { askedFor: input.askedFor } : {}),
    status: "draft",
    createdOn: today,
  };
}

/** Marks a request sent today, with a chase date a week on. */
export function markSent(request: AdminRequest, today: string): AdminRequest {
  return {
    ...request,
    status: request.status === "draft" ? "sent" : request.status,
    sentOn: request.sentOn ?? today,
    followUpOn: request.followUpOn ?? addDaysToDate(today, REQUEST_CHASE_AFTER_DAYS),
  };
}

export function markSeen(request: AdminRequest, today: string): AdminRequest {
  return { ...request, status: "seen", seenOn: today };
}

export function recordAnswer(
  request: AdminRequest,
  outcome: RequestOutcome,
  note: string,
  today: string,
): AdminRequest {
  const trimmed = note.trim();
  return {
    ...request,
    status: "decided",
    outcome,
    decidedOn: today,
    ...(trimmed ? { outcomeNote: trimmed } : {}),
    followUpOn: undefined,
  };
}

/** Puts an answered request back to open, for "Reopen". */
export function reopen(request: AdminRequest): AdminRequest {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- dropped from the reopened copy
  const { outcome: _outcome, outcomeNote: _note, decidedOn: _decided, ...rest } = request;
  return { ...rest, status: request.seenOn ? "seen" : "sent" };
}

/**
 * A saved edit: what the sheet holds now, over the request's own history (its
 * id, status and dates). Fields the doctor can clear in the sheet (reason,
 * note, dates, email) come only from the new save, so clearing one sticks.
 */
export function editedRequest(existing: AdminRequest, next: AdminRequest): AdminRequest {
  const history: Partial<AdminRequest> = { ...existing };
  for (const key of ["reason", "note", "dueOn", "askedFor", "toEmail"] as const) delete history[key];
  return { ...history, ...next, id: existing.id, status: existing.status, createdOn: existing.createdOn };
}

/** Drops undefined keys, so the strict schema reads the record back. */
export function cleanRequest(request: AdminRequest): AdminRequest {
  return Object.fromEntries(Object.entries(request).filter(([, value]) => value !== undefined)) as AdminRequest;
}

export interface MoreTimeSuggestion {
  readonly key: string;
  readonly title: string;
  readonly dueOn: string;
  readonly bucket: "date-passed" | "start-renewing";
  readonly href: string;
}

/**
 * Items the doctor may need more time for, from their own Compliance view:
 * dates passed, or renewing with 30 days or less to go. Soonest first, three at
 * most. Items already asked about (an open more-time request with the same
 * title) are left out.
 */
export function moreTimeSuggestions(
  overview: ComplianceOverview,
  requests: readonly AdminRequest[],
  today: string,
): MoreTimeSuggestion[] {
  const asked = new Set(
    requests
      .filter((request) => request.kind === "more-time" && isOpenRequest(request))
      .map((request) => request.title.toLowerCase()),
  );
  const horizon = addDaysToDate(today, 30);
  return overview.groups
    .flatMap((group) => group.items)
    .filter(
      (item) =>
        item.row.expiresOn !== undefined &&
        (item.bucket === "date-passed" || (item.bucket === "start-renewing" && item.row.expiresOn <= horizon)) &&
        !asked.has(item.row.item.title.toLowerCase()),
    )
    .sort((a, b) => (a.row.expiresOn! < b.row.expiresOn! ? -1 : 1))
    .slice(0, 3)
    .map((item) => ({
      key: item.row.item.id,
      title: item.row.item.title,
      dueOn: item.row.expiresOn!,
      bucket: item.bucket as "date-passed" | "start-renewing",
      href: `/admin/renewals?item=${item.row.entry?.id ?? item.row.item.id}`,
    }));
}
