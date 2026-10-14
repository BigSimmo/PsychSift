import {
  Activity,
  AlertTriangle,
  Baby,
  CloudRain,
  GlassWater,
  HeartPulse,
  ShieldAlert,
  Wine,
  Zap,
  type LucideIcon,
} from "lucide-react";

export type CalculatorTone = "success" | "info" | "warning" | "danger";

export type CalculatorOption = {
  label: string;
  /** Compact label for segmented controls on narrow screens. */
  short: string;
  points: number;
};

export type CalculatorItem = {
  id: string;
  text: string;
  /** Optional clarifier rendered under the item text. */
  detail?: string;
  /**
   * checkbox items score `points` when ticked and 0 when clear;
   * options items score the selected option.
   */
  kind: "checkbox" | "options";
  points?: number;
  options?: CalculatorOption[];
  /** Safety flag surfaced whenever this item scores above zero. */
  flag?: string;
};

export type ScoreBand = {
  min: number;
  max: number;
  label: string;
  tone: CalculatorTone;
  guidance: string;
};

export type CalculatorDomain = "mood" | "anxiety" | "substance" | "risk" | "distress";

export type CalculatorFixture = {
  id: string;
  abbrev: string;
  name: string;
  domain: CalculatorDomain;
  icon: LucideIcon;
  /** When to reach for this tool. */
  indication: string;
  /** One-line summary for cards and rails. */
  summary: string;
  /** Question stem shown above the items. */
  stem?: string;
  timeEstimate: string;
  minScore: number;
  maxScore: number;
  items: CalculatorItem[];
  bands: ScoreBand[];
  /** How to read the number, shown with the result. */
  scoringNote: string;
  source: string;
  caution?: string;
  disclaimer?: string;
};

export const domainLabels: Record<CalculatorDomain, string> = {
  mood: "Mood",
  anxiety: "Anxiety & OCD",
  substance: "Substance use",
  risk: "Suicide risk",
  distress: "General distress",
};

export const domainIcons: Record<CalculatorDomain, LucideIcon> = {
  mood: CloudRain,
  anxiety: Zap,
  substance: Wine,
  risk: ShieldAlert,
  distress: Activity,
};

const frequency0to3: CalculatorOption[] = [
  { label: "Not at all", short: "0", points: 0 },
  { label: "Several days", short: "1", points: 1 },
  { label: "More than half the days", short: "2", points: 2 },
  { label: "Nearly every day", short: "3", points: 3 },
];

const kessler1to5: CalculatorOption[] = [
  { label: "None of the time", short: "1", points: 1 },
  { label: "A little of the time", short: "2", points: 2 },
  { label: "Some of the time", short: "3", points: 3 },
  { label: "Most of the time", short: "4", points: 4 },
  { label: "All of the time", short: "5", points: 5 },
];

export const calculators: CalculatorFixture[] = [
  {
    id: "phq9",
    abbrev: "PHQ-9",
    name: "Patient Health Questionnaire-9",
    domain: "mood",
    icon: CloudRain,
    indication: "Screen for depression, grade severity, and track response to treatment over time.",
    summary: "9-item depression severity score with treatment-action bands.",
    stem: "Over the last 2 weeks, how often have you been bothered by:",
    timeEstimate: "2–3 min",
    minScore: 0,
    maxScore: 27,
    scoringNote: "Sum of 9 items (0–3 each). Severity bands map to stepped treatment actions.",
    source: "Kroenke, Spitzer & Williams 2001",
    caution: "Any endorsement of item 9 requires direct suicide-risk assessment regardless of total score.",
    items: [
      { id: "p1", kind: "options", options: frequency0to3, text: "Little interest or pleasure in doing things" },
      { id: "p2", kind: "options", options: frequency0to3, text: "Feeling down, depressed, or hopeless" },
      {
        id: "p3",
        kind: "options",
        options: frequency0to3,
        text: "Trouble falling or staying asleep, or sleeping too much",
      },
      { id: "p4", kind: "options", options: frequency0to3, text: "Feeling tired or having little energy" },
      { id: "p5", kind: "options", options: frequency0to3, text: "Poor appetite or overeating" },
      {
        id: "p6",
        kind: "options",
        options: frequency0to3,
        text: "Feeling bad about yourself — or that you are a failure or have let yourself or your family down",
      },
      {
        id: "p7",
        kind: "options",
        options: frequency0to3,
        text: "Trouble concentrating on things, such as reading the newspaper or watching television",
      },
      {
        id: "p8",
        kind: "options",
        options: frequency0to3,
        text: "Moving or speaking so slowly that other people could have noticed? Or the opposite — being so fidgety or restless that you have been moving around a lot more than usual",
      },
      {
        id: "p9",
        kind: "options",
        options: frequency0to3,
        text: "Thoughts that you would be better off dead, or of hurting yourself in some way",
        flag: "Item 9 endorsed — complete a structured suicide-risk assessment now.",
      },
    ],
    bands: [
      {
        min: 0,
        max: 4,
        label: "Minimal",
        tone: "success",
        guidance: "Lower symptom score band; interpret in clinical context.",
      },
      {
        min: 5,
        max: 9,
        label: "Mild",
        tone: "info",
        guidance: "Mild symptom score band; interpret in clinical context.",
      },
      {
        min: 10,
        max: 14,
        label: "Moderate",
        tone: "warning",
        guidance: "Moderate symptom score band; interpret in clinical context.",
      },
      {
        min: 15,
        max: 19,
        label: "Moderately severe",
        tone: "warning",
        guidance: "Moderately severe symptom score band; interpret in clinical context.",
      },
      {
        min: 20,
        max: 27,
        label: "Severe",
        tone: "danger",
        guidance: "Severe symptom score band; interpret in clinical context.",
      },
    ],
  },
  {
    id: "gad7",
    abbrev: "GAD-7",
    name: "Generalised Anxiety Disorder-7",
    domain: "anxiety",
    icon: Zap,
    indication: "Screen for generalised anxiety and grade severity; scores ≥10 warrant further assessment.",
    summary: "7-item anxiety severity score; also performs well for panic and social anxiety.",
    stem: "Over the last 2 weeks, how often have you been bothered by:",
    timeEstimate: "1–2 min",
    minScore: 0,
    maxScore: 21,
    scoringNote: "Sum of 7 items (0–3 each). ≥10 is the usual cut-point for probable GAD.",
    source: "Spitzer et al. 2006",
    items: [
      { id: "g1", kind: "options", options: frequency0to3, text: "Feeling nervous, anxious, or on edge" },
      { id: "g2", kind: "options", options: frequency0to3, text: "Not being able to stop or control worrying" },
      { id: "g3", kind: "options", options: frequency0to3, text: "Worrying too much about different things" },
      { id: "g4", kind: "options", options: frequency0to3, text: "Trouble relaxing" },
      { id: "g5", kind: "options", options: frequency0to3, text: "Being so restless that it is hard to sit still" },
      { id: "g6", kind: "options", options: frequency0to3, text: "Becoming easily annoyed or irritable" },
      { id: "g7", kind: "options", options: frequency0to3, text: "Feeling afraid, as if something awful might happen" },
    ],
    bands: [
      {
        min: 0,
        max: 4,
        label: "Minimal",
        tone: "success",
        guidance: "Lower anxiety symptom score band; interpret in clinical context.",
      },
      {
        min: 5,
        max: 9,
        label: "Mild",
        tone: "info",
        guidance: "Mild anxiety symptom score band; interpret in clinical context.",
      },
      {
        min: 10,
        max: 14,
        label: "Moderate",
        tone: "warning",
        guidance: "Moderate anxiety symptom score band; interpret in clinical context.",
      },
      {
        min: 15,
        max: 21,
        label: "Severe",
        tone: "danger",
        guidance: "Severe anxiety symptom score band; interpret in clinical context.",
      },
    ],
  },
  {
    id: "k10",
    abbrev: "K10",
    name: "Kessler Psychological Distress Scale",
    domain: "distress",
    icon: Activity,
    indication:
      "Measure non-specific psychological distress over the past 4 weeks as a screening and monitoring measure, not a diagnostic instrument.",
    summary: "10-item distress measure scored 10–50, widely used across Australian primary care.",
    stem: "In the past 4 weeks, about how often did you feel:",
    timeEstimate: "2–3 min",
    minScore: 10,
    maxScore: 50,
    scoringNote: "Sum of 10 items (1–5 each); range 10–50. Higher scores indicate greater distress.",
    source: "Kessler et al. 2002 · ABS scoring",
    items: [
      { id: "k1", kind: "options", options: kessler1to5, text: "Tired out for no good reason" },
      { id: "k2", kind: "options", options: kessler1to5, text: "Nervous" },
      { id: "k3", kind: "options", options: kessler1to5, text: "So nervous that nothing could calm you down" },
      { id: "k4", kind: "options", options: kessler1to5, text: "Hopeless" },
      { id: "k5", kind: "options", options: kessler1to5, text: "Restless or fidgety" },
      { id: "k6", kind: "options", options: kessler1to5, text: "So restless you could not sit still" },
      { id: "k7", kind: "options", options: kessler1to5, text: "Depressed" },
      { id: "k8", kind: "options", options: kessler1to5, text: "That everything was an effort" },
      { id: "k9", kind: "options", options: kessler1to5, text: "So sad that nothing could cheer you up" },
      { id: "k10", kind: "options", options: kessler1to5, text: "Worthless" },
    ],
    bands: [
      {
        min: 10,
        max: 15,
        label: "Low",
        tone: "success",
        guidance: "Lower psychological distress score band; interpret in clinical context.",
      },
      {
        min: 16,
        max: 21,
        label: "Moderate",
        tone: "info",
        guidance: "Moderate psychological distress score band; interpret in clinical context.",
      },
      {
        min: 22,
        max: 29,
        label: "High",
        tone: "warning",
        guidance: "High psychological distress score band; interpret in clinical context.",
      },
      {
        min: 30,
        max: 50,
        label: "Very high",
        tone: "danger",
        guidance: "Very high psychological distress score band; interpret in clinical context.",
      },
    ],
  },
  {
    id: "cage",
    abbrev: "CAGE",
    name: "CAGE Questionnaire",
    domain: "substance",
    icon: Wine,
    indication: "Rapid 4-question lifetime screen for problem drinking in adults.",
    summary: "Four yes/no questions; two or more positives is a clinically significant screen.",
    timeEstimate: "under 1 min",
    minScore: 0,
    maxScore: 4,
    scoringNote: "1 point per “yes”. ≥2 is a positive screen; follow with AUDIT and drinking history.",
    source: "Ewing 1984",
    items: [
      { id: "c1", kind: "checkbox", points: 1, text: "Have you ever felt you should Cut down on your drinking?" },
      { id: "c2", kind: "checkbox", points: 1, text: "Have people Annoyed you by criticising your drinking?" },
      { id: "c3", kind: "checkbox", points: 1, text: "Have you ever felt bad or Guilty about your drinking?" },
      {
        id: "c4",
        kind: "checkbox",
        points: 1,
        text: "Have you ever had a drink first thing in the morning (Eye-opener) to steady your nerves or get rid of a hangover?",
      },
    ],
    bands: [
      {
        min: 0,
        max: 1,
        label: "Screen negative",
        tone: "success",
        guidance: "Lower-risk screening score band; interpret in clinical context.",
      },
      {
        min: 2,
        max: 4,
        label: "Clinically significant",
        tone: "danger",
        guidance: "Positive screening score band; interpret in clinical context.",
      },
    ],
  },
  {
    id: "auditc",
    abbrev: "AUDIT-C",
    name: "Alcohol Use Disorders Identification Test — Consumption",
    domain: "substance",
    icon: GlassWater,
    indication: "Brief consumption screen for hazardous drinking — the first three AUDIT items.",
    summary: "3 consumption questions scored 0–4 each, total 0–12, read against a named screening convention.",
    timeEstimate: "1 min",
    minScore: 0,
    maxScore: 12,
    scoringNote:
      "Sum of 3 items (0–4 each), range 0–12. The registered convention is Bradley et al. 2007: 4 or more for men and 3 or more for women, derived in United States primary care. Confirm the convention your service uses.",
    source: "Bush et al. 1998 (derivation, men only) · Bradley et al. 2007 (thresholds)",
    items: [
      {
        id: "a1",
        kind: "options",
        text: "How often do you have a drink containing alcohol?",
        options: [
          { label: "Never", short: "0", points: 0 },
          { label: "Monthly or less", short: "1", points: 1 },
          { label: "2–4 times a month", short: "2", points: 2 },
          { label: "2–3 times a week", short: "3", points: 3 },
          { label: "4+ times a week", short: "4", points: 4 },
        ],
      },
      {
        id: "a2",
        kind: "options",
        text: "How many standard drinks do you have on a typical day when you are drinking?",
        options: [
          { label: "1–2", short: "0", points: 0 },
          { label: "3–4", short: "1", points: 1 },
          { label: "5–6", short: "2", points: 2 },
          { label: "7–9", short: "3", points: 3 },
          { label: "10 or more", short: "4", points: 4 },
        ],
      },
      {
        id: "a3",
        kind: "options",
        text: "How often do you have six or more standard drinks on one occasion?",
        options: [
          { label: "Never", short: "0", points: 0 },
          { label: "Less than monthly", short: "1", points: 1 },
          { label: "Monthly", short: "2", points: 2 },
          { label: "Weekly", short: "3", points: 3 },
          { label: "Daily or almost daily", short: "4", points: 4 },
        ],
      },
    ],
    bands: [
      {
        min: 0,
        max: 2,
        label: "Below both thresholds",
        tone: "success",
        guidance: "Below the registered screening thresholds for men and for women; interpret in clinical context.",
      },
      {
        min: 3,
        max: 3,
        label: "At the threshold for women",
        tone: "warning",
        guidance: "At the registered threshold for women and below it for men; interpret in clinical context.",
      },
      {
        min: 4,
        max: 12,
        label: "At or above both thresholds",
        tone: "danger",
        guidance:
          "At or above the registered screening thresholds for men and for women; interpret in clinical context.",
      },
    ],
  },
];

export const domainOrder: CalculatorDomain[] = ["mood", "anxiety", "substance", "risk", "distress"];

/** Extra directory entries shown as "coming soon" in directory-style mockups. */
export const plannedCalculators: { abbrev: string; name: string; indication: string; icon: LucideIcon }[] = [
  {
    abbrev: "CIWA-Ar",
    name: "Clinical Institute Withdrawal Assessment — Alcohol",
    indication: "Grade alcohol-withdrawal severity and drive symptom-triggered dosing.",
    icon: HeartPulse,
  },
  {
    abbrev: "EPDS",
    name: "Edinburgh Postnatal Depression Scale",
    indication: "Screen for depression in the perinatal period.",
    icon: Baby,
  },
  {
    abbrev: "COWS",
    name: "Clinical Opiate Withdrawal Scale",
    indication: "Grade opioid-withdrawal severity before induction.",
    icon: AlertTriangle,
  },
];
