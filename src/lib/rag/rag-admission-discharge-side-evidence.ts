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
export function withAdmissionDischargeSideEvidence(args: {
  query: string;
  queryClass: RagQueryClass;
  selected: SearchResult[];
  candidates: readonly SearchResult[];
}) {
  if (!isAdmissionDischargeRequirementsComparisonQuery(args.query, args.queryClass)) return args.selected;
  const selectedDocuments = sides.map(
    (side) => new Set(sourceBoundComparisonFacts({ ...side, results: args.selected }).map((f) => f.result.document_id)),
  );
  const [admissionDocuments, dischargeDocuments] = selectedDocuments;
  // A pair already exists when the two sides draw on at least one different document each.
  if ([...admissionDocuments].some((id) => [...dischargeDocuments].some((other) => other !== id))) {
    return args.selected;
  }
  const selectedIds = new Set(args.selected.map((result) => result.id));
  const pool = [...args.selected, ...args.candidates.filter((result) => !selectedIds.has(result.id))];
  // Search both sides jointly over selected + eligible evidence for the pair of facts from two
  // different documents that needs the fewest added chunks (ties keep retrieval order). Choosing
  // sides independently can miss a valid pair, e.g. selected document A's admission blocking A's
  // discharge while document B's admission is never considered, or a per-side cap filled by one
  // document hiding the only other document.
  const [admissionFacts, dischargeFacts] = sides.map((side) => sourceBoundComparisonFacts({ ...side, results: pool }));
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
