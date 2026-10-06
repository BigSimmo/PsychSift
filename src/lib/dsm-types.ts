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
