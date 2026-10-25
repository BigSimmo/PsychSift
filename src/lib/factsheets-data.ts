/**
 * Patient factsheet library — content model and helpers.
 *
 * This module is intentionally framework-free (no React/lucide imports) so it can
 * be consumed by server route handlers (`generateStaticParams`, `generateMetadata`,
 * search filtering) as well as client components. Icons are referenced by a stable
 * key and mapped to Lucide components in `factsheets-icons.ts`.
 *
 * Governance: these sheets are patient-facing demonstration content written in
 * plain language and dated with a content month (`reviewedOn`). They cite
 * reputable public consumer-health sources (see each sheet's `sources`) but are
 * not clinician-approved for publication. Connect only governance-approved
 * patient information before treating sheets as locally approved.
 */

import { categoryAccentVars, FACTSHEET_CATEGORY_IDENTITY, type FactsheetCategoryKey } from "@/lib/category-identity";
import { includesWholeTerm, normalizeSearchText } from "@/lib/catalog-search";
import { smartSearchContentTerms } from "@/lib/smart-search-intent";

/**
 * Demonstration/governance status shown on-screen and preserved in the printed /
 * exported take-away, so a handout is never mistaken for approved local patient
 * information. Kept as a single source of truth for the disclaimer copy.
 */
/**
 * The Australian crisis routes, as one string so the sheet kinds cannot drift
 * apart over which numbers a reader is given.
 *
 * Every kind must be able to reach this. `condition` and `therapy` append it to `support`,
 * `medRich` carries its own `urgentHelp`, `procedure` carries it inside `safe`,
 * and `medLite` gets `FACTSHEET_MEDLITE_URGENT_HELP` below — because a sheet
 * that names self-harm, a seizure or serotonin toxicity and then offers no way
 * to act on it is worse than one that never raised the symptom.
 */
export const FACTSHEET_CRISIS_CONTACTS = [
  { name: "13YARN", number: "13 92 76" },
  { name: "Beyond Blue", number: "1300 22 4636" },
  { name: "Lifeline", number: "13 11 14" },
] as const;

/** The emergency number, kept beside the contacts it is rendered with. */
export const FACTSHEET_EMERGENCY_NUMBER = "000";

/**
 * Plain-text crisis line for the printed projection.
 *
 * Derived from `FACTSHEET_CRISIS_CONTACTS` rather than written out, because the
 * screen renders the same numbers with its own markup. Two hand-written copies
 * is how a printed handout and a screen come to give a reader different
 * emergency instructions.
 */
export const FACTSHEET_CRISIS_LINE = `In Australia you can call ${FACTSHEET_CRISIS_CONTACTS.map(
  (contact) => `${contact.name} ${contact.number}`,
).join(", ")}, or ${FACTSHEET_EMERGENCY_NUMBER} in an emergency.`;

/**
 * Urgent-help block for the two medicine-overview sheets. `medLite` has no
 * `urgentHelp` field of its own, and both sheets legitimately name
 * emergency-grade symptoms, so the route is supplied by the projection rather
 * than duplicated into each record's prose.
 */
export const FACTSHEET_MEDLITE_URGENT_HELP =
  "If you have thoughts of harming yourself, a seizure, fainting or a sustained irregular heartbeat, or a fever with " +
  "agitation, tremor or stiff muscles, get help straight away rather than waiting for your next appointment. " +
  `Go to your nearest emergency department or call ${FACTSHEET_EMERGENCY_NUMBER}. ${FACTSHEET_CRISIS_LINE}`;

export const FACTSHEET_DEMO_NOTICE =
  "Demonstration content — not clinician-approved. Governance-approved patient information must replace it before any clinical use or sharing.";

/**
 * Re-exported from the shared category registry so the accent map and this
 * module cannot drift over what the four categories are.
 */
export type FactsheetCategory = FactsheetCategoryKey;

export type FactsheetIconKey =
  | "capsule"
  | "layers"
  | "tablet"
  | "cloudRain"
  | "worry"
  | "swings"
  | "chatCheck"
  | "droplet"
  | "chat"
  | "pill"
  | "heart";

export type FactsheetSource = {
  n: string;
  title: string;
  org: string;
  year: string;
  tag: string;
  /**
   * Canonical URL for the cited source. Optional: only governance-approved,
   * verifiable links belong here. When present the detail page renders the
   * citation as an outbound link; when absent it renders as a plain citation
   * (no external-link affordance) rather than implying an openable source.
   *
   * A source whose host is not in `GOVERNED_SOURCE_HOSTS`
   * (`src/lib/sources/source-url-policy.ts`) belongs here without a URL. The
   * host list is ranking-adjacent policy and is not widened to make a citation
   * openable.
   */
  url?: string;
  /**
   * Exact publication date (`YYYY-MM-DD`), where the publisher states one.
   *
   * `year` is the display string and is frequently a year or month only, which
   * `strictSourceDate` correctly refuses. Recording the exact date separately
   * lets the Sources provider pass through real dates without inventing a day
   * for a source that never gave one. Omit rather than approximate.
   */
  publicationDate?: string;
  /** Publisher's own version/issue label, e.g. "CG113" or "Aust Prescr 2020;43:91–3". */
  version?: string;
  /**
   * Explicit catalogue evidence type, for sources the Consumer/Reference tag
   * cannot classify. Without it `factsheetEvidenceType` falls back to
   * `unknown`, which files a real source in the catalogue's unknown band.
   */
  evidenceType?: FactsheetSourceEvidenceType;
};

/**
 * The subset of `ClinicalSourceType` a factsheet citation may declare. Kept as
 * a literal union rather than an import so this module stays framework- and
 * catalogue-free; `tests/factsheets-source-evidence.test.ts` pins it against
 * the catalogue's own type.
 */
export type FactsheetSourceEvidenceType =
  "consumer_reference" | "professional_reference" | "guideline" | "regulatory" | "standard";

type FactsheetBase = {
  slug: string;
  title: string;
  /** Muted brand suffix rendered after the title, e.g. "(Zoloft)". */
  brand?: string;
  category: FactsheetCategory;
  audience: string;
  readTime: string;
  /**
   * Content date month for the sheet, e.g. "Jul 2026".
   * This is a demonstration currency stamp — not clinician approval.
   */
  reviewedOn: string;
  icon: FactsheetIconKey;
  summary: string;
  sources: FactsheetSource[];
  /**
   * Official translated versions of this sheet's topic, published by a
   * governed multicultural-health source (e.g. Health Translations Victoria,
   * HealthyWA, Beyond Blue). We never translate anything ourselves — every
   * entry links to publisher-owned translated material only, and its `url`
   * host must be in `GOVERNED_SOURCE_HOSTS`
   * (`src/lib/sources/source-url-policy.ts`), exactly like `FactsheetSource.url`.
   * Optional: most sheets have none, because no matching official translated
   * material was found for their topic.
   */
  translatedResources?: FactsheetTranslatedResource[];
};

export type FactsheetTranslatedResource = {
  /** The resource's language, or "Multiple languages" for a hub page that lists several. */
  language: string;
  title: string;
  url: string;
};

type MedRichContent = {
  kind: "medRich";
  keyFacts: Array<{ k: string; v: string }>;
  whatEasy: string;
  whatStandard: string;
  howto: Array<{ n: string; t: string }>;
  sideCommon: string[];
  sideSerious: string[];
  urgentHelp: string;
};

type MedLiteContent = {
  kind: "medLite";
  timing: string;
  sections: Array<{ heading: string; body: string }>;
};

type ConditionContent = {
  kind: "condition";
  intro: string;
  signs: string[];
  why: string;
  helps: Array<{ icon: FactsheetIconKey; title: string; body: string }>;
  support: string;
};

type TherapyContent = {
  kind: "therapy";
  intro: string;
  steps: Array<{ n: string; h: string; t: string }>;
  expect: Array<{ k: string; v: string }>;
  support?: string;
};

type ProcedureContent = {
  kind: "procedure";
  why: string;
  prepare: string[];
  timeline: Array<{ t: string; d: string }>;
  /**
   * Symptoms that mean "act now", as a scannable list.
   *
   * Optional and deliberately separate from `safe`. `safe` renders as a single
   * prose paragraph inside a warning callout, which is the wrong shape for the
   * most important content on a monitoring sheet: a reader scanning for
   * "should I be worried about this symptom" should not have to read a
   * paragraph to find out. A sheet with no act-now list omits the field rather
   * than padding one.
   */
  warningSigns?: { heading: string; items: string[] };
  safe: string;
};

export type Factsheet = FactsheetBase &
  (MedRichContent | MedLiteContent | ConditionContent | TherapyContent | ProcedureContent);

export const factsheetCategories: readonly FactsheetCategory[] = [
  "Medications",
  "Conditions",
  "Therapies",
  "Tests & procedures",
] as const;

/** Category → accent theming, expressed as CSS values (token-based, dark-mode safe). */
export type FactsheetTheme = {
  /** Text/icon accent colour. */
  accent: string;
  /** Soft tint used for icon tiles and chips. */
  soft: string;
  /** Hero band gradient. */
  hero: string;
};

/**
 * Derived from `FACTSHEET_CATEGORY_IDENTITY` rather than hand-written per case.
 *
 * The previous table drew two of its four accents from the SEMANTIC palette —
 * Therapies on `--success-text`/`--success-bg` and Tests & procedures on
 * `--warning-text`/`--warning-bg`. Those tokens carry meaning: the six-tone
 * badge system uses warning for "pause, check, adjust, review" and success for
 * a passed check. Painting a whole category in them asserted a safety judgement
 * about content nothing had reviewed, and it did so on the loudest surface the
 * factsheet has — the hero band. `docs/clinical-badge-system-guide.md` puts it
 * the other way round: meaning drives the colour, never the colour the meaning.
 *
 * Medications also moves off `--clinical-accent`. It was the same blue as every
 * selection state, focus ring and evidence marker on the page, so the largest
 * category was the one with no identity of its own.
 *
 * The shape is unchanged, so the ~20 call sites that pass these as inline style
 * values are untouched.
 */
export function categoryTheme(category: FactsheetCategory): FactsheetTheme {
  const vars = categoryAccentVars(FACTSHEET_CATEGORY_IDENTITY[category].accent);
  return {
    accent: vars.accent,
    soft: vars.soft,
    hero: `linear-gradient(135deg, ${vars.soft} 0%, var(--surface) 68%)`,
  };
}

const SOURCES: Record<string, FactsheetSource[]> = {
  sertraline: [
    {
      // Was titled "Consumer Medicine Information" and attributed to
      // "healthdirect / TGA". The linked page is healthdirect's own medicine
      // page, not a CMI, and the TGA neither writes nor publishes CMIs. The
      // issuer of the underlying Apo leaflet was never established, so none is
      // claimed — the publisher of the cited page is healthdirect.
      n: "1",
      title: "Sertraline (Apo) medicine page",
      org: "healthdirect Australia",
      year: "2025",
      tag: "Consumer",
      url: "https://www.healthdirect.gov.au/medicines/brand/amt,154611000036104/sertraline-apo",
    },
    {
      n: "2",
      title: "Sertraline (oral route)",
      org: "Mayo Clinic",
      year: "2026",
      tag: "Reference",
      url: "https://www.mayoclinic.org/drugs-supplements/sertraline-oral-route/description/drg-20065940",
    },
    {
      n: "3",
      title: "Medicines for anxiety",
      org: "healthdirect Australia",
      year: "2025",
      tag: "Consumer",
      url: "https://www.healthdirect.gov.au/medicines-for-anxiety",
    },
    {
      n: "4",
      title: "Antidepressants",
      org: "healthdirect Australia",
      year: "2025",
      tag: "Reference",
      url: "https://www.healthdirect.gov.au/antidepressants",
    },
    {
      // Sponsor-issued, not issued by the site that hosts it: the leaflet is
      // published by Viatris and hosted by the ACSQHC medicine finder with
      // content supplied by MIMS. `org` names the issuer.
      //
      // No URL: the hosting domain is not in GOVERNED_SOURCE_HOSTS, and the
      // host list is not widened to make a citation openable. Rendered as a
      // plain citation, which is what the leaflet's identity supports.
      // Verified 2026-09-16 against the healthdirect Zoloft brand page (citation
      // 6), which lists the Australian indications verbatim: major depression,
      // OCD and panic disorder; social phobia (social anxiety disorder) and
      // prevention of relapse; PMDD; and OCD in children from 6 years. PTSD is
      // NOT an Australian Zoloft indication — it is a US sertraline indication
      // and must not be imported from an overseas source.
      n: "5",
      title: "Zoloft (sertraline) — Consumer Medicine Information, June 2026 edition",
      org: "Viatris Pty Ltd",
      year: "Jun 2026",
      tag: "Consumer",
      version: "2026-06 CMI",
      evidenceType: "consumer_reference",
    },
    {
      // Added so the indication sentence on this sheet is checkable. The
      // sponsor CMI above cannot carry a link (ungoverned host), which left
      // the Australian indication list resting on one uncheckable citation.
      n: "6",
      title: "Zoloft — brand and indication information",
      org: "healthdirect Australia",
      year: "2026",
      tag: "Reference",
      url: "https://www.healthdirect.gov.au/medicines/brand/amt,3559011000036109/zoloft",
      evidenceType: "consumer_reference",
    },
  ],
  depression: [
    {
      n: "1",
      title: "Understand depression",
      org: "Beyond Blue",
      year: "2025",
      tag: "Consumer",
      url: "https://www.beyondblue.org.au/mental-health/depression",
    },
    {
      n: "2",
      title: "Types of depression",
      org: "Beyond Blue",
      year: "2025",
      tag: "Consumer",
      url: "https://www.beyondblue.org.au/mental-health/depression/types-of-depression",
    },
  ],
  gad: [
    {
      n: "1",
      title: "Generalised anxiety disorder (GAD)",
      org: "healthdirect Australia",
      year: "2024",
      tag: "Reference",
      url: "https://www.healthdirect.gov.au/generalised-anxiety-disorder-gad",
    },
    {
      n: "2",
      title: "Generalized Anxiety Disorder: When Worry Gets Out of Control",
      org: "NIMH",
      year: "2024",
      tag: "Reference",
      url: "https://www.nimh.nih.gov/health/publications/generalized-anxiety-disorder-gad",
    },
  ],
  bipolar: [
    {
      n: "1",
      title: "Types of depression (includes bipolar disorder)",
      org: "Beyond Blue",
      year: "2025",
      tag: "Consumer",
      url: "https://www.beyondblue.org.au/mental-health/depression/types-of-depression",
    },
    {
      n: "2",
      title: "Bipolar disorder",
      org: "healthdirect Australia",
      year: "2025",
      tag: "Reference",
      url: "https://www.healthdirect.gov.au/bipolar-disorder",
    },
  ],
  cbt: [
    {
      n: "1",
      title: "Cognitive behaviour therapy (CBT)",
      org: "healthdirect Australia",
      year: "2025",
      tag: "Reference",
      url: "https://www.healthdirect.gov.au/cognitive-behaviour-therapy-cbt",
    },
    {
      n: "2",
      title: "Treatments for depression",
      org: "Beyond Blue",
      year: "2025",
      tag: "Consumer",
      url: "https://www.beyondblue.org.au/mental-health/depression/treatments-for-depression",
    },
    {
      // Linked, not reproduced. CCI's copyright notice does not grant
      // republication of its worksheets or permission to send full texts for
      // indexing; those rights are unresolved and recorded as a hold.
      n: "3",
      title: "WA Centre for Clinical Interventions — self-help resource library",
      org: "CCI, North Metropolitan Health Service WA",
      year: "2025",
      tag: "Consumer",
      url: "https://www.cci.health.wa.gov.au/",
    },
  ],
  ssri: [
    {
      n: "1",
      title: "Medicines for anxiety",
      org: "healthdirect Australia",
      year: "2025",
      tag: "Consumer",
      url: "https://www.healthdirect.gov.au/medicines-for-anxiety",
    },
    {
      n: "2",
      title: "Antidepressants",
      org: "healthdirect Australia",
      year: "2025",
      tag: "Reference",
      url: "https://www.healthdirect.gov.au/antidepressants",
    },
  ],
  escitalopram: [
    {
      n: "1",
      title: "Antidepressants",
      org: "healthdirect Australia",
      year: "2025",
      tag: "Reference",
      url: "https://www.healthdirect.gov.au/antidepressants",
    },
    {
      n: "2",
      title: "Medicines for anxiety",
      org: "healthdirect Australia",
      year: "2025",
      tag: "Consumer",
      url: "https://www.healthdirect.gov.au/medicines-for-anxiety",
    },
    {
      // Sponsor-issued and hosted elsewhere, as above; no URL for the same
      // host-policy reason. The CMI is cited rather than the product
      // information: the hosted PI's edition could not be resolved, so it has
      // no honest date or version, and the indication discrepancy inside it is
      // recorded as a hold in `factsheetEvidence` rather than resolved here.
      n: "3",
      title: "Lexapro (escitalopram) — Consumer Medicine Information, August 2023 edition",
      org: "Lundbeck Australia Pty Ltd",
      year: "Aug 2023",
      tag: "Consumer",
      version: "2023-08 CMI",
      evidenceType: "consumer_reference",
    },
  ],
  "lithium-monitoring": [
    {
      n: "1",
      title: "Lithium",
      org: "healthdirect Australia",
      year: "2025",
      tag: "Consumer",
      url: "https://www.healthdirect.gov.au/lithium",
    },
    {
      n: "2",
      title: "Bipolar disorder",
      org: "healthdirect Australia",
      year: "2025",
      tag: "Reference",
      url: "https://www.healthdirect.gov.au/bipolar-disorder",
    },
    // Australian Prescriber lithium article + correction stay in the
    // acquisition register as candidate/unverified only. They must not
    // appear in the patient-facing `sources` projection until adopted.
  ],
};

export const factsheets: Factsheet[] = [
  {
    slug: "sertraline",
    title: "Sertraline",
    brand: "(Zoloft)",
    category: "Medications",
    audience: "Patients starting an SSRI",
    readTime: "6 min read",
    reviewedOn: "Sep 2026",
    icon: "capsule",
    summary: "A commonly used SSRI for depression and anxiety — how it works, how to take it, and what to expect.",
    sources: SOURCES.sertraline,
    kind: "medRich",
    keyFacts: [
      { k: "Drug class", v: "SSRI antidepressant" },
      { k: "Common brand", v: "Zoloft" },
      { k: "Usual dose", v: "Set by your doctor — depends on the condition" },
      { k: "Takes effect", v: "Often 2–4 weeks, up to 6–8" },
      { k: "With food?", v: "Either way" },
      { k: "Availability", v: "Prescription (S4)" },
    ],
    whatEasy:
      "Sertraline is a medicine that helps with depression and some anxiety conditions. It changes the way your brain uses a chemical messenger called serotonin. Doctors do not fully understand how that lifts mood and eases worry, but for many people it does. It is not addictive, and most people take it once a day.",
    whatStandard:
      "Sertraline is a selective serotonin reuptake inhibitor (SSRI). It blocks the reuptake of serotonin, increasing the amount available between nerve cells, although exactly how that translates into improvement over several weeks is not fully understood. In Australia, Zoloft is registered for major depression, obsessive compulsive disorder, panic disorder, social phobia (social anxiety disorder) and premenstrual dysphoric disorder, and for obsessive compulsive disorder in children from six years. Post-traumatic stress disorder is not an Australian Zoloft indication, although sertraline is approved for it in some other countries. It is not associated with dependence. This sheet is written for adults and is not a dosing guide for children or for premenstrual dysphoric disorder.",
    howto: [
      {
        n: "1",
        t: "Started at the dose your doctor prescribes, taken in the morning or the evening, with or without food. A lower starting dose for the first week is common for some conditions.",
      },
      {
        n: "2",
        t: "Take it at the same time each day. Your doctor may adjust the dose over time. The usual maximum is not the same for every condition, so follow the dose on your own prescription rather than a general figure.",
      },
      {
        n: "3",
        t: "If you miss your usual Zoloft dose, leave it out and take your normal dose the next day. Never take two doses at once to catch up. Other brands and other medicines give different missed-dose advice, so use the leaflet for the product you are taking.",
      },
      {
        n: "4",
        t: "Do not stop suddenly. When the time is right, your doctor will lower the dose slowly over a few weeks.",
      },
    ],
    sideCommon: [
      "Feeling sick (nausea)",
      "Headache",
      "Trouble sleeping, or feeling sleepy",
      "Dry mouth",
      "Looser or more frequent bowel movements",
    ],
    sideSerious: [
      "New or worsening thoughts of self-harm, especially early on",
      "Restlessness you can’t sit still with",
      "Unusual bruising or bleeding",
      "Fever with stiff or twitching muscles and confusion",
    ],
    urgentHelp:
      "Call 000 or go to your nearest emergency department if you have thoughts of harming yourself, or a fever with stiff or twitching muscles, sweating and confusion. You can also call the Poisons Information Centre on 13 11 26.",
  },
  {
    slug: "depression",
    title: "Understanding depression",
    category: "Conditions",
    audience: "Patients and supporters",
    readTime: "8 min read",
    reviewedOn: "Sep 2026",
    icon: "cloudRain",
    summary: "What depression is, the signs to look for, and the treatments and support that help.",
    sources: SOURCES.depression,
    translatedResources: [
      {
        language: "Multiple languages",
        title: "Depression fact sheet (EMBRACE Multicultural Mental Health) — Health Translations Victoria",
        url: "https://www.healthtranslations.vic.gov.au/resources/depression-factsheet",
      },
    ],
    kind: "condition",
    intro:
      "Depression is more than a low mood — it is a health condition that affects both your body and mind, and it can last for weeks, months or longer. It is common, and it is treatable. Doctors usually look for low mood or loss of interest, together with other symptoms, lasting most of the day on most days for about two weeks or more. That two-week mark is a guide for assessment, not a waiting period: if symptoms are severe, if you are losing touch with reality, or if you are thinking of suicide, get help straight away, however long it has been going on.",
    signs: [
      "Low or flat mood most of the day",
      "Losing interest in things you enjoy",
      "Low energy or feeling slowed down",
      "Trouble sleeping, or sleeping too much",
      "Trouble concentrating or deciding",
      "Feeling worthless or guilty",
      "Changes in appetite or weight",
    ],
    why: "Depression usually develops from a combination of biological, psychological and social factors — recent life events, personal and family history, physical illness, and some medicines and substances — rather than from a single cause. It is not simply a shortage of one brain chemical, and it is not a weakness. Part of the assessment is checking for other explanations, including past periods of unusually high or irritable mood, which change what treatment is right.",
    helps: [
      {
        icon: "chat",
        title: "Talking therapy",
        body: "Structured therapies like CBT help you understand and shift unhelpful patterns.",
      },
      {
        icon: "pill",
        title: "Medicines",
        body: "Antidepressants such as SSRIs can help, especially for moderate-to-severe depression.",
      },
      {
        icon: "heart",
        title: "Everyday support",
        body: "Routine, movement, sleep and trusted people all support recovery.",
      },
    ],
    support:
      "Your GP is a good place to start the conversation and build a plan together. Treatment is matched to how severe the depression is, what has helped before, your preferences and your safety — routine, exercise and support are valuable, but they do not replace treatment that is needed urgently. Seek help promptly for thoughts of suicide.",
  },
  {
    slug: "gad",
    title: "Generalised anxiety disorder",
    category: "Conditions",
    audience: "Patients and supporters",
    readTime: "7 min read",
    reviewedOn: "Sep 2026",
    icon: "worry",
    summary: "Persistent, hard-to-control worry — what it feels like and the therapies and medicines that help.",
    sources: SOURCES.gad,
    translatedResources: [
      {
        language: "Multiple languages",
        title: "Anxiety fact sheet for young people (headspace) — Health Translations Victoria",
        url: "https://www.healthtranslations.vic.gov.au/resources/anxiety-fact-sheet",
      },
    ],
    kind: "condition",
    intro:
      "Generalised anxiety disorder (GAD) is when worry happens most of the time and across many situations, often about everyday things. Everyone feels anxious sometimes, but in GAD the worry is harder to control and gets in the way of daily life.",
    signs: [
      "Worry that is hard to control",
      "Feeling restless or on edge",
      "Muscle tension or aches",
      "Tiring easily",
      "Trouble concentrating",
      "Irritability",
      "Poor sleep, often trouble getting off to sleep",
    ],
    why: "A mix of individual and environmental factors — genetics, temperament and stressful experiences — can contribute. Doctors usually look for the characteristic pattern on most days for six months or more, together with distress or interference in daily life, and they consider other explanations such as depression, another anxiety condition, a physical illness, or the effect of a medicine or substance. Duration on its own is not a diagnosis, and you do not have to wait six months to ask for help.",
    helps: [
      {
        icon: "chat",
        title: "CBT",
        body: "Cognitive behavioural therapy is a first-line, well-evidenced treatment for worry.",
      },
      {
        icon: "pill",
        title: "Medicines",
        body: "Antidepressants such as SSRIs or SNRIs are effective; benzodiazepines are avoided long-term.",
      },
      {
        icon: "heart",
        title: "Lifestyle",
        body: "Regular sleep, cutting back on caffeine, and exercise all support treatment.",
      },
    ],
    support:
      "If worry is affecting your daily life, your GP can build a mental health care plan and refer you on. Benzodiazepines can cause dependence and are generally kept for short-term use with a specific reason, rather than ongoing treatment for worry.",
  },
  {
    slug: "ssri",
    title: "Antidepressants: SSRIs explained",
    category: "Medications",
    audience: "Anyone considering an antidepressant",
    readTime: "5 min read",
    reviewedOn: "Sep 2026",
    icon: "layers",
    summary:
      "A widely used class of antidepressant in Australia — how they work, what to expect, and how they are stopped safely.",
    sources: SOURCES.ssri,
    kind: "medLite",
    timing:
      "Most people feel better after 2–4 weeks; it can take 6–8 weeks for the full effect. Keep taking it as prescribed even once you feel well.",
    sections: [
      {
        heading: "What SSRIs are",
        body: "Selective serotonin reuptake inhibitors (SSRIs) are a widely used and usually well tolerated class of antidepressant. Examples include sertraline, escitalopram, citalopram, fluoxetine, fluvoxamine and paroxetine. They are not interchangeable — the conditions they are approved for, their interactions, their doses and how they are stopped all differ between products.",
      },
      {
        heading: "How they work",
        body: "SSRIs change the way the brain handles serotonin, a chemical messenger involved in mood, emotion and sleep. Exactly how that improves symptoms is not fully understood, and depression is not simply a shortage of one brain chemical. Benefit usually builds over several weeks and varies from person to person, so progress is reviewed rather than assumed.",
      },
      {
        heading: "Side effects and stopping",
        body: "Early side effects such as trouble sleeping, nausea, stomach upset, dizziness or sexual difficulties often ease after a few weeks. Tell your doctor promptly about marked restlessness, new or worsening thoughts of self-harm, or a sudden lift in mood and energy. Some medicines, including other serotonin medicines and those affecting bleeding, need to be checked before they are added.",
      },
      {
        heading: "Not addictive, but stopping still needs a plan",
        body: "SSRIs are not addictive and are not a drug of dependence. That is not the same as stopping being easy — withdrawal symptoms such as dizziness, flu-like feelings, irritability or electric-shock sensations can follow a dose reduction or stopping. Do not stop suddenly. Reduction is worked out with your doctor for you and your medicine, not from a fixed taper that suits everyone, and withdrawal is checked against the possibility that the original condition is returning.",
      },
      {
        heading: "If you have ever had a high or manic period",
        body: "Tell your prescriber about any past period of unusually elevated or irritable mood, reduced need for sleep, racing thoughts or out-of-character risk-taking. A history of mania or hypomania changes both the assessment and the prescribing decision, and this general SSRI sheet is not a recommendation to treat bipolar depression with an antidepressant on its own.",
      },
    ],
  },
  {
    slug: "cbt",
    title: "Cognitive behavioural therapy (CBT)",
    category: "Therapies",
    audience: "Patients considering therapy",
    readTime: "5 min read",
    reviewedOn: "Sep 2026",
    icon: "chatCheck",
    summary: "A structured talking therapy that helps you change unhelpful patterns of thinking and behaviour.",
    sources: SOURCES.cbt,
    kind: "therapy",
    intro:
      "Cognitive behavioural therapy is a structured, practical talking therapy delivered with a trained therapist. It works with the links between thoughts, feelings and behaviour, and it means learning and practising skills — not simply being told to think positively. It is one of the most widely used and well-evidenced therapies for depression and anxiety.",
    steps: [
      {
        n: "1",
        h: "Notice your thoughts",
        t: "You learn to catch the automatic thoughts that show up in difficult moments.",
      },
      { n: "2", h: "See the links", t: "You map how thoughts, feelings and behaviours feed into each other." },
      { n: "3", h: "Test and try", t: "You gently test unhelpful thoughts and try new responses in everyday life." },
      { n: "4", h: "Build skills", t: "You practise between sessions so the skills stick and become your own." },
      {
        n: "5",
        h: "Review as you go",
        t: "How often you meet and how many sessions you need depend on the problem, its complexity and your progress. A typical range is a guide, not a limit on what treatment you need.",
      },
    ],
    expect: [
      { k: "Format", v: "Often weekly, varies" },
      { k: "Length", v: "Varies — often 6–20 sessions" },
      { k: "Delivery", v: "Individual or group, in person or online" },
      { k: "Best for", v: "Depression, anxiety" },
    ],
  },
  {
    slug: "escitalopram",
    title: "Escitalopram (Lexapro)",
    category: "Medications",
    audience: "Patients starting an SSRI",
    readTime: "6 min read",
    reviewedOn: "Sep 2026",
    icon: "tablet",
    summary:
      "A commonly used SSRI antidepressant — what to expect week by week, and the safety points to raise with your doctor.",
    sources: SOURCES.escitalopram,
    kind: "medLite",
    timing:
      "It commonly takes 2–4 weeks to notice improvement and up to 6–8 weeks for the full benefit. Keep taking it as prescribed and review progress with your doctor.",
    sections: [
      {
        heading: "What it is",
        body: "Escitalopram is a selective serotonin reuptake inhibitor (SSRI), taken once a day. It is used for depression, and for some anxiety conditions depending on the product prescribed. Which conditions a particular brand is approved for is set by that brand's own product information, so ask your doctor or pharmacist what yours is being used for.",
      },
      {
        heading: "What to expect",
        body: "It commonly takes 2–4 weeks to notice improvement and up to 6–8 weeks for the full benefit, and this varies between people. Early side effects such as nausea or sleep changes often settle. Sexual difficulties are common and worth raising. Keep taking it as prescribed and review progress with your doctor.",
      },
      {
        heading: "A missed dose",
        body: "If you miss a dose, take it as soon as you remember — unless there are fewer than 12 hours until your next dose, in which case leave the missed dose out and carry on as usual. Never take two doses at once to catch up. This is the rule for escitalopram specifically: do not copy the missed-dose instructions from a different antidepressant.",
      },
      {
        heading: "Safety points to raise",
        body: "Tell your doctor about all your other medicines and supplements, any heart rhythm problem or family history of one, and any plans for pregnancy or breastfeeding. Escitalopram can affect the heart's rhythm and can lower blood sodium, particularly in older people or alongside certain other medicines — whether you need an ECG or blood tests is judged case by case, not routinely for everyone. Get urgent assessment for fainting, a sustained irregular heartbeat, a seizure, marked confusion, or fever with agitation, tremor or muscle stiffness.",
      },
      {
        heading: "Stopping safely",
        body: "Do not stop suddenly. Withdrawal symptoms can follow a reduction or stopping, so your doctor will work out a plan with you and lower the dose gradually if and when you decide to stop.",
      },
    ],
  },
  {
    slug: "bipolar",
    title: "Bipolar disorder",
    category: "Conditions",
    audience: "Patients and supporters",
    readTime: "8 min read",
    reviewedOn: "Sep 2026",
    icon: "swings",
    summary: "Periods of depression and periods of high mood (mania) — how it is recognised and managed.",
    sources: SOURCES.bipolar,
    translatedResources: [
      {
        language: "Multiple languages",
        title: "What is a bipolar mood disorder? (EMBRACE Multicultural Mental Health) — Health Translations Victoria",
        url: "https://www.healthtranslations.vic.gov.au/resources/what-is-a-bipolar-mood-disorder",
      },
    ],
    kind: "condition",
    intro:
      "Bipolar disorder involves distinct episodes of elevated mood and energy — mania or hypomania — usually with periods of depression and more settled periods in between. Bipolar I is defined by a manic episode: depression is common but is not required for the diagnosis. Bipolar II involves hypomanic episodes together with major depressive episodes, and is assessed differently. Only a full clinical assessment can make either diagnosis.",
    signs: [
      "Low periods with the signs of depression",
      "High periods with unusually elevated mood",
      "Reduced need for sleep during highs",
      "Fast thoughts or fast speech",
      "Doing more than usual, or taking risks",
      "Irritability",
      "Difficulty seeing the change in yourself",
    ],
    why: "Because people usually seek help during the low periods, bipolar disorder can be missed or diagnosed late. It helps your clinician to know about any past periods of unusually high, energised or irritable mood, not just the low times. Ordinary ups and downs are not enough on their own — what matters is a clear change from your usual self.",
    helps: [
      {
        icon: "pill",
        title: "Medicines",
        body: "Treatment is episode-specific: mania, bipolar depression and staying well between episodes call for different decisions. Mood stabilisers such as lithium are monitored with blood tests.",
      },
      {
        icon: "chat",
        title: "Talking therapy",
        body: "Therapy and psychoeducation help you recognise early warning signs and act on them.",
      },
      {
        icon: "heart",
        title: "Routine & support",
        body: "Regular sleep, routine and a shared plan with your team help you stay well.",
      },
    ],
    support:
      "A shared plan with your care team helps you spot early warning signs and act early. Some changes need help straight away rather than at the next appointment: going without sleep for days, behaviour that puts you or others at risk, losing touch with reality, or thoughts of suicide. Call 000 or go to an emergency department if there is immediate danger.",
  },
  {
    slug: "lithium-monitoring",
    title: "Lithium blood tests",
    category: "Tests & procedures",
    audience: "Patients taking lithium",
    readTime: "4 min read",
    reviewedOn: "Sep 2026",
    icon: "droplet",
    summary: "Why regular blood tests matter while taking lithium, and how to prepare for them.",
    sources: SOURCES["lithium-monitoring"],
    kind: "procedure",
    why: "Lithium works within a narrow range — too little may not help, and too much can be harmful — so regular blood tests check the level in your body and that your kidneys and thyroid are healthy. The level is never read on its own: your team interprets it alongside how you are feeling, your kidney function, and the dose you have actually been taking.",
    prepare: [
      "Have your blood taken about 12 hours after your last dose, unless your team has agreed a different arrangement with you",
      "Tell the person taking the blood the time of your last dose and the time of the test, so they can be recorded",
      "Bring a list of your current medicines, including anything you buy without a prescription",
      "Tell the team if you have been unwell, vomiting, had diarrhoea, or been dehydrated",
      "Don’t change your dose unless your doctor tells you to",
    ],
    timeline: [
      { t: "Before", d: "Keep to your usual dose and your normal salt and fluid intake." },
      {
        t: "On the day",
        d: "Blood taken about 12 hours after your last dose. Taking lithium at night does not turn the next morning's sample into a full 24-hour one — the 12-hour interval is what the result is read against.",
      },
      {
        t: "After a dose change",
        d: "It usually takes about 5 to 7 days for the level to settle after a change, which is a different thing from the 12-hour gap before a test. If you feel unwell in the meantime, do not wait for either interval to pass.",
      },
      {
        t: "After the test",
        d: "Your team reviews the level alongside kidney function, electrolytes, thyroid and calcium results. How often these are repeated depends on the plan you and your team are following.",
      },
    ],
    warningSigns: {
      heading: "Signs of lithium toxicity — get urgent advice now",
      items: [
        "New or worsening vomiting or diarrhoea",
        "A coarse, shaky tremor",
        "Feeling unsteady on your feet",
        "Slurred speech",
        "Confusion, or feeling much more drowsy than usual",
        "Blurred vision, or muscle twitching or jerking",
        "Do not take the next dose until you have spoken to a clinician or the Poisons Information Centre",
        "Call 000 or go to an emergency department if you are confused, unsteady on your feet, slurring your speech or very drowsy",
        "Otherwise call the Poisons Information Centre on 13 11 26 now, even if you feel only mildly unwell — do not wait for your next blood test",
      ],
    },
    safe: "Keep your fluid and salt intake reasonably steady and avoid sudden changes. Being unwell with vomiting, diarrhoea, fever or dehydration can push your lithium level up — treat that as urgent: call your doctor, pharmacist, or the Poisons Information Centre on 13 11 26, and do not take the next dose until advised. Check with your doctor or pharmacist before starting or changing any medicine, including anti-inflammatories bought over the counter, and medicines for blood pressure or fluid — these can change your lithium level. Tell your doctor if you are pregnant or planning a pregnancy, and never switch to a different lithium product without advice. For a suspected overdose, call the Poisons Information Centre on 13 11 26 straight away even if you feel well, and call 000 for a collapse, a seizure or any immediate danger.",
  },
];

// ---- Draft evidence and governance provenance -------------------------------------------------

/**
 * Why this is a side table rather than fields on `Factsheet`.
 *
 * The sheets are demonstration content. Their evidence state — when the
 * sources were last read, who reviewed the clinical text, what is still
 * held — is *governance* data, not reader-facing content, and it must not be
 * projected into the sheet or the printed take-away. Keeping it beside the
 * content means `Factsheet` keeps its shape (and its ~20 call sites), the
 * renderer cannot accidentally paint a hold as patient guidance, and a field
 * with no honest value stays `null` instead of acquiring a reassuring
 * placeholder.
 *
 * Every date here is a distinct event. `evidenceCheckedOn` is the day a human
 * last opened the cited sources. It is not a publication date, not a publisher
 * review date, and emphatically not clinical approval — `clinicalReviewer`,
 * `approvedOn` and `nextReviewDue` stay `null` until a named clinician signs
 * the content off, which nothing in this repository can do on their behalf.
 */
export type FactsheetHold = {
  /** Claim id from the source-checked review this hold came from. */
  claimId: string;
  /** What cannot safely be stated, in the reviewer's terms. */
  statement: string;
  /** What would resolve it. Never "review again" — a concrete next step. */
  resolution: string;
  /** Role accountable for that step. Not a person: nobody is named unasked. */
  accountableRole: string;
};

export type FactsheetEvidence = {
  /** Governance state of the clinical text. Never `approved` from this file. */
  status: "draft";
  /** Day the cited sources were last opened and read. Not approval. */
  evidenceCheckedOn: string;
  /** Named clinician who signed the content off. `null` until one has. */
  clinicalReviewer: null;
  /** Day of that sign-off. `null` for the same reason. */
  approvedOn: null;
  /** Next review date. Unknowable before a first approval, so `null`. */
  nextReviewDue: null;
  /** Whether the sheet may be published as patient information. */
  publicationAllowed: false;
  /** Claims the review could not clear, kept out of the reader-facing copy. */
  holds: readonly FactsheetHold[];
};

/**
 * The day the source-checked claim review was completed, and the default for a
 * sheet whose sources have not been reopened since.
 *
 * It is a default, not a constant for the library: a sheet whose sources were
 * re-read later carries its own later date. Pinning all eight to one value
 * would have reported false provenance for sertraline, whose Australian
 * indication list was re-verified against the publisher two days afterwards.
 */
export const FACTSHEET_EVIDENCE_CHECKED_ON = "2026-09-14";

const draft = (holds: readonly FactsheetHold[] = [], checkedOn = FACTSHEET_EVIDENCE_CHECKED_ON): FactsheetEvidence => ({
  status: "draft",
  evidenceCheckedOn: checkedOn,
  clinicalReviewer: null,
  approvedOn: null,
  nextReviewDue: null,
  publicationAllowed: false,
  holds,
});

/**
 * Holds recorded against each sheet. A hold is the reason a fact is *absent*
 * from the copy, so it is as much a part of the record as the text that is
 * there — without it the next editor re-adds the same unsupported line.
 *
 * Nothing renders this today, and `printBlocks` never reads it. But the
 * component layer re-exports this module wholesale, so a future admin or
 * editor view could import it without further plumbing: `hold.statement` and
 * `hold.resolution` must never reach a patient-facing surface. They describe
 * the claim that is being withheld, so rendering one publishes it.
 *
 * `tests/factsheets-source-evidence.test.ts` asserts only that a hold's own
 * sentence has not been pasted into a projection. That is a copy-paste guard,
 * not a claim guard: the substantive per-claim assertions live in
 * `tests/factsheets-clinical-safeguards.test.ts`, one describe block per hold.
 */
export const factsheetEvidence: Record<string, FactsheetEvidence> = {
  // Later than the rest: the Australian indication list was re-read from the
  // publisher on 2026-09-16, which confirmed PTSD is not an Australian Zoloft
  // indication.
  sertraline: draft([], "2026-09-16"),
  depression: draft(),
  gad: draft([
    {
      claimId: "ps-clm-factsheets-gad-funding-held",
      statement:
        "Better Access referral and MyMedicare requirements, including exceptions, are not stated here as a rebate or referral rule.",
      resolution:
        "Read the current Australian Government factsheet, including its exceptions, and record its publication date before any funding wording is added.",
      accountableRole: "Content owner",
    },
  ]),
  ssri: draft([
    {
      claimId: "ps-clm-factsheets-ssri-utilisation-held",
      statement:
        "SSRIs are not described as the most commonly prescribed antidepressant class. An antidepressant share of all mental-health prescriptions does not establish the SSRI share of antidepressants.",
      resolution:
        "Obtain a dated Australian dataset using the drug class itself as the denominator, or leave the superlative out.",
      accountableRole: "Content owner",
    },
  ]),
  cbt: draft([
    {
      claimId: "ps-clm-factsheets-cbt-cci-rights",
      statement:
        "CCI worksheets are linked, not reproduced, translated or sent for indexing. The site's copyright notice does not grant those rights.",
      resolution:
        "Resolve reuse rights with CCI separately for access, storage, display, modification, redistribution and AI processing before any full text is held.",
      accountableRole: "Content owner with the source's rights holder",
    },
  ]),
  escitalopram: draft([
    {
      claimId: "ps-clm-factsheets-escitalopram-indications-held",
      statement:
        "The approved-indication list for the Lexapro brand is not stated. The hosted document lists depression and social anxiety in section 4.1 but carries dosing text for other conditions elsewhere, and neither reading may be asserted from that discrepancy.",
      resolution:
        "Obtain the current regulator or sponsor product information and reconcile the two sections before any indication claim is published.",
      accountableRole: "Content owner",
    },
  ]),
  bipolar: draft([
    {
      claimId: "ps-clm-factsheets-bipolar-prevalence-held",
      statement:
        "No prevalence figure is given. The previous '2 in 100' carried no population, diagnostic scope, timeframe or dated source.",
      resolution:
        "Cite a dated Australian prevalence source stating its population and diagnostic scope, or leave the figure out — the patient explanation does not need it.",
      accountableRole: "Content owner",
    },
  ]),
  "lithium-monitoring": draft([
    {
      claimId: "ps-clm-factsheets-lithium-monitoring-targets",
      statement:
        "No target concentration range and no monitoring interval are stated. Both depend on treatment phase, response, age, renal function, formulation and the controlling protocol.",
      resolution: "Adopt the local WA monitoring protocol and cite it, rather than inserting a generic range.",
      accountableRole: "Clinical governance, with the local protocol owner",
    },
  ]),
};

/** Evidence record for a sheet, or `undefined` for an unknown slug. */
export function findFactsheetEvidence(slug: string): FactsheetEvidence | undefined {
  return factsheetEvidence[slug];
}

/** Every open hold across the library, for a governance view or a receipt. */
export function factsheetHolds(): Array<FactsheetHold & { slug: string }> {
  return Object.entries(factsheetEvidence).flatMap(([slug, evidence]) =>
    evidence.holds.map((hold) => ({ ...hold, slug })),
  );
}

const bySlug = new Map(factsheets.map((sheet) => [sheet.slug, sheet]));

/** Curated slugs worth promoting elsewhere (e.g. related-content surfaces); kept in order. */
export const featuredFactsheetSlugs = ["sertraline", "depression", "gad", "ssri", "cbt", "lithium-monitoring"];

const relatedMap: Record<string, string[]> = {
  sertraline: ["depression", "ssri", "escitalopram"],
  depression: ["sertraline", "cbt", "gad"],
  gad: ["cbt", "ssri", "sertraline"],
  ssri: ["sertraline", "escitalopram", "depression"],
  cbt: ["depression", "gad", "ssri"],
  escitalopram: ["sertraline", "ssri", "depression"],
  bipolar: ["lithium-monitoring", "depression", "ssri"],
  "lithium-monitoring": ["bipolar", "ssri", "sertraline"],
};

export function findFactsheet(slug: string): Factsheet | undefined {
  return bySlug.get(slug);
}

export function factsheetSlugs(): string[] {
  return factsheets.map((sheet) => sheet.slug);
}

/** Canonical detail route for a factsheet record. */
export function factsheetDetailHref(slug: string): string {
  return `/factsheets/${slug}`;
}

/** Category-ordered groups for the Topics browse page. */
export function factsheetsGroupedByCategory(): Array<{ category: FactsheetCategory; sheets: Factsheet[] }> {
  return factsheetCategories.map((category) => ({
    category,
    sheets: factsheets.filter((sheet) => sheet.category === category),
  }));
}

/** First N rows shown before the section's "Show all" control. */
export const TOPIC_SECTION_PREVIEW_LIMIT = 8;

/** Stable section / hash id for a topic heading. */
export function topicSectionId(category: string): string {
  return `factsheet-topic-${category.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
}

/** Query value for `?topic=` — the section slug without the `factsheet-topic-` prefix. */
export function factsheetTopicQueryValue(category: FactsheetCategory): string {
  return topicSectionId(category).replace(/^factsheet-topic-/, "");
}

/**
 * Resolve `?topic=` to a known category. Accepts the display name, the section
 * id, or the short slug. Unknown values return undefined so every topic stays
 * closed instead of opening a blank filter.
 */
export function resolveFactsheetTopicParam(value?: string | null): FactsheetCategory | undefined {
  const raw = value?.trim();
  if (!raw) return undefined;
  const exact = factsheetCategories.find((entry) => entry === raw);
  if (exact) return exact;
  const slug = raw.replace(/^factsheet-topic-/i, "").toLowerCase();
  return factsheetCategories.find((entry) => factsheetTopicQueryValue(entry) === slug);
}

/** Rows a topic section should paint before the reader asks to expand it. */
export function visibleTopicSheets<T>(
  sheets: readonly T[],
  expanded: boolean,
  limit = TOPIC_SECTION_PREVIEW_LIMIT,
): T[] {
  if (expanded || sheets.length <= limit) return [...sheets];
  return sheets.slice(0, limit);
}

/** Server-driven filter for the search page: optional query + optional category. */
export function filterFactsheets(query: string, category?: string, expansions: readonly string[] = []): Factsheet[] {
  const q = normalizeSearchText(query);
  const normalizedExpansions = Array.from(
    new Set([...expansions, ...smartSearchContentTerms("factsheets", query)].map(normalizeSearchText).filter(Boolean)),
  );
  const activeCategory = factsheetCategories.find((entry) => entry === category);
  const identityMatches: Factsheet[] = [];
  const directMatches: Factsheet[] = [];
  const expansionOnlyMatches: Array<{ sheet: Factsheet; score: number }> = [];
  for (const sheet of factsheets) {
    if (activeCategory && sheet.category !== activeCategory) continue;
    // Include the brand suffix (e.g. "(Zoloft)") so brand-name searches resolve
    // even though it is stored separately from the title.
    const searchable = normalizeSearchText(
      `${sheet.title} ${sheet.brand ?? ""} ${sheet.summary} ${sheet.category} ${sheet.audience}`,
    );
    // A natural-language query can name a sheet while adding surrounding
    // context. Treat that embedded title or brand as a direct identity match,
    // rather than letting an expansion-only hit (for example, an incidental
    // medicine mentioning "anxiety") appear above the sheet the reader named.
    const identities = [sheet.title, sheet.brand]
      .filter((value): value is string => Boolean(value))
      .map(normalizeSearchText)
      .filter(Boolean);
    const mentionsIdentity = identities.some((identity) => ` ${q} `.includes(` ${identity} `));
    if (q && mentionsIdentity) {
      identityMatches.push(sheet);
    } else if (!q || searchable.includes(q)) {
      directMatches.push(sheet);
    } else {
      const identityText = normalizeSearchText(`${sheet.title} ${sheet.brand ?? ""}`);
      const expansionScore = normalizedExpansions.reduce((score, term) => {
        const specificity = term.includes(" ") ? term.split(" ").length : 1;
        if (includesWholeTerm(identityText, term)) return score + 10 * specificity;
        if (includesWholeTerm(searchable, term)) return score + specificity;
        return score;
      }, 0);
      if (expansionScore > 0) expansionOnlyMatches.push({ sheet, score: expansionScore });
    }
  }
  expansionOnlyMatches.sort((left, right) => right.score - left.score);
  return [...identityMatches, ...directMatches, ...expansionOnlyMatches.map(({ sheet }) => sheet)];
}

export function relatedFactsheets(slug: string): Factsheet[] {
  const ids = relatedMap[slug] ?? ["depression", "gad", "cbt"];
  return ids.map((id) => bySlug.get(id)).filter((sheet): sheet is Factsheet => Boolean(sheet));
}

export function sameTopicFactsheets(slug: string): Factsheet[] {
  const sheet = bySlug.get(slug);
  if (!sheet) return [];
  return factsheets.filter((entry) => entry.category === sheet.category && entry.slug !== sheet.slug);
}

// ---- Print + table-of-contents projections -------------------------------------------------

export type PrintBlock =
  | { kind: "prose"; heading: string; body: string }
  | { kind: "list"; heading: string; items: string[] }
  | { kind: "facts"; heading: string; items: Array<{ k: string; v: string }> }
  | { kind: "sources"; heading: string; items: FactsheetSource[] };

export function printBlocks(sheet: Factsheet, readingLevel: "easy" | "standard" = "standard"): PrintBlock[] {
  const sourcesBlock: PrintBlock = { kind: "sources", heading: "Sources", items: sheet.sources };
  switch (sheet.kind) {
    case "medRich":
      return [
        { kind: "facts", heading: "At a glance", items: sheet.keyFacts },
        {
          kind: "prose",
          heading: "What is this medicine?",
          body: readingLevel === "easy" ? sheet.whatEasy : sheet.whatStandard,
        },
        { kind: "list", heading: "How to take it", items: sheet.howto.map((step) => step.t) },
        { kind: "list", heading: "Common side effects", items: sheet.sideCommon },
        { kind: "list", heading: "Serious — tell your doctor", items: sheet.sideSerious },
        { kind: "prose", heading: "When to get urgent help", body: sheet.urgentHelp },
        sourcesBlock,
      ];
    case "medLite":
      return [
        { kind: "prose", heading: "How long it takes", body: sheet.timing },
        ...sheet.sections.map((section): PrintBlock => ({
          kind: "prose",
          heading: section.heading,
          body: section.body,
        })),
        // Printed before the sources, as on screen. Without it the handout
        // names emergency-grade symptoms and gives the reader nowhere to go.
        { kind: "prose", heading: "When to get urgent help", body: FACTSHEET_MEDLITE_URGENT_HELP },
        sourcesBlock,
      ];
    case "condition":
      return [
        { kind: "prose", heading: "In plain terms", body: sheet.intro },
        { kind: "list", heading: "Signs to look for", items: sheet.signs },
        { kind: "prose", heading: "Why it happens", body: sheet.why },
        { kind: "list", heading: "What helps", items: sheet.helps.map((help) => `${help.title} — ${help.body}`) },
        {
          kind: "prose",
          heading: "Getting support",
          body: `${sheet.support} ${FACTSHEET_CRISIS_LINE}`,
        },
        sourcesBlock,
      ];
    case "therapy":
      return [
        { kind: "prose", heading: "What it is", body: sheet.intro },
        { kind: "list", heading: "How it works", items: sheet.steps.map((step) => `${step.h} — ${step.t}`) },
        { kind: "facts", heading: "What to expect", items: sheet.expect },
        // The screen shows the same support callout as a condition sheet, so the
        // printed handout carries the same crisis line rather than dropping it.
        {
          kind: "prose",
          heading: "Getting support",
          body: `${sheet.support ?? ""} ${FACTSHEET_CRISIS_LINE}`.trim(),
        },
        sourcesBlock,
      ];
    case "procedure":
      return [
        { kind: "prose", heading: "Why it matters", body: sheet.why },
        { kind: "list", heading: "How to prepare", items: sheet.prepare },
        { kind: "list", heading: "Step by step", items: sheet.timeline.map((step) => `${step.t} — ${step.d}`) },
        // Printed above the prose, as on screen: the act-now list is the part
        // of a monitoring handout a reader must be able to find without reading.
        ...(sheet.warningSigns
          ? [{ kind: "list", heading: sheet.warningSigns.heading, items: sheet.warningSigns.items } as PrintBlock]
          : []),
        { kind: "prose", heading: "Staying safe between tests", body: sheet.safe },
        sourcesBlock,
      ];
  }
}

/*
 * `tocFor` used to live here: a hand-maintained switch over `sheet.kind`
 * returning heading *strings*, painted into an inert `<li>` list in the detail
 * page's sidebar. It was wrong in both directions — it named "What is this
 * medicine?" where the page renders "What is <title>?", and never listed the
 * More-in-topic or Related sections the page renders on every sheet — and it
 * could not have been right, because nothing tied a string to a rendered
 * element. The section index is now `factsheetNavSections`
 * (`factsheet-nav-header.tsx`), which returns ids asserted against the rendered
 * DOM by `tests/in-page-nav-route-sections.dom.test.tsx`.
 */
