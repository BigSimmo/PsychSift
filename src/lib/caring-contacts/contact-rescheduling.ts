// src/lib/caring-contacts/contact-rescheduling.ts
//
// Coordination design spec §5: "A coordinator may move a contact only within its scheduled day;
// a date change needs a reason and team-lead approval." `moveContactWithinDay` and
// `changeContactDate` are granted action names with no rules behind them until now. Spec §8 also
// requires that nothing sends outside 09:00-18:00 AWST and that the twelve-month calendar never
// rebases -- both functions below leave `sequence`, `cadenceLabel`, `messageType`, and
// `suppressed` untouched; only `calendarDay` and `sendAt` ever change.
//
// Pure transition module: no ambient time beyond the injected `Clock` (only `changeContactDate`
// needs one, to compare the target day against "today"), no storage, no permission check -- the
// caller has already authorised the action and, for a date change, already collected the
// team-lead approval this module only checks for presence.
import { awstCalendarDay, awstWallTimeToInstant, type Clock } from "./clock";
import type { ActorId } from "./ids";
import type { TransitionResult } from "./model";
import { isWithinApprovedSendWindow, type PlannedContact } from "./schedule";

export type ContactMoveRequest = { contact: PlannedContact; toHour: number; toMinute: number };
export type ContactDateChangeRequest = {
  contact: PlannedContact;
  toCalendarDay: string;
  reason: string;
  teamLeadApprovalActorId: ActorId | null;
};

/**
 * Moves a contact to a different time on the same scheduled day.
 *
 * Refusals:
 *   * `contact-move-leaves-scheduled-day` -- the resulting instant's AWST calendar day must equal
 *     `contact.calendarDay`. Checked independently of the window check below: an hour/minute pair
 *     that overflows past midnight can roll onto the next AWST day while still looking like an
 *     in-window hour (e.g. 33:00 on day N reads as 09:00 on day N+1), so this check cannot be
 *     skipped just because the resulting hour happens to fall inside 09:00-18:00.
 *   * `contact-move-outside-approved-window` -- the resulting instant must fall inside
 *     `APPROVED_SEND_WINDOW` (09:00-18:00 AWST).
 */
export function moveContactWithinDay(request: ContactMoveRequest): TransitionResult<PlannedContact> {
  const { contact, toHour, toMinute } = request;
  const sendAt = awstWallTimeToInstant(contact.calendarDay, toHour, toMinute);

  if (awstCalendarDay(sendAt) !== contact.calendarDay) {
    return { ok: false, reason: "contact-move-leaves-scheduled-day" };
  }
  if (!isWithinApprovedSendWindow(sendAt)) {
    return { ok: false, reason: "contact-move-outside-approved-window" };
  }

  return { ok: true, value: { ...contact, sendAt } };
}

/**
 * Moves a contact to a different scheduled day, at the same wall-clock hour it was already
 * scheduled for (see the module note: the twelve-month calendar's other fields never rebase, and
 * the send hour is one of them -- a date change is a date change, not also an implicit time
 * change).
 *
 * Refusals:
 *   * `contact-date-change-reason-required` -- a non-blank reason is required.
 *   * `contact-date-change-approval-required` -- a team-lead approver must be recorded.
 *   * `contact-date-change-in-the-past` -- the target day must not be before the clock's current
 *     AWST calendar day.
 */
export function changeContactDate(request: ContactDateChangeRequest, clock: Clock): TransitionResult<PlannedContact> {
  const { contact, toCalendarDay, reason, teamLeadApprovalActorId } = request;

  if (reason.trim() === "") return { ok: false, reason: "contact-date-change-reason-required" };
  if (teamLeadApprovalActorId === null) return { ok: false, reason: "contact-date-change-approval-required" };

  const today = awstCalendarDay(clock.now());
  if (toCalendarDay < today) return { ok: false, reason: "contact-date-change-in-the-past" };

  const { hour, minute } = wallClockOf(contact.sendAt, contact.calendarDay);
  return {
    ok: true,
    value: { ...contact, calendarDay: toCalendarDay, sendAt: awstWallTimeToInstant(toCalendarDay, hour, minute) },
  };
}

/** Recovers the AWST wall-clock hour/minute a contact was scheduled at, from its own `sendAt`. */
function wallClockOf(sendAt: Date, calendarDay: string): { hour: number; minute: number } {
  const wholeMinutesSinceMidnight = Math.round(
    (sendAt.getTime() - awstWallTimeToInstant(calendarDay, 0, 0).getTime()) / 60_000,
  );
  return { hour: Math.floor(wholeMinutesSinceMidnight / 60), minute: wholeMinutesSinceMidnight % 60 };
}
