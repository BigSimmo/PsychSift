import { evaluateEvidenceCoverageGate } from "@/lib/rag/rag-coverage-gate";
import { isKnownSourceCorpusScope } from "@/lib/source-metadata";
import type {
  AnswerCoveragePlan,
  ClinicalAmbiguity,
  RagInsufficiencyReason,
  RagQueryPlan,
  SearchResult,
  SiteContentDomain,
  SourcePolicyConflict,
} from "@/lib/types";

const knownSiteDomains = new Set<SiteContentDomain>([
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
]);

export type SubquestionEvidenceInput = {
  subquestionId: string;
  selectedChunkIds: readonly string[];
  citedChunkIds: readonly string[];
  /** Optional existing role/governance selection; absent means selectedChunkIds are already eligible. */
  eligibleChunkIds?: readonly string[];
  support?: "direct" | "partial";
  reasonCodes?: readonly string[];
  insufficiencyReason?: RagInsufficiencyReason | null;
};

export type EvaluateAnswerCoverageInput = {
  plan: RagQueryPlan;
  selectedEvidence: readonly SearchResult[];
  evidenceBySubquestion: readonly SubquestionEvidenceInput[];
  conflicts?: readonly SourcePolicyConflict[];
  ambiguity?: ClinicalAmbiguity | null;
  insufficiencyReason?: RagInsufficiencyReason | null;
};

function candidateHasKnownServerScope(result: SearchResult) {
  if (!isKnownSourceCorpusScope(result.corpus_scope)) return false;
  if (result.site_content_domain != null && !knownSiteDomains.has(result.site_content_domain as SiteContentDomain)) {
    return false;
  }
  if (result.source_metadata?.source_kind === "registry_record" && result.corpus_scope !== "clinical_kb_site") {
    return false;
  }
  return true;
}

function retainedConflicts(conflicts: readonly SourcePolicyConflict[], directlyCitedIds: ReadonlySet<string>) {
  return conflicts.filter(
    (conflict) =>
      conflict.local.supportingChunkIds.some((id) => directlyCitedIds.has(id)) &&
      conflict.australian.supportingChunkIds.some((id) => directlyCitedIds.has(id)),
  );
}

function inferredInsufficiencyReason(
  input: EvaluateAnswerCoverageInput,
  overall: AnswerCoveragePlan["overall"],
): RagInsufficiencyReason | null {
  if (overall === "complete") return null;
  if (overall === "conflicting") return "source_conflict";
  if (input.insufficiencyReason) return input.insufficiencyReason;
  const selectedReason = input.evidenceBySubquestion.find((item) => item.insufficiencyReason)?.insufficiencyReason;
  if (selectedReason) return selectedReason;
  return overall === "absent" ? "not_in_corpus" : "insufficient_claim_support";
}

export function evaluateAnswerCoverage(input: EvaluateAnswerCoverageInput): AnswerCoveragePlan {
  const evidenceById = new Map(input.selectedEvidence.map((result) => [result.id, result]));
  const selectionBySubquestion = new Map(input.evidenceBySubquestion.map((item) => [item.subquestionId, item]));
  const allDirectIds = new Set<string>();

  const coverage: AnswerCoveragePlan["coverage"] = input.plan.subquestions.map((subquestion) => {
    const selection = selectionBySubquestion.get(subquestion.id);
    const selectedIds = new Set(selection?.selectedChunkIds ?? []);
    const citedIds = new Set(selection?.citedChunkIds ?? []);
    const eligibleIds = selection?.eligibleChunkIds ? new Set(selection.eligibleChunkIds) : selectedIds;
    let rejectedScope = false;
    const directEvidence = [...selectedIds].flatMap((id) => {
      if (!citedIds.has(id) || !eligibleIds.has(id)) return [];
      const result = evidenceById.get(id);
      if (!result) return [];
      if (!candidateHasKnownServerScope(result)) {
        rejectedScope = true;
        return [];
      }
      allDirectIds.add(id);
      return [result];
    });
    const gate = evaluateEvidenceCoverageGate(subquestion.question, directEvidence);
    const reasonCodes = [
      ...(selection?.reasonCodes ?? []),
      `evidence_gate:${gate.reason}`,
      ...(rejectedScope ? ["candidate_scope_rejected"] : []),
    ];
    const status: AnswerCoveragePlan["coverage"][number]["status"] =
      directEvidence.length === 0 ? "absent" : selection?.support === "partial" ? "partial" : "direct";
    return {
      subquestionId: subquestion.id,
      status,
      chunkIds: directEvidence.map((result) => result.id),
      reasonCodes: [...new Set(reasonCodes)],
    } satisfies AnswerCoveragePlan["coverage"][number];
  });

  const conflicts = retainedConflicts(input.conflicts ?? [], allDirectIds);
  const conflictChunkIds = new Set(
    conflicts.flatMap((conflict) => [...conflict.local.supportingChunkIds, ...conflict.australian.supportingChunkIds]),
  );
  for (const item of coverage) {
    if (item.chunkIds.some((id) => conflictChunkIds.has(id))) item.status = "conflicting";
  }

  const requiredIds = new Set(input.plan.subquestions.filter((item) => item.required).map((item) => item.id));
  const requiredCoverage = coverage.filter((item) => requiredIds.has(item.subquestionId));
  const directCount = requiredCoverage.filter((item) => item.status === "direct").length;
  const anySupported = requiredCoverage.some((item) => item.status !== "absent");
  const overall: AnswerCoveragePlan["overall"] =
    conflicts.length > 0
      ? "conflicting"
      : requiredCoverage.length > 0 && directCount === requiredCoverage.length
        ? "complete"
        : anySupported
          ? "partial"
          : "absent";

  return {
    interpretation: input.plan.interpretation,
    ambiguity: input.ambiguity ?? null,
    subquestions: input.plan.subquestions.map(({ id, question, required }) => ({ id, question, required })),
    coverage,
    conflicts,
    overall,
    insufficiencyReason: inferredInsufficiencyReason(input, overall),
  };
}
