import type { ClinicalAskEvidence, ClinicalAskRequest, SourceReviewState } from "@/lib/clinical-ask/contracts";
import { loadDifferentialSnapshot } from "@/lib/differential-fixtures";
import { deriveGovernanceFromSnapshot } from "@/lib/differential-records";
import { searchDifferentialRecords, searchPresentationWorkflows } from "@/lib/differentials";
import { diagnosisOwnSummary } from "@/lib/differential-snapshot";
import { dsmCatalogueProvenance, dsmDiagnosisSummary, rankDsmDiagnoses } from "@/lib/dsm";
import { searchFormulationMechanisms } from "@/lib/formulation";
import { searchFormRecords } from "@/lib/forms";
import { searchServiceRecords } from "@/lib/services";
import { searchSpecifiers } from "@/lib/specifiers";
import { isSpecifierClinicianReviewed, specifierCatalogItems } from "@/lib/specifiers-content";
import { therapyRecordHref } from "@/lib/therapy-compass-navigation";
import { therapySourceMetadata } from "@/lib/therapy-source-governance";
import { searchTherapyRecords } from "@/lib/therapies";

const RESULT_LIMIT = 12;
const EXTRACT_LIMIT = 2_000;

// A question that matches nothing yields an empty tier. Never substitute the
// whole catalogue: the orchestrator's evidence-gap path must fire before any
// provider call rather than synthesise over unrelated records (audit L16).

function abortIfRequested(signal: AbortSignal) {
  if (!signal.aborted) return;
  const error = new Error("The catalogue request was aborted.");
  error.name = "AbortError";
  throw error;
}

function text(parts: Array<string | null | undefined>) {
  const extract = parts
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(" ");
  return extract.slice(0, EXTRACT_LIMIT);
}

function evidence(
  request: ClinicalAskRequest,
  slug: string,
  fields: Pick<ClinicalAskEvidence, "title" | "publisher" | "href" | "extract" | "reviewState"> &
    Partial<Pick<ClinicalAskEvidence, "jurisdiction" | "publishedAt" | "updatedAt">>,
): ClinicalAskEvidence {
  return {
    id: `catalogue:${request.mode}:${slug}`,
    tier: "catalogue",
    jurisdiction: fields.jurisdiction ?? null,
    publishedAt: fields.publishedAt ?? null,
    updatedAt: fields.updatedAt ?? null,
    retrievedAt: null,
    ...fields,
  };
}

function serviceReviewState(status: string | null | undefined): SourceReviewState {
  if (!status) return "unknown";
  const normalized = status.toLowerCase();
  if (normalized.includes("verified") || normalized.includes("reviewed")) return "reviewed";
  if (normalized.includes("review") || normalized.includes("verify")) return "needs_review";
  return "unknown";
}

function serviceEvidence(request: ClinicalAskRequest) {
  return searchServiceRecords(request.question, RESULT_LIMIT).map(({ service }) =>
    evidence(request, service.slug, {
      title: service.title,
      publisher: service.source?.label?.trim() || service.catalogueLabel?.trim() || "Services catalogue",
      jurisdiction: service.location?.trim() || null,
      href: `/services/${service.slug}`,
      extract: text([service.subtitle, service.bestUse, service.eligibility, service.referral, service.location]),
      reviewState: serviceReviewState(service.source?.status ?? service.source?.reviewed),
      publishedAt: service.source?.published ?? null,
      updatedAt: service.source?.reviewed ?? null,
    }),
  );
}

function formEvidence(request: ClinicalAskRequest) {
  return searchFormRecords(request.question, RESULT_LIMIT).map(({ service: form }) =>
    evidence(request, form.slug, {
      title: form.title,
      publisher: form.source?.label?.trim() || "Forms catalogue",
      jurisdiction: form.location?.trim() || null,
      href: `/forms/${form.slug}`,
      extract: text([form.subtitle, form.bestUse, form.eligibility, form.referral]),
      reviewState: serviceReviewState(form.source?.status ?? form.source?.reviewed),
      publishedAt: form.source?.published ?? null,
      updatedAt: form.source?.reviewed ?? null,
    }),
  );
}

function differentialEvidence(request: ClinicalAskRequest) {
  const snapshot = loadDifferentialSnapshot();
  const governance = deriveGovernanceFromSnapshot(snapshot);
  const reviewState: SourceReviewState =
    governance.validation_status === "locally_reviewed"
      ? governance.source_status === "review_due"
        ? "needs_review"
        : "reviewed"
      : "unknown";
  const diagnoses = searchDifferentialRecords(request.question);
  const presentations = searchPresentationWorkflows(request.question);
  return [
    ...diagnoses.map((record) =>
      evidence(request, `diagnosis:${record.slug}`, {
        title: record.title,
        publisher: snapshot.governance.sourceTitle,
        href: `/differentials/diagnoses/${record.slug}`,
        extract: text([record.subtitle, diagnosisOwnSummary(record), record.safetySnapshot.summary]),
        reviewState,
        updatedAt: snapshot.exportedAt,
      }),
    ),
    ...presentations.map((workflow) =>
      evidence(request, `presentation:${workflow.id}`, {
        title: workflow.title,
        publisher: snapshot.governance.sourceTitle,
        href: `/differentials/presentations/${workflow.id}`,
        extract: text([workflow.subtitle, workflow.safetySnapshot.summary, workflow.highestUrgencyNote]),
        reviewState,
        updatedAt: workflow.sourceStatus.lastUpdated || snapshot.exportedAt,
      }),
    ),
  ].slice(0, RESULT_LIMIT);
}

function formulationEvidence(request: ClinicalAskRequest) {
  const ranked = searchFormulationMechanisms(request.question);
  return ranked.slice(0, RESULT_LIMIT).map(({ mechanism }) =>
    evidence(request, mechanism.id, {
      title: mechanism.name,
      publisher: "Formulation catalogue",
      href: `/formulation/${mechanism.id}`,
      extract: text([mechanism.summary, mechanism.coreProcess, mechanism.formulationUse, ...mechanism.caveats]),
      reviewState: mechanism.sourceStatus.toLowerCase().includes("pending") ? "needs_review" : "unknown",
    }),
  );
}

/**
 * The DSM tier used to declare `publisher: "Authorised DSM clinical catalogue"`
 * and `reviewState: "reviewed"` on every item. Neither was derived from
 * anything: the catalogue is a vendored upstream snapshot with no review receipt
 * in this repository, and 145 of its 146 records carry no criteria at all.
 *
 * The consequence was not cosmetic. `assessEvidenceSufficiency` gates
 * `sufficient` on `hasReviewedSupport`, so a hard-coded "reviewed" made every
 * DSM answer register as fully supported by the catalogue alone and suppressed
 * the external-corroboration path that exists for exactly this case.
 *
 * Both fields now come from `dsmCatalogueProvenance`, and the extract states
 * when a record has no full criteria rather than letting a key-feature summary
 * read as the diagnostic standard.
 */
function dsmEvidence(request: ClinicalAskRequest) {
  return rankDsmDiagnoses(request.question, RESULT_LIMIT).map(({ diagnosis }) => {
    const summary = dsmDiagnosisSummary(diagnosis);
    const completeness =
      summary.criteriaProvenance === "dsm_criteria"
        ? null
        : "The full DSM-5-TR criteria are not included in this record; the text above is a key feature summary.";
    return evidence(request, diagnosis.slug, {
      title: summary.title,
      publisher: dsmCatalogueProvenance.label,
      href: `/dsm/diagnoses/${diagnosis.slug}`,
      extract: text([summary.category.label, summary.icd_code, summary.summary, completeness]),
      reviewState: dsmCatalogueProvenance.reviewState,
      // The export's generation date. It says how current the snapshot is, and
      // is deliberately not presented as a clinical review or publication date.
      updatedAt: dsmCatalogueProvenance.generatedOn,
    });
  });
}

function specifierEvidence(request: ClinicalAskRequest) {
  const rankedLabels = new Map(searchSpecifiers(request.question).map(({ record }, index) => [record.name, index]));
  const question = request.question.trim().toLowerCase();
  // Match on the ranked specifier search (the same signal the specifiers mode
  // uses), plus any catalogue item whose label or disorder contains a short
  // question verbatim. No match means no evidence for this tier.
  const items = specifierCatalogItems().filter(
    (item) =>
      rankedLabels.has(item.label) ||
      (question ? `${item.label} ${item.disorderName}`.toLowerCase().includes(question) : true),
  );
  const candidates = items
    .map((item, index) => ({ item, rank: rankedLabels.get(item.label) ?? rankedLabels.size + index }))
    .sort((left, right) => left.rank - right.rank)
    .slice(0, RESULT_LIMIT);
  return candidates.map(({ item }) => {
    const clinicianReviewed = isSpecifierClinicianReviewed(item.review);
    return evidence(request, item.slug, {
      title: item.label,
      // Same defect as the DSM label above: a fallback must not assert an
      // authority the item does not carry. The review state below is derived.
      publisher: item.definition?.sourceFamily || "Specifier catalogue",
      href: `/specifiers/${item.slug}`,
      // Keep the structural context searchable, but never send unsigned
      // definition wording to synthesis.
      extract: text([
        item.disorderName,
        clinicianReviewed ? item.definition?.meaning : undefined,
        clinicianReviewed ? item.definition?.clinicalNote : undefined,
        item.icd11Context,
      ]),
      reviewState:
        item.review.sourceVerificationStatus.includes("needs") || !clinicianReviewed ? "needs_review" : "reviewed",
    });
  });
}

function therapyEvidence(request: ClinicalAskRequest) {
  const ranked = searchTherapyRecords(request.question);
  return ranked.slice(0, RESULT_LIMIT).map(({ record }) => {
    const source = therapySourceMetadata(
      { title: record.name, sourceType: record.category, reference: record.clinicalSummary },
      record.reviewStatus,
    );
    return evidence(request, record.slug, {
      title: record.name,
      publisher: "Therapy Compass catalogue",
      href: therapyRecordHref(record.slug),
      extract: text([record.clinicalSummary, record.bestUsedFor, record.targetSymptoms, record.indications]),
      reviewState: source.clinical_validation_status === "locally_reviewed" ? "reviewed" : "needs_review",
    });
  });
}

export async function retrieveCatalogueEvidence(
  request: ClinicalAskRequest,
  signal: AbortSignal,
): Promise<ClinicalAskEvidence[]> {
  abortIfRequested(signal);
  let result: ClinicalAskEvidence[];
  switch (request.mode) {
    case "services":
      result = serviceEvidence(request);
      break;
    case "forms":
      result = formEvidence(request);
      break;
    case "differentials":
      result = differentialEvidence(request);
      break;
    case "formulation":
      result = formulationEvidence(request);
      break;
    case "dsm":
      result = dsmEvidence(request);
      break;
    case "specifiers":
      result = specifierEvidence(request);
      break;
    case "therapy-compass":
      result = therapyEvidence(request);
      break;
  }
  abortIfRequested(signal);
  return result;
}
