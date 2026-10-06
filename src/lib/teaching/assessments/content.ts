/*
 * Teaching › Assessments: the fixed wording of a WA prevocational term assessment.
 * The domains, outcomes, rating scale and global ratings follow the AMC National
 * Framework 2024 template (as used on the RPBG 2025 form). These are rules text, not
 * patient data; they are to be checked against the source before real records exist.
 */

export const RATING_LABELS = [
  "Rarely met",
  "Inconsistently met",
  "Consistently met",
  "Often exceeded",
  "Consistently exceeded",
] as const;

/** A domain rating, 1 to 5. */
export type Rating = 1 | 2 | 3 | 4 | 5;

export type GlobalRating = "sat" | "cond" | "unsat";

export const GLOBAL_RATINGS: readonly { id: GlobalRating; title: string; detail: string }[] = [
  {
    id: "sat",
    title: "Satisfactory",
    detail: "Met or exceeded what's expected at this level of training this term.",
  },
  {
    id: "cond",
    title: "Conditional pass",
    detail: "More information, assessment or support needed before deciding.",
  },
  {
    id: "unsat",
    title: "Unsatisfactory",
    detail: "Did not meet what's expected at this level of training this term.",
  },
];

export function globalRatingName(id: GlobalRating | null): string {
  return GLOBAL_RATINGS.find((rating) => rating.id === id)?.title ?? "Not rated";
}

export type DomainNumber = 1 | 2 | 3 | 4;
export const DOMAIN_NUMBERS: readonly DomainNumber[] = [1, 2, 3, 4];

export type Outcome = { id: string; name: string; detail: string };
export type Domain = { n: DomainNumber; title: string; subtitle: string; outcomes: readonly Outcome[] };

const outcome = (id: string, name: string, detail: string): Outcome => ({ id, name, detail });

export const DOMAINS: readonly Domain[] = [
  {
    n: 1,
    title: "Clinical practice",
    subtitle: "The doctor as practitioner",
    outcomes: [
      outcome(
        "1.1",
        "Patient safety",
        "Place the needs and safety of patients at the centre of care: handover, graded assertiveness, delegation and escalation, infection control, adverse event reporting.",
      ),
      outcome(
        "1.2",
        "Communication",
        "Communicate sensitively and effectively with patients, families, carers and health professionals, using shared decision-making and informed consent.",
      ),
      outcome(
        "1.3",
        "Communication with Aboriginal and Torres Strait Islander patients",
        "Culturally safe, empathic communication that respects Indigenous knowledges of wellbeing and health.",
      ),
      outcome(
        "1.4",
        "Patient assessment",
        "Take a problem-focused history and relevant examination, document it, and form a valid differential or summary.",
      ),
      outcome(
        "1.5",
        "Investigations",
        "Request and interpret common investigations using evidence and cost-effectiveness.",
      ),
      outcome("1.6", "Procedures", "Safely perform common procedures expected of a PGY1 or PGY2 doctor."),
      outcome(
        "1.7",
        "Patient management",
        "Make evidence-informed management decisions and referrals with patients, carers and the team.",
      ),
      outcome(
        "1.8",
        "Prescribing",
        "Prescribe drugs, fluids, electrolytes and blood products safely, effectively and economically.",
      ),
      outcome(
        "1.9",
        "Emergency care",
        "Recognise, assess, escalate and give immediate care to deteriorating and critically unwell patients.",
      ),
      outcome(
        "1.10",
        "Using and adapting to systems",
        "Use documentation, communication and decision-support systems well.",
      ),
    ],
  },
  {
    n: 2,
    title: "Professionalism and leadership",
    subtitle: "The doctor as a professional and leader",
    outcomes: [
      outcome(
        "2.1",
        "Professionalism",
        "Integrity, compassion, self-awareness, empathy, confidentiality and respect for all.",
      ),
      outcome("2.2", "Self-management", "Look after own wellbeing, respond to fatigue, and know own limits."),
      outcome("2.3", "Self-education", "Lifelong learning, and taking part in teaching, supervision and feedback."),
      outcome(
        "2.4",
        "Clinical responsibility",
        "Take more responsibility over time while knowing the limits of own expertise.",
      ),
      outcome("2.5", "Teamwork", "Respect other professions and work well in the team."),
      outcome(
        "2.6",
        "Safe workplace culture",
        "Help keep work safe and supportive; know the policies on bullying, harassment and discrimination.",
      ),
      outcome(
        "2.7",
        "Culturally safe practice for Aboriginal and Torres Strait Islander patients",
        "Reflect on own cultural and clinical competence and plan to close gaps.",
      ),
      outcome("2.8", "Time management", "Manage time and workload, be punctual, and prioritise well."),
    ],
  },
  {
    n: 3,
    title: "Health and society",
    subtitle: "The doctor as a health advocate",
    outcomes: [
      outcome("3.1", "Population health", "Bring prevention, screening and health promotion into individual care."),
      outcome(
        "3.2",
        "Whole of person care",
        "Consider physical, emotional, social, economic, cultural and spiritual needs, and where the person lives.",
      ),
      outcome(
        "3.3",
        "Cultural safety for all communities",
        "Reflect on own practice and power to give care free of racism and discrimination.",
      ),
      outcome(
        "3.4",
        "Understanding biases",
        "Know the system and clinician biases that affect care for Aboriginal and Torres Strait Islander peoples.",
      ),
      outcome(
        "3.5",
        "Impacts of colonisation and racism",
        "Know the ongoing effects of colonisation, intergenerational trauma and racism on health.",
      ),
      outcome(
        "3.6",
        "Integrated healthcare",
        "Partner with patients across the wider health system, including carers and other professionals.",
      ),
    ],
  },
  {
    n: 4,
    title: "Science and scholarship",
    subtitle: "The doctor as scientist and scholar",
    outcomes: [
      outcome("4.1", "Knowledge", "Apply knowledge of common and important presentations across ages and settings."),
      outcome("4.2", "Evidence-informed practice", "Find, appraise and apply evidence."),
      outcome(
        "4.3",
        "Quality assurance",
        "Take part in audit, peer review, incident reporting and reflective practice.",
      ),
      outcome(
        "4.4",
        "Advancing Aboriginal and Torres Strait Islander health",
        "Know evidence-informed models of care that advance Aboriginal and Torres Strait Islander health.",
      ),
    ],
  },
];

export function domain(n: DomainNumber): Domain {
  return DOMAINS[n - 1]!;
}

export const EVIDENCE_SOURCES = [
  "Nursing staff",
  "Registrars",
  "Allied health",
  "Other specialists",
  "EPAs",
  "Learning record",
] as const;

/** The eight steps of the form, in order. */
export const FORM_STEPS = ["about", "d1", "d2", "d3", "d4", "global", "summary", "review"] as const;
export const LAST_FORM_STEP = FORM_STEPS.length - 1;

export type EpaNumber = 1 | 2 | 3 | 4;
export const EPAS: readonly { id: EpaNumber; title: string; short: string; detail: string }[] = [
  {
    id: 1,
    title: "Clinical assessment",
    short: "Assessment",
    detail: "History, examination, differential diagnosis and a management plan.",
  },
  {
    id: 2,
    title: "Acutely unwell patient",
    short: "Acutely unwell",
    detail: "Recognise, assess, escalate and give immediate care.",
  },
  {
    id: 3,
    title: "Prescribing",
    short: "Prescribing",
    detail: "Prescribe drugs, fluids, blood products and oxygen to suit the patient.",
  },
  { id: 4, title: "Team communication", short: "Communication", detail: "Documentation, handover and referral." },
];

export function epa(id: EpaNumber) {
  return EPAS[id - 1]!;
}

export type SupervisionLevel = "direct" | "proximal" | "minimal";
export const SUPERVISION_LEVELS: readonly { id: SupervisionLevel; title: string; detail: string }[] = [
  { id: "direct", title: "Direct supervision", detail: "The supervisor needs to watch the work directly." },
  { id: "proximal", title: "Proximal supervision", detail: "The supervisor is close by and checks the work promptly." },
  { id: "minimal", title: "Minimal supervision", detail: "The supervisor trusts the doctor to do it." },
];

export function supervisionLevelName(id: SupervisionLevel): string {
  return SUPERVISION_LEVELS.find((level) => level.id === id)!.title;
}

export const GLOSSARY: readonly [string, string][] = [
  ["AMC", "Australian Medical Council. Sets the national framework for PGY1 and PGY2 training."],
  ["PMCWA", "Postgraduate Medical Council of WA. Runs the framework in WA."],
  ["MEU", "Medical Education Unit. Your hospital's team for forms, due dates and support."],
  ["DCT", "Director of Clinical Training. Senior doctor responsible for junior doctors' training at your hospital."],
  ["DPME", "Director of Postgraduate Medical Education. Leads the MEU."],
  [
    "EPA",
    "Entrustable professional activity. A short observed task (like a clinical assessment) rated by how much supervision you needed.",
  ],
  ["IPAP", "Improving Performance Action Plan. Extra support with goals and a review date."],
  ["Assessment Review Panel", "Recommends at the end of the year whether you've completed PGY1 or PGY2."],
  ["CLA", "Clinical Learning Australia. The national e-portfolio used in WA."],
  [
    "A, B, C, D",
    "Kinds of experience: undifferentiated illness, chronic illness, acute and critical illness, peri-operative/procedural.",
  ],
];
