import type { EmergencyDepartment, Site, Unit } from "@/components/ward-management/ward-model";

/**
 * The synthetic "now" every `confirmedAt` value below is authored against. Task 5's movements
 * are expected to use the same anchor so referral timers and capacity freshness line up.
 */
export const NOW_ANCHOR = 10 * 60 + 42;

/**
 * The hospital network. Sites carry an emergency department, inpatient units, or both — that
 * asymmetry is real: Fremantle and Bentley run mental health units with no ED of their own;
 * Peel and Joondalup run EDs that feed patients elsewhere in the network.
 */
export const wardSites: Site[] = [
  {
    code: "RPH",
    name: "Royal Perth Hospital",
    service: "East Metro",
    emergencyDepartment: { id: "rph-ed", siteCode: "RPH", name: "Royal Perth Hospital Emergency Department" },
    units: [
      {
        id: "rph-adult-secure",
        siteCode: "RPH",
        name: "RPH Adult Secure",
        cohort: "Adult",
        security: "Secure",
        authorised: true,
        beds: 20,
        empty: { value: 2, source: "feed", confirmedAt: NOW_ANCHOR - 4, staleAfterMinutes: 15 },
        allocatable: { value: 1, source: "ward", confirmedAt: NOW_ANCHOR - 20, staleAfterMinutes: 90 },
        held: 1,
        blocked: 0,
        sexMix: { Female: 9, Male: 9 },
        speciallingCapacity: 2,
      },
      {
        id: "rph-older-adult",
        siteCode: "RPH",
        name: "RPH Older Adult",
        cohort: "Older adult",
        security: "Open",
        authorised: true,
        beds: 14,
        empty: { value: 1, source: "feed", confirmedAt: NOW_ANCHOR - 6, staleAfterMinutes: 15 },
        allocatable: { value: 1, source: "ward", confirmedAt: NOW_ANCHOR - 25, staleAfterMinutes: 90 },
        held: 2,
        blocked: 1,
        sexMix: { Female: 6, Male: 6 },
        speciallingCapacity: 1,
      },
    ],
  },
  {
    code: "SCGH",
    name: "Sir Charles Gairdner Hospital",
    service: "North Metro",
    emergencyDepartment: {
      id: "scgh-ed",
      siteCode: "SCGH",
      name: "Sir Charles Gairdner Hospital Emergency Department",
    },
    units: [
      {
        // Feed says five beds empty; the ward has only cleared two for allocation — a live
        // feed-versus-ward disagreement.
        id: "scgh-adult-open",
        siteCode: "SCGH",
        name: "SCGH Adult Open",
        cohort: "Adult",
        security: "Open",
        authorised: true,
        beds: 24,
        empty: { value: 5, source: "feed", confirmedAt: NOW_ANCHOR - 2, staleAfterMinutes: 15 },
        allocatable: { value: 2, source: "ward", confirmedAt: NOW_ANCHOR - 15, staleAfterMinutes: 60 },
        held: 3,
        blocked: 0,
        sexMix: { Female: 10, Male: 9 },
        speciallingCapacity: 3,
      },
      {
        id: "scgh-older-adult",
        siteCode: "SCGH",
        name: "SCGH Older Adult",
        cohort: "Older adult",
        security: "Open",
        authorised: true,
        beds: 16,
        empty: { value: 1, source: "feed", confirmedAt: NOW_ANCHOR - 5, staleAfterMinutes: 15 },
        allocatable: { value: 1, source: "ward", confirmedAt: NOW_ANCHOR - 18, staleAfterMinutes: 90 },
        held: 1,
        blocked: 0,
        sexMix: { Female: 8, Male: 7 },
        speciallingCapacity: 1,
      },
    ],
  },
  {
    code: "FSH",
    name: "Fiona Stanley Hospital",
    service: "South Metro",
    emergencyDepartment: { id: "fsh-ed", siteCode: "FSH", name: "Fiona Stanley Hospital Emergency Department" },
    units: [
      {
        id: "fsh-adult-secure",
        siteCode: "FSH",
        name: "FSH Adult Secure",
        cohort: "Adult",
        security: "Secure",
        authorised: true,
        beds: 18,
        empty: { value: 3, source: "feed", confirmedAt: NOW_ANCHOR - 3, staleAfterMinutes: 15 },
        allocatable: { value: 3, source: "ward", confirmedAt: NOW_ANCHOR - 10, staleAfterMinutes: 60 },
        held: 2,
        blocked: 1,
        sexMix: { Female: 7, Male: 7 },
        speciallingCapacity: 2,
      },
      {
        // Second unit sitting at zero allocatable — older-adult scarcity is the norm, not
        // the exception.
        id: "fsh-older-adult",
        siteCode: "FSH",
        name: "FSH Older Adult",
        cohort: "Older adult",
        security: "Open",
        authorised: true,
        beds: 12,
        empty: { value: 1, source: "feed", confirmedAt: NOW_ANCHOR - 7, staleAfterMinutes: 15 },
        allocatable: { value: 0, source: "ward", confirmedAt: NOW_ANCHOR - 30, staleAfterMinutes: 120 },
        held: 1,
        blocked: 0,
        sexMix: { Female: 6, Male: 5 },
        speciallingCapacity: 1,
      },
    ],
  },
  {
    code: "ARM",
    name: "Armadale Health Service",
    service: "East Metro",
    emergencyDepartment: { id: "arm-ed", siteCode: "ARM", name: "Armadale Hospital Emergency Department" },
    units: [
      {
        id: "arm-adult-open",
        siteCode: "ARM",
        name: "ARM Adult Open",
        cohort: "Adult",
        security: "Open",
        authorised: true,
        beds: 19,
        empty: { value: 3, source: "feed", confirmedAt: NOW_ANCHOR - 3, staleAfterMinutes: 15 },
        allocatable: { value: 2, source: "ward", confirmedAt: NOW_ANCHOR - 16, staleAfterMinutes: 60 },
        held: 1,
        blocked: 0,
        sexMix: { Female: 8, Male: 8 },
        speciallingCapacity: 2,
      },
    ],
  },
  {
    code: "SJGM",
    name: "St John of God Midland Public Hospital",
    service: "East Metro",
    emergencyDepartment: {
      id: "sjgm-ed",
      siteCode: "SJGM",
      name: "St John of God Midland Emergency Department",
    },
    units: [
      {
        id: "sjgm-adult-open",
        siteCode: "SJGM",
        name: "SJGM Adult Open",
        cohort: "Adult",
        security: "Open",
        authorised: true,
        beds: 16,
        empty: { value: 2, source: "feed", confirmedAt: NOW_ANCHOR - 4, staleAfterMinutes: 15 },
        allocatable: { value: 1, source: "ward", confirmedAt: NOW_ANCHOR - 18, staleAfterMinutes: 90 },
        held: 1,
        blocked: 0,
        sexMix: { Female: 7, Male: 7 },
        speciallingCapacity: 1,
      },
    ],
  },
  {
    code: "RGH",
    name: "Rockingham General Hospital",
    service: "South Metro",
    emergencyDepartment: {
      id: "rgh-ed",
      siteCode: "RGH",
      name: "Rockingham General Hospital Emergency Department",
    },
    units: [
      {
        id: "rgh-adult-secure",
        siteCode: "RGH",
        name: "RGH Adult Secure",
        cohort: "Adult",
        security: "Secure",
        authorised: true,
        beds: 14,
        empty: { value: 1, source: "feed", confirmedAt: NOW_ANCHOR - 5, staleAfterMinutes: 15 },
        allocatable: { value: 1, source: "ward", confirmedAt: NOW_ANCHOR - 17, staleAfterMinutes: 90 },
        held: 1,
        blocked: 0,
        sexMix: { Female: 7, Male: 6 },
        speciallingCapacity: 1,
      },
    ],
  },
  {
    code: "JHC",
    name: "Joondalup Health Campus",
    service: "North Metro",
    emergencyDepartment: {
      id: "jhc-ed",
      siteCode: "JHC",
      name: "Joondalup Health Campus Emergency Department",
    },
    units: [],
  },
  {
    code: "PEEL",
    name: "Peel Health Campus",
    service: "South Metro",
    emergencyDepartment: { id: "peel-ed", siteCode: "PEEL", name: "Peel Health Campus Emergency Department" },
    units: [],
  },
  {
    code: "FRE",
    name: "Fremantle Hospital",
    service: "South Metro",
    units: [
      {
        id: "fre-adult-open",
        siteCode: "FRE",
        name: "FRE Adult Open",
        cohort: "Adult",
        security: "Open",
        authorised: true,
        beds: 22,
        empty: { value: 4, source: "feed", confirmedAt: NOW_ANCHOR - 3, staleAfterMinutes: 15 },
        allocatable: { value: 3, source: "ward", confirmedAt: NOW_ANCHOR - 12, staleAfterMinutes: 60 },
        held: 2,
        blocked: 0,
        sexMix: { Female: 9, Male: 9 },
        speciallingCapacity: 2,
      },
      {
        id: "fre-older-adult",
        siteCode: "FRE",
        name: "FRE Older Adult",
        cohort: "Older adult",
        security: "Open",
        authorised: true,
        beds: 13,
        empty: { value: 2, source: "feed", confirmedAt: NOW_ANCHOR - 6, staleAfterMinutes: 15 },
        allocatable: { value: 1, source: "ward", confirmedAt: NOW_ANCHOR - 22, staleAfterMinutes: 90 },
        held: 1,
        blocked: 0,
        sexMix: { Female: 6, Male: 5 },
        speciallingCapacity: 1,
      },
    ],
  },
  {
    code: "BTY",
    name: "Bentley Health Service",
    service: "East Metro",
    units: [
      {
        id: "bty-adult-secure",
        siteCode: "BTY",
        name: "BTY Adult Secure",
        cohort: "Adult",
        security: "Secure",
        authorised: true,
        beds: 17,
        empty: { value: 2, source: "feed", confirmedAt: NOW_ANCHOR - 4, staleAfterMinutes: 15 },
        allocatable: { value: 2, source: "ward", confirmedAt: NOW_ANCHOR - 14, staleAfterMinutes: 60 },
        held: 1,
        blocked: 1,
        sexMix: { Female: 7, Male: 7 },
        speciallingCapacity: 2,
      },
      {
        id: "bty-older-adult",
        siteCode: "BTY",
        name: "BTY Older Adult",
        cohort: "Older adult",
        security: "Open",
        authorised: true,
        beds: 11,
        empty: { value: 1, source: "feed", confirmedAt: NOW_ANCHOR - 5, staleAfterMinutes: 15 },
        allocatable: { value: 1, source: "ward", confirmedAt: NOW_ANCHOR - 19, staleAfterMinutes: 90 },
        held: 1,
        blocked: 0,
        sexMix: { Female: 5, Male: 5 },
        speciallingCapacity: 1,
      },
    ],
  },
  {
    code: "GRY",
    name: "Graylands Hospital",
    service: "North Metro",
    units: [
      {
        id: "gry-adult-secure",
        siteCode: "GRY",
        name: "Graylands Adult Secure",
        cohort: "Adult",
        security: "Secure",
        authorised: true,
        beds: 15,
        empty: { value: 2, source: "feed", confirmedAt: NOW_ANCHOR - 4, staleAfterMinutes: 15 },
        allocatable: { value: 1, source: "ward", confirmedAt: NOW_ANCHOR - 20, staleAfterMinutes: 90 },
        held: 1,
        blocked: 0,
        sexMix: { Female: 7, Male: 6 },
        speciallingCapacity: 1,
      },
      {
        // Zero allocatable AND its ward confirmation is well past staleAfterMinutes — the
        // freshness gate should catch this one.
        id: "gry-older-adult",
        siteCode: "GRY",
        name: "Graylands Older Adult",
        cohort: "Older adult",
        security: "Open",
        authorised: true,
        beds: 10,
        empty: { value: 0, source: "feed", confirmedAt: NOW_ANCHOR - 5, staleAfterMinutes: 15 },
        allocatable: { value: 0, source: "ward", confirmedAt: NOW_ANCHOR - 300, staleAfterMinutes: 180 },
        held: 0,
        blocked: 1,
        sexMix: { Female: 5, Male: 4 },
        speciallingCapacity: 0,
      },
    ],
  },
  {
    code: "ALB",
    name: "Albany Health Campus",
    service: "WACHS",
    units: [
      {
        id: "alb-adult-open",
        siteCode: "ALB",
        name: "Albany Adult Open",
        cohort: "Adult",
        security: "Open",
        authorised: true,
        beds: 8,
        empty: { value: 1, source: "feed", confirmedAt: NOW_ANCHOR - 9, staleAfterMinutes: 20 },
        allocatable: { value: 1, source: "ward", confirmedAt: NOW_ANCHOR - 35, staleAfterMinutes: 120 },
        held: 0,
        blocked: 0,
        sexMix: { Female: 4, Male: 3 },
        speciallingCapacity: 0,
      },
    ],
  },
  {
    code: "BUN",
    name: "Bunbury Hospital",
    service: "WACHS",
    units: [
      {
        id: "bun-adult-open",
        siteCode: "BUN",
        name: "Bunbury Adult Open",
        cohort: "Adult",
        security: "Open",
        authorised: true,
        beds: 9,
        empty: { value: 2, source: "feed", confirmedAt: NOW_ANCHOR - 8, staleAfterMinutes: 20 },
        allocatable: { value: 1, source: "ward", confirmedAt: NOW_ANCHOR - 40, staleAfterMinutes: 120 },
        held: 1,
        blocked: 0,
        sexMix: { Female: 4, Male: 3 },
        speciallingCapacity: 1,
      },
    ],
  },
  {
    code: "BRM",
    name: "Broome Hospital",
    service: "WACHS",
    units: [
      {
        id: "brm-adult-secure",
        siteCode: "BRM",
        name: "Broome Adult Secure",
        cohort: "Adult",
        security: "Secure",
        authorised: true,
        beds: 6,
        empty: { value: 1, source: "feed", confirmedAt: NOW_ANCHOR - 10, staleAfterMinutes: 20 },
        allocatable: { value: 0, source: "ward", confirmedAt: NOW_ANCHOR - 45, staleAfterMinutes: 150 },
        held: 0,
        blocked: 0,
        sexMix: { Female: 3, Male: 2 },
        speciallingCapacity: 0,
      },
    ],
  },
  {
    code: "GER",
    name: "Geraldton Hospital",
    service: "WACHS",
    units: [
      {
        id: "ger-adult-open",
        siteCode: "GER",
        name: "Geraldton Adult Open",
        cohort: "Adult",
        security: "Open",
        authorised: true,
        beds: 7,
        empty: { value: 1, source: "feed", confirmedAt: NOW_ANCHOR - 9, staleAfterMinutes: 20 },
        allocatable: { value: 1, source: "ward", confirmedAt: NOW_ANCHOR - 38, staleAfterMinutes: 120 },
        held: 0,
        blocked: 0,
        sexMix: { Female: 3, Male: 3 },
        speciallingCapacity: 0,
      },
    ],
  },
  {
    code: "KUN",
    name: "Kununurra District Hospital",
    service: "WACHS",
    units: [
      {
        // A remote-site feed lag: the ward confirmation is well past staleAfterMinutes.
        id: "kun-adult-open",
        siteCode: "KUN",
        name: "Kununurra Adult Open",
        cohort: "Adult",
        security: "Open",
        authorised: true,
        beds: 6,
        empty: { value: 1, source: "feed", confirmedAt: NOW_ANCHOR - 11, staleAfterMinutes: 20 },
        allocatable: { value: 0, source: "ward", confirmedAt: NOW_ANCHOR - 200, staleAfterMinutes: 120 },
        held: 0,
        blocked: 0,
        sexMix: { Female: 3, Male: 2 },
        speciallingCapacity: 0,
      },
    ],
  },
  {
    code: "SJGS",
    name: "St John of God Subiaco Hospital",
    service: "Private",
    units: [
      {
        // Private and not authorised under the Mental Health Act — it can take voluntary
        // admissions but never an involuntary destination.
        id: "sjgs-adult-open",
        siteCode: "SJGS",
        name: "SJGS Adult Open",
        cohort: "Adult",
        security: "Open",
        authorised: false,
        beds: 10,
        empty: { value: 2, source: "feed", confirmedAt: NOW_ANCHOR - 5, staleAfterMinutes: 15 },
        allocatable: { value: 1, source: "ward", confirmedAt: NOW_ANCHOR - 20, staleAfterMinutes: 90 },
        held: 1,
        blocked: 0,
        sexMix: { Female: 4, Male: 4 },
        speciallingCapacity: 1,
      },
      {
        id: "sjgs-adult-secure",
        siteCode: "SJGS",
        name: "SJGS Adult Secure",
        cohort: "Adult",
        security: "Secure",
        authorised: false,
        beds: 8,
        empty: { value: 1, source: "feed", confirmedAt: NOW_ANCHOR - 6, staleAfterMinutes: 15 },
        allocatable: { value: 1, source: "ward", confirmedAt: NOW_ANCHOR - 24, staleAfterMinutes: 90 },
        held: 0,
        blocked: 0,
        sexMix: { Female: 4, Male: 3 },
        speciallingCapacity: 0,
      },
    ],
  },
];

export function allUnits(): Unit[] {
  return wardSites.flatMap((site) => site.units);
}

export function allEmergencyDepartments(): EmergencyDepartment[] {
  return wardSites.flatMap((site) => (site.emergencyDepartment ? [site.emergencyDepartment] : []));
}

/** Returns `undefined` for an unknown id. Never falls back to a different unit. */
export function unitById(id: string): Unit | undefined {
  return allUnits().find((unit) => unit.id === id);
}

/**
 * Task 9: added alongside `unitById` (per the Task 9-12 preflight's "no `edById`" note) rather
 * than leaving every future caller to write its own inline `.find()`. Returns `undefined` for an
 * unknown id — never falls back to a different department.
 */
export function edById(id: string): EmergencyDepartment | undefined {
  return allEmergencyDepartments().find((ed) => ed.id === id);
}

/** Returns `undefined` for an unknown code. Never falls back to a different site. */
export function siteByCode(code: string): Site | undefined {
  return wardSites.find((site) => site.code === code);
}
