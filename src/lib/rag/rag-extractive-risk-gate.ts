import { medicationSafetyEntitiesInText } from "@/lib/medication-entities";
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

const genericDoseQueryWords = new Set([
  "about",
  "adult",
  "adults",
  "advised",
  "children",
  "commence",
  "doses",
  "dosing",
  "given",
  "maximum",
  "medication",
  "medications",
  "medicine",
  "medicines",
  "recommended",
  "should",
  "starting",
  "there",
  "these",
  "which",
]);

/**
 * A dose-risk quoted answer that gives a dose figure, names no recognised medicine and shares no
 * subject word with the question (child agitation doses quoted for "IM doses for agitation"). An
 * answer that repeats the asked-for name is kept, because the medicine list is not complete.
 */
export function doseWithoutNamedMedicationReason(answerText: string, queryClass: RagQueryClass, query: string) {
  if (queryClass !== "medication_dose_risk") return null;
  if (!doseFigurePattern.test(answerText)) return null;
  if (medicationSafetyEntitiesInText(answerText).length) return null;
  const answerLower = answerText.toLowerCase();
  const subjectWords = (query.toLowerCase().match(/[a-z]{5,}/g) ?? []).filter(
    (word) => !genericDoseQueryWords.has(word),
  );
  return subjectWords.some((word) => answerLower.includes(word)) ? null : "dose_without_named_medication";
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
    return queryMedications.some((entity) => answerMedications.has(entity)) ? null : "medication_subject_not_in_answer";
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
