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
 * such a pair, append up to three governed eligible chunks per missing side, from documents other than
 * those supplying the opposite side, using the builder's own fact extraction. Every claim still passes
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
  const unselected = args.candidates.filter((result) => !selectedIds.has(result.id));
  const additions: SearchResult[] = [];
  sides.forEach((side, index) => {
    const oppositeDocuments = selectedDocuments[1 - index];
    // This side is present and only the other side is missing: the other side's additions complete the pair.
    if (selectedDocuments[index].size && !oppositeDocuments.size) return;
    additions.push(
      ...sourceBoundComparisonFacts({ ...side, results: unselected })
        .map((fact) => fact.result)
        // One chunk can yield several facts; add each chunk once, never from the opposite side's documents.
        .filter(
          (result, position, all) =>
            all.indexOf(result) === position &&
            !additions.includes(result) &&
            !oppositeDocuments.has(result.document_id),
        )
        .slice(0, 3),
    );
  });
  return additions.length ? [...args.selected, ...additions] : args.selected;
}
