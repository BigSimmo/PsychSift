export type BiologicalSex = "male" | "female";

export type CreatinineUnit = "umol/L" | "mg/dL";

export type RenalStage =
  | "normal" // >= 90 mL/min
  | "mild_impairment" // 60 - 89 mL/min
  | "moderate_impairment" // 30 - 59 mL/min
  | "severe_impairment" // 15 - 29 mL/min
  | "kidney_failure"; // < 15 mL/min

export type CockcroftGaultInput = {
  age: number;
  weightKg: number;
  heightCm?: number;
  sex: BiologicalSex;
  serumCreatinine: number;
  creatinineUnit: CreatinineUnit;
};

export type CockcroftGaultResult = {
  isValid: boolean;
  crClMlMin: number | null;
  stage: RenalStage | null;
  ibwKg?: number | null;
  effectiveWeightKg?: number | null;
  weightBasis?: "actual" | "ideal";
  lithiumClinicalNote?: string;
  errors: string[];
  warnings: string[];
};

export type CkdEpiInput = {
  age: number;
  sex: BiologicalSex;
  serumCreatinine: number;
  creatinineUnit: CreatinineUnit;
};

export type CkdEpiResult = {
  isValid: boolean;
  egfr: number | null;
  stage: RenalStage | null;
  errors: string[];
  warnings: string[];
};

export type QtcRiskCategory = "normal" | "borderline" | "prolonged" | "critical_torsades_risk";

export type QtcInput = {
  qtMs: number;
  heartRateBpm?: number;
  rrIntervalSeconds?: number;
  sex: BiologicalSex;
};

export type QtcResult = {
  isValid: boolean;
  bazettMs: number | null;
  fridericiaMs: number | null;
  framinghamMs: number | null;
  hodgesMs: number | null;
  riskCategory: QtcRiskCategory | null;
  alerts: string[];
  errors: string[];
};

export type LithiumIndication = "maintenance" | "acute_mania";

export type LithiumLevelStatus = "invalid" | "subtherapeutic" | "therapeutic" | "supratherapeutic" | "toxic";

export type LithiumToxicitySeverity = "none" | "mild" | "moderate" | "severe";

export type LithiumLevelInput = {
  serumLevelMmolL: number;
  indication: LithiumIndication;
  age: number;
};

export type LithiumLevelEvaluation = {
  status: LithiumLevelStatus;
  isWithinTarget: boolean;
  severity: LithiumToxicitySeverity;
  toxicitySeverity?: LithiumToxicitySeverity;
  requiresUrgentAction?: boolean;
  targetRange: { min: number; max: number };
  clinicalGuidance: string[];
};

export type LithiumDoseAdjustmentInput = {
  currentDoseMg: number;
  currentLevelMmolL: number;
  targetLevelMmolL: number;
  tabletIncrementMg?: 125 | 225 | 250 | 450;
};

export type LithiumDoseAdjustmentResult = {
  isValid: boolean;
  suggestedDoseMg: number | null;
  rawDoseMg?: number | null;
  warnings?: string[];
  errors: string[];
  note: string;
};
