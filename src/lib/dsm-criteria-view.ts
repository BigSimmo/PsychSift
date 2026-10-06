/**
 * Lightweight, zero-data leaf module for DSM criteria viewing and specifier splitting.
 *
 * Extracted from dsm.ts to allow client components (such as dsm-note.ts and note builders)
 * to compute criteria views and note texts without pulling in the massive dsm-clinical-content.json
 * dictionary dataset into client bundles.
 */

export type DsmLabeledText = {
  label: string;
  text: string;
};

export type DsmSpecifier = {
  name: string;
  description: string | null;
};

export type DsmCategory = {
  key: string;
  label: string;
  diagnosis_count: number;
};

export type DsmDiagnosis = {
  record_id: string;
  slug: string;
  category: Pick<DsmCategory, "key" | "label">;
  icd_code: string;
  title: string;
  key_features: DsmLabeledText[];
  criteria_display: DsmLabeledText[];
  clinical_checkpoints: DsmLabeledText[];
  specifiers: DsmSpecifier[];
  differentials: string[];
  differential_notes: Array<Record<string, unknown>>;
  classification_notes: Array<Record<string, unknown>>;
  documentation_template: string;
  severity_specifier_supported: boolean;
};

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
 * Returns structured criteria rows or key-feature summary fallback with provenance.
 */
export function dsmCriteriaView(diagnosis: Pick<DsmDiagnosis, "criteria_display" | "key_features">): DsmCriteriaView {
  if (diagnosis.criteria_display.length > 0) {
    return { rows: diagnosis.criteria_display, provenance: "dsm_criteria", isDsmCriteria: true };
  }
  if (diagnosis.key_features.length > 0) {
    return { rows: diagnosis.key_features, provenance: "key_features_summary", isDsmCriteria: false };
  }
  return { rows: [], provenance: "none", isDsmCriteria: false };
}

/**
 * A specifier row that states the disorder has no specifiers.
 */
export function isDsmAbsentSpecifierNote(specifier: DsmSpecifier) {
  return /^no\b/i.test(specifier.name.trim()) && /specifier/i.test(specifier.name);
}

export type DsmSpecifierSplit = {
  /** Rows that name an actual specifier. This length is the count to display. */
  specifiers: DsmSpecifier[];
  /** Rows stating the disorder has none. Rendered as prose, never counted. */
  absentNotes: DsmSpecifier[];
};

/**
 * Splits specifiers into true specifiers and absence notes.
 */
export function dsmSpecifierSplit(diagnosis: Pick<DsmDiagnosis, "specifiers">): DsmSpecifierSplit {
  const specifiers: DsmSpecifier[] = [];
  const absentNotes: DsmSpecifier[] = [];
  for (const specifier of diagnosis.specifiers) {
    (isDsmAbsentSpecifierNote(specifier) ? absentNotes : specifiers).push(specifier);
  }
  return { specifiers, absentNotes };
}
