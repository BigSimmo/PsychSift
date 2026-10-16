// Public entry point for the extractive answer and final quality gate. The implementation lives in
// four layered modules (signals, shape checks, builder, quality gate); this file only re-exports
// what callers and tests already imported from here, so import paths and module mocks are unchanged.

export {
  type OriginalSectionFinalizationContext,
  carryOriginalSectionCandidateProof,
  prepareOriginalSectionCandidateProof,
  enforceOriginalSectionDeliveredCompleteness,
} from "@/lib/rag/rag-original-section-delivery";
export {
  isSourceBoundActiveCommunityEdProcedureQuery,
  isSourceBoundCommunityHomeVisitRequirementsQuery,
  isSourceBoundBestPracticePrescriptionRequirementsQuery,
  bestPracticePrescriptionProgramUseEvidence,
  bestPracticePrescriptionProfileEvidence,
} from "@/lib/rag/rag-source-bound-policy-procedures";
export { labelledNumericBandConflictChunkIds } from "@/lib/answer-verification";
export { classifyAnswerIntent } from "@/lib/rag/rag-answer-intent";
export {
  isExplicitEscalationQuery,
  extractiveAnswerCarriesIntentFigure,
  hasMaximumDoseEvidence,
  splitClinicalEvidenceSentences,
} from "@/lib/rag/rag-extractive-signals";
export {
  finalQualityGapAnswer,
  isLaunderedGuidanceWrapperAnswer,
  retainCitedExtractiveFallbackEvidence,
} from "@/lib/rag/rag-answer-shape-checks";
export {
  admissionComparisonTermPattern,
  dischargeComparisonTermPattern,
  admissionRequirementBindingPatterns,
  dischargeRequirementBindingPatterns,
  toxicityListSentences,
  sentenceFromFact,
  completeExtractiveSentence,
  isAdmissionDischargeRequirementsComparisonQuery,
  isSourceBoundAdmissionDischargeComparisonQuery,
  isSourceBoundClozapineBloodActionThresholdQuery,
  isSourceBoundClozapineBloodActionThresholdAnswer,
  isSourceBoundAdmissionDischargeComparisonAnswer,
  isSourceBoundActiveCommunityEdProcedureAnswer,
  isSourceBoundCommunityHomeVisitRequirementsAnswer,
  isSourceBoundBestPracticePrescriptionRequirementsAnswer,
  sourceBoundComparisonFacts,
  buildAdmissionDischargeComparisonAnswer,
  documentSupportListIntent,
  compactExtractiveCitations,
  buildExtractiveAnswer,
} from "@/lib/rag/rag-extractive-builder";
export {
  sourceBackedGenerationTimeoutAnswer,
  strongReasoningEffortForQueryClass,
  isUnusableGeneratedAnswer,
  isProviderSourceGapGeneratedAnswer,
  hasCitedProviderSourceGap,
  isTemplateLikeGeneratedAnswer,
  isSimpleDirectQuestion,
  isBareDefinitionQuestion,
  isOverExpandedSimpleGeneratedAnswer,
  hasInvalidModelEvidenceIds,
  generatedAnswerQualityFailureReason,
  isBareDocumentSupportListAnswer,
  isSafeExtractiveFallbackCandidate,
  isBareCrossReferenceAnswer,
  cleanAnswerSectionHeading,
  retainVerifiedAnswerParts,
  finalizeRagAnswerQuality,
  rejectAdaptiveAnswerContract,
} from "@/lib/rag/rag-answer-quality-gate";
