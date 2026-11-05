import { type ClinicalAskContextField, type ClinicalAskModeId, isClinicalAskModeId } from "./contracts";

export { isClinicalAskModeId };

export type ClinicalAskModeProfile = {
  id: ClinicalAskModeId;
  label: string;
  sectionOrder: readonly string[];
  acceptedContextFields: readonly ClinicalAskContextField[];
  materialClarificationFields: readonly ClinicalAskContextField[];
  catalogueDomains: readonly string[];
  allowedAuthorityIds: readonly string[];
  handoffModes: readonly ClinicalAskModeId[];
  prohibitedOutcomes: readonly string[];
};
const commonContext = ["ageGroup", "careSetting", "jurisdiction", "presentationFeatures"] as const;
const profile = (
  id: ClinicalAskModeId,
  label: string,
  sectionOrder: string[],
  materialClarificationFields: ClinicalAskContextField[],
  catalogueDomains: string[],
  allowedAuthorityIds: string[],
  handoffModes: ClinicalAskModeId[],
  prohibitedOutcomes: string[],
): ClinicalAskModeProfile => ({
  id,
  label,
  sectionOrder,
  acceptedContextFields: [...new Set([...commonContext, ...materialClarificationFields])],
  materialClarificationFields,
  catalogueDomains,
  allowedAuthorityIds,
  handoffModes,
  prohibitedOutcomes,
});

export const clinicalAskModeProfiles = {
  services: profile(
    "services",
    "Services",
    ["potential_matches", "fit_reasons", "eligibility", "access_pathway", "missing_information"],
    ["serviceLocation", "population", "pathwayStage", "referralPurpose"],
    ["services"],
    ["official-service-directories"],
    ["forms"],
    ["allocation", "referral acceptance", "eligibility determination", "unsupported availability"],
  ),
  forms: profile(
    "forms",
    "Forms",
    ["potential_forms", "jurisdiction_stage", "purpose", "prerequisites", "responsibility", "submission_pathway"],
    ["jurisdiction", "clinicalLegalStage", "formPurpose", "responsibleRole"],
    ["forms"],
    ["official-form-publishers"],
    ["services"],
    ["legal determination", "automatic completion", "signature", "submission"],
  ),
  differentials: profile(
    "differentials",
    "Differentials",
    [
      "candidate_possibilities",
      "supporting_clues",
      "contradicting_clues",
      "discriminators",
      "must_not_miss",
      "missing_assessment",
    ],
    ["presentationFeatures", "duration", "careSetting"],
    ["differentials"],
    ["clinical-guideline-publishers"],
    ["dsm", "formulation"],
    ["final diagnosis", "patient-specific probability", "automatic disposition"],
  ),
  formulation: profile(
    "formulation",
    "Formulation",
    [
      "mechanism_hypotheses",
      "predisposing",
      "precipitating",
      "perpetuating",
      "protective",
      "evidence_against",
      "questions_to_test",
    ],
    ["presentationFeatures", "course", "careSetting"],
    ["formulation"],
    ["clinical-guideline-publishers"],
    ["differentials", "therapy-compass"],
    ["hypothesis as fact", "invented history", "treatment directive"],
  ),
  dsm: profile(
    "dsm",
    "DSM-5 Diagnosis",
    ["candidate_mapping", "apparently_supported", "duration", "impairment", "exclusions", "differential_gaps"],
    ["workingDiagnosis", "duration", "impairment", "exclusions"],
    ["dsm"],
    ["diagnostic-authorities"],
    ["specifiers", "differentials"],
    ["definitive diagnosis", "inferred criterion", "autonomous coding"],
  ),
  specifiers: profile(
    "specifiers",
    "Specifiers",
    [
      "potential_specifiers",
      "base_diagnosis_applicability",
      "features_for",
      "features_against",
      "missing_criteria",
      "incompatibilities",
    ],
    ["workingDiagnosis", "course", "impairment", "presentationFeatures"],
    ["specifiers"],
    ["diagnostic-authorities"],
    ["dsm"],
    ["confirmed specifier", "establishing diagnosis", "psychotherapy guidance"],
  ),
  "therapy-compass": profile(
    "therapy-compass",
    "Therapy",
    ["potential_options", "rationale", "population_setting_fit", "cautions", "practical_requirements", "alternatives"],
    ["therapyGoals", "population", "careSetting", "cautions", "priorResponse"],
    ["therapies"],
    ["therapy-guideline-publishers"],
    ["formulation"],
    ["automatic treatment plan", "patient-specific recommendation", "unsupported efficacy comparison"],
  ),
} as const satisfies Record<ClinicalAskModeId, ClinicalAskModeProfile>;

export function clinicalAskModeProfile(mode: ClinicalAskModeId): ClinicalAskModeProfile {
  return clinicalAskModeProfiles[mode];
}

/** Public headings come from the trusted section vocabulary, never model prose. */
export function clinicalAskSectionTitle(mode: ClinicalAskModeId, sectionId: string): string {
  if (!clinicalAskModeProfile(mode).sectionOrder.includes(sectionId)) return "Evidence";
  const label = sectionId.replaceAll("_", " ");
  return label.charAt(0).toUpperCase() + label.slice(1);
}
