import {
  Activity,
  AlertTriangle,
  Baby,
  Brain,
  CloudRain,
  GlassWater,
  HeartPulse,
  Repeat2,
  ShieldAlert,
  Wine,
  Zap,
  type LucideIcon,
} from "lucide-react";

import { calculatorEvidence } from "./calculator-evidence";

export { calculatorEvidence };

export type CalculatorTone = "success" | "info" | "warning" | "danger";

type CalculatorOption = {
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
  /** Evidence claim for the safety wording. */
  flagClaimId?: string;
};

export type ScoreBand = {
  min: number;
  max: number;
  label: string;
  tone: CalculatorTone;
  /** Source-linked psychometric interpretation, never management instruction. */
  interpretation: string;
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
  /** Numeric range used by the local completion-time filter. */
  timeEstimateMinutes: { min: number; max: number };
  minScore: number;
  maxScore: number;
  items: CalculatorItem[];
  bands: ScoreBand[];
  /** How to read the number, shown with the result. */
  scoringNote: string;
  source: string;
  caution?: string;
  disclaimer?: string;
  instrumentVersion: string;
  administrationMethod: string;
  intendedPopulation: string;
  timeframe: string;
  completionPolicy: string;
  interpretationPolicy: string;
  sourceIds: string[];
  claimIds: string[];
  /**
   * Reproduction/use rights for the instrument itself, distinct from the review-workflow
   * `rights.status` used elsewhere to gate release. `holder`, `digitalUseAllowed`,
   * `modificationAllowed`, `attributionRequired` and `verifiedAt` are populated only for
   * instruments whose rights position has actually been checked against a public source —
   * see `rightsInfo` below.
   */
  rights: CalculatorRights;
  /**
   * SHA-256 fingerprint (see `computeResponseAnchorFingerprint`-equivalent generation) of
   * this fixture's response anchors — every item's kind plus its option labels and point
   * values, or its checkbox point value, in item order. Pinned by hand at authoring time so
   * an anchor edited without updating this ID goes red in
   * `tests/calculators-governance-hardening.test.ts`, rather than silently drifting.
   */
  responseAnchorSetId: string;
  /**
   * SHA-256 fingerprint of the administered name, stem, item wording, details and safety flags.
   * This is separate from `responseAnchorSetId` so wording and scoring-anchor reviews cannot
   * accidentally stand in for one another.
   */
  wordingSetId: string;
  jurisdiction: string;
  lastReviewed: string;
  nextReview: string;
  reviewer: string;
  confidence: "high" | "moderate" | "low";
  riskLevel: "low" | "moderate" | "high";
  instrumentStatus: "active" | "quarantined";
  evidenceStatus: "verified" | "review_required" | "blocked";
  releaseStatus: "available" | "quarantined";
  limitations: string[];
  unresolvedIssues: string[];
};

/**
 * Reproduction/use rights for an instrument. `status` mirrors the release-gating union used
 * elsewhere (`available` | `permission_review_required` | `unknown`); the remaining fields
 * are populated only once a source stating the position has actually been checked — see
 * `rightsInfo` below and the calculator governance hardening PR notes for what was verified.
 */
export type CalculatorRights = {
  status: "available" | "permission_review_required" | "unknown";
  /** Copyright/rights holder, or "Public domain" plus the originating author when applicable. */
  holder?: string;
  /** Whether the holder's stated policy covers reproducing the instrument in a digital tool. */
  digitalUseAllowed?: boolean;
  /** Whether wording/item changes are permitted — false unless a source explicitly allows it. */
  modificationAllowed?: boolean;
  /** Whether the holder's policy (or ordinary academic practice) requires citing the source. */
  attributionRequired?: boolean;
  /** Date (YYYY-MM-DD) this rights position was last checked against a public source. */
  verifiedAt?: string;
  /** Evidence-registry source that directly states the permission represented here. */
  sourceId?: string;
  /** Human-readable boundary on the permission, including non-commercial restrictions. */
  permissionScope?: string;
};

type RawScoreBand = Omit<ScoreBand, "interpretation"> & { guidance: string };
type RawCalculatorFixture = Omit<
  CalculatorFixture,
  | "bands"
  | "instrumentVersion"
  | "administrationMethod"
  | "intendedPopulation"
  | "timeframe"
  | "completionPolicy"
  | "interpretationPolicy"
  | "sourceIds"
  | "claimIds"
  | "rights"
  | "responseAnchorSetId"
  | "wordingSetId"
  | "jurisdiction"
  | "lastReviewed"
  | "nextReview"
  | "reviewer"
  | "confidence"
  | "riskLevel"
  | "instrumentStatus"
  | "evidenceStatus"
  | "releaseStatus"
  | "limitations"
  | "unresolvedIssues"
> & { bands: RawScoreBand[] };

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

const ybocsSeverity: CalculatorOption[] = [
  { label: "None", short: "0", points: 0 },
  { label: "Mild", short: "1", points: 1 },
  { label: "Moderate", short: "2", points: 2 },
  { label: "Severe", short: "3", points: 3 },
  { label: "Extreme", short: "4", points: 4 },
];

// Items 4 and 9 ask how much effort the patient makes to resist, which is a different question
// from the perceived control asked by items 5 and 10, so they carry their own anchors.
const ybocsResistance: CalculatorOption[] = [
  { label: "Always resists", short: "0", points: 0 },
  { label: "Resists most of the time", short: "1", points: 1 },
  { label: "Some effort to resist", short: "2", points: 2 },
  { label: "Yields, with some reluctance", short: "3", points: 3 },
  { label: "Completely yields", short: "4", points: 4 },
];

const ybocsControl: CalculatorOption[] = [
  { label: "Complete control", short: "0", points: 0 },
  { label: "Much control", short: "1", points: 1 },
  { label: "Moderate control", short: "2", points: 2 },
  { label: "Little control", short: "3", points: 3 },
  { label: "No control", short: "4", points: 4 },
];

const calculatorFixtures: RawCalculatorFixture[] = [
  {
    id: "phq9",
    abbrev: "PHQ-9",
    name: "Patient Health Questionnaire-9",
    domain: "mood",
    icon: CloudRain,
    indication: "Screen for depression, grade severity, and track response to treatment over time.",
    summary: "9-item depression assessment and monitoring measure.",
    stem: "Over the last 2 weeks, how often have you been bothered by:",
    timeEstimate: "2–3 min",
    timeEstimateMinutes: { min: 2, max: 3 },
    minScore: 0,
    maxScore: 27,
    scoringNote:
      "Sum of 9 items (0–3 each); interpret a completed result with the instrument source and clinical context.",
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
        flag: "Item 9 endorsed — directly assess suicidal thoughts, self-harm thoughts and immediate safety now.",
        flagClaimId: "claim:phq9:safety-flag",
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
    timeEstimateMinutes: { min: 1, max: 2 },
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
    timeEstimateMinutes: { min: 2, max: 3 },
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
    id: "mdq",
    abbrev: "MDQ",
    name: "Mood Disorder Questionnaire",
    domain: "mood",
    icon: Repeat2,
    indication: "Screen for lifetime bipolar-spectrum disorder before starting or reviewing antidepressant treatment.",
    summary: "13 lifetime hypomanic symptoms plus co-occurrence and impairment criteria.",
    stem: "Has there ever been a period of time when you were not your usual self and you…",
    timeEstimate: "3–4 min",
    timeEstimateMinutes: { min: 3, max: 4 },
    minScore: 0,
    maxScore: 13,
    scoringNote:
      "Positive screen requires ≥7 symptoms, symptoms clustering in the same period, and moderate-or-serious impairment.",
    source: "Hirschfeld et al. 2000",
    caution: "A positive screen is not a diagnosis — confirm with a structured bipolar-disorder assessment.",
    items: [
      {
        id: "m1",
        kind: "checkbox",
        points: 1,
        text: "…felt so good or hyper that other people thought you were not your normal self, or you got into trouble",
      },
      {
        id: "m2",
        kind: "checkbox",
        points: 1,
        text: "…were so irritable that you shouted at people or started fights",
      },
      { id: "m3", kind: "checkbox", points: 1, text: "…felt much more self-confident than usual" },
      {
        id: "m4",
        kind: "checkbox",
        points: 1,
        text: "…got much less sleep than usual and found you didn't really miss it",
      },
      { id: "m5", kind: "checkbox", points: 1, text: "…were much more talkative or spoke much faster than usual" },
      {
        id: "m6",
        kind: "checkbox",
        points: 1,
        text: "…had thoughts racing through your head that you couldn't slow down",
      },
      {
        id: "m7",
        kind: "checkbox",
        points: 1,
        text: "…were so easily distracted that you had trouble concentrating or staying on track",
      },
      { id: "m8", kind: "checkbox", points: 1, text: "…had much more energy than usual" },
      { id: "m9", kind: "checkbox", points: 1, text: "…were much more active or did many more things than usual" },
      {
        id: "m10",
        kind: "checkbox",
        points: 1,
        text: "…were much more social or outgoing — for example, telephoning friends in the middle of the night",
      },
      { id: "m11", kind: "checkbox", points: 1, text: "…were much more interested in sex than usual" },
      {
        id: "m12",
        kind: "checkbox",
        points: 1,
        text: "…did things that were unusual for you or that other people might have thought excessive, foolish, or risky",
      },
      {
        id: "m13",
        kind: "checkbox",
        points: 1,
        text: "…found that spending money got you or your family into trouble",
      },
      {
        id: "mco",
        kind: "checkbox",
        points: 0,
        text: "Several of these ever happened during the same period of time",
        detail: "Criterion 2 — co-occurrence. Does not add to the symptom count.",
      },
      {
        id: "mimp",
        kind: "options",
        text: "How much of a problem did any of these cause you?",
        detail: "Criterion 3 — impairment. Moderate or serious is required for a positive screen.",
        options: [
          { label: "No problem", short: "None", points: 0 },
          { label: "Minor problem", short: "Minor", points: 0 },
          { label: "Moderate problem", short: "Mod", points: 0 },
          { label: "Serious problem", short: "Serious", points: 0 },
        ],
      },
    ],
    bands: [
      {
        min: 0,
        max: 6,
        label: "Below symptom threshold",
        tone: "success",
        guidance: "Symptom-count screen result; interpret with all required criteria and clinical context.",
      },
      {
        min: 7,
        max: 13,
        label: "Symptom threshold met",
        tone: "warning",
        guidance: "Symptom-count screen result; interpret with all required criteria and clinical context.",
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
    timeEstimateMinutes: { min: 0, max: 1 },
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
    timeEstimateMinutes: { min: 1, max: 1 },
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
  {
    id: "sadpersons",
    abbrev: "SAD PERSONS",
    name: "SAD PERSONS Scale",
    domain: "risk",
    icon: ShieldAlert,
    indication: "Structure a rapid inventory of static suicide-risk factors as an adjunct to clinical assessment.",
    summary: "10 yes/no risk factors, one point each; supports — never replaces — clinical judgement.",
    timeEstimate: "1–2 min",
    timeEstimateMinutes: { min: 1, max: 2 },
    minScore: 0,
    maxScore: 10,
    scoringNote: "1 point per factor present. Bands are indicative only; act on clinical concern at any score.",
    source: "Patterson et al. 1983",
    caution:
      "Risk scales have poor predictive value. Evidence-based guidelines (including NICE, RANZCP, and Cochrane reviews) strongly recommend against using SAD PERSONS to predict suicide risk or determine admission; comprehensive clinical assessment and personalised safety planning are required.",
    items: [
      { id: "s1", kind: "checkbox", points: 1, text: "Sex — male" },
      { id: "s2", kind: "checkbox", points: 1, text: "Age — under 19 or over 45" },
      { id: "s3", kind: "checkbox", points: 1, text: "Depression — current low mood or diagnosed depressive episode" },
      { id: "s4", kind: "checkbox", points: 1, text: "Previous suicide attempt or psychiatric care" },
      { id: "s5", kind: "checkbox", points: 1, text: "Excess alcohol or substance use" },
      { id: "s6", kind: "checkbox", points: 1, text: "Rational thinking loss — psychosis or organic impairment" },
      { id: "s7", kind: "checkbox", points: 1, text: "Separated, widowed, or divorced" },
      {
        id: "s8",
        kind: "checkbox",
        points: 1,
        text: "Organised or serious attempt / plan",
        flag: "Organised plan endorsed — escalate to a full structured risk assessment now.",
      },
      { id: "s9", kind: "checkbox", points: 1, text: "No social supports" },
      { id: "s10", kind: "checkbox", points: 1, text: "Stated future intent to repeat or ambivalence about survival" },
    ],
    bands: [
      {
        min: 0,
        max: 4,
        label: "Lower indicative risk",
        tone: "info",
        guidance: "Lower score band; this instrument is not available for score-based decision support.",
      },
      {
        min: 5,
        max: 6,
        label: "Intermediate",
        tone: "warning",
        guidance: "Intermediate score band; this instrument is not available for score-based decision support.",
      },
      {
        min: 7,
        max: 10,
        label: "Higher indicative risk",
        tone: "danger",
        guidance: "Higher score band; this instrument is not available for score-based decision support.",
      },
    ],
  },
  {
    id: "ybocs",
    abbrev: "Y-BOCS",
    name: "Yale-Brown Obsessive Compulsive Scale — Severity",
    domain: "anxiety",
    icon: Brain,
    indication: "Grade the severity of obsessive-compulsive symptoms and track treatment response.",
    summary: "10 severity items (0–4) across obsessions and compulsions; total 0–40.",
    timeEstimate: "5–8 min",
    timeEstimateMinutes: { min: 5, max: 8 },
    minScore: 0,
    maxScore: 40,
    scoringNote: "Sum of 10 items. Items 1–5 grade obsessions, 6–10 compulsions; subscales can be reported separately.",
    source: "Goodman et al. 1989",
    items: [
      { id: "y1", kind: "options", options: ybocsSeverity, text: "Time occupied by obsessive thoughts" },
      { id: "y2", kind: "options", options: ybocsSeverity, text: "Interference from obsessive thoughts" },
      { id: "y3", kind: "options", options: ybocsSeverity, text: "Distress associated with obsessive thoughts" },
      {
        id: "y4",
        kind: "options",
        options: ybocsResistance,
        text: "Resistance against obsessions",
        detail: "0 = always resists",
      },
      { id: "y5", kind: "options", options: ybocsControl, text: "Degree of control over obsessive thoughts" },
      { id: "y6", kind: "options", options: ybocsSeverity, text: "Time spent performing compulsive behaviours" },
      { id: "y7", kind: "options", options: ybocsSeverity, text: "Interference from compulsive behaviours" },
      { id: "y8", kind: "options", options: ybocsSeverity, text: "Distress if compulsions are prevented" },
      {
        id: "y9",
        kind: "options",
        options: ybocsResistance,
        text: "Resistance against compulsions",
        detail: "0 = always resists",
      },
      { id: "y10", kind: "options", options: ybocsControl, text: "Degree of control over compulsive behaviour" },
    ],
    bands: [
      {
        min: 0,
        max: 7,
        label: "Subclinical",
        tone: "success",
        guidance: "Subclinical score band; interpret in clinical context.",
      },
      { min: 8, max: 15, label: "Mild", tone: "info", guidance: "Mild score band; interpret in clinical context." },
      {
        min: 16,
        max: 23,
        label: "Moderate",
        tone: "warning",
        guidance: "Moderate score band; interpret in clinical context.",
      },
      {
        min: 24,
        max: 31,
        label: "Severe",
        tone: "danger",
        guidance: "Severe score band; interpret in clinical context.",
      },
      {
        min: 32,
        max: 40,
        label: "Extreme",
        tone: "danger",
        guidance: "Extreme score band; interpret in clinical context.",
      },
    ],
  },
];

const activeCalculatorIds = new Set(["phq9", "gad7", "k10", "cage", "auditc"]);

/**
 * SHA-256 response-anchor fingerprints, pinned by hand from each fixture's current items
 * (kind, options label+points, or checkbox point value, in item order). Regenerate a value
 * here — do not hand-edit the hex — whenever the corresponding fixture's items change; the
 * governance test recomputes the fingerprint from the live items and fails on any mismatch.
 */
const responseAnchorSetIds: Record<string, string> = {
  phq9: "rax-b9f706a1a226d782",
  gad7: "rax-761ef68846c9a4d2",
  k10: "rax-f16ed6eed3763e0d",
  mdq: "rax-22ff4ff2e31ba1b2",
  cage: "rax-a9efad27e70f3351",
  auditc: "rax-2542f10c0cd037e1",
  sadpersons: "rax-d3e9691eb7b40e58",
  ybocs: "rax-f6b6411d03a7e8a8",
};

/**
 * Independently pinned wording fingerprints. The governance test recomputes each value from the
 * instrument name, stem, item text, item detail and safety-flag wording. Response options remain
 * pinned separately by `responseAnchorSetIds`.
 */
const wordingSetIds: Record<string, string> = {
  phq9: "wrx-2901a1fda5d43a82",
  gad7: "wrx-a40cb4434a309c68",
  k10: "wrx-beff4c4323324b73",
  mdq: "wrx-7cb67e4100d0172a",
  cage: "wrx-682d12e6df5ac388",
  auditc: "wrx-fe367617c29c4429",
  sadpersons: "wrx-2d468bed49cc9495",
  ybocs: "wrx-be0333b17ced1d1b",
};

/**
 * Rights positions checked against the reviewed source identified by each record's `sourceId`.
 * Every value below reflects what that source documents as of the `verifiedAt` date:
 *
 * - PHQ-9 / GAD-7: the official Pfizer instrument sheets state "No permission required to
 *   reproduce, translate, display or distribute" for clinical, educational and research use.
 * - K10: Ronald C. Kessler permits use without formal approval, while retaining copyright and
 *   requiring citation and copyright acknowledgement.
 * - CAGE: Dr John Ewing's permission statement allows clinical and research use but requires a
 *   negotiated payment for a profit-making endeavour.
 * - AUDIT-C: the first three items of WHO AUDIT; the reviewed AUDIT rights statement permits
 *   non-commercial use without material change and requires WHO acknowledgement.
 *
 * `modificationAllowed` is conservatively `false` for every instrument here: none of the
 * above sources grants permission to alter item wording or scoring, and altering a validated
 * instrument's wording invalidates its psychometrics regardless of the rights position.
 */
const rightsInfo: Record<string, CalculatorRights> = {
  phq9: {
    status: "available",
    holder: "Pfizer Inc.",
    digitalUseAllowed: true,
    modificationAllowed: false,
    attributionRequired: true,
    verifiedAt: "2026-09-04",
    sourceId: "source:rights:phq-gad7",
    permissionScope: "Unrestricted access and reproduction under Pfizer's published statement.",
  },
  gad7: {
    status: "available",
    holder: "Pfizer Inc.",
    digitalUseAllowed: true,
    modificationAllowed: false,
    attributionRequired: true,
    verifiedAt: "2026-09-04",
    sourceId: "source:rights:phq-gad7",
    permissionScope: "Unrestricted access and reproduction under Pfizer's published statement.",
  },
  k10: {
    status: "available",
    holder: "Ronald C. Kessler, PhD",
    digitalUseAllowed: true,
    modificationAllowed: false,
    attributionRequired: true,
    verifiedAt: "2026-09-04",
    sourceId: "source:rights:k10",
    permissionScope: "Free use without formal approval; citation and copyright acknowledgement required.",
  },
  cage: {
    status: "available",
    holder: "John A. Ewing / Bowles Center for Alcohol Studies",
    digitalUseAllowed: true,
    modificationAllowed: false,
    attributionRequired: true,
    verifiedAt: "2026-09-04",
    sourceId: "source:rights:cage",
    permissionScope: "Clinical and research use; profit-making use requires negotiated permission.",
  },
  auditc: {
    status: "available",
    holder: "World Health Organization (WHO) — derived from the AUDIT instrument",
    digitalUseAllowed: true,
    modificationAllowed: false,
    attributionRequired: true,
    verifiedAt: "2026-09-04",
    sourceId: "source:rights:audit",
    permissionScope: "Non-commercial use without material change; identify it as a WHO-approved instrument.",
  },
  mdq: { status: "permission_review_required" },
  sadpersons: { status: "unknown" },
  ybocs: { status: "unknown" },
};

/**
 * AUDIT-C is the one instrument whose evidence does not reduce to a single `source:<id>` record.
 * Its screening-performance evidence (`source:auditc:validation`), its sex-specific threshold
 * convention (`source:auditc:thresholds`) and the Australian standard-drink context assumed by
 * its item wording (`source:auditc`) are three different sources supporting three different
 * claims, and collapsing them onto one id is what let a standard-drinks guide stand as the sole
 * support for a screening cut-point.
 */
const extraSourceIds: Record<string, string[]> = {
  auditc: ["source:auditc:validation", "source:auditc:thresholds", "source:auditc"],
};

const extraClaimIds: Record<string, string[]> = {
  phq9: ["claim:phq9:safety-flag"],
  auditc: ["claim:auditc:thresholds", "claim:auditc:units"],
};

function sourceIdsFor(id: string) {
  return [...(extraSourceIds[id] ?? [`source:${id}`]), "source:governance"];
}

function claimIdsFor(id: string) {
  return [`claim:${id}:interpretation`, ...(extraClaimIds[id] ?? [])];
}

function metadataFor(id: string): Omit<CalculatorFixture, keyof RawCalculatorFixture | "bands"> {
  const active = activeCalculatorIds.has(id);

  return {
    instrumentVersion: `${id.toUpperCase()} catalogue fixture v1`,
    administrationMethod: "Clinician-entered responses in a browser-session calculator.",
    intendedPopulation: "Adults unless the linked instrument source specifies otherwise.",
    timeframe:
      id === "k10" ? "Past 4 weeks" : id === "cage" || id === "mdq" ? "Lifetime" : "As stated by the instrument.",
    completionPolicy: "Every item requires an explicit response before a final result is shown.",
    interpretationPolicy:
      "Interpretation describes the completed instrument result only and does not determine management.",
    sourceIds: sourceIdsFor(id),
    claimIds: claimIdsFor(id),
    rights: rightsInfo[id] ?? { status: "unknown" },
    responseAnchorSetId: responseAnchorSetIds[id] ?? "",
    wordingSetId: wordingSetIds[id] ?? "",
    jurisdiction:
      id === "k10" || id === "auditc" ? "Australia" : "International instrument with Australian use context",
    lastReviewed: "2026-09-01",
    nextReview: "2027-09-01",
    reviewer: "Clinical safety governance",
    confidence: active ? "moderate" : "low",
    riskLevel: active ? "moderate" : "high",
    instrumentStatus: active ? "active" : "quarantined",
    evidenceStatus: active ? "verified" : id === "mdq" ? "review_required" : "blocked",
    releaseStatus: active ? "available" : "quarantined",
    limitations: [
      "A score supports assessment and monitoring but does not establish a diagnosis or management decision.",
    ],
    unresolvedIssues: active ? [] : ["Not released for active clinical decision support pending governance review."],
  };
}

/**
 * AUDIT-C carries no single universal cut-point. The registered convention is Bradley et al.
 * 2007 (`source:auditc:thresholds`): 4 or more for men, 3 or more for women, derived in United
 * States primary care. A total of 3 is therefore positive for women and negative for men, which
 * is why the band interpretation names the convention rather than asserting one threshold. The
 * Australian standard-drinks guide (`source:auditc`) supports the drink-size context behind item
 * wording only, never the cut-point — see `claim:auditc:units`.
 */
function interpretationFor(id: string, label: string) {
  if (id === "k10") return `${label} psychological-distress range; it is not a diagnostic category.`;
  if (id === "auditc")
    return `${label} on the registered AUDIT-C convention (4 or more for men, 3 or more for women). A completed score screens reported consumption and does not establish a diagnosis. Interpret with Australian standard-drink context, drinking history and the convention your service uses.`;
  return `${label} completed-score range; interpret with the instrument source, clinical context and limitations.`;
}

export const allCalculatorFixtures: CalculatorFixture[] = calculatorFixtures.map((fixture) => {
  const { bands, ...base } = fixture;

  return {
    ...base,
    ...metadataFor(fixture.id),
    summary: `${fixture.abbrev} assessment and monitoring measure with interpretation after complete responses.`,
    scoringNote: "Final interpretation is available only after every item is explicitly answered.",
    bands: bands.map((band) => ({
      min: band.min,
      max: band.max,
      label: band.label,
      tone: band.tone,
      interpretation: interpretationFor(fixture.id, band.label),
    })),
  };
});

export const calculators = allCalculatorFixtures.filter(
  (fixture) =>
    fixture.instrumentStatus === "active" &&
    fixture.rights.status === "available" &&
    fixture.evidenceStatus === "verified" &&
    fixture.releaseStatus === "available",
);

export const quarantinedCalculators = allCalculatorFixtures.filter(
  (fixture) => fixture.instrumentStatus === "quarantined",
);

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
