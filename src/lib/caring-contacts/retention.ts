// src/lib/caring-contacts/retention.ts
//
// Retention policy and de-identification for caring-contact episodes and their audit trail.
//
// Contract (decision lock, 2026-08-19):
//   * DEFAULT_RETENTION_POLICY holds the one hard-coded retention period in this module -- every
//     other file in this directory reaches for it (or an explicit override) rather than repeating
//     the number. A sibling-scanning test in this suite enforces that.
//   * an episode becomes due for de-identification only once it has reached a terminal state AND
//     the policy period has elapsed since it did, measured in AWST calendar days -- never UTC, and
//     never from any other milestone.
//   * de-identifying an episode removes everything that identifies the patient (name, mobile,
//     identifiers, cultural identity) and keeps everything needed for aggregate reporting (plan
//     dates, pathway version, team, outcome, counts).
//   * de-identifying an audit event keeps only the five fields that tell the story of what
//     happened -- actor id, action, timestamp, object type, outcome -- and drops everything else,
//     including the object id, which could otherwise point back at a specific patient's record.
//   * both de-identification functions are idempotent: applying either a second time returns the
//     same value as applying it once, so a caller never has to track whether it already ran.
import type { AuditEvent, AuditOutcome } from "./audit";
import { awstCalendarDay } from "./clock";
import type { Clock } from "./clock";
import type { DeidentifiedEpisode, Episode, EpisodeState } from "./episode";
import type { ActorId } from "./ids";
import type { TransitionResult } from "./model";

export type RetentionPolicy = { years: number };

/** The one hard-coded retention period in this domain. Callers may override it per call. */
export const DEFAULT_RETENTION_POLICY: RetentionPolicy = Object.freeze({ years: 7 });

// The episode shape moved to ./episode so the datastore can project one without importing this
// policy module, which the sibling guard in tests/caring-contacts-retention.test.ts forbids. It is
// re-exported here unchanged, so every existing import of these names still resolves.
export type { DeidentifiedEpisode, Episode, EpisodeCounts, EpisodePlanDates, EpisodeState } from "./episode";

const TERMINAL_EPISODE_STATES: readonly EpisodeState[] = Object.freeze(["withdrawn", "cancelled", "completed"]);

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

/** Adds whole years to an AWST calendar day, clamping 29 Feb to 28 Feb in a non-leap target year. */
function addYearsToCalendarDay(calendarDay: string, years: number): string {
  const [year, month, day] = calendarDay.split("-").map(Number);
  const targetYear = year + years;
  const clampedDay = Math.min(day, daysInMonth(targetYear, month));
  return `${String(targetYear).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(clampedDay).padStart(2, "0")}`;
}

/**
 * True only once an episode has reached a terminal state and `policy.years` whole years have
 * elapsed since it did, both sides measured as an AWST calendar day. An episode that has not
 * completed, or whose completion instant is unknown, is never due.
 */
export function isDueForDeidentification(episode: Episode, policy: RetentionPolicy, clock: Clock): boolean {
  if (!TERMINAL_EPISODE_STATES.includes(episode.state)) return false;
  if (episode.planDates.completedAt === null) return false;

  const completedCalendarDay = awstCalendarDay(episode.planDates.completedAt);
  const dueCalendarDay = addYearsToCalendarDay(completedCalendarDay, policy.years);
  const nowCalendarDay = awstCalendarDay(clock.now());
  return nowCalendarDay >= dueCalendarDay;
}

/**
 * The two facts a clearance decision turns on, and deliberately nothing else.
 *
 * Narrowed rather than taking a whole `Episode` for the same reason `ServiceStopBannerFacts` is
 * narrowed in ./service-state: a store asking this question holds a plan row, not an assembled
 * episode, and a wider parameter would invite the rule to start reading fields it has no business
 * in. `Episode` is structurally assignable to it, so a caller that does hold one just passes it.
 */
export type RetentionClearanceFacts = {
  state: EpisodeState;
  planDates: { completedAt: Date | null };
};

/**
 * Whether an episode's identifying detail may be recorded as cleared, and the instant it ended.
 *
 * The precondition is `isDueForDeidentification`'s own, and it is stated once above it: an episode
 * that has not completed, or whose completion instant is unknown, is never due. An episode that
 * could never have become due cannot meaningfully be marked cleared either -- so this refuses,
 * rather than accepting and recording nothing. Both preconditions carry the SAME reason because
 * they are the same fact from the storage layer's side: there is no end instant to clear against.
 *
 * Returning that instant is not a convenience. A stored clearance is only interpretable beside the
 * end it is measured from, which is why the schema's own
 * `retention_state_cleared_after_terminal` refuses one without the other.
 *
 * Pure transition: no ambient time, no storage, no permission check -- the caller has already
 * authorised the action, and recording it in the audit trail is likewise the caller's job.
 */
export function admitRetentionClearance(episode: RetentionClearanceFacts): TransitionResult<Date> {
  if (!TERMINAL_EPISODE_STATES.includes(episode.state)) {
    return { ok: false, reason: "retention-episode-not-terminal" };
  }
  const { completedAt } = episode.planDates;
  if (completedAt === null) return { ok: false, reason: "retention-episode-not-terminal" };
  return { ok: true, value: new Date(completedAt.getTime()) };
}

/**
 * Removes patient name, mobile number, identifiers, and cultural identity; keeps plan dates,
 * pathway version, team, outcome, and counts. Accepts an already-de-identified episode too, so
 * applying it twice is exactly the same as applying it once.
 */
export function deidentifyEpisode(episode: Episode | DeidentifiedEpisode): DeidentifiedEpisode {
  const { state, planDates, pathwayVersionId, teamId, outcome, counts } = episode;
  return Object.freeze({
    state,
    planDates: Object.freeze({ ...planDates }),
    pathwayVersionId,
    teamId,
    outcome,
    counts: Object.freeze({ ...counts }),
  });
}

export type DeidentifiedAuditEvent = {
  actorId: ActorId;
  action: string;
  timestamp: string;
  objectType: string;
  outcome: AuditOutcome;
  /** Always cleared: the object id can point back at a specific patient's record. */
  objectId: string;
};

/**
 * Keeps exactly actor id, action, timestamp, object type, and outcome; clears object id and drops
 * every other field (actor roles, team id, idempotency key). Accepts an already-de-identified
 * event too, so applying it twice is exactly the same as applying it once.
 */
export function deidentifyAuditEvent(event: AuditEvent | DeidentifiedAuditEvent): DeidentifiedAuditEvent {
  const { actorId, action, timestamp, objectType, outcome } = event;
  return Object.freeze({ actorId, action, timestamp, objectType, outcome, objectId: "" });
}
