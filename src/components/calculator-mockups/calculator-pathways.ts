import type { CalculatorFixture } from "./calculator-fixtures";
import type { DerivedCalculator } from "./calculator-ui";

/**
 * Score-driven pathway content for the search/detail mockup: which knowledge-base
 * content to surface at the current severity band.
 *
 * Band-driven action lists were removed here on clinical-safety grounds, mirroring
 * PR #2491 in the production tree. The mockup must not carry directive prescribing,
 * ECT or admission copy that production has already judged unsafe to give, so the
 * band panel now shows the band's descriptive interpretation sentence only.
 * `tests/calculator-mockup-clinical-safety.test.ts` holds both trees to that.
 *
 * Mockup fixtures only — production would resolve `related` through the live
 * retrieval index instead of hand-authored hrefs.
 */

export type PathwayAction = {
  label: string;
  detail?: string;
};

export type RelatedKind = "guideline" | "medication" | "differential" | "service" | "form" | "answer" | "calculator";

export type RelatedItem = {
  title: string;
  kind: RelatedKind;
  /** Route within the app; ignored for kind "calculator". */
  href?: string;
  /** For kind "calculator": switch to this scale in place. */
  calcId?: string;
  note?: string;
  /** Only show once the current band index reaches this value (0-based). */
  minBandIndex?: number;
};

export const relatedKindLabels: Record<RelatedKind, string> = {
  guideline: "Guideline",
  medication: "Medication",
  differential: "Differential",
  service: "Service",
  form: "Form",
  answer: "Ask",
  calculator: "Calculator",
};

type CalculatorPathway = {
  related: RelatedItem[];
};

const pathways: Record<string, CalculatorPathway> = {
  phq9: {
    related: [
      {
        title: "Major depression — stepped treatment pathway",
        kind: "guideline",
        href: "/documents/search?q=major+depression+treatment+pathway",
      },
      {
        title: "Sertraline — initiation and monitoring",
        kind: "medication",
        href: "/medications/sertraline",
        minBandIndex: 2,
      },
      { title: "Low mood — differential diagnoses", kind: "differential", href: "/differentials" },
      { title: "Mental health treatment plan", kind: "guideline", href: "/documents?q=stepped+care", minBandIndex: 1 },
      {
        title: "Acute mental health team referral",
        kind: "service",
        href: "/services",
        minBandIndex: 3,
      },
      {
        title: "ECT consent requirements",
        kind: "answer",
        href: "/?mode=answer&q=ECT+consent+requirements",
        minBandIndex: 4,
      },
    ],
  },
  gad7: {
    related: [
      {
        title: "Generalised anxiety — management pathway",
        kind: "guideline",
        href: "/documents/search?q=generalised+anxiety+management",
      },
      {
        title: "Escitalopram — dosing and cautions",
        kind: "medication",
        href: "/medications/escitalopram",
        minBandIndex: 2,
      },
      { title: "Anxiety — differential diagnoses", kind: "differential", href: "/differentials" },
      {
        title: "Benzodiazepine deprescribing",
        kind: "answer",
        href: "/?mode=answer&q=benzodiazepine+deprescribing",
        minBandIndex: 3,
      },
      { title: "PHQ-9 — depression co-screen", kind: "calculator", calcId: "phq9", minBandIndex: 2 },
    ],
  },
  k10: {
    related: [
      { title: "Mental health treatment plan", kind: "guideline", href: "/documents?q=stepped+care", minBandIndex: 2 },
      {
        title: "Psychological distress — stepped care",
        kind: "guideline",
        href: "/documents/search?q=stepped+care+psychological+distress",
      },
      { title: "PHQ-9 — depression severity", kind: "calculator", calcId: "phq9", minBandIndex: 2 },
      { title: "GAD-7 — anxiety severity", kind: "calculator", calcId: "gad7", minBandIndex: 2 },
    ],
  },
  cage: {
    related: [
      { title: "AUDIT-C — consumption screen", kind: "calculator", calcId: "auditc" },
      {
        title: "Alcohol withdrawal management",
        kind: "guideline",
        href: "/documents/search?q=alcohol+withdrawal+management",
        minBandIndex: 1,
      },
      { title: "Thiamine — Wernicke prophylaxis", kind: "medication", href: "/medications/thiamine", minBandIndex: 1 },
      { title: "Drug and alcohol service referral", kind: "service", href: "/services", minBandIndex: 1 },
    ],
  },
  auditc: {
    related: [
      {
        title: "Alcohol — brief intervention guide",
        kind: "guideline",
        href: "/documents/search?q=alcohol+brief+intervention",
      },
      { title: "CAGE — dependence signal check", kind: "calculator", calcId: "cage" },
      { title: "Drug and alcohol service referral", kind: "service", href: "/services", minBandIndex: 2 },
      {
        title: "Safe drinking limits",
        kind: "answer",
        href: "/?mode=answer&q=safe+drinking+limits+australia",
      },
    ],
  },
};

/** Actions for the current band — falls back to the band's guidance sentence. */
export function actionsForBand(calc: CalculatorFixture, derived: DerivedCalculator): PathwayAction[] {
  const bandIndex = derived.band ? calc.bands.indexOf(derived.band) : -1;
  if (bandIndex < 0) return [];
  return derived.result.guidance ? [{ label: derived.result.guidance }] : [];
}

/** Related knowledge-base content visible at the current band. */
export function relatedForBand(calc: CalculatorFixture, derived: DerivedCalculator): RelatedItem[] {
  const bandIndex = derived.band ? calc.bands.indexOf(derived.band) : 0;
  return (pathways[calc.id]?.related ?? []).filter((item) => (item.minBandIndex ?? 0) <= bandIndex);
}
