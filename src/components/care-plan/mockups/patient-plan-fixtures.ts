import { publicCrisisContacts } from "./fixtures";
import type { PatientResource, PatientResourceCategory, SyntheticId } from "./types";

/**
 * Care Plan — the resources offered on a person's own copy of their plan.
 *
 * These live in their own module rather than in `fixtures.ts`, which is already
 * long enough that a reader looking for one patient's plan content has to scroll
 * past everything else. Nothing here reads a clock, a network, storage, or a
 * random source.
 *
 * **Everything in this file is invented except the crisis lines.** The synthetic
 * services, their telephone numbers, and their web addresses are fictional and
 * `SYN-` identified. The `crisis_contact` entries are built from
 * `publicCrisisContacts` — the four verified public numbers — rather than being
 * typed out again here, because a resource sheet that leaves the building with a
 * mistyped crisis number is the one error on it that could matter at 3am. There
 * is one source of truth for those four, and this is not it.
 *
 * Housing and financial entries are present, and deliberately so. They are
 * frequently the actual reason somebody keeps arriving at an emergency
 * department, and a resource list that cannot mention rent, a bond, or a
 * Centrelink payment is a list about the wrong problem. Alex has nowhere settled
 * to go and Jordan is behind on rent; both are on their own plans in plain words,
 * without either being described as a failing of theirs.
 */

/** How each category is headed on the person's own copy, in their voice. */
export const PATIENT_RESOURCE_CATEGORY_LABEL: Record<PatientResourceCategory, string> = {
  care_team: "Your care team",
  local_service: "Services near you",
  housing: "Somewhere to live",
  financial: "Money and bills",
  transport: "Getting there",
  carer_support: "For the people who support you",
  alcohol_and_other_drugs: "Alcohol and other drugs",
  cultural_or_peer: "Cultural and peer support",
  crisis_contact: "If you need help now",
  self_help_reading: "Things to read",
};

/**
 * The order the categories are printed in. The person's own team first, because
 * that is who they will actually ring; the crisis lines last, because that is
 * where a reader looks when everything above has not worked and it should be the
 * easiest block on the page to find by flipping to the end.
 */
export const PATIENT_RESOURCE_CATEGORY_ORDER = [
  "care_team",
  "local_service",
  "housing",
  "financial",
  "transport",
  "carer_support",
  "alcohol_and_other_drugs",
  "cultural_or_peer",
  "self_help_reading",
  "crisis_contact",
] as const satisfies readonly PatientResourceCategory[];

/**
 * The verified public crisis lines, as resources on one person's copy. Built
 * from the fixture rather than transcribed: the number, the hours, the stated
 * limitation, and the page each was checked against all travel together, so a
 * correction in one place reaches every printed sheet.
 */
function crisisResourcesFor(patientId: SyntheticId): PatientResource[] {
  return publicCrisisContacts.map((contact, index) => ({
    id: `SYN-RESOURCE-CRISIS-${patientId.slice("SYN-PATIENT-".length)}-${String(index + 1).padStart(3, "0")}`,
    patientId,
    category: "crisis_contact",
    name: `${contact.name} — ${contact.telephoneDisplay}`,
    detail:
      contact.caveat === null
        ? `${contact.coverage}. ${contact.availability}.`
        : `${contact.coverage}. ${contact.availability}. ${contact.caveat}`,
    contact: contact.telephoneDisplay,
    sourceUrl: contact.sourceUrl,
    isRealContact: true,
  })) satisfies PatientResource[];
}

/**
 * The invented services. Written to be read by the person they are for: what the
 * service does, what it will actually help with, and what to say when ringing.
 * None of them describes the person as a problem, and none of them makes an offer
 * conditional on the person doing something first.
 */
const INVENTED_RESOURCES = [
  // --- Rowan (SYN-PATIENT-001) ------------------------------------------------
  {
    id: "SYN-RESOURCE-001",
    patientId: "SYN-PATIENT-001",
    category: "care_team",
    name: "North River community mental health team",
    detail:
      "Your team during the week. Ask for the duty worker if Sam is not in — you do not need an appointment to ring.",
    contact: "0491 570 101",
    sourceUrl: null,
    isRealContact: false,
  },
  {
    id: "SYN-RESOURCE-002",
    patientId: "SYN-PATIENT-001",
    category: "local_service",
    name: "North River after-hours drop-in",
    detail: "A quiet room and someone to talk to, evenings and weekends. You can turn up without ringing first.",
    contact: "0491 570 130",
    sourceUrl: "https://example.org/north-river-drop-in",
    isRealContact: false,
  },
  {
    id: "SYN-RESOURCE-003",
    patientId: "SYN-PATIENT-001",
    category: "financial",
    name: "North River financial counselling",
    detail:
      "Free help with bills, debts, and Centrelink payments. They can ring a company on your behalf and ask for more time to pay.",
    contact: "0491 570 140",
    sourceUrl: "https://example.org/north-river-money-help",
    isRealContact: false,
  },
  {
    id: "SYN-RESOURCE-004",
    patientId: "SYN-PATIENT-001",
    category: "transport",
    name: "Hospital travel help",
    detail: "Help with the cost of getting to appointments, and a taxi voucher home if you come in at night.",
    contact: "0491 570 150",
    sourceUrl: null,
    isRealContact: false,
  },
  {
    id: "SYN-RESOURCE-005",
    patientId: "SYN-PATIENT-001",
    category: "cultural_or_peer",
    name: "North River peer support",
    detail:
      "People who have used these services themselves, and will sit with you in the emergency department if you would like that.",
    contact: "0491 570 160",
    sourceUrl: null,
    isRealContact: false,
  },
  {
    id: "SYN-RESOURCE-006",
    patientId: "SYN-PATIENT-001",
    category: "carer_support",
    name: "Family and carer line",
    detail: "For Jess, or anyone else who supports you, to get advice and support of their own.",
    contact: "0491 570 170",
    sourceUrl: null,
    isRealContact: false,
  },
  {
    id: "SYN-RESOURCE-007",
    patientId: "SYN-PATIENT-001",
    category: "self_help_reading",
    name: "Sleep and settling — a short guide",
    detail: "Six pages on getting to sleep when your head will not switch off. Written to be read a bit at a time.",
    contact: null,
    sourceUrl: "https://example.org/north-river-sleep-guide",
    isRealContact: false,
  },

  // --- Mira (SYN-PATIENT-002) -------------------------------------------------
  {
    id: "SYN-RESOURCE-008",
    patientId: "SYN-PATIENT-002",
    category: "care_team",
    name: "Coastal Plains older adult community mental health team",
    detail:
      "Your team during the week. Devon is your care coordinator, and the duty worker can help when Devon is out.",
    contact: "0491 570 111",
    sourceUrl: null,
    isRealContact: false,
  },
  {
    id: "SYN-RESOURCE-009",
    patientId: "SYN-PATIENT-002",
    category: "local_service",
    name: "Coastal Plains pain and mobility clinic",
    detail: "For your back. They can see you at home if getting to the clinic is too much on the day.",
    contact: "0491 570 180",
    sourceUrl: null,
    isRealContact: false,
  },
  {
    id: "SYN-RESOURCE-010",
    patientId: "SYN-PATIENT-002",
    category: "transport",
    name: "Community bus to appointments",
    detail: "A door-to-door bus. Ring the day before, and tell them if you need help getting down the front step.",
    contact: "0491 570 190",
    sourceUrl: null,
    isRealContact: false,
  },
  {
    id: "SYN-RESOURCE-011",
    patientId: "SYN-PATIENT-002",
    category: "carer_support",
    name: "Carer support for Daniel",
    detail: "Advice, a break, and someone to talk to for Daniel, so that supporting you does not fall on him alone.",
    contact: "0491 570 200",
    sourceUrl: "https://example.org/coastal-plains-carers",
    isRealContact: false,
  },
  {
    id: "SYN-RESOURCE-012",
    patientId: "SYN-PATIENT-002",
    category: "self_help_reading",
    name: "Living with long-term pain — large print",
    detail: "A large-print booklet about pacing a day so pain takes less of it. Ask Devon for a paper copy.",
    contact: null,
    sourceUrl: "https://example.org/coastal-plains-pain-booklet",
    isRealContact: false,
  },

  // --- Jordan (SYN-PATIENT-003) -----------------------------------------------
  {
    id: "SYN-RESOURCE-013",
    patientId: "SYN-PATIENT-003",
    category: "care_team",
    name: "Wandoo District community mental health team",
    detail: "Your team during the week. There is no named care coordinator yet, so ask for the duty worker.",
    contact: "0491 570 121",
    sourceUrl: null,
    isRealContact: false,
  },
  {
    id: "SYN-RESOURCE-014",
    patientId: "SYN-PATIENT-003",
    category: "housing",
    name: "Wandoo District tenancy support",
    detail:
      "Free help if you are behind on rent or have had a notice from your landlord. Ring them early rather than late — there is much more they can do before a hearing date.",
    contact: "0491 570 210",
    sourceUrl: "https://example.org/wandoo-tenancy-support",
    isRealContact: false,
  },
  {
    id: "SYN-RESOURCE-015",
    patientId: "SYN-PATIENT-003",
    category: "financial",
    name: "Wandoo District emergency relief",
    detail: "Food, fuel, and a hand with an overdue bill. No appointment, and you do not have to explain yourself.",
    contact: "0491 570 220",
    sourceUrl: null,
    isRealContact: false,
  },
  {
    id: "SYN-RESOURCE-016",
    patientId: "SYN-PATIENT-003",
    category: "alcohol_and_other_drugs",
    name: "Wandoo District alcohol and other drug service",
    detail:
      "You can ring them whether or not you want to change anything yet. They will talk about staying safer either way.",
    contact: "0491 570 230",
    sourceUrl: null,
    isRealContact: false,
  },
  {
    id: "SYN-RESOURCE-017",
    patientId: "SYN-PATIENT-003",
    category: "transport",
    name: "Country patient travel scheme",
    detail: "Help with fuel and a bed for the night when an appointment means a long drive.",
    contact: "0491 570 240",
    sourceUrl: null,
    isRealContact: false,
  },
  {
    id: "SYN-RESOURCE-018",
    patientId: "SYN-PATIENT-003",
    category: "self_help_reading",
    name: "A hard week — what helps",
    detail: "Four pages of things other people have found useful. Nothing in it costs anything.",
    contact: null,
    sourceUrl: "https://example.org/wandoo-hard-week",
    isRealContact: false,
  },

  // --- Evelyn (SYN-PATIENT-004) -----------------------------------------------
  {
    id: "SYN-RESOURCE-019",
    patientId: "SYN-PATIENT-004",
    category: "care_team",
    name: "North River community mental health team",
    detail: "Your team during the week. Ask for the duty worker — you do not need an appointment to ring.",
    contact: "0491 570 101",
    sourceUrl: null,
    isRealContact: false,
  },
  {
    id: "SYN-RESOURCE-020",
    patientId: "SYN-PATIENT-004",
    category: "local_service",
    name: "North River women's health service",
    detail: "A women-only service, with a private room and a female clinician. You can ask for either when you ring.",
    contact: "0491 570 250",
    sourceUrl: null,
    isRealContact: false,
  },
  {
    id: "SYN-RESOURCE-021",
    patientId: "SYN-PATIENT-004",
    category: "housing",
    name: "North River housing and safety support",
    detail:
      "Somewhere to stay, and help sorting out a longer-term place. They can talk through your options without you having to decide anything on the call.",
    contact: "0491 570 260",
    sourceUrl: "https://example.org/north-river-housing",
    isRealContact: false,
  },
  {
    id: "SYN-RESOURCE-022",
    patientId: "SYN-PATIENT-004",
    category: "cultural_or_peer",
    name: "North River women's peer group",
    detail: "A small group that meets on Thursdays. You can come once and see what you think.",
    contact: null,
    sourceUrl: "https://example.org/north-river-womens-group",
    isRealContact: false,
  },
  {
    id: "SYN-RESOURCE-023",
    patientId: "SYN-PATIENT-004",
    category: "self_help_reading",
    name: "Getting privacy in a busy place",
    detail: "A short guide to asking for a private room, and what to say if the first answer is no.",
    contact: null,
    sourceUrl: "https://example.org/north-river-privacy-guide",
    isRealContact: false,
  },

  // --- Alex (SYN-PATIENT-005) -------------------------------------------------
  {
    id: "SYN-RESOURCE-024",
    patientId: "SYN-PATIENT-005",
    category: "care_team",
    name: "North River community mental health team",
    detail: "Your team during the week. You have met them once; you can ring them whether or not you come back in.",
    contact: "0491 570 101",
    sourceUrl: null,
    isRealContact: false,
  },
  {
    id: "SYN-RESOURCE-025",
    patientId: "SYN-PATIENT-005",
    category: "housing",
    name: "North River youth housing service",
    detail:
      "A bed tonight, and help finding somewhere longer term. Ring any time — they answer at night, which is when it usually matters.",
    contact: "0491 570 270",
    sourceUrl: "https://example.org/north-river-youth-housing",
    isRealContact: false,
  },
  {
    id: "SYN-RESOURCE-026",
    patientId: "SYN-PATIENT-005",
    category: "financial",
    name: "Centrelink social work service",
    detail:
      "They can sort out a payment quickly when you have nowhere to stay, and you do not need an address to start.",
    contact: "0491 570 280",
    sourceUrl: null,
    isRealContact: false,
  },
  {
    id: "SYN-RESOURCE-027",
    patientId: "SYN-PATIENT-005",
    category: "alcohol_and_other_drugs",
    name: "North River young people's alcohol and other drug service",
    detail: "For under twenty-fives. They will talk about staying safer whether or not you want to stop anything.",
    contact: "0491 570 290",
    sourceUrl: null,
    isRealContact: false,
  },
  {
    id: "SYN-RESOURCE-028",
    patientId: "SYN-PATIENT-005",
    category: "cultural_or_peer",
    name: "North River young adult peer worker",
    detail: "Someone closer to your own age who has been through this, and will meet you somewhere that is not a ward.",
    contact: "0491 570 300",
    sourceUrl: null,
    isRealContact: false,
  },
  {
    id: "SYN-RESOURCE-029",
    patientId: "SYN-PATIENT-005",
    category: "local_service",
    name: "North River walk-in health clinic",
    detail: "Free, no appointment, no Medicare card needed. Good for anything physical while things are unsettled.",
    contact: "0491 570 310",
    sourceUrl: null,
    isRealContact: false,
  },
  {
    id: "SYN-RESOURCE-030",
    patientId: "SYN-PATIENT-005",
    category: "self_help_reading",
    name: "Waiting well",
    detail: "Two pages on getting through a long wait in an emergency department without leaving before you are seen.",
    contact: null,
    sourceUrl: "https://example.org/north-river-waiting-well",
    isRealContact: false,
  },
] satisfies readonly PatientResource[];

/** Every patient the invented resources name, in fixture order. */
const RESOURCE_PATIENT_IDS = [
  "SYN-PATIENT-001",
  "SYN-PATIENT-002",
  "SYN-PATIENT-003",
  "SYN-PATIENT-004",
  "SYN-PATIENT-005",
] as const satisfies readonly SyntheticId[];

/**
 * Every resource in the prototype: the invented services, plus the verified
 * crisis lines for each person. One flat list, because the state holds one flat
 * list and a shape that differs between the fixture and the state is a shape
 * somebody has to convert at the boundary.
 */
export const syntheticPatientResources: readonly PatientResource[] = [
  ...INVENTED_RESOURCES,
  ...RESOURCE_PATIENT_IDS.flatMap((patientId) => crisisResourcesFor(patientId)),
];

export function getPatientResources(
  resources: readonly PatientResource[],
  patientId: SyntheticId,
): readonly PatientResource[] {
  return resources.filter((resource) => resource.patientId === patientId);
}

/**
 * Resources grouped for display, in `PATIENT_RESOURCE_CATEGORY_ORDER`, with
 * empty categories dropped. A heading with nothing under it on a person's own
 * copy reads as something they were not offered.
 */
export function groupPatientResources(
  resources: readonly PatientResource[],
): readonly { category: PatientResourceCategory; label: string; resources: readonly PatientResource[] }[] {
  return PATIENT_RESOURCE_CATEGORY_ORDER.map((category) => ({
    category,
    label: PATIENT_RESOURCE_CATEGORY_LABEL[category],
    resources: resources.filter((resource) => resource.category === category),
  })).filter((group) => group.resources.length > 0);
}
