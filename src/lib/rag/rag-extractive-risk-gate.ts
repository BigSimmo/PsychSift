import { medicationEntityMatchesInText, medicationSafetyEntitiesInText } from "@/lib/medication-entities";
import type { RagQueryClass } from "@/lib/types";

/**
 * Answer safety re-audit A2R-01 (26 Oct 2026, owner yes "yes to both"). Quoted-text
 * (extractive) answers were shown as sourced while answering a different question:
 * child agitation doses with no medicine named, a bupropion card for zuranolone, an
 * ECT passage for clozapine, oral thiamine for Wernicke prevention. These pure checks
 * decide when a quoted passage must be shown as "passages to review" instead.
 */

const highRiskQueryClasses = new Set<RagQueryClass>(["medication_dose_risk", "table_threshold"]);
const weakRetrievalRouteReason = /\b(?:retrieval_gap_or_conflict|limited_retrieval_strength)\b/;
const doseFigurePattern = /\b\d+(?:\.\d+)?\s*(?:mg|mcg|micrograms?|g|mL|units?)\b/i;
// Short upper-case query subjects (ECT, CTO, CIWA) that a cited passage must name. Route,
// unit and place abbreviations are excluded because answers rarely repeat them.
const queryAcronymPattern = /\b[A-Z][A-Z0-9]{1,5}\b/g;
const ignoredQueryAcronyms = new Set(["IM", "IV", "PO", "SC", "UK", "US", "AU", "WA", "NSW", "OK", "PRN", "MG"]);
// Clinical acronyms people often type in lower case.
const lowercaseQueryAcronyms = /\b(?:ect|cto|ciwa|nms|ssri|snri|maoi|tca|rtms)\b/g;

// Endings shared by most medicine names, so an unrecognised name in the question ("zolinapine")
// can still count as the asked-for medicine while a topic word ("agitation") cannot.
const medicineNameShape =
  /^[a-z]{5,}(?:apine|pine|idone|done|azepam|azolam|pam|lam|oxetine|oxamine|aline|tyline|pramine|prazole|olol|pril|sartan|mab|nib|zine|xine|amide|mide|thium|proate|amate|igine|ine|one|ol|ate)$/;
const nonMedicineWords = new Set([
  "adolescent",
  "alcohol",
  "alone",
  "baseline",
  "cholesterol",
  "combine",
  "determine",
  "estimate",
  "examine",
  "immediate",
  "intermediate",
  "medicine",
  "moderate",
  "online",
  "routine",
  "someone",
  "urine",
]);

/** Words in the question that look like a medicine name, recognised or not. */
function queryMedicineNameWords(query: string) {
  return (query.toLowerCase().match(/[a-z]{5,}/g) ?? []).filter(
    (word) => medicineNameShape.test(word) && !nonMedicineWords.has(word),
  );
}

/**
 * A dose-risk quoted answer that gives a dose figure and names no recognised medicine, unless it
 * repeats a medicine-like name from the question (the medicine list is not complete). A shared
 * topic word ("For agitation, give 10 mg IM") does not count, because the medicine is unknown.
 */
export function doseWithoutNamedMedicationReason(answerText: string, queryClass: RagQueryClass, query: string) {
  if (queryClass !== "medication_dose_risk") return null;
  if (!doseFigurePattern.test(answerText)) return null;
  if (medicationSafetyEntitiesInText(answerText).length) return null;
  const answerLower = answerText.toLowerCase();
  return queryMedicineNameWords(query).some((word) => answerLower.includes(word))
    ? null
    : "dose_without_named_medication";
}

/**
 * Every quoted dose figure belongs to a medicine the question did not ask about: each figure is
 * read against the nearest medicine named before it in the same sentence ("If taking lithium,
 * give diazepam 10 mg" gives the dose to diazepam). Figures with no medicine before them are
 * ignored, and one figure for the asked-for medicine is enough to keep the answer.
 */
export function doseAttributedToOtherMedicationReason(query: string, answerText: string) {
  const queryMedications = new Set(medicationSafetyEntitiesInText(query));
  if (!queryMedications.size) return null;
  const safeAnswerMedications = new Set(medicationSafetyEntitiesInText(answerText));
  const mentions = medicationEntityMatchesInText(answerText).filter((match) =>
    safeAnswerMedications.has(match.canonical),
  );
  const owners: string[] = [];
  for (const dose of answerText.matchAll(new RegExp(doseFigurePattern.source, "gi"))) {
    const owner = mentions
      .filter((mention) => mention.end <= dose.index)
      .filter((mention) => !/[.!?;\n]/.test(answerText.slice(mention.end, dose.index)))
      .at(-1);
    if (owner) owners.push(owner.canonical);
  }
  if (!owners.length || owners.some((owner) => queryMedications.has(owner))) return null;
  return "dose_attributed_to_other_medication";
}

/**
 * A dose or threshold quote about a different medicine from the one asked about: the asked-for
 * medicine is missing, or the question names none and the quote names one (a bupropion card for
 * a zuranolone question, where zuranolone is not yet a recognised medicine).
 */
export function medicationSubjectMismatchReason(query: string, answerText: string) {
  const queryMedications = medicationSafetyEntitiesInText(query);
  const answerMedications = new Set(medicationSafetyEntitiesInText(answerText));
  if (queryMedications.length) {
    if (!queryMedications.some((entity) => answerMedications.has(entity))) return "medication_subject_not_in_answer";
    return doseAttributedToOtherMedicationReason(query, answerText);
  }
  return answerMedications.size ? "answer_names_unasked_medication" : null;
}

/** A distinctive query acronym the shown quoted answer never mentions. */
export function querySubjectNotInAnswerReason(query: string, answerText: string) {
  const acronyms = Array.from(
    new Set([
      ...(query.match(queryAcronymPattern) ?? []),
      ...(query.toLowerCase().match(lowercaseQueryAcronyms) ?? []).map((token) => token.toUpperCase()),
    ]),
  ).filter((token) => !ignoredQueryAcronyms.has(token));
  if (!acronyms.length) return null;
  const haystack = answerText.toLowerCase();
  const missing = acronyms.filter(
    (token) => !new RegExp(`(?:^|[^a-z0-9])${token.toLowerCase()}(?:$|[^a-z0-9])`).test(haystack),
  );
  return missing.length ? "query_subject_not_in_answer" : null;
}

/**
 * Why a quoted passage chosen after a failed AI draft must be shown for review rather than as
 * a sourced answer: a dose or threshold quote about another medicine, any route that already
 * reported weak or conflicting retrieval, a dose with no medicine named, or a missing subject.
 */
export function extractiveFallbackRiskReason(args: {
  query: string;
  queryClass: RagQueryClass;
  routeReason: string;
  answerText: string;
}) {
  if (highRiskQueryClasses.has(args.queryClass)) {
    const medicationReason = medicationSubjectMismatchReason(args.query, args.answerText);
    if (medicationReason) return medicationReason;
  }
  if (weakRetrievalRouteReason.test(args.routeReason)) return "weak_retrieval_extractive_after_failed_generation";
  return (
    doseWithoutNamedMedicationReason(args.answerText, args.queryClass, args.query) ??
    querySubjectNotInAnswerReason(args.query, args.answerText)
  );
}
