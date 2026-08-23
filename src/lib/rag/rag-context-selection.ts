import type { ClinicalClaimRole, RagAnswer, RagQueryClass, SearchResult } from "@/lib/types";
import { selectAustralianClinicalContext } from "@/lib/australian-source-priority";

export { summarizeAustralianSourceSelection } from "@/lib/australian-source-priority";

const fastRoutineModelContextLimit = 4;

const maxContextChunksPerDocument = 3;

// The current verified classifier distinguishes numeric/dose questions from broader clinical
// questions, but does not yet prove legal, subsidy, quality, or service-workflow claim intent.
// Fail those ambiguous classes closed to treatment eligibility rather than admitting a more
// permissive role. A later intent-aware retrieval phase may replace this exhaustive mapping.
const claimRoleByQueryClass = {
  document_lookup: "treatment",
  table_threshold: "dose_or_monitoring",
  medication_dose_risk: "dose_or_monitoring",
  comparison: "treatment",
  broad_summary: "treatment",
  unsupported_or_general: "treatment",
} as const satisfies Record<RagQueryClass, ClinicalClaimRole>;

// P9: keep one verbose document from dominating the sources the model sees. Cap each document to at
// most `maxContextChunksPerDocument` chunks (order-preserving, no reranking/dedup), but only when the
// result set spans multiple documents — a genuinely single-document answer must not be starved.
export function capPerDocumentCrowding(results: SearchResult[], maxPerDocument = maxContextChunksPerDocument) {
  if (results.length <= maxPerDocument) return results;
  const distinctDocuments = new Set(results.map((result) => result.document_id)).size;
  if (distinctDocuments < 2) return results;
  const documentCounts = new Map<string, number>();
  const capped: SearchResult[] = [];
  for (const result of results) {
    const count = documentCounts.get(result.document_id) ?? 0;
    if (count >= maxPerDocument) continue;
    documentCounts.set(result.document_id, count + 1);
    capped.push(result);
  }
  return capped;
}

export function selectModelContextResults(args: {
  routeMode: RagAnswer["routingMode"];
  queryClass: RagQueryClass;
  crossDocument: boolean;
  results: SearchResult[];
}) {
  const highRiskNumericQuery = args.queryClass === "medication_dose_risk" || args.queryClass === "table_threshold";
  if (highRiskNumericQuery) {
    return selectAustralianClinicalContext(args.results, { claimRole: claimRoleByQueryClass[args.queryClass] });
  }

  const fastRoutineQuery =
    args.routeMode === "fast" &&
    !args.crossDocument &&
    args.queryClass !== "comparison" &&
    args.queryClass !== "broad_summary";
  // Preserve the retrieval-ranked fast budget before applying the order-only
  // Australian preference. This keeps a stronger/unique supplementary result
  // inside the four-chunk budget while still moving equally relevant local
  // guidance ahead within that retained set. Apply the existing crowding cap
  // first so a fourth chunk from one document cannot hide another document.
  const preferenceCandidates = fastRoutineQuery
    ? capPerDocumentCrowding(
        args.results.filter((result) => result.relevance?.verdict !== "none"),
        maxContextChunksPerDocument,
      ).slice(0, fastRoutineModelContextLimit)
    : args.results;

  // All answer classes should prefer authoritative Australian guidance when it
  // is equally relevant. For non-numeric questions this is an order-only
  // preference: retain supplementary evidence so a local source cannot hide a
  // stronger or uniquely relevant international passage. Numeric/high-risk
  // queries keep the stricter bounded Australian-first policy above.
  const results = selectAustralianClinicalContext(preferenceCandidates, {
    claimRole: claimRoleByQueryClass[args.queryClass],
    limit: preferenceCandidates.length,
    maxPerDocument: maxContextChunksPerDocument,
    omitSupplementaryPadding: false,
  });
  return results;
}
