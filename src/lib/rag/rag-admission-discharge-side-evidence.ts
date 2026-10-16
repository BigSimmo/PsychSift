import type { RagQueryClass, SearchResult } from "@/lib/types";
import {
  admissionComparisonTermPattern,
  admissionRequirementBindingPatterns,
  dischargeComparisonTermPattern,
  dischargeRequirementBindingPatterns,
  isAdmissionDischargeRequirementsComparisonQuery,
  sourceBoundComparisonFacts,
} from "@/lib/rag/rag-extractive-answer";

const sides = [
  {
    subjectPattern: admissionComparisonTermPattern,
    otherSubjectPattern: dischargeComparisonTermPattern,
    requirementBindingPatterns: admissionRequirementBindingPatterns,
  },
  {
    subjectPattern: dischargeComparisonTermPattern,
    otherSubjectPattern: admissionComparisonTermPattern,
    requirementBindingPatterns: dischargeRequirementBindingPatterns,
  },
] as const;

/**
 * Give the admission/discharge fallback builder both sides to work from. Answer-evidence selection
 * can fill every slot with one stage's documents (live canary 38363682098: the admission guideline
 * ranked in search but never reached the builder), so the builder failed closed. The builder pairs
 * source-bound requirement facts from two different documents; when the selected evidence cannot form
 * such a pair, append the fewest governed eligible chunks (at most one per side) that complete a pair from
 * two different documents, using the builder's own fact extraction. Every claim still passes
 * the claim-support gate, so a side with no bound requirement still fails closed.
 */
const isCommunityAdmissionResult = (result: SearchResult) =>
  /\bcommunity\b|admissioncommunitypts/i.test(`${result.title ?? ""} ${result.file_name ?? ""}`);

export function withAdmissionDischargeSideEvidence(args: {
  query: string;
  queryClass: RagQueryClass;
  selected: SearchResult[];
  candidates: readonly SearchResult[];
}) {
  if (!isAdmissionDischargeRequirementsComparisonQuery(args.query, args.queryClass)) return args.selected;
  const selectedIds = new Set(args.selected.map((result) => result.id));
  const pool = [...args.selected, ...args.candidates.filter((result) => !selectedIds.has(result.id))];
  const [rawAdmissionFacts, dischargeFacts] = sides.map((side) =>
    sourceBoundComparisonFacts({ ...side, results: pool }),
  );
  const communityAdmissionFacts = rawAdmissionFacts.filter((fact) => isCommunityAdmissionResult(fact.result));
  const admissionFacts = communityAdmissionFacts.length > 0 ? communityAdmissionFacts : rawAdmissionFacts;
  const selectedAdmissionDocs = new Set(
    admissionFacts.filter((fact) => selectedIds.has(fact.result.id)).map((fact) => fact.result.document_id),
  );
  const selectedDischargeDocs = new Set(
    dischargeFacts.filter((fact) => selectedIds.has(fact.result.id)).map((fact) => fact.result.document_id),
  );
  // A pair already exists when the two sides draw on at least one different document each.
  if ([...selectedAdmissionDocs].some((id) => [...selectedDischargeDocs].some((other) => other !== id))) {
    return args.selected;
  }
  const cost = (result: SearchResult) => (selectedIds.has(result.id) ? 0 : 1);
  let best: { admission: SearchResult; discharge: SearchResult; cost: number } | undefined;
  for (const admission of admissionFacts) {
    for (const discharge of dischargeFacts) {
      if (admission.result.document_id === discharge.result.document_id) continue;
      const pairCost = cost(admission.result) + cost(discharge.result);
      if (!best || pairCost < best.cost)
        best = { admission: admission.result, discharge: discharge.result, cost: pairCost };
    }
  }
  const additions = best
    ? [best.admission, best.discharge].filter(
        (result, position, all) => !selectedIds.has(result.id) && all.indexOf(result) === position,
      )
    : [];
  return additions.length ? [...args.selected, ...additions] : args.selected;
}

export function withAdmissionDischargeContextPair<
  T extends { served: { results: SearchResult[] }; strongRetry: { results: SearchResult[] } },
>(args: { query: string; queryClass: RagQueryClass; pair: T; candidates: readonly SearchResult[] }): T {
  if (!isAdmissionDischargeRequirementsComparisonQuery(args.query, args.queryClass)) return args.pair;
  return {
    ...args.pair,
    served: {
      ...args.pair.served,
      results: withAdmissionDischargeSideEvidence({
        query: args.query,
        queryClass: args.queryClass,
        selected: args.pair.served.results,
        candidates: args.candidates,
      }),
    },
    strongRetry: {
      ...args.pair.strongRetry,
      results: withAdmissionDischargeSideEvidence({
        query: args.query,
        queryClass: args.queryClass,
        selected: args.pair.strongRetry.results,
        candidates: args.candidates,
      }),
    },
  };
}
