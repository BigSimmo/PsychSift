import type { RagQueryClass, SearchResult } from "@/lib/types";
import {
  bestPracticePrescriptionProfileEvidence,
  bestPracticePrescriptionProgramUseEvidence,
  isSourceBoundBestPracticePrescriptionRequirementsQuery,
} from "@/lib/rag/rag-extractive-answer";

/**
 * Give the measured Best Practice Prescription extractive-first builder the two chunks it pairs.
 * Answer-evidence selection can fill the fast four-chunk budget with the procedure's legislative and
 * monitoring chunks (live canaries 38383361787 and 38419027058 cited only p4 chunks 05a8819b and 212f78ad),
 * so the builder found no program-use + medication-profile pair and the query fell through to model
 * generation, which the final gate then rejected as ungrounded. When the selected evidence cannot
 * form that pair, append at most one governed eligible chunk per role from the same AKG document,
 * using the builder's own evidence predicates. Nothing is appended for any other query, and the
 * short-circuit still requires the candidate answer to pass every final quality gate.
 */
export function withBestPracticePrescriptionEvidence(args: {
  query: string;
  queryClass: RagQueryClass;
  selected: SearchResult[];
  candidates: readonly SearchResult[];
}) {
  if (!isSourceBoundBestPracticePrescriptionRequirementsQuery(args.query, args.queryClass)) return args.selected;
  const selectedIds = new Set(args.selected.map((result) => result.id));
  const pool = [...args.selected, ...args.candidates.filter((result) => !selectedIds.has(result.id))];
  const useSources = pool.filter(bestPracticePrescriptionProgramUseEvidence);
  const profileSources = pool.filter(bestPracticePrescriptionProfileEvidence);
  const cost = (result: SearchResult) => (selectedIds.has(result.id) ? 0 : 1);
  let best: { use: SearchResult; profile: SearchResult; cost: number } | undefined;
  for (const use of useSources) {
    for (const profile of profileSources) {
      if (use.id === profile.id || !use.document_id || use.document_id !== profile.document_id) continue;
      const pairCost = cost(use) + cost(profile);
      if (!best || pairCost < best.cost) best = { use, profile, cost: pairCost };
    }
  }
  if (!best || best.cost === 0) return args.selected;
  const additions = [best.use, best.profile].filter((result) => !selectedIds.has(result.id));
  return [...args.selected, ...additions];
}
