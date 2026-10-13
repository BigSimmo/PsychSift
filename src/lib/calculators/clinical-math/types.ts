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
  sex: BiologicalSex;
  serumCreatinine: number;
  creatinineUnit: CreatinineUnit;
};

export type CockcroftGaultResult = {
  isValid: boolean;
  crClMlMin: number | null;
  stage: RenalStage | null;
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

export type LithiumLevelStatus = "subtherapeutic" | "therapeutic" | "supratherapeutic" | "toxic";

export type LithiumToxicitySeverity = "none" | "mild" | "moderate" | "severe_dialysis_threshold";

export type LithiumLevelInput = {
  serumLevelMmolL: number;
  indication: LithiumIndication;
  age: number;
};

export type LithiumLevelEvaluation = {
  status: LithiumLevelStatus;
  isWithinTarget: boolean;
  severity: LithiumToxicitySeverity;
  targetRange: { min: number; max: number };
  clinicalGuidance: string[];
};

export type LithiumDoseAdjustmentInput = {
  currentDoseMg: number;
  currentLevelMmolL: number;
  targetLevelMmolL: number;
};

export type LithiumDoseAdjustmentResult = {
  isValid: boolean;
  suggestedDoseMg: number | null;
  errors: string[];
  note: string;
};
