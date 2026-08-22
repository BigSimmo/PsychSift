import { MOVEMENT_STAGES } from "@/components/ward-management/ward-model";
import type { BedRelease, Cohort, Movement, MovementStage, Security } from "@/components/ward-management/ward-model";
import { NOW_ANCHOR, allEmergencyDepartments, allUnits } from "@/components/ward-management/ward-sites";

/**
 * Hand-authored movements covering the states volume alone cannot guarantee: three declines
 * with nowhere eligible left, a status change mid-referral, a movement that never completed,
 * two legal-form breaches, every stage in the pathway at least once, and the older-adult and
 * specialling pressure that is normal — not exceptional — on a busy metro night.
 */
const seededMovements: Movement[] = [
  {
    id: "WF-001",
    originEdId: "arm-ed",
    openedAt: NOW_ANCHOR - 95,
    urgency: 1,
    cohort: "Adult",
    security: "Open",
    sex: "Female",
    specialling: false,
    legalStatus: "Referred for psychiatric examination",
    legalForm: { code: "1A", label: "Referral for examination", kind: "examination", dueAt: NOW_ANCHOR - 15 },
    statusChanges: [],
    stage: "placement_requested",
    owner: "ED mental health team",
    referredUnitIds: [],
    declines: [],
    blocker: "Confirming destination options",
    withdrawnReferrals: [],
  },
  {
    id: "WF-002",
    originEdId: "fsh-ed",
    openedAt: NOW_ANCHOR - 180,
    urgency: 2,
    cohort: "Older adult",
    security: "Open",
    sex: "Male",
    specialling: true,
    legalStatus: "Voluntary",
    statusChanges: [],
    stage: "destination_review",
    owner: "Flow coordinator",
    referredUnitIds: ["fsh-older-adult"],
    declines: [],
    blocker: "Awaiting older-adult bed confirmation",
    withdrawnReferrals: [],
    formedAt: NOW_ANCHOR - 180 - 90,
    arrivalMode: "ambulance",
  },
  {
    id: "WF-003",
    originEdId: "rph-ed",
    openedAt: NOW_ANCHOR - 260,
    urgency: 1,
    cohort: "Adult",
    security: "Secure",
    sex: "Female",
    specialling: false,
    legalStatus: "Involuntary inpatient",
    legalForm: {
      code: "3B",
      label: "Inpatient treatment order",
      kind: "detention",
    },
    statusChanges: [],
    stage: "accepted_awaiting_bed",
    owner: "Flow coordinator",
    referredUnitIds: [],
    acceptedUnitId: "rph-adult-secure",
    declines: [],
    blocker: "Bed being made ready",
    withdrawnReferrals: [],
    arrivalMode: "ambulance",
    examination: { at: NOW_ANCHOR - 60, outcome: "inpatient_order" },
  },
  {
    id: "WF-004",
    originEdId: "sjgm-ed",
    openedAt: NOW_ANCHOR - 410,
    urgency: 1,
    cohort: "Adult",
    security: "Secure",
    sex: "Male",
    specialling: false,
    legalStatus: "Involuntary inpatient",
    legalForm: {
      code: "4C",
      label: "Transfer between authorised hospitals",
      kind: "transfer",
      dueAt: NOW_ANCHOR + 300,
    },
    statusChanges: [],
    stage: "bed_held",
    owner: "Flow coordinator",
    referredUnitIds: [],
    acceptedUnitId: "bty-adult-secure",
    declines: [],
    blocker: "Escort provider organising secure transport",
    withdrawnReferrals: [],
    bedHeldUntil: NOW_ANCHOR - 10,
  },
  {
    id: "WF-005",
    originEdId: "peel-ed",
    openedAt: NOW_ANCHOR - 330,
    urgency: 2,
    cohort: "Adult",
    security: "Open",
    sex: "Female",
    specialling: false,
    legalStatus: "Detained awaiting examination",
    legalForm: { code: "1A", label: "Referral for examination", kind: "examination", dueAt: NOW_ANCHOR - 40 },
    statusChanges: [],
    stage: "handover_ready",
    owner: "ED mental health team",
    referredUnitIds: [],
    acceptedUnitId: "fre-adult-open",
    declines: [],
    transport: {
      id: "TR-1005",
      provider: "St John WA",
      escortRequired: true,
      formRequired: "Form 1A",
      acceptedAt: NOW_ANCHOR - 30,
    },
    blocker: "Transport escort confirming departure time",
    withdrawnReferrals: [],
    formedAt: NOW_ANCHOR - 330 - 150,
  },
  {
    id: "WF-006",
    originEdId: "rgh-ed",
    openedAt: NOW_ANCHOR - 500,
    urgency: 1,
    cohort: "Adult",
    security: "Secure",
    sex: "Male",
    specialling: false,
    legalStatus: "Involuntary inpatient",
    legalForm: {
      code: "4A",
      label: "Transport order",
      kind: "transport",
      dueAt: NOW_ANCHOR + 90,
    },
    statusChanges: [],
    stage: "moving",
    owner: "Flow coordinator",
    referredUnitIds: [],
    acceptedUnitId: "rgh-adult-secure",
    declines: [],
    transport: {
      id: "TR-1006",
      provider: "St John WA",
      escortRequired: true,
      acceptedAt: NOW_ANCHOR - 50,
      enRouteAt: NOW_ANCHOR - 15,
      // Collected 8 minutes after going en route (a short RGH-to-RGH-Adult-Secure hop), so at
      // NOW_ANCHOR the crew has been driving with the patient for 7 minutes — clearly still
      // mid-transfer, not close enough to arrival to also need `arrivedAt`.
      collectedAt: NOW_ANCHOR - 7,
    },
    blocker: "None — in transit",
    withdrawnReferrals: [
      {
        unitId: "fsh-adult-secure",
        at: NOW_ANCHOR - 470,
        reason: "Referral withdrawn once RGH Adult Secure confirmed the bed",
      },
    ],
  },
  {
    id: "WF-007",
    originEdId: "scgh-ed",
    openedAt: NOW_ANCHOR - 600,
    urgency: 2,
    cohort: "Older adult",
    security: "Open",
    sex: "Female",
    specialling: false,
    legalStatus: "Voluntary",
    statusChanges: [],
    stage: "arrived",
    owner: "Ward nurse in charge",
    referredUnitIds: [],
    acceptedUnitId: "scgh-older-adult",
    declines: [],
    blocker: "None — handover complete",
    closure: { at: NOW_ANCHOR - 5, outcome: "arrived", reason: "Handover complete at SCGH Older Adult" },
    withdrawnReferrals: [],
  },
  {
    id: "WF-008",
    originEdId: "jhc-ed",
    openedAt: NOW_ANCHOR - 150,
    urgency: 3,
    cohort: "Adult",
    security: "Open",
    sex: "Male",
    specialling: false,
    legalStatus: "Voluntary",
    statusChanges: [],
    // Ruling R64: carries acceptedUnitId but no bedHeldUntil and no transport. HOLD_BED is the
    // only reducer transition that writes bedHeldUntil, and HANDOVER_READY (the only producer of
    // "handover_ready") requires stage "bed_held" already — so a movement with an accepted unit
    // but neither of those later fields never reached bed_held, let alone handover_ready. The
    // furthest stage its own fields honestly support is "accepted_awaiting_bed".
    stage: "accepted_awaiting_bed",
    owner: "ED mental health team",
    referredUnitIds: [],
    acceptedUnitId: "fre-adult-open",
    declines: [],
    blocker: "Patient declined transfer",
    closure: {
      at: NOW_ANCHOR - 20,
      outcome: "did_not_proceed",
      reason: "Patient self-discharged from ED before transport arrived",
    },
    withdrawnReferrals: [],
  },
  {
    id: "WF-009",
    originEdId: "peel-ed",
    openedAt: NOW_ANCHOR - 420,
    urgency: 1,
    cohort: "Adult",
    security: "Secure",
    sex: "Male",
    specialling: true,
    legalStatus: "Involuntary inpatient",
    legalForm: {
      code: "3B",
      label: "Inpatient treatment order",
      kind: "detention",
    },
    statusChanges: [],
    stage: "destination_review",
    owner: "Flow coordinator",
    referredUnitIds: [],
    declines: [
      { unitId: "rph-adult-secure", at: NOW_ANCHOR - 90, reason: "no_bed", note: "Zero allocatable beds confirmed" },
      {
        unitId: "gry-adult-secure",
        at: NOW_ANCHOR - 60,
        reason: "acuity_mix",
        note: "Acuity mix unsuitable for the current ward composition",
      },
      {
        unitId: "bty-adult-secure",
        at: NOW_ANCHOR - 30,
        reason: "bed_held_for_earlier_referral",
        note: "Bed already held against an earlier referral",
      },
      {
        unitId: "fsh-adult-secure",
        at: NOW_ANCHOR - 15,
        reason: "specialling_unavailable",
        note: "No specialling capacity available at referral time",
      },
      {
        unitId: "rgh-adult-secure",
        at: NOW_ANCHOR - 5,
        reason: "capability_mismatch",
        note: "Ward composition unsuitable for this referral",
      },
    ],
    // Every authorised secure adult unit in the network has now either declined this
    // referral or fails an eligibility gate on its own (Broome has zero allocatable beds;
    // SJGS Adult Secure is not MHA-authorised) — the search really is exhausted, not just
    // capped at three parallel referrals.
    blocker: "No secure adult bed available across the network",
    withdrawnReferrals: [],
    arrivalMode: "police",
    examination: { at: NOW_ANCHOR - 100, outcome: "inpatient_order" },
    escalation: {
      at: NOW_ANCHOR - 3,
      triedUnitIds: [
        "rph-adult-secure",
        "gry-adult-secure",
        "bty-adult-secure",
        "fsh-adult-secure",
        "rgh-adult-secure",
      ],
      contact: "State bed coordination desk",
    },
  },
  {
    id: "WF-010",
    originEdId: "jhc-ed",
    openedAt: NOW_ANCHOR - 110,
    urgency: 2,
    cohort: "Adult",
    security: "Open",
    sex: "Female",
    specialling: false,
    legalStatus: "Detained awaiting examination",
    legalForm: { code: "1A", label: "Referral for examination", kind: "examination", dueAt: NOW_ANCHOR + 260 },
    statusChanges: [
      { at: NOW_ANCHOR - 40, from: "Voluntary", to: "Detained awaiting examination", by: "Duty psychiatrist" },
    ],
    stage: "destination_review",
    owner: "Flow coordinator",
    referredUnitIds: ["sjgm-adult-open"],
    declines: [],
    blocker: "Awaiting destination response",
    withdrawnReferrals: [],
  },
  {
    id: "WF-011",
    originEdId: "arm-ed",
    openedAt: NOW_ANCHOR - 360,
    urgency: 1,
    cohort: "Older adult",
    security: "Open",
    sex: "Male",
    specialling: true,
    legalStatus: "Involuntary inpatient",
    legalForm: {
      code: "4C",
      label: "Transfer between authorised hospitals",
      kind: "transfer",
      dueAt: NOW_ANCHOR + 340,
    },
    statusChanges: [],
    stage: "bed_held",
    owner: "Flow coordinator",
    referredUnitIds: [],
    acceptedUnitId: "fre-older-adult",
    declines: [],
    blocker: "Awaiting single-room clean",
    withdrawnReferrals: [],
    bedHeldUntil: NOW_ANCHOR + 20,
  },
  {
    id: "WF-012",
    originEdId: "rgh-ed",
    openedAt: NOW_ANCHOR - 70,
    urgency: 2,
    cohort: "Adult",
    security: "Secure",
    sex: "Female",
    specialling: true,
    legalStatus: "Referred for psychiatric examination",
    legalForm: { code: "1A", label: "Referral for examination", kind: "examination", dueAt: NOW_ANCHOR + 200 },
    statusChanges: [],
    stage: "placement_requested",
    owner: "ED mental health team",
    referredUnitIds: ["gry-adult-secure"],
    declines: [],
    blocker: "Awaiting specialling roster confirmation",
    withdrawnReferrals: [],
  },
  {
    id: "WF-013",
    originEdId: "sjgm-ed",
    openedAt: NOW_ANCHOR - 200,
    urgency: 3,
    cohort: "Older adult",
    security: "Open",
    sex: "Male",
    specialling: false,
    legalStatus: "Voluntary",
    statusChanges: [],
    stage: "destination_review",
    owner: "Flow coordinator",
    referredUnitIds: ["bty-older-adult", "gry-older-adult"],
    declines: [],
    blocker: "Comparing two older-adult options",
    withdrawnReferrals: [],
    formedAt: NOW_ANCHOR - 200 - 120,
  },
  {
    id: "WF-014",
    originEdId: "fsh-ed",
    openedAt: NOW_ANCHOR - 480,
    urgency: 1,
    cohort: "Adult",
    security: "Secure",
    sex: "Female",
    specialling: true,
    legalStatus: "Involuntary inpatient",
    legalForm: {
      code: "4A",
      label: "Transport order",
      kind: "transport",
      dueAt: NOW_ANCHOR + 60,
    },
    statusChanges: [],
    stage: "moving",
    owner: "Flow coordinator",
    referredUnitIds: [],
    acceptedUnitId: "rph-adult-secure",
    declines: [],
    transport: {
      id: "TR-1014",
      provider: "St John WA",
      escortRequired: true,
      formRequired: "Form 1A",
      acceptedAt: NOW_ANCHOR - 45,
      enRouteAt: NOW_ANCHOR - 10,
      // A short secure-escort hop (FSH to RPH Adult Secure): collected 6 minutes after going en
      // route, so only 4 minutes into the drive to the destination at NOW_ANCHOR.
      collectedAt: NOW_ANCHOR - 4,
    },
    blocker: "None — in transit",
    withdrawnReferrals: [],
  },
  {
    id: "WF-015",
    originEdId: "rgh-ed",
    openedAt: NOW_ANCHOR - 340,
    urgency: 2,
    cohort: "Older adult",
    security: "Open",
    sex: "Male",
    specialling: true,
    legalStatus: "Voluntary",
    statusChanges: [],
    stage: "handover_ready",
    owner: "Ward nurse in charge",
    referredUnitIds: [],
    acceptedUnitId: "scgh-older-adult",
    declines: [],
    transport: { id: "TR-1015", provider: "St John WA", escortRequired: false, acceptedAt: NOW_ANCHOR - 15 },
    blocker: "Awaiting transport escort",
    withdrawnReferrals: [],
  },
  {
    id: "WF-016",
    originEdId: "peel-ed",
    openedAt: NOW_ANCHOR - 250,
    urgency: 3,
    cohort: "Adult",
    security: "Open",
    sex: "Female",
    specialling: false,
    legalStatus: "Referred for psychiatric examination",
    legalForm: { code: "1A", label: "Referral for examination", kind: "examination", dueAt: NOW_ANCHOR + 220 },
    statusChanges: [],
    stage: "bed_held",
    owner: "Flow coordinator",
    referredUnitIds: [],
    acceptedUnitId: "sjgm-adult-open",
    declines: [],
    blocker: "Ward finalising bed clean",
    withdrawnReferrals: [],
    bedHeldUntil: NOW_ANCHOR + 45,
  },
  {
    id: "WF-017",
    originEdId: "jhc-ed",
    openedAt: NOW_ANCHOR - 400,
    urgency: 1,
    cohort: "Adult",
    security: "Secure",
    sex: "Male",
    specialling: true,
    legalStatus: "Involuntary inpatient",
    legalForm: {
      code: "3B",
      label: "Inpatient treatment order",
      kind: "detention",
    },
    statusChanges: [],
    stage: "destination_review",
    owner: "ED mental health team",
    referredUnitIds: ["bty-adult-secure"],
    declines: [
      {
        unitId: "gry-adult-secure",
        at: NOW_ANCHOR - 70,
        reason: "specialling_unavailable",
        note: "No specialling capacity available",
      },
    ],
    blocker: "Escalated to duty psychiatrist — breach imminent",
    withdrawnReferrals: [],
    examination: { at: NOW_ANCHOR - 260, outcome: "inpatient_order" },
  },
  {
    id: "WF-018",
    originEdId: "scgh-ed",
    openedAt: NOW_ANCHOR - 40,
    urgency: 3,
    cohort: "Older adult",
    security: "Open",
    sex: "Female",
    specialling: false,
    legalStatus: "Voluntary",
    statusChanges: [],
    stage: "placement_requested",
    owner: "ED mental health team",
    referredUnitIds: [],
    declines: [],
    blocker: "Awaiting family collateral before destination decision",
    withdrawnReferrals: [
      {
        unitId: "scgh-older-adult",
        at: NOW_ANCHOR - 10,
        reason: "Referral withdrawn — the unit filled the bed from an earlier request",
      },
    ],
  },
];

/**
 * A deterministic destination for a generated movement. Prefers an exact cohort+security
 * match (the normal case); falls back to a cohort-only match, then to any unit, so the
 * synthetic model — which has no secure older-adult unit anywhere in the network — never
 * throws for a combination it cannot satisfy exactly. `index` is the only varying input, so
 * the pick is stable across runs.
 */
function fallbackUnitId(cohort: Cohort, security: Security, index: number): string {
  const units = allUnits();
  const exact = units.filter((unit) => unit.cohort === cohort && unit.security === security);
  const sameCohort = units.filter((unit) => unit.cohort === cohort);
  const pool = exact.length > 0 ? exact : sameCohort.length > 0 ? sameCohort : units;
  return pool[index % pool.length].id;
}

/**
 * Stage-dependent fields a generated movement needs to not contradict its own `stage` — the
 * same fields the hand-authored `seededMovements` above always carry together. Kept as a
 * switch, rather than folded into the field literals below, so each stage's requirement
 * reads as one block instead of being scattered across independent index checks.
 */
function stageFields(
  stage: MovementStage,
  cohort: Cohort,
  security: Security,
  index: number,
): Pick<Movement, "acceptedUnitId" | "transport" | "closure" | "bedHeldUntil"> {
  switch (stage) {
    case "accepted_awaiting_bed":
      return { acceptedUnitId: fallbackUnitId(cohort, security, index) };
    case "bed_held":
      // Bounds match the hand-authored records: NOW_ANCHOR - 20 to NOW_ANCHOR + 45, so a
      // hold cannot be recorded without a time for it to expire at.
      return {
        acceptedUnitId: fallbackUnitId(cohort, security, index),
        bedHeldUntil: NOW_ANCHOR - 20 + (index % 66),
      };
    case "moving": {
      const acceptedAt = NOW_ANCHOR - (40 + (index % 15));
      const enRouteAt = acceptedAt + (10 + (index % 10));
      // Stage "moving" means the crew already collected the patient — PATIENT_COLLECTED is the
      // only reducer transition that produces it, and it always sets `transport.collectedAt` in
      // the same update (ward-flow-reducer.ts). A generated "moving" record with no
      // `collectedAt` would be a state the reducer itself could never produce. The pickup-drive
      // offset varies by index (8-25 minutes) so generated in-transit journeys read as being at
      // different points, never one shared constant; the `Math.min` keeps `collectedAt` at or
      // before `NOW_ANCHOR` even for an index/gap combination narrower than the largest offset.
      const collectedAt = enRouteAt + Math.min(NOW_ANCHOR - enRouteAt, 8 + (index % 18));
      return {
        acceptedUnitId: fallbackUnitId(cohort, security, index),
        transport: {
          id: `TR-${1300 + index}`,
          provider: "St John WA",
          escortRequired: index % 2 === 0,
          acceptedAt,
          enRouteAt,
          collectedAt,
        },
      };
    }
    case "arrived": {
      const acceptedUnitId = fallbackUnitId(cohort, security, index);
      const unitName = allUnits().find((unit) => unit.id === acceptedUnitId)?.name ?? acceptedUnitId;
      return {
        acceptedUnitId,
        closure: {
          at: NOW_ANCHOR - (index % 10),
          outcome: "arrived",
          reason: `Handover complete at ${unitName}`,
        },
      };
    }
    default:
      return {};
  }
}

/**
 * Routine movements filling out a busy metro night. Deterministic — index drives every
 * varying field — so screenshots and tests never shift between runs.
 */
function routineMovements(count: number, startIndex: number): Movement[] {
  const eds = allEmergencyDepartments();
  return Array.from({ length: count }, (_, offset) => {
    const index = startIndex + offset;
    const ed = eds[index % eds.length];
    const cohort: Cohort = index % 4 === 0 ? "Older adult" : "Adult";
    const security: Security = index % 7 === 0 ? "Secure" : "Open";
    const sex = index % 2 === 0 ? "Female" : "Male";
    const urgency = ((index % 3) + 1) as 1 | 2 | 3;
    const rawStage = MOVEMENT_STAGES[index % MOVEMENT_STAGES.length];
    // `stageFields` below has no case for "handover_ready" — and rightly so: giving it one would
    // mean fabricating the acceptedUnitId/bedHeldUntil/transport a real handover_ready movement
    // can only get by actually passing through accepted_awaiting_bed and bed_held first
    // (ward-flow-reducer.ts's ACCEPT_IN_PRINCIPLE, HOLD_BED and HANDOVER_READY cases). Every
    // generated movement's `referredUnitIds` is unconditionally `[]` below, so a generated
    // "handover_ready" record — which the switch's `default` branch leaves with none of those
    // fields — is a state the reducer could never produce, exactly the ruling-R64 defect that
    // let WF-305/312/319/326 render as ready-for-handover-with-no-transport. The honest stage
    // for a record with an empty referredUnitIds and no acceptedUnitId is "placement_requested"
    // (ruling R64), so that index is remapped here rather than stageFields inventing fields —
    // this closes the defect for every index this generator can ever produce, not only today's.
    const stage = rawStage === "handover_ready" ? "placement_requested" : rawStage;
    return {
      id: `WF-${String(index).padStart(3, "0")}`,
      originEdId: ed.id,
      openedAt: NOW_ANCHOR - (60 + ((index * 37) % 900)),
      urgency,
      cohort,
      security,
      sex,
      specialling: index % 11 === 0,
      legalStatus: index % 3 === 0 ? "Referred for psychiatric examination" : "Voluntary",
      legalForm:
        index % 3 === 0
          ? {
              code: "1A",
              label: "Referral for examination",
              kind: "examination" as const,
              dueAt: NOW_ANCHOR + (((index * 53) % 400) - 60),
            }
          : undefined,
      statusChanges: [],
      stage,
      owner: index % 2 === 0 ? "Flow coordinator" : "ED mental health team",
      referredUnitIds: [],
      declines: [],
      blocker: index % 5 === 0 ? "Awaiting destination response" : "No blocker",
      withdrawnReferrals: [],
      ...stageFields(stage, cohort, security, index),
    } satisfies Movement;
  });
}

export const wardMovements: Movement[] = [...seededMovements, ...routineMovements(30, 300)];

/** Returns `undefined` for an unknown id. Never falls back to a different movement. */
export function movementById(id: string): Movement | undefined {
  return wardMovements.find((movement) => movement.id === id);
}

export function movementsByStage(stage: MovementStage): Movement[] {
  return wardMovements.filter((movement) => movement.stage === stage);
}

/**
 * Beds expected to free up, each attributed to a named confirmer and nothing about the
 * departing patient — the whole point of this list is capacity, not identity.
 */
export const bedReleases: BedRelease[] = [
  {
    id: "WR-001",
    unitId: "rph-adult-secure",
    expectedAt: NOW_ANCHOR + 45,
    confidence: "confirmed",
    blocker: "Bed clean pending",
    confirmedAt: NOW_ANCHOR - 10,
    confirmedBy: "NUM RPH Adult Secure",
  },
  {
    id: "WR-002",
    unitId: "scgh-adult-open",
    expectedAt: NOW_ANCHOR + 90,
    confidence: "likely",
    blocker: "Awaiting bed-management confirmation",
    confirmedAt: NOW_ANCHOR - 25,
    confirmedBy: "NUM SCGH Adult Open",
  },
  {
    id: "WR-003",
    unitId: "fsh-older-adult",
    expectedAt: NOW_ANCHOR + 180,
    confidence: "possible",
    blocker: "Awaiting external placement confirmation",
    confirmedAt: NOW_ANCHOR - 60,
    confirmedBy: "NUM FSH Older Adult",
  },
  {
    id: "WR-004",
    unitId: "fre-adult-open",
    expectedAt: NOW_ANCHOR + 30,
    confidence: "confirmed",
    blocker: "Awaiting pharmacy",
    confirmedAt: NOW_ANCHOR - 5,
    confirmedBy: "NUM FRE Adult Open",
  },
  {
    id: "WR-005",
    unitId: "bty-adult-secure",
    expectedAt: NOW_ANCHOR + 120,
    confidence: "likely",
    blocker: "Pending case review outcome",
    confirmedAt: NOW_ANCHOR - 35,
    confirmedBy: "NUM BTY Adult Secure",
  },
  {
    id: "WR-006",
    unitId: "gry-older-adult",
    expectedAt: NOW_ANCHOR + 240,
    confidence: "possible",
    blocker: "Awaiting external service coordination",
    confirmedAt: NOW_ANCHOR - 80,
    confirmedBy: "NUM Graylands Older Adult",
  },
];
