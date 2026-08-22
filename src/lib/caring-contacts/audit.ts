// src/lib/caring-contacts/audit.ts
//
// Frozen, patient-data-free audit trail records for caring-contact actions.
//
// Contract (decision lock, 2026-08-19):
//   * every event names the actor, its roles, the team, the action, the kind and id of the object
//     acted on, and whether the action was allowed, denied, or failed -- never why in clinical terms;
//   * an event must never carry a mobile number, a message body, or any free clinical text -- the
//     guard below rejects both by value (a mobile-number pattern) and by field name (a configurable
//     denylist), so a caller cannot smuggle patient data through an unexpected field, even one the
//     type checker never saw;
//   * every event is frozen at construction. An audit record that can be edited after the fact is
//     not an audit record.
//
// Pure and deterministic given a clock: buildAuditEvent never reaches for a datastore or any clock
// other than the one it is handed.
import { awstIsoTimestamp, type Clock } from "./clock";
import type { ActorId, IdempotencyKey, TeamId } from "./ids";

export type AuditOutcome = "allowed" | "denied" | "failed";

export type AuditableChange = {
  actorId: ActorId;
  actorRoles: readonly string[];
  teamId: TeamId;
  action: string;
  objectType: string;
  objectId: string;
  outcome: AuditOutcome;
  idempotencyKey: IdempotencyKey;
};

export type AuditEvent = AuditableChange & {
  /** ISO-8601 instant with an explicit numeric offset (AWST, +08:00 year-round -- see clock.ts). */
  timestamp: string;
};

/**
 * Australian mobile numbers, in every form this codebase has produced them: spaced
 * ("+61 491 570 156"), unspaced ("+61491570156"), and the 04xx local form, spaced or not
 * ("0491 570 156" / "0491570156").
 */
const AU_MOBILE_NUMBER_PATTERN = /(?:\+?61[ .-]?4\d{2}[ .-]?\d{3}[ .-]?\d{3})|(?:\b04\d{2}[ .-]?\d{3}[ .-]?\d{3}\b)/;

/**
 * Field names that must never appear on an audit event, regardless of value -- these are the
 * shapes patient data takes elsewhere in this domain (see message-policy.ts). Exported so a
 * caller with a wider denylist can extend the guard instead of forking it.
 */
export const DEFAULT_FORBIDDEN_AUDIT_FIELD_NAMES: readonly string[] = Object.freeze([
  "mobileNumber",
  "mobile",
  "phoneNumber",
  "patientMobileNumber",
  "messageBody",
  "message",
  "text",
  "clinicalNote",
  "note",
  "notes",
  "patientName",
  "name",
  "culturalIdentity",
]);

export class AuditEventContainsPatientDataError extends Error {
  constructor(reason: string) {
    super(`audit-event-contains-patient-data: ${reason}`);
    this.name = "audit-event-contains-patient-data";
  }
}

/**
 * Throws `AuditEventContainsPatientDataError` if any own field's value matches the mobile-number
 * pattern, or if any own field name is in `forbiddenFieldNames`. Runs against every own key on
 * `input`, not just the keys the caller's declared type has, so a loosely-typed caller (or one
 * that spreads extra data onto the object) cannot smuggle a field past the type checker.
 */
export function assertAuditEventFreeOfPatientData(
  input: Record<string, unknown>,
  forbiddenFieldNames: readonly string[] = DEFAULT_FORBIDDEN_AUDIT_FIELD_NAMES,
): void {
  for (const [field, value] of Object.entries(input)) {
    if (forbiddenFieldNames.includes(field)) {
      throw new AuditEventContainsPatientDataError(`forbidden field name "${field}"`);
    }
    const candidates = Array.isArray(value) ? value : [value];
    for (const candidate of candidates) {
      if (typeof candidate === "string" && AU_MOBILE_NUMBER_PATTERN.test(candidate)) {
        throw new AuditEventContainsPatientDataError(`mobile-number pattern matched in field "${field}"`);
      }
    }
  }
}

/**
 * Builds a frozen audit event from `input` and `clock`. Pure and deterministic given the clock:
 * the same input and the same clock always produce byte-identical output. Throws
 * `AuditEventContainsPatientDataError` before constructing anything if `input` fails the guard.
 */
export function buildAuditEvent(input: AuditableChange, clock: Clock): AuditEvent {
  assertAuditEventFreeOfPatientData(input as unknown as Record<string, unknown>);

  const event: AuditEvent = {
    actorId: input.actorId,
    actorRoles: Object.freeze([...input.actorRoles]),
    teamId: input.teamId,
    action: input.action,
    objectType: input.objectType,
    objectId: input.objectId,
    outcome: input.outcome,
    idempotencyKey: input.idempotencyKey,
    timestamp: awstIsoTimestamp(clock.now()),
  };
  return Object.freeze(event);
}
