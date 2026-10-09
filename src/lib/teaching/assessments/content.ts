/*
 * Teaching › Assessments: the fixed wording of a prevocational term assessment.
 * The domains, outcomes, rating scale and global ratings follow the AMC National
 * Framework 2024 term assessment form (e-portfolio and paper versions, checked 9 Oct
 * 2026; sources in work-mode-build/assessments-cla-sources-check.md). Hospitals lay
 * their own forms out differently. These are rules text, not patient data.
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
    // AMC term assessment form: "Further information, assessment and/or remediation will be required before deciding".
    detail: "Further information, assessment or remediation is needed before deciding.",
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

/**
 * Titles are the AMC term assessment form's domain headings, subtitles the Section 2A domain names, and outcome
 * names the form's short labels (1.3 has a colon where the form has a spaced hyphen).
 */
export const DOMAINS: readonly Domain[] = [
  {
    n: 1,
    title: "Clinical practice",
    subtitle: "The prevocational doctor as a practitioner",
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
        "Communication: Aboriginal and Torres Strait Islander patients",
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
        "Utilising and adapting to dynamic systems",
        "Use documentation, communication and decision-support systems well.",
      ),
    ],
  },
  {
    n: 2,
    title: "Professionalism and leadership",
    subtitle: "The prevocational doctor as a professional and leader",
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
        "Help keep work safe and supportive. Know the policies on bullying, harassment and discrimination.",
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
    subtitle: "The prevocational doctor as a health advocate",
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
        "Understanding impacts of colonisation and racism",
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
    subtitle: "The prevocational doctor as a scientist and scholar",
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

/** The "Sources of information" ticks on the AMC paper term assessment form. Its "Other" has its own field. */
export const EVIDENCE_SOURCES = [
  "Nursing staff",
  "Registrars",
  "Allied health professionals",
  "Other specialists",
  "EPAs",
  "PGY1/PGY2 record of learning",
] as const;

/** The eight steps of the form, in order. */
export const FORM_STEPS = ["about", "d1", "d2", "d3", "d4", "global", "summary", "review"] as const;
export const LAST_FORM_STEP = FORM_STEPS.length - 1;

export type EpaNumber = 1 | 2 | 3 | 4;
/**
 * The four EPAs of the AMC National Framework, the same for PGY1 and PGY2 (assessed at a higher level in PGY2).
 * `title` is the short name rows use. `formal` is the name on the AMC term assessment form, and `detail`
 * follows the AMC's own description (Training and assessment requirements, Section 2B). Sources are listed
 * in /mnt/project-files/work-mode-build/assessments-cla-sources-check.md, checked 9 Oct 2026.
 */
export const EPAS: readonly { id: EpaNumber; title: string; formal: string; short: string; detail: string }[] = [
  {
    id: 1,
    title: "Clinical assessment",
    formal: "Clinical assessment",
    short: "Assessment",
    detail: "History, examination, a differential diagnosis and a management plan, including investigations.",
  },
  {
    id: 2,
    title: "Recognition and care of the acutely unwell patient",
    formal: "Recognition and care of the acutely unwell patient",
    short: "Acutely unwell",
    detail: "Recognise, assess, escalate and give immediate care to deteriorating and acutely unwell patients.",
  },
  {
    id: 3,
    title: "Prescribing",
    formal: "Prescribing",
    short: "Prescribing",
    detail: "Prescribe drugs, fluids, blood products and inhaled therapies, including oxygen, to suit the patient.",
  },
  {
    id: 4,
    title: "Team communication",
    formal: "Team communication: documentation, handover and referrals",
    short: "Communication",
    detail: "Documentation, handover and referral, written and spoken.",
  },
];

export function epa(id: EpaNumber) {
  return EPAS[id - 1]!;
}

export type SupervisionLevel = "direct" | "proximal" | "minimal";
/**
 * The EPA form's three-point scale. `formLabel` is the AMC form's exact wording, `title` the short name rows
 * use, and `detail` a plain reading of the form's descriptor, addressed to the assessor.
 */
export const SUPERVISION_LEVELS: readonly { id: SupervisionLevel; title: string; formLabel: string; detail: string }[] =
  [
    {
      id: "direct",
      title: "Direct supervision",
      formLabel: "Requires direct supervision",
      detail: "You or the day-to-day supervisor need to be there to watch and review the work.",
    },
    {
      id: "proximal",
      title: "Proximal supervision",
      formLabel: "Requires proximal supervision",
      // AMC EPA form: "easily contacted, and able to provide immediate or detailed review of work".
      detail: "You need to be easy to reach, and able to review the work straight away or in detail.",
    },
    {
      id: "minimal",
      title: "Minimal supervision",
      formLabel: "Requires minimal supervision",
      // AMC EPA form and Section 2B, p.25: "contactable/in the building and able to provide a general overview".
      detail: "You trust them to do it, and need only be contactable or in the building for a general overview.",
    },
  ];

export function supervisionLevelName(id: SupervisionLevel): string {
  return SUPERVISION_LEVELS.find((level) => level.id === id)!.title;
}

/** Case complexity, as the EPA form records it. */
export type CaseComplexity = "low" | "medium" | "high";
export const CASE_COMPLEXITIES: readonly { id: CaseComplexity; title: string }[] = [
  { id: "low", title: "Low" },
  { id: "medium", title: "Medium" },
  { id: "high", title: "High" },
];

export function caseComplexityName(id: CaseComplexity): string {
  return CASE_COMPLEXITIES.find((c) => c.id === id)!.title;
}

/**
 * Help and words. Sources (work-mode-build/assessments-cla-sources-check.md): PMCWA accredits prevocational posts
 * in WA (Medical Board list of postgraduate medical councils, §12). WA Health uses the title Director of Clinical
 * Training (§12, owner decision 9 Oct 2026). The primary clinical supervisor is "the consultant responsible for
 * managing the patients" and may change during the term (AMC Section 2, p.22), and completes the mid-term (AMC
 * Section 3A). The specialist EPA is AMC Section 3A, p.50. The panel makes a global judgement, and for PGY1 the
 * Medical Board decides on general registration (AMC Guide to Assessment Review Panels, p.5; Section 3C, p.59).
 */
export const GLOSSARY: readonly [string, string][] = [
  ["AMC", "Australian Medical Council. Sets the national framework for PGY1 and PGY2 training."],
  ["PMCWA", "Postgraduate Medical Council of WA. Accredits prevocational training posts in WA."],
  ["MEU", "Medical Education Unit. Your hospital's team for forms, due dates and support."],
  [
    "DCT",
    "Director of Clinical Training. Senior doctor responsible for junior doctors' training at your hospital. Some hospitals use a different title.",
  ],
  ["MEO", "Medical Education Officer. Works in the MEU, sets up terms and tracks forms."],
  ["Term supervisor", "Runs your term orientation and assessment, and signs your end-of-term assessment."],
  [
    "Primary clinical supervisor",
    "The consultant responsible for managing your patients. This may change during the term. Usually completes your mid-term assessment.",
  ],
  [
    "Assessor",
    "Anyone trained to rate an EPA, such as a registrar or specialist. Nurses and pharmacists can contribute. At least one EPA each term is by your primary clinical supervisor or an equivalent specialist.",
  ],
  [
    "EPA",
    "Entrustable professional activity. A short observed task (like a clinical assessment) rated by how much supervision you needed.",
  ],
  ["IPAP", "Improving Performance Action Plan. Extra support with goals and a review date."],
  [
    "Assessment Review Panel",
    "Judges at the end of the year whether you've achieved the outcomes. For PGY1, the Medical Board then decides on general registration.",
  ],
  [
    "CLA",
    "Clinical Learning Australia. The AMC's national e-portfolio for PGY1 and PGY2 training. Your MEU tells you if your hospital uses it.",
  ],
  [
    "Guest assessor",
    "An EPA assessor without a CLA account, who answers from an emailed link. Shows as Unapproved until the MEU approves them.",
  ],
  [
    "A, B, C, D",
    "Kinds of experience: undifferentiated illness, chronic illness, acute and critical illness, peri-operative/procedural.",
  ],
];
