import { syntheticEdPresentations, syntheticPatients } from "./fixtures";
import type { PrototypeScenario } from "./types";

/**
 * Every Care Plan URL is built here and nowhere else, so a link can never drift
 * from the route it is supposed to reach and no page file has to repeat a
 * synthetic identifier. The whole family lives under one gated prefix; the
 * developer-area gate in `src/proxy.ts` matches this exact string.
 */
export const CARE_PLAN_BASE = "/mockups/care-plan";

/**
 * The one place a literal synthetic identifier appears in a URL. `CARE_PLAN_ROUTES`
 * is the reconstructable example of each route — the address you can type into the
 * browser and land on a working page — while the builders below rebuild the same
 * shapes for any other synthetic record.
 */
const EXAMPLE_PATIENT_ID = "SYN-PATIENT-001";
const EXAMPLE_PRESENTATION_ID = "SYN-PRESENTATION-001";

function patientPath(patientId: string) {
  return `${CARE_PLAN_BASE}/patients/${patientId}`;
}

export const CARE_PLAN_ROUTES = {
  home: CARE_PLAN_BASE,
  patients: `${CARE_PLAN_BASE}/patients`,
  patient: patientPath(EXAMPLE_PATIENT_ID),
  managementPlan: `${patientPath(EXAMPLE_PATIENT_ID)}/management-plan`,
  managementPlanEdit: `${patientPath(EXAMPLE_PATIENT_ID)}/management-plan/edit`,
  managementPlanReview: `${patientPath(EXAMPLE_PATIENT_ID)}/management-plan/review`,
  managementPlanPrint: `${patientPath(EXAMPLE_PATIENT_ID)}/management-plan/print`,
  patientPlan: `${patientPath(EXAMPLE_PATIENT_ID)}/patient-plan`,
  patientPlanEdit: `${patientPath(EXAMPLE_PATIENT_ID)}/patient-plan/edit`,
  patientPlanPrint: `${patientPath(EXAMPLE_PATIENT_ID)}/patient-plan/print`,
  safetyPlan: `${patientPath(EXAMPLE_PATIENT_ID)}/safety-plan`,
  safetyPlanEdit: `${patientPath(EXAMPLE_PATIENT_ID)}/safety-plan/edit`,
  safetyPlanPrint: `${patientPath(EXAMPLE_PATIENT_ID)}/safety-plan/print`,
  presentations: `${patientPath(EXAMPLE_PATIENT_ID)}/presentations`,
  newPresentation: `${patientPath(EXAMPLE_PATIENT_ID)}/presentations/new`,
  presentation: `${patientPath(EXAMPLE_PATIENT_ID)}/presentations/${EXAMPLE_PRESENTATION_ID}`,
  history: `${patientPath(EXAMPLE_PATIENT_ID)}/history`,
  reviews: `${CARE_PLAN_BASE}/reviews`,
  team: `${CARE_PLAN_BASE}/team`,
  governance: `${CARE_PLAN_BASE}/governance`,
  systemStates: `${CARE_PLAN_BASE}/system-states`,
} as const;

export type CarePlanRouteKey = keyof typeof CARE_PLAN_ROUTES;

/**
 * Query strings carry a named specimen state and nothing else. No name, contact
 * detail, clinical text, or any other record content is ever put in a URL, so a
 * link can be shared, bookmarked, or logged without carrying content with it.
 */
export function withQuery(route: string, key: string, value: string) {
  const separator = route.includes("?") ? "&" : "?";
  return `${route}${separator}${key}=${encodeURIComponent(value)}`;
}

export const carePlanRoute = {
  patient(patientId: string) {
    return patientPath(patientId);
  },
  managementPlan(patientId: string) {
    return `${patientPath(patientId)}/management-plan`;
  },
  /** Where a replacement version is drafted. Reached only by a role that carries
   *  the authoring capability; the reducer rechecks that either way. */
  managementPlanEdit(patientId: string) {
    return `${patientPath(patientId)}/management-plan/edit`;
  },
  /** Where a submitted version is compared and decided on. */
  managementPlanReview(patientId: string) {
    return `${patientPath(patientId)}/management-plan/review`;
  },
  managementPlanPrint(patientId: string) {
    return `${patientPath(patientId)}/management-plan/print`;
  },
  patientPlan(patientId: string) {
    return `${patientPath(patientId)}/patient-plan`;
  },
  /** Where the person's own copy is written and its gaps are filled. Any
   *  clinical role may approve it, so this is the only authoring address the
   *  Patient Plan has. */
  patientPlanEdit(patientId: string) {
    return `${patientPath(patientId)}/patient-plan/edit`;
  },
  patientPlanPrint(patientId: string) {
    return `${patientPath(patientId)}/patient-plan/print`;
  },
  safetyPlan(patientId: string) {
    return `${patientPath(patientId)}/safety-plan`;
  },
  /** Where the person's own document is written or revised. It needs no senior
   *  approval, so this is the only authoring address the Safety Plan has. */
  safetyPlanEdit(patientId: string) {
    return `${patientPath(patientId)}/safety-plan/edit`;
  },
  safetyPlanPrint(patientId: string) {
    return `${patientPath(patientId)}/safety-plan/print`;
  },
  presentations(patientId: string) {
    return `${patientPath(patientId)}/presentations`;
  },
  /** Where one concise ED Presentation is recorded. */
  newPresentation(patientId: string) {
    return `${patientPath(patientId)}/presentations/new`;
  },
  presentation(patientId: string, presentationId: string) {
    return `${patientPath(patientId)}/presentations/${presentationId}`;
  },
  history(patientId: string) {
    return `${patientPath(patientId)}/history`;
  },
  scenario(scenario: PrototypeScenario, route: string = CARE_PLAN_ROUTES.systemStates) {
    return withQuery(route, "scenario", scenario);
  },
  withQuery,
} as const;

/**
 * The finite parameter lists the dynamic pages prerender from. They are derived
 * from the fixtures rather than written out again, so a fixture change cannot
 * leave a page file quietly pointing at a record that no longer exists.
 */
export const SYNTHETIC_PATIENT_PARAMS: readonly { patientId: string }[] = syntheticPatients.map((patient) => ({
  patientId: patient.id,
}));

export const SYNTHETIC_PRESENTATION_PARAMS: readonly { patientId: string; presentationId: string }[] =
  syntheticEdPresentations.map((presentation) => ({
    patientId: presentation.patientId,
    presentationId: presentation.id,
  }));

const PATIENT_IDS = new Set(SYNTHETIC_PATIENT_PARAMS.map(({ patientId }) => patientId));
const PRESENTATION_PAIRS = new Set(
  SYNTHETIC_PRESENTATION_PARAMS.map(({ patientId, presentationId }) => `${patientId}/${presentationId}`),
);

export function isSyntheticPatientId(patientId: string): boolean {
  return PATIENT_IDS.has(patientId);
}

/**
 * An episode belongs to exactly one patient, so a valid episode identifier under
 * the wrong patient is still an unknown address and nothing may render it.
 *
 * This answers the question against the fixtures, which is everything the
 * prerendered parameter list knows. It is not what the episode page asks — see
 * `isSyntheticPresentationId` for why.
 */
export function isSyntheticPresentationForPatient(patientId: string, presentationId: string): boolean {
  return PRESENTATION_PAIRS.has(`${patientId}/${presentationId}`);
}

const SYNTHETIC_PRESENTATION_ID = /^SYN-PRESENTATION-\d{3,}$/;

/**
 * Whether an address names an identifier in the synthetic episode series at all.
 *
 * The episode page is a server component and cannot see the session's memory, so
 * it cannot ask the question that matters — does this episode belong to this
 * patient. An episode recorded during the session is a real address the
 * fixture-derived pairing has never heard of, so answering with
 * `isSyntheticPresentationForPatient` there would send a clinician who has just
 * recorded an ED Presentation to a 404 for the record they created.
 *
 * The page therefore refuses only what is not an address at all, and the surface
 * — which holds the state — makes the belongs-to-this-patient decision and shows
 * identity uncertainty rather than a nearby person's episode.
 */
export function isSyntheticPresentationId(presentationId: string): boolean {
  return SYNTHETIC_PRESENTATION_ID.test(presentationId);
}

export type CarePlanDestination = "Home" | "Patients" | "Reviews" | "Team" | "Governance" | "System states";

export const CARE_PLAN_PRIMARY_DESTINATIONS: readonly { label: CarePlanDestination; href: string }[] = [
  { label: "Home", href: CARE_PLAN_ROUTES.home },
  { label: "Patients", href: CARE_PLAN_ROUTES.patients },
  { label: "Reviews", href: CARE_PLAN_ROUTES.reviews },
  { label: "Team", href: CARE_PLAN_ROUTES.team },
  { label: "Governance", href: CARE_PLAN_ROUTES.governance },
];

/** The three destinations the phone dock does not have room for. */
export const CARE_PLAN_MORE_DESTINATIONS: readonly {
  label: CarePlanDestination;
  href: string;
  description: string;
}[] = [
  { label: "Team", href: CARE_PLAN_ROUTES.team, description: "Community teams and the clinicians who own each plan" },
  {
    label: "Governance",
    href: CARE_PLAN_ROUTES.governance,
    description: "What this prototype does, who may do it, and what it deliberately does not decide",
  },
  {
    label: "System states",
    href: CARE_PLAN_ROUTES.systemStates,
    description: "Deterministic specimens of every degraded state",
  },
];

export const CARE_PLAN_SYSTEM_STATES_DESTINATION = {
  label: "System states" as const,
  href: CARE_PLAN_ROUTES.systemStates,
};
