import type { Instant } from "@/components/ward-management/ward-clock";

export type HealthService = "North Metro" | "South Metro" | "East Metro" | "WACHS" | "Private";
export type Cohort = "Adult" | "Older adult";
export type Security = "Open" | "Secure";
export type Sex = "Female" | "Male";

export const MOVEMENT_STAGES = [
  "placement_requested",
  "destination_review",
  "accepted_awaiting_bed",
  "bed_held",
  "handover_ready",
  "moving",
  "arrived",
] as const;
export type MovementStage = (typeof MOVEMENT_STAGES)[number];

export const DECLINE_REASONS = [
  "no_bed",
  "sex_mix",
  "specialling_unavailable",
  "acuity_mix",
  "capability_mismatch",
  "bed_held_for_earlier_referral",
  "out_of_catchment",
] as const;
export type DeclineReason = (typeof DECLINE_REASONS)[number];

/** Referring to more than three units at once spams wards and erodes trust between services. */
export const PARALLEL_REFERRAL_CAP = 3;

/**
 * A Form 1A referral must carry an explicit expiry. In this synthetic model a
 * newly raised referral uses the Mental Health Act's seven-day outer limit;
 * production form capture must always use the expiry recorded on the actual
 * approved form rather than treating this demo default as clinical advice.
 */
export const FORM_1A_REFERRAL_EXPIRY_MINUTES = 7 * 24 * 60;

export type LegalStatus =
  "Voluntary" | "Referred for psychiatric examination" | "Detained awaiting examination" | "Involuntary inpatient";

/**
 * The legal clock and the ED clock are different clocks (spec "Model changes this phase
 * requires", `Movement.formedAt`). `dueAt` is the legal clock — the Mental Health Act deadline
 * this specific form carries, when it has one. A Form 1A ("referral for examination") always
 * carries a real statutory examination window, so it always carries a `dueAt`. A Form 3B
 * ("inpatient treatment order") has no equivalent post-examination deadline in the Act — put to
 * the clinician directly, his answer was that the post-examination clock "is just counting how
 * long they have been in ED determining priority. So counting up," i.e. it is not a legal
 * countdown at all (Task 6A). So `dueAt` is optional, and a 3B is authored — and produced by the
 * reducer — without one. Never substitute a fallback number for an absent `dueAt`, and never let
 * an absent `dueAt` read as "clear" or "not yet due"; render its absence explicitly.
 */
export type LegalForm = {
  code: string;
  label: string;
  kind: "examination" | "detention" | "transport" | "transfer";
  dueAt?: Instant;
};

/**
 * The emergency department's access target, in minutes. This is a real, named figure from spec
 * §7 — but it is a **departmental performance measure**, counted UP from `Movement.openedAt`
 * (how long the patient has been in the department), because that is the number a department is
 * judged on and mental health patients are its largest breachers. It is **not** a Mental Health
 * Act deadline: it must never be attached to a `LegalForm`, never gain a `dueAt`, and never feed
 * a legal-breach count or an eligibility gate. Task 6A only introduces and pins this constant
 * (see `tests/ward-model.test.ts`); Task 11's emergency department screen is what actually
 * renders it against `openedAt`.
 *
 * The spec originally named this figure four hours (240 minutes). The product owner — the
 * spec's own author — superseded that figure for this prototype on 2026-08-22, in response to a
 * direct clinical question, and set it to 24 hours (1440 minutes) instead. Nothing about *how*
 * this figure is counted, rendered or safeguarded changed: it is still counted up from
 * `openedAt`, never a deadline, and still barred from every `LegalForm`/`dueAt`/breach/
 * eligibility surface listed above.
 */
export const ED_ACCESS_TARGET_MINUTES = 1440;

/**
 * A capacity number is meaningless without where it came from and when.
 * `feed` knows which beds are physically empty; `ward` knows which are actually allocatable
 * once staffing, sex mix, acuity mix, single rooms and holds are accounted for.
 */
export type CapacitySource = "feed" | "ward";

export type CapacityFigure = {
  value: number;
  source: CapacitySource;
  confirmedAt: Instant;
  staleAfterMinutes: number;
};

export type EmergencyDepartment = {
  id: string;
  siteCode: string;
  name: string;
};

export type Unit = {
  id: string;
  siteCode: string;
  name: string;
  cohort: Cohort;
  security: Security;
  /** Authorised under the Mental Health Act 2014 to receive involuntary admissions. */
  authorised: boolean;
  beds: number;
  /** Physically empty beds, per the feed. */
  empty: CapacityFigure;
  /** Beds the ward says it can actually allocate. Never greater than `empty` in practice. */
  allocatable: CapacityFigure;
  held: number;
  blocked: number;
  /** Current occupants by sex, which is what constrains who the next admission can be. */
  sexMix: Record<Sex, number>;
  /** How many 1:1 observation patients this unit can staff beyond its current load. */
  speciallingCapacity: number;
};

export type Site = {
  code: string;
  name: string;
  service: HealthService;
  emergencyDepartment?: EmergencyDepartment;
  units: Unit[];
};

export type Decline = {
  unitId: string;
  at: Instant;
  reason: DeclineReason;
  note?: string;
};

export type StatusChange = {
  at: Instant;
  from: LegalStatus;
  to: LegalStatus;
  by: string;
};

export type TransportJob = {
  id: string;
  provider: string;
  escortRequired: boolean;
  formRequired?: string;
  acceptedAt?: Instant;
  enRouteAt?: Instant;
  collectedAt?: Instant;
  arrivedAt?: Instant;
  cancelledAt?: Instant;
};

export type MovementClosure = {
  at: Instant;
  outcome: "arrived" | "did_not_proceed";
  reason: string;
};

export type Movement = {
  id: string;
  /** Where the patient physically is. Detention here is lawful even when unauthorised. */
  originEdId: string;
  openedAt: Instant;
  urgency: 1 | 2 | 3;
  cohort: Cohort;
  security: Security;
  sex: Sex;
  specialling: boolean;
  legalStatus: LegalStatus;
  legalForm?: LegalForm;
  statusChanges: StatusChange[];
  stage: MovementStage;
  owner: string;
  /** Units currently holding a live referral. Never longer than PARALLEL_REFERRAL_CAP. */
  referredUnitIds: string[];
  acceptedUnitId?: string;
  declines: Decline[];
  transport?: TransportJob;
  blocker: string;
  closure?: MovementClosure;
  /** When the referral for examination was made. May precede `openedAt` for a community-formed
   *  patient — the legal clock and the department clock are different clocks. */
  formedAt?: Instant;
  /** How the patient reached the department. Police attendance is a real and invisible pressure. */
  arrivalMode?: "self" | "ambulance" | "police";
  /** When a held bed lapses. A hold cannot expire without a time to expire at. */
  bedHeldUntil?: Instant;
  /** The psychiatric examination a Form 1A refers the person for. Until it happens you often do
   *  not know whether an authorised bed is needed at all. */
  examination?: { at: Instant; outcome: "inpatient_order" | "community_order" | "revoked" };
  /** Referrals ended because another unit accepted. A shrinking `referredUnitIds` tells nobody. */
  withdrawnReferrals: { unitId: string; at: Instant; reason: string }[];
  /** Recorded when the network is exhausted. */
  escalation?: { at: Instant; triedUnitIds: string[]; contact: string };
};

/** A transition the reducer refused, surfaced on the coordinator screen rather than swallowed. */
export type Rejection = {
  id: string;
  at: Instant;
  movementId: string;
  attempted: string;
  reason: string;
};

export type BedRelease = {
  id: string;
  unitId: string;
  expectedAt: Instant;
  confidence: "confirmed" | "likely" | "possible";
  blocker: string;
  confirmedAt: Instant;
  confirmedBy: string;
};
