#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { validateOfflineContractTests } from "./rag-offline-contract.mjs";

const goldenPath = "scripts/fixtures/rag-retrieval-golden.json";
const cases = JSON.parse(readFileSync(goldenPath, "utf8"));
const failures = [];
const fail = (message) => failures.push(message);
const hasText = (value) => typeof value === "string" && value.trim().length > 0;
const requiredProgrammeFailureClasses = [
  "direct_evidence_generic_refusal",
  "trusted_admin_activation",
  "ordinary_user_upload_denial",
  "private_staging_exclusion",
  "broad_partial_gap",
  "uploaded_australian_augmentation",
  "site_specifier_current",
  "site_differential_current",
  "site_medication_current",
  "cross_domain_site_coverage",
  "uploaded_primary_over_site_summary",
  "site_product_primary",
  "changed_deleted_site_record",
  "stale_manifest_cache_mismatch",
  "uploaded_public_conflict",
  "public_release_auth_parity",
  "site_admin_only_mutation",
  "source_role_mismatch",
  "site_sync_unavailable",
  "australian_augmentation_unavailable",
  "healthdirect_exclusion",
  "etg_amh_link_only",
  "prohibited_upload_pre_provider",
  "narrow_answer_conciseness",
  "broad_answer_completeness",
  "broad_management_route",
  "structured_output_truncation",
  "anaphoric_follow_up",
  "incremental_reconciliation",
];
const programmeEnums = {
  expectedCorpusScopes: new Set([
    "uploaded_local",
    "clinical_kb_site",
    "australian_public",
    "international_supplementary",
  ]),
  expectedSourceRoles: new Set([
    "local_guideline",
    "clinical_guideline",
    "clinical_reference",
    "service_directory",
    "form_reference",
    "tool_reference",
    "safety_alert",
    "regulatory",
    "quality_standard",
    "legal",
    "subsidy",
    "professional_review",
    "service_policy",
    "reference_link",
  ]),
  expectedSiteDomains: new Set([
    "services",
    "forms",
    "medications",
    "differentials",
    "specifiers",
    "dsm",
    "formulation",
    "therapies",
    "dictionary",
    "factsheets",
    "calculators",
    "tools",
  ]),
  expectedSubquestionPurposes: new Set([
    "primary",
    "comparison_side",
    "required_action",
    "monitoring",
    "risk",
    "special_population",
  ]),
  allowedAnswerShapes: new Set(["narrow", "focused", "comprehensive", "comparison", "partial"]),
  forbiddenFallbackReasons: new Set([
    "not_in_corpus",
    "retrieval_miss",
    "insufficient_claim_support",
    "source_role_mismatch",
    "source_conflict",
    "governance_block",
    "site_content_updating",
    "site_content_stale",
    "site_content_unavailable",
    "timeout",
    "provider_failure",
  ]),
};
const publicSiteStates = new Set(["current", "updating", "stale", "unavailable", "disabled", "not_applicable"]);
const conflictFields = new Set([
  "source_identity",
  "publication_or_effective_date",
  "jurisdiction",
  "source_role",
  "material_difference",
  "local_primary_decision",
  "review_flag",
]);
const incrementalEligibility = new Set(["none", "lead", "independent_sections"]);
const casePrivacyClassifications = new Set(["synthetic_non_patient", "deidentified_failure_reproduction"]);

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function fingerprint(value) {
  return `sha256:${createHash("sha256").update(stableJson(value)).digest("hex")}`;
}

function isEnumArray(value, allowed, allowEmpty = true) {
  return Array.isArray(value) && (allowEmpty || value.length > 0) && value.every((item) => allowed.has(item));
}

function isStringArray(value, allowEmpty = true) {
  return Array.isArray(value) && (allowEmpty || value.length > 0) && value.every(hasText);
}

function validateTerm(term, caseId, fieldName) {
  if (Array.isArray(term)) {
    if (term.length === 0 || !term.every(hasText))
      fail(`${caseId}: ${fieldName} contains an empty alternative term group.`);
    return;
  }
  if (!hasText(term)) fail(`${caseId}: ${fieldName} contains an empty term.`);
}

if (!Array.isArray(cases) || cases.length < 10) {
  fail(`${goldenPath} must contain the offline retrieval contract cases.`);
} else {
  const ids = new Set();
  for (const item of cases) {
    if (!hasText(item.id)) fail("Golden retrieval case is missing id.");
    if (ids.has(item.id)) fail(`${item.id}: duplicate golden retrieval case id.`);
    ids.add(item.id);
    if (!hasText(item.query)) fail(`${item.id}: query is required.`);
    if (!hasText(item.expectedQueryClass)) fail(`${item.id}: expectedQueryClass is required.`);
    if (!Number.isInteger(item.topK) || item.topK < 1 || item.topK > 50) fail(`${item.id}: topK must be 1-50.`);
    if (!Array.isArray(item.expectedDocumentSubstrings)) {
      fail(`${item.id}: expectedDocumentSubstrings must be an array.`);
    } else {
      for (const term of item.expectedDocumentSubstrings) validateTerm(term, item.id, "expectedDocumentSubstrings");
    }
    if (!Array.isArray(item.expectedContentTerms) || item.expectedContentTerms.length === 0) {
      fail(`${item.id}: expectedContentTerms must include at least one required term.`);
    } else {
      for (const term of item.expectedContentTerms) validateTerm(term, item.id, "expectedContentTerms");
    }
    if (typeof item.expectTableEvidence !== "boolean") fail(`${item.id}: expectTableEvidence must be boolean.`);
  }
}

const contractTestsPath = "scripts/fixtures/rag-offline-contract-tests.json";
const contractTests = JSON.parse(readFileSync(contractTestsPath, "utf8"));
failures.push(...validateOfflineContractTests(contractTests));

const programmePath = "scripts/fixtures/rag-programme-failures.v1.json";
const programmeFixture = JSON.parse(readFileSync(programmePath, "utf8"));
if (
  programmeFixture?.version !== 1 ||
  programmeFixture?.fixtureId !== "rag-programme-failures-v1" ||
  !Array.isArray(programmeFixture?.cases)
) {
  fail(`${programmePath} must be the versioned rag-programme-failures-v1 contract.`);
} else {
  const privacyReview = programmeFixture.privacyReview;
  if (
    privacyReview?.reviewed !== true ||
    !hasText(privacyReview?.reviewDate) ||
    privacyReview?.classification !== "synthetic_and_deidentified" ||
    !Object.hasOwn(privacyReview ?? {}, "containsPatientData") ||
    privacyReview?.containsPatientData !== false ||
    !Object.hasOwn(privacyReview ?? {}, "containsProductionTraceData") ||
    privacyReview?.containsProductionTraceData !== false ||
    !Object.hasOwn(privacyReview ?? {}, "containsProviderOutput") ||
    privacyReview?.containsProviderOutput !== false ||
    !Object.hasOwn(privacyReview ?? {}, "containsProtectedReferenceContent") ||
    privacyReview?.containsProtectedReferenceContent !== false ||
    !Object.hasOwn(privacyReview ?? {}, "containsUserOrAdministratorIdentifiers") ||
    privacyReview?.containsUserOrAdministratorIdentifiers !== false
  ) {
    fail(
      `${programmePath}: the fixture privacy boundary must be explicitly reviewed and all protected-data flags false.`,
    );
  }

  const declaredClasses = programmeFixture.requiredFailureClasses;
  const declaredSet = new Set(Array.isArray(declaredClasses) ? declaredClasses : []);
  const requiredSet = new Set(requiredProgrammeFailureClasses);
  if (
    !Array.isArray(declaredClasses) ||
    declaredClasses.length !== requiredSet.size ||
    declaredSet.size !== requiredSet.size ||
    requiredProgrammeFailureClasses.some((item) => !declaredSet.has(item)) ||
    [...declaredSet].some((item) => !requiredSet.has(item))
  ) {
    fail(`${programmePath}: requiredFailureClasses must exactly match the programme contract.`);
  }

  const ids = new Set();
  const coveredClasses = new Set();
  for (const [index, item] of programmeFixture.cases.entries()) {
    const caseId = hasText(item?.id) ? item.id : `programme case ${index}`;
    if (!hasText(item?.id)) fail(`${caseId}: id is required.`);
    if (ids.has(item?.id)) fail(`${caseId}: duplicate programme case id.`);
    ids.add(item?.id);
    if (!hasText(item?.question)) fail(`${caseId}: question is required.`);
    if (
      item?.privacyReview?.reviewed !== true ||
      !casePrivacyClassifications.has(item?.privacyReview?.classification) ||
      !Object.hasOwn(item?.privacyReview ?? {}, "containsPatientText") ||
      item?.privacyReview?.containsPatientText !== false
    ) {
      fail(`${caseId}: privacy review must be complete and declare containsPatientText=false.`);
    }
    if (!Array.isArray(item?.protectedFailureClasses) || item.protectedFailureClasses.length === 0) {
      fail(`${caseId}: protectedFailureClasses must name at least one class.`);
    } else {
      for (const failureClass of item.protectedFailureClasses) {
        coveredClasses.add(failureClass);
        if (!requiredSet.has(failureClass)) fail(`${caseId}: unknown protected failure class ${failureClass}.`);
      }
    }
    if (!Array.isArray(item?.expectedDocumentIds) || !item.expectedDocumentIds.every(hasText)) {
      fail(`${caseId}: expectedDocumentIds must be an array of stable synthetic identifiers.`);
    }
    const expectation = item?.expectation;
    if (!expectation || typeof expectation !== "object") {
      fail(`${caseId}: expectation is required.`);
      continue;
    }
    for (const [field, allowed] of Object.entries(programmeEnums)) {
      if (!isEnumArray(expectation[field], allowed, field !== "allowedAnswerShapes")) {
        fail(`${caseId}: ${field} contains an invalid value.`);
      }
    }
    if (!publicSiteStates.has(expectation.expectedPublicSiteContentState)) {
      fail(`${caseId}: expectedPublicSiteContentState is invalid.`);
    }
    if (!Number.isInteger(expectation.minimumDirectSubquestions) || expectation.minimumDirectSubquestions < 0) {
      fail(`${caseId}: minimumDirectSubquestions must be a non-negative integer.`);
    }
    if (typeof expectation.requireSupportedPart !== "boolean" || typeof expectation.requireExactGap !== "boolean") {
      fail(`${caseId}: supported-part and exact-gap flags must be boolean.`);
    }
    if (!isStringArray(expectation.requiredFacts, false)) {
      fail(`${caseId}: requiredFacts must contain explicit facts.`);
    }
    if (!isStringArray(expectation.forbiddenPatterns)) {
      fail(`${caseId}: forbiddenPatterns must contain only non-empty strings.`);
    }
    if (!incrementalEligibility.has(expectation.incrementalEligibility)) {
      fail(`${caseId}: incrementalEligibility is invalid.`);
    }
    if (expectation.expectedConflict !== null) {
      const conflict = expectation.expectedConflict;
      if (
        !conflict ||
        typeof conflict !== "object" ||
        !hasText(conflict.localDocumentId) ||
        !hasText(conflict.australianDocumentId) ||
        !isEnumArray(conflict.requireVisibleFields, conflictFields, false)
      ) {
        fail(`${caseId}: expectedConflict is malformed.`);
      }
    }
  }

  for (const failureClass of requiredProgrammeFailureClasses) {
    if (!coveredClasses.has(failureClass))
      fail(`${programmePath}: protected failure class ${failureClass} is uncovered.`);
  }

  const { caseSetFingerprint, ...fingerprintInput } = programmeFixture;
  fingerprintInput.cases = programmeFixture.cases.map(({ caseFingerprint: _caseFingerprint, ...item }) => item);
  const expectedFingerprint = fingerprint(fingerprintInput);
  if (caseSetFingerprint !== expectedFingerprint) {
    fail(`${programmePath}: case-set fingerprint mismatch; expected ${expectedFingerprint}.`);
  }
}

if (failures.length > 0) {
  console.error("Offline RAG fixture and manifest validation failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(
  `Offline RAG fixture and manifest validation passed (${cases.length} golden cases, ${contractTests.length} suites, ${programmeFixture.cases.length} programme cases; ${programmeFixture.caseSetFingerprint}).`,
);
