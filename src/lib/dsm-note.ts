import {
  dsmCriteriaView,
  dsmSpecifierSplit,
  type DsmDiagnosis,
  type DsmLabeledText,
  type DsmSpecifier,
} from "@/lib/dsm-criteria-view";
import { plainClinicalText } from "@/lib/plain-clinical-text";

export { plainClinicalText };

/**
 * Note text generation for the DSM diagnosis page's note builder.
 *
 * This module is deliberately pure and free of React so the wording — the part
 * that ends up pasted into a progress note — is unit-testable without rendering.
 *
 * Why it exists: the page previously rendered `documentation_template`, one
 * fixed paragraph per record that asserts EVERY criterion as met and enumerates
 * every symptom the disorder can present with. Copying it documents findings
 * that may never have been elicited. Everything here is built from what the
 * clinician actually ticked, and an unassessed criterion is stated as such
 * rather than silently omitted.
 */

export type DsmCriterionStatus = "met" | "not-met" | "not-assessed";

export type DsmNoteCriterion = {
  label: string;
  text: string;
  status: DsmCriterionStatus;
};

export type DsmNoteInput = {
  title: string;
  icdCode: string;
  /**
   * Whether `criteria` really are DSM-5-TR criteria rows, or the record's
   * key-feature summary standing in for them. It decides every heading and the
   * closing basis line, because the note is pasted into a patient's record and
   * must not assert a diagnostic standard the record never supplied.
   */
  isDsmCriteria: boolean;
  criteria: DsmNoteCriterion[];
  /** Ticked specifier names, verbatim from the record. */
  specifiers: string[];
  /** Free-text specifiers the clinician typed, comma separated. */
  specifierText: string;
  /** Differentials the clinician ticked as considered and excluded. */
  excludedDifferentials: string[];
  /** When false the criteria blocks list labels only, for a shorter note. */
  includeCriterionText: boolean;
};

/**
 * The specifier rows that are safe to offer as a tick box.
 *
 * 17 of the 315 specifier names in the export are slash menus rather than single
 * values, and they do not share one shape: "Mild / Moderate / Severe" is three
 * values, "Severity (Mild / Moderate / Severe)" wraps them in a parenthesis,
 * "Cannabis use disorder - Mild / Moderate / Severe" carries a prefix, "Mild /
 * Major neurocognitive disorder" carries a shared SUFFIX, and "With absent
 * insight / delusional beliefs" is a single DSM specifier that happens to
 * contain a slash. Every splitting rule tried against the real corpus produced
 * wrong text for at least six of them ("Severity (Mild", "Cannabis use disorder
 * - Mild", a bare "Mild"), and wrong text here is pasted into a record.
 *
 * So no menu is parsed. Menu rows stay visible in the specifiers panel as
 * reference and the clinician types the value into the free-text field, which is
 * the only option that cannot state something the record does not say.
 */
export function dsmSelectableSpecifiers(specifiers: DsmSpecifier[]): DsmSpecifier[] {
  return specifiers.filter((specifier) => !specifier.name.includes(" / "));
}

/**
 * A criterion line opens a sentence, so it has to read like one.
 *
 * 216 criteria in the export begin with a threshold sign, and spelling that out
 * leaves the line starting mid-word: "B. at least 1 attack followed by...".
 * Only the first character is touched, so an accented or bracketed opening is
 * left exactly as the record has it.
 */
function sentenceCase(value: string) {
  return value.charAt(0).toLocaleUpperCase("en-AU") + value.slice(1);
}

function criteriaWithStatus(criteria: DsmNoteCriterion[], status: DsmCriterionStatus) {
  return criteria.filter((criterion) => criterion.status === status);
}

function criteriaBlock(heading: string, criteria: DsmNoteCriterion[], includeText: boolean) {
  const labels = criteria.map((criterion) => criterion.label).join(", ");
  if (!includeText) return `${heading} (${labels}).`;
  const lines = criteria.map((criterion) => `${criterion.label}. ${sentenceCase(plainClinicalText(criterion.text))}`);
  return [`${heading} (${labels}):`, ...lines].join("\n");
}

/**
 * The pasteable note. Returns an empty string when nothing has been recorded,
 * so the surface can prompt rather than offer an empty skeleton to copy.
 */
export function buildDsmDiagnosisNote(input: DsmNoteInput): string {
  const met = criteriaWithStatus(input.criteria, "met");
  const notMet = criteriaWithStatus(input.criteria, "not-met");
  const notAssessed = criteriaWithStatus(input.criteria, "not-assessed");
  const specifiers = [...input.specifiers, ...input.specifierText.split(",")]
    .map((value) => plainClinicalText(value))
    .filter(Boolean);
  const excluded = input.excludedDifferentials.map(plainClinicalText).filter(Boolean);

  if (met.length === 0 && notMet.length === 0 && specifiers.length === 0 && excluded.length === 0) return "";

  const headingParts = [`${plainClinicalText(input.title)} (${input.icdCode})`, ...specifiers];
  const blocks: string[] = [headingParts.join(", ")];

  // 145 of the 146 records supply no criteria, so on almost every diagnosis these
  // rows are the key-feature summary. Saying "Criteria met" over them put a claim
  // about the diagnostic standard into a clinical record that the record did not
  // support. The wording follows the provenance instead.
  const metHeading = input.isDsmCriteria ? "Criteria met" : "Key features present";
  const notMetHeading = input.isDsmCriteria ? "Criteria not met" : "Key features absent";
  if (met.length > 0) blocks.push(criteriaBlock(metHeading, met, input.includeCriterionText));
  if (notMet.length > 0) blocks.push(criteriaBlock(notMetHeading, notMet, input.includeCriterionText));
  // Always full text: the point of this block is that the reader can see exactly
  // what remains open, which a bare letter does not convey.
  if (notAssessed.length > 0) blocks.push(criteriaBlock("Not assessed", notAssessed, true));
  if (excluded.length > 0) blocks.push(`Differentials considered and excluded: ${excluded.join(", ")}.`);

  blocks.push(
    input.isDsmCriteria
      ? "Recorded against DSM-5-TR criteria. Confirm against the full assessment."
      : "Recorded against a key feature summary, not the full DSM-5-TR criteria. Confirm against DSM-5-TR and the full assessment before relying on this diagnosis.",
  );
  return blocks.join("\n\n");
}

/**
 * Exactly what the note builder needs, and nothing else.
 *
 * The builder is a Client Component, so every field of whatever it is handed is
 * serialised into the RSC payload and shipped to the browser. Passing the whole
 * `DsmDiagnosis` sent `documentation_template` with it — 538 to 1323 characters
 * per record of the very prose this change exists to stop people pasting, dead
 * weight in the payload of all 146 diagnosis pages. `src/lib/dsm.ts` records the
 * same trap for the category export, where spreading the raw row would have
 * shipped `css_class` and a raw hex to the browser.
 *
 * Projecting on the server keeps the wire shape honest to what the UI reads.
 */
export type DsmNoteBuilderRecord = {
  title: string;
  icdCode: string;
  /** False when `criteria` are the record's key-feature summary. See DsmNoteInput. */
  isDsmCriteria: boolean;
  criteria: DsmLabeledText[];
  /** Already filtered to the rows that are safe to offer as a tick box. */
  specifiers: DsmSpecifier[];
  differentials: string[];
};

export function dsmNoteBuilderRecord(diagnosis: DsmDiagnosis): DsmNoteBuilderRecord {
  const view = dsmCriteriaView(diagnosis);
  return {
    title: diagnosis.title,
    icdCode: diagnosis.icd_code,
    isDsmCriteria: view.isDsmCriteria,
    criteria: view.rows.map(({ label, text }) => ({ label, text })),
    specifiers: dsmSelectableSpecifiers(dsmSpecifierSplit(diagnosis).specifiers).map(({ name, description }) => ({
      name,
      description,
    })),
    differentials: diagnosis.differentials,
  };
}
