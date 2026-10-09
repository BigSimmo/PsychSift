import type { DsmDiagnosis, DsmLabeledText, DsmSpecifier } from "@/lib/dsm-types";

export type DsmCriteriaProvenance =
  /** The record supplies structured DSM-5-TR criteria rows. */
  | "dsm_criteria"
  /** No criteria were supplied. The rows are the record's key-feature summary. */
  | "key_features_summary"
  /** The record supplies neither. No record in the current export is in this state. */
  | "none";

export type DsmCriteriaView = {
  /** The rows to render. Never empty for a record that carries either field. */
  rows: DsmLabeledText[];
  provenance: DsmCriteriaProvenance;
  /** True only when `rows` really are DSM-5-TR criteria. Gate every label on this. */
  isDsmCriteria: boolean;
};

/**
 * What a record actually supplies, and what it may therefore be called.
 *
 * 145 of the 146 records in `src/data/dsm-clinical-content.json` ship an empty
 * `criteria_display`; only Bipolar II carries structured criteria. The old
 * `dsmCriteria()` collapsed that distinction — `criteria_display.length > 0 ?
 * criteria_display : key_features` — and every caller then labelled the result
 * as criteria. So 145 diagnosis pages headed a key-feature summary "Core
 * diagnostic criteria / All criteria are shown", the compare table read it out
 * under "Core threshold", and the note builder emitted "Criteria met (A, B, C)"
 * followed by "Recorded against DSM-5-TR criteria" into text meant for a
 * patient's record.
 *
 * The summary is worth showing and is not removed here. What changes is that a
 * caller can no longer state a diagnostic-standard basis it does not have: the
 * provenance travels with the rows, and the label is chosen from it.
 *
 * An empty `criteria_display` means the supplied record omitted the criteria,
 * NOT that DSM-5-TR defines none — which is why the fallback is named a summary
 * rather than reported as zero criteria to the reader.
 *
 * `tests/dsm-criteria-provenance.test.ts` holds this.
 */
export function dsmCriteriaView(diagnosis: DsmDiagnosis): DsmCriteriaView {
  if (diagnosis.criteria_display.length > 0) {
    return { rows: diagnosis.criteria_display, provenance: "dsm_criteria", isDsmCriteria: true };
  }
  if (diagnosis.key_features.length > 0) {
    return { rows: diagnosis.key_features, provenance: "key_features_summary", isDsmCriteria: false };
  }
  return { rows: [], provenance: "none", isDsmCriteria: false };
}

/**
 * A specifier row that is really a statement that the disorder HAS no
 * specifiers, e.g. "No DSM-5-TR specifiers for this disorder".
 *
 * Ten records carry one of these, and on all ten it is the ONLY row in
 * `specifiers` — the upstream export uses the array as a slot for the sentence
 * rather than leaving it empty. Counting it made every one of those records
 * report "1 specifier" in the at-a-glance strip and the record summary when the
 * true answer is none, which is a factual error about the diagnostic standard
 * and not a rendering nicety.
 *
 * The rows are still worth rendering: six of the ten carry a real description
 * (ARFID's sensory/fear-of-consequences/low-interest subtypes, pica's context
 * examples), so `dsmSpecifierSplit` separates them rather than dropping them.
 */
function isDsmAbsentSpecifierNote(specifier: DsmSpecifier) {
  return /^no\b/i.test(specifier.name.trim()) && /specifier/i.test(specifier.name);
}

export type DsmSpecifierSplit = {
  /** Rows that name an actual specifier. This length is the count to display. */
  specifiers: DsmSpecifier[];
  /** Rows stating the disorder has none. Rendered as prose, never counted. */
  absentNotes: DsmSpecifier[];
};

export function dsmSpecifierSplit(diagnosis: DsmDiagnosis): DsmSpecifierSplit {
  const specifiers: DsmSpecifier[] = [];
  const absentNotes: DsmSpecifier[] = [];
  for (const specifier of diagnosis.specifiers) {
    (isDsmAbsentSpecifierNote(specifier) ? absentNotes : specifiers).push(specifier);
  }
  return { specifiers, absentNotes };
}
