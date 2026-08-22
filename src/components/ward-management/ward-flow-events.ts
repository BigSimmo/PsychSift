import type { Instant } from "@/components/ward-management/ward-clock";
import type { Cohort, DeclineReason, LegalStatus, Security, Sex } from "@/components/ward-management/ward-model";

/**
 * Who may raise an event. `demo` is the jump-forward / reset control on the coordinator screen —
 * it belongs to nobody's clinical role, which is exactly why it needs its own gate rather than
 * being nodded through as "coordinator".
 */
export type WardFlowRole = "coordinator" | "ed" | "ward" | "officer" | "demo";

/** The short form an ED fills in to raise a brand-new referral. */
export type ReferralDraft = {
  cohort: Cohort;
  security: Security;
  sex: Sex;
  specialling: boolean;
  legalStatus: LegalStatus;
  urgency: 1 | 2 | 3;
};

/**
 * One variant per row of spec §6. Every event carries `role` (checked against `EVENT_ROLE`
 * before anything else happens) and `now` (the reducer never reads a clock itself).
 */
export type WardFlowEvent =
  | { type: "RAISE_REFERRAL"; role: WardFlowRole; now: Instant; edId: string; draft: ReferralDraft }
  | {
      type: "RECORD_EXAMINATION";
      role: WardFlowRole;
      now: Instant;
      movementId: string;
      outcome: "inpatient_order" | "community_order" | "revoked";
    }
  | { type: "REFER_TO_UNITS"; role: WardFlowRole; now: Instant; movementId: string; unitIds: string[] }
  | { type: "ACCEPT_IN_PRINCIPLE"; role: WardFlowRole; now: Instant; movementId: string; unitId: string }
  | { type: "HOLD_BED"; role: WardFlowRole; now: Instant; movementId: string; unitId: string }
  | {
      type: "DECLINE";
      role: WardFlowRole;
      now: Instant;
      movementId: string;
      unitId: string;
      reason: DeclineReason;
      note?: string;
    }
  | { type: "HANDOVER_READY"; role: WardFlowRole; now: Instant; movementId: string }
  | { type: "TRANSPORT_ACCEPTED"; role: WardFlowRole; now: Instant; movementId: string }
  | { type: "TRANSPORT_EN_ROUTE"; role: WardFlowRole; now: Instant; movementId: string }
  | { type: "PATIENT_COLLECTED"; role: WardFlowRole; now: Instant; movementId: string }
  | { type: "PATIENT_ARRIVED"; role: WardFlowRole; now: Instant; movementId: string }
  | { type: "CONFIRM_CAPACITY"; role: WardFlowRole; now: Instant; unitId: string; value: number }
  | {
      type: "RECORD_ESCALATION";
      role: WardFlowRole;
      now: Instant;
      movementId: string;
      triedUnitIds: string[];
      contact: string;
    }
  | { type: "ADVANCE_CLOCK"; role: WardFlowRole; now: Instant; minutes: number }
  | { type: "RESET_SCENARIO"; role: WardFlowRole; now: Instant };

/**
 * One table, read by the reducer's role check, rather than a `switch` repeated at every call
 * site. Adding an event here without an entry is a compile error, which is the point.
 */
export const EVENT_ROLE: Record<WardFlowEvent["type"], WardFlowRole> = {
  RAISE_REFERRAL: "ed",
  RECORD_EXAMINATION: "ed",
  REFER_TO_UNITS: "coordinator",
  ACCEPT_IN_PRINCIPLE: "ward",
  HOLD_BED: "ward",
  DECLINE: "ward",
  HANDOVER_READY: "ed",
  TRANSPORT_ACCEPTED: "officer",
  TRANSPORT_EN_ROUTE: "officer",
  PATIENT_COLLECTED: "officer",
  PATIENT_ARRIVED: "officer",
  CONFIRM_CAPACITY: "ward",
  RECORD_ESCALATION: "coordinator",
  ADVANCE_CLOCK: "demo",
  RESET_SCENARIO: "demo",
};
